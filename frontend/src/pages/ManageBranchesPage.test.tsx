import '../test/page-mocks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ManageBranchesPage } from './ManageBranchesPage';
import { branchService as realBranchService } from '../services/branch.service';
import { adminProfile, fakeAuth, setAuth, setServices } from '../test/mocks';

const branches = [{ id: 1, name: 'Main Branch', code: 'MUM' }, { id: 2, name: 'Delhi', code: 'DEL' }];
let branchRepository: Record<string, ReturnType<typeof vi.fn>>;
let branchService: typeof realBranchService;

function renderPage() {
  branchRepository = { getAllActive: vi.fn().mockResolvedValue(branches), delete: vi.fn().mockResolvedValue(undefined) };
  branchService = { ...realBranchService, create: vi.fn().mockResolvedValue(branches[0]), update: vi.fn().mockResolvedValue(undefined) } as never;
  setAuth(fakeAuth(adminProfile));
  setServices({ branchRepository: branchRepository as never, branchService });
  return render(<MemoryRouter><ManageBranchesPage /></MemoryRouter>);
}
const el = (id: string) => document.getElementById(id) as HTMLInputElement;
const rows = () => Array.from(document.querySelectorAll('table tbody tr')).map((r) => r.textContent ?? '');

describe('Branch management (REQ-ADMIN-003)', () => {
  beforeEach(() => vi.useRealTimers());

  it('lists every branch with name and code', async () => {
    renderPage();
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(rows().join('|')).toContain('MUM');
    expect(rows().join('|')).toContain('Delhi');
  });

  it('blank name and code block submission with field errors (both mandatory)', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /add branch/i }));
    await user.click(screen.getByRole('button', { name: /^(save|create)/i }));
    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Code is required')).toBeInTheDocument();
    expect(branchService.create).not.toHaveBeenCalled();
  });

  it('whitespace-only values are treated as blank', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /add branch/i }));
    await user.type(el('branch-name'), '   ');
    await user.type(el('branch-code'), '  ');
    await user.click(screen.getByRole('button', { name: /^(save|create)/i }));
    expect(await screen.findByText('Name is required')).toBeInTheDocument();
  });

  it('a valid branch is created', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /add branch/i }));
    await user.type(el('branch-name'), 'Pune');
    await user.type(el('branch-code'), 'PUN');
    await user.click(screen.getByRole('button', { name: /^(save|create)/i }));
    await waitFor(() => expect(branchService.create).toHaveBeenCalledWith({ name: 'Pune', code: 'PUN' }));
  });

  it('a duplicate code is reported as already used by another branch', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /add branch/i }));
    (branchService.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('duplicate key value violates unique constraint "idx_branches_code_active"'));
    await user.type(el('branch-name'), 'Dup');
    await user.type(el('branch-code'), 'MUM');
    await user.click(screen.getByRole('button', { name: /^(save|create)/i }));
    expect(await screen.findByText('This code is already used by another branch.')).toBeInTheDocument();
  });

  it('edit opens prefilled and saves through update', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click((await screen.findAllByRole('button', { name: 'Edit Delhi' }))[0]);
    expect(el('branch-name')).toHaveValue('Delhi');
    expect(el('branch-code')).toHaveValue('DEL');
    await user.clear(el('branch-name'));
    await user.type(el('branch-name'), 'New Delhi');
    await user.click(screen.getByRole('button', { name: /^(save|update)/i }));
    await waitFor(() => expect(branchService.update).toHaveBeenCalledWith(2, { name: 'New Delhi', code: 'DEL' }));
  });

  it('a branch with members cannot be deleted: "used by X member(s)" shown', async () => {
    const user = userEvent.setup();
    renderPage();
    branchRepository.delete.mockRejectedValue(new Error('Cannot delete — used by 12 member(s)'));
    await user.click((await screen.findAllByRole('button', { name: 'Delete Main Branch' }))[0]);
    const dialog = screen.getByText('Delete branch?').parentElement as HTMLElement;
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }));
    expect(await screen.findByText('Cannot delete — used by 12 member(s)')).toBeInTheDocument();
  });

  it('an unused branch is deleted after confirmation', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click((await screen.findAllByRole('button', { name: 'Delete Delhi' }))[0]);
    const dialog = screen.getByText('Delete branch?').parentElement as HTMLElement;
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(branchRepository.delete).toHaveBeenCalledWith(2));
  });
});
