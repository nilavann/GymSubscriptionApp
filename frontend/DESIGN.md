---
name: Fit & Fine
description: Light, front-desk-friendly operations console with a configurable tint/CTA/radius theme.
colors:
  neutral-900: "#111827"
  neutral-500: "#6b7280"
  neutral-400: "#9ca3af"
  neutral-300: "#d1d5db"
  neutral-200: "#e5e7eb"
  neutral-150: "#f1f1f3"
  neutral-100: "#f5f5f6"
  neutral-75: "#f9fafb"
  neutral-50: "#f3f4f6"
  neutral-0: "#ffffff"
  data-1: "#2563eb"
  data-2: "#7c3aed"
  data-3: "#059669"
  data-4: "#b45309"
  data-5: "#be123c"
  data-6: "#0891b2"
  status-success-bg: "#dcfce7"
  status-success-text: "#15803d"
  status-warning-bg: "#fef3c7"
  status-warning-text: "#b45309"
  status-danger-bg: "#fee2e2"
  status-danger-text: "#b91c1c"
typography:
  page-title:
    fontSize: "1.375rem"
    fontWeight: 700
  hero-name:
    fontSize: "1.2rem"
    fontWeight: 700
  section-title:
    fontSize: "0.72rem"
    fontWeight: 700
    letterSpacing: "0.05em"
  body:
    fontSize: "0.85rem"
    fontWeight: 400
  small:
    fontSize: "0.78rem"
    fontWeight: 400
  caption:
    fontSize: "0.72rem"
    fontWeight: 700
rounded:
  el: "12px (soft) / 999px (pill) / 6px (sharp)"
  card: "28px (soft) / 40px (pill) / 10px (sharp)"
  tile: "16px (soft) / 999px (pill) / 6px (sharp)"
  pill: "999px (constant)"
spacing:
  xs: "0.35rem"
  sm: "0.75rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
components:
  button-primary:
    background: "linear-gradient(to bottom, var(--cta-from), var(--cta-to))"
    textColor: "{colors.neutral-0}"
    rounded: "{rounded.el}"
  chip-selected:
    background: "var(--tint-pill-bg)"
    textColor: "var(--tint-accent)"
    rounded: "{rounded.pill}"
  card:
    backgroundColor: "{colors.neutral-0}"
    border: "1px solid {colors.neutral-150}"
    rounded: "{rounded.card}"
---

# Design System: Fit & Fine

## Overview

**Creative North Star: "The Configurable Front Desk"**

Fit & Fine's second visual generation replaces the earlier flat, single-accent "Coral Jam" system with a lighter, softer console built around a genuinely configurable theme: three independent axes — **tint**, **CTA color**, and **corner radius** — combine into the app's whole visual identity, switchable at runtime (`ThemeProvider`, `src/context/theme.context.tsx`) without a page reload. The default combination is **sky tint + charcoal CTA + soft radius**. Gradients, previously banned outright, are now a first-class device: every primary action button and the login/current-membership cards carry a soft two-stop gradient. Status color (success/warning/danger) and the categorical avatar palette are untouched by any of the three axes — they stay fixed regardless of theme choice, so "this needs attention" and "this member's avatar happens to be blue" never get relitigated by a tint change.

**Key characteristics:**
- Three theme axes (tint × CTA × radius) drive nearly every visual token in the app — see Theming below. Nothing else in the system is user-configurable.
- Tint accent is the one color that means "this is selected/active/interactive" — active nav item, active filter chip, active status pill, progress bars, the Reports donut's Cash slice, focus rings.
- CTA gradient is reserved for the primary action in a given context — "Sign in," "Create member," "Save checkout," "+ Add [X]." Never used for anything else.
- Status (success/warning/danger) and the 6-color categorical avatar palette are both independent, fixed palettes — never re-themed, never reused for brand/interactive meaning.
- Cards are white on a light gray page background (`--color-surface-page`, `#f3f4f6`), with ambient shadows only — no heavy borders as the primary depth cue on interactive surfaces, though a hairline `--color-border-card` (`#f1f1f3`) still separates card from page.
- Single system-font stack (`-apple-system, "Segoe UI", system-ui, sans-serif`) throughout — no webfont loading, no two-typeface split.
- Every interactive control keeps the inherited 44×44px minimum touch target.

## Theming (tint × CTA × radius)

Implemented as plain CSS custom-property overrides in `src/styles/tokens.css`, keyed by `data-tint` / `data-cta` / `data-radius` attributes that `ThemeProvider` sets on `<html>` and persists to `localStorage`. Because every component consumes these as `var(--tint-accent)` etc. (never a hardcoded hex), switching the attribute re-themes the whole app live.

