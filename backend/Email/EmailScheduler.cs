namespace Email;

/// <summary>
/// Sends the emails that are due by time rather than by a request: shortly after startup, then every 30 minutes. Fine
/// while the app runs as a single instance; several instances would each send.
/// </summary>
public sealed class EmailScheduler(IServiceScopeFactory scopes, ILogger<EmailScheduler> logger) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(30);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Lets startup (and its migrations) finish first.
        await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);
        using var timer = new PeriodicTimer(Interval);
        do
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                await scope.ServiceProvider.GetRequiredService<TrialReminders>().SendDue(stoppingToken);
                await scope.ServiceProvider.GetRequiredService<WeeklySummaries>().SendDue(stoppingToken);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                logger.LogError(exception, "Scheduled emails failed; trying again in {Interval}.", Interval);
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
