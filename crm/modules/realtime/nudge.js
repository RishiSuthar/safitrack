// modules/realtime/nudge.js
// Safi Nudge real-time messaging via Supabase channels.
import { state, supabaseClient, SAFI_NUDGE_EVENT, SAFI_NUDGE_CHANNEL, SAFI_NUDGE_BOT_GIF } from '../state.js';
import { escapeHtml, showToast, getInitials } from '../ui/toast.js';


function clearSafiNudgeTimers() {
  state.safiNudgeTimers.forEach((timer) => clearTimeout(timer));
  state.safiNudgeTimers = [];
}

function getSafiNudgeContainer() {
  let container = document.getElementById('safi-nudge-container');
  if (container) return container;

  container = document.createElement('div');
  container.id = 'safi-nudge-container';
  container.className = 'safi-nudge-container';
  document.body.appendChild(container);
  return container;
}

function queueSafiNudge(nudge) {
  state.safiNudgeQueue.push(nudge);
  if (!state.safiNudgeShowing) {
    renderNextSafiNudge();
  }
}

function hideSafiNudgeCard() {
  const container = document.getElementById('safi-nudge-container');
  if (!container) return;

  container.classList.remove('show-message');
  container.classList.remove('active');

  const completeHideTimer = window.setTimeout(() => {
    if (!state.safiNudgeShowing) {
      container.innerHTML = '';
      return;
    }
    state.safiNudgeShowing = false;
    renderNextSafiNudge();
  }, 320);

  state.safiNudgeTimers.push(completeHideTimer);
}

function renderNextSafiNudge() {
  if (state.safiNudgeQueue.length === 0) {
    state.safiNudgeShowing = false;
    const container = document.getElementById('safi-nudge-container');
    if (container) {
      container.classList.remove('active');
      container.innerHTML = '';
    }
    return;
  }

  state.safiNudgeShowing = true;
  clearSafiNudgeTimers();

  const nudge = state.safiNudgeQueue.shift();
  const container = getSafiNudgeContainer();
  const fromName = escapeHtml(nudge.fromName || 'Teammate');
  const message = escapeHtml(nudge.message || 'You got a SafiNudge ✨');

  const initials = getInitials(nudge.fromName || 'Teammate');
  
  container.innerHTML = `
    <div class="nudge-toast-card" role="status" aria-live="polite">
      <div class="nudge-toast-avatar">${initials}</div>
      <div class="nudge-toast-content">
        <div class="nudge-toast-title">Nudge from ${fromName}</div>
        <div class="nudge-toast-message">${message}</div>
      </div>
      <button class="nudge-toast-dismiss" aria-label="Dismiss">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
    </div>
  `;

  container.classList.add('active');

  const revealTimer = window.setTimeout(() => {
    container.classList.add('show-message');
  }, 520);
  state.safiNudgeTimers.push(revealTimer);

  container.onclick = () => {
    hideSafiNudgeCard();
  };

  const hideTimer = window.setTimeout(() => {
    hideSafiNudgeCard();
  }, 5600);
  state.safiNudgeTimers.push(hideTimer);
}

function handleIncomingSafiNudge(payload) {
  if (!payload || !state.currentUser?.id) return;
  if (String(payload.toUserId || '') !== String(state.currentUser.id)) return;
  if (String(payload.fromUserId || '') === String(state.currentUser.id)) return;

  queueSafiNudge(payload);
}

function stopSafiNudgeRealtime() {
  if (state.safiNudgeChannel) {
    supabaseClient.removeChannel(state.safiNudgeChannel);
    state.safiNudgeChannel = null;
  }
  state.safiNudgeSubscribed = false;
  state.safiNudgeLastStatus = 'stopped';
  state.safiNudgeStarting = false;
  state.safiNudgeReconnectAttempt = 0;
  if (state.safiNudgeReconnectTimer) {
    clearTimeout(state.safiNudgeReconnectTimer);
    state.safiNudgeReconnectTimer = null;
  }
  state.safiNudgeQueue = [];
  state.safiNudgeShowing = false;
  clearSafiNudgeTimers();

  const container = document.getElementById('safi-nudge-container');
  if (container) {
    container.classList.remove('active');
    container.innerHTML = '';
  }
}

