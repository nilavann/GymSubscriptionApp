-- Ad-hoc test data: 9 members with join dates spread across 2025-10-05 .. 2026-07-02,
-- and their subscription history through "today" (assumed 2026-07-21), for exercising
-- reports/filters/status pills over a realistic multi-month range.
--
-- NOT part of the official seed.sql (that file is throwaway fixture data seeded via
-- `supabase db reset`, keyed to relative current_date offsets). This script uses literal
-- dates on purpose, since the point here is a fixed, reviewable Oct-2025-to-date window.
--
-- Safe to run once against an already-migrated database (branches/plans from
-- 20260720000000_master_data.sql must already exist). Run manually — this file is NOT
-- wired into config.toml's db.seed.sql_paths, so `supabase db reset` will NOT pick it up.
-- Uses phone numbers 9700000001-9700000010 (seed.sql already owns the 9800000001-10 range)
-- so the two data sets never collide.
--
-- Run with: supabase db query --linked -f supabase/test-data/member-subscriptions-oct2025-jul2026.sql
-- (or paste into the Supabase SQL Editor for the linked project).

---------------------------------------------------------------------------
-- Members
---------------------------------------------------------------------------

-- 1. Rohan Mehta — joined 2025-10-05. Annual + indefinite Membership Fee add-on. Active.
insert into members (
  name, phone, date_of_birth, date_of_joining, gender, weight_kg, height_cm,
  under_doctor_care, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
  branch_id
) values (
  'Rohan Mehta', '9700000001', '1994-03-12', '2025-10-05', 'Male', 80.00, 176.00,
  false, 'Meena Mehta', '9700000101', 'Spouse',
  (select id from branches where code = 'MUM')
);

-- 2. Kavya Iyer — joined 2025-10-18. Two Monthly checkouts, a lapsed gap, then a Quarterly
-- + Zumba Class (qty 6) combo still active today. Exercises the "lapsed then renewed" case.
insert into members (
  name, phone, date_of_birth, date_of_joining, gender, weight_kg, height_cm,
  under_doctor_care, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
  branch_id
) values (
  'Kavya Iyer', '9700000002', '1997-07-08', '2025-10-18', 'Female', 58.00, 161.00,
  false, 'Ramesh Iyer', '9700000102', 'Parent',
  (select id from branches where code = 'MUM')
);

-- 3. Suresh Nambiar — joined 2025-11-02. Three consecutive Quarterly checkouts, back to
-- back with no gaps; the latest expires 2026-07-29 (8 days out — "Expiring soon" case).
insert into members (
  name, phone, date_of_birth, date_of_joining, gender, weight_kg, height_cm,
  under_doctor_care, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
  branch_id
) values (
  'Suresh Nambiar', '9700000003', '1985-11-20', '2025-11-02', 'Male', 84.00, 172.00,
  false, 'Latha Nambiar', '9700000103', 'Spouse',
  (select id from branches where code = 'MUM')
);

-- 4/5. Ananya Das (primary) + Vivek Das (shared) — joined 2025-12-10. Couple Monthly,
-- renewed once, then lapsed 21 days ago — "Expired" couple-plan case.
insert into members (
  name, phone, date_of_birth, date_of_joining, gender, weight_kg, height_cm,
  under_doctor_care, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
  branch_id
) values (
  'Ananya Das', '9700000004', '1996-02-14', '2025-12-10', 'Female', 56.00, 159.00,
  false, 'Vivek Das', '9700000005', 'Spouse',
  (select id from branches where code = 'MUM')
);
insert into members (
  name, phone, date_of_birth, date_of_joining, gender, weight_kg, height_cm,
  under_doctor_care, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
  branch_id
) values (
  'Vivek Das', '9700000005', '1994-05-30', '2025-12-10', 'Male', 79.00, 174.00,
  false, 'Ananya Das', '9700000004', 'Spouse',
  (select id from branches where code = 'MUM')
);

