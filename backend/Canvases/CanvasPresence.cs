namespace Canvases;

/// <summary>
/// Someone in a canvas with their timer and last dice roll. Times are relative to now (TimerRemainingMs is
/// negative once the timer has ended), so clients do not depend on matching clocks. DiceRollId changes on every
/// roll, so a repeated value still animates.
/// </summary>
public sealed record PresenceView(
    string UserId, string Name, string? Avatar, int? TimerSeconds, long? TimerRemainingMs, int? Dice, long? DiceRollId,
    long? DiceAgeMs);

/// <summary>Who is in each canvas, kept in memory like the locks (single instance on the free Render tier).</summary>
public sealed class CanvasPresence
{
    /// <summary>The timer lengths the timer button cycles through; 0 removes the timer.</summary>
    public static readonly int[] TimerOptions = [0, 10, 30, 300, 1800];

    private sealed class Entry
    {
        public required string Name { get; init; }
        public string? Avatar { get; init; }
        public int Connections { get; set; }
        public int? TimerSeconds { get; set; }
        public DateTimeOffset? TimerEndsAt { get; set; }
        public int? Dice { get; set; }
        public long? DiceRollId { get; set; }
        public DateTimeOffset? DiceRolledAt { get; set; }
    }

    private readonly Dictionary<int, Dictionary<string, Entry>> byCanvas = new();
    private readonly Lock gate = new();
    private long rolls;

    /// <summary>Counts connections, so a second tab does not make the person appear twice or leave early.</summary>
    public void Join(int canvasId, string userId, string name, string? avatar)
    {
        lock (gate)
        {
            if (!byCanvas.TryGetValue(canvasId, out var people)) byCanvas[canvasId] = people = new();
            if (!people.TryGetValue(userId, out var entry)) people[userId] = entry = new Entry { Name = name, Avatar = avatar };
            entry.Connections++;
        }
    }

    public void Leave(int canvasId, string userId)
    {
        lock (gate)
        {
            if (!byCanvas.TryGetValue(canvasId, out var people) || !people.TryGetValue(userId, out var entry)) return;
            if (--entry.Connections > 0) return;
            people.Remove(userId);
            if (people.Count == 0) byCanvas.Remove(canvasId);
        }
    }

    public void SetTimer(int canvasId, string userId, int seconds) => Update(canvasId, userId, entry =>
    {
        entry.TimerSeconds = seconds == 0 ? null : seconds;
        entry.TimerEndsAt = seconds == 0 ? null : DateTimeOffset.UtcNow.AddSeconds(seconds);
    });

    public void RollDice(int canvasId, string userId) => Update(canvasId, userId, entry =>
    {
        entry.Dice = Random.Shared.Next(1, 7);
        entry.DiceRollId = Interlocked.Increment(ref rolls);
        entry.DiceRolledAt = DateTimeOffset.UtcNow;
    });

    public IReadOnlyList<PresenceView> List(int canvasId)
    {
        lock (gate)
        {
            if (!byCanvas.TryGetValue(canvasId, out var people)) return [];
            var now = DateTimeOffset.UtcNow;
            return people.Select(pair => new PresenceView(
                pair.Key,
                pair.Value.Name,
                pair.Value.Avatar,
                pair.Value.TimerSeconds,
                pair.Value.TimerEndsAt is { } endsAt ? (long)(endsAt - now).TotalMilliseconds : null,
                pair.Value.Dice,
                pair.Value.DiceRollId,
                pair.Value.DiceRolledAt is { } rolledAt ? (long)(now - rolledAt).TotalMilliseconds : null)).ToList();
        }
    }

    private void Update(int canvasId, string userId, Action<Entry> change)
    {
        lock (gate)
        {
            if (byCanvas.TryGetValue(canvasId, out var people) && people.TryGetValue(userId, out var entry)) change(entry);
        }
    }
}
