namespace Model;

/// <summary>
/// One stretch of a user being on a paid plan (Plus or Pro): from moving onto one until leaving paid plans again for
/// trial, free or no plan. Switching between Plus and Pro stays within the same spell. For the admin's figures on how
/// long people keep paying.
/// </summary>
public sealed class PaidSpell
{
    public long Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    public DateTimeOffset StartedAt { get; set; }
    /// <summary>When they left paid plans; null while they still pay.</summary>
    public DateTimeOffset? EndedAt { get; set; }
    public ApplicationUser User { get; set; } = null!;
}
