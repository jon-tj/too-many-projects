using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Identity;
using Model;

[ApiController]
[Authorize]
[Route("api/account")]
public sealed class AccountController(UserManager<ApplicationUser> users) : ControllerBase
{
    [HttpGet("me")]
    public async Task<ActionResult<AccountResponse>> GetCurrent(CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        var user = userId is null ? null : await users.FindByIdAsync(userId);
        return user is null
            ? Unauthorized()
            : Ok(new AccountResponse(user.Id, user.UserName ?? "", user.DisplayName, user.Email ?? ""));
    }
}

/// <summary>Profile data for the authenticated account.</summary>
public sealed record AccountResponse(string Id, string UserName, string DisplayName, string Email);