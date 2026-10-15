using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Model;
// Stripe has its own Plan and PlanService.
using Plan = Plans.Plan;
using PlanService = Plans.PlanService;
using Stripe;

namespace Payments;

/// <summary>Stripe settings: appsettings.json locally, Stripe__SecretKey and so on on Render.</summary>
public sealed class StripeOptions
{
    public const string Section = "Stripe";
    /// <summary>sk_test_... or sk_live_... (or a restricted rk_ key).</summary>
    public string SecretKey { get; set; } = string.Empty;
    /// <summary>whsec_...: the signing secret of the webhook endpoint pointing at /api/stripe/webhook.</summary>
    public string WebhookSecret { get; set; } = string.Empty;
    /// <summary>price_...: the monthly recurring price of the Plus plan.</summary>
    public string PlusPriceId { get; set; } = string.Empty;
    /// <summary>price_...: the monthly recurring price of the Pro plan.</summary>
    public string ProPriceId { get; set; } = string.Empty;
}

/// <summary>
/// Paid plans through Stripe: Checkout to start a subscription, the customer portal to manage it, and webhooks to
/// keep the user's plan in step with it. Stripe is the source of truth: the plan follows the subscription's price, and
/// the renew date follows its current period. When no secret key is configured, <see cref="Enabled"/> is false and
/// plans switch without payment as before.
/// </summary>
public sealed class StripeBilling(
    IOptions<StripeOptions> options, AppDbContext db, PlanService plans, ILogger<StripeBilling> logger)
{
    /// <summary>Subscription statuses that keep the paid plan; past_due is Stripe still retrying the payment.</summary>
    private static readonly string[] PayingStatuses = ["active", "trialing", "past_due"];
    /// <summary>Subscription statuses that are over for good.</summary>
    private static readonly string[] EndedStatuses = ["canceled", "unpaid", "incomplete_expired"];

    private readonly StripeOptions settings = options.Value;
    private StripeClient? client;
    private StripeClient Client => client ??= new StripeClient(settings.SecretKey);

    public bool Enabled =>
        !string.IsNullOrWhiteSpace(settings.SecretKey)
        && !string.IsNullOrWhiteSpace(settings.PlusPriceId)
        && !string.IsNullOrWhiteSpace(settings.ProPriceId);

    private string? PriceFor(string plan) => plan switch
    {
        Plan.Plus => settings.PlusPriceId,
        Plan.Pro => settings.ProPriceId,
        _ => null,
    };

    private string? PlanFor(string? priceId) =>
        priceId == settings.PlusPriceId ? Plan.Plus : priceId == settings.ProPriceId ? Plan.Pro : null;

    /// <summary>The prices last read from Stripe, kept for an hour (a few minutes when one could not be read).</summary>
    private static (DateTimeOffset Until, IReadOnlyList<PlanPrice> Prices)? cachedPrices;

    /// <summary>
    /// The paid plans' prices as set in Stripe, for showing them. A plan whose price cannot be read (no secret key, an
    /// unknown price id, Stripe unreachable) is left out, and the app shows its own fallback price instead.
    /// </summary>
    public async Task<IReadOnlyList<PlanPrice>> GetPrices(CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        if (cachedPrices is { } hit && hit.Until > now) return hit.Prices;
        if (string.IsNullOrWhiteSpace(settings.SecretKey)) return [];

        var prices = new List<PlanPrice>();
        foreach (var plan in new[] { Plan.Plus, Plan.Pro })
        {
            if (PriceFor(plan) is not { Length: > 0 } priceId) continue;
            try
            {
                var price = await Client.V1.Prices.GetAsync(priceId, cancellationToken: cancellationToken);
                if (price.UnitAmount is { } amount)
                    prices.Add(new PlanPrice(plan, amount, price.Currency, price.Recurring?.Interval ?? "month",
                        price.Recurring?.IntervalCount ?? 1));
            }
            catch (StripeException exception)
            {
                logger.LogWarning(exception, "Could not read the {Plan} price {Price} from Stripe.", plan, priceId);
            }
        }
        cachedPrices = (now + (prices.Count == 2 ? TimeSpan.FromHours(1) : TimeSpan.FromMinutes(5)), prices);
        return prices;
    }

    /// <summary>
    /// A Checkout page where the user subscribes to the plan. Afterwards Stripe sends them to /plans with the session
    /// id, where <see cref="ConfirmCheckout"/> applies it at once instead of waiting for the webhook.
    /// </summary>
    public async Task<string> CreateCheckout(
        ApplicationUser user, string plan, string baseUrl, CancellationToken cancellationToken)
    {
        var price = PriceFor(plan) ?? throw new ArgumentException($"{plan} is not a paid plan.", nameof(plan));
        if (user.StripeCustomerId is null)
        {
            var customer = await Client.V1.Customers.CreateAsync(new CustomerCreateOptions
            {
                Email = user.Email,
                Name = string.IsNullOrEmpty(user.DisplayName) ? user.UserName : user.DisplayName,
                Metadata = new() { ["userId"] = user.Id },
            }, cancellationToken: cancellationToken);
            user.StripeCustomerId = customer.Id;
            await db.Users.Where(entry => entry.Id == user.Id).ExecuteUpdateAsync(
                entry => entry.SetProperty(field => field.StripeCustomerId, customer.Id), cancellationToken);
        }

        var session = await Client.V1.Checkout.Sessions.CreateAsync(new Stripe.Checkout.SessionCreateOptions
        {
            Mode = "subscription",
            Customer = user.StripeCustomerId,
            ClientReferenceId = user.Id,
            LineItems = [new() { Price = price, Quantity = 1 }],
            SubscriptionData = new() { Metadata = new() { ["userId"] = user.Id } },
            AllowPromotionCodes = true,
            SuccessUrl = $"{baseUrl}/plans?checkout={{CHECKOUT_SESSION_ID}}",
            CancelUrl = $"{baseUrl}/plans?checkout=cancelled",
        }, cancellationToken: cancellationToken);
        return session.Url;
    }

    /// <summary>Applies a finished Checkout session of the user's; sessions of other users are ignored.</summary>
    public async Task ConfirmCheckout(ApplicationUser user, string sessionId, CancellationToken cancellationToken)
    {
        var session = await Client.V1.Checkout.Sessions.GetAsync(sessionId, cancellationToken: cancellationToken);
        if (session.ClientReferenceId != user.Id || session.SubscriptionId is null) return;
        var subscription = await Client.V1.Subscriptions.GetAsync(session.SubscriptionId, cancellationToken: cancellationToken);
        await Sync(subscription, user.Id, cancellationToken);
    }

    /// <summary>
    /// Moves the user's running subscription to another paid plan, prorated on the next invoice, and resumes it if it
    /// was set to end. The plan changes at once.
    /// </summary>
    public async Task ChangePlan(ApplicationUser user, string plan, CancellationToken cancellationToken)
    {
        var price = PriceFor(plan) ?? throw new ArgumentException($"{plan} is not a paid plan.", nameof(plan));
        var subscription = await Client.V1.Subscriptions.GetAsync(user.StripeSubscriptionId!, cancellationToken: cancellationToken);
        subscription = await Client.V1.Subscriptions.UpdateAsync(subscription.Id, new SubscriptionUpdateOptions
        {
            Items = [new() { Id = subscription.Items.Data[0].Id, Price = price }],
            ProrationBehavior = "create_prorations",
            CancelAtPeriodEnd = false,
        }, cancellationToken: cancellationToken);
        await Sync(subscription, user.Id, cancellationToken);
    }

    /// <summary>Ends the subscription at the renew date; the user keeps the paid plan until then, then moves to free.</summary>
    public async Task CancelAtRenewal(ApplicationUser user, CancellationToken cancellationToken)
    {
        var subscription = await Client.V1.Subscriptions.UpdateAsync(user.StripeSubscriptionId!,
            new SubscriptionUpdateOptions { CancelAtPeriodEnd = true }, cancellationToken: cancellationToken);
        await Sync(subscription, user.Id, cancellationToken);
    }

    /// <summary>The Stripe customer portal, for the payment method, invoices and cancelling.</summary>
    public async Task<string> CreatePortal(ApplicationUser user, string returnUrl, CancellationToken cancellationToken)
    {
        var session = await Client.V1.BillingPortal.Sessions.CreateAsync(new Stripe.BillingPortal.SessionCreateOptions
        {
            Customer = user.StripeCustomerId,
            ReturnUrl = returnUrl,
        }, cancellationToken: cancellationToken);
        return session.Url;
    }

    /// <summary>Stops charging a user whose account is being deleted. Best effort: a failure is logged, not thrown.</summary>
    public async Task CancelForDeletedUser(ApplicationUser user, CancellationToken cancellationToken)
    {
        if (!Enabled || user.StripeSubscriptionId is null) return;
        try
        {
            await Client.V1.Subscriptions.CancelAsync(user.StripeSubscriptionId, cancellationToken: cancellationToken);
        }
        catch (StripeException exception)
        {
            logger.LogError(exception, "Could not cancel subscription {Subscription} of deleted user {User}.",
                user.StripeSubscriptionId, user.Id);
        }
    }

    /// <summary>
    /// Verifies and applies a webhook event. Throws <see cref="StripeException"/> when the signature is wrong.
    /// </summary>
    public async Task HandleWebhook(string json, string signature, CancellationToken cancellationToken)
    {
        var stripeEvent = EventUtility.ConstructEvent(json, signature, settings.WebhookSecret,
            throwOnApiVersionMismatch: false);
        switch (stripeEvent.Type)
        {
            case EventTypes.CheckoutSessionCompleted
                when stripeEvent.Data.Object is Stripe.Checkout.Session { SubscriptionId: { } subscriptionId } session:
                var subscription = await Client.V1.Subscriptions.GetAsync(subscriptionId, cancellationToken: cancellationToken);
                await Sync(subscription, session.ClientReferenceId, cancellationToken);
                break;
            case EventTypes.CustomerSubscriptionCreated:
            case EventTypes.CustomerSubscriptionUpdated:
            case EventTypes.CustomerSubscriptionDeleted:
                if (stripeEvent.Data.Object is Subscription changed)
                    await Sync(changed, null, cancellationToken);
                break;
        }
    }

    /// <summary>
    /// Brings the user's plan in step with the subscription. Events can arrive more than once and out of order, so
    /// this only looks at the subscription's current state. A subscription that ended because the user cancelled it
    /// moves them to free; one that ended unpaid lets the plan run out now (no plan, everything frozen).
    /// </summary>
    private async Task Sync(Subscription subscription, string? userId, CancellationToken cancellationToken)
    {
        userId ??= subscription.Metadata.GetValueOrDefault("userId");
        var user = await db.Users.SingleOrDefaultAsync(user =>
            user.StripeCustomerId == subscription.CustomerId || (userId != null && user.Id == userId), cancellationToken);
        if (user is null)
        {
            logger.LogWarning("Stripe subscription {Subscription} belongs to no user.", subscription.Id);
            return;
        }
        // A plan that just ran out becomes none first, so the switch below follows the rules for choosing a plan.
        await plans.IsLapsed(user, cancellationToken);

        var item = subscription.Items.Data.FirstOrDefault();
        var plan = PlanFor(item?.Price?.Id);
        if (PayingStatuses.Contains(subscription.Status) && plan is not null && item is not null)
        {
            user.StripeCustomerId = subscription.CustomerId;
            user.StripeSubscriptionId = subscription.Id;
            user.PlanCancelsAtRenewal = subscription.CancelAtPeriodEnd || subscription.CancelAt is not null;
            await plans.StageSwitch(user, plan, new DateTimeOffset(item.CurrentPeriodEnd, TimeSpan.Zero), cancellationToken);
        }
        else if (EndedStatuses.Contains(subscription.Status) && user.StripeSubscriptionId == subscription.Id)
        {
            user.StripeSubscriptionId = null;
            user.PlanCancelsAtRenewal = false;
            if (subscription.CancellationDetails?.Reason == "cancellation_requested")
                await plans.StageSwitch(user, Plan.Free, null, cancellationToken);
            else if (user.PlanType is Plan.Plus or Plan.Pro)
                // Lapses on the next read, as a plan reaching its renew date does (unless the user is exempt).
                user.PlanRenewDate = DateTimeOffset.UtcNow;
        }
        else
        {
            // incomplete (first payment pending), paused, or an old subscription: nothing to change.
            return;
        }
        await db.SaveChangesAsync(cancellationToken);
    }
}

/// <summary>A paid plan's price as set in Stripe.</summary>
/// <param name="Amount">In the currency's smallest unit, e.g. cents.</param>
/// <param name="Currency">Lowercase ISO code, e.g. usd.</param>
/// <param name="Interval">day, week, month or year; billed every <paramref name="IntervalCount"/> of them.</param>
public sealed record PlanPrice(string Plan, long Amount, string Currency, string Interval, long IntervalCount);