-- 6. Farhan Ali — joined 2026-01-15. Main "add-on" showcase: one checkout with THREE
-- items (Monthly membership + Zumba Class + Membership Fee), then a later Monthly-only
-- renewal expiring in 3 days ("Expiring soon").
insert into members (
  name, phone, date_of_birth, date_of_joining, gender, weight_kg, height_cm,
  under_doctor_care, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
  branch_id
) values (
  'Farhan Ali', '9700000006', '1999-09-09', '2026-01-15', 'Male', 90.00, 181.00,
  false, 'Nusrat Ali', '9700000106', 'Sibling',
  (select id from branches where code = 'MUM')
);

-- 7. Ishita Rao — joined 2026-03-01. Annual only, long runway (expires 2027-02-28).
insert into members (
  name, phone, date_of_birth, date_of_joining, gender, weight_kg, height_cm,
  under_doctor_care, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
  branch_id
) values (
  'Ishita Rao', '9700000007', '1992-12-01', '2026-03-01', 'Female', 61.00, 163.00,
  false, 'Deepak Rao', '9700000107', 'Spouse',
  (select id from branches where code = 'MUM')
);

-- 8. Manoj Pillai — joined 2026-05-20. Monthly only, never renewed — lapsed 33 days ago
-- ("Expired", no add-ons).
insert into members (
  name, phone, date_of_birth, date_of_joining, gender, weight_kg, height_cm,
  under_doctor_care, doctor_care_details, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
  branch_id
) values (
  'Manoj Pillai', '9700000008', '1990-06-15', '2026-05-20', 'Male', 87.00, 177.00,
  true, 'Type 2 diabetes, monitors blood sugar before sessions', 'Geetha Pillai', '9700000108', 'Spouse',
  (select id from branches where code = 'MUM')
);

-- 9. Divya Krishnan — joined 2026-07-01 (most recent). Day-plan trial (expired same day),
-- then upgraded to Monthly + Zumba Class the next day — still active today.
insert into members (
  name, phone, date_of_birth, date_of_joining, gender, weight_kg, height_cm,
  under_doctor_care, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
  branch_id
) values (
  'Divya Krishnan', '9700000009', '2001-01-25', '2026-07-01', 'Other', 52.00, 156.00,
  false, 'Ajay Krishnan', '9700000109', 'Sibling',
  (select id from branches where code = 'MUM')
);

---------------------------------------------------------------------------
-- Subscriptions (checkouts) + line items — direct inserts, matching seed.sql's
-- convention: end_date computed by hand as start_date + (duration_days * quantity) - 1,
-- or NULL for an indefinite plan.
---------------------------------------------------------------------------

-- Rohan Mehta: Annual (2025-10-05 -> 2026-10-04) + indefinite Membership Fee.
with new_sub as (
  insert into subscriptions (member_id, payment_mode, notes)
  values ((select id from members where phone = '9700000001'), 'Card', 'Initial signup')
  returning id
)
insert into subscription_items (subscription_id, plan_id, member_id, start_date, end_date, quantity, amount_paid)
select new_sub.id, v.plan_id, (select id from members where phone = '9700000001'), v.start_date, v.end_date, v.quantity, v.amount_paid
from new_sub, (values
  ((select id from plans where name = 'Annual'),         '2025-10-05'::date, '2026-10-04'::date, 1, 8000::numeric),
  ((select id from plans where name = 'Membership Fee'), '2025-10-05'::date, null::date,          1, 500::numeric)
) as v(plan_id, start_date, end_date, quantity, amount_paid);

-- Kavya Iyer: Monthly (2025-10-18 -> 2025-11-16), Monthly renewal (2025-11-17 -> 2025-12-16),
-- lapsed ~6 weeks, then Quarterly + Zumba Class x6 (2026-02-01 -> 2026-07-30/2026-05-01), still active.
with new_sub as (
  insert into subscriptions (member_id, payment_mode)
  values ((select id from members where phone = '9700000002'), 'UPI')
  returning id
)
insert into subscription_items (subscription_id, plan_id, member_id, start_date, end_date, quantity, amount_paid)
select new_sub.id, (select id from plans where name = 'Monthly'), (select id from members where phone = '9700000002'),
       '2025-10-18', '2025-11-16', 1, 1000
from new_sub;

