import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Pencil, Trash2, RefreshCw, X, Check } from 'lucide-react';
import { useServices } from '../context/services.context';
import { withTimeout } from '../lib/with-timeout';
import { AdminTabs } from '../components/AdminTabs';
import type { Branch } from '../types/branch';
import type { BranchDraft, BranchFormErrors } from '../services/branch.service';
import './ManageBranchesPage.css';

const FETCH_TIMEOUT_MS = 10000;
type LoadState = 'loading' | 'loaded' | 'network-error' | 'generic-error';

function emptyDraft(): BranchDraft {
  return { name: '', code: '' };
}

export function ManageBranchesPage() {
  const { branchRepository, branchService } = useServices();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<BranchDraft>(emptyDraft());
  const [errors, setErrors] = useState<BranchFormErrors>({});
  const [touched, setTouched] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Branch | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function load() {
    setLoadState('loading');
    try {
      const data = await withTimeout(branchRepository.getAllActive(), FETCH_TIMEOUT_MS, new Error('branches-timeout'));
      setBranches(data);
      setLoadState('loaded');
    } catch (err) {
      const isNetwork = err instanceof Error && (err.message === 'branches-timeout' || err.message === 'Failed to fetch');
      setLoadState(isNetwork ? 'network-error' : 'generic-error');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openAddForm() {
    setEditingId(null);
    setForm(emptyDraft());
    setErrors({});
    setTouched(false);
    setSaveError(null);
    setIsFormOpen(true);
  }

  function openEditForm(branch: Branch) {
    setEditingId(branch.id);
    setForm({ name: branch.name, code: branch.code });
    setErrors({});
    setTouched(false);
    setSaveError(null);
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    const validationErrors = branchService.validateBranch(form);
    setErrors(validationErrors);
    if (!branchService.isBranchFormValid(validationErrors)) return;

    setSaveError(null);
    setIsSaving(true);
    try {
      if (editingId === null) {
        await branchService.create(form);
      } else {
        await branchService.update(editingId, form);
      }
      setIsFormOpen(false);
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.toLowerCase().includes('code')) {
        setSaveError('This code is already used by another branch.');
      } else if (message === 'Failed to fetch') {
        setSaveError("Couldn't save this branch — check your connection and try again.");
      } else {
        setSaveError('Something went wrong saving this branch. Please try again.');
      }
    } finally {
      setIsSaving(false);
    }
  }

  function openDeleteConfirm(branch: Branch) {
    setDeleteError(null);
    setDeleteTarget(branch);
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await branchRepository.delete(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message === 'Failed to fetch') {
        setDeleteError("Couldn't delete this branch — check your connection and try again.");
      } else if (message) {
        // Includes the "Cannot delete — used by X member(s)" message from delete-branch
        // verbatim (edge-functions.md §4) — already specific, not generic.
        setDeleteError(message);
      } else {
        setDeleteError('Something went wrong deleting this branch. Please try again.');
      }
    } finally {
      setIsDeleting(false);
    }
  }

  if (loadState === 'loading') {
    return (
      <div className="branches-page">
        <div className="branches-skeleton" aria-label="Loading" />
      </div>
    );
  }

  if (loadState === 'network-error' || loadState === 'generic-error') {
    return (
      <div className="branches-page">
        <div className="branches-load-error">
          <p>
            {loadState === 'network-error'
              ? "Couldn't load branches — check your connection and try again."
              : 'Something went wrong loading branches. Please try again.'}
          </p>
          <button type="button" className="branches-retry" onClick={load}>
            <RefreshCw size={16} strokeWidth={2} />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="branches-page">
      <div className="branches-page-header">
        <h1>Branches</h1>
        <button type="button" className="branches-add-button" onClick={openAddForm}>
          <Plus size={18} strokeWidth={2.5} />
          Add Branch
        </button>
      </div>

      <AdminTabs />

      {isFormOpen && (
        <form className="branches-form" onSubmit={handleSubmit} noValidate>
          <h2>{editingId === null ? 'Add Branch' : 'Edit Branch'}</h2>
          {saveError && <div className="branches-banner-error">{saveError}</div>}

          <label htmlFor="branch-name">
            Name<span className="branches-required"> *</span>
          </label>
          <input
            id="branch-name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            onBlur={() => setTouched(true)}
          />
          {touched && errors.name && <p className="branches-error">{errors.name}</p>}

          <label htmlFor="branch-code">
            Code<span className="branches-required"> *</span>
          </label>
          <input
            id="branch-code"
            placeholder="e.g. MUM"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            onBlur={() => setTouched(true)}
          />
          {touched && errors.code && <p className="branches-error">{errors.code}</p>}
          <p className="branches-helper">Branches scope member numbering and all member records.</p>

          <div className="branches-form-actions">
            <button type="button" className="branches-cancel" disabled={isSaving} onClick={closeForm}>
              <X size={18} strokeWidth={2} />
              Cancel
            </button>
            <button type="submit" className="branches-submit" disabled={isSaving}>
              {isSaving ? <RefreshCw size={18} strokeWidth={2} className="branches-spin" /> : <Check size={18} strokeWidth={2} />}
              {isSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}

      {branches.length === 0 ? (
        <div className="branches-empty">
          <p>No branches yet.</p>
          <button type="button" className="branches-add-button" onClick={openAddForm}>
            <Plus size={18} strokeWidth={2.5} />
            Add Branch
          </button>
        </div>
      ) : (
        <>
          <div className="branches-cards">
            {branches.map((branch) => (
              <div key={branch.id} className="branches-card">
                <div>
                  <span className="branches-card-name">{branch.name}</span>
                  <span className="branches-card-code">{branch.code}</span>
                </div>
                <div className="branches-card-actions">
                  <button
                    type="button"
                    className="branches-edit-button"
                    onClick={() => openEditForm(branch)}
                    aria-label={`Edit ${branch.name}`}
                  >
                    <Pencil size={14} strokeWidth={2} />
                    Edit
                  </button>
                  <button
                    type="button"
                    className="branches-delete-button"
                    onClick={() => openDeleteConfirm(branch)}
                    aria-label={`Delete ${branch.name}`}
                  >
                    <Trash2 size={14} strokeWidth={2} />
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>

          <table className="branches-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Code</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {branches.map((branch) => (
                <tr key={branch.id}>
                  <td>{branch.name}</td>
                  <td>{branch.code}</td>
                  <td className="branches-table-actions">
                    <button
                      type="button"
                      className="branches-edit-button"
                      onClick={() => openEditForm(branch)}
                      aria-label={`Edit ${branch.name}`}
                    >
                      <Pencil size={14} strokeWidth={2} />
                      Edit
                    </button>
                    <button
                      type="button"
                      className="branches-delete-button"
                      onClick={() => openDeleteConfirm(branch)}
                      aria-label={`Delete ${branch.name}`}
                    >
                      <Trash2 size={14} strokeWidth={2} />
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {deleteTarget && (
        <div className="branches-delete-backdrop">
          <div className="branches-delete-dialog">
            <h2>Delete branch?</h2>
            <p>
              "{deleteTarget.name}" will be permanently deleted. This can't be undone unless it's in use, in which case
              deletion is blocked below instead.
            </p>
            {deleteError && <div className="branches-banner-error">{deleteError}</div>}
            <div className="branches-form-actions">
              <button type="button" className="branches-cancel" disabled={isDeleting} onClick={() => setDeleteTarget(null)}>
                <X size={18} strokeWidth={2} />
                Cancel
              </button>
              <button type="button" className="branches-delete-confirm" disabled={isDeleting} onClick={handleConfirmDelete}>
                {isDeleting ? (
                  <RefreshCw size={18} strokeWidth={2} className="branches-spin" />
                ) : (
                  <Trash2 size={18} strokeWidth={2} />
                )}
                {isDeleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
