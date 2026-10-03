-- Section 10 NFR: "Member list must load in < 1s for up to ~2,000 members."
-- Measures the database side of that budget (member_list_view over 2,000 members with realistic item counts).
begin;
select t.seed_users();
select t.as_super();
alter table members disable trigger trg_members_audit_fields;
alter table subscription_items disable trigger trg_subscription_items_audit_fields;
alter table subscriptions disable trigger trg_subscriptions_audit_fields;

insert into members (name, phone, date_of_birth, gender, weight_kg, height_cm, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, branch_id, date_of_joining)
select 'Member ' || g, lpad((7000000000 + g)::text, 10, '0'), '1990-01-01', (array['Male','Female','Other'])[1 + g % 3], 70, 170, 'e', '9', 'f', t.branch(), current_date - (g % 700)
from generate_series(1, 2000) g;

insert into subscriptions (member_id) select id from members;
-- one membership + (for a third of members) one add-on, mixed end dates incl. expired and indefinite
insert into subscription_items (subscription_id, plan_id, member_id, start_date, end_date, quantity, amount_paid)
select s.id, t.plan('Monthly'), s.member_id, current_date - 40 + (s.id % 80)::int, case when s.id % 17 = 0 then null else current_date - 10 + (s.id % 60)::int end, 1, 1000 from subscriptions s;
insert into subscription_items (subscription_id, plan_id, member_id, start_date, end_date, quantity, amount_paid)
select s.id, t.plan('Zumba Class'), s.member_id, current_date, current_date + 29, 1, 800 from subscriptions s where s.id % 3 = 0;
analyze;

select t.eq('PERF fixture: 2,000 live members', (select count(*)::int from members), 2000);

do $$
declare t0 timestamptz; ms numeric; n int;
begin
  t0 := clock_timestamp();
  select count(*) into n from member_list_view;
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  perform t.ok(format('PERF member_list_view over 2,000 members returns all rows (%s rows)', n), n = 2000);
  perform t.ok(format('PERF member_list_view over 2,000 members completes well under the 1s budget (%s ms)', round(ms)), ms < 1000);

  t0 := clock_timestamp();
  select count(*) into n from member_list_view where current_membership_end_date between current_date and current_date + 30;
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  perform t.ok(format('PERF Action Center bounded queue stays under 1s (%s ms)', round(ms)), ms < 1000);
end $$;

-- and as a real signed-in staff user (RLS + is_active_user() per row)
select t.as_user(t.staff_id());
do $$
declare t0 timestamptz; ms numeric; n int;
begin
  t0 := clock_timestamp();
  select count(*) into n from member_list_view;
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  perform t.ok(format('PERF member list as a staff user under 1s (%s ms)', round(ms)), n = 2000 and ms < 1000);
end $$;
rollback;