function scheduleSafiNudgeReconnect(reason = 'unknown') {
  if (!state.currentUser?.id) return;
  if (state.safiNudgeReconnectTimer) return;

  state.safiNudgeReconnectAttempt += 1;
  const delayMs = Math.min(4000, 500 + (state.safiNudgeReconnectAttempt - 1) * 700);

  state.safiNudgeReconnectTimer = window.setTimeout(() => {
    state.safiNudgeReconnectTimer = null;
    startSafiNudgeRealtime();
  }, delayMs);
}

async function startSafiNudgeRealtime() {
  if (!state.currentUser?.id) return;
  if (state.safiNudgeStarting) {
    return;
  }

  state.safiNudgeStarting = true;
  if (state.safiNudgeReconnectTimer) {
    clearTimeout(state.safiNudgeReconnectTimer);
    state.safiNudgeReconnectTimer = null;
  }

  if (state.safiNudgeChannel) {
    supabaseClient.removeChannel(state.safiNudgeChannel);
    state.safiNudgeChannel = null;
  }
  state.safiNudgeSubscribed = false;
  state.safiNudgeLastStatus = 'starting';

  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session?.access_token && supabaseClient.realtime?.setAuth) {
      supabaseClient.realtime.setAuth(session.access_token);
    }

    if (supabaseClient.realtime?.connect) {
      supabaseClient.realtime.connect();
    }
  } catch (error) {
    // Error during realtime setup
  }

  const nudgeChannelName = state.currentOrganization?.id
    ? `${SAFI_NUDGE_CHANNEL}:${state.currentOrganization.id}`
    : SAFI_NUDGE_CHANNEL;
  state.safiNudgeChannel = supabaseClient.channel(nudgeChannelName, {
    config: {
      broadcast: { self: false }
    }
  });

  state.safiNudgeChannel
    .on('broadcast', { event: SAFI_NUDGE_EVENT }, ({ payload }) => {
      handleIncomingSafiNudge(payload);
    })
    .subscribe((status) => {
      state.safiNudgeLastStatus = status;
      state.safiNudgeSubscribed = status === 'SUBSCRIBED';

      if (status === 'SUBSCRIBED') {
        state.safiNudgeStarting = false;
        state.safiNudgeReconnectAttempt = 0;
        return;
      }

      if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR' || status === 'CLOSED') {
        state.safiNudgeStarting = false;
        state.safiNudgeSubscribed = false;
        scheduleSafiNudgeReconnect(status);
      }
    });

  window.setTimeout(() => {
    if (state.safiNudgeLastStatus === 'starting') {
      state.safiNudgeStarting = false;
      scheduleSafiNudgeReconnect('startup-no-status');
    }
  }, 2600);
}

async function ensureSafiNudgeReady(timeoutMs = 5200) {
  if (!state.currentUser?.id) return false;

  if (!state.safiNudgeChannel) {
    await startSafiNudgeRealtime();
  }

  if (state.safiNudgeSubscribed) {
    return true;
  }

  const startedAt = Date.now();
  let iterations = 0;
  while (Date.now() - startedAt < timeoutMs) {
    iterations += 1;
    await new Promise((resolve) => setTimeout(resolve, 120));
    if (state.safiNudgeSubscribed) {
      return true;
    }
  }

  return false;
}

