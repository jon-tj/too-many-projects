using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using Documents;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Model;
using Plans;

/// <summary>
/// A project's documents for its client (see <see cref="Document"/>), for project owners only: drafts are made,
/// finalized, revised and shared here. Drafts show their content as it would be finalized now; finalized documents show
/// what was stored. Only finalized documents can be shared, by secret link that opens without an account.
/// </summary>
[ApiController]
[Authorize]
[Route("api/projects/{projectId:long}/documents")]
[RequiresProject(ProjectFeature.Full)]
public sealed class DocumentsController(AppDbContext db, BillingReports reports, ProgressReports progress) : ControllerBase
{
    private static readonly Dictionary<long, string> NoTokens = [];
    private static readonly string[] PaymentStatuses = ["due", "paid", "partiallyPaid", "unpaid", "canceled"];

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<DocumentSummary>>> List(long projectId, CancellationToken cancellationToken)
    {
        if (await GetOwnedProject(projectId, cancellationToken) is null) return NotFound();
        var documents = await db.Documents.AsNoTracking().Where(document => document.ProjectId == projectId)
            .ToListAsync(cancellationToken);
        var tokens = await ShareTokens(projectId, cancellationToken);
        // Ordered in memory: SQLite cannot order by DateTimeOffset.
        return Ok(documents
            .OrderByDescending(document => document.CreatedAt)
            .Select(document => ToSummary(document, tokens, documents))
            .ToList());
    }

    /// <summary>
    /// Starts a draft. An invoice is for a month with billing enabled; a month has at most one draft (which is returned
    /// if it exists) and one invoice that is not canceled. A progress report covers the days From to To.
    /// </summary>
    [HttpPost]
    public async Task<ActionResult<DocumentSummary>> Create(
        long projectId, CreateDocumentRequest request, CancellationToken cancellationToken)
    {
        var project = await GetOwnedProject(projectId, cancellationToken);
        if (project is null) return NotFound();
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        switch (request.Type)
        {
            case "invoice":
                if (request.Month is not { } month || !BillingReports.TryParseMonth(month, out var parsed))
                    return BadRequest(new { error = "Choose the month to invoice, e.g. 2026-10." });
                if (!project.BillingEnabled) return BadRequest(new { error = "Turn on billing in the project's settings first." });
                var existing = await db.Invoices.AsNoTracking().Where(invoice => invoice.ProjectId == projectId
                        && invoice.Month == month && invoice.PaymentStatus != "canceled")
                    .ToListAsync(cancellationToken);
                if (existing.FirstOrDefault(invoice => invoice.IsFinal) is { } final)
                    return Conflict(new { error = $"{month} is already invoiced (invoice {final.Number}). Cancel that invoice first to make a new one.", documentId = final.Id });
                if (existing.FirstOrDefault() is { } draft)
                    return Ok(ToSummary(draft, NoTokens, []));
                var invoice = new Invoice
                {
                    ProjectId = projectId,
                    Type = "invoice",
                    Month = month,
                    Title = $"Invoice {parsed.ToString("MMMM yyyy", CultureInfo.InvariantCulture)}",
                    CreatedByUserId = userId,
                };
                db.Invoices.Add(invoice);
                await db.SaveChangesAsync(cancellationToken);
                return Ok(ToSummary(invoice, NoTokens, []));
            case "progressReport":
                if (request.From is not { } from || request.To is not { } to)
                    return BadRequest(new { error = "Choose the period the report covers." });
                if (CheckPeriod(from, to) is { } periodError) return BadRequest(new { error = periodError });
                var report = new ProgressReport
                {
                    ProjectId = projectId,
                    Type = "progressReport",
                    Title = PeriodTitle(from, to),
                    CreatedByUserId = userId,
                    ContentJson = JsonSerializer.Serialize(new ProgressReportInput { From = from, To = to }, JsonSerializerOptions.Web),
                };
                db.ProgressReports.Add(report);
                await db.SaveChangesAsync(cancellationToken);
                return Ok(ToSummary(report, NoTokens, []));
            default:
                return BadRequest(new { error = "Unknown document type." });
        }
    }

