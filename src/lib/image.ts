import { ApiError } from '../api/types';

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Product photos are shown at most ~480 px wide, so phones' 4000 px originals are scaled down
 * (and re-encoded as WebP, or JPEG where the browser cannot write WebP) before upload.
 */
export async function resizeImage(file: File, maxSide = 960): Promise<Blob> {
  if (!ACCEPTED.includes(file.type) || file.size > 20 * 1024 * 1024) throw new ApiError('image_invalid');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ApiError('image_invalid');
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const encode = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.82));
  const webp = await encode('image/webp');
  if (webp && webp.type === 'image/webp') return webp;
  const jpeg = await encode('image/jpeg');
  if (!jpeg) throw new ApiError('image_invalid');
  return jpeg;
}
