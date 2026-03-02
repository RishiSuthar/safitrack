/**
 * SafiTrack Edge Function: send-invite
 * ─────────────────────────────────────
 * Called by a manager when they click "Invite member" in Team Settings.
 *
 * Request body (JSON):
 *   { email: string, role: "sales_rep" | "technician" | "manager" }
 *
 * Authorization: Bearer <user's access token>  (anon key from frontend)
 *
 * What it does:
 *   1. Verifies the caller is a manager in a valid org
 *   2. Checks the org hasn't hit its max_members limit
 *   3. Creates a row in public.invitations
 *   4. Fires auth.admin.inviteUserByEmail which sends the email with a
 *      magic link pointing to /crm/accept-invite.html
 *
 * Deploy:
 *   supabase functions deploy send-invite --no-verify-jwt
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SITE_URL = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://safitrack.netlify.app';
const ACCEPT_INVITE_URL = `${SITE_URL}/crm/accept-invite.html`;

Deno.serve(async (req: Request) => {
  // Handle CORS pre-flight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── 1. Authenticate the caller (uses their JWT from the browser) ──
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Missing Authorization header' }, 401);
    }

    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const {
      data: { user },
      error: userErr,
    } = await supabaseUser.auth.getUser();

    if (userErr || !user) {
      return json({ error: 'Unauthorized' }, 401);
    }

    // ── 2. Use the service-role client for privileged operations ──
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── 3. Look up the caller's profile (must be a manager) ──
    const { data: callerProfile, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('role, organization_id')
      .eq('id', user.id)
      .single();

    if (profileErr || !callerProfile) {
      return json({ error: 'Profile not found' }, 403);
    }
    if (callerProfile.role !== 'manager') {
      return json({ error: 'Only managers can send invitations' }, 403);
    }

    const orgId: string = callerProfile.organization_id;
    if (!orgId) {
      return json({ error: 'Your account is not linked to an organization' }, 400);
    }

    // ── 4. Parse & validate request body ──
    const body = await req.json().catch(() => ({}));
    const email: string = (body.email ?? '').toLowerCase().trim();
    const role: string = body.role ?? '';

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: 'A valid email address is required' }, 400);
    }
    if (!['sales_rep', 'technician', 'manager'].includes(role)) {
      return json({ error: 'role must be sales_rep, technician, or manager' }, 400);
    }

    // ── 5. Check org member limit ──
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('name, max_members')
      .eq('id', orgId)
      .single();

    const { count: memberCount } = await supabaseAdmin
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .neq('status', 'suspended');

    const { count: pendingCount } = await supabaseAdmin
      .from('invitations')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('status', 'pending');

    const totalSlots = (memberCount ?? 0) + (pendingCount ?? 0);
    const maxMembers = org?.max_members ?? 10;

    if (totalSlots >= maxMembers) {
      return json(
        {
          error: `Your plan allows ${maxMembers} members. You have ${totalSlots} active + pending. Upgrade to invite more.`,
        },
        400,
      );
    }

    // ── 6. Check for duplicate pending invitation ──
    // Allow re-invite if the existing invitation has already expired.
    const { data: duplicate } = await supabaseAdmin
      .from('invitations')
      .select('id, expires_at')
      .eq('organization_id', orgId)
      .ilike('email', email)
      .eq('status', 'pending')
      .maybeSingle();

    if (duplicate) {
      const alreadyExpired = new Date(duplicate.expires_at) <= new Date();
      if (alreadyExpired) {
        // Purge the stale record so a fresh one can be created
        await supabaseAdmin.from('invitations').delete().eq('id', duplicate.id);
      } else {
        return json({ error: 'A pending invitation already exists for this email address. Check their spam folder or wait for it to expire before resending.' }, 400);
      }
    }

    // Check if the person is already a member
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('organization_id', orgId)
      .ilike('email', email)
      .maybeSingle();

    if (existingProfile) {
      return json({ error: 'This person is already a member of your organization' }, 400);
    }

    // ── 7. Create invitation record ──
    const { data: invitation, error: invErr } = await supabaseAdmin
      .from('invitations')
      .insert({
        organization_id: orgId,
        email,
        role,
        invited_by: user.id,
        status: 'pending',
      })
      .select()
      .single();

    if (invErr || !invitation) {
      return json({ error: `Failed to create invitation: ${invErr?.message ?? 'unknown'}` }, 500);
    }

    // ── 8. Send the invite email via Supabase auth ──
    // The user_metadata passed here will be available as
    // user.user_metadata on the accept-invite page.
    const { error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email,
      {
        data: {
          organization_id: orgId,
          organization_name: org?.name ?? '',
          role,
          invitation_id: invitation.id,
        },
        redirectTo: ACCEPT_INVITE_URL,
      },
    );

    if (inviteErr) {
      // Roll back the invitation record so it doesn't become a ghost
      await supabaseAdmin.from('invitations').delete().eq('id', invitation.id);
      return json({ error: `Auth invite failed: ${inviteErr.message}` }, 500);
    }

    return json({ success: true, invitation_id: invitation.id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});

// ── helpers ──────────────────────────────────────────────────
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
