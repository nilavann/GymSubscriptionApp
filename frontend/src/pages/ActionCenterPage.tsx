import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Clock, Eye, RefreshCw, Repeat, WifiOff } from 'lucide-react';
import { useServices } from '../context/services.context';
import { withTimeout } from '../lib/with-timeout';
import { formatDate } from '../lib/datetime';
import { getActionCenterWindow, getRelativeExpiryLabel, splitActionCenterQueue, type ExpiryTier } from '../lib/action-center';
import { getAvatarColor, getInitials } from '../lib/avatar';
import { PhotoLightbox } from '../components/PhotoLightbox';
import type { MemberListRow } from '../types/member-list';
import './ActionCenterPage.css';
import { isNetworkError } from '../lib/network-error';

const FETCH_TIMEOUT_MS = 10000;
type ActionCenterTab = 'expiring' | 'expired';
type LoadState = 'loading' | 'loaded' | 'network-error' | 'generic-error';

const TIER_PILL_CLASS: Record<ExpiryTier, string> = {
  urgent: 'action-center-pill-urgent',
  soon: 'action-center-pill-soon',
  expired: 'action-center-pill-expired',
};

/**
 * Renewal queue — see spec/frontend/action-center.md. First nav item; purpose is working
 * the set of memberships expiring in the next 30 days or expired in the last 12 months,
 * without having to fetch (or scroll through) every member the way Members List does.
 */
