/**
 * SafiTrack Edge Function: delete-member
 * ─────────────────────────────────────────
 * Allows a manager to fully remove a non-manager member from their organization.
 * Deletes both the public.profiles row (cascading app data) and the auth.users
 * entry so no orphan account remains.
 *
 * Request body: { userId: string }
 * Authorization: Bearer <manager's access token>
 *
 * Guards:
 *   - Caller must be authenticated and have role = 'manager'
 *   - Target must be in the same organization as the caller
 *   - Target must NOT be a manager (managers are protected)
 *   - Caller cannot delete themselves via this endpoint
 *
 * Deploy:
 *   supabase functions deploy delete-member --no-verify-jwt
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    // ── 1. Authenticate the caller ───────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !user) return json({ error: 'Unauthorized' }, 401);

    // ── 2. Parse request body ────────────────────────────────────────────
    let body: { userId?: string };
    try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

    const { userId: targetId } = body;
    if (!targetId || typeof targetId !== 'string') {
      return json({ error: 'userId is required' }, 400);
    }

    if (targetId === user.id) {
      return json({ error: 'You cannot delete your own account via this endpoint' }, 400);
    }

    // ── 3. Admin client for privileged operations ────────────────────────
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── 4. Verify caller is a manager ────────────────────────────────────
    const { data: callerProfile, error: callerErr } = await supabaseAdmin
      .from('profiles')
      .select('role, organization_id')
      .eq('id', user.id)
      .single();

    if (callerErr || !callerProfile) return json({ error: 'Caller profile not found' }, 403);
    if (callerProfile.role !== 'manager') return json({ error: 'Only managers can remove members' }, 403);
    if (!callerProfile.organization_id) return json({ error: 'Caller has no organization' }, 403);

    // ── 5. Verify target exists, is in same org, and is not a manager ─────
    const { data: targetProfile, error: targetErr } = await supabaseAdmin
      .from('profiles')
      .select('role, organization_id')
      .eq('id', targetId)
      .single();

    if (targetErr || !targetProfile) return json({ error: 'Target member not found' }, 404);

    if (targetProfile.organization_id !== callerProfile.organization_id) {
      return json({ error: 'Target member is not in your organization' }, 403);
    }

    if (targetProfile.role === 'manager') {
      return json({ error: 'Managers cannot be deleted by other managers. Only the organization owner can delete the entire organization.' }, 403);
    }

    // ── 6. Delete the profile row first (CASCADE removes all their CRM data) ──
    // This mirrors how delete-organization works: data is wiped via cascade,
    // then the auth user is removed best-effort.
    const { error: profileDelErr } = await supabaseAdmin
      .from('profiles')
      .delete()
      .eq('id', targetId);

    if (profileDelErr) {
      return json({ error: 'Failed to delete member profile: ' + profileDelErr.message }, 500);
    }

    // ── 7. Delete the auth user (best-effort — data is already gone) ─────────
    const { error: authDelErr } = await supabaseAdmin.auth.admin.deleteUser(targetId);
    if (authDelErr) {
      // Log but don't fail — profile + all CRM data are already deleted.
      // The auth account is now useless (no profile = no org access).
      console.warn('[delete-member] Auth user deletion failed (data already removed):', JSON.stringify(authDelErr));
    }

    return json({ success: true });
  } catch (err) {
    console.error('[delete-member] Unexpected error:', err);
    return json({ error: 'Internal server error' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
