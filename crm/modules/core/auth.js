// modules/core/auth.js
// Authentication: login, logout, signup wizard, Google OAuth, invite.
import { state, supabaseClient, APP_BOOT_STARTED_AT, FAST_BOOT_SKIP_MS, LOADER_FADE_MS, clearViewState } from '../state.js';

import { loadingScreen, authScreen, mainApp, logoutBtn, mobileMenuToggle, sidebarClose, sidebarOverlay, userAvatarBtn, userMenu, notificationsBtn, notificationsMenu, notificationsCount, notificationsList, notificationsEnableBtn, notificationsMarkAllBtn, notificationsFilterTabs, safiNudgeLauncher } from '../ui/dom.js';
import { initApp } from './app-init.js';
import { loadView, openSidebar, closeSidebar } from './navigation.js';
import { stopDueNotificationsMonitor, markAllDueNotificationsRead, markSingleNotificationRead, requestNotificationPermission, updateNotificationPermissionCTA, setNotifActiveFilter, getNotifActiveFilter } from '../features/notifications.js';
import { stopSafiNudgeRealtime } from '../realtime/nudge.js';
// command-palette.js now self-initializes its own keyboard shortcuts
import { escapeHtml, showToast } from '../ui/toast.js';
import { showWelcomeScreen } from '../ui/welcome.js';

function initTheme() {
  const savedTheme = localStorage.getItem('safitrack_theme') || localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
}

function initAuth() {
  const finishBootstrap = (session) => {
    if (state.authBootstrapHandled) return;
    state.authBootstrapHandled = true;

    const elapsed = performance.now() - APP_BOOT_STARTED_AT;
    const skipFade = elapsed <= FAST_BOOT_SKIP_MS;

    const continueInit = () => {
      if (session) {
        state.currentUser = session.user;
        initApp();
      } else {
        authScreen.style.display = 'flex';
        if (new URLSearchParams(window.location.search).get('signup') === '1') {
          setTimeout(() => switchAuthPane('signup'), 0);
        }
      }
    };

    if (skipFade) {
      loadingScreen.style.display = 'none';
      continueInit();
      return;
    }

    loadingScreen.classList.add('hidden');
    setTimeout(() => {
      loadingScreen.style.display = 'none';
      continueInit();
    }, LOADER_FADE_MS);
  };

  supabaseClient.auth.getSession()
    .then(({ data: { session } }) => finishBootstrap(session))
    .catch((error) => {
      console.error('Session bootstrap error:', error);
      finishBootstrap(null);
    });

  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN') {
      state.currentUser = session.user;
      loadingScreen.style.display = 'none';

      // Extract first name from OAuth metadata (Google provides given_name/full_name).
      // The profile DB fetch in initApp() will refine this via updateWelcomeName().
      const meta = session.user.user_metadata || {};
      const nameHint = meta.given_name
        || meta.first_name
        || (meta.full_name || meta.name || '').split(' ')[0]
        || '';
      showWelcomeScreen(nameHint);

      initApp();
    } else if (event === 'SIGNED_OUT') {
      stopDueNotificationsMonitor();
      stopSafiNudgeRealtime();
      state.currentUser = null;
      state.currentUserProfile = null;
      mainApp.style.display = 'none';
      authScreen.style.display = 'flex';

      const completePane = document.getElementById('complete-profile-pane');
      if (completePane) completePane.style.display = 'none';

      if (new URLSearchParams(window.location.search).get('signup') === '1') {
        setTimeout(() => switchAuthPane('signup'), 0);
      } else {
        setTimeout(() => switchAuthPane('login'), 0);
      }
    }
  });
}

