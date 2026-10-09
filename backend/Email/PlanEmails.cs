using System.Net;

namespace Email;

/// <summary>Emails about plans. All values are HTML-encoded.</summary>
public static class PlanEmails
{
    /// <summary>A team member asks the project's owner to choose a plan that includes the project, or all its features.</summary>
    public static EmailMessage UpgradeRequest(
        string to, string ownerName, string requesterName, string projectName, bool frozen, string plansUrl) =>
        new(to, $"{requesterName} asks you to upgrade {projectName}", $"""
            <p>Hi {Encode(ownerName)},</p>
            <p>{Encode(requesterName)} would like to keep working in <strong>{Encode(projectName)}</strong> on Too Many Projects,
            but {(frozen
                ? "the project is frozen because your plan does not include it right now"
                : "your plan only includes boards and tasks")}.</p>
            <p>You can change your plan, or choose which of your projects stay active, on the plans page:</p>
            <p><a href="{Encode(plansUrl)}">Manage your plan</a></p>
            """);

    private static string Encode(string value) => WebUtility.HtmlEncode(value);
}
