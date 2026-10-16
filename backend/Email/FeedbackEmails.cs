using System.Net;

namespace Email;

/// <summary>Emails about feedback from users. All values are HTML-encoded.</summary>
public static class FeedbackEmails
{
    /// <summary>Tells an admin that a user sent a feature request.</summary>
    public static EmailMessage FeatureRequest(
        string to, string requesterName, string requesterEmail, string title, string description, string adminUrl) =>
        new(to, $"Feature request: {title}", $"""
            <p><strong>{Encode(requesterName)}</strong> ({Encode(requesterEmail)}) asked for a feature:</p>
            <h2>{Encode(title)}</h2>
            <p style="white-space: pre-line">{Encode(description)}</p>
            <p><a href="{Encode(adminUrl)}">See all feature requests</a></p>
            """);

    private static string Encode(string value) => WebUtility.HtmlEncode(value);
}
