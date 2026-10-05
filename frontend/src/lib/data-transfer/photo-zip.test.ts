import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { DEFAULT_PART_BYTES, PhotoZipBuilder, photoExtension } from './photo-zip';

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

const photo = (bytes: number[], type = 'image/jpeg') => new Blob([new Uint8Array(bytes)], { type });
const filler = (length: number, seed = 1) => photo(Array.from({ length }, (_, i) => (i * seed) % 251));
const unzip = async (blob: Blob) => unzipSync(await bytesOf(blob));

describe('photoExtension — taken from the content type, not the stored path', () => {
  it.each([
    ['image/jpeg', '5/original-1.jpg', 'jpg'],
    ['image/jpg', '5/original-1.jpg', 'jpg'],
    ['image/png', '5/original-1.jpg', 'png'], // uploadPhoto names every object .jpg even when it is a PNG
    ['image/webp', '5/original-1.jpg', 'webp'],
    ['IMAGE/PNG', '5/x.jpg', 'png'],
    ['image/png; charset=binary', '5/x.jpg', 'png'],
    ['', '5/original-1.webp', 'webp'], // no usable type -> fall back to the path's extension
    ['application/octet-stream', '5/original-1.PNG', 'png'],
    ['', '5/original', 'jpg'], // nothing to go on -> jpg
  ])('%j for %s -> %s', (type, path, expected) => {
    expect(photoExtension(type, path)).toBe(expected);
  });
});

describe('PhotoZipBuilder', () => {
  it('is empty when nothing was added', async () => {
    const zip = await PhotoZipBuilder.create();
    expect(zip.finish()).toEqual([]);
  });

  it('round-trips every file byte for byte under the given entry names, in one part', async () => {
    const zip = await PhotoZipBuilder.create();
    const a = [0, 255, 1, 2, 128, 7];
    const b = Array.from({ length: 5000 }, (_, i) => (i * 7) % 256);
    await zip.add('MUM-2026-0001.jpg', photo(a));
    await zip.add('MUM-2026-0002.png', photo(b, 'image/png'));

    const parts = zip.finish();
    expect(parts).toHaveLength(1);
    expect(parts[0].photoCount).toBe(2);
    expect(parts[0].blob.type).toBe('application/zip');

    const files = await unzip(parts[0].blob);
    expect(Object.keys(files).sort()).toEqual(['MUM-2026-0001.jpg', 'MUM-2026-0002.png']);
    expect(Array.from(files['MUM-2026-0001.jpg'])).toEqual(a);
    expect(Array.from(files['MUM-2026-0002.png'])).toEqual(b);
  });

  it('starts a new part once the size limit would be passed — each part is a complete, readable zip', async () => {
    const zip = await PhotoZipBuilder.create(600);
    for (let i = 1; i <= 3; i += 1) await zip.add(`p${i}.jpg`, filler(400, i));

    const parts = zip.finish();
    expect(parts.map((p) => p.photoCount)).toEqual([1, 1, 1]);
    const names = await Promise.all(parts.map(async (p) => Object.keys(await unzip(p.blob))));
    expect(names).toEqual([['p1.jpg'], ['p2.jpg'], ['p3.jpg']]);
  });

  it('calling finish() again returns the same parts and never throws or duplicates them', async () => {
    const zip = await PhotoZipBuilder.create(600);
    for (let i = 1; i <= 3; i += 1) await zip.add(`p${i}.jpg`, filler(400, i));
    const first = zip.finish();
    const second = zip.finish();
    expect(second).toHaveLength(3);
    expect(second.map((p) => p.blob)).toEqual(first.map((p) => p.blob));
  });

  it('parts closed by the size limit are real Blobs straight away, each independently readable before finish()', async () => {
    const zip = await PhotoZipBuilder.create(600);
    await zip.add('p1.jpg', filler(400, 1));
    await zip.add('p2.jpg', filler(400, 2)); // closes part 1
    await zip.add('p3.jpg', filler(400, 3)); // closes part 2, leaves part 3 open
    const parts = zip.finish();
    expect(parts).toHaveLength(3);
    for (const [i, part] of parts.entries()) {
      expect(part.blob).toBeInstanceOf(Blob);
      expect(Object.keys(await unzip(part.blob))).toEqual([`p${i + 1}.jpg`]);
    }
  });

  it('keeps several small files together in one part while under the limit', async () => {
    const zip = await PhotoZipBuilder.create(10_000);
    for (let i = 1; i <= 4; i += 1) await zip.add(`p${i}.jpg`, filler(100, i));
    const parts = zip.finish();
    expect(parts).toHaveLength(1);
    expect(parts[0].photoCount).toBe(4);
  });

  it('a single file larger than the limit still gets its own part — never an empty part, never dropped', async () => {
    const zip = await PhotoZipBuilder.create(10);
    await zip.add('huge.jpg', filler(500));
    const parts = zip.finish();
    expect(parts).toHaveLength(1);
    expect(Object.keys(await unzip(parts[0].blob))).toEqual(['huge.jpg']);
  });

  it('stores entries without compression (photos are already compressed; keeps part-size accounting exact)', async () => {
    const zip = await PhotoZipBuilder.create();
    const data = filler(2000);
    await zip.add('x.jpg', data);
    const part = zip.finish()[0];
    // A stored entry costs the payload plus a small constant of headers; deflating 2000 bytes of this data would not.
    expect(part.blob.size).toBeGreaterThan(2000);
    expect(part.blob.size).toBeLessThan(2000 + 300);
  });

  it('the default part size is about 250 MB (browser memory)', () => {
    expect(DEFAULT_PART_BYTES).toBe(250 * 1024 * 1024);
  });
});
