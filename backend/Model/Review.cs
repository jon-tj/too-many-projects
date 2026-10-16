namespace Model;

/// <summary>
/// A user's answer when asked about their experience, at one of the <see cref="Rounds"/>: a review with stars, or a
/// dismissal, so the same round is not asked again. The admin features reviews the user allowed to be published, and
/// featured reviews are shown on the landing page.
/// </summary>
public sealed class Review
{
    /// <summary>Days after creating their account that users are asked for a review.</summary>
    public static readonly int[] Rounds = [10, 40, 150];

    /// <summary>The round the user is in on the given date: the latest one they have reached, or null before the first.</summary>
    public static int? CurrentRound(DateTimeOffset accountCreatedAt, DateTimeOffset now)
    {
        var days = (now - accountCreatedAt).TotalDays;
        return Rounds.Where(round => days >= round).Select(round => (int?)round).LastOrDefault();
    }

    public long Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    /// <summary>Which of the <see cref="Rounds"/> this answers.</summary>
    public int Round { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    /// <summary>The user said no to this round; the review fields are empty.</summary>
    public bool Dismissed { get; set; }
    /// <summary>1 to 5; null when dismissed.</summary>
    public int? Stars { get; set; }
    public string Body { get; set; } = string.Empty;
    /// <summary>The user allows the review to be shown on the landing page, with their name.</summary>
    public bool MayPublish { get; set; }
    /// <summary>A project of theirs the user allows to be named with the review; null for none. Copied, not linked.</summary>
    public string? ProjectName { get; set; }
    /// <summary>Chosen by the admin for the landing page; only reviews that <see cref="MayPublish"/>.</summary>
    public bool Featured { get; set; }
    public ApplicationUser User { get; set; } = null!;
}
