-- Local/dev test data — loaded automatically by `supabase db reset` (see config.toml's
-- db.seed.sql_paths), never by `supabase db push` to a real project. Distinct from the
-- master-data migration's branches/plans seed, which is real reference data the app needs
-- to function; this is throwaway fixture data for exercising the Members List's search,
-- status pills, filter panel, and sort against a variety of real scenarios.
--
-- Meant to run once against a freshly-reset database (relies on `members.phone`'s unique
-- index as a natural key when looking rows back up below) — re-running this against an
-- already-seeded database will fail on duplicate phone numbers rather than silently
-- duplicating data.
--
-- All dates are relative to current_date rather than hardcoded, so the active/expiring/
-- expired mix stays meaningful no matter when this actually gets loaded. Note that
-- member_list_view's status only ever comes from member_current_items (see
-- backend/member-management.md §5-6), which already excludes any item whose end_date has
-- passed — so an "expired" member here shows up as current_membership_plan_id IS NULL
-- (no current item at all), same as a member who never had a subscription. That's expected,
-- not a seed bug: both correctly render the same red "Expired" badge.

-- 1. Arjun Kumar — Active (Annual, ~64 days remaining), no add-ons.
insert into members (
  name, phone, date_of_birth, date_of_joining, gender, weight_kg, height_cm,
  under_doctor_care, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
  branch_id
) values (
  'Arjun Kumar', '9800000001', '1990-05-14', current_date - 300, 'Male', 78.50, 175.00,
  false, 'Sunita Kumar', '9800000101', 'Spouse',
  (select id from branches where code = 'MUM')
);

-- 2. Priya Sharma — Expiring (Monthly, 4 days remaining) + Zumba Class add-on (x2 quantity).
insert into members (
  name, phone, date_of_birth, date_of_joining, gender, weight_kg, height_cm,
  under_doctor_care, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
  branch_id
) values (
  'Priya Sharma', '9800000002', '1995-08-22', current_date - 25, 'Female', 60.00, 162.50,
  false, 'Rakesh Sharma', '9800000102', 'Spouse',
  (select id from branches where code = 'MUM')
);

-- 3. Ramesh Iyer — Expired (Monthly lapsed 11 days ago), under doctor's care.
insert into members (
  name, phone, date_of_birth, date_of_joining, gender, weight_kg, height_cm,
  under_doctor_care, doctor_care_details, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
  branch_id
) values (
  'Ramesh Iyer', '9800000003', '1988-01-10', current_date - 40, 'Male', 82.00, 170.00,
  true, 'Hypertension, on daily medication', 'Lakshmi Iyer', '9800000103', 'Spouse',
  (select id from branches where code = 'MUM')
);

-- 4. Sneha Reddy — Active (Quarterly, ~79 days remaining) + indefinite Membership Fee add-on.
insert into members (
  name, phone, date_of_birth, date_of_joining, gender, weight_kg, height_cm,
  under_doctor_care, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
  branch_id
) values (
  'Sneha Reddy', '9800000004', '1998-11-30', current_date - 10, 'Female', 55.50, 160.00,
  false, 'Kiran Reddy', '9800000104', 'Sibling',
  (select id from branches where code = 'MUM')
);

-- 5. Vikram Singh — No subscription at all ("No plan" / Expired-by-absence).
insert into members (
  name, phone, date_of_birth, date_of_joining, gender, weight_kg, height_cm,
  under_doctor_care, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
  branch_id
) values (
  'Vikram Singh', '9800000005', '1992-03-03', current_date - 100, 'Male', 90.00, 180.00,
  false, 'Neha Singh', '9800000105', 'Spouse',
  (select id from branches where code = 'MUM')
);

-- 6. Anjali Nair — Active (Couple Monthly, primary member).
insert into members (
  name, phone, date_of_birth, date_of_joining, gender, weight_kg, height_cm,
  under_doctor_care, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
  branch_id
) values (
  'Anjali Nair', '9800000006', '1993-07-19', current_date - 5, 'Female', 58.00, 158.00,
  false, 'Suresh Nair', '9800000106', 'Parent',
  (select id from branches where code = 'MUM')
);

