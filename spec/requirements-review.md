# Requirements Review — Gaps, Missing & Conflicting Items

> Source reviewed: [requirements-template.md](./requirements-template.md). Answer inline under each item (e.g. replace `> Answer:` with your decision), then fold resolved items back into the requirements doc (Section 2 changes, Section 5 Out of Scope, or Section 6 Open Questions as appropriate).

---

## Contradictions

### 1. `date_of_birth` listed as both required and optional
Line 64 lists `date_of_birth` under Member (required); line 65 lists it again under Member (optional). REQ-MEM-001 itself calls it "mandatory." The optional-list entry looks like a leftover copy/paste error.

> Answer: date of dirth is an required field not an optional one update the required so everwhere it is marked as required

### 2. `branch` required by REQ-MEM-001 but missing from Data Touched
REQ-MEM-001 (line 33) requires `branch` at registration, and REQ-MEM-005 depends on it for member-number generation (`<branch code>-<year>-<sequence>`). But the Member "required" field list (line 64) never mentions a `branch`/`branch_id` field.

> Answer:  Yes The branch table should have the branch name, branch id as manditory fields

### 3. Multi-branch: core feature vs. "out of scope" placeholder
The spec already has a `Branch` entity, branch-scoped member numbering (REQ-MEM-005), and a full Branch Management admin screen (REQ-ADMIN-003) — branches are clearly load-bearing. Yet Section 5 (line 451) still carries the placeholder example "Multi-gym / multi-branch support" as out-of-scope, and the Section 3/4 example text says "single gym location... no multi-tenant requirement." Likely intent: single-tenant business, but multi-branch (multiple physical locations within that one business) is IN scope. Needs explicit confirmation since the placeholder text contradicts the rest of the doc.

> Answer: The branch does not bring any signifacance other then members added att he time of adding where they are resuterd and then it user foe member id gereation. NBut it does not bring any other signoifance as of now

---

## Missing / Gaps

### 4. Sections 3 and 4 are entirely unfilled placeholder text
Non-Functional Requirements and Constraints & Assumptions (lines 425–443) still contain only the `<e.g. ...>` template examples, not real content. The doc's own closing instruction (line 474) says not to proceed to the domain model until these are filled in or moved to Out of Scope/Open Questions.

> Answer: 1) All the entities should have create at, created by, changed at and changed by attributes, 2) All entities shoudl only suport soft deleted with column is deleted denothing whether that records is delted. An it is not rturned tohtorug API, user e=when validation until explicaitly syateted 3) All entitrs whne change should be logged in the audit log entity forauting 4) Alway follow best proactice 5) always follow spec deriven deveopment spec need to be change before the changing the functionality

### 5. No deletion guard specified for `AddOn` or `Branch`
Plans have an explicit "used by X subscriptions" delete guard (REQ-ADMIN-002, line 391). AddOn (REQ-ADDON-001) and Branch (REQ-ADMIN-003) have no equivalent — deleting an AddOn referenced by past `SubscriptionAddOn` rows, or a Branch referenced by existing members' `branch_id`/member numbers, is undefined.

> Answer: Yes lets added the non delete graoun if members are added to a branch or addon

### 6. Cancelling a subscription's effect on its attached add-ons is undefined
REQ-SUB-012 lets staff cancel a subscription. It's silent on what happens to that subscription's still-active, refundable add-ons (`SubscriptionAddOn` rows) — do they auto-cancel, stay active independently, or require separate manual cancellation? This affects REQ-SUB-013's "latest subscription" status logic and reporting.

> Answer: Every thing is indepence in Ui they will should in the same form but in back subscription record and add-on record are independed they need to be cancelled seperately and records.

### 7. `max_members > 2` isn't actually supported by anything
REQ-SUB-004 (line 221) explicitly says the UI only supports primary + secondary (2), while `Plan.max_members` is a free integer field with no upper bound enforced. If an admin sets `max_members = 3` via REQ-ADMIN-002, there's no defined behavior.

> Answer: Valida concern let note it and handel it later

### 8. `SubscriptionAddOn` overlap tracking is less complete than `Subscription`'s
For subscriptions, REQ-SUB-005 records both `overlap_override` and `overlap_conflict_subscription_id` (the specific conflicting record). For add-ons, REQ-SUB-008 / Data Touched (line 217) only mirrors `overlap_override` — there's no equivalent "which prior add-on attachment did this conflict with" reference for audit purposes.

> Answer: Both should folow =same rules if they are overlapinf inform user get concent and allow the overlaping record.

### 9. No password-reset / forgot-password flow
REQ-AUTH-001–004 covers sign-in and invite, but never addresses password reset for existing accounts.

> Answer: Yes we need password reset flows

### 10. No general "edit member" requirement
REQ-MEM-001 covers creation; REQ-MEM-003 covers only the `handled_by` field edit. There's no requirement stating staff/admin can edit a member's core details (phone, weight, doctor's-care status, etc.) after creation, even though this is clearly assumed elsewhere (e.g. photo retry in REQ-MEM-004).

> Answer: Yes we need this user can edit member details except the unquie id generaed by the app everything else but we need to make sure the phone number, member_id, cannot be same as other person, event when creating

### 11. REQ-SUB-011 only covers *reducing* quantity, not increasing it
Line 148 and its acceptance criteria are explicitly scoped to lowering quantity on an existing subscription/add-on. Whether quantity can later be *increased* (extend the term) is unaddressed.

> Answer: Lets note it down, Lets handel it lagter, For now lets say only during cancelition flow they can lower it not on edit that  a condition

---

## Minor / Ambiguity

### 12. REQ-LIST-001 sort options don't match its own acceptance criteria example
The requirement lists final sort options as "join date, member name, subscription status" (line 97), but the acceptance criteria example (line 95) cites `expiry-asc` as a valid sort — expiry date and subscription status are different sort keys.

> Answer: Update the requirement by default lets show the member details with joining date descedning and  other avialable as options

### 13. REQ-MEM-002 priority value "Optional" isn't a valid enum value
The Priority column is defined as Must/Should/Could throughout the doc; line 34 uses "Optional" instead — likely should be "Could."

> Answer: Explain where it is exactly for me to resolve

### 14. Every Feature Area section is numbered "2."
All nine feature-area headers (Member Management, Member List, Subscription Management, Add-on Management, Reporting, User Authentication, Audit Trail, Admin Data Management) share the literal heading "## 2. Feature Area: ..." instead of being numbered sequentially. Not a requirements gap, but likely to cause confusion if anything ever cross-references "Section 2" specifically.

> Answer: Update the number please
