# UI Design Tokens — Color System — Web Edition

> Part of: [SPEC-WEB.md](../../SPEC-WEB.md) | App: Fit&Fine Gym Subscription Manager (Web)
> Implementation file: `web/src/styles/tokens.css` (CSS custom properties) + `web/src/constants/colors.ts` (typed TS export for use in JS/inline logic)

**Rule:** Never hardcode a hex value in a component file. Always use a CSS custom property (`var(--color-...)`) in stylesheets/CSS Modules, or the `Colors` object in TypeScript when a color must be read in JS (e.g. passed to a canvas/chart library).

The token **names and hex values are unchanged from the mobile app** ([spec/colors.md](../../spec/colors.md)) — this is the same brand, just a different rendering technology. Do not invent new colors without updating both spec files.

```css
/* web/src/styles/tokens.css */
:root {
  --color-brand-100: #FF9B70;
  --color-brand-200: #FF6B35;
  --color-brand-primary: #E8430A;
  --color-brand-600: #C0230A;
  --color-brand-800: #8C1505;
  --color-brand-tint: #FFF0EA;
  --color-brand-tint-border: #FFDCCC;

  --color-neutral-900: #0D0D0D;
  --color-neutral-800: #1E1E1E;
  --color-neutral-600: #3A3A3A;
  --color-neutral-400: #6B6B6B;
  --color-neutral-200: #BBBBBB;
  --color-neutral-100: #E0E0E0;
  --color-neutral-50: #F5F5F5;
  --color-neutral-0: #FFFFFF;

  --color-status-success: #1A8C4E;
  --color-status-success-bg: #E8F5EE;
  --color-status-success-border: #A8D8BC;
  --color-status-success-text: #146B3B; /* text on --color-status-success-bg; base success color is only ~3.8:1 there, this reaches ~5.9:1 */
  --color-status-warning: #D97706;
  --color-status-warning-text: #B45309;
  --color-status-warning-bg: #FEF3E2;
  --color-status-warning-border: #F9D08B;
  --color-status-danger: #C0230A;
  --color-status-danger-bg: #FDECEA;
  --color-status-danger-border: #F4B2AA;
  --color-status-neutral: #6B6B6B;
  --color-status-neutral-bg: #F5F5F5;
  --color-status-neutral-border: #BBBBBB;

  --color-surface-background: #F5F5F5;
  --color-surface-card: #FFFFFF;
  --color-surface-elevated: #FFFFFF;
  --color-surface-dark: #0D0D0D;
  --color-surface-input: #F5F5F5;
  --color-surface-brand-tint: #FFF0EA;

  --color-text-primary: #0D0D0D;
  --color-text-secondary: #3A3A3A;
  --color-text-muted: #6B6B6B;
  --color-text-disabled: #BBBBBB;
  --color-text-inverse: #FFFFFF;
  --color-text-brand: #E8430A;
  --color-text-on-brand-tint: #8C1505;

  --color-border-default: #E0E0E0;
  --color-border-strong: #BBBBBB;
  --color-border-focus: #E8430A;
  --color-border-brand-tint: #FFDCCC;
  --color-border-on-dark: #3A3A3A;

  --color-interactive-default: #E8430A;
  --color-interactive-pressed: #C0230A;
  --color-interactive-disabled: #BBBBBB;
  --color-interactive-focus-ring: rgba(232, 67, 10, 0.18);

  --color-shadow: rgba(13, 13, 13, 0.35); /* elevation/drop-shadow color - use instead of a raw rgba(0,0,0,...) literal */
}
```

