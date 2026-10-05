import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { RADIUS_OPTIONS, ThemeProvider, TINT_OPTIONS, useTheme } from './theme.context';
import { allowConsoleError } from '../test/console';

// v3 key. Versioned on purpose — see the comment on STORAGE_KEY in theme.context.tsx.
const STORAGE_KEY = 'flexhub-theme-v3';
const LEGACY_KEY = 'flexhub-theme';
const root = document.documentElement;

function wrapper({ children }: { children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

const stored = () => JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null');

beforeEach(() => {
  root.removeAttribute('data-tint');
  root.removeAttribute('data-radius');
});

describe('ThemeProvider', () => {
  it('defaults to amber + soft (Stone & Amber) and applies them to <html>', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current).toMatchObject({ tint: 'amber', radius: 'soft' });
    expect(root.getAttribute('data-tint')).toBe('amber');
    expect(root.getAttribute('data-radius')).toBe('soft');
  });

  it('writes the theme to localStorage on mount — so EVERY device ends up with a stored value', () => {
    renderHook(() => useTheme(), { wrapper });
    expect(stored()).toEqual({ tint: 'amber', radius: 'soft' });
  });

  it('restores a valid stored theme', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ tint: 'violet', radius: 'sharp' }));
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current).toMatchObject({ tint: 'violet', radius: 'sharp' });
    expect(root.getAttribute('data-tint')).toBe('violet');
  });

  it('can still select the v2 "wild" tint', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ tint: 'wild', radius: 'soft' }));
    expect(renderHook(() => useTheme(), { wrapper }).result.current.tint).toBe('wild');
  });

  describe('the v2 -> v3 default change reaches devices that already stored a theme', () => {
    it('ignores the pre-v3 key entirely, so a stored "wild" can no longer pin a device to the old look', () => {
      // Every device that ever opened the app has this, because the provider wrote it on mount.
      window.localStorage.setItem(LEGACY_KEY, JSON.stringify({ tint: 'wild', radius: 'sharp' }));
      const { result } = renderHook(() => useTheme(), { wrapper });
      expect(result.current).toMatchObject({ tint: 'amber', radius: 'soft' });
    });

    it('does not touch or delete the legacy key (harmless; lets a rollback still find it)', () => {
      window.localStorage.setItem(LEGACY_KEY, JSON.stringify({ tint: 'wild', radius: 'soft' }));
      renderHook(() => useTheme(), { wrapper });
      expect(window.localStorage.getItem(LEGACY_KEY)).toBe(JSON.stringify({ tint: 'wild', radius: 'soft' }));
    });
  });

  it('falls back to the default for corrupt JSON instead of crashing the app', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json');
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current).toMatchObject({ tint: 'amber', radius: 'soft' });
  });

  it('ignores a stale/unknown tint or radius but keeps whichever half is still valid', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ tint: 'emerald', radius: 'sharp' }));
    expect(renderHook(() => useTheme(), { wrapper }).result.current).toMatchObject({ tint: 'amber', radius: 'sharp' });

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ tint: 'sky', radius: 'pill' }));
    expect(renderHook(() => useTheme(), { wrapper }).result.current).toMatchObject({ tint: 'sky', radius: 'soft' });
  });

  it('setTint / setRadius update <html> and persist under the v3 key', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => result.current.setTint('sky'));
    act(() => result.current.setRadius('sharp'));

    expect(root.getAttribute('data-tint')).toBe('sky');
    expect(root.getAttribute('data-radius')).toBe('sharp');
    expect(stored()).toEqual({ tint: 'sky', radius: 'sharp' });
  });

  it('exposes the available options, amber first (it is the default)', () => {
    expect(TINT_OPTIONS).toEqual(['amber', 'wild', 'sky', 'violet']);
    expect(RADIUS_OPTIONS).toEqual(['soft', 'sharp']);
  });

  it('throws a clear error when used outside the provider', () => {
    allowConsoleError(/useTheme must be used inside ThemeProvider/, /The above error occurred/);
    expect(() => renderHook(() => useTheme())).toThrow('useTheme must be used inside ThemeProvider');
  });
});
