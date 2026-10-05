import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddMemberPage } from './AddMemberPage';
import { memberService as realMemberService } from '../services/member.service';
import { todayDate } from '../lib/datetime';
import { fakeServices } from '../test/fakes';
import { renderRoutes } from '../test/render';
import { buildBranch, buildMember, buildProfile } from '../test/builders';

const BRANCHES = [buildBranch({ id: 1, name: 'Mumbai Central', code: 'MUM' }), buildBranch({ id: 2, name: 'Pune Camp', code: 'PUN' })];
const ME = buildProfile({ id: 'me', full_name: 'Priya Sharma' });
const STAFF = [ME, buildProfile({ id: 'ravi', full_name: 'Ravi Kumar' })];

function renderAdd(
  options: {
    getBranches?: ReturnType<typeof vi.fn>;
    getProfiles?: ReturnType<typeof vi.fn>;
    create?: ReturnType<typeof vi.fn>;
  } = {}
) {
  const {
    getBranches = vi.fn().mockResolvedValue(BRANCHES),
    getProfiles = vi.fn().mockResolvedValue(STAFF),
    create = vi.fn().mockResolvedValue({ member: buildMember({ id: 77 }), photoError: null }),
  } = options;
  const utils = renderRoutes(
    [
      { path: '/members/new', element: <AddMemberPage /> },
      { path: '/', element: <p>Members screen</p> },
      { path: '/members/:id', element: <p>Member detail screen</p> },
    ],
    {
      route: '/members/new',
      auth: { currentProfile: ME },
      services: fakeServices({
        branchRepository: { getAllActive: getBranches },
        profileRepository: { getAllActive: getProfiles },
        memberService: { ...realMemberService, create },
      }),
    }
  );
  return { ...utils, getBranches, getProfiles, create };
}

const ready = () => screen.findByRole('heading', { name: 'Add Member' });
const field = (id: string) => document.getElementById(id) as HTMLInputElement;
const chips = () => within(screen.getByRole('group', { name: /Gender/ }));

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(field('name'), 'Neha Joshi');
  await user.type(field('phone'), '9876543210');
  fireEvent.change(field('date_of_birth'), { target: { value: '1996-03-14' } });
  await user.selectOptions(field('branch_id'), '1');
  await user.click(chips().getByRole('button', { name: 'Female' }));
  await user.type(field('weight_kg'), '58.5');
  await user.type(field('height_cm'), '162');
  await user.type(field('emergency_contact_name'), 'Meera Joshi');
  await user.type(field('emergency_contact_phone'), '9123456780');
  await user.type(field('emergency_contact_relationship'), 'Mother');
}

afterEach(() => {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
});

