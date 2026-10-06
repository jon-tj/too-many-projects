using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Text.Json;
using Canvases;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Model;

[ApiController]
[Authorize]
[Route("api/projects/{projectId:long}/canvases")]
public sealed class CanvasesController(AppDbContext db, CanvasAccessService access) : ControllerBase
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

    /// <summary>Canvases the caller can read that have a pin linked to the task, with that pin's id.</summary>
    [HttpGet("pinned/{taskId:long}")]
    public async Task<ActionResult<IReadOnlyList<PinnedCanvasResponse>>> GetPinnedTo(
        long projectId, long taskId, CancellationToken cancellationToken)
    {
        var member = await GetMember(projectId, cancellationToken);
        if (member is null) return NotFound();

        var canvases = await db.Canvases.AsNoTracking()
            .Where(canvas => canvas.ProjectId == projectId)
            .Select(canvas => new
            {
                canvas.Id,
                canvas.Name,
                canvas.CanvasJson,
                Permission = canvas.Permissions.FirstOrDefault(permission => permission.UserId == member.UserId)
            })
            .ToListAsync(cancellationToken);

        return Ok(canvases
            .Where(canvas => Effective(member.Role, canvas.Permission).CanRead)
            .Select(canvas => (canvas, pinId: FindPinFor(canvas.CanvasJson, taskId)))
            .Where(match => match.pinId is not null)
            .Select(match => new PinnedCanvasResponse(match.canvas.Id, match.canvas.Name, match.pinId!))
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

    private const int MaxImageBytes = 5 * 1024 * 1024;

    /// <summary>Stores a pasted image; the canvas item then refers to it by the returned id.</summary>
    [HttpPost("{canvasId:int}/images")]
    [RequestSizeLimit(MaxImageBytes + 64 * 1024)]
    public async Task<ActionResult<CanvasImageResponse>> UploadImage(
        long projectId, int canvasId, IFormFile file, CancellationToken cancellationToken)
    {
        var access = await GetAccess(projectId, canvasId, cancellationToken);
        if (access is null) return NotFound();
        if (!access.CanWrite) return Forbid();
        if (!file.ContentType.StartsWith("image/", StringComparison.Ordinal))
            return BadRequest(new { error = "Only images can be added to a canvas." });
        if (file.Length > MaxImageBytes)
            return BadRequest(new { error = "Images can be at most 5 MB." });

        using var data = new MemoryStream();
        await file.CopyToAsync(data, cancellationToken);
        var image = new CanvasImage { CanvasId = canvasId, ContentType = file.ContentType, Data = data.ToArray() };
        db.CanvasImages.Add(image);
        await db.SaveChangesAsync(cancellationToken);
        return Ok(new CanvasImageResponse(image.Id));
    }

    [HttpGet("{canvasId:int}/images/{imageId:int}")]
    public async Task<IActionResult> GetImage(long projectId, int canvasId, int imageId, CancellationToken cancellationToken)
    {
        if (await GetAccess(projectId, canvasId, cancellationToken) is null) return NotFound();

        var image = await db.CanvasImages.AsNoTracking().SingleOrDefaultAsync(
            image => image.Id == imageId && image.CanvasId == canvasId, cancellationToken);
        if (image is null) return NotFound();

        // An image never changes after upload, so browsers may keep it.
        Response.Headers.CacheControl = "private, max-age=31536000, immutable";
        return File(image.Data, image.ContentType);
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

    /// <summary>Pins live inside the canvas document: the id of the item with type "pin" and a matching taskId.</summary>
    private static string? FindPinFor(string canvasJson, long taskId)
    {
        using var document = JsonDocument.Parse(canvasJson);
        if (!document.RootElement.TryGetProperty("items", out var items) || items.ValueKind != JsonValueKind.Array)
            return null;

        foreach (var item in items.EnumerateArray())
        {
            if (item.TryGetProperty("type", out var type) && type.ValueKind == JsonValueKind.String && type.GetString() == "pin"
                && item.TryGetProperty("taskId", out var id) && id.ValueKind == JsonValueKind.Number && id.GetInt64() == taskId
                && item.TryGetProperty("id", out var pinId) && pinId.ValueKind == JsonValueKind.String)
                return pinId.GetString();
        }
        return null;
    }

    private static (bool CanRead, bool CanWrite) Effective(string role, CanvasPermission? permission) =>
        CanvasAccessService.Effective(role, permission);

    private string UserId => User.FindFirstValue(ClaimTypes.NameIdentifier)!;

    private Task<ProjectMember?> GetMember(long projectId, CancellationToken cancellationToken) =>
        access.GetMember(projectId, UserId, cancellationToken);

    private Task<CanvasAccess?> GetAccess(long projectId, int canvasId, CancellationToken cancellationToken) =>
        access.GetAccess(projectId, canvasId, UserId, cancellationToken);
}

/// <summary>Canvas listed in a project.</summary>
public sealed record CanvasSummaryResponse(int Id, string Name, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);

/// <summary>A canvas with the id of the pin linked to a task.</summary>
public sealed record PinnedCanvasResponse(int Id, string Name, string PinId);

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

/// <summary>The id of an uploaded canvas image.</summary>
public sealed record CanvasImageResponse(int Id);

/// <summary>Updated canvas document.</summary>
public sealed record SaveCanvasRequest(JsonElement Canvas);

/// <summary>Read and write access for one member.</summary>
public sealed record SetCanvasPermissionRequest(bool CanRead, bool CanWrite);
