using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Model;

namespace Documents;

/// <summary>
/// Works out a month's billing: what the live preview shows, and what an invoice freezes when it is finalized.
/// Billable hours per member per day = worked hours raised to the daily minimum (on days with work) and capped at
/// the daily maximum, times the member's billable fraction, then rounded up to the project's rounding step (15, 30 or
/// 60 minutes), if any. A maximum of 0 or 24+ means no cap; a minimum of 0 means no minimum. Days start at midnight in
/// the project's billing time zone.
/// Every hour is billed exactly once: a report covers all recorded work up to the end of its month, minus what earlier
/// finalized (not canceled) invoices already billed for each member-day. Earlier days left unbilled are marked CarriedOver.
/// </summary>
public sealed class BillingReports(AppDbContext db)
{
    public static readonly Dictionary<string, decimal> Fractions = new()
    {
        ["1/1"] = 1m, ["3/4"] = 0.75m, ["2/3"] = 2m / 3m, ["1/2"] = 0.5m,
    };

    /// <summary>The rounding steps offered, in minutes; 0 is no rounding.</summary>
    public static readonly int[] RoundingSteps = [0, 15, 30, 60];

    /// <summary>
    /// Hours rounded up to a whole number of steps; unchanged without a step. Rounded to the second first, so time that
    /// is exactly on a step (2 h from timestamps) is not pushed to the next one.
    /// </summary>
    public static decimal RoundUp(decimal hours, int stepMinutes)
    {
        if (stepMinutes <= 0) return hours;
        var step = stepMinutes / 60m;
        return Math.Ceiling(Math.Round(hours * 3600) / 3600 / step) * step;
    }

    /// <summary>A daily maximum of 0 or 24 hours and above means the day is not capped.</summary>
    public static bool IsCapped(decimal maxHoursPerDay) => maxHoursPerDay > 0 && maxHoursPerDay < 24;

    public static bool TryParseMonth(string month, out DateTime parsed) =>
        DateTime.TryParseExact(month, "yyyy-MM", CultureInfo.InvariantCulture, DateTimeStyles.None, out parsed);

    /// <summary>Finalized invoices that count: canceled ones bill nothing and are owed nothing.</summary>
    private IQueryable<Invoice> Counted(long projectId) =>
        db.Invoices.AsNoTracking()
            .Where(invoice => invoice.ProjectId == projectId && invoice.Status == Document.Final && invoice.PaymentStatus != "canceled");

    /// <summary>The project's billing time zone; UTC when none is set or it is not known on this server.</summary>
    public static TimeZoneInfo BillingZone(Project project) =>
        project.BillingTimeZone != "" && TimeZoneInfo.TryFindSystemTimeZoneById(project.BillingTimeZone, out var zone)
            ? zone
            : TimeZoneInfo.Utc;

