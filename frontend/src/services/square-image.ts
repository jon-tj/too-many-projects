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


/**
 * Scales an image file to fit within `width` × `height` pixels, keeping its shape (logos), returned as a PNG data URL.
 * Smaller images are kept at their size.
 */
export async function fittedImageDataUrl(file: File, width: number, height: number): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, width / bitmap.width, height / bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/png');
}
