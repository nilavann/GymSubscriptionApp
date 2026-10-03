import { beforeEach, describe, expect, it, vi } from 'vitest';
import { member } from '../test/fixtures';

const repo = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
const storage = vi.hoisted(() => ({ upload: vi.fn(), remove: vi.fn() }));
const compress = vi.hoisted(() => vi.fn());
vi.mock('../repositories/member.repository', () => ({ memberRepository: repo }));
vi.mock('../lib/photo-compression', () => ({ compressImage: compress }));
vi.mock('../lib/supabase-client', () => ({ supabase: { storage: { from: () => storage } } }));

import { memberService, validateMemberEdit, validateNewMember, isMemberFormValid, editDraftFromMember, type NewMemberDraft } from './member.service';

function validDraft(overrides: Partial<NewMemberDraft> = {}): NewMemberDraft {
  return {
    name: 'Priya Sharma',
    phone: '9876543210',
    date_of_birth: '1995-04-02',
    date_of_joining: '2026-07-15',
    gender: 'Female',
    weight_kg: '60',
    height_cm: '165.5',
    under_doctor_care: false,
    doctor_care_details: '',
    emergency_contact_name: 'Ravi Sharma',
    emergency_contact_phone: '9123456780',
    emergency_contact_relationship: 'Brother',
    email: '',
    residential_address: '',
    aadhaar_number: '',
    occupation: '',
    handled_by_staff: '',
    branch_id: 1,
    ...overrides,
  };
}

describe('REQ-MEM-001 validation', () => {
  it('a fully filled form is valid', () => {
    expect(isMemberFormValid(validateNewMember(validDraft()))).toBe(true);
  });

  it('every required field missing is reported by name (one error per field)', () => {
    const errors = validateNewMember({
      ...validDraft(),
      name: '', phone: '', date_of_birth: '', date_of_joining: '', gender: '', weight_kg: '', height_cm: '',
      emergency_contact_name: '', emergency_contact_phone: '', emergency_contact_relationship: '', branch_id: '',
    });
    expect(Object.keys(errors).sort()).toEqual([
      'branch_id', 'date_of_birth', 'date_of_joining', 'emergency_contact_name', 'emergency_contact_phone',
      'emergency_contact_relationship', 'gender', 'height_cm', 'name', 'phone', 'weight_kg',
    ]);
  });

  it('optional fields (email, address, aadhaar, occupation, photo, handled_by) are NOT required', () => {
    const errors = validateNewMember(validDraft({ email: '', residential_address: '', aadhaar_number: '', occupation: '' }));
    expect(errors).toEqual({});
  });

  describe('name', () => {
    it.each([['', 'required'], ['   ', 'required'], ['A', '2-80'], ['x'.repeat(81), '2-80']])('rejects %j', (name, hint) => {
      expect(validateNewMember(validDraft({ name })).name).toContain(hint === 'required' ? 'required' : '2-80');
    });
    it.each(['Al', 'x'.repeat(80), '  Jo  '])('accepts %j', (name) => {
      expect(validateNewMember(validDraft({ name })).name).toBeUndefined();
    });
  });

  describe('phone', () => {
    it.each(['123', '98765432101', 'abcdefghij', '98765-4321'])('rejects %j', (phone) => {
      expect(validateNewMember(validDraft({ phone })).phone).toBeDefined();
    });
    it('accepts exactly 10 digits, and ignores embedded spaces', () => {
      expect(validateNewMember(validDraft({ phone: '9876543210' })).phone).toBeUndefined();
      expect(validateNewMember(validDraft({ phone: '98765 43210' })).phone).toBeUndefined();
    });
    it('emergency contact phone follows the same rule', () => {
      expect(validateNewMember(validDraft({ emergency_contact_phone: '12345' })).emergency_contact_phone).toBeDefined();
    });
  });

  describe('weight / height bounds mirror the DB CHECK constraints', () => {
    it.each([['0', true], ['0.9', true], ['1', false], ['500', false], ['500.01', true], ['abc', true], ['', true]])('weight %j error=%s', (v, err) => {
      expect(validateNewMember(validDraft({ weight_kg: v })).weight_kg !== undefined).toBe(err);
    });
    it.each([['0', true], ['1', false], ['300', false], ['300.1', true], ['-5', true]])('height %j error=%s', (v, err) => {
      expect(validateNewMember(validDraft({ height_cm: v })).height_cm !== undefined).toBe(err);
    });
  });

  describe("doctor's care (conditional required)", () => {
    it('Yes + blank explanation -> blocked', () => {
      expect(validateNewMember(validDraft({ under_doctor_care: true, doctor_care_details: '' })).doctor_care_details).toBeDefined();
    });
    it('Yes + whitespace-only explanation -> blocked', () => {
      expect(validateNewMember(validDraft({ under_doctor_care: true, doctor_care_details: '   \n ' })).doctor_care_details).toBeDefined();
    });
    it('Yes + explanation -> ok', () => {
      expect(validateNewMember(validDraft({ under_doctor_care: true, doctor_care_details: 'Asthma' })).doctor_care_details).toBeUndefined();
    });
    it('No + blank explanation -> ok', () => {
      expect(validateNewMember(validDraft({ under_doctor_care: false, doctor_care_details: '' })).doctor_care_details).toBeUndefined();
    });
  });

  it('email: optional, but must look like an email when given', () => {
    expect(validateNewMember(validDraft({ email: 'nope' })).email).toBeDefined();
    expect(validateNewMember(validDraft({ email: 'a@b' })).email).toBeDefined();
    expect(validateNewMember(validDraft({ email: 'a@b.co' })).email).toBeUndefined();
    expect(validateNewMember(validDraft({ email: '   ' })).email).toBeUndefined();
  });

  it('REQ-MEM-006: the edit form has no branch field to validate (immutable after creation)', () => {
    const { branch_id: _omit, ...edit } = validDraft();
    expect(validateMemberEdit(edit)).toEqual({});
  });
});

