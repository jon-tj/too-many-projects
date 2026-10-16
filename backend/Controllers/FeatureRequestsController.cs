using System.Collections.Concurrent;
using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using Email;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Model;

/// <summary>Users asking for features. Each request is saved for the admin page and emailed to the admins.</summary>
[ApiController]
[Authorize]
[Route("api/feature-requests")]
public sealed class FeatureRequestsController(
    AppDbContext db, IEmailService emailService, ILogger<FeatureRequestsController> logger) : ControllerBase
{
    /// <summary>How many requests one user may send per hour, so a stuck button or a script cannot flood the admins.</summary>
    private const int HourlyLimit = 5;
    private static readonly ConcurrentDictionary<string, List<DateTimeOffset>> Recent = new();

    [HttpPost]
    public async Task<IActionResult> Create(CreateFeatureRequest request, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var title = request.Title.Trim();
        if (title == "") return BadRequest(new { error = "Give the feature a short title." });

        var now = DateTimeOffset.UtcNow;
        var recent = Recent.GetOrAdd(userId, _ => []);
        lock (recent)
        {
            recent.RemoveAll(sent => now - sent > TimeSpan.FromHours(1));
            if (recent.Count >= HourlyLimit)
                return StatusCode(StatusCodes.Status429TooManyRequests,
                    new { error = "Thanks for all the ideas! Please wait a little before sending more." });
            recent.Add(now);
        }

        var requester = await db.Users.AsNoTracking().SingleAsync(user => user.Id == userId, cancellationToken);
        db.FeatureRequests.Add(new FeatureRequest { UserId = userId, Title = title, Description = request.Description.Trim() });
        await db.SaveChangesAsync(cancellationToken);

        // Best effort: the request is saved either way and shows on the admin page.
        var admins = await db.Users.AsNoTracking()
            .Where(user => user.IsAdmin && user.Email != null && user.Email != "")
            .Select(user => user.Email!)
            .ToListAsync(cancellationToken);
        var name = requester.DisplayName != "" ? requester.DisplayName : requester.UserName ?? "";
        foreach (var admin in admins)
        {
            try
            {
                await emailService.SendAsync(FeedbackEmails.FeatureRequest(
                    admin, name, requester.Email ?? "", title, request.Description.Trim(),
                    $"{Request.Scheme}://{Request.Host}/admin"), cancellationToken);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                logger.LogWarning(exception, "Could not email the feature request to {Admin}.", admin);
            }
        }
        return NoContent();
    }
}

public sealed record CreateFeatureRequest
{
    [Required, StringLength(120)]
    public required string Title { get; init; }

    [StringLength(2000)]
    public string Description { get; init; } = string.Empty;
}
