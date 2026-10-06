using System.ComponentModel.DataAnnotations;
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
    public async Task<ActionResult<AccountResponse>> GetCurrent()
    {
        var user = await users.GetUserAsync(User);
        return user is null
            ? Unauthorized()
            : Ok(new AccountResponse(user.Id, user.UserName ?? "", user.DisplayName, user.Email ?? "", user.MustChangePassword));
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
}

/// <summary>Profile data for the authenticated account.</summary>
public sealed record AccountResponse(string Id, string UserName, string DisplayName, string Email, bool MustChangePassword);

/// <summary>The current password (or temporary password) and the new one.</summary>
public sealed record ChangePasswordRequest
{
    [Required]
    public required string CurrentPassword { get; init; }

    [Required]
    public required string NewPassword { get; init; }
}
