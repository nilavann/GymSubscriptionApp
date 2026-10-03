import '../test/page-mocks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MemberDetailPage } from './MemberDetailPage';
import { memberService as realMemberService } from '../services/member.service';
import { adminProfile, fakeAuth, setAuth, setServices, staffProfile } from '../test/mocks';
import { currentItem, localDate, member, memberRow, plan } from '../test/fixtures';

let memberRepository: Record<string, ReturnType<typeof vi.fn>>;
let memberService: typeof realMemberService;
let subscriptionRepository: Record<string, ReturnType<typeof vi.fn>>;

function setup(opts: { items?: ReturnType<typeof currentItem>[]; found?: boolean; path?: string; failFirstLoad?: boolean } = {}) {
  memberRepository = {
    getById: vi.fn().mockResolvedValue(opts.found === false ? null : member({ id: 5, created_by: adminProfile.id, handled_by_staff: null })),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  if (opts.failFirstLoad) memberRepository.getById.mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue(member({ id: 5 }));
  memberService = { ...realMemberService, updateMember: vi.fn().mockResolvedValue({ name: 'Arjun Kumar', handled_by_staff: staffProfile.id }) } as never;
  subscriptionRepository = {
    getCurrentItemsForMember: vi.fn().mockResolvedValue(opts.items ?? []),
    getHistoryForMember: vi.fn().mockResolvedValue([]),
    getItemsForSubscriptions: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue(undefined),
  };
  setAuth(fakeAuth(staffProfile));
  setServices({
    memberRepository: memberRepository as never,
    memberService,
    subscriptionRepository: subscriptionRepository as never,
    planRepository: { getAllActive: vi.fn().mockResolvedValue([plan()]) } as never,
    profileRepository: {
      getAllActive: vi.fn().mockResolvedValue([staffProfile, adminProfile]),
      getAllNonDeleted: vi.fn().mockResolvedValue([staffProfile, adminProfile]),
    } as never,
    memberListRepository: { getAll: vi.fn().mockResolvedValue([memberRow({ id: 5 })]) } as never,
  });
  return render(
    <MemoryRouter initialEntries={[opts.path ?? '/members/5']}>
      <Routes>
        <Route path="/members/:id" element={<MemberDetailPage />} />
        <Route path="/members/:id/edit" element={<MemberDetailPage />} />
        <Route path="/" element={<div>MEMBERS LIST PAGE</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Member detail page', () => {
  beforeEach(() => vi.useRealTimers());

  it('shows the member number, who created the record, and "Not set" for handled-by', async () => {
    setup();
    expect(await screen.findByText('Member number')).toBeInTheDocument();
    expect(screen.getAllByText('MUM-2026-0001').length).toBeGreaterThan(0);
    expect(screen.getByText('Created by').nextSibling).toHaveTextContent('Ada Admin');
    expect(screen.getByText('Handled by staff').nextSibling).toHaveTextContent('Not set');
  });

  it('missing member shows a not-found message with a way back', async () => {
    setup({ found: false });
    expect(await screen.findByText('This member could not be found.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to members/i })).toBeInTheDocument();
  });

  it('load failure shows a retry button that refetches', async () => {
    setup({ failFirstLoad: true });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /retry/i }));
    expect(await screen.findByText('Member number')).toBeInTheDocument();
  });

  describe('status badge from the current membership item', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(localDate(2026, 7, 15));
    });
    it.each([
      ['2026-12-31', 'Active'],
      ['2026-07-20', 'Expiring'],
      [null, 'Active'],
    ])('end_date %s -> %s', async (end, label) => {
      setup({ items: [currentItem({ end_date: end })] });
      await screen.findByText('Current Membership');
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    });
    it('no current membership: Expired badge + Add Subscription link', async () => {
      setup({ items: [] });
      expect(await screen.findByText('No active membership')).toBeInTheDocument();
      expect(screen.getAllByRole('link', { name: /add subscription/i })[0]).toHaveAttribute('href', '/members/5/renew');
      expect(screen.getAllByText('Expired').length).toBeGreaterThan(0);
    });
    it('Renew link goes to the renew checkout for this member', async () => {
      setup({ items: [currentItem({ end_date: '2026-12-31' })] });
      expect(await screen.findByRole('link', { name: 'Renew' })).toHaveAttribute('href', '/members/5/renew');
    });
  });

  describe('REQ-MEM-006 editing', () => {
    it('Edit opens the form; member number and created-by stay read-only (no inputs for them)', async () => {
      const user = userEvent.setup();
      setup();
      await user.click(await screen.findByRole('button', { name: /edit/i }));
      expect(document.getElementById('detail-name')).not.toBeNull();
      expect(document.getElementById('detail-member_number')).toBeNull();
      expect(document.getElementById('detail-created_by')).toBeNull();
      expect(document.getElementById('detail-branch_id')).toBeNull();
      expect(screen.getByText('Member number').nextSibling).toHaveTextContent('MUM-2026-0001');
    });

    it('/members/:id/edit deep link opens in edit mode', async () => {
      setup({ path: '/members/5/edit' });
      await waitFor(() => expect(document.getElementById('detail-name')).not.toBeNull());
    });

    it('saving sends the edited fields and returns to read mode', async () => {
      const user = userEvent.setup();
      setup();
      await user.click(await screen.findByRole('button', { name: /edit/i }));
      const name = document.getElementById('detail-name') as HTMLInputElement;
      await user.clear(name);
      await user.type(name, 'Arjun K');
      await user.click(screen.getByRole('button', { name: /save/i }));
      await waitFor(() => expect(memberService.updateMember).toHaveBeenCalled());
      expect((memberService.updateMember as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(5);
      expect((memberService.updateMember as ReturnType<typeof vi.fn>).mock.calls[0][1].name).toBe('Arjun K');
      await waitFor(() => expect(document.getElementById('detail-name')).toBeNull());
    });

    it('invalid edits are blocked client-side with field errors', async () => {
      const user = userEvent.setup();
      setup();
      await user.click(await screen.findByRole('button', { name: /edit/i }));
      const phone = document.getElementById('detail-phone') as HTMLInputElement;
      await user.clear(phone);
      await user.click(screen.getByRole('button', { name: /save/i }));
      expect(memberService.updateMember).not.toHaveBeenCalled();
      expect(await screen.findByText('Phone is required')).toBeInTheDocument();
    });

    it('a duplicate phone on edit is reported as a conflict and the form stays open', async () => {
      const user = userEvent.setup();
      setup();
      (memberService.updateMember as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('duplicate key value violates unique constraint "idx_members_phone_active"'));
      await user.click(await screen.findByRole('button', { name: /edit/i }));
      await user.click(screen.getByRole('button', { name: /save/i }));
      expect(await screen.findByText('This phone number is already used by another member.')).toBeInTheDocument();
      expect(document.getElementById('detail-name')).not.toBeNull();
    });

    it('REQ-MEM-003: handled-by is an editable dropdown of active staff/admin, independent of created-by', async () => {
      const user = userEvent.setup();
      setup();
      await user.click(await screen.findByRole('button', { name: /edit/i }));
      const select = document.getElementById('detail-handled_by_staff') as HTMLSelectElement;
      expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Not set', 'Sam Staff', 'Ada Admin']);
      await user.selectOptions(select, staffProfile.id);
      await user.click(screen.getByRole('button', { name: /save/i }));
      await waitFor(() => expect(memberService.updateMember).toHaveBeenCalled());
      expect((memberService.updateMember as ReturnType<typeof vi.fn>).mock.calls[0][1].handled_by_staff).toBe(staffProfile.id);
    });

    it('Cancel discards edits', async () => {
      const user = userEvent.setup();
      setup();
      await user.click(await screen.findByRole('button', { name: /edit/i }));
      await user.type(document.getElementById('detail-name') as HTMLInputElement, 'zzz');
      await user.click(screen.getByRole('button', { name: /cancel/i }));
      expect(document.getElementById('detail-name')).toBeNull();
      expect(memberService.updateMember).not.toHaveBeenCalled();
    });

    // REQ-MEM-006 AC: "member_number, created_by, and branch_id are displayed read-only". Branch is not shown anywhere.
    it.fails('SPEC GAP REQ-MEM-006: branch is displayed read-only on the member page', async () => {
      setup();
      await screen.findByText('Member number');
      expect(screen.getByText(/^Branch$/i)).toBeInTheDocument();
    });
  });

  describe('REQ-MEM-007 delete', () => {
    it('asks for confirmation first; Cancel does nothing', async () => {
      const user = userEvent.setup();
      setup();
      await user.click(await screen.findByRole('button', { name: /^delete$/i }));
      expect(screen.getByText('Delete member?')).toBeInTheDocument();
      await user.click(within(screen.getByText('Delete member?').parentElement as HTMLElement).getByRole('button', { name: /cancel/i }));
      expect(memberRepository.delete).not.toHaveBeenCalled();
      expect(screen.queryByText('Delete member?')).toBeNull();
    });

    it('confirming soft-deletes through the delete-member function and returns to the list', async () => {
      const user = userEvent.setup();
      setup();
      await user.click(await screen.findByRole('button', { name: /^delete$/i }));
      const dialog = screen.getByText('Delete member?').parentElement as HTMLElement;
      await user.click(within(dialog).getByRole('button', { name: /^delete$/i }));
      await waitFor(() => expect(memberRepository.delete).toHaveBeenCalledWith(5));
      expect(await screen.findByText('MEMBERS LIST PAGE')).toBeInTheDocument();
    });

    it('a member with subscriptions is protected: the server guard message is shown verbatim, member stays', async () => {
      const user = userEvent.setup();
      setup();
      memberRepository.delete.mockRejectedValue(new Error('Cannot delete — used by 3 subscription/add-on record(s)'));
      await user.click(await screen.findByRole('button', { name: /^delete$/i }));
      const dialog = screen.getByText('Delete member?').parentElement as HTMLElement;
      await user.click(within(dialog).getByRole('button', { name: /^delete$/i }));
      expect(await screen.findByText('Cannot delete — used by 3 subscription/add-on record(s)')).toBeInTheDocument();
      expect(screen.queryByText('MEMBERS LIST PAGE')).toBeNull();
    });

    it('network failure on delete shows a connectivity message', async () => {
      const user = userEvent.setup();
      setup();
      memberRepository.delete.mockRejectedValue(new Error('Failed to fetch'));
      await user.click(await screen.findByRole('button', { name: /^delete$/i }));
      const dialog = screen.getByText('Delete member?').parentElement as HTMLElement;
      await user.click(within(dialog).getByRole('button', { name: /^delete$/i }));
      expect(await screen.findByText(/check your connection/i)).toBeInTheDocument();
    });
  });
});
