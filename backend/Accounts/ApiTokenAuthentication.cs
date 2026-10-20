using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Accounts;

/// <summary>Personal access tokens (see Model.ApiToken): how they look, and how a request signs in with one.</summary>
public static class ApiTokens
{
    public const string Scheme = "ApiToken";
    /// <summary>Every token starts with this, so requests can be told apart from the app's own sign-in tokens.</summary>
    public const string Prefix = "tmp_";

    /// <summary>A new token: the prefix and 256 random bits, URL-safe.</summary>
    public static string Create() =>
        Prefix + Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    /// <summary>The token in an "Authorization: Bearer tmp_…" header; null for anything else.</summary>
    public static string? FromRequest(HttpRequest request)
    {
        var header = request.Headers.Authorization.ToString();
        return header.StartsWith("Bearer " + Prefix, StringComparison.Ordinal) ? header["Bearer ".Length..].Trim() : null;
    }
}

/// <summary>
/// Signs a request in as the owner of its personal access token. The user id goes in the same claim the app's own
/// sign-in uses, so every endpoint works with either.
/// </summary>
public sealed class ApiTokenHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder, AppDbContext db)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (ApiTokens.FromRequest(Request) is not { } token) return AuthenticateResult.NoResult();
        var hash = ApiTokens.Hash(token);
        var found = await db.ApiTokens
            .Where(entry => entry.Hash == hash)
            .Select(entry => new { entry.Id, entry.UserId, entry.LastUsedAt, entry.User.UserName })
            .SingleOrDefaultAsync(Context.RequestAborted);
        if (found is null) return AuthenticateResult.Fail("Unknown or revoked token.");

        // Kept roughly up to date for the settings page, without a write on every request.
        var now = DateTimeOffset.UtcNow;
        if (found.LastUsedAt is not { } used || now - used > TimeSpan.FromHours(1))
            await db.ApiTokens.Where(entry => entry.Id == found.Id)
                .ExecuteUpdateAsync(entry => entry.SetProperty(field => field.LastUsedAt, now), Context.RequestAborted);

        var identity = new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, found.UserId), new Claim(ClaimTypes.Name, found.UserName ?? "")],
            ApiTokens.Scheme);
        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), ApiTokens.Scheme));
    }
}
