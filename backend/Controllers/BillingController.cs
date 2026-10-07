using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Model;

/// <summary>
/// Project billing, for project owners only: settings, member fractions and monthly reports.
/// Billable hours per member per day = worked hours raised to the daily minimum (on days with work) and capped at
/// the daily maximum, times the member's billable fraction. A maximum of 0 or 24+ means no cap; a minimum of 0 means
/// no minimum. Days are UTC days, like the overview.
/// Every hour is billed exactly once: a report covers all recorded work up to the end of its month, minus what earlier
/// (not canceled) bills already billed for each member-day. Earlier days left unbilled are marked CarriedOver.
/// </summary>
[ApiController]
[Authorize]
[Route("api/projects/{projectId:long}/billing")]
public sealed class BillingController(AppDbContext db) : ControllerBase
{
    private static readonly Dictionary<string, decimal> Fractions = new()
    {
        ["1/1"] = 1m, ["3/4"] = 0.75m, ["2/3"] = 2m / 3m, ["1/2"] = 0.5m,
    };

    /// <summary>A daily maximum of 0 or 24 hours and above means the day is not capped.</summary>
    public static bool IsCapped(decimal maxHoursPerDay) => maxHoursPerDay > 0 && maxHoursPerDay < 24;

    [HttpGet]
    public async Task<ActionResult<BillingSettings>> Get(long projectId, CancellationToken cancellationToken)
    {
        var project = await GetOwnedProject(projectId, cancellationToken);
        return project is null ? NotFound() : Ok(ToSettings(project));
    }

