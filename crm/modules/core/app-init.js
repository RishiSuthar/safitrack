// modules/core/app-init.js
// Application bootstrap: profile loading, navigation setup.
import { state, supabaseClient, crmDebugLog } from '../state.js';

import { authScreen, mainApp } from '../ui/dom.js';
import { loadView } from './navigation.js';
import { startDueNotificationsMonitor } from '../features/notifications.js';
import { startSafiNudgeRealtime } from '../realtime/nudge.js';
import { attemptShowPWABanner } from '../ui/pwa.js';
import { showToast } from '../ui/toast.js';

// ======================
// APP INITIALIZATION
// ======================

// appInitialized lives on state.appInitialized (see modules/state.js)

async function initApp() {
  if (state.appInitialized) return;
  authScreen.style.display = 'none';
  mainApp.style.display = 'flex';

  const { data: profile, error: profileError } = await supabaseClient
    .from('profiles')
    .select('role, first_name, last_name, email, date_format, organization_id')
    .eq('id', state.currentUser.id)
    .maybeSingle();

  if (!profile || !profile.organization_id) {
    console.log('[SafiTrack] No profile or organization found yet. Redirecting to complete setup.');

    // Show complete profile pane and ensure everything else is hidden
    authScreen.style.display = 'flex';
    mainApp.style.display = 'none';

    const loginPane = document.getElementById('login-pane');
    const signupPane = document.getElementById('signup-pane');
    const verifyPane = document.getElementById('email-verify-pane');
    const completePane = document.getElementById('complete-profile-pane');

    if (loginPane) loginPane.style.display = 'none';
    if (signupPane) signupPane.style.display = 'none';
    if (verifyPane) verifyPane.style.display = 'none';

    if (completePane) {
      completePane.style.display = '';

      // Clear company name to start fresh
      const companyInput = document.getElementById('complete-profile-company');
      if (companyInput) companyInput.value = '';

      // Pre-fill name from metadata if possible
      const fnameInput = document.getElementById('complete-profile-firstname');
      const lnameInput = document.getElementById('complete-profile-lastname');

      if (fnameInput && !fnameInput.value) {
        const nameArr = (state.currentUser.user_metadata?.full_name || state.currentUser.user_metadata?.name || '').split(' ');
        fnameInput.value = state.currentUser.user_metadata?.first_name || nameArr[0] || '';
        if (nameArr.length > 1 && lnameInput) {
          lnameInput.value = state.currentUser.user_metadata?.last_name || nameArr.slice(1).join(' ');
        }
      }
    }
    return;
  }

  // If we reach here, user has a profile AND an organization
  state.appInitialized = true;
  authScreen.style.display = 'none';
  mainApp.style.display = 'flex';

  const completePane = document.getElementById('complete-profile-pane');
  if (completePane) completePane.style.display = 'none';
  state.isManager = profile.role === 'manager';
  state.isTechnician = profile.role === 'technician';
  state.isSalesRep = profile.role === 'sales_rep';
  state.currentUserProfile = profile;

  // Load organization for this user (used in invite flow, member list, etc.)
  if (profile.organization_id) {
    try {
      const { data: org } = await supabaseClient
        .from('organizations')
        .select('id, name, owner_id, max_members, currency')
        .eq('id', profile.organization_id)
        .single();
      state.currentOrganization = org || null;
      state.orgCurrency = org?.currency || 'USD';
      const orgNameEl = document.getElementById('ws-btn-org-name');
      const orgAvatarEl = document.getElementById('ws-btn-avatar');
      const headerOrgNameEl = document.getElementById('header-org-name');
      if (state.currentOrganization?.name) {
        const truncated = state.currentOrganization.name.length > 16
          ? state.currentOrganization.name.slice(0, 16) + '…'
          : state.currentOrganization.name;
        if (orgNameEl) orgNameEl.textContent = truncated;
        if (orgAvatarEl) orgAvatarEl.textContent = state.currentOrganization.name[0].toUpperCase();
        if (headerOrgNameEl) headerOrgNameEl.textContent = state.currentOrganization.name;
      }
    } catch (_orgErr) { /* non-critical */ }
  }

  // Initialize date format preference from profile if present
  try {
    if (profile && profile.date_format) {
      localStorage.setItem('safitrack_date_format', profile.date_format);
    }
  } catch (e) { }

  // Update UI based on role
  updateUserDisplay(profile);
  updateNavigationForRole();

  // Load all people for mention functionality
  await loadAllPeople();
  // Load companies early so logos are available on first render
  await loadAllCompanies();

  const savedView = localStorage.getItem('lastActiveView');

  // Define the default based on role
  let defaultView;
  if (state.isManager) {
    defaultView = 'team-dashboard';
  } else if (state.isTechnician) {
    defaultView = 'technician-log-visit';
  } else {
    defaultView = 'log-visit';
  }

  // If we have a saved view (and it's not the auth screen), use it. Otherwise use default.
  const viewToLoad = (savedView && savedView !== 'auth-screen') ? savedView : defaultView;

  // Load the determined view
  await loadView(viewToLoad);

  // Start sitewide due notifications monitor (tasks, reminders, deals)
  startDueNotificationsMonitor();
  startSafiNudgeRealtime();

  // Identify if onboarding should be shown (new user or forced)
  const hasCompletedTour = localStorage.getItem('safitrack_onboarding_completed');

  // Initialize onboarding system
  if (window.onboarding) {
    window.onboarding.init(profile.role);
    if (!hasCompletedTour) {
      setTimeout(() => window.onboarding.start(), 2000);
    } else {
      // If already done, try showing PWA prompt
      attemptShowPWABanner();
    }
    // No onboarding module, show PWA prompt
    attemptShowPWABanner();
  }

  // Initialize custom calendar for all date/time inputs
  initCustomCalendar('#task-due-date', { type: 'datetime-local' });
  initCustomCalendar('#reminder-date', { type: 'datetime-local' });
  initCustomCalendar('#call-datetime', { type: 'datetime-local' });
  initCustomCalendar('#opportunity-next-step-date', { type: 'date' });
  initCustomCalendar('#export-date-from', { type: 'date' });
  initCustomCalendar('#export-date-to', { type: 'date' });
}

