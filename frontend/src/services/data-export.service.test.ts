import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import {
  ExportCancelledError,
  createDataExportService,
  type ExportDeps,
  type ExportProgress,
} from './data-export.service';
import { PhotoZipBuilder } from '../lib/data-transfer/photo-zip';
import { EXPORT_TABLES, type BuiltSheet, type ExportTable, type Row } from '../lib/data-transfer/workbook-schema';
import { isNetworkError } from '../lib/network-error';
import type { DataTransferRepository, ExportPage } from '../repositories/data-transfer.repository';

// ---- fixtures ----------------------------------------------------------------------------------------------------------
const member = (id: number, extra: Row = {}): Row => ({
  id, name: `M${id}`, phone: `98765432${String(id).padStart(2, '0')}`, member_number: `MUM-2026-000${id}`, branch_id: 1,
  photo_url: null, photo_thumbnail_url: null, ...extra,
});

function tables(overrides: Partial<Record<ExportTable, Row[]>> = {}): Record<ExportTable, Row[]> {
  const base = Object.fromEntries(EXPORT_TABLES.map((t) => [t, [] as Row[]])) as Record<ExportTable, Row[]>;
  base.branches = [{ id: 1, name: 'Main', code: 'MUM' }];
  base.members = [member(1), member(2), member(3), member(4), member(5)];
  base.audit_log = [{ id: 1 }, { id: 2 }, { id: 3 }];
  return { ...base, ...overrides };
}

interface FakeRepo extends DataTransferRepository {
  calls: { table: ExportTable; after: number | null; limit: number }[];
  downloads: string[];
}

/** Serves `data` in pages of `pageSize` rows; the last page is an empty one, exactly like the real function. */
function fakeRepository(
  data: Record<ExportTable, Row[]>,
  options: { pageSize?: number; projectRef?: string; photo?: (path: string) => Promise<Blob> } = {}
): FakeRepo {
  const { pageSize = 2, projectRef = 'proj123', photo } = options;
  const calls: FakeRepo['calls'] = [];
  const downloads: string[] = [];
  return {
    calls,
    downloads,
    async exportPage(table, after, limit): Promise<ExportPage> {
      calls.push({ table, after, limit });
      const all = data[table];
      const keyed = table !== 'configuration' && table !== 'member_number_sequences' && table !== 'user_roles' && table !== 'users';
      if (!keyed) return { rows: all, next: null, project_ref: projectRef };
      const rows = all.filter((r) => (r.id as number) > (after ?? -1)).slice(0, pageSize);
      return { rows, next: rows.length ? (rows[rows.length - 1].id as number) : null, project_ref: projectRef };
    },
    async downloadPhoto(path) {
      downloads.push(path);
      if (photo) return photo(path);
      return new Blob([`bytes:${path}`], { type: 'image/jpeg' });
    },
  };
}

interface Capture {
  sheets: BuiltSheet[];
  zipEntries: { name: string; type: string }[];
  zipParts: number;
}

/** Cheap stand-ins for the spreadsheet engine and the zip, so the orchestration is tested on its own. */
function fakeDeps(capture: Capture, parts = 1): ExportDeps {
  return {
    async writeWorkbook(sheets) {
      capture.sheets = sheets;
      return new Blob(['xlsx']);
    },
    async createPhotoZip() {
      return {
        async add(name: string, blob: Blob) {
          capture.zipEntries.push({ name, type: blob.type });
        },
        finish() {
          capture.zipParts = parts;
          const count = capture.zipEntries.length;
          return Array.from({ length: count === 0 ? 0 : parts }, (_, i) => ({
            blob: new Blob([`zip${i}`]),
            photoCount: i === 0 ? count : 0,
          }));
        },
      };
    },
  };
}

const newCapture = (): Capture => ({ sheets: [], zipEntries: [], zipParts: 0 });
const BASE = { includeAuditLog: true, includePhotos: false, exportedBy: 'admin@example.com' };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 6, 9, 30, 0)); // local 6 Oct 2026, 09:30
});
afterEach(() => vi.useRealTimers());

