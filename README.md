# Banking App

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

To use Supabase PostgreSQL instead, set the connection string in the backend terminal before running it. You may need to use session pooler for this to work if you are struggling with connecting.

```powershell
$env:ConnectionStrings__Supabase = "Host=<pooler-host>;Port=5432;Database=postgres;Username=<pooler-user>;Password=<database-password>;SSL Mode=Require"
dotnet run --project backend/backend.csproj
```

Use the **Session pooler** connection string from Supabase Project Settings > Database. Keep the password private and do not commit it. When this variable is set, Supabase replaces the local SQLite database. The application applies the checked-in EF Core migrations on startup.

## Deploy to Render

Create a Render **Web Service** from this repository and select **Docker** as the runtime. Render will build the root `Dockerfile`; it builds the Angular frontend, publishes the ASP.NET backend, and serves both from one service. The container listens on Render's `PORT` (default `10000`).

In the Render service environment, add:

- `ConnectionStrings__Supabase`: the Supabase **Session pooler** connection string, including `SSL Mode=Require`. Configure this for persistent hosted data; otherwise the service falls back to SQLite, whose local container file is not persistent across Render deployments.

Render supplies `PORT` automatically. Do not put Supabase credentials in the Dockerfile or source control.