    [HttpPut]
    public async Task<IActionResult> Save(long projectId, BillingSettings request, CancellationToken cancellationToken)
    {
        if (IsCapped(request.MaxHoursPerDay) && request.MaxHoursPerDay < request.MinHoursPerDay)
            return BadRequest(new { error = "The maximum hours per day cannot be below the minimum." });
        var project = await GetOwnedProject(projectId, cancellationToken);
        if (project is null) return NotFound();

        project.BillingEnabled = request.Enabled;
        project.BillingClientName = request.ClientName.Trim();
        project.BillingContactName = request.ContactName.Trim();
        project.BillingCostPerHour = request.CostPerHour;
        project.BillingMinHoursPerDay = request.MinHoursPerDay;
        project.BillingMaxHoursPerDay = request.MaxHoursPerDay;
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    [HttpPut("members/{userId}")]
    public async Task<IActionResult> SetFraction(
        long projectId, string userId, SetFractionRequest request, CancellationToken cancellationToken)
    {
        if (!Fractions.ContainsKey(request.Fraction))
            return BadRequest(new { error = "The fraction must be 1/1, 3/4, 2/3 or 1/2." });
        if (await GetOwnedProject(projectId, cancellationToken) is null) return NotFound();

        var member = await db.ProjectMembers.SingleOrDefaultAsync(
            member => member.ProjectId == projectId && member.UserId == userId, cancellationToken);
        if (member is null) return NotFound();
        member.BillableFraction = request.Fraction;
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    private static readonly string[] BillStatuses = ["due", "paid", "partiallyPaid", "unpaid", "canceled"];

    /// <summary>Preview of the month's billing, per member and per day, with overdue earlier bills. month is "yyyy-MM".</summary>
    [HttpGet("report")]
    public async Task<ActionResult<BillingReport>> Report(long projectId, [FromQuery] string month, CancellationToken cancellationToken)
    {
        if (!TryParseMonth(month, out var parsed)) return BadRequest(new { error = "The month must look like 2026-10." });
        var project = await GetOwnedProject(projectId, cancellationToken);
        if (project is null) return NotFound();
        if (!project.BillingEnabled) return BadRequest(new { error = "Billing is not enabled for this project." });
        return Ok(await BuildReport(project, month, parsed, cancellationToken));
    }

    /// <summary>Finalizes the month's report as a bill (status "due"). One open bill per month.</summary>
    [HttpPost("bills")]
    public async Task<ActionResult<BillSummary>> Finalize(long projectId, FinalizeBillRequest request, CancellationToken cancellationToken)
    {
        if (!TryParseMonth(request.Month, out var parsed)) return BadRequest(new { error = "The month must look like 2026-10." });
        var project = await GetOwnedProject(projectId, cancellationToken);
        if (project is null) return NotFound();
        if (!project.BillingEnabled) return BadRequest(new { error = "Billing is not enabled for this project." });
        if (await db.Bills.AnyAsync(bill => bill.ProjectId == projectId && bill.Month == request.Month && bill.Status != "canceled", cancellationToken))
            return Conflict(new { error = "This month already has a bill. Cancel it first to finalize again." });

        var report = await BuildReport(project, request.Month, parsed, cancellationToken);
        var bill = new Bill
        {
            ProjectId = projectId,
            Month = request.Month,
            Amount = report.Amount,
            ReportJson = JsonSerializer.Serialize(report, JsonSerializerOptions.Web),
        };
        db.Bills.Add(bill);
        await db.SaveChangesAsync(cancellationToken);
        return Ok(ToSummary(bill));
    }

    [HttpGet("bills")]
    public async Task<ActionResult<IReadOnlyList<BillSummary>>> Bills(long projectId, CancellationToken cancellationToken)
    {
        if (await GetOwnedProject(projectId, cancellationToken) is null) return NotFound();
        var bills = await db.Bills.AsNoTracking().Where(bill => bill.ProjectId == projectId).ToListAsync(cancellationToken);
        return Ok(bills.OrderByDescending(bill => bill.Month).ThenByDescending(bill => bill.Id).Select(ToSummary).ToList());
    }

    /// <summary>A bill with its report as it was when finalized.</summary>
    [HttpGet("bills/{billId:long}")]
    public async Task<ActionResult<BillDetail>> GetBill(long projectId, long billId, CancellationToken cancellationToken)
    {
        if (await GetOwnedProject(projectId, cancellationToken) is null) return NotFound();
        var bill = await db.Bills.AsNoTracking()
            .SingleOrDefaultAsync(bill => bill.Id == billId && bill.ProjectId == projectId, cancellationToken);
        if (bill is null) return NotFound();
        var report = JsonSerializer.Deserialize<BillingReport>(bill.ReportJson, JsonSerializerOptions.Web)!;
        return Ok(new BillDetail(ToSummary(bill), report));
    }

    [HttpPut("bills/{billId:long}/status")]
    public async Task<ActionResult<BillSummary>> SetBillStatus(
        long projectId, long billId, SetBillStatusRequest request, CancellationToken cancellationToken)
    {
        if (!BillStatuses.Contains(request.Status))
            return BadRequest(new { error = "The status must be due, paid, partiallyPaid, unpaid or canceled." });
        if (await GetOwnedProject(projectId, cancellationToken) is null) return NotFound();
        var bill = await db.Bills.SingleOrDefaultAsync(bill => bill.Id == billId && bill.ProjectId == projectId, cancellationToken);
        if (bill is null) return NotFound();
        if (request.Status == "partiallyPaid" && (request.AmountPaid is not { } paid || paid <= 0 || paid >= bill.Amount))
            return BadRequest(new { error = "A partial payment must be more than 0 and less than the bill amount." });

        bill.Status = request.Status;
        bill.AmountPaid = request.Status switch
        {
            "partiallyPaid" => request.AmountPaid!.Value,
            "paid" => bill.Amount,
            _ => 0,
        };
        await db.SaveChangesAsync(cancellationToken);
        return Ok(ToSummary(bill));
    }

    private static bool TryParseMonth(string month, out DateTime parsed) =>
        DateTime.TryParseExact(month, "yyyy-MM", CultureInfo.InvariantCulture, DateTimeStyles.None, out parsed);

    private static BillSummary ToSummary(Bill bill) =>
        new(bill.Id, bill.Month, bill.CreatedAt, bill.Status, bill.Amount, bill.AmountPaid, bill.Overdue);

    private async Task<BillingReport> BuildReport(Project project, string month, DateTime parsed, CancellationToken cancellationToken)
    {
        var projectId = project.Id;
        var start = new DateTimeOffset(parsed.Year, parsed.Month, 1, 0, 0, 0, TimeSpan.Zero);
        var now = DateTimeOffset.UtcNow;
        var until = start.AddMonths(1) < now ? start.AddMonths(1) : now;

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
            var to = session.EndedAt is { } ended && ended < until ? ended : until;
            while (from < to)
            {
                var dayEnd = new DateTimeOffset(from.UtcDateTime.Date.AddDays(1), TimeSpan.Zero);
                var end = dayEnd < to ? dayEnd : to;
                var key = (session.UserId, DateOnly.FromDateTime(from.UtcDateTime));
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

        // What earlier bills already billed per member-day (canceled bills free their hours again).
        var billed = new Dictionary<(string UserId, DateOnly Day), (decimal Hours, decimal Billable)>();
        var earlierBills = await db.Bills.AsNoTracking()
            .Where(bill => bill.ProjectId == projectId && bill.Status != "canceled")
            .Select(bill => bill.ReportJson)
            .ToListAsync(cancellationToken);
        foreach (var json in earlierBills)
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
        var monthStart = DateOnly.FromDateTime(start.UtcDateTime);
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
                    Math.Max(0, Math.Round(clamped * Fractions[fraction] - billedBillable, 2)),
                    entry.Key.Day < monthStart);
            })
            // Under 0.01 h (36 s) left is rounding, not unbilled work.
            .Where(day => day.HoursWorked >= 0.01m)
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

        // Earlier bills still owed, by month; stored with the bill when it is finalized.
        var overdue = (await db.Bills.AsNoTracking()
                .Where(bill => bill.ProjectId == projectId && bill.Month != month
                    && (bill.Status == "unpaid" || bill.Status == "partiallyPaid"))
                .ToListAsync(cancellationToken))
            .Where(bill => string.CompareOrdinal(bill.Month, month) < 0)
            .OrderBy(bill => bill.Month)
            .Select(bill => new OverdueBill(bill.Id, bill.Month, bill.Overdue))
            .ToList();

        var amount = members.Sum(member => member.Amount);
        var overdueTotal = overdue.Sum(bill => bill.Amount);
        var carriedOverBillable = days.Where(day => day.CarriedOver).Sum(day => day.BillableHours);
        return new BillingReport(
            project.Name, month, ToSettings(project), members, days,
            members.Sum(member => member.HoursWorked), members.Sum(member => member.BillableHours), amount,
            overdue, overdueTotal, amount + overdueTotal,
            carriedOverBillable, Math.Round(carriedOverBillable * project.BillingCostPerHour, 2));
    }