// ---- reading -----------------------------------------------------------------------------------------------------------
describe('dataExportService.run — reading the tables', () => {
  it('reads every table, lookups first, audit log last', async () => {
    const repo = fakeRepository(tables());
    await createDataExportService(repo, fakeDeps(newCapture())).run(BASE);
    const order = [...new Set(repo.calls.map((c) => c.table))];
    expect(order).toEqual([...EXPORT_TABLES]);
    expect(order[order.length - 1]).toBe('audit_log');
    expect(order.indexOf('branches')).toBeLessThan(order.indexOf('members'));
    expect(order.indexOf('users')).toBeLessThan(order.indexOf('members'));
  });

  it('follows the cursor page by page until the empty last page, never asking for more than 1000 rows', async () => {
    const repo = fakeRepository(tables());
    await createDataExportService(repo, fakeDeps(newCapture())).run(BASE);
    const members = repo.calls.filter((c) => c.table === 'members');
    expect(members.map((c) => c.after)).toEqual([null, 2, 4, 5]); // 5 rows, 2 per page, then the empty page
    expect(members.every((c) => c.limit === 1000)).toBe(true);
  });

  it('single-page tables are read exactly once', async () => {
    const repo = fakeRepository(tables({ configuration: [{ key: 'k', value: 'v' }] }));
    await createDataExportService(repo, fakeDeps(newCapture())).run(BASE);
    expect(repo.calls.filter((c) => c.table === 'configuration')).toHaveLength(1);
    expect(repo.calls.filter((c) => c.table === 'users')).toHaveLength(1);
  });

  it('does not read the audit log at all when it is not included, and says so in the README', async () => {
    const repo = fakeRepository(tables());
    const capture = newCapture();
    const result = await createDataExportService(repo, fakeDeps(capture)).run({ ...BASE, includeAuditLog: false });
    expect(repo.calls.some((c) => c.table === 'audit_log')).toBe(false);
    expect(capture.sheets.map((s) => s.name)).not.toContain('AuditLog');
    expect(capture.sheets[0].rows).toContainEqual(['include_audit_log', 'FALSE']);
    expect(result.counts).not.toHaveProperty('AuditLog');
  });

  it('refuses to loop forever on a cursor that does not advance', async () => {
    const stuck = fakeRepository(tables());
    stuck.exportPage = async () => ({ rows: [{ id: 1 }], next: 1, project_ref: 'p' });
    await expect(createDataExportService(stuck, fakeDeps(newCapture())).run(BASE)).rejects.toThrow(/cursor did not advance/);
  });

  it('propagates a repository failure unchanged, producing no files', async () => {
    const repo = fakeRepository(tables());
    repo.exportPage = async () => {
      throw new Error('Admin access required');
    };
    await expect(createDataExportService(repo, fakeDeps(newCapture())).run(BASE)).rejects.toThrow('Admin access required');
  });

  it('an offline failure reaches the caller recognisable as a network error', async () => {
    const repo = fakeRepository(tables());
    repo.exportPage = async () => {
      throw new Error('Failed to fetch');
    };
    const error = await createDataExportService(repo, fakeDeps(newCapture())).run(BASE).catch((e: unknown) => e);
    expect(isNetworkError(error)).toBe(true);
    expect(error).not.toBeInstanceOf(ExportCancelledError);
  });
});

