import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { X, Check, RefreshCw, Plus, Trash2 } from 'lucide-react';
import { useServices } from '../context/services.context';
import { withTimeout } from '../lib/with-timeout';
import { formatDate } from '../lib/datetime';
import type { Member } from '../types/member';
import type { Plan } from '../types/plan';
import type { MemberCurrentItem } from '../types/member-current-item';
import type { MemberListRow } from '../types/member-list';
import type { PaymentMode } from '../types/subscription';
import {
  newCheckoutItem,
  defaultStartDateForPlan,
  previewEndDate,
  defaultAmountPaid,
  validateCheckoutItem,
  isCheckoutValid,
  findOverlapConflicts,
  type CheckoutItemDraft,
  type OverlapConflict,
} from '../services/subscription.service';
import './RenewSubscriptionPage.css';

const FETCH_TIMEOUT_MS = 10000;
const QUANTITY_PRESETS = [1, 2, 3, 6, 12];
type LoadState = 'loading' | 'loaded' | 'network-error' | 'generic-error';

export function RenewSubscriptionPage() {
  const { id } = useParams();
  const memberId = Number(id);
  const navigate = useNavigate();
  const { memberRepository, planRepository, memberListRepository, subscriptionRepository } = useServices();

  const [member, setMember] = useState<Member | null>(null);
  const [currentItems, setCurrentItems] = useState<MemberCurrentItem[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [allMembers, setAllMembers] = useState<MemberListRow[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');

  const [items, setItems] = useState<CheckoutItemDraft[]>([newCheckoutItem()]);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('Cash');
  const [notes, setNotes] = useState('');

  const [overlapConflicts, setOverlapConflicts] = useState<OverlapConflict[] | null>(null);
  const [hasConfirmedOverlap, setHasConfirmedOverlap] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [touchedItemKeys, setTouchedItemKeys] = useState<Set<string>>(new Set());

  async function load() {
    setLoadState('loading');
    try {
      const [memberData, items, planRows, memberRows] = await Promise.all([
        withTimeout(memberRepository.getById(memberId), FETCH_TIMEOUT_MS, new Error('member-timeout')),
        withTimeout(subscriptionRepository.getCurrentItemsForMember(memberId), FETCH_TIMEOUT_MS, new Error('items-timeout')),
        withTimeout(planRepository.getAllActive(), FETCH_TIMEOUT_MS, new Error('plans-timeout')),
        withTimeout(memberListRepository.getAll(), FETCH_TIMEOUT_MS, new Error('members-timeout')),
      ]);
      if (!memberData) {
        setLoadState('generic-error');
        return;
      }
      setMember(memberData);
      setCurrentItems(items);
      setPlans(planRows);
      setAllMembers(memberRows);
      setLoadState('loaded');
    } catch (err) {
      const isNetwork = err instanceof Error && (err.message.endsWith('-timeout') || err.message === 'Failed to fetch');
      setLoadState(isNetwork ? 'network-error' : 'generic-error');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);

  const planById = useMemo(() => new Map(plans.map((p) => [p.id, p])), [plans]);
  const membershipPlans = useMemo(() => plans.filter((p) => p.category === 'membership'), [plans]);
  const addonPlans = useMemo(() => plans.filter((p) => p.category === 'addon'), [plans]);
  const sharedMemberOptions = useMemo(() => allMembers.filter((m) => m.id !== memberId), [allMembers, memberId]);

  const membershipItemCount = items.filter((item) => item.plan_id !== '' && planById.get(item.plan_id)?.category === 'membership').length;

  const itemErrors = useMemo(
    () => items.map((item) => validateCheckoutItem(item, item.plan_id === '' ? undefined : planById.get(item.plan_id), memberId)),
    [items, planById, memberId]
  );
  const canSubmit = isCheckoutValid(itemErrors, membershipItemCount) && !isSaving;

  function updateItem(key: string, updates: Partial<CheckoutItemDraft>) {
    setItems((prev) => prev.map((item) => (item.key === key ? { ...item, ...updates } : item)));
  }

  function handlePlanChange(key: string, planId: number) {
    const plan = planById.get(planId);
    setItems((prev) =>
      prev.map((item) => {
        if (item.key !== key) return item;
        const startDate = plan ? defaultStartDateForPlan(plan, currentItems) : item.start_date;
        const quantity = plan?.duration_days === null ? 1 : item.quantity === '' ? 1 : item.quantity;
        const amount = item.amountTouched ? item.amount_paid : defaultAmountPaid(plan, typeof quantity === 'number' ? quantity : 1);
        return {
          ...item,
          plan_id: planId,
          start_date: startDate,
          quantity,
          amount_paid: amount,
          shared_member_id: plan?.category === 'membership' && plan.max_members === 2 ? item.shared_member_id : '',
        };
      })
    );
  }

  function handleQuantityChange(key: string, quantity: number) {
    setItems((prev) =>
      prev.map((item) => {
        if (item.key !== key) return item;
        const plan = item.plan_id === '' ? undefined : planById.get(item.plan_id);
        const amount = item.amountTouched ? item.amount_paid : defaultAmountPaid(plan, quantity);
        return { ...item, quantity, amount_paid: amount };
      })
    );
  }

  function addItem() {
    setItems((prev) => [...prev, newCheckoutItem()]);
  }

  function removeItem(key: string) {
    setItems((prev) => (prev.length > 1 ? prev.filter((item) => item.key !== key) : prev));
  }

  function markAllTouched() {
    setTouchedItemKeys(new Set(items.map((item) => item.key)));
  }

  async function performSave() {
    if (!member) return;
    setSaveError(null);
    setIsSaving(true);
    try {
      const result = await subscriptionRepository.create({
        member_id: member.id,
        payment_mode: paymentMode,
        notes: notes.trim() || null,
        items: items.map((item) => ({
          plan_id: item.plan_id as number,
          member_id: member.id,
          shared_member_id: item.shared_member_id === '' ? null : item.shared_member_id,
          start_date: item.start_date,
          quantity: item.quantity === '' ? null : item.quantity,
          amount_paid: item.amount_paid === '' ? null : item.amount_paid,
        })),
      });
      if (result) {
        navigate(`/members/${member.id}`, { replace: true });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message === 'Failed to fetch') {
        setSaveError("Couldn't save this checkout — check your connection and try again.");
      } else if (message) {
        setSaveError(message);
      } else {
        setSaveError('Something went wrong saving this checkout. Please try again.');
      }
      setIsSaving(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    markAllTouched();
    if (!isCheckoutValid(itemErrors, membershipItemCount)) return;

    if (!hasConfirmedOverlap) {
      const conflicts = findOverlapConflicts(items, planById, currentItems);
      if (conflicts.length > 0) {
        setOverlapConflicts(conflicts);
        return;
      }
    }
    await performSave();
  }

  async function handleSaveAnyway() {
    setHasConfirmedOverlap(true);
    setOverlapConflicts(null);
    await performSave();
  }

  if (loadState === 'loading') {
    return (
      <div className="renew-page">
        <div className="renew-skeleton" aria-label="Loading" />
      </div>
    );
  }

  if (loadState === 'network-error' || loadState === 'generic-error') {
    return (
      <div className="renew-page">
        <div className="renew-load-error">
          <p>
            {loadState === 'network-error'
              ? "Couldn't load this screen — check your connection and try again."
              : 'Something went wrong loading this screen. Please try again.'}
          </p>
          <button type="button" className="renew-retry" onClick={load}>
            <RefreshCw size={16} strokeWidth={2} />
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (plans.length === 0) {
    return (
      <div className="renew-page">
        <h1>Add Subscription</h1>
        <p className="renew-empty-plans">No plans available — ask an admin to add one first.</p>
        <Link to={`/members/${memberId}`} className="renew-cancel-link">
          Back to member
        </Link>
      </div>
    );
  }

  return (
    <div className="renew-page">
      <h1>Add Subscription{member ? ` — ${member.name}` : ''}</h1>

      {saveError && <div className="renew-banner-error">{saveError}</div>}

      <form onSubmit={handleSubmit} noValidate>
        <div className="renew-items">
          {items.map((item, index) => {
            const plan = item.plan_id === '' ? undefined : planById.get(item.plan_id);
            const errors = itemErrors[index];
            const showErrors = touchedItemKeys.has(item.key);
            const showQuantity = plan && plan.duration_days !== null;
            const showSharedMember = plan?.category === 'membership' && plan.max_members === 2;
            const endDatePreview = plan ? previewEndDate(plan, item.start_date, item.quantity === '' ? 1 : item.quantity) : null;

            return (
              <div key={item.key} className="renew-item-card">
                <div className="renew-item-header">
                  <span className="renew-item-title">Item {index + 1}</span>
                  {items.length > 1 && (
                    <button
                      type="button"
                      className="renew-remove-item"
                      onClick={() => removeItem(item.key)}
                      aria-label={`Remove item ${index + 1}`}
                    >
                      <Trash2 size={16} strokeWidth={2} />
                    </button>
                  )}
                </div>

                <label htmlFor={`plan-${item.key}`}>Plan</label>
                <select
                  id={`plan-${item.key}`}
                  value={item.plan_id}
                  onChange={(e) => handlePlanChange(item.key, Number(e.target.value))}
                  onBlur={() => setTouchedItemKeys((prev) => new Set(prev).add(item.key))}
                >
                  <option value="">Select a plan…</option>
                  <optgroup label="Membership">
                    {membershipPlans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — ₹{p.price}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Add-on">
                    {addonPlans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — ₹{p.price}
                      </option>
                    ))}
                  </optgroup>
                </select>
                {showErrors && errors.plan_id && <p className="renew-error">{errors.plan_id}</p>}

                <label htmlFor={`start-${item.key}`}>Start date</label>
                <input
                  id={`start-${item.key}`}
                  type="date"
                  value={item.start_date}
                  onChange={(e) => updateItem(item.key, { start_date: e.target.value })}
                  onBlur={() => setTouchedItemKeys((prev) => new Set(prev).add(item.key))}
                />
                {showErrors && errors.start_date && <p className="renew-error">{errors.start_date}</p>}

                {showQuantity && (
                  <>
                    <span className="renew-field-label">Quantity</span>
                    <div className="renew-quantity-row">
                      {QUANTITY_PRESETS.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          className={`renew-chip${item.quantity === preset ? ' renew-chip-selected' : ''}`}
                          onClick={() => handleQuantityChange(item.key, preset)}
                        >
                          ×{preset}
                        </button>
                      ))}
                      <input
                        type="number"
                        min={1}
                        className="renew-quantity-custom"
                        placeholder="Custom"
                        value={item.quantity}
                        onChange={(e) => handleQuantityChange(item.key, e.target.value === '' ? 1 : Number(e.target.value))}
                      />
                    </div>
                    {showErrors && errors.quantity && <p className="renew-error">{errors.quantity}</p>}
                  </>
                )}

                {showSharedMember && (
                  <>
                    <label htmlFor={`shared-${item.key}`}>Shared member (optional)</label>
                    <select
                      id={`shared-${item.key}`}
                      value={item.shared_member_id}
                      onChange={(e) => updateItem(item.key, { shared_member_id: e.target.value ? Number(e.target.value) : '' })}
                    >
                      <option value="">None</option>
                      {sharedMemberOptions.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.member_number})
                        </option>
                      ))}
                    </select>
                    {showErrors && errors.shared_member_id && <p className="renew-error">{errors.shared_member_id}</p>}
                  </>
                )}

                <label htmlFor={`amount-${item.key}`}>Amount paid</label>
                <input
                  id={`amount-${item.key}`}
                  type="number"
                  min={0}
                  step="0.01"
                  value={item.amount_paid}
                  onChange={(e) =>
                    updateItem(item.key, {
                      amount_paid: e.target.value === '' ? '' : Number(e.target.value),
                      amountTouched: true,
                    })
                  }
                  onBlur={() => setTouchedItemKeys((prev) => new Set(prev).add(item.key))}
                />
                {showErrors && errors.amount_paid && <p className="renew-error">{errors.amount_paid}</p>}

                <p className="renew-end-date-preview">
                  {endDatePreview ? `Ends ${formatDate(endDatePreview)}` : plan ? 'Never expires' : ''}
                </p>
              </div>
            );
          })}
        </div>

        <button type="button" className="renew-add-item" onClick={addItem}>
          <Plus size={16} strokeWidth={2} />
          Add Item
        </button>

        {membershipItemCount !== 1 && (
          <p className="renew-error renew-membership-gate">
            A checkout must include exactly one membership-category item ({membershipItemCount} selected).
          </p>
        )}

        <fieldset className="renew-header-fields">
          <legend>Checkout Details</legend>

          <span className="renew-field-label">Payment mode</span>
          <div className="renew-chip-row" role="group" aria-label="Payment mode">
            {(['Cash', 'UPI', 'Card'] as PaymentMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`renew-chip${paymentMode === mode ? ' renew-chip-selected' : ''}`}
                onClick={() => setPaymentMode(mode)}
              >
                {mode}
              </button>
            ))}
          </div>

          <label htmlFor="notes">Notes (optional)</label>
          <textarea id="notes" rows={3} maxLength={200} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </fieldset>

        <div className="renew-actions">
          <button type="button" className="renew-cancel" disabled={isSaving} onClick={() => navigate(`/members/${memberId}`)}>
            <X size={18} strokeWidth={2} />
            Cancel
          </button>
          <button type="submit" className="renew-submit" disabled={!canSubmit}>
            {isSaving ? <RefreshCw size={18} strokeWidth={2} className="renew-spin" /> : <Check size={18} strokeWidth={2} />}
            {isSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>

      {overlapConflicts && overlapConflicts.length > 0 && (
        <div className="renew-overlap-backdrop">
          <div className="renew-overlap-dialog">
            <h2>Possible conflict</h2>
            <ul>
              {overlapConflicts.map((conflict, index) => (
                <li key={index}>
                  {conflict.planName} already runs {formatDate(conflict.existingStartDate)}
                  {conflict.existingEndDate ? `–${formatDate(conflict.existingEndDate)}` : ' onward (indefinite)'} for this
                  member.
                </li>
              ))}
            </ul>
            <div className="renew-overlap-actions">
              <button type="button" className="renew-cancel" onClick={() => setOverlapConflicts(null)}>
                Cancel
              </button>
              <button type="button" className="renew-submit" onClick={handleSaveAnyway}>
                Save anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
