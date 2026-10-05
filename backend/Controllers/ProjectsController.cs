using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Model;

[ApiController]
[Authorize]
[Route("api/projects")]
public sealed class ProjectsController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<ProjectResponse>>> GetAll(CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var projects = await db.Projects.AsNoTracking()
            .Where(project => project.Members.Any(member => member.UserId == userId))
            .OrderByDescending(project => project.Id)
            .Select(project => new ProjectResponse(
                project.Id, project.Name, project.Description, project.CreatedAt,
                project.Tasks.Count, project.Members.Count))
            .ToListAsync(cancellationToken);

        return Ok(projects);
    }

    [HttpGet("{id:long}")]
    public async Task<ActionResult<ProjectResponse>> GetById(long id, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var project = await db.Projects.AsNoTracking()
            .Where(project => project.Id == id && project.Members.Any(member => member.UserId == userId))
            .Select(project => new ProjectResponse(
                project.Id, project.Name, project.Description, project.CreatedAt,
                project.Tasks.Count, project.Members.Count))
            .SingleOrDefaultAsync(cancellationToken);

        return project is null ? NotFound() : Ok(project);
    }

    [HttpGet("{id:long}/members")]
    public async Task<ActionResult<IReadOnlyList<ProjectMemberResponse>>> GetMembers(long id, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var isMember = await db.ProjectMembers.AnyAsync(
            member => member.ProjectId == id && member.UserId == userId,
            cancellationToken);
        if (!isMember) return NotFound();

        var members = await db.ProjectMembers.AsNoTracking()
            .Where(member => member.ProjectId == id)
            .OrderBy(member => member.Role)
            .Select(member => new ProjectMemberResponse(
                member.UserId,
                member.User.UserName ?? string.Empty,
                member.User.DisplayName,
                member.Role))
            .ToListAsync(cancellationToken);

        return Ok(members);
    }

    [HttpPost]
    public async Task<ActionResult<ProjectResponse>> Create(
        CreateProjectRequest request, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var project = new Project
        {
            Name = request.Name.Trim(),
            Description = request.Description?.Trim() ?? string.Empty,
            OwnerId = userId
        };
        project.Members.Add(new ProjectMember { Project = project, UserId = userId, Role = "Owner" });

        db.Projects.Add(project);
        await db.SaveChangesAsync(cancellationToken);

        var response = new ProjectResponse(project.Id, project.Name, project.Description, project.CreatedAt, 0, 1);
        return CreatedAtAction(nameof(GetById), new { id = project.Id }, response);
    }

    [HttpGet("{id:long}/canvas")]
    public async Task<ActionResult<CanvasResponse>> GetCanvas(long id, CancellationToken cancellationToken)
    {
        var project = await GetMemberProject(id, cancellationToken);
        if (project is null) return NotFound();
        return Ok(new CanvasResponse(JsonDocument.Parse(project.CanvasJson).RootElement.Clone()));
    }

    [HttpPut("{id:long}/canvas")]
    public async Task<IActionResult> SaveCanvas(
        long id, SaveCanvasRequest request, CancellationToken cancellationToken)
    {
        var project = await GetMemberProject(id, cancellationToken);
        if (project is null) return NotFound();

        project.CanvasJson = request.Canvas.GetRawText();
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    private Task<Project?> GetMemberProject(long id, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        return db.Projects.SingleOrDefaultAsync(
            project => project.Id == id && project.Members.Any(member => member.UserId == userId),
            cancellationToken);
    }
}

/// <summary>Project summary visible to a member.</summary>
public sealed record ProjectResponse(long Id, string Name, string Description, DateTimeOffset CreatedAt, int TaskCount, int MemberCount);

/// <summary>A member of a project visible to project participants.</summary>
public sealed record ProjectMemberResponse(string UserId, string UserName, string DisplayName, string Role);

/// <summary>Data required to create a project.</summary>
public sealed record CreateProjectRequest
{
    [Required, StringLength(120, MinimumLength = 1)]
    public required string Name { get; init; }

    [StringLength(1000)]
    public string? Description { get; init; }
}

/// <summary>Canvas document for a project.</summary>
public sealed record CanvasResponse(JsonElement Canvas);

/// <summary>Updated project canvas document.</summary>
public sealed record SaveCanvasRequest(JsonElement Canvas);