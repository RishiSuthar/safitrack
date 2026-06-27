/**
 * SafiTrack Edge Function: delete-organization
 * ─────────────────────────────────────────────
 * Exclusively callable by the organization owner (the user whose id matches
 * organizations.owner_id). Performs a full, irreversible wipe:
 *
 *   1. Authenticates the caller and confirms they are the org owner.
 *   2. Collects every auth user ID that belongs to the organization.
 *   3. Deletes the organization row — Postgres CASCADE handles all child data:
 *      profiles, companies, people, visits, tasks, reminders, opportunities,
 *      call_logs, technician_visits, routes, notes, invitations.
 *   4. Deletes every collected auth.users row via the Admin API so no
 *      orphan auth accounts remain.
 *
 * Request body: (none required — the org is derived from the caller's JWT)
 * Authorization: Bearer <user's access token>
 *
 * Deploy:
 *   supabase functions deploy delete-organization --no-verify-jwt
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req: Request) => {
  // ── CORS pre-flight ──────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    // ── 1. Authenticate the caller via their JWT ─────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Missing Authorization header' }, 401);
    }

    // User-scoped client (respects RLS — used only for getUser)
    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !user) {
      return json({ error: 'Unauthorized' }, 401);
    }

    // ── 2. Admin client for all privileged operations ────────────────────
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── 3. Look up caller's profile ──────────────────────────────────────
    const { data: callerProfile, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('organization_id')
      .eq('id', user.id)
      .single();

    if (profileErr || !callerProfile?.organization_id) {
      return json({ error: 'Profile or organization not found' }, 403);
    }

    const orgId: string = callerProfile.organization_id;

    // ── 4. Verify the caller IS the organization owner ───────────────────
    const { data: org, error: orgErr } = await supabaseAdmin
      .from('organizations')
      .select('id, owner_id')
      .eq('id', orgId)
      .single();

    if (orgErr || !org) {
      return json({ error: 'Organization not found' }, 404);
    }

    if (org.owner_id !== user.id) {
      return json({ error: 'Only the organization owner can delete the organization' }, 403);
    }

    // ── 5. Collect all auth user IDs in this org before deletion ─────────
    const { data: members, error: membersErr } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('organization_id', orgId);

    if (membersErr) {
      return json({ error: 'Failed to list organization members: ' + membersErr.message }, 500);
    }

    const memberIds: string[] = (members ?? []).map((m: { id: string }) => m.id);

    // ── 6. Delete the organization row (CASCADE wipes all app data) ───────
    const { error: delOrgErr } = await supabaseAdmin
      .from('organizations')
      .delete()
      .eq('id', orgId);

    if (delOrgErr) {
      return json({ error: 'Failed to delete organization: ' + delOrgErr.message }, 500);
    }

    // ── 7. Delete all auth users (best-effort; failures are logged) ───────
    const authDeleteErrors: string[] = [];
    for (const uid of memberIds) {
      const { error: authDelErr } = await supabaseAdmin.auth.admin.deleteUser(uid);
      if (authDelErr) {
        console.error(`[delete-organization] Failed to delete auth user ${uid}:`, authDelErr.message);
        authDeleteErrors.push(uid);
      }
    }

    return json({
      success: true,
      deletedMembers: memberIds.length,
      authDeleteErrors: authDeleteErrors.length > 0 ? authDeleteErrors : undefined,
    });
  } catch (err) {
    console.error('[delete-organization] Unexpected error:', err);
    return json({ error: 'Internal server error' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
