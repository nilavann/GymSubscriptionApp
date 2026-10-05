import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, SlidersHorizontal, RefreshCw, Repeat, Eye, Table, LayoutGrid, X, WifiOff } from 'lucide-react';
import { useServices } from '../context/services.context';
import { withTimeout } from '../lib/with-timeout';
import { useIsTabletUp } from '../lib/use-media-query';
import { formatDate } from '../lib/datetime';
import { deriveStatus, STATUS_LABEL, STATUS_BADGE_CLASS } from '../lib/status';
import { getAvatarColor, getInitials } from '../lib/avatar';
import { PhotoLightbox } from '../components/PhotoLightbox';
import { FilterDrawer } from '../components/FilterDrawer';
import {
  applyStatusPill,
  filterBeforeStatus,
  sortMembers,
  statusPillCounts as computeStatusPillCounts,
  type SortOption,
  type StatusPill,
} from '../lib/member-list-filters';
import type { MemberListRow } from '../types/member-list';
import type { Gender } from '../types/member';
import type { Plan } from '../types/plan';
import './MembersListPage.css';
import { isNetworkError } from '../lib/network-error';

const FETCH_TIMEOUT_MS = 10000;
const GENDERS: Gender[] = ['Male', 'Female', 'Other'];
type LoadState = 'loading' | 'loaded' | 'network-error' | 'generic-error';
type ViewMode = 'table' | 'cards';

