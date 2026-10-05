# Handoff: FlexHub Mobile (v3, Stone & Amber) — Fit & Fine Gym

## Overview
Mobile layouts (390px phone) for all nine screens of the Fit & Fine gym staff app: Login, Members, Action Center, Member Detail, Renew / Add Subscription, Add Member, Edit Member, Reports, Settings. Mobile is **not a separate design** — it is the same responsive app at ≤860px. This bundle documents what changes at that breakpoint and the v3 Stone & Amber theme.

## About the Design Files
The files here are **design references created in HTML** — prototypes showing intended look and behavior, not production code. Recreate them in the target codebase (React + React Router + Supabase web app, with a sibling Expo/React Native app) using its existing patterns and Tailwind setup. Do not ship the HTML.

- `Gym App Mobile v3.dc.html` — frame board: nine iPhone frames, each an iframe of the desktop file at `?screen=<id>&embed=1`. Open this to see every mobile screen side by side; each frame is tappable.
- `Gym App Mockups v3.dc.html` — the single source of all screens. `embed=1` hides the mockup screen-switcher bar and pads for the device status bar / home indicator. Resize the browser below 860px to see the mobile layout directly.
- `Theme Sheet Stone and Amber.dc.html` — token sheet with rationale (light + dark columns, contrast pairs).
- `ios-frame.jsx`, `support.js` — mockup runtime only. Do not implement.

Screen ids: `login`, `membersCopy` (Members), `action`, `detail`, `renew`, `add`, `edit`, `reports`, `admin` (Settings).

**Mockup-only, do not build:** the top screen-switcher bar, "Simulate network error" toggle, and the login variant chips above the login card (they switch between login states for review).

## Fidelity
**High-fidelity.** Colors, type, spacing, copy and states are final intent.

## Operating constraints (why the theme looks this way)
Staff use cheap-to-decent laptops and their own phones, in mixed daylight, during early-morning / afternoon / evening rushes; staff are rotating part-timers; nothing is printed. So: status must be readable at a glance on low-quality panels (separate hue **and** fill weight), touch targets ≥44px, no hover-only information, no dependency on color alone.

## Breakpoints
Align to the codebase's existing 768px convention where it differs from the mockup's 860px cut.

| Width | Change |
|---|---|
| ≤ 1100px | Action Center carousel: 2 cards in view |
| ≤ 980px | Reports tiles 4→2 col, report grid →1 col, admin list+form →1 col, hub cards 3→2 col |
| ≤ 860px (**mobile**) | Sidebar hidden → fixed bottom tab bar; members table → stacked member cards; desktop footer hidden → legal links list (Settings); header user name hidden (avatar only) |
| ≤ 760px | Member Detail 2→1 col; Action Center cards 88% width (peek of next card) |
| ≤ 720px | Members card view → 1 col |
| ≤ 640px | All form grids 2→1 col; hub cards →1 col |

## Mobile shell
- **Header** (all screens except Login): 58px, `#ffffff`, bottom border `1px #e7e5e4`, padding 0 20px. Left: `assets/logo.png` (24×18) + "Fit & Fine Gym" (Schibsted Grotesk 15.5px/700, letter-spacing −0.015em, `#1c1917`). Right: 28px round avatar `#292524`, white initials 11px/700. The "Priya S · Admin" label is hidden on mobile.
- **Page background**: `#fafaf9` with a dot grid — `radial-gradient(#f4e2ce 1px, transparent 1px)`, 18px tile.
- **Content**: single scroll container between header and tab bar; bottom padding clears the tab bar (≈96px including home indicator / safe-area inset).
- **Bottom tab bar** — shown on Action Center, Members, Reports, Settings only (hidden on Login, Detail, Renew, Add, Edit, which use a back arrow instead):
  - Fixed bottom, full width, `#ffffff`, top border `1px #e7e5e4`, padding `8px 6px` + `env(safe-area-inset-bottom)`; items `justify-content: space-around`.
  - Order: **Action Center · Members · Reports · Settings**. Each tab: flex 1, min-height 48px, 20px Lucide-style icon (2px stroke) over label 10.5px.
  - Inactive `#57534e`/400; active `#b45309`/500. No pill or background on active.
  - Action Center icon carries a count badge: min 16×16, `#b91c1c`, white 10px/700, offset top −6 / right −10. Value = total queue size.
  - Staff see Action Center, Members, Reports; Admins also see Settings.

