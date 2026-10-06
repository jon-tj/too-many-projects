using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace Canvases;

/// <summary>
/// Live canvas editing. Clients join a canvas group, send small changes ({ upsert, remove, order }) that
/// are relayed to everyone else on the canvas, and lock the items they drag. Everyone in a canvas also sees
/// who else is there, with their timer and dice. Saving stays on the HTTP API.
/// </summary>
[Authorize]
public sealed class CanvasHub(AppDbContext db, CanvasAccessService access, CanvasLocks locks, CanvasPresence presence) : Hub
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

        var user = await db.Users.Where(user => user.Id == UserId)
            .Select(user => new { user.DisplayName, user.UserName, user.AvatarImage })
            .SingleAsync(Context.ConnectionAborted);
        var name = string.IsNullOrEmpty(user.DisplayName) ? user.UserName ?? "Someone" : user.DisplayName;
        presence.Join(canvasId, UserId, name, user.AvatarImage);
        await SendPresence(canvasId);
        return locks.Active(canvasId);
    }

    public async Task Leave(int canvasId)
    {
        if (Joined.Remove(canvasId))
        {
            presence.Leave(canvasId, UserId);
            await SendPresence(canvasId);
        }
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

    /// <summary>Starts (or with 0 removes) the user's timer, shown under their profile to everyone.</summary>
    public async Task SetTimer(int canvasId, int seconds)
    {
        RequireJoined(canvasId);
        if (!CanvasPresence.TimerOptions.Contains(seconds)) throw new HubException("That timer length is not available.");
        presence.SetTimer(canvasId, UserId, seconds);
        await SendPresence(canvasId);
    }

    /// <summary>Rolls on the server, so everyone sees the same result.</summary>
    public async Task RollDice(int canvasId)
    {
        RequireJoined(canvasId);
        presence.RollDice(canvasId, UserId);
        await SendPresence(canvasId);
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        foreach (var canvasId in Joined.Keys)
        {
            presence.Leave(canvasId, UserId);
            await SendPresence(canvasId);
        }
        await ReleaseLock();
        await base.OnDisconnectedAsync(exception);
    }

    private Task SendPresence(int canvasId) => Clients.Group(Group(canvasId)).SendAsync("Presence", presence.List(canvasId));

    private async Task ReleaseLock()
    {
        if (locks.Release(UserId) is int canvasId)
            await Clients.Group(Group(canvasId)).SendAsync("Locks", locks.Active(canvasId));
    }

    private void RequireJoined(int canvasId)
    {
        if (!Joined.ContainsKey(canvasId)) throw new HubException("Join the canvas first.");
    }

    private void RequireWrite(int canvasId)
    {
        if (!Joined.TryGetValue(canvasId, out var canWrite) || !canWrite)
            throw new HubException("You cannot edit this canvas.");
    }
}
