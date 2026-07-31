import { useEffect, useState, type FormEvent } from 'react';
import { Pencil, Check, X, RefreshCw } from 'lucide-react';
import { useServices } from '../context/services.context';
import { withTimeout } from '../lib/with-timeout';
import { sanitizeDigits } from '../lib/input-masks';
import { AdminTabs } from '../components/AdminTabs';
import type { ConfigDraft, ConfigFormErrors } from '../services/member-numbering.service';
import type { MemberNumberConfig, BranchSequence } from '../types/member-numbering';
import './MemberNumberingPage.css';

const FETCH_TIMEOUT_MS = 10000;
type LoadState = 'loading' | 'loaded' | 'network-error' | 'generic-error';

/** Preview only — the real value always comes from the server (generate_member_number() /
 * update-member-number-sequence), same "client previews, server decides" split as
 * RenewSubscriptionPage's end_date preview. Always stamped with the *current* calendar
 * year, since that's what a registration happening right now would actually receive — the
 * counter itself no longer resets at a year boundary, so there's no other year to preview. */
function formatMemberNumber(code: string, sequence: number, width: number): string {
  return `${code}-${new Date().getFullYear()}-${String(sequence).padStart(width, '0')}`;
}

/**
 * Member Numbering settings (spec/backend/member-management.md §3.1) — lets an admin tune
 * the global start/increment/padding settings generate_member_number() reads, and view/edit
 * each branch's independent counter. Every branch's counter is fully independent of every
 * other branch's (member_number_sequences is keyed by branch_id) and increments
 * continuously for that branch's lifetime — it never resets, including at a calendar-year
 * boundary; only the year embedded in the formatted string changes, reflecting whenever a
 * member actually registered.
 */
