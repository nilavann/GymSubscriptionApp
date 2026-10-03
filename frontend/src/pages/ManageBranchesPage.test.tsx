import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { ManageBranchesPage } from './ManageBranchesPage';
import { branchService as realBranchService } from '../services/branch.service';
import { fakeServices } from '../test/fakes';
import { renderWithProviders, type RenderOptions } from '../test/render';
import { buildBranch } from '../test/builders';
import { MOBILE_WIDTH } from '../test/viewport';
import type { Branch } from '../types/branch';

const BRANCHES: Branch[] = [
  buildBranch({ id: 1, name: 'Mumbai Central', code: 'MUM' }),
  buildBranch({ id: 2, name: 'Pune Camp', code: 'PUN' }),
];

function renderBranches(
  options: RenderOptions & {
    branches?: Branch[];
    getAllActive?: ReturnType<typeof vi.fn>;
    create?: ReturnType<typeof vi.fn>;
    update?: ReturnType<typeof vi.fn>;
    remove?: ReturnType<typeof vi.fn>;
  } = {}
) {
  const {
    branches = BRANCHES,
    getAllActive = vi.fn().mockResolvedValue(branches),
    create = vi.fn().mockResolvedValue(buildBranch()),
    update = vi.fn().mockResolvedValue(undefined),
    remove = vi.fn().mockResolvedValue(undefined),
    ...rest
  } = options;
  const utils = renderWithProviders(<ManageBranchesPage />, {
    ...rest,
    services: fakeServices({
      branchRepository: { getAllActive, delete: remove },
      // Real validation, faked network.
      branchService: { ...realBranchService, create, update },
    }),
  });
  return { ...utils, getAllActive, create, update, remove };
}

const ready = () => screen.findByRole('heading', { name: 'Branches' });

