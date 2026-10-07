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

Render supplies `PORT` automatically. Do not put credentials in the Dockerfile or source control; `backend/appsettings.json` is excluded from both git and the Docker build.