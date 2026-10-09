using System.ComponentModel.DataAnnotations;
using System.Linq.Expressions;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Model;

[ApiController]
[Authorize]
[Route("api/tasks")]
public sealed class TasksController(AppDbContext db) : ControllerBase
{
    private static readonly string[] ValidStatuses = ["todo", "doing", "done"];
    private static readonly string[] ValidPriorities = ["low", "high", "critical"];
    private const string BlockedError = "This task is blocked until all its dependencies are done.";

    private static readonly Expression<Func<ProjectTask, TaskResponse>> ToResponse = task => new TaskResponse(
        task.Id, task.ProjectId, task.Project.Name, task.Title, task.Description,
        task.Status, task.Priority, task.AssigneeUserId, task.DueAt, task.CreatedAt, task.CompletedAt, task.Units, task.UnitsDone,
        task.Dependencies.Select(dependency => dependency.DependsOnTaskId).ToList(),
        task.Dependencies.Any(dependency => dependency.DependsOn.Status != "done"));

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<TaskResponse>>> GetMyAndUnassigned(CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        // What you are doing, then what you could pick up next: to do tasks that are yours or unassigned and not
        // blocked (blocked ones cannot be started yet).
        var tasks = await db.ProjectTasks.AsNoTracking()
            .Where(task => task.Project.Members.Any(member => member.UserId == userId)
                && ((task.Status == "doing" && task.AssigneeUserId == userId)
                    || (task.Status == "todo"
                        && (task.AssigneeUserId == null || task.AssigneeUserId == userId)
                        && !task.Dependencies.Any(dependency => dependency.DependsOn.Status != "done"))))
            .Select(ToResponse)
            .ToListAsync(cancellationToken);

        // Sorted in memory: SQLite cannot order by DateTimeOffset. Doing first, then by priority, then the earliest
        // due date (tasks without one last), then newest first.
        return Ok(tasks
            .OrderBy(task => task.Status == "doing" ? 0 : 1)
            .ThenByDescending(task => task.Priority switch { "critical" => 2, "high" => 1, _ => 0 })
            .ThenBy(task => task.DueAt ?? DateTimeOffset.MaxValue)
            .ThenByDescending(task => task.Id)
            .ToList());
    }

    [HttpGet("{id:long}")]
    public async Task<ActionResult<TaskResponse>> GetById(long id, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var task = await db.ProjectTasks.AsNoTracking()
            .Where(task => task.Id == id && task.Project.Members.Any(member => member.UserId == userId))
            .Select(ToResponse)
            .SingleOrDefaultAsync(cancellationToken);

        return task is null ? NotFound() : Ok(task);
    }

    [HttpGet("by-project/{projectId:long}")]
    public async Task<ActionResult<IReadOnlyList<TaskResponse>>> GetByProject(long projectId, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var tasks = await db.ProjectTasks.AsNoTracking()
            .Where(task => task.ProjectId == projectId && task.Project.Members.Any(member => member.UserId == userId))
            .OrderByDescending(task => task.Id)
            .Select(ToResponse)
            .ToListAsync(cancellationToken);

        return Ok(tasks);
    }

    [HttpPost("by-project/{projectId:long}")]
    public async Task<ActionResult<TaskResponse>> Create(
        long projectId, CreateTaskRequest request, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var project = await db.Projects.SingleOrDefaultAsync(
            project => project.Id == projectId && project.Members.Any(member => member.UserId == userId),
            cancellationToken);
        if (project is null) return NotFound();
        if (!ValidPriorities.Contains(request.Priority))
            return BadRequest(new { error = "Priority must be low, high, or critical." });
        var dependsOn = request.DependsOn.Distinct().ToArray();
        if (await ValidateDependencies(projectId, null, dependsOn, cancellationToken) is { } dependencyError)
            return BadRequest(new { error = dependencyError });
        if (request.AssigneeUserId is not null && !await db.ProjectMembers.AnyAsync(
                member => member.ProjectId == projectId && member.UserId == request.AssigneeUserId,
                cancellationToken))
            return BadRequest(new { error = "The assignee must be a member of the project." });

        var task = new ProjectTask
        {
            ProjectId = projectId,
            Title = request.Title.Trim(),
            Description = request.Description?.Trim() ?? string.Empty,
            Priority = request.Priority,
            CreatedByUserId = userId,
            AssigneeUserId = request.AssigneeUserId,
            Units = request.Units,
            DueAt = request.DueAt
        };
        foreach (var dependency in dependsOn) task.Dependencies.Add(new TaskDependency { DependsOnTaskId = dependency });
        db.ProjectTasks.Add(task);
        await db.SaveChangesAsync(cancellationToken);

        var response = await db.ProjectTasks.AsNoTracking()
            .Where(created => created.Id == task.Id)
            .Select(ToResponse)
            .SingleAsync(cancellationToken);
        return Created($"/api/tasks/{task.Id}", response);
    }

