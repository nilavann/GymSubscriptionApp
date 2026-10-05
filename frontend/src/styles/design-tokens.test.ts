import { describe, expect, it } from 'vitest';
import { expectScanned, readSourceFiles } from '../test/source-files';

/**
 * Guards for the design-token contract (CLAUDE.md "Mobile conventions", rules.md rule 14): the
 * checks a reviewer would otherwise have to do by eye on every re-skin. They read the real source
 * files, so a violation anywhere in src/ fails here.
 */

const sources = readSourceFiles();
expectScanned(sources);
const tokensCss = sources['/src/styles/tokens.css'];

// Application source only: not tests, not the shared test helpers, and tokens.css is the one file
// that IS allowed to contain hex literals.
const appFiles = Object.entries(sources).filter(
  ([path]) => !/\.test\.(ts|tsx)$/.test(path) && !path.includes('/src/test/') && !path.endsWith('/styles/tokens.css')
);

const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

// ---- parsing tokens.css ------------------------------------------------------------------------

function declarations(block: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [, name, value] of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) result[name] = value.trim();
  return result;
}

function blocks(css: string): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  for (const [, selector, body] of stripComments(css).matchAll(/(:root(?:\[[^\]]+\])?|@theme)\s*\{([^}]*)\}/g)) {
    result[selector] = declarations(body);
  }
  return result;
}

const tokenBlocks = blocks(tokensCss);
const theme = tokenBlocks['@theme'];
const defaults = tokenBlocks[':root'];

// ---- WCAG contrast -----------------------------------------------------------------------------

function luminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const AA = 4.5;

// ---- tests -------------------------------------------------------------------------------------

describe('no hex literals outside tokens.css (rule 14)', () => {
  // Google's brand mark: its four colours are mandated by Google's branding rules, not by this theme.
  const ALLOWED: Record<string, string[]> = {
    '/src/pages/LoginPage.tsx': ['#4285F4', '#34A853', '#FBBC05', '#EA4335'],
  };

  it('finds none in application CSS/TS/TSX', () => {
    const offenders: string[] = [];
    for (const [path, code] of appFiles) {
      const allowed = (ALLOWED[path] ?? []).map((h) => h.toLowerCase());
      for (const [hex] of stripComments(code).matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
        if (!allowed.includes(hex.toLowerCase())) offenders.push(`${path}: ${hex}`);
      }
    }
    expect(offenders, 'move these into styles/tokens.css and reference the token').toEqual([]);
  });
});

describe('every var(--token) a source file reads is actually defined', () => {
  it('has no undefined custom property without a fallback', () => {
    const defined = new Set<string>();
    for (const [, code] of [...appFiles, ['tokens', tokensCss] as const]) {
      for (const [, name] of stripComments(code).matchAll(/--([a-z0-9-]+)\s*:/g)) defined.add(name);
    }
    // Tailwind generates these from @theme namespaces; --color-* utilities etc. are covered by the declarations above.
    const missing = new Set<string>();
    for (const [path, code] of appFiles) {
      for (const [, name] of stripComments(code).matchAll(/var\(\s*--([a-z0-9-]+)\s*\)/g)) {
        if (!defined.has(name)) missing.add(`${path}: --${name}`);
      }
    }
    expect([...missing]).toEqual([]);
  });
});

