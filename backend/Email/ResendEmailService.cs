using System.Net.Http.Headers;
using Microsoft.Extensions.Options;

namespace Email;

/// <summary>Settings from the "Resend" configuration section (env vars: Resend__ApiKey, Resend__From).</summary>
public sealed class ResendOptions
{
    public const string Section = "Resend";
    public string ApiKey { get; set; } = string.Empty;
    public string From { get; set; } = string.Empty;
}

/// <summary>Sends email through the Resend REST API (https://resend.com/docs/api-reference/emails/send-email).</summary>
public sealed class ResendEmailService(HttpClient http, IOptions<ResendOptions> options) : IEmailService
{
    public async Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default)
    {
        var settings = options.Value;
        using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.resend.com/emails")
        {
            Content = JsonContent.Create(new
            {
                from = settings.From,
                to = new[] { message.To },
                subject = message.Subject,
                html = message.Html
            })
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.ApiKey);

        using var response = await http.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException($"Resend rejected the email ({(int)response.StatusCode}): {body}");
        }
    }
}
