using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Plans;

/// <summary>
/// Work sessions: the caller's own for the work log, and everyone's in a project for its hours table. Only the caller's
/// own sessions can be corrected or deleted.
/// </summary>
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
                session.Id, session.ProjectId, session.Project.Name, session.StartedAt, session.EndedAt,
                session.Mood, session.Resistance, session.Message))
            .ToListAsync(cancellationToken);

        return Ok(sessions
            .Where(session => session.EndedAt is not { } ended || ended >= from)
            .OrderBy(session => session.StartedAt)
            .ToList());
    }

    /// <summary>
    /// Everyone's sessions in the project that were still running at or after <paramref name="from"/>, for members of
    /// the project. Newest first.
    /// </summary>
    [RequiresProject(ProjectFeature.Full)]
    [HttpGet("by-project/{projectId:long}")]
    public async Task<ActionResult<IReadOnlyList<ProjectWorkSessionResponse>>> GetProject(
        long projectId, [FromQuery] DateTimeOffset from, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        if (!await db.ProjectMembers.AnyAsync(member => member.ProjectId == projectId && member.UserId == userId, cancellationToken))
            return NotFound();

        var sessions = await db.WorkSessions.AsNoTracking()
            .Where(session => session.ProjectId == projectId)
            .Select(session => new ProjectWorkSessionResponse(
                session.Id, session.UserId, session.User.DisplayName, session.User.AvatarImage, session.StartedAt,
                session.EndedAt, session.Mood, session.Resistance, session.Message, session.UserId == userId))
            .ToListAsync(cancellationToken);
        // Filtered and ordered in memory: SQLite cannot compare or order DateTimeOffset values in queries.
        return Ok(sessions
            .Where(session => session.EndedAt is not { } ended || ended >= from)
            .OrderByDescending(session => session.StartedAt)
            .ToList());
    }

    /// <summary>
    /// Corrects one of the caller's sessions: its start and end, and how it went. A finished session must keep an end; a
    /// running one may be given one, which stops it. Sessions may lie in the future (planned or pre-filled work), but
    /// cannot overlap the caller's other sessions in the same project (sessions in different projects may).
    /// </summary>
    [RequiresProject(ProjectFeature.Full, ProjectKey.WorkSessionId)]
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

        if (request.EndedAt is null && session.EndedAt is not null)
            return BadRequest(new { error = "A finished session needs an end time." });
        if (await CheckTimes(userId, session.ProjectId, id, request.StartedAt, request.EndedAt, cancellationToken) is { } error)
            return BadRequest(new { error });

        session.StartedAt = request.StartedAt;
        session.EndedAt = request.EndedAt;
        session.Mood = request.Mood;
        session.Resistance = request.Resistance;
        session.Message = string.IsNullOrWhiteSpace(request.Message) ? null : request.Message.Trim();
        await db.SaveChangesAsync(cancellationToken);
        return Ok(new WorkSessionResponse(
            session.Id, session.ProjectId, session.Project.Name, session.StartedAt, session.EndedAt,
            session.Mood, session.Resistance, session.Message));
    }

    /// <summary>
    /// Logs a session for the caller that was not tracked live: work done away from the app, or planned ahead. The same
    /// rules apply as for correcting one: the end after the start, and no overlap with the caller's other sessions in
    /// the project.
    /// </summary>
    [RequiresProject(ProjectFeature.Full)]
    [HttpPost("by-project/{projectId:long}")]
    public async Task<ActionResult<ProjectWorkSessionResponse>> Create(
        long projectId, CreateWorkSessionRequest request, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var user = await db.ProjectMembers
            .Where(member => member.ProjectId == projectId && member.UserId == userId)
            .Select(member => new { member.User.DisplayName, member.User.AvatarImage })
            .SingleOrDefaultAsync(cancellationToken);
        if (user is null) return NotFound();
        if (await CheckTimes(userId, projectId, null, request.StartedAt, request.EndedAt, cancellationToken) is { } error)
            return BadRequest(new { error });

        var session = new Model.WorkSession
        {
            ProjectId = projectId,
            UserId = userId,
            StartedAt = request.StartedAt,
            EndedAt = request.EndedAt,
            Mood = request.Mood,
            Resistance = request.Resistance,
            Message = string.IsNullOrWhiteSpace(request.Message) ? null : request.Message.Trim(),
        };
        db.WorkSessions.Add(session);
        await db.SaveChangesAsync(cancellationToken);
        return Ok(new ProjectWorkSessionResponse(
            session.Id, userId, user.DisplayName, user.AvatarImage, session.StartedAt, session.EndedAt,
            session.Mood, session.Resistance, session.Message, true));
    }

    /// <summary>
    /// Creates many finished sessions at once from a time tracker's CSV export (Toggl, Clockify, Harvest) read in the
    /// browser. Each row's person is matched to a project member by email, username, name or first name; rows without a
    /// person are the caller's. Project owners may import anyone's hours, other members only their own. Rows that match
    /// nobody, or overlap a session the person already has in the project (or an earlier row), are skipped and counted,
    /// so importing the same file twice adds nothing.
    /// </summary>
    [RequiresProject(ProjectFeature.Full)]
    [HttpPost("by-project/{projectId:long}/import")]
    public async Task<ActionResult<ImportSessionsResponse>> Import(
        long projectId, ImportSessionsRequest request, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var members = await db.ProjectMembers.AsNoTracking()
            .Where(member => member.ProjectId == projectId)
            .Select(member => new { member.UserId, member.Role, member.User.Email, member.User.UserName, member.User.DisplayName })
            .ToListAsync(cancellationToken);
        var caller = members.FirstOrDefault(member => member.UserId == userId);
        if (caller is null) return NotFound();
        if (request.Sessions.Count is 0 or > 5000)
            return BadRequest(new { error = "Import between 1 and 5000 time entries at a time." });

        string? Match(string? who)
        {
            if (string.IsNullOrWhiteSpace(who)) return userId;
            who = who.Trim();
            bool Same(string? value) => string.Equals(value?.Trim(), who, StringComparison.OrdinalIgnoreCase);
            var match = members.FirstOrDefault(member => Same(member.Email))
                ?? members.FirstOrDefault(member => Same(member.UserName))
                ?? members.FirstOrDefault(member => Same(member.DisplayName));
            if (match is not null) return match.UserId;
            // Harvest exports first and last names apart; a first name alone counts if only one member has it.
            var byFirstName = members.Where(member => Same(member.DisplayName.Split(' ')[0])).ToList();
            return byFirstName.Count == 1 ? byFirstName[0].UserId : null;
        }

        // Compared in memory: SQLite cannot compare DateTimeOffset values in queries.
        var taken = (await db.WorkSessions.AsNoTracking()
                .Where(session => session.ProjectId == projectId)
                .Select(session => new { session.UserId, session.StartedAt, session.EndedAt })
                .ToListAsync(cancellationToken))
            .Select(session => (session.UserId, Start: session.StartedAt, End: session.EndedAt ?? DateTimeOffset.MaxValue))
            .ToList();
        int imported = 0, unmatched = 0, overlapping = 0;
        foreach (var row in request.Sessions)
        {
            if (row.EndedAt <= row.StartedAt) return BadRequest(new { error = "Every time entry must end after it starts." });
            var person = Match(row.Person);
            if (person is null)
            {
                unmatched++;
                continue;
            }
            if (person != userId && caller.Role != "Owner")
                return StatusCode(StatusCodes.Status403Forbidden,
                    new { error = "Only project owners can import other people's hours. Import only your own rows, or ask an owner." });
            if (taken.Any(other => other.UserId == person && other.Start < row.EndedAt && other.End > row.StartedAt))
            {
                overlapping++;
                continue;
            }
            taken.Add((person, row.StartedAt, row.EndedAt));
            db.WorkSessions.Add(new Model.WorkSession
            {
                ProjectId = projectId,
                UserId = person,
                StartedAt = row.StartedAt,
                EndedAt = row.EndedAt,
                Message = string.IsNullOrWhiteSpace(row.Message) ? null : row.Message.Trim()[..Math.Min(row.Message.Trim().Length, 1000)],
            });
            imported++;
        }
        await db.SaveChangesAsync(cancellationToken);
        return Ok(new ImportSessionsResponse(imported, unmatched, overlapping));
    }

    /// <summary>Deletes one of the caller's sessions, running or finished; its hours no longer count anywhere.</summary>
    [RequiresProject(ProjectFeature.Full, ProjectKey.WorkSessionId)]
    [HttpDelete("{id:long}")]
    public async Task<IActionResult> Delete(long id, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var deleted = await db.WorkSessions
            .Where(session => session.Id == id && session.UserId == userId
                && session.Project.Members.Any(member => member.UserId == userId))
            .ExecuteDeleteAsync(cancellationToken);
        return deleted == 0 ? NotFound() : NoContent();
    }

    /// <summary>
    /// Why the times are not allowed, or null when they are: the end must come after the start, and they cannot overlap the user's other sessions in the project (other than <paramref name="exceptId"/>),
    /// which would count the same hours twice. Sessions in different projects may overlap.
    /// </summary>
    private async Task<string?> CheckTimes(
        string userId, long projectId, long? exceptId, DateTimeOffset start, DateTimeOffset? end,
        CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        if (end is { } finish && finish <= start) return "The end must be after the start.";

        // Compared in memory: SQLite cannot compare DateTimeOffset values in queries.
        var others = await db.WorkSessions.AsNoTracking()
            .Where(other => other.UserId == userId && other.ProjectId == projectId && other.Id != exceptId)
            .Select(other => new { other.StartedAt, other.EndedAt })
            .ToListAsync(cancellationToken);
        var until = end ?? now;
        return others.Any(other => other.StartedAt < until && (other.EndedAt ?? now) > start)
            ? "That overlaps another session of yours in this project."
            : null;
    }
}