function initEventListeners() {
  // Password toggles
  document.querySelectorAll('.toggle-password').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = btn.closest('.input-wrapper').querySelector('input');
      const icon = btn.querySelector('i');
      if (input.type === 'password') {
        input.type = 'text';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
      } else {
        input.type = 'password';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
      }
    });
  });

  // Login form
  document.getElementById('login-form').addEventListener('submit', handleLogin);

  // ── Auth pane switchers (login ↔ signup ↔ email-verify) ──────────────
  document.getElementById('show-signup-btn')?.addEventListener('click', () => switchAuthPane('signup'));
  document.getElementById('show-login-btn')?.addEventListener('click', () => switchAuthPane('login'));
  document.getElementById('back-to-signup-btn')?.addEventListener('click', () => switchAuthPane('signup'));
  document.getElementById('signup-form')?.addEventListener('submit', handleSignup);
  // On steps 1–2, Enter key should advance rather than submit
  document.getElementById('signup-form')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const activePanel = document.querySelector('.signup-step-panel.active');
    if (!activePanel) return;
    const step = parseInt(activePanel.id.replace('signup-step-', ''), 10);
    if (step < 3) { e.preventDefault(); goToSignupStep(step + 1); }
  });

  // ── Invite modal ──────────────────────────────────────────────────────
  document.getElementById('invite-modal-close')?.addEventListener('click', closeInviteModal);
  document.getElementById('invite-modal-overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeInviteModal();
  });
  document.getElementById('invite-form')?.addEventListener('submit', handleInviteSubmit);
  // Delegate invite-member-btn click (rendered inside settings view)
  document.addEventListener('click', (e) => {
    if (e.target.closest('#invite-member-btn')) openInviteModal();
  });

  // Logout
  logoutBtn.addEventListener('click', handleLogout);

  // Mobile menu
  mobileMenuToggle?.addEventListener('click', openSidebar);
  sidebarClose?.addEventListener('click', closeSidebar);
  sidebarOverlay?.addEventListener('click', closeSidebar);

  // User menu
  userAvatarBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    notificationsMenu?.classList.remove('active');
    userMenu.classList.toggle('active');
  });

  notificationsBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    userMenu?.classList.remove('active');
    notificationsMenu?.classList.toggle('active');
  });

  notificationsMarkAllBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    markAllDueNotificationsRead();
  });

  notificationsFilterTabs?.addEventListener('click', (e) => {
    const tab = e.target.closest('.notif-tab');
    if (!tab) return;
    const filter = tab.dataset.filter;
    if (!filter || filter === getNotifActiveFilter()) return;
    notificationsFilterTabs.querySelectorAll('.notif-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    setNotifActiveFilter(filter);
  });

  safiNudgeLauncher?.addEventListener('click', async (e) => {
    e.stopPropagation();
    userMenu?.classList.remove('active');
    notificationsMenu?.classList.remove('active');
    await window.openSafiNudgeComposer();
  });

  notificationsEnableBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    await requestNotificationPermission();
    updateNotificationPermissionCTA();
  });

  notificationsList?.addEventListener('click', async (e) => {
    const itemEl = e.target.closest('.notification-item');
    if (!itemEl) return;
    const targetView = itemEl.dataset.view;
    const key = itemEl.dataset.key;
    markSingleNotificationRead(key);
    notificationsMenu?.classList.remove('active');
    if (targetView && targetView !== state.currentView) {
      await loadView(targetView);
    }
  });

  document.addEventListener('click', (e) => {
    if (!userMenu?.contains(e.target)) {
      userMenu?.classList.remove('active');
    }
    if (!notificationsMenu?.contains(e.target)) {
      notificationsMenu?.classList.remove('active');
    }
  });

  // Theme toggle
  // themeToggle?.addEventListener('click', toggleTheme);

  // Command palette keyboard shortcuts are now handled in command-palette.js module

  // Help Guide
  document.getElementById('help-guide-btn')?.addEventListener('click', () => {
    userMenu?.classList.remove('active');
    if (window.onboarding) window.onboarding.start();
  });

  // Settings
  document.getElementById('settings-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    userMenu?.classList.remove('active');
    loadView('settings');
  });


  // Navigation
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const view = e.currentTarget.getAttribute('data-view');
      loadView(view);
      closeSidebar();
    });
  });

  // Company description AI generation
  const _generateCompanyDescBtn = document.getElementById('generate-company-desc-btn');
  if (_generateCompanyDescBtn) {
    _generateCompanyDescBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleGenerateCompanyDescription();
    });
  }
  const _inlineGenerateBtn = document.getElementById('generate-company-desc-inline-btn');
  if (_inlineGenerateBtn) {
    _inlineGenerateBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleGenerateCompanyDescription();
    });
  }
  // inline button removed from markup — clean up variable if present
  if (_inlineGenerateBtn && !_inlineGenerateBtn.parentElement) {
    // no-op, just safe-guard
  }

  initWorkspaceMenu();
}

