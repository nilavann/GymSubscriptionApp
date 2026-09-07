import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

// The two theme axes from design_handoff_flexhub_v2/README.md §Theming (tint / radius) —
// implemented as a real runtime-switchable config (not baked into tokens.css as a single
// fixed look), applied via data-tint/data-radius attribute overrides in tokens.css.
//
// v2 note: CTA is no longer an independent axis (each tint now owns its own CTA gradient),
// and the `pill` radius option is gone — only `soft`/`sharp` remain. `emerald`/`amber`/`rose`
// tints are gone too (v2 reserves those hues for membership status, not decoration); `wild`
// is new and is the default.
export type Tint = 'wild' | 'sky' | 'violet';
export type Radius = 'soft' | 'sharp';

export interface ThemeConfig {
  tint: Tint;
  radius: Radius;
}

const DEFAULT_THEME: ThemeConfig = { tint: 'wild', radius: 'soft' };

const TINT_OPTIONS: Tint[] = ['wild', 'sky', 'violet'];
const RADIUS_OPTIONS: Radius[] = ['soft', 'sharp'];

const STORAGE_KEY = 'flexhub-theme';

interface ThemeContextValue extends ThemeConfig {
  setTint: (tint: Tint) => void;
  setRadius: (radius: Radius) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isTint(value: unknown): value is Tint {
  return typeof value === 'string' && (TINT_OPTIONS as string[]).includes(value);
}

function isRadius(value: unknown): value is Radius {
  return typeof value === 'string' && (RADIUS_OPTIONS as string[]).includes(value);
}

// Reads a possibly-corrupt/older-shape localStorage value defensively — a bad or stale
// value here (including a pre-v2 tint like "emerald" or a pre-v2 "pill"/"cta" field) should
// fall back to the default theme, never throw and break the whole app (README's "guard the
// lookups" note — a stale stored preference must never white-screen the app).
function loadStoredTheme(): ThemeConfig {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_THEME;
    const parsed = JSON.parse(raw) as Partial<Record<keyof ThemeConfig, unknown>>;
    return {
      tint: isTint(parsed.tint) ? parsed.tint : DEFAULT_THEME.tint,
      radius: isRadius(parsed.radius) ? parsed.radius : DEFAULT_THEME.radius,
    };
  } catch {
    return DEFAULT_THEME;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeConfig>(() => loadStoredTheme());

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-tint', theme.tint);
    root.setAttribute('data-radius', theme.radius);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
  }, [theme]);

  const value: ThemeContextValue = {
    ...theme,
    setTint: (tint) => setTheme((prev) => ({ ...prev, tint })),
    setRadius: (radius) => setTheme((prev) => ({ ...prev, radius })),
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}

export { TINT_OPTIONS, RADIUS_OPTIONS };