with new_sub as (
  insert into subscriptions (member_id, payment_mode)
  values ((select id from members where phone = '9700000002'), 'UPI')
  returning id
)
insert into subscription_items (subscription_id, plan_id, member_id, start_date, end_date, quantity, amount_paid)
select new_sub.id, (select id from plans where name = 'Monthly'), (select id from members where phone = '9700000002'),
       '2025-11-17', '2025-12-16', 1, 1000
from new_sub;

with new_sub as (
  insert into subscriptions (member_id, payment_mode, notes)
  values ((select id from members where phone = '9700000002'), 'Cash', 'Rejoined after a break; upgraded to Quarterly + Zumba')
  returning id
)
insert into subscription_items (subscription_id, plan_id, member_id, start_date, end_date, quantity, amount_paid)
select new_sub.id, v.plan_id, (select id from members where phone = '9700000002'), v.start_date, v.end_date, v.quantity, v.amount_paid
from new_sub, (values
  ((select id from plans where name = 'Quarterly'),    '2026-02-01'::date, '2026-05-01'::date, 1, 2500::numeric),
  ((select id from plans where name = 'Zumba Class'),  '2026-02-01'::date, '2026-07-30'::date, 6, 4800::numeric)
) as v(plan_id, start_date, end_date, quantity, amount_paid);

-- Suresh Nambiar: three consecutive Quarterly checkouts, no gaps.
with new_sub as (
  insert into subscriptions (member_id, payment_mode)
  values ((select id from members where phone = '9700000003'), 'Cash')
  returning id
)
insert into subscription_items (subscription_id, plan_id, member_id, start_date, end_date, quantity, amount_paid)
select new_sub.id, (select id from plans where name = 'Quarterly'), (select id from members where phone = '9700000003'),
       '2025-11-02', '2026-01-30', 1, 2500
from new_sub;

with new_sub as (
  insert into subscriptions (member_id, payment_mode)
  values ((select id from members where phone = '9700000003'), 'Cash')
  returning id
)
insert into subscription_items (subscription_id, plan_id, member_id, start_date, end_date, quantity, amount_paid)
select new_sub.id, (select id from plans where name = 'Quarterly'), (select id from members where phone = '9700000003'),
       '2026-01-31', '2026-04-30', 1, 2500
from new_sub;

with new_sub as (
  insert into subscriptions (member_id, payment_mode)
  values ((select id from members where phone = '9700000003'), 'Card')
  returning id
)
insert into subscription_items (subscription_id, plan_id, member_id, start_date, end_date, quantity, amount_paid)
select new_sub.id, (select id from plans where name = 'Quarterly'), (select id from members where phone = '9700000003'),
       '2026-05-01', '2026-07-29', 1, 2500
from new_sub;

-- Ananya Das + Vivek Das: Couple Monthly, renewed once, then lapsed.
with new_sub as (
  insert into subscriptions (member_id, payment_mode)
  values ((select id from members where phone = '9700000004'), 'UPI')
  returning id
)
insert into subscription_items (subscription_id, plan_id, member_id, shared_member_id, start_date, end_date, quantity, amount_paid)
select new_sub.id, (select id from plans where name = 'Couple Monthly'),
       (select id from members where phone = '9700000004'), (select id from members where phone = '9700000005'),
       '2025-12-10', '2026-01-08', 1, 1800
from new_sub;

with new_sub as (
  insert into subscriptions (member_id, payment_mode)
  values ((select id from members where phone = '9700000004'), 'UPI')
  returning id
)
insert into subscription_items (subscription_id, plan_id, member_id, shared_member_id, start_date, end_date, quantity, amount_paid)
select new_sub.id, (select id from plans where name = 'Couple Monthly'),
       (select id from members where phone = '9700000004'), (select id from members where phone = '9700000005'),
       '2026-01-09', '2026-02-07', 1, 1800
from new_sub;

with new_sub as (
  insert into subscriptions (member_id, payment_mode)
  values ((select id from members where phone = '9700000004'), 'Cash')
  returning id
)
insert into subscription_items (subscription_id, plan_id, member_id, shared_member_id, start_date, end_date, quantity, amount_paid)
select new_sub.id, (select id from plans where name = 'Couple Monthly'),
       (select id from members where phone = '9700000004'), (select id from members where phone = '9700000005'),
       '2026-06-01', '2026-06-30', 1, 1800
