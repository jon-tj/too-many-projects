using System.Net;

namespace Email;

/// <summary>Emails sent when someone is added to a project. All values are HTML-encoded.</summary>
public static class MemberEmails
{
    public static EmailMessage NewUser(
        string to, string userName, string password, string projectName, string inviterName, string role, string signInUrl) =>
        new(to, $"You've been added to {projectName}", $"""
            <p>Hi {Encode(userName)},</p>
            <p>{Encode(inviterName)} added you to <strong>{Encode(projectName)}</strong> on Too Many Projects as {Encode(role)}.</p>
            <p>Sign in at <a href="{Encode(signInUrl)}">{Encode(signInUrl)}</a> with:</p>
            <p>Username: <strong>{Encode(userName)}</strong><br>Temporary password: <strong>{Encode(password)}</strong></p>
            <p>You will be asked to choose your own password the first time you sign in.</p>
            """);

    public static EmailMessage ExistingUser(
        string to, string name, string projectName, string inviterName, string role, string signInUrl) =>
        new(to, $"You've been added to {projectName}", $"""
            <p>Hi {Encode(name)},</p>
            <p>{Encode(inviterName)} added you to <strong>{Encode(projectName)}</strong> on Too Many Projects as {Encode(role)}.</p>
            <p><a href="{Encode(signInUrl)}">Open Too Many Projects</a></p>
            """);

    private static string Encode(string value) => WebUtility.HtmlEncode(value);
}
