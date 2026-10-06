using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Security.Cryptography;
using Email;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Model;

[ApiController]
[Authorize]
[Route("api/projects")]
public sealed class ProjectsController(
    AppDbContext db,
    UserManager<ApplicationUser> userManager,
    IEmailService emailService,
    ILogger<ProjectsController> logger) : ControllerBase
{
    private static readonly string[] MemberRoles = ["Owner", "Developer", "External"];

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<ProjectResponse>>> GetAll(CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var projects = await db.Projects.AsNoTracking()
            .Where(project => project.Members.Any(member => member.UserId == userId))
            .OrderByDescending(project => project.Id)
            .Select(project => new ProjectResponse(
                project.Id, project.Name, project.Description, project.CreatedAt,
                project.Tasks.Count, project.Members.Count, project.Icon, project.IconImage))
            .ToListAsync(cancellationToken);

        return Ok(projects);
    }

    [HttpGet("{id:long}")]
    public async Task<ActionResult<ProjectResponse>> GetById(long id, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var project = await db.Projects.AsNoTracking()
            .Where(project => project.Id == id && project.Members.Any(member => member.UserId == userId))
            .Select(project => new ProjectResponse(
                project.Id, project.Name, project.Description, project.CreatedAt,
                project.Tasks.Count, project.Members.Count, project.Icon, project.IconImage))
            .SingleOrDefaultAsync(cancellationToken);

        return project is null ? NotFound() : Ok(project);
    }

    [HttpGet("{id:long}/members")]
    public async Task<ActionResult<IReadOnlyList<ProjectMemberResponse>>> GetMembers(long id, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var isMember = await db.ProjectMembers.AnyAsync(
            member => member.ProjectId == id && member.UserId == userId,
            cancellationToken);
        if (!isMember) return NotFound();

        var members = await db.ProjectMembers.AsNoTracking()
            .Where(member => member.ProjectId == id)
            .OrderBy(member => member.Role)
            .Select(member => new ProjectMemberResponse(
                member.UserId,
                member.User.UserName ?? string.Empty,
                member.User.DisplayName,
                member.Role))
            .ToListAsync(cancellationToken);

        return Ok(members);
    }

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

    [HttpPost("{id:long}/members")]
    public async Task<ActionResult<ProjectMemberResponse>> AddMember(
        long id, AddMemberRequest request, CancellationToken cancellationToken)
    {
        if (!MemberRoles.Contains(request.Role)) return BadRequest(new { error = "Role must be Owner, Developer, or External." });
        if (!await IsProjectOwner(id, cancellationToken)) return Forbid();

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
        return Ok(new ProjectMemberResponse(user.Id, user.UserName ?? string.Empty, user.DisplayName, request.Role));
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

        var unfinishedTasks = await db.ProjectTasks
            .Where(task => task.ProjectId == id && task.AssigneeUserId == userId
                && (task.Status == "todo" || task.Status == "doing"))
            .ToListAsync(cancellationToken);
        foreach (var task in unfinishedTasks)
            task.AssigneeUserId = null;

        db.CanvasPermissions.RemoveRange(db.CanvasPermissions.Where(
            permission => permission.Canvas.ProjectId == id && permission.UserId == userId));
        db.ProjectMembers.Remove(member);
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    [HttpPost("{id:long}/members/new-user")]
    public async Task<ActionResult<NewUserMemberResponse>> AddNewUserMember(
        long id, NewUserMemberRequest request, CancellationToken cancellationToken)
    {
        if (!MemberRoles.Contains(request.Role)) return BadRequest(new { error = "Role must be Owner, Developer, or External." });
        if (!await IsProjectOwner(id, cancellationToken)) return Forbid();
        if (await userManager.FindByEmailAsync(request.Email.Trim()) is not null)
            return Conflict(new { error = "A user with this email already exists." });

        var password = RandomNumberGenerator.GetInt32(0, 100_000_000).ToString("D8");
        var user = new ApplicationUser
        {
            UserName = request.UserName.Trim(),
            Email = request.Email.Trim(),
            EmailConfirmed = true,
            DisplayName = request.UserName.Trim(),
            MustChangePassword = true
        };
        // An all-digit temporary password does not satisfy the Identity password rules, so it is hashed directly.
        user.PasswordHash = userManager.PasswordHasher.HashPassword(user, password);
        var result = await userManager.CreateAsync(user);
        if (!result.Succeeded)
            return BadRequest(new { error = string.Join(" ", result.Errors.Select(error => error.Description)) });

        db.ProjectMembers.Add(new ProjectMember { ProjectId = id, UserId = user.Id, Role = request.Role });
        await db.SaveChangesAsync(cancellationToken);
        var (projectName, inviterName) = await GetInvitationDetails(id, cancellationToken);
        var emailSent = await TrySendEmail(MemberEmails.NewUser(
            user.Email, user.UserName, password, projectName, inviterName, request.Role, SignInUrl()), cancellationToken);

        var member = new ProjectMemberResponse(user.Id, user.UserName, user.DisplayName, request.Role);
        return Ok(new NewUserMemberResponse(member, password, emailSent));
    }

    [HttpPost]
    public async Task<ActionResult<ProjectResponse>> Create(
        ProjectRequest request, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var project = new Project
        {
            Name = request.Name.Trim(),
            Description = request.Description?.Trim() ?? string.Empty,
            OwnerId = userId
        };
        project.Members.Add(new ProjectMember { Project = project, UserId = userId, Role = "Owner" });

        db.Projects.Add(project);
        await db.SaveChangesAsync(cancellationToken);

        var response = new ProjectResponse(project.Id, project.Name, project.Description, project.CreatedAt, 0, 1, null, null);
        return CreatedAtAction(nameof(GetById), new { id = project.Id }, response);
    }

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

    private Task<bool> IsProjectOwner(long projectId, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        return db.ProjectMembers.AnyAsync(
            member => member.ProjectId == projectId && member.UserId == userId && member.Role == "Owner",
            cancellationToken);
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
public sealed record ProjectResponse(
    long Id, string Name, string Description, DateTimeOffset CreatedAt, int TaskCount, int MemberCount,
    string? Icon, string? IconImage);

/// <summary>A member of a project visible to project participants.</summary>
public sealed record ProjectMemberResponse(string UserId, string UserName, string DisplayName, string Role);

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

/// <summary>The added member with the generated password, shown once to the project owner.</summary>
/// <remarks>The password is still returned so it can be shown if the email does not arrive.</remarks>
public sealed record NewUserMemberResponse(ProjectMemberResponse Member, string Password, bool EmailSent);

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
}