export function MembersListPage() {
  const { memberListRepository, planRepository } = useServices();
  const navigate = useNavigate();
  const isTabletUp = useIsTabletUp();

  const [rows, setRows] = useState<MemberListRow[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');

  const [search, setSearch] = useState('');
  const [statusPill, setStatusPill] = useState<StatusPill>('all');
  const [sort, setSort] = useState<SortOption>('join-date');
  // Desktop-only preference (>=768px). Below that only cards are rendered (a table doesn't fit a phone
  // screen) — see `showTable` below; the view toggle isn't rendered there either.
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedGenders, setSelectedGenders] = useState<Gender[]>([]);
  const [selectedAddonPlanIds, setSelectedAddonPlanIds] = useState<number[]>([]);
  const [selectedPlanIds, setSelectedPlanIds] = useState<number[]>([]);
  const [lightboxMember, setLightboxMember] = useState<MemberListRow | null>(null);

  async function load() {
    setLoadState('loading');
    try {
      const [listRows, planRows] = await Promise.all([
        withTimeout(memberListRepository.getAll(), FETCH_TIMEOUT_MS, new Error('members-timeout')),
        withTimeout(planRepository.getAllActive(), FETCH_TIMEOUT_MS, new Error('plans-timeout')),
      ]);
      setRows(listRows);
      setPlans(planRows);
      setLoadState('loaded');
    } catch (err) {
      const isNetwork = err instanceof Error && (err.message.endsWith('-timeout') || isNetworkError(err));
      setLoadState(isNetwork ? 'network-error' : 'generic-error');
    }
  }

  // Re-fetch on every route entry - never show stale data on return to `/` (rules.md rule 6).
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const membershipPlans = useMemo(() => plans.filter((p) => p.category === 'membership'), [plans]);
  const addonPlans = useMemo(() => plans.filter((p) => p.category === 'addon'), [plans]);

  const activeFilterCount =
    (statusPill !== 'all' ? 1 : 0) +
    (selectedGenders.length > 0 ? 1 : 0) +
    (selectedAddonPlanIds.length > 0 ? 1 : 0) +
    (selectedPlanIds.length > 0 ? 1 : 0);

  /** Every filter EXCEPT the status pill itself — feeds each pill's own count (below), so
      clicking a pill shows how many rows it would surface given the other active filters. */
  const rowsBeforeStatusFilter = useMemo(
    () =>
      filterBeforeStatus(rows, {
        search,
        genders: selectedGenders,
        addonPlanIds: selectedAddonPlanIds,
        planIds: selectedPlanIds,
      }),
    [rows, search, selectedGenders, selectedAddonPlanIds, selectedPlanIds]
  );

  const statusPillCounts = useMemo(() => computeStatusPillCounts(rowsBeforeStatusFilter), [rowsBeforeStatusFilter]);

  const filteredRows = useMemo(
    () => sortMembers(applyStatusPill(rowsBeforeStatusFilter, statusPill), sort),
    [rowsBeforeStatusFilter, statusPill, sort]
  );

  function toggleInArray<T>(list: T[], value: T, setList: (next: T[]) => void) {
    setList(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  }

  /** Only the original photo enlarges — a member with no photo_url yet (upload in progress/failed) has nothing to show. */
  function enlargePhoto(row: MemberListRow) {
    if (row.photo_url) setLightboxMember(row);
  }

  function clearFilters() {
    setStatusPill('all');
    setSelectedGenders([]);
    setSelectedAddonPlanIds([]);
    setSelectedPlanIds([]);
  }

  function resultCountLine(): string {
    const n = filteredRows.length;
    if (search.trim()) return `${n} results for "${search.trim()}"`;
    if (activeFilterCount > 0) return `${n} members · ${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'} active`;
    return `${n} members`;
  }

  if (loadState === 'loading') {
    return (
      <div className="members-page">
        <div className="members-skeleton" aria-label="Loading" />
      </div>
    );
  }

  if (loadState === 'network-error' || loadState === 'generic-error') {
    return (
      <div className="members-page">
        <div className="members-load-error">
          <span className="members-load-error-icon" aria-hidden="true">
            <WifiOff size={26} strokeWidth={2} />
          </span>
          <p className="members-load-error-title">Couldn't load members</p>
          <p className="members-load-error-body">
            {loadState === 'network-error'
              ? 'Check your internet connection. Your search and filters are kept — nothing is lost.'
              : 'Something went wrong loading members. Please try again.'}
          </p>
          <button type="button" className="members-retry" onClick={load}>
            <RefreshCw size={16} strokeWidth={2} />
            Retry
          </button>
        </div>
      </div>
    );
  }

  const hasNoMembersAtAll = rows.length === 0;
  const hasNoResults = !hasNoMembersAtAll && filteredRows.length === 0;

  // Render exactly ONE of table / cards (rules.md rule 33) — not both with one hidden by CSS, which
  // doubled every row's DOM and every member photo <img>. Page state (search, filters, sort, viewMode)
  // lives above this switch, so resizing across 768px keeps it.
  const showTable = isTabletUp && viewMode === 'table';

  return (
    <div className="members-page" data-view={viewMode}>
      <div className="members-page-header">
        <h1>Members</h1>
        <Link to="/members/new" className="members-add-link">
          <Plus size={18} strokeWidth={2.5} />
          Add Member
        </Link>
      </div>

      {!hasNoMembersAtAll && (
        <>
          <div className="members-controls">
            <div className="members-search-wrap">
              <Search size={18} strokeWidth={2} className="members-search-icon" aria-hidden="true" />
              <input
                type="search"
                className="members-search"
                placeholder="Search by name, member #, or phone"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search members"
              />
            </div>

            <div className="members-pill-row" role="group" aria-label="Status filter">
              {(['all', 'active', 'expiring', 'expired'] as StatusPill[]).map((pill) => (
                <button
                  key={pill}
                  type="button"
                  className={`members-pill${statusPill === pill ? ' members-pill-active' : ''}`}
                  onClick={() => setStatusPill(pill)}
                >
                  {pill === 'all' ? 'All' : STATUS_LABEL[pill]}
                  <span className="members-pill-count">{statusPillCounts[pill]}</span>
                </button>
              ))}
            </div>

            <div className="members-controls-row">
              <select
                className="members-sort"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortOption)}
                aria-label="Sort by"
              >
                <option value="join-date">Sort: Join date (newest)</option>
                <option value="name">Sort: Name</option>
                <option value="expiry">Sort: Expiry date</option>
              </select>

              <button
                type="button"
                className={`members-filter-toggle${activeFilterCount > 0 ? ' members-filter-toggle-active' : ''}`}
                onClick={() => setFiltersOpen(true)}
              >
                <SlidersHorizontal size={16} strokeWidth={2} />
                Filters
                {activeFilterCount > 0 && <span className="members-filter-toggle-count">{activeFilterCount}</span>}
              </button>

              {isTabletUp && <ViewToggle viewMode={viewMode} onChange={setViewMode} />}
            </div>

            {(selectedGenders.length > 0 || selectedPlanIds.length > 0 || selectedAddonPlanIds.length > 0) && (
              <div className="members-applied-chips">
                {selectedGenders.map((gender) => (
                  <span key={`gender-${gender}`} className="members-applied-chip">
                    Gender: {gender}
                    <button type="button" onClick={() => toggleInArray(selectedGenders, gender, setSelectedGenders)} aria-label={`Remove gender filter ${gender}`}>
                      <X size={13} strokeWidth={2.5} />
                    </button>
                  </span>
                ))}
                {selectedPlanIds.map((id) => {
                  const plan = membershipPlans.find((p) => p.id === id);
                  if (!plan) return null;
                  return (
                    <span key={`plan-${id}`} className="members-applied-chip">
                      Plan: {plan.name}
                      <button type="button" onClick={() => toggleInArray(selectedPlanIds, id, setSelectedPlanIds)} aria-label={`Remove plan filter ${plan.name}`}>
                        <X size={13} strokeWidth={2.5} />
                      </button>
                    </span>
                  );
                })}
                {selectedAddonPlanIds.map((id) => {
                  const plan = addonPlans.find((p) => p.id === id);
                  if (!plan) return null;
                  return (
                    <span key={`addon-${id}`} className="members-applied-chip">
                      Add-on: {plan.name}
                      <button type="button" onClick={() => toggleInArray(selectedAddonPlanIds, id, setSelectedAddonPlanIds)} aria-label={`Remove add-on filter ${plan.name}`}>
                        <X size={13} strokeWidth={2.5} />
                      </button>
                    </span>
                  );
                })}
                <button type="button" className="members-clear-link" onClick={clearFilters}>
                  Clear all
                </button>
              </div>
            )}

            <FilterDrawer open={filtersOpen} onClose={() => setFiltersOpen(false)} onClear={clearFilters}>
              <div className="members-filter-group">
                <span className="members-filter-label">Gender</span>
                {GENDERS.map((gender) => (
                  <label key={gender} className="members-filter-checkbox-row">
                    <input
                      type="checkbox"
                      checked={selectedGenders.includes(gender)}
                      onChange={() => toggleInArray(selectedGenders, gender, setSelectedGenders)}
                    />
                    {gender}
                  </label>
                ))}
              </div>

              {membershipPlans.length > 0 && (
                <div className="members-filter-group">
                  <span className="members-filter-label">Plan</span>
                  {membershipPlans.map((plan) => (
                    <label key={plan.id} className="members-filter-checkbox-row">
                      <input
                        type="checkbox"
                        checked={selectedPlanIds.includes(plan.id)}
                        onChange={() => toggleInArray(selectedPlanIds, plan.id, setSelectedPlanIds)}
                      />
                      {plan.name}
                    </label>
                  ))}
                </div>
              )}

              {addonPlans.length > 0 && (
                <div className="members-filter-group">
                  <span className="members-filter-label">Add-on</span>
                  {addonPlans.map((plan) => (
                    <label key={plan.id} className="members-filter-checkbox-row">
                      <input
                        type="checkbox"
                        checked={selectedAddonPlanIds.includes(plan.id)}
                        onChange={() => toggleInArray(selectedAddonPlanIds, plan.id, setSelectedAddonPlanIds)}
                      />
                      {plan.name}
                    </label>
                  ))}
                </div>
              )}
            </FilterDrawer>
          </div>

          <p className="members-result-count">{resultCountLine()}</p>
        </>
      )}

      {hasNoMembersAtAll && (
        <div className="members-empty">
          <p>No members yet.</p>
          <Link to="/members/new" className="members-add-link">
            <Plus size={18} strokeWidth={2.5} />
            Add Member
          </Link>
        </div>
      )}

      {hasNoResults && search.trim() && (
        <div className="members-empty">
          <p>No results for "{search.trim()}"</p>
          <button type="button" className="members-clear-link" onClick={() => setSearch('')}>
            Clear search
          </button>
        </div>
      )}

      {hasNoResults && !search.trim() && (
        <div className="members-empty">
          <p>No members match these filters.</p>
          <button type="button" className="members-clear-link" onClick={clearFilters}>
            Clear filters
          </button>
        </div>
      )}

      {filteredRows.length > 0 &&
        (showTable ? (
          <MembersTable rows={filteredRows} onSort={setSort} onEnlargePhoto={enlargePhoto} />
        ) : (
          <div className="members-cards">
            {filteredRows.map((row) => (
              <MemberCard
                key={row.id}
                row={row}
                compact={!isTabletUp}
                onOpen={() => navigate(`/members/${row.id}`)}
                onEnlargePhoto={() => enlargePhoto(row)}
              />
            ))}
          </div>
        ))}

      {lightboxMember?.photo_url && (
        <PhotoLightbox src={lightboxMember.photo_url} alt={lightboxMember.name} onClose={() => setLightboxMember(null)} />
      )}
    </div>
  );
}

