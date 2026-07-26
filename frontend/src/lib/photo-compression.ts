// Client-side photo compression (REQ-MEM-004) — targets ~400px on the longest side and
// under ~50KB. The original file is uploaded untouched; this only produces the thumbnail.

const TARGET_MAX_DIMENSION = 400;
const TARGET_MAX_BYTES = 50 * 1024;
const MIN_QUALITY = 0.3;
const QUALITY_STEP = 0.1;

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('photo-compression-failed'))), 'image/jpeg', quality);
  });
}

export async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, TARGET_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas-not-supported');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // Step quality down until under the size target, or hit a floor rather than looping forever.
  let quality = 0.9;
  let blob = await canvasToBlob(canvas, quality);
  while (blob.size > TARGET_MAX_BYTES && quality > MIN_QUALITY) {
    quality -= QUALITY_STEP;
    blob = await canvasToBlob(canvas, quality);
  }
  return blob;
}
