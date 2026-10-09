namespace Model;

/// <summary>The task cannot start until the task it depends on is done. Both are in the same project.</summary>
public sealed class TaskDependency
{
    public long TaskId { get; set; }
    public long DependsOnTaskId { get; set; }
    public ProjectTask Task { get; set; } = null!;
    public ProjectTask DependsOn { get; set; } = null!;
}
