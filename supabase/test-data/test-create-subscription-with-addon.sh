#!/usr/bin/env bash
# Exercises the REAL create-subscription Edge Function (not a raw DB insert) with a
# membership item + an add-on item, to validate the deployed function's own logic:
# end_date computation, "exactly one membership item" check, indefinite-item hard block,
# amount_paid defaulting, etc.
#
# Prerequisites:
#   1. Migrations + functions deployed to the linked project (supabase db push,
#      supabase functions deploy create-subscription).
#   2. This test-data script's members already inserted:
#      supabase/test-data/member-subscriptions-oct2025-jul2026.sql
#      (uses Rohan Mehta, phone 9700000001, member_id looked up below)
#   3. A valid Supabase Auth access token for an ACTIVE profile (admin or staff) in this
#      project — e.g. sign in via the app in the browser, open devtools -> Application ->
#      Local Storage -> the sb-<project-ref>-auth-token entry -> copy the "access_token".
#
# Usage:
#   SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co" \
#   SUPABASE_ANON_KEY="your-anon-key" \
#   ACCESS_TOKEN="the-signed-in-user's-jwt" \
#   MEMBER_ID=123 \
#   MEMBERSHIP_PLAN_ID=456 \
#   ADDON_PLAN_ID=789 \
#     ./supabase/test-data/test-create-subscription-with-addon.sh

set -euo pipefail

: "${SUPABASE_URL:?Set SUPABASE_URL (e.g. https://xxxx.supabase.co)}"
: "${SUPABASE_ANON_KEY:?Set SUPABASE_ANON_KEY}"
: "${ACCESS_TOKEN:?Set ACCESS_TOKEN to a signed-in active user's JWT}"
: "${MEMBER_ID:?Set MEMBER_ID (bigint id of an existing member, e.g. Rohan Mehta)}"
: "${MEMBERSHIP_PLAN_ID:?Set MEMBERSHIP_PLAN_ID (id of a category='membership' plan, e.g. Monthly)}"
: "${ADDON_PLAN_ID:?Set ADDON_PLAN_ID (id of a category='addon' plan, e.g. Zumba Class)}"

TODAY=$(date +%F)

curl -i -X POST "${SUPABASE_URL}/functions/v1/create-subscription" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d @- <<JSON
{
  "member_id": ${MEMBER_ID},
  "payment_mode": "UPI",
  "notes": "Test checkout via test-create-subscription-with-addon.sh",
  "items": [
    {
      "plan_id": ${MEMBERSHIP_PLAN_ID},
      "member_id": ${MEMBER_ID},
      "shared_member_id": null,
      "start_date": "${TODAY}",
      "quantity": 1,
      "amount_paid": null
    },
    {
      "plan_id": ${ADDON_PLAN_ID},
      "member_id": ${MEMBER_ID},
      "shared_member_id": null,
      "start_date": "${TODAY}",
      "quantity": 1,
      "amount_paid": null
    }
  ]
}
JSON
echo
