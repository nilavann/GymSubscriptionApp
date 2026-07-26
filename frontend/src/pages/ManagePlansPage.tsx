import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Plus, Pencil, Trash2, RefreshCw, X, Check } from 'lucide-react';
import { useServices } from '../context/services.context';
import { withTimeout } from '../lib/with-timeout';
import { sanitizeDecimal } from '../lib/input-masks';
import type { Plan, PlanCategory } from '../types/plan';
import type { PlanDraft, PlanFormErrors } from '../services/plan.service';
import './ManagePlansPage.css';

const FETCH_TIMEOUT_MS = 10000;
type LoadState = 'loading' | 'loaded' | 'network-error' | 'generic-error';
type CategoryFilter = 'all' | PlanCategory;

export function ManagePlansPage() {
  const { planRepository, planService } = useServices();

  const [plans, setPlans] = useState<Plan[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<PlanDraft>(planService.emptyPlanDraft());
  const [errors, setErrors] = useState<PlanFormErrors>({});
  const [touched, setTouched] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Plan | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function load() {
    setLoadState('loading');
    try {
      const data = await withTimeout(planRepository.getAllActive(), FETCH_TIMEOUT_MS, new Error('plans-timeout'));
      setPlans(data);
      setLoadState('loaded');
    } catch (err) {
      const isNetwork = err instanceof Error && (err.message === 'plans-timeout' || err.message === 'Failed to fetch');
      setLoadState(isNetwork ? 'network-error' : 'generic-error');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredPlans = useMemo(
    () => (categoryFilter === 'all' ? plans : plans.filter((p) => p.category === categoryFilter)),
    [plans, categoryFilter]
  );

  function openAddForm() {
    setEditingId(null);
    setForm(planService.emptyPlanDraft());
    setErrors({});
    setTouched(false);
    setSaveError(null);
    setIsFormOpen(true);
  }

  function openEditForm(plan: Plan) {
    setEditingId(plan.id);
    setForm(planService.planToDraft(plan));
    setErrors({});
    setTouched(false);
    setSaveError(null);
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
  }

  function handleCategoryChange(category: PlanCategory) {
    setForm((prev) => ({
      ...prev,
      category,
      // Switching category clears fields that don't apply to it rather than silently
      // submitting a stale value the server would reject/ignore anyway.
      max_members: category === 'membership' ? prev.max_members : 1,
      neverExpires: category === 'addon' ? prev.neverExpires : false,
    }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    const validationErrors = planService.validatePlan(form);
    setErrors(validationErrors);
    if (!planService.isPlanFormValid(validationErrors)) return;

    setSaveError(null);
    setIsSaving(true);
    try {
      if (editingId === null) {
        await planService.create(form);
      } else {
        await planService.update(editingId, form);
      }
      setIsFormOpen(false);
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.toLowerCase().includes('name')) {
        setSaveError('This name is already used by another plan.');
      } else if (message === 'Failed to fetch') {
        setSaveError("Couldn't save this plan — check your connection and try again.");
      } else {
        setSaveError('Something went wrong saving this plan. Please try again.');
      }
    } finally {
      setIsSaving(false);
    }
  }

  function openDeleteConfirm(plan: Plan) {
    setDeleteError(null);
    setDeleteTarget(plan);
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await planRepository.delete(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message === 'Failed to fetch') {
        setDeleteError("Couldn't delete this plan — check your connection and try again.");
      } else if (message) {
        // Includes the "Cannot delete — used by X subscription(s)" message from
        // delete-plan verbatim (edge-functions.md §4) — already specific, not generic.
        setDeleteError(message);
      } else {
        setDeleteError('Something went wrong deleting this plan. Please try again.');
      }
    } finally {
      setIsDeleting(false);
    }
  }

  if (loadState === 'loading') {
    return (
      <div className="plans-page">
        <div className="plans-skeleton" aria-label="Loading" />
      </div>
    );
  }

  if (loadState === 'network-error' || loadState === 'generic-error') {
    return (
      <div className="plans-page">
        <div className="plans-load-error">
          <p>
            {loadState === 'network-error'
              ? "Couldn't load plans — check your connection and try again."
              : 'Something went wrong loading plans. Please try again.'}
          </p>
          <button type="button" className="plans-retry" onClick={load}>
            <RefreshCw size={16} strokeWidth={2} />
            Retry
          </button>
        </div>
      </div>
    );
  }

  const durationRequired = form.category === 'membership' || (form.category === 'addon' && !form.neverExpires);

  return (
    <div className="plans-page">
      <div className="plans-page-header">
        <h1>Plans</h1>
        <button type="button" className="plans-add-button" onClick={openAddForm}>
          <Plus size={18} strokeWidth={2.5} />
          Add Plan
        </button>
      </div>

      {plans.length > 0 && (
        <div className="plans-filter-row" role="group" aria-label="Category filter">
          {(['all', 'membership', 'addon'] as CategoryFilter[]).map((option) => (
            <button
              key={option}
              type="button"
              className={`plans-pill${categoryFilter === option ? ' plans-pill-active' : ''}`}
              onClick={() => setCategoryFilter(option)}
            >
              {option === 'all' ? 'All' : option === 'membership' ? 'Membership' : 'Add-on'}
            </button>
          ))}
        </div>
      )}

      {isFormOpen && (
        <form className="plans-form" onSubmit={handleSubmit} noValidate>
          <h2>{editingId === null ? 'Add Plan' : 'Edit Plan'}</h2>
          {saveError && <div className="plans-banner-error">{saveError}</div>}

          <label htmlFor="plan-name">
            Name<span className="plans-required"> *</span>
          </label>
          <input
            id="plan-name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            onBlur={() => setTouched(true)}
          />
          {touched && errors.name && <p className="plans-error">{errors.name}</p>}

          <span className="plans-field-label">
            Category<span className="plans-required"> *</span>
          </span>
          <div className="plans-chip-row" role="group" aria-label="Category">
            <button
              type="button"
              className={`plans-chip${form.category === 'membership' ? ' plans-chip-selected' : ''}`}
              onClick={() => handleCategoryChange('membership')}
            >
              Membership
            </button>
            <button
              type="button"
              className={`plans-chip${form.category === 'addon' ? ' plans-chip-selected' : ''}`}
              onClick={() => handleCategoryChange('addon')}
            >
              Add-on
            </button>
          </div>
          {touched && errors.category && <p className="plans-error">{errors.category}</p>}

          {form.category === 'addon' && (
            <label className="plans-checkbox-label">
              <input
                type="checkbox"
                checked={form.neverExpires}
                onChange={(e) => setForm({ ...form, neverExpires: e.target.checked })}
              />
              Never expires (indefinite — e.g. a one-time fee)
            </label>
          )}

          {durationRequired && (
            <>
              <label htmlFor="plan-duration">
                Duration (days)<span className="plans-required"> *</span>
              </label>
              <input
                id="plan-duration"
                type="number"
                min={1}
                step={1}
                value={form.duration_days}
                onChange={(e) => setForm({ ...form, duration_days: e.target.value === '' ? '' : Number(e.target.value) })}
                onBlur={() => setTouched(true)}
              />
              {touched && errors.duration_days && <p className="plans-error">{errors.duration_days}</p>}
            </>
          )}

          <label htmlFor="plan-price">
            Price<span className="plans-required"> *</span>
          </label>
          <input
            id="plan-price"
            type="text"
            inputMode="decimal"
            placeholder="e.g. 1000.00"
            value={form.price}
            onChange={(e) => setForm({ ...form, price: sanitizeDecimal(e.target.value, 2) })}
            onBlur={() => setTouched(true)}
          />
          {touched && errors.price && <p className="plans-error">{errors.price}</p>}

          {form.category === 'membership' && (
            <>
              <span className="plans-field-label">Max members</span>
              <div className="plans-chip-row" role="group" aria-label="Max members">
                {[1, 2].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`plans-chip${form.max_members === n ? ' plans-chip-selected' : ''}`}
                    onClick={() => setForm({ ...form, max_members: n as 1 | 2 })}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="plans-form-actions">
            <button type="button" className="plans-cancel" disabled={isSaving} onClick={closeForm}>
              <X size={18} strokeWidth={2} />
              Cancel
            </button>
            <button type="submit" className="plans-submit" disabled={isSaving}>
              {isSaving ? <RefreshCw size={18} strokeWidth={2} className="plans-spin" /> : <Check size={18} strokeWidth={2} />}
              {isSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}

      {plans.length === 0 ? (
        <div className="plans-empty">
          <p>No plans yet.</p>
          <button type="button" className="plans-add-button" onClick={openAddForm}>
            <Plus size={18} strokeWidth={2.5} />
            Add Plan
          </button>
        </div>
      ) : (
        <>
          <div className="plans-cards">
            {filteredPlans.map((plan) => (
              <div key={plan.id} className="plans-card">
                <div className="plans-card-top">
                  <span className="plans-card-name">{plan.name}</span>
                  <span className={`plans-category-badge plans-category-${plan.category}`}>
                    {plan.category === 'membership' ? 'Membership' : 'Add-on'}
                  </span>
                </div>
                <p className="plans-card-detail">
                  {plan.duration_days === null ? 'Never expires' : `${plan.duration_days} days`} · ₹{plan.price}
                </p>
                <div className="plans-card-actions">
                  <button
                    type="button"
                    className="plans-edit-button"
                    onClick={() => openEditForm(plan)}
                    aria-label={`Edit ${plan.name}`}
                  >
                    <Pencil size={14} strokeWidth={2} />
                    Edit
                  </button>
                  <button
                    type="button"
                    className="plans-delete-button"
                    onClick={() => openDeleteConfirm(plan)}
                    aria-label={`Delete ${plan.name}`}
                  >
                    <Trash2 size={14} strokeWidth={2} />
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>

          <table className="plans-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Duration</th>
                <th>Price</th>
                <th>Max Members</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredPlans.map((plan) => (
                <tr key={plan.id}>
                  <td>{plan.name}</td>
                  <td>
                    <span className={`plans-category-badge plans-category-${plan.category}`}>
                      {plan.category === 'membership' ? 'Membership' : 'Add-on'}
                    </span>
                  </td>
                  <td>{plan.duration_days === null ? 'Never expires' : `${plan.duration_days} days`}</td>
                  <td>₹{plan.price}</td>
                  <td>{plan.category === 'membership' ? plan.max_members : '—'}</td>
                  <td className="plans-table-actions">
                    <button
                      type="button"
                      className="plans-edit-button"
                      onClick={() => openEditForm(plan)}
                      aria-label={`Edit ${plan.name}`}
                    >
                      <Pencil size={14} strokeWidth={2} />
                      Edit
                    </button>
                    <button
                      type="button"
                      className="plans-delete-button"
                      onClick={() => openDeleteConfirm(plan)}
                      aria-label={`Delete ${plan.name}`}
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
        <div className="plans-delete-backdrop">
          <div className="plans-delete-dialog">
            <h2>Delete plan?</h2>
            <p>
              "{deleteTarget.name}" will be permanently deleted. This can't be undone unless it's in use, in which case
              deletion is blocked below instead.
            </p>
            {deleteError && <div className="plans-banner-error">{deleteError}</div>}
            <div className="plans-form-actions">
              <button type="button" className="plans-cancel" disabled={isDeleting} onClick={() => setDeleteTarget(null)}>
                <X size={18} strokeWidth={2} />
                Cancel
              </button>
              <button type="button" className="plans-delete-confirm" disabled={isDeleting} onClick={handleConfirmDelete}>
                {isDeleting ? <RefreshCw size={18} strokeWidth={2} className="plans-spin" /> : <Trash2 size={18} strokeWidth={2} />}
                {isDeleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
