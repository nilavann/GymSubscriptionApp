# UI Design Tokens — Color System — Web Edition

> Part of: [SPEC-WEB.md](../../SPEC-WEB.md) | App: Fit&Fine Gym Subscription Manager (Web)
> Implementation file: `frontend/src/styles/tokens.css`
>
> **Full rewrite (2026-09-05).** The previous version of this file described a brand-orange
> token system (`--color-brand-*`, dark nav chrome, PIN-dot rules) that predates two
> redesigns — the original FlexHub visual redesign (`29c0913`) and the v2 theme-axis rework
> (`design_handoff_flexhub_v2/README.md`). None of that vocabulary exists in the codebase
> anymore. This file now describes `tokens.css` as it actually stands.

**Rule unchanged:** never hardcode a hex value in a component file. Use a CSS custom property (`var(--color-...)`) — every token below both works as `var(...)` in plain CSS and generates a matching Tailwind utility (`tokens.css`'s `@theme` block — see [styling.md](./styling.md) §3).

---

## 1. Fixed tokens (`@theme` block — same for every tint/radius choice)

```css
--color-neutral-900: #111827; /* primary text */
--color-neutral-600: #475569;
--color-neutral-500: #6b7280; /* secondary text */
--color-neutral-400: #9ca3af; /* muted text — disabled states only, see Usage Rules */
--color-neutral-300: #d1d5db; /* disabled text */
--color-neutral-200: #e5e7eb; /* control borders */
--color-neutral-150: #f1f1f3; /* card borders */
--color-neutral-100: #f5f5f6; /* row dividers */
--color-neutral-75:  #f9fafb; /* input bg */
--color-neutral-50:  #f3f4f6; /* page bg */
--color-neutral-0:   #ffffff;

/* Categorical/secondary palette — member avatars (lib/avatar.ts), deterministically hashed
   by member id. Carries no brand or status meaning — never reused for anything semantic. */
--color-data-1: #2563eb;
--color-data-2: #7c3aed;
--color-data-3: #059669;
--color-data-4: #b45309;
--color-data-5: #be123c;
--color-data-6: #0891b2;

/* Status — a badge strength (chips/pills) and a lighter "subtle" strength (banners/summary
   cards). Semantic-only — see Usage Rules. */
--color-status-success-bg:        #dcfce7;
--color-status-success-bg-subtle: #ecfdf5;
--color-status-success-border:    #a7f3d0;
--color-status-success-text:      #15803d;
--color-status-success-text-deep: #047857;

--color-status-warning-bg:        #fef3c7;
--color-status-warning-bg-subtle: #fffbeb;
--color-status-warning-border:    #fde68a;
--color-status-warning-text:      #b45309;
--color-status-warning-text-deep: #92400e;

--color-status-danger-bg:        #fee2e2;
--color-status-danger-bg-subtle: #fef2f2;
--color-status-danger-border:    #fecaca;
--color-status-danger-text:      #b91c1c;
--color-status-danger-text-deep: #dc2626;

--color-status-neutral-bg:   #f3f4f6;
--color-status-neutral-text: #6b7280;

--color-surface-page:  #f3f4f6;
--color-surface-card:  #ffffff;
--color-surface-input: #f9fafb;

--color-text-primary:   #111827;
--color-text-secondary: #6b7280;
--color-text-muted:     #9ca3af;
--color-text-disabled:  #d1d5db;
--color-text-inverse:   #ffffff;

--color-border-default: #e5e7eb;
--color-border-card:    #f1f1f3;
--color-border-divider: #f5f5f6;

--color-interactive-disabled-bg:   #e5e7eb;
--color-interactive-disabled-text: #9ca3af;
```

There is no dark nav chrome, no `--color-surface-dark`, and no PIN-dot component in this app — the sidebar/tab bar are white (`--color-neutral-0`), and login is username/PIN over Supabase Auth rather than a native PIN-dot UI.

---

## 2. Theme-axis tokens (tint × radius — runtime-switchable, `context/theme.context.tsx`)

Two theme axes, defaulting to `wild + soft`. These live in a plain `:root` block (not `@theme`) so `ThemeProvider` can override them at runtime via `data-tint`/`data-radius` attributes on `<html>` — see [styling.md](./styling.md) §3.

### 2.1 Tint — three options, four roles each

CTA is folded into tint (no separate CTA axis) — each tint owns its own CTA gradient, so no clashing tint/CTA pairs can be produced. Every tint exposes **four** color roles; using the right one is what keeps the UI at WCAG AA — never collapse them into a single "primary":

| Role | Used for | Contrast requirement |
|---|---|---|
| `--tint-accent`  | Decorative fills only: progress bars, avatar tiles, toggle-on, chart bars | Vivid; never sits under small text |
| `--tint-ink`     | Accent-colored text/icons on white or `--color-surface-page` | ≥4.5:1 on white |
| `--tint-solid`   | Fills that carry **white** text: selected pills/tabs, count badges, CTAs that reuse the tint | ≥4.5:1 with `#fff` |
| `--tint-on-pill` | Text on `--tint-pill-bg`: active nav label, applied filter chips, role badges | ≥4.5:1 on pillBg |

| tint | card bg | border | accent | ink | solid | onPill | pillBg | cta |
|---|---|---|---|---|---|---|---|---|
| **wild** (default) | `#fff4f0` | `#ffdccf` | `#ff5a2c` | `#c2410c` | `#c2410c` | `#9a3412` | `#ffe4d9` | wild (own gradient) |
| sky | `#eff6ff` | `#dbeafe` | `#2563eb` | `#1d4ed8` | `#1d4ed8` | `#1e3a8a` | `#dbeafe` | charcoal |
| violet | `#f5f3ff` | `#ede9fe` | `#7c3aed` | `#6d28d9` | `#6d28d9` | `#5b21b6` | `#ede9fe` | charcoal (no dedicated violet gradient) |

CTA gradients (`--cta-from`/`--cta-to`, button fills with white labels):
- `wild` — `#c2410c` → `#9a3412`
- `charcoal` — `#374151` → `#111827`

Reading the theme object must guard the lookup with a fallback **on the object**, not the key, or a stale stored preference (an old `emerald`/`amber`/`rose` tint, or a pre-v2 `pill` radius) white-screens the app — see `theme.context.tsx`'s `isTint`/`isRadius`/`loadStoredTheme`.

### 2.2 Radius — two options

| radius | card | inputs/buttons (`el`) | tiles (`tile`) | pills |
|---|---|---|---|---|
| **soft** (default) | 28px | 12px | 16px | 999px |
| sharp | 10px | 6px | 10px | 6px |

There is no `pill` radius option anymore (v1 had three; v2 cut it to two).

---

## 3. Component Color Rules

| Component | Rule |
|---|---|
| Primary/CTA button | bg = `linear-gradient(var(--cta-from), var(--cta-to))`, text = `--color-text-inverse` |
| Secondary/outline button | bg transparent, text = `--color-text-secondary`, border = `--color-border-default` |
| Danger action | bg = `--color-status-danger-text` or `--color-status-danger-bg` fill depending on context (destructive buttons vs. inline banners) — never invented ad hoc |
| Input (default) | bg = `--color-surface-input`, border = `--color-border-default` |
| Input (focused) | border = `--tint-ink` (or tint-specific focus ring — `--tint-focus-ring`), box-shadow = `--tint-focus-ring` |
| Input (disabled) | bg = `--color-interactive-disabled-bg`, text = `--color-interactive-disabled-text` |
| Nav bar (mobile/desktop) | bg = `--color-neutral-0`, active = `--tint-ink` (text/icon on white) or `--tint-on-pill` (text on a `--tint-pill-bg` active-item background, e.g. the desktop sidebar's active row), inactive = `--color-text-secondary` |
| Member status badge | pill shape — bg/text from the matching `--color-status-*-bg`/`-text` pair |
| Screen background | Always `--color-surface-page` |
| Card surface | Always `--color-surface-card` with `--color-border-card` 1px border |

---

## 4. Usage Rules

1. Import colors only from `tokens.css`'s custom properties — never hardcode hex in a component (arbitrary Tailwind values like `bg-[#c0230a]` are the same violation via a different door, see [styling.md](./styling.md) §3).
2. Only one CTA-gradient action per screen; secondary actions use outline/ghost styling.
3. `--color-status-*` tokens are semantic-only — never used decoratively (an avatar hash must never land on a status color by coincidence — this is exactly why the categorical `--color-data-*` palette exists separately, see `lib/avatar.ts`).
4. `--color-text-muted` (`#9ca3af`) is for **disabled states only** — general secondary body text uses `--color-text-secondary` (`#6b7280`). This was a v1→v2 change (secondary text moved off `#9ca3af`); a full per-component audit of remaining `--color-text-muted` usage on non-disabled text is tracked as an open cleanup item, not yet complete everywhere.
5. Every tint's four roles (§2.1) must be used per their contrast contract — `--tint-accent` never sits under small text; a component needing accent-colored text uses `--tint-ink` (on white/`--color-surface-page`) or `--tint-on-pill` (on `--tint-pill-bg`) instead, and a solid fill carrying white text uses `--tint-solid`. **This audit is complete app-wide** (2026-09-07) — every `--tint-accent` usage left in the codebase is a border, a native `accent-color` (checkbox tint), a focus-ring companion, or one of the role table's explicitly-allowed decorative fills (progress bars, avatar tiles, toggle-on, chart bars, donut slices). A newly-added component must still follow the same rule; there's no longer a backlog to catch up on.
6. Admin screens share the same color system — no separate admin palette.
7. Respect the user's OS-level reduced-motion/contrast preferences where feasible (`prefers-reduced-motion`) — this token set has no dark-mode variant defined.

---

## 5. Related docs

- [styling.md](./styling.md) — how `tokens.css`'s `@theme` block plugs into Tailwind, and the breakpoint scale
- [action-center.md](./action-center.md) — first screen built against the v2 tint/radius axis in this table
- `frontend/src/context/theme.context.tsx` — the runtime tint/radius switcher these tokens back
