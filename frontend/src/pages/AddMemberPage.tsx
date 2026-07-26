import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Upload, RefreshCw, X, Check } from 'lucide-react';
import { useServices } from '../context/services.context';
import { todayDate } from '../lib/datetime';
import { withTimeout } from '../lib/with-timeout';
import { sanitizeDigits, sanitizeDecimal } from '../lib/input-masks';
import { CameraCaptureModal } from '../components/CameraCaptureModal';
import type { Branch } from '../types/branch';
import type { Gender } from '../types/member';
import type { MemberFormErrors, NewMemberDraft } from '../services/member.service';
import './AddMemberPage.css';

const FETCH_TIMEOUT_MS = 10000;
const GENDERS: Gender[] = ['Male', 'Female', 'Other'];

/** Asterisk marker for required-field labels — see spec/frontend/rules.md UI conventions. */
function Req() {
  return (
    <span className="add-member-required" aria-hidden="true">
      {' '}
      *
    </span>
  );
}

function emptyDraft(): NewMemberDraft {
  return {
    name: '',
    phone: '',
    date_of_birth: '',
    date_of_joining: todayDate(),
    branch_id: '',
    gender: '',
    weight_kg: '',
    height_cm: '',
    under_doctor_care: false,
    doctor_care_details: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
    emergency_contact_relationship: '',
    email: '',
    residential_address: '',
    aadhaar_number: '',
    occupation: '',
  };
}

type BranchLoadState = 'loading' | 'loaded' | 'network-error' | 'generic-error';

