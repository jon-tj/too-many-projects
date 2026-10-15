using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Payments;

/// <summary>The paid plans' prices from Stripe, for the landing page and the plan picker. Needs no sign-in.</summary>
[ApiController]
[AllowAnonymous]
[Route("api/public/plans")]
public sealed class PublicPlansController(StripeBilling stripe) : ControllerBase
{
    /// <summary>Plans whose price could not be read from Stripe are left out; the app shows its own price for them.</summary>
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<PlanPrice>>> Get(CancellationToken cancellationToken) =>
        Ok(await stripe.GetPrices(cancellationToken));
}
