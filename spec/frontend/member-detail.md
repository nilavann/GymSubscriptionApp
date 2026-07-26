# Member Detail — Screen Spec (Web Edition)

> Part of: [SPEC-WEB.md](../../SPEC-WEB.md) | App: Fit&Fine Gym Subscription Manager (Web)
> Route: `/members/:id` (+ `/members/:id/edit`, `/members/:id/renew` — see [navigation.md](./navigation.md))

> **Full rewrite (2026-07-20).** The previous version of this file was the mobile app's original React Native / Expo / Firestore spec (SDD-SCR-003), carried over with a Firebase→SQLite adaptation table but never actually adapted to this project's real stack. Every field, type, and flow below is now derived directly from the current, authoritative specs:
> - **Member fields, photo capture, edit/delete rules:** [backend/member-management.md](../backend/member-management.md) / [frontend/member-management.md](./member-management.md) (REQ-MEM-001–007)
> - **Subscription checkout, overlap warning:** [backend/subscription-management.md](../backend/subscription-management.md) / [frontend/subscription-management.md](./subscription-management.md) (REQ-SUB-001–012)
> - **Types:** `frontend/src/types/member.ts`, `plan.ts`, `subscription.ts` — this doc references them, it does not redeclare them
> - **Shell/nav:** [app-shell.md](./app-shell.md) — this screen renders *inside* `<AppShell>`'s `<Outlet/>`; it does not have its own top-level brand/sign-out bar, only a page-local header (§4)
>
> Firestore, `expo-router`, React Native (`View`/`Pressable`/`BottomSheetModal`/`SafeAreaView`), and the single-subscription-per-member model no longer apply anywhere in this project — none of that vocabulary appears below.

---

## 1. Scope

| Requirement | Summary |
|---|---|
| REQ-MEM-006 | View + inline-edit every Member field except `member_number`/`created_by`/`branch_id` |
| REQ-MEM-003 | `created_by` read-only; `handled_by_staff` independently editable |
| REQ-MEM-002/004 | Photo capture/upload + compression, from this screen |
| REQ-MEM-007 | Delete member (soft delete) from this screen |
| REQ-SUB-001–004/006/007/009 | Renew/Add Subscription checkout, reached from this screen |
| REQ-SUB-005/008 | Client-side overlap warning inside the checkout (own screen, §16) |
| REQ-LIST-003 | Status badge reused from the Members List status derivation |

---

## 2. Types

No new types are declared for this screen — it consumes what already exists:

| Type | File | Used for |
|---|---|---|
| `Member`, `NewMember`, `UpdateMember`, `Gender` | `frontend/src/types/member.ts` | Hero card, Personal Details, Body Metrics, Doctor's Care, Emergency Contact, save flow |
| `Plan`, `PlanCategory` | `frontend/src/types/plan.ts` | Renew/Add Subscription plan picker |
| `Subscription`, `SubscriptionItem`, `SubscriptionItemWithPlan`, `NewSubscription`, `NewSubscriptionItem`, `UpdateSubscription`, `CreateSubscriptionResult`, `PaymentMode` | `frontend/src/types/subscription.ts` | Current Membership/Add-ons, Subscription History, Renew/Add Subscription checkout |

If a field is ever added to any of these, update the type file first — this doc follows it, not the other way around (same rule `member-management.md` already states for itself).

---

## 3. Repositories & Services

This codebase's actual convention (see `repositories/profile.repository.ts`, `services/auth.service.ts`) is a plain exported object typed via `typeof`, registered in `services.context.tsx` — **not** the constructor-injected class sketched in `architecture.md`'s illustrative section. Follow the real pattern:

