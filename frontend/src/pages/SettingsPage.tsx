import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, LogOut, Users, Layers, Building2, UserCog, ShieldCheck, Repeat, RefreshCw, History, Hash } from 'lucide-react';
import { useAuth } from '../context/auth.context';
import { useServices } from '../context/services.context';
import { withTimeout } from '../lib/with-timeout';
import './SettingsPage.css';

const FETCH_TIMEOUT_MS = 10000;
type PasswordResetState = 'idle' | 'sending' | 'sent' | 'error';

/**
 * Settings hub (screens.md WSCR-11) — the one place admins reach Manage Plans, Manage
 * Branches, and Manage Users from; those routes have no other in-app link to them.
 */
export function SettingsPage() {
  const { currentProfile, session, signOut, resetPasswordForEmail } = useAuth();
  const {
    memberRepository,
    planRepository,
    branchRepository,
    roleRepository,
    profileRepository,
    subscriptionRepository,
    auditLogRepository,
  } = useServices();

  const [passwordResetState, setPasswordResetState] = useState<PasswordResetState>('idle');

  async function handleChangePassword() {
    if (!session?.user.email) return;
    setPasswordResetState('sending');
    try {
      await resetPasswordForEmail(session.user.email);
      setPasswordResetState('sent');
    } catch {
      setPasswordResetState('error');
    }
  }

  return (
    <div className="settings-page">
      <div className="settings-page-header">
        <h1>Settings</h1>
      </div>

      <section className="settings-profile-card">
        <div>
          <span className="settings-profile-name">{currentProfile?.full_name}</span>
          <span className="settings-profile-email">{session?.user.email}</span>
        </div>
        <span className="settings-role-badges">
          {currentProfile?.roles.map((role) => (
            <span key={role} className={`settings-role-badge${role === 'admin' ? ' settings-role-admin' : ' settings-role-staff'}`}>
              {role}
            </span>
          ))}
        </span>
      </section>

      <section className="settings-section">
        <h2 className="settings-section-title">Account</h2>
        <div className="settings-account-actions">
          <button
            type="button"
            className="settings-account-button"
            onClick={handleChangePassword}
            disabled={passwordResetState === 'sending'}
          >
            <KeyRound size={18} strokeWidth={2} />
            Change Password
          </button>
          <button type="button" className="settings-account-button settings-signout-button" onClick={() => signOut()}>
            <LogOut size={18} strokeWidth={2} />
            Sign Out
          </button>
        </div>
        {passwordResetState === 'sent' && (
          <p className="settings-account-message">Password reset email sent — check your inbox.</p>
        )}
        {passwordResetState === 'error' && (
          <p className="settings-account-message settings-account-message-error">
            Something went wrong sending the reset email. Please try again.
          </p>
        )}
      </section>

      <section className="settings-section">
        <h2 className="settings-section-title">Data Management</h2>
        <div className="settings-data-grid">
          <DataManagementCard
            icon={<Users size={20} strokeWidth={2} />}
            label="Members"
            to="/"
            fetchCount={memberRepository.getCount}
          />
          <DataManagementCard
            icon={<Layers size={20} strokeWidth={2} />}
            label="Plans"
            to="/plans"
            fetchCount={planRepository.getCount}
          />
          <DataManagementCard
            icon={<Building2 size={20} strokeWidth={2} />}
            label="Branches"
            to="/branches"
            fetchCount={branchRepository.getCount}
          />
          <DataManagementCard
            icon={<UserCog size={20} strokeWidth={2} />}
            label="Manage Users"
            to="/users"
            fetchCount={profileRepository.getCount}
          />
          <DataManagementCard
            icon={<ShieldCheck size={20} strokeWidth={2} />}
            label="Roles"
            to="/roles"
            fetchCount={roleRepository.getCount}
          />
          <DataManagementCard
            icon={<Repeat size={20} strokeWidth={2} />}
            label="Subscriptions"
            fetchCount={subscriptionRepository.getCount}
          />
          <DataManagementCard
            icon={<History size={20} strokeWidth={2} />}
            label="Audit Log"
            to="/audit-log"
            fetchCount={auditLogRepository.getCount}
          />
          <DataManagementCard
            icon={<Hash size={20} strokeWidth={2} />}
            label="Member Numbering"
            to="/member-numbering"
            fetchCount={branchRepository.getCount}
          />
        </div>
      </section>
    </div>
  );
}

function DataManagementCard({
  icon,
  label,
  to,
  fetchCount,
}: {
  icon: ReactNode;
  label: string;
  to?: string;
  fetchCount: () => Promise<number>;
}) {
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [count, setCount] = useState<number | null>(null);

  async function load() {
    setState('loading');
    try {
      const value = await withTimeout(fetchCount(), FETCH_TIMEOUT_MS, new Error('count-timeout'));
      setCount(value);
      setState('loaded');
    } catch {
      setState('error');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const content = (
    <>
      <span className="settings-card-icon">{icon}</span>
      <span className="settings-card-label">{label}</span>
      {state === 'loading' && <span className="settings-card-count-skeleton" aria-label="Loading" />}
      {state === 'loaded' && <span className="settings-card-count">{count}</span>}
      {state === 'error' && (
        <button
          type="button"
          className="settings-card-retry"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            load();
          }}
        >
          <RefreshCw size={14} strokeWidth={2} />
          Retry
        </button>
      )}
    </>
  );

  if (to) {
    return (
      <Link to={to} className="settings-card settings-card-link">
        {content}
      </Link>
    );
  }
  return <div className="settings-card">{content}</div>;
}
