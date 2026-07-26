import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, SlidersHorizontal, Pencil, RefreshCw } from 'lucide-react';
import { useServices } from '../context/services.context';
import { withTimeout } from '../lib/with-timeout';
import { formatDate } from '../lib/datetime';
import { deriveStatus, STATUS_LABEL, STATUS_BADGE_CLASS } from '../lib/status';
import { getAvatarColor, getInitials } from '../lib/avatar';
import { PhotoLightbox } from '../components/PhotoLightbox';
import type { MemberListRow, MemberStatus } from '../types/member-list';
import type { Gender } from '../types/member';
import type { Plan } from '../types/plan';
import './MembersListPage.css';

const FETCH_TIMEOUT_MS = 10000;
const GENDERS: Gender[] = ['Male', 'Female', 'Other'];
type SortOption = 'join-date' | 'name' | 'expiry';
type StatusPill = 'all' | MemberStatus;
type LoadState = 'loading' | 'loaded' | 'network-error' | 'generic-error';

function matchesSearch(row: MemberListRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const qDigits = q.replace(/\s+/g, '');
  return (
    row.name.toLowerCase().includes(q) ||
    row.member_number.toLowerCase().includes(q) ||
    row.phone.replace(/\s+/g, '').toLowerCase().includes(qDigits)
  );
}

