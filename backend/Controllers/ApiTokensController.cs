using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using Accounts;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Model;

/// <summary>The caller's personal access tokens, for the CLI and scripts: list, create (shown once) and revoke.</summary>
[ApiController]
[Authorize]
[Route("api/account/tokens")]
public sealed class ApiTokensController(AppDbContext db) : ControllerBase
{
    private const int Limit = 20;

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<ApiTokenResponse>>> List(CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var tokens = await db.ApiTokens.AsNoTracking()
            .Where(token => token.UserId == userId)
            .Select(token => new ApiTokenResponse(token.Id, token.Name, token.Prefix, token.CreatedAt, token.LastUsedAt))
            .ToListAsync(cancellationToken);
        // Ordered in memory: SQLite cannot order by DateTimeOffset.
        return Ok(tokens.OrderByDescending(token => token.CreatedAt).ToList());
    }

    /// <summary>Makes a token and returns it; this is the only time it is shown.</summary>
    [HttpPost]
    public async Task<ActionResult<CreatedApiTokenResponse>> Create(CreateApiTokenRequest request, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        if (await db.ApiTokens.CountAsync(token => token.UserId == userId, cancellationToken) >= Limit)
            return BadRequest(new { error = $"You can have at most {Limit} tokens. Revoke one you no longer use first." });

        var secret = ApiTokens.Create();
        var token = new ApiToken
        {
            UserId = userId,
            Name = request.Name.Trim(),
            Hash = ApiTokens.Hash(secret),
            Prefix = secret[..(ApiTokens.Prefix.Length + 6)],
        };
        db.ApiTokens.Add(token);
        await db.SaveChangesAsync(cancellationToken);
        return Ok(new CreatedApiTokenResponse(
            new ApiTokenResponse(token.Id, token.Name, token.Prefix, token.CreatedAt, null), secret));
    }

    /// <summary>Revokes a token: anything using it is signed out at once.</summary>
    [HttpDelete("{id:long}")]
    public async Task<IActionResult> Revoke(long id, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var deleted = await db.ApiTokens.Where(token => token.Id == id && token.UserId == userId)
            .ExecuteDeleteAsync(cancellationToken);
        return deleted == 0 ? NotFound() : NoContent();
    }
}

/// <param name="Prefix">The token's first characters, e.g. "tmp_Ab3dEf", to tell tokens apart.</param>
public sealed record ApiTokenResponse(long Id, string Name, string Prefix, DateTimeOffset CreatedAt, DateTimeOffset? LastUsedAt);

/// <param name="Token">The whole token; shown only now.</param>
public sealed record CreatedApiTokenResponse(ApiTokenResponse Info, string Token);

public sealed record CreateApiTokenRequest
{
    [Required, StringLength(80, MinimumLength = 1)]
    public required string Name { get; init; }
}