```ts
// repositories/member.repository.ts
export const memberRepository = {
  async getById(id: number): Promise<Member | null> { /* direct select, RLS-guarded */ },
  async create(data: NewMember): Promise<Member> { /* direct insert, RLS-guarded */ },
  async update(id: number, data: UpdateMember): Promise<void> { /* direct update, RLS-guarded */ },
  async delete(id: number): Promise<void> { /* update deleted_at/deleted_by — REQ-MEM-007 */ },
};
export type MemberRepository = typeof memberRepository;

// repositories/subscription.repository.ts
export const subscriptionRepository = {
  async getCurrentItemsForMember(memberId: number): Promise<SubscriptionItemWithPlan[]> {
    /* select * from member_current_items where member_id = :id, joined to plans for display */
  },
  async getHistoryForMember(memberId: number): Promise<Subscription[]> {
    /* select subscriptions + their subscription_items where member_id = :id order by created_at desc */
  },
  async create(data: NewSubscription): Promise<CreateSubscriptionResult> {
    /* supabase.functions.invoke('create-subscription', { body: data }) */
  },
  async update(data: UpdateSubscription): Promise<void> {
    /* supabase.functions.invoke('update-subscription', { body: data }) */
  },
};
export type SubscriptionRepository = typeof subscriptionRepository;
```

Both get registered in `services.context.tsx`'s `Services` interface/`defaultServices`, same as `profileRepository` today. Components never import these directly — only through `useServices()` (`architecture.md`'s "component must never call supabase-js directly" rule still applies).

---

## 4. Member Detail Page (`pages/MemberDetailPage.tsx`, route `/members/:id`)

### 4.1 State

```ts
const { id } = useParams();               // react-router-dom — memberId as a route param, not a nav prop
const [member, setMember] = useState<Member | null>(null);
const [currentItems, setCurrentItems] = useState<SubscriptionItemWithPlan[]>([]);
const [history, setHistory] = useState<Subscription[]>([]);

const [isLoading, setIsLoading] = useState(true);
const [loadError, setLoadError] = useState<string | null>(null);

// Member field edit — completely independent of subscription state (unchanged rule
// from screens.md/member-management.md: own loading/error state each).
const [isEditingMember, setIsEditingMember] = useState(false);
const [memberForm, setMemberForm] = useState<UpdateMember | null>(null);
const [memberErrors, setMemberErrors] = useState<Record<string, string>>({});
const [isSavingMember, setIsSavingMember] = useState(false);
const [memberSaveError, setMemberSaveError] = useState<string | null>(null);

// Photo retry state (REQ-MEM-004) — independent of the rest of the member save.
const [photoError, setPhotoError] = useState<string | null>(null);
```

There is no `sheetMode`/bottom-sheet state here at all — Renew/Add Subscription is its own routed screen (`/members/:id/renew`, §16), not a modal opened from this page's state, per `navigation.md`'s "regular routed pages, not RN modals" rule.

### 4.2 Data load on mount, error handling, and retry