describe('create / update payloads', () => {
  beforeEach(() => {
    repo.create.mockReset();
    repo.update.mockReset();
    storage.upload.mockReset();
    storage.remove.mockReset();
    compress.mockReset();
    repo.create.mockResolvedValue(member({ id: 42 }));
  });

  it('create sends trimmed/normalised values and nulls for blank optionals', async () => {
    await memberService.create(validDraft({ name: '  Priya Sharma ', phone: '98765 43210', email: ' ', occupation: 'Dev ' }), null);
    const payload = repo.create.mock.calls[0][0];
    expect(payload).toMatchObject({
      name: 'Priya Sharma', phone: '9876543210', email: null, residential_address: null, aadhaar_number: null,
      occupation: 'Dev', weight_kg: 60, height_cm: 165.5, doctor_care_details: null, handled_by_staff: null, branch_id: 1,
    });
  });

  it('REQ-MEM-006/005: create never sends member_number or created_by', async () => {
    await memberService.create(validDraft(), null);
    const payload = repo.create.mock.calls[0][0];
    expect(payload).not.toHaveProperty('member_number');
    expect(payload).not.toHaveProperty('created_by');
  });

  it('REQ-MEM-003: handled_by_staff is passed through when chosen', async () => {
    await memberService.create(validDraft({ handled_by_staff: 'staff-uuid' }), null);
    expect(repo.create.mock.calls[0][0].handled_by_staff).toBe('staff-uuid');
  });

  it('doctor details are only sent when under_doctor_care is true', async () => {
    await memberService.create(validDraft({ under_doctor_care: false, doctor_care_details: 'stale text' }), null);
    expect(repo.create.mock.calls[0][0].doctor_care_details).toBeNull();
    await memberService.create(validDraft({ under_doctor_care: true, doctor_care_details: ' Asthma ' }), null);
    expect(repo.create.mock.calls[1][0].doctor_care_details).toBe('Asthma');
  });

  it('REQ-MEM-006: update payload never contains branch_id, member_number or created_by', async () => {
    const { branch_id: _b, ...edit } = validDraft();
    const payload = await memberService.updateMember(5, edit);
    expect(repo.update).toHaveBeenCalledWith(5, payload);
    for (const k of ['branch_id', 'member_number', 'created_by']) expect(payload).not.toHaveProperty(k);
  });

  it('REQ-MEM-003: handled_by_staff can be changed independently on update, and cleared with null', async () => {
    const { branch_id: _b, ...edit } = validDraft({ handled_by_staff: 'other-staff' });
    expect((await memberService.updateMember(5, edit)).handled_by_staff).toBe('other-staff');
    expect((await memberService.updateMember(5, { ...edit, handled_by_staff: '' })).handled_by_staff).toBeNull();
  });

  it('editDraftFromMember round-trips a Member into form strings', () => {
    const draft = editDraftFromMember(member({ weight_kg: 72.5, email: null, doctor_care_details: null, handled_by_staff: null }));
    expect(draft).toMatchObject({ weight_kg: '72.5', email: '', doctor_care_details: '', handled_by_staff: '' });
    expect(draft).not.toHaveProperty('branch_id');
  });
});

