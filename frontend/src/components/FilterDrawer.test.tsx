import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterDrawer } from './FilterDrawer';

function setup(props: Partial<ComponentProps<typeof FilterDrawer>> = {}) {
  const onClose = vi.fn();
  const onClear = vi.fn();
  render(
    <FilterDrawer open onClose={onClose} onClear={onClear} {...props}>
      <p>Filter content</p>
    </FilterDrawer>
  );
  return { onClose, onClear };
}

describe('FilterDrawer', () => {
  it('renders nothing at all while closed', () => {
    render(
      <FilterDrawer open={false} onClose={vi.fn()} onClear={vi.fn()}>
        <p>Filter content</p>
      </FilterDrawer>
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Filter content')).not.toBeInTheDocument();
  });

  it('is a modal dialog titled "Filters" by default, with the caller’s content in the body', () => {
    setup();
    const dialog = screen.getByRole('dialog', { name: 'Filters' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { name: 'Filters' })).toBeInTheDocument();
    expect(screen.getByText('Filter content')).toBeInTheDocument();
  });

  it('accepts a custom title', () => {
    setup({ title: 'Refine' });
    expect(screen.getByRole('dialog', { name: 'Refine' })).toBeInTheDocument();
  });

  it('closes from the X, from Apply filters and from a backdrop tap', async () => {
    const { onClose } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Close filters' }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await userEvent.click(document.querySelector('.filter-drawer-backdrop') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('does not close when the panel itself is tapped', async () => {
    const { onClose } = setup();
    await userEvent.click(screen.getByText('Filter content'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Clear all calls onClear without closing', async () => {
    const { onClear, onClose } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});
