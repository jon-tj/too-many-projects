using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Model;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options)
    : IdentityDbContext<ApplicationUser>(options), IDataProtectionKeyContext
{
	public DbSet<Project> Projects => Set<Project>();
	public DbSet<ProjectMember> ProjectMembers => Set<ProjectMember>();
	public DbSet<ProjectTask> ProjectTasks => Set<ProjectTask>();
	public DbSet<TaskDependency> TaskDependencies => Set<TaskDependency>();
	public DbSet<Canvas> Canvases => Set<Canvas>();
	public DbSet<CanvasPermission> CanvasPermissions => Set<CanvasPermission>();
	public DbSet<CanvasImage> CanvasImages => Set<CanvasImage>();
	public DbSet<WorkSession> WorkSessions => Set<WorkSession>();
	public DbSet<Bill> Bills => Set<Bill>();
	public DbSet<PlanExemption> PlanExemptions => Set<PlanExemption>();
	public DbSet<Review> Reviews => Set<Review>();
	public DbSet<FeatureRequest> FeatureRequests => Set<FeatureRequest>();
	public DbSet<ShareLink> ShareLinks => Set<ShareLink>();
	public DbSet<PaidSpell> PaidSpells => Set<PaidSpell>();
	public DbSet<PlanChange> PlanChanges => Set<PlanChange>();
	public DbSet<Visit> Visits => Set<Visit>();
	public DbSet<ApiToken> ApiTokens => Set<ApiToken>();
	/// <summary>Keys that encrypt sign-in tokens, kept in the database so deploys do not sign everyone out.</summary>
	public DbSet<DataProtectionKey> DataProtectionKeys => Set<DataProtectionKey>();

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
		builder.Entity<PlanExemption>().HasKey(exemption => exemption.UserId);
		builder.Entity<PlanExemption>()
			.HasOne(exemption => exemption.User)
			.WithOne()
			.HasForeignKey<PlanExemption>(exemption => exemption.UserId);
		builder.Entity<WorkSession>().Property(session => session.Message).HasMaxLength(1000);
		builder.Entity<PaidSpell>()
			.HasOne(spell => spell.User)
			.WithMany()
			.HasForeignKey(spell => spell.UserId)
			.OnDelete(DeleteBehavior.Cascade);
		builder.Entity<PlanChange>()
			.HasOne(change => change.User)
			.WithMany()
			.HasForeignKey(change => change.UserId)
			.OnDelete(DeleteBehavior.Cascade);
		builder.Entity<PlanChange>().Property(change => change.From).HasMaxLength(16);
		builder.Entity<PlanChange>().Property(change => change.To).HasMaxLength(16);
		builder.Entity<Visit>().Property(visit => visit.Id).ValueGeneratedNever();
		builder.Entity<ApiToken>()
			.HasOne(token => token.User)
			.WithMany()
			.HasForeignKey(token => token.UserId)
			.OnDelete(DeleteBehavior.Cascade);
		builder.Entity<ApiToken>().HasIndex(token => token.Hash).IsUnique();
		builder.Entity<ApiToken>().Property(token => token.Hash).HasMaxLength(64);
		builder.Entity<ApiToken>().Property(token => token.Name).HasMaxLength(80);
		builder.Entity<ApiToken>().Property(token => token.Prefix).HasMaxLength(16);
		builder.Entity<ShareLink>().HasKey(link => link.Token);
		builder.Entity<ShareLink>().Property(link => link.Token).HasMaxLength(32);
		builder.Entity<ShareLink>().Property(link => link.Month).HasMaxLength(7);
		builder.Entity<ShareLink>()
			.HasOne(link => link.Project)
			.WithMany()
			.HasForeignKey(link => link.ProjectId)
			.OnDelete(DeleteBehavior.Cascade);
		builder.Entity<ShareLink>().HasIndex(link => link.ProjectId);
		builder.Entity<FeatureRequest>()
			.HasOne(request => request.User)
			.WithMany()
			.HasForeignKey(request => request.UserId)
			.OnDelete(DeleteBehavior.Cascade);
		builder.Entity<FeatureRequest>().Property(request => request.Title).HasMaxLength(120);
		builder.Entity<FeatureRequest>().Property(request => request.Description).HasMaxLength(2000);
		builder.Entity<Review>()
			.HasOne(review => review.User)
			.WithMany()
			.HasForeignKey(review => review.UserId)
			.OnDelete(DeleteBehavior.Cascade);
		builder.Entity<Review>().HasIndex(review => new { review.UserId, review.Round }).IsUnique();
		builder.Entity<Review>().Property(review => review.Body).HasMaxLength(2000);
		builder.Entity<Review>().Property(review => review.ProjectName).HasMaxLength(120);
		builder.Entity<TaskDependency>().HasKey(dependency => new { dependency.TaskId, dependency.DependsOnTaskId });
		builder.Entity<TaskDependency>()
			.HasOne(dependency => dependency.Task)
			.WithMany(task => task.Dependencies)
			.HasForeignKey(dependency => dependency.TaskId);
		builder.Entity<TaskDependency>()
			.HasOne(dependency => dependency.DependsOn)
			.WithMany(task => task.Dependents)
			.HasForeignKey(dependency => dependency.DependsOnTaskId);
	}
}