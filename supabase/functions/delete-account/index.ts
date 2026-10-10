/**
 * SafiTrack Edge Function: delete-account
 * ────────────────────────────────────────
 * Lets a signed-in user permanently delete their own account. The login
 * (auth.users) is deleted, which removes their profile; records they created
 * stay with the organization with their name cleared.
 *
 * Request body: (none — the account is the caller's)
 * Authorization: Bearer <user's access token>
 *
 * Guards:
 *   - The organization owner must delete the organization instead, so an
 *     organization is never left without an owner.
 *   - A manager cannot delete their account while they are the only active
 *     manager in the organization.
 *
 * Deploy:
 *   supabase functions deploy delete-account
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

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── 2. Guards ────────────────────────────────────────────────────────
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role, organization_id')
      .eq('id', user.id)
      .maybeSingle();

    if (profile?.organization_id) {
      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('owner_id')
        .eq('id', profile.organization_id)
        .single();

      if (org?.owner_id === user.id) {
        return json({
          error: 'You own this organization, so your account cannot be deleted on its own. Delete the organization instead.',
        }, 400);
      }

      if (profile.role === 'manager') {
        const { count } = await supabaseAdmin
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', profile.organization_id)
          .eq('role', 'manager')
          .neq('status', 'suspended')
          .neq('id', user.id);

        if (!count) {
          return json({
            error: 'You are the only manager. Promote another member to manager before deleting your account.',
          }, 400);
        }
      }
    }

    // ── 3. Delete the login; the profile goes with it ────────────────────
    const { error: deleteErr } = await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (deleteErr) {
      console.error('[delete-account] deleteUser failed:', JSON.stringify(deleteErr));
      return json({ error: 'Could not delete your account. Please try again.' }, 500);
    }

    return json({ success: true });
  } catch (err) {
    console.error('[delete-account] Unexpected error:', err);
    return json({ error: 'Internal server error' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