describe('AddMemberPage — loading and the back control', () => {
  it('shows a skeleton while the branches load', () => {
    renderAdd({ getBranches: vi.fn().mockReturnValue(new Promise(() => undefined)) });
    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
  });

  it('a network failure offers Retry and recovers', async () => {
    const getBranches = vi.fn().mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue(BRANCHES);
    const { user } = renderAdd({ getBranches });
    expect(await screen.findByText("Couldn't load this screen — check your connection and try again.")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await ready()).toBeInTheDocument();
  });

  it('a generic failure never shows the raw error', async () => {
    renderAdd({ getBranches: vi.fn().mockRejectedValue(new Error('PGRST raw')) });
    expect(await screen.findByText('Something went wrong loading this screen. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText(/PGRST/)).not.toBeInTheDocument();
  });

  it('has a back link to Members — this route hides the tab bar, so it is the way out on a phone', async () => {
    renderAdd();
    await ready();
    expect(screen.getByRole('link', { name: 'Members' })).toHaveAttribute('href', '/');
  });
});

describe('AddMemberPage — the form', () => {
  it('has the seven handoff sections, in order', async () => {
    renderAdd();
    await ready();
    const legends = Array.from(document.querySelectorAll('legend')).map((l) => l.textContent);
    expect(legends).toEqual(['Identity', 'Body metrics', 'Medical', 'Emergency contact', 'Optional details', 'Staff record', 'Photo']);
  });

  it('defaults joining date to today and "handled by" to the signed-in staff member', async () => {
    renderAdd();
    await ready();
    expect(field('date_of_joining')).toHaveValue(todayDate());
    expect(field('handled_by_staff')).toHaveValue('me');
    const staffOptions = within(field('handled_by_staff')).getAllByRole('option').map((o) => o.textContent);
    expect(staffOptions).toEqual(['Not set', 'Priya Sharma', 'Ravi Kumar']);
  });

  it('lists the branches with their codes', async () => {
    renderAdd();
    await ready();
    expect(within(field('branch_id')).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Select a branch…',
      'Mumbai Central (MUM)',
      'Pune Camp (PUN)',
    ]);
  });

  it('offers gender as three chips, and the first selection does not flash a "Select a gender" error', async () => {
    const { user } = renderAdd();
    await ready();
    expect(chips().getAllByRole('button').map((b) => b.textContent)).toEqual(['Male', 'Female', 'Other']);

    await user.click(chips().getByRole('button', { name: 'Other' }));
    expect(chips().getByRole('button', { name: 'Other' })).toHaveClass('add-member-chip-selected');
    expect(screen.queryByText('Select a gender')).not.toBeInTheDocument();
  });

  it.each([
    ['phone', 'phone', '98a76-54 3210987', '9876543210'],
    ['emergency phone', 'emergency_contact_phone', '91x23', '9123'],
    ['pincode', 'pincode', '40a0001', '400001'],
    ['aadhaar', 'aadhaar_number', '1234 5678 9012 99', '123456789012'],
    ['weight (decimal mask)', 'weight_kg', '72.567', '72.56'],
  ])('masks %s as it is typed', async (_label, id, typed, expected) => {
    const { user } = renderAdd();
    await ready();
    await user.type(field(id), typed);
    expect(field(id)).toHaveValue(expected);
  });

  it('numeric fields use the numeric/decimal keyboard on a phone', async () => {
    renderAdd();
    await ready();
    expect(field('phone')).toHaveAttribute('inputmode', 'numeric');
    expect(field('pincode')).toHaveAttribute('inputmode', 'numeric');
    expect(field('weight_kg')).toHaveAttribute('inputmode', 'decimal');
    expect(field('height_cm')).toHaveAttribute('inputmode', 'decimal');
  });

  it('marks required fields for assistive tech as well as visually', async () => {
    renderAdd();
    await ready();
    expect(field('name')).toBeRequired();
    expect(field('phone')).toBeRequired();
    expect(field('email')).not.toBeRequired();
  });

  it('"Under doctor’s care" reveals a details box that becomes required', async () => {
    const { user } = renderAdd();
    await ready();
    expect(field('doctor_care_details')).toBeNull();
    await user.click(screen.getByRole('switch'));
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    expect(field('doctor_care_details')).toBeInTheDocument();
  });

  it('the doctor’s-care toggle works from the keyboard (Enter and Space)', async () => {
    const { user } = renderAdd();
    await ready();
    screen.getByRole('switch').focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    await user.keyboard(' ');
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });
});

describe('AddMemberPage — saving', () => {
  it('shows every missing required field on submit, scrolls to the first, and saves nothing', async () => {
    const { user, create } = renderAdd();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Create member' }));

    for (const message of ['Name is required', 'Phone is required', 'Date of birth is required', 'Select a gender', 'Select a branch']) {
      expect(screen.getByText(message)).toBeInTheDocument();
    }
    expect(create).not.toHaveBeenCalled();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('creates the member from a complete form and opens their page (replacing this entry in history)', async () => {
    const { user, create, router } = renderAdd();
    await ready();
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Create member' }));

    expect(create).toHaveBeenCalledTimes(1);
    const [draft, photo] = create.mock.calls[0];
    expect(draft).toMatchObject({
      name: 'Neha Joshi',
      phone: '9876543210',
      gender: 'Female',
      branch_id: 1,
      weight_kg: '58.5',
      height_cm: '162',
      handled_by_staff: 'me',
    });
    expect(photo).toBeNull();
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/members/77'));
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('still opens the member when only the PHOTO failed to upload (REQ-MEM-004)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const create = vi.fn().mockResolvedValue({ member: buildMember({ id: 5 }), photoError: 'photo failed' });
    const { user, router } = renderAdd({ create });
    await ready();
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Create member' }));

    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/members/5'));
    expect(warn).toHaveBeenCalledWith('photo failed');
  });

  it('locks the form and says "Saving…" while the request is in flight', async () => {
    const { user } = renderAdd({ create: vi.fn().mockReturnValue(new Promise(() => undefined)) });
    await ready();
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Create member' }));

    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it.each([
    ['a duplicate phone number', new Error('duplicate key … phone'), 'This phone number is already used by another member.'],
    ['being offline', new Error('Failed to fetch'), "Couldn't save this member — check your connection and try again."],
    ['anything else', new Error('boom'), 'Something went wrong saving this member. Please try again.'],
  ])('shows a specific message for %s, keeps every input and re-enables Save', async (_label, error, message) => {
    const { user } = renderAdd({ create: vi.fn().mockRejectedValue(error) });
    await ready();
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Create member' }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(field('name')).toHaveValue('Neha Joshi');
    expect(screen.getByRole('button', { name: 'Create member' })).toBeEnabled();
  });

  it('Cancel returns to the Members list without saving', async () => {
    const { user, create, router } = renderAdd();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(router.state.location.pathname).toBe('/');
    expect(create).not.toHaveBeenCalled();
  });
});

describe('AddMemberPage — photo', () => {
  it('offers both Take Photo and Upload Photo', async () => {
    renderAdd();
    await ready();
    expect(screen.getByRole('button', { name: /Take Photo/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Upload Photo/ })).toBeInTheDocument();
  });

  it('an uploaded photo is previewed and sent along with the member', async () => {
    const { user, create } = renderAdd();
    await ready();
    const file = new File(['img'], 'me.jpg', { type: 'image/jpeg' });
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, file);

    expect(screen.getByRole('img', { name: 'Selected preview' })).toHaveAttribute('src', 'blob:test-preview');
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Create member' }));
    expect(create.mock.calls[0][1]).toBe(file);
  });

  it('Take Photo opens the camera dialog, and cancelling it closes it', async () => {
    const { user } = renderAdd();
    await ready();
    await user.click(screen.getByRole('button', { name: /Take Photo/ }));
    expect(screen.getByRole('dialog', { name: 'Take a photo' })).toBeInTheDocument();
    // Two buttons are named Cancel (the page's and the camera dialog's) — scope to the dialog.
    await user.click(within(screen.getByRole('dialog', { name: 'Take a photo' })).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Take a photo' })).not.toBeInTheDocument();
  });
});
