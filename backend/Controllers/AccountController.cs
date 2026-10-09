using System.ComponentModel.DataAnnotations;
using Accounts;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Model;
using Plans;

[ApiController]
[Authorize]
[Route("api/account")]
public sealed class AccountController(
    UserManager<ApplicationUser> users, UserRemoval userRemoval, AppDbContext db, PlanService plans,
    MembershipRemoval membershipRemoval) : ControllerBase
{
    [HttpGet("me")]
    public async Task<ActionResult<AccountResponse>> GetCurrent(CancellationToken cancellationToken)
    {
        var user = await users.GetUserAsync(User);
        if (user is null) return Unauthorized();
        // First, so a plan that just ran out shows as none.
        var lapsed = await plans.IsLapsed(user, cancellationToken);
        return Ok(new AccountResponse(
            user.Id, user.UserName ?? "", user.DisplayName, user.Email ?? "", user.MustChangePassword, user.AvatarImage,
            user.PlanType, user.PlanRenewDate, lapsed, user.PreviousPlanType));
    }

    /// <summary>The caller's plan and the projects they own, for choosing a plan and which projects stay active.</summary>
    [HttpGet("plan")]
    public async Task<ActionResult<PlanResponse>> GetPlan(CancellationToken cancellationToken)
    {
        var user = await users.GetUserAsync(User);
        if (user is null) return Unauthorized();
        // First, so a plan that just ran out shows as none with its projects frozen.
        var lapsed = await plans.IsLapsed(user, cancellationToken);
        var owned = await db.Projects.AsNoTracking()
            .Where(project => project.OwnerId == user.Id)
            .OrderBy(project => project.Name)
            .Select(project => new OwnedProjectResponse(project.Id, project.Name, project.Frozen, project.Members.Count))
            .ToListAsync(cancellationToken);
        return Ok(new PlanResponse(
            user.PlanType, user.PlanRenewDate, lapsed, user.PreviousPlanType,
            await plans.IsExempt(user.Id, cancellationToken), Plan.ProjectLimit(user.PlanType),
            Plan.MemberLimit(user.PlanType), owned));
    }

    /// <summary>
    /// Switches plan. Exempt users switch to any plan without paying; for everyone else payment is not wired up yet, so
    /// a paid plan simply runs for a month. On a plan without a project limit every owned project is active; on one
    /// whose limit the caller is within, too. Over the limit, every owned project is frozen and the owner unfreezes the
    /// ones they want, up to the limit (POST api/projects/{id}/unfreeze). A plan that ran out is "none" (no slots, all
    /// frozen), so choosing any plan after that follows the same rules. Choosing the plan you are already on renews it
    /// and keeps the projects as they are.
    /// </summary>
    [HttpPut("plan")]
    public async Task<IActionResult> ChoosePlan(ChoosePlanRequest request, CancellationToken cancellationToken)
    {
        if (!Plan.Choosable.Contains(request.Plan)) return BadRequest(new { error = "Choose the free, plus or pro plan." });
        var user = await users.GetUserAsync(User);
        if (user is null) return Unauthorized();
        // A plan that just ran out becomes none first, so choosing it again is a change of plan, not a renewal.
        await plans.IsLapsed(user, cancellationToken);

        // When Stripe is wired up, Plus and Pro need a payment here before anything below changes, unless the user is
        // exempt (plans.IsExempt): exempt users switch to any plan for free.
        // Renewing keeps the frozen projects as they are, so it cannot be used to swap them.
        if (request.Plan != user.PlanType)
        {
            var owned = await db.Projects.Where(project => project.OwnerId == user.Id).ToListAsync(cancellationToken);
            var freezeAll = Plan.ProjectLimit(request.Plan) is { } limit && owned.Count > limit;
            foreach (var project in owned) project.Frozen = freezeAll;
            // Active projects over the new plan's member limit lose their most recently added members (free keeps only
            // the owner). Frozen projects keep theirs until they are unfrozen.
            if (Plan.MemberLimit(request.Plan) is { } memberLimit)
                await membershipRemoval.StageTrim(user.Id,
                    owned.Where(project => !project.Frozen).Select(project => project.Id).ToList(), memberLimit,
                    cancellationToken);
        }
        user.PlanType = request.Plan;
        user.PlanRenewDate = request.Plan == Plan.Free ? null : Plan.RenewDateFrom(request.Plan, DateTimeOffset.UtcNow);
        // The user and the projects are tracked by the same context, so this saves both.
        var result = await users.UpdateAsync(user);
        if (!result.Succeeded)
            return BadRequest(new { error = string.Join(" ", result.Errors.Select(error => error.Description)) });
        return NoContent();
    }

    /// <summary>Changes the sign-in username after confirming the password. Identity rejects names already taken.</summary>
    [HttpPut("username")]
    public async Task<IActionResult> ChangeUserName(ChangeUserNameRequest request)
    {
        var user = await users.GetUserAsync(User);
        if (user is null) return Unauthorized();
        if (!await users.CheckPasswordAsync(user, request.Password))
            return BadRequest(new { error = "Incorrect password." });

        var result = await users.SetUserNameAsync(user, request.UserName.Trim());
        if (!result.Succeeded)
            return BadRequest(new { error = string.Join(" ", result.Errors.Select(error => error.Description)) });
        return NoContent();
    }

    [HttpPost("password")]
    public async Task<IActionResult> ChangePassword(ChangePasswordRequest request)
    {
        var user = await users.GetUserAsync(User);
        if (user is null) return Unauthorized();

        var result = await users.ChangePasswordAsync(user, request.CurrentPassword, request.NewPassword);
        if (!result.Succeeded)
            return BadRequest(new { error = string.Join(" ", result.Errors.Select(error => error.Description)) });

        if (user.MustChangePassword)
        {
            user.MustChangePassword = false;
            await users.UpdateAsync(user);
        }
        return NoContent();
    }

    /// <summary>Sets (or with null removes) the profile picture shown in the sidebar and on canvases.</summary>
    [HttpPut("avatar")]
    public async Task<IActionResult> SetAvatar(SetAvatarRequest request)
    {
        if (request.Image is not null && !request.Image.StartsWith("data:image/", StringComparison.Ordinal))
            return BadRequest(new { error = "The picture must be an image data URL." });

        var user = await users.GetUserAsync(User);
        if (user is null) return Unauthorized();
        user.AvatarImage = request.Image;
        await users.UpdateAsync(user);
        return NoContent();
    }

    /// <summary>Deletes the signed-in account after confirming the password.</summary>
    [HttpPost("delete")]
    public async Task<IActionResult> DeleteAccount(DeleteAccountRequest request, CancellationToken cancellationToken)
    {
        var user = await users.GetUserAsync(User);
        if (user is null) return Unauthorized();
        if (!await users.CheckPasswordAsync(user, request.Password))
            return BadRequest(new { error = "Incorrect password." });

        var sharedProjects = await userRemoval.SharedProjectsOwnedBy(user.Id, cancellationToken);
        if (sharedProjects.Count > 0)
            return Conflict(new
            {
                error = $"You created projects that other people are still in: {string.Join(", ", sharedProjects)}. " +
                    "Delete those projects or remove their other members first."
            });

        var result = await userRemoval.DeleteAsync(user, cancellationToken);
        if (!result.Succeeded)
            return BadRequest(new { error = string.Join(" ", result.Errors.Select(error => error.Description)) });
        return NoContent();
    }
}

