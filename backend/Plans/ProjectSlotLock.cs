using System.Collections.Concurrent;

namespace Plans;

/// <summary>
/// Makes one user's slot-using actions (creating or unfreezing a project) run one at a time, so two requests at the
/// same moment cannot both see a free slot and both take it. Per server process, which is enough while the app runs
/// as a single instance; several instances would need a database lock instead.
/// </summary>
public static class ProjectSlotLock
{
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> Locks = new();

    /// <summary>Waits for the user's lock; dispose the result to release it.</summary>
    public static async Task<IDisposable> AcquireAsync(string userId, CancellationToken cancellationToken)
    {
        var semaphore = Locks.GetOrAdd(userId, _ => new SemaphoreSlim(1, 1));
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