export function MemberNumberingPage() {
  const { memberNumberingRepository, memberNumberingService } = useServices();

  const [config, setConfig] = useState<MemberNumberConfig | null>(null);
  const [configDraft, setConfigDraft] = useState<ConfigDraft>({ start_sequence: '', increment: '', padding_width: '' });
  const [configErrors, setConfigErrors] = useState<ConfigFormErrors>({});
  const [configTouched, setConfigTouched] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [configSaveError, setConfigSaveError] = useState<string | null>(null);
  const [configSaved, setConfigSaved] = useState(false);

  const [sequences, setSequences] = useState<BranchSequence[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');

  const [editingBranchId, setEditingBranchId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [isSavingSequence, setIsSavingSequence] = useState(false);

  async function loadAll() {
    setLoadState('loading');
    try {
      const cfg = await withTimeout(memberNumberingRepository.getConfig(), FETCH_TIMEOUT_MS, new Error('config-timeout'));
      setConfig(cfg);
      setConfigDraft(memberNumberingService.configToDraft(cfg));
      const rows = await withTimeout(memberNumberingRepository.getSequences(cfg), FETCH_TIMEOUT_MS, new Error('sequences-timeout'));
      setSequences(rows);
      setLoadState('loaded');
    } catch (err) {
      const isNetwork = err instanceof Error && (err.message.endsWith('-timeout') || err.message === 'Failed to fetch');
      setLoadState(isNetwork ? 'network-error' : 'generic-error');
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConfigSubmit(event: FormEvent) {
    event.preventDefault();
    setConfigTouched(true);
    setConfigSaved(false);
    const validationErrors = memberNumberingService.validateConfig(configDraft);
    setConfigErrors(validationErrors);
    if (!memberNumberingService.isConfigValid(validationErrors)) return;

    setConfigSaveError(null);
    setIsSavingConfig(true);
    try {
      await memberNumberingService.updateConfig(configDraft);
      setConfigSaved(true);
      await loadAll();
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setConfigSaveError(
        message === 'Failed to fetch'
          ? "Couldn't save these settings — check your connection and try again."
          : 'Something went wrong saving these settings. Please try again.'
      );
      // The write itself is atomic (update_member_number_config), but the response could
      // still be lost after the server-side commit succeeded (e.g. connection drop right
      // after). Reconcile from the actual DB state rather than leaving the pre-submit draft
      // on screen looking unsaved when it may not be.
      await loadAll();
    } finally {
      setIsSavingConfig(false);
    }
  }

  function startEdit(seq: BranchSequence) {
    setEditingBranchId(seq.branch_id);
    setEditValue(String(seq.next_sequence));
    setEditError(null);
  }

  function cancelEdit() {
    setEditingBranchId(null);
    setEditError(null);
  }

  async function handleSaveSequence(seq: BranchSequence) {
    const { value, error } = memberNumberingService.validateNextSequenceInput(editValue);
    if (error || value === null) {
      setEditError(error);
      return;
    }
    setEditError(null);
    setIsSavingSequence(true);
    try {
      const result = await memberNumberingRepository.updateSequence(seq.branch_id, value);
      setEditingBranchId(null);
      await loadAll();
      if (result.adjusted) {
        window.alert(
          `${seq.branch_name}: ${result.requested} was already used for this branch — set to ${result.next_sequence} instead.`
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setEditError(
        message === 'Failed to fetch' ? "Couldn't save — check your connection and try again." : message || 'Something went wrong. Please try again.'
      );
    } finally {
      setIsSavingSequence(false);
    }
  }

  if (loadState === 'loading' && !config) {
    return (
      <div className="member-numbering-page">
        <div className="member-numbering-skeleton" aria-label="Loading" />
      </div>
    );
  }

  if ((loadState === 'network-error' || loadState === 'generic-error') && !config) {
    return (
      <div className="member-numbering-page">
        <div className="member-numbering-load-error">
          <p>
            {loadState === 'network-error'
              ? "Couldn't load member numbering settings — check your connection and try again."
              : 'Something went wrong loading member numbering settings. Please try again.'}
          </p>
          <button type="button" className="member-numbering-retry" onClick={loadAll}>
            <RefreshCw size={16} strokeWidth={2} />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="member-numbering-page">
      <div className="member-numbering-page-header">
        <h1>Member Numbering</h1>
      </div>

      <AdminTabs />

      <section className="member-numbering-section">
        <h2 className="member-numbering-section-title">Per-Branch Sequences</h2>
        <p className="member-numbering-hint">
          Each branch's counter is completely independent — editing one branch's next number never affects any other
          branch — and increments continuously for that branch's whole lifetime; it never resets at a new calendar
          year (only the year shown in the number itself changes, reflecting when a member actually registers). If
          the value you set has already been issued to a member at this branch in any year (active or deleted —
          member numbers are never reused), it's automatically moved forward to the next number that hasn't been
          used yet.
        </p>

        {loadState === 'loading' && <div className="member-numbering-skeleton" aria-label="Loading" />}

        {(loadState === 'network-error' || loadState === 'generic-error') && (
          <div className="member-numbering-load-error">
            <p>
              {loadState === 'network-error'
                ? "Couldn't load sequences — check your connection and try again."
                : 'Something went wrong loading sequences. Please try again.'}
            </p>
            <button type="button" className="member-numbering-retry" onClick={loadAll}>
              <RefreshCw size={16} strokeWidth={2} />
              Retry
            </button>
          </div>
        )}

        {loadState === 'loaded' && config && (
          <>
            <div className="member-numbering-cards">
              {sequences.map((seq) => (
                <div key={seq.branch_id} className="member-numbering-card">
                  <div className="member-numbering-card-top">
                    <span className="member-numbering-card-name">{seq.branch_name}</span>
                    <span className="member-numbering-card-code">{seq.branch_code}</span>
                  </div>
                  <p className="member-numbering-card-row">
                    Last issued: {seq.last_sequence === null ? 'None yet' : formatMemberNumber(seq.branch_code, seq.last_sequence, config.padding_width)}
                  </p>
                  {editingBranchId === seq.branch_id ? (
                    <div className="member-numbering-edit-row">
                      <input
                        inputMode="numeric"
                        value={editValue}
                        onChange={(e) => setEditValue(sanitizeDigits(e.target.value, 8))}
                        disabled={isSavingSequence}
                      />
                      <button type="button" className="member-numbering-icon-button" disabled={isSavingSequence} onClick={cancelEdit}>
                        <X size={16} strokeWidth={2} />
                      </button>
                      <button
                        type="button"
                        className="member-numbering-icon-button member-numbering-icon-button-primary"
                        disabled={isSavingSequence}
                        onClick={() => handleSaveSequence(seq)}
                      >
                        {isSavingSequence ? <RefreshCw size={16} strokeWidth={2} className="member-numbering-spin" /> : <Check size={16} strokeWidth={2} />}
                      </button>
                    </div>
                  ) : (
                    <p className="member-numbering-card-row">
                      Next: <strong>{formatMemberNumber(seq.branch_code, seq.next_sequence, config.padding_width)}</strong>
                      <button type="button" className="member-numbering-edit-link" onClick={() => startEdit(seq)}>
                        <Pencil size={14} strokeWidth={2} />
                        Edit
                      </button>
                    </p>
                  )}
                  {editingBranchId === seq.branch_id && editError && <p className="member-numbering-field-error">{editError}</p>}
                </div>
              ))}
            </div>

            <table className="member-numbering-table">
              <thead>
                <tr>
                  <th>Branch</th>
                  <th>Last issued</th>
                  <th>Next number</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sequences.map((seq) => (
                  <tr key={seq.branch_id}>
                    <td>
                      {seq.branch_name} <span className="member-numbering-table-code">({seq.branch_code})</span>
                    </td>
                    <td>{seq.last_sequence === null ? 'None yet' : formatMemberNumber(seq.branch_code, seq.last_sequence, config.padding_width)}</td>
                    <td>
                      {editingBranchId === seq.branch_id ? (
                        <div className="member-numbering-edit-row">
                          <input
                            inputMode="numeric"
                            value={editValue}
                            onChange={(e) => setEditValue(sanitizeDigits(e.target.value, 8))}
                            disabled={isSavingSequence}
                          />
                          {editError && <p className="member-numbering-field-error">{editError}</p>}
                        </div>
                      ) : (
                        <strong>{formatMemberNumber(seq.branch_code, seq.next_sequence, config.padding_width)}</strong>
                      )}
                    </td>
                    <td>
                      {editingBranchId === seq.branch_id ? (
                        <div className="member-numbering-table-actions">
                          <button type="button" className="member-numbering-icon-button" disabled={isSavingSequence} onClick={cancelEdit}>
                            <X size={16} strokeWidth={2} />
                          </button>
                          <button
                            type="button"
                            className="member-numbering-icon-button member-numbering-icon-button-primary"
                            disabled={isSavingSequence}
                            onClick={() => handleSaveSequence(seq)}
                          >
                            {isSavingSequence ? (
                              <RefreshCw size={16} strokeWidth={2} className="member-numbering-spin" />
                            ) : (
                              <Check size={16} strokeWidth={2} />
                            )}
                          </button>
                        </div>
                      ) : (
                        <button type="button" className="member-numbering-edit-link" onClick={() => startEdit(seq)}>
                          <Pencil size={14} strokeWidth={2} />
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section className="member-numbering-section">
        <h2 className="member-numbering-section-title">Global Settings</h2>
        <p className="member-numbering-hint">
          Applies to every branch's counter. Changing these affects only future member numbers — existing numbers are
          never recalculated.
        </p>

        <form className="member-numbering-config-form" onSubmit={handleConfigSubmit} noValidate>
          <div className="member-numbering-config-field">
            <label htmlFor="config-start">Start sequence</label>
            <input
              id="config-start"
              inputMode="numeric"
              value={configDraft.start_sequence}
              onChange={(e) => setConfigDraft({ ...configDraft, start_sequence: sanitizeDigits(e.target.value, 8) })}
              onBlur={() => setConfigTouched(true)}
            />
            {configTouched && configErrors.start_sequence && <p className="member-numbering-field-error">{configErrors.start_sequence}</p>}
          </div>

          <div className="member-numbering-config-field">
            <label htmlFor="config-increment">Increment</label>
            <input
              id="config-increment"
              inputMode="numeric"
              value={configDraft.increment}
              onChange={(e) => setConfigDraft({ ...configDraft, increment: sanitizeDigits(e.target.value, 6) })}
              onBlur={() => setConfigTouched(true)}
            />
            {configTouched && configErrors.increment && <p className="member-numbering-field-error">{configErrors.increment}</p>}
          </div>

          <div className="member-numbering-config-field">
            <label htmlFor="config-width">Padding width</label>
            <input
              id="config-width"
              inputMode="numeric"
              value={configDraft.padding_width}
              onChange={(e) => setConfigDraft({ ...configDraft, padding_width: sanitizeDigits(e.target.value, 2) })}
              onBlur={() => setConfigTouched(true)}
            />
            {configTouched && configErrors.padding_width && (
              <p className="member-numbering-field-error">{configErrors.padding_width}</p>
            )}
          </div>

          <button type="submit" className="member-numbering-save" disabled={isSavingConfig}>
            {isSavingConfig ? <RefreshCw size={16} strokeWidth={2} className="member-numbering-spin" /> : <Check size={16} strokeWidth={2} />}
            {isSavingConfig ? 'Saving…' : 'Save Settings'}
          </button>
        </form>

        {configSaveError && <div className="member-numbering-banner-error">{configSaveError}</div>}
        {configSaved && !configSaveError && <div className="member-numbering-banner-success">Settings saved.</div>}
      </section>
    </div>
  );
}
