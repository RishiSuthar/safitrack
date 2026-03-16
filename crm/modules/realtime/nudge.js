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

  container.innerHTML = `
    <div class="safi-nudge-stage" role="status" aria-live="polite">
      <div class="safi-nudge-bot" aria-hidden="true">
        <img class="safi-nudge-bot-gif" src="${SAFI_NUDGE_BOT_GIF}" alt="" loading="eager" decoding="async">
        <span class="safi-nudge-bot-sparkle">✨</span>
      </div>
      <div class="safi-nudge-bubble">
        <div class="safi-nudge-title">SafiNudge from ${fromName}</div>
        <div class="safi-nudge-message">${message}</div>
      </div>
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
    <div class="modal-container snc-container">

      <div class="snc-hero">
        <button class="snc-close" type="button" id="safi-nudge-close" aria-label="Close">
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
        <img class="snc-bot" src="${SAFI_NUDGE_BOT_GIF}" alt="" loading="eager" decoding="async">
        <div class="snc-hero-title">Nudge a teammate</div>
        <div class="snc-hero-sub">Send a little something. No reason needed.</div>
      </div>

      <div class="snc-body">

        <div class="snc-to-row">
          <span class="snc-to-badge">To</span>
          <select id="safi-nudge-target-select" class="snc-select">
            <option value="">Pick a teammate…</option>
          </select>
        </div>

        <div class="snc-message-wrap">
          <textarea id="safi-nudge-message" class="snc-textarea" rows="3" maxlength="160" placeholder="What do you want them to know?"></textarea>
          <div class="snc-counter"><span id="safi-nudge-count">0</span> / 160</div>
        </div>

        <div class="snc-chips">
          <button type="button" class="snc-chip safi-nudge-quick" data-msg="Proud of you 🌟">Proud of you 🌟</button>
          <button type="button" class="snc-chip safi-nudge-quick" data-msg="You're on fire lately 🔥">You're on fire lately 🔥</button>
          <button type="button" class="snc-chip safi-nudge-quick" data-msg="Just thinking of you 👋">Just thinking of you 👋</button>
          <button type="button" class="snc-chip safi-nudge-quick" data-msg="Crushed it today 💪">Crushed it today 💪</button>
          <button type="button" class="snc-chip safi-nudge-quick" data-msg="You've got this 🎯">You've got this 🎯</button>
          <button type="button" class="snc-chip safi-nudge-quick" data-msg="Sending good energy ✨">Sending good energy ✨</button>
          <button type="button" class="snc-chip safi-nudge-quick" data-msg="You matter here ♥️">You matter here ♥️</button>
          <button type="button" class="snc-chip safi-nudge-quick" data-msg="Keep going, you're close 🙌">Keep going, you're close 🙌</button>
        </div>

      </div>

      <div class="snc-footer">
        <button class="snc-cancel-btn" type="button" id="safi-nudge-cancel">Maybe later</button>
        <button class="snc-send-btn" type="button" id="safi-nudge-send">Send it 🚀</button>
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
    const targetName = targetSelect?.selectedOptions?.[0]?.textContent?.trim() || 'Teammate';
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

  selectEl.innerHTML = '<option value="">Loading teammates…</option>';

  // Guard: we must know the org before we can safely scope the query
  const orgId = state.currentOrganization?.id;
  if (!orgId) {
    selectEl.innerHTML = '<option value="">No teammates visible for your role</option>';
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
    selectEl.innerHTML = '<option value="">No teammates visible for your role</option>';
    showToast('Could not find visible teammates to nudge yet', 'error');
    return;
  }

  selectEl.innerHTML = '<option value="">Choose a teammate</option>' + teammates.map((user) => {
    return `<option value="${user.id}">${escapeHtml(user.name)}</option>`;
  }).join('');

  if (preselectedUserId) {
    selectEl.value = String(preselectedUserId);
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
    targetSelect.value = '';
  }

  modal.style.display = 'flex';
  if (window.lucide) lucide.createIcons();
  if (targetSelect && !targetSelect.value) {
    targetSelect.focus();
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