    /// <summary>Assigns several of a project's tasks at once, from the board's selection. A null assignee unassigns them.</summary>
    [HttpPatch("by-project/{projectId:long}/assignee")]
    public async Task<IActionResult> AssignMany(
        long projectId, AssignTasksRequest request, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        if (!await db.ProjectMembers.AnyAsync(
                member => member.ProjectId == projectId && member.UserId == userId, cancellationToken))
            return NotFound();
        if (request.AssigneeUserId is not null && !await db.ProjectMembers.AnyAsync(
                member => member.ProjectId == projectId && member.UserId == request.AssigneeUserId,
                cancellationToken))
            return BadRequest(new { error = "The assignee must be a member of the project." });

        var tasks = await db.ProjectTasks
            .Where(task => task.ProjectId == projectId && request.TaskIds.Contains(task.Id))
            .ToListAsync(cancellationToken);
        if (tasks.Count != request.TaskIds.Distinct().Count()) return NotFound();

        foreach (var task in tasks) task.AssigneeUserId = request.AssigneeUserId;
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    /// <summary>Sets the priority of several of a project's tasks at once, e.g. from the roadmap's critical path.</summary>
    [HttpPatch("by-project/{projectId:long}/priority")]
    public async Task<IActionResult> SetPriorityMany(
        long projectId, SetTasksPriorityRequest request, CancellationToken cancellationToken)
    {
        if (!ValidPriorities.Contains(request.Priority))
            return BadRequest(new { error = "Priority must be low, high, or critical." });
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        if (!await db.ProjectMembers.AnyAsync(
                member => member.ProjectId == projectId && member.UserId == userId, cancellationToken))
            return NotFound();

        var tasks = await db.ProjectTasks
            .Where(task => task.ProjectId == projectId && request.TaskIds.Contains(task.Id))
            .ToListAsync(cancellationToken);
        if (tasks.Count != request.TaskIds.Distinct().Count()) return NotFound();

        foreach (var task in tasks) task.Priority = request.Priority;
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    [HttpPut("{id:long}")]
    public async Task<IActionResult> Update(
        long id, UpdateTaskRequest request, CancellationToken cancellationToken)
    {
        if (!ValidStatuses.Contains(request.Status))
            return BadRequest(new { error = "Status must be todo, doing, or done." });
        if (!ValidPriorities.Contains(request.Priority))
            return BadRequest(new { error = "Priority must be low, high, or critical." });

        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var task = await db.ProjectTasks.SingleOrDefaultAsync(
            task => task.Id == id && task.Project.Members.Any(member => member.UserId == userId),
            cancellationToken);
        if (task is null) return NotFound();

        if (request.AssigneeUserId is not null && !await db.ProjectMembers.AnyAsync(
                member => member.ProjectId == task.ProjectId && member.UserId == request.AssigneeUserId,
                cancellationToken))
            return BadRequest(new { error = "The assignee must be a member of the project." });

        var dependsOn = request.DependsOn.Distinct().ToArray();
        if (await ValidateDependencies(task.ProjectId, task.Id, dependsOn, cancellationToken) is { } dependencyError)
            return BadRequest(new { error = dependencyError });
        if (task.Status == "todo" && request.Status != "todo" && await db.ProjectTasks.AnyAsync(
                other => dependsOn.Contains(other.Id) && other.Status != "done", cancellationToken))
            return BadRequest(new { error = BlockedError });

        var existing = await db.TaskDependencies.Where(dependency => dependency.TaskId == id).ToListAsync(cancellationToken);
        db.TaskDependencies.RemoveRange(existing.Where(dependency => !dependsOn.Contains(dependency.DependsOnTaskId)));
        db.TaskDependencies.AddRange(dependsOn
            .Except(existing.Select(dependency => dependency.DependsOnTaskId))
            .Select(dependency => new TaskDependency { TaskId = id, DependsOnTaskId = dependency }));
        task.Title = request.Title.Trim();
        task.Description = request.Description?.Trim() ?? string.Empty;
        task.SetStatus(request.Status);
        task.Priority = request.Priority;
        task.AssigneeUserId = request.AssigneeUserId;
        task.DueAt = request.DueAt;
        task.SetUnits(request.Units);
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    [HttpDelete("{id:long}")]
    public async Task<IActionResult> Delete(long id, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var task = await db.ProjectTasks.SingleOrDefaultAsync(
            task => task.Id == id && task.Project.Members.Any(member => member.UserId == userId),
            cancellationToken);
        if (task is null) return NotFound();

        db.ProjectTasks.Remove(task);
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    /// <summary>Sets how many units are done, from the board's − / + controls.</summary>
    [HttpPatch("{id:long}/units")]
    public async Task<IActionResult> SetUnitsDone(
        long id, SetUnitsDoneRequest request, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var task = await db.ProjectTasks.SingleOrDefaultAsync(
            task => task.Id == id && task.Project.Members.Any(member => member.UserId == userId),
            cancellationToken);
        if (task is null) return NotFound();
        if (task.Units is not { } total) return BadRequest(new { error = "This task is not split into units." });
        if (request.Done < 0 || request.Done > total)
            return BadRequest(new { error = $"Units done must be between 0 and {total}." });

        task.UnitsDone = request.Done;
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    [HttpPatch("{id:long}/status")]
    public async Task<IActionResult> SetStatus(
        long id, SetTaskStatusRequest request, CancellationToken cancellationToken)
    {
        if (!ValidStatuses.Contains(request.Status))
            return BadRequest(new { error = "Status must be todo, doing, or done." });

        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var task = await db.ProjectTasks.SingleOrDefaultAsync(
            task => task.Id == id && task.Project.Members.Any(member => member.UserId == userId),
            cancellationToken);
        if (task is null) return NotFound();
        if (task.Status == "todo" && request.Status != "todo" && await db.TaskDependencies.AnyAsync(
                dependency => dependency.TaskId == id && dependency.DependsOn.Status != "done", cancellationToken))
            return BadRequest(new { error = BlockedError });

        // Starting an unassigned task makes it yours; tasks already assigned to someone keep their assignee.
        if (request.Status == "doing" && task.AssigneeUserId is null) task.AssigneeUserId = userId;
        task.SetStatus(request.Status);
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    /// <summary>
    /// Checks the dependencies are other tasks in the same project, would not form a cycle, and that none being added is
    /// already implied: if B depends on A, a task depending on B must not also depend on A, whichever is added second.
    /// Only added dependencies are checked, so tasks saved before this rule can still be edited.
    /// Returns an error message, or null when they are fine.
    /// </summary>
    private async Task<string?> ValidateDependencies(
        long projectId, long? taskId, long[] dependsOn, CancellationToken cancellationToken)
    {
        if (dependsOn.Length == 0) return null;
        if (taskId is { } self && dependsOn.Contains(self)) return "A task cannot depend on itself.";
        var titles = await db.ProjectTasks
            .Where(task => task.ProjectId == projectId && dependsOn.Contains(task.Id))
            .ToDictionaryAsync(task => task.Id, task => task.Title, cancellationToken);
        if (titles.Count != dependsOn.Length) return "Dependencies must be tasks in the same project.";

        // Every other task's dependencies; this task's own are the ones being replaced.
        var edges = (await db.TaskDependencies
                .Where(dependency => dependency.Task.ProjectId == projectId && dependency.TaskId != taskId)
                .Select(dependency => new { dependency.TaskId, dependency.DependsOnTaskId })
                .ToListAsync(cancellationToken))
            .ToLookup(edge => edge.TaskId, edge => edge.DependsOnTaskId);
        // Everything a task waits for, directly or through others.
        HashSet<long> Upstream(long start)
        {
            var seen = new HashSet<long>();
            var pending = new Stack<long>(edges[start]);
            while (pending.TryPop(out var current))
                if (seen.Add(current)) foreach (var next in edges[current]) pending.Push(next);
            return seen;
        }
        var upstream = dependsOn.ToDictionary(id => id, Upstream);

        if (taskId is { } id && dependsOn.Any(dependency => dependency == id || upstream[dependency].Contains(id)))
            return "That would make the tasks depend on each other in a loop.";

        var existing = taskId is null
            ? []
            : await db.TaskDependencies
                .Where(dependency => dependency.TaskId == taskId)
                .Select(dependency => dependency.DependsOnTaskId)
                .ToListAsync(cancellationToken);
        foreach (var added in dependsOn.Except(existing))
        {
            if (dependsOn.FirstOrDefault(other => upstream[other].Contains(added)) is var via and not 0)
                return $"\"{titles[added]}\" is already a dependency through \"{titles[via]}\".";
            if (dependsOn.FirstOrDefault(other => upstream[added].Contains(other)) is var implied and not 0)
                return $"\"{titles[added]}\" already depends on \"{titles[implied]}\"; remove \"{titles[implied]}\" first.";
        }
        return null;
    }
}

/// <summary>Task summary for project and dashboard views.</summary>
public sealed record TaskResponse(
    long Id, long ProjectId, string ProjectName, string Title, string Description,
    string Status, string Priority, string? AssigneeUserId, DateTimeOffset? DueAt, DateTimeOffset CreatedAt,
    DateTimeOffset? CompletedAt, int? Units, int UnitsDone,
    IReadOnlyList<long> DependsOn, bool Blocked);

/// <summary>How many units of a task are done.</summary>
public sealed record SetUnitsDoneRequest(int Done);

/// <summary>Data required to add a task to a project.</summary>
public sealed record CreateTaskRequest
{
    [Required, StringLength(180, MinimumLength = 1)]
    public required string Title { get; init; }

    [StringLength(2000)]
    public string? Description { get; init; }

    /// <summary>low, high or critical.</summary>
    public string Priority { get; init; } = "low";

    public string? AssigneeUserId { get; init; }

    [Range(1, 1000)]
    public int? Units { get; init; }

    public DateTimeOffset? DueAt { get; init; }

    /// <summary>Ids of tasks in the same project that must be done before this one can start.</summary>
    public long[] DependsOn { get; init; } = [];
}

/// <summary>The tasks to assign and who to assign them to (null to unassign).</summary>
public sealed record AssignTasksRequest
{
    [Required, MinLength(1)]
    public required long[] TaskIds { get; init; }

    public string? AssigneeUserId { get; init; }
}

/// <summary>The tasks to change and their new priority: low, high or critical.</summary>
public sealed record SetTasksPriorityRequest
{
    [Required, MinLength(1)]
    public required long[] TaskIds { get; init; }

    [Required]
    public required string Priority { get; init; }
}

/// <summary>New task workflow status.</summary>
public sealed record SetTaskStatusRequest
{
    [Required]
    public required string Status { get; init; }
}

/// <summary>Editable task fields.</summary>
public sealed record UpdateTaskRequest
{
    [Required, StringLength(180, MinimumLength = 1)]
    public required string Title { get; init; }

    [StringLength(2000)]
    public string? Description { get; init; }

    [Required]
    public required string Status { get; init; }

    /// <summary>low, high or critical.</summary>
    public string Priority { get; init; } = "low";

    public string? AssigneeUserId { get; init; }

    [Range(1, 1000)]
    public int? Units { get; init; }

    public DateTimeOffset? DueAt { get; init; }

    /// <summary>Ids of tasks in the same project that must be done before this one can start.</summary>
    public long[] DependsOn { get; init; } = [];
}