// ---- the produced files ------------------------------------------------------------------------------------------------
describe('dataExportService.run — the workbook', () => {
  it('names the file with today\'s LOCAL date and returns it as the first (workbook) file', async () => {
    const result = await createDataExportService(fakeRepository(tables()), fakeDeps(newCapture())).run(BASE);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({ kind: 'workbook', filename: 'fit-and-fine-data-2026-10-06.xlsx' });
  });

  it('puts README first and records who, when, from which project, and the row counts', async () => {
    const capture = newCapture();
    const result = await createDataExportService(fakeRepository(tables(), { projectRef: 'abcdefgh' }), fakeDeps(capture)).run(BASE);
    const readme = capture.sheets[0];
    expect(readme.name).toBe('README');
    expect(readme.rows).toContainEqual(['schema_version', 1]);
    expect(readme.rows).toContainEqual(['exported_by', 'admin@example.com']);
    expect(readme.rows).toContainEqual(['source_project', 'abcdefgh']);
    expect(readme.rows).toContainEqual(['exported_at', new Date(2026, 9, 6, 9, 30, 0).toISOString()]);
    expect(readme.rows).toContainEqual(['Members', 5]);
    expect(readme.rows).toContainEqual(['AuditLog', 3]);
    expect(result.counts).toMatchObject({ Members: 5, Branches: 1, AuditLog: 3 });
    expect(capture.sheets.slice(1).map((s) => s.name)).toContain('Members');
  });

  it('warns (in the result and the README) when control characters a spreadsheet cannot store were removed', async () => {
    const capture = newCapture();
    const result = await createDataExportService(
      fakeRepository(tables({ members: [member(1, { name: 'Me\u0001era' }), member(2, { occupation: 'a\u0002b' }), member(3)] })),
      fakeDeps(capture)
    ).run(BASE);
    expect(result.warnings).toEqual(['2 cell(s) contained control characters that a spreadsheet cannot store; those characters were removed.']);
    expect(capture.sheets[0].rows).toContainEqual(['cleaned_cells', 2]);
    const members = capture.sheets.find((s) => s.name === 'Members')!;
    expect(members.rows[0][members.headers.indexOf('name')]).toBe('Meera');
  });

  it('a clean export has no warnings at all', async () => {
    const result = await createDataExportService(fakeRepository(tables()), fakeDeps(newCapture())).run(BASE);
    expect(result.warnings).toEqual([]);
  });

  it('warns (in the result and the README) about truncated cells', async () => {
    const capture = newCapture();
    const long = 'x'.repeat(40000);
    const result = await createDataExportService(
      fakeRepository(tables({ members: [member(1, { residential_address: long })] })),
      fakeDeps(capture)
    ).run(BASE);
    expect(result.warnings).toEqual([expect.stringMatching(/1 cell\(s\) were longer than 32,767 characters and were truncated/)]);
    expect(capture.sheets[0].rows.map((r) => r[0])).toContain(result.warnings[0]);
  });
});

