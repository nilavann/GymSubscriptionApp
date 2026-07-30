-- crud-review.md Low/polish finding: "required" validation on branches.name/code, plans.name,
-- and roles.name was client-side only — the `not null` column constraint accepts '' or '   ',
-- so a direct API call (or a client bug) could still create a blank-named row. Add CHECK
-- constraints so the database itself rejects empty/whitespace-only values.

alter table branches
  add constraint chk_branches_name_not_blank check (trim(name) <> ''),
  add constraint chk_branches_code_not_blank check (trim(code) <> '');

alter table plans
  add constraint chk_plans_name_not_blank check (trim(name) <> '');

alter table roles
  add constraint chk_roles_name_not_blank check (trim(name) <> '');
