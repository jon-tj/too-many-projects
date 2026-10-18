namespace Model;

/// <summary>
/// One anonymous visit to the landing or sign-up page: a browser tab, identified by a random id it keeps in session
/// storage (no cookie, nothing personal). Signing up from that tab links the visit to the new account, so the admin can
/// see how many visits end in an account.
/// </summary>
public sealed class Visit
{
    public Guid Id { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    /// <summary>The account made from this visit; null while (or if) none was.</summary>
    public string? UserId { get; set; }
}
