using Microsoft.AspNetCore.Identity;

namespace Model;

public sealed class ApplicationUser : IdentityUser
{
	public string DisplayName { get; set; } = string.Empty;
}