/// <summary>A stretch of work; EndedAt is null while it is still running. Mood, resistance and message are optional.</summary>
public sealed record WorkSessionResponse(
    long Id, long ProjectId, string ProjectName, DateTimeOffset StartedAt, DateTimeOffset? EndedAt,
    int? Mood, int? Resistance, string? Message);

/// <summary>A stretch of work in a project, with who did it.</summary>
/// <param name="Mine">The caller's own, so they can correct or delete it.</param>
public sealed record ProjectWorkSessionResponse(
    long Id, string UserId, string DisplayName, string? AvatarImage, DateTimeOffset StartedAt, DateTimeOffset? EndedAt,
    int? Mood, int? Resistance, string? Message, bool Mine);

/// <summary>Time entries read from a CSV file and mapped in the browser.</summary>
public sealed record ImportSessionsRequest(IReadOnlyList<ImportedSession> Sessions);

/// <param name="Person">An email, username or name to match to a project member; null for the caller.</param>
public sealed record ImportedSession(string? Person, DateTimeOffset StartedAt, DateTimeOffset EndedAt, string? Message);

/// <param name="Unmatched">Rows whose person is not in the project.</param>
/// <param name="Overlapping">Rows overlapping a session the person already had (e.g. imported before).</param>
public sealed record ImportSessionsResponse(int Imported, int Unmatched, int Overlapping);

/// <summary>A finished session to log after the fact; mood, resistance and message are optional.</summary>
public sealed record CreateWorkSessionRequest
{
    [Required]
    public required DateTimeOffset StartedAt { get; init; }

    [Required]
    public required DateTimeOffset EndedAt { get; init; }

    [Range(0, 10)]
    public int? Mood { get; init; }

    [Range(0, 10)]
    public int? Resistance { get; init; }

    [StringLength(1000)]
    public string? Message { get; init; }
}

/// <summary>
/// The session as it should be: a null end keeps a running session running, and null mood, resistance or message
/// clear them. Send the current values of anything that should stay.
/// </summary>
public sealed record UpdateWorkSessionRequest
{
    [Required]
    public required DateTimeOffset StartedAt { get; init; }

    public DateTimeOffset? EndedAt { get; init; }

    [Range(0, 10)]
    public int? Mood { get; init; }

    [Range(0, 10)]
    public int? Resistance { get; init; }

    [StringLength(1000)]
    public string? Message { get; init; }
}
