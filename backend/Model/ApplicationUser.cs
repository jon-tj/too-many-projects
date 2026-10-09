using Microsoft.AspNetCore.Identity;

namespace Model;

public sealed class ApplicationUser : IdentityUser
{
	public string DisplayName { get; set; } = string.Empty;
	/// <summary>Set for users created with a temporary password; cleared when they choose their own.</summary>
	public bool MustChangePassword { get; set; }
	/// <summary>Small square profile picture as an image data URL; null shows the initial instead.</summary>
	public string? AvatarImage { get; set; }
	public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
	/// <summary>When the free trial started at sign-up runs out; null for accounts created before sign-up existed.</summary>
	public DateTimeOffset? TrialEndsAt { get; set; }

	// Answers from the sign-up form, for understanding who signs up.
	public string PrimaryUseCase { get; set; } = string.Empty;
	public string TeamRole { get; set; } = string.Empty;

	// Where the sign-up came from: the utm_* parameters on the link that brought them, and the referring page.
	public string? UtmSource { get; set; }
	public string? UtmMedium { get; set; }
	public string? UtmCampaign { get; set; }
	public string? UtmTerm { get; set; }
	public string? UtmContent { get; set; }
	public string? SignupReferrer { get; set; }
}