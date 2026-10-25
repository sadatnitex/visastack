import { type Crop, sourceRect } from './crop';

/**
 * The browser half of profile photo cropping (WP-PH1). The page's security
 * policy allows no `blob:` or `data:` images, so the chosen file is decoded
 * straight into a bitmap and drawn on a canvas, never shown through an image
 * address. Any format the browser can decode works, which is how an iPhone
 * photo (HEIC) becomes a JPEG in Safari without the server decoding HEIC. The
 * camera's rotation is applied while decoding.
 */

export const OUTPUT_SIZE = 512;
const OUTPUT_QUALITY = 0.9;

export interface DecodedPhoto {
  readonly source: CanvasImageSource;
  readonly width: number;
  readonly height: number;
  close(): void;
}

export async function decodePhoto(file: Blob): Promise<DecodedPhoto> {
  if (typeof createImageBitmap !== 'function') throw new Error('image decoding unavailable');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  return {
    source: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    close: () => bitmap.close(),
  };
}

function drawCrop(
  context: CanvasRenderingContext2D,
  photo: DecodedPhoto,
  crop: Crop,
  size: number,
): void {
  const { sx, sy, size: side } = sourceRect(crop);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size, size);
  context.imageSmoothingQuality = 'high';
  context.drawImage(photo.source, sx, sy, side, side, 0, 0, size, size);
}

/** Draws what the square currently shows, sharp on high-density screens. */
export function drawPreview(canvas: HTMLCanvasElement, photo: DecodedPhoto, crop: Crop): void {
  const ratio = typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 3);
  const pixels = Math.round(crop.view * ratio);
  if (canvas.width !== pixels) canvas.width = pixels;
  if (canvas.height !== pixels) canvas.height = pixels;
  const context = canvas.getContext('2d');
  if (context) drawCrop(context, photo, crop, pixels);
}

/** The cropped square as a JPEG (a canvas never writes location or other metadata). */
export async function exportSquareJpeg(photo: DecodedPhoto, crop: Crop): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas unavailable');
  drawCrop(context, photo, crop, OUTPUT_SIZE);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('photo export failed'))),
      'image/jpeg',
      OUTPUT_QUALITY,
    );
  });
}