from new_sub;

-- Farhan Ali: Monthly + Zumba Class + Membership Fee in ONE checkout (3-item add-on
-- showcase), then a later Monthly-only renewal expiring in 3 days.
with new_sub as (
  insert into subscriptions (member_id, payment_mode, notes)
  values ((select id from members where phone = '9700000006'), 'Cash', 'Signed up with Zumba + one-time membership fee')
  returning id
)
insert into subscription_items (subscription_id, plan_id, member_id, start_date, end_date, quantity, amount_paid)
select new_sub.id, v.plan_id, (select id from members where phone = '9700000006'), v.start_date, v.end_date, v.quantity, v.amount_paid
from new_sub, (values
  ((select id from plans where name = 'Monthly'),        '2026-01-15'::date, '2026-02-13'::date, 1, 1000::numeric),
  ((select id from plans where name = 'Zumba Class'),    '2026-01-15'::date, '2026-02-13'::date, 1, 800::numeric),
  ((select id from plans where name = 'Membership Fee'), '2026-01-15'::date, null::date,          1, 500::numeric)
) as v(plan_id, start_date, end_date, quantity, amount_paid);

with new_sub as (
  insert into subscriptions (member_id, payment_mode)
  values ((select id from members where phone = '9700000006'), 'UPI')
  returning id
)
insert into subscription_items (subscription_id, plan_id, member_id, start_date, end_date, quantity, amount_paid)
select new_sub.id, (select id from plans where name = 'Monthly'), (select id from members where phone = '9700000006'),
       '2026-06-25', '2026-07-24', 1, 1000
from new_sub;

-- Ishita Rao: Annual only, long runway.
with new_sub as (
  insert into subscriptions (member_id, payment_mode)
  values ((select id from members where phone = '9700000007'), 'Card')
  returning id
)
insert into subscription_items (subscription_id, plan_id, member_id, start_date, end_date, quantity, amount_paid)
select new_sub.id, (select id from plans where name = 'Annual'), (select id from members where phone = '9700000007'),
       '2026-03-01', '2027-02-28', 1, 8000
from new_sub;

-- Manoj Pillai: Monthly only, never renewed — expired.
with new_sub as (
  insert into subscriptions (member_id, payment_mode)
  values ((select id from members where phone = '9700000008'), 'Cash')
  returning id
)
insert into subscription_items (subscription_id, plan_id, member_id, start_date, end_date, quantity, amount_paid)
select new_sub.id, (select id from plans where name = 'Monthly'), (select id from members where phone = '9700000008'),
       '2026-05-20', '2026-06-18', 1, 1000
from new_sub;

-- Divya Krishnan: Day-plan trial (expired same day), then upgraded to Monthly + Zumba
-- Class the next day — both still active today.
with new_sub as (
  insert into subscriptions (member_id, payment_mode, notes)
  values ((select id from members where phone = '9700000009'), 'Cash', 'One-day trial before upgrading')
  returning id
)
insert into subscription_items (subscription_id, plan_id, member_id, start_date, end_date, quantity, amount_paid)
select new_sub.id, (select id from plans where name = 'Day'), (select id from members where phone = '9700000009'),
       '2026-07-01', '2026-07-01', 1, 100
from new_sub;

with new_sub as (
  insert into subscriptions (member_id, payment_mode, notes)
  values ((select id from members where phone = '9700000009'), 'UPI', 'Upgraded to Monthly + Zumba after the trial')
  returning id
)
insert into subscription_items (subscription_id, plan_id, member_id, start_date, end_date, quantity, amount_paid)
select new_sub.id, v.plan_id, (select id from members where phone = '9700000009'), v.start_date, v.end_date, v.quantity, v.amount_paid
from new_sub, (values
  ((select id from plans where name = 'Monthly'),     '2026-07-02'::date, '2026-07-31'::date, 1, 1000::numeric),
  ((select id from plans where name = 'Zumba Class'), '2026-07-02'::date, '2026-07-31'::date, 1, 800::numeric)
) as v(plan_id, start_date, end_date, quantity, amount_paid);
