using System.Net;

namespace Email;

/// <summary>Emails about a free trial running out. All values are HTML-encoded.</summary>
public static class TrialEmails
{
    /// <param name="endsIn">e.g. "in 7 days", or "tomorrow".</param>
    /// <param name="freeProjectLimit">Active projects the free plan keeps.</param>
    public static EmailMessage Ending(
        string to, string name, string endsIn, DateTimeOffset endsAt, int ownedProjects, int freeProjectLimit,
        string plansUrl) =>
        new(to, $"Your TooManyProjects trial ends {endsIn}", $"""
            <p>Hi {Encode(name)},</p>
            <p>Your free trial of TooManyProjects ends <strong>{Encode(endsIn)}</strong>, on {endsAt:MMMM d}.</p>
            <p>Nothing is lost when it ends: {(ownedProjects == 1 ? "your project is" : $"your {ownedProjects} projects are")}
            frozen, not deleted, and every task, canvas and hour stays exactly where it is.</p>
            <p>To keep working without a break, choose a plan before then. Free keeps up to {freeProjectLimit} projects
            active with boards and tasks; Plus and Pro keep everything, and only the project owner pays.</p>
            <p><a href="{Encode(plansUrl)}">Choose a plan</a></p>
            """);

    private static string Encode(string value) => WebUtility.HtmlEncode(value);
}