/** Enlarges the ORIGINAL photo (photo_url) on click — never the thumbnail already shown here. No-op when there's no photo. */
function Avatar({ row, onEnlarge }: { row: MemberListRow; onEnlarge: () => void }) {
  if (row.photo_thumbnail_url) {
    return (
      <img
        src={row.photo_thumbnail_url}
        alt=""
        loading="lazy"
        decoding="async"
        className="members-avatar-img members-avatar-clickable"
        onClick={(e) => {
          e.stopPropagation();
          onEnlarge();
        }}
      />
    );
  }
  return (
    <span className="members-avatar" style={{ background: getAvatarColor(row.id) }}>
      {getInitials(row.name)}
    </span>
  );
}

/** The Table/Cards switch — desktop only (>= 768px). On a phone only cards exist, so it isn't rendered. */
function ViewToggle({ viewMode, onChange }: { viewMode: ViewMode; onChange: (mode: ViewMode) => void }) {
  return (
    <div className="members-view-toggle" role="group" aria-label="View">
      <button
        type="button"
        className={`members-view-toggle-btn${viewMode === 'table' ? ' members-view-toggle-btn-active' : ''}`}
        onClick={() => onChange('table')}
        aria-pressed={viewMode === 'table'}
        aria-label="Table view"
        title="Table view"
      >
        <Table size={16} strokeWidth={2} />
      </button>
      <button
        type="button"
        className={`members-view-toggle-btn${viewMode === 'cards' ? ' members-view-toggle-btn-active' : ''}`}
        onClick={() => onChange('cards')}
        aria-pressed={viewMode === 'cards'}
        aria-label="Cards view"
        title="Cards view"
      >
        <LayoutGrid size={16} strokeWidth={2} />
      </button>
    </div>
  );
}

