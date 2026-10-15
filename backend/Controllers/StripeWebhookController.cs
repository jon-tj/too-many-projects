using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Payments;

/// <summary>
/// Receives Stripe's events about subscriptions (see StripeBilling.HandleWebhook). Anonymous: Stripe signs every
/// event with the endpoint's secret instead, and anything without a valid signature is refused.
/// </summary>
[ApiController]
[AllowAnonymous]
[Route("api/stripe/webhook")]
public sealed class StripeWebhookController(StripeBilling stripe, ILogger<StripeWebhookController> logger) : ControllerBase
{
    [HttpPost]
    public async Task<IActionResult> Receive(CancellationToken cancellationToken)
    {
        if (!stripe.Enabled) return NotFound();
        // The signature covers the exact bytes Stripe sent, so the body is read as is rather than model-bound.
        using var reader = new StreamReader(Request.Body);
        var json = await reader.ReadToEndAsync(cancellationToken);
        try
        {
            await stripe.HandleWebhook(json, Request.Headers["Stripe-Signature"].ToString(), cancellationToken);
        }
        catch (Stripe.StripeException exception)
        {
            // Wrong signature or secret, or Stripe refused a follow-up call; Stripe retries anything that is not 2xx.
            logger.LogWarning(exception, "Stripe webhook failed.");
            return BadRequest();
        }
        return Ok();
    }
}
