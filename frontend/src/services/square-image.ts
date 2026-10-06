/**
 * Crops an image file to its centre square and scales it to `size` pixels, returned as a data URL, so it is
 * small enough to store with a record (project icons, profile pictures).
 */
export async function squareImageDataUrl(file: File, size: number, type = 'image/png', quality?: number): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas
    .getContext('2d')!
    .drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  return canvas.toDataURL(type, quality);
}