/// <summary>Profile data for the authenticated account.</summary>
public sealed record AccountResponse(
    string Id, string UserName, string DisplayName, string Email, bool MustChangePassword, string? AvatarImage,
    string PlanType, DateTimeOffset? PlanRenewDate, bool PlanLapsed, string? PreviousPlanType);

/// <summary>The caller's plan, whether it is exempt from lapsing, its project limit (null for none) and the projects they own.</summary>
public sealed record PlanResponse(
    string PlanType, DateTimeOffset? PlanRenewDate, bool PlanLapsed, string? PreviousPlanType, bool PlanExempt, int? ProjectLimit,
    int? MemberLimit,
    IReadOnlyList<OwnedProjectResponse> OwnedProjects);

/// <param name="MemberCount">Members including the owner and pending invites.</param>
public sealed record OwnedProjectResponse(long Id, string Name, bool Frozen, int MemberCount);

/// <summary>The plan to switch to: free, plus or pro.</summary>
public sealed record ChoosePlanRequest
{
    [Required]
    public required string Plan { get; init; }
}

/// <summary>A profile picture as a small image data URL, or null to remove it.</summary>
public sealed record SetAvatarRequest
{
    [StringLength(100_000)]
    public string? Image { get; init; }
}

/// <summary>The current password (or temporary password) and the new one.</summary>
public sealed record ChangePasswordRequest
{
    [Required]
    public required string CurrentPassword { get; init; }

    [Required]
    public required string NewPassword { get; init; }
}

/// <summary>The current password, to confirm deleting the account.</summary>
public sealed record DeleteAccountRequest
{
    [Required]
    public required string Password { get; init; }
}

/// <summary>A new username, confirmed with the current password.</summary>
public sealed record ChangeUserNameRequest
{
    [Required, StringLength(64, MinimumLength = 2)]
    public required string UserName { get; init; }

    [Required]
    public required string Password { get; init; }
}
