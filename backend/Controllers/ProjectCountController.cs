using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Mvc;

[ApiController]
[Route("api/debug/project-count")]
public sealed class ProjectCountController(
    AppDbContext db,
    ILogger<ProjectCountController> logger) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType<ProjectCountResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ProjectCountErrorResponse>(StatusCodes.Status503ServiceUnavailable)]
    public async Task<ActionResult<ProjectCountResponse>> Get(CancellationToken cancellationToken)
    {
        try
        {
            await db.Database.MigrateAsync(cancellationToken);
            var projectCount = await db.Projects.LongCountAsync(cancellationToken);
            return Ok(new ProjectCountResponse(true, projectCount));
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Unable to retrieve the project count from the database.");
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new ProjectCountErrorResponse(
                false,
                "Database connection or project-count query failed. Check the configured database and Projects table permissions."));
        }
    }
}

/// <summary>Database connectivity and project count returned by the debug endpoint.</summary>
public sealed record ProjectCountResponse(bool DatabaseConnected, long ProjectCount);

/// <summary>Database failure details returned by the debug endpoint.</summary>
public sealed record ProjectCountErrorResponse(bool DatabaseConnected, string Error);