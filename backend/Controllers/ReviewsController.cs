using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Model;
using Plans;

/// <summary>
/// Asking users about their experience 10, 40 and 150 days after they created their account (see Review.Rounds). Each
/// round is asked until it is answered or dismissed; a user who misses a round is only asked the latest one.
/// </summary>
[ApiController]
[Authorize]
[Route("api/reviews")]
public sealed class ReviewsController(AppDbContext db, UserManager<ApplicationUser> users, PlanService plans) : ControllerBase
{
    /// <summary>How many days a review adds to a running trial.</summary>
    public const int TrialBonusDays = 10;

    /// <summary>The round to ask the caller about now, or 204 when there is none. Admins are never asked.</summary>
    [HttpGet("prompt")]
    public async Task<ActionResult<ReviewPromptResponse>> GetPrompt(CancellationToken cancellationToken)
    {
        var user = await users.GetUserAsync(User);
        if (user is null) return Unauthorized();
        if (user.IsAdmin || await DueRound(user, cancellationToken) is not { } round) return NoContent();

        var lapsed = await plans.IsLapsed(user, cancellationToken);
        return Ok(new ReviewPromptResponse(
            round, !lapsed && user.PlanType == Plan.Trial ? TrialBonusDays : null,
            await ProjectNames(user.Id, cancellationToken)));
    }

    /// <summary>Saves the caller's review for the current round. A running trial gets <see cref="TrialBonusDays"/> more.</summary>
    [HttpPost]
    public async Task<ActionResult<SubmitReviewResponse>> Submit(SubmitReviewRequest request, CancellationToken cancellationToken)
    {
        var user = await users.GetUserAsync(User);
        if (user is null) return Unauthorized();
        if (await DueRound(user, cancellationToken) != request.Round)
            return Conflict(new { error = "This review has already been answered." });
        if (string.IsNullOrWhiteSpace(request.Body)) return BadRequest(new { error = "Write a few words about your experience." });
        var projectName = request.MayPublish ? request.ProjectName?.Trim() : null;
        if (!string.IsNullOrEmpty(projectName) && !(await ProjectNames(user.Id, cancellationToken)).Contains(projectName))
            return BadRequest(new { error = "Choose one of your own projects." });

        db.Reviews.Add(new Review
        {
            UserId = user.Id,
            Round = request.Round,
            Stars = request.Stars,
            Body = request.Body.Trim(),
            MayPublish = request.MayPublish,
            ProjectName = string.IsNullOrEmpty(projectName) ? null : projectName,
        });

        DateTimeOffset? trialEndsAt = null;
        if (!await plans.IsLapsed(user, cancellationToken) && user.PlanType == Plan.Trial && user.PlanRenewDate is { } renew)
        {
            trialEndsAt = renew.AddDays(TrialBonusDays);
            user.PlanRenewDate = trialEndsAt;
        }
        // The user is tracked by the same context, so this saves the review and the trial together.
        await db.SaveChangesAsync(cancellationToken);
        return Ok(new SubmitReviewResponse(trialEndsAt));
    }

    /// <summary>The caller does not want to review this round; they are asked again at the next one.</summary>
    [HttpPost("dismiss")]
    public async Task<IActionResult> Dismiss(DismissReviewRequest request, CancellationToken cancellationToken)
    {
        var user = await users.GetUserAsync(User);
        if (user is null) return Unauthorized();
        if (await DueRound(user, cancellationToken) != request.Round) return NoContent();
        db.Reviews.Add(new Review { UserId = user.Id, Round = request.Round, Dismissed = true });
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    /// <summary>The user's current round, unless they have answered or dismissed it already.</summary>
    private async Task<int?> DueRound(ApplicationUser user, CancellationToken cancellationToken)
    {
        if (Review.CurrentRound(user.CreatedAt, DateTimeOffset.UtcNow) is not { } round) return null;
        var answered = await db.Reviews.AnyAsync(review => review.UserId == user.Id && review.Round == round, cancellationToken);
        return answered ? null : round;
    }

    /// <summary>Projects the user is in, which they may choose to name with their review.</summary>
    private Task<List<string>> ProjectNames(string userId, CancellationToken cancellationToken) =>
        db.Projects
            .Where(project => project.Members.Any(member => member.UserId == userId))
            .OrderBy(project => project.Name)
            .Select(project => project.Name)
            .Distinct()
            .ToListAsync(cancellationToken);
}

/// <param name="Round">Days since the account was created that this round asks about (10, 40 or 150).</param>
/// <param name="TrialBonusDays">Days a review adds to the caller's trial; null when they are not on one.</param>
/// <param name="ProjectNames">The caller's projects, to optionally name one with the review.</param>
public sealed record ReviewPromptResponse(int Round, int? TrialBonusDays, IReadOnlyList<string> ProjectNames);

/// <param name="TrialEndsAt">The trial's new end when the review extended it; null otherwise.</param>
public sealed record SubmitReviewResponse(DateTimeOffset? TrialEndsAt);

public sealed record SubmitReviewRequest
{
    [Required]
    public required int Round { get; init; }

    [Required, Range(1, 5)]
    public required int Stars { get; init; }

    [Required, StringLength(2000, MinimumLength = 1)]
    public required string Body { get; init; }

    /// <summary>The review may be shown on the landing page with the user's name.</summary>
    public bool MayPublish { get; init; }

    /// <summary>One of the user's projects to name with the review; ignored unless <see cref="MayPublish"/>.</summary>
    [StringLength(120)]
    public string? ProjectName { get; init; }
}

public sealed record DismissReviewRequest
{
    [Required]
    public required int Round { get; init; }
}
