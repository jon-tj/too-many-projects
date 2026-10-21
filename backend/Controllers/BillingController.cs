using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
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
        project.BillingTimeZone = timeZone;
        project.BillingCurrency = request.Currency.Trim().ToUpperInvariant();
        project.BillingVatRate = request.VatRate;
        project.BillingPaymentDetails = request.PaymentDetails.Trim();
        project.BillingPaymentTermsDays = request.PaymentTermsDays;
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
}

public sealed record SetFractionRequest(string Fraction);

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
public sealed record BillingReport(
    string ProjectName, string Month, BillingSettings Settings, IReadOnlyList<BillingMemberTotal> Members,
    IReadOnlyList<BillingDay> Days, decimal HoursWorked, decimal BillableHours, decimal Amount,
    IReadOnlyList<OverdueBill> Overdue, decimal OverdueTotal, decimal TotalWithOverdue,
    decimal CarriedOverBillableHours = 0, decimal CarriedOverAmount = 0, decimal Vat = 0, decimal? AmountWithVat = null,
    string? ProjectIcon = null, string? ProjectIconImage = null);
