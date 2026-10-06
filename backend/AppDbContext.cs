using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Model;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options)
    : IdentityDbContext<ApplicationUser>(options)
{
	public DbSet<Project> Projects => Set<Project>();
	public DbSet<ProjectMember> ProjectMembers => Set<ProjectMember>();
	public DbSet<ProjectTask> ProjectTasks => Set<ProjectTask>();
	public DbSet<Canvas> Canvases => Set<Canvas>();
	public DbSet<CanvasPermission> CanvasPermissions => Set<CanvasPermission>();

	protected override void OnModelCreating(ModelBuilder builder)
	{
		base.OnModelCreating(builder);

		builder.Entity<ProjectMember>().HasKey(member => new { member.ProjectId, member.UserId });
		builder.Entity<CanvasPermission>().HasKey(permission => new { permission.CanvasId, permission.UserId });
		builder.Entity<Canvas>().Property(canvas => canvas.Name).HasMaxLength(120);
		builder.Entity<ProjectMember>()
			.HasOne(member => member.Project)
			.WithMany(project => project.Members)
			.HasForeignKey(member => member.ProjectId);
		builder.Entity<ProjectMember>()
			.HasOne(member => member.User)
			.WithMany()
			.HasForeignKey(member => member.UserId);

		builder.Entity<Project>()
			.HasOne<ApplicationUser>()
			.WithMany()
			.HasForeignKey(project => project.OwnerId)
			.OnDelete(DeleteBehavior.Restrict);

		builder.Entity<ProjectTask>()
			.HasOne(task => task.Project)
			.WithMany(project => project.Tasks)
			.HasForeignKey(task => task.ProjectId);
		builder.Entity<ProjectTask>().HasIndex(task => new { task.ProjectId, task.Status });
		builder.Entity<ProjectTask>().HasIndex(task => task.AssigneeUserId);
	}
}