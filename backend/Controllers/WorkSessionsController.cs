using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

/// <summary>The caller's own work sessions, for the work log: listing them and correcting their times.</summary>
[ApiController]
[Authorize]
[Route("api/work-sessions")]
public sealed class WorkSessionsController(AppDbContext db) : ControllerBase
{
    /// <summary>
    /// The caller's sessions that were still running at or after <paramref name="from"/>, in projects they are a member of,
    /// optionally only one project's. Oldest first.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<WorkSessionResponse>>> GetMine(
        [FromQuery] DateTimeOffset from, [FromQuery] long? projectId, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        // Filtered by time in memory: SQLite cannot compare DateTimeOffset values in queries.
        var sessions = await db.WorkSessions.AsNoTracking()
            .Where(session => session.UserId == userId
                && (projectId == null || session.ProjectId == projectId)
                && session.Project.Members.Any(member => member.UserId == userId))
            .Select(session => new WorkSessionResponse(
                session.Id, session.ProjectId, session.Project.Name, session.StartedAt, session.EndedAt))
            .ToListAsync(cancellationToken);

        return Ok(sessions
            .Where(session => session.EndedAt is not { } ended || ended >= from)
            .OrderBy(session => session.StartedAt)
            .ToList());
    }

    /// <summary>
    /// Corrects a session's start and end. A finished session must keep an end; a running one may be given one, which
    /// stops it. Times cannot be in the future, and sessions cannot overlap the caller's other sessions in the same
    /// project (sessions in different projects may).
    /// </summary>
    [HttpPatch("{id:long}")]
    public async Task<ActionResult<WorkSessionResponse>> Update(
        long id, UpdateWorkSessionRequest request, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var session = await db.WorkSessions
            .Include(session => session.Project)
            .SingleOrDefaultAsync(session => session.Id == id && session.UserId == userId
                && session.Project.Members.Any(member => member.UserId == userId), cancellationToken);
        if (session is null) return NotFound();

        var now = DateTimeOffset.UtcNow;
        if (request.EndedAt is null && session.EndedAt is not null)
            return BadRequest(new { error = "A finished session needs an end time." });
        if (request.StartedAt > now || request.EndedAt > now)
            return BadRequest(new { error = "Times cannot be in the future." });
        if (request.EndedAt is { } end && end <= request.StartedAt)
            return BadRequest(new { error = "The end must be after the start." });

        // Overlapping sessions in the same project would count the same hours twice; other projects may overlap freely.
        var others = await db.WorkSessions.AsNoTracking()
            .Where(other => other.UserId == userId && other.ProjectId == session.ProjectId && other.Id != id)
            .Select(other => new { other.StartedAt, other.EndedAt })
            .ToListAsync(cancellationToken);
        var until = request.EndedAt ?? now;
        if (others.Any(other => other.StartedAt < until && (other.EndedAt ?? now) > request.StartedAt))
            return BadRequest(new { error = "That overlaps another session in this project." });

        session.StartedAt = request.StartedAt;
        session.EndedAt = request.EndedAt;
        await db.SaveChangesAsync(cancellationToken);
        return Ok(new WorkSessionResponse(
            session.Id, session.ProjectId, session.Project.Name, session.StartedAt, session.EndedAt));
    }
}

/// <summary>A stretch of work; EndedAt is null while it is still running.</summary>
public sealed record WorkSessionResponse(
    long Id, long ProjectId, string ProjectName, DateTimeOffset StartedAt, DateTimeOffset? EndedAt);

/// <summary>New times for a work session; a null end keeps a running session running.</summary>
public sealed record UpdateWorkSessionRequest
{
    [Required]
    public required DateTimeOffset StartedAt { get; init; }

    public DateTimeOffset? EndedAt { get; init; }
}
