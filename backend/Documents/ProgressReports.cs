using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;
using Model;

namespace Documents;

/// <summary>
/// Works out a progress report from what the author entered: the tasks completed over the period, what is being worked
/// on and what comes next, the hours worked, and the pace (cumulative tasks done and hours, per day or per week). Days
/// start at midnight in the project's billing time zone (UTC when none is set). A draft shows this as it is now; a
/// finalized report stores it.
/// </summary>
public sealed class ProgressReports(AppDbContext db)
{
    /// <summary>Longest period one report covers.</summary>
    public const int MaxDays = 366;
    private const int ListLimit = 50;

    public async Task<ProgressReportContent> Build(Project project, ProgressReportInput input, CancellationToken cancellationToken)
    {
        var zone = BillingReports.BillingZone(project);
        var start = BillingReports.MidnightIn(zone, input.From.ToDateTime(TimeOnly.MinValue));
        var end = BillingReports.MidnightIn(zone, input.To.AddDays(1).ToDateTime(TimeOnly.MinValue));
        var now = DateTimeOffset.UtcNow;

        var tasks = await db.ProjectTasks.AsNoTracking()
            .Where(task => task.ProjectId == project.Id)
            .Select(task => new TaskRow(
                task.Id, task.Title, task.Status, task.Priority, task.AssigneeUserId, task.DueAt, task.CompletedAt,
                task.Units, task.UnitsDone, task.Dependencies.Any(dependency => dependency.DependsOn.Status != "done")))
            .ToListAsync(cancellationToken);
        var names = await db.ProjectMembers.AsNoTracking()
            .Where(member => member.ProjectId == project.Id)
            .Select(member => new { member.UserId, Name = member.User.DisplayName != "" ? member.User.DisplayName : member.User.UserName ?? "" })
            .ToDictionaryAsync(member => member.UserId, member => member.Name, cancellationToken);
        string? Name(string? userId) => userId is null ? null : names.GetValueOrDefault(userId, "Former member");

        // Filtered and ordered in memory: SQLite cannot compare or order DateTimeOffset values in queries.
        var completed = tasks
            .Where(task => task.Status == "done" && task.CompletedAt is { } at && at >= start && at < end)
            .OrderBy(task => task.CompletedAt)
            .ToList();
        var inProgress = tasks
            .Where(task => task.Status == "doing")
            .OrderByDescending(task => Rank(task.Priority)).ThenBy(task => task.DueAt ?? DateTimeOffset.MaxValue)
            .ToList();
        // What comes next: open tasks that can be started, those due soonest and most important first.
        var nextUp = tasks
            .Where(task => task.Status == "todo" && !task.Blocked)
            .OrderBy(task => task.DueAt ?? DateTimeOffset.MaxValue).ThenByDescending(task => Rank(task.Priority))
            .Take(10)
            .ToList();

        var sessions = await db.WorkSessions.AsNoTracking()
            .Where(session => session.ProjectId == project.Id)
            .Select(session => new { session.UserId, session.StartedAt, session.EndedAt })
            .ToListAsync(cancellationToken);
        // The part of each session inside [from, to), counting running sessions up to now.
        double HoursWithin(DateTimeOffset from, DateTimeOffset to, string? userId = null) => sessions
            .Where(session => userId is null || session.UserId == userId)
            .Sum(session =>
            {
                var sessionStart = session.StartedAt > from ? session.StartedAt : from;
                var sessionEnd = session.EndedAt ?? now;
                var stop = sessionEnd < to ? sessionEnd : to;
                return stop > sessionStart ? (stop - sessionStart).TotalHours : 0;
            });

        var hoursByMember = sessions.Select(session => session.UserId).Distinct()
            .Select(userId => new MemberHours(Name(userId)!, Math.Round(HoursWithin(start, end, userId), 2)))
            .Where(member => member.Hours > 0)
            .OrderByDescending(member => member.Hours)
            .ToList();

        // The pace: cumulative per day, or per week for periods over two months.
        var days = input.To.DayNumber - input.From.DayNumber + 1;
        var step = days > 62 ? 7 : 1;
        var pace = new List<PacePoint>();
        for (var day = input.From; day <= input.To; day = day.AddDays(step))
        {
            var last = day.AddDays(step - 1) < input.To ? day.AddDays(step - 1) : input.To;
            var until = BillingReports.MidnightIn(zone, last.AddDays(1).ToDateTime(TimeOnly.MinValue));
            pace.Add(new PacePoint(day, completed.Count(task => task.CompletedAt < until), Math.Round(HoursWithin(start, until), 2)));
        }

        ReportTask ToReportTask(TaskRow task) => new(
            task.Id, task.Title, task.Priority, Name(task.AssigneeUserId), task.DueAt, task.CompletedAt, task.Units, task.UnitsDone);

        return new ProgressReportContent(
            input,
            completed.Count,
            Math.Round(HoursWithin(start, end), 2),
            tasks.Count(task => task.Status != "done"),
            tasks.Count(task => task.Status == "todo" && task.Blocked),
            completed.Take(ListLimit).Select(ToReportTask).ToList(),
            inProgress.Take(ListLimit).Select(ToReportTask).ToList(),
            nextUp.Select(ToReportTask).ToList(),
            input.ShowHours ? hoursByMember : [],
            pace,
            step == 7 ? "week" : "day",
            now);
    }