// ======================
// WORKSPACE MENU
// ======================

function initWorkspaceMenu() {
  const btn = document.getElementById('ws-btn');
  if (!btn) return;

  // Expose toggle as a global so the inline onclick always works
  window.toggleWorkspaceMenu = function (e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('ws-menu');
    if (!menu) return;
    if (menu.style.display === 'none' || menu.style.display === '') {
      _openWorkspaceMenu();
    } else {
      _closeWorkspaceMenu();
    }
  };

  const menu = document.createElement('div');
  menu.id = 'ws-menu';
  menu.className = 'ws-menu';
  menu.style.display = 'none';
  menu.innerHTML = `
    <div class="ws-menu-org-row">
      <span class="ws-menu-org-avatar" id="ws-menu-avatar">S</span>
      <span class="ws-menu-org-name" id="ws-menu-org-label">My Workspace</span>
    </div>
    <div class="ws-menu-divider"></div>
    <button class="ws-menu-item" data-ws-action="account">
      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>
      Account settings
    </button>
    <button class="ws-menu-item" data-ws-action="workspace">
      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
      Organization settings
    </button>
    <div class="ws-menu-divider"></div>
    <button class="ws-menu-item" data-ws-action="invite">
      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/></svg>
      Invite team members
    </button>
    <button class="ws-menu-item" data-ws-action="upgrade">
      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>
      Upgrade SafiTrack
    </button>
    <div class="ws-menu-divider"></div>
    <button class="ws-menu-item" data-ws-action="integrations">
      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>
      Apps &amp; integrations
    </button>
    <div class="ws-menu-divider"></div>
    <button class="ws-menu-item ws-menu-item--danger" data-ws-action="signout">
      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>
      Logout
    </button>
  `;
  document.body.appendChild(menu);

  // Header org button (visible on desktop where sidebar-header is hidden)
  const headerOrgBtn = document.getElementById('header-org-btn');

  function _openWorkspaceMenu(triggerEl) {
    const orgLabel = menu.querySelector('#ws-menu-org-label');
    const orgAvatar = menu.querySelector('#ws-menu-avatar');
    if (state.currentOrganization?.name) {
      if (orgLabel) orgLabel.textContent = state.currentOrganization.name;
      if (orgAvatar) {
        if (state.currentOrganization.logo_url) {
          orgAvatar.innerHTML = `<img src="${state.currentOrganization.logo_url}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block;">`;
        } else {
          orgAvatar.textContent = state.currentOrganization.name[0].toUpperCase();
        }
      }
    }
    const rect = triggerEl.getBoundingClientRect();
    menu.style.left = rect.left + 'px';
    menu.style.width = Math.max(rect.width, 230) + 'px';
    menu.style.top = (rect.bottom + 6) + 'px';
    menu.style.display = 'block';
    triggerEl.classList.add('open');
    menu._activeTrigger = triggerEl;
  }

  function _closeWorkspaceMenu() {
    menu.style.display = 'none';
    if (menu._activeTrigger) {
      menu._activeTrigger.classList.remove('open');
      menu._activeTrigger = null;
    }
    btn.classList.remove('open');
    if (headerOrgBtn) headerOrgBtn.classList.remove('open');
  }

  const openMenu = _openWorkspaceMenu;
  const closeMenu = _closeWorkspaceMenu;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.style.display === 'none' || menu.style.display === '' ? openMenu(btn) : closeMenu();
  });

  if (headerOrgBtn) {
    headerOrgBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.style.display === 'none' || menu.style.display === '' ? openMenu(headerOrgBtn) : closeMenu();
    });
  }

  menu.addEventListener('click', async (e) => {
    const item = e.target.closest('[data-ws-action]');
    if (!item) return;
    closeMenu();
    const action = item.dataset.wsAction;
    switch (action) {
      case 'account':
        state._pendingSettingsSection = 'profile';
        await loadView('settings');
        break;
      case 'workspace':
        state._pendingSettingsSection = 'organization';
        await loadView('settings');
        break;
      case 'invite':
        openInviteModal();
        break;
      case 'upgrade':
        window.open('https://safitrack.netlify.app/pages/pricing', '_blank', 'noopener');
        break;
      case 'integrations':
        window.open('https://safitrack.netlify.app/pages/integrations', '_blank', 'noopener');
        break;
      case 'signout':
        handleLogout();
        break;
    }
  });

  document.addEventListener('click', (e) => {
    if (menu.style.display !== 'none' && !menu.contains(e.target) && !btn.contains(e.target) && (!headerOrgBtn || !headerOrgBtn.contains(e.target))) {
      closeMenu();
    }
  });
}