| Axis | Options | What it drives |
|---|---|---|
| `tint` | `sky` (default) / `violet` / `emerald` / `amber` / `rose` | `--tint-card-from/-to` (login & current-membership card gradient), `--tint-border`, `--tint-accent` (active nav/pills/links/focus rings/donut Cash slice), `--tint-pill-bg` (selected chip/badge background) |
| `cta` | `charcoal` (default) / `orange` / `blue` | `--cta-from/-to` — the two-stop gradient on every primary button |
| `radius` | `soft` (default) / `pill` / `sharp` | `--radius-card` (28/40/10px), `--radius-el` (12/999/6px, inputs/buttons), `--radius-tile` (16/999/6px, avatars/icon tiles). `--radius-pill` (chips/badges) stays `999px` at every setting — pills don't reshape with the rest of the UI. |

An admin-facing picker lives on the Settings Hub (`SettingsPage`, "Appearance" section) — swatch buttons per option, immediately applied. This is a browser-local preference (`localStorage`), not a synced org-wide setting.

## Colors

### Neutral / surface
The whole app sits on a light neutral scale — no dark "counter" chrome tier exists in this generation (the previous dark topbar/sidebar has been removed). `--color-surface-page` (`#f3f4f6`) is the page background; `--color-neutral-0` (white) is every card/panel surface; `--color-surface-input` (`#f9fafb`) is the resting fill for text inputs. Text uses `--color-text-primary` (`#111827`) / `-secondary` (`#6b7280`) / `-muted` (`#9ca3af`) / `-disabled` (`#d1d5db`).

### Tint (themeable)
Five options (see Theming). Each pairs a very light two-stop gradient (login card, current-membership card), a matching hairline border, and one accent hex used for every "this is active/selected/interactive" moment app-wide. Never used as a large flat fill outside the two gradient-card contexts.

### CTA (themeable)
Three two-stop vertical gradients (`charcoal` default: `#374151 → #111827`; `orange`: `#f97316 → #c2410c`; `blue`: `#3b82f6 → #1d4ed8`). The only place a gradient appears besides the tint-card backgrounds. Reserved for primary buttons only — secondary/ghost buttons stay white/bordered, destructive actions stay in the fixed danger palette below.

### Status (fixed, never themed)
Each status has a badge-strength pair (bg/text) and a lighter banner-strength pair (`-bg-subtle`), plus a deeper text variant for banners:
- **Success**: `#dcfce7`/`#15803d` (badges), `#ecfdf5`/`#047857` (banners).
- **Warning**: `#fef3c7`/`#b45309` (badges), `#fffbeb`/`#92400e` (banners).
- **Danger**: `#fee2e2`/`#b91c1c` (badges), `#fef2f2`/`#dc2626` (inline field errors).

### Categorical (fixed, never themed)
Six hues for member-avatar hashing (`lib/avatar.ts`) — `#2563eb #7c3aed #059669 #b45309 #be123c #0891b2`. Carries no brand or status meaning; never reused for interactive/brand color, same rule as the previous generation.

### Named rule: the tint/CTA/status/categorical separation
Four independent color systems that never borrow each other's values. Tint means "selected/active." CTA means "the primary action here." Status means "this needs attention" (or doesn't). Categorical means "this row/segment is distinct from its neighbors, nothing more." A value moving between these roles — e.g. a status color reused as a CTA gradient stop, or an avatar color coinciding with the danger palette by anything other than hash coincidence — is a defect.

## Typography

System font stack only (`-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`) — no Google Fonts/webfont loading, no heading/body typeface split. Weight and size carry the hierarchy that a second typeface used to.

### Size ramp

