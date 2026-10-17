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
    /// <summary>The project's GitHub repository (https://github.com/...); null when not set.</summary>
    public string? GitHubUrl { get; set; }
    /// <summary>The project's website (http(s)://...); null when not set.</summary>
    public string? WebsiteUrl { get; set; }
    /// <summary>Set when the owner's plan no longer includes the project; nobody can use it until it is unfrozen.</summary>
    public bool Frozen { get; set; }
    public bool BillingEnabled { get; set; }
    public string BillingClientName { get; set; } = string.Empty;
    /// <summary>Who does the work for the client, shown on reports and bills.</summary>
    public string BillingContractorName { get; set; } = string.Empty;
    /// <summary>
    /// The IANA time zone (e.g. Europe/Oslo) whose midnights start each billed day and month; empty counts in UTC.
    /// </summary>
    public string BillingTimeZone { get; set; } = string.Empty;
    /// <summary>ISO 4217 code (e.g. USD, NOK) the cost per hour and every amount on reports and bills are in.</summary>
    public string BillingCurrency { get; set; } = "USD";
    public decimal BillingCostPerHour { get; set; }
    /// <summary>Days with recorded work bill at least this many hours per member.</summary>
    public decimal BillingMinHoursPerDay { get; set; }
    /// <summary>Days bill at most this many hours per member.</summary>
    public decimal BillingMaxHoursPerDay { get; set; } = 8;
    public ICollection<ProjectMember> Members { get; set; } = new List<ProjectMember>();
    public ICollection<ProjectTask> Tasks { get; set; } = new List<ProjectTask>();
    public ICollection<Canvas> Canvases { get; set; } = new List<Canvas>();
}