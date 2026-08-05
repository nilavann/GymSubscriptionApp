import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useLocation, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Pencil,
  X,
  Check,
  RefreshCw,
  Camera,
  Upload,
  Trash2,
  ChevronDown,
  ChevronUp,
  Plus,
} from 'lucide-react';
import { useServices } from '../context/services.context';
import { CameraCaptureModal } from '../components/CameraCaptureModal';
import { PhotoLightbox } from '../components/PhotoLightbox';
import { withTimeout } from '../lib/with-timeout';
import { formatDate, toLocalDisplay, todayDate } from '../lib/datetime';
import { sanitizeDigits, sanitizeDecimal } from '../lib/input-masks';
import { deriveStatus, STATUS_LABEL, STATUS_BADGE_CLASS } from '../lib/status';
import { getAvatarColor, getInitials } from '../lib/avatar';
import type { Gender, Member } from '../types/member';
import type { Plan } from '../types/plan';
import type { Profile } from '../types/profile';
import type { MemberCurrentItem } from '../types/member-current-item';
import type { MemberListRow } from '../types/member-list';
import type { PaymentMode, Subscription, SubscriptionItem } from '../types/subscription';
import type { MemberEditDraft, MemberEditFormErrors } from '../services/member.service';
import './MemberDetailPage.css';

const FETCH_TIMEOUT_MS = 10000;
const GENDERS: Gender[] = ['Male', 'Female', 'Other'];
const PAYMENT_MODES: PaymentMode[] = ['Cash', 'UPI', 'Card'];

const NOT_FOUND_MESSAGE = 'This member could not be found.';
const NETWORK_ERROR_MESSAGE = "Couldn't load this member — check your connection and try again.";
const GENERIC_ERROR_MESSAGE = 'Something went wrong loading this member. Please try again.';

type LoadErrorKind = 'not-found' | 'network' | 'generic';

function Req() {
  return (
    <span className="member-detail-required" aria-hidden="true">
      {' '}
      *
    </span>
  );
}

