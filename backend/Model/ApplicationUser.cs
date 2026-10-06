using Microsoft.AspNetCore.Identity;

namespace Model;

public sealed class ApplicationUser : IdentityUser
{
	public string DisplayName { get; set; } = string.Empty;
	/// <summary>Set for users created with a temporary password; cleared when they choose their own.</summary>
	public bool MustChangePassword { get; set; }
}