## Screens (mobile behavior)

### Login
Centered card, `max-width 380px`, padding 36/32, gradient `#fffbeb → #fff`, border `#fde68a`, radius 28, shadow `0 20px 40px rgba(58,31,12,0.08)`. Logo 64px tall. "Welcome to Fit & Fine" 22px/600; sub "Staff portal. Sign in to manage members." 13.5px `#57534e`. Username + 4-digit PIN inputs, full-width "Sign in" CTA, Google button (42px). Banners for wrong credentials / deactivated / reset sent / network error; signed-out state with redirect bar. Identical to desktop, card fills width minus 24px side padding.

### Members
- Title + "+ Add Member"; search full width; Filters button opens a right drawer (`320px`, `max-width 85vw`, backdrop `rgba(17,24,39,0.35)`).
- Status pills (All / Active / Expiring / Expired with counts) scroll horizontally if they overflow; do not wrap to a second line.
- **Rows become cards**: white, radius 14, border `1px #e7e5e4`, padding 14, gap 12, 10px between cards. Avatar 38px (radius 16) left. Right column: row 1 name 14.5px/600 `#1c1917` + status pill right-aligned; row 2 member # 12.5px `#57534e`; row 3 "Plan · Phone" 13px `#57534e`; row 4 expiry text 12.5px `#57534e`. Whole card taps → Member Detail. Long names ellipsize; expose full name without hover.
- Card view toggle: grid → 1 column ≤720px.

### Action Center
- Header "Action Center" + disabled "Send renewal reminders" (`#f5f5f4` bg, `#a8a29e` text, `cursor:not-allowed`). Two summary cards wrap (min-width 180px).
- Tabs: Expiring soon (default) / Expired, with counts. Selected = `#b45309` fill, white text.
- Horizontal snap carousel: cards 88% width so the next card peeks; `scroll-snap-type: x mandatory`; swipe is the primary gesture (arrow buttons are a desktop affordance). Card: 76px avatar left, name 15.5px/700, member #, phone, status pill, then plan, expiry, Renew (CTA) + View (ghost) buttons ≥44px tall.
- See **Status ladder** below — the four-state queue supersedes the two tabs.

### Member Detail
Back arrow, no tab bar. Single merged profile + membership card (Active / Expired / No plan strip). Info columns stack to one column ≤760px in this order: Personal, Medical, Emergency, Add-ons, Subscription history. Edit / Delete buttons stay in the hero; Renew CTA full width inside the membership strip.

### Renew / Add Subscription
Back arrow. Payment card (Cash / UPI / Card chips + notes), repeatable item cards, overlap warning, "+ Add another item", total footer. Form grids go to 1 column ≤640px; quantity chips wrap. Cancel / Save checkout buttons fill the footer row.

### Add Member / Edit Member
Back arrow. Section cards (Identity, Body metrics, Medical, Emergency contact, Optional details, Staff record, Photo) in 1 column ≤640px. Gender stays as 3 equal chips. Phone/pincode use `inputMode="numeric"`. Photo offers both "Take Photo" and "Upload Photo". Edit shows the validation state (error summary + inline errors). Footer Cancel + primary.

### Reports
Range chips scroll horizontally. Tiles 2×2. Cards stack: Payment modes, Transactions, New registrations, Expiring this week. Fixed-height scroll areas (transactions 340px, expiring 230px) keep internal scroll.

### Settings
Sub-tab pills scroll horizontally. Hub cards 1 column. List + form panels stack (form below list). Desktop footer is replaced by a **legal links list** at the bottom of the hub: white card, radius 16, padding 6px 16px; each link a 44px-min row (13.5px/500 `#44403c`, chevron right, dividers `#f5f5f4`): Privacy Policy, Terms of Use, Refund Policy, Support.

