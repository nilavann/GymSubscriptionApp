import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoadingView } from './LoadingView';

describe('LoadingView', () => {
  it('says it is loading', () => {
    render(<LoadingView />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('takes the full screen height via a class (so CSS can carry the dvh fallback), not an inline 100vh', () => {
    render(<LoadingView />);
    const root = screen.getByText('Loading…');
    expect(root).toHaveClass('loading-view');
    expect(root.style.minHeight).toBe('');
  });

  it('hides its spinner from assistive tech', () => {
    render(<LoadingView />);
    expect(document.querySelector('.loading-view-spin')).toHaveAttribute('aria-hidden', 'true');
  });
});
