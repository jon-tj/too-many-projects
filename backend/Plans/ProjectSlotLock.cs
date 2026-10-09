using System.Collections.Concurrent;

namespace Plans;

/// <summary>
/// Makes actions that use up a limited slot run one at a time per key, so two requests at the same moment cannot both
/// see the last free slot and both take it: a user's project slots (keyed by user id) or a project's member slots
/// (keyed "members:{projectId}"). Per server process, which is enough while the app runs as a single instance; several
/// instances would need a database lock instead.
/// </summary>
public static class ProjectSlotLock
{
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> Locks = new();

    /// <summary>Waits for the key's lock; dispose the result to release it.</summary>
    public static async Task<IDisposable> AcquireAsync(string key, CancellationToken cancellationToken)
    {
        var semaphore = Locks.GetOrAdd(key, _ => new SemaphoreSlim(1, 1));
        await semaphore.WaitAsync(cancellationToken);
        return new Release(semaphore);
    }

    private sealed class Release(SemaphoreSlim semaphore) : IDisposable
    {
        private int released;

        public void Dispose()
        {
            if (Interlocked.Exchange(ref released, 1) == 0) semaphore.Release();
        }
    }
}
