namespace Model;

/// <summary>A finalized monthly bill: a frozen copy of that month's billing report plus its payment status.</summary>
public sealed class Bill
{
    public long Id { get; set; }
    public long ProjectId { get; set; }
    /// <summary>"yyyy-MM".</summary>
    public string Month { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    /// <summary>"due" (open), "paid", "partiallyPaid", "unpaid" or "canceled".</summary>
    public string Status { get; set; } = "due";
    /// <summary>The month's amount, excluding overdue amounts from earlier bills.</summary>
    public decimal Amount { get; set; }
    /// <summary>What was received, for partially paid bills.</summary>
    public decimal AmountPaid { get; set; }
    /// <summary>The report as it was when finalized (JSON), so later changes do not alter the bill.</summary>
    public string ReportJson { get; set; } = string.Empty;
    public Project Project { get; set; } = null!;

    /// <summary>Unpaid and partially paid bills are overdue: what is still owed. Due bills are still open.</summary>
    public decimal Overdue => Status switch
    {
        "unpaid" => Amount,
        "partiallyPaid" => Math.Max(0, Amount - AmountPaid),
        _ => 0,
    };
}
