# Data Export / Import (WSCR-17) — Frontend Spec

> **Status: §1–§3 (the screen and the Export section, REQ-ADMIN-007) are implemented (Phase 1). §4 Import (Merge) and §4A Restore are specification only — the Import section is not rendered yet.** Requirements: [REQ-ADMIN-007 / 008 / 009](../requirements-template.md#9-feature-area-admin-data-management). Backend contracts: [../backend/data-export-import.md](../backend/data-export-import.md) (workbook format, export, Merge) and [../backend/data-restore.md](../backend/data-restore.md) (Restore) — this file never restates them, it only specifies the screen and the client-side layers.
> Binding rules: [rules.md](./rules.md), the *Responsive rendering rules* and *Testing rules* in the root `CLAUDE.md`.

## 1. Screen

| | |
|---|---|
| Screen | **WSCR-17 — Data Backup** (export · import-merge · restore) |
| Route | `/data-backup` (lazy chunk, like every page) |
| Access | **Admin only** — `<RequireAdmin>` (inline "Access Denied" for staff, per [navigation.md](./navigation.md)); UX only, both Edge Functions re-check |
| Reached from | Settings hub (WSCR-11) Data Management grid — new card **Data Backup** (icon `Download`, no count) — and a new **Backup** pill in `AdminTabs` (after *Numbering*). No primary-nav entry. |
| Tab bar | Shown on mobile like the other admin sub-pages (no `hideTabBar`). The Settings nav item stays active on `/data-backup` (`isNavItemActive()` list gains the route). |

## 2. Layout

Single column at every width, `max-width` ~720px, page header + `AdminTabs`, then four stacked blocks:

1. **Notice** (always visible): "Exports contain personal and medical data (Aadhaar numbers, medical notes, emergency contacts, emails). Store them securely. Import has two modes: **Add data (merge)** adds or updates records in this project and regenerates member numbers and history; **Restore a backup** rebuilds an empty project exactly as it was, including ids and the audit log."
2. **Export** section.
3. **Import** section.
4. **Last result** area (the current operation's progress/result, with an `aria-live="polite"` region).

The only alternate rendering is the import **preview summary**: a `<table>` at `>= 768px` and a card list below, chosen with `useIsTabletUp()`; exactly one is in the DOM at each width (CLAUDE.md responsive rule 1; asserted in tests). Page state (checkbox values, chosen files, preview) lives in the page component above that switch so rotating or resizing never loses it (rule 5).

## 3. Export section

Controls: checkbox **Include audit log (can be large)** — default on; checkbox **Include member photos (separate .zip)** — default on; primary button **Export data**.

States (single machine; every state has a visible label, never colour alone):

| State | UI |
|---|---|
| `idle` | Controls enabled |
| `reading` | Determinate bar (`role="progressbar"`, `aria-valuenow/min/max`; the value is tables finished ÷ tables to read) + text "Reading members… 1,000 rows" (the running row count — the function does not report a table total up front, so there is no "x / N" per table); **Cancel** button |
| `building` | "Building workbook…" (indeterminate) |
| `photos` | "Downloading photos… 120 / 340" determinate; Cancel |
| `ready` | Two explicit buttons — **Download data (.xlsx)** and **Download photos (.zip)** (+ size, count; one per part if split) — plus a warnings list (unreadable photos, truncated cells). **No auto-download** (browsers block multiple automatic downloads). Blob URLs are revoked when the page unmounts or a new export starts. |
| `cancelled` | "Export cancelled." + **Start again** |
| `offline` | `isNetworkError()` ⇒ the existing offline wording + **Retry** (re-runs the whole export). Never string-compares a message. |
| `error` | The Edge Function's message surfaced verbatim, or a generic fallback, + **Retry** (rules.md 29–31) |

Export never persists anything and never changes data. A second click while running is impossible (button disabled).

## 4. Import section

First control: a **mode** radio group — **Add data to this project (merge)** (default) and **Restore a backup (same ids and history)**. The mode is explicit, never inferred from the file; changing it resets the section to `idle` (all state below is per mode). Everything in this section (§4) is **merge**; the restore flow is §4A.

Controls, in order:

1. **Excel file** — `<input type="file" accept=".xlsx">`, required. Label "Data workbook (.xlsx)".
2. **Photos** — `<input type="file" accept=".zip" multiple>`, optional. Hint: "Add the photo zip(s) exported with the workbook; photos are only added for members created by this import."
3. Checkbox **Also update existing members, plans and branches** — default off. Hint: "Blank cells never overwrite existing values."
4. Checkbox **Skip invalid rows and import the rest** — default off. Hint: "Off: if any row is invalid, nothing is imported."
5. Button **Check file** (disabled until an `.xlsx` is chosen).

Flow and states:

| State | UI |
|---|---|
| `idle` | As above |
| `file-error` | Immediate, no request: not an `.xlsx`, > 10 MB, unsupported `schema_version`, no importable sheets, missing required column, or more than 2,000 importable rows ("split the file — importing it in several parts is safe"). Names the exact problem. |
| `checking` | "Checking file…" — parse (dynamic `import()` of the reader), build payload with `_row` numbers, one `import-data` call with `dry_run: true` |
| `preview` | Per-sheet summary (**new · will update · already exist · skipped (deleted) · errors**) in table/cards; warnings (ignored columns, unresolved `handled_by_email`, blank `date_of_joining` defaulted to today); the **first 50 errors** (`Row 14 — Phone: Enter a valid 10-digit phone number…`) with **Download full report**; **Import N rows** button — enabled only when N > 0 and (errors = 0 or *Skip invalid rows* is on). Changing either checkbox or the file invalidates the preview and returns to `idle`. |
| `confirming` | Modal (z-index 50): "Import 312 new and 5 updated rows? This cannot be undone from the app." **Import** / **Cancel**. Focus is trapped and returns to the trigger. |
| `importing` | "Importing…" (indeterminate — one atomic request); all controls disabled |
| `photos` | If zips supplied: "Uploading photos… 12 / 340" determinate; Cancel stops further uploads (members already created stay) |
| `done` | Summary of what was committed, photo outcome ("338 added, 2 skipped"), per-row warnings, **Download report (.xlsx)**; heading receives focus |
| `aborted` | Server returned `committed: false` (any invalid row with *Skip invalid* off): "Nothing was imported." + the error list |
| `offline` / `error` | As in §3. After an offline failure during `importing` the screen says the outcome is unknown and instructs the admin to run **Check file** again — re-importing is safe because every row has a natural key (idempotent). |

Server messages are shown verbatim; React escapes everything (cell text is data, never HTML).

## 4A. Restore mode

Backend contract: [../backend/data-restore.md](../backend/data-restore.md). Chosen with the mode radio in §4. A persistent prerequisite note sits above the controls: "Restore only works on a project without member data, and your own account must already exist here with the **same id** it had in the backup (see the restore runbook). It rebuilds everything exactly as it was — member numbers, who created what, and the audit log. Users get no password: they use *Forgot password* or Google."

Controls: **Excel file** (same input as merge); **Photos** (`.zip`, multiple, optional). No merge checkboxes — restore is all-or-nothing.

A **stepper** (visible text "Step 2 of 5 — …", not colour alone) with exactly these steps; a step the data doesn't need (accounts) is skipped and the count adjusts:

| Step | State(s) | UI |
|---|---|---|
| 1 Select | `idle`, `file-error` | As merge's file-level errors, plus restore's: a sheet missing, README counts ≠ rows, unsupported `schema_version`, > 100 MB / > 500,000 rows |
| 2 Stage & check | `staging` → `checking` → `check-failed` / `checked` | "Reading workbook… / Uploading 120,000 / 340,000 rows…" (determinate, Cancel). Then the **sanity-check report**: each of R1–R15 (data-restore.md §4) as a labelled row — **Passed / Warning / Blocked** with counts and the first 50 row-numbered messages; **Download full report**. Any *Blocked* check stops here with the reason (e.g. "This project already has 213 members that are not in the backup — use Add data (merge) instead"; "Your account exists here with a different id — restore needs the same id; see the runbook"). |
| 3 Accounts | `accounts-needed` → `creating-accounts` → `accounts-ready` | Shown only if accounts are missing: "N accounts will be created **without passwords** and stay blocked until the restore finishes." **Create accounts** button (idempotent; failures listed per email, Retry). |
| 4 Preview & restore | `previewing` → `preview` → `confirming` → `restoring` | The dry run (rolled back) returns per-table counts (**inserted · adopted · overwritten**), warnings (R10 counter raised, R14 format-rule warnings — counts + first 50, never blocking), and any error list. **Restore** is enabled only with zero errors. Confirm modal (z-index 50): lists the counts and says "This rewrites this project's data and history and cannot be undone from the app. Type **RESTORE** to continue." — the confirm button stays disabled until the exact text is typed; focus trapped, restored on close. During `restoring` all controls are disabled (one atomic request, indeterminate). |
| 5 Photos & finish | `photos` → `done` / `aborted` | If zips were supplied: "Restoring photos… 120 / 340" (determinate, Cancel — the data is already restored), failures listed. `done`: summary, accounts unbanned count, warnings, **Download report (.xlsx)**, a reminder that restored users must use *Forgot password*; heading receives focus. `aborted` (the transaction rolled back): "Nothing was restored." + the error list; **Start again**. |

Offline/error at any step: `isNetworkError()` ⇒ offline copy + Retry of that step. Staging is idempotent (chunks keyed by job, sheet and row) and **accounts** and **run** are idempotent, so Retry/refresh after an interruption is always safe; after an *offline failure during the commit* the screen says the outcome is unknown and tells the admin to run the check again (a completed restore shows as already restored — nothing to do). The staged job is cleaned up automatically after `done`, `aborted` or Start again.

Layering additions: see §5 (restore adds `data-restore.service.ts` and repository methods; the page still talks only to services).

## 5. Layering and files

View → Service → Repository, per [architecture.md](../architecture.md). The page and components never import `supabase-js`, a library, or call `functions.invoke`.

```
frontend/src/
  lib/data-transfer/
    workbook-schema.ts        ← ONE definition per sheet: header names, canonical keys, types, formatter,
                                parser, required/importable flags, alias matching. Shared by export + import.
    xlsx-writer.ts            ← dynamic import('write-excel-file/browser'); string-typed cells, frozen bold header
    xlsx-reader.ts            ← dynamic import('read-excel-file/browser'); header matching, _row numbers, value normalisation
    photo-zip.ts              ← dynamic import('fflate'); entry naming from blob content type, part splitting
  repositories/
    data-transfer.repository.ts   ← exportPage(table, after, limit), importWorkbook(request),
                                    restoreStage(chunk), restoreCheck(job), restoreAccounts(job),
                                    restoreRun(job, dryRun, confirm), restoreCleanup(job),
                                    downloadPhoto(path): Promise<Blob>, uploadRestoredPhoto(path, blob)
                                    (uses extractFunctionErrorMessage)
  services/
    data-export.service.ts    ← orchestrates pages → workbook → photos; progress callbacks; AbortSignal
    data-import.service.ts    ← Merge: parse → payload → dry run → apply → photo upload (reuses memberService.uploadPhoto)
    data-restore.service.ts   ← Restore: parse → chunked stage → check → accounts → dry run → run(confirm) → photo restore
                                (uploads to the exact paths in members.photo_url / photo_thumbnail_url; reuses compressImage)
  pages/
    DataBackupPage.tsx / .css / .test.tsx
  components/AdminTabs.tsx    ← + { label: 'Backup', path: '/data-backup' }
  pages/SettingsPage.tsx      ← + Data Backup card (no count)
  context/services.context.tsx ← register dataTransferRepository, dataExportService, dataImportService
  test/fakes.ts               ← fakes for the new repository/services (un-faked methods throw a named error)
frontend/e2e/data-backup.spec.ts
```

Rules: libraries are only reachable through the three `lib/data-transfer/*` modules (each a dynamic import, so the main and page chunks stay small — verified by inspecting the `vite build` chunk output); `workbook-schema.ts` is the single place a column is named; services take their repository via the `useServices()`/constructor pattern (never a repository singleton import, per CLAUDE.md layer rules); progress is reported through callbacks and cancellation through `AbortSignal`, so services stay UI-free and testable.

## 6. Accessibility and mobile conventions

Every control has a visible label; both file inputs and checkboxes are keyboard operable; all buttons ≥ 44×44 px; form controls 16px below 768px (global rule); progress is exposed as `role="progressbar"` with a text equivalent and a polite live region (not colour alone); the confirm modal traps focus and restores it; the result heading receives focus on `done`/`aborted`. No hex literals; tokens only. Network-bound steps (pages, photo downloads) are async and never block the main thread. **Known limit:** the final workbook write is one uninterruptible library call that blocks the main thread for about 1 s per 50,000 audit rows (backend spec §11 spike), during which the page cannot repaint or respond to Cancel; the service yields once so "Building workbook…" is painted before it starts, and honours a Cancel pressed just before it. A Web Worker would remove the freeze (backend spec §13.6).

## 7. Tests (CLAUDE.md testing rules 1–7)

| Layer | Must cover |
|---|---|
| Unit — `workbook-schema` | Every sheet: format ↔ parse round-trip; header aliasing (case, space/underscore, reordered, deleted, unknown columns); text columns survive numeric cells (leading-zero phone → clear error); ISO date vs Excel date cell vs ambiguous `05/06/2026`; boolean spellings; blank = no value |
| Unit — services (fake repository) | Export: pagination loop, abort stops requests, photo failure → warning not failure, README warnings, part split at threshold. Import: payload shape with `_row`, options mapping, caps, file-level errors, `committed:false` handling, photo upload only for `created` members and never on a dry run or an aborted import |
| Component — `DataBackupPage` (`renderWithProviders`, fake services) | Every state in §3 and §4 incl. offline via a network-style error, error text verbatim, Retry; Import button gating on errors + *Skip invalid*; preview invalidation on option/file change; confirm modal; **exactly one** of table/cards at 390 px and 1024 px; staff sees Access Denied |
| Restore (unit + component, fake services) | Stepper skips *Accounts* when none needed; each *Blocked* check halts with its message (non-empty target, account id conflict, README count mismatch, missing sheet); warnings never block; **Restore stays disabled until exactly `RESTORE` is typed** (exact, case-sensitive match); `confirm` literal sent only on commit; chunked staging (retry resumes, idempotent); mode change resets state; photos upload to the *exact* stored paths and a failure is reported without failing the restore; offline at each step; one table/cards rendering at 390 / 1024 px |
| E2E (`frontend/e2e/data-backup.spec.ts`, desktop + mobile projects, Supabase mocked) | Export → both downloads offered, workbook opens with the expected sheets; import with a fixture workbook → preview counts → confirm → report; invalid fixture shows row-numbered errors and blocks Import; unmocked requests fail the test (existing rule) |
| Manual (not automatable) | A real workbook edited and re-saved in desktop Excel imports correctly (leading zeros, dates); `.xlsx` ≥ 10 MB and ≥ 2,000-row behaviour; large export memory on a mid-range phone |

## 8. Out of scope here

Scheduling, cloud destinations, workbook encryption or signing, restoring passwords/sessions/OAuth identities, restoring into a project that has member data (Merge covers that) — see the backend specs ([§1/§13](../backend/data-export-import.md), [data-restore.md §1/§13](../backend/data-restore.md)).

## Related docs

[../backend/data-export-import.md](../backend/data-export-import.md) · [../backend/data-restore.md](../backend/data-restore.md) · [screens.md](./screens.md) (WSCR-11 hub, WSCR-14/16 sibling admin screens) · [navigation.md](./navigation.md) · [rules.md](./rules.md) · [member-management.md](./member-management.md) (photo capture/compression the import reuses)
