using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Model;

/// <summary>
/// Creates accounts from the sign-up page, with a 30-day trial, the sign-up questions and where the visitor came from.
/// The client signs in with /api/auth/login afterwards. Identity's own /api/auth/register is switched off in Program.cs.
/// </summary>
[ApiController]
[AllowAnonymous]
[Route("api/signup")]
public sealed class SignupController(UserManager<ApplicationUser> users) : ControllerBase
{
    public static readonly string[] UseCases = ["client-work", "product-development", "internal-operations", "personal", "other"];
    public static readonly string[] TeamRoles = ["founder", "manager", "contributor", "freelancer", "other"];
    private static readonly TimeSpan Trial = TimeSpan.FromDays(30);

    [HttpPost]
    public async Task<IActionResult> Register(SignupRequest request)
    {
        if (!UseCases.Contains(request.PrimaryUseCase))
            return BadRequest(new { error = "Choose what you will mainly use TooManyProjects for." });
        if (!TeamRoles.Contains(request.TeamRole))
            return BadRequest(new { error = "Choose your role in the team." });
        var email = request.Email.Trim();
        if (await users.FindByEmailAsync(email) is not null)
            return BadRequest(new { error = "An account with that email already exists. Try logging in instead." });

        var now = DateTimeOffset.UtcNow;
        var user = new ApplicationUser
        {
            UserName = request.UserName.Trim(),
            Email = email,
            DisplayName = request.DisplayName.Trim(),
            CreatedAt = now,
            TrialEndsAt = now + Trial,
            PrimaryUseCase = request.PrimaryUseCase,
            TeamRole = request.TeamRole,
            UtmSource = Clean(request.UtmSource),
            UtmMedium = Clean(request.UtmMedium),
            UtmCampaign = Clean(request.UtmCampaign),
            UtmTerm = Clean(request.UtmTerm),
            UtmContent = Clean(request.UtmContent),
            SignupReferrer = Clean(request.Referrer, 500),
        };
        var result = await users.CreateAsync(user, request.Password);
        if (!result.Succeeded)
            return BadRequest(new { error = string.Join(" ", result.Errors.Select(error => error.Description)) });
        return NoContent();
    }

    /// <summary>Trims tracking values and caps their length; empty ones are stored as null.</summary>
    private static string? Clean(string? value, int maxLength = 200)
    {
        var trimmed = value?.Trim();
        return string.IsNullOrEmpty(trimmed) ? null : trimmed[..Math.Min(trimmed.Length, maxLength)];
    }
}

/// <summary>The sign-up form, plus the utm_* parameters and referrer the visitor arrived with.</summary>
public sealed record SignupRequest
{
    [Required, StringLength(80, MinimumLength = 1)]
    public required string DisplayName { get; init; }

    [Required, StringLength(64, MinimumLength = 2)]
    public required string UserName { get; init; }

    [Required, EmailAddress, StringLength(254)]
    public required string Email { get; init; }

    [Required]
    public required string Password { get; init; }

    /// <summary>One of <see cref="SignupController.UseCases"/>.</summary>
    [Required]
    public required string PrimaryUseCase { get; init; }

    /// <summary>One of <see cref="SignupController.TeamRoles"/>.</summary>
    [Required]
    public required string TeamRole { get; init; }

    public string? UtmSource { get; init; }
    public string? UtmMedium { get; init; }
    public string? UtmCampaign { get; init; }
    public string? UtmTerm { get; init; }
    public string? UtmContent { get; init; }
    public string? Referrer { get; init; }
}