    /// <summary>Changes a draft: its title, and for a progress report the period and what the author wrote.</summary>
    [HttpPut("{documentId:long}")]
    public async Task<ActionResult<DocumentSummary>> Update(
        long projectId, long documentId, UpdateDocumentRequest request, CancellationToken cancellationToken)
    {
        if (await GetOwnedProject(projectId, cancellationToken) is null) return NotFound();
        var document = await db.Documents.SingleOrDefaultAsync(
            document => document.Id == documentId && document.ProjectId == projectId, cancellationToken);
        if (document is null) return NotFound();
        if (document.IsFinal) return BadRequest(new { error = "Finalized documents never change. Revise it instead." });
        if (document is ProgressReport)
        {
            if (request.ProgressReport is not { } input) return BadRequest(new { error = "Send the report's period and text." });
            if (CheckPeriod(input.From, input.To) is { } periodError) return BadRequest(new { error = periodError });
            document.ContentJson = JsonSerializer.Serialize(input, JsonSerializerOptions.Web);
        }
        document.Title = request.Title.Trim();
        document.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return Ok(ToSummary(document, NoTokens, []));
    }

    private static string? CheckPeriod(DateOnly from, DateOnly to) =>
        to < from ? "The period must end on or after its first day."
        : to.DayNumber - from.DayNumber + 1 > ProgressReports.MaxDays ? $"A report covers at most {ProgressReports.MaxDays} days."
        : null;

    /// <summary>"Progress report 1 Oct – 31 Oct 2026", or with both years when they differ.</summary>
    private static string PeriodTitle(DateOnly from, DateOnly to)
    {
        var culture = CultureInfo.InvariantCulture;
        var first = from.Year == to.Year ? from.ToString("d MMM", culture) : from.ToString("d MMM yyyy", culture);
        return $"Progress report {first} – {to.ToString("d MMM yyyy", culture)}";
    }

    [HttpGet("{documentId:long}")]
    public async Task<ActionResult<DocumentResponse>> Get(long projectId, long documentId, CancellationToken cancellationToken)
    {
        var project = await GetOwnedProject(projectId, cancellationToken);
        if (project is null) return NotFound();
        var document = await db.Documents.AsNoTracking()
            .SingleOrDefaultAsync(document => document.Id == documentId && document.ProjectId == projectId, cancellationToken);
        if (document is null) return NotFound();
        var siblings = await db.Documents.AsNoTracking()
            .Where(other => other.ProjectId == projectId && other.RevisionOfId == documentId)
            .ToListAsync(cancellationToken);
        var summary = ToSummary(document, await ShareTokens(projectId, cancellationToken), siblings);
        return Ok(await ToResponse(project, document, summary, cancellationToken));
    }

