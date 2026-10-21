/**
 * Edge Function invite-staff — adds a person to a café's staff.
 *
 * Creating a login needs the service_role key, which must never reach the browser, so the admin
 * panel calls this function instead. It
 *   1. identifies the caller from their access token,
 *   2. asks the database whether the caller may add someone with that role (the owner and manager
 *      rules live in public.staff_invite_check, next to every other permission),
 *   3. creates the login with the temporary password, unless the email already has one,
 *   4. links the login to the café (public.staff_link_user).
 *
 * Deploy:  supabase functions deploy invite-staff
 * Supabase provides SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to the function automatically.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const KNOWN = ['not_authenticated', 'forbidden', 'owner_required', 'already_staff', 'cannot_change_self', 'name_required', 'invalid_input'];

function reply(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

function fail(error: { message?: string } | null, fallback = 'invite_failed') {
  const message = error?.message ?? '';
  const code = KNOWN.find((c) => message.includes(c)) ?? (/invalid input syntax/i.test(message) ? 'invalid_input' : fallback);
  return reply({ error: code }, code === 'forbidden' || code === 'owner_required' ? 403 : 400);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'invalid_input' }, 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: caller } = await admin.auth.getUser(token);
  if (!caller?.user || caller.user.is_anonymous) return reply({ error: 'not_authenticated' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return reply({ error: 'invalid_input' }, 400);
  }
  const cafeId = String(body.cafeId ?? '');
  const email = String(body.email ?? '').trim().toLowerCase();
  const name = String(body.name ?? '').trim();
  const role = String(body.role ?? '');
  const password = String(body.password ?? '');

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({ error: 'invalid_email' }, 400);
  if (!name) return reply({ error: 'name_required' }, 400);

  const check = await admin.rpc('staff_invite_check', { p_actor: caller.user.id, p_cafe: cafeId, p_role: role });
  if (check.error) return fail(check.error);

  const existing = await admin.rpc('staff_user_id_by_email', { p_email: email });
  if (existing.error) return fail(existing.error);
  let userId = existing.data as string | null;
  let created = false;

  if (!userId) {
    if (password.length < 8) return reply({ error: 'weak_password' }, 400);
    const res = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: name } });
    if (res.error || !res.data.user) return fail(res.error);
    userId = res.data.user.id;
    created = true;
  }

  const link = await admin.rpc('staff_link_user', { p_actor: caller.user.id, p_cafe: cafeId, p_user: userId, p_name: name, p_role: role });
  if (link.error) return fail(link.error);
  return reply({ staffId: link.data, created });
});
