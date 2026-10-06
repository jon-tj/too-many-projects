using System.Collections.Concurrent;

namespace Canvases;

/// <summary>Items a user is dragging on a canvas. UpdatedAt is refreshed while they keep moving them.</summary>
public sealed record CanvasLock(string UserId, string UserName, int CanvasId, string[] ItemIds, DateTimeOffset UpdatedAt);

/// <summary>
/// One lock per user, kept in memory: locks only matter while someone is connected, and the free Render
/// tier runs a single instance. A lock not updated for a minute is ignored.
/// </summary>
public sealed class CanvasLocks
{
    private static readonly TimeSpan Timeout = TimeSpan.FromMinutes(1);
    private readonly ConcurrentDictionary<string, CanvasLock> byUser = new();
    private readonly Lock gate = new();

    public IReadOnlyList<CanvasLock> Active(int canvasId) =>
        byUser.Values.Where(item => item.CanvasId == canvasId && IsActive(item)).ToList();

    /// <summary>Takes the items unless another user's active lock already holds one of them.</summary>
    public bool TryLock(int canvasId, string userId, string userName, string[] itemIds)
    {
        lock (gate)
        {
            var taken = byUser.Values.Any(other =>
                other.UserId != userId && other.CanvasId == canvasId && IsActive(other) && other.ItemIds.Intersect(itemIds).Any());
            if (taken) return false;
            byUser[userId] = new CanvasLock(userId, userName, canvasId, itemIds, DateTimeOffset.UtcNow);
            return true;
        }
    }

    /// <summary>Keeps the user's lock alive while they are still moving the items.</summary>
    public void Touch(string userId)
    {
        if (byUser.TryGetValue(userId, out var current))
            byUser[userId] = current with { UpdatedAt = DateTimeOffset.UtcNow };
    }

    /// <summary>Releases the user's lock; returns the canvas it was on, if any.</summary>
    public int? Release(string userId) => byUser.TryRemove(userId, out var removed) ? removed.CanvasId : null;

    private static bool IsActive(CanvasLock item) => DateTimeOffset.UtcNow - item.UpdatedAt < Timeout;
}
