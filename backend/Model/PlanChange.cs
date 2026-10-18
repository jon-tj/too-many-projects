namespace Model;

/// <summary>
/// A user moving from one plan to another (trial, free, plus, pro or none), for the admin's transition matrix and plan
/// flux. Accounts start on the trial without a row; the log only holds changes after that.
/// </summary>
public sealed class PlanChange
{
    public long Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    public string From { get; set; } = string.Empty;
    public string To { get; set; } = string.Empty;
    /// <summary>When the change took effect; for a plan that ran out, its renew date rather than when it was noticed.</summary>
    public DateTimeOffset At { get; set; }
    public ApplicationUser User { get; set; } = null!;
}