// ---- photos -------------------------------------------------------------------------------------------------------------
describe('dataExportService.run — photos', () => {
  const withPhotos = () =>
    tables({
      members: [
        member(1, { photo_url: '1/original-1.jpg' }),
        member(2, { photo_url: '2/original-2.jpg' }),
        member(3), // no photo
        member(4, { photo_url: '4/original-4.jpg', deleted_at: '2026-03-01T00:00:00+00:00' }), // a deleted member's photo is still backed up
      ],
    });

  it('downloads only members that have a photo, deleted members included, and skips photos entirely when switched off', async () => {
    const repo = fakeRepository(withPhotos());
    await createDataExportService(repo, fakeDeps(newCapture())).run({ ...BASE, includePhotos: true });
    expect(repo.downloads.sort()).toEqual(['1/original-1.jpg', '2/original-2.jpg', '4/original-4.jpg']);

    const off = fakeRepository(withPhotos());
    const result = await createDataExportService(off, fakeDeps(newCapture())).run(BASE);
    expect(off.downloads).toEqual([]);
    expect(result.files.map((f) => f.kind)).toEqual(['workbook']);
  });

  it('names each entry <member_number>.<ext> from the blob type and records it as the member\'s photo_file', async () => {
    const capture = newCapture();
    const repo = fakeRepository(withPhotos(), {
      photo: async (path) => new Blob(['x'], { type: path.startsWith('2/') ? 'image/png' : 'image/jpeg' }),
    });
    await createDataExportService(repo, fakeDeps(capture)).run({ ...BASE, includePhotos: true });
    expect(capture.zipEntries.map((e) => e.name).sort()).toEqual(['MUM-2026-0001.jpg', 'MUM-2026-0002.png', 'MUM-2026-0004.jpg']);

    const members = capture.sheets.find((s) => s.name === 'Members')!;
    const fileColumn = members.headers.indexOf('photo_file');
    expect(members.rows.map((r) => r[fileColumn])).toEqual(['MUM-2026-0001.jpg', 'MUM-2026-0002.png', null, 'MUM-2026-0004.jpg']);
  });

  it('gives a clashing entry name the member id as a suffix, and strips path characters', async () => {
    const capture = newCapture();
    const repo = fakeRepository(
      tables({
        members: [
          member(1, { member_number: 'A/B', photo_url: 'p1' }),
          member(2, { member_number: 'A/B', photo_url: 'p2' }),
        ],
      })
    );
    await createDataExportService(repo, fakeDeps(capture)).run({ ...BASE, includePhotos: true });
    expect(capture.zipEntries.map((e) => e.name)).toEqual(['A_B.jpg', 'A_B-2.jpg']);
  });

  it('a photo that cannot be read is a warning, not a failure — the member keeps a blank photo_file', async () => {
    const capture = newCapture();
    const repo = fakeRepository(withPhotos(), {
      photo: async (path) => {
        if (path.startsWith('2/')) throw new Error('Object not found');
        return new Blob(['x'], { type: 'image/jpeg' });
      },
    });
    const result = await createDataExportService(repo, fakeDeps(capture)).run({ ...BASE, includePhotos: true });
    expect(result.warnings).toEqual(['Photo for member MUM-2026-0002 could not be read and was skipped.']);
    expect(capture.zipEntries).toHaveLength(2);
    const members = capture.sheets.find((s) => s.name === 'Members')!;
    expect(members.rows[1][members.headers.indexOf('photo_file')]).toBeNull();
    expect(capture.sheets[0].rows.map((r) => r[0])).toContain(result.warnings[0]);
    expect(result.files.map((f) => f.kind)).toEqual(['workbook', 'photos']);
  });

  it('losing the connection while downloading a photo aborts the export (it is not silently skipped)', async () => {
    const repo = fakeRepository(withPhotos(), {
      photo: async () => {
        throw new Error('Failed to fetch');
      },
    });
    const error = await createDataExportService(repo, fakeDeps(newCapture())).run({ ...BASE, includePhotos: true }).catch((e: unknown) => e);
    expect(isNetworkError(error)).toBe(true);
  });

  it('when every photo is unreadable there is no empty zip, only warnings', async () => {
    const repo = fakeRepository(withPhotos(), { photo: async () => { throw new Error('gone'); } });
    const result = await createDataExportService(repo, fakeDeps(newCapture())).run({ ...BASE, includePhotos: true });
    expect(result.files.map((f) => f.kind)).toEqual(['workbook']);
    expect(result.warnings).toHaveLength(3);
  });

  it('names a single zip plainly and several parts part-1, part-2 …, and records the part count in the README', async () => {
    const one = await createDataExportService(fakeRepository(withPhotos()), fakeDeps(newCapture(), 1)).run({ ...BASE, includePhotos: true });
    expect(one.files.filter((f) => f.kind === 'photos').map((f) => f.filename)).toEqual(['fit-and-fine-photos-2026-10-06.zip']);

    const capture = newCapture();
    const many = await createDataExportService(fakeRepository(withPhotos()), fakeDeps(capture, 3)).run({ ...BASE, includePhotos: true });
    expect(many.files.filter((f) => f.kind === 'photos').map((f) => f.filename)).toEqual([
      'fit-and-fine-photos-2026-10-06-part-1.zip',
      'fit-and-fine-photos-2026-10-06-part-2.zip',
      'fit-and-fine-photos-2026-10-06-part-3.zip',
    ]);
    expect(capture.sheets[0].rows).toContainEqual(['photo_parts', 3]);
  });

  it('exposes the photo count on the zip file for the download button', async () => {
    const result = await createDataExportService(fakeRepository(withPhotos()), fakeDeps(newCapture())).run({ ...BASE, includePhotos: true });
    expect(result.files.find((f) => f.kind === 'photos')?.photoCount).toBe(3);
  });
});

