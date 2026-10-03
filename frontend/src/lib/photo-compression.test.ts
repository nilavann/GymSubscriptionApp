import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compressImage } from './photo-compression';

// REQ-MEM-004: ~400px longest side, under ~50KB.
function stubBrowser(width: number, height: number, sizeAtQuality: (q: number) => number) {
  const drawImage = vi.fn();
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage }),
    toBlob: (cb: (b: Blob | null) => void, _type: string, quality: number) => cb(new Blob([new Uint8Array(sizeAtQuality(quality))])),
  };
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width, height, close: vi.fn() }));
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => (tag === 'canvas' ? canvas : document.createElementNS('http://www.w3.org/1999/xhtml', tag))) as never);
  return { canvas, drawImage };
}

describe('compressImage (REQ-MEM-004)', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());
  const file = new File(['x'], 'p.jpg');

  it('scales a landscape image so the longest side is 400px, preserving aspect ratio', async () => {
    const { canvas } = stubBrowser(2000, 1000, () => 1000);
    await compressImage(file);
    expect([canvas.width, canvas.height]).toEqual([400, 200]);
  });

  it('scales a portrait image by its height', async () => {
    const { canvas } = stubBrowser(1000, 3000, () => 1000);
    await compressImage(file);
    expect([canvas.width, canvas.height]).toEqual([133, 400]);
  });

  it('never upscales a small image', async () => {
    const { canvas } = stubBrowser(200, 100, () => 1000);
    await compressImage(file);
    expect([canvas.width, canvas.height]).toEqual([200, 100]);
  });

  it('an image exactly 400px on the long side is left as is', async () => {
    const { canvas } = stubBrowser(400, 300, () => 1000);
    await compressImage(file);
    expect([canvas.width, canvas.height]).toEqual([400, 300]);
  });

  it('lowers JPEG quality until the blob is under 50KB', async () => {
    stubBrowser(2000, 2000, (q) => Math.round(q * 100_000)); // 90KB at 0.9 ... 50KB at 0.5
    const blob = await compressImage(file);
    expect(blob.size).toBeLessThanOrEqual(50 * 1024);
  });

  it('stops at a quality floor rather than looping forever when it cannot reach the target', async () => {
    stubBrowser(2000, 2000, () => 500_000);
    const blob = await compressImage(file);
    expect(blob.size).toBe(500_000); // gave up at the floor, still returned something
  });

  it('throws when the canvas 2D context is unavailable', async () => {
    const { canvas } = stubBrowser(100, 100, () => 10);
    canvas.getContext = () => null as never;
    await expect(compressImage(file)).rejects.toThrow('canvas-not-supported');
  });

  it('rejects when the browser cannot encode the image', async () => {
    const { canvas } = stubBrowser(100, 100, () => 10);
    canvas.toBlob = ((cb: (b: Blob | null) => void) => cb(null)) as never;
    await expect(compressImage(file)).rejects.toThrow('photo-compression-failed');
  });
});
