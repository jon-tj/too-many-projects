# Project Management App

This app is hosted on [Render](https://dashboard.render.com) using [Supabase](https://www.supabase.com) for postgres.

## Run locally

Use two terminals from the repository root.

```powershell
dotnet run --project backend/backend.csproj
```

```powershell
Set-Location frontend
npm install
npm start
```

The API runs at `http://localhost:5081` and Angular runs at `http://localhost:4200`. By default, the API uses a local SQLite database at `backend/app.db`; EF Core migrations create and update the schema on startup.

On first startup, Identity seeds a development account with username `jon`, email `piehunter123@gmail.com`, and password `Passw0rd!`. Identity hashes and salts the password. Change or remove these seed credentials before deploying to a shared or production environment.

### Local settings and secrets

`backend/appsettings.json` holds local secrets and is not tracked by git. Create it from the template the first time:

```powershell
Copy-Item backend/appsettings.example.json backend/appsettings.json
```

- `ConnectionStrings:Supabase`: to use Supabase PostgreSQL instead of SQLite, paste the **Session pooler** connection string from Supabase Project Settings > Database, e.g. `Host=<pooler-host>;Port=5432;Database=postgres;Username=<pooler-user>;Password=<database-password>;SSL Mode=Require`. Leave it empty to use the local SQLite database. The application applies the checked-in EF Core migrations on startup.
- `Resend:ApiKey`: your Resend API key. When it is empty, emails are written to the log instead of being sent.
- `Resend:From`: the sender. `onboarding@resend.dev` works for testing but can only deliver to the email address of your Resend account; use an address on a domain you have verified in Resend for real recipients.
- `App:BaseUrl`: the site's address (e.g. `https://toomanyprojects.fyi`) for links in emails sent on a schedule, such as trial reminders.
- `Stripe:*`: payments for the Plus and Pro plans; see [Payments with Stripe](#payments-with-stripe). While `SecretKey` or a price id is empty, plans switch without payment.

Environment variables override these values, e.g. `$env:ConnectionStrings__Supabase = "..."`.

To use the local SQLite database even when a Supabase connection string is configured, run the backend with `--sqlite`:

```powershell
dotnet run --project backend/backend.csproj --sqlite
```

The startup log says which database is in use.

## Deploy to Render

Create a Render **Web Service** from this repository and select **Docker** as the runtime. Render will build the root `Dockerfile`; it builds the Angular frontend, publishes the ASP.NET backend, and serves both from one service. The container listens on Render's `PORT` (default `10000`).

In the Render service environment, add:

- `ConnectionStrings__Supabase`: the Supabase **Session pooler** connection string, including `SSL Mode=Require`. Configure this for persistent hosted data; otherwise the service falls back to SQLite, whose local container file is not persistent across Render deployments.
- `Resend__ApiKey`: your Resend API key.
- `Resend__From`: the sender address, on a domain verified in Resend.
- `Stripe__SecretKey`, `Stripe__WebhookSecret`, `Stripe__PlusPriceId`, `Stripe__ProPriceId`: see below.

Render supplies `PORT` automatically. Do not put credentials in the Dockerfile or source control; `backend/appsettings.json` is excluded from both git and the Docker build.

## Payments with Stripe

Plus and Pro are monthly Stripe subscriptions. Choosing one opens Stripe Checkout; the plan changes when the user comes back paid (and through the webhook, should they not). Users who already subscribe switch between Plus and Pro in place (prorated), and choosing Free ends the subscription at the renew date. **Billing and invoices** on the plans page opens Stripe's customer portal. Exempt users (the admin, and anyone exempted on the admin page) never pay.

### In Stripe

1. **Products**: create a product *Plus* with a recurring monthly price of $3.99 and a product *Pro* with $8.99 (the prices shown in the app are in `frontend/src/components/plan-picker/plan-picker.ts`). Copy each **price id** (`price_...`).
2. **API key**: Developers > API keys: copy the **secret key** (`sk_test_...` in test mode, `sk_live_...` for real payments).
3. **Webhook**: Developers > Webhooks > Add endpoint:
   - URL: `https://<your-render-domain>/api/stripe/webhook`
   - API version: `2026-09-30.endive` (the version the Stripe.net package in the backend uses)
   - Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, and `price.created`, `price.updated`, `price.deleted`, `product.updated` (so a changed price shows at once; otherwise the app picks it up within 10 minutes)

   Copy its **signing secret** (`whsec_...`).
4. **Customer portal**: Settings > Billing > Customer portal: activate it, allow updating payment methods, showing invoices and cancelling (at the end of the billing period). To let people switch plan there too, add both products under *Subscriptions*.
5. **Failed payments**: Settings > Billing > Subscriptions and emails: after all retries fail, **cancel the subscription**. The user then has no plan and their projects freeze until they choose one.

Test mode and live mode have separate keys, prices and webhooks, so do the steps once in each.

### In the app

Set the four values in `backend/appsettings.json` locally, or as environment variables on Render:

```json
"Stripe": {
  "SecretKey": "sk_test_...",
  "WebhookSecret": "whsec_...",
  "PlusPriceId": "price_...",
  "ProPriceId": "price_..."
}
```

Locally, forward webhooks with the [Stripe CLI](https://docs.stripe.com/stripe-cli) and use the `whsec_...` it prints as `WebhookSecret`:

```powershell
stripe listen --forward-to localhost:5081/api/stripe/webhook
```

Test card: `4242 4242 4242 4242`, any future date and CVC.

