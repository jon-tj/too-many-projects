using Accounts;
using Canvases;
using Email;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authentication.BearerToken;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Model;

// `dotnet run --sqlite` uses the local SQLite database even when a Supabase connection string is configured.
// The flag is removed before configuration reads the arguments, where it would otherwise expect a value.
var useSqlite = args.Contains("--sqlite");
var builder = WebApplication.CreateBuilder(args.Where(arg => arg != "--sqlite").ToArray());

var supabaseConnectionString = useSqlite ? null : builder.Configuration.GetConnectionString("Supabase");
var localDatabasePath = Path.Combine(builder.Environment.ContentRootPath, "app.db");
builder.Services.AddDbContext<AppDbContext>(options =>
{
    options.ConfigureWarnings(warnings => warnings.Ignore(
        Microsoft.EntityFrameworkCore.Diagnostics.RelationalEventId.PendingModelChangesWarning));

    if (!string.IsNullOrWhiteSpace(supabaseConnectionString))
    {
        options.UseNpgsql(supabaseConnectionString);
    }
    else
    {
        options.UseSqlite($"Data Source={localDatabasePath}");
    }
});
// Sign-in tokens are encrypted with Data Protection keys. Keeping the keys in the database (instead of the
// container's file system) means a new Render deploy can still read tokens issued before it.
builder.Services.AddDataProtection()
    .SetApplicationName("too-many-projects")
    .PersistKeysToDbContext<AppDbContext>();

// "Remember me" keeps the refresh token in the browser; each refresh issues a new one, valid for 15 days.
builder.Services.Configure<BearerTokenOptions>(IdentityConstants.BearerScheme, options =>
{
    options.RefreshTokenExpiration = TimeSpan.FromDays(15);
    // Browsers cannot set headers on WebSocket requests, so the live canvas hub sends the token in the URL.
    options.Events.OnMessageReceived = context =>
    {
        if (context.Request.Path.StartsWithSegments("/hubs") && context.Request.Query.TryGetValue("access_token", out var token))
            context.Token = token;
        return Task.CompletedTask;
    };
});
builder.Services.AddIdentityApiEndpoints<ApplicationUser>()
    .AddEntityFrameworkStores<AppDbContext>();
builder.Services.AddAuthorization();

// Email: Resend when an API key is configured (appsettings.json locally, Resend__ApiKey on Render), otherwise log only.
var resendSettings = builder.Configuration.GetSection(ResendOptions.Section);
builder.Services.Configure<ResendOptions>(resendSettings);
if (!string.IsNullOrWhiteSpace(resendSettings[nameof(ResendOptions.ApiKey)]))
    builder.Services.AddHttpClient<IEmailService, ResendEmailService>();
else
    builder.Services.AddSingleton<IEmailService, LoggingEmailService>();
builder.Services.AddScoped<UserRemoval>();
builder.Services.AddScoped<Plans.PlanService>();
builder.Services.AddScoped<CanvasAccessService>();
builder.Services.AddSingleton<CanvasLocks>();
builder.Services.AddSingleton<CanvasPresence>();
builder.Services.AddSignalR();
// Frozen projects and free-plan limits are enforced for every endpoint marked with [RequiresProject].
builder.Services.AddControllers(options => options.Filters.Add<Plans.ProjectFeatureFilter>());

// Add services to the container.
// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();

var app = builder.Build();
app.Logger.LogInformation(
    string.IsNullOrWhiteSpace(supabaseConnectionString) ? "Database: local SQLite ({Path})" : "Database: Supabase (Postgres)",
    localDatabasePath);

await using (var scope = app.Services.CreateAsyncScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await db.Database.MigrateAsync();

    var userManager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
    if (await userManager.FindByNameAsync("jon") is null)
    {
        var jon = new ApplicationUser
        {
            UserName = "jon",
            Email = "piehunter123@gmail.com",
            EmailConfirmed = true,
            DisplayName = "Jon",
            PlanType = Plans.Plan.Pro
        };
        var result = await userManager.CreateAsync(jon, "Passw0rd!");
        if (!result.Succeeded)
        {
            throw new InvalidOperationException($"Could not seed the jon account: {string.Join("; ", result.Errors.Select(error => error.Description))}");
        }
    }

    // The admin's plan never lapses.
    var admin = (await userManager.FindByNameAsync("jon"))!;
    if (!await db.PlanExemptions.AnyAsync(exemption => exemption.UserId == admin.Id))
    {
        db.PlanExemptions.Add(new PlanExemption { UserId = admin.Id, Note = "Admin" });
        await db.SaveChangesAsync();
    }
    else if (app.Environment.IsDevelopment())
    {
        var jon = (await userManager.FindByNameAsync("jon"))!;
        if (!await userManager.CheckPasswordAsync(jon, "Passw0rd!"))
        {
            if (await userManager.HasPasswordAsync(jon))
            {
                var removePassword = await userManager.RemovePasswordAsync(jon);
                if (!removePassword.Succeeded)
                    throw new InvalidOperationException("Could not refresh the development Jon password.");
            }

            var addPassword = await userManager.AddPasswordAsync(jon, "Passw0rd!");
            if (!addPassword.Succeeded)
                throw new InvalidOperationException($"Could not refresh the development Jon password: {string.Join("; ", addPassword.Errors.Select(error => error.Description))}");
        }

        await userManager.ResetAccessFailedCountAsync(jon);
        await userManager.SetLockoutEndDateAsync(jon, null);
    }
}

// Configure the HTTP request pipeline.
if (Directory.Exists(Path.Combine(app.Environment.ContentRootPath, "wwwroot")))
{
    app.UseDefaultFiles();
    app.UseStaticFiles();
    app.MapFallbackToFile("index.html");
}

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

if (!app.Environment.IsDevelopment())
{
    app.UseHttpsRedirection();
}

// Accounts are created through /api/signup, which also records the trial and the sign-up answers, so Identity's
// own register endpoint (mapped below with the other auth endpoints) is switched off.
app.Use(async (context, next) =>
{
    if (HttpMethods.IsPost(context.Request.Method)
        && context.Request.Path.Equals("/api/auth/register", StringComparison.OrdinalIgnoreCase))
    {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        return;
    }
    await next();
});

app.UseAuthentication();
app.UseAuthorization();

app.MapGroup("/api/auth").MapIdentityApi<ApplicationUser>();
app.MapControllers();
app.MapHub<CanvasHub>("/hubs/canvas");

app.Run();
