# TODO

Follow-ups left over from the mobile view (Stone & Amber v3) and test-suite work. None of these block it; each one was found, deliberately not fixed in that change, and is small enough to take on its own. Tick a box when its fix lands, with the test that proves it.

## Fixes

- [ ] **Offline screens appear ~7 seconds late.** supabase-js (postgrest-js) retries a failed GET three times with 1s + 2s + 4s backoff before reporting the failure, so "Check your internet connection" shows about 7s after a request on a dead connection. Decide per call whether the retry helps (background reads) or hurts (a screen the user is waiting on) — postgrest-js has `.retry(false)` per query. Pages already treat the eventual error correctly (`lib/network-error.ts`). The offline E2E tests (`e2e/action-center.spec.ts`, `reports.spec.ts`) currently wait ~20s because of this; tighten them when it changes.
- [ ] **Member Numbering: icon-only save/cancel buttons have no accessible name.** `frontend/src/pages/MemberNumberingPage.tsx` — the ✕ and ✓ buttons in both the table row and the card (`.member-numbering-icon-button`). Add `aria-label`s (e.g. "Cancel edit", "Save next number for <branch>"). `MemberNumberingPage.test.tsx` and `e2e/admin-audit-numbering.spec.ts` find them by position/class today; switch them to role + name.
- [ ] **Members search placeholder truncates at 390px.** `frontend/src/pages/MembersListPage.tsx` (`placeholder="Search by name, member #, or phone"`) is cut to "…member #, or phon" on a phone. Shorten it or make it width-aware (CSS only, no second input).
- [ ] **Member Detail photo buttons are 26px, under the 44px touch-target convention.** `.member-detail-photo-button` in `frontend/src/pages/MemberDetailPage.css` (camera and upload circles on the avatar). Keep the 26px glyph and give the button a 44px hit area (e.g. a `::after` inset), without letting the two areas overlap. Add the 44px check to `e2e/members.spec.ts`.
- [ ] **Action Center badge query signs photo URLs just to count rows.** `useActionCenterCount` (`lib/action-center.ts`) calls `memberListRepository.getActionCenterQueue`, which runs `resolvePhotoUrls` on every row — a Storage signing request on every page load for a number. Give the repository a count-only path (`select('id', { count: 'exact', head: true })` with the same window) and use it for the badge. `e2e/lists-render-once.spec.ts` has a comment about the second sign call; remove it when this is done.
- [ ] **`AuditLogPage` imports a constant from the repository layer.** `frontend/src/pages/AuditLogPage.tsx` takes `AUDITED_TABLES` from `repositories/audit-log.repository` — a page must not import a concrete repository (CLAUDE.md layer rules). Move the list to `types/audit-log.ts` (or `lib/`) and import it from both sides. Related, already documented in CLAUDE.md "Testing rules" #3: seven services import their concrete repository module instead of an interface.

## Out of scope for now

- [ ] **E2E against a real local Supabase (Docker).** The current E2E fakes the network, so RLS policies, triggers and Edge Function code are not exercised by any test. Add a suite that runs the real stack (`supabase start`) for the server-authority rules in CLAUDE.md's table.
- [ ] **Six-state status ladder** (and the Action Center window shrinking from 30 to 7 days). The handoff README says to **confirm with the product owner before building it** — it changes the status vocabulary in Members, Member Detail and Renew and the badge count.
- [ ] **Dark mode.**
- [ ] **CI.** No workflow exists. Minimum: install, `npm run typecheck`, `npm run typecheck:e2e`, `npm run test`, `npm run build:frontend`, and `npm run test:e2e` (Playwright browsers cached; the suite takes ~5 minutes).

## Manual checks

- [ ] **Real iPhone on a Vercel preview.** Playwright's WebKit does not reproduce iOS Safari's safe-area, focus-zoom or address-bar behaviour. Check: the tab bar clears the home indicator, tapping an input does not zoom the page, the header and tab bar survive the address bar collapsing, the avatar menu signs out, and refreshing `/members/:id` (pull-to-refresh) stays on the member.
