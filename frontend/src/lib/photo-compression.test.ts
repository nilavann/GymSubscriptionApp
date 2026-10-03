import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compressImage } from './photo-compression';

// jsdom has no image decoding or canvas, so both are faked: the bitmap reports a chosen size, and the canvas
// "encodes" to a Blob whose size we control per quality step. What is under test is the LOGIC — scale down to
// 400px, then step quality down until under 50KB or the floor — not the browser's JPEG encoder.

function fakeBitmap(width: number, height: number) {
  return { width, height, close: vi.fn() };
}

let drawImage: ReturnType<typeof vi.fn>;
let created: HTMLCanvasElement[];

function installCanvas(sizeForQuality: (quality: number) => number) {
  const qualities: number[] = [];
  drawImage = vi.fn();
  created = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    created.push(this);
    return { drawImage } as unknown as CanvasRenderingContext2D;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, _type, quality) => {
    qualities.push(quality as number);
    callback(new Blob([new Uint8Array(sizeForQuality(quality as number))], { type: 'image/jpeg' }));
  });
  return qualities;
}

beforeEach(() => {
  vi.stubGlobal('createImageBitmap', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const file = new File(['x'], 'p.jpg', { type: 'image/jpeg' });
const setBitmap = (w: number, h: number) => {
  const bitmap = fakeBitmap(w, h);
  (createImageBitmap as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(bitmap);
  return bitmap;
};

describe('compressImage — sizing', () => {
  it('scales a large landscape photo so its LONGEST side is 400px, keeping the aspect ratio', async () => {
    const bitmap = setBitmap(4000, 3000);
    installCanvas(() => 1000);
    await compressImage(file);
    expect(created[0].width).toBe(400);
    expect(created[0].height).toBe(300);
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 400, 300);
  });

  it('scales a large portrait photo by its height', async () => {
    setBitmap(1500, 3000);
    installCanvas(() => 1000);
    await compressImage(file);
    expect([created[0].width, created[0].height]).toEqual([200, 400]);
  });

  it('never upscales a photo that is already smaller than 400px', async () => {
    setBitmap(300, 200);
    installCanvas(() => 1000);
    await compressImage(file);
    expect([created[0].width, created[0].height]).toEqual([300, 200]);
  });

  it('releases the decoded bitmap', async () => {
    const bitmap = setBitmap(800, 600);
    installCanvas(() => 1000);
    await compressImage(file);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });
});

describe('compressImage — quality stepping toward 50KB', () => {
  it('stops at the first try when it is already small enough (quality 0.9)', async () => {
    setBitmap(800, 600);
    const qualities = installCanvas(() => 20 * 1024);
    const blob = await compressImage(file);
    expect(qualities).toEqual([0.9]);
    expect(blob.type).toBe('image/jpeg');
  });

  it('steps quality down by 0.1 until the result fits under 50KB', async () => {
    setBitmap(800, 600);
    // 90KB at q0.9, 70KB at q0.8, 45KB at q0.7 -> done
    const qualities = installCanvas((q) => (q > 0.85 ? 90 : q > 0.75 ? 70 : 45) * 1024);
    const blob = await compressImage(file);
    expect(qualities.map((q) => Number(q.toFixed(1)))).toEqual([0.9, 0.8, 0.7]);
    expect(blob.size).toBe(45 * 1024);
  });

  it('gives up at the quality floor (0.3) instead of looping forever on a photo that will not shrink', async () => {
    setBitmap(800, 600);
    const qualities = installCanvas(() => 500 * 1024);
    const blob = await compressImage(file);
    expect(qualities.map((q) => Number(q.toFixed(1)))).toEqual([0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3]);
    expect(blob.size).toBe(500 * 1024); // returned as-is: a thumbnail that is big beats no thumbnail
  });
});

describe('compressImage — failures', () => {
  it('throws when the browser has no 2D canvas', async () => {
    setBitmap(800, 600);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    await expect(compressImage(file)).rejects.toThrow('canvas-not-supported');
  });

  it('throws when the canvas cannot encode', async () => {
    setBitmap(800, 600);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(null));
    await expect(compressImage(file)).rejects.toThrow('photo-compression-failed');
  });

  it('propagates a file the browser cannot decode', async () => {
    (createImageBitmap as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('decode failed'));
    await expect(compressImage(file)).rejects.toThrow('decode failed');
  });
});
