namespace Model;

/// <summary>
/// A secret link to one bill, or to the live report of one month, that anyone holding it can open without an account,
/// e.g. the client. The project's owner turns it off by deleting it.
/// </summary>
public sealed class ShareLink
{
    /// <summary>The secret in the link: 128 random bits, URL-safe.</summary>
    public string Token { get; set; } = string.Empty;
    public long ProjectId { get; set; }
    /// <summary>The bill shared; null when a month's live report is shared instead.</summary>
    public long? BillId { get; set; }
    /// <summary>"yyyy-MM" of the live report shared; null for a bill.</summary>
    public string? Month { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public Project Project { get; set; } = null!;
}
