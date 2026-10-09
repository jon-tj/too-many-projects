using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

/// <summary>Real usage numbers for the landing page. Worked out at most every ten minutes, since anyone can ask.</summary>
[ApiController]
[AllowAnonymous]
[Route("api/public/stats")]
public sealed class PublicStatsController(AppDbContext db) : ControllerBase
{
    private static readonly TimeSpan CacheFor = TimeSpan.FromMinutes(10);
    private static (DateTimeOffset At, PublicStatsResponse Stats)? cached;

    [HttpGet]
    public async Task<ActionResult<PublicStatsResponse>> Get(CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        if (cached is { } hit && now - hit.At < CacheFor) return Ok(hit.Stats);

        // Filtered by time in memory: SQLite cannot compare DateTimeOffset values in queries.
        var sessions = await db.WorkSessions.AsNoTracking()
            .Select(session => new { session.UserId, session.StartedAt, session.EndedAt })
            .ToListAsync(cancellationToken);
        var tasks = await db.ProjectTasks.AsNoTracking()
            .Select(task => new { task.CreatedByUserId, task.CreatedAt, Done = task.Status == "done" })
            .ToListAsync(cancellationToken);

        // Active this week: tracked time or created a task in the last seven days.
        var weekAgo = now.AddDays(-7);
        var weeklyActiveUsers = sessions
            .Where(session => (session.EndedAt ?? now) >= weekAgo)
            .Select(session => session.UserId)
            .Concat(tasks.Where(task => task.CreatedAt >= weekAgo).Select(task => task.CreatedByUserId))
            .Distinct()
            .Count();
        var hoursTracked = sessions.Sum(session => ((session.EndedAt ?? now) - session.StartedAt).TotalHours);

        var stats = new PublicStatsResponse(weeklyActiveUsers, tasks.Count(task => task.Done), (int)Math.Round(hoursTracked));
        cached = (now, stats);
        return Ok(stats);
    }
}

/// <summary>Usage numbers shown on the landing page.</summary>
public sealed record PublicStatsResponse(int WeeklyActiveUsers, int TasksCompleted, int HoursTracked);
