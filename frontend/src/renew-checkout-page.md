# Renew / Add Subscription — Checkout

Detailed build spec for one screen. Source of truth: `Gym App Mockups.dc.html`, screen `renew`
(open the mockup, click **Renew** in the screen switcher). Defaults assumed below: tint `sky`,
CTA `charcoal`, radius `soft`.

---

## 1. Purpose and model

One checkout = one payment event containing **one or more line items**. A line item is either a
**Membership** or an **Add-on**. Payment mode and notes are recorded once, at the checkout level —
not per item.

Rules the UI enforces:

- Exactly **one Membership item** per checkout. Zero → block save. Two or more → block save.
- Zero or more Add-on items.
- Each item computes its own end date from `start + (plan duration × quantity)`. The end date is a
  **preview only**; the server recomputes it on save.
- If an item's date range overlaps an existing active subscription of the same plan, show a
  non-blocking warning with an explicit *Save anyway* affordance.
- Total = sum of `amount paid` across items. `amount paid` is editable, so total ≠ plan price sum
  is legal (partial payments).

### Route

`/members/:memberId/renew`

Entered from the member detail page (**Renew / Add subscription** button). Back arrow and
**Cancel** both return to `/members/:memberId` — Cancel prompts for confirmation only if items were
edited.

### Payload shape

```json
POST /api/members/FF-0231/checkouts
{
  "paymentMode": "cash" | "upi" | "card",
  "notes": "string, max 200",
  "items": [
    {
      "type": "membership" | "addon",
      "planId": "uuid",
      "startDate": "2026-08-13",
      "quantity": 1,
      "amountPaid": 12000,
      "overlapAcknowledged": false
    }
  ]
}
```

Response returns each item's server-computed `endDate` and the generated receipt number.

---

## 2. Layout

Full-width app header (56px, gym logo + name left, signed-in user right), then a single centered
column:

| Property | Value |
|---|---|
| Column max-width | 760px (`box-sizing: border-box`) |
| Column padding | `26px 20px 60px` |
| Page background | inherited page grey |
| Card gap | 14px (`margin-bottom` on each card) |

Stack order, top to bottom:

1. Title row — back button + `h1`
2. Subtitle line
3. Payment card
4. Line-item cards (one per item, repeated)
5. *+ Add another item* dashed button
6. Network-error banner (conditional)
7. Checkout footer (total + actions)

### Title row

- Back button: 32×32, `border-radius: 9px`, `1px solid #e5e7eb`, white fill, arrow-left icon
  15×15, stroke `#6b7280`.
- `h1`: 21px / 700 / `#111827`, text **"Renew / Add Subscription"**.
- Gap between button and heading: 10px. Row `margin-bottom: 6px`.
- Subtitle: 13px / `#9ca3af`, `margin: 0 0 18px 42px` (aligns under the heading, not the button).
  Content: `{member name} · {member #} · one checkout, one or more items`.

### Card shell (all cards)

```css
background: #fff;
border: 1px solid #f1f1f3;
border-radius: 16px;
padding: 20px 22px;
margin-bottom: 14px;
```

### Section title (inside cards)

```css
font-size: 11.5px; font-weight: 700; color: #9ca3af;
text-transform: uppercase; letter-spacing: .05em; margin-bottom: 14px;
```

### Two-column form grid

`gm-form-grid`: two equal columns, 14px column gap, 14px row gap. Collapses to one column below
**640px**.

### Field label

```css
display: block; font-size: 12.5px; font-weight: 600; color: #374151; margin-bottom: 6px;
```

Required marker: `<span style="color:#dc2626">*</span>` after the label text, preceded by a space.

### Field input

```css
width: 100%; box-sizing: border-box; padding: 9px 12px;
border-radius: 10px; border: 1px solid #e5e7eb; background: #f9fafb;
font-size: 13px; color: #111827; outline: none;
```

Error variant: `border: 1.5px solid #f87171; background: #fef2f2`.

### Helper text under a field

11.5px / `#9ca3af`, `margin-top: 4px`.

---

## 3. Payment card

Section title: **PAYMENT**. Two grid columns.

**Payment mode** (required) — three segmented chips filling the row, `display:flex; gap:8px`, each
`flex:1`:

| State | Style |
|---|---|
| Selected | `padding:8px 0; border-radius:10px; border:1.5px solid #2563eb; background:#eff6ff; color:#2563eb; font-size:13px; font-weight:600` |
| Unselected | `padding:8px 0; border-radius:10px; border:1px solid #e5e7eb; background:#fff; color:#6b7280; font-size:13px; font-weight:500` |

Options, in order: **Cash**, **UPI**, **Card**. Default selection: **Cash**. Single-select, always
one selected — no empty state, so this field can never fail validation.