    /// <summary>
    /// The moment the given day starts in the zone: local midnight, or the first moment after it on the rare days
    /// clocks jump forward at midnight, when midnight itself never happens.
    /// </summary>
    public static DateTimeOffset MidnightIn(TimeZoneInfo zone, DateTime day)
    {
        var local = DateTime.SpecifyKind(day.Date, DateTimeKind.Unspecified);
        while (zone.IsInvalidTime(local)) local = local.AddMinutes(30);
        return new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(local, zone), TimeSpan.Zero);
    }

    /// <summary>The month's billing as it stands now. month is "yyyy-MM" and must parse.</summary>
    public async Task<BillingReport> Build(Project project, string month, CancellationToken cancellationToken)
    {
        if (!TryParseMonth(month, out var parsed)) throw new ArgumentException("The month must look like 2026-10.", nameof(month));
        var projectId = project.Id;
        // Days and months start at midnight in the project's billing time zone, as the people working there count them.
        var zone = BillingZone(project);
        var nextMonth = MidnightIn(zone, new DateTime(parsed.Year, parsed.Month, 1).AddMonths(1));
        var now = DateTimeOffset.UtcNow;

        // Filtered in memory: SQLite cannot compare DateTimeOffset values in queries.
        var sessions = await db.WorkSessions.AsNoTracking()
            .Where(session => session.ProjectId == projectId)
            .Select(session => new { session.UserId, session.StartedAt, session.EndedAt })
            .ToListAsync(cancellationToken);

        // Hours per member per day for all work up to the end of the month, splitting sessions that cross midnight.
        var hours = new Dictionary<(string UserId, DateOnly Day), decimal>();
        foreach (var session in sessions)
        {
            var from = session.StartedAt;
            // Finished sessions count in full, even ones entered ahead of time; running ones up to now. Nothing counts
            // past the end of the month.
            var sessionEnd = session.EndedAt ?? now;
            var to = sessionEnd < nextMonth ? sessionEnd : nextMonth;
            while (from < to)
            {
                var localDay = TimeZoneInfo.ConvertTime(from, zone).Date;
                var dayEnd = MidnightIn(zone, localDay.AddDays(1));
                var end = dayEnd < to ? dayEnd : to;
                var key = (session.UserId, DateOnly.FromDateTime(localDay));
                hours[key] = hours.GetValueOrDefault(key) + (decimal)(end - from).TotalHours;
                from = end;
            }
        }

        var userIds = hours.Keys.Select(key => key.UserId).Distinct().ToList();
        var people = await db.Users.AsNoTracking()
            .Where(user => userIds.Contains(user.Id))
            .Select(user => new { user.Id, Name = user.DisplayName != "" ? user.DisplayName : user.UserName ?? "" })
            .ToDictionaryAsync(user => user.Id, user => user.Name, cancellationToken);
        // People removed from the project since keep their hours, billed at 1/1.
        var fractions = await db.ProjectMembers.AsNoTracking()
            .Where(member => member.ProjectId == projectId)
            .ToDictionaryAsync(member => member.UserId, member => member.BillableFraction, cancellationToken);

        // What earlier invoices already billed per member-day.
        var billed = new Dictionary<(string UserId, DateOnly Day), (decimal Hours, decimal Billable)>();
        var earlier = await Counted(projectId).Select(invoice => invoice.ContentJson).ToListAsync(cancellationToken);
        foreach (var json in earlier)
        {
            foreach (var day in JsonSerializer.Deserialize<BillingReport>(json, JsonSerializerOptions.Web)!.Days)
            {
                var key = (day.UserId, day.Date);
                var (billedHours, billedBillable) = billed.GetValueOrDefault(key);
                billed[key] = (billedHours + day.HoursWorked, billedBillable + day.BillableHours);
            }
        }

        // Daily limits apply to the day's full total; what was billed before is then subtracted,
        // so a day never gets the minimum twice nor more than the maximum in total.
        var monthStart = new DateOnly(parsed.Year, parsed.Month, 1);
        var days = hours
            .Select(entry =>
            {
                var fraction = fractions.GetValueOrDefault(entry.Key.UserId, "1/1");
                var clamped = Math.Max(entry.Value, project.BillingMinHoursPerDay);
                if (IsCapped(project.BillingMaxHoursPerDay)) clamped = Math.Min(clamped, project.BillingMaxHoursPerDay);
                var (billedHours, billedBillable) = billed.GetValueOrDefault(entry.Key);
                return new BillingDay(
                    entry.Key.Day, entry.Key.UserId, people.GetValueOrDefault(entry.Key.UserId, "Former member"), fraction,
                    Math.Round(entry.Value - billedHours, 2),
                    // Rounded on the day's full total, so the part earlier invoices billed stays on whole steps too.
                    Math.Max(0, Math.Round(RoundUp(clamped * Fractions[fraction], project.BillingRoundingMinutes) - billedBillable, 2)),
                    entry.Key.Day < monthStart);
            })
            // Keep days with anything to bill: a few seconds of work still bills the daily minimum. Days with nothing
            // billable and under 0.01 h (36 s) left are rounding leftovers from earlier invoices.
            .Where(day => day.BillableHours > 0 || day.HoursWorked >= 0.01m)
            .OrderBy(day => day.Date).ThenBy(day => day.Name)
            .ToList();

        var members = days
            .GroupBy(day => day.UserId)
            .Select(group =>
            {
                var billable = group.Sum(day => day.BillableHours);
                return new BillingMemberTotal(
                    group.First().Name, group.First().Fraction, group.Count(), group.Sum(day => day.HoursWorked),
                    billable, Math.Round(billable * project.BillingCostPerHour, 2));
            })
            .OrderBy(member => member.Name)
            .ToList();

        // Earlier invoices still owed, by month; stored with the invoice when it is finalized.
        var overdue = (await Counted(projectId)
                .Where(invoice => invoice.Month != month
                    && (invoice.PaymentStatus == "unpaid" || invoice.PaymentStatus == "partiallyPaid"))
                .ToListAsync(cancellationToken))
            .Where(invoice => string.CompareOrdinal(invoice.Month, month) < 0)
            .OrderBy(invoice => invoice.Month)
            .Select(invoice => new OverdueBill(invoice.Number ?? invoice.Id, invoice.Month, invoice.Overdue))
            .ToList();

        var amount = members.Sum(member => member.Amount);
        // VAT is added to this month's work only: overdue invoices already include their own.
        var vat = Math.Round(amount * project.BillingVatRate / 100, 2);
        var overdueTotal = overdue.Sum(invoice => invoice.Amount);
        var carriedOverBillable = days.Where(day => day.CarriedOver).Sum(day => day.BillableHours);
        return new BillingReport(
            project.Name, month, ToSettings(project), members, days,
            members.Sum(member => member.HoursWorked), members.Sum(member => member.BillableHours), amount,
            overdue, overdueTotal, amount + vat + overdueTotal,
            carriedOverBillable, Math.Round(carriedOverBillable * project.BillingCostPerHour, 2), vat, amount + vat,
            project.Icon, project.IconImage);
    }

    public static BillingSettings ToSettings(Project project) => new()
    {
        Enabled = project.BillingEnabled,
        ClientName = project.BillingClientName,
        ContractorName = project.BillingContractorName,
        CostPerHour = project.BillingCostPerHour,
        MinHoursPerDay = project.BillingMinHoursPerDay,
        MaxHoursPerDay = project.BillingMaxHoursPerDay,
        RoundingMinutes = project.BillingRoundingMinutes,
        TimeZone = project.BillingTimeZone,
        Currency = project.BillingCurrency,
        VatRate = project.BillingVatRate,
        ContractorAddress = project.BillingContractorAddress,
        OrgNumber = project.BillingOrgNumber,
        PaymentDetails = project.BillingPaymentDetails,
        PaymentTermsDays = project.BillingPaymentTermsDays,
    };
}
