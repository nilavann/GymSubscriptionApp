import { isNetworkError } from '../lib/network-error';
import { todayDate } from '../lib/datetime';
import { PhotoZipBuilder, photoExtension, type PhotoZipPart } from '../lib/data-transfer/photo-zip';
import { writeWorkbook } from '../lib/data-transfer/xlsx-writer';
import {
  EXPORT_TABLES,
  MAX_CELL_CHARS,
  buildReadme,
  buildSheets,
  type BuiltSheet,
  type ExportData,
  type ExportTable,
  type Row,
} from '../lib/data-transfer/workbook-schema';
import type { DataTransferRepository } from '../repositories/data-transfer.repository';

/** REQ-ADMIN-007 — orchestration only (spec/frontend/data-export-import.md §5). Reads pages, builds the files. */

const PAGE_SIZE = 1000;
const PHOTO_BATCH = 4;

export type ExportProgress =
  | { phase: 'reading'; table: ExportTable; rows: number; step: number; steps: number }
  | { phase: 'photos'; done: number; total: number }
  | { phase: 'building' };

export interface ExportOptions {
  includeAuditLog: boolean;
  includePhotos: boolean;
  /** Signed-in admin's email, recorded in the README. */
  exportedBy: string;
  signal?: AbortSignal;
  onProgress?: (progress: ExportProgress) => void;
}

export interface ExportFile {
  kind: 'workbook' | 'photos';
  filename: string;
  blob: Blob;
  /** Number of photos in this zip part (photos only). */
  photoCount?: number;
}

export interface ExportResult {
  files: ExportFile[];
  warnings: string[];
  /** Rows per sheet, as written to the README. */
  counts: Record<string, number>;
}

/** Thrown when the admin cancels; the page shows the "cancelled" state, not an error. */
export class ExportCancelledError extends Error {
  constructor() {
    super('Export cancelled');
    this.name = 'ExportCancelledError';
  }
}

/** The heavy parts, injectable so the orchestration is testable without a spreadsheet engine. */
export interface ExportDeps {
  writeWorkbook: (sheets: BuiltSheet[]) => Promise<Blob>;
  createPhotoZip: () => Promise<Pick<PhotoZipBuilder, 'add' | 'finish'>>;
}

const defaultDeps: ExportDeps = { writeWorkbook, createPhotoZip: () => PhotoZipBuilder.create() };

function throwIfCancelled(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw new ExportCancelledError();
}

/**
 * Lets the browser render and paint what React just queued. Building the workbook blocks the main thread for about a
 * second per 50,000 audit rows (measured — backend spec §11), so "Building workbook…" must already be on screen when
 * that starts; a plain `await` only yields a microtask, which is not enough for a paint.
 */
function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    const later = () => setTimeout(resolve, 0);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(later);
    else later();
  });
}

