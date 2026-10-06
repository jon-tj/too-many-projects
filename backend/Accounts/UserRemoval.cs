using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Model;

namespace Accounts;

/// <summary>Permanently deletes a user and cleans up what references them.</summary>
public sealed class UserRemoval(AppDbContext db, UserManager<ApplicationUser> users)
{
    /// <summary>Names of projects the user created that other people are still in; these block deletion.</summary>
    public Task<List<string>> SharedProjectsOwnedBy(string userId, CancellationToken cancellationToken) =>
        db.Projects
            .Where(project => project.OwnerId == userId && project.Members.Any(member => member.UserId != userId))
            .Select(project => project.Name)
            .ToListAsync(cancellationToken);

    /// <summary>
    /// Unassigns the user's tasks, deletes projects only they are in, then deletes the user.
    /// Memberships and canvas permissions are removed by the database cascade.
    /// Call <see cref="SharedProjectsOwnedBy"/> first: those projects would block the delete.
    /// </summary>
    public async Task<IdentityResult> DeleteAsync(ApplicationUser user, CancellationToken cancellationToken)
    {
        await db.ProjectTasks
            .Where(task => task.AssigneeUserId == user.Id)
            .ExecuteUpdateAsync(setters => setters.SetProperty(task => task.AssigneeUserId, (string?)null), cancellationToken);
        await db.Projects
            .Where(project => project.OwnerId == user.Id)
            .ExecuteDeleteAsync(cancellationToken);
        return await users.DeleteAsync(user);
    }
}
