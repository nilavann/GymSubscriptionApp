import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Pencil, Trash2, RefreshCw, X, Check } from 'lucide-react';
import { useServices } from '../context/services.context';
import { withTimeout } from '../lib/with-timeout';
import { AdminTabs } from '../components/AdminTabs';
import type { Role } from '../types/role';
import type { RoleDraft, RoleFormErrors } from '../services/role.service';
import './ManageRolesPage.css';

const FETCH_TIMEOUT_MS = 10000;
type LoadState = 'loading' | 'loaded' | 'network-error' | 'generic-error';

/** Manage Roles — admin-only catalog of role names a user can be assigned (auth.md §2),
 * same shape as Manage Plans / Manage Branches. */
export function ManageRolesPage() {
  const { roleRepository, roleService } = useServices();

  const [roles, setRoles] = useState<Role[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<RoleDraft>(roleService.emptyRoleDraft());
  const [errors, setErrors] = useState<RoleFormErrors>({});
  const [touched, setTouched] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function load() {
    setLoadState('loading');
    try {
      const data = await withTimeout(roleRepository.getAllActive(), FETCH_TIMEOUT_MS, new Error('roles-timeout'));
      setRoles(data);
      setLoadState('loaded');
    } catch (err) {
      const isNetwork = err instanceof Error && (err.message === 'roles-timeout' || err.message === 'Failed to fetch');
      setLoadState(isNetwork ? 'network-error' : 'generic-error');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openAddForm() {
    setEditingId(null);
    setForm(roleService.emptyRoleDraft());
    setErrors({});
    setTouched(false);
    setSaveError(null);
    setIsFormOpen(true);
  }

  function openEditForm(role: Role) {
    setEditingId(role.id);
    setForm(roleService.roleToDraft(role));
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
    const validationErrors = roleService.validateRole(form);
    setErrors(validationErrors);
    if (!roleService.isRoleFormValid(validationErrors)) return;

    setSaveError(null);
    setIsSaving(true);
    try {
      if (editingId === null) {
        await roleService.create(form);
      } else {
        await roleService.update(editingId, form);
      }
      setIsFormOpen(false);
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.toLowerCase().includes('name')) {
        setSaveError('This name is already used by another role.');
      } else if (message === 'Failed to fetch') {
        setSaveError("Couldn't save this role — check your connection and try again.");
      } else {
        setSaveError('Something went wrong saving this role. Please try again.');
      }
    } finally {
      setIsSaving(false);
    }
  }

  function openDeleteConfirm(role: Role) {
    setDeleteError(null);
    setDeleteTarget(role);
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await roleRepository.delete(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message === 'Failed to fetch') {
        setDeleteError("Couldn't delete this role — check your connection and try again.");
      } else if (message) {
        // Includes the "Cannot delete — used by X user(s)" message from delete-role
        // verbatim (edge-functions.md §4) — already specific, not generic.
        setDeleteError(message);
      } else {
        setDeleteError('Something went wrong deleting this role. Please try again.');
      }
    } finally {
      setIsDeleting(false);
    }
  }

  if (loadState === 'loading') {
    return (
      <div className="roles-page">
        <div className="roles-skeleton" aria-label="Loading" />
      </div>
    );
  }

  if (loadState === 'network-error' || loadState === 'generic-error') {
    return (
      <div className="roles-page">
        <div className="roles-load-error">
          <p>
            {loadState === 'network-error'
              ? "Couldn't load roles — check your connection and try again."
              : 'Something went wrong loading roles. Please try again.'}
          </p>
          <button type="button" className="roles-retry" onClick={load}>
            <RefreshCw size={16} strokeWidth={2} />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="roles-page">
      <div className="roles-page-header">
        <h1>Roles</h1>
        <button type="button" className="roles-add-button" onClick={openAddForm}>
          <Plus size={18} strokeWidth={2.5} />
          Add Role
        </button>
      </div>

      <AdminTabs />

      {isFormOpen && (
        <form className="roles-form" onSubmit={handleSubmit} noValidate>
          <h2>{editingId === null ? 'Add Role' : 'Edit Role'}</h2>
          {saveError && <div className="roles-banner-error">{saveError}</div>}

          <label htmlFor="role-name">
            Name<span className="roles-required"> *</span>
          </label>
          <input
            id="role-name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            onBlur={() => setTouched(true)}
          />
          {touched && errors.name && <p className="roles-error">{errors.name}</p>}

          <label htmlFor="role-description">Description</label>
          <input
            id="role-description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            onBlur={() => setTouched(true)}
          />

          <div className="roles-form-actions">
            <button type="button" className="roles-cancel" disabled={isSaving} onClick={closeForm}>
              <X size={18} strokeWidth={2} />
              Cancel
            </button>
            <button type="submit" className="roles-submit" disabled={isSaving}>
              {isSaving ? <RefreshCw size={18} strokeWidth={2} className="roles-spin" /> : <Check size={18} strokeWidth={2} />}
              {isSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}

      {roles.length === 0 ? (
        <div className="roles-empty">
          <p>No roles yet.</p>
          <button type="button" className="roles-add-button" onClick={openAddForm}>
            <Plus size={18} strokeWidth={2.5} />
            Add Role
          </button>
        </div>
      ) : (
        <>
          <div className="roles-cards">
            {roles.map((role) => (
              <div key={role.id} className="roles-card">
                <div>
                  <span className="roles-card-name">{role.name}</span>
                  {role.description && <span className="roles-card-description">{role.description}</span>}
                </div>
                <div className="roles-card-actions">
                  <button
                    type="button"
                    className="roles-edit-button"
                    onClick={() => openEditForm(role)}
                    aria-label={`Edit ${role.name}`}
                  >
                    <Pencil size={14} strokeWidth={2} />
                    Edit
                  </button>
                  <button
                    type="button"
                    className="roles-delete-button"
                    onClick={() => openDeleteConfirm(role)}
                    aria-label={`Delete ${role.name}`}
                  >
                    <Trash2 size={14} strokeWidth={2} />
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>

          <table className="roles-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => (
                <tr key={role.id}>
                  <td>{role.name}</td>
                  <td>{role.description ?? '—'}</td>
                  <td className="roles-table-actions">
                    <button
                      type="button"
                      className="roles-edit-button"
                      onClick={() => openEditForm(role)}
                      aria-label={`Edit ${role.name}`}
                    >
                      <Pencil size={14} strokeWidth={2} />
                      Edit
                    </button>
                    <button
                      type="button"
                      className="roles-delete-button"
                      onClick={() => openDeleteConfirm(role)}
                      aria-label={`Delete ${role.name}`}
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
        <div className="roles-delete-backdrop">
          <div className="roles-delete-dialog">
            <h2>Delete role?</h2>
            <p>
              "{deleteTarget.name}" will be permanently deleted. This can't be undone unless it's in use, in which case
              deletion is blocked below instead.
            </p>
            {deleteError && <div className="roles-banner-error">{deleteError}</div>}
            <div className="roles-form-actions">
              <button type="button" className="roles-cancel" disabled={isDeleting} onClick={() => setDeleteTarget(null)}>
                <X size={18} strokeWidth={2} />
                Cancel
              </button>
              <button type="button" className="roles-delete-confirm" disabled={isDeleting} onClick={handleConfirmDelete}>
                {isDeleting ? <RefreshCw size={18} strokeWidth={2} className="roles-spin" /> : <Trash2 size={18} strokeWidth={2} />}
                {isDeleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
