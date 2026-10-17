using System.Globalization;
using System.Net;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Model;

namespace Email;

/// <summary>
/// Every Monday from 06:00 UTC, emails each user who wants it what happened last week (Monday to Sunday, UTC) in the
/// projects they are in: the team's hours and theirs, tasks done, and the average mood and resistance. Users without
/// activity get nothing. Each user is sent each week once; a week not sent by Tuesday 06:00 is skipped as stale.
/// </summary>
public sealed class WeeklySummaries(
    AppDbContext db, IEmailService email, IConfiguration configuration, IDataProtectionProvider protection,
    ILogger<WeeklySummaries> logger)
{
    /// <summary>Purpose of the unsubscribe token, which signs the user id so the link works without signing in.</summary>
    public const string UnsubscribePurpose = "WeeklySummaryUnsubscribe";

    public async Task SendDue(CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        var thisMonday = new DateTimeOffset(now.UtcDateTime.Date.AddDays(-(((int)now.DayOfWeek + 6) % 7)), TimeSpan.Zero);
        if (now < thisMonday.AddHours(6) || now >= thisMonday.AddHours(30)) return;
        var weekStart = thisMonday.AddDays(-7);
        var week = DateOnly.FromDateTime(weekStart.UtcDateTime).ToString("yyyy-MM-dd");

        var users = await db.Users
            .Where(user => user.WeeklySummary && !user.MustChangePassword && user.Email != null && user.Email != ""
                && (user.WeeklySummarySentFor == null || user.WeeklySummarySentFor != week))
            .ToListAsync(cancellationToken);
        if (users.Count == 0) return;

        // Filtered by time in memory: SQLite cannot compare DateTimeOffset values in queries.
        var sessions = (await db.WorkSessions.AsNoTracking()
                .Select(session => new { session.ProjectId, session.UserId, session.StartedAt, session.EndedAt, session.Mood, session.Resistance })
                .ToListAsync(cancellationToken))
            .Select(session =>
            {
                var from = session.StartedAt > weekStart ? session.StartedAt : weekStart;
                var end = session.EndedAt ?? now;
                var to = end < thisMonday ? end : thisMonday;
                return new { session.ProjectId, session.UserId, Hours = to > from ? (to - from).TotalHours : 0, session.Mood, session.Resistance };
            })
            .Where(session => session.Hours > 0)
            .ToList();
        var done = (await db.ProjectTasks.AsNoTracking()
                .Where(task => task.CompletedAt != null)
                .Select(task => new { task.ProjectId, CompletedAt = task.CompletedAt!.Value })
                .ToListAsync(cancellationToken))
            .Where(task => task.CompletedAt >= weekStart && task.CompletedAt < thisMonday)
            .ToList();
        var memberships = await db.ProjectMembers.AsNoTracking()
            .Select(member => new { member.UserId, member.ProjectId, member.Project.Name, member.Project.Frozen })
            .ToListAsync(cancellationToken);

        var baseUrl = configuration["App:BaseUrl"] ?? "https://toomanyprojects.fyi";
        var protector = protection.CreateProtector(UnsubscribePurpose);
        foreach (var user in users)
        {
            var projects = memberships
                .Where(member => member.UserId == user.Id && !member.Frozen)
                .Select(member =>
                {
                    var worked = sessions.Where(session => session.ProjectId == member.ProjectId).ToList();
                    var moods = worked.Where(session => session.Mood != null).Select(session => (double)session.Mood!).ToList();
                    var resistances = worked.Where(session => session.Resistance != null).Select(session => (double)session.Resistance!).ToList();
                    return new ProjectWeek(
                        member.ProjectId, member.Name, worked.Sum(session => session.Hours),
                        worked.Where(session => session.UserId == user.Id).Sum(session => session.Hours),
                        done.Count(task => task.ProjectId == member.ProjectId),
                        moods.Count > 0 ? moods.Average() : null, resistances.Count > 0 ? resistances.Average() : null);
                })
                // Under 0.01 h (36 s) is a stray click, not a week's work.
                .Where(project => project.TeamHours >= 0.01 || project.TasksDone > 0)
                .OrderByDescending(project => project.TeamHours)
                .ToList();
            if (projects.Count > 0)
            {
                var name = user.DisplayName != "" ? user.DisplayName : user.UserName ?? "";
                var unsubscribeUrl = $"{baseUrl}/api/email/unsubscribe/{protector.Protect(user.Id)}";
                try
                {
                    await email.SendAsync(Summary(user.Email!, name, weekStart, projects, baseUrl, unsubscribeUrl), cancellationToken);
                }
                catch (Exception exception) when (exception is not OperationCanceledException)
                {
                    // Tried again on the next run.
                    logger.LogWarning(exception, "Could not send the weekly summary to {User}.", user.Id);
                    continue;
                }
            }
            // Users without activity are marked too, so they are not looked at again this week.
            user.WeeklySummarySentFor = week;
            await db.SaveChangesAsync(cancellationToken);
        }
    }

    private sealed record ProjectWeek(
        long Id, string Name, double TeamHours, double YourHours, int TasksDone, double? Mood, double? Resistance);

    private static EmailMessage Summary(
        string to, string name, DateTimeOffset weekStart, List<ProjectWeek> projects, string baseUrl, string unsubscribeUrl)
    {
        // The emails are in English, so their dates are too, whatever the server's language.
        var range = string.Create(CultureInfo.InvariantCulture, $"{weekStart:MMM d}–{weekStart.AddDays(6):MMM d}");
        var rows = string.Concat(projects.Select(project => $"""
            <tr>
              <td style="padding:10px 12px;border-top:1px solid #e3e6df">
                <a href="{Encode($"{baseUrl}/projects/{project.Id}/overview")}" style="color:#334931;font-weight:600">{Encode(project.Name)}</a>
              </td>
              <td style="padding:10px 12px;border-top:1px solid #e3e6df;text-align:right">{Hours(project.TeamHours)}<br><small style="color:#5f6b63">you {Hours(project.YourHours)}</small></td>
              <td style="padding:10px 12px;border-top:1px solid #e3e6df;text-align:right">{project.TasksDone}</td>
              <td style="padding:10px 12px;border-top:1px solid #e3e6df;text-align:right">{Score(project.Mood)}</td>
              <td style="padding:10px 12px;border-top:1px solid #e3e6df;text-align:right">{Score(project.Resistance)}</td>
            </tr>
            """));
        return new(to, $"Your week in TooManyProjects, {range}", $"""
            <p>Hi {Encode(name)},</p>
            <p>Here is how last week ({range}) went in your projects.</p>
            <table style="border-collapse:collapse;font-size:14px">
              <tr style="color:#5f6b63;font-size:12px;text-align:right">
                <th style="padding:6px 12px;text-align:left">Project</th><th style="padding:6px 12px">Team hours</th>
                <th style="padding:6px 12px">Tasks done</th><th style="padding:6px 12px">Mood</th><th style="padding:6px 12px">Resistance</th>
              </tr>
              {rows}
            </table>
            <p style="color:#5f6b63;font-size:12px">Mood and resistance are the team's averages out of 10, from the sessions where they were given.</p>
            <p style="color:#5f6b63;font-size:12px">You get this every Monday. <a href="{Encode(unsubscribeUrl)}">Unsubscribe</a> with one click, or turn it off in Settings.</p>
            """);
    }

    private static string Hours(double hours) =>
        hours < 1 ? FormattableString.Invariant($"{Math.Round(hours * 60)} min") : FormattableString.Invariant($"{Math.Round(hours, 1)} h");

    private static string Score(double? value) =>
        value is { } score ? FormattableString.Invariant($"{Math.Round(score, 1)} / 10") : "–";

    private static string Encode(string value) => WebUtility.HtmlEncode(value);
}