```typescript
// web/src/constants/colors.ts — mirrors tokens.css for JS/TS usage
export const Colors = {
  brand: { 100: '#FF9B70', 200: '#FF6B35', primary: '#E8430A', 600: '#C0230A', 800: '#8C1505', tint: '#FFF0EA', tintBorder: '#FFDCCC' },
  neutral: { 900: '#0D0D0D', 800: '#1E1E1E', 600: '#3A3A3A', 400: '#6B6B6B', 200: '#BBBBBB', 100: '#E0E0E0', 50: '#F5F5F5', 0: '#FFFFFF' },
  status: {
    success: '#1A8C4E', successBg: '#E8F5EE', successBorder: '#A8D8BC', successText: '#146B3B',
    warning: '#D97706', warningText: '#B45309', warningBg: '#FEF3E2', warningBorder: '#F9D08B',
    danger: '#C0230A', dangerBg: '#FDECEA', dangerBorder: '#F4B2AA',
    neutral: '#6B6B6B', neutralBg: '#F5F5F5', neutralBorder: '#BBBBBB',
  },
  shadow: 'rgba(13, 13, 13, 0.35)',
  surface: { background: '#F5F5F5', card: '#FFFFFF', elevated: '#FFFFFF', dark: '#0D0D0D', input: '#F5F5F5', brandTint: '#FFF0EA' },
  text: { primary: '#0D0D0D', secondary: '#3A3A3A', muted: '#6B6B6B', disabled: '#BBBBBB', inverse: '#FFFFFF', brand: '#E8430A', onBrandTint: '#8C1505' },
  border: { default: '#E0E0E0', strong: '#BBBBBB', focus: '#E8430A', brandTint: '#FFDCCC', onDark: '#3A3A3A' },
  interactive: { default: '#E8430A', pressed: '#C0230A', disabled: '#BBBBBB', focusRing: 'rgba(232,67,10,0.18)' },
} as const;
```

`tokens.css` is imported once, globally, in `web/src/main.tsx`.

---

## Component Color Rules

Same mapping as the mobile app, expressed as CSS custom properties instead of RN style objects:

| Component           | Rule                                                                                    |
|----------------------|--------------------------------------------------------------------------------------------|
| Primary button       | bg=`--color-brand-600`, text=`--color-text-inverse`, hover/active=`--color-brand-800` (was `--color-brand-primary`/`--color-brand-600` — that pairing only reaches ~4.0:1 with white text at normal button-label sizes, short of AA 4.5:1; brand-600 reaches ~6:1) |
| Secondary button     | bg=`--color-neutral-900`, text=`--color-text-inverse`, hover/active=`--color-neutral-800` |
| Outline button       | bg=transparent, text=`--color-text-brand`, border=`--color-brand-primary`, hover bg=`--color-brand-tint` |
| Ghost button          | bg=transparent, text=`--color-text-secondary`, border=`--color-neutral-200`, hover bg=`--color-neutral-50` |
| Danger button         | bg=`--color-status-danger`, text=`--color-text-inverse`, hover=`--color-brand-800`        |
| Input (default)       | bg=`--color-surface-input`, border=`--color-border-strong` 1.5px                          |
| Input (focused)       | border=`--color-border-focus` 1.5px, box-shadow=`--color-interactive-focus-ring` 3px       |
| Input (error)         | border=`--color-status-danger` 1.5px, bg=`--color-status-danger-bg`                       |
| Input (disabled)      | border=`--color-neutral-100` 1px, bg=`--color-neutral-50`                                 |
| Nav bar (mobile/desktop)| bg=`--color-surface-dark`, active=`--color-text-brand`, inactive=`--color-neutral-600`  |
| Member status badge    | pill shape — bg + text + border from status tokens above                                  |
| Screen background      | Always `--color-surface-background`                                                        |
| Card surface           | Always `--color-surface-card` with `--color-border-default` 1px border                     |

There is no PIN-dot component in the web edition (login is email/password/OAuth, not PIN — see [app-shell.md](./app-shell.md)), so the mobile spec's PIN dot rules do not carry over.

---

## Usage Rules

1. Import colors only from `tokens.css` (CSS) or `constants/colors.ts` (TS) — never hardcode hex in components.
2. Only **one** primary (brand orange) CTA per screen. Secondary actions use black or outline.
3. `status.*` tokens are semantic-only — never used decoratively.
4. Never use `--color-text-brand` for body copy on white — only labels ≥ 14px bold, or links.
5. All text on `--color-surface-dark` must use `--color-text-inverse` or `--color-text-brand`.
6. Disabled elements: use `--color-interactive-disabled` fill — no opacity hacks.
7. Admin screens share the same color system — no separate admin palette.
8. Respect the user's OS-level reduced-motion/contrast preferences where feasible (e.g. `prefers-reduced-motion`) even though this token set has no dark-mode variant defined yet.
