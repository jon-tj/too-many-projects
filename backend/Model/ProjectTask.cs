namespace Model;

public sealed class ProjectTask
{
    public long Id { get; set; }
    public long ProjectId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string Status { get; set; } = "todo";
    public string CreatedByUserId { get; set; } = string.Empty;
    public string? AssigneeUserId { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? DueAt { get; set; }
    /// <summary>When the task last moved to done; null while it is not done.</summary>
    public DateTimeOffset? CompletedAt { get; set; }

    /// <summary>Changes the status, keeping CompletedAt in step with it.</summary>
    public void SetStatus(string status)
    {
        if (status == "done" && Status != "done") CompletedAt = DateTimeOffset.UtcNow;
        else if (status != "done") CompletedAt = null;
        Status = status;
    }
    public Project Project { get; set; } = null!;
}