/** A zip-safe, unique entry name for one photo: `<member_number>.<ext>` (a clash gets the member id as a suffix). */
function entryNameFor(member: Row, extension: string, used: Set<string>): string {
  const base = String(member.member_number ?? `member-${member.id}`).replace(/[\\/:*?"<>|]/g, '_');
  let name = `${base}.${extension}`;
  if (used.has(name)) name = `${base}-${member.id}.${extension}`;
  used.add(name);
  return name;
}

export function createDataExportService(repository: DataTransferRepository, deps: ExportDeps = defaultDeps) {
  async function readTable(table: ExportTable, signal: AbortSignal | undefined, onRows: (rows: number) => void) {
    const rows: Row[] = [];
    let after: number | null = null;
    let projectRef = '';
    for (;;) {
      throwIfCancelled(signal);
      const page = await repository.exportPage(table, after, PAGE_SIZE);
      projectRef = page.project_ref || projectRef;
      rows.push(...page.rows);
      onRows(rows.length);
      if (page.next === null) break;
      // A cursor that does not move forward would loop forever — fail loudly instead.
      if (after !== null && page.next <= after) throw new Error(`Export of ${table} stopped: the page cursor did not advance`);
      after = page.next;
    }
    return { rows, projectRef };
  }

  /** Downloads every member's original photo into the zip. Network loss aborts; any other failure is a warning. */
  async function collectPhotos(
    members: Row[],
    signal: AbortSignal | undefined,
    onProgress: ExportOptions['onProgress'],
    warnings: string[]
  ) {
    const withPhoto = members.filter((m) => typeof m.photo_url === 'string' && m.photo_url !== '');
    const photoFiles = new Map<number, string>();
    if (withPhoto.length === 0) return { photoFiles, parts: [] as PhotoZipPart[] };

    const zip = await deps.createPhotoZip();
    const usedNames = new Set<string>();
    for (let start = 0; start < withPhoto.length; start += PHOTO_BATCH) {
      throwIfCancelled(signal);
      const batch = withPhoto.slice(start, start + PHOTO_BATCH);
      const downloaded = await Promise.all(
        batch.map(async (member) => {
          try {
            return await repository.downloadPhoto(member.photo_url as string);
          } catch (error) {
            if (isNetworkError(error)) throw error;
            return null;
          }
        })
      );
      for (const [index, blob] of downloaded.entries()) {
        const member = batch[index];
        if (!blob) {
          warnings.push(`Photo for member ${member.member_number ?? member.id} could not be read and was skipped.`);
          continue;
        }
        const name = entryNameFor(member, photoExtension(blob.type, member.photo_url as string), usedNames);
        await zip.add(name, blob);
        photoFiles.set(member.id as number, name);
      }
      onProgress?.({ phase: 'photos', done: Math.min(start + PHOTO_BATCH, withPhoto.length), total: withPhoto.length });
    }
    return { photoFiles, parts: zip.finish() };
  }

  return {
    /** Runs a full export. Rejects with ExportCancelledError on cancel, or the underlying error (check isNetworkError). */
    async run(options: ExportOptions): Promise<ExportResult> {
      const { signal, onProgress } = options;
      const tables = EXPORT_TABLES.filter((t) => t !== 'audit_log' || options.includeAuditLog);
      const data = Object.fromEntries(EXPORT_TABLES.map((t) => [t, [] as Row[]])) as ExportData;

      let projectRef = '';
      for (const [step, table] of tables.entries()) {
        const result = await readTable(table, signal, (rows) =>
          onProgress?.({ phase: 'reading', table, rows, step, steps: tables.length })
        );
        data[table] = result.rows;
        projectRef = result.projectRef || projectRef;
      }

      const warnings: string[] = [];
      const { photoFiles, parts } = options.includePhotos
        ? await collectPhotos(data.members, signal, onProgress, warnings)
        : { photoFiles: new Map<number, string>(), parts: [] as PhotoZipPart[] };

      throwIfCancelled(signal);
      onProgress?.({ phase: 'building' });
      await yieldToBrowser();
      throwIfCancelled(signal); // Cancel pressed in the instant before the (uninterruptible) build starts
      const built = buildSheets(data, { includeAuditLog: options.includeAuditLog, photoFiles });
      if (built.stats.truncatedCells > 0) {
        warnings.push(
          `${built.stats.truncatedCells} cell(s) were longer than ${MAX_CELL_CHARS.toLocaleString('en-US')} characters and were truncated.`
        );
      }
      if (built.stats.cleanedCells > 0) {
        warnings.push(
          `${built.stats.cleanedCells} cell(s) contained control characters that a spreadsheet cannot store; those characters were removed.`
        );
      }
      const readme = buildReadme({
        exportedAt: new Date().toISOString(),
        exportedBy: options.exportedBy,
        sourceProject: projectRef,
        includeAuditLog: options.includeAuditLog,
        photoParts: parts.length,
        counts: built.counts,
        truncatedCells: built.stats.truncatedCells,
        cleanedCells: built.stats.cleanedCells,
        warnings,
      });
      const workbook = await deps.writeWorkbook([readme, ...built.sheets]);

      const date = todayDate();
      const files: ExportFile[] = [{ kind: 'workbook', filename: `fit-and-fine-data-${date}.xlsx`, blob: workbook }];
      parts.forEach((part, index) =>
        files.push({
          kind: 'photos',
          filename: parts.length === 1 ? `fit-and-fine-photos-${date}.zip` : `fit-and-fine-photos-${date}-part-${index + 1}.zip`,
          blob: part.blob,
          photoCount: part.photoCount,
        })
      );
      return { files, warnings, counts: built.counts };
    },
  };
}

export type DataExportService = ReturnType<typeof createDataExportService>;
