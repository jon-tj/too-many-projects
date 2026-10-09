using System.Collections.Concurrent;
using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Security.Cryptography;
using Accounts;
using Email;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Plans;
using Model;

[ApiController]
[Authorize]
[Route("api/projects")]
public sealed class ProjectsController(
    AppDbContext db,
    UserManager<ApplicationUser> userManager,
    IEmailService emailService,
    UserRemoval userRemoval,
    PlanService plans,
    MembershipRemoval membershipRemoval,
    ILogger<ProjectsController> logger) : ControllerBase
{
    private static readonly string[] MemberRoles = ["Owner", "Developer", "External"];
    /// <summary>When each member last asked for an upgrade, per project, so owners get at most one email a day from each.</summary>
    private static readonly ConcurrentDictionary<(long ProjectId, string UserId), DateTimeOffset> UpgradeRequests = new();

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<ProjectResponse>>> GetAll(CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var projects = await db.Projects.AsNoTracking()
            .Where(project => project.Members.Any(member => member.UserId == userId))
            .OrderByDescending(project => project.Id)
            .Select(project => new ProjectResponse(
                project.Id, project.Name, project.Description, project.CreatedAt,
                project.Tasks.Count(task => task.Status != "done"), project.Members.Count, project.Icon, project.IconImage,
                project.Members.Where(member => member.UserId == userId).Select(member => member.Role).First(),
                project.BillingEnabled, project.GitHubUrl, project.WebsiteUrl, project.Frozen, true,
                project.OwnerId == userId,
                db.Users.Where(user => user.Id == project.OwnerId)
                    .Select(user => user.DisplayName != "" ? user.DisplayName : user.UserName ?? "")
                    .FirstOrDefault() ?? "", false, null))
            .ToListAsync(cancellationToken);

        return Ok(await WithPlanStatus(projects, cancellationToken));
    }

    [HttpGet("{id:long}")]
    public async Task<ActionResult<ProjectResponse>> GetById(long id, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var project = await db.Projects.AsNoTracking()
            .Where(project => project.Id == id && project.Members.Any(member => member.UserId == userId))
            .Select(project => new ProjectResponse(
                project.Id, project.Name, project.Description, project.CreatedAt,
                project.Tasks.Count(task => task.Status != "done"), project.Members.Count, project.Icon, project.IconImage,
                project.Members.Where(member => member.UserId == userId).Select(member => member.Role).First(),
                project.BillingEnabled, project.GitHubUrl, project.WebsiteUrl, project.Frozen, true,
                project.OwnerId == userId,
                db.Users.Where(user => user.Id == project.OwnerId)
                    .Select(user => user.DisplayName != "" ? user.DisplayName : user.UserName ?? "")
                    .FirstOrDefault() ?? "", false, null))
            .SingleOrDefaultAsync(cancellationToken);

        return project is null ? NotFound() : Ok((await WithPlanStatus([project], cancellationToken))[0]);
    }

    [RequiresProject(ProjectFeature.Tasks, ProjectKey.Id)]
    [HttpGet("{id:long}/members")]
    public async Task<ActionResult<IReadOnlyList<ProjectMemberResponse>>> GetMembers(long id, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var isMember = await db.ProjectMembers.AnyAsync(
            member => member.ProjectId == id && member.UserId == userId,
            cancellationToken);
        if (!isMember) return NotFound();

        var ownerId = await db.Projects.Where(project => project.Id == id)
            .Select(project => project.OwnerId).SingleAsync(cancellationToken);
        var members = await db.ProjectMembers.AsNoTracking()
            .Where(member => member.ProjectId == id)
            .Select(member => new ProjectMemberResponse(
                member.UserId,
                member.User.UserName ?? string.Empty,
                member.User.DisplayName,
                member.Role,
                member.User.MustChangePassword,
                member.BillableFraction,
                member.AddedAt))
            .ToListAsync(cancellationToken);

        // In the order they joined, the owner first; sorted in memory since SQLite cannot order by DateTimeOffset.
        return Ok(members
            .OrderBy(member => member.UserId == ownerId ? 0 : 1)
            .ThenBy(member => member.AddedAt)
            .ToList());
    }

    [RequiresProject(ProjectFeature.Full, ProjectKey.Id)]
    [HttpGet("{id:long}/member-candidates")]
    public async Task<ActionResult<IReadOnlyList<UserSummaryResponse>>> SearchMemberCandidates(
        long id, [FromQuery] string? search, CancellationToken cancellationToken)
    {
        if (!await IsProjectOwner(id, cancellationToken)) return Forbid();
        var term = search?.Trim() ?? string.Empty;
        if (term.Length < 2) return Ok(Array.Empty<UserSummaryResponse>());

        var normalized = term.ToUpperInvariant();
        var lower = term.ToLowerInvariant();
        var users = await db.Users.AsNoTracking()
            .Where(user => !db.ProjectMembers.Any(member => member.ProjectId == id && member.UserId == user.Id)
                && (user.NormalizedUserName!.Contains(normalized)
                    || user.NormalizedEmail!.Contains(normalized)
                    || user.DisplayName.ToLower().Contains(lower)))
            .OrderBy(user => user.UserName)
            .Take(10)
            .Select(user => new UserSummaryResponse(user.Id, user.UserName ?? string.Empty, user.DisplayName, user.Email ?? string.Empty))
            .ToListAsync(cancellationToken);

        return Ok(users);
    }

    [RequiresProject(ProjectFeature.Full, ProjectKey.Id)]
    [HttpPost("{id:long}/members")]
    public async Task<ActionResult<ProjectMemberResponse>> AddMember(
        long id, AddMemberRequest request, CancellationToken cancellationToken)
    {
        if (!MemberRoles.Contains(request.Role)) return BadRequest(new { error = "Role must be Owner, Developer, or External." });
        if (!await IsProjectOwner(id, cancellationToken)) return Forbid();
        using var memberLock = await ProjectSlotLock.AcquireAsync($"members:{id}", cancellationToken);
        if (await MemberLimitReached(id, cancellationToken) is { } refused) return refused;

        var user = await db.Users.SingleOrDefaultAsync(user => user.Id == request.UserId, cancellationToken);
        if (user is null) return NotFound();
        if (await db.ProjectMembers.AnyAsync(member => member.ProjectId == id && member.UserId == user.Id, cancellationToken))
            return Conflict(new { error = "This user is already a member of the project." });

        db.ProjectMembers.Add(new ProjectMember { ProjectId = id, UserId = user.Id, Role = request.Role });
        await db.SaveChangesAsync(cancellationToken);

        if (!string.IsNullOrEmpty(user.Email))
        {
            var (projectName, inviterName) = await GetInvitationDetails(id, cancellationToken);
            await TrySendEmail(MemberEmails.ExistingUser(
                user.Email, user.DisplayName, projectName, inviterName, request.Role, SignInUrl()), cancellationToken);
        }
        return Ok(new ProjectMemberResponse(
            user.Id, user.UserName ?? string.Empty, user.DisplayName, request.Role, user.MustChangePassword, "1/1", DateTimeOffset.UtcNow));
    }

    [HttpDelete("{id:long}/members/{userId}")]
    public async Task<IActionResult> RemoveMember(
        long id, string userId, CancellationToken cancellationToken)
    {
        if (!await IsProjectOwner(id, cancellationToken)) return Forbid();

        var member = await db.ProjectMembers.SingleOrDefaultAsync(
            member => member.ProjectId == id && member.UserId == userId,
            cancellationToken);
        if (member is null) return NotFound();

        var projectOwnerId = await db.Projects
            .Where(project => project.Id == id)
            .Select(project => project.OwnerId)
            .SingleAsync(cancellationToken);
        if (userId == projectOwnerId)
            return Conflict(new { error = "The project creator cannot be removed." });

        await RemoveMembership(member, cancellationToken);
        return NoContent();
    }

    /// <summary>
    /// Cancels the invite of a user who has not signed in yet. If this project is their only one, the
    /// account is deleted too; otherwise only this membership goes, so other projects' invites are untouched.
    /// </summary>
    [RequiresProject(ProjectFeature.Full, ProjectKey.Id)]
    [HttpDelete("{id:long}/members/{userId}/invite")]
    public async Task<ActionResult<CancelInviteResponse>> CancelInvite(
        long id, string userId, CancellationToken cancellationToken)
    {
        if (!await IsProjectOwner(id, cancellationToken)) return Forbid();

        var member = await db.ProjectMembers.Include(member => member.User).SingleOrDefaultAsync(
            member => member.ProjectId == id && member.UserId == userId, cancellationToken);
        if (member is null) return NotFound();
        if (!member.User.MustChangePassword)
            return Conflict(new { error = "This user has already signed in, so they can only be removed from the project." });

        var inOtherProjects = await db.ProjectMembers.AnyAsync(
            other => other.UserId == userId && other.ProjectId != id, cancellationToken);
        if (inOtherProjects)
        {
            await RemoveMembership(member, cancellationToken);
            return Ok(new CancelInviteResponse(UserDeleted: false));
        }

        var result = await userRemoval.DeleteAsync(member.User, cancellationToken);
        if (!result.Succeeded)
            return BadRequest(new { error = string.Join(" ", result.Errors.Select(error => error.Description)) });
        return Ok(new CancelInviteResponse(UserDeleted: true));
    }

    [RequiresProject(ProjectFeature.Full, ProjectKey.Id)]
    [HttpPost("{id:long}/members/new-user")]
    public async Task<ActionResult<ProjectMemberResponse>> AddNewUserMember(
        long id, NewUserMemberRequest request, CancellationToken cancellationToken)
    {
        if (!MemberRoles.Contains(request.Role)) return BadRequest(new { error = "Role must be Owner, Developer, or External." });
        if (!await IsProjectOwner(id, cancellationToken)) return Forbid();
        using var memberLock = await ProjectSlotLock.AcquireAsync($"members:{id}", cancellationToken);
        if (await MemberLimitReached(id, cancellationToken) is { } refused) return refused;
        if (await userManager.FindByEmailAsync(request.Email.Trim()) is not null)
            return Conflict(new { error = "A user with this email already exists." });

        var password = RandomNumberGenerator.GetInt32(0, 100_000_000).ToString("D8");
        var user = new ApplicationUser
        {
            UserName = request.UserName.Trim(),
            Email = request.Email.Trim(),
            EmailConfirmed = true,
            DisplayName = request.UserName.Trim(),
            MustChangePassword = true,
            // Their own trial, for any projects they create themselves.
            PlanType = Plan.Trial,
            PlanRenewDate = Plan.RenewDateFrom(Plan.Trial, DateTimeOffset.UtcNow)
        };
        // An all-digit temporary password does not satisfy the Identity password rules, so it is hashed directly.
        user.PasswordHash = userManager.PasswordHasher.HashPassword(user, password);
        var result = await userManager.CreateAsync(user);
        if (!result.Succeeded)
            return BadRequest(new { error = string.Join(" ", result.Errors.Select(error => error.Description)) });

        db.ProjectMembers.Add(new ProjectMember { ProjectId = id, UserId = user.Id, Role = request.Role });
        await db.SaveChangesAsync(cancellationToken);
        // The temporary password only ever leaves the server in this email. If it cannot be sent, nobody
        // could sign in as the new user, so the user (and, by cascade, the membership) is removed again.
        var (projectName, inviterName) = await GetInvitationDetails(id, cancellationToken);
        var emailSent = await TrySendEmail(MemberEmails.NewUser(
            user.Email, user.UserName, password, projectName, inviterName, request.Role, SignInUrl()), cancellationToken);
        if (!emailSent)
        {
            await userManager.DeleteAsync(user);
            return StatusCode(StatusCodes.Status502BadGateway,
                new { error = "The invitation email could not be sent, so the user was not created. Please try again." });
        }

        return Ok(new ProjectMemberResponse(user.Id, user.UserName, user.DisplayName, request.Role, true, "1/1", DateTimeOffset.UtcNow));
    }

    [HttpPost]
    public async Task<ActionResult<ProjectResponse>> Create(
        ProjectRequest request, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var owner = await userManager.GetUserAsync(User);
        if (owner is null) return Unauthorized();
        // Held until the project is saved, so simultaneous requests cannot both take the last free slot.
        using var slotLock = await ProjectSlotLock.AcquireAsync(userId, cancellationToken);
        if (await plans.IsLapsed(owner, cancellationToken))
            return StatusCode(StatusCodes.Status403Forbidden,
                new { error = "Your plan has run out. Choose a plan to create projects again.", code = "plan" });
        if (Plan.ProjectLimit(owner.PlanType) is { } limit
            && await db.Projects.CountAsync(project => project.OwnerId == userId && !project.Frozen, cancellationToken) >= limit)
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                error = $"Your plan includes {limit} active projects. Upgrade your plan, or delete a project, to create another.",
                code = "limit"
            });

        var project = new Project
        {
            Name = request.Name.Trim(),
            Description = request.Description?.Trim() ?? string.Empty,
            OwnerId = userId
        };
        project.Members.Add(new ProjectMember { Project = project, UserId = userId, Role = "Owner" });

        db.Projects.Add(project);
        await db.SaveChangesAsync(cancellationToken);

        var response = new ProjectResponse(
            project.Id, project.Name, project.Description, project.CreatedAt, 0, 1, null, null, "Owner", false, null, null,
            false, Plan.HasFullFeatures(owner.PlanType), true,
            string.IsNullOrEmpty(owner.DisplayName) ? owner.UserName ?? "" : owner.DisplayName, false,
            Plan.MemberLimit(owner.PlanType));
        return CreatedAtAction(nameof(GetById), new { id = project.Id }, response);
    }

    [RequiresProject(ProjectFeature.Tasks, ProjectKey.Id)]
    [HttpPut("{id:long}")]
    public async Task<IActionResult> Update(
        long id, UpdateProjectRequest request, CancellationToken cancellationToken)
    {
        if (request.Icon is not null && request.IconImage is not null)
            return BadRequest(new { error = "Choose either an icon or an image." });
        if (request.IconImage is not null && !request.IconImage.StartsWith("data:image/", StringComparison.Ordinal))
            return BadRequest(new { error = "The image must be an image data URL." });

        var project = await GetMemberProject(id, cancellationToken);
        if (project is null) return NotFound();

        project.Name = request.Name.Trim();
        project.Description = request.Description?.Trim() ?? string.Empty;
        project.Icon = request.Icon;
        project.IconImage = request.IconImage;
        project.GitHubUrl = string.IsNullOrWhiteSpace(request.GitHubUrl) ? null : request.GitHubUrl.Trim();
        project.WebsiteUrl = string.IsNullOrWhiteSpace(request.WebsiteUrl) ? null : request.WebsiteUrl.Trim();
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    /// <summary>
    /// Tasks completed and hours worked, cumulative from the start of the range (7d / 30d daily, 1y weekly, in UTC),
    /// plus whether the caller is currently working.
    /// </summary>
    [RequiresProject(ProjectFeature.Full, ProjectKey.Id)]
    [HttpGet("{id:long}/overview")]
    public async Task<ActionResult<ProjectOverviewResponse>> GetOverview(
        long id, [FromQuery] string range, CancellationToken cancellationToken)
    {
        (int Buckets, int DaysPerBucket)? shape = range switch { "7d" => (7, 1), "30d" => (30, 1), "1y" => (52, 7), _ => null };
        if (shape is not { } bucketing) return BadRequest(new { error = "Range must be 7d, 30d or 1y." });
        if (await GetMemberProject(id, cancellationToken) is null) return NotFound();

        var now = DateTimeOffset.UtcNow;
        var today = new DateTimeOffset(now.UtcDateTime.Date, TimeSpan.Zero);
        var start = today.AddDays(-(bucketing.Buckets - 1) * bucketing.DaysPerBucket);

        // Filtered in memory: SQLite cannot compare DateTimeOffset values in queries.
        var completed = (await db.ProjectTasks.AsNoTracking()
                .Where(task => task.ProjectId == id && task.CompletedAt != null)
                .Select(task => task.CompletedAt!.Value)
                .ToListAsync(cancellationToken))
            .Where(at => at >= start)
            .ToList();
        var sessions = await db.WorkSessions.AsNoTracking()
            .Where(session => session.ProjectId == id)
            .Select(session => new { session.StartedAt, session.EndedAt })
            .ToListAsync(cancellationToken);

        var points = Enumerable.Range(0, bucketing.Buckets).Select(index =>
        {
            var bucketStart = start.AddDays(index * bucketing.DaysPerBucket);
            var bucketEnd = bucketStart.AddDays(bucketing.DaysPerBucket);
            var until = bucketEnd < now ? bucketEnd : now;
            var hours = sessions.Sum(session =>
            {
                var from = session.StartedAt > start ? session.StartedAt : start;
                var to = session.EndedAt is { } ended && ended < until ? ended : until;
                return to > from ? (to - from).TotalHours : 0;
            });
            return new OverviewPoint(bucketStart, completed.Count(at => at < bucketEnd), Math.Round(hours, 2));
        }).ToList();

        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var open = await db.WorkSessions.AsNoTracking()
            .Where(session => session.ProjectId == id && session.UserId == userId && session.EndedAt == null)
            .Select(session => (DateTimeOffset?)session.StartedAt)
            .FirstOrDefaultAsync(cancellationToken);
        return Ok(new ProjectOverviewResponse(points, open is not null, open));
    }

    /// <summary>"Working" opens a work session for the caller; "Idle" closes it.</summary>
    [RequiresProject(ProjectFeature.Full, ProjectKey.Id)]
    [HttpPut("{id:long}/work")]
    public async Task<IActionResult> SetWorking(long id, SetWorkingRequest request, CancellationToken cancellationToken)
    {
        if (await GetMemberProject(id, cancellationToken) is null) return NotFound();
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var open = await db.WorkSessions.SingleOrDefaultAsync(
            session => session.ProjectId == id && session.UserId == userId && session.EndedAt == null, cancellationToken);

        if (request.Working && open is null)
            db.WorkSessions.Add(new WorkSession { ProjectId = id, UserId = userId });
        else if (!request.Working && open is not null)
            open.EndedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    /// <summary>
    /// Emails the project's owner that a member would like the project upgraded: unfrozen, or moved off the free plan.
    /// At most once a day per member and project.
    /// </summary>
    [HttpPost("{id:long}/upgrade-request")]
    public async Task<IActionResult> RequestUpgrade(long id, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var project = await GetMemberProject(id, cancellationToken);
        if (project is null) return NotFound();
        if (project.OwnerId == userId) return BadRequest(new { error = "This is your own project: change your plan instead." });
        var status = await plans.GetStatus(id, cancellationToken);
        if (status is { Frozen: false, FullFeatures: true })
            return BadRequest(new { error = "This project already has everything its plan offers." });

        var now = DateTimeOffset.UtcNow;
        if (UpgradeRequests.TryGetValue((id, userId), out var last) && now - last < TimeSpan.FromDays(1))
            return StatusCode(StatusCodes.Status429TooManyRequests,
                new { error = "You already asked the owner today. Give them a little time." });

        var owner = await db.Users.AsNoTracking().SingleAsync(user => user.Id == project.OwnerId, cancellationToken);
        if (string.IsNullOrEmpty(owner.Email))
            return BadRequest(new { error = "The project's owner has no email address to send the request to." });
        var requester = await db.Users.AsNoTracking().SingleAsync(user => user.Id == userId, cancellationToken);
        static string Name(ApplicationUser user) => string.IsNullOrEmpty(user.DisplayName) ? user.UserName ?? "" : user.DisplayName;

        var sent = await TrySendEmail(PlanEmails.UpgradeRequest(
            owner.Email, Name(owner), Name(requester), project.Name, status?.Frozen ?? false,
            $"{Request.Scheme}://{Request.Host}/plans"), cancellationToken);
        if (!sent)
            return StatusCode(StatusCodes.Status502BadGateway, new { error = "The request could not be sent. Please try again." });
        UpgradeRequests[(id, userId)] = now;
        return NoContent();
    }

    /// <summary>
    /// Unfreezes one of the caller's own projects while their plan is running and has a free project slot, removing the
    /// most recently added members beyond the plan's member limit. There is no way back short of changing plan, so slots
    /// cannot be swapped between projects.
    /// </summary>
    [HttpPost("{id:long}/unfreeze")]
    public async Task<IActionResult> Unfreeze(long id, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var project = await GetMemberProject(id, cancellationToken);
        if (project is null) return NotFound();
        if (project.OwnerId != userId) return Forbid();
        if (!project.Frozen) return NoContent();
        // Held until the project is saved, so simultaneous unfreezes cannot both take the last free slot.
        using var slotLock = await ProjectSlotLock.AcquireAsync(userId, cancellationToken);
        if (!await HasFreeProjectSlot(cancellationToken))
            return BadRequest(new
            {
                error = "Every active project slot in your plan is in use, or your plan has run out. Upgrade to unfreeze more."
            });

        project.Frozen = false;
        // Frozen projects kept all their members; now that it is active again it must fit the plan's member limit.
        var owner = await userManager.GetUserAsync(User);
        if (owner is not null && Plan.MemberLimit(owner.PlanType) is { } memberLimit)
            await membershipRemoval.StageTrim(userId, [id], memberLimit, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    [HttpDelete("{id:long}")]
    public async Task<IActionResult> Delete(long id, CancellationToken cancellationToken)
    {
        var project = await GetMemberProject(id, cancellationToken);
        if (project is null) return NotFound();
        if (project.OwnerId != User.FindFirstValue(ClaimTypes.NameIdentifier)) return Forbid();

        db.Projects.Remove(project);
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    private async Task<(string ProjectName, string InviterName)> GetInvitationDetails(
        long projectId, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var projectName = await db.Projects.Where(project => project.Id == projectId)
            .Select(project => project.Name).SingleAsync(cancellationToken);
        var inviter = await db.Users.Where(user => user.Id == userId)
            .Select(user => new { user.DisplayName, user.UserName }).SingleAsync(cancellationToken);
        return (projectName, string.IsNullOrEmpty(inviter.DisplayName) ? inviter.UserName ?? "Someone" : inviter.DisplayName);
    }

    private string SignInUrl() => $"{Request.Scheme}://{Request.Host}/login";

    /// <summary>Email is best effort: a failed send is logged and never undoes adding the member.</summary>
    private async Task<bool> TrySendEmail(EmailMessage message, CancellationToken cancellationToken)
    {
        try
        {
            await emailService.SendAsync(message, cancellationToken);
            return true;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogWarning(exception, "Could not send email to {To}.", message.To);
            return false;
        }
    }

    /// <summary>Removes one membership: unfinished tasks in the project are unassigned and canvas overrides dropped.</summary>
    private async Task RemoveMembership(ProjectMember member, CancellationToken cancellationToken)
    {
        await membershipRemoval.Stage(member, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
    }

    private Task<bool> IsProjectOwner(long projectId, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        return db.ProjectMembers.AnyAsync(
            member => member.ProjectId == projectId && member.UserId == userId && member.Role == "Owner",
            cancellationToken);
    }

    /// <summary>
    /// Fills in whether each project is frozen and has full features, which depend on its owner's plan, and whether the
    /// caller can unfreeze it. Expects Frozen to hold the project's own frozen flag.
    /// </summary>
    private async Task<List<ProjectResponse>> WithPlanStatus(
        IReadOnlyList<ProjectResponse> projects, CancellationToken cancellationToken)
    {
        var statuses = await plans.GetStatuses(projects.Select(project => project.Id).ToList(), cancellationToken);
        var hasFreeSlot = projects.Any(project => project.IsPlanOwner && project.Frozen)
            && await HasFreeProjectSlot(cancellationToken);
        return projects.Select(project => statuses.TryGetValue(project.Id, out var status)
            ? project with
            {
                Frozen = status.Frozen,
                FullFeatures = status.FullFeatures,
                MemberLimit = status.MemberLimit,
                CanUnfreeze = project.IsPlanOwner && project.Frozen && hasFreeSlot,
            }
            : project).ToList();
    }

    /// <summary>
    /// A 403 when the project already has as many members (pending invites included) as its owner's plan allows; null
    /// when there is room. Members beyond the limit after a downgrade stay, but no more can be added.
    /// </summary>
    private async Task<ObjectResult?> MemberLimitReached(long id, CancellationToken cancellationToken)
    {
        if (await plans.GetStatus(id, cancellationToken) is not { MemberLimit: { } limit }) return null;
        if (await db.ProjectMembers.CountAsync(member => member.ProjectId == id, cancellationToken) < limit) return null;
        return StatusCode(StatusCodes.Status403Forbidden, new
        {
            error = $"This project's plan includes up to {limit} members, pending invites included. Upgrade to Pro to add more.",
            code = "member-limit"
        });
    }

    /// <summary>Whether the caller's plan is running and has room for another active project.</summary>
    private async Task<bool> HasFreeProjectSlot(CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null || await plans.IsLapsed(user, cancellationToken)) return false;
        return Plan.ProjectLimit(user.PlanType) is not { } limit
            || await db.Projects.CountAsync(project => project.OwnerId == user.Id && !project.Frozen, cancellationToken) < limit;
    }

    private Task<Project?> GetMemberProject(long id, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        return db.Projects.SingleOrDefaultAsync(
            project => project.Id == id && project.Members.Any(member => member.UserId == userId),
            cancellationToken);
    }
}

/// <summary>Project summary visible to a member.</summary>
/// <param name="TaskCount">Tasks that are not done yet.</param>
/// <param name="MyRole">The caller's role in the project.</param>
/// <param name="IsPlanOwner">The caller owns the project, so its plan (and whether it is frozen) is theirs to change.</param>
/// <param name="OwnerName">Who owns the project, to ask about upgrading it.</param>
/// <param name="CanUnfreeze">The project is the caller's, frozen, and their plan has a free project slot.</param>
/// <param name="MemberLimit">Members (pending invites included) the owner's plan allows; null for no limit.</param>
public sealed record ProjectResponse(
    long Id, string Name, string Description, DateTimeOffset CreatedAt, int TaskCount, int MemberCount,
    string? Icon, string? IconImage, string MyRole, bool BillingEnabled, string? GitHubUrl,
    string? WebsiteUrl, bool Frozen, bool FullFeatures, bool IsPlanOwner, string OwnerName, bool CanUnfreeze,
    int? MemberLimit);

/// <summary>A member of a project visible to project participants.</summary>
/// <param name="Pending">Invited but not signed in yet: still on the temporary password.</param>
public sealed record ProjectMemberResponse(
    string UserId, string UserName, string DisplayName, string Role, bool Pending, string BillableFraction,
    DateTimeOffset AddedAt);

/// <summary>Data required to create a project.</summary>
public sealed record ProjectRequest
{
    [Required, StringLength(120, MinimumLength = 1)]
    public required string Name { get; init; }

    [StringLength(1000)]
    public string? Description { get; init; }
}

/// <summary>A user that can be added to a project.</summary>
public sealed record UserSummaryResponse(string Id, string UserName, string DisplayName, string Email);

/// <summary>An existing user to add to a project.</summary>
public sealed record AddMemberRequest
{
    [Required]
    public required string UserId { get; init; }

    [Required]
    public required string Role { get; init; }
}

/// <summary>A new user to create and add to a project.</summary>
public sealed record NewUserMemberRequest
{
    [Required, StringLength(64, MinimumLength = 2)]
    public required string UserName { get; init; }

    [Required, EmailAddress]
    public required string Email { get; init; }

    [Required]
    public required string Role { get; init; }
}


/// <summary>Editable project details. Icon is a Material icon name, IconImage a small image data URL; neither means the default icon.</summary>
public sealed record UpdateProjectRequest
{
    [Required, StringLength(120, MinimumLength = 1)]
    public required string Name { get; init; }

    [StringLength(1000)]
    public string? Description { get; init; }

    [RegularExpression("^[a-z0-9_]{1,40}$")]
    public string? Icon { get; init; }

    [StringLength(200_000)]
    public string? IconImage { get; init; }

    /// <summary>Only GitHub links, so the header link cannot point somewhere unexpected.</summary>
    [StringLength(300), RegularExpression(@"^\s*https://github\.com/\S*\s*$", ErrorMessage = "The GitHub link must start with https://github.com/.")]
    public string? GitHubUrl { get; init; }

    /// <summary>Any web address, but only http(s), so the link cannot run script.</summary>
    [StringLength(300), RegularExpression(@"^\s*https?://\S+\s*$", ErrorMessage = "The website must start with https:// or http://.")]
    public string? WebsiteUrl { get; init; }
}

/// <summary>Whether cancelling the invite also deleted the account (it was the user's only project).</summary>
public sealed record CancelInviteResponse(bool UserDeleted);

/// <summary>Cumulative values at the end of one day (or week) starting at Date.</summary>
public sealed record OverviewPoint(DateTimeOffset Date, int TasksCompleted, double Hours);

/// <summary>The overview chart data and the caller's working status.</summary>
public sealed record ProjectOverviewResponse(IReadOnlyList<OverviewPoint> Points, bool Working, DateTimeOffset? WorkingSince);

public sealed record SetWorkingRequest(bool Working);
