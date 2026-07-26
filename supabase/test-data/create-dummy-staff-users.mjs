// Creates dummy admin/staff accounts for UI testing, via Supabase's Admin API
// (supabase.auth.admin.createUser) — NOT a raw SQL insert into auth.users, since that
// requires GoTrue's own bcrypt password hashing. Each created auth.users row triggers
// handle_new_auth_user() (see supabase/migrations/20260719000000_profiles_auth.sql),
// which reads full_name from user_metadata below and creates the matching `profiles`
// row automatically — same mechanism described in database.md's "Bootstrapping the
// First Admin" section. Role is no longer part of that trigger (20260722000000_roles_
// and_user_roles.sql) — this script assigns it explicitly via `user_roles` below, the
// same two-step shape invite-user's Edge Function uses.
//
// Run ONCE per environment (re-running is safe — createUser fails harmlessly on an
// email that already exists, logged and skipped rather than aborting the whole run).
//
// Requires the SERVICE ROLE key (admin-only, full-privilege) — never commit it, never
// put it in a VITE_* var. Get it from Supabase dashboard -> Project Settings -> API.
//
// Usage:
//   SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co" \
//   SUPABASE_SERVICE_ROLE_KEY="your-service-role-key" \
//   node supabase/test-data/create-dummy-staff-users.mjs

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables first.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Dummy password for every test account below — fine for a throwaway test project,
// but rotate/remove these accounts before this project ever holds real member data.
const DUMMY_PASSWORD = 'TestPass123!';

const DUMMY_USERS = [
  { email: 'admin.test@fitandfine.example', full_name: 'Asha Admin', role: 'admin' },
  { email: 'staff.priya@fitandfine.example', full_name: 'Priya Staff', role: 'staff' },
  { email: 'staff.rohit@fitandfine.example', full_name: 'Rohit Staff', role: 'staff' },
  { email: 'staff.neha@fitandfine.example', full_name: 'Neha Staff', role: 'staff' },
];

const { data: roleRows, error: roleRowsError } = await supabase.from('roles').select('id, name').is('deleted_at', null);
if (roleRowsError) {
  console.error('Could not load roles table —', roleRowsError.message);
  process.exit(1);
}
const roleIdByName = new Map(roleRows.map((r) => [r.name, r.id]));

for (const user of DUMMY_USERS) {
  const { data, error } = await supabase.auth.admin.createUser({
    email: user.email,
    password: DUMMY_PASSWORD,
    email_confirm: true, // skip the confirmation-email step so it's immediately usable
    user_metadata: { full_name: user.full_name },
  });

  if (error) {
    if (error.message?.toLowerCase().includes('already been registered')) {
      console.log(`SKIP  ${user.email} — already exists`);
    } else {
      console.error(`FAIL  ${user.email} —`, error.message);
    }
    continue;
  }

  const roleId = roleIdByName.get(user.role);
  if (roleId === undefined) {
    console.error(`FAIL  ${user.email} — role "${user.role}" not found in roles table`);
    continue;
  }
  const { error: userRolesError } = await supabase.from('user_roles').insert({ user_id: data.user.id, role_id: roleId });
  if (userRolesError) {
    console.error(`FAIL  ${user.email} — created but role assignment failed:`, userRolesError.message);
    continue;
  }

  console.log(`OK    ${user.email} (${user.role}) — auth.users.id = ${data.user.id}`);
}

console.log(`\nAll accounts use password: ${DUMMY_PASSWORD}`);