export function MemberDetailPage() {
  const { id } = useParams();
  const memberId = Number(id);
  const navigate = useNavigate();
  const location = useLocation();
  /** /members/:id/edit is a deep-linkable route that just pre-opens this same page in edit mode (screens.md WSCR-03 recommendation, member-detail.md §5). */
  const startInEditMode = location.pathname.endsWith('/edit');
  const { memberRepository, memberService, subscriptionRepository, planRepository, profileRepository, memberListRepository } =
    useServices();
  /** Set by RenewSubscriptionPage on success navigation (renew-checkout-page.md §7's "toast" — no
   * app-wide toast system exists yet, so a dismissible banner fills that role here). */
  const [successMessage, setSuccessMessage] = useState<string | null>((location.state as { toast?: string } | null)?.toast ?? null);

  const [member, setMember] = useState<Member | null>(null);
  const [currentItems, setCurrentItems] = useState<MemberCurrentItem[]>([]);
  const [history, setHistory] = useState<Subscription[]>([]);
  const [historyItems, setHistoryItems] = useState<SubscriptionItem[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [memberRows, setMemberRows] = useState<MemberListRow[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadErrorKind, setLoadErrorKind] = useState<LoadErrorKind | null>(null);

  const [isEditingMember, setIsEditingMember] = useState(false);
  const [memberForm, setMemberForm] = useState<MemberEditDraft | null>(null);
  const [memberErrors, setMemberErrors] = useState<MemberEditFormErrors>({});
  const [touched, setTouched] = useState<Partial<Record<keyof MemberEditDraft, boolean>>>({});
  const [isSavingMember, setIsSavingMember] = useState(false);
  const [memberSaveError, setMemberSaveError] = useState<string | null>(null);

  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isPhotoEnlarged, setIsPhotoEnlarged] = useState(false);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [expandedSubscriptionIds, setExpandedSubscriptionIds] = useState<Set<number>>(new Set());
  const [editingSubscriptionId, setEditingSubscriptionId] = useState<number | null>(null);
  const [historyEditDraft, setHistoryEditDraft] = useState<{ payment_mode: PaymentMode; notes: string }>({
    payment_mode: 'Cash',
    notes: '',
  });
  const [isSavingHistoryEdit, setIsSavingHistoryEdit] = useState(false);
  const [historyEditError, setHistoryEditError] = useState<string | null>(null);

  async function load() {
    setIsLoading(true);
    setLoadError(null);
    setLoadErrorKind(null);
    try {
      const [memberData, items, historyData, planRows, profileRows, allProfileRows, listRows] = await Promise.all([
        withTimeout(memberRepository.getById(memberId), FETCH_TIMEOUT_MS, new Error('member-fetch-timeout')),
        withTimeout(
          subscriptionRepository.getCurrentItemsForMember(memberId),
          FETCH_TIMEOUT_MS,
          new Error('items-fetch-timeout')
        ),
        withTimeout(subscriptionRepository.getHistoryForMember(memberId), FETCH_TIMEOUT_MS, new Error('history-fetch-timeout')),
        withTimeout(planRepository.getAllActive(), FETCH_TIMEOUT_MS, new Error('plans-fetch-timeout')),
        withTimeout(profileRepository.getAllActive(), FETCH_TIMEOUT_MS, new Error('profiles-fetch-timeout')),
        withTimeout(profileRepository.getAllNonDeleted(), FETCH_TIMEOUT_MS, new Error('all-profiles-fetch-timeout')),
        withTimeout(memberListRepository.getAll(), FETCH_TIMEOUT_MS, new Error('members-fetch-timeout')),
      ]);
      if (!memberData) {
        setLoadErrorKind('not-found');
        setLoadError(NOT_FOUND_MESSAGE);
        setIsLoading(false);
        return;
      }
      const items2 = await withTimeout(
        subscriptionRepository.getItemsForSubscriptions(historyData.map((s) => s.id)),
        FETCH_TIMEOUT_MS,
        new Error('history-items-fetch-timeout')
      );
      setMember(memberData);
      setCurrentItems(items);
      setHistory(historyData);
      setHistoryItems(items2);
      setPlans(planRows);
      setProfiles(profileRows);
      setAllProfiles(allProfileRows);
      setMemberRows(listRows);
      if (startInEditMode) {
        setMemberForm(memberService.editDraftFromMember(memberData));
        setIsEditingMember(true);
      }
    } catch (err) {
      const isTimeoutOrNetwork = err instanceof Error && (err.message.endsWith('-timeout') || err.message === 'Failed to fetch');
      setLoadErrorKind(isTimeoutOrNetwork ? 'network' : 'generic');
      setLoadError(isTimeoutOrNetwork ? NETWORK_ERROR_MESSAGE : GENERIC_ERROR_MESSAGE);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);

  function startEdit() {
    if (!member) return;
    setMemberForm(memberService.editDraftFromMember(member));
    setMemberErrors({});
    setTouched({});
    setMemberSaveError(null);
    setIsEditingMember(true);
  }

  function cancelEdit() {
    setIsEditingMember(false);
    setMemberForm(null);
  }

  function updateField<K extends keyof MemberEditDraft>(field: K, value: MemberEditDraft[K]) {
    setMemberForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  }

  function handleBlur(field: keyof MemberEditDraft) {
    setTouched((prev) => ({ ...prev, [field]: true }));
    if (memberForm) setMemberErrors(memberService.validateMemberEdit(memberForm));
  }

  async function handleSaveMember(event: FormEvent) {
    event.preventDefault();
    if (!memberForm || !member) return;
    const validationErrors = memberService.validateMemberEdit(memberForm);
    setMemberErrors(validationErrors);
    setTouched(
      Object.fromEntries(Object.keys(memberForm).map((key) => [key, true])) as Partial<Record<keyof MemberEditDraft, boolean>>
    );
    if (!memberService.isMemberFormValid(validationErrors)) {
      const firstErrorField = Object.keys(validationErrors)[0];
      document.getElementById(`detail-${firstErrorField}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    setMemberSaveError(null);
    setIsSavingMember(true);
    try {
      const payload = await memberService.updateMember(member.id, memberForm);
      setMember((prev) => (prev ? { ...prev, ...payload } : prev));
      setIsEditingMember(false);
      setIsSavingMember(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.toLowerCase().includes('phone')) {
        setMemberSaveError('This phone number is already used by another member.');
      } else if (message === 'Failed to fetch') {
        setMemberSaveError("Couldn't save this member — check your connection and try again.");
      } else {
        setMemberSaveError('Something went wrong saving this member. Please try again.');
      }
      setIsSavingMember(false);
    }
  }

  async function handlePhotoSelected(file: File | undefined) {
    if (!file || !member) return;
    setPhotoError(null);
    setIsUploadingPhoto(true);
    try {
      await memberService.uploadPhoto(member.id, file);
      const refreshed = await memberRepository.getById(member.id);
      if (refreshed) setMember(refreshed);
    } catch {
      setPhotoError("The photo couldn't be uploaded. Please try again.");
    } finally {
      setIsUploadingPhoto(false);
    }
  }

  async function handleConfirmDelete() {
    if (!member) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await memberRepository.delete(member.id);
      navigate('/', { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message === 'Failed to fetch') {
        setDeleteError("Couldn't delete this member — check your connection and try again.");
      } else if (message) {
        // Includes the "Cannot delete — used by X subscription/add-on record(s)" message
        // from delete-member verbatim — already specific, not generic.
        setDeleteError(message);
      } else {
        setDeleteError('Something went wrong deleting this member. Please try again.');
      }
      setIsDeleting(false);
    }
  }

  function toggleExpanded(subscriptionId: number) {
    setExpandedSubscriptionIds((prev) => {
      const next = new Set(prev);
      if (next.has(subscriptionId)) next.delete(subscriptionId);
      else next.add(subscriptionId);
      return next;
    });
  }

  function startHistoryEdit(sub: Subscription) {
    setEditingSubscriptionId(sub.id);
    setHistoryEditDraft({ payment_mode: sub.payment_mode, notes: sub.notes ?? '' });
    setHistoryEditError(null);
  }

  async function handleSaveHistoryEdit(subscriptionId: number) {
    setIsSavingHistoryEdit(true);
    setHistoryEditError(null);
    try {
      await subscriptionRepository.update({
        subscription_id: subscriptionId,
        payment_mode: historyEditDraft.payment_mode,
        notes: historyEditDraft.notes.trim() || null,
      });
      setHistory((prev) =>
        prev.map((s) =>
          s.id === subscriptionId ? { ...s, payment_mode: historyEditDraft.payment_mode, notes: historyEditDraft.notes.trim() || null } : s
        )
      );
      setEditingSubscriptionId(null);
    } catch (err) {
      const message = err instanceof Error && err.message === 'Failed to fetch';
      setHistoryEditError(
        message ? "Couldn't save — check your connection and try again." : 'Something went wrong saving. Please try again.'
      );
    } finally {
      setIsSavingHistoryEdit(false);
    }
  }

  if (isLoading) {
    return (
      <div className="member-detail-page">
        <div className="member-detail-skeleton" aria-label="Loading" />
      </div>
    );
  }

  if (loadErrorKind === 'not-found') {
    return (
      <div className="member-detail-page">
        <div className="member-detail-load-error">
          <p>{loadError}</p>
          <Link to="/" className="member-detail-back-link">
            <ArrowLeft size={16} strokeWidth={2} />
            Back to Members
          </Link>
        </div>
      </div>
    );
  }

  if (loadErrorKind === 'network' || loadErrorKind === 'generic') {
    return (
      <div className="member-detail-page">
        <div className="member-detail-load-error">
          <p>{loadError}</p>
          <button type="button" className="member-detail-retry" onClick={load}>
            <RefreshCw size={16} strokeWidth={2} />
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!member) return null;

  const status = deriveStatus({
    current_membership_plan_id: currentItems.find((i) => i.category === 'membership')?.plan_id ?? null,
    current_membership_end_date: currentItems.find((i) => i.category === 'membership')?.end_date ?? null,
  });
  const currentMembershipItem = currentItems.find((i) => i.category === 'membership') ?? null;
  const currentAddonItems = currentItems.filter((i) => i.category === 'addon');

  const planById = new Map(plans.map((p) => [p.id, p]));
  const profileById = new Map(allProfiles.map((p) => [p.id, p]));
  const memberNameById = new Map(memberRows.map((m) => [m.id, m.name]));
  const historyItemsBySubscription = new Map<number, SubscriptionItem[]>();
  for (const item of historyItems) {
    const list = historyItemsBySubscription.get(item.subscription_id) ?? [];
    list.push(item);
    historyItemsBySubscription.set(item.subscription_id, list);
  }

  const showError = (field: keyof MemberEditDraft) => touched[field] && memberErrors[field];

  return (
    <div className="member-detail-page">
      <div className="member-detail-header">
        <Link to="/" className="member-detail-back-link">
          <ArrowLeft size={16} strokeWidth={2} />
          Members
        </Link>
      </div>

      {successMessage && (
        <div className="member-detail-banner-success">
          {successMessage}
          <button type="button" className="member-detail-banner-dismiss" onClick={() => setSuccessMessage(null)} aria-label="Dismiss">
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      )}

      {memberSaveError && <div className="member-detail-banner-error">{memberSaveError}</div>}

      <div className="member-detail-hero">
        <div className="member-detail-avatar-wrap">
          {member.photo_url ? (
            <img
              src={member.photo_url}
              alt=""
              className="member-detail-avatar-img member-detail-avatar-clickable"
              onClick={() => setIsPhotoEnlarged(true)}
            />
          ) : (
            <span className="member-detail-avatar" style={{ background: getAvatarColor(member.id) }}>
              {getInitials(member.name)}
            </span>
          )}
          {/* Take Photo opens a live in-page camera (CameraCaptureModal, getUserMedia)
              rather than a <input capture> file input — that attribute only opens the
              native camera app on some mobile browsers and is silently ignored on
              desktop, indistinguishable from Upload there. */}
          <button
            type="button"
            className="member-detail-photo-button member-detail-photo-button-camera"
            aria-label="Take photo"
            onClick={() => setIsCameraOpen(true)}
          >
            <Camera size={14} strokeWidth={2} />
          </button>
          <label className="member-detail-photo-button member-detail-photo-button-upload" aria-label="Upload photo">
            <Upload size={14} strokeWidth={2} />
            <input type="file" accept="image/*" hidden onChange={(e) => handlePhotoSelected(e.target.files?.[0])} />
          </label>
        </div>
        {isCameraOpen && (
          <CameraCaptureModal
            onCapture={(file) => {
              handlePhotoSelected(file);
              setIsCameraOpen(false);
            }}
            onClose={() => setIsCameraOpen(false)}
          />
        )}
        {isPhotoEnlarged && member.photo_url && (
          <PhotoLightbox src={member.photo_url} alt={member.name} onClose={() => setIsPhotoEnlarged(false)} />
        )}
        <div className="member-detail-hero-info">
          <span className="member-detail-name">{member.name}</span>
          <div className="member-detail-hero-meta">
            <span className={`status-badge ${STATUS_BADGE_CLASS[status]}`}>{STATUS_LABEL[status]}</span>
            <span className="member-detail-number">{member.member_number}</span>
          </div>
          {isUploadingPhoto && <p className="member-detail-photo-status">Uploading photo…</p>}
          {photoError && (
            <p className="member-detail-photo-error">
              {photoError}{' '}
              <button type="button" className="member-detail-inline-retry" onClick={() => setPhotoError(null)}>
                Dismiss
              </button>
            </p>
          )}
        </div>

        <div className="member-detail-hero-actions">
          {!isEditingMember ? (
            <>
              <button type="button" className="member-detail-edit-button" onClick={startEdit}>
                <Pencil size={16} strokeWidth={2} />
                Edit
              </button>
              <button type="button" className="member-detail-delete-link" onClick={() => setDeleteConfirmOpen(true)}>
                <Trash2 size={16} strokeWidth={2} />
                Delete
              </button>
            </>
          ) : (
            <>
              <button type="button" className="member-detail-cancel" disabled={isSavingMember} onClick={cancelEdit}>
                <X size={16} strokeWidth={2} />
                Cancel
              </button>
              <button type="submit" form="member-detail-form" className="member-detail-save" disabled={isSavingMember}>
                {isSavingMember ? <RefreshCw size={16} strokeWidth={2} className="member-detail-spin" /> : <Check size={16} strokeWidth={2} />}
                {isSavingMember ? 'Saving…' : 'Save'}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="member-detail-columns">
        <div className="member-detail-column-left">
          <form id="member-detail-form" onSubmit={handleSaveMember} noValidate>
            <fieldset className="member-detail-section">
              <legend>Personal</legend>
              {!isEditingMember || !memberForm ? (
                <dl className="member-detail-view-grid">
                  <ViewField label="Name" value={member.name} />
                  <ViewField label="Phone" value={member.phone} />
                  <ViewField label="Date of birth" value={formatDate(member.date_of_birth)} />
                  <ViewField label="Date of joining" value={formatDate(member.date_of_joining)} />
                  <ViewField label="Gender" value={member.gender} />
                  <ViewField label="Email" value={member.email ?? '—'} />
                  <ViewField label="Occupation" value={member.occupation ?? '—'} />
                  <ViewField label="Aadhaar number" value={member.aadhaar_number ?? '—'} />
                  <ViewField label="Address" value={member.residential_address ?? '—'} span />
                </dl>
              ) : (
                <div className="member-detail-field-grid">
                  <div className="member-detail-field">
                    <label htmlFor="detail-name">
                      Name
                      <Req />
                    </label>
                    <input
                      id="detail-name"
                      value={memberForm.name}
                      onChange={(e) => updateField('name', e.target.value)}
                      onBlur={() => handleBlur('name')}
                    />
                    {showError('name') && <p className="member-detail-error">{memberErrors.name}</p>}
                  </div>
                  <div className="member-detail-field">
                    <label htmlFor="detail-phone">
                      Phone
                      <Req />
                    </label>
                    <input
                      id="detail-phone"
                      type="tel"
                      inputMode="numeric"
                      value={memberForm.phone}
                      onChange={(e) => updateField('phone', sanitizeDigits(e.target.value, 10))}
                      onBlur={() => handleBlur('phone')}
                    />
                    {showError('phone') && <p className="member-detail-error">{memberErrors.phone}</p>}
                  </div>
                  <div className="member-detail-field">
                    <label htmlFor="detail-date_of_birth">
                      Date of birth
                      <Req />
                    </label>
                    <input
                      id="detail-date_of_birth"
                      type="date"
                      value={memberForm.date_of_birth}
                      onChange={(e) => updateField('date_of_birth', e.target.value)}
                      onBlur={() => handleBlur('date_of_birth')}
                    />
                    {showError('date_of_birth') && <p className="member-detail-error">{memberErrors.date_of_birth}</p>}
                  </div>
                  <div className="member-detail-field">
                    <label htmlFor="detail-date_of_joining">
                      Date of joining
                      <Req />
                    </label>
                    <input
                      id="detail-date_of_joining"
                      type="date"
                      value={memberForm.date_of_joining}
                      onChange={(e) => updateField('date_of_joining', e.target.value)}
                      onBlur={() => handleBlur('date_of_joining')}
                    />
                    {showError('date_of_joining') && <p className="member-detail-error">{memberErrors.date_of_joining}</p>}
                  </div>
                  <div className="member-detail-field">
                    <span className="member-detail-chip-label">
                      Gender
                      <Req />
                    </span>
                    <div className="member-detail-chip-row" role="group" aria-label="Gender">
                      {GENDERS.map((gender) => (
                        <button
                          key={gender}
                          type="button"
                          className={`member-detail-chip${memberForm.gender === gender ? ' member-detail-chip-selected' : ''}`}
                          onClick={() => {
                            updateField('gender', gender);
                            handleBlur('gender');
                          }}
                        >
                          {gender}
                        </button>
                      ))}
                    </div>
                    {showError('gender') && <p className="member-detail-error">{memberErrors.gender}</p>}
                  </div>
                  <div className="member-detail-field">
                    <label htmlFor="detail-email">Email (optional)</label>
                    <input
                      id="detail-email"
                      type="email"
                      value={memberForm.email}
                      onChange={(e) => updateField('email', e.target.value)}
                      onBlur={() => handleBlur('email')}
                    />
                    {showError('email') && <p className="member-detail-error">{memberErrors.email}</p>}
                  </div>
                  <div className="member-detail-field">
                    <label htmlFor="detail-occupation">Occupation (optional)</label>
                    <input id="detail-occupation" value={memberForm.occupation} onChange={(e) => updateField('occupation', e.target.value)} />
                  </div>
                  <div className="member-detail-field">
                    <label htmlFor="detail-aadhaar_number">Aadhaar number (optional)</label>
                    <input
                      id="detail-aadhaar_number"
                      value={memberForm.aadhaar_number}
                      onChange={(e) => updateField('aadhaar_number', sanitizeDigits(e.target.value, 12))}
                    />
                  </div>
                  <div className="member-detail-field member-detail-field-span-2">
                    <label htmlFor="detail-residential_address">Address (optional)</label>
                    <textarea
                      id="detail-residential_address"
                      rows={4}
                      value={memberForm.residential_address}
                      onChange={(e) => updateField('residential_address', e.target.value)}
                    />
                  </div>
                </div>
              )}
            </fieldset>

            <fieldset className="member-detail-section">
              <legend>Body Metrics</legend>
              {!isEditingMember || !memberForm ? (
                <dl className="member-detail-view-grid">
                  <ViewField label="Weight" value={`${member.weight_kg} kg`} />
                  <ViewField label="Height" value={`${member.height_cm} cm`} />
                </dl>
              ) : (
                <div className="member-detail-metrics-row">
                  <div>
                    <label htmlFor="detail-weight_kg">
                      Weight (kg)
                      <Req />
                    </label>
                    <input
                      id="detail-weight_kg"
                      type="text"
                      inputMode="decimal"
                      value={memberForm.weight_kg}
                      onChange={(e) => updateField('weight_kg', sanitizeDecimal(e.target.value, 2))}
                      onBlur={() => handleBlur('weight_kg')}
                    />
                    {showError('weight_kg') && <p className="member-detail-error">{memberErrors.weight_kg}</p>}
                  </div>
                  <div>
                    <label htmlFor="detail-height_cm">
                      Height (cm)
                      <Req />
                    </label>
                    <input
                      id="detail-height_cm"
                      type="text"
                      inputMode="decimal"
                      value={memberForm.height_cm}
                      onChange={(e) => updateField('height_cm', sanitizeDecimal(e.target.value, 2))}
                      onBlur={() => handleBlur('height_cm')}
                    />
                    {showError('height_cm') && <p className="member-detail-error">{memberErrors.height_cm}</p>}
                  </div>
                </div>
              )}
            </fieldset>

            <fieldset className="member-detail-section">
              <legend>Medical</legend>
              {!isEditingMember || !memberForm ? (
                <dl className="member-detail-view-grid">
                  <ViewField label="Under doctor's care" value={member.under_doctor_care ? 'Yes' : 'No'} />
                  {member.under_doctor_care && <ViewField label="Details" value={member.doctor_care_details ?? '—'} span />}
                </dl>
              ) : (
                <>
                  <label className="member-detail-toggle-row">
                    <span>Under doctor's care</span>
                    <span
                      className={`member-detail-toggle${memberForm.under_doctor_care ? ' member-detail-toggle-on' : ''}`}
                      role="switch"
                      aria-checked={memberForm.under_doctor_care}
                      tabIndex={0}
                      onClick={() => updateField('under_doctor_care', !memberForm.under_doctor_care)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          updateField('under_doctor_care', !memberForm.under_doctor_care);
                        }
                      }}
                    >
                      <span className="member-detail-toggle-knob" />
                    </span>
                  </label>
                  {memberForm.under_doctor_care && (
                    <>
                      <label htmlFor="detail-doctor_care_details">
                        Details
                        <Req />
                      </label>
                      <textarea
                        id="detail-doctor_care_details"
                        value={memberForm.doctor_care_details}
                        onChange={(e) => updateField('doctor_care_details', e.target.value)}
                        onBlur={() => handleBlur('doctor_care_details')}
                      />
                      {showError('doctor_care_details') && <p className="member-detail-error">{memberErrors.doctor_care_details}</p>}
                    </>
                  )}
                </>
              )}
            </fieldset>

            <fieldset className="member-detail-section">
              <legend>Emergency contact</legend>
              {!isEditingMember || !memberForm ? (
                <dl className="member-detail-view-grid">
                  <ViewField label="Name" value={member.emergency_contact_name} />
                  <ViewField label="Phone" value={member.emergency_contact_phone} />
                  <ViewField label="Relationship" value={member.emergency_contact_relationship} />
                </dl>
              ) : (
                <div className="member-detail-field-grid">
                  <div className="member-detail-field">
                    <label htmlFor="detail-emergency_contact_name">
                      Name
                      <Req />
                    </label>
                    <input
                      id="detail-emergency_contact_name"
                      value={memberForm.emergency_contact_name}
                      onChange={(e) => updateField('emergency_contact_name', e.target.value)}
                      onBlur={() => handleBlur('emergency_contact_name')}
                    />
                    {showError('emergency_contact_name') && (
                      <p className="member-detail-error">{memberErrors.emergency_contact_name}</p>
                    )}
                  </div>
                  <div className="member-detail-field">
                    <label htmlFor="detail-emergency_contact_phone">
                      Phone
                      <Req />
                    </label>
                    <input
                      id="detail-emergency_contact_phone"
                      type="tel"
                      inputMode="numeric"
                      value={memberForm.emergency_contact_phone}
                      onChange={(e) => updateField('emergency_contact_phone', sanitizeDigits(e.target.value, 10))}
                      onBlur={() => handleBlur('emergency_contact_phone')}
                    />
                    {showError('emergency_contact_phone') && (
                      <p className="member-detail-error">{memberErrors.emergency_contact_phone}</p>
                    )}
                  </div>
                  <div className="member-detail-field member-detail-field-span-2">
                    <label htmlFor="detail-emergency_contact_relationship">
                      Relationship
                      <Req />
                    </label>
                    <input
                      id="detail-emergency_contact_relationship"
                      value={memberForm.emergency_contact_relationship}
                      onChange={(e) => updateField('emergency_contact_relationship', e.target.value)}
                      onBlur={() => handleBlur('emergency_contact_relationship')}
                    />
                    {showError('emergency_contact_relationship') && (
                      <p className="member-detail-error">{memberErrors.emergency_contact_relationship}</p>
                    )}
                  </div>
                </div>
              )}
            </fieldset>

            <fieldset className="member-detail-section">
              <legend>System</legend>
              <dl className="member-detail-view-grid">
                <ViewField label="Member number" value={member.member_number} />
                <ViewField label="Created by" value={member.created_by ? profileById.get(member.created_by)?.full_name ?? 'Unknown' : '—'} />
                {!isEditingMember || !memberForm ? (
                  <ViewField
                    label="Handled by staff"
                    value={member.handled_by_staff ? profileById.get(member.handled_by_staff)?.full_name ?? 'Unknown' : 'Not set'}
                  />
                ) : (
                  <div className="member-detail-field">
                    <label htmlFor="detail-handled_by_staff">Handled by staff</label>
                    <select
                      id="detail-handled_by_staff"
                      value={memberForm.handled_by_staff}
                      onChange={(e) => updateField('handled_by_staff', e.target.value)}
                    >
                      <option value="">Not set</option>
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.full_name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </dl>
            </fieldset>
          </form>
        </div>

        <div className="member-detail-column-right">
          <section className="member-detail-section">
            <h2 className="member-detail-section-title">Current Membership</h2>
            {!currentMembershipItem ? (
              <div className="member-detail-empty">
                <p>No active membership</p>
                <Link to={`/members/${member.id}/renew`} className="member-detail-add-sub-link">
                  <Plus size={16} strokeWidth={2} />
                  Add Subscription
                </Link>
              </div>
            ) : (
              <div className="member-detail-item-card">
                <div className="member-detail-item-card-top">
                  <span className="member-detail-item-name">{currentMembershipItem.plan_name}</span>
                  <Link to={`/members/${member.id}/renew`} className="member-detail-renew-button">
                    Renew
                  </Link>
                </div>
                <p className="member-detail-item-detail">
                  {formatDate(currentMembershipItem.start_date)} –{' '}
                  {currentMembershipItem.end_date ? formatDate(currentMembershipItem.end_date) : 'No expiry'}
                  {'  '}
                  <span className={`status-badge ${STATUS_BADGE_CLASS[status]}`}>{STATUS_LABEL[status]}</span>
                </p>
                <p className="member-detail-item-amount">₹{currentMembershipItem.amount_paid}</p>
                {currentMembershipItem.end_date &&
                  (() => {
                    const { pct, daysRemaining } = membershipProgress(currentMembershipItem.start_date, currentMembershipItem.end_date);
                    return (
                      <>
                        <div className="member-detail-progress-track">
                          <div className="member-detail-progress-fill" style={{ transform: `scaleX(${pct / 100})` }} />
                        </div>
                        <p className="member-detail-progress-label">
                          {daysRemaining > 0 ? `${daysRemaining} days remaining` : 'Expired'}
                        </p>
                      </>
                    );
                  })()}
              </div>
            )}
          </section>

          {currentAddonItems.length > 0 && (
            <section className="member-detail-section">
              <h2 className="member-detail-section-title">Current Add-ons</h2>
              <div className="member-detail-addon-list">
                {currentAddonItems.map((item) => (
                  <div key={item.subscription_item_id} className="member-detail-addon-row">
                    <span>{item.plan_name}</span>
                    <span className="member-detail-addon-dates">
                      {formatDate(item.start_date)} – {item.end_date ? formatDate(item.end_date) : 'No expiry'}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="member-detail-section">
            <div className="member-detail-history-header">
              <h2 className="member-detail-section-title">Subscription History</h2>
              <Link to={`/members/${member.id}/renew`} className="member-detail-add-sub-link">
                <Plus size={16} strokeWidth={2} />
                Add Subscription
              </Link>
            </div>
            {history.length === 0 ? (
              <p className="member-detail-empty-inline">No subscription history yet</p>
            ) : (
              <div className="member-detail-history-list">
                {history.map((sub) => {
                  const items = historyItemsBySubscription.get(sub.id) ?? [];
                  const total = items.reduce((sum, i) => sum + i.amount_paid, 0);
                  const expanded = expandedSubscriptionIds.has(sub.id);
                  const editing = editingSubscriptionId === sub.id;
                  return (
                    <div key={sub.id} className="member-detail-history-row">
                      <div className="member-detail-history-summary">
                        <button type="button" className="member-detail-history-toggle" onClick={() => toggleExpanded(sub.id)}>
                          {expanded ? <ChevronUp size={16} strokeWidth={2} /> : <ChevronDown size={16} strokeWidth={2} />}
                          <span>
                            {toLocalDisplay(sub.created_at)} · {sub.payment_mode} · ₹{total}
                          </span>
                        </button>
                        <button type="button" className="member-detail-history-edit" onClick={() => startHistoryEdit(sub)}>
                          <Pencil size={14} strokeWidth={2} />
                          Edit
                        </button>
                      </div>

                      {editing && (
                        <div className="member-detail-history-edit-form">
                          {historyEditError && <div className="member-detail-banner-error">{historyEditError}</div>}
                          <label htmlFor={`history-payment-${sub.id}`}>Payment mode</label>
                          <select
                            id={`history-payment-${sub.id}`}
                            value={historyEditDraft.payment_mode}
                            onChange={(e) => setHistoryEditDraft((d) => ({ ...d, payment_mode: e.target.value as PaymentMode }))}
                          >
                            {PAYMENT_MODES.map((mode) => (
                              <option key={mode} value={mode}>
                                {mode}
                              </option>
                            ))}
                          </select>
                          <label htmlFor={`history-notes-${sub.id}`}>Notes</label>
                          <textarea
                            id={`history-notes-${sub.id}`}
                            value={historyEditDraft.notes}
                            onChange={(e) => setHistoryEditDraft((d) => ({ ...d, notes: e.target.value }))}
                          />
                          <div className="member-detail-form-actions">
                            <button
                              type="button"
                              className="member-detail-cancel"
                              disabled={isSavingHistoryEdit}
                              onClick={() => setEditingSubscriptionId(null)}
                            >
                              <X size={16} strokeWidth={2} />
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="member-detail-save"
                              disabled={isSavingHistoryEdit}
                              onClick={() => handleSaveHistoryEdit(sub.id)}
                            >
                              {isSavingHistoryEdit ? (
                                <RefreshCw size={16} strokeWidth={2} className="member-detail-spin" />
                              ) : (
                                <Check size={16} strokeWidth={2} />
                              )}
                              Save
                            </button>
                          </div>
                        </div>
                      )}

                      {expanded && (
                        <div className="member-detail-history-items">
                          {items.map((item) => {
                            const plan = planById.get(item.plan_id);
                            const sharedName = item.shared_member_id
                              ? memberNameById.get(item.member_id === member.id ? item.shared_member_id : item.member_id)
                              : null;
                            return (
                              <p key={item.id} className="member-detail-history-item">
                                {plan?.name ?? 'Unknown plan'} ({plan?.category === 'addon' ? 'add-on' : 'membership'}) ·{' '}
                                {formatDate(item.start_date)} – {item.end_date ? formatDate(item.end_date) : 'No expiry'}
                                {sharedName && <span className="member-detail-shared-note"> · Shared with {sharedName}</span>}
                              </p>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>

      {deleteConfirmOpen && (
        <div className="member-detail-delete-backdrop">
          <div className="member-detail-delete-dialog">
            <h2>Delete member?</h2>
            <p>"{member.name}" will be removed from the members list, search, and reports. This can't be undone from here.</p>
            {deleteError && <div className="member-detail-banner-error">{deleteError}</div>}
            <div className="member-detail-form-actions">
              <button type="button" className="member-detail-cancel" disabled={isDeleting} onClick={() => setDeleteConfirmOpen(false)}>
                <X size={18} strokeWidth={2} />
                Cancel
              </button>
              <button type="button" className="member-detail-delete-confirm" disabled={isDeleting} onClick={handleConfirmDelete}>
                {isDeleting ? <RefreshCw size={18} strokeWidth={2} className="member-detail-spin" /> : <Trash2 size={18} strokeWidth={2} />}
                {isDeleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** UI-only progress preview for the current-membership card — never the source of truth for end_date. */
function membershipProgress(start: string, end: string) {
  const toUTC = (d: string) => {
    const [y, m, dd] = d.split('-').map(Number);
    return Date.UTC(y, m - 1, dd);
  };
  const totalDays = Math.max(1, (toUTC(end) - toUTC(start)) / 86400000);
  const elapsedDays = Math.min(totalDays, Math.max(0, (toUTC(todayDate()) - toUTC(start)) / 86400000));
  const pct = Math.min(100, Math.max(0, (elapsedDays / totalDays) * 100));
  const daysRemaining = Math.max(0, Math.round(totalDays - elapsedDays));
  return { pct, daysRemaining };
}

function ViewField({ label, value, span }: { label: string; value: string; span?: boolean }) {
  return (
    <div className={`member-detail-view-field${span ? ' member-detail-field-span-2' : ''}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
