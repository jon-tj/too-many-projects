using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Model;

/// <summary>
/// Project billing, for project owners only: settings, member fractions and monthly reports.
/// Billable hours per member per day = worked hours raised to the daily minimum (on days with work) and capped at
/// the daily maximum, times the member's billable fraction. A maximum of 0 or 24+ means no cap; a minimum of 0 means
/// no minimum. Days are UTC days, like the overview.
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

    /// <summary>The month's billing, per member and per day. month is "yyyy-MM".</summary>
    [HttpGet("report")]
    public async Task<ActionResult<BillingReport>> Report(long projectId, [FromQuery] string month, CancellationToken cancellationToken)
    {
        if (!DateTime.TryParseExact(month, "yyyy-MM", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed))
            return BadRequest(new { error = "The month must look like 2026-10." });
        var project = await GetOwnedProject(projectId, cancellationToken);
        if (project is null) return NotFound();
        if (!project.BillingEnabled) return BadRequest(new { error = "Billing is not enabled for this project." });

        var start = new DateTimeOffset(parsed.Year, parsed.Month, 1, 0, 0, 0, TimeSpan.Zero);
        var now = DateTimeOffset.UtcNow;
        var until = start.AddMonths(1) < now ? start.AddMonths(1) : now;

        // Filtered in memory: SQLite cannot compare DateTimeOffset values in queries.
        var sessions = await db.WorkSessions.AsNoTracking()
            .Where(session => session.ProjectId == projectId)
            .Select(session => new { session.UserId, session.StartedAt, session.EndedAt })
            .ToListAsync(cancellationToken);

        // Hours per member per day, splitting sessions that cross midnight.
        var hours = new Dictionary<(string UserId, DateOnly Day), decimal>();
        foreach (var session in sessions)
        {
            var from = session.StartedAt > start ? session.StartedAt : start;
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

        var days = hours
            .Select(entry =>
            {
                var fraction = fractions.GetValueOrDefault(entry.Key.UserId, "1/1");
                var clamped = Math.Max(entry.Value, project.BillingMinHoursPerDay);
                if (IsCapped(project.BillingMaxHoursPerDay)) clamped = Math.Min(clamped, project.BillingMaxHoursPerDay);
                return new BillingDay(
                    entry.Key.Day, entry.Key.UserId, people.GetValueOrDefault(entry.Key.UserId, "Former member"), fraction,
                    Math.Round(entry.Value, 2), Math.Round(clamped * Fractions[fraction], 2));
            })
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

        return Ok(new BillingReport(
            project.Name, month, ToSettings(project), members, days,
            members.Sum(member => member.HoursWorked), members.Sum(member => member.BillableHours),
            members.Sum(member => member.Amount)));
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
public sealed record BillingDay(DateOnly Date, string UserId, string Name, string Fraction, decimal HoursWorked, decimal BillableHours);

public sealed record BillingMemberTotal(
    string Name, string Fraction, int DaysWorked, decimal HoursWorked, decimal BillableHours, decimal Amount);

public sealed record BillingReport(
    string ProjectName, string Month, BillingSettings Settings, IReadOnlyList<BillingMemberTotal> Members,
    IReadOnlyList<BillingDay> Days, decimal HoursWorked, decimal BillableHours, decimal Amount);
