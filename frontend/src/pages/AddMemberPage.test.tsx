import '../test/page-mocks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AddMemberPage } from './AddMemberPage';
import { memberService as realMemberService } from '../services/member.service';
import { adminProfile, fakeAuth, setAuth, setServices, staffProfile } from '../test/mocks';
import { localDate, member } from '../test/fixtures';

const branches = [
  { id: 1, name: 'Main Branch', code: 'MUM' },
  { id: 2, name: 'Delhi', code: 'DEL' },
];
const profiles = [staffProfile, adminProfile];

let create: ReturnType<typeof vi.fn>;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/members/new']}>
      <Routes>
        <Route path="/members/new" element={<AddMemberPage />} />
        <Route path="/members/:id" element={<div>MEMBER DETAIL PAGE</div>} />
      </Routes>
    </MemoryRouter>
  );
}

const el = (id: string) => document.getElementById(id) as HTMLInputElement;
const waitForForm = () => waitFor(() => expect(document.getElementById('name')).not.toBeNull());
const submit = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: /create member/i }));

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await waitForForm();
  await user.type(el('name'), 'Priya Sharma');
  await user.type(el('phone'), '9876543210');
  await user.type(el('date_of_birth'), '1995-04-02');
  await user.selectOptions(el('branch_id'), '1');
  await user.click(screen.getByRole('button', { name: 'Female' }));
  await user.type(el('weight_kg'), '60');
  await user.type(el('height_cm'), '165');
  await user.type(el('emergency_contact_name'), 'Ravi');
  await user.type(el('emergency_contact_phone'), '9123456780');
  await user.type(el('emergency_contact_relationship'), 'Brother');
}

describe('Add Member page (REQ-MEM-001/002/003)', () => {
  beforeEach(() => {
    vi.useRealTimers();
    create = vi.fn().mockResolvedValue({ member: member({ id: 77 }), photoError: null });
    setAuth(fakeAuth(staffProfile));
    setServices({
      memberService: { ...realMemberService, create } as never,
      branchRepository: { getAllActive: vi.fn().mockResolvedValue(branches) } as never,
      profileRepository: { getAllActive: vi.fn().mockResolvedValue(profiles) } as never,
    });
  });

  it('REQ-MEM-001: date_of_joining is pre-filled with today (browser local date)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(localDate(2026, 7, 15));
    renderPage();
    await waitForForm();
    expect(el('date_of_joining')).toHaveValue('2026-07-15');
  });

  it('REQ-MEM-003: "Handled by staff" defaults to the logged-in user and lists active staff/admin', async () => {
    renderPage();
    await waitForForm();
    const select = el('handled_by_staff');
    expect(select).toHaveValue(staffProfile.id);
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(expect.arrayContaining(['Sam Staff', 'Ada Admin']));
  });

  it('REQ-MEM-003: handled_by can be changed before submit and is what gets saved', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForForm();
    await user.selectOptions(el('handled_by_staff'), adminProfile.id);
    await fillValidForm(user);
    await submit(user);
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0].handled_by_staff).toBe(adminProfile.id);
  });

  it('REQ-MEM-001: submitting an empty form is blocked and names the missing fields', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForForm();
    await submit(user);
    expect(create).not.toHaveBeenCalled();
    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Phone is required')).toBeInTheDocument();
    expect(screen.getByText('Date of birth is required')).toBeInTheDocument();
    expect(screen.getByText('Select a branch')).toBeInTheDocument();
    expect(screen.getByText('Select a gender')).toBeInTheDocument();
    expect(screen.getByText('Emergency contact name is required')).toBeInTheDocument();
  });

  it("REQ-MEM-001: doctor's-care explanation is hidden until Yes, then mandatory", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForForm();
    expect(document.getElementById('doctor_care_details')).toBeNull();
    await user.click(screen.getByRole('switch'));
    expect(document.getElementById('doctor_care_details')).not.toBeNull();
    await fillValidForm(user);
    await submit(user);
    expect(create).not.toHaveBeenCalled();
    expect(await screen.findByText(/Details are required when under doctor's care/)).toBeInTheDocument();
    await user.type(el('doctor_care_details'), 'Asthma');
    await submit(user);
    await waitFor(() => expect(create).toHaveBeenCalled());
  });

  it('REQ-MEM-001: a valid form creates the member and navigates to it', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForForm();
    await fillValidForm(user);
    await submit(user);
    expect(await screen.findByText('MEMBER DETAIL PAGE')).toBeInTheDocument();
    expect(create.mock.calls[0][0]).toMatchObject({ name: 'Priya Sharma', phone: '9876543210', branch_id: 1, gender: 'Female' });
  });

  it('REQ-MEM-001: the edited date_of_joining is saved instead of today', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForForm();
    await fillValidForm(user);
    const doj = el('date_of_joining');
    await user.clear(doj);
    await user.type(doj, '2026-01-10');
    await submit(user);
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0].date_of_joining).toBe('2026-01-10');
  });

  it('REQ-MEM-001: a duplicate phone is reported as a validation-style error naming the conflict', async () => {
    create.mockRejectedValue(new Error('duplicate key value violates unique constraint "idx_members_phone_active"'));
    const user = userEvent.setup();
    renderPage();
    await waitForForm();
    await fillValidForm(user);
    await submit(user);
    expect(await screen.findByText('This phone number is already used by another member.')).toBeInTheDocument();
    expect(screen.queryByText('MEMBER DETAIL PAGE')).toBeNull();
  });

  it('a network failure shows a connectivity message and keeps the form', async () => {
    create.mockRejectedValue(new Error('Failed to fetch'));
    const user = userEvent.setup();
    renderPage();
    await waitForForm();
    await fillValidForm(user);
    await submit(user);
    expect(await screen.findByText(/check your connection/i)).toBeInTheDocument();
    expect(el('name')).toHaveValue('Priya Sharma');
  });

  it('phone input only accepts digits, max 10', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForForm();
    const phone = el('phone');
    await user.type(phone, '98a76-54321099');
    expect(phone).toHaveValue('9876543210');
  });

  it('form data load failure shows retry', async () => {
    setServices({
      memberService: { ...realMemberService, create } as never,
      branchRepository: { getAllActive: vi.fn().mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue(branches) } as never,
      profileRepository: { getAllActive: vi.fn().mockResolvedValue(profiles) } as never,
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /retry/i }));
    await waitForForm();
  });

  it('REQ-MEM-002: file upload and camera are both offered as photo sources', async () => {
    renderPage();
    await waitForForm();
    expect(screen.getByRole('button', { name: /take photo/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upload photo/i })).toBeInTheDocument();
  });

  // REQ-MEM-004 AC: "...staff sees an error message stating the photo couldn't be uploaded, with the option to
  // retry the photo upload afterward". AddMemberPage only console.warn()s the photoError and navigates away.
  it.fails('SPEC GAP REQ-MEM-004: a photo upload failure at registration is shown to staff (not just logged)', async () => {
    create.mockResolvedValue({ member: member({ id: 77 }), photoError: "The member was saved, but the photo couldn't be uploaded." });
    const user = userEvent.setup();
    renderPage();
    await waitForForm();
    await fillValidForm(user);
    await submit(user);
    expect(await screen.findByText(/photo couldn't be uploaded/i, undefined, { timeout: 500 })).toBeInTheDocument();
  });
});
