import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft, Trash2, Calendar, AlertTriangle, WifiOff, RefreshCw } from 'lucide-react';
import { useServices } from '../context/services.context';
import { withTimeout } from '../lib/with-timeout';
import { formatDate, todayDate } from '../lib/datetime';
import type { Member } from '../types/member';
import type { Plan } from '../types/plan';
import type { MemberCurrentItem } from '../types/member-current-item';
import type { PaymentMode } from '../types/subscription';
import {
  newCheckoutItem,
  defaultStartDateForPlan,
  defaultAmountPaid,
  previewEndDate,
  validateCheckoutItem,
  isCheckoutValid,
  findItemOverlap,
  buildInitialCheckoutItems,
  type CheckoutItemDraft,
  type ItemOverlapConflict,
} from '../services/subscription.service';
import './RenewSubscriptionPage.css';

const FETCH_TIMEOUT_MS = 10000;
const QUANTITY_PRESETS = [1, 2, 3, 6, 12];
const PAYMENT_MODES: PaymentMode[] = ['Cash', 'UPI', 'Card'];
type LoadState = 'loading' | 'loaded' | 'network-error' | 'generic-error';

function Req() {
  return (
    <span className="renew-required" aria-hidden="true">
      {' '}
      *
    </span>
  );
}

function formatRupees(amount: number): string {
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

function planOptionLabel(plan: Plan): string {
  const duration = plan.duration_days === null ? 'Never expires' : `${plan.duration_days} days`;
  return `${plan.name} · ${duration} · ₹${plan.price.toLocaleString('en-IN')}`;
}

export function RenewSubscriptionPage() {
  const { id } = useParams();
  const memberId = Number(id);
  const navigate = useNavigate();
  const { memberRepository, planRepository, subscriptionRepository } = useServices();

  const [member, setMember] = useState<Member | null>(null);
  const [currentItems, setCurrentItems] = useState<MemberCurrentItem[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');

  const [items, setItems] = useState<CheckoutItemDraft[]>([]);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('Cash');
  const [notes, setNotes] = useState('');
  const [isDirty, setIsDirty] = useState(false);

  const [touchedItemKeys, setTouchedItemKeys] = useState<Set<string>>(new Set());
  const [amountFocusKey, setAmountFocusKey] = useState<string | null>(null);
  const [pendingFocusKey, setPendingFocusKey] = useState<string | null>(null);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const [saveErrorKind, setSaveErrorKind] = useState<'network' | 'generic' | null>(null);
  const [saveErrorMessage, setSaveErrorMessage] = useState('');

  const itemCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const planSelectRefs = useRef<Record<string, HTMLSelectElement | null>>({});
  /** Per item, the last start date that didn't overlap — lets the overlap warning's own
   * Cancel button revert to it (§4's "reverts the start date to its last non-overlapping value"). */
  const lastGoodStartDateRef = useRef<Record<string, string>>({});

  async function load() {
    setLoadState('loading');
    try {
      const [memberData, currentItemsData, planRows] = await Promise.all([
        withTimeout(memberRepository.getById(memberId), FETCH_TIMEOUT_MS, new Error('member-timeout')),
        withTimeout(subscriptionRepository.getCurrentItemsForMember(memberId), FETCH_TIMEOUT_MS, new Error('items-timeout')),
        withTimeout(planRepository.getAllActive(), FETCH_TIMEOUT_MS, new Error('plans-timeout')),
      ]);
      if (!memberData) {
        setLoadState('generic-error');
        return;
      }
      setMember(memberData);
      setCurrentItems(currentItemsData);
      setPlans(planRows);
      setItems(buildInitialCheckoutItems(currentItemsData, planRows));
      setIsDirty(false);
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

  const membershipItemCount = items.filter((item) => item.category === 'membership').length;

  const itemErrors = useMemo(
    () => items.map((item) => validateCheckoutItem(item, item.plan_id === '' ? undefined : planById.get(item.plan_id))),
    [items, planById]
  );
  const canSubmit = isCheckoutValid(itemErrors, membershipItemCount) && !isSaving;

  const overlapByKey = useMemo(() => {
    const map = new Map<string, ItemOverlapConflict | null>();
    items.forEach((item) => map.set(item.key, findItemOverlap(item, items, planById, currentItems)));
    return map;
  }, [items, planById, currentItems]);

  useEffect(() => {
    items.forEach((item) => {
      if (!overlapByKey.get(item.key)) lastGoodStartDateRef.current[item.key] = item.start_date;
    });
  }, [items, overlapByKey]);

  useEffect(() => {
    if (!pendingFocusKey) return;
    itemCardRefs.current[pendingFocusKey]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    planSelectRefs.current[pendingFocusKey]?.focus();
    setPendingFocusKey(null);
  }, [pendingFocusKey]);

  function markDirty() {
    setIsDirty(true);
  }

  function touchItem(key: string) {
    setTouchedItemKeys((prev) => new Set(prev).add(key));
  }

  function handlePlanChange(key: string, planId: number) {
    const plan = planById.get(planId);
    setItems((prev) =>
      prev.map((item) => {
        if (item.key !== key) return item;
        const isFirstPick = item.plan_id === '';
        const startDate = isFirstPick && plan ? defaultStartDateForPlan(plan, currentItems) : item.start_date;
        return {
          ...item,
          plan_id: planId,
          start_date: startDate,
          amount_paid: defaultAmountPaid(plan, item.quantity),
          overlapAcknowledged: false,
        };
      })
    );
    markDirty();
  }

  function handleStartDateChange(key: string, value: string) {
    setItems((prev) => prev.map((item) => (item.key === key ? { ...item, start_date: value, overlapAcknowledged: false } : item)));
    markDirty();
  }

  function handleQuantityPreset(key: string, preset: number) {
    setItems((prev) =>
      prev.map((item) => {
        if (item.key !== key) return item;
        const plan = item.plan_id === '' ? undefined : planById.get(item.plan_id);
        return { ...item, quantity: preset, isCustomQuantity: false, amount_paid: defaultAmountPaid(plan, preset), overlapAcknowledged: false };
      })
    );
    markDirty();
  }

  function handleQuantityCustomInput(key: string, value: number) {
    const clamped = Math.max(1, Math.min(60, Number.isFinite(value) ? value : 1));
    setItems((prev) =>
      prev.map((item) => {
        if (item.key !== key) return item;
        const plan = item.plan_id === '' ? undefined : planById.get(item.plan_id);
        return { ...item, quantity: clamped, amount_paid: defaultAmountPaid(plan, clamped), overlapAcknowledged: false };
      })
    );
    markDirty();
  }

  function showCustomQuantity(key: string) {
    setItems((prev) => prev.map((item) => (item.key === key ? { ...item, isCustomQuantity: true } : item)));
  }

  function backToPresets(key: string) {
    setItems((prev) => prev.map((item) => (item.key === key ? { ...item, isCustomQuantity: false } : item)));
  }

  function handleAmountChange(key: string, digits: string) {
    setItems((prev) => prev.map((item) => (item.key === key ? { ...item, amount_paid: digits === '' ? '' : Number(digits) } : item)));
    markDirty();
  }

  function addItem() {
    const hasMembership = items.some((item) => item.category === 'membership');
    const item = newCheckoutItem(hasMembership ? 'addon' : 'membership');
    setItems((prev) => [...prev, item]);
    setPendingFocusKey(item.key);
    markDirty();
  }

  function removeItem(key: string) {
    setItems((prev) => prev.filter((item) => item.key !== key));
    markDirty();
  }

  function handleOverlapCancel(key: string) {
    const fallback = lastGoodStartDateRef.current[key] ?? todayDate();
    setItems((prev) => prev.map((item) => (item.key === key ? { ...item, start_date: fallback, overlapAcknowledged: false } : item)));
  }

  function handleOverlapSaveAnyway(key: string) {
    setItems((prev) => prev.map((item) => (item.key === key ? { ...item, overlapAcknowledged: true } : item)));
  }

  function markAllTouched() {
    setTouchedItemKeys(new Set(items.map((item) => item.key)));
  }

  async function performSave() {
    if (!member) return;
    setSaveErrorKind(null);
    setSaveErrorMessage('');
    setIsSaving(true);
    try {
      const result = await subscriptionRepository.create({
        member_id: member.id,
        payment_mode: paymentMode,
        notes: notes.trim() || null,
        items: items.map((item) => {
          const plan = item.plan_id === '' ? undefined : planById.get(item.plan_id);
          return {
            plan_id: item.plan_id as number,
            member_id: member.id,
            shared_member_id: null,
            start_date: item.start_date,
            quantity: plan?.duration_days === null ? null : item.quantity,
            amount_paid: item.amount_paid === '' ? null : item.amount_paid,
          };
        }),
      });
      navigate(`/members/${member.id}`, {
        replace: true,
        state: { toast: `Checkout saved · receipt #${result.subscription.id}` },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message === 'Failed to fetch') {
        setSaveErrorKind('network');
      } else {
        setSaveErrorKind('generic');
        setSaveErrorMessage(message || 'Something went wrong saving this checkout. Please try again.');
      }
      setIsSaving(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    markAllTouched();
    if (!isCheckoutValid(itemErrors, membershipItemCount)) return;
    await performSave();
  }

  function handleCancelClick() {
    if (isDirty) {
      setDiscardConfirmOpen(true);
    } else {
      navigate(`/members/${memberId}`);
    }
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
        <h1>Renew / Add Subscription</h1>
        <p className="renew-empty-plans">No plans available — ask an admin to add one first.</p>
        <Link to={`/members/${memberId}`} className="renew-cancel-link">
          Back to member
        </Link>
      </div>
    );
  }

  const totalThisVisit = items.reduce((sum, item) => sum + (typeof item.amount_paid === 'number' ? item.amount_paid : 0), 0);
  const validityMessage =
    membershipItemCount === 1
      ? '✓ Contains exactly one membership item'
      : membershipItemCount === 0
        ? 'Add one membership item to continue'
        : 'Only one membership item per checkout';

  return (
    <div className="renew-page">
      <div className="renew-title-row">
        <Link to={`/members/${memberId}`} className="renew-back-link" aria-label="Back to member">
          <ArrowLeft size={15} strokeWidth={2} />
        </Link>
        <h1>Renew / Add Subscription</h1>
      </div>
      <p className="renew-subtitle">
        {member ? `${member.name} · ${member.member_number} · ` : ''}one checkout, one or more items
      </p>

      {saveErrorKind === 'generic' && <div className="renew-banner-error">{saveErrorMessage}</div>}

      <form onSubmit={handleSubmit} noValidate>
        <div className="renew-card">
          <p className="renew-section-title">Payment</p>
          <div className="renew-form-grid">
            <div className="renew-field">
              <span className="renew-field-label">
                Payment mode
                <Req />
              </span>
              <div className="renew-payment-chip-row" role="group" aria-label="Payment mode">
                {PAYMENT_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`renew-payment-chip${paymentMode === mode ? ' renew-payment-chip-selected' : ''}`}
                    disabled={isSaving}
                    onClick={() => {
                      setPaymentMode(mode);
                      markDirty();
                    }}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            <div className="renew-field">
              <label htmlFor="renew-notes">
                Notes <span className="renew-field-optional">(optional, ≤ 200 chars)</span>
              </label>
              <input
                id="renew-notes"
                type="text"
                maxLength={200}
                placeholder="e.g. paid partially, balance next week"
                value={notes}
                disabled={isSaving}
                onChange={(e) => {
                  setNotes(e.target.value);
                  markDirty();
                }}
              />
              {notes.length >= 180 && <p className="renew-helper">{notes.length}/200</p>}
            </div>
          </div>
        </div>

        <div className="renew-items">
          {items.map((item, index) => {
            const plan = item.plan_id === '' ? undefined : planById.get(item.plan_id);
            const errors = itemErrors[index];
            const showErrors = touchedItemKeys.has(item.key);
            const categoryPlans = item.category === 'membership' ? membershipPlans : addonPlans;
            const showQuantity = !plan || plan.duration_days !== null;
            const isIndefinite = plan && plan.duration_days === null;
            const endDatePreview = plan ? previewEndDate(plan, item.start_date, item.quantity) : null;
            const isPastStart = item.start_date !== '' && item.start_date < todayDate();
            const conflict = overlapByKey.get(item.key) ?? null;
            const isOnlyMembership = item.category === 'membership' && membershipItemCount === 1;
            const startHelperText =
              item.category === 'membership'
                ? 'Defaults to day after current membership expires.'
                : 'Defaults to day after current add-on expires.';

            return (
              <div
                key={item.key}
                className="renew-card renew-item-card"
                ref={(el) => {
                  itemCardRefs.current[item.key] = el;
                }}
              >
                <div className="renew-item-header">
                  <span className={`renew-category-tag renew-category-tag-${item.category}`}>
                    {item.category === 'addon' ? 'Add-on' : 'Membership'}
                  </span>
                  <button
                    type="button"
                    className="renew-delete-item"
                    disabled={isOnlyMembership || isSaving}
                    title={isOnlyMembership ? 'A checkout needs one membership.' : undefined}
                    aria-label={`Remove ${item.category === 'addon' ? 'add-on' : 'membership'} item`}
                    onClick={() => removeItem(item.key)}
                  >
                    <Trash2 size={12} strokeWidth={2} />
                  </button>
                </div>

                <div className="renew-form-grid">
                  <div className="renew-field">
                    <label htmlFor={`plan-${item.key}`}>
                      Plan
                      <Req />
                    </label>
                    <select
                      id={`plan-${item.key}`}
                      ref={(el) => {
                        planSelectRefs.current[item.key] = el;
                      }}
                      value={item.plan_id}
                      disabled={isSaving}
                      className={showErrors && errors.plan_id ? 'renew-input-error' : ''}
                      onChange={(e) => handlePlanChange(item.key, Number(e.target.value))}
                      onBlur={() => touchItem(item.key)}
                    >
                      <option value="">Select a plan…</option>
                      {categoryPlans.map((p) => (
                        <option key={p.id} value={p.id}>
                          {planOptionLabel(p)}
                        </option>
                      ))}
                    </select>
                    {showErrors && errors.plan_id && <p className="renew-error">{errors.plan_id}</p>}
                  </div>

                  <div className="renew-field">
                    <label htmlFor={`start-${item.key}`}>
                      Start date
                      <Req />
                    </label>
                    <input
                      id={`start-${item.key}`}
                      type="date"
                      value={item.start_date}
                      disabled={isSaving}
                      className={showErrors && errors.start_date ? 'renew-input-error' : ''}
                      onChange={(e) => handleStartDateChange(item.key, e.target.value)}
                      onBlur={() => touchItem(item.key)}
                    />
                    {showErrors && errors.start_date ? (
                      <p className="renew-error">{errors.start_date}</p>
                    ) : (
                      <p className={`renew-helper${isPastStart ? ' renew-helper-warning' : ''}`}>{startHelperText}</p>
                    )}
                  </div>

                  {showQuantity && (
                    <div className="renew-field">
                      <span className="renew-field-label">Quantity</span>
                      {item.isCustomQuantity ? (
                        <div className="renew-quantity-custom-row">
                          <input
                            type="number"
                            min={1}
                            max={60}
                            value={item.quantity}
                            disabled={isSaving}
                            onChange={(e) => handleQuantityCustomInput(item.key, Number(e.target.value))}
                            onBlur={() => touchItem(item.key)}
                          />
                          <button type="button" className="renew-back-to-presets" onClick={() => backToPresets(item.key)}>
                            back to presets
                          </button>
                        </div>
                      ) : (
                        <div className="renew-quantity-row">
                          {QUANTITY_PRESETS.map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              className={`renew-quantity-chip${item.quantity === preset ? ' renew-quantity-chip-selected' : ''}`}
                              disabled={isSaving}
                              onClick={() => handleQuantityPreset(item.key, preset)}
                            >
                              ×{preset}
                            </button>
                          ))}
                          <button
                            type="button"
                            className="renew-quantity-chip"
                            disabled={isSaving}
                            onClick={() => showCustomQuantity(item.key)}
                          >
                            Custom
                          </button>
                        </div>
                      )}
                      {showErrors && errors.quantity && <p className="renew-error">{errors.quantity}</p>}
                    </div>
                  )}

                  <div className="renew-field">
                    <label htmlFor={`amount-${item.key}`}>Amount paid (₹)</label>
                    <input
                      id={`amount-${item.key}`}
                      type="text"
                      inputMode="numeric"
                      disabled={isSaving}
                      className={showErrors && errors.amount_paid ? 'renew-input-error' : ''}
                      value={
                        amountFocusKey === item.key
                          ? item.amount_paid === ''
                            ? ''
                            : String(item.amount_paid)
                          : item.amount_paid === ''
                            ? ''
                            : item.amount_paid.toLocaleString('en-IN')
                      }
                      onFocus={() => setAmountFocusKey(item.key)}
                      onChange={(e) => handleAmountChange(item.key, e.target.value.replace(/[^0-9]/g, ''))}
                      onBlur={() => {
                        setAmountFocusKey(null);
                        touchItem(item.key);
                      }}
                    />
                    {showErrors && errors.amount_paid ? (
                      <p className="renew-error">{errors.amount_paid}</p>
                    ) : (
                      <p className="renew-helper">Defaults to price × quantity, editable.</p>
                    )}
                  </div>
                </div>

                {plan && (
                  <p className="renew-end-preview">
                    <Calendar size={14} strokeWidth={2} />
                    {isIndefinite ? (
                      'Never expires'
                    ) : (
                      <>
                        Ends <strong>{endDatePreview ? formatDate(endDatePreview) : '—'}</strong>{' '}
                        <span className="renew-end-preview-muted">(computed on save)</span>
                      </>
                    )}
                  </p>
                )}

                {conflict && !item.overlapAcknowledged && (
                  <div className="renew-overlap-warning">
                    <AlertTriangle size={15} strokeWidth={2} className="renew-overlap-icon" />
                    <div className="renew-overlap-body">
                      <p>
                        Overlaps with current <strong>{conflict.planName}</strong>
                        {conflict.existingEndDate ? ` (till ${formatDate(conflict.existingEndDate)}).` : '.'}
                      </p>
                      <div className="renew-overlap-actions">
                        <button type="button" className="renew-overlap-cancel" onClick={() => handleOverlapCancel(item.key)}>
                          Cancel
                        </button>
                        <button type="button" className="renew-overlap-save" onClick={() => handleOverlapSaveAnyway(item.key)}>
                          Save anyway
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {conflict && item.overlapAcknowledged && <p className="renew-overlap-acknowledged">Overlap acknowledged.</p>}
              </div>
            );
          })}
        </div>

        <button type="button" className="renew-add-item" disabled={isSaving} onClick={addItem}>
          + Add another item
        </button>

        {saveErrorKind === 'network' && (
          <div className="renew-network-banner">
            <WifiOff size={16} strokeWidth={2} />
            <div className="renew-network-banner-body">
              <p>Checkout couldn't be saved — network error. No payment was recorded; your items are kept.</p>
              <button type="button" className="renew-retry-save" onClick={performSave}>
                Retry save
              </button>
            </div>
          </div>
        )}

        <div className="renew-footer-card">
          <div className="renew-footer-left">
            <span className="renew-footer-label">Total this visit</span>
            <p className="renew-footer-amount">{formatRupees(totalThisVisit)}</p>
            <p className={`renew-footer-validity${membershipItemCount === 1 ? ' renew-footer-validity-ok' : ''}`}>{validityMessage}</p>
          </div>
          <div className="renew-footer-actions">
            <button type="button" className="renew-footer-cancel" disabled={isSaving} onClick={handleCancelClick}>
              Cancel
            </button>
            <button type="submit" className="renew-footer-submit" disabled={!canSubmit}>
              {isSaving && <RefreshCw size={16} strokeWidth={2} className="renew-spin" />}
              {isSaving ? 'Saving…' : 'Save checkout'}
            </button>
          </div>
        </div>
      </form>

      {discardConfirmOpen && (
        <div className="renew-confirm-backdrop">
          <div className="renew-confirm-dialog">
            <h2>Discard this checkout?</h2>
            <p>You've made changes that haven't been saved. Leaving now will discard them.</p>
            <div className="renew-confirm-actions">
              <button type="button" className="renew-footer-cancel" onClick={() => setDiscardConfirmOpen(false)}>
                Keep editing
              </button>
              <button type="button" className="renew-discard-confirm" onClick={() => navigate(`/members/${memberId}`)}>
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