-- 7. Karthik Menon — no checkout of his own; appears only as Anjali's couple-plan shared_member_id below.
insert into members (
  name, phone, date_of_birth, date_of_joining, gender, weight_kg, height_cm,
  under_doctor_care, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
  branch_id
) values (
  'Karthik Menon', '9800000007', '1991-09-25', current_date - 5, 'Male', 75.00, 172.00,
  false, 'Anjali Nair', '9800000006', 'Partner',
  (select id from branches where code = 'MUM')
);

-- 8. Divya Patel — current add-on but no membership item at all (Zumba Class only, seeded
-- directly at the DB level, bypassing create-subscription's "exactly one membership item"
-- rule on purpose — a useful edge case for the list view even though the app itself would
-- never let staff create this via the checkout screen).
insert into members (
  name, phone, date_of_birth, date_of_joining, gender, weight_kg, height_cm,
  under_doctor_care, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
  branch_id
) values (
  'Divya Patel', '9800000008', '1996-02-14', current_date - 15, 'Other', 50.00, 155.00,
  false, 'Amit Patel', '9800000108', 'Sibling',
  (select id from branches where code = 'MUM')
);

-- 9. Rahul Verma — Active (Annual, ~164 days remaining) + two add-ons (Zumba Class, Membership Fee).
insert into members (
  name, phone, date_of_birth, date_of_joining, gender, weight_kg, height_cm,
  under_doctor_care, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
  branch_id
) values (
  'Rahul Verma', '9800000009', '1989-06-05', current_date - 200, 'Male', 88.00, 178.00,
  false, 'Pooja Verma', '9800000109', 'Spouse',
  (select id from branches where code = 'MUM')
);

-- 10. Meera Joshi — Expired (Day plan, lapsed the same day it was bought).
insert into members (
  name, phone, date_of_birth, date_of_joining, gender, weight_kg, height_cm,
  under_doctor_care, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
  branch_id
) values (
  'Meera Joshi', '9800000010', '2000-04-18', current_date - 45, 'Female', 48.00, 150.00,
  false, 'Anil Joshi', '9800000110', 'Parent',
  (select id from branches where code = 'MUM')
);

---------------------------------------------------------------------------
-- Subscriptions (checkouts) + line items
---------------------------------------------------------------------------
-- Written as direct inserts (not through create-subscription/the RPC) since seed data
-- runs with superuser privileges outside the app's request path anyway — end_date is
-- computed by hand here to match the same formula the Edge Function uses:
-- start_date + (plan.duration_days * quantity) - 1, or NULL for an indefinite plan.

-- Arjun Kumar: Annual only.
with new_sub as (
  insert into subscriptions (member_id, payment_mode)
  values ((select id from members where phone = '9800000001'), 'Cash')
  returning id
)
insert into subscription_items (subscription_id, plan_id, member_id, start_date, end_date, quantity, amount_paid)
select new_sub.id, (select id from plans where name = 'Annual'), (select id from members where phone = '9800000001'),
       current_date - 300, current_date + 64, 1, 8000
from new_sub;

-- Priya Sharma: Monthly + Zumba Class (x2).
with new_sub as (
  insert into subscriptions (member_id, payment_mode)
  values ((select id from members where phone = '9800000002'), 'UPI')
  returning id
)
insert into subscription_items (subscription_id, plan_id, member_id, start_date, end_date, quantity, amount_paid)
select new_sub.id, v.plan_id, (select id from members where phone = '9800000002'), v.start_date, v.end_date, v.quantity, v.amount_paid
from new_sub, (values
  ((select id from plans where name = 'Monthly'),     (current_date - 25)::date, (current_date + 4)::date,  1, 1000::numeric),
  ((select id from plans where name = 'Zumba Class'), (current_date - 5)::date,  (current_date + 54)::date, 2, 1600::numeric)
) as v(plan_id, start_date, end_date, quantity, amount_paid);

