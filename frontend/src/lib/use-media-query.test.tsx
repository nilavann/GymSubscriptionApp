import { describe, expect, it } from 'vitest';
import { render, renderHook, screen } from '@testing-library/react';
import { TABLET_UP_QUERY, useIsTabletUp, useMediaQuery } from './use-media-query';
import { MOBILE_WIDTH, setViewport } from '../test/viewport';

describe('TABLET_UP_QUERY', () => {
  it('is the px query the page CSS uses (not the rem-based Tailwind token)', () => {
    expect(TABLET_UP_QUERY).toBe('(min-width: 768px)');
  });
});

describe('useIsTabletUp', () => {
  it('is true on a desktop-width window and false on a phone, on the very first render', () => {
    expect(renderHook(() => useIsTabletUp()).result.current).toBe(true);

    setViewport(MOBILE_WIDTH);
    expect(renderHook(() => useIsTabletUp()).result.current).toBe(false);
  });

  it('flips exactly at 768px: 767 is mobile, 768 is tablet', () => {
    setViewport(767);
    const { result } = renderHook(() => useIsTabletUp());
    expect(result.current).toBe(false);

    setViewport(768);
    expect(result.current).toBe(true);

    setViewport(767);
    expect(result.current).toBe(false);
  });

  it('re-renders subscribers when the window crosses the breakpoint (rotating a phone / resizing)', () => {
    const { result } = renderHook(() => useIsTabletUp());
    expect(result.current).toBe(true);
    setViewport(390);
    expect(result.current).toBe(false);
    setViewport(1024);
    expect(result.current).toBe(true);
  });

  it('does not re-render for width changes that stay on the same side of the breakpoint', () => {
    let renders = 0;
    function Probe() {
      renders += 1;
      return <span>{useIsTabletUp() ? 'wide' : 'narrow'}</span>;
    }
    render(<Probe />);
    const afterMount = renders;

    setViewport(1100);
    setViewport(900);
    expect(renders).toBe(afterMount);
    expect(screen.getByText('wide')).toBeInTheDocument();
  });

  it('stops listening after unmount', () => {
    let renders = 0;
    function Probe() {
      renders += 1;
      return <span>{useIsTabletUp() ? 'wide' : 'narrow'}</span>;
    }
    const { unmount } = render(<Probe />);
    unmount();
    const afterUnmount = renders;

    setViewport(390);
    expect(renders).toBe(afterUnmount);
  });
});

describe('useMediaQuery', () => {
  it('works for any query, e.g. max-width', () => {
    const { result } = renderHook(() => useMediaQuery('(max-width: 500px)'));
    expect(result.current).toBe(false);
    setViewport(400);
    expect(result.current).toBe(true);
  });
});