function getSafiNudgeModal() {
  let modal = document.getElementById('safi-nudge-modal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'safi-nudge-modal';
  modal.className = 'modal';
  modal.style.display = 'none';
  modal.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal-container nudge-composer-container" style="max-width: 480px;">
      <div class="modal-header">
        <div class="modal-title-row" style="display:flex; align-items:center; gap: 8px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-zap"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          <h2 style="margin:0; font-size: 1.15rem; background: linear-gradient(90deg, var(--color-primary), #7c3aed); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">Send a Quick Nudge</h2>
        </div>
        <button class="modal-close" type="button" id="safi-nudge-close" aria-label="Close">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>

      <div class="modal-body" style="padding-top: 16px;">
        <div class="form-field" style="margin-bottom: 16px;">
          <label for="safi-nudge-target-select">To</label>
          <div class="input-wrapper modern-input">
            <div class="crm-dd crm-dd--form" data-dd-id="safi-nudge-target-select" style="width: 100%;" data-dd-required="true">
              <button type="button" class="crm-dd-trigger" aria-haspopup="listbox" aria-expanded="false">
                <span class="crm-dd-label" style="color:var(--text-muted)">Pick a teammate…</span>
                <span class="crm-dd-chevron"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>
              </button>
              <div class="crm-dd-panel" role="listbox">
                <ul class="crm-dd-list">
                  <li class="crm-dd-option" role="option" data-value="" data-label="Pick a teammate…" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Pick a teammate…</li>
                </ul>
              </div>
              <input class="crm-dd-value-input" type="hidden" id="safi-nudge-target-select" required>
            </div>
          </div>
        </div>

        <div class="form-field" style="margin-bottom: 16px; position: relative;">
          <label for="safi-nudge-message">Message</label>
          <div class="input-wrapper modern-input">
            <textarea id="safi-nudge-message" rows="3" maxlength="160" placeholder="What do you want them to know?" style="width: 100%; border-radius: var(--radius-md); padding: 12px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary); font-family: inherit; font-size: var(--type-md); resize: none; transition: border-color var(--transition-fast);"></textarea>
          </div>
          <div style="position: absolute; bottom: 8px; right: 12px; font-size: 0.75rem; color: var(--text-muted);"><span id="safi-nudge-count">0</span> / 160</div>
        </div>

        <div style="display: flex; flex-wrap: wrap; gap: 8px; padding-bottom: 8px;">
          <button type="button" class="nudge-pill-btn safi-nudge-quick" data-msg="Proud of you 🌟">Proud of you 🌟</button>
          <button type="button" class="nudge-pill-btn safi-nudge-quick" data-msg="You're on fire lately 🔥">You're on fire lately 🔥</button>
          <button type="button" class="nudge-pill-btn safi-nudge-quick" data-msg="Just thinking of you 👋">Just thinking of you 👋</button>
          <button type="button" class="nudge-pill-btn safi-nudge-quick" data-msg="Crushed it today 💪">Crushed it today 💪</button>
          <button type="button" class="nudge-pill-btn safi-nudge-quick" data-msg="You've got this 🎯">You've got this 🎯</button>
          <button type="button" class="nudge-pill-btn safi-nudge-quick" data-msg="Sending good energy ✨">Sending good energy ✨</button>
        </div>
      </div>

      <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 12px; padding: 16px 24px; border-top: 1px solid var(--border-color-light); background: var(--bg-primary);">
        <button class="btn btn-secondary" type="button" id="safi-nudge-cancel" style="border-radius: var(--btn-radius);">Maybe later</button>
        <div style="position: relative; min-width: 100px; height: 36px;">
            <button class="gradient-button" type="button" id="safi-nudge-send" style="position: absolute; right: 0; top: 0; width: 100%; height: 100%; margin: 0; display: flex; align-items: center; justify-content: center; gap: 6px;">
              <span>Send it 🚀</span>
            </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeModal = () => {
    modal.style.display = 'none';
    modal.removeAttribute('data-target-id');
    modal.removeAttribute('data-target-name');
  };

  modal.querySelector('#safi-nudge-close')?.addEventListener('click', closeModal);
  modal.querySelector('#safi-nudge-cancel')?.addEventListener('click', closeModal);
  modal.querySelector('.modal-backdrop')?.addEventListener('click', closeModal);

  const messageInput = modal.querySelector('#safi-nudge-message');
  const countEl = modal.querySelector('#safi-nudge-count');
  messageInput?.addEventListener('input', () => {
    if (countEl) countEl.textContent = String(messageInput.value.length);
  });

  modal.querySelectorAll('.safi-nudge-quick').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!messageInput) return;
      messageInput.value = btn.dataset.msg || '';
      messageInput.dispatchEvent(new Event('input'));
      messageInput.focus();
    });
  });

  modal.querySelector('#safi-nudge-send')?.addEventListener('click', async () => {
    const targetSelect = modal.querySelector('#safi-nudge-target-select');
    const targetId = targetSelect?.value || '';
    const root = targetSelect?.closest('.crm-dd');
    const selOpt = root?.querySelector('.crm-dd-option.is-selected');
    const targetName = selOpt?.dataset.label || 'Teammate';
    const rawMessage = messageInput?.value || '';
    const message = rawMessage.trim();

    if (!targetId) {
      showToast('Choose a teammate first', 'error');
      return;
    }

    if (!message) {
      showToast('Add a message before sending your nudge', 'error');
      return;
    }

    const ok = await sendSafiNudge(targetId, targetName, message);
    if (ok) {
      closeModal();
    }
  });

  return modal;
}

