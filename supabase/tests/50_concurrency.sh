#!/usr/bin/env bash
# REQ-SUB-007 under concurrency. Two sessions each try to attach the SAME indefinite plan to the SAME member
# at the same moment (session A's transaction is still open when B runs). Under READ COMMITTED with no lock /
# unique index, B cannot see A's uncommitted row, so both succeed. Prints "known-gap" while that is true.
# Usage: 50_concurrency.sh <dbname>
set -euo pipefail
DB=$1
P="psql -X -q -At -v ON_ERROR_STOP=1 -d $DB"
$P -c "select t.seed_users();" >/dev/null
M=$($P -c "insert into members (name,phone,date_of_birth,gender,weight_kg,height_cm,emergency_contact_name,emergency_contact_phone,emergency_contact_relationship,branch_id) select 'Race','9500000001','1990-01-01','Male',70,170,'e','9','f',id from branches limit 1 returning id;" | head -1)
PLAN=$($P -c "select id from plans where name='Membership Fee';")
CALL="select create_subscription_with_items('a0000000-0000-0000-0000-000000000002', $M, 'Cash', null, '[{\"plan_id\":$PLAN,\"member_id\":$M,\"start_date\":\"2026-01-01\",\"quantity\":1,\"amount_paid\":500}]'::jsonb);"
( $P <<SQL >/dev/null
begin;
$CALL
select pg_sleep(2);
commit;
SQL
) &
sleep 0.7
B_OK=1; $P -c "$CALL" >/dev/null 2>&1 || B_OK=0
wait
N=$($P -c "select count(*) from subscription_items where member_id=$M and plan_id=$PLAN and deleted_at is null;")
if [ "$N" -le 1 ]; then echo "ok - SUB-007 concurrent duplicate indefinite attach is prevented"; else echo "known-gap - SUB-007 (GAP) two concurrent checkouts both attached the same indefinite plan ($N rows) — the atomic check is not actually atomic across sessions"; fi
