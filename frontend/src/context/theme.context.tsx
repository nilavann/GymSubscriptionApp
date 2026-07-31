import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

// The three theme axes from frontend/mockups/README.md §Theming (tint / cta / radius) —
// implemented as a real runtime-switchable config (not baked into tokens.css as a single
// fixed look), applied via data-tint/data-cta/data-radius attribute overrides in tokens.css.
export type Tint = 'sky' | 'violet' | 'emerald' | 'amber' | 'rose';
export type Cta = 'charcoal' | 'orange' | 'blue';
export type Radius = 'soft' | 'pill' | 'sharp';

export interface ThemeConfig {
  tint: Tint;
  cta: Cta;
  radius: Radius;
}

const DEFAULT_THEME: ThemeConfig = { tint: 'sky', cta: 'charcoal', radius: 'soft' };

const TINT_OPTIONS: Tint[] = ['sky', 'violet', 'emerald', 'amber', 'rose'];
const CTA_OPTIONS: Cta[] = ['charcoal', 'orange', 'blue'];
const RADIUS_OPTIONS: Radius[] = ['soft', 'pill', 'sharp'];

const STORAGE_KEY = 'flexhub-theme';

interface ThemeContextValue extends ThemeConfig {
  setTint: (tint: Tint) => void;
  setCta: (cta: Cta) => void;
  setRadius: (radius: Radius) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isTint(value: unknown): value is Tint {
  return typeof value === 'string' && (TINT_OPTIONS as string[]).includes(value);
}

function isCta(value: unknown): value is Cta {
  return typeof value === 'string' && (CTA_OPTIONS as string[]).includes(value);
}

function isRadius(value: unknown): value is Radius {
  return typeof value === 'string' && (RADIUS_OPTIONS as string[]).includes(value);
}

// Reads a possibly-corrupt/older-shape localStorage value defensively — a bad or stale
// value here should fall back to the default theme, never throw and break the whole app.
function loadStoredTheme(): ThemeConfig {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_THEME;
    const parsed = JSON.parse(raw) as Partial<Record<keyof ThemeConfig, unknown>>;
    return {
      tint: isTint(parsed.tint) ? parsed.tint : DEFAULT_THEME.tint,
      cta: isCta(parsed.cta) ? parsed.cta : DEFAULT_THEME.cta,
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
    root.setAttribute('data-cta', theme.cta);
    root.setAttribute('data-radius', theme.radius);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
  }, [theme]);

  const value: ThemeContextValue = {
    ...theme,
    setTint: (tint) => setTheme((prev) => ({ ...prev, tint })),
    setCta: (cta) => setTheme((prev) => ({ ...prev, cta })),
    setRadius: (radius) => setTheme((prev) => ({ ...prev, radius })),
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}

export { TINT_OPTIONS, CTA_OPTIONS, RADIUS_OPTIONS };
