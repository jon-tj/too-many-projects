namespace Model;

/// <summary>
/// A secret link to one finalized document that anyone holding it can open without an account, e.g. the client. The
/// project's owner turns it off by deleting it.
/// </summary>
public sealed class ShareLink
{
    /// <summary>The secret in the link: 128 random bits, URL-safe.</summary>
    public string Token { get; set; } = string.Empty;
    public long ProjectId { get; set; }
    public long DocumentId { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public Project Project { get; set; } = null!;
    public Document Document { get; set; } = null!;
}
