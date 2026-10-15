namespace Model;

/// <summary>
/// A user whose plan never lapses, whatever its renew date, e.g. the admin. Kept apart from the user because very few
/// users have one. Managed on the admin page (api/admin/users/{id}/exempt).
/// </summary>
public sealed class PlanExemption
{
    public string UserId { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    /// <summary>Why the user is exempt, for whoever looks at the table later.</summary>
    public string Note { get; set; } = string.Empty;
    public ApplicationUser User { get; set; } = null!;
}
