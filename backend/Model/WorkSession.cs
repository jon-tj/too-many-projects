namespace Model;

/// <summary>A stretch of time someone marked themselves as working on a project. Open while EndedAt is null.</summary>
public sealed class WorkSession
{
    public long Id { get; set; }
    public long ProjectId { get; set; }
    public string UserId { get; set; } = string.Empty;
    public DateTimeOffset StartedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? EndedAt { get; set; }
    public Project Project { get; set; } = null!;
    public ApplicationUser User { get; set; } = null!;
}