async function populateSafiNudgeRecipients(selectEl, preselectedUserId = null) {
  if (!selectEl) return;
  const root = selectEl.closest?.('.crm-dd') || selectEl;

  if (window.updateCrmDropdownOptions) {
    window.updateCrmDropdownOptions(root, [{ value: '', label: 'Loading teammates…' }], false);
  } else {
    selectEl.innerHTML = '<option value="">Loading teammates…</option>';
  }

  // Guard: we must know the org before we can safely scope the query
  const orgId = state.currentOrganization?.id;
  if (!orgId) {
    if (window.updateCrmDropdownOptions) {
      window.updateCrmDropdownOptions(root, [{ value: '', label: 'No teammates visible for your role' }], false);
    } else {
      selectEl.innerHTML = '<option value="">No teammates visible for your role</option>';
    }
    return;
  }

  const teammateMap = new Map();

  const addTeammate = (profileLike) => {
    if (!profileLike?.id) return;
    // Never include cross-org profiles that may arrive via FK joins
    if (profileLike.organization_id && profileLike.organization_id !== orgId) return;
    const id = String(profileLike.id);
    if (id === String(state.currentUser?.id || '')) return;

    const name = `${profileLike.first_name || ''} ${profileLike.last_name || ''}`.trim() || profileLike.email || 'Teammate';
    if (!teammateMap.has(id)) {
      teammateMap.set(id, {
        id,
        name,
        email: profileLike.email || ''
      });
    }
  };

  // Primary source: profiles strictly scoped to current org
  const { data: users, error } = await supabaseClient
    .from('profiles')
    .select('id, first_name, last_name, email, organization_id')
    .eq('organization_id', orgId)
    .order('first_name', { ascending: true });

  if (!error && Array.isArray(users)) {
    users.forEach(addTeammate);
  }

  // Fallback sources for restricted roles (e.g., sales reps with limited profiles visibility)
  // All queries are org-scoped to prevent cross-org profile bleed via FK joins.
  if (teammateMap.size === 0) {

    const [tasksRes, remindersRes, routesRes] = await Promise.all([
      supabaseClient
        .from('tasks')
        .select(`
          assigned_to_profile:profiles!tasks_assigned_to_fkey(id, first_name, last_name, email, organization_id),
          created_by_profile:profiles!tasks_created_by_fkey(id, first_name, last_name, email, organization_id)
        `)
        .eq('organization_id', orgId)
        .limit(400),
      supabaseClient
        .from('reminders')
        .select(`
          assigned_to_profile:profiles!reminders_assigned_to_fkey(id, first_name, last_name, email, organization_id),
          created_by_profile:profiles!reminders_created_by_fkey(id, first_name, last_name, email, organization_id)
        `)
        .eq('organization_id', orgId)
        .limit(400),
      supabaseClient
        .from('routes')
        .select(`
          assigned_to_profile:profiles!routes_assigned_to_fkey(id, first_name, last_name, email, organization_id),
          created_by_profile:profiles!routes_created_by_fkey(id, first_name, last_name, email, organization_id)
        `)
        .eq('organization_id', orgId)
        .limit(400)
    ]);

    (tasksRes.data || []).forEach((item) => {
      addTeammate(item.assigned_to_profile);
      addTeammate(item.created_by_profile);
    });

    (remindersRes.data || []).forEach((item) => {
      addTeammate(item.assigned_to_profile);
      addTeammate(item.created_by_profile);
    });

    (routesRes.data || []).forEach((item) => {
      addTeammate(item.assigned_to_profile);
      addTeammate(item.created_by_profile);
    });
  }

  const teammates = Array.from(teammateMap.values())
    .sort((a, b) => a.name.localeCompare(b.name));

  if (teammates.length === 0) {
    if (window.updateCrmDropdownOptions) {
      window.updateCrmDropdownOptions(root, [{ value: '', label: 'No teammates visible for your role' }], false);
    } else {
      selectEl.innerHTML = '<option value="">No teammates visible for your role</option>';
    }
    showToast('Could not find visible teammates to nudge yet', 'error');
    return;
  }

  const options = [{ value: '', label: 'Choose a teammate' }].concat(
    teammates.map(user => ({ value: user.id, label: user.name }))
  );

  if (window.updateCrmDropdownOptions) {
    window.updateCrmDropdownOptions(root, options, false);
    if (preselectedUserId) {
      window.setCrmDropdownValue(root, String(preselectedUserId));
    } else {
      window.setCrmDropdownValue(root, '');
    }
  } else {
    selectEl.innerHTML = '<option value="">Choose a teammate</option>' + teammates.map((user) => {
      return `<option value="${user.id}">${escapeHtml(user.name)}</option>`;
    }).join('');

    if (preselectedUserId) {
      selectEl.value = String(preselectedUserId);
    }
  }
}

