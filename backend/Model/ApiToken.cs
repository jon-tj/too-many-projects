namespace Model;

/// <summary>
/// A personal access token for the CLI and other scripts: sent as "Authorization: Bearer tmp_…" and acting as the user
/// who made it, until it is revoked. Only a hash of the token is kept; the token itself is shown once, when made.
/// </summary>
public sealed class ApiToken
{
    public long Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    /// <summary>What the user called it, e.g. "Laptop CLI".</summary>
    public string Name { get; set; } = string.Empty;
    /// <summary>SHA-256 of the token, hex; tokens are looked up by it.</summary>
    public string Hash { get; set; } = string.Empty;
    /// <summary>The token's first characters, so the user can tell their tokens apart.</summary>
    public string Prefix { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    /// <summary>When it was last used, to within an hour; null if never.</summary>
    public DateTimeOffset? LastUsedAt { get; set; }
    public ApplicationUser User { get; set; } = null!;
}
