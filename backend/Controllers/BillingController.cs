using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Documents;
using Plans;
using Model;

/// <summary>
/// Project billing, for project owners only: settings, member fractions and the live preview of a month's billing
/// (see <see cref="BillingReports"/>). Invoices made from it are documents (see DocumentsController).
/// </summary>
[ApiController]
[Authorize]
[Route("api/projects/{projectId:long}/billing")]
[RequiresProject(ProjectFeature.Full)]
public sealed class BillingController(AppDbContext db, BillingReports reports) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<BillingSettings>> Get(long projectId, CancellationToken cancellationToken)
    {
        var project = await GetOwnedProject(projectId, cancellationToken);
        return project is null ? NotFound() : Ok(BillingReports.ToSettings(project));
    }

    /// <summary>Saves the billing settings. Who the work is from (contractor name, address, org. number) is set with the
    /// document branding instead, so those fields are ignored here.</summary>
    [HttpPut]
    public async Task<IActionResult> Save(long projectId, BillingSettings request, CancellationToken cancellationToken)
    {
        if (BillingReports.IsCapped(request.MaxHoursPerDay) && request.MaxHoursPerDay < request.MinHoursPerDay)
            return BadRequest(new { error = "The maximum hours per day cannot be below the minimum." });
        if (!BillingReports.RoundingSteps.Contains(request.RoundingMinutes))
            return BadRequest(new { error = "Round up to 15, 30 or 60 minutes, or not at all." });
        if (CheckSplit(request.Split) is { } splitError) return BadRequest(new { error = splitError });
        var timeZone = request.TimeZone.Trim();
        if (timeZone != "" && !TimeZoneInfo.TryFindSystemTimeZoneById(timeZone, out _))
            return BadRequest(new { error = $"Unknown time zone: {timeZone}. Use a name such as Europe/Oslo." });
        var project = await GetOwnedProject(projectId, cancellationToken);
        if (project is null) return NotFound();

        project.BillingEnabled = request.Enabled;
        project.BillingClientName = request.ClientName.Trim();
        project.BillingCostPerHour = request.CostPerHour;
        project.BillingMinHoursPerDay = request.MinHoursPerDay;
        project.BillingMaxHoursPerDay = request.MaxHoursPerDay;
        project.BillingRoundingMinutes = request.RoundingMinutes;
        project.BillingTimeZone = timeZone;
        project.BillingCurrency = request.Currency.Trim().ToUpperInvariant();
        project.BillingVatRate = request.VatRate;
        project.BillingPaymentDetails = request.PaymentDetails.Trim();
        project.BillingPaymentTermsDays = request.PaymentTermsDays;
        project.BillingSplitJson = request.Split.Count == 0
            ? string.Empty
            : JsonSerializer.Serialize(
                request.Split.Select(share => share with { Name = share.Name.Trim() }), JsonSerializerOptions.Web);
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    [HttpPut("members/{userId}")]
    public async Task<IActionResult> SetFraction(
        long projectId, string userId, SetFractionRequest request, CancellationToken cancellationToken)
    {
        if (!BillingReports.Fractions.ContainsKey(request.Fraction))
            return BadRequest(new { error = "The fraction must be 1/1, 3/4, 2/3 or 1/2." });
        if (await GetOwnedProject(projectId, cancellationToken) is null) return NotFound();

        var member = await db.ProjectMembers.SingleOrDefaultAsync(
            member => member.ProjectId == projectId && member.UserId == userId, cancellationToken);
        if (member is null) return NotFound();
        member.BillableFraction = request.Fraction;
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    /// <summary>The month's billing as it stands now, per member and per day, with overdue earlier invoices. month is "yyyy-MM".</summary>
    [HttpGet("report")]
    public async Task<ActionResult<BillingReport>> Report(long projectId, [FromQuery] string month, CancellationToken cancellationToken)
    {
        if (!BillingReports.TryParseMonth(month, out _)) return BadRequest(new { error = "The month must look like 2026-10." });
        var project = await GetOwnedProject(projectId, cancellationToken);
        if (project is null) return NotFound();
        if (!project.BillingEnabled) return BadRequest(new { error = "Billing is not enabled for this project." });
        return Ok(await reports.Build(project, month, cancellationToken));
    }

    /// <summary>Why the split is not allowed, or null: two to ten payers, each named and with a share, adding up to 100%.</summary>
    private static string? CheckSplit(IReadOnlyList<BillingSplitShare> split)
    {
        if (split.Count == 0) return null;
        if (split.Count is < 2 or > 10) return "Split invoices between 2 to 10 payers, or turn splitting off.";
        if (split.Any(share => string.IsNullOrWhiteSpace(share.Name))) return "Give every payer a name.";
        if (split.Any(share => share.Percent <= 0)) return "Every payer's share must be more than 0%.";
        if (split.Sum(share => share.Percent) != 100) return "The payers' shares must add up to 100%.";
        return null;
    }

    private Task<Project?> GetOwnedProject(long projectId, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        return db.Projects.SingleOrDefaultAsync(
            project => project.Id == projectId
                && project.Members.Any(member => member.UserId == userId && member.Role == "Owner"),
            cancellationToken);
    }
}

/// <summary>A project's billing settings.</summary>
public sealed record BillingSettings
{
    public bool Enabled { get; init; }

    [StringLength(200)]
    public string ClientName { get; init; } = string.Empty;

    /// <summary>Who does the work for the client.</summary>
    [StringLength(200)]
    public string ContractorName { get; init; } = string.Empty;

    [Range(0, 1_000_000)]
    public decimal CostPerHour { get; init; }

    [Range(0, 24)]
    public decimal MinHoursPerDay { get; init; }

    /// <summary>0 or 24+ means no cap.</summary>
    [Range(0, 1000)]
    public decimal MaxHoursPerDay { get; init; } = 8;

    /// <summary>
    /// Billable hours per member per day are rounded up to this many minutes: 0 (none), 15, 30 or 60. Missing (0) on
    /// invoices from before rounding.
    /// </summary>
    public int RoundingMinutes { get; init; }

    /// <summary>IANA name (e.g. Europe/Oslo) whose midnights start each billed day and month; empty means UTC.</summary>
    [StringLength(64)]
    public string TimeZone { get; init; } = string.Empty;

    /// <summary>ISO 4217 code such as USD or NOK. Bills finalized before currencies existed have none and were in USD.</summary>
    [RegularExpression("^[A-Za-z]{3}$", ErrorMessage = "The currency must be a three-letter code such as USD or NOK.")]
    public string Currency { get; init; } = "USD";

    /// <summary>VAT added on top of each invoice, in percent; 0 adds none.</summary>
    [Range(0, 100)]
    public decimal VatRate { get; init; }

    [StringLength(500)]
    public string ContractorAddress { get; init; } = string.Empty;

    [StringLength(64)]
    public string OrgNumber { get; init; } = string.Empty;

    /// <summary>How to pay: bank account, IBAN, reference.</summary>
    [StringLength(500)]
    public string PaymentDetails { get; init; } = string.Empty;

    /// <summary>Days after an invoice is issued that it is due.</summary>
    [Range(0, 365)]
    public int PaymentTermsDays { get; init; } = 14;

    /// <summary>
    /// Who pays which share of each invoice's amount due, when several clients pay together; empty when one client pays
    /// it all. Only divides what is owed: hours, rates and totals stay the same.
    /// </summary>
    public IReadOnlyList<BillingSplitShare> Split { get; init; } = [];
}

public sealed record SetFractionRequest(string Fraction);

/// <summary>One payer of a split invoice.</summary>
public sealed record BillingSplitShare
{
    [StringLength(200)]
    public string Name { get; init; } = string.Empty;

    /// <summary>This payer's share of the amount due, e.g. 45 or 33.33.</summary>
    [Range(0, 100)]
    public decimal Percent { get; init; }
}

/// <summary>What one payer owes of an invoice's amount due.</summary>
public sealed record SplitAmount(string Name, decimal Percent, decimal Amount);

/// <summary>One member's billing for one day, in the project's billing time zone.</summary>
/// <param name="CarriedOver">Worked before the bill's month but not billed before.</param>
public sealed record BillingDay(
    DateOnly Date, string UserId, string Name, string Fraction, decimal HoursWorked, decimal BillableHours,
    bool CarriedOver = false);

public sealed record BillingMemberTotal(
    string Name, string Fraction, int DaysWorked, decimal HoursWorked, decimal BillableHours, decimal Amount);

/// <summary>An earlier invoice still owed (unpaid, or the rest of a partial payment).</summary>
/// <param name="BillId">The invoice's number (named from when invoices were bills, as stored in finalized invoices).</param>
public sealed record OverdueBill(long BillId, string Month, decimal Amount);

/// <param name="Amount">This month's work, before VAT.</param>
/// <param name="Vat">VAT on <paramref name="Amount"/>; 0 on bills from before VAT.</param>
/// <param name="AmountWithVat">What this month's work costs with VAT; null on bills from before VAT.</param>
/// <param name="TotalWithOverdue">With VAT, plus earlier bills still owed.</param>
/// <param name="ProjectIcon">The project's icon at the time, shown at the top of the bill; null on older bills.</param>
/// <param name="ProjectIconImage">The project's uploaded image, which takes precedence over the icon.</param>
/// <param name="Split">What each payer owes of the amount due (TotalWithOverdue), when it is split; null otherwise.</param>
public sealed record BillingReport(
    string ProjectName, string Month, BillingSettings Settings, IReadOnlyList<BillingMemberTotal> Members,
    IReadOnlyList<BillingDay> Days, decimal HoursWorked, decimal BillableHours, decimal Amount,
    IReadOnlyList<OverdueBill> Overdue, decimal OverdueTotal, decimal TotalWithOverdue,
    decimal CarriedOverBillableHours = 0, decimal CarriedOverAmount = 0, decimal Vat = 0, decimal? AmountWithVat = null,
    string? ProjectIcon = null, string? ProjectIconImage = null, IReadOnlyList<SplitAmount>? Split = null);
