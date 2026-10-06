namespace Model;

public sealed class Canvas
{
    public int Id { get; set; }
    public long ProjectId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string CanvasJson { get; set; } = "{\"view\":{\"x\":40,\"y\":40,\"zoom\":1},\"items\":[]}";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public Project Project { get; set; } = null!;
    public ICollection<CanvasPermission> Permissions { get; set; } = new List<CanvasPermission>();
}
