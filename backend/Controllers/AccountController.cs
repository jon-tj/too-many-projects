using System.ComponentModel.DataAnnotations;
using Accounts;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Model;
using Payments;
using Plans;

[ApiController]
[Authorize]
[Route("api/account")]
public sealed class AccountController(
    UserManager<ApplicationUser> users, UserRemoval userRemoval, AppDbContext db, PlanService plans,
    StripeBilling stripe, ILogger<AccountController> logger) : ControllerBase
{
    [HttpGet("me")]
    public async Task<ActionResult<AccountResponse>> GetCurrent(CancellationToken cancellationToken)
    {
        var user = await users.GetUserAsync(User);
        if (user is null) return Unauthorized();
        // The app loads the account on every visit, so this is when the user was last active. Written at most every ten
        // minutes, and without UpdateAsync so the security stamp's concurrency token is left alone.
        var now = DateTimeOffset.UtcNow;
        if (user.LastSeenAt is not { } seen || now - seen > TimeSpan.FromMinutes(10))
        {
            user.LastSeenAt = now;
            await db.Users.Where(entry => entry.Id == user.Id)
                .ExecuteUpdateAsync(entry => entry.SetProperty(field => field.LastSeenAt, now), cancellationToken);
        }
        // First, so a plan that just ran out shows as none.
        var lapsed = await plans.IsLapsed(user, cancellationToken);
        return Ok(new AccountResponse(
            user.Id, user.UserName ?? "", user.DisplayName, user.Email ?? "", user.MustChangePassword, user.AvatarImage,
            user.PlanType, user.PlanRenewDate, lapsed, user.PreviousPlanType, user.IsAdmin));
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
            Plan.MemberLimit(user.PlanType), owned, stripe.Enabled, user.StripeSubscriptionId is not null,
            user.StripeCustomerId is not null, user.PlanCancelsAtRenewal));
    }

    /// <summary>
    /// Switches plan. With Stripe connected, a paid plan needs paying: without a running subscription the answer is a
    /// Checkout URL to send the user to, and the plan changes once they have paid (see StripeBilling); with one, the
    /// subscription moves to the new price at once. Choosing free with a running subscription ends it at the renew date,
    /// keeping the paid plan until then. Exempt users, and everyone while Stripe is not connected, switch straight away
    /// (a paid plan then runs for a month). See PlanService.StageSwitch for what happens to the projects.
    /// </summary>
    [HttpPut("plan")]
    public async Task<ActionResult<ChoosePlanResponse>> ChoosePlan(ChoosePlanRequest request, CancellationToken cancellationToken)
    {
        if (!Plan.Choosable.Contains(request.Plan)) return BadRequest(new { error = "Choose the free, plus or pro plan." });
        var user = await users.GetUserAsync(User);
        if (user is null) return Unauthorized();
        // A plan that just ran out becomes none first, so choosing it again is a change of plan, not a renewal.
        await plans.IsLapsed(user, cancellationToken);

        if (stripe.Enabled && !await plans.IsExempt(user.Id, cancellationToken))
        {
            try
            {
                if (user.StripeSubscriptionId is not null)
                {
                    if (request.Plan == Plan.Free) await stripe.CancelAtRenewal(user, cancellationToken);
                    else await stripe.ChangePlan(user, request.Plan, cancellationToken);
                    return Ok(new ChoosePlanResponse(null));
                }
                if (request.Plan != Plan.Free)
                    return Ok(new ChoosePlanResponse(await stripe.CreateCheckout(user, request.Plan, AppUrl(), cancellationToken)));
            }
            catch (Stripe.StripeException exception)
            {
                logger.LogError(exception, "Stripe refused a plan change for {User}.", user.Id);
                return StatusCode(StatusCodes.Status502BadGateway, new { error = "The payment provider could not be reached. Please try again." });
            }
        }

        await plans.StageSwitch(user, request.Plan,
            request.Plan == Plan.Free ? null : Plan.RenewDateFrom(request.Plan, DateTimeOffset.UtcNow), cancellationToken);
        // The user and the projects are tracked by the same context, so this saves both.
        var result = await users.UpdateAsync(user);
        if (!result.Succeeded)
            return BadRequest(new { error = string.Join(" ", result.Errors.Select(error => error.Description)) });
        return Ok(new ChoosePlanResponse(null));
    }

    /// <summary>
    /// Applies a finished Stripe Checkout as soon as the user is back on the plans page, rather than waiting for the
    /// webhook (which applies it too, should they never come back).
    /// </summary>
    [HttpPost("plan/checkout/confirm")]
    public async Task<IActionResult> ConfirmCheckout(ConfirmCheckoutRequest request, CancellationToken cancellationToken)
    {
        if (!stripe.Enabled) return NotFound();
        var user = await users.GetUserAsync(User);
        if (user is null) return Unauthorized();
        try
        {
            await stripe.ConfirmCheckout(user, request.SessionId, cancellationToken);
        }
        catch (Stripe.StripeException exception)
        {
            logger.LogError(exception, "Could not confirm Checkout session {Session}.", request.SessionId);
            return StatusCode(StatusCodes.Status502BadGateway, new { error = "Could not confirm the payment yet. Your plan updates in a moment." });
        }
        return NoContent();
    }

    /// <summary>A Stripe customer portal session, for the payment method, invoices and cancelling.</summary>
    [HttpPost("plan/portal")]
    public async Task<ActionResult<PortalResponse>> OpenBillingPortal(CancellationToken cancellationToken)
    {
        var user = await users.GetUserAsync(User);
        if (user is null) return Unauthorized();
        if (!stripe.Enabled || user.StripeCustomerId is null) return NotFound();
        try
        {
            return Ok(new PortalResponse(await stripe.CreatePortal(user, $"{AppUrl()}/plans", cancellationToken)));
        }
        catch (Stripe.StripeException exception)
        {
            logger.LogError(exception, "Could not open the billing portal for {User}.", user.Id);
            return StatusCode(StatusCodes.Status502BadGateway, new { error = "The payment provider could not be reached. Please try again." });
        }
    }

    /// <summary>
    /// Where the app is served, for Stripe to send the user back to: the browser's origin, so it also works behind the
    /// dev server's proxy; the API's own address otherwise.
    /// </summary>
    private string AppUrl() =>
        Uri.TryCreate(Request.Headers.Origin.ToString(), UriKind.Absolute, out var origin)
            ? origin.GetLeftPart(UriPartial.Authority)
            : $"{Request.Scheme}://{Request.Host}";

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
    string PlanType, DateTimeOffset? PlanRenewDate, bool PlanLapsed, string? PreviousPlanType, bool IsAdmin);

