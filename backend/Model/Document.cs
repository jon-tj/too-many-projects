namespace Model;

/// <summary>
/// Something a project sends its client: an invoice, a progress report, and later SWOT analyses and tender responses.
/// A document starts as a draft only the project's owners see, and is finalized to share it. Finalizing freezes it:
/// the content and branding are stored as they were, so what the client sees never changes. A finalized document is
/// changed by revising it, which opens a new draft that replaces it once finalized (invoices are canceled and reissued
/// instead). Each type adds the columns it needs (see <see cref="Invoice"/>); the rest of its content is JSON.
/// </summary>
public abstract class Document
{
    public const string Draft = "draft";
    public const string Final = "final";

    public long Id { get; set; }
    public long ProjectId { get; set; }
    /// <summary>"invoice" or "progressReport"; set from the subclass.</summary>
    public string Type { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    /// <summary><see cref="Draft"/> or <see cref="Final"/>.</summary>
    public string Status { get; set; } = Draft;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public string CreatedByUserId { get; set; } = string.Empty;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? FinalizedAt { get; set; }
    /// <summary>The finalized document this one revises; null for a first version.</summary>
    public long? RevisionOfId { get; set; }
    /// <summary>The type's content as JSON: what the author entered while a draft, everything shown once finalized.</summary>
    public string ContentJson { get; set; } = "{}";
    /// <summary>
    /// The sender's branding (<see cref="DocumentBranding"/>) as it was when finalized; null while a draft, and on
    /// invoices finalized as bills before documents existed.
    /// </summary>
    public string? BrandingJson { get; set; }
    public Project Project { get; set; } = null!;

    public bool IsFinal => Status == Final;
}

/// <summary>A month's work billed to the client. Its content is the month's billing report.</summary>
public sealed class Invoice : Document
{
    /// <summary>
    /// Numbered per project when finalized; invoices from before documents keep their bill number. Null while a draft.
    /// </summary>
    public long? Number { get; set; }
    /// <summary>"yyyy-MM".</summary>
    public string Month { get; set; } = string.Empty;
    /// <summary>"due" (open), "paid", "partiallyPaid", "unpaid" or "canceled"; only used once finalized.</summary>
    public string PaymentStatus { get; set; } = "due";
    /// <summary>What the client owes for the month, VAT included, excluding overdue amounts from earlier invoices.</summary>
    public decimal Amount { get; set; }
    /// <summary>What was received, for partially paid invoices.</summary>
    public decimal AmountPaid { get; set; }

    /// <summary>Unpaid and partially paid invoices are overdue: what is still owed. Due invoices are still open.</summary>
    public decimal Overdue => PaymentStatus switch
    {
        "unpaid" => Amount,
        "partiallyPaid" => Math.Max(0, Amount - AmountPaid),
        _ => 0,
    };
}

/// <summary>What was done over a period: tasks completed, hours worked and the pace, with the author's summary.</summary>
public sealed class ProgressReport : Document;

/// <summary>Who a document is from, as printed on it.</summary>
/// <param name="Color">The accent colour, "#rrggbb"; empty uses the default.</param>
public sealed record DocumentBranding(
    string ProjectName, string SenderName, string SenderAddress, string OrgNumber, string Color,
    string? ProjectIcon, string? ProjectIconImage);
