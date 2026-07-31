import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, LogOut, Users, Layers, Building2, UserCog, ShieldCheck, Repeat, RefreshCw, History, Hash } from 'lucide-react';
import { useAuth } from '../context/auth.context';
import { useServices } from '../context/services.context';
import { withTimeout } from '../lib/with-timeout';
import { AdminTabs } from '../components/AdminTabs';
import { useTheme, TINT_OPTIONS, CTA_OPTIONS, RADIUS_OPTIONS, type Tint, type Cta, type Radius } from '../context/theme.context';
import './SettingsPage.css';

const FETCH_TIMEOUT_MS = 10000;
type PasswordResetState = 'idle' | 'sending' | 'sent' | 'error';

const TINT_LABEL: Record<Tint, string> = { sky: 'Sky', violet: 'Violet', emerald: 'Emerald', amber: 'Amber', rose: 'Rose' };
const CTA_LABEL: Record<Cta, string> = { charcoal: 'Charcoal', orange: 'Orange', blue: 'Blue' };
const RADIUS_LABEL: Record<Radius, string> = { soft: 'Soft', pill: 'Pill', sharp: 'Sharp' };

/**
 * Settings hub (screens.md WSCR-11) — the one place admins reach Manage Plans, Manage
 * Branches, and Manage Users from; those routes have no other in-app link to them.
 */
export function SettingsPage() {
  const { currentProfile, session, signOut, resetPasswordForEmail } = useAuth();
  const { tint, cta, radius, setTint, setCta, setRadius } = useTheme();
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

      <AdminTabs />

      <section className="settings-profile-card">
        <span className="settings-profile-avatar" aria-hidden="true">
          {currentProfile?.full_name?.slice(0, 2).toUpperCase()}
        </span>
        <div className="settings-profile-info">
          <span className="settings-profile-name">{currentProfile?.full_name}</span>
          <span className="settings-profile-email">{session?.user.email}</span>
          <span className="settings-role-badges">
            {currentProfile?.roles.map((role) => (
              <span key={role} className={`settings-role-badge${role === 'admin' ? ' settings-role-admin' : ' settings-role-staff'}`}>
                {role}
              </span>
            ))}
          </span>
        </div>
        <div className="settings-profile-actions">
          <button
            type="button"
            className="settings-account-button"
            onClick={handleChangePassword}
            disabled={passwordResetState === 'sending'}
          >
            <KeyRound size={16} strokeWidth={2} />
            Change Password
          </button>
          <button type="button" className="settings-account-button settings-signout-button" onClick={() => signOut()}>
            <LogOut size={16} strokeWidth={2} />
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
        <h2 className="settings-section-title">Appearance</h2>
        <div className="settings-theme-picker">
          <div className="settings-theme-group">
            <span className="settings-theme-label">Tint</span>
            <div className="settings-theme-swatch-row">
              {TINT_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`settings-theme-swatch${tint === option ? ' settings-theme-swatch-active' : ''}`}
                  data-tint-preview={option}
                  onClick={() => setTint(option)}
                  aria-pressed={tint === option}
                >
                  {TINT_LABEL[option]}
                </button>
              ))}
            </div>
          </div>
          <div className="settings-theme-group">
            <span className="settings-theme-label">CTA color</span>
            <div className="settings-theme-swatch-row">
              {CTA_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`settings-theme-swatch${cta === option ? ' settings-theme-swatch-active' : ''}`}
                  data-cta-preview={option}
                  onClick={() => setCta(option)}
                  aria-pressed={cta === option}
                >
                  {CTA_LABEL[option]}
                </button>
              ))}
            </div>
          </div>
          <div className="settings-theme-group">
            <span className="settings-theme-label">Radius</span>
            <div className="settings-theme-swatch-row">
              {RADIUS_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`settings-theme-swatch${radius === option ? ' settings-theme-swatch-active' : ''}`}
                  onClick={() => setRadius(option)}
                  aria-pressed={radius === option}
                >
                  {RADIUS_LABEL[option]}
                </button>
              ))}
            </div>
          </div>
        </div>
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