Applies [rules.md rules 29–30](./rules.md#data-loading-errors--empty-states) to this screen's three fetches (member, current items, history) — three distinct states, a specific message per failure kind, and a Retry action, not a raw error string:

```ts
const NOT_FOUND_MESSAGE = 'This member could not be found.';
const NETWORK_ERROR_MESSAGE = "Couldn't load this member — check your connection and try again.";
const GENERIC_ERROR_MESSAGE = 'Something went wrong loading this member. Please try again.';
const FETCH_TIMEOUT_MS = 10000;

type LoadErrorKind = 'not-found' | 'network' | 'generic';
const [loadErrorKind, setLoadErrorKind] = useState<LoadErrorKind | null>(null);

useEffect(() => {
  let active = true;

  async function load() {
    setIsLoading(true);
    setLoadError(null);
    setLoadErrorKind(null);
    try {
      const [memberData, items, historyData] = await Promise.all([
        withTimeout(memberRepository.getById(Number(id)), FETCH_TIMEOUT_MS, new Error('member-fetch-timeout')),
        withTimeout(
          subscriptionRepository.getCurrentItemsForMember(Number(id)),
          FETCH_TIMEOUT_MS,
          new Error('items-fetch-timeout')
        ),
        withTimeout(
          subscriptionRepository.getHistoryForMember(Number(id)),
          FETCH_TIMEOUT_MS,
          new Error('history-fetch-timeout')
        ),
      ]);
      if (!active) return;
      if (!memberData) {
        setLoadErrorKind('not-found');
        setLoadError(NOT_FOUND_MESSAGE);
        return;
      }
      setMember(memberData);
      setCurrentItems(items);
      setHistory(historyData);
    } catch (err) {
      if (!active) return;
      const isTimeoutOrNetwork = err instanceof Error && (err.message.endsWith('-timeout') || err.message === 'Failed to fetch');
      setLoadErrorKind(isTimeoutOrNetwork ? 'network' : 'generic');
      setLoadError(isTimeoutOrNetwork ? NETWORK_ERROR_MESSAGE : GENERIC_ERROR_MESSAGE);
    } finally {
      if (active) setIsLoading(false);
    }
  }

  load();
  return () => { active = false; };
}, [id]);
```

Reuses `web/src/lib/with-timeout.ts` — the same utility `auth.context.tsx` already uses for its profile lookup — so a hung request can't leave this page spinning forever.

| State | Condition | UI |
|---|---|---|
| Loading | `isLoading === true` | Skeleton in place of the hero + all sections — never alongside stale content from a previous member |
| Error — not found | `loadErrorKind === 'not-found'` | `NOT_FOUND_MESSAGE` + a link back to `/`. **No Retry button** — retrying can't change this outcome |
| Error — network/generic | `loadErrorKind === 'network' \| 'generic'` | The matching message + a **Retry** button that calls `load()` again — no separate code path, no full page reload |
| Loaded | `isLoading === false && loadError === null` | Normal page render (§6–17); see §4.3 for how its own lists handle having zero rows |

Re-fetches on every route entry (mount), same as Members List — never trust stale data on return to this screen.

The same three-state/specific-message/retry treatment (rules.md rule 30) applies independently to every other data-changing action on this page — member save (§13), photo upload (§11), delete (§17) — each already has its own error state in §4.1's state list; none of them force-navigate away or discard already-entered form data on failure.

### 4.3 Empty states

Per [rules.md rule 31](./rules.md#data-loading-errors--empty-states) — every list this page renders has its own explicit empty-state message, independent of the page-level loading/error state above (these only ever apply once `isLoading === false && loadError === null`):

| Section | Empty condition | Message |
|---|---|---|
| Current Membership (§14) | No current `category = 'membership'` item | "No active membership" + an Add Subscription CTA |
| Current Add-ons (§14) | No current `category = 'addon'` items | Section not rendered at all — this is the normal case for most members, not an error, so it gets no message at all rather than an empty-state placeholder |
| Subscription History (§15) | Zero `subscriptions` rows for this member | "No subscription history yet" |

### 4.4 Responsive layout (mobile-first)

Per [rules.md rule 16](./rules.md#ui--styling) — this page must work as well on a phone as on tablet as on desktop, extending `screens.md`'s original WSCR-03 breakdown to the current, larger section list. Three tiers, not two — see [styling.md §4](./styling.md#4-breakpoints--three-tiers-not-two) for why the tablet tier below exists:

| Breakpoint | Layout |
|---|---|
| `< 768px` (mobile) | Single column, stacked in reading order: Hero (§6) → Personal Details (§7) → Body Metrics (§8) → Doctor's Care (§9) → Emergency Contact (§10) → Current Membership/Add-ons (§14) → Subscription History (§15) |
| `768–1023px` (tablet) | **Still single column**, same stacking order as mobile — this is the corrected behavior. The two-column split at `>= 768px` was this page's own bug: `AppShell`'s `240px` sidebar plus this page's `360px` left column leave only ~88px for the right column at a 768–810px viewport (iPad portrait and most small Android tablets), which read as the right column's content overlapping/crowding the left. Tablet gets the mobile layout until there's genuinely enough width for two real columns. |
| `>= 1024px` (desktop) | Two columns: left (~360px, matching `AppShell`'s sidebar width) has Hero + Personal Details + Body Metrics + Doctor's Care + Emergency Contact; right (flexible width) has Current Membership/Add-ons + Subscription History. At this width there's `1024 − 240 (sidebar) − ~64 (padding) − 360 (left column) − 16 (gap) ≈ 344px` for the right column — healthy, not cramped. |

Mobile/tablet-specific requirements, beyond the column collapse:
- Every tappable control — Edit/Save/Cancel, gender/plan/status chips, photo capture buttons, History row expand, Delete — has a minimum 44×44px touch target (rules.md rule 16).
- Photo capture (§11) is *more* relevant on mobile than desktop (device camera) — the camera-capture path must be reachable and usable at the narrowest supported width (`~360px`), not just the file-upload fallback.
- Renew/Add Subscription (§16) is a full routed page rather than a modal/sheet specifically so it renders full-width on mobile without a bottom-sheet library — see `subscription-management.md` §3, which follows this same mobile-first rule.
- No horizontal scrolling at any width — Subscription History's expanded item rows (§15) wrap onto multiple lines on narrow viewports rather than truncating or requiring a horizontal scroll.

### 4.5 Computed: current status

```ts
const currentMembershipItem = currentItems.find((item) => item.plan.category === 'membership') ?? null;
const currentAddonItems = currentItems.filter((item) => item.plan.category === 'addon');
const status = deriveStatus({
  current_membership_plan_id: currentMembershipItem?.plan_id ?? null,
  current_membership_end_date: currentMembershipItem?.end_date ?? null,
});
```

Reuses the exact same `deriveStatus()` the Members List uses ([backend/member-management.md §6](../backend/member-management.md#6-status-derivation-client-side-unchanged-authority--see-business-logicmd)) — a member's detail page and list row must never disagree about status.

---

## 5. Page Header

Not a fixed top bar (`AppShell` already owns the real one — brand, user name, sign-out, app-shell.md §3.1) — this is a plain in-content row at the top of the page:

```
┌──────────────────────────────────────────────────┐
│  ← Members            [Edit]  or  [Cancel] [Save] │
└──────────────────────────────────────────────────┘
```

| Element | View mode | Edit mode |
|---|---|---|
| Back link | `<Link to="/">← Members</Link>` | Same, but see unsaved-changes note below |
| Right action | `Edit` button — toggles `isEditingMember` | `Cancel` (discards `memberForm`, exits edit mode) + `Save` (disabled while `isSavingMember`) |

No confirmation-on-navigate-away guard is specced for this revision (unlike the old RN doc's "discard sheet") — keep it simple: `Cancel` just resets `memberForm` from `member` and exits edit mode. Add a confirmation dialog later only if this turns out to be a real problem in practice.

---

## 6. Hero Section

```
┌──────────────────────────────────────────┐
│  [photo or initials]   Arjun Kumar        │
│                        ● Active  MUM-2026-0001 │
└──────────────────────────────────────────┘
```

| Element | Source | Notes |
|---|---|---|
| Avatar | `member.photo_url` if set, else initials circle (same avatar-color algorithm as Members List) | Uses `photo_url` (original), **not** `photo_thumbnail_url` — thumbnails are for list/card surfaces only (REQ-MEM-004) |
| Name | `member.name` | Always the saved value, never the in-progress edit form's draft |
| Status badge | `status` (§4.5) | Same badge component/colors as Members List (Active green / Expiring amber / Expired red) |
| Member number | `member.member_number` | Read-only, always — never an input anywhere on this page (REQ-MEM-005) |

Photo upload/retry control lives here too — see §11.

---

## 7. Personal Details

View + inline-edit, same toggle pattern as the rest of this page (§4.1's `isEditingMember`).

| Field | Editable | Rule |
|---|---|---|
| name | Yes | 2–80 chars |
| phone | Yes | Exactly 10 digits; unique among non-deleted members — conflict surfaced as a save error naming it |
| date_of_birth | Yes | Date picker |
| date_of_joining | Yes | Date picker |
| gender | Yes | Male / Female / Other |
| email | Yes | Format-validated if present, optional |
| residential_address | Yes | Optional |
| aadhaar_number | Yes | Optional, no format validation (per member-management.md) |
| occupation | Yes | Optional |

`branch_id` is **not** shown as an input anywhere on this section, or anywhere on this page — it's a registration-time fact, frozen by `generate_member_number()`'s `UPDATE` branch (REQ-MEM-006, `database.md`). If it needs a display at all, it's read-only next to Member Number in §6, not here.

---

## 8. Body Metrics

| Field | Editable | Rule |
|---|---|---|
| weight_kg | Yes | Decimal 1–500, up to 2 decimal places |
| height_cm | Yes | Decimal 1.0–300.0 |

Both are **required**, not optional — this is the one place the old RN doc was most wrong (it had both as nullable/optional). A required field left empty in edit mode blocks Save with an inline error, same as any other required field.

---

## 9. Doctor's Care

| Field | Editable | Rule |
|---|---|---|
| under_doctor_care | Yes | Yes/No toggle, defaults No |
| doctor_care_details | Conditional | Shown and required (blocks Save) only when `under_doctor_care = Yes`; hidden otherwise |

Matches `chk_doctor_care_details_required` exactly — including that a value consisting only of whitespace is rejected server-side too (`database.md`), so client validation should trim before checking non-empty, not just check truthiness.

---

## 10. Emergency Contact

| Field | Editable | Rule |
|---|---|---|
| emergency_contact_name | Yes | Required |
| emergency_contact_phone | Yes | Required |
| emergency_contact_relationship | Yes | Required |

No format validation specified for the phone here beyond required (unlike the member's own `phone`, which is 10-digit-validated) — matches `member-management.md` §2, which gives this field no format rule.

---

## 11. Photo

Upload or camera-capture control, same flow as Add Member (REQ-MEM-002/004, `member-management.md` §4):

1. Staff chooses "Take Photo" (opens `CameraCaptureModal`, a live `getUserMedia` preview — not a `capture`-attribute file input, which desktop browsers ignore) or "Upload Photo" (file picker). If the camera can't be used, the modal shows an error and the user closes it and taps "Upload Photo" instead — both buttons are always visible side by side, so this is a manual choice, not an automatic fallback. Never a dead end.
2. Browser compresses client-side (canvas) to ~400px longest side, targeting <50KB.
3. Both the original and compressed file upload to the `member-photos` Storage bucket; a follow-up `memberRepository.update(id, { photo_url, photo_thumbnail_url })` call saves both URLs — **separate from** the rest of the member field save (`isSavingMember`/`memberSaveError` are for personal-details/body-metrics/etc.; photo has its own `photoError` state, per §4.1).
4. If compression or upload fails: the rest of the member record is unaffected (this was never blocking to begin with, since it's a separate call) — show an inline error on the hero photo control with a retry action. Never blocks viewing or editing the rest of the page.
5. **Photo lightbox (new):** clicking the hero photo itself (when `photo_url` is set — an initials-avatar placeholder isn't clickable) opens it enlarged in a full-screen overlay, via the same shared `PhotoLightbox` component the Members List uses ([member-management.md §3.4](./member-management.md#34-members-list)). The hero already shows `photo_url` (the original, not the thumbnail — §11 above), so the lightbox enlarges exactly what's already on screen, just bigger. Click the backdrop, press Escape, or tap the close button to dismiss. This click is separate from the Take Photo/Upload Photo controls (§11 above), which sit beside the photo, not on top of it.

---

## 12. System Fields

Shown read-only near the hero/personal-details area, never as inputs:

| Field | Editable | Notes |
|---|---|---|
| member_number | No | REQ-MEM-005 |
| created_by | No | Shown as the creating staff member's name (resolve `profiles.full_name` for the id) — REQ-MEM-003 |
| branch_id | No | Registration-time fact, see §7 |
| handled_by_staff | **Yes** | The one exception — independently editable by any active user, own save action optional (can share the Personal Details save button), never overwrites `created_by` — REQ-MEM-003 |

---

## 13. Member Save Flow

```
Save tapped (Personal Details / Body Metrics / Doctor's Care / Emergency Contact / handled_by_staff)
  → validate all fields client-side (blur-per-field + submit-all-at-once, same as Add Member)
      → errors: show inline, stop
      → valid: setIsSavingMember(true)
          → memberRepository.update(member.id, memberForm)
              → success: setMember({ ...member, ...memberForm })
                          setIsEditingMember(false)
                          setIsSavingMember(false)
              → failure: setMemberSaveError(message)  // e.g. phone conflict, naming it
                          setIsSavingMember(false)
                          // form stays open, in edit mode
```

`memberForm` is typed `UpdateMember` (§2) — `member_number`/`created_by`/`branch_id` are structurally absent from that type, so there's no accidental way to include them in the payload even if a future edit introduced a bug; the DB trigger would silently pin them back regardless (defense in depth, not the only guard).

---

## 14. Current Membership & Add-ons

Replaces the old doc's "Current Subscription" section — under the header/line-item model a member's current holdings are **a set of items**, not one row (`backend/subscription-management.md`).

```
CURRENT MEMBERSHIP

┌─────────────────────────────────────────┐
│  Annual                                  │
│  01 Jun 2026 – 31 May 2027   ● Active    │
│  ₹8,000 · Cash                           │
└─────────────────────────────────────────┘
                                    [Renew]

CURRENT ADD-ONS

┌─────────────────────────────────────────┐
│  Zumba Class          01 Jul – 30 Jul    │
│  Personal Training    15 Jul – 14 Aug    │
└─────────────────────────────────────────┘
```

| Section | Source | Empty state |
|---|---|---|
| Current Membership | `currentMembershipItem` (§4.5) — the single `category = 'membership'` item with the latest `end_date`, or indefinite if one exists | "No active membership" + an "Add Subscription" CTA opening `/members/:id/renew` (same screen either way — see §16) |
| Current Add-ons | `currentAddonItems` (§4.5) — **all** current add-on items, not just one | Section hidden entirely if empty (not an empty-state message — a member with no add-ons is the normal case, unlike no membership) |

Renew button always opens the same checkout screen (§16), whether the member currently has a membership, an expiring one, or none at all — there's no separate "first subscription" vs "renewal" screen, matching `subscription-management.md` §3.

---

## 15. Subscription History

One row per past **checkout** (`subscriptions` header), newest first — not one row per item:

```
SUBSCRIPTION HISTORY

▸ 01 Jun 2026 · Cash · ₹8,800                      [Edit]
    Annual (membership) · 01 Jun 2026 – 31 May 2027
    Zumba Class (add-on) · 01 Jun 2026 – 30 Jun 2026

▸ 15 Jan 2026 · UPI · ₹1,000
    Monthly (membership) · 15 Jan 2026 – 13 Feb 2026
```

| Element | Behavior |
|---|---|
| Row header | Checkout date (`created_at`), `payment_mode`, sum of the checkout's item `amount_paid` values |
| Expand | Reveals every `subscription_items` row in that checkout, each showing plan name + category + its own date range |
| Edit | Opens a small inline form for **`payment_mode`/`notes` only** — calls `subscriptionRepository.update()` (→ `update-subscription`). No field on any line item is editable here, or anywhere — not `plan_id`, not dates, not `quantity`, not `shared_member_id`. This is a hard rule, not a missing feature: adding/removing/changing an item is always a new checkout (§16) |
| Empty state | "No subscription history yet" |

This directly replaces the old doc's per-subscription edit sheet (Section 15 in the previous version), which let staff change plan/dates/amount on an existing record — that capability doesn't exist in the current data model at all.

---

## 16. Renew / Add Subscription (`/members/:id/renew`)

Full checkout-builder screen — not a bottom sheet. See **[frontend/subscription-management.md §2–5](./subscription-management.md)** for the complete, authoritative spec (this section is a pointer, not a duplicate):

- **Fields** (§2 of that doc): header (`payment_mode`, `notes`) + one-or-more items (`plan_id`, `start_date`, `quantity`, `amount_paid`, `shared_member_id` where applicable), with exactly one item required to be `category = 'membership'`.
- **Renewal start-date default** (§4 of that doc): membership items default to the day after the member's current membership item's `end_date` if one exists, else today; add-on items use the same logic scoped to that add-on's own `plan_id`.
- **Overlap warning** (§5 of that doc): client-side only, checked per item right before the `create-subscription` call, using `member_current_items` — membership items conflict against *any* existing current membership item, add-on items only against the *same* `plan_id`. Cancel-or-proceed dialog; nothing persisted either way.
- **Submit**: `subscriptionRepository.create()` → `create-subscription` Edge Function → on success, navigate back to `/members/:id`, where §14/§15 re-fetch and reflect the new checkout.

Do not re-derive any of this here — if it changes, update `subscription-management.md` first, then this pointer's wording only if the route or entry point changes.

---

## 17. Delete Member (REQ-MEM-007)

A destructive action on this page (confirm dialog), calling `memberRepository.delete(member.id)` — a plain soft-delete update (`deleted_at`/`deleted_by`), same RLS-guarded path as any other member update. On success, navigate to `/` (Members List). No separate "deactivate" state exists for members — this is the only removal action. Deleting never touches `subscriptions`/`subscription_items`/`audit_log` — that history is retained unchanged and still visible to reports, independent of the member's `deleted_at`.

---

## 18. Edge Cases

| Scenario | Expected behavior |
|---|---|
| Member ID not found / soft-deleted | Load error → message + link back to `/` |
| Member has zero current items and zero history | Both §14 and §15 show their respective empty states — this is a normal state for a brand-new member, not an error |
| `photo_url` missing | Hero shows initials avatar, no broken-image icon |
| `handled_by_staff` null | Shown as "Not set" in view mode, a staff picker in edit mode |
| `doctor_care_details` toggled to Yes then blanked before Save | Blocks Save with a validation error, same as create (REQ-MEM-001's rule applies identically to edit) |
| Phone changed to a value already used by another non-deleted member | Save fails with a conflict error naming it (REQ-MEM-001/006) — `memberForm` stays populated, edit mode stays open |
| Two browser tabs editing the same member | Not specially handled — last write wins, same as every other table in this app; no optimistic-concurrency check exists anywhere in this project |
| Subscription History row belongs to a couple-plan item (`shared_member_id` set) | Shown once on this member's history (as either `member_id` or `shared_member_id`), with a small "shared with {other member's name}" note — read-only, not editable from here |

---

## 19. Requirements Traceability

| Requirement | Implementation |
|---|---|
| REQ-MEM-002/004 | §11 Photo |
| REQ-MEM-003 | §12 System Fields (`created_by` read-only, `handled_by_staff` editable) |
| REQ-MEM-005 | §6 Hero (member_number read-only) |
| REQ-MEM-006 | §7–10, §13 (edit everything except member_number/created_by/branch_id) |
| REQ-MEM-007 | §17 Delete Member |
| REQ-SUB-001–004/006/007/009 | §16 → subscription-management.md |
| REQ-SUB-005/008 | §16 → subscription-management.md §5 |
| REQ-LIST-003 (status derivation reuse) | §4.5, §6 |
| (non-functional) loading/error/retry, empty states, mobile-responsive | §4.2–§4.4 — enforced app-wide by [rules.md](./rules.md) rules 16, 29–31 |

---

## Related docs

- [member-management.md](./member-management.md) — Member field list, screens, photo flow (authoritative; this doc points here rather than repeating field rules)
- [subscription-management.md](./subscription-management.md) — checkout form, overlap warning (authoritative for §16)
- [navigation.md](./navigation.md) — route map this page's paths come from
- [app-shell.md](./app-shell.md) — the shared shell this page renders inside
- [../backend/member-management.md](../backend/member-management.md), [../backend/subscription-management.md](../backend/subscription-management.md) — backend counterparts
