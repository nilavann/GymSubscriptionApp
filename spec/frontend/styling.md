# Styling — Tailwind CSS, Theming & Breakpoints

> Part of: [SPEC-WEB.md](../../SPEC-WEB.md) | App: Fit&Fine Gym Subscription Manager (Web)
> Referenced by [rules.md](./rules.md) rules 12, 14, and 16. This is the detailed write-up behind those rules — update this file first if the approach changes, then re-sync the rule summaries.

---

## 1. Why Tailwind, and why not a component library

[rules.md](./rules.md) rule 12 defaults to no third-party dependency, but asks for an explicit evaluation rather than a reflexive ban whenever a package would genuinely avoid reinventing the wheel. Two things were missing from this app before Tailwind: a tested **spacing/breakpoint scale** (the only breakpoint anywhere in the codebase was a single hardcoded `768px`, with no tablet tier — see §5's incident writeup) and a consistent way to write layout/spacing code without re-deriving values by hand in every `.css` file.

**Tailwind CSS was adopted because it solves exactly that gap without crossing the line rule 12 actually cares about**: it ships no pre-built components (no `<Button>`, no `<Dialog>`, no `<Table>`) — only utility classes for spacing, layout, color, and responsive variants. It doesn't impose a visual language the way MUI's Material elevation/ripples or Ant's density would, so it doesn't fight this app's own brand tokens (colors.md), and there's no pre-built component API to migrate off later if this decision needs revisiting. A full UI kit (MUI, Chakra, Ant Design, shadcn/ui, Bootstrap) remains off-limits per rule 12 for the reasons discussed there — this is a narrower, lower-risk adoption than any of those.

## 2. Setup

- `frontend/package.json` — `tailwindcss` + `@tailwindcss/vite` as devDependencies (Tailwind v4; no `tailwind.config.js` — v4 is CSS-first, configured entirely in `@theme`).
- `frontend/vite.config.ts` — `tailwindcss()` added to the Vite `plugins` array, alongside `react()`.
- `frontend/src/styles/tokens.css` — the color/breakpoint tokens live inside a Tailwind `@theme { ... }` block (not plain `:root`) — see §3.
- `frontend/src/index.css` — `@import 'tailwindcss';` then `@import './styles/tokens.css';`, in that order, at the top of the file. This is the one file Tailwind actually processes; per-page `.css` files (`MemberDetailPage.css` etc.) are untouched plain CSS as before and don't need to import Tailwind themselves.
- `frontend/src/main.tsx` — imports only `./index.css` now (previously imported `tokens.css` separately; folding it into `index.css`'s import chain is what puts it in Tailwind's processed graph).

## 3. Theming — one source of truth, no hex duplicated

`tokens.css`'s `@theme` block **is** the token file from [colors.md](./colors.md) — same names, same hex values, just wrapped in `@theme` instead of `:root`. Tailwind's `@theme` still emits every property as a real CSS custom property on `:root` under the hood, so:

- **Existing plain CSS keeps working unchanged**: `var(--color-brand-600)` resolves exactly as before.
- **New Tailwind utilities are generated for free**: any `--color-<name>` token automatically becomes `bg-<name>`, `text-<name>`, `border-<name>`, etc. — `--color-brand-600` → `bg-brand-600`/`text-brand-600`/`border-brand-600`.

**Tailwind's own default palette (`red-500`, `blue-600`, `gray-100`, `white`, `black`, ...) has been explicitly removed** (`--color-*: initial;` at the top of the `@theme` block, before this app's own tokens are declared). This isn't optional cleanup — without it, `bg-red-500` would be a silent, always-available escape hatch around the token system, defeating rule 14's "never hardcode a color" rule via a different door. If a utility class for a token doesn't exist, the token is missing from `tokens.css`, not "use Tailwind's stock color instead."