    private Task<Project?> GetOwnedProject(long projectId, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        return db.Projects.SingleOrDefaultAsync(
            project => project.Id == projectId
                && project.Members.Any(member => member.UserId == userId && member.Role == "Owner"),
            cancellationToken);
    }

    private static BillingSettings ToSettings(Project project) => new()
    {
        Enabled = project.BillingEnabled,
        ClientName = project.BillingClientName,
        ContactName = project.BillingContactName,
        CostPerHour = project.BillingCostPerHour,
        MinHoursPerDay = project.BillingMinHoursPerDay,
        MaxHoursPerDay = project.BillingMaxHoursPerDay,
    };
}

/// <summary>A project's billing settings.</summary>
public sealed record BillingSettings
{
    public bool Enabled { get; init; }

    [StringLength(200)]
    public string ClientName { get; init; } = string.Empty;

    /// <summary>Our side's point of contact for the client.</summary>
    [StringLength(200)]
    public string ContactName { get; init; } = string.Empty;

    [Range(0, 1_000_000)]
    public decimal CostPerHour { get; init; }

    [Range(0, 24)]
    public decimal MinHoursPerDay { get; init; }

    /// <summary>0 or 24+ means no cap.</summary>
    [Range(0, 1000)]
    public decimal MaxHoursPerDay { get; init; } = 8;
}

public sealed record SetFractionRequest(string Fraction);

/// <summary>One member's billing for one (UTC) day.</summary>
/// <param name="CarriedOver">Worked before the bill's month but not billed before.</param>
public sealed record BillingDay(
    DateOnly Date, string UserId, string Name, string Fraction, decimal HoursWorked, decimal BillableHours,
    bool CarriedOver = false);

public sealed record BillingMemberTotal(
    string Name, string Fraction, int DaysWorked, decimal HoursWorked, decimal BillableHours, decimal Amount);

/// <summary>An earlier bill still owed (unpaid, or the rest of a partial payment).</summary>
public sealed record OverdueBill(long BillId, string Month, decimal Amount);

public sealed record BillingReport(
    string ProjectName, string Month, BillingSettings Settings, IReadOnlyList<BillingMemberTotal> Members,
    IReadOnlyList<BillingDay> Days, decimal HoursWorked, decimal BillableHours, decimal Amount,
    IReadOnlyList<OverdueBill> Overdue, decimal OverdueTotal, decimal TotalWithOverdue,
    decimal CarriedOverBillableHours = 0, decimal CarriedOverAmount = 0);

public sealed record FinalizeBillRequest(string Month);

/// <param name="Overdue">What is still owed on this bill (unpaid or partially paid), otherwise 0.</param>
public sealed record BillSummary(
    long Id, string Month, DateTimeOffset CreatedAt, string Status, decimal Amount, decimal AmountPaid, decimal Overdue);

public sealed record BillDetail(BillSummary Bill, BillingReport Report);

public sealed record SetBillStatusRequest(string Status, decimal? AmountPaid);
