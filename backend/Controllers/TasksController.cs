using System.ComponentModel.DataAnnotations;
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

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<TaskResponse>>> GetMyAndUnassigned(CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var tasks = await db.ProjectTasks.AsNoTracking()
            .Where(task => task.Project.Members.Any(member => member.UserId == userId)
                && (task.AssigneeUserId == null || task.AssigneeUserId == userId)
                && task.Status != "done")
            .OrderByDescending(task => task.Id)
            .Select(task => new TaskResponse(
                task.Id, task.ProjectId, task.Project.Name, task.Title, task.Description,
                task.Status, task.AssigneeUserId, task.DueAt, task.CreatedAt, task.Units, task.UnitsDone))
            .ToListAsync(cancellationToken);

        return Ok(tasks);
    }

    [HttpGet("{id:long}")]
    public async Task<ActionResult<TaskResponse>> GetById(long id, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var task = await db.ProjectTasks.AsNoTracking()
            .Where(task => task.Id == id && task.Project.Members.Any(member => member.UserId == userId))
            .Select(task => new TaskResponse(
                task.Id, task.ProjectId, task.Project.Name, task.Title, task.Description,
                task.Status, task.AssigneeUserId, task.DueAt, task.CreatedAt, task.Units, task.UnitsDone))
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
            .Select(task => new TaskResponse(
                task.Id, task.ProjectId, task.Project.Name, task.Title, task.Description,
                task.Status, task.AssigneeUserId, task.DueAt, task.CreatedAt, task.Units, task.UnitsDone))
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
        if (request.AssigneeUserId is not null && !await db.ProjectMembers.AnyAsync(
                member => member.ProjectId == projectId && member.UserId == request.AssigneeUserId,
                cancellationToken))
            return BadRequest(new { error = "The assignee must be a member of the project." });

        var task = new ProjectTask
        {
            ProjectId = projectId,
            Title = request.Title.Trim(),
            Description = request.Description?.Trim() ?? string.Empty,
            CreatedByUserId = userId,
            AssigneeUserId = request.AssigneeUserId,
            Units = request.Units,
            DueAt = request.DueAt
        };
        db.ProjectTasks.Add(task);
        await db.SaveChangesAsync(cancellationToken);

        var response = new TaskResponse(task.Id, projectId, project.Name, task.Title, task.Description,
            task.Status, task.AssigneeUserId, task.DueAt, task.CreatedAt, task.Units, task.UnitsDone);
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

    [HttpPut("{id:long}")]
    public async Task<IActionResult> Update(
        long id, UpdateTaskRequest request, CancellationToken cancellationToken)
    {
        if (!ValidStatuses.Contains(request.Status))
            return BadRequest(new { error = "Status must be todo, doing, or done." });

        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var task = await db.ProjectTasks.SingleOrDefaultAsync(
            task => task.Id == id && task.Project.Members.Any(member => member.UserId == userId),
            cancellationToken);
        if (task is null) return NotFound();

        if (request.AssigneeUserId is not null && !await db.ProjectMembers.AnyAsync(
                member => member.ProjectId == task.ProjectId && member.UserId == request.AssigneeUserId,
                cancellationToken))
            return BadRequest(new { error = "The assignee must be a member of the project." });

        task.Title = request.Title.Trim();
        task.Description = request.Description?.Trim() ?? string.Empty;
        task.SetStatus(request.Status);
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

        task.SetStatus(request.Status);
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }
}

/// <summary>Task summary for project and dashboard views.</summary>
public sealed record TaskResponse(
    long Id, long ProjectId, string ProjectName, string Title, string Description,
    string Status, string? AssigneeUserId, DateTimeOffset? DueAt, DateTimeOffset CreatedAt, int? Units, int UnitsDone);

/// <summary>How many units of a task are done.</summary>
public sealed record SetUnitsDoneRequest(int Done);

/// <summary>Data required to add a task to a project.</summary>
public sealed record CreateTaskRequest
{
    [Required, StringLength(180, MinimumLength = 1)]
    public required string Title { get; init; }

    [StringLength(2000)]
    public string? Description { get; init; }

    public string? AssigneeUserId { get; init; }

    [Range(1, 1000)]
    public int? Units { get; init; }

    public DateTimeOffset? DueAt { get; init; }
}

/// <summary>The tasks to assign and who to assign them to (null to unassign).</summary>
public sealed record AssignTasksRequest
{
    [Required, MinLength(1)]
    public required long[] TaskIds { get; init; }

    public string? AssigneeUserId { get; init; }
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

    public string? AssigneeUserId { get; init; }

    [Range(1, 1000)]
    public int? Units { get; init; }

    public DateTimeOffset? DueAt { get; init; }
}