/// <summary>The caller's plan, whether it is exempt from lapsing, its project limit (null for none) and the projects they own.</summary>
/// <param name="PaymentsEnabled">Stripe is connected, so paid plans go through Checkout.</param>
/// <param name="Subscribed">A Stripe subscription pays for the plan.</param>
/// <param name="HasBillingAccount">The caller has paid through Stripe before, so the customer portal has something to show.</param>
/// <param name="CancelsAtRenewal">The subscription ends at the renew date, and the caller then moves to free.</param>
public sealed record PlanResponse(
    string PlanType, DateTimeOffset? PlanRenewDate, bool PlanLapsed, string? PreviousPlanType, bool PlanExempt, int? ProjectLimit,
    int? MemberLimit,
    IReadOnlyList<OwnedProjectResponse> OwnedProjects, bool PaymentsEnabled, bool Subscribed, bool HasBillingAccount,
    bool CancelsAtRenewal);

/// <param name="CheckoutUrl">Where to send the user to pay; null when the plan changed (or was scheduled) already.</param>
public sealed record ChoosePlanResponse(string? CheckoutUrl);

public sealed record PortalResponse(string Url);

public sealed record ConfirmCheckoutRequest
{
    [Required, StringLength(200)]
    public required string SessionId { get; init; }
}

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
