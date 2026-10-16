namespace Model;

/// <summary>A stretch of time someone marked themselves as working on a project. Open while EndedAt is null.</summary>
public sealed class WorkSession
{
    public long Id { get; set; }
    public long ProjectId { get; set; }
    public string UserId { get; set; } = string.Empty;
    public DateTimeOffset StartedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? EndedAt { get; set; }
    /// <summary>How the work felt, 0 (awful) to 10 (great), given when finishing; null when not given.</summary>
    public int? Mood { get; set; }
    /// <summary>How much the work pushed back, 0 (none) to 10 (a wall), given when finishing; null when not given.</summary>
    public int? Resistance { get; set; }
    /// <summary>An optional note about the session, given when finishing.</summary>
    public string? Message { get; set; }
    public Project Project { get; set; } = null!;
    public ApplicationUser User { get; set; } = null!;
}
