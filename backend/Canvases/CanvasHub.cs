using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace Canvases;

/// <summary>
/// Live canvas editing. Clients join a canvas group, send small changes ({ upsert, remove, order }) that
/// are relayed to everyone else on the canvas, and lock the items they drag. Saving stays on the HTTP API.
/// </summary>
[Authorize]
public sealed class CanvasHub(CanvasAccessService access, CanvasLocks locks) : Hub
{
    private string UserId => Context.User!.FindFirstValue(ClaimTypes.NameIdentifier)!;

    /// <summary>Canvas ids this connection has joined, with whether it may write to them.</summary>
    private Dictionary<int, bool> Joined =>
        (Dictionary<int, bool>)(Context.Items["canvases"] ??= new Dictionary<int, bool>());

    private static string Group(int canvasId) => $"canvas-{canvasId}";

    /// <summary>Joins a canvas the user can read and returns the current locks on it.</summary>
    public async Task<IReadOnlyList<CanvasLock>> Join(long projectId, int canvasId)
    {
        var canvas = await access.GetAccess(projectId, canvasId, UserId, Context.ConnectionAborted)
            ?? throw new HubException("This canvas could not be found.");
        Joined[canvasId] = canvas.CanWrite;
        await Groups.AddToGroupAsync(Context.ConnectionId, Group(canvasId));
        return locks.Active(canvasId);
    }

    public async Task Leave(int canvasId)
    {
        Joined.Remove(canvasId);
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, Group(canvasId));
        await ReleaseLock();
    }

    /// <summary>Relays an edit to everyone else on the canvas.</summary>
    public async Task Change(int canvasId, JsonElement change)
    {
        RequireWrite(canvasId);
        locks.Touch(UserId);
        await Clients.OthersInGroup(Group(canvasId)).SendAsync("Changed", UserId, change);
    }

    /// <summary>Locks the items the user starts dragging; false when someone else holds one of them.</summary>
    public async Task<bool> Lock(int canvasId, string[] itemIds)
    {
        RequireWrite(canvasId);
        var userName = Context.User!.FindFirstValue(ClaimTypes.Name) ?? "Someone";
        if (!locks.TryLock(canvasId, UserId, userName, itemIds)) return false;
        await Clients.OthersInGroup(Group(canvasId)).SendAsync("Locks", locks.Active(canvasId));
        return true;
    }

    public Task Unlock() => ReleaseLock();

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await ReleaseLock();
        await base.OnDisconnectedAsync(exception);
    }

    private async Task ReleaseLock()
    {
        if (locks.Release(UserId) is int canvasId)
            await Clients.Group(Group(canvasId)).SendAsync("Locks", locks.Active(canvasId));
    }

    private void RequireWrite(int canvasId)
    {
        if (!Joined.TryGetValue(canvasId, out var canWrite) || !canWrite)
            throw new HubException("You cannot edit this canvas.");
    }
}
