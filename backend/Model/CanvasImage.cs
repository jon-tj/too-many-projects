namespace Model;

/// <summary>An image pasted into a canvas. The canvas document only references it by id, so saves stay small.</summary>
public sealed class CanvasImage
{
    public int Id { get; set; }
    public int CanvasId { get; set; }
    public string ContentType { get; set; } = string.Empty;
    public byte[] Data { get; set; } = [];
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public Canvas Canvas { get; set; } = null!;
}