// ======================
// AUTHENTICATION HANDLERS
// ======================

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const submitBtn = e.target.querySelector('button[type="submit"]');

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Signing in...';

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

  if (error) {
    showToast(error.message, 'error');
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span>Sign In</span>';
    return;
  }

  state.currentUser = data.user;
  submitBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-icon lucide-check"><path d="M20 6 9 17l-5-5"/></svg> Success!';
}

async function handleLogout() {
  stopDueNotificationsMonitor();
  stopSafiNudgeRealtime();
  clearViewState();
  state.appInitialized = false;
  await supabaseClient.auth.signOut();
  location.reload();
}

// ── Auth pane switcher ───────────────────────────────────────────────────────
function switchAuthPane(pane) {
  const loginPane = document.getElementById('login-pane');
  const signupPane = document.getElementById('signup-pane');
  const verifyPane = document.getElementById('email-verify-pane');
  const completePane = document.getElementById('complete-profile-pane');

  if (!loginPane) return;
  loginPane.style.display = pane === 'login' ? '' : 'none';
  signupPane.style.display = pane === 'signup' ? '' : 'none';
  verifyPane.style.display = pane === 'verify' ? '' : 'none';
  if (completePane) completePane.style.display = 'none';

  // Always restart the wizard from step 1 when the signup pane is shown
  if (pane === 'signup') goToSignupStep(1);
}

// ── Google OAuth ─────────────────────────────────────────────────────────────
async function handleGoogleAuth() {
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin + window.location.pathname
    }
  });

  if (error) {
    showToast(error.message, 'error');
  }
}

