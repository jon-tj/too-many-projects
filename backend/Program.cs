using Accounts;
using Email;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authentication.BearerToken;
using Microsoft.AspNetCore.Identity;
using Model;

var builder = WebApplication.CreateBuilder(args);

var supabaseConnectionString = builder.Configuration.GetConnectionString("Supabase");
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
// "Remember me" keeps the refresh token in the browser; each refresh issues a new one, valid for 15 days.
builder.Services.Configure<BearerTokenOptions>(IdentityConstants.BearerScheme, options =>
    options.RefreshTokenExpiration = TimeSpan.FromDays(15));
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
builder.Services.AddControllers();

// Add services to the container.
// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();

var app = builder.Build();

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
            DisplayName = "Jon"
        };
        var result = await userManager.CreateAsync(jon, "Passw0rd!");
        if (!result.Succeeded)
        {
            throw new InvalidOperationException($"Could not seed the jon account: {string.Join("; ", result.Errors.Select(error => error.Description))}");
        }
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

app.UseAuthentication();
app.UseAuthorization();

app.MapGroup("/api/auth").MapIdentityApi<ApplicationUser>();
app.MapControllers();

app.Run();
