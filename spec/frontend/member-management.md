# Member Management — Frontend Spec

> Consolidates the frontend side of [requirements-template.md §2 Member Management](../requirements-template.md#2-feature-area-member-management) (REQ-MEM-001–007) and [§3 Member List](../requirements-template.md#3-feature-area-member-list--home-page) (REQ-LIST-001–004) into one place.
>
> **This is the current source of truth for Member fields and screens — [screens.md](./screens.md)'s WSCR-02/03/04/06 sections and [data-models.md](./data-models.md)'s `Member` type predate the requirements revision that added `date_of_birth`, `branch_id`, `member_number`, doctor's-care/emergency-contact fields, `handled_by_staff`, and soft-delete columns.** Those files still describe an earlier, smaller Member shape (e.g. weight/height as optional, no member number). Treat this doc as authoritative for Member Management until they're updated to match; the route map, layout breakpoints, and general screen conventions those files describe elsewhere are still valid and referenced below, not repeated.
>
> Backend counterpart: [../backend/member-management.md](../backend/member-management.md) — includes `member_list_view`, the resolution to the previously-open "member status" question this doc's search/filter/sort section depends on.

---

## 1. Scope

| Requirement | Summary |
|---|---|
| REQ-MEM-001 | Register a member: required + optional fields, unique phone |
| REQ-MEM-002 | Camera capture as an alternative to file upload |
| REQ-MEM-003 | Immutable `created_by`; independently-editable `handled_by_staff` |
| REQ-MEM-004 | Client-side photo compression; original + thumbnail both stored |
| REQ-MEM-005 | System-generated `member_number`, read-only everywhere in the UI |
| REQ-MEM-006 | Edit any field except `member_number`/`created_by` |
| REQ-MEM-007 | Delete = soft delete; excluded from list/search/reports by default |
| REQ-LIST-001 | Default sort `date_of_joining desc`; sort by name or expiry |
| REQ-LIST-002 | Search by name/member_number/phone |
| REQ-LIST-003 | Status pills: All/Active/Expiring/Expired |
| REQ-LIST-004 | Filter panel: gender, add-on, plan (combinable) |

---

## 2. Member Fields (current shape)

| Field | Required | Type / Rule |
|---|---|---|
| name | Yes | 2–80 chars |
| phone | Yes | Exactly 10 digits; unique among non-deleted members |
| date_of_birth | Yes | Date picker |
| date_of_joining | Yes | Date picker, pre-filled with today (browser local date), editable |
| branch_id | Yes | Select from active branches — feeds `member_number` generation |
| gender | Yes | `Male` / `Female` / `Other` |
| weight_kg | Yes | Decimal 1–500, up to 2 decimal places (matches the `numeric` DB column — not integer-only, corrected from an earlier revision of this doc) |
| height_cm | Yes | Decimal 1.0–300.0, up to 2 decimal places |
| under_doctor_care | Yes | Yes/No toggle, defaults No |
| doctor_care_details | Conditional | Required (blocks submit) whenever `under_doctor_care = Yes`, otherwise hidden |
| emergency_contact_name | Yes | |
| emergency_contact_phone | Yes | Exactly 10 digits — same format rule as `phone` above (no uniqueness requirement, since it doesn't identify a member) |
| emergency_contact_relationship | Yes | |
| email | No | Format-validated if present |
| residential_address | No | |
| aadhaar_number | No | No format validation specified yet |
| occupation | No | |
| photo | No | Upload or camera capture (§4) |
| handled_by_staff | No | Select a staff/admin profile; independently editable, separate from `created_by` |

**Never shown as an input, always read-only or absent from the form:** `member_number` (system-generated, REQ-MEM-005), `created_by` (system-set, REQ-MEM-003).

---

## 3. Screens

### 3.1 Add Member — `/members/new`

All-signed-in-users route (screens.md's route map/access table still applies — only the field list here supersedes it). Fields per §2 above, minus `handled_by_staff` (not meaningful before the record exists — set afterward from the detail page) and minus `member_number`/`created_by`.

```
Save tapped
  → validate all fields (client-side; blur-per-field + submit-all-at-once, scroll to first error)
      → errors: show inline, stop
      → "under doctor's care" = Yes and doctor_care_details blank: block with a validation error
      → valid: memberService.create({ name, phone, date_of_birth, date_of_joining, branch_id,
                 gender, weight_kg, height_cm, under_doctor_care, doctor_care_details,
                 emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
                 email, residential_address, aadhaar_number, occupation })
          → photo (if selected): compressed client-side (§4), then uploaded, then a follow-up
            update sets photo_url/photo_thumbnail_url - a separate step from the create above,
            so a photo failure never blocks the member record itself (REQ-MEM-004)
          → success: navigate to /members/:newId (replace, not push)
          → failure: inline error banner, form stays open, submitted values untouched — per
            rules.md rule 30, the message names the specific cause where one exists (e.g. a
            phone conflict), otherwise falls back to a generic "Something went wrong saving
            this member. Please try again." — never a raw error string. The form staying open
            with the Save button re-enabled *is* this screen's retry action; there's no
            separate button for it.
```

`member_number`/`created_by` are never included in the payload — the database generates/sets them (see [backend/member-management.md §3](../backend/member-management.md#3-member-number-generation-req-mem-005)).

This screen only creates the member row — it does not collect a first subscription (unchanged from the existing screens.md note); that happens from the new member's detail page.

Mobile-friendliness (rules.md rule 16): this form has grown to 19 fields since screens.md's original WSCR-04 (which had 7) — that's a longer scroll on a phone, not a layout problem; every field still stacks in one column below 768px and every input/toggle/chip meets the 44×44px touch-target minimum, same as every other form in this app.

### 3.2 Member Detail — `/members/:id`

All fields from §2 are viewable, with an inline edit toggle (matches the existing hero/personal-details/body-metrics/subscription layout in screens.md — only the field set changes, not the layout pattern). Additions to what screens.md currently describes:

- **Member number** shown read-only near the hero section (`member_number`, e.g. `MUM-2026-0001`).
- **`handled_by_staff`** editable independently of the rest of the personal-details section — its own field, its own save action is not required (can share the personal-details save), but must never overwrite `created_by`.
- **Delete action** (REQ-MEM-007): a destructive action (confirm dialog) that calls a soft-delete update and navigates back to `/` on success. No separate "deactivate" state exists for members.
- **Photo**: upload or camera-capture control (§4); shows `photo_url` here (the original), not the thumbnail — thumbnails are for list/card surfaces only (REQ-MEM-004).

Member field saves and subscription saves remain **completely independent** (own loading/error state each) — unchanged from the existing screens.md rule. **See [member-detail.md](./member-detail.md) for the full screen spec** — component state, the loading/error/retry treatment (rules.md rules 29–30), empty states for Current Membership/Add-ons/History (rule 31), and the mobile-first responsive breakdown (rule 16). This section stays a summary; that doc is authoritative for this route.

### 3.3 Edit Member — `/members/:id/edit`

Same field set as Add Member (§3.1) plus `handled_by_staff`, pre-filled with the member's current data. `member_number` and `created_by` are displayed read-only, never sent as editable inputs. Cancel returns to `/members/:id` without saving; Save calls `memberService.update(id, data)` — same failure handling as §3.1 (specific message where the cause is known, e.g. a phone conflict; generic fallback otherwise; form stays open with the entered values intact as the retry path, per rules.md rule 30).

(Whether this is a separate route or an inline-edit-on-detail toggle is an implementation choice screens.md already left open — pick one consistently; the field-level rules here apply either way.) Same mobile-friendliness note as §3.1 applies here too (rules.md rule 16).

### 3.4 Members List — `/`

**Data source:** `member_list_view` ([backend/member-management.md §5](../backend/member-management.md#5-member_list_view--resolving-the-member-status-open-question)) — one row per non-deleted member with `current_membership_plan_id`/`current_membership_plan_name`/`current_membership_end_date`/`current_addon_plan_ids` already joined in. The frontend never re-derives this from raw `subscription_items` itself.

#### Layout (unchanged from screens.md)

| Breakpoint | Layout |
|---|---|
| Mobile | Stacked member cards: avatar, name, plan · phone, expiry line, status badge |
| Desktop | Data table — Avatar+Name, Phone, Plan, Expiry, Status, Actions; sortable by column header |

#### Search (REQ-LIST-002)

Matches `name`, `member_number`, or `phone` — substring, case-insensitive; phone match ignores spaces. Live as-you-type, client-side over the already-fetched `member_list_view` rows (see performance note below).

#### Status pills (REQ-LIST-003)

All / Active / Expiring / Expired, single-select, additive with search and the filter panel. Uses `deriveStatus()` ([backend/member-management.md §6](../backend/member-management.md#6-status-derivation-client-side-unchanged-authority--see-business-logicmd)) against each row's `current_membership_plan_id`/`current_membership_end_date` — **evaluated client-side using the browser's local date**, not a server-computed status column, per the existing Timezone Rule.

**Each pill shows a live count** of how many rows it would surface — computed from the rows that already pass search + the filter panel (§Filter panel below) but *before* the status pill's own filter is applied, so every pill's number answers "how many would I see if I clicked this," given whatever else is currently active. `All`'s count is therefore the size of that pre-status-filter set, not the full unfiltered member list, whenever search/gender/plan/add-on filters are active. Recomputed client-side alongside `filteredRows` — no additional fetch.

#### Filter panel (REQ-LIST-004)

| Filter | Behavior |
|---|---|
| Gender | Multi-select against `row.gender` |
| Add-on | Multi-select; a member matches if `row.current_addon_plan_ids` contains at least one selected plan id |
| Plan | Multi-select against `row.current_membership_plan_id` |

All filter-panel selections combine with each other (AND) and are additive with the pill filter and search box (unchanged combination rule from the existing spec).

#### Sort (REQ-LIST-001)

| Option | Field | Default |
|---|---|---|
| Join date | `date_of_joining` | **Yes**, descending |
| Name | `name` | — |
| Expiry | `current_membership_end_date` | — |

Default sort applies whenever no explicit sort has been chosen, including while searching/filtering; an explicit user choice overrides the default until cleared or the page reloads.

#### Performance note

At this app's scale (NFR: low-thousands of members, per requirements-template.md §10), fetch the full `member_list_view` result set once per route entry and do search/filter/sort client-side over it — no pagination or server-side filter parameters needed. Re-fetch on every route entry (existing rule: never show stale data on return to `/`).

#### Loading, errors & retry

Per [rules.md rules 29–30](./rules.md#data-loading-errors--empty-states) — this is the home screen and the single most-used data fetch in the app, so it gets the full three-state treatment, not just a happy-path description:

| State | Condition | UI |
|---|---|---|
| Loading | Fetch in flight | Skeleton rows/cards in place of the list — not a blank page, not stale data from a previous member's session |
| Error | Fetch failed (network/timeout or generic server error) | "Couldn't load members — check your connection and try again." (network/timeout) or "Something went wrong loading members. Please try again." (generic) + a **Retry** button that re-runs the same fetch. Bounded by `web/src/lib/with-timeout.ts`, same as every other fetch in this app. There is no "not found" case here (unlike a single-member fetch) — this is always a full-collection read |
| Loaded, zero rows | Fetch succeeded, `member_list_view` empty or filtered to empty | See "Row / card content, empty states" below — **not** the error state above; an empty result is not a failure |

#### Row / card content, empty states

Unchanged from the existing screens.md WSCR-02 section (avatar algorithm, secondary line format, empty-state copy) — only the underlying data source and status-derivation logic changed, not the visual content. Already satisfies [rules.md rule 31](./rules.md#data-loading-errors--empty-states): WSCR-02 distinguishes "no members at all" (`"No members yet." + "Add Member" CTA`) from "filter returns nothing" (`"No members match these filters." + "Clear filters"`) with different copy for each — these are not the same message.

#### Photo lightbox (new)

Clicking a row's avatar (mobile card or desktop table, wherever a photo exists — an initials-avatar placeholder isn't clickable, there's nothing to enlarge) opens the photo enlarged in a full-screen overlay, via the shared `PhotoLightbox` component (also used by Member Detail, `member-detail.md` §11). Enlarges `photo_url` (the **original**, uncompressed upload), never `photo_thumbnail_url` — the list/card avatar itself stays the compressed thumbnail as before (REQ-MEM-004), only the lightbox reaches for the original. Requires `member_list_view.photo_url` ([backend/member-management.md §5.2](../backend/member-management.md#52-definition)).

- Click the avatar → overlay opens; click the backdrop, press Escape, or tap the close button → overlay closes.
- The click that opens the lightbox is stopped from also navigating to Member Detail (`stopPropagation`) — the rest of the card/row still navigates as before.
- No fetch involved — `photo_url` is already present on the already-loaded `MemberListRow`.

#### Mobile-friendliness confirmation

The Mobile/Desktop breakpoint table above (unchanged from screens.md) already satisfies [rules.md rule 16](./rules.md#ui--styling)'s single-column-below-768px requirement — stacked member cards are inherently one column. Confirming the two things rule 16 added beyond what screens.md originally specified: every card/row and its status badge/action controls meet the 44×44px touch-target minimum, and the desktop data table does not require horizontal scrolling at the 768px boundary (columns are Avatar+Name, Phone, Plan, Expiry, Status, Actions — no wider than a standard viewport at that width).

---

## 4. Photo Capture & Compression (REQ-MEM-002/004)

1. Staff chooses "Take Photo" or "Upload Photo" — both feed the same downstream path (`handlePhotoSelected`).
   - **Take Photo** opens `CameraCaptureModal`: a live in-page camera preview via `getUserMedia({ video: { facingMode: 'environment' } })`, with a shutter button that draws the current video frame to a canvas and produces a `File`. **Decided against** `<input type="file" capture="environment">` for this button — that attribute only opens the native camera app on some mobile browsers and is silently ignored on desktop, where it falls back to the same file/gallery picker "Upload Photo" already uses, making the two controls indistinguishable there.
   - **Upload Photo** stays a plain `<input type="file">` — the file/gallery picker is the *correct* behavior for this control, not a bug.
2. If the camera can't be used (permission denied, no camera, `getUserMedia` unsupported), the modal shows an inline error with no automatic fallback — the user closes it and taps "Upload Photo" instead, which is always visible alongside "Take Photo," never nested behind it. Never a dead end.
3. Before upload, the browser compresses the image client-side (canvas), targeting ~400px on the longest side and under ~50KB — identical pipeline regardless of whether the `File` came from the camera modal or the upload picker.
4. **Both** the original file and the compressed version are uploaded to the `member-photos` Storage bucket; both URLs (`photo_url`, `photo_thumbnail_url`) are saved on the member record.
5. List/card surfaces use `photo_thumbnail_url` by default; the Member Detail hero uses `photo_url`.
6. If compression or upload fails, the rest of the member's details still save as an independent step — the member record is created/updated regardless, with an inline error stating the photo couldn't be uploaded and a retry option on that member's record.

---

## 5. Requirements Traceability

| Requirement | Frontend implementation |
|---|---|
| REQ-MEM-001 | Add Member form (§3.1), field table (§2) |
| REQ-MEM-002 | Camera/upload toggle (§4) |
| REQ-MEM-003 | `created_by` never in any form payload; `handled_by_staff` field on Member Detail (§3.2) |
| REQ-MEM-004 | Compression flow (§4) |
| REQ-MEM-005 | `member_number` shown read-only only, never an input (§2, §3.2) |
| REQ-MEM-006 | Edit Member (§3.3) |
| REQ-MEM-007 | Delete action on Member Detail (§3.2) |
| REQ-LIST-001 | Sort control (§3.4) |
| REQ-LIST-002 | Search box (§3.4) |
| REQ-LIST-003 | Status pills (§3.4) |
| REQ-LIST-004 | Filter panel (§3.4) |

---

## Related docs

- [screens.md](./screens.md) — general screen/layout conventions (route map, breakpoints, empty-state patterns) still apply; its WSCR-02/03/04/06 field-level content is superseded by this doc
- [member-detail.md](./member-detail.md) — full Member Detail screen spec (§3.2 here is a summary; that doc is authoritative, including its loading/error/retry and responsive sections)
- [rules.md](./rules.md) — app-wide non-functional rules this doc's screens must satisfy: responsive/mobile-first (rule 16), loading/error/retry (rules 29–30), empty states (rule 31)
- [data-models.md](./data-models.md) — its `Member` type is stale; §2 above is current
- [business-logic.md](./business-logic.md) — client-side date helpers (`todayDate`, `addDays`, `formatDate`)
- [../backend/member-management.md](../backend/member-management.md) — backend counterpart: schema, `member_list_view`, RLS, status-derivation authority
