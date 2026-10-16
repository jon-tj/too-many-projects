namespace Model;

/// <summary>Something a user would like TooManyProjects to do, sent from the sidebar; the admin triages it.</summary>
public sealed class FeatureRequest
{
    /// <summary>Where a request stands, set by the admin.</summary>
    public static readonly string[] Statuses = ["new", "planned", "done", "declined"];

    public long Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    /// <summary>One of <see cref="Statuses"/>.</summary>
    public string Status { get; set; } = "new";
    public ApplicationUser User { get; set; } = null!;
}
