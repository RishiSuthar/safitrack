/**
 * SafiTrack — Accept Invite Page Logic
 * ─────────────────────────────────────────────────────────────────────────────
 * Flow:
 *   1. On page load:  parse the URL → extract the Supabase OTP token hash.
 *   2. Exchange the hash for a real session (verifyOtp).
 *   3. Read the user's metadata (org name, role, invitation_id).
 *   4. Show the "set up your account" form.
 *   5. On submit: set their password via updateUser, then call the
 *      accept_invitation() RPC to create their profile row and mark invite done.
 *   6. Redirect to /crm/index.html so they land in the app.
 * ─────────────────────────────────────────────────────────────────────────────
 */

(async () => {
  // ── Supabase client ─────────────────────────────────────────────────────────
  const SUPABASE_URL = (window.APP_CONFIG || {}).SUPABASE_URL;
  const SUPABASE_KEY = (window.APP_CONFIG || {}).SUPABASE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    showState('error', 'Configuration missing. This invite page is mis-configured.');
    return;
  }

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function showState(state, errorMsg) {
    document.getElementById('state-loading').style.display = 'none';
    document.getElementById('state-error').style.display   = 'none';
    document.getElementById('state-setup').style.display   = 'none';
    document.getElementById('state-done').style.display    = 'none';

    document.getElementById(`state-${state}`).style.display = 'block';

    if (state === 'error' && errorMsg) {
      document.getElementById('error-message').textContent = errorMsg;
    }
  }

  function formatRole(role) {
    if (role === 'sales_rep')  return 'Sales Rep';
    if (role === 'technician') return 'Technician';
    if (role === 'manager')    return 'Manager';
    return role || 'Member';
  }

  function setFormBusy(busy) {
    const btn = document.getElementById('setup-btn');
    btn.disabled = busy;
    btn.innerHTML = busy
      ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 0.7s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Setting up…`
      : '<span>Finish setting up</span>';
  }

  function showFormError(msg) {
    const el = document.getElementById('form-msg');
    el.textContent = msg;
    el.className = 'msg error';
  }

  function clearFormError() {
    const el = document.getElementById('form-msg');
    el.className = 'msg';
    el.textContent = '';
  }

  // ── Step 1 & 2: Parse URL hash and exchange for session ──────────────────────
  showState('loading');

  // Supabase sends the invite link as:
  //   https://yoursite.com/crm/accept-invite.html#access_token=...&refresh_token=...&type=invite
  // We need to extract the token_hash (or use the access_token directly).
  const hash = window.location.hash.substring(1);
  const params = new URLSearchParams(hash);

  const accessToken   = params.get('access_token');
  const refreshToken  = params.get('refresh_token');
  const type          = params.get('type');            // 'invite' or 'recovery'
  const tokenHash     = params.get('token_hash');      // used by PKCE flow

  let session = null;

  // ── Try standard hash-fragment session (implicit flow) ──
  if (accessToken && refreshToken && type === 'invite') {
    const { data, error } = await supabase.auth.setSession({
      access_token:   accessToken,
      refresh_token:  refreshToken,
    });

    if (error || !data.session) {
      showState('error', `Could not verify your invite link: ${error?.message ?? 'unknown error'}. It may have expired — ask your manager to resend it.`);
      return;
    }
    session = data.session;
  }
  // ── Try PKCE / email OTP flow ──
  else if (tokenHash) {
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: 'invite',
    });

    if (error || !data.session) {
      showState('error', `Could not verify your invite link: ${error?.message ?? 'unknown error'}. It may have expired — ask your manager to resend it.`);
      return;
    }
    session = data.session;
  }
  // ── Also handle the case where the user already landed and Supabase auto-
  //    detected the session from the URL (SDK v2 auto-detects in some configs) ──
  else {
    const { data } = await supabase.auth.getSession();
    if (data?.session) {
      session = data.session;
    } else {
      showState('error', 'No invite token found in this URL. Please use the link from your invitation email.');
      return;
    }
  }

  const user = session.user;

  // ── Step 3: Populate form from user metadata ──────────────────────────────────
  const meta         = user.user_metadata || {};
  const orgName      = meta.organization_name || '';
  const role         = meta.role             || '';
  const invitationId = meta.invitation_id    || null;

  // Pre-fill read-only email
  const emailInput = document.getElementById('ai-email');
  if (emailInput) emailInput.value = user.email || '';

  // Fill org name + role in subtitle
  const orgNameEl = document.getElementById('org-name-display');
  const roleEl    = document.getElementById('role-display');
  if (orgNameEl) orgNameEl.textContent = orgName || 'your organization';
  if (roleEl)    roleEl.textContent    = formatRole(role);

  showState('setup');

  // ── Step 4: Password visibility toggle ──────────────────────────────────────
  document.getElementById('toggle-pwd-btn')?.addEventListener('click', () => {
    const pwInput = document.getElementById('ai-password');
    pwInput.type = pwInput.type === 'password' ? 'text' : 'password';
  });

  // ── Step 5: Form submit ──────────────────────────────────────────────────────
  document.getElementById('setup-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormError();

    const firstName = document.getElementById('ai-firstname').value.trim();
    const lastName  = document.getElementById('ai-lastname').value.trim();
    const password  = document.getElementById('ai-password').value;

    // Basic validation
    if (!firstName) { showFormError('Please enter your first name.'); return; }
    if (!lastName)  { showFormError('Please enter your last name.'); return; }
    if (password.length < 8) { showFormError('Password must be at least 8 characters.'); return; }

    setFormBusy(true);

    try {
      // 5a. Set name + password on the auth user
      const { error: updateErr } = await supabase.auth.updateUser({
        password,
        data: { first_name: firstName, last_name: lastName },
      });

      if (updateErr) {
        showFormError(`Couldn't update your account: ${updateErr.message}`);
        setFormBusy(false);
        return;
      }

      // 5b. Create profile + mark invitation accepted via RPC
      if (invitationId) {
        const { data: rpcResult, error: rpcErr } = await supabase.rpc('accept_invitation', {
          p_invitation_id: invitationId,
          p_first_name:    firstName,
          p_last_name:     lastName,
        });

        if (rpcErr) {
          // Non-fatal: profile might still have been created by the trigger.
          // Log and continue.
          console.warn('[SafiTrack] accept_invitation RPC error (non-fatal):', rpcErr.message);
        }

        if (rpcResult && rpcResult.success === false) {
          // The RPC indicated a problem (already accepted, expired, etc.)
          // Still allow login — the user has an auth account now.
          console.warn('[SafiTrack] accept_invitation returned:', rpcResult.error);
        }
      } else {
        // No invitation_id in metadata (edge case). Try to upsert profile from metadata.
        const orgId = meta.organization_id;
        if (orgId) {
          await supabase.from('profiles').upsert({
            id:              user.id,
            email:           user.email,
            first_name:      firstName,
            last_name:       lastName,
            role:            role || 'sales_rep',
            organization_id: orgId,
            status:          'active',
          });
        }
      }

      // 5c. Clean up URL hash so tokens aren't visible
      history.replaceState(null, '', window.location.pathname);

      // 5d. Show done state and redirect
      showState('done');
      setTimeout(() => { location.href = './index.html'; }, 3000);

    } catch (err) {
      showFormError(`Something went wrong: ${err.message}`);
      setFormBusy(false);
    }
  });

})();
