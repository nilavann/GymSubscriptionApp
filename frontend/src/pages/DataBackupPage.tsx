import { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';
import { useAuth } from '../context/auth.context';
import { useServices } from '../context/services.context';
import { AdminTabs } from '../components/AdminTabs';
import { isNetworkError } from '../lib/network-error';
import { ExportCancelledError, type ExportFile, type ExportProgress, type ExportResult } from '../services/data-export.service';
import type { ExportTable } from '../lib/data-transfer/workbook-schema';
import './DataBackupPage.css';

type ExportState =
  | { kind: 'idle' }
  | { kind: 'running'; progress: ExportProgress | null }
  | { kind: 'ready'; result: ExportResult }
  | { kind: 'cancelled' }
  | { kind: 'offline' }
  | { kind: 'error'; message: string };

interface DownloadLink {
  file: ExportFile;
  url: string;
}

const TABLE_LABEL: Record<ExportTable, string> = {
  branches: 'branches',
  plans: 'plans',
  roles: 'roles',
  users: 'users',
  user_roles: 'user roles',
  configuration: 'configuration',
  member_number_sequences: 'member number counters',
  members: 'members',
  subscriptions: 'subscriptions',
  subscription_items: 'subscription items',
  audit_log: 'audit log',
};

const MAX_WARNINGS_SHOWN = 20;

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function describe(progress: ExportProgress | null): { text: string; percent: number | null } {
  if (!progress) return { text: 'Starting export…', percent: 0 };
  if (progress.phase === 'reading') {
    return {
      text: `Reading ${TABLE_LABEL[progress.table]}… ${progress.rows.toLocaleString('en-US')} rows`,
      percent: Math.round((progress.step / progress.steps) * 100),
    };
  }
  if (progress.phase === 'photos') {
    return {
      text: `Downloading photos… ${progress.done.toLocaleString('en-US')} / ${progress.total.toLocaleString('en-US')}`,
      percent: Math.round((progress.done / progress.total) * 100),
    };
  }
  return { text: 'Building workbook…', percent: null };
}

/**
 * Data Backup (WSCR-17, REQ-ADMIN-007) — exports every table to one Excel workbook plus the member
 * photos as a separate zip. Export only reads; nothing here ever changes data. All reading and file
 * building lives in `dataExportService`; this page only holds UI state.
 * Spec: spec/frontend/data-export-import.md §3.
 */
export function DataBackupPage() {
  const { session } = useAuth();
  const { dataExportService } = useServices();

  const [includeAuditLog, setIncludeAuditLog] = useState(true);
  const [includePhotos, setIncludePhotos] = useState(true);
  const [state, setState] = useState<ExportState>({ kind: 'idle' });
  const [links, setLinks] = useState<DownloadLink[]>([]);
  const controllerRef = useRef<AbortController | null>(null);

  // Blob URLs live exactly as long as the "ready" result they belong to — revoked on a new export / leaving the page.
  useEffect(() => {
    if (state.kind !== 'ready') {
      setLinks([]);
      return;
    }
    const created = state.result.files.map((file) => ({ file, url: URL.createObjectURL(file.blob) }));
    setLinks(created);
    return () => created.forEach((link) => URL.revokeObjectURL(link.url));
  }, [state]);

  // Leaving the page mid-export stops the work instead of leaving it running unseen.
  useEffect(() => () => controllerRef.current?.abort(), []);

  const running = state.kind === 'running';

  async function startExport() {
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ kind: 'running', progress: null });
    try {
      const result = await dataExportService.run({
        includeAuditLog,
        includePhotos,
        exportedBy: session?.user.email ?? '',
        signal: controller.signal,
        onProgress: (progress) => setState({ kind: 'running', progress }),
      });
      setState({ kind: 'ready', result });
    } catch (error) {
      if (error instanceof ExportCancelledError) {
        setState({ kind: 'cancelled' });
      } else if (isNetworkError(error)) {
        setState({ kind: 'offline' });
      } else {
        const message = error instanceof Error ? error.message : '';
        setState({ kind: 'error', message });
      }
    }
  }

  const progress = state.kind === 'running' ? describe(state.progress) : null;
  const photoZips = links.filter((link) => link.file.kind === 'photos');

  return (
    <div className="data-backup-page">
      <div className="data-backup-page-header">
        <h1>Data Backup</h1>
      </div>

      <AdminTabs />

      <p className="data-backup-notice">
        Exports contain personal and medical data (Aadhaar numbers, medical notes, emergency contacts, emails). Store them
        securely. Passwords are never exported.
      </p>

      <section className="data-backup-section" aria-labelledby="data-backup-export-title">
        <h2 id="data-backup-export-title" className="data-backup-section-title">
          Export
        </h2>
        <p className="data-backup-hint">
          Downloads every record — including deleted ones, flagged as deleted — as one Excel workbook, and the member photos as
          a separate zip file.
        </p>

        <div className="data-backup-options">
          <label className="data-backup-check">
            <input type="checkbox" checked={includeAuditLog} disabled={running} onChange={(e) => setIncludeAuditLog(e.target.checked)} />
            Include audit log (can be large)
          </label>
          <label className="data-backup-check">
            <input type="checkbox" checked={includePhotos} disabled={running} onChange={(e) => setIncludePhotos(e.target.checked)} />
            Include member photos (separate .zip)
          </label>
        </div>

        <button type="button" className="data-backup-primary" onClick={startExport} disabled={running}>
          <Download size={16} strokeWidth={2} />
          Export data
        </button>

        <div className="data-backup-status" role="status" aria-live="polite">
          {progress && (
            <div className="data-backup-progress">
              <p className="data-backup-progress-text">{progress.text}</p>
              <div
                className={`data-backup-bar${progress.percent === null ? ' data-backup-bar-indeterminate' : ''}`}
                role="progressbar"
                aria-label="Export progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress.percent ?? undefined}
                aria-valuetext={progress.text}
              >
                <span className="data-backup-bar-fill" style={progress.percent === null ? undefined : { width: `${progress.percent}%` }} />
              </div>
              <button type="button" className="data-backup-secondary" onClick={() => controllerRef.current?.abort()}>
                <X size={16} strokeWidth={2} />
                Cancel
              </button>
            </div>
          )}

          {state.kind === 'ready' && (
            <div className="data-backup-ready">
              <p className="data-backup-banner-success">Export ready. Download the file{photoZips.length > 0 ? 's' : ''} below.</p>
              <div className="data-backup-downloads">
                {links.map((link) => (
                  <a key={link.file.filename} className="data-backup-download" href={link.url} download={link.file.filename}>
                    <Download size={16} strokeWidth={2} />
                    {link.file.kind === 'workbook'
                      ? 'Download data (.xlsx)'
                      : photoZips.length > 1
                        ? `Download photos part ${photoZips.indexOf(link) + 1} of ${photoZips.length} (.zip)`
                        : 'Download photos (.zip)'}
                    <span className="data-backup-download-meta">
                      {link.file.kind === 'photos' && link.file.photoCount !== undefined
                        ? `${link.file.photoCount.toLocaleString('en-US')} photos · `
                        : ''}
                      {formatSize(link.file.blob.size)}
                    </span>
                  </a>
                ))}
              </div>
              {state.result.warnings.length > 0 && (
                <div className="data-backup-warnings">
                  <p className="data-backup-warnings-title">Heads-up ({state.result.warnings.length})</p>
                  <ul>
                    {state.result.warnings.slice(0, MAX_WARNINGS_SHOWN).map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                  {state.result.warnings.length > MAX_WARNINGS_SHOWN && (
                    <p>…and {state.result.warnings.length - MAX_WARNINGS_SHOWN} more (listed in the workbook's README sheet).</p>
                  )}
                </div>
              )}
            </div>
          )}

          {state.kind === 'cancelled' && <p className="data-backup-banner-neutral">Export cancelled. Nothing was downloaded.</p>}

          {state.kind === 'offline' && (
            <div className="data-backup-banner-error">
              <p>Couldn't finish the export — check your connection and try again.</p>
              <button type="button" className="data-backup-retry" onClick={startExport}>
                <RefreshCw size={16} strokeWidth={2} />
                Retry
              </button>
            </div>
          )}

          {state.kind === 'error' && (
            <div className="data-backup-banner-error">
              <p>{state.message ? `The export failed: ${state.message}` : 'Something went wrong during the export. Please try again.'}</p>
              <button type="button" className="data-backup-retry" onClick={startExport}>
                <RefreshCw size={16} strokeWidth={2} />
                Retry
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
