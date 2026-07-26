# Reporting — Frontend Spec

> Consolidates the frontend side of [requirements-template.md §6 Reporting](../requirements-template.md#6-feature-area-reporting) (REQ-REPORT-001/002) with the pre-existing summary-tile/expiring-list content from [screens.md WSCR-07](./screens.md#wscr-07--reports) into one place — this is the richer version that WSCR-07's own note anticipated ("If richer reporting (charts, date-range filters, exports) is wanted, add it to this file first before building it"). Treat this doc as authoritative for the Reports screen; WSCR-07 is superseded by it (layout/loading/error/empty-state wording carries over unchanged, referenced below rather than repeated).
>
> Backend counterpart: [../backend/reporting.md](../backend/reporting.md) — no Edge Function, no new schema; every number here comes from a direct `supabase-js` read.

---

## 1. Scope

| Requirement | Summary |
|---|---|
| *(pre-existing)* | Summary tiles: Total / Active / Expiring Soon / Expired member counts |
| *(pre-existing)* | Expiring This Week list: members whose current membership ends within 7 days |
| REQ-REPORT-001 | Two bar charts — New Subscriptions per Month, New Add-ons per Month — for a selected date range |
| REQ-REPORT-002 | Itemized transaction list for the same range |
| *(new)* | Revenue by Payment Mode donut chart — same range, ₹ total split across Cash/UPI/Card |

---

## 2. Screen — Reports

**Route:** `/reports` · All signed-in users (same access level as the Members List — not admin-restricted).

### 2.1 Layout, top to bottom

1. **Summary tiles** — Total members, Active, Expiring Soon, Expired. Static (not affected by the date-range picker below — these are current-state counts, not historical). Responsive grid: 2 columns on mobile, 4 on desktop.
2. **Expiring This Week** — members whose current membership `end_date` is within 7 days (inclusive) of today, soonest first. Also static, same reasoning as the tiles.
3. **Date range picker** — start/end date inputs, defaulting to the 1st of the current calendar month through today (§3). Everything below this point reacts to the selected range.
4. **Two bar charts** — "New Subscriptions per Month" and "New Add-ons per Month" (§4), one bar per calendar month within the selected range.
5. **Revenue by Payment Mode** — a donut chart of total ₹ received in the range, split across Cash/UPI/Card (§5). Appears in the same range-scoped section as the transaction list below it, so it loads/errors/empties together with it, not independently.
6. **Itemized transaction list** — one row per line item in the selected range (§6).

The static section (1–2) and the range-scoped section (3–5) load and error independently — a failure fetching transaction data must not blank out the summary tiles, and vice versa (rule 30's "isolated per-section failure" pattern, same as the Settings hub).

### 2.2 Page load

| State | Section | UI |
|---|---|---|
| Loading | Summary tiles + Expiring list | Skeleton tiles + skeleton list rows |
| Loading | Charts + transaction list | Skeleton chart placeholders + skeleton table/list rows, shown on initial load and again on every date-range change |
| Error | Either section independently | "Couldn't load reports — check your connection and try again." (network/timeout, bounded by `with-timeout.ts`) or "Something went wrong loading reports. Please try again." (generic) + a **Retry** button that re-runs only that section's query |
| Empty — Expiring This Week | Zero members expiring | "No memberships expiring this week." — a healthy, non-error state |
| Empty — zero members overall | member_list_view returns nothing | Summary tiles show `0` for every count (a valid value, not an empty state); Expiring list shows the same "No memberships expiring this week" message |
| Empty — zero transactions in range | Charts + list | Bar charts render as flat/empty (zero bars, or a "No data for this range" placeholder); the donut chart shows "No payments in this date range." in place of the ring; transaction list shows "No transactions in this date range." |

### 2.3 Responsive layout (mobile-first)

Per [rules.md rule 16](./rules.md#ui--styling):

| Breakpoint | Layout |
|---|---|
| `< 768px` (mobile) | Summary tiles: 2-column grid. Expiring list: single-column stacked rows. Date range: stacked start/end fields, full-width Apply button. Bar charts: stacked vertically, one full-width chart at a time, horizontally scrollable bar area only if the month count genuinely doesn't fit (never the whole page scrolling sideways). Donut chart: ring above its legend, both centered, single column. Transaction list: stacked cards, one per transaction (never a table requiring horizontal scroll) |
| `>= 768px` (desktop) | Summary tiles: 4-column grid. Date range fields inline with the Apply button. Bar charts: side by side, two columns. Donut chart: ring beside its legend, single row. Transaction list: a table |

Every control (date inputs, Apply/Retry buttons, list rows) meets the 44×44px touch-target minimum.

---

## 3. Date Range Control (REQ-REPORT-001)

- **Default on load:** 1st of the current calendar month through today (browser local date, consistent with the Timezone Rule).
- Two date inputs (start, end) + an **Apply** button — the charts and transaction list only refetch/recompute on Apply, not on every keystroke, to avoid firing a query per partial date entry.
- **Validation:** start date must be `<=` end date; if not, show an inline error next to the fields and don't fetch. No minimum/maximum range length is enforced — a single-day range and a multi-year range are both valid (the latter simply produces more monthly bars/rows).
- No persistence across visits — reopening `/reports` always resets to the current-month default; the picker is a session-scoped filter, not a saved preference.

---

## 4. Bar Charts (REQ-REPORT-001)

Two charts, same shape, one per `plans.category`:

- **"New Subscriptions per Month"** — counts membership items (`category = 'membership'`) by the calendar month their `start_date` falls in.
- **"New Add-ons per Month"** — same, for `category = 'addon'`.

Rules common to both:
- **Always bucketed by calendar month**, never daily/weekly, regardless of the selected range's length (backend spec §4's rule).
- One bar per month that falls (even partially) within the selected range, in chronological order, including months with a zero count (a flat/empty bar, not a skipped month) — so the x-axis reads as a continuous timeline.
- Each bar shows its count on hover/focus (accessible via keyboard focus too, not mouse-only) and always shows the count as a visible label if there's room (avoid a chart that requires hovering to read any value at all).
- **No charting library dependency** — implemented as plain CSS/SVG bars (height or width proportional to count relative to the range's max), consistent with this app's minimal-dependency approach (only `lucide-react` has been added beyond the Supabase/React/Router baseline). Revisit only if a future requirement (tooltips, zoom, export-to-image) genuinely needs a library.

---

## 5. Revenue by Payment Mode (new — donut chart)

A donut chart of total ₹ received in the selected range, split across the three `subscriptions.payment_mode` values (Cash, UPI, Card). Sits in the range-scoped section, directly above the transaction list (§2.1) — same load/error/empty lifecycle as the bar charts and transaction list, not an independent fetch (it derives from the same `transactions` data §6 already loads).

- **Fixed categorical order** — Cash, UPI, Card, always in that order regardless of magnitude; a slice's color is tied to its payment mode, never to its rank by value (dataviz skill, "color follows the entity, never its rank"). All three modes always render in the legend, including at ₹0, so the set of rows never shifts.
- **Data**: `sum(subscription_items.amount_paid)` grouped by the parent `subscriptions.payment_mode`, over the same `subscription_items` rows the transaction list (§6) already fetches for the range — no separate query.
- **Colors**: categorical slots 1–3 of the dataviz skill's reference palette (`references/palette.md`) — Cash `#2a78d6` (blue), UPI `#008300` (green), Card `#e87ba4` (magenta). This app has no categorical multi-hue set of its own (`colors.md` defines one brand hue + status colors only), so the validated reference instance is used as-is per the skill's own guidance, rather than inventing new unvalidated hues. Validated via `validate_palette.js`: PASS on lightness band, chroma floor, CVD separation, and the normal-vision floor; WARN on contrast for the Card slice (2.69:1 on white) — mitigated by the always-visible legend (below), never relying on ring color alone.
- **Center label**: the grand total across all three modes (a hero-figure-style number, proportional figures, not `tabular-nums`).
- **Legend**: one row per mode — color swatch, mode name, ₹ amount, percentage of total — permanently visible (not hover-gated), directly beneath/beside the ring depending on breakpoint (§2.3). This is what satisfies the contrast WARN's relief requirement and the "no color-only encoding" accessibility rule: every value in the chart is also plain text.
- **Hover/focus**: each ring segment highlights (thicker stroke) and shows a native tooltip on hover/focus; this enhances, it never gates — every value it would show is already permanent text in the legend.
- **Empty state**: all three modes at ₹0 in range → "No payments in this date range." in place of the ring (§2.2), consistent with the bar charts' and transaction list's own empty-range messaging.

---

## 6. Itemized Transaction List (REQ-REPORT-002)

One row per `subscription_items` row whose `start_date` falls within the selected range — never aggregated per member, even when a member has multiple items in range (e.g. a renewal plus two add-ons each appear as separate rows).

| Column | Source |
|---|---|
| Member name | `members.name` |
| Member number | `members.member_number` |
| Phone | `members.phone` |
| Transaction type | Derived from `plans.category`: "Subscription" for `membership`, "Add-on" for `addon` |
| Plan / add-on name | `plans.name` |
| Transaction date | `subscription_items.start_date` |
| Amount | `subscription_items.amount_paid` |
| Payment mode | Parent `subscriptions.payment_mode` — one value per checkout, shared by every row from that checkout |

- Sorted by transaction date, most recent first.
- Desktop: a table (§2.3). Mobile: stacked cards, each showing every column above in a compact label/value layout.
- No pagination for now — the same "fetch the whole range once" approach the Members List uses for its full dataset; revisit if a range routinely returns enough rows to matter.
- No export (CSV/PDF) in this revision — not requested, not built.

---

## 7. Requirements Traceability

| Requirement | Frontend implementation |
|---|---|
| *(pre-existing)* Summary tiles | §2.1.1 — reuses `member_list_view` + `deriveStatus()`, same as Members List |
| *(pre-existing)* Expiring This Week | §2.1.2 — same data source, filtered to `status === 'expiring'` |
| REQ-REPORT-001 | Date range control (§3) + two bar charts (§4) |
| *(new)* Revenue by Payment Mode | Donut chart (§5), derived from the same range data as §6 |
| REQ-REPORT-002 | Itemized transaction list (§6) |
| (non-functional) loading/error/retry, empty states, mobile-responsive | §2.2, §2.3 — enforced app-wide by [rules.md](./rules.md) rules 16, 29–31 |

---

## Related docs

- [screens.md WSCR-07](./screens.md#wscr-07--reports) — original lighter spec (summary tiles + Expiring This Week only); superseded by this doc for anything charts/date-range/transaction-list related
- [rules.md](./rules.md) — app-wide non-functional rules this screen satisfies: responsive/mobile-first (rule 16), loading/error/retry (rules 29–30), empty states (rule 31)
- [member-management.md §5](./member-management.md#5-member_list_view--resolving-the-member-status-open-question) *(backend)* — `member_list_view` and the status derivation the summary tiles/Expiring list reuse unchanged
- [../backend/reporting.md](../backend/reporting.md) — backend counterpart: data sources, read-path query shape, business rules