    private sealed record TaskRow(
        long Id, string Title, string Status, string Priority, string? AssigneeUserId, DateTimeOffset? DueAt,
        DateTimeOffset? CompletedAt, int? Units, int UnitsDone, bool Blocked);

    private static int Rank(string priority) => priority switch { "critical" => 2, "high" => 1, _ => 0 };
}

/// <summary>What the author of a progress report chooses and writes.</summary>
/// <param name="ShowHours">Show hours worked per person; the total is always shown.</param>
public sealed record ProgressReportInput
{
    public required DateOnly From { get; init; }
    public required DateOnly To { get; init; }

    [StringLength(5000)]
    public string Summary { get; init; } = string.Empty;

    [StringLength(5000)]
    public string NextSteps { get; init; } = string.Empty;

    public bool ShowHours { get; init; } = true;
}

/// <param name="Input">What the author wrote, kept with the report so a revision starts from it.</param>
/// <param name="OpenTasks">Tasks not done, as of when the report was made.</param>
/// <param name="Blocked">Open tasks waiting on others.</param>
/// <param name="Completed">Completed in the period, oldest first (at most 50).</param>
/// <param name="InProgress">Being worked on (at most 50).</param>
/// <param name="NextUp">Up to 10 tasks that can be started next, soonest due first.</param>
/// <param name="HoursByMember">Hours per person, if the author chose to show them.</param>
/// <param name="Pace">Cumulative tasks done and hours, one point per day or week.</param>
/// <param name="PaceStep">"day" or "week".</param>
/// <param name="MadeAt">When the figures were worked out.</param>
public sealed record ProgressReportContent(
    ProgressReportInput Input, int TasksCompleted, double Hours, int OpenTasks, int Blocked,
    IReadOnlyList<ReportTask> Completed, IReadOnlyList<ReportTask> InProgress, IReadOnlyList<ReportTask> NextUp,
    IReadOnlyList<MemberHours> HoursByMember, IReadOnlyList<PacePoint> Pace, string PaceStep, DateTimeOffset MadeAt);

public sealed record ReportTask(
    long Id, string Title, string Priority, string? Assignee, DateTimeOffset? DueAt, DateTimeOffset? CompletedAt,
    int? Units, int UnitsDone);

public sealed record MemberHours(string Name, double Hours);

/// <param name="Date">The first day of the point's day or week.</param>
public sealed record PacePoint(DateOnly Date, int TasksCompleted, double Hours);
