using Microsoft.EntityFrameworkCore;
using Model;

namespace Canvases;

/// <summary>A canvas and what the caller may do with it.</summary>
public sealed record CanvasAccess(Canvas Canvas, bool CanWrite, bool IsOwner);

/// <summary>Canvas permission rules, shared by the canvas endpoints and the live-editing hub.</summary>
public sealed class CanvasAccessService(AppDbContext db, Plans.PlanService plans)
{
    /// <summary>Owners always have full access; otherwise an override applies, else the role default.</summary>
    public static (bool CanRead, bool CanWrite) Effective(string role, CanvasPermission? permission) =>
        role == "Owner" ? (true, true)
        : permission is not null ? (permission.CanRead, permission.CanWrite)
        : role == "External" ? (false, false)
        : (true, true);

    public Task<ProjectMember?> GetMember(long projectId, string userId, CancellationToken cancellationToken) =>
        db.ProjectMembers.AsNoTracking().SingleOrDefaultAsync(
            member => member.ProjectId == projectId && member.UserId == userId, cancellationToken);

    /// <summary>The canvas and the user's access to it, or null when they cannot read it.</summary>
    public async Task<CanvasAccess?> GetAccess(
        long projectId, int canvasId, string userId, CancellationToken cancellationToken)
    {
        var member = await GetMember(projectId, userId, cancellationToken);
        if (member is null) return null;
        // Canvases need full features and an unfrozen project; this also covers the live-editing hub.
        if (await plans.GetStatus(projectId, cancellationToken) is { } status && (status.Frozen || !status.FullFeatures))
            return null;

        var canvas = await db.Canvases.SingleOrDefaultAsync(
            canvas => canvas.Id == canvasId && canvas.ProjectId == projectId, cancellationToken);
        if (canvas is null) return null;

        var permission = await db.CanvasPermissions.AsNoTracking().SingleOrDefaultAsync(
            permission => permission.CanvasId == canvasId && permission.UserId == member.UserId, cancellationToken);
        var (canRead, canWrite) = Effective(member.Role, permission);
        return canRead ? new CanvasAccess(canvas, canWrite, member.Role == "Owner") : null;
    }
}