// ── Complete Google Profile ──────────────────────────────────────────────────
async function handleCompleteGoogleProfile(e) {
  e.preventDefault();
  const firstName = document.getElementById('complete-profile-firstname').value.trim();
  const lastName = document.getElementById('complete-profile-lastname').value.trim();
  const companyName = document.getElementById('complete-profile-company').value.trim();
  const btn = document.getElementById('complete-profile-btn');

  if (!firstName || !lastName || !companyName) {
    showToast('Please fill out all fields.', 'error');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Setting up your workspace...';

  // Call the SQL RPC to create the org and attach to the profile
  const { data, error } = await supabaseClient.rpc('complete_google_signup', {
    p_company_name: companyName,
    p_first_name: firstName,
    p_last_name: lastName
  });

  btn.disabled = false;
  btn.textContent = 'Complete Setup';

  if (error || (data && !data.success)) {
    showToast(error?.message || data?.error || 'Failed to complete profile', 'error');
    return;
  }

  // Reload the session locally to pick up the new role/org changes
  await supabaseClient.auth.refreshSession();

  // Transition to the app
  const completePane = document.getElementById('complete-profile-pane');
  if (completePane) completePane.style.display = 'none';

  initApp();
}

// ── Signup multi-step wizard ─────────────────────────────────────────────────
let _signupCurrentStep = 1;

const _SIGNUP_STEP_COPY = {
  1: { title: 'Tell us about you', sub: "You're 3 quick steps away from your workspace." },
  2: { title: 'Set up your workspace', sub: 'Almost there — just a few more details.' },
  3: { title: 'Choose your plan', sub: 'Start free. Upgrade whenever you need to.' },
};

function goToSignupStep(target) {
  const current = _signupCurrentStep;
  if (target > current && !_validateSignupStep(current)) return;

  const reverse = target < current;
  _signupCurrentStep = target;

  // Clear the email-taken notice whenever the user navigates away from step 3
  if (target !== 3) document.getElementById('signup-email-taken-notice')?.remove();

  // Swap step panels
  document.querySelectorAll('.signup-step-panel').forEach((panel, i) => {
    const isTarget = (i + 1) === target;
    panel.classList.remove('active', 'step-reverse');
    if (isTarget) {
      // Force reflow so the animation always replays
      void panel.offsetWidth;
      if (reverse) panel.classList.add('step-reverse');
      panel.classList.add('active');
    }
  });

  // Update stepper dots
  document.querySelectorAll('.ss-step').forEach((stepEl, i) => {
    const s = i + 1;
    stepEl.classList.remove('active', 'completed');
    if (s === target) stepEl.classList.add('active');
    else if (s < target) stepEl.classList.add('completed');
  });

  // Update heading copy
  const copy = _SIGNUP_STEP_COPY[target];
  if (copy) {
    const titleEl = document.getElementById('signup-step-title');
    const subEl = document.getElementById('signup-step-subtitle');
    if (titleEl) titleEl.textContent = copy.title;
    if (subEl) subEl.textContent = copy.sub;
  }
}

function _validateSignupStep(step) {
  if (step === 1) {
    const fn = document.getElementById('signup-firstname')?.value.trim();
    const ln = document.getElementById('signup-lastname')?.value.trim();
    if (!fn) { showToast('Please enter your first name.', 'error'); return false; }
    if (!ln) { showToast('Please enter your last name.', 'error'); return false; }
  }
  if (step === 2) {
    const co = document.getElementById('signup-company')?.value.trim();
    const em = document.getElementById('signup-email')?.value.trim();
    const pw = document.getElementById('signup-password')?.value ?? '';
    if (!co) { showToast('Please enter your company name.', 'error'); return false; }
    if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      showToast('Please enter a valid work email.', 'error'); return false;
    }
    if (pw.length < 8) { showToast('Password must be at least 8 characters.', 'error'); return false; }
  }
  return true;
}

