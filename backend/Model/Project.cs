namespace Model;

public sealed class Project
{
    public long Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string OwnerId { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    /// <summary>Material icon name; null uses the default icon.</summary>
    public string? Icon { get; set; }
    /// <summary>Small image as a data URL; takes precedence over <see cref="Icon"/>.</summary>
    public string? IconImage { get; set; }
    public ICollection<ProjectMember> Members { get; set; } = new List<ProjectMember>();
    public ICollection<ProjectTask> Tasks { get; set; } = new List<ProjectTask>();
    public ICollection<Canvas> Canvases { get; set; } = new List<Canvas>();
}