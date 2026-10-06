namespace Model;

/// <summary>Overrides a project member's default access to one canvas.</summary>
public sealed class CanvasPermission
{
    public int CanvasId { get; set; }
    public string UserId { get; set; } = string.Empty;
    public bool CanRead { get; set; }
    public bool CanWrite { get; set; }
    public Canvas Canvas { get; set; } = null!;
    public ApplicationUser User { get; set; } = null!;
}
