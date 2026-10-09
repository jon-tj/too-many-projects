namespace Model;

public sealed class ProjectMember
{
    public long ProjectId { get; set; }
    public string UserId { get; set; } = string.Empty;
    public string Role { get; set; } = "Member";
    /// <summary>Share of this member's hours that is billed: "1/1", "3/4", "2/3" or "1/2".</summary>
    public string BillableFraction { get; set; } = "1/1";
    /// <summary>When the member joined the project; the most recently added go first when a plan allows fewer members.</summary>
    public DateTimeOffset AddedAt { get; set; } = DateTimeOffset.UtcNow;
    public Project Project { get; set; } = null!;
    public ApplicationUser User { get; set; } = null!;
}