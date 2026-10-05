namespace Model;

public sealed class ProjectMember
{
    public long ProjectId { get; set; }
    public string UserId { get; set; } = string.Empty;
    public string Role { get; set; } = "Member";
    public Project Project { get; set; } = null!;
    public ApplicationUser User { get; set; } = null!;
}