using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Model;

[ApiController]
[Authorize]
[Route("api/projects/{projectId:long}/canvases")]
public sealed class CanvasesController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<CanvasSummaryResponse>>> GetAll(
        long projectId, CancellationToken cancellationToken)
    {
        var member = await GetMember(projectId, cancellationToken);
        if (member is null) return NotFound();

        var canvases = await db.Canvases.AsNoTracking()
            .Where(canvas => canvas.ProjectId == projectId)
            .Select(canvas => new
            {
                Summary = new CanvasSummaryResponse(canvas.Id, canvas.Name, canvas.CreatedAt, canvas.UpdatedAt),
                Permission = canvas.Permissions.FirstOrDefault(permission => permission.UserId == member.UserId)
            })
            .ToListAsync(cancellationToken);

        // Sorted in memory because SQLite cannot order by DateTimeOffset.
        return Ok(canvases
            .Where(canvas => Effective(member.Role, canvas.Permission).CanRead)
            .Select(canvas => canvas.Summary)
            .OrderByDescending(canvas => canvas.UpdatedAt)
            .ToList());
    }

    [HttpPost]
    public async Task<ActionResult<CanvasSummaryResponse>> Create(
        long projectId, CanvasNameRequest request, CancellationToken cancellationToken)
    {
        var member = await GetMember(projectId, cancellationToken);
        if (member is null) return NotFound();
        if (member.Role == "External") return Forbid();

        var canvas = new Canvas { ProjectId = projectId, Name = request.Name.Trim() };
        db.Canvases.Add(canvas);
        await db.SaveChangesAsync(cancellationToken);
        return Ok(new CanvasSummaryResponse(canvas.Id, canvas.Name, canvas.CreatedAt, canvas.UpdatedAt));
    }

    [HttpGet("{canvasId:int}")]
    public async Task<ActionResult<CanvasResponse>> Get(
        long projectId, int canvasId, CancellationToken cancellationToken)
    {
        var access = await GetAccess(projectId, canvasId, cancellationToken);
        if (access is null) return NotFound();

        var canvas = access.Canvas;
        return Ok(new CanvasResponse(
            canvas.Id, canvas.Name, canvas.CreatedAt, canvas.UpdatedAt,
            access.CanWrite, access.IsOwner,
            JsonDocument.Parse(canvas.CanvasJson).RootElement.Clone()));
    }

    [HttpPut("{canvasId:int}")]
    public async Task<IActionResult> Rename(
        long projectId, int canvasId, CanvasNameRequest request, CancellationToken cancellationToken)
    {
        var access = await GetAccess(projectId, canvasId, cancellationToken);
        if (access is null) return NotFound();
        if (!access.CanWrite) return Forbid();

        access.Canvas.Name = request.Name.Trim();
        access.Canvas.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    [HttpDelete("{canvasId:int}")]
    public async Task<IActionResult> Delete(long projectId, int canvasId, CancellationToken cancellationToken)
    {
        var access = await GetAccess(projectId, canvasId, cancellationToken);
        if (access is null) return NotFound();
        if (!access.IsOwner) return Forbid();

        db.Canvases.Remove(access.Canvas);
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    [HttpPut("{canvasId:int}/content")]
    public async Task<IActionResult> SaveContent(
        long projectId, int canvasId, SaveCanvasRequest request, CancellationToken cancellationToken)
    {
        var access = await GetAccess(projectId, canvasId, cancellationToken);
        if (access is null) return NotFound();
        if (!access.CanWrite) return Forbid();

        access.Canvas.CanvasJson = request.Canvas.GetRawText();
        access.Canvas.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    [HttpGet("{canvasId:int}/permissions")]
    public async Task<ActionResult<IReadOnlyList<CanvasPermissionResponse>>> GetPermissions(
        long projectId, int canvasId, CancellationToken cancellationToken)
    {
        if (await GetAccess(projectId, canvasId, cancellationToken) is null) return NotFound();

        var members = await db.ProjectMembers.AsNoTracking()
            .Where(member => member.ProjectId == projectId)
            .OrderBy(member => member.User.UserName)
            .Select(member => new
            {
                member.UserId,
                UserName = member.User.UserName ?? string.Empty,
                member.User.DisplayName,
                member.Role,
                Permission = db.CanvasPermissions.FirstOrDefault(
                    permission => permission.CanvasId == canvasId && permission.UserId == member.UserId)
            })
            .ToListAsync(cancellationToken);

        return Ok(members.Select(member =>
        {
            var (canRead, canWrite) = Effective(member.Role, member.Permission);
            return new CanvasPermissionResponse(member.UserId, member.UserName, member.DisplayName, member.Role, canRead, canWrite);
        }).ToList());
    }

    [HttpPut("{canvasId:int}/permissions/{userId}")]
    public async Task<IActionResult> SetPermission(
        long projectId, int canvasId, string userId, SetCanvasPermissionRequest request,
        CancellationToken cancellationToken)
    {
        var access = await GetAccess(projectId, canvasId, cancellationToken);
        if (access is null) return NotFound();
        if (!access.IsOwner) return Forbid();

        var target = await db.ProjectMembers.AsNoTracking().SingleOrDefaultAsync(
            member => member.ProjectId == projectId && member.UserId == userId, cancellationToken);
        if (target is null) return NotFound();
        if (target.Role == "Owner") return Conflict(new { error = "Owners always have full access." });

        var permission = await db.CanvasPermissions.SingleOrDefaultAsync(
            permission => permission.CanvasId == canvasId && permission.UserId == userId, cancellationToken);
        if (permission is null)
        {
            permission = new CanvasPermission { CanvasId = canvasId, UserId = userId };
            db.CanvasPermissions.Add(permission);
        }
        // Writing requires reading, so the two flags are kept consistent.
        permission.CanWrite = request.CanWrite;
        permission.CanRead = request.CanRead || request.CanWrite;
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    /// <summary>Owners always have full access; otherwise an override applies, else the role default.</summary>
    private static (bool CanRead, bool CanWrite) Effective(string role, CanvasPermission? permission) =>
        role == "Owner" ? (true, true)
        : permission is not null ? (permission.CanRead, permission.CanWrite)
        : role == "External" ? (false, false)
        : (true, true);

    private Task<ProjectMember?> GetMember(long projectId, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        return db.ProjectMembers.AsNoTracking().SingleOrDefaultAsync(
            member => member.ProjectId == projectId && member.UserId == userId, cancellationToken);
    }

    /// <summary>The canvas and the caller's access to it, or null when the caller cannot read it.</summary>
    private async Task<CanvasAccess?> GetAccess(long projectId, int canvasId, CancellationToken cancellationToken)
    {
        var member = await GetMember(projectId, cancellationToken);
        if (member is null) return null;

        var canvas = await db.Canvases.SingleOrDefaultAsync(
            canvas => canvas.Id == canvasId && canvas.ProjectId == projectId, cancellationToken);
        if (canvas is null) return null;

        var permission = await db.CanvasPermissions.AsNoTracking().SingleOrDefaultAsync(
            permission => permission.CanvasId == canvasId && permission.UserId == member.UserId, cancellationToken);
        var (canRead, canWrite) = Effective(member.Role, permission);
        return canRead ? new CanvasAccess(canvas, canWrite, member.Role == "Owner") : null;
    }

    private sealed record CanvasAccess(Canvas Canvas, bool CanWrite, bool IsOwner);
}

/// <summary>Canvas listed in a project.</summary>
public sealed record CanvasSummaryResponse(int Id, string Name, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);

/// <summary>Canvas document with the caller's access.</summary>
public sealed record CanvasResponse(
    int Id, string Name, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt,
    bool CanWrite, bool CanManage, JsonElement Canvas);

/// <summary>A project member's effective access to a canvas.</summary>
public sealed record CanvasPermissionResponse(
    string UserId, string UserName, string DisplayName, string Role, bool CanRead, bool CanWrite);

/// <summary>Name for a new or renamed canvas.</summary>
public sealed record CanvasNameRequest
{
    [Required, StringLength(120, MinimumLength = 1)]
    public required string Name { get; init; }
}

/// <summary>Updated canvas document.</summary>
public sealed record SaveCanvasRequest(JsonElement Canvas);

/// <summary>Read and write access for one member.</summary>
public sealed record SetCanvasPermissionRequest(bool CanRead, bool CanWrite);
