// Builds the photos .zip in the browser (backend spec §4.5). `fflate` is loaded with a dynamic import so it
// stays out of the main bundle. Photos are already compressed images, so entries are STORED (no deflate):
// less CPU, and the part-size accounting below is exact.

type Fflate = typeof import('fflate');
type ZipInstance = InstanceType<Fflate['Zip']>;

/** A part is closed once it passes this, so one huge zip never has to fit in browser memory (~250 MB). */
export const DEFAULT_PART_BYTES = 250 * 1024 * 1024;

export interface PhotoZipPart {
  blob: Blob;
  photoCount: number;
}

interface OpenPart {
  zip: ZipInstance;
  chunks: Uint8Array[];
  size: number;
  count: number;
}

const EXTENSION_BY_TYPE: Record<string, string> = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/**
 * File extension for an exported photo. Taken from the blob's CONTENT TYPE, not from the stored path:
 * memberService.uploadPhoto names every object `.jpg` even when the content is PNG or WebP.
 */
export function photoExtension(contentType: string, storedPath: string): string {
  const fromType = EXTENSION_BY_TYPE[contentType.toLowerCase().split(';')[0].trim()];
  if (fromType) return fromType;
  const fromPath = /\.([a-z0-9]{2,5})$/i.exec(storedPath)?.[1]?.toLowerCase();
  return fromPath ?? 'jpg';
}

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  // Older WebKit (and jsdom) have no Blob.arrayBuffer(). FileReader exists everywhere; `new Response(blob)` would be
  // wrong under jsdom, where the Blob and Node's Response come from different realms.
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the photo'));
    reader.readAsArrayBuffer(blob);
  });
}

export class PhotoZipBuilder {
  /** Parts already closed — held as Blobs, which the browser may keep outside the JS heap. */
  private readonly closed: PhotoZipPart[] = [];
  /** The one part still being written: the only place raw chunks live in memory. */
  private current: OpenPart | null = null;

  private constructor(
    private readonly fflate: Fflate,
    private readonly partBytes: number
  ) {}

  static async create(partBytes: number = DEFAULT_PART_BYTES): Promise<PhotoZipBuilder> {
    return new PhotoZipBuilder(await import('fflate'), partBytes);
  }

  private open(): OpenPart {
    const part: OpenPart = { chunks: [], size: 0, count: 0, zip: undefined as unknown as ZipInstance };
    part.zip = new this.fflate.Zip((error, chunk) => {
      if (error) throw error;
      part.chunks.push(chunk);
      part.size += chunk.length;
    });
    this.current = part;
    return part;
  }

  /** Writes the zip's end-of-archive records and turns the part into a Blob, releasing its chunks. */
  private closeCurrent(): void {
    const part = this.current;
    if (!part) return;
    part.zip.end();
    this.closed.push({ blob: new Blob(part.chunks as BlobPart[], { type: 'application/zip' }), photoCount: part.count });
    this.current = null;
  }

  /** Adds one file. Closes the current part first if this file would push it past the size limit. */
  async add(entryName: string, blob: Blob): Promise<void> {
    const data = await blobBytes(blob);
    if (this.current && this.current.count > 0 && this.current.size + data.length > this.partBytes) this.closeCurrent();
    const part = this.current ?? this.open();
    const entry = new this.fflate.ZipPassThrough(entryName);
    part.zip.add(entry);
    entry.push(data, true);
    part.count += 1;
  }

  /** Closes the last part and returns every part in order. Empty when nothing was added. */
  finish(): PhotoZipPart[] {
    this.closeCurrent();
    return this.closed;
  }
}
