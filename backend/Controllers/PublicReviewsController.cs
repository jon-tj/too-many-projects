using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

/// <summary>The reviews the admin featured, for the landing page. Needs no sign-in.</summary>
[ApiController]
[AllowAnonymous]
[Route("api/public/reviews")]
public sealed class PublicReviewsController(AppDbContext db) : ControllerBase
{
    /// <summary>Featured reviews that their users allowed to be published, newest first; empty when there are none.</summary>
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<PublicReviewResponse>>> Get(CancellationToken cancellationToken)
    {
        var reviews = await db.Reviews.AsNoTracking()
            .Where(review => review.Featured && review.MayPublish && !review.Dismissed)
            .Select(review => new
            {
                review.CreatedAt,
                Response = new PublicReviewResponse(
                    review.Stars ?? 0, review.Body, review.User.DisplayName, review.User.AvatarImage,
                    review.User.CreatedAt, review.ProjectName),
            })
            .ToListAsync(cancellationToken);
        // Ordered in memory: SQLite cannot order by DateTimeOffset.
        return Ok(reviews.OrderByDescending(review => review.CreatedAt).Select(review => review.Response).ToList());
    }
}

/// <param name="MemberSince">When the reviewer created their account.</param>
/// <param name="ProjectName">The project the reviewer allowed to be named; null for none.</param>
public sealed record PublicReviewResponse(
    int Stars, string Body, string Name, string? AvatarImage, DateTimeOffset MemberSince, string? ProjectName);
