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
    /// <summary>How many units of work the task has; null when it is not split into units.</summary>
    public int? Units { get; set; }
    /// <summary>Units completed so far, between 0 and Units. A done task counts as complete whatever this is.</summary>
    public int UnitsDone { get; set; }

    /// <summary>Sets the unit total, keeping the completed count within it.</summary>
    public void SetUnits(int? units)
    {
        Units = units;
        UnitsDone = units is { } total ? Math.Min(UnitsDone, total) : 0;
    }

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