window.openSafiNudgeComposer = async function (targetUserId = '', targetUserName = '') {
  if (!state.currentUser?.id) return;
  if (targetUserId && String(targetUserId) === String(state.currentUser.id)) {
    showToast('Choose another teammate to nudge', 'error');
    return;
  }

  const modal = getSafiNudgeModal();
  const targetSelect = modal.querySelector('#safi-nudge-target-select');
  const messageInput = modal.querySelector('#safi-nudge-message');
  const countEl = modal.querySelector('#safi-nudge-count');

  modal.dataset.targetId = String(targetUserId || '');
  modal.dataset.targetName = String(targetUserName || '');
  if (messageInput) messageInput.value = '';
  if (countEl) countEl.textContent = '0';

  await populateSafiNudgeRecipients(targetSelect, targetUserId || null);

  if (targetSelect && !targetUserId) {
    window.setCrmDropdownValue?.(targetSelect.closest('.crm-dd') || targetSelect, '');
  }

  modal.style.display = 'flex';
  if (window.lucide) lucide.createIcons();
  
  // init dropdown inside modal if not yet init
  const dd = modal.querySelector('.crm-dd');
  if (dd && window.initCrmDropdown) window.initCrmDropdown(dd);

  if (targetSelect && !targetSelect.value) {
    dd?.querySelector('.crm-dd-trigger')?.focus() || targetSelect.focus();
  } else {
    messageInput?.focus();
  }
};

async function sendSafiNudge(toUserId, toUserName, message) {
  const isReady = await ensureSafiNudgeReady();
  if (!isReady || !state.safiNudgeChannel) {
    showToast(`SafiNudge could not connect (status: ${state.safiNudgeLastStatus}).`, 'error');
    return false;
  }

  const safeMessage = String(message || '').trim().slice(0, 160);
  if (!safeMessage) {
    showToast('Nudge message cannot be empty', 'error');
    return false;
  }

  const fromName = getDisplayNameFromProfile(state.currentUserProfile);
  const payload = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fromUserId: state.currentUser.id,
    fromName,
    toUserId,
    toUserName,
    message: safeMessage,
    sentAt: new Date().toISOString()
  };

  try {
    const result = await state.safiNudgeChannel.send({
      type: 'broadcast',
      event: SAFI_NUDGE_EVENT,
      payload
    });

    if (result !== 'ok') {
      showToast('Could not deliver SafiNudge right now', 'error');
      return false;
    }

    showToast(`SafiNudge sent to ${toUserName} ✨`, 'success');
    return true;
  } catch (error) {
    showToast('Failed to send SafiNudge: ' + error.message, 'error');
    return false;
  }
}

window.sendTestSafiNudge = function () {
  if (!state.currentUser?.id) return;

  queueSafiNudge({
    id: `test-${Date.now()}`,
    fromUserId: 'safibot',
    fromName: 'SafiBot',
    toUserId: state.currentUser.id,
    toUserName: getDisplayNameFromProfile(state.currentUserProfile),
    message: 'Debug ping! Your SafiNudge bot is alive and adorable ✨',
    sentAt: new Date().toISOString()
  });

  showToast('Test SafiNudge triggered', 'info', { subtle: true, duration: 1400, dedupeMs: 800 });
};

// ======================
// VISITS HUB - PREMIUM MANAGER VIEW


// ── Exports ────────────────────────────────────────────────────
export {
  clearSafiNudgeTimers,
  getSafiNudgeContainer,
  queueSafiNudge,
  hideSafiNudgeCard,
  renderNextSafiNudge,
  handleIncomingSafiNudge,
  stopSafiNudgeRealtime,
  scheduleSafiNudgeReconnect,
  startSafiNudgeRealtime,
  ensureSafiNudgeReady,
  getSafiNudgeModal,
  populateSafiNudgeRecipients,
  sendSafiNudge,
};