// ── Sign-up handler (manager self-registration) ──────────────────────────────
async function handleSignup(e) {
  e.preventDefault();
  const firstName = document.getElementById('signup-firstname').value.trim();
  const lastName = document.getElementById('signup-lastname').value.trim();
  const companyName = document.getElementById('signup-company').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const btn = document.getElementById('signup-btn');

  if (!firstName || !lastName) { showToast('Please enter your full name.', 'error'); return; }
  if (!companyName) { showToast('Please enter your company name.', 'error'); return; }
  if (password.length < 8) { showToast('Password must be at least 8 characters.', 'error'); return; }

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating account…';

  // The `company_name`, `first_name`, `last_name` in user_metadata trigger the
  // `handle_new_user` DB trigger which auto-creates the organization + manager profile.
  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: {
      data: {
        first_name: firstName,
        last_name: lastName,
        company_name: companyName,
      },
      emailRedirectTo: window.location.origin + window.location.pathname,
    },
  });

  btn.disabled = false;
  btn.innerHTML = 'Create account';

  if (error) {
    showToast(error.message, 'error');
    return;
  }

  // Supabase returns a user with an empty identities array when the email is
  // already registered — it won't expose this via an error to prevent enumeration.
  if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    _showSignupEmailTakenError(email);
    return;
  }

  // If Supabase has email confirmation disabled, a session is returned immediately
  // — log the user straight into the app instead of showing the verify pane.
  if (data?.session) {
    return; // onAuthStateChange will fire and load the app
  }

  // Show email verification pane
  const verifyEmailEl = document.getElementById('verify-email-display');
  if (verifyEmailEl) verifyEmailEl.textContent = email;
  switchAuthPane('verify');
  // Store email for the resend button
  const resendBtn = document.getElementById('resend-verify-btn');
  if (resendBtn) {
    resendBtn.dataset.email = email;
    resendBtn.style.display = 'inline';
  }
}

// ── Email-already-exists inline error ────────────────────────────────────────
function _showSignupEmailTakenError(email) {
  // Remove any previous notice
  document.getElementById('signup-email-taken-notice')?.remove();

  const notice = document.createElement('div');
  notice.id = 'signup-email-taken-notice';
  notice.style.cssText = [
    'margin-top:14px',
    'padding:13px 15px',
    'border-radius:10px',
    'border:1px solid var(--color-warning, #c6841a)',
    'background:var(--color-warning-bg, rgba(198,132,26,.12))',
    'font-size:0.875rem',
    'line-height:1.5',
    'color:var(--text-primary)',
    'display:flex',
    'align-items:flex-start',
    'gap:10px',
  ].join(';');

  notice.innerHTML = `
    <svg style="flex-shrink:0;margin-top:1px" width="16" height="16" fill="none"
      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
      viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
    <span>
      <strong>${email}</strong> is already registered.
      <button type="button"
        style="background:none;border:none;padding:0;margin-left:4px;font-family:inherit;
               font-size:inherit;font-weight:700;cursor:pointer;color:var(--color-primary);
               text-decoration:underline;text-underline-offset:2px;"
        onclick="document.getElementById('signup-email-taken-notice')?.remove(); switchAuthPane('login'); document.getElementById('login-email').value='${email.replace(/'/g, "\\'")}'; document.getElementById('login-email').dispatchEvent(new Event('input'));">
        Sign in instead
      </button>
    </span>`;

  // Insert after the password field (last field in step 3's form area)
  const step3 = document.getElementById('signup-step-3');
  const actions = step3?.querySelector('.signup-step-actions');
  if (actions) {
    actions.insertAdjacentElement('beforebegin', notice);
  }
}

// ── Invite modal ─────────────────────────────────────────────────────────────
async function handleResendVerification(btn) {
  const email = btn?.dataset?.email || document.getElementById('verify-email-display')?.textContent?.trim();
  if (!email) { showToast('Email address not found.', 'error'); return; }
  btn.disabled = true;
  btn.textContent = 'Sending…';
  const { error } = await supabaseClient.auth.resend({ type: 'signup', email });
  btn.disabled = false;
  btn.textContent = 'Resend confirmation email';
  if (error) {
    showToast('Could not resend: ' + error.message, 'error');
  } else {
    showToast('Confirmation email resent — check your inbox (and spam).', 'success');
  }
}

function openInviteModal() {
  const overlay = document.getElementById('invite-modal-overlay');
  if (!overlay) return;
  // Reset form
  document.getElementById('invite-form')?.reset();
  const msgEl = document.getElementById('invite-msg');
  if (msgEl) { msgEl.style.display = 'none'; msgEl.textContent = ''; }
  const submitBtn = document.getElementById('invite-submit-btn');
  if (submitBtn) submitBtn.disabled = false;
  overlay.style.display = 'flex';
}