describe('ManageBranchesPage — data states', () => {
  it('shows a skeleton while loading', () => {
    renderBranches({ getAllActive: vi.fn().mockReturnValue(new Promise(() => undefined)) });
    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
  });

  it('a network failure offers Retry and recovers', async () => {
    const getAllActive = vi.fn().mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue(BRANCHES);
    const { user } = renderBranches({ getAllActive });
    expect(await screen.findByText("Couldn't load branches — check your connection and try again.")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await ready()).toBeInTheDocument();
  });

  it('a generic failure is worded differently and never shows the raw error', async () => {
    renderBranches({ getAllActive: vi.fn().mockRejectedValue(new Error('PGRST raw')) });
    expect(await screen.findByText('Something went wrong loading branches. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText(/PGRST/)).not.toBeInTheDocument();
  });

  it('with no branches, says so and offers to add one', async () => {
    const { user } = renderBranches({ branches: [] });
    await ready();
    expect(screen.getByText('No branches yet.')).toBeInTheDocument();
    await user.click(within(document.querySelector('.branches-empty') as HTMLElement).getByRole('button', { name: /Add Branch/ }));
    expect(screen.getByRole('heading', { name: 'Add Branch' })).toBeInTheDocument();
  });

  it('carries the admin section tabs', async () => {
    renderBranches();
    await ready();
    expect(screen.getByRole('navigation', { name: 'Admin sections' })).toBeInTheDocument();
  });
});

describe('ManageBranchesPage renders exactly ONE of table / cards', () => {
  it('on desktop: a table, one row per branch, no cards', async () => {
    renderBranches({ viewport: 1280 });
    await ready();
    expect(document.querySelectorAll('table')).toHaveLength(1);
    expect(within(document.querySelector('table') as HTMLElement).getAllByRole('row')).toHaveLength(BRANCHES.length + 1);
    expect(document.querySelector('.branches-cards')).toBeNull();
  });

  it('on a phone: cards, one per branch, no table', async () => {
    renderBranches({ viewport: MOBILE_WIDTH });
    await ready();
    expect(document.querySelectorAll('table')).toHaveLength(0);
    expect(document.querySelectorAll('.branches-card')).toHaveLength(BRANCHES.length);
  });
});

describe('ManageBranchesPage — add / edit', () => {
  it('validates on submit, showing each missing field, and does not call the service', async () => {
    const { user, create } = renderBranches();
    await ready();
    await user.click(screen.getAllByRole('button', { name: /Add Branch/ })[0]);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Code is required')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('creates a branch, closes the form and reloads the list', async () => {
    const { user, create, getAllActive } = renderBranches();
    await ready();
    await user.click(screen.getAllByRole('button', { name: /Add Branch/ })[0]);

    await user.type(screen.getByLabelText(/Name/), 'Thane West');
    await user.type(screen.getByLabelText(/Code/), 'THA');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(create).toHaveBeenCalledWith({ name: 'Thane West', code: 'THA' });
    await vi.waitFor(() => expect(screen.queryByRole('heading', { name: 'Add Branch', level: 2 })).not.toBeInTheDocument());
    expect(getAllActive).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['a duplicate code', new Error('duplicate key value violates unique constraint idx_branches_code_active (code)'), 'This code is already used by another branch.'],
    ['being offline', new Error('Failed to fetch'), "Couldn't save this branch — check your connection and try again."],
    ['anything else', new Error('boom'), 'Something went wrong saving this branch. Please try again.'],
  ])('shows a specific message for %s and keeps the form open', async (_label, error, message) => {
    const { user } = renderBranches({ create: vi.fn().mockRejectedValue(error) });
    await ready();
    await user.click(screen.getAllByRole('button', { name: /Add Branch/ })[0]);
    await user.type(screen.getByLabelText(/Name/), 'X');
    await user.type(screen.getByLabelText(/Code/), 'X');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByLabelText(/Name/)).toHaveValue('X'); // input kept
  });

  it('editing prefills the form and saves with the branch id', async () => {
    const { user, update } = renderBranches({ viewport: 1280 });
    await ready();
    await user.click(screen.getByRole('button', { name: 'Edit Pune Camp' }));

    expect(screen.getByRole('heading', { name: 'Edit Branch' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Name/)).toHaveValue('Pune Camp');
    expect(screen.getByLabelText(/Code/)).toHaveValue('PUN');

    await user.clear(screen.getByLabelText(/Code/));
    await user.type(screen.getByLabelText(/Code/), 'PNE');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(update).toHaveBeenCalledWith(2, { name: 'Pune Camp', code: 'PNE' });
  });

  it('Cancel closes the form without saving', async () => {
    const { user, create } = renderBranches();
    await ready();
    await user.click(screen.getAllByRole('button', { name: /Add Branch/ })[0]);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText(/Name/)).not.toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });
});

describe('ManageBranchesPage — delete', () => {
  it('asks for confirmation, then deletes and reloads', async () => {
    const { user, remove, getAllActive } = renderBranches({ viewport: 1280 });
    await ready();
    await user.click(screen.getByRole('button', { name: 'Delete Mumbai Central' }));

    expect(screen.getByRole('heading', { name: 'Delete branch?' })).toBeInTheDocument();
    await user.click(within(document.querySelector('.branches-delete-dialog') as HTMLElement).getByRole('button', { name: 'Delete' }));

    expect(remove).toHaveBeenCalledWith(1);
    await vi.waitFor(() => expect(screen.queryByRole('heading', { name: 'Delete branch?' })).not.toBeInTheDocument());
    expect(getAllActive).toHaveBeenCalledTimes(2);
  });

  it('cancelling the confirmation deletes nothing', async () => {
    const { user, remove } = renderBranches({ viewport: 1280 });
    await ready();
    await user.click(screen.getByRole('button', { name: 'Delete Mumbai Central' }));
    await user.click(within(document.querySelector('.branches-delete-dialog') as HTMLElement).getByRole('button', { name: 'Cancel' }));
    expect(remove).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Delete branch?' })).not.toBeInTheDocument();
  });

  it('shows the server’s own "in use" message verbatim and keeps the dialog open', async () => {
    const remove = vi.fn().mockRejectedValue(new Error('Cannot delete — used by 3 member(s)'));
    const { user } = renderBranches({ remove, viewport: 1280 });
    await ready();
    await user.click(screen.getByRole('button', { name: 'Delete Mumbai Central' }));
    await user.click(within(document.querySelector('.branches-delete-dialog') as HTMLElement).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('Cannot delete — used by 3 member(s)')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Delete branch?' })).toBeInTheDocument();
  });

  it('works from the phone card layout too', async () => {
    const { user, remove } = renderBranches({ viewport: MOBILE_WIDTH });
    await ready();
    await user.click(screen.getByRole('button', { name: 'Delete Pune Camp' }));
    await user.click(within(document.querySelector('.branches-delete-dialog') as HTMLElement).getByRole('button', { name: 'Delete' }));
    expect(remove).toHaveBeenCalledWith(2);
  });
});
