import '../test/page-mocks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { MemberNumberingPage } from './MemberNumberingPage';
import { memberNumberingService as realService } from '../services/member-numbering.service';
import { adminProfile, fakeAuth, setAuth, setServices } from '../test/mocks';

const cfg = { start_sequence: 1, increment: 1, padding_width: 4 };
const seqs = [{ branch_id: 1, branch_name: 'Main Branch', branch_code: 'MUM', last_sequence: 41, next_sequence: 42, preview: 'MUM-2026-0042' }];
let repo: Record<string, ReturnType<typeof vi.fn>>;
let svc: typeof realService;
const el = (id: string) => document.getElementById(id) as HTMLInputElement;

function renderPage() {
  repo = {
    getConfig: vi.fn().mockResolvedValue(cfg),
    getSequences: vi.fn().mockResolvedValue(seqs),
    updateSequence: vi.fn().mockResolvedValue({ success: true, next_sequence: 100, requested: 100, adjusted: false }),
  };
  svc = { ...realService, updateConfig: vi.fn().mockResolvedValue(undefined) } as never;
  setAuth(fakeAuth(adminProfile));
  setServices({ memberNumberingRepository: repo as never, memberNumberingService: svc });
  return render(<MemoryRouter><MemberNumberingPage /></MemoryRouter>);
}

describe('Member numbering settings (REQ-MEM-005 admin)', () => {
  beforeEach(() => vi.useRealTimers());

  it('shows each branch counter with the number the next member will get', async () => {
    renderPage();
    expect((await screen.findAllByText(/MUM-\d{4}-0042/)).length).toBeGreaterThan(0);
  });
  it('global settings are prefilled', async () => {
    renderPage();
    await waitFor(() => expect(el('config-width')).toHaveValue('4'));
    expect(el('config-start')).toHaveValue('1');
  });
  it('invalid settings are blocked client-side', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(el('config-width')).toHaveValue('4'));
    await user.clear(el('config-width'));
    await user.type(el('config-width'), '99');
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(svc.updateConfig).not.toHaveBeenCalled();
    expect(await screen.findByText('Enter a whole number from 1 to 10')).toBeInTheDocument();
  });
  it('valid settings are saved', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(el('config-width')).toHaveValue('4'));
    await user.clear(el('config-width'));
    await user.type(el('config-width'), '6');
    await user.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(svc.updateConfig).toHaveBeenCalledWith({ start_sequence: '1', increment: '1', padding_width: '6' }));
  });
  it('a branch counter can be edited; invalid input is rejected without a request', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click((await screen.findAllByRole('button', { name: /edit/i }))[0]);
    const input = document.querySelector('.member-numbering-edit-row input') as HTMLInputElement;
    await user.clear(input);
    await user.type(input, '0');
    await user.click(document.querySelector('.member-numbering-icon-button-primary') as HTMLElement);
    expect(repo.updateSequence).not.toHaveBeenCalled();
    expect((await screen.findAllByText('Enter a whole number, at least 1')).length).toBeGreaterThan(0);
  });
});
