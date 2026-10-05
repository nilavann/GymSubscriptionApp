import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import { DataBackupPage } from './DataBackupPage';
import { ExportCancelledError, type ExportFile, type ExportOptions, type ExportResult } from '../services/data-export.service';
import { fakeServices } from '../test/fakes';
import { renderWithProviders, type RenderOptions } from '../test/render';
import { buildAdminProfile } from '../test/builders';
import { MOBILE_WIDTH } from '../test/viewport';

// jsdom has no URL.createObjectURL; the page needs one to offer a download. Counting them proves each blob URL is
// released again (a leaked URL keeps the whole file in memory).
let created: string[];
let revoked: string[];

beforeEach(() => {
  created = [];
  revoked = [];
  let n = 0;
  URL.createObjectURL = vi.fn(() => {
    const url = `blob:mock-${(n += 1)}`;
    created.push(url);
    return url;
  });
  URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url);
  });
});
// Deliberately NOT removed afterwards: Vitest runs afterEach hooks in reverse order, so RTL's cleanup (registered in
// setup.ts) unmounts the page AFTER a hook here would run — and the page's unmount effect revokes its blob URLs.

const file = (kind: ExportFile['kind'], filename: string, bytes: number, photoCount?: number): ExportFile => ({
  kind,
  filename,
  blob: new Blob([new Uint8Array(bytes)]),
  photoCount,
});
const result = (files: ExportFile[], warnings: string[] = []): ExportResult => ({ files, warnings, counts: { Members: 3 } });
const WORKBOOK = file('workbook', 'fit-and-fine-data-2026-10-06.xlsx', 2048);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderPage(run: ReturnType<typeof vi.fn>, options: RenderOptions = {}) {
  return renderWithProviders(<DataBackupPage />, {
    route: '/data-backup',
    auth: { currentProfile: buildAdminProfile() },
    ...options,
    services: fakeServices({ dataExportService: { run } }),
  });
}

const exportButton = () => screen.getByRole('button', { name: 'Export data' });
const optionsOf = (run: ReturnType<typeof vi.fn>, call = 0) => run.mock.calls[call][0] as ExportOptions;

