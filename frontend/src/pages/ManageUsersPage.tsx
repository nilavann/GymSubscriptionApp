import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Plus, Pencil, Trash2, RefreshCw, X, Check } from 'lucide-react';
import { useAuth } from '../context/auth.context';
import { useServices } from '../context/services.context';
import { withTimeout } from '../lib/with-timeout';
import type { ManagedUser } from '../types/profile';
import type { Role } from '../types/role';
import type { EditUserDraft, EditUserFormErrors } from '../services/user.service';
import './ManageUsersPage.css';

const FETCH_TIMEOUT_MS = 10000;
type LoadState = 'loading' | 'loaded' | 'network-error' | 'generic-error';
type ActiveDialog = { type: 'toggle-active'; user: ManagedUser } | { type: 'delete'; user: ManagedUser } | null;

/** Manage Users (screens.md WSCR-09) — admin-only, list source is list-users (edge-functions.md §5), not a direct profiles read. */
export function ManageUsersPage() {
  const { currentProfile } = useAuth();
  const { userService, roleRepository } = useServices();
  const location = useLocation();
  /** Set by InviteUserPage on success navigation (WSCR-10's "toast" — no app-wide toast system exists yet, so a dismissible banner fills that role here). */
  const [successMessage, setSuccessMessage] = useState<string | null>((location.state as { toast?: string } | null)?.toast ?? null);

  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [availableRoles, setAvailableRoles] = useState<Role[]>([]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EditUserDraft>({ full_name: '', roles: [], is_active: true });
  const [errors, setErrors] = useState<EditUserFormErrors>({});
  const [touched, setTouched] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [dialog, setDialog] = useState<ActiveDialog>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  async function load() {
    setLoadState('loading');
    try {
      const data = await withTimeout(userService.getAll(), FETCH_TIMEOUT_MS, new Error('users-timeout'));
      setUsers(data);
      setLoadState('loaded');
    } catch (err) {
      const isNetwork = err instanceof Error && (err.message === 'users-timeout' || err.message === 'Failed to fetch');
      setLoadState(isNetwork ? 'network-error' : 'generic-error');
    }
  }

  useEffect(() => {
    load();
    roleRepository.getAllActive().then(setAvailableRoles).catch(() => setAvailableRoles([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openEditForm(user: ManagedUser) {
    setEditingId(user.id);
    setForm({ full_name: user.full_name, roles: user.roles, is_active: user.is_active });
    setErrors({});
    setTouched(false);
    setSaveError(null);
  }

  function toggleFormRole(name: string) {
    setForm((prev) => ({
      ...prev,
      roles: prev.roles.includes(name) ? prev.roles.filter((r) => r !== name) : [...prev.roles, name],
    }));
  }

  function closeForm() {
    setEditingId(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!editingId) return;
    setTouched(true);
    const validationErrors = userService.validateEditUser(form);
    setErrors(validationErrors);
    if (!userService.isFormValid(validationErrors)) return;

    const isSelf = editingId === currentProfile?.id;
    setSaveError(null);
    setIsSaving(true);
    try {
      // Self-edits may only ever touch full_name — update-user rejects roles/is_active
      // on the caller's own id server-side (edge-functions.md §5 item 2); this mirrors
      // that client-side so the request never round-trips just to be rejected.
      await userService.update(editingId, isSelf ? { full_name: form.full_name } : { full_name: form.full_name, roles: form.roles });
      setEditingId(null);
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setSaveError(
        message === 'Failed to fetch' ? "Couldn't save — check your connection and try again." : "Couldn't update this user. Please try again."
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleConfirmToggleActive() {
    if (dialog?.type !== 'toggle-active') return;
    setIsConfirming(true);
    setConfirmError(null);
    try {
      await userService.update(dialog.user.id, { is_active: !dialog.user.is_active });
      setDialog(null);
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setConfirmError(message === 'Failed to fetch' ? "Couldn't save — check your connection and try again." : "Couldn't update this user. Please try again.");
    } finally {
      setIsConfirming(false);
    }
  }

  async function handleConfirmDelete() {
    if (dialog?.type !== 'delete') return;
    setIsConfirming(true);
    setConfirmError(null);
    try {
      await userService.delete(dialog.user.id);
      setDialog(null);
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setConfirmError(message === 'Failed to fetch' ? "Couldn't delete — check your connection and try again." : "Something went wrong deleting this user. Please try again.");
    } finally {
      setIsConfirming(false);
    }
  }

  if (loadState === 'loading') {
    return (
      <div className="users-page">
        <div className="users-skeleton" aria-label="Loading" />
      </div>
    );
  }

  if (loadState === 'network-error' || loadState === 'generic-error') {
    return (
      <div className="users-page">
        <div className="users-load-error">
          <p>
            {loadState === 'network-error'
              ? "Couldn't load users — check your connection and try again."
              : 'Something went wrong loading users. Please try again.'}
          </p>
          <button type="button" className="users-retry" onClick={load}>
            <RefreshCw size={16} strokeWidth={2} />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="users-page">
      <div className="users-page-header">
        <h1>Manage Users</h1>
        <Link to="/users/invite" className="users-add-button">
          <Plus size={18} strokeWidth={2.5} />
          Invite User
        </Link>
      </div>

      {successMessage && (
        <div className="users-banner-success">
          {successMessage}
          <button type="button" className="users-banner-dismiss" onClick={() => setSuccessMessage(null)} aria-label="Dismiss">
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      )}

      {editingId && (
        <form className="users-form" onSubmit={handleSubmit} noValidate>
          <h2>Edit User</h2>
          {saveError && <div className="users-banner-error">{saveError}</div>}

          <label htmlFor="user-full-name">
            Name<span className="users-required"> *</span>
          </label>
          <input
            id="user-full-name"
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            onBlur={() => setTouched(true)}
          />
          {touched && errors.full_name && <p className="users-error">{errors.full_name}</p>}

          <span className="users-chip-label">Roles</span>
          <div className="users-chip-row" role="group" aria-label="Roles">
            {availableRoles.map((role) => (
              <button
                key={role.id}
                type="button"
                disabled={editingId === currentProfile?.id}
                className={`users-chip${form.roles.includes(role.name) ? ' users-chip-selected' : ''}`}
                onClick={() => toggleFormRole(role.name)}
              >
                {role.name}
              </button>
            ))}
          </div>
          {editingId === currentProfile?.id && <p className="users-hint">You can't change your own roles.</p>}

          <div className="users-form-actions">
            <button type="button" className="users-cancel" disabled={isSaving} onClick={closeForm}>
              <X size={18} strokeWidth={2} />
              Cancel
            </button>
            <button type="submit" className="users-submit" disabled={isSaving}>
              {isSaving ? <RefreshCw size={18} strokeWidth={2} className="users-spin" /> : <Check size={18} strokeWidth={2} />}
              {isSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}

      <div className="users-cards">
        {users.map((user) => (
          <UserRow
            key={user.id}
            user={user}
            isSelf={user.id === currentProfile?.id}
            variant="card"
            onEdit={() => openEditForm(user)}
            onToggleActive={() => setDialog({ type: 'toggle-active', user })}
            onDelete={() => setDialog({ type: 'delete', user })}
          />
        ))}
      </div>

      <table className="users-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              isSelf={user.id === currentProfile?.id}
              variant="row"
              onEdit={() => openEditForm(user)}
              onToggleActive={() => setDialog({ type: 'toggle-active', user })}
              onDelete={() => setDialog({ type: 'delete', user })}
            />
          ))}
        </tbody>
      </table>

      {dialog?.type === 'toggle-active' && (
        <div className="users-delete-backdrop">
          <div className="users-delete-dialog">
            <h2>{dialog.user.is_active ? 'Deactivate user?' : 'Reactivate user?'}</h2>
            <p>
              {dialog.user.is_active
                ? `${dialog.user.full_name} will not be able to sign in.`
                : `${dialog.user.full_name} will be able to sign in again.`}
            </p>
            {confirmError && <div className="users-banner-error">{confirmError}</div>}
            <div className="users-form-actions">
              <button type="button" className="users-cancel" disabled={isConfirming} onClick={() => setDialog(null)}>
                <X size={18} strokeWidth={2} />
                Cancel
              </button>
              <button type="button" className="users-submit" disabled={isConfirming} onClick={handleConfirmToggleActive}>
                {isConfirming ? <RefreshCw size={18} strokeWidth={2} className="users-spin" /> : <Check size={18} strokeWidth={2} />}
                {dialog.user.is_active ? 'Deactivate' : 'Reactivate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {dialog?.type === 'delete' && (
        <div className="users-delete-backdrop">
          <div className="users-delete-dialog">
            <h2>Delete user?</h2>
            <p>"{dialog.user.full_name}" will be permanently removed from Manage Users. This can't be undone.</p>
            {confirmError && <div className="users-banner-error">{confirmError}</div>}
            <div className="users-form-actions">
              <button type="button" className="users-cancel" disabled={isConfirming} onClick={() => setDialog(null)}>
                <X size={18} strokeWidth={2} />
                Cancel
              </button>
              <button type="button" className="users-delete-confirm" disabled={isConfirming} onClick={handleConfirmDelete}>
                {isConfirming ? <RefreshCw size={18} strokeWidth={2} className="users-spin" /> : <Trash2 size={18} strokeWidth={2} />}
                {isConfirming ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function UserRow({
  user,
  isSelf,
  variant,
  onEdit,
  onToggleActive,
  onDelete,
}: {
  user: ManagedUser;
  isSelf: boolean;
  variant: 'card' | 'row';
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  const actions = (
    <div className={variant === 'card' ? 'users-card-actions' : 'users-table-actions'}>
      <button type="button" className="users-edit-button" onClick={onEdit} aria-label={`Edit ${user.full_name}`}>
        <Pencil size={14} strokeWidth={2} />
        Edit
      </button>
      <button
        type="button"
        className="users-edit-button"
        onClick={onToggleActive}
        disabled={isSelf}
        aria-label={user.is_active ? `Deactivate ${user.full_name}` : `Reactivate ${user.full_name}`}
      >
        {user.is_active ? 'Deactivate' : 'Reactivate'}
      </button>
      <button
        type="button"
        className="users-delete-button"
        onClick={onDelete}
        disabled={isSelf}
        aria-label={`Delete ${user.full_name}`}
      >
        <Trash2 size={14} strokeWidth={2} />
        Delete
      </button>
    </div>
  );

  const roleBadges = (
    <span className="users-role-badges">
      {user.roles.map((role) => (
        <span key={role} className={`users-role-badge${role === 'admin' ? ' users-role-admin' : ''}`}>
          {role}
        </span>
      ))}
    </span>
  );
  const statusBadge = (
    <span className={`users-status-badge${user.is_active ? ' users-status-active' : ' users-status-inactive'}`}>
      {user.is_active ? 'Active' : 'Deactivated'}
    </span>
  );

  if (variant === 'card') {
    return (
      <div className="users-card">
        <div className="users-card-top">
          <span className="users-card-name">
            {user.full_name}
            {isSelf && <span className="users-you-tag"> (you)</span>}
          </span>
          {roleBadges}
          {statusBadge}
        </div>
        <span className="users-card-email">{user.email}</span>
        {actions}
      </div>
    );
  }

  return (
    <tr>
      <td>
        {user.full_name}
        {isSelf && <span className="users-you-tag"> (you)</span>}
      </td>
      <td>{user.email}</td>
      <td>{roleBadges}</td>
      <td>{statusBadge}</td>
      <td>{actions}</td>
    </tr>
  );
}