describe('REQ-MEM-004 photo handling', () => {
  const file = new File(['x'], 'me.png', { type: 'image/png' });
  beforeEach(() => {
    repo.create.mockReset().mockResolvedValue(member({ id: 42 }));
    repo.update.mockReset().mockResolvedValue(undefined);
    storage.upload.mockReset().mockResolvedValue({ error: null });
    storage.remove.mockReset().mockResolvedValue({});
    compress.mockReset().mockResolvedValue(new Blob(['small']));
  });

  it('no photo: member created, no upload attempted', async () => {
    const result = await memberService.create(validDraft(), null);
    expect(result.photoError).toBeNull();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('uploads BOTH the original and the compressed thumbnail, then stores both paths', async () => {
    const result = await memberService.create(validDraft(), file);
    expect(result.photoError).toBeNull();
    expect(storage.upload).toHaveBeenCalledTimes(2);
    const [[originalPath, originalBody], [thumbPath, thumbBody]] = storage.upload.mock.calls;
    expect(originalPath).toMatch(/^42\/original-\d+\.jpg$/);
    expect(thumbPath).toMatch(/^42\/thumbnail-\d+\.jpg$/);
    expect(originalBody).toBe(file); // original untouched
    expect(thumbBody).toBeInstanceOf(Blob);
    expect(repo.update).toHaveBeenCalledWith(42, { photo_url: originalPath, photo_thumbnail_url: thumbPath });
  });

  it('compression runs before the upload request', async () => {
    const order: string[] = [];
    compress.mockImplementation(async () => { order.push('compress'); return new Blob(['s']); });
    storage.upload.mockImplementation(async () => { order.push('upload'); return { error: null }; });
    await memberService.create(validDraft(), file);
    expect(order[0]).toBe('compress');
  });

  it('compression failure: member is still created, user gets a photo error message', async () => {
    compress.mockRejectedValue(new Error('canvas-not-supported'));
    const result = await memberService.create(validDraft(), file);
    expect(result.member.id).toBe(42);
    expect(result.photoError).toMatch(/photo couldn't be uploaded/i);
    expect(result.photoError).toMatch(/retry/i);
  });

  it('upload failure: member kept, error surfaced', async () => {
    storage.upload.mockResolvedValue({ error: new Error('network') });
    const result = await memberService.create(validDraft(), file);
    expect(result.photoError).toBeTruthy();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('half-failed upload cleans up the side that landed (no orphaned blob)', async () => {
    storage.upload.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: new Error('boom') });
    await memberService.create(validDraft(), file);
    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(storage.remove.mock.calls[0][0]).toHaveLength(1);
    expect(storage.remove.mock.calls[0][0][0]).toMatch(/original-/);
  });

  it('failure saving the paths removes both uploaded blobs', async () => {
    repo.update.mockRejectedValue(new Error('db down'));
    const result = await memberService.create(validDraft(), file);
    expect(result.photoError).toBeTruthy();
    expect(storage.remove).toHaveBeenCalledWith(expect.arrayContaining([expect.stringMatching(/original-/), expect.stringMatching(/thumbnail-/)]));
  });

  it('retry path: uploadPhoto can be called again for an existing member', async () => {
    await expect(memberService.uploadPhoto(42, file)).resolves.toBeUndefined();
    expect(repo.update).toHaveBeenCalledTimes(1);
  });

  it('a failed member insert propagates (no photo work attempted)', async () => {
    repo.create.mockRejectedValue(new Error('duplicate key value violates unique constraint "idx_members_phone_active"'));
    await expect(memberService.create(validDraft(), file)).rejects.toThrow(/idx_members_phone_active/);
    expect(storage.upload).not.toHaveBeenCalled();
  });
});
