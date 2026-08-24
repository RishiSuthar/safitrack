// modules/core/app-init.js
// Application bootstrap: profile loading, navigation setup.
import { state, supabaseClient, crmDebugLog } from '../state.js';

import { authScreen, mainApp } from '../ui/dom.js';
import { loadView, initCollapsibleSections } from './navigation.js';
import { notificationStore } from '../features/notifications.js';
import { startSafiNudgeRealtime } from '../realtime/nudge.js';
import { attemptShowPWABanner } from '../ui/pwa.js';
import { showToast } from '../ui/toast.js';
import { checkAndShowChangelog } from '../ui/changelog.js';
import { updateWelcomeName, dismissWelcomeScreen } from '../ui/welcome.js';

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
    .select('role, first_name, last_name, email, date_format, organization_id, avatar_url')
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

  // Refine the welcome screen name now that we have the real profile.
  updateWelcomeName(profile.first_name);

  // Load organization for this user (used in invite flow, member list, etc.)
  if (profile.organization_id) {
    try {
      const { data: org } = await supabaseClient
        .from('organizations')
        .select('id, name, owner_id, max_members, currency, logo_url, settings')
        .eq('id', profile.organization_id)
        .single();
      state.currentOrganization = org || null;
      state.orgCurrency = org?.currency || 'USD';
      state.isOrgOwner = !!(org && org.owner_id === state.currentUser?.id);
      const orgNameEl = document.getElementById('ws-btn-org-name');
      const orgAvatarEl = document.getElementById('ws-btn-avatar');
      const headerOrgNameEl = document.getElementById('header-org-name');
      if (state.currentOrganization?.name) {
        const truncated = state.currentOrganization.name.length > 16
          ? state.currentOrganization.name.slice(0, 16) + '…'
          : state.currentOrganization.name;
        if (orgNameEl) orgNameEl.textContent = truncated;
        if (headerOrgNameEl) headerOrgNameEl.textContent = state.currentOrganization.name;
        if (orgAvatarEl) {
          if (state.currentOrganization.logo_url) {
            orgAvatarEl.innerHTML = `<img src="${state.currentOrganization.logo_url}" alt="" class="ws-btn-logo-img">`;
          } else {
            orgAvatarEl.textContent = state.currentOrganization.name[0].toUpperCase();
          }
        }
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
  initCollapsibleSections();

  // Start loading people and companies non-blockingly, storing the promises globally
  window.allPeoplePromise = loadAllPeople();
  window.allCompaniesPromise = loadAllCompanies();

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

  const urlParams = new URLSearchParams(window.location.search);
  const requestedView = urlParams.get('view');

  // If we have a requested view from URL, use it. Otherwise fallback to saved or default.
  let viewToLoad = defaultView;
  if (requestedView) {
    viewToLoad = requestedView;
  } else if (savedView && savedView !== 'auth-screen') {
    viewToLoad = savedView;
  }

  // Load the determined view
  await loadView(viewToLoad);

  // App is ready — signal the welcome screen to fade out.
  dismissWelcomeScreen();

  // Initialize the refresh button
  initRefreshButton();

  // Show a welcome toast if not already done today
  // ... (code below remains untouched)

  // Start sitewide due notifications monitor (tasks, reminders, deals)
  notificationStore.start();
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

  // Only show changelog to users who have already completed onboarding.
  // New users get the welcome tour first — changelog can wait until next login.
  if (hasCompletedTour) {
    checkAndShowChangelog();
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

  const fetchParallel = async (table, selectStr) => {
    let qCount = supabaseClient.from(table).select('*', { count: 'exact', head: true });
    if (orgId) qCount = qCount.eq('organization_id', orgId);
    
    const { count, error: countError } = await qCount;
    if (countError || count === null) return { data: [], error: countError };
    if (count === 0) return { data: [], error: null };

    const pageSize = 1000;
    const pages = Math.ceil(count / pageSize);
    const promises = [];

    for (let i = 0; i < pages; i++) {
      const from = i * pageSize;
      const to = from + pageSize - 1;
      let q = supabaseClient.from(table).select(selectStr).order('name', { ascending: true });
      if (orgId) q = q.eq('organization_id', orgId);
      promises.push(q.range(from, to));
    }

    const results = await Promise.all(promises);
    let allRecords = [];
    for (const res of results) {
      if (res.error) return { data: allRecords, error: res.error };
      if (res.data) allRecords = allRecords.concat(res.data);
    }
    return { data: allRecords, error: null };
  };

  const [peopleResult, companiesResult] = await Promise.all([
    fetchParallel('people', '*'),
    fetchParallel('companies', 'id, name')
  ]);

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
      let qCount = supabaseClient.from('companies').select('*', { count: 'exact', head: true });
      if (state.currentOrganization?.id) qCount = qCount.eq('organization_id', state.currentOrganization.id);
      
      const { count, error: countError } = await qCount;
      if (countError || count === null) return { companies: [], error: countError };
      if (count === 0) return { companies: [], error: null };

      const pageSize = 1000;
      const pages = Math.ceil(count / pageSize);
      const promises = [];

      for (let i = 0; i < pages; i++) {
        const from = i * pageSize;
        const to = from + pageSize - 1;
        let q = supabaseClient.from('companies').select('*, company_categories(categories(id, name))').order('name', { ascending: true });
        if (state.currentOrganization?.id) q = q.eq('organization_id', state.currentOrganization.id);
        promises.push(q.range(from, to));
      }

      const results = await Promise.all(promises);
      let allCompanies = [];
      for (const res of results) {
        if (res.error) return { companies: allCompanies, error: res.error };
        if (res.data) allCompanies = allCompanies.concat(res.data);
      }
      return { companies: allCompanies, error: null };
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
    // Ensure each company has a resolved logo_url in the in-memory cache.
    // We ONLY trust explicit DB values — we do NOT prefetch or manufacture favicon URLs here
    // because speculative favicon requests flood the console with 404s.
    const FAVICON_SERVICE_PATTERNS = ['s2/favicons', 'faviconV2', 't0.gstatic', 't1.gstatic', 't2.gstatic', 't3.gstatic'];
    window.allCompaniesData.forEach(c => {
      // If logo_url was written by old code as a favicon-service URL, clear it so the
      // render layer falls back to a ui-avatar (no broken-image noise).
      if (c.logo_url && FAVICON_SERVICE_PATTERNS.some(p => c.logo_url.includes(p))) {
        c.logo_url = null;
      }
    });
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

  // Update header avatar – show photo if available, otherwise initials
  const avatarEl = document.getElementById('user-avatar');
  if (avatarEl) {
    if (profile.avatar_url) {
      avatarEl.innerHTML = `<img src="${profile.avatar_url}" alt="" class="user-avatar-img">`;
    } else {
      avatarEl.textContent = initials;
    }
  }
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
    // Show dashboard at top of nav for managers
    const dashTopNav = document.getElementById('dashboard-top-nav');
    if (dashTopNav) dashTopNav.style.display = 'flex';
    // Show the new Technicians manager section
    const techManagerNav = document.getElementById('technicians-manager-nav-section');
    if (techManagerNav) techManagerNav.style.display = 'block';
    // Show log visit for managers in sidebar (removed the hiding logic)
    // Hide my-activity and my-routes for managers
    document.querySelectorAll('.sidebar-nav [data-view="my-activity"]').forEach(el => {
      el.style.display = 'none';
    });
    document.querySelectorAll('.sidebar-nav [data-view="my-routes"]').forEach(el => {
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
    // Hide technicians-manager section
    const techManagerNav = document.getElementById('technicians-manager-nav-section');
    if (techManagerNav) techManagerNav.style.display = 'none';
    // Hide sales rep navigation
    document.querySelectorAll('.sidebar-nav [data-view="log-visit"]').forEach(el => {
      el.style.display = 'none';
    });
    document.querySelectorAll('.sidebar-nav [data-view="my-activity"]').forEach(el => {
      el.style.display = 'none';
    });
    // Hide views that technicians should not access
    ['sales-funnel', 'opportunity-pipeline', 'call-logs', 'companies', 'people', 'workflows', 'reports'].forEach(view => {
      document.querySelectorAll(`.sidebar-nav [data-view="${view}"]`).forEach(el => el.style.display = 'none');
    });
    
    // Also hide entire sections
    const salesNav = document.getElementById('sales-nav-section');
    if (salesNav) salesNav.style.display = 'none';
    const intelNav = document.getElementById('intelligence-nav-section');
    if (intelNav) intelNav.style.display = 'none';

    document.querySelectorAll('.sidebar-nav [data-view="user-management"]').forEach(el => {
      el.style.display = 'flex';
    });
    // Hide manager navigation
    managerNavSection.style.display = 'none';
  } else {
    // Sales rep view
    managerNavSection.style.display = 'none';
    technicianNavSection.style.display = 'none';
    const techManagerNav = document.getElementById('technicians-manager-nav-section');
    if (techManagerNav) techManagerNav.style.display = 'none';
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


function initRefreshButton() {
  const btn = document.getElementById('refresh-data-btn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    // Visual feedback
    const svg = btn.querySelector('svg');
    if (svg) svg.style.animation = 'spin 1s linear infinite';
    btn.disabled = true;

    try {
      // Re-trigger the global load promises
      window.allPeoplePromise = loadAllPeople();
      window.allCompaniesPromise = loadAllCompanies();
      
      await Promise.all([window.allPeoplePromise, window.allCompaniesPromise]);

      // Clear opportunities data so pipeline view is forced to refresh
      window.opportunitiesData = null;

      // Reload the current view so the new data renders immediately
      if (typeof window.loadView === 'function' && window.state?.currentView) {
        await window.loadView(window.state.currentView);
      }

      if (typeof window.showToast === 'function') {
        window.showToast('Data refreshed successfully', 'success');
      }
    } catch (err) {
      if (typeof window.showToast === 'function') {
        window.showToast('Failed to refresh data', 'error');
      }
    } finally {
      if (svg) svg.style.animation = '';
      btn.disabled = false;
    }
  });
}

// ── Exports ────────────────────────────────────────────────────
export {
  initApp,
  loadAllPeople,
  loadAllCompanies,
  updateUserDisplay,
  updateNavigationForRole,
};
