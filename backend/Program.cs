using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

var supabaseConnectionString = builder.Configuration.GetConnectionString("Supabase");
var localDatabasePath = Path.Combine(builder.Environment.ContentRootPath, "app.db");
builder.Services.AddDbContext<AppDbContext>(options =>
{
    if (!string.IsNullOrWhiteSpace(supabaseConnectionString))
    {
        options.UseNpgsql(supabaseConnectionString);
    }
    else
    {
        options.UseSqlite($"Data Source={localDatabasePath}");
    }
});
builder.Services.AddControllers();

// Add services to the container.
// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();

var app = builder.Build();

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

app.MapControllers();

app.Run();