**Adding a new color**: add it to `colors.md` first (per that file's own process), then add the same name/hex pair to `tokens.css`'s `@theme` block. Never add a color directly in a component file, whether as a hex value, an inline `style`, or an arbitrary Tailwind value (`bg-[#ff0000]`) — all three bypass the token file the same way.

One token is deliberately **excluded** from `@theme`: `--color-shadow` (used only as a `box-shadow` color value). Tailwind would otherwise generate a `text-shadow` utility from it — a *color* utility that happens to share its class name with the real CSS `text-shadow` property, which reads as "applies a text shadow" but actually just sets `color`. It's declared as a plain `:root` custom property instead, right below `@theme`, so `var(--color-shadow)` still works everywhere it's already used.

## 4. Breakpoints — three tiers, not two

### The incident that motivated this

The member detail page (`/members/:id/edit`) had its "Current Membership"/"Subscription History" content visually crowding into the "Personal Details" column at tablet widths. Root cause: `AppShell.css`'s sidebar (`240px`, fixed) and `MemberDetailPage.css`'s left column (`360px`, fixed) both activate at the **same single breakpoint** (`768px`) — which was the *only* breakpoint anywhere in the app. At a 768–810px viewport (iPad portrait, most small Android tablets), the math is `768 − 240 (sidebar) − ~64 (content padding) − 360 (fixed left column) − 16 (gap) ≈ 88px` left for the entire right-hand column. Two independently-reasonable fixed-pixel decisions, each fine in isolation, compounded at the one seam the app had no intermediate tier to absorb.

This is the general failure mode a two-tier (mobile/desktop) system invites once a layout has more than one fixed-width element: nothing forces anyone to check the *boundary*, only "mobile" and "desktop" as presets. Material Design 3, Bootstrap, and Tailwind's own defaults all converge on **three tiers** (phone/tablet/desktop) for exactly this reason — see the design-system comparison discussion for the fuller industry survey.

### The scale

Defined in `tokens.css`'s `@theme` block, replacing Tailwind's default `sm`/`md`/`lg`/`xl`/`2xl` scale entirely (`--breakpoint-*: initial;`, then two custom names):

| Tier | Range | Tailwind variant | Notes |
|---|---|---|---|
| Mobile | `<768px` | *(unprefixed — the default)* | Single column, stacked, reading order. Unchanged from before. |
| Tablet | `768–1023px` | `tablet:` | **New.** The tier most likely to be skipped — verify it explicitly, don't assume desktop layout survives down to 768px. |
| Desktop | `≥1024px` | `desktop:` | Full multi-column layouts. |

`sm:`/`md:`/`lg:`/`xl:`/`2xl:` are not available in this project — using one is a mistake (there's no config for it to fall back to), not an alternate way to write the same thing. This is deliberate: one documented breakpoint system, not two running in parallel where it's ambiguous which one a given class belongs to.

Example: `<div class="flex flex-col tablet:flex-row desktop:gap-8">` — stacked by default, row from 768px up, extra gap from 1024px up.

## 5. What "best practices" means day to day

- **New components/screens**: prefer Tailwind utility classes for layout, spacing, and responsive behavior. Reach for the color utilities (`bg-brand-600`) over `var(--color-brand-600)` in a separate `.css` file when the two are equivalent — fewer files, the responsive variant and the color live next to each other in the JSX.
- **Existing per-page `.css` files are not being mass-migrated.** They keep working as plain CSS. Convert a page's CSS to Tailwind utilities only when you're already touching that page for another reason (a bug fix, a new field) — opportunistic, not a dedicated rewrite sprint. `rules.md`'s compliance table tracks rule 16 per screen; use it to prioritize which pages get the tablet-tier check first (Member Detail is the confirmed-broken one; the rest are unverified, not confirmed-good — see that table's note).
- **Plain CSS is still the right tool** for: keyframe animations, complex `:has()`/sibling selectors, and anything where the utility-class version would be meaningfully harder to read than three lines of CSS. Tailwind doesn't replace CSS, it replaces *hand-writing spacing/layout/color values from scratch*.
- **Never use an arbitrary value** (`bg-[#c0230a]`, `mt-[13px]`) as a substitute for adding a proper token — arbitrary values are an escape hatch for genuine one-offs (a third-party embed's exact pixel requirement, say), not a way to avoid updating `tokens.css`.
- **Every new responsive layout decision gets checked at exactly 768px and exactly 1024px**, not just "small phone" and "big monitor" presets — that boundary is where the incident in §4 actually lived, and it's invisible unless you look there specifically.

## 6. Related docs

- [rules.md](./rules.md) rules 12 (dependency policy), 14 (color tokens), 16 (responsive tiers)
- [colors.md](./colors.md) — the token catalog `tokens.css`'s `@theme` block mirrors
- [app-shell.md §3](./app-shell.md#3-responsive-layout-shell-websrccomponentsappshelltsx) — the app shell's own sidebar/tab-bar responsive behavior
