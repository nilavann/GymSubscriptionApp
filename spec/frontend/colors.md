# UI Design Tokens — Color System — Web Edition

> Part of: [SPEC-WEB.md](../../SPEC-WEB.md) | App: Fit&Fine Gym Subscription Manager (Web)
> Implementation file: `frontend/src/styles/tokens.css`
>
> **v3 "Stone & Amber" (2026-10-03).** Re-skinned from the v2 palette to the theme in
> `design_handoff_flexhub_mobile/` (README §Design tokens + `Theme Sheet Stone and Amber.dc.html`).
> Token **names** are unchanged from v2 — `--color-neutral-900` is now stone-900 rather than
> slate-900 — so the re-skin was a value change in `tokens.css`, not an edit to every component.
> Earlier history: the original FlexHub redesign (`29c0913`), then the v2 theme-axis rework
> (`design_handoff_flexhub_v2/README.md`).

**Rule unchanged:** never hardcode a hex value in a component file. Use a CSS custom property (`var(--color-...)`) — every token below both works as `var(...)` in plain CSS and generates a matching Tailwind utility (`tokens.css`'s `@theme` block — see [styling.md](./styling.md) §3). This is **enforced**, not just asked: `frontend/src/styles/design-tokens.test.ts` fails on any hex literal outside `tokens.css` (the one exception is Google's four mandated brand-mark colours in `LoginPage.tsx`), on any `var(--x)` that nothing defines, and on a page stylesheet re-declaring the status pills.

---

## 1. Fixed tokens (`@theme` block — same for every tint/radius choice)

```css
/* Neutral ramp — Tailwind "stone" (warm grays). 150 has no stone equivalent: it is the shimmer
   highlight paired with 50 in every loading skeleton, so it reuses the 200 hairline. */
--color-neutral-900: #1c1917; /* primary text */
--color-neutral-600: #57534e;
--color-neutral-500: #78716c; /* muted text */
--color-neutral-400: #a8a29e; /* placeholder / disabled */
--color-neutral-300: #d6d3d1; /* border-strong */
--color-neutral-200: #e7e5e4; /* control borders, border-subtle */
--color-neutral-150: #e7e5e4; /* skeleton shimmer highlight */
--color-neutral-100: #f5f5f4; /* surface-sunken */
--color-neutral-75:  #fafaf9; /* input bg */
--color-neutral-50:  #f5f5f4; /* skeleton shimmer base */
--color-neutral-0:   #ffffff;

/* Categorical palette — member avatars only (lib/avatar.ts), hashed by member id. Carries no brand
   or status meaning. v3 README: warm ambers and stones; the list intentionally repeats two values. */
--color-data-1: #b45309;  --color-data-2: #b45309;  --color-data-3: #92400e;
--color-data-4: #292524;  --color-data-5: #92400e;  --color-data-6: #1c1917;

/* Status — a badge strength (chips/pills) and a lighter "subtle" strength (banners/summary cards).
   Semantic-only — see Usage Rules. Danger and success banners are unchanged from v2. */
--color-status-success-bg:        #dcfce7;   --color-status-success-bg-subtle: #ecfdf5;
--color-status-success-border:    #a7f3d0;   --color-status-success-text:      #15803d;
--color-status-success-text-deep: #047857;

--color-status-warning-bg:        #fef3c7;   --color-status-warning-bg-subtle: #fffbeb;
--color-status-warning-border:    #fde68a;   --color-status-warning-text:      #b45309;
--color-status-warning-text-deep: #92400e;

--color-status-danger-bg:        #fee2e2;    --color-status-danger-bg-subtle: #fef2f2;
--color-status-danger-border:    #fecaca;    --color-status-danger-text:      #b91c1c;
--color-status-danger-text-deep: #dc2626;

--color-status-neutral-bg:   #f5f5f4;  --color-status-neutral-text: #57534e;   /* "No plan" */
--color-status-active-bg:    #f5f5f4;  --color-status-active-text:  #292524;   /* Active pill — see §3 */

--color-surface-page:    #fafaf9;
--color-surface-card:    #ffffff;
--color-surface-input:   #fafaf9;
--color-surface-inverse: #292524;   /* mobile header avatar, inverse chrome */
--color-surface-dots:    #f4e2ce;   /* the 18px dot grid on the page background */

--color-text-primary:   #1c1917;
--color-text-secondary: #57534e;
--color-text-muted:     #78716c;
--color-text-disabled:  #a8a29e;
--color-text-inverse:   #ffffff;

--color-border-default: #e7e5e4;
--color-border-card:    #e7e5e4;
--color-border-divider: #f3e8db;    /* warm row divider */

--color-interactive-disabled-bg:   #f5f5f4;
--color-interactive-disabled-text: #a8a29e;

/* Real colors that are not part of the theme proper but must still live here (rule 14). */
--color-media-backdrop:  #000000;   /* behind the live camera preview */
--color-chart-upi:       #44403c;   /* Reports donut: Cash follows --tint-accent; UPI and Card are fixed, */
--color-chart-card:      #a8a29e;   /* distinct stones so the slices stay separable under ANY tint */
--color-tint-preview-amber: #d97706;   --color-tint-preview-wild: #ff5a2c;   /* Settings > Appearance swatches */
--color-tint-preview-sky:   #2563eb;   --color-tint-preview-violet: #7c3aed;  /* show each tint while another is live */
```