describe('DataBackupPage — idle', () => {
  it('shows the heading, the admin section tabs and the personal-data notice', () => {
    renderPage(vi.fn());
    expect(screen.getByRole('heading', { name: 'Data Backup' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Admin sections' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Backup' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText(/personal and medical data/)).toBeInTheDocument();
    expect(screen.getByText(/Passwords are never exported/)).toBeInTheDocument();
  });

  it('offers the audit log and the photos, both on by default, and an enabled Export button', () => {
    renderPage(vi.fn());
    expect(screen.getByRole('checkbox', { name: 'Include audit log (can be large)' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Include member photos (separate .zip)' })).toBeChecked();
    expect(exportButton()).toBeEnabled();
  });

  it('shows nothing about progress, results or errors yet', () => {
    renderPage(vi.fn());
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText(/Export ready/)).not.toBeInTheDocument();
    expect(screen.queryByText(/failed/i)).not.toBeInTheDocument();
  });

  it('renders no table or card list (it has only one rendering at any width)', () => {
    for (const viewport of [MOBILE_WIDTH, 1280]) {
      const { unmount } = renderPage(vi.fn(), { viewport });
      expect(document.querySelectorAll('table')).toHaveLength(0);
      unmount();
    }
  });
});

describe('DataBackupPage — starting an export', () => {
  it('passes the options as chosen, the signed-in admin\'s email, and an AbortSignal', async () => {
    const run = vi.fn().mockResolvedValue(result([WORKBOOK]));
    const { user } = renderPage(run);
    await user.click(exportButton());
    await screen.findByText(/Export ready/);
    expect(run).toHaveBeenCalledTimes(1);
    expect(optionsOf(run)).toMatchObject({ includeAuditLog: true, includePhotos: true, exportedBy: 'priya@fitandfine.in' });
    expect(optionsOf(run).signal).toBeInstanceOf(AbortSignal);
    expect(optionsOf(run).onProgress).toBeTypeOf('function');
  });

  it('honours unticked options', async () => {
    const run = vi.fn().mockResolvedValue(result([WORKBOOK]));
    const { user } = renderPage(run);
    await user.click(screen.getByRole('checkbox', { name: 'Include audit log (can be large)' }));
    await user.click(screen.getByRole('checkbox', { name: 'Include member photos (separate .zip)' }));
    await user.click(exportButton());
    await screen.findByText(/Export ready/);
    expect(optionsOf(run)).toMatchObject({ includeAuditLog: false, includePhotos: false });
  });

  it('while running: the button and both checkboxes are disabled, a status region announces progress, and Cancel is offered', async () => {
    const gate = deferred<ExportResult>();
    const { user } = renderPage(vi.fn().mockReturnValue(gate.promise));
    await user.click(exportButton());

    expect(await screen.findByText('Starting export…')).toBeInTheDocument();
    expect(exportButton()).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Include audit log (can be large)' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Include member photos (separate .zip)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(screen.getByRole('status')).toContainElement(screen.getByRole('progressbar', { name: 'Export progress' }));
    await act(async () => gate.resolve(result([WORKBOOK])));
  });
});

describe('DataBackupPage — progress', () => {
  async function startAndReport(progress: Parameters<NonNullable<ExportOptions['onProgress']>>[0]) {
    const gate = deferred<ExportResult>();
    const run = vi.fn().mockReturnValue(gate.promise);
    const utils = renderPage(run);
    await utils.user.click(exportButton());
    await act(async () => optionsOf(run).onProgress!(progress));
    return { ...utils, gate };
  }

  it('reading: names the table, shows the running row count and a percentage of tables done', async () => {
    const { gate } = await startAndReport({ phase: 'reading', table: 'members', rows: 1200, step: 5, steps: 10 });
    expect(screen.getByText('Reading members… 1,200 rows')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: 'Export progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuetext', 'Reading members… 1,200 rows');
    await act(async () => gate.resolve(result([WORKBOOK])));
  });

  it.each([
    ['audit_log', 'audit log'],
    ['user_roles', 'user roles'],
    ['member_number_sequences', 'member number counters'],
    ['subscription_items', 'subscription items'],
  ] as const)('reading %s is labelled in plain words ("%s")', async (table, label) => {
    const { gate } = await startAndReport({ phase: 'reading', table, rows: 3, step: 1, steps: 11 });
    expect(screen.getByText(`Reading ${label}… 3 rows`)).toBeInTheDocument();
    await act(async () => gate.resolve(result([WORKBOOK])));
  });

  it('photos: shows done / total and the matching percentage', async () => {
    const { gate } = await startAndReport({ phase: 'photos', done: 120, total: 340 });
    expect(screen.getByText('Downloading photos… 120 / 340')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '35');
    await act(async () => gate.resolve(result([WORKBOOK])));
  });

  it('building: indeterminate — no aria-valuenow, so a screen reader is not told a false percentage', async () => {
    const { gate } = await startAndReport({ phase: 'building' });
    expect(screen.getByText('Building workbook…')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    await act(async () => gate.resolve(result([WORKBOOK])));
  });
});

describe('DataBackupPage — cancelling', () => {
  it('Cancel aborts the signal given to the service; when it settles as cancelled the page says nothing was downloaded', async () => {
    const gate = deferred<ExportResult>();
    const run = vi.fn().mockReturnValue(gate.promise);
    const { user } = renderPage(run);
    await user.click(exportButton());
    const signal = optionsOf(run).signal!;
    expect(signal.aborted).toBe(false);

    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(signal.aborted).toBe(true);

    await act(async () => gate.reject(new ExportCancelledError()));
    expect(await screen.findByText('Export cancelled. Nothing was downloaded.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/failed/i)).not.toBeInTheDocument();
    expect(exportButton()).toBeEnabled();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('leaving the page mid-export aborts it instead of leaving it running unseen', async () => {
    const gate = deferred<ExportResult>();
    const run = vi.fn().mockReturnValue(gate.promise);
    const { user, unmount } = renderPage(run);
    await user.click(exportButton());
    const signal = optionsOf(run).signal!;
    unmount();
    expect(signal.aborted).toBe(true);
  });
});

describe('DataBackupPage — a finished export', () => {
  it('offers the workbook as a download with its filename and size', async () => {
    const run = vi.fn().mockResolvedValue(result([WORKBOOK]));
    const { user } = renderPage(run);
    await user.click(exportButton());

    expect(await screen.findByText('Export ready. Download the file below.')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Download data \(\.xlsx\)/ });
    expect(link).toHaveAttribute('download', 'fit-and-fine-data-2026-10-06.xlsx');
    expect(link).toHaveAttribute('href', created[0]);
    expect(within(link).getByText('2 KB')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /photos/i })).not.toBeInTheDocument();
    expect(exportButton()).toBeEnabled();
  });

  it('offers the photo zip separately, with its photo count and size', async () => {
    const run = vi.fn().mockResolvedValue(
      result([WORKBOOK, file('photos', 'fit-and-fine-photos-2026-10-06.zip', 3 * 1024 * 1024, 1340)])
    );
    const { user } = renderPage(run);
    await user.click(exportButton());

    expect(await screen.findByText('Export ready. Download the files below.')).toBeInTheDocument();
    const zip = screen.getByRole('link', { name: /Download photos \(\.zip\)/ });
    expect(zip).toHaveAttribute('download', 'fit-and-fine-photos-2026-10-06.zip');
    expect(within(zip).getByText('1,340 photos · 3.0 MB')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Download/ })).toHaveLength(2);
  });

  it('labels several zip parts "part N of M"', async () => {
    const run = vi.fn().mockResolvedValue(
      result([
        WORKBOOK,
        file('photos', 'fit-and-fine-photos-2026-10-06-part-1.zip', 1024, 10),
        file('photos', 'fit-and-fine-photos-2026-10-06-part-2.zip', 1024, 4),
      ])
    );
    const { user } = renderPage(run);
    await user.click(exportButton());
    expect(await screen.findByRole('link', { name: /Download photos part 1 of 2 \(\.zip\)/ })).toHaveAttribute(
      'download',
      'fit-and-fine-photos-2026-10-06-part-1.zip'
    );
    expect(screen.getByRole('link', { name: /Download photos part 2 of 2 \(\.zip\)/ })).toBeInTheDocument();
  });

  it('lists warnings, capped at 20 with a pointer to the README for the rest', async () => {
    const warnings = Array.from({ length: 25 }, (_, i) => `Photo for member MUM-${i} could not be read and was skipped.`);
    const run = vi.fn().mockResolvedValue(result([WORKBOOK], warnings));
    const { user } = renderPage(run);
    await user.click(exportButton());

    expect(await screen.findByText('Heads-up (25)')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(20);
    expect(screen.getByText(/…and 5 more \(listed in the workbook's README sheet\)/)).toBeInTheDocument();
  });

  it('shows no warnings block when there are none', async () => {
    const { user } = renderPage(vi.fn().mockResolvedValue(result([WORKBOOK])));
    await user.click(exportButton());
    await screen.findByText(/Export ready/);
    expect(screen.queryByText(/Heads-up/)).not.toBeInTheDocument();
  });

  it('releases the blob URLs when a new export starts and when the page is left', async () => {
    const gate = deferred<ExportResult>();
    const run = vi.fn().mockResolvedValueOnce(result([WORKBOOK])).mockReturnValueOnce(gate.promise);
    const { user, unmount } = renderPage(run);

    await user.click(exportButton());
    await screen.findByText(/Export ready/);
    expect(created).toHaveLength(1);
    expect(revoked).toEqual([]);

    await user.click(exportButton()); // a second export: the first result's URL must be freed
    await screen.findByText('Starting export…');
    expect(revoked).toEqual([created[0]]);

    await act(async () => gate.resolve(result([WORKBOOK])));
    await screen.findByText(/Export ready/);
    unmount();
    expect(revoked).toEqual([created[0], created[1]]);
  });
});

describe('DataBackupPage — failures', () => {
  it('offline: says to check the connection and offers Retry, which runs the whole export again', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue(result([WORKBOOK]));
    const { user } = renderPage(run);
    await user.click(exportButton());

    expect(await screen.findByText("Couldn't finish the export — check your connection and try again.")).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Download/ })).not.toBeInTheDocument(); // never a partial file
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText(/Export ready/)).toBeInTheDocument();
    expect(run).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/check your connection/)).not.toBeInTheDocument();
  });

  it.each(['Load failed', 'TypeError: Failed to fetch', 'NetworkError when attempting to fetch resource.'])(
    'recognises the %j browser wording as offline too',
    async (message) => {
      const { user } = renderPage(vi.fn().mockRejectedValue(new Error(message)));
      await user.click(exportButton());
      expect(await screen.findByText(/check your connection/)).toBeInTheDocument();
    }
  );

  it('a server error is shown with its message, with Retry', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('Admin access required')).mockResolvedValue(result([WORKBOOK]));
    const { user } = renderPage(run);
    await user.click(exportButton());

    expect(await screen.findByText('The export failed: Admin access required')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/Export ready/)).toBeInTheDocument();
  });

  it('an error with no message falls back to a generic sentence', async () => {
    const { user } = renderPage(vi.fn().mockRejectedValue('weird'));
    await user.click(exportButton());
    expect(await screen.findByText('Something went wrong during the export. Please try again.')).toBeInTheDocument();
  });

  it('a failed export re-enables the controls', async () => {
    const { user } = renderPage(vi.fn().mockRejectedValue(new Error('boom')));
    await user.click(exportButton());
    await screen.findByText(/The export failed/);
    expect(exportButton()).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: 'Include audit log (can be large)' })).toBeEnabled();
  });
});