function closeInviteModal() {
  const overlay = document.getElementById('invite-modal-overlay');
  if (overlay) overlay.style.display = 'none';
}

async function handleInviteSubmit(e) {
  e.preventDefault();
  const email = (document.getElementById('invite-email')?.value || '').trim();
  const roleEl = document.querySelector('input[name="invite-role"]:checked');
  const role = roleEl ? roleEl.value : 'sales_rep';
  const msgEl = document.getElementById('invite-msg');
  const submitBtn = document.getElementById('invite-submit-btn');

  if (!email) { setInviteMsg('Please enter an email address.', 'error'); return; }

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending…';

  try {
    const SUPABASE_URL = (window.APP_CONFIG || {}).SUPABASE_URL;
    const session = (await supabaseClient.auth.getSession()).data.session;
    const accessToken = session?.access_token;

    const response = await fetch(`${SUPABASE_URL}/functions/v1/send-invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'apikey': (window.APP_CONFIG || {}).SUPABASE_KEY,
      },
      body: JSON.stringify({ email, role }),
    });

    const result = await response.json();

    if (!response.ok || result.error) {
      setInviteMsg(result.error || 'Failed to send invitation.', 'error');
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><path d="M22 2L11 13"/><path d="M22 2L15 22 11 13 2 9l20-7z"/></svg> Send invitation';
      return;
    }

    // Success
    setInviteMsg(`Invitation sent to ${email}! They'll receive an email shortly.`, 'success');
    submitBtn.innerHTML = '✓ Sent!';
    setTimeout(() => {
      closeInviteModal();
      // Refresh the members list if it's visible
      const membersList = document.getElementById('sv-members-container');
      if (membersList) membersList.closest('section')?.querySelector('.sv-primary-btn')?.dispatchEvent(new Event('refresh'));
    }, 2200);

  } catch (err) {
    setInviteMsg(`Error: ${err.message}`, 'error');
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><path d="M22 2L11 13"/><path d="M22 2L15 22 11 13 2 9l20-7z"/></svg> Send invitation';
  }
}

function setInviteMsg(text, type) {
  const el = document.getElementById('invite-msg');
  if (!el) return;
  el.style.display = 'block';

  const isSeatLimit = type === 'error' && text.toLowerCase().includes('plan allows');

  if (type === 'error') {
    el.style.background = 'rgba(239,68,68,0.12)';
    el.style.border = '1px solid rgba(239,68,68,0.4)';
    el.style.color = 'var(--text-primary, #111)';
  } else {
    el.style.background = 'rgba(34,197,94,0.12)';
    el.style.border = '1px solid rgba(34,197,94,0.4)';
    el.style.color = 'var(--text-primary, #111)';
  }

  if (isSeatLimit) {
    el.innerHTML = `
      <span>${escapeHtml(text)}</span>
      <a href="https://safitrack.netlify.app/pages/pricing" target="_blank" rel="noopener"
         style="display:block;margin-top:8px;padding:6px 14px;border-radius:6px;background:#000;color:#fff;font-size:0.82rem;font-weight:600;text-decoration:none;text-align:center;">
        Upgrade plan
      </a>`;
  } else {
    el.textContent = text;
  }
}

// ======================


// ── Exports ────────────────────────────────────────────────────
export {
  initTheme,
  initAuth,
  initEventListeners,
  initWorkspaceMenu,
  handleLogin,
  handleLogout,
  switchAuthPane,
  handleGoogleAuth,
  handleCompleteGoogleProfile,
  goToSignupStep,
  handleSignup,
  handleResendVerification,
  openInviteModal,
  closeInviteModal,
  handleInviteSubmit,
};
