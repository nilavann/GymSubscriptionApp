# Domain Model / Schema Review — Open Findings

> DB-expert pass over [domain-model.md](./domain-model.md) and the generated [database.md](./database.md), done 2026-07-19. Checklist for tracking — check items off as they're addressed (in the schema, the doc, or both).

---

## High

- [ ] **No `end_date >= start_date` check on `subscription_items`.** A cheap CHECK
  constraint that catches a whole class of future Edge Function bugs at the DB layer
  instead of in production data — currently nothing stops `start_date` and `end_date`
  from being inserted in either order.
  ([20260720000100_transactional_data.sql:86-87](../../supabase/migrations/20260720000100_transactional_data.sql#L86-L87))
  (`subscriptions`/`subscription_addons` as named in the original finding no longer
  match the schema — `subscriptions` has no date columns of its own, and
  `subscription_addons` doesn't exist; the equivalent table today is `subscription_items`.)
  **Pending, not applicable yet:** a `refund_amount <= amount_paid` check belongs with
  the deferred cancellation/refund design (REQ-SUB-011,
  [requirements-template.md](../requirements-template.md)) — there is no `refund_amount`
  column to constrain until that work is picked up. Add this CHECK alongside whichever
  migration introduces the column, not before.

---

## Medium

- [ ] **`audit_log` EAV growth has no stated retention/partitioning story.** Reasonable trade-off given the `change_id` grouping requirement — not asking to change the design — but worth a line in the doc so a future reader doesn't mistake unbounded per-field-per-edit growth for an oversight.

---

## Minor / decisions to make explicit

- [ ] Member-number sequence can gap on failed inserts (counter increments before the row is guaranteed to land) — fine for a display identifier, just confirm nothing downstream assumes contiguity.
- [ ] `text` + `CHECK IN (...)` used everywhere instead of native Postgres `ENUM` — reasonable modern choice (easier to alter), just flagging it was never stated as a deliberate trade-off.