    /// <summary>Deletes a draft. Finalized documents are kept: invoices are canceled instead, others revised.</summary>
    [HttpDelete("{documentId:long}")]
    public async Task<IActionResult> Delete(long projectId, long documentId, CancellationToken cancellationToken)
    {
        if (await GetOwnedProject(projectId, cancellationToken) is null) return NotFound();
        var document = await db.Documents.SingleOrDefaultAsync(
            document => document.Id == documentId && document.ProjectId == projectId, cancellationToken);
        if (document is null) return NotFound();
        if (document.IsFinal) return BadRequest(new { error = "Finalized documents are kept. Cancel an invoice, or revise the document instead." });
        db.Documents.Remove(document);
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    /// <summary>
    /// Freezes a draft as it is now, with the sender's branding, so it can be shared. An invoice gets the next number
    /// in the project.
    /// </summary>
    [HttpPost("{documentId:long}/finalize")]
    public async Task<ActionResult<DocumentSummary>> Finalize(long projectId, long documentId, CancellationToken cancellationToken)
    {
        var project = await GetOwnedProject(projectId, cancellationToken);
        if (project is null) return NotFound();
        var document = await db.Documents.SingleOrDefaultAsync(
            document => document.Id == documentId && document.ProjectId == projectId, cancellationToken);
        if (document is null) return NotFound();
        if (document.IsFinal) return BadRequest(new { error = "This document is already finalized." });

        if (document is Invoice invoice)
        {
            if (!project.BillingEnabled) return BadRequest(new { error = "Turn on billing in the project's settings first." });
            if (await db.Invoices.AnyAsync(other => other.ProjectId == projectId && other.Id != invoice.Id
                    && other.Month == invoice.Month && other.Status == Document.Final && other.PaymentStatus != "canceled",
                    cancellationToken))
                return Conflict(new { error = $"{invoice.Month} is already invoiced. Cancel that invoice first." });
            var report = await reports.Build(project, invoice.Month, cancellationToken);
            invoice.Number = (await db.Invoices.Where(other => other.ProjectId == projectId)
                .MaxAsync(other => other.Number, cancellationToken) ?? 0) + 1;
            // What the client owes: VAT included.
            invoice.Amount = report.AmountWithVat ?? report.Amount;
            invoice.ContentJson = JsonSerializer.Serialize(report, JsonSerializerOptions.Web);
        }
        else if (document is ProgressReport)
        {
            var input = JsonSerializer.Deserialize<ProgressReportInput>(document.ContentJson, JsonSerializerOptions.Web)!;
            document.ContentJson = JsonSerializer.Serialize(await progress.Build(project, input, cancellationToken), JsonSerializerOptions.Web);
        }

        var now = DateTimeOffset.UtcNow;
        document.BrandingJson = JsonSerializer.Serialize(Branding(project), JsonSerializerOptions.Web);
        document.Status = Document.Final;
        document.FinalizedAt = now;
        document.UpdatedAt = now;
        await db.SaveChangesAsync(cancellationToken);
        return Ok(ToSummary(document, NoTokens, []));
    }

    /// <summary>
    /// Opens a draft revising a finalized document; the original stays as it is, and shared, until the revision is
    /// finalized and shared in its place. Returns the existing draft revision if there is one. Invoices are canceled
    /// and made again instead.
    /// </summary>
    [HttpPost("{documentId:long}/revise")]
    public async Task<ActionResult<DocumentSummary>> Revise(long projectId, long documentId, CancellationToken cancellationToken)
    {
        if (await GetOwnedProject(projectId, cancellationToken) is null) return NotFound();
        var document = await db.Documents.AsNoTracking().SingleOrDefaultAsync(
            document => document.Id == documentId && document.ProjectId == projectId, cancellationToken);
        if (document is null) return NotFound();
        if (document is Invoice) return BadRequest(new { error = "Invoices are not revised: cancel it and make a new one." });
        if (!document.IsFinal) return BadRequest(new { error = "Only finalized documents are revised; edit the draft instead." });
        var draft = await db.Documents.AsNoTracking().FirstOrDefaultAsync(
            other => other.RevisionOfId == documentId && other.Status == Document.Draft, cancellationToken);
        if (draft is not null) return Ok(ToSummary(draft, NoTokens, []));

        // The revision starts from what the author wrote; its figures are worked out again.
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        Document revision = document switch
        {
            ProgressReport => new ProgressReport
            {
                Type = "progressReport",
                ContentJson = JsonSerializer.Serialize(
                    JsonSerializer.Deserialize<ProgressReportContent>(document.ContentJson, JsonSerializerOptions.Web)!.Input,
                    JsonSerializerOptions.Web),
            },
            _ => throw new InvalidOperationException($"No revisions for {document.Type}."),
        };
        revision.ProjectId = projectId;
        revision.Title = document.Title;
        revision.CreatedByUserId = userId;
        revision.RevisionOfId = document.Id;
        db.Documents.Add(revision);
        await db.SaveChangesAsync(cancellationToken);
        return Ok(ToSummary(revision, NoTokens, []));
    }

    /// <summary>Records what the client paid on a finalized invoice; canceling one frees its hours for a new invoice.</summary>
    [HttpPut("{documentId:long}/payment")]
    public async Task<ActionResult<DocumentSummary>> SetPayment(
        long projectId, long documentId, SetPaymentRequest request, CancellationToken cancellationToken)
    {
        if (!PaymentStatuses.Contains(request.Status))
            return BadRequest(new { error = "The status must be due, paid, partiallyPaid, unpaid or canceled." });
        if (await GetOwnedProject(projectId, cancellationToken) is null) return NotFound();
        var invoice = await db.Invoices.SingleOrDefaultAsync(
            invoice => invoice.Id == documentId && invoice.ProjectId == projectId, cancellationToken);
        if (invoice is null) return NotFound();
        if (!invoice.IsFinal) return BadRequest(new { error = "Finalize the invoice first." });
        if (request.Status == "partiallyPaid" && (request.AmountPaid is not { } paid || paid <= 0 || paid >= invoice.Amount))
            return BadRequest(new { error = "A partial payment must be more than 0 and less than the invoice amount." });
        if (invoice.PaymentStatus == "canceled" && request.Status != "canceled" && await db.Invoices.AnyAsync(
                other => other.ProjectId == projectId && other.Id != invoice.Id && other.Month == invoice.Month
                    && other.PaymentStatus != "canceled", cancellationToken))
            return Conflict(new { error = $"{invoice.Month} has a newer invoice. Cancel or delete that one first." });

        invoice.PaymentStatus = request.Status;
        invoice.AmountPaid = request.Status switch
        {
            "partiallyPaid" => request.AmountPaid!.Value,
            "paid" => invoice.Amount,
            _ => 0,
        };
        invoice.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return Ok(ToSummary(invoice, await ShareTokens(projectId, cancellationToken), []));
    }

    /// <summary>Shares a finalized document by secret link; returns the existing link if it is shared already.</summary>
    [HttpPost("{documentId:long}/share")]
    public async Task<ActionResult<ShareResponse>> Share(long projectId, long documentId, CancellationToken cancellationToken)
    {
        if (await GetOwnedProject(projectId, cancellationToken) is null) return NotFound();
        var document = await db.Documents.AsNoTracking().SingleOrDefaultAsync(
            document => document.Id == documentId && document.ProjectId == projectId, cancellationToken);
        if (document is null) return NotFound();
        if (!document.IsFinal) return BadRequest(new { error = "Finalize the document before sharing it: drafts are never shared." });

        var existing = await db.ShareLinks.AsNoTracking()
            .FirstOrDefaultAsync(link => link.DocumentId == documentId, cancellationToken);
        if (existing is not null) return Ok(new ShareResponse(existing.Token));
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(16)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        db.ShareLinks.Add(new ShareLink { Token = token, ProjectId = projectId, DocumentId = documentId });
        await db.SaveChangesAsync(cancellationToken);
        return Ok(new ShareResponse(token));
    }

    /// <summary>Turns the document's link off: it stops working at once.</summary>
    [HttpDelete("{documentId:long}/share")]
    public async Task<IActionResult> Unshare(long projectId, long documentId, CancellationToken cancellationToken)
    {
        if (await GetOwnedProject(projectId, cancellationToken) is null) return NotFound();
        var deleted = await db.ShareLinks
            .Where(link => link.DocumentId == documentId && link.ProjectId == projectId)
            .ExecuteDeleteAsync(cancellationToken);
        return deleted == 0 ? NotFound() : NoContent();
    }

    /// <summary>
    /// A shared document, for anyone holding its link: read only, exactly as finalized. 404 once the link is turned off.
    /// The second route keeps links to bills, made before documents existed, working.
    /// </summary>
    [AllowAnonymous]
    [HttpGet("/api/public/documents/{token}")]
    [HttpGet("/api/public/shared/{token}")]
    public async Task<ActionResult<DocumentResponse>> Shared(string token, CancellationToken cancellationToken)
    {
        var link = await db.ShareLinks.AsNoTracking()
            .Include(link => link.Document).ThenInclude(document => document.Project)
            .SingleOrDefaultAsync(link => link.Token == token, cancellationToken);
        if (link is null || !link.Document.IsFinal) return NotFound();
        var summary = ToSummary(link.Document, new Dictionary<long, string> { [link.DocumentId] = token }, []);
        return Ok(await ToResponse(link.Document.Project, link.Document, summary, cancellationToken));
    }

    /// <summary>Who the project's documents are from, as the next finalized document will show it.</summary>
    [HttpGet("/api/projects/{projectId:long}/branding")]
    public async Task<ActionResult<BrandingSettings>> GetBranding(long projectId, CancellationToken cancellationToken)
    {
        var project = await GetOwnedProject(projectId, cancellationToken);
        return project is null ? NotFound() : Ok(new BrandingSettings
        {
            SenderName = project.BillingContractorName,
            SenderAddress = project.BillingContractorAddress,
            OrgNumber = project.BillingOrgNumber,
            Color = project.BrandColor,
        });
    }

    /// <summary>Saves the branding; finalized documents keep the branding they were finalized with.</summary>
    [HttpPut("/api/projects/{projectId:long}/branding")]
    public async Task<IActionResult> SaveBranding(long projectId, BrandingSettings request, CancellationToken cancellationToken)
    {
        var project = await GetOwnedProject(projectId, cancellationToken);
        if (project is null) return NotFound();
        project.BillingContractorName = request.SenderName.Trim();
        project.BillingContractorAddress = request.SenderAddress.Trim();
        project.BillingOrgNumber = request.OrgNumber.Trim();
        project.BrandColor = request.Color.Trim().ToLowerInvariant();
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    /// <summary>The branding a document shows: stored when it was finalized, or the project's own while a draft.</summary>
    private static DocumentBranding Branding(Project project) => new(
        project.Name, project.BillingContractorName, project.BillingContractorAddress, project.BillingOrgNumber,
        project.BrandColor, project.Icon, project.IconImage);

    private async Task<DocumentResponse> ToResponse(
        Project project, Document document, DocumentSummary summary, CancellationToken cancellationToken)
    {
        DocumentBranding branding;
        if (document.BrandingJson is { } stored)
            branding = JsonSerializer.Deserialize<DocumentBranding>(stored, JsonSerializerOptions.Web)!;
        else if (document is Invoice { IsFinal: true } old)
        {
            // Finalized as a bill, before documents had branding: who it was from was stored with its report.
            var report = JsonSerializer.Deserialize<BillingReport>(old.ContentJson, JsonSerializerOptions.Web)!;
            branding = new DocumentBranding(report.ProjectName, report.Settings.ContractorName,
                report.Settings.ContractorAddress, report.Settings.OrgNumber, "", report.ProjectIcon,
                report.ProjectIconImage);
        }
        else branding = Branding(project);

        object content = document switch
        {
            { IsFinal: true } => JsonSerializer.Deserialize<JsonElement>(document.ContentJson),
            Invoice invoice when project.BillingEnabled => await reports.Build(project, invoice.Month, cancellationToken),
            Invoice => new { error = "Billing is turned off for this project." },
            ProgressReport => await progress.Build(
                project, JsonSerializer.Deserialize<ProgressReportInput>(document.ContentJson, JsonSerializerOptions.Web)!,
                cancellationToken),
            _ => JsonSerializer.Deserialize<JsonElement>(document.ContentJson),
        };
        return new DocumentResponse(summary, JsonSerializer.SerializeToElement(content, JsonSerializerOptions.Web), branding);
    }

    private Task<Dictionary<long, string>> ShareTokens(long projectId, CancellationToken cancellationToken) =>
        db.ShareLinks.AsNoTracking().Where(link => link.ProjectId == projectId)
            .ToDictionaryAsync(link => link.DocumentId, link => link.Token, cancellationToken);

    /// <param name="others">Documents that may revise this one, to find its newest finalized revision.</param>
    private static DocumentSummary ToSummary(Document document, IReadOnlyDictionary<long, string> tokens, IEnumerable<Document> others) =>
        new(document.Id, document.Type, document.Title, document.Status, document.CreatedAt, document.UpdatedAt,
            document.FinalizedAt, document.RevisionOfId,
            others.Where(other => other.RevisionOfId == document.Id).Select(other => (long?)other.Id).FirstOrDefault(),
            tokens.GetValueOrDefault(document.Id),
            document is Invoice invoice
                ? new InvoiceInfo(invoice.Number, invoice.Month, invoice.PaymentStatus, invoice.Amount, invoice.AmountPaid, invoice.Overdue)
                : null);

    private Task<Project?> GetOwnedProject(long projectId, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        return db.Projects.SingleOrDefaultAsync(
            project => project.Id == projectId
                && project.Members.Any(member => member.UserId == userId && member.Role == "Owner"),
            cancellationToken);
    }
}

/// <param name="Status">"draft" or "final".</param>
/// <param name="RevisionOfId">The finalized document this one revises.</param>
/// <param name="RevisedById">A later revision of this one, draft or final.</param>
/// <param name="ShareToken">The secret of its share link; null when not shared.</param>
/// <param name="Invoice">Invoice details; null for other types.</param>
public sealed record DocumentSummary(
    long Id, string Type, string Title, string Status, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt,
    DateTimeOffset? FinalizedAt, long? RevisionOfId, long? RevisedById, string? ShareToken, InvoiceInfo? Invoice);

/// <param name="Number">Null while a draft.</param>
/// <param name="Overdue">What is still owed (unpaid or partially paid), otherwise 0.</param>
public sealed record InvoiceInfo(long? Number, string Month, string PaymentStatus, decimal Amount, decimal AmountPaid, decimal Overdue);

/// <param name="Content">The type's content: for an invoice, its billing report; for a progress report, its figures and text.</param>
public sealed record DocumentResponse(DocumentSummary Document, JsonElement Content, DocumentBranding Branding);

/// <param name="Type">"invoice" or "progressReport".</param>
/// <param name="Month">For an invoice: "yyyy-MM".</param>
/// <param name="From">For a progress report: the period's first day.</param>
/// <param name="To">For a progress report: the period's last day.</param>
public sealed record CreateDocumentRequest(string Type, string? Month, DateOnly? From = null, DateOnly? To = null);

/// <param name="ProgressReport">For a progress report: its period and text.</param>
public sealed record UpdateDocumentRequest
{
    [Required, StringLength(200, MinimumLength = 1)]
    public required string Title { get; init; }

    public ProgressReportInput? ProgressReport { get; init; }
}

public sealed record SetPaymentRequest(string Status, decimal? AmountPaid);

public sealed record ShareResponse(string Token);

/// <summary>Who documents are from: printed on every document when it is finalized.</summary>
public sealed record BrandingSettings
{
    [StringLength(200)]
    public string SenderName { get; init; } = string.Empty;

    [StringLength(500)]
    public string SenderAddress { get; init; } = string.Empty;

    [StringLength(64)]
    public string OrgNumber { get; init; } = string.Empty;

    /// <summary>"#rrggbb", or empty for the default.</summary>
    [RegularExpression("^(#[0-9A-Fa-f]{6})?$", ErrorMessage = "The colour must look like #2f6b4f.")]
    public string Color { get; init; } = string.Empty;
}
