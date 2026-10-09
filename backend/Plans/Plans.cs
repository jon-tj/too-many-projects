using Microsoft.EntityFrameworkCore;
using Model;

namespace Plans;

/// <summary>
/// The plans and what they allow. A project's features follow its owner's plan. Every plan but free runs until its
/// renew date; then the user moves to <see cref="None"/>, with no project slots, so everything they own is frozen until
/// they choose a plan. Payments are not wired up yet (Stripe later): choosing a paid plan sets the renew date a month ahead.
/// </summary>
public static class Plan
{
    /// <summary>Set at registration: full features and no project limit for 30 days. Cannot be chosen.</summary>
    public const string Trial = "trial";
    /// <summary>Boards and tasks only, at most two active projects.</summary>
    public const string Free = "free";
    /// <summary>$3.99 a month: everything, at most three active projects.</summary>
    public const string Plus = "plus";
    /// <summary>$8.99 a month: everything, any number of projects.</summary>
    public const string Pro = "pro";
    /// <summary>What a plan becomes when it runs out: no project slots, so everything is frozen. Cannot be chosen.</summary>
    public const string None = "none";

    /// <summary>The plans a user can switch to.</summary>
    public static readonly string[] Choosable = [Free, Plus, Pro];

    /// <summary>How many projects may be active at once; null means no limit.</summary>
    public static int? ProjectLimit(string plan) => plan switch
    {
        None => 0,
        Free => 2,
        Plus => 3,
        _ => null,
    };

    /// <summary>
    /// How many members (the owner and pending invites included) a project may have; null means no limit. Free is just
    /// the owner. The trial matches Plus, since members cannot sensibly be removed afterwards.
    /// </summary>
    public static int? MemberLimit(string plan) => plan switch
    {
        Free => 1,
        Trial or Plus => 8,
        _ => null,
    };

    /// <summary>Whether projects get everything beyond boards and tasks (roadmap, canvas, time tracking, billing, members).</summary>
    public static bool HasFullFeatures(string plan) => plan is not (Free or None);

    /// <summary>How long a newly chosen paid plan runs before it needs renewing.</summary>
    public static DateTimeOffset RenewDateFrom(string plan, DateTimeOffset now) => plan switch
    {
        Trial => now.AddDays(30),
        _ => now.AddMonths(1),
    };

    /// <summary>
    /// The plan has reached its renew date (or never had one) and should move to <see cref="None"/>. Free never runs
    /// out; exempt users are left out by <see cref="PlanService"/>.
    /// </summary>
    public static bool IsDue(ApplicationUser user, DateTimeOffset now) =>
        user.PlanType is not (Free or None) && (user.PlanRenewDate is not { } renew || renew <= now);
}

/// <summary>
/// What a project allows right now: frozen projects allow nothing; free-plan projects allow only tasks. MemberLimit is
/// null when the plan allows any number of members.
/// </summary>
public sealed record ProjectPlanStatus(bool Frozen, bool FullFeatures, int? MemberLimit);

/// <summary>
/// Reads plans and project status. Every read first moves owners whose plan has run out to <see cref="Plan.None"/> and
/// freezes their projects, so a plan stops the moment its renew date passes without a scheduled job.
/// </summary>
public sealed class PlanService(AppDbContext db)
{
    /// <summary>Whether the user's plan never runs out (see <see cref="PlanExemption"/>).</summary>
    public Task<bool> IsExempt(string userId, CancellationToken cancellationToken) =>
        db.PlanExemptions.AnyAsync(exemption => exemption.UserId == userId, cancellationToken);

    /// <summary>Whether the user has no plan, after moving them there if their plan just ran out.</summary>
    public async Task<bool> IsLapsed(ApplicationUser user, CancellationToken cancellationToken)
    {
        await ApplyDueLapses([user], cancellationToken);
        return user.PlanType == Plan.None;
    }

    public async Task<ProjectPlanStatus?> GetStatus(long projectId, CancellationToken cancellationToken) =>
        (await GetStatuses([projectId], cancellationToken)).GetValueOrDefault(projectId);

    /// <summary>Status per project id; projects that do not exist are left out.</summary>
    public async Task<Dictionary<long, ProjectPlanStatus>> GetStatuses(
        IReadOnlyCollection<long> projectIds, CancellationToken cancellationToken)
    {
        var projects = await db.Projects.AsNoTracking()
            .Where(project => projectIds.Contains(project.Id))
            .Select(project => new { project.Id, project.Frozen, project.OwnerId })
            .ToListAsync(cancellationToken);
        var ownerIds = projects.Select(project => project.OwnerId).Distinct().ToList();
        var owners = await db.Users.AsNoTracking()
            .Where(user => ownerIds.Contains(user.Id))
            .ToDictionaryAsync(user => user.Id, cancellationToken);
        // The projects were read before their owner's plan may have run out just now, which froze them.
        var justLapsed = await ApplyDueLapses(owners.Values, cancellationToken);

        return projects.ToDictionary(project => project.Id, project =>
        {
            var owner = owners.GetValueOrDefault(project.OwnerId);
            return new ProjectPlanStatus(
                project.Frozen || justLapsed.Contains(project.OwnerId),
                owner is null || Plan.HasFullFeatures(owner.PlanType),
                owner is null ? null : Plan.MemberLimit(owner.PlanType));
        });
    }

    /// <summary>
    /// Moves users whose plan has run out (and who are not exempt) to <see cref="Plan.None"/>, remembering the plan they
    /// had, and freezes everything they own, in the database and on the given user objects. Returns their ids. Dates are compared in memory, since
    /// SQLite cannot compare DateTimeOffset values in queries.
    /// </summary>
    private async Task<HashSet<string>> ApplyDueLapses(IEnumerable<ApplicationUser> users, CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        var due = users.Where(user => Plan.IsDue(user, now)).ToList();
        if (due.Count == 0) return [];
        var dueIds = due.Select(user => user.Id).ToList();
        var exempt = await db.PlanExemptions
            .Where(exemption => dueIds.Contains(exemption.UserId))
            .Select(exemption => exemption.UserId)
            .ToListAsync(cancellationToken);
        due.RemoveAll(user => exempt.Contains(user.Id));
        if (due.Count == 0) return [];

        var ids = due.Select(user => user.Id).ToList();
        await db.Users.Where(user => ids.Contains(user.Id)).ExecuteUpdateAsync(user => user
            .SetProperty(entry => entry.PreviousPlanType, entry => entry.PlanType)
            .SetProperty(entry => entry.PlanType, Plan.None)
            .SetProperty(entry => entry.PlanRenewDate, (DateTimeOffset?)null), cancellationToken);
        await db.Projects.Where(project => ids.Contains(project.OwnerId))
            .ExecuteUpdateAsync(project => project.SetProperty(entry => entry.Frozen, true), cancellationToken);
        foreach (var user in due)
        {
            user.PreviousPlanType = user.PlanType;
            user.PlanType = Plan.None;
            user.PlanRenewDate = null;
        }
        return ids.ToHashSet();
    }
}