export function MembersListPage() {
  const { memberListRepository, planRepository } = useServices();
  const navigate = useNavigate();

  const [rows, setRows] = useState<MemberListRow[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');

  const [search, setSearch] = useState('');
  const [statusPill, setStatusPill] = useState<StatusPill>('all');
  const [sort, setSort] = useState<SortOption>('join-date');
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
      const isNetwork = err instanceof Error && (err.message.endsWith('-timeout') || err.message === 'Failed to fetch');
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
  const rowsBeforeStatusFilter = useMemo(() => {
    let result = rows.filter((row) => matchesSearch(row, search));
    if (selectedGenders.length > 0) {
      result = result.filter((row) => selectedGenders.includes(row.gender));
    }
    if (selectedAddonPlanIds.length > 0) {
      result = result.filter((row) => row.current_addon_plan_ids.some((id) => selectedAddonPlanIds.includes(id)));
    }
    if (selectedPlanIds.length > 0) {
      result = result.filter(
        (row) => row.current_membership_plan_id !== null && selectedPlanIds.includes(row.current_membership_plan_id)
      );
    }
    return result;
  }, [rows, search, selectedGenders, selectedAddonPlanIds, selectedPlanIds]);

  const statusPillCounts = useMemo(() => {
    const counts: Record<StatusPill, number> = { all: rowsBeforeStatusFilter.length, active: 0, expiring: 0, expired: 0 };
    for (const row of rowsBeforeStatusFilter) {
      counts[deriveStatus(row)] += 1;
    }
    return counts;
  }, [rowsBeforeStatusFilter]);

  const filteredRows = useMemo(() => {
    const result = statusPill === 'all' ? rowsBeforeStatusFilter : rowsBeforeStatusFilter.filter((row) => deriveStatus(row) === statusPill);

    const sorted = [...result];
    if (sort === 'name') {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === 'expiry') {
      sorted.sort((a, b) => {
        if (a.current_membership_end_date === null) return 1;
        if (b.current_membership_end_date === null) return -1;
        return a.current_membership_end_date.localeCompare(b.current_membership_end_date);
      });
    } else {
      sorted.sort((a, b) => b.date_of_joining.localeCompare(a.date_of_joining));
    }
    return sorted;
  }, [rowsBeforeStatusFilter, statusPill, sort]);

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
          <p>
            {loadState === 'network-error'
              ? "Couldn't load members — check your connection and try again."
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

  return (
    <div className="members-page">
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

              <button type="button" className="members-filter-toggle" onClick={() => setFiltersOpen((v) => !v)}>
                <SlidersHorizontal size={16} strokeWidth={2} />
                Filters{activeFilterCount > 0 && !filtersOpen ? ` (${activeFilterCount})` : ''}
              </button>
            </div>

            {filtersOpen && (
              <div className="members-filter-panel">
                <div className="members-filter-group">
                  <span className="members-filter-label">Gender</span>
                  <div className="members-chip-row">
                    {GENDERS.map((gender) => (
                      <button
                        key={gender}
                        type="button"
                        className={`members-chip${selectedGenders.includes(gender) ? ' members-chip-selected' : ''}`}
                        onClick={() => toggleInArray(selectedGenders, gender, setSelectedGenders)}
                      >
                        {gender}
                      </button>
                    ))}
                  </div>
                </div>

                {membershipPlans.length > 0 && (
                  <div className="members-filter-group">
                    <span className="members-filter-label">Plan</span>
                    <div className="members-chip-row">
                      {membershipPlans.map((plan) => (
                        <button
                          key={plan.id}
                          type="button"
                          className={`members-chip${selectedPlanIds.includes(plan.id) ? ' members-chip-selected' : ''}`}
                          onClick={() => toggleInArray(selectedPlanIds, plan.id, setSelectedPlanIds)}
                        >
                          {plan.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {addonPlans.length > 0 && (
                  <div className="members-filter-group">
                    <span className="members-filter-label">Add-on</span>
                    <div className="members-chip-row">
                      {addonPlans.map((plan) => (
                        <button
                          key={plan.id}
                          type="button"
                          className={`members-chip${selectedAddonPlanIds.includes(plan.id) ? ' members-chip-selected' : ''}`}
                          onClick={() => toggleInArray(selectedAddonPlanIds, plan.id, setSelectedAddonPlanIds)}
                        >
                          {plan.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
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

      {filteredRows.length > 0 && (
        <>
          {/* Mobile: stacked cards. Desktop: data table. Both read the same filteredRows -
              toggled purely by CSS media query (rules.md rule 16), same pattern as AppShell. */}
          <div className="members-cards">
            {filteredRows.map((row) => (
              <MemberCard key={row.id} row={row} onOpen={() => navigate(`/members/${row.id}`)} onEnlargePhoto={() => enlargePhoto(row)} />
            ))}
          </div>

          <table className="members-table">
            <thead>
              <tr>
                <th>
                  <button type="button" className="members-sort-header" onClick={() => setSort('name')}>
                    Name
                  </button>
                </th>
                <th>Phone</th>
                <th>Plan</th>
                <th>
                  <button type="button" className="members-sort-header" onClick={() => setSort('expiry')}>
                    Expiry
                  </button>
                </th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const status = deriveStatus(row);
                return (
                  <tr key={row.id} className="members-table-row" onClick={() => navigate(`/members/${row.id}`)}>
                    <td>
                      <div className="members-table-name-cell">
                        <Avatar row={row} onEnlarge={() => enlargePhoto(row)} />
                        <span>{row.name}</span>
                      </div>
                    </td>
                    <td>{row.phone}</td>
                    <td>{row.current_membership_plan_name ?? 'No plan'}</td>
                    <td>
                      {row.current_membership_end_date ? formatDate(row.current_membership_end_date) : '—'}
                    </td>
                    <td>
                      <span className={`status-badge ${STATUS_BADGE_CLASS[status]}`}>{STATUS_LABEL[status]}</span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="members-edit-button"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/members/${row.id}/edit`);
                        }}
                        aria-label={`Edit ${row.name}`}
                      >
                        <Pencil size={14} strokeWidth={2} />
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

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

function MemberCard({ row, onOpen, onEnlargePhoto }: { row: MemberListRow; onOpen: () => void; onEnlargePhoto: () => void }) {
  const status = deriveStatus(row);
  const navigate = useNavigate();
  const secondaryLine = `${row.current_membership_plan_name ?? 'No plan'} · ${row.phone}`;
  const expiryLine = row.current_membership_end_date
    ? status === 'expired'
      ? `Expired ${formatDate(row.current_membership_end_date)}`
      : `Expires ${formatDate(row.current_membership_end_date)}`
    : '—';

  return (
    <div className="members-card" onClick={onOpen} role="button" tabIndex={0}>
      <Avatar row={row} onEnlarge={onEnlargePhoto} />
      <div className="members-card-body">
        <div className="members-card-top">
          <span className="members-card-name">{row.name}</span>
          <button
            type="button"
            className="members-edit-button"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/members/${row.id}/edit`);
            }}
            aria-label={`Edit ${row.name}`}
          >
            <Pencil size={14} strokeWidth={2} />
            Edit
          </button>
        </div>
        <p className="members-card-secondary">{secondaryLine}</p>
        <div className="members-card-bottom">
          <span className={`members-card-expiry status-text-${status}`}>{expiryLine}</span>
          <span className={`status-badge ${STATUS_BADGE_CLASS[status]}`}>{STATUS_LABEL[status]}</span>
        </div>
      </div>
    </div>
  );
}
