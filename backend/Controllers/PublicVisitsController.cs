using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Model;

/// <summary>Counts anonymous visits to the landing and sign-up pages (see Visit). Needs no sign-in.</summary>
[ApiController]
[AllowAnonymous]
[Route("api/public/visits")]
public sealed class PublicVisitsController(AppDbContext db) : ControllerBase
{
    /// <summary>Records the visit once; sending the same id again changes nothing.</summary>
    [HttpPost]
    public async Task<IActionResult> Record(RecordVisitRequest request, CancellationToken cancellationToken)
    {
        if (request.Id == Guid.Empty) return BadRequest();
        if (!await db.Visits.AnyAsync(visit => visit.Id == request.Id, cancellationToken))
        {
            db.Visits.Add(new Visit { Id = request.Id });
            try
            {
                await db.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateException)
            {
                // The same tab sent it twice at once; one of them was recorded.
            }
        }
        return NoContent();
    }
}

public sealed record RecordVisitRequest(Guid Id);
