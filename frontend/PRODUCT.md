# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are front-desk staff at a small, real gym business — non-technical, at-the-counter operators who register members, take payments, and renew subscriptions all day, often on a shared desktop or a tablet at the front counter. A secondary admin/owner role manages plans, branches, staff accounts, roles, and reviews earnings/reports and the audit log. Staff and admin share the same login and member/reports screens; admin-only screens (Plans, Branches, Users, Roles, Settings, Audit Log, Member Numbering) are gated via `RequireAdmin`.

## Product Purpose

Fit & Fine is a gym membership and subscription management system for a small, real gym (single or multi-branch). It replaces manual/paper or spreadsheet tracking of members, plans, and payments with a system of record: register members, sell/renew memberships and add-ons, track per-branch member numbering, and give the owner/admin a live view of earnings and membership health (active/expiring/expired counts, revenue) via a dashboard-style Reports screen. Success means front-desk staff can complete a registration or renewal quickly with no training beyond the app itself, and the admin can trust the numbers (audit-logged, server-computed) without reconciling by hand.

## Positioning

Deliberately scoped simpler than enterprise gym-CRM suites (Mindbody, Zen Planner, etc.): a small gym's day-to-day workflow — register, renew, see who's expiring, see earnings — done with minimal training overhead, not a sprawling feature set. Ease of use for non-technical counter staff and a genuinely responsive layout across mobile, tablet, and desktop are the product's real differentiators for now, not competitive feature parity with larger platforms.

## Operating Context

Used at a real gym's front desk (desktop or tablet) for daily registration/renewal work, and by the owner/admin (any device) for plans, branches, staff/role administration, and reviewing reports. Multi-branch aware: members, subscriptions, and member-numbering sequences are branch-scoped. Business-critical computations (subscription end dates, plan-deletion safety, audit fields) are enforced server-side (Postgres RLS + Edge Functions per [spec/architecture.md](../spec/architecture.md)) — the client is treated as untrusted, since this runs as a public web app, not a closed device.

## Capabilities and Constraints

- Member lifecycle: add, edit, view detail (personal details, body metrics, photo), search/filter/sort a members list.
- Subscription lifecycle: renew/add subscriptions and add-on items per member, view subscription history; no client-side trust for `end_date` or overlap enforcement — see architecture.md's Server-Side Authority table.
- Master data: Plans, Branches, Roles are admin-managed catalogs with usage-guarded delete (soft delete, blocked if in use).
- Users & roles: multi-role assignment (not single admin/staff enum), admin invite flow via Supabase Auth email invite, self-protection rules (an admin cannot change their own role/active state).
- Reporting: summary tiles (total/active/expiring/expired members), expiring-this-week list, date-range-scoped earnings/transaction detail — no revenue breakdown beyond what's specified in [spec/frontend/reporting.md](../spec/frontend/reporting.md).
- Audit log: append-only, field-level change history, view-only, admin-only.
- Auth: Supabase Auth (email/password + Google OAuth), deactivated-account and password-reset flows.
- Responsive requirement: every screen must work across mobile, tablet (`>= 768px`), and desktop (`>= 1024px`) tiers per [spec/frontend/styling.md](../spec/frontend/styling.md) — mobile is the unprefixed default, not an afterthought.
- Terminology: "member" (not "customer"/"client"), "plan" (not "package"), "branch" (not "location"/"site"), "subscription" (a member's purchased plan instance, distinct from the Plan catalog entry).
- A sibling Expo/React Native mobile app exists in the same repo with its own spec (`spec/screens/`) — this web app is a separate, web-native edition (not a wrapper), and does not need to mirror the mobile app's pixel-level layout, only its data/business rules where explicitly noted as shared.

## Brand Commitments

Product name: "Fit & Fine — Gym Subscription Manager." The design system was redirected onto a new mockup-based visual language (`frontend/mockups/`) with a configurable tint × CTA-color × radius theme, implemented in [src/styles/tokens.css](src/styles/tokens.css) and documented in [DESIGN.md](DESIGN.md) — treat as the confirmed incumbent visual identity for refinement work, not a placeholder. This superseded the prior single-accent "Coral Jam" palette. Status colors (success/warning/danger) and the categorical avatar palette remain fixed, independent of the active theme, across this and the prior redesign.

## Evidence on Hand

No specific real branch names, member data, or financial figures were provided during this session — treat the existing seed data (`supabase/seed.sql`) as dev/demo data only, not real business evidence. Do not fabricate testimonials, customer counts, or revenue figures in any future design work; the Reports/earnings dashboard must read from real/seeded data, never invented sample numbers presented as if real.

## Product Principles

1. Front-desk speed over feature breadth — every counter workflow (register, renew, look up a member) should be completable fast, by a non-technical operator, with no training beyond the UI itself.
2. Trust the numbers — anything money- or date-related (end dates, earnings, audit trail) is server-computed and server-verified; the client previews but never decides.
3. Responsive is not optional — mobile, tablet, and desktop are all real usage contexts for this app (counter tablet, back-office desktop, on-the-go admin phone), not a single primary target with breakpoints bolted on.
4. Small-gym scope, not enterprise-CRM scope — resist feature creep toward Mindbody/Zen-Planner-style breadth; every addition should serve a small gym's actual daily operation.
5. Admin-only surfaces stay out of staff's way — role-gating (RequireAdmin) is a product principle, not just an access-control detail: staff should never see catalog/administration complexity they don't need.

## Accessibility & Inclusion

Minimum 44×44px touch targets on every interactive control at every breakpoint, and required-field markers doubled (visual asterisk + `aria-required`) per [spec/frontend/rules.md](../spec/frontend/rules.md) — these are existing, confirmed requirements, not new ones. No additional accessibility standard (e.g. a formal WCAG level) was specified beyond what the existing rules.md already encodes.