describe('status pills are declared once (CLAUDE.md "Mobile conventions")', () => {
  it('only styles/status.css declares .status-badge-* / .status-text-*', () => {
    const offenders = appFiles
      .filter(([path]) => path.endsWith('.css') && !path.endsWith('/styles/status.css'))
      .filter(([, css]) => /^\s*\.status-(badge|text)/m.test(stripComments(css)))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});

describe('tint axis', () => {
  const ROLES = [
    'tint-card-from',
    'tint-card-to',
    'tint-border',
    'tint-accent',
    'tint-ink',
    'tint-solid',
    'tint-on-pill',
    'tint-pill-bg',
    'tint-focus-ring',
    'cta-from',
    'cta-to',
  ];

  // amber is the :root default; the others are attribute overrides.
  const tints: Record<string, Record<string, string>> = {
    amber: defaults,
    wild: tokenBlocks[":root[data-tint='wild']"],
    sky: tokenBlocks[":root[data-tint='sky']"],
    violet: tokenBlocks[":root[data-tint='violet']"],
  };

  it('defines all four tints', () => {
    for (const [name, vars] of Object.entries(tints)) expect(vars, `tint "${name}"`).toBeDefined();
  });

  it.each(Object.keys(tints))('%s defines every colour role (a missing one would silently inherit another tint)', (name) => {
    for (const role of ROLES) expect(tints[name][role], `${name} is missing --${role}`).toBeTruthy();
  });

  it('amber is the default and matches the v3 Theme Sheet roles', () => {
    expect(defaults).toMatchObject({
      'tint-accent': '#d97706', // accent-mark: rules/fills, never behind text
      'tint-ink': '#b45309', // action-primary
      'tint-solid': '#b45309',
      'tint-on-pill': '#92400e', // accent-text
    });
    expect(`${defaults['cta-from']} -> ${defaults['cta-to']}`).toBe('#b45309 -> #92400e');
  });

  // The "Accessibility contract" in tokens.css: each role has ONE job, and the pairs it is used in must be AA.
  describe.each(Object.keys(tints))('%s meets WCAG AA where each role is used', (name) => {
    const t = () => tints[name];
    const white = theme['color-neutral-0'];
    const page = theme['color-surface-page'];

    it('--tint-ink (text/icons) on white and on the page background', () => {
      expect(contrast(t()['tint-ink'], white)).toBeGreaterThanOrEqual(AA);
      expect(contrast(t()['tint-ink'], page)).toBeGreaterThanOrEqual(AA);
    });
    it('white text on --tint-solid (selected pills, badges, CTAs)', () => {
      expect(contrast(white, t()['tint-solid'])).toBeGreaterThanOrEqual(AA);
    });
    it('--tint-on-pill text on --tint-pill-bg', () => {
      expect(contrast(t()['tint-on-pill'], t()['tint-pill-bg'])).toBeGreaterThanOrEqual(AA);
    });
    it('white text on both ends of the CTA gradient', () => {
      expect(contrast(white, t()['cta-from'])).toBeGreaterThanOrEqual(AA);
      expect(contrast(white, t()['cta-to'])).toBeGreaterThanOrEqual(AA);
    });
  });

  it('the decorative accent is NOT usable as text on white (Theme Sheet: amber 600 fails AA)', () => {
    // Pinned as a reminder of why --tint-accent must never sit under small text.
    expect(contrast(defaults['tint-accent'], theme['color-neutral-0'])).toBeLessThan(AA);
  });
});

describe('fixed colour pairs meet WCAG AA', () => {
  const pair = (label: string, fg: string, bg: string) =>
    it(label, () => expect(contrast(theme[fg], theme[bg])).toBeGreaterThanOrEqual(AA));

  describe('text', () => {
    pair('primary on page', 'color-text-primary', 'color-surface-page');
    pair('secondary on page', 'color-text-secondary', 'color-surface-page');
    pair('secondary on white', 'color-text-secondary', 'color-neutral-0');
    pair('muted on white', 'color-text-muted', 'color-neutral-0');
    pair('muted on page', 'color-text-muted', 'color-surface-page');
  });

  describe('membership pills (README §Status)', () => {
    pair('Active: stone-800 on stone-100', 'color-status-active-text', 'color-status-active-bg');
    pair('Expiring: amber-800 on amber-50', 'color-status-warning-text-deep', 'color-status-warning-bg-subtle');
    pair('Expired: red-700 on red-100', 'color-status-danger-text', 'color-status-danger-bg');
    pair('No plan: stone-600 on stone-100', 'color-status-neutral-text', 'color-status-neutral-bg');
  });

  describe('banners', () => {
    pair('danger', 'color-status-danger-text', 'color-status-danger-bg-subtle');
    pair('success', 'color-status-success-text-deep', 'color-status-success-bg-subtle');
  });

  describe('white on inverse chrome (header avatar initials)', () => {
    pair('white on inverse', 'color-neutral-0', 'color-surface-inverse');
  });
});