async function loadAllPeople() {
  const orgId = state.currentOrganization?.id;
  let pQ = supabaseClient.from('people').select('id, name, email, company_id').order('name', { ascending: true });
  let cQ = supabaseClient.from('companies').select('id, name');
  if (orgId) {
    pQ = pQ.eq('organization_id', orgId);
    cQ = cQ.eq('organization_id', orgId);
  }
  const [peopleResult, companiesResult] = await Promise.all([pQ, cQ]);

  const { data: people, error } = peopleResult;
  crmDebugLog('loadAllPeople.peopleResult', {
    error,
    count: Array.isArray(people) ? people.length : 0,
    sample: Array.isArray(people) && people.length > 0 ? people[0] : null
  });

  if (error) {
    console.error('Error loading people:', error);
    return;
  }

  const companies = companiesResult.data || [];
  crmDebugLog('loadAllPeople.companiesResult', {
    error: companiesResult.error || null,
    count: companies.length,
    sample: companies.length > 0 ? companies[0] : null
  });

  const companiesById = new Map(companies.map((company) => [String(company.id), company]));

  state.allPeople = (people || []).map((person) => {
    const company = person.company_id ? companiesById.get(String(person.company_id)) || null : null;
    return {
      ...person,
      company,
      companies: company
    };
  });

  crmDebugLog('loadAllPeople.mappedPeople', {
    count: state.allPeople.length,
    sample: state.allPeople.length > 0 ? state.allPeople[0] : null
  });
}

async function loadAllCompanies() {
  try {
    // diagnostic logs removed
    const doFetch = async () => {
      let q = supabaseClient.from('companies').select('id, name, domain').order('name', { ascending: true });
      if (state.currentOrganization?.id) q = q.eq('organization_id', state.currentOrganization.id);
      const { data: companies, error } = await q;
      return { companies, error };
    };

    let { companies, error } = await doFetch();

    if (error) {
      crmDebugLog('loadAllCompanies.error', error);
      window.allCompaniesData = window.allCompaniesData || [];
      // initial fetch error (logged during development)
    }

    window.allCompaniesData = Array.isArray(companies) ? companies : [];

    // If no companies came back, try one quick retry (handles possible RLS/session timing issues)
    if ((!Array.isArray(window.allCompaniesData) || window.allCompaniesData.length === 0)) {
      // retrying fetch after short delay
      await new Promise(r => setTimeout(r, 250));
      const retryRes = await doFetch();
      companies = retryRes.companies;
      error = retryRes.error;
      if (error) {
        crmDebugLog('loadAllCompanies.retryError', error);
        // retry fetch error (ignored)
      }
      window.allCompaniesData = Array.isArray(companies) ? companies : window.allCompaniesData || [];
    }

    crmDebugLog('loadAllCompanies.loaded', { count: window.allCompaniesData.length });
    // Ensure each company has a usable logo_url and prefetch images to warm browser cache
    window.allCompaniesData.forEach(c => {
      const name = c.name || '';
      const initials = getInitials(name || '');
      const domain = c.domain || '';
      const computed = c.logo_url || (domain ? getCompanyLogoUrl(domain) : null) || `https://ui-avatars.com/api/?name=${encodeURIComponent(name || initials)}&background=ededed&color=444&size=64`;
      if (!c.logo_url) c.logo_url = computed;
      try { const img = new Image(); img.src = c.logo_url; } catch (e) { /* ignore */ }
    });
    // Log loaded companies and their logo urls for debugging first-load logo issues
    // companies loaded (silent)
    return window.allCompaniesData;
  } catch (e) {
    crmDebugLog('loadAllCompanies.exception', e);
    window.allCompaniesData = window.allCompaniesData || [];
    // exception during loadAllCompanies (ignored)
    return window.allCompaniesData;
  }
}