// ---- progress and cancellation -----------------------------------------------------------------------------------------
describe('dataExportService.run — progress and cancellation', () => {
  it('reports reading progress per table (running row count + step/steps), then photos, then building last', async () => {
    const events: ExportProgress[] = [];
    const data = tables({ members: [member(1, { photo_url: 'p1' }), member(2, { photo_url: 'p2' })] });
    await createDataExportService(fakeRepository(data), fakeDeps(newCapture())).run({
      ...BASE,
      includePhotos: true,
      onProgress: (p) => events.push(p),
    });
    const reading = events.filter((e): e is Extract<ExportProgress, { phase: 'reading' }> => e.phase === 'reading');
    expect(reading[0]).toMatchObject({ table: 'branches', step: 0, steps: EXPORT_TABLES.length });
    expect(reading.filter((e) => e.table === 'members').map((e) => e.rows)).toEqual([2, 2]); // page of 2, then the empty page
    expect(reading[reading.length - 1]).toMatchObject({ table: 'audit_log', step: EXPORT_TABLES.length - 1 });

    const photos = events.filter((e): e is Extract<ExportProgress, { phase: 'photos' }> => e.phase === 'photos');
    expect(photos[photos.length - 1]).toEqual({ phase: 'photos', done: 2, total: 2 });
    expect(events[events.length - 1]).toEqual({ phase: 'building' });
    expect(events.findIndex((e) => e.phase === 'photos')).toBeGreaterThan(events.findIndex((e) => e.phase === 'reading'));
  });

  it('steps counts one fewer table when the audit log is off', async () => {
    const events: ExportProgress[] = [];
    await createDataExportService(fakeRepository(tables()), fakeDeps(newCapture())).run({
      ...BASE,
      includeAuditLog: false,
      onProgress: (p) => events.push(p),
    });
    expect(events.find((e) => e.phase === 'reading')).toMatchObject({ steps: EXPORT_TABLES.length - 1 });
  });

  it('an already-cancelled export reads nothing', async () => {
    const repo = fakeRepository(tables());
    const controller = new AbortController();
    controller.abort();
    await expect(createDataExportService(repo, fakeDeps(newCapture())).run({ ...BASE, signal: controller.signal })).rejects.toBeInstanceOf(
      ExportCancelledError
    );
    expect(repo.calls).toHaveLength(0);
  });

  it('cancelling mid-read stops further requests and produces no files', async () => {
    const repo = fakeRepository(tables());
    const capture = newCapture();
    const controller = new AbortController();
    const promise = createDataExportService(repo, fakeDeps(capture)).run({
      ...BASE,
      signal: controller.signal,
      onProgress: (p) => {
        if (p.phase === 'reading' && p.table === 'plans') controller.abort();
      },
    });
    await expect(promise).rejects.toBeInstanceOf(ExportCancelledError);
    expect(repo.calls.some((c) => c.table === 'members')).toBe(false);
    expect(capture.sheets).toEqual([]);
  });

  it('cancelling during the photo phase stops downloading and builds nothing', async () => {
    const data = tables({ members: Array.from({ length: 10 }, (_, i) => member(i + 1, { photo_url: `p${i + 1}` })) });
    const repo = fakeRepository(data);
    const capture = newCapture();
    const controller = new AbortController();
    const promise = createDataExportService(repo, fakeDeps(capture)).run({
      ...BASE,
      includePhotos: true,
      signal: controller.signal,
      onProgress: (p) => {
        if (p.phase === 'photos') controller.abort();
      },
    });
    await expect(promise).rejects.toBeInstanceOf(ExportCancelledError);
    expect(repo.downloads.length).toBeLessThan(10);
    expect(capture.sheets).toEqual([]);
  });

  it('lets the browser paint "Building workbook…" BEFORE the blocking build starts', async () => {
    const order: string[] = [];
    const deps: ExportDeps = {
      writeWorkbook: async () => {
        order.push('write');
        return new Blob(['x']);
      },
      createPhotoZip: async () => ({ add: async () => undefined, finish: () => [] }),
    };
    await createDataExportService(fakeRepository(tables()), deps).run({
      ...BASE,
      onProgress: (p) => {
        if (p.phase === 'building') {
          order.push('building');
          setTimeout(() => order.push('a task the browser ran in between'), 0);
        }
      },
    });
    expect(order).toEqual(['building', 'a task the browser ran in between', 'write']);
  });

  it('Cancel pressed while the "building" state is being painted still cancels — nothing is written', async () => {
    const controller = new AbortController();
    const capture = newCapture();
    const promise = createDataExportService(fakeRepository(tables()), fakeDeps(capture)).run({
      ...BASE,
      signal: controller.signal,
      onProgress: (p) => {
        if (p.phase === 'building') setTimeout(() => controller.abort(), 0);
      },
    });
    await expect(promise).rejects.toBeInstanceOf(ExportCancelledError);
    expect(capture.sheets).toEqual([]);
  });

  it('ExportCancelledError is distinguishable from a real failure', () => {
    const error = new ExportCancelledError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ExportCancelledError');
    expect(isNetworkError(error)).toBe(false);
  });
});