The full scale (per the mockup handoff's Design Tokens section), in px and the `rem` a 16px root produces — every font-size in the app should land on one of these steps:

| px | rem | Typical use |
|---|---|---|
| 11 | 0.6875rem (~`0.68rem`) | Micro labels — login/footer fine print, mobile tab-bar labels |
| 11.5 | 0.71875rem (~`0.72rem`) | Section titles (uppercase, `0.05em` tracking), captions/badges |
| 12 | 0.75rem | Small pills, result counts |
| 12.5 | 0.78125rem (~`0.78rem`) | Secondary card lines, table cells |
| 13 | 0.8125rem | — |
| 13.5 | 0.84375rem (~`0.85rem`) | Body — form inputs, primary reading copy |
| 14.5 | 0.90625rem (~`0.9rem`) | Comfortable secondary text, primary-button labels |
| 15 | 0.9375rem | — |
| 17 | 1.0625rem (~`1.05rem`) | Current-membership plan name, Reports donut total |
| 19 | 1.1875rem (~`1.2rem`) | Hero name (member-detail) |
| 21 | 1.3125rem | — |
| 22 | 1.375rem | Page title (`<h1>`, global rule in `index.css`), login/reset brand title |
| 26 | 1.625rem | — |

Weights: 500/600/700 only — no 400 outside plain body copy, no 800+.

`font-variant-numeric: tabular-nums` still applies to member numbers, sequence counts, and pill counts.

## Layout

Unchanged breakpoint convention: mobile-first, single documented cutover at `768px` (`--breakpoint-tablet`). Below 768px: single-column, fixed bottom tab bar, card lists. At/above 768px: a `240px` fixed sidebar (light, not dark — see Navigation below) + fluid content, tables replace card lists, bottom tab bar disappears. Content stays capped at `1200px` and centered. A handful of pages layer their own narrower sub-breakpoints from the mockup spec (e.g. Member Detail's two-column split at `760px`, Reports/Settings grid collapses at `980px`) as plain `@media` queries in their own CSS files — these aren't part of the shared token system.

## Elevation & Depth

Flat by default; shadows are the primary depth cue, now noticeably softer and lower-contrast than the previous generation:
- **Card/resting**: `0 1px 3px var(--color-shadow)`, where `--color-shadow` is now `rgba(17, 24, 39, 0.08)` (was `0.35`) — a much lighter ambient shadow matching the mockup's `0 20px 40px rgba(17,24,39,.08)` login-card spec, scaled down for smaller surfaces.
- **Overlay** (login/reset card, modals): `0 20px 40px var(--color-shadow)`.
- **Drawer/backdrop**: `--color-backdrop`, `rgba(17, 24, 39, 0.35)` — the filter drawer and delete-confirmation dialogs both use this fixed (non-themed) scrim.

## Shapes

Every corner radius on cards, inputs, buttons, and tiles is theme-driven (see Theming) — there is no longer a single fixed radius scale to document independently of the `radius` axis. Pills (chips, badges, avatars-as-circles) stay `999px`/`50%` regardless of the radius axis. One fixed exception outside the axis system: small inline icon-affordances (e.g. the login password show/hide toggle) use a flat `6px` — these are chrome details on an input, not a themeable surface, so they don't scale with the `radius` axis.

## Navigation

No persistent dark topbar in this generation. The sidebar (`≥768px`) is white, carries the brand mark (logo tile + "Fit & Fine") at its own top, and its active item uses `--tint-pill-bg` background + `--tint-accent` text — no left-border accent. The mobile bottom tab bar is white with a top hairline border; active tab is tint-accent icon/label color only. Sign-out lives in the Settings Hub's Account section, not in persistent chrome. Every admin/data-management screen (Plans, Branches, Users, Roles, Audit Log, Numbering) additionally renders a shared pill sub-tab row (`components/AdminTabs.tsx`) so an admin can jump between them without returning to the Settings hub each time.

## Components

### Buttons
Primary: CTA gradient background, white text, 700-weight label. Secondary/ghost: white background, `--color-border-default` border. Destructive: fixed danger palette, never the CTA gradient (Delete must never look like Save).

### Chips / pills / badges
Unselected: white bg, `--color-border-default` border. Selected (filter chips, category tags, active status pill): `--tint-pill-bg` background + `--tint-accent` text — the one shared "selected" treatment across the app (filter chips, gender/category pickers, Renew's Membership/Add-on tag, admin sub-tabs).

### Toggle switch
Doctor's-care and similar boolean fields use a real 44×24px switch (`--color-neutral-200` off, `--tint-accent` on) rather than a Yes/No chip pair.

### Skeleton loading
Unchanged pattern: shimmering `neutral-50 → neutral-150 → neutral-50` gradient block, reused verbatim across every list screen.

## Do's and Don'ts

### Do
- **Do** drive every color/radius/gradient decision through the three theme axes' tokens (`--tint-*`, `--cta-*`, `--radius-*`) — never hardcode a hex that duplicates what an axis already provides.
- **Do** keep Status and Categorical completely independent of the active theme — a tint change must never shift a status badge's or an avatar's color.
- **Do** reserve the CTA gradient for the single primary action in a given context.
- **Do** keep the 44×44px touch-target floor at every breakpoint.

### Don't
- **Don't** introduce a fourth color role beyond tint/CTA/status/categorical.
- **Don't** use a gradient anywhere except CTA buttons and the tint-card backgrounds (login, reset-password, current-membership) — everything else stays a flat fill.
- **Don't** style a route-level `<h1>` per-page — the global rule in `index.css` is the one source for that treatment.
- **Don't** reintroduce a second typeface — the system-font-only choice is deliberate for this generation.
