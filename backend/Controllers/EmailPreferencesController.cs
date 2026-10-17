using System.Net;
using System.Security.Cryptography;
using Email;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// The unsubscribe link in the weekly summary: one click, no sign-in. The token is the user's id signed by the app, so
/// it cannot be made up for someone else.
/// </summary>
[ApiController]
[AllowAnonymous]
[Route("api/email")]
public sealed class EmailPreferencesController(AppDbContext db, IDataProtectionProvider protection) : ControllerBase
{
    [HttpGet("unsubscribe/{token}")]
    public async Task<ContentResult> Unsubscribe(string token, CancellationToken cancellationToken)
    {
        string userId;
        try
        {
            userId = protection.CreateProtector(WeeklySummaries.UnsubscribePurpose).Unprotect(token);
        }
        catch (CryptographicException)
        {
            return Page("This unsubscribe link is not valid. You can turn the weekly summary off in Settings instead.");
        }
        var updated = await db.Users.Where(user => user.Id == userId)
            .ExecuteUpdateAsync(user => user.SetProperty(field => field.WeeklySummary, false), cancellationToken);
        return Page(updated == 0
            ? "This account no longer exists, so it gets no emails."
            : "You are unsubscribed from the weekly summary. You can turn it back on in Settings at any time.");
    }

    private static ContentResult Page(string message) => new()
    {
        ContentType = "text/html; charset=utf-8",
        Content = $"""
            <!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
            <title>TooManyProjects</title>
            <body style="font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;padding:0 16px;color:#29322c">
            <h1 style="font-size:20px">TooManyProjects</h1><p>{WebUtility.HtmlEncode(message)}</p>
            <p><a href="/settings" style="color:#334931">Open Settings</a></p></body>
            """,
    };
}
