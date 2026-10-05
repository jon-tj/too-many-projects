using Microsoft.EntityFrameworkCore;
using Model;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
	public DbSet<Project> Projects => Set<Project>();
}