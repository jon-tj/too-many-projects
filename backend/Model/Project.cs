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
    /// <summary>Who does the work for the client: the sender on every document.</summary>
    public string BillingContractorName { get; set; } = string.Empty;
    /// <summary>
    /// The IANA time zone (e.g. Europe/Oslo) whose midnights start each billed day and month; empty counts in UTC.
    /// </summary>
    public string BillingTimeZone { get; set; } = string.Empty;
    /// <summary>ISO 4217 code (e.g. USD, NOK) the cost per hour and every amount on reports and bills are in.</summary>
    public string BillingCurrency { get; set; } = "USD";
    /// <summary>VAT added on top of each bill, in percent (e.g. 25); 0 adds none.</summary>
    public decimal BillingVatRate { get; set; }
    /// <summary>The contractor's postal address, one line per line, shown under their name on documents.</summary>
    public string BillingContractorAddress { get; set; } = string.Empty;
    /// <summary>The contractor's organisation or VAT number, shown on documents.</summary>
    public string BillingOrgNumber { get; set; } = string.Empty;
    /// <summary>How to pay (bank account, IBAN, reference), shown on bills.</summary>
    public string BillingPaymentDetails { get; set; } = string.Empty;
    /// <summary>Days after a bill is issued that it is due.</summary>
    public int BillingPaymentTermsDays { get; set; } = 14;
    public decimal BillingCostPerHour { get; set; }
    /// <summary>Days with recorded work bill at least this many hours per member.</summary>
    public decimal BillingMinHoursPerDay { get; set; }
    /// <summary>Days bill at most this many hours per member.</summary>
    public decimal BillingMaxHoursPerDay { get; set; } = 8;
    /// <summary>The accent colour on documents, "#rrggbb"; empty uses the default.</summary>
    public string BrandColor { get; set; } = string.Empty;
    /// <summary>The contractor's logo on documents, as a data URL; null shows the project's icon instead.</summary>
    public string? BrandLogo { get; set; }
    public ICollection<ProjectMember> Members { get; set; } = new List<ProjectMember>();
    public ICollection<ProjectTask> Tasks { get; set; } = new List<ProjectTask>();
    public ICollection<Canvas> Canvases { get; set; } = new List<Canvas>();
}