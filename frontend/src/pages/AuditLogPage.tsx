import { useEffect, useState, type FormEvent } from 'react';
import { RefreshCw } from 'lucide-react';
import { useServices } from '../context/services.context';
import { withTimeout } from '../lib/with-timeout';
import { todayDate, firstOfCurrentMonth, toLocalDisplay } from '../lib/datetime';
import { AUDITED_TABLES } from '../repositories/audit-log.repository';
import type { AuditLogEntry, AuditOperation } from '../types/audit-log';
import type { ManagedUser } from '../types/profile';
import './AuditLogPage.css';

const FETCH_TIMEOUT_MS = 10000;
type LoadState = 'loading' | 'loaded' | 'network-error' | 'generic-error';

const OPERATION_LABEL: Record<AuditOperation, string> = {
  insert: 'Created',
  update: 'Updated',
  delete: 'Deleted',
};

function displayValue(value: string | null): string {
  return value === null ? '—' : value;
}

/**
 * Audit Log overview (REQ-ADMIN-005) — admin-only, strictly view-only: no edit/delete
 * action anywhere on this screen, or anywhere else in the app, for any AuditLog entry.
 * Filterable by table name, record id, date range, and who made the change, per the
 * acceptance criteria. See spec/backend/domain-model.md §7 for what feeds this table.
 */
export function AuditLogPage() {
  const { auditLogRepository, profileRepository } = useServices();

  const [users, setUsers] = useState<ManagedUser[]>([]);

  const [startDate, setStartDate] = useState(firstOfCurrentMonth());
  const [endDate, setEndDate] = useState(todayDate());
  const [tableName, setTableName] = useState('');
  const [recordId, setRecordId] = useState('');
  const [changedBy, setChangedBy] = useState('');
  const [rangeError, setRangeError] = useState<string | null>(null);

  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>('loading');

  async function load(filters: { startDate: string; endDate: string; tableName: string; recordId: string; changedBy: string }) {
    setLoadState('loading');
    try {
      const page = await withTimeout(
        auditLogRepository.getFiltered({
          startDate: filters.startDate,
          endDate: filters.endDate,
          tableName: filters.tableName || null,
          recordId: filters.recordId || null,
          changedBy: filters.changedBy || null,
        }),
        FETCH_TIMEOUT_MS,
        new Error('audit-log-timeout')
      );
      setEntries(page.rows);
      setTruncated(page.truncated);
      setLoadState('loaded');
    } catch (err) {
      const isNetwork = err instanceof Error && (err.message === 'audit-log-timeout' || err.message === 'Failed to fetch');
      setLoadState(isNetwork ? 'network-error' : 'generic-error');
    }
  }

  async function loadUsers() {
    try {
      const all = await withTimeout(profileRepository.getAllUsers(), FETCH_TIMEOUT_MS, new Error('users-timeout'));
      setUsers([...all].sort((a, b) => a.full_name.localeCompare(b.full_name)));
    } catch {
      // The "Changed by" dropdown is a filter convenience, not load-bearing — if it fails
      // to load, filtering by table/record/date range still works without it.
    }
  }

  const applied = { startDate, endDate, tableName, recordId, changedBy };

  useEffect(() => {
    loadUsers();
    load(applied);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleApply(event: FormEvent) {
    event.preventDefault();
    if (endDate < startDate) {
      setRangeError('End date must be on or after the start date.');
      return;
    }
    setRangeError(null);
    load(applied);
  }

  return (
    <div className="audit-log-page">
      <div className="audit-log-page-header">
        <h1>Audit Log</h1>
      </div>

      <form className="audit-log-filters" onSubmit={handleApply}>
        <div className="audit-log-filter-field">
          <label htmlFor="audit-start">Start date</label>
          <input id="audit-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="audit-log-filter-field">
          <label htmlFor="audit-end">End date</label>
          <input id="audit-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <div className="audit-log-filter-field">
          <label htmlFor="audit-table">Table</label>
          <select id="audit-table" value={tableName} onChange={(e) => setTableName(e.target.value)}>
            <option value="">All tables</option>
            {AUDITED_TABLES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="audit-log-filter-field">
          <label htmlFor="audit-record">Record ID</label>
          <input
            id="audit-record"
            type="text"
            value={recordId}
            onChange={(e) => setRecordId(e.target.value)}
            placeholder="e.g. 42"
          />
        </div>
        <div className="audit-log-filter-field">
          <label htmlFor="audit-changed-by">Changed by</label>
          <select id="audit-changed-by" value={changedBy} onChange={(e) => setChangedBy(e.target.value)}>
            <option value="">Anyone</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="audit-log-apply">
          Apply
        </button>
      </form>
      {rangeError && <p className="audit-log-range-error">{rangeError}</p>}

      {loadState === 'loading' && <div className="audit-log-skeleton" aria-label="Loading" />}

      {(loadState === 'network-error' || loadState === 'generic-error') && (
        <div className="audit-log-load-error">
          <p>
            {loadState === 'network-error'
              ? "Couldn't load the audit log — check your connection and try again."
              : 'Something went wrong loading the audit log. Please try again.'}
          </p>
          <button type="button" className="audit-log-retry" onClick={() => load(applied)}>
            <RefreshCw size={16} strokeWidth={2} />
            Retry
          </button>
        </div>
      )}

      {loadState === 'loaded' && (
        <>
          {truncated && (
            <p className="audit-log-truncated-notice">
              Showing the most recent 500 changes for these filters — narrow the date range or add a filter to see more.
            </p>
          )}

          {entries.length === 0 ? (
            <p className="audit-log-empty">No changes match these filters.</p>
          ) : (
            <>
              <div className="audit-log-cards">
                {entries.map((entry) => (
                  <div key={entry.id} className="audit-log-card">
                    <div className="audit-log-card-top">
                      <span className={`audit-log-op-badge audit-log-op-${entry.operation}`}>
                        {OPERATION_LABEL[entry.operation]}
                      </span>
                      <span className="audit-log-card-when">{toLocalDisplay(entry.changed_at)}</span>
                    </div>
                    <p className="audit-log-card-target">
                      {entry.table_name} #{entry.record_id} · {entry.field_name}
                    </p>
                    <p className="audit-log-card-diff">
                      {displayValue(entry.old_value)} → {displayValue(entry.new_value)}
                    </p>
                    <p className="audit-log-card-who">{entry.changed_by_name}</p>
                  </div>
                ))}
              </div>

              <table className="audit-log-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Table</th>
                    <th>Record</th>
                    <th>Field</th>
                    <th>Operation</th>
                    <th>Old value</th>
                    <th>New value</th>
                    <th>Changed by</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <td>{toLocalDisplay(entry.changed_at)}</td>
                      <td>{entry.table_name}</td>
                      <td>{entry.record_id}</td>
                      <td>{entry.field_name}</td>
                      <td>
                        <span className={`audit-log-op-badge audit-log-op-${entry.operation}`}>
                          {OPERATION_LABEL[entry.operation]}
                        </span>
                      </td>
                      <td>{displayValue(entry.old_value)}</td>
                      <td>{displayValue(entry.new_value)}</td>
                      <td>{entry.changed_by_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </div>
  );
}
