import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PhotoLightbox } from './PhotoLightbox';

describe('PhotoLightbox', () => {
  it('shows the photo in a modal dialog named after the member', () => {
    render(<PhotoLightbox src="https://img.test/a.jpg" alt="Asha Verma" onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Asha Verma' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('img', { name: 'Asha Verma' })).toHaveAttribute('src', 'https://img.test/a.jpg');
  });

  it('falls back to a generic dialog name when there is no alt text', () => {
    render(<PhotoLightbox src="x.jpg" alt="" onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Photo' })).toBeInTheDocument();
  });

  it('closes from the close button, the backdrop and Escape', async () => {
    const onClose = vi.fn();
    render(<PhotoLightbox src="x.jpg" alt="A" onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(2);

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('does not close when the photo itself is tapped', async () => {
    const onClose = vi.fn();
    render(<PhotoLightbox src="x.jpg" alt="A" onClose={onClose} />);
    await userEvent.click(screen.getByRole('img', { name: 'A' }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stops listening for Escape after it unmounts', async () => {
    const onClose = vi.fn();
    const { unmount } = render(<PhotoLightbox src="x.jpg" alt="A" onClose={onClose} />);
    unmount();
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });
});
