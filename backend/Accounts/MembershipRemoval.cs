using Microsoft.EntityFrameworkCore;
using Model;

namespace Accounts;

/// <summary>Takes people out of projects: by hand from the members page, or when a plan allows fewer members.</summary>
public sealed class MembershipRemoval(AppDbContext db)
{
    /// <summary>
    /// Stages removing one membership: the member's unfinished tasks in the project are unassigned and their canvas
    /// overrides dropped. The caller saves.
    /// </summary>
    public async Task Stage(ProjectMember member, CancellationToken cancellationToken)
    {
        var unfinishedTasks = await db.ProjectTasks
            .Where(task => task.ProjectId == member.ProjectId && task.AssigneeUserId == member.UserId
                && (task.Status == "todo" || task.Status == "doing"))
            .ToListAsync(cancellationToken);
        foreach (var task in unfinishedTasks)
            task.AssigneeUserId = null;

        db.CanvasPermissions.RemoveRange(await db.CanvasPermissions
            .Where(permission => permission.Canvas.ProjectId == member.ProjectId && permission.UserId == member.UserId)
            .ToListAsync(cancellationToken));
        db.ProjectMembers.Remove(member);
    }

    /// <summary>
    /// Stages trimming the given projects of one owner to at most <paramref name="limit"/> members each: the owner always
    /// stays, then the earliest added; the most recently added go. Only for active projects: frozen ones keep their
    /// members until they are unfrozen. The caller saves. Returns how many were removed.
    /// </summary>
    public async Task<int> StageTrim(
        string ownerId, IReadOnlyCollection<long> projectIds, int limit, CancellationToken cancellationToken)
    {
        var members = await db.ProjectMembers
            .Where(member => projectIds.Contains(member.ProjectId))
            .ToListAsync(cancellationToken);

        var removed = 0;
        // Ordered in memory: SQLite cannot order by DateTimeOffset.
        foreach (var project in members.GroupBy(member => member.ProjectId))
        {
            var beyondLimit = project
                .OrderBy(member => member.UserId == ownerId ? 0 : 1)
                .ThenBy(member => member.AddedAt)
                .ThenBy(member => member.UserId, StringComparer.Ordinal)
                .Skip(limit);
            foreach (var member in beyondLimit)
            {
                await Stage(member, cancellationToken);
                removed++;
            }
        }
        return removed;
    }
}
