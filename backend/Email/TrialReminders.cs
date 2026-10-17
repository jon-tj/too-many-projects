using Microsoft.EntityFrameworkCore;
using Plans;

namespace Email;

/// <summary>
/// Emails users whose trial ends within 7 days, and again within a day. Each reminder is sent once per trial end date,
/// so a trial that is extended (a review bonus) or restarted (a new trial from the admin page) is reminded about again.
/// Exempt users never run out, so they are left alone.
/// </summary>
public sealed class TrialReminders(
    AppDbContext db, PlanService plans, IEmailService email, IConfiguration configuration, ILogger<TrialReminders> logger)
{
    public async Task SendDue(CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        // Filtered by date in memory: SQLite cannot compare DateTimeOffset values in queries.
        var trials = (await db.Users
                .Where(user => user.PlanType == Plan.Trial && user.PlanRenewDate != null && user.Email != null && user.Email != "")
                .ToListAsync(cancellationToken))
            .Where(user => user.PlanRenewDate > now && user.PlanRenewDate - now <= TimeSpan.FromDays(7))
            .ToList();
        var plansUrl = $"{configuration["App:BaseUrl"] ?? "https://toomanyprojects.fyi"}/plans";

        foreach (var user in trials)
        {
            var endsAt = user.PlanRenewDate!.Value;
            var lastDay = endsAt - now <= TimeSpan.FromDays(1);
            // The day-before reminder replaces the week one if both are due, e.g. for a trial restarted with a day left.
            if (lastDay ? user.TrialDayReminderFor == endsAt : user.TrialWeekReminderFor == endsAt) continue;
            if (await plans.IsExempt(user.Id, cancellationToken)) continue;

            var owned = await db.Projects.CountAsync(project => project.OwnerId == user.Id, cancellationToken);
            var name = user.DisplayName != "" ? user.DisplayName : user.UserName ?? "";
            try
            {
                await email.SendAsync(TrialEmails.Ending(
                    user.Email!, name, lastDay ? "tomorrow" : $"in {Math.Ceiling((endsAt - now).TotalDays)} days", endsAt,
                    owned, Plan.ProjectLimit(Plan.Free) ?? 0,
                    plansUrl), cancellationToken);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                // Tried again on the next run.
                logger.LogWarning(exception, "Could not send the trial reminder to {User}.", user.Id);
                continue;
            }
            user.TrialWeekReminderFor = endsAt;
            if (lastDay) user.TrialDayReminderFor = endsAt;
            await db.SaveChangesAsync(cancellationToken);
        }
    }
}
