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
	/// <summary>When the user last opened the app (to within ten minutes), for weekly and monthly active users; null if never.</summary>
	public DateTimeOffset? LastSeenAt { get; set; }
	/// <summary>Can open the admin page (api/admin) to manage every user and project.</summary>
	public bool IsAdmin { get; set; }
	/// <summary>trial, free, plus or pro (see Plans.Plan); trial is only ever set at registration. Owned projects follow it.</summary>
	public string PlanType { get; set; } = Plans.Plan.Trial;
	/// <summary>
	/// When the plan runs out unless renewed: the end of the trial, or the next renewal of a paid plan. Null on the free
	/// plan, which never runs out. See Plans.Plan.Lapsed.
	/// </summary>
	public DateTimeOffset? PlanRenewDate { get; set; }
	/// <summary>The plan the user had when it last ran out (trial, plus or pro), so it can be named and offered again.</summary>
	public string? PreviousPlanType { get; set; }
	/// <summary>The user's customer in Stripe, made the first time they pay; null until then.</summary>
	public string? StripeCustomerId { get; set; }
	/// <summary>The Stripe subscription paying for the plan; null while nothing is being paid.</summary>
	public string? StripeSubscriptionId { get; set; }
	/// <summary>The subscription ends at the renew date instead of renewing; the user then moves to the free plan.</summary>
	public bool PlanCancelsAtRenewal { get; set; }
	/// <summary>The trial end date the "ends in 7 days" email was sent for; a new end date gets a new email.</summary>
	public DateTimeOffset? TrialWeekReminderFor { get; set; }
	/// <summary>The trial end date the "ends tomorrow" email was sent for.</summary>
	public DateTimeOffset? TrialDayReminderFor { get; set; }
	/// <summary>Wants the Monday summary email; turned off in Settings or by its unsubscribe link.</summary>
	public bool WeeklySummary { get; set; } = true;
	/// <summary>The week ("yyyy-MM-dd" of its Monday) the last weekly summary was sent (or skipped) for.</summary>
	public string? WeeklySummarySentFor { get; set; }

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