-- Ramesh Iyer: Monthly only, already lapsed.
with new_sub as (
  insert into subscriptions (member_id, payment_mode)
  values ((select id from members where phone = '9800000003'), 'Cash')
  returning id
)
insert into subscription_items (subscription_id, plan_id, member_id, start_date, end_date, quantity, amount_paid)
select new_sub.id, (select id from plans where name = 'Monthly'), (select id from members where phone = '9800000003'),
       current_date - 40, current_date - 11, 1, 1000
from new_sub;

-- Sneha Reddy: Quarterly + indefinite Membership Fee.
with new_sub as (
  insert into subscriptions (member_id, payment_mode)
  values ((select id from members where phone = '9800000004'), 'Card')
  returning id
)
insert into subscription_items (subscription_id, plan_id, member_id, start_date, end_date, quantity, amount_paid)
select new_sub.id, v.plan_id, (select id from members where phone = '9800000004'), v.start_date, v.end_date, v.quantity, v.amount_paid
from new_sub, (values
  ((select id from plans where name = 'Quarterly'),      (current_date - 10)::date, (current_date + 79)::date, 1, 2500::numeric),
  ((select id from plans where name = 'Membership Fee'), (current_date - 10)::date, null::date,                1, 500::numeric)
) as v(plan_id, start_date, end_date, quantity, amount_paid);

-- Vikram Singh: intentionally no subscription at all.

-- Anjali Nair + Karthik Menon: Couple Monthly, Anjali primary, Karthik shared.
with new_sub as (
  insert into subscriptions (member_id, payment_mode)
  values ((select id from members where phone = '9800000006'), 'UPI')
  returning id
)
insert into subscription_items (subscription_id, plan_id, member_id, shared_member_id, start_date, end_date, quantity, amount_paid)
select new_sub.id, (select id from plans where name = 'Couple Monthly'),
       (select id from members where phone = '9800000006'), (select id from members where phone = '9800000007'),
       current_date - 5, current_date + 24, 1, 1800
from new_sub;

-- Divya Patel: Zumba Class only, no membership item (see comment above).
with new_sub as (
  insert into subscriptions (member_id, payment_mode)
  values ((select id from members where phone = '9800000008'), 'Cash')
  returning id
)
insert into subscription_items (subscription_id, plan_id, member_id, start_date, end_date, quantity, amount_paid)
select new_sub.id, (select id from plans where name = 'Zumba Class'), (select id from members where phone = '9800000008'),
       current_date - 5, current_date + 24, 1, 800
from new_sub;

-- Rahul Verma: Annual + Zumba Class + Membership Fee (3 items, 2 add-ons).
with new_sub as (
  insert into subscriptions (member_id, payment_mode)
  values ((select id from members where phone = '9800000009'), 'Cash')
  returning id
)
insert into subscription_items (subscription_id, plan_id, member_id, start_date, end_date, quantity, amount_paid)
select new_sub.id, v.plan_id, (select id from members where phone = '9800000009'), v.start_date, v.end_date, v.quantity, v.amount_paid
from new_sub, (values
  ((select id from plans where name = 'Annual'),         (current_date - 200)::date, (current_date + 164)::date, 1, 8000::numeric),
  ((select id from plans where name = 'Zumba Class'),    (current_date - 3)::date,   (current_date + 26)::date,  1, 800::numeric),
  ((select id from plans where name = 'Membership Fee'), (current_date - 3)::date,   null::date,                 1, 500::numeric)
) as v(plan_id, start_date, end_date, quantity, amount_paid);

-- Meera Joshi: Day plan, one-day trial, expired same day.
with new_sub as (
  insert into subscriptions (member_id, payment_mode)
  values ((select id from members where phone = '9800000010'), 'Cash')
  returning id
)
insert into subscription_items (subscription_id, plan_id, member_id, start_date, end_date, quantity, amount_paid)
select new_sub.id, (select id from plans where name = 'Day'), (select id from members where phone = '9800000010'),
       current_date - 45, current_date - 45, 1, 100
from new_sub;
