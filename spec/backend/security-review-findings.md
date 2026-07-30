# User Management, Photo Storage & Audit Trail Review — Open Findings

> Supabase-expert pass over the newly added `invite-user`/`list-users`/`update-user` Edge
> Functions, the `profiles` RLS policies, and the `member-photos` storage bucket, done
> 2026-07-21. Checklist for tracking — check items off as they're addressed (in the schema,
> the Edge Function, or the doc).
>
> The Critical finding (`profiles_update_self_name` allowed self-promotion to admin) and the
> High finding (`profiles` was the only audited table missing `set_audit_fields`/
> `prevent_hard_delete`/`audit_row_changes`) originally tracked here were both verified fixed
> in [20260722000000_roles_and_user_roles.sql](../../supabase/migrations/20260722000000_roles_and_user_roles.sql)
> — `role` moved off `profiles` into `roles`/`user_roles` with zero client write access, a
> column-level grant restricts direct `profiles` writes to `full_name` only, the `on delete
> cascade` FK to `auth.users` was dropped, and all three shared triggers are now attached —
> and have been removed from this list. See [domain-model-review.md](./domain-model-review.md)'s
> Critical #1 for the related `profiles.id ... on delete cascade` fix that unblocked the High
> item.

---

## Low / polish

- [ ] `weight_kg`/`height_cm` are unscoped `numeric` (arbitrary precision) while every
  monetary column uses `numeric(10,2)`
  ([20260720000100_transactional_data.sql:22-23](../../supabase/migrations/20260720000100_transactional_data.sql#L22-L23)) —
  harmless given the existing CHECK bounds, just a style inconsistency worth a pass if
  `database.md` gets a numeric-precision pass anyway.