export function ActionCenterPage() {
  const { memberListRepository } = useServices();
  const navigate = useNavigate();

  const [rows, setRows] = useState<MemberListRow[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [tab, setTab] = useState<ActionCenterTab>('expiring');
  const [lightboxMember, setLightboxMember] = useState<MemberListRow | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  /** Only the original photo enlarges — a member with no photo_url yet (upload in progress/failed) has nothing to show. */
  function enlargePhoto(row: MemberListRow) {
    if (row.photo_url) setLightboxMember(row);
  }

  async function load() {
    setLoadState('loading');
    try {
      const { from, to } = getActionCenterWindow();
      const queue = await withTimeout(
        memberListRepository.getActionCenterQueue({ from, to }),
        FETCH_TIMEOUT_MS,
        new Error('action-center-timeout')
      );
      setRows(queue);
      setLoadState('loaded');
    } catch (err) {
      const isNetwork = err instanceof Error && (err.message.endsWith('-timeout') || isNetworkError(err));
      setLoadState(isNetwork ? 'network-error' : 'generic-error');
    }
  }

  // Re-fetch on every route entry - never show a stale queue on return to /action-center.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { upcoming, expired } = splitActionCenterQueue(rows);
  const visibleRows = tab === 'expiring' ? upcoming : expired;

  function scrollByCard(direction: 1 | -1) {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const card = scroller.querySelector<HTMLElement>('.action-center-card');
    const gap = 16;
    const step = card ? card.offsetWidth + gap : scroller.clientWidth;
    scroller.scrollBy({ left: step * direction });
  }

  if (loadState === 'loading') {
    return (
      <div className="action-center-page">
        <div className="action-center-skeleton" aria-label="Loading" />
      </div>
    );
  }

  if (loadState === 'network-error' || loadState === 'generic-error') {
    return (
      <div className="action-center-page">
        <div className="action-center-load-error">
          <span className="action-center-load-error-icon" aria-hidden="true">
            <WifiOff size={26} strokeWidth={2} />
          </span>
          <p className="action-center-load-error-title">Couldn't load the renewal queue</p>
          <p className="action-center-load-error-body">
            {loadState === 'network-error'
              ? 'Check your internet connection and try again.'
              : 'Something went wrong loading the renewal queue. Please try again.'}
          </p>
          <button type="button" className="action-center-retry" onClick={load}>
            <RefreshCw size={16} strokeWidth={2} />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="action-center-page">
      <div className="action-center-header">
        <div>
          <h1>Action Center</h1>
          <p className="action-center-sub">
            Memberships expiring in the next 30 days and everything that expired in the last 12 months, newest expiry
            first.
          </p>
        </div>
        <button type="button" className="action-center-reminders" disabled title="Coming soon">
          Send renewal reminders
        </button>
      </div>

      <div className="action-center-summary-row">
        <div className="action-center-summary-card action-center-summary-warning">
          <span className="action-center-summary-count">{upcoming.length}</span>
          <span className="action-center-summary-label">Expiring in 30 days</span>
          <span className="action-center-summary-note">
            {upcoming.length > 0 && upcoming[0].current_membership_end_date
              ? `Next: ${formatDate(upcoming[0].current_membership_end_date)}`
              : 'Nothing on the horizon'}
          </span>
        </div>
        <div className="action-center-summary-card action-center-summary-danger">
          <span className="action-center-summary-count">{expired.length}</span>
          <span className="action-center-summary-label">Expired</span>
          <span className="action-center-summary-note">In the last 12 months</span>
        </div>
      </div>

      <div className="action-center-tabs" role="group" aria-label="Queue filter">
        <button
          type="button"
          className={`action-center-tab${tab === 'expiring' ? ' action-center-tab-active' : ''}`}
          onClick={() => setTab('expiring')}
        >
          Expiring soon
          <span className="action-center-tab-count">{upcoming.length}</span>
        </button>
        <button
          type="button"
          className={`action-center-tab${tab === 'expired' ? ' action-center-tab-active' : ''}`}
          onClick={() => setTab('expired')}
        >
          Expired
          <span className="action-center-tab-count">{expired.length}</span>
        </button>
      </div>

      {visibleRows.length === 0 ? (
        <div className="action-center-empty">
          <span className="action-center-empty-icon" aria-hidden="true">
            <Clock size={28} strokeWidth={2} />
          </span>
          <p className="action-center-empty-title">
            {tab === 'expiring' ? 'Nothing expiring in the next 30 days' : 'No expired memberships'}
          </p>
          <p className="action-center-empty-body">
            {tab === 'expiring'
              ? 'Members whose membership is about to lapse will show up here.'
              : 'Members whose membership lapsed in the last 12 months will show up here.'}
          </p>
        </div>
      ) : (
        <div className="action-center-carousel">
          <button
            type="button"
            className="action-center-arrow"
            onClick={() => scrollByCard(-1)}
            aria-label="Scroll to previous card"
          >
            <ChevronLeft size={18} strokeWidth={2} />
          </button>

          <div className="action-center-scroller" ref={scrollerRef}>
            {visibleRows.map((row) => (
              <ActionCenterCard
                key={row.id}
                row={row}
                onRenew={() => navigate(`/members/${row.id}/renew`)}
                onView={() => navigate(`/members/${row.id}`)}
                onEnlargePhoto={() => enlargePhoto(row)}
              />
            ))}
          </div>

          <button
            type="button"
            className="action-center-arrow"
            onClick={() => scrollByCard(1)}
            aria-label="Scroll to next card"
          >
            <ChevronRight size={18} strokeWidth={2} />
          </button>
        </div>
      )}

      {lightboxMember?.photo_url && (
        <PhotoLightbox src={lightboxMember.photo_url} alt={lightboxMember.name} onClose={() => setLightboxMember(null)} />
      )}
    </div>
  );
}

function ActionCenterCard({
  row,
  onRenew,
  onView,
  onEnlargePhoto,
}: {
  row: MemberListRow;
  onRenew: () => void;
  onView: () => void;
  onEnlargePhoto: () => void;
}) {
  const endDate = row.current_membership_end_date as string;
  const { text: relativeLabel, tier } = getRelativeExpiryLabel(endDate);

  return (
    <div className="action-center-card">
      <div className="action-center-card-header">
        {row.photo_thumbnail_url ? (
          <img
            src={row.photo_thumbnail_url}
            alt=""
            className="action-center-avatar-img action-center-avatar-clickable"
            onClick={(e) => {
              e.stopPropagation();
              onEnlargePhoto();
            }}
          />
        ) : (
          <span className="action-center-avatar" style={{ background: getAvatarColor(row.id) }}>
            {getInitials(row.name)}
          </span>
        )}
        <div className="action-center-card-identity">
          <span className="action-center-card-name" title={row.name}>
            {row.name}
          </span>
          <span className="action-center-card-meta">{row.member_number}</span>
          <span className="action-center-card-meta">{row.phone}</span>
          <span className={`action-center-pill ${TIER_PILL_CLASS[tier]}`}>{relativeLabel}</span>
        </div>
      </div>

      <p className="action-center-card-plan">{row.current_membership_plan_name ?? 'No plan'}</p>
      <p className="action-center-card-expiry">Expiry {formatDate(endDate)}</p>

      <div className="action-center-card-actions">
        <button type="button" className="action-center-card-renew" onClick={onRenew}>
          <Repeat size={14} strokeWidth={2} />
          Renew
        </button>
        <button type="button" className="action-center-card-view" onClick={onView}>
          <Eye size={14} strokeWidth={2} />
          View
        </button>
      </div>
    </div>
  );
}