function updateUserDisplay(profile) {
  const displayName = profile.first_name ? `${profile.first_name} ${profile.last_name || ''}` : state.currentUser.email;
  const initials = getInitials(displayName);
  const email = profile.email || state.currentUser.email;

  // Update header avatar
  document.getElementById('user-avatar').textContent = initials;
  document.getElementById('user-display-name').textContent = displayName;
  document.getElementById('user-display-email').textContent = email;

}

function updateNavigationForRole() {
  const managerNavSection = document.getElementById('manager-nav-section');
  const technicianNavSection = document.getElementById('technician-nav-section');
  const managerBottomNav = document.querySelector('.bottom-nav-item.manager-only');
  const logVisitNav = document.querySelector('[data-view="log-visit"]');
  const technicianLogVisitNav = document.querySelector('[data-view="technician-log-visit"]');
  const technicianBottomNav = document.querySelectorAll('.bottom-nav-item.technician-only');

  if (state.isManager) {
    managerNavSection.style.display = 'block';
    if (managerBottomNav) managerBottomNav.style.display = 'flex';
    // Hide log visit for managers in sidebar
    document.querySelectorAll('.sidebar-nav [data-view="log-visit"]').forEach(el => {
      el.style.display = 'none';
    });
    // Hide technician views for managers
    technicianNavSection.style.display = 'none';


    // Ensure records are shown
    ['companies', 'people', 'user-management'].forEach(view => {
      document.querySelectorAll(`.sidebar-nav [data-view="${view}"]`).forEach(el => el.style.display = 'flex');
    });
  } else if (state.isTechnician) {
    // Show technician navigation
    technicianNavSection.style.display = 'block';
    // Hide sales rep navigation
    document.querySelectorAll('.sidebar-nav [data-view="log-visit"]').forEach(el => {
      el.style.display = 'none';
    });
    document.querySelectorAll('.sidebar-nav [data-view="my-activity"]').forEach(el => {
      el.style.display = 'none';
    });
    // Hide views that technicians should not access
    ['sales-funnel', 'opportunity-pipeline', 'call-logs', 'companies', 'people'].forEach(view => {
      document.querySelectorAll(`.sidebar-nav [data-view="${view}"]`).forEach(el => el.style.display = 'none');
    });
    document.querySelectorAll('.sidebar-nav [data-view="user-management"]').forEach(el => {
      el.style.display = 'flex';
    });
    // Hide manager navigation
    managerNavSection.style.display = 'none';
  } else {
    // Sales rep view
    managerNavSection.style.display = 'none';
    technicianNavSection.style.display = 'none';
    if (managerBottomNav) managerBottomNav.style.display = 'none';


    // Ensure records are shown
    ['companies', 'people', 'user-management'].forEach(view => {
      document.querySelectorAll(`.sidebar-nav [data-view="${view}"]`).forEach(el => el.style.display = 'flex');
    });
  }
  if (state.isTechnician) {
    technicianBottomNav.forEach(el => el.style.display = 'flex');
    // Hide other navigation
    document.querySelectorAll('.bottom-nav-item:not(.technician-only)').forEach(el => {
      el.style.display = 'none';
    });
  } else {
    technicianBottomNav.forEach(el => el.style.display = 'none');
  }

}


// ======================
// SIDEBAR & NAVIGATION
// ======================


// ── Exports ────────────────────────────────────────────────────
export {
  initApp,
  loadAllPeople,
  loadAllCompanies,
  updateUserDisplay,
  updateNavigationForRole,
};