**Notes** (optional) — single-line text input. Label suffix: `(optional, ≤ 200 chars)` in 400 weight
`#9ca3af`. Placeholder: `e.g. paid partially, balance next week`. Hard-cap input at 200 characters;
no counter shown until 180 characters, then show `{n}/200` in helper position.

---

## 4. Line-item card

Repeated once per item. Card shell as above.

### Item header row

`display:flex; align-items:center; justify-content:space-between; margin-bottom:14px`.

Left: a category tag badge, `padding:2px 8px; border-radius:999px; font-size:10.5px; font-weight:600`:

| Category | Background | Text |
|---|---|---|
| Membership | `#dbeafe` | `#2563eb` |
| Add-on | `#fef3c7` | `#b45309` |

Right: delete button, 28×28, `border-radius:8px`, `1px solid #e5e7eb`, white fill, trash icon 12×12
stroke `#9ca3af`. Removes the item immediately (no confirm) but disabled when the item is the only
Membership in the cart — hovering the disabled button shows tooltip *"A checkout needs one
membership."*

### Item fields — 2×2 grid

**1. Plan** (required) — `select`. Option label format: `{Plan name} · {duration} · ₹{price}`
(e.g. `Gold Plan · 6 months · ₹12,000`). Options are filtered by the item's category: a Membership
item lists only membership plans, an Add-on item lists only add-on plans. Changing the plan resets
`amount paid` to `price × quantity` and recomputes the end preview.

**2. Start date** — native `date` input. Defaults:

- Membership item → day after the member's current membership expiry.
- Add-on item → day after that add-on's current expiry, or today if none.

Helper text: `Defaults to day after current membership expires.` (swap "membership" for "add-on" on
add-on items). Editable; no past-date restriction, but a past start date shows the helper text in
`#b45309`.

**3. Quantity** — chip row, `display:flex; gap:6px; flex-wrap:wrap`:

| State | Style |
|---|---|
| Selected | `padding:6px 11px; border-radius:999px; border:1.5px solid #2563eb; background:#eff6ff; color:#2563eb; font-size:12px; font-weight:600` |
| Unselected | `padding:6px 11px; border-radius:999px; border:1px solid #e5e7eb; background:#fff; color:#6b7280; font-size:12px; font-weight:500` |

Options: **×1 ×2 ×3 ×6 ×12 Custom**. Default **×1**. *Custom* swaps the chip row for a number input
(min 1, max 60) plus a *back to presets* link. Changing quantity recomputes `amount paid` and the
end preview.

**4. Amount paid (₹)** — text input, digit-and-comma formatted on blur. Prefilled with
`price × quantity`. Helper: `Defaults to price × quantity, editable.` Accepts a lower value
(partial payment) and a higher value (advance); both save without warning.

### End-date preview

Below the grid, `margin-top:14px`:

```css
display: flex; align-items: center; gap: 6px;
padding: 9px 12px; border-radius: 10px;
background: #f9fafb; border: 1px dashed #e5e7eb;
font-size: 12.5px; color: #374151;
```

Calendar icon 14×14, then `Ends ` + **bold date** + ` (computed on save)` at `opacity:.6`. Date
format: `12 Feb 2027`. Recompute live on any change to plan / start / quantity.

### Overlap warning (conditional, per item)

Rendered under the end preview, `margin-top:12px`:

```css
display: flex; align-items: flex-start; gap: 10px;
padding: 11px 14px; border-radius: 10px;
background: #fffbeb; border: 1px solid #fde68a;
```

Warning triangle icon 15×15 stroke `#b45309`, `flex-shrink:0; margin-top:1px`.

Body: 12.5px `#92400e`, `line-height:1.45`, copy —
`Overlaps with current {Plan name} (till {date}).` with the plan name bold.

Two buttons below, 8px gap, `margin-top:8px`:

- **Cancel** — `padding:5px 12px; border-radius:8px; border:1px solid #fde68a; background:#fff; color:#92400e; font-size:12px; font-weight:600`. Reverts the start date to its last non-overlapping value.
- **Save anyway** — `padding:5px 12px; border-radius:8px; border:none; background:#b45309; color:#fff; font-size:12px; font-weight:600`. Sets `overlapAcknowledged: true`; the warning collapses to a single muted line `Overlap acknowledged.`

The warning never blocks *Save checkout*.

---

## 5. Add another item

Full-width dashed button below the last item card:

```css
width: 100%; padding: 12px 0; border-radius: 14px;
border: 1.5px dashed #d1d5db; background: transparent;
color: #6b7280; font-size: 13px; font-weight: 600; margin-bottom: 16px;
```

Label: `+ Add another item`. Appends a new Add-on item card (a Membership item already exists) with
plan unselected, start date defaulted to today, quantity ×1, amount blank. If the cart has no
Membership item, the new card defaults to category Membership instead. Scroll the new card into view
and focus its Plan select.

---

## 6. Checkout footer

Card shell, but `padding:16px 22px`, `border-radius:16px`, and
`display:flex; align-items:center; justify-content:space-between; gap:14px; flex-wrap:wrap`.