/**
 * One member as a card. `compact` is the phone layout, per design_handoff_flexhub_mobile/README.md
 * §Members: name + status pill on the first row, then member #, "Plan · Phone" and the expiry — and no
 * action buttons: the whole card opens Member Detail, which has the full-width Renew button. The desktop
 * Cards view (not compact) keeps its Renew/View buttons.
 */
function MemberCard({
  row,
  compact,
  onOpen,
  onEnlargePhoto,
}: {
  row: MemberListRow;
  compact: boolean;
  onOpen: () => void;
  onEnlargePhoto: () => void;
}) {
  const status = deriveStatus(row);
  const navigate = useNavigate();
  const secondaryLine = `${row.current_membership_plan_name ?? 'No plan'} · ${row.phone}`;
  const expiryLine = row.current_membership_end_date
    ? status === 'expired'
      ? `Expired ${formatDate(row.current_membership_end_date)}`
      : `Expires ${formatDate(row.current_membership_end_date)}`
    : '—';
  const badge = <span className={`status-badge ${STATUS_BADGE_CLASS[status]}`}>{STATUS_LABEL[status]}</span>;

  return (
    <div
      className={`members-card${compact ? ' members-card-compact' : ''}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        // Only the card itself: Enter/Space on the Renew/View buttons inside must not also open the member.
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <Avatar row={row} onEnlarge={onEnlargePhoto} />
      <div className="members-card-body">
        <div className="members-card-top">
          <span className="members-card-name" title={row.name}>
            {row.name}
          </span>
          {compact && badge}
        </div>
        <p className="members-card-number">{row.member_number}</p>
        <p className="members-card-secondary">{secondaryLine}</p>
        {compact ? (
          <p className="members-card-expiry-line">{expiryLine}</p>
        ) : (
          <>
            <div className="members-card-bottom">
              <span className={`members-card-expiry status-text-${status}`}>{expiryLine}</span>
              {badge}
            </div>
            <div className="members-row-actions members-card-actions">
              <button
                type="button"
                className="members-row-renew"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/members/${row.id}/renew`);
                }}
                aria-label={`Renew ${row.name}`}
              >
                <Repeat size={14} strokeWidth={2} />
                Renew
              </button>
              <button
                type="button"
                className="members-row-view"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/members/${row.id}`);
                }}
                aria-label={`View ${row.name}`}
              >
                <Eye size={14} strokeWidth={2} />
                View
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** The desktop data table (>= 768px, Table view). Rendered INSTEAD OF the card list, never beside it. */
function MembersTable({
  rows,
  onSort,
  onEnlargePhoto,
}: {
  rows: MemberListRow[];
  onSort: (sort: SortOption) => void;
  onEnlargePhoto: (row: MemberListRow) => void;
}) {
  const navigate = useNavigate();

  return (
    <table className="members-table">
      <thead>
        <tr>
          <th>
            <button type="button" className="members-sort-header" onClick={() => onSort('name')}>
              Name
            </button>
          </th>
          <th>Member #</th>
          <th>Phone</th>
          <th>Plan</th>
          <th>
            <button type="button" className="members-sort-header" onClick={() => onSort('expiry')}>
              Expiry
            </button>
          </th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const status = deriveStatus(row);
          return (
            <tr key={row.id} className="members-table-row" onClick={() => navigate(`/members/${row.id}`)}>
              <td>
                <div className="members-table-name-cell">
                  <Avatar row={row} onEnlarge={() => onEnlargePhoto(row)} />
                  <span>{row.name}</span>
                </div>
              </td>
              <td className="members-table-number">{row.member_number}</td>
              <td>{row.phone}</td>
              <td>{row.current_membership_plan_name ?? 'No plan'}</td>
              <td>
                {row.current_membership_end_date ? formatDate(row.current_membership_end_date) : '—'}
              </td>
              <td>
                <span className={`status-badge ${STATUS_BADGE_CLASS[status]}`}>{STATUS_LABEL[status]}</span>
              </td>
              <td className="members-table-actions-cell">
                <div className="members-row-actions">
                  <button
                    type="button"
                    className="members-row-renew"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/members/${row.id}/renew`);
                    }}
                    aria-label={`Renew ${row.name}`}
                  >
                    <Repeat size={14} strokeWidth={2} />
                    Renew
                  </button>
                  <button
                    type="button"
                    className="members-row-view"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/members/${row.id}`);
                    }}
                    aria-label={`View ${row.name}`}
                  >
                    <Eye size={14} strokeWidth={2} />
                    View
                  </button>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
