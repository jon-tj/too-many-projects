using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;

namespace Accounts;

/// <summary>
/// Refuses the request with 403 unless the caller is an admin (<see cref="Model.ApplicationUser.IsAdmin"/>). Read from
/// the database on every request, so taking the flag away takes effect at once rather than when the token expires.
/// </summary>
public sealed class AdminOnlyFilter(AppDbContext db) : IAsyncAuthorizationFilter
{
    public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var userId = context.HttpContext.User.FindFirstValue(ClaimTypes.NameIdentifier);
        var isAdmin = userId is not null && await db.Users.AnyAsync(
            user => user.Id == userId && user.IsAdmin, context.HttpContext.RequestAborted);
        if (!isAdmin) context.Result = new ForbidResult();
    }
}