Left block:

- `Total this visit` — 12px `#9ca3af`
- Amount — 19px / 700 / `#111827`, format `₹14,500`
- Validity line — 11.5px, `margin-top:2px`:
  - valid → `✓ Contains exactly one membership item` in `#15803d`
  - no membership → `Add one membership item to continue` in `#dc2626`
  - two memberships → `Only one membership item per checkout` in `#dc2626`

Right block, 10px gap:

- **Cancel** — `padding:9px 16px; border-radius:10px; border:1px solid #e5e7eb; background:#fff; color:#374151; font-size:13px; font-weight:600`
- **Save checkout** — `padding:9px 16px; border-radius:10px; border:none; background-image:{charcoal CTA gradient}; color:#fff; font-size:13px; font-weight:600; box-shadow:0 4px 10px rgba(17,24,39,0.10)`

Save is disabled (50% opacity, `cursor:not-allowed`) while the membership-count rule fails or any
required field is empty.

---

## 7. States

| State | Trigger | Presentation |
|---|---|---|
| Default | Entered from member detail | Membership item prefilled from the member's current plan; Add-on cards only if the member has active add-ons to renew |
| Item invalid | Required field blurred empty | Field error variant + red helper text; footer validity line unchanged |
| Overlap | Item range intersects an active subscription | Amber warning inside that item card |
| Saving | Save pressed | Save button shows spinner + label `Saving…`; all inputs disabled |
| Network error | Save request fails | Amber banner above footer (below), items retained |
| Success | Save succeeds | Navigate to `/members/:id` with a green toast `Checkout saved · receipt #{n}` |

### Network-error banner

Sits between the *Add another item* button and the footer, `margin-bottom:14px`:

```css
display: flex; align-items: flex-start; gap: 10px;
padding: 12px 16px; border-radius: 12px;
background: #fffbeb; border: 1px solid #fde68a;
```

Offline icon 16×16 stroke `#b45309`. Copy, 13px `#92400e`:
`Checkout couldn't be saved — network error. No payment was recorded; your items are kept.`
Trailing **Retry save** button, small ghost style on amber.

The wording is deliberate: it states that no payment was recorded, so staff do not re-collect cash.
Keep it verbatim.

---

## 8. Responsive

| Breakpoint | Change |
|---|---|
| ≥ 861px | As specified above |
| 641–860px | Header persists; column max-width 760px still applies with 20px side padding |
| ≤ 640px | Form grid collapses to one column; quantity chips wrap to two rows; footer wraps so the total sits above the buttons; both footer buttons go `flex:1` and share the row |
| ≤ 860px | App-level bottom tab bar appears; add 72px bottom padding to the column so the footer clears it |

Minimum touch target on mobile: 44px. Bump the delete button to 36×36 and quantity chips to
`padding:9px 13px` below 640px.

---

## 9. Copy inventory

Every string on this screen, verbatim:

- `Renew / Add Subscription`
- `{name} · {member #} · one checkout, one or more items`
- `Payment`
- `Payment mode`
- `Cash` / `UPI` / `Card`
- `Notes` / `(optional, ≤ 200 chars)`
- `e.g. paid partially, balance next week`
- `Membership` / `Add-on`
- `Plan`
- `Start date`
- `Defaults to day after current membership expires.`
- `Defaults to day after current add-on expires.`
- `Quantity`
- `×1` `×2` `×3` `×6` `×12` `Custom`
- `Amount paid (₹)`
- `Defaults to price × quantity, editable.`
- `Ends {date}` / `(computed on save)`
- `Overlaps with current {plan} (till {date}).`
- `Cancel` / `Save anyway`
- `+ Add another item`
- `Checkout couldn't be saved — network error. No payment was recorded; your items are kept.`
- `Retry save`
- `Total this visit`
- `✓ Contains exactly one membership item`
- `Cancel` / `Save checkout`

---

## 10. Tokens used

| Token | Value |
|---|---|
| Accent | `#2563eb` |
| Accent surface | `#eff6ff` |
| Accent pill | `#dbeafe` |
| Card border | `#f1f1f3` |
| Field border | `#e5e7eb` |
| Field fill | `#f9fafb` |
| Text primary | `#111827` |
| Text secondary | `#374151` |
| Text muted | `#9ca3af` |
| Success | `#15803d` |
| Warning text | `#92400e` / icon `#b45309` |
| Warning fill | `#fffbeb` / border `#fde68a` |
| Error | `#dc2626` / border `#f87171` / fill `#fef2f2` |
| Radius: card | 16px |
| Radius: field, chip-square | 10px |
| Radius: pill | 999px |
| Radius: small button | 8–9px |

Currency: `₹` with thousands separators, no decimals. Dates displayed as `12 Feb 2027`; date inputs
use ISO `YYYY-MM-DD`.