export function AddMemberPage() {
  const { memberService, branchRepository } = useServices();
  const navigate = useNavigate();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchLoadState, setBranchLoadState] = useState<BranchLoadState>('loading');

  const [form, setForm] = useState<NewMemberDraft>(emptyDraft());
  const [errors, setErrors] = useState<MemberFormErrors>({});
  const [touched, setTouched] = useState<Partial<Record<keyof NewMemberDraft, boolean>>>({});
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const uploadInputRef = useRef<HTMLInputElement>(null);

  // Loading, error, and retry per rules.md rules 29-30 — the branch list is required
  // (branch_id feeds member_number generation) so the form can't usefully render until
  // it's loaded.
  async function loadBranches() {
    setBranchLoadState('loading');
    try {
      const data = await withTimeout(branchRepository.getAllActive(), FETCH_TIMEOUT_MS, new Error('branches-timeout'));
      setBranches(data);
      setBranchLoadState('loaded');
    } catch (err) {
      const isNetwork = err instanceof Error && (err.message === 'branches-timeout' || err.message === 'Failed to fetch');
      setBranchLoadState(isNetwork ? 'network-error' : 'generic-error');
    }
  }

  useEffect(() => {
    loadBranches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    };
  }, [photoPreviewUrl]);

  function updateField<K extends keyof NewMemberDraft>(field: K, value: NewMemberDraft[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleBlur(field: keyof NewMemberDraft) {
    setTouched((prev) => ({ ...prev, [field]: true }));
    setErrors(memberService.validateNewMember({ ...form }));
  }

  function handlePhotoSelected(file: File | undefined) {
    if (!file) return;
    setPhotoFile(file);
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    setPhotoPreviewUrl(URL.createObjectURL(file));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const validationErrors = memberService.validateNewMember(form);
    setErrors(validationErrors);
    setTouched(
      Object.fromEntries(Object.keys(form).map((key) => [key, true])) as Partial<Record<keyof NewMemberDraft, boolean>>
    );

    if (!memberService.isMemberFormValid(validationErrors)) {
      const firstErrorField = Object.keys(validationErrors)[0];
      document.getElementById(firstErrorField)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    setSaveError(null);
    setIsSaving(true);
    try {
      const { member, photoError } = await memberService.create(form, photoFile);
      if (photoError) {
        // Photo failure never blocks the member record (REQ-MEM-004) - it's already
        // saved, so we still navigate through; the retry lives on the member's own page.
        console.warn(photoError);
      }
      navigate(`/members/${member.id}`, { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.toLowerCase().includes('phone')) {
        setSaveError('This phone number is already used by another member.');
      } else if (message === 'Failed to fetch') {
        setSaveError("Couldn't save this member — check your connection and try again.");
      } else {
        setSaveError('Something went wrong saving this member. Please try again.');
      }
      setIsSaving(false);
    }
  }

  if (branchLoadState === 'loading') {
    return (
      <div className="add-member-page">
        <div className="add-member-skeleton" aria-label="Loading" />
      </div>
    );
  }

  if (branchLoadState === 'network-error' || branchLoadState === 'generic-error') {
    return (
      <div className="add-member-page">
        <div className="add-member-load-error">
          <p>
            {branchLoadState === 'network-error'
              ? "Couldn't load this screen — check your connection and try again."
              : 'Something went wrong loading this screen. Please try again.'}
          </p>
          <button type="button" className="add-member-retry" onClick={loadBranches}>
            <RefreshCw size={16} strokeWidth={2} />
            Retry
          </button>
        </div>
      </div>
    );
  }

  const showError = (field: keyof NewMemberDraft) => touched[field] && errors[field];

  return (
    <div className="add-member-page">
      <h1>Add Member</h1>

      {saveError && <div className="add-member-banner-error">{saveError}</div>}

      <form onSubmit={handleSubmit} noValidate>
        <fieldset className="add-member-section">
          <legend>Personal Details</legend>
          <div className="add-member-field-grid">
            <div className="add-member-field">
              <label htmlFor="name">
                Name
                <Req />
              </label>
              <input
                id="name"
                placeholder="Full name"
                required
                aria-required="true"
                value={form.name}
                onChange={(e) => updateField('name', e.target.value)}
                onBlur={() => handleBlur('name')}
              />
              {showError('name') && <p className="add-member-error">{errors.name}</p>}
            </div>

            <div className="add-member-field">
              <label htmlFor="phone">
                Phone
                <Req />
              </label>
              <input
                id="phone"
                type="tel"
                inputMode="numeric"
                placeholder="10-digit mobile number"
                required
                aria-required="true"
                value={form.phone}
                onChange={(e) => updateField('phone', sanitizeDigits(e.target.value, 10))}
                onBlur={() => handleBlur('phone')}
              />
              {showError('phone') && <p className="add-member-error">{errors.phone}</p>}
            </div>

            <div className="add-member-field">
              <label htmlFor="date_of_birth">
                Date of birth
                <Req />
              </label>
              <input
                id="date_of_birth"
                type="date"
                required
                aria-required="true"
                value={form.date_of_birth}
                onChange={(e) => updateField('date_of_birth', e.target.value)}
                onBlur={() => handleBlur('date_of_birth')}
              />
              {showError('date_of_birth') && <p className="add-member-error">{errors.date_of_birth}</p>}
            </div>

            <div className="add-member-field">
              <label htmlFor="date_of_joining">
                Date of joining
                <Req />
              </label>
              <input
                id="date_of_joining"
                type="date"
                required
                aria-required="true"
                value={form.date_of_joining}
                onChange={(e) => updateField('date_of_joining', e.target.value)}
                onBlur={() => handleBlur('date_of_joining')}
              />
              {showError('date_of_joining') && <p className="add-member-error">{errors.date_of_joining}</p>}
            </div>

            <div className="add-member-field">
              <label htmlFor="branch_id">
                Branch
                <Req />
              </label>
              <select
                id="branch_id"
                required
                aria-required="true"
                value={form.branch_id}
                onChange={(e) => updateField('branch_id', e.target.value ? Number(e.target.value) : '')}
                onBlur={() => handleBlur('branch_id')}
              >
                <option value="">Select a branch…</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name} ({branch.code})
                  </option>
                ))}
              </select>
              {showError('branch_id') && <p className="add-member-error">{errors.branch_id}</p>}
            </div>

            <div className="add-member-field">
              <span id="gender" className="add-member-chip-label">
                Gender
                <Req />
              </span>
              <div className="add-member-chip-row" role="group" aria-labelledby="gender">
                {GENDERS.map((gender) => (
                  <button
                    key={gender}
                    type="button"
                    className={`add-member-chip${form.gender === gender ? ' add-member-chip-selected' : ''}`}
                    onClick={() => {
                      updateField('gender', gender);
                      handleBlur('gender');
                    }}
                  >
                    {gender}
                  </button>
                ))}
              </div>
              {showError('gender') && <p className="add-member-error">{errors.gender}</p>}
            </div>

            <div className="add-member-field">
              <label htmlFor="email">Email (optional)</label>
              <input
                id="email"
                type="email"
                placeholder="name@example.com"
                value={form.email}
                onChange={(e) => updateField('email', e.target.value)}
                onBlur={() => handleBlur('email')}
              />
              {showError('email') && <p className="add-member-error">{errors.email}</p>}
            </div>

            <div className="add-member-field">
              <label htmlFor="occupation">Occupation (optional)</label>
              <input
                id="occupation"
                placeholder="e.g. Software Engineer"
                value={form.occupation}
                onChange={(e) => updateField('occupation', e.target.value)}
              />
            </div>

            <div className="add-member-field">
              <label htmlFor="aadhaar_number">Aadhaar number (optional)</label>
              <input
                id="aadhaar_number"
                placeholder="12-digit Aadhaar number"
                value={form.aadhaar_number}
                onChange={(e) => updateField('aadhaar_number', sanitizeDigits(e.target.value, 12))}
              />
            </div>

            <div className="add-member-field add-member-field-span-2">
              <label htmlFor="residential_address">Address (optional)</label>
              <textarea
                id="residential_address"
                rows={4}
                placeholder="Street, city, state"
                value={form.residential_address}
                onChange={(e) => updateField('residential_address', e.target.value)}
              />
            </div>
          </div>
        </fieldset>

        <fieldset className="add-member-section">
          <legend>Body Metrics</legend>
          <div className="add-member-metrics-row">
            <div>
              <label htmlFor="weight_kg">
                Weight (kg)
                <Req />
              </label>
              <input
                id="weight_kg"
                type="text"
                inputMode="decimal"
                placeholder="e.g. 72.5"
                required
                aria-required="true"
                value={form.weight_kg}
                onChange={(e) => updateField('weight_kg', sanitizeDecimal(e.target.value, 2))}
                onBlur={() => handleBlur('weight_kg')}
              />
              {showError('weight_kg') && <p className="add-member-error">{errors.weight_kg}</p>}
            </div>
            <div>
              <label htmlFor="height_cm">
                Height (cm)
                <Req />
              </label>
              <input
                id="height_cm"
                type="text"
                inputMode="decimal"
                placeholder="e.g. 172.50"
                required
                aria-required="true"
                value={form.height_cm}
                onChange={(e) => updateField('height_cm', sanitizeDecimal(e.target.value, 2))}
                onBlur={() => handleBlur('height_cm')}
              />
              {showError('height_cm') && <p className="add-member-error">{errors.height_cm}</p>}
            </div>
          </div>
        </fieldset>

        <fieldset className="add-member-section">
          <legend>Doctor's Care</legend>
          <div className="add-member-chip-row" role="group" aria-label="Under doctor's care">
            <button
              type="button"
              className={`add-member-chip${!form.under_doctor_care ? ' add-member-chip-selected' : ''}`}
              onClick={() => updateField('under_doctor_care', false)}
            >
              No
            </button>
            <button
              type="button"
              className={`add-member-chip${form.under_doctor_care ? ' add-member-chip-selected' : ''}`}
              onClick={() => updateField('under_doctor_care', true)}
            >
              Yes
            </button>
          </div>

          {form.under_doctor_care && (
            <>
              <label htmlFor="doctor_care_details">
                Details
                <Req />
              </label>
              <textarea
                id="doctor_care_details"
                placeholder="Describe the condition or treatment"
                required
                aria-required="true"
                value={form.doctor_care_details}
                onChange={(e) => updateField('doctor_care_details', e.target.value)}
                onBlur={() => handleBlur('doctor_care_details')}
              />
              {showError('doctor_care_details') && <p className="add-member-error">{errors.doctor_care_details}</p>}
            </>
          )}
        </fieldset>

        <fieldset className="add-member-section">
          <legend>Emergency Contact</legend>
          <div className="add-member-field-grid">
            <div className="add-member-field">
              <label htmlFor="emergency_contact_name">
                Name
                <Req />
              </label>
              <input
                id="emergency_contact_name"
                placeholder="Full name"
                required
                aria-required="true"
                value={form.emergency_contact_name}
                onChange={(e) => updateField('emergency_contact_name', e.target.value)}
                onBlur={() => handleBlur('emergency_contact_name')}
              />
              {showError('emergency_contact_name') && (
                <p className="add-member-error">{errors.emergency_contact_name}</p>
              )}
            </div>

            <div className="add-member-field">
              <label htmlFor="emergency_contact_phone">
                Phone
                <Req />
              </label>
              <input
                id="emergency_contact_phone"
                type="tel"
                inputMode="numeric"
                placeholder="Contact phone number"
                required
                aria-required="true"
                value={form.emergency_contact_phone}
                onChange={(e) => updateField('emergency_contact_phone', sanitizeDigits(e.target.value, 10))}
                onBlur={() => handleBlur('emergency_contact_phone')}
              />
              {showError('emergency_contact_phone') && (
                <p className="add-member-error">{errors.emergency_contact_phone}</p>
              )}
            </div>

            <div className="add-member-field add-member-field-span-2">
              <label htmlFor="emergency_contact_relationship">
                Relationship
                <Req />
              </label>
              <input
                id="emergency_contact_relationship"
                placeholder="e.g. Spouse, Parent, Sibling"
                required
                aria-required="true"
                value={form.emergency_contact_relationship}
                onChange={(e) => updateField('emergency_contact_relationship', e.target.value)}
                onBlur={() => handleBlur('emergency_contact_relationship')}
              />
              {showError('emergency_contact_relationship') && (
                <p className="add-member-error">{errors.emergency_contact_relationship}</p>
              )}
            </div>
          </div>
        </fieldset>

        <fieldset className="add-member-section">
          <legend>Photo (optional)</legend>
          {photoPreviewUrl && <img src={photoPreviewUrl} alt="Selected preview" className="add-member-photo-preview" />}
          <div className="add-member-photo-actions">
            {/* Two always-visible buttons: Take Photo opens a live in-page camera
                (CameraCaptureModal, getUserMedia) rather than a <input capture> file
                input — that attribute only opens the native camera app on some mobile
                browsers and is silently ignored on desktop, indistinguishable from
                Upload there. If the camera can't be used (denied/unsupported), Upload
                Photo is right there — never a dead end (REQ-MEM-002). */}
            <button type="button" onClick={() => setIsCameraOpen(true)}>
              <Camera size={16} strokeWidth={2} />
              Take Photo
            </button>
            <button type="button" onClick={() => uploadInputRef.current?.click()}>
              <Upload size={16} strokeWidth={2} />
              Upload Photo
            </button>
          </div>
          <input
            ref={uploadInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => handlePhotoSelected(e.target.files?.[0])}
          />
          {isCameraOpen && (
            <CameraCaptureModal
              onCapture={(file) => {
                handlePhotoSelected(file);
                setIsCameraOpen(false);
              }}
              onClose={() => setIsCameraOpen(false)}
            />
          )}
        </fieldset>

        <div className="add-member-actions">
          <button
            type="button"
            className="add-member-cancel"
            disabled={isSaving}
            onClick={() => navigate('/')}
          >
            <X size={18} strokeWidth={2} />
            Cancel
          </button>
          <button type="submit" className="add-member-submit" disabled={isSaving}>
            {isSaving ? (
              <RefreshCw size={18} strokeWidth={2} className="add-member-spin" />
            ) : (
              <Check size={18} strokeWidth={2} />
            )}
            {isSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
