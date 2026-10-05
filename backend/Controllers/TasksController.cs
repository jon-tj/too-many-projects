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
                && (task.AssigneeUserId == null || task.AssigneeUserId == userId))
            .OrderByDescending(task => task.Id)
            .Select(task => new TaskResponse(
                task.Id, task.ProjectId, task.Project.Name, task.Title, task.Description,
                task.Status, task.AssigneeUserId, task.DueAt, task.CreatedAt))
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
                task.Status, task.AssigneeUserId, task.DueAt, task.CreatedAt))
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
                task.Status, task.AssigneeUserId, task.DueAt, task.CreatedAt))
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

        var task = new ProjectTask
        {
            ProjectId = projectId,
            Title = request.Title.Trim(),
            Description = request.Description?.Trim() ?? string.Empty,
            CreatedByUserId = userId,
            DueAt = request.DueAt
        };
        db.ProjectTasks.Add(task);
        await db.SaveChangesAsync(cancellationToken);

        var response = new TaskResponse(task.Id, projectId, project.Name, task.Title, task.Description,
            task.Status, task.AssigneeUserId, task.DueAt, task.CreatedAt);
        return Created($"/api/tasks/{task.Id}", response);
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
        task.Status = request.Status;
        task.AssigneeUserId = request.AssigneeUserId;
        task.DueAt = request.DueAt;
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

        task.Status = request.Status;
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }
}

/// <summary>Task summary for project and dashboard views.</summary>
public sealed record TaskResponse(
    long Id, long ProjectId, string ProjectName, string Title, string Description,
    string Status, string? AssigneeUserId, DateTimeOffset? DueAt, DateTimeOffset CreatedAt);

/// <summary>Data required to add a task to a project.</summary>
public sealed record CreateTaskRequest
{
    [Required, StringLength(180, MinimumLength = 1)]
    public required string Title { get; init; }

    [StringLength(2000)]
    public string? Description { get; init; }

    public DateTimeOffset? DueAt { get; init; }
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

    public DateTimeOffset? DueAt { get; init; }
}
