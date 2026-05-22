import type { ChatImage } from './protocol';

/** An image attachment plus a data URL for the composer thumbnail. */
export interface PreparedImage extends ChatImage {
  previewUrl: string;
}

// Claude gains nothing from images larger than ~1568px on the long edge —
// downscaling here keeps WebSocket payloads small.
const MAX_EDGE = 1568;

/** Load, downscale and re-encode an image file for sending to Claude. */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is unavailable');
    ctx.drawImage(bitmap, 0, 0, width, height);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return {
      mediaType: 'image/jpeg',
      data: dataUrl.slice(dataUrl.indexOf(',') + 1),
      previewUrl: dataUrl,
    };
  } finally {
    bitmap.close();
  }
}
