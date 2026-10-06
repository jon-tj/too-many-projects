namespace Email;

/// <summary>Sends email. The app depends on this abstraction; Resend is one implementation.</summary>
public interface IEmailService
{
    Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default);
}

/// <summary>A single email to one recipient.</summary>
public sealed record EmailMessage(string To, string Subject, string Html);
