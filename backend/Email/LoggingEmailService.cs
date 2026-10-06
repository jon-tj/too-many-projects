namespace Email;

/// <summary>Used when no Resend API key is configured: logs emails instead of sending them.</summary>
public sealed class LoggingEmailService(ILogger<LoggingEmailService> logger) : IEmailService
{
    public Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default)
    {
        logger.LogInformation(
            "Email not sent because no Resend API key is configured. To: {To}, subject: {Subject}",
            message.To, message.Subject);
        return Task.CompletedTask;
    }
}