Typography tokens (`--font-ui` Rubik, `--font-display` Schibsted Grotesk, self-hosted Fontsource variable fonts imported in `main.tsx`) also live in the `@theme` block.

There is no dark nav chrome, no `--color-surface-dark`, and no PIN-dot component in this app — the sidebar/tab bar are white (`--color-neutral-0`), and login is email/password over Supabase Auth rather than a native PIN-dot UI. There is no dark-mode variant yet (the Theme Sheet defines dark values, but the handoff says they are not applied to screens).

> **Tailwind gotcha.** An `@theme` variable only reaches the built CSS if some scanned source file references it — a token nobody reads is dropped. Reference tokens as literal `var(--color-x)` strings; a name assembled at runtime from a template string is invisible to the scan and vanishes from production.

---

## 2. Theme-axis tokens (tint × radius — runtime-switchable, `context/theme.context.tsx`)

Two theme axes, defaulting to **`amber` + `soft`**. These live in a plain `:root` block (not `@theme`) so `ThemeProvider` can override them at runtime via `data-tint`/`data-radius` attributes on `<html>` — see [styling.md](./styling.md) §3.

### 2.1 Tint — four options, four roles each

CTA is folded into tint (no separate CTA axis) — each tint owns its own CTA gradient, so no clashing tint/CTA pairs can be produced. Every tint exposes **four** color roles; using the right one is what keeps the UI at WCAG AA — never collapse them into a single "primary". The Theme Sheet's own rule is the same: *amber 600 is not a text colour* (it fails AA on white); amber 700 is.

| Role | Used for | Contrast requirement |
|---|---|---|
| `--tint-accent`  | Decorative fills only: progress bars, avatar tiles, toggle-on, chart bars, rules/edges | Vivid; never sits under small text |
| `--tint-ink`     | Accent-colored text/icons on white or `--color-surface-page` | ≥4.5:1 on white |
| `--tint-solid`   | Fills that carry **white** text: selected pills/tabs, count badges, CTAs that reuse the tint | ≥4.5:1 with `#fff` |
| `--tint-on-pill` | Text on `--tint-pill-bg`: active nav label, applied filter chips, role badges | ≥4.5:1 on pillBg |

| tint | card bg | border | accent | ink | solid | onPill | pillBg | cta |
|---|---|---|---|---|---|---|---|---|
| **amber** (default, v3) | `#fffbeb` | `#fde68a` | `#d97706` | `#b45309` | `#b45309` | `#92400e` | `#fef3c7` | `#b45309` → `#92400e` |
| wild (the v2 default) | `#fff4f0` | `#ffdccf` | `#ff5a2c` | `#c2410c` | `#c2410c` | `#9a3412` | `#ffe4d9` | `#c2410c` → `#9a3412` |
| sky | `#eff6ff` | `#dbeafe` | `#2563eb` | `#1d4ed8` | `#1d4ed8` | `#1e3a8a` | `#dbeafe` | charcoal |
| violet | `#f5f3ff` | `#ede9fe` | `#7c3aed` | `#6d28d9` | `#6d28d9` | `#5b21b6` | `#ede9fe` | charcoal (no dedicated violet gradient) |

charcoal CTA gradient: `#44403c` → `#1c1917` (stone, matching the v3 "stone" CTA tint). The contract above is **tested**: `design-tokens.test.ts` computes WCAG contrast for every tint's `ink` on white and on the page background, white on `solid` and on both CTA ends, and `onPill` on `pillBg`.

**Amber is the default and the only tint the v3 mockups show;** wild/sky/violet stay selectable in Settings > Appearance. The Theme Sheet says "one accent by design", so treat the other three as legacy options kept for now, not as peers to design new screens against.

