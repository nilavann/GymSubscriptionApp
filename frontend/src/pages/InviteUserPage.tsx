import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Send } from 'lucide-react';
import { useServices } from '../context/services.context';
import type { InviteUserDraft, InviteUserFormErrors } from '../services/user.service';
import type { Role } from '../types/role';
import './InviteUserPage.css';

function emptyDraft(): InviteUserDraft {
  return { email: '', full_name: '', roles: [] };
}

/** Invite User (screens.md WSCR-10) — admin-only, single-column form at every width. */
export function InviteUserPage() {
  const navigate = useNavigate();
  const { userService, roleRepository } = useServices();

  const [availableRoles, setAvailableRoles] = useState<Role[]>([]);
  const [form, setForm] = useState<InviteUserDraft>(emptyDraft());
  const [errors, setErrors] = useState<InviteUserFormErrors>({});
  const [touched, setTouched] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    roleRepository.getAllActive().then(setAvailableRoles).catch(() => setAvailableRoles([]));
  }, [roleRepository]);

  function toggleRole(name: string) {
    setForm((prev) => ({
      ...prev,
      roles: prev.roles.includes(name) ? prev.roles.filter((r) => r !== name) : [...prev.roles, name],
    }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    const validationErrors = userService.validateInvite(form);
    setErrors(validationErrors);
    if (!userService.isFormValid(validationErrors)) return;

    setSubmitError(null);
    setIsSubmitting(true);
    try {
      await userService.invite(form);
      navigate('/users', { replace: true, state: { toast: `Invitation sent to ${form.email.trim()}` } });
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.toLowerCase().includes('already registered')) {
        setSubmitError('This email is already registered.');
      } else if (message === 'Failed to fetch') {
        setSubmitError("Couldn't send the invite — check your connection and try again.");
      } else {
        setSubmitError('Something went wrong sending the invite. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="invite-user-page">
      <button type="button" className="invite-user-back-link" onClick={() => navigate('/users')}>
        <ArrowLeft size={16} strokeWidth={2} />
        Manage Users
      </button>

      <h1>Invite User</h1>

      <form className="invite-user-form" onSubmit={handleSubmit} noValidate>
        {submitError && <div className="invite-user-banner-error">{submitError}</div>}

        <label htmlFor="invite-email">
          Email<span className="invite-user-required"> *</span>
        </label>
        <input
          id="invite-email"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          onBlur={() => setTouched(true)}
        />
        {touched && errors.email && <p className="invite-user-error">{errors.email}</p>}

        <label htmlFor="invite-full-name">
          Name<span className="invite-user-required"> *</span>
        </label>
        <input
          id="invite-full-name"
          value={form.full_name}
          onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          onBlur={() => setTouched(true)}
        />
        {touched && errors.full_name && <p className="invite-user-error">{errors.full_name}</p>}

        <span className="invite-user-chip-label">
          Roles<span className="invite-user-required"> *</span>
        </span>
        <div className="invite-user-chip-row" role="group" aria-label="Roles">
          {availableRoles.map((role) => (
            <button
              key={role.id}
              type="button"
              className={`invite-user-chip${form.roles.includes(role.name) ? ' invite-user-chip-selected' : ''}`}
              onClick={() => toggleRole(role.name)}
            >
              {role.name}
            </button>
          ))}
        </div>
        {touched && errors.roles && <p className="invite-user-error">{errors.roles}</p>}

        <button type="submit" className="invite-user-submit" disabled={isSubmitting}>
          {isSubmitting ? <RefreshCw size={18} strokeWidth={2} className="invite-user-spin" /> : <Send size={18} strokeWidth={2} />}
          {isSubmitting ? 'Sending…' : 'Send Invitation'}
        </button>
      </form>
    </div>
  );
}
