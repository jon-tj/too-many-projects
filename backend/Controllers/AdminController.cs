using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using Accounts;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Model;
using Plans;

/// <summary>
/// Everything in the database for the admin: every user and project, and overriding what the plans would otherwise
/// decide (freezing, exemptions, trials). Plan limits do not apply to anything done here.
/// </summary>
[ApiController]
[Authorize]
[TypeFilter<AdminOnlyFilter>]
[Route("api/admin")]
public sealed class AdminController(
    AppDbContext db, UserManager<ApplicationUser> users, UserRemoval userRemoval, PlanService plans,
    MembershipRemoval membershipRemoval) : ControllerBase
{
    [HttpGet("users")]
    public async Task<ActionResult<IReadOnlyList<AdminUserResponse>>> GetUsers(CancellationToken cancellationToken)
    {
        var all = await db.Users.AsNoTracking().ToListAsync(cancellationToken);
        // First, so plans that just ran out show as none.
        await plans.ApplyDueLapses(all, cancellationToken);

        var exempt = (await db.PlanExemptions.Select(exemption => exemption.UserId).ToListAsync(cancellationToken))
            .ToHashSet();
        var owned = await CountBy(db.Projects.Select(project => project.OwnerId), cancellationToken);
        var memberOf = await CountBy(db.ProjectMembers.Select(member => member.UserId), cancellationToken);
        var tasksCreated = await CountBy(db.ProjectTasks.Select(task => task.CreatedByUserId), cancellationToken);
        // Tasks keep no record of who finished them, so a done task counts for whoever it is assigned to.
        var tasksCompleted = await CountBy(
            db.ProjectTasks.Where(task => task.Status == "done" && task.AssigneeUserId != null)
                .Select(task => task.AssigneeUserId!),
            cancellationToken);

        return Ok(all
            .OrderBy(user => user.DisplayName, StringComparer.OrdinalIgnoreCase)
            .Select(user => new AdminUserResponse(
                user.Id, user.UserName ?? "", user.DisplayName, user.Email ?? "", user.AvatarImage, user.CreatedAt,
                user.LastSeenAt, user.IsAdmin, user.MustChangePassword, user.PlanType, user.PlanRenewDate, user.PreviousPlanType,
                user.StripeSubscriptionId is not null,
                exempt.Contains(user.Id), owned.GetValueOrDefault(user.Id), memberOf.GetValueOrDefault(user.Id),
                tasksCreated.GetValueOrDefault(user.Id), tasksCompleted.GetValueOrDefault(user.Id)))
            .ToList());
    }

    /// <summary>Weekly and monthly active users, and sign-ups and invites over the same periods.</summary>
    [HttpGet("stats")]
    public async Task<ActionResult<AdminStatsResponse>> GetStats(CancellationToken cancellationToken)
    {
        // Counted in memory: SQLite cannot compare DateTimeOffset values in queries.
        var all = await db.Users.AsNoTracking()
            .Select(user => new { user.CreatedAt, user.LastSeenAt, user.IsAdmin, SignedUp = user.PrimaryUseCase != "" })
            .ToListAsync(cancellationToken);
        // The sign-up form requires a use case; invited accounts (and the seeded admin) have none.
        var created = all.Where(user => !user.IsAdmin).ToList();
        var now = DateTimeOffset.UtcNow;
        var weekAgo = now.AddDays(-7);
        var monthAgo = now.AddDays(-30);
        return Ok(new AdminStatsResponse(
            all.Count(user => user.LastSeenAt >= weekAgo),
            all.Count(user => user.LastSeenAt >= monthAgo),
            created.Count(user => user.SignedUp && user.CreatedAt >= weekAgo),
            created.Count(user => user.SignedUp && user.CreatedAt >= monthAgo),
            created.Count(user => !user.SignedUp && user.CreatedAt >= weekAgo),
            created.Count(user => !user.SignedUp && user.CreatedAt >= monthAgo)));
    }

    [HttpGet("projects")]
    public async Task<ActionResult<IReadOnlyList<AdminProjectResponse>>> GetProjects(CancellationToken cancellationToken)
    {
        var adminId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var projects = await db.Projects.AsNoTracking()
            .OrderBy(project => project.Name)
            .Select(project => new
            {
                project.Id, project.Name, project.Description, project.Icon, project.IconImage, project.CreatedAt,
                project.OwnerId, project.Frozen,
                MemberCount = project.Members.Count,
                TaskCount = project.Tasks.Count,
                DoneCount = project.Tasks.Count(task => task.Status == "done"),
                AdminIsMember = project.Members.Any(member => member.UserId == adminId),
            })
            .ToListAsync(cancellationToken);
        // Freezes the projects of owners whose plan just ran out, so they show as frozen.
        var statuses = await plans.GetStatuses(projects.Select(project => project.Id).ToList(), cancellationToken);
        var ownerIds = projects.Select(project => project.OwnerId).Distinct().ToList();
        var owners = await db.Users.AsNoTracking()
            .Where(user => ownerIds.Contains(user.Id))
            .ToDictionaryAsync(user => user.Id, user => new { user.DisplayName, user.UserName, user.PlanType },
                cancellationToken);

        return Ok(projects.Select(project =>
        {
            var owner = owners.GetValueOrDefault(project.OwnerId);
            return new AdminProjectResponse(
                project.Id, project.Name, project.Description, project.Icon, project.IconImage, project.CreatedAt,
                project.OwnerId, owner?.DisplayName ?? "", owner?.UserName ?? "", owner?.PlanType ?? Plan.None,
                statuses.GetValueOrDefault(project.Id)?.Frozen ?? project.Frozen,
                project.MemberCount, project.TaskCount, project.DoneCount, project.AdminIsMember);
        }).ToList());
    }

    /// <summary>
    /// Freezes or unfreezes a project whatever its owner's plan allows. A project unfrozen here stays active until its
    /// owner's plan next changes or runs out.
    /// </summary>
    [HttpPut("projects/{id:long}/frozen")]
    public async Task<IActionResult> SetFrozen(long id, SetFrozenRequest request, CancellationToken cancellationToken)
    {
        var updated = await db.Projects.Where(project => project.Id == id)
            .ExecuteUpdateAsync(project => project.SetProperty(entry => entry.Frozen, request.Frozen), cancellationToken);
        return updated == 0 ? NotFound() : NoContent();
    }

    [HttpDelete("projects/{id:long}")]
    public async Task<IActionResult> DeleteProject(long id, CancellationToken cancellationToken)
    {
        var project = await db.Projects.SingleOrDefaultAsync(project => project.Id == id, cancellationToken);
        if (project is null) return NotFound();
        db.Projects.Remove(project);
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    /// <summary>Adds the admin to the project with the Owner role, beyond the plan's member limit if need be.</summary>
    [HttpPost("projects/{id:long}/join")]
    public async Task<IActionResult> JoinProject(long id, CancellationToken cancellationToken)
    {
        var adminId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        if (!await db.Projects.AnyAsync(project => project.Id == id, cancellationToken)) return NotFound();
        if (await db.ProjectMembers.AnyAsync(member => member.ProjectId == id && member.UserId == adminId, cancellationToken))
            return Conflict(new { error = "You are already a member of this project." });

        db.ProjectMembers.Add(new ProjectMember { ProjectId = id, UserId = adminId, Role = "Owner" });
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    /// <summary>
    /// Deletes a user as deleting their own account would: projects only they are in go with them, and projects they
    /// created that others are still in block it, so those are deleted first.
    /// </summary>
    [HttpDelete("users/{userId}")]
    public async Task<IActionResult> DeleteUser(string userId, CancellationToken cancellationToken)
    {
        if (userId == User.FindFirstValue(ClaimTypes.NameIdentifier))
            return BadRequest(new { error = "You cannot delete your own account here." });
        var user = await users.FindByIdAsync(userId);
        if (user is null) return NotFound();

        var sharedProjects = await userRemoval.SharedProjectsOwnedBy(user.Id, cancellationToken);
        if (sharedProjects.Count > 0)
            return Conflict(new
            {
                error = $"{user.DisplayName} created projects that other people are still in: " +
                    $"{string.Join(", ", sharedProjects)}. Delete those projects first."
            });

        var result = await userRemoval.DeleteAsync(user, cancellationToken);
        if (!result.Succeeded)
            return BadRequest(new { error = string.Join(" ", result.Errors.Select(error => error.Description)) });
        return NoContent();
    }

    /// <summary>Makes the user's plan never run out, or lets it run out again at its renew date.</summary>
    [HttpPut("users/{userId}/exempt")]
    public async Task<IActionResult> SetExempt(string userId, SetExemptRequest request, CancellationToken cancellationToken)
    {
        if (userId == User.FindFirstValue(ClaimTypes.NameIdentifier))
            return BadRequest(new { error = "Your own plan is always exempt." });
        if (!await db.Users.AnyAsync(user => user.Id == userId, cancellationToken)) return NotFound();

        var exemption = await db.PlanExemptions.FindAsync([userId], cancellationToken);
        if (request.Exempt && exemption is null)
            db.PlanExemptions.Add(new PlanExemption { UserId = userId, Note = "Exempted on the admin page" });
        else if (!request.Exempt && exemption is not null)
            db.PlanExemptions.Remove(exemption);
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    /// <summary>
    /// Starts a new 30-day trial. As when choosing a plan without a project limit, every project the user owns is
    /// unfrozen, and active projects keep at most the trial's member limit (the most recently added go).
    /// </summary>
    [HttpPost("users/{userId}/trial")]
    public async Task<IActionResult> StartTrial(string userId, CancellationToken cancellationToken)
    {
        var user = await users.FindByIdAsync(userId);
        if (user is null) return NotFound();

        var owned = await db.Projects.Where(project => project.OwnerId == user.Id).ToListAsync(cancellationToken);
        foreach (var project in owned) project.Frozen = false;
        if (Plan.MemberLimit(Plan.Trial) is { } memberLimit)
            await membershipRemoval.StageTrim(user.Id, owned.Select(project => project.Id).ToList(), memberLimit,
                cancellationToken);
        user.PlanType = Plan.Trial;
        user.PlanRenewDate = Plan.RenewDateFrom(Plan.Trial, DateTimeOffset.UtcNow);
        // The user and the projects are tracked by the same context, so this saves both.
        var result = await users.UpdateAsync(user);
        if (!result.Succeeded)
            return BadRequest(new { error = string.Join(" ", result.Errors.Select(error => error.Description)) });
        return NoContent();
    }

    /// <summary>Every review (not dismissals), newest first.</summary>
    [HttpGet("reviews")]
    public async Task<ActionResult<IReadOnlyList<AdminReviewResponse>>> GetReviews(CancellationToken cancellationToken)
    {
        var reviews = await db.Reviews.AsNoTracking()
            .Where(review => !review.Dismissed)
            .Select(review => new AdminReviewResponse(
                review.Id, review.UserId, review.User.DisplayName, review.User.UserName ?? "", review.User.AvatarImage,
                review.User.CreatedAt, review.Round, review.CreatedAt, review.Stars ?? 0, review.Body, review.MayPublish,
                review.ProjectName, review.Featured))
            .ToListAsync(cancellationToken);
        // Ordered in memory: SQLite cannot order by DateTimeOffset.
        return Ok(reviews.OrderByDescending(review => review.CreatedAt).ToList());
    }

    /// <summary>Shows the review on the landing page, or stops showing it. Only reviews the user allowed to be published.</summary>
    [HttpPut("reviews/{id:long}/featured")]
    public async Task<IActionResult> SetFeatured(long id, SetFeaturedRequest request, CancellationToken cancellationToken)
    {
        var review = await db.Reviews.SingleOrDefaultAsync(review => review.Id == id && !review.Dismissed, cancellationToken);
        if (review is null) return NotFound();
        if (request.Featured && !review.MayPublish)
            return BadRequest(new { error = "This user did not allow their review to be published." });
        review.Featured = request.Featured;
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    [HttpDelete("reviews/{id:long}")]
    public async Task<IActionResult> DeleteReview(long id, CancellationToken cancellationToken)
    {
        var deleted = await db.Reviews.Where(review => review.Id == id).ExecuteDeleteAsync(cancellationToken);
        return deleted == 0 ? NotFound() : NoContent();
    }

    /// <summary>Every feature request, newest first.</summary>
    [HttpGet("feature-requests")]
    public async Task<ActionResult<IReadOnlyList<AdminFeatureRequestResponse>>> GetFeatureRequests(
        CancellationToken cancellationToken)
    {
        var requests = await db.FeatureRequests.AsNoTracking()
            .Select(request => new AdminFeatureRequestResponse(
                request.Id, request.UserId, request.User.DisplayName, request.User.UserName ?? "",
                request.User.Email ?? "", request.User.AvatarImage, request.Title, request.Description,
                request.CreatedAt, request.Status))
            .ToListAsync(cancellationToken);
        // Ordered in memory: SQLite cannot order by DateTimeOffset.
        return Ok(requests.OrderByDescending(request => request.CreatedAt).ToList());
    }

    [HttpPut("feature-requests/{id:long}/status")]
    public async Task<IActionResult> SetFeatureRequestStatus(
        long id, SetFeatureRequestStatusRequest request, CancellationToken cancellationToken)
    {
        if (!FeatureRequest.Statuses.Contains(request.Status))
            return BadRequest(new { error = "The status must be new, planned, done or declined." });
        var updated = await db.FeatureRequests.Where(entry => entry.Id == id)
            .ExecuteUpdateAsync(entry => entry.SetProperty(field => field.Status, request.Status), cancellationToken);
        return updated == 0 ? NotFound() : NoContent();
    }

    [HttpDelete("feature-requests/{id:long}")]
    public async Task<IActionResult> DeleteFeatureRequest(long id, CancellationToken cancellationToken)
    {
        var deleted = await db.FeatureRequests.Where(request => request.Id == id).ExecuteDeleteAsync(cancellationToken);
        return deleted == 0 ? NotFound() : NoContent();
    }

    private static async Task<Dictionary<string, int>> CountBy(IQueryable<string> userIds, CancellationToken cancellationToken) =>
        await userIds.GroupBy(id => id)
            .Select(group => new { group.Key, Count = group.Count() })
            .ToDictionaryAsync(entry => entry.Key, entry => entry.Count, cancellationToken);
}

/// <summary>A user with their plan and how much they have done.</summary>
/// <param name="Pending">Invited but not signed in yet: still on the temporary password.</param>
/// <param name="Subscribed">A Stripe subscription pays for their plan.</param>
/// <param name="ProjectsCreated">Projects they own.</param>
/// <param name="ProjectsJoined">Projects they are a member of, their own included.</param>
/// <param name="TasksCompleted">Done tasks assigned to them.</param>
public sealed record AdminUserResponse(
    string Id, string UserName, string DisplayName, string Email, string? AvatarImage, DateTimeOffset CreatedAt,
    DateTimeOffset? LastSeenAt, bool IsAdmin, bool Pending, string PlanType, DateTimeOffset? PlanRenewDate, string? PreviousPlanType,
    bool Subscribed,
    bool PlanExempt, int ProjectsCreated, int ProjectsJoined, int TasksCreated, int TasksCompleted);

/// <summary>Usage over the last 7 and 30 days.</summary>
/// <param name="WeeklyActive">Users who opened the app in the last 7 days.</param>
/// <param name="MonthlyActive">Users who opened the app in the last 30 days.</param>
/// <param name="SignupsWeek">Accounts made through the sign-up form; invited accounts are counted apart.</param>
public sealed record AdminStatsResponse(
    int WeeklyActive, int MonthlyActive, int SignupsWeek, int SignupsMonth, int InvitedWeek, int InvitedMonth);

/// <summary>A project with its owner and size.</summary>
/// <param name="AdminIsMember">The caller (the admin) is a member, so can open it.</param>
public sealed record AdminProjectResponse(
    long Id, string Name, string Description, string? Icon, string? IconImage, DateTimeOffset CreatedAt,
    string OwnerId, string OwnerName, string OwnerUserName, string OwnerPlanType, bool Frozen,
    int MemberCount, int TaskCount, int DoneTaskCount, bool AdminIsMember);

/// <summary>A review with who wrote it.</summary>
/// <param name="Round">Days after creating their account that the user was asked (10, 40 or 150).</param>
/// <param name="MayPublish">The user allows it on the landing page, with their name.</param>
/// <param name="ProjectName">The project the user allows to be named with it; null for none.</param>
/// <param name="Featured">Shown on the landing page.</param>
public sealed record AdminReviewResponse(
    long Id, string UserId, string DisplayName, string UserName, string? AvatarImage, DateTimeOffset MemberSince,
    int Round, DateTimeOffset CreatedAt, int Stars, string Body, bool MayPublish, string? ProjectName, bool Featured);

/// <summary>A feature request with who sent it.</summary>
/// <param name="Status">new, planned, done or declined.</param>
public sealed record AdminFeatureRequestResponse(
    long Id, string UserId, string DisplayName, string UserName, string Email, string? AvatarImage, string Title,
    string Description, DateTimeOffset CreatedAt, string Status);

public sealed record SetFeatureRequestStatusRequest
{
    [Required]
    public required string Status { get; init; }
}

public sealed record SetFeaturedRequest
{
    [Required]
    public required bool Featured { get; init; }
}

public sealed record SetFrozenRequest
{
    [Required]
    public required bool Frozen { get; init; }
}

public sealed record SetExemptRequest
{
    [Required]
    public required bool Exempt { get; init; }
}