// ---- end to end with the real writer and zip ---------------------------------------------------------------------------
describe('dataExportService.run — real spreadsheet + zip engines', () => {
  async function bytesOf(blob: Blob): Promise<Uint8Array> {
    if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
  }

  it('produces a readable workbook and a zip whose entries match the Members sheet\'s photo_file column', async () => {
    const data = tables({
      members: [
        member(1, { photo_url: '1/original-1.jpg', phone: '0987654321' }),
        member(2, { photo_url: '2/original-2.jpg' }),
      ],
    });
    const repo = fakeRepository(data, {
      photo: async (path) => new Blob([new Uint8Array([1, 2, 3, path.length])], { type: path.startsWith('2/') ? 'image/png' : 'image/jpeg' }),
    });
    const service = createDataExportService(repo); // default deps: the real writer and the real zip
    const result = await service.run({ ...BASE, includePhotos: true });

    const workbook = unzipSync(await bytesOf(result.files[0].blob));
    const sheetNames = [...strFromU8(workbook['xl/workbook.xml']).matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => m[1]);
    expect(sheetNames).toEqual(['README', ...Object.keys(result.counts)]);
    const strings = strFromU8(workbook['xl/sharedStrings.xml']);
    expect(strings).toContain('0987654321'); // leading zero kept as text
    expect(strings).toContain('MUM-2026-0001.jpg');
    expect(strings).toContain('MUM-2026-0002.png');

    const zip = unzipSync(await bytesOf(result.files[1].blob));
    expect(Object.keys(zip).sort()).toEqual(['MUM-2026-0001.jpg', 'MUM-2026-0002.png']);
    expect(Array.from(zip['MUM-2026-0001.jpg'])).toEqual([1, 2, 3, '1/original-1.jpg'.length]);
  });

  it('splits into several real zip parts when the part size is tiny, every one readable', async () => {
    const data = tables({ members: [1, 2, 3].map((i) => member(i, { photo_url: `p${i}` })) });
    const repo = fakeRepository(data, { photo: async () => new Blob([new Uint8Array(400).fill(7)], { type: 'image/jpeg' }) });
    const service = createDataExportService(repo, {
      writeWorkbook: async () => new Blob(['x']),
      createPhotoZip: () => PhotoZipBuilder.create(600),
    });
    const result = await service.run({ ...BASE, includePhotos: true });
    const zips = result.files.filter((f) => f.kind === 'photos');
    expect(zips.map((f) => f.filename)).toEqual([
      'fit-and-fine-photos-2026-10-06-part-1.zip',
      'fit-and-fine-photos-2026-10-06-part-2.zip',
      'fit-and-fine-photos-2026-10-06-part-3.zip',
    ]);
    for (const z of zips) expect(Object.keys(unzipSync(await bytesOf(z.blob)))).toHaveLength(1);
  });
});