## Status ladder (decided, partly built)
The v3 screens still use a **two-state** model (Expiring Soon / Expired). The agreed model, already built in `Action Center Neo-Geo.dc.html` (included; desktop layout, different visual style — take the state logic from it, not the styling), is six states with all states keeping a pill so they read as one set:
- Active — no flag in queues, neutral pill `#f5f5f4` / `#292524`.
- **This week** (expires in ≤7 days, still saveable) — amber, light fill `#fffbeb` / `#92400e`.
- **Lapsed** (expired < 90 days) — red, heavier fill `#fee2e2` / `#b91c1c`.
- **Dormant** (expired ≥ 90 days) — red, separated from Lapsed by weight.
- No plan — `#f5f5f4` / `#57534e`.
Queue window shrinks from 30 days ahead to **7 days**. Amber vs red differ in fill weight as well as hue so they survive cheap panels. Rolling the ladder into Members, Member Detail and Renew is an open decision — confirm before building those.

## Interactions
- Tap targets ≥44px; no hover-only info (names' `title` tooltips need a tap/long-press equivalent).
- Card/row tap → detail; inner buttons stop propagation.
- Transitions 150ms on background/border/color; buttons translateY(1px) on press. Entrance `gmRise` (opacity 0→1, translateY 7px→0) on lists.
- Network errors: list screens show full-area retry; forms show a non-destructive banner and keep input.
- Carousel: `scrollBy` one card **without** `behavior:'smooth'` (snap cancels smooth programmatic scroll).

## State
- `screen` maps to routes: `/login`, `/`, `/action-center`, `/members/:id`, `/members/:id/renew`, `/members/new`, `/members/:id/edit`, `/reports`, `/settings`.
- Members: query, statusPill, filters {gender[], plan[], addon[]}, sort, cardView — client-side over one fetch.
- Action Center: active tab; server-side sorted sets (upcoming ascending, expired descending).
- Checkout: paymentMode, notes, items[]; exactly one membership item gates Save.

## Design tokens (Stone & Amber, light)
**Type** — UI: Rubik 300/400/500/600. Display / brand: Schibsted Grotesk 500–800. Sizes 10.5 / 11 / 11.5 / 12 / 12.5 / 13 / 13.5 / 14.5 / 15.5 / 17 / 19 / 22 / 26px.

**Neutrals (stone)** — text `#1c1917`, text-mid `#44403c`, text-secondary `#57534e`, text-muted `#78716c`, placeholder/disabled `#a8a29e`, border-subtle `#e7e5e4`, border-strong `#d6d3d1`, surface-sunken `#f5f5f4`, page `#fafaf9`, surface `#ffffff`, inverse `#292524`, row divider `#f3e8db`.

**Amber (brand / action)** — accent-mark `#d97706` (fills, rules, never behind text), action/ink/solid `#b45309`, onPill/accent-text `#92400e`, pressed `#78350f`, accent-surface `#fffbeb`, accent-border `#fde68a`, focus ring `#b45309` 2px / 2px offset.

**CTA** — `linear-gradient(145deg, #b45309, #92400e)`, white label, shadow `0 4px 10px rgba(58,31,12,0.12)`. Alternate "stone" tint uses `linear-gradient(to bottom, #44403c, #1c1917)`.

**Status** — see Status ladder. Danger banner `#fef2f2` / `#fecaca` / `#b91c1c`; success `#ecfdf5` / `#a7f3d0` / `#047857`.

**Avatars** — `#b45309 #b45309 #92400e #292524 #92400e #1c1917`, white initials, hashed by member id.

**Radii (soft, default)** — card 28, element 12, tile 16, pill 999. Mobile list cards 14–16. Sharp alt: 10 / 6 / 10 / 6.

**Shadows** — warm, low: `rgba(58,31,12,0.08–0.15)`. Only on login card, CTAs, active segmented toggle.

**Dark values** are in the Theme Sheet (second column) — not yet applied to screens.

## Assets
- `assets/logo.png` — brand logo (header 24×18, login 64px tall).
- Icons: inline Lucide-equivalent SVGs, 2px stroke — use the codebase's Lucide package.
- Data is placeholder.