**Stored preference & the versioned key.** `ThemeProvider` writes the theme to `localStorage` on *every* mount, so every device that ever opened the app already holds a value; changing the default alone would never reach an existing user. The key is therefore versioned (`flexhub-theme-v3`) and **must be bumped whenever the default changes**. v3 deliberately ignores the pre-v3 `flexhub-theme` key (left in place, harmless). Reading the stored value must stay defensive — a corrupt value, or a stale tint/radius (an old `emerald`/`rose` tint, a pre-v2 `pill` radius) must fall back per-field to the default, never white-screen the app — see `theme.context.tsx`'s `isTint`/`isRadius`/`loadStoredTheme`.

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
| Input (focused) | border = `--tint-accent`, box-shadow = `--tint-focus-ring` (soft glow) |
| Button / link (keyboard-focused) | `outline: 2px solid var(--tint-ink)` with `outline-offset: 2px` — one global rule in `index.css` (Theme Sheet: "a 2px amber 700 ring with a 2px offset, on every control") |
| Input (disabled) | bg = `--color-interactive-disabled-bg`, text = `--color-interactive-disabled-text` |
| Nav bar (mobile tab bar / desktop sidebar) | bg = `--color-neutral-0`; inactive = `--color-text-secondary`; active = `--tint-ink` (mobile tab: text + icon, **no pill**) or `--tint-on-pill` on a `--tint-pill-bg` row (the desktop sidebar's active item). Action Center count badge: desktop = `--tint-solid`, mobile tab = `--color-status-danger-text` (README) |
| Membership status pill | the **one** declaration is `styles/status.css`. **Active** = `--color-status-active-bg`/`-text` (neutral stone — amber is reserved for "can still act", red for lapsed); **Expiring** = `--color-status-warning-bg-subtle`/`-text-deep`; **Expired** = `--color-status-danger-bg`/`-text`. Amber vs red differ in fill weight as well as hue, and every pill carries a text label — status is never color alone |
| Screen background | `--color-surface-page` plus the 18px dot grid (`--color-surface-dots`) on `.app-shell` |
| Card surface | Always `--color-surface-card` with `--color-border-card` 1px border |

---

## 4. Usage Rules

1. Import colors only from `tokens.css`'s custom properties — never hardcode hex in a component (arbitrary Tailwind values like `bg-[#c0230a]` are the same violation via a different door, see [styling.md](./styling.md) §3). A unit test enforces this.
2. Only one CTA-gradient action per screen; secondary actions use outline/ghost styling. (Theme Sheet: amber appears once per screen region — if two amber things compete, one of them is not the primary action.)
3. `--color-status-*` tokens are semantic-only — never used decoratively (an avatar hash must never land on a status color by coincidence — this is exactly why the categorical `--color-data-*` palette exists separately, see `lib/avatar.ts`).
4. `--color-text-muted` (`#78716c`) is AA-safe body-size text on white and on the page background (≥4.5:1 — tested); it is for timestamps and hints. `--color-text-disabled` (`#a8a29e`) is for placeholders and disabled states **only** and is deliberately below AA — never use it for text a user must read.
5. Every tint's four roles (§2.1) must be used per their contrast contract — `--tint-accent` never sits under small text; a component needing accent-colored text uses `--tint-ink` (on white/`--color-surface-page`) or `--tint-on-pill` (on `--tint-pill-bg`) instead, and a solid fill carrying white text uses `--tint-solid`. Every `--tint-accent` usage in the codebase is a border, a native `accent-color` (checkbox tint), a focus-ring companion, or one of the role table's explicitly-allowed decorative fills (progress bars, avatar tiles, toggle-on, chart bars, donut slices). A newly-added component must still follow the same rule.
6. Admin screens share the same color system — no separate admin palette.
7. Respect the user's OS-level reduced-motion/contrast preferences where feasible (`prefers-reduced-motion`) — this token set has no dark-mode variant defined.
8. Don't add a second brand hue for variety, and don't put white type on amber 500/600 (below AA — use amber 700). Carry urgency with weight, fill and position before reaching for color.

---

## 5. Related docs

- [styling.md](./styling.md) — how `tokens.css`'s `@theme` block plugs into Tailwind, the breakpoint scale, and CSS-vs-JS rendering
- [action-center.md](./action-center.md) — first screen built against the tint/radius axis in this table
- `frontend/src/context/theme.context.tsx` — the runtime tint/radius switcher these tokens back
- `design_handoff_flexhub_mobile/Theme Sheet Stone and Amber.dc.html` — the rationale and the contrast pairs this file implements
