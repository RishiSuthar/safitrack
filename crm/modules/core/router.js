// modules/core/router.js
// History API router for the CRM SPA. Keeps feature rendering delegated to loadView.

import { state } from '../state.js';
import { loadView } from './navigation.js';

const CRM_BASE_PATH = '/crm';
const AUTH_SEGMENT_TO_PANE = {
  login: 'login',
  signup: 'signup',
  verify: 'verify',
  'verify-email': 'verify',
};

const ROUTE_ALIAS_TO_VIEW = {
  // Sales rep / shared
  'log-visit': 'log-visit',
  log: 'log-visit',
  'my-activity': 'my-activity',
  activity: 'my-activity',
  'my-routes': 'my-routes',
  routes: 'my-routes',
  reminders: 'reminders',
  notes: 'notes',
  'sales-funnel': 'sales-funnel',
  funnel: 'sales-funnel',
  'opportunity-pipeline': 'opportunity-pipeline',
  opportunities: 'opportunity-pipeline',
  'call-logs': 'call-logs',
  calls: 'call-logs',
  workflows: 'workflows',
  reports: 'reports',
  settings: 'settings',
  companies: 'companies',
  people: 'people',
  contacts: 'people',
  tasks: 'tasks',
  deals: 'opportunity-pipeline',
  calendar: 'reminders',

  // Manager / admin
  'main-dashboard': 'main-dashboard',
  dashboard: 'main-dashboard',
  'team-dashboard': 'team-dashboard',
  visits: 'team-dashboard',
  'route-planning': 'route-planning',
  'route-plan': 'route-planning',
  submissions: 'submissions',
  contracts: 'contracts',
  forms: 'forms',
  manuals: 'manuals',
  'user-management': 'user-management',
  users: 'user-management',

  // Technician
  'technician-log-visit': 'technician-log-visit',
  'service-log': 'technician-log-visit',
  'technician-activity': 'technician-activity',
  'service-visits': 'technician-activity',
};

const FRIENDLY_ROUTE_TO_PAGE = {
  dashboard: () => import('../pages/dashboard.js').then((m) => m.renderDashboardPage()),
  visits: () => import('../pages/visits.js').then((m) => m.renderVisitsPage()),
  contacts: () => import('../pages/contacts.js').then((m) => m.renderContactsPage()),
  companies: () => import('../pages/companies.js').then((m) => m.renderCompaniesPage()),
  deals: () => import('../pages/deals.js').then((m) => m.renderDealsPage()),
  tasks: () => import('../pages/tasks.js').then((m) => m.renderTasksPage()),
  calendar: () => import('../pages/calendar.js').then((m) => m.renderCalendarPage()),
  reports: () => import('../pages/reports.js').then((m) => m.renderReportsPage()),
  settings: () => import('../pages/settings.js').then((m) => m.renderSettingsPage()),
};

const VIEW_TO_PATH = {
  people: '/contacts',
  companies: '/companies',
  'opportunity-pipeline': '/deals',
  tasks: '/tasks',
  reminders: '/calendar',
  reports: '/reports',
  settings: '/settings',
  'main-dashboard': '/dashboard',
  'team-dashboard': '/visits',
  'my-activity': '/visits',
  'technician-activity': '/visits',
};

let routerInitialized = false;

function restorePathFromFallbackQuery() {
  const params = new URLSearchParams(window.location.search);
  const routedPath = params.get('__route');
  if (!routedPath || !routedPath.startsWith(`${CRM_BASE_PATH}/`)) return;
  window.history.replaceState({}, '', routedPath);
}

function normalizePath(pathname) {
  if (!pathname) return `${CRM_BASE_PATH}/`;
  return pathname.replace(/\/+$/, '') || '/';
}

function getPathnameFromTarget(target) {
  if (!target) return `${CRM_BASE_PATH}/`;
  if (target.startsWith('/')) return target;
  return `${CRM_BASE_PATH}/${target}`;
}

function getRouteSegment(pathname = window.location.pathname) {
  const normalized = normalizePath(pathname);

  if (normalized === `${CRM_BASE_PATH}` || normalized === `${CRM_BASE_PATH}/index.html`) {
    return '';
  }

  if (normalized.startsWith(`${CRM_BASE_PATH}/`)) {
    return normalized.slice(`${CRM_BASE_PATH}/`.length);
  }

  return '';
}

function getPathForView(viewName) {
  const mapped = VIEW_TO_PATH[viewName] || `/${viewName}`;
  return `${CRM_BASE_PATH}${mapped}`;
}

function getAuthPaneFromPath(pathname = window.location.pathname) {
  const segment = getRouteSegment(pathname);
  return AUTH_SEGMENT_TO_PANE[segment] || null;
}

function getPathForAuthPane(pane) {
  const segment = pane === 'signup' ? 'signup' : pane === 'verify' ? 'verify-email' : 'login';
  return `${CRM_BASE_PATH}/${segment}`;
}

function getCanonicalPathForAliasSegment(segment) {
  const aliasedView = ROUTE_ALIAS_TO_VIEW[segment];
  if (!aliasedView) return null;
  return getPathForView(aliasedView);
}

function syncFromAuthPane(pane, { replace = false } = {}) {
  const nextPath = getPathForAuthPane(pane);
  setHistoryPath(nextPath, { replace });
}

function applyAuthPaneFromPath() {
  const pane = getAuthPaneFromPath(window.location.pathname);
  if (!pane) return false;

  const canonicalAuthPath = getPathForAuthPane(pane);
  setHistoryPath(canonicalAuthPath, { replace: true });

  if (typeof window.switchAuthPane === 'function') {
    window.switchAuthPane(pane, { skipRouteSync: true });
  }

  return true;
}

async function renderCurrentPath() {
  const segment = getRouteSegment(window.location.pathname);

  if (!segment) {
    return false;
  }

  if (AUTH_SEGMENT_TO_PANE[segment]) {
    return false;
  }

  const pageRenderer = FRIENDLY_ROUTE_TO_PAGE[segment];
  if (pageRenderer) {
    await pageRenderer();
    return true;
  }

  const aliasedView = ROUTE_ALIAS_TO_VIEW[segment];
  if (aliasedView) {
    await loadView(aliasedView, { skipRouteSync: true });
    const canonicalPath = getCanonicalPathForAliasSegment(segment);
    if (canonicalPath) {
      setHistoryPath(canonicalPath, { replace: true });
    }
    return true;
  }

  await loadView(segment, { skipRouteSync: true });
  return true;
}

function setHistoryPath(pathname, { replace = false } = {}) {
  const targetPath = normalizePath(pathname);
  const currentPath = normalizePath(window.location.pathname);
  if (targetPath === currentPath) return;

  if (replace) {
    window.history.replaceState({}, '', targetPath);
  } else {
    window.history.pushState({}, '', targetPath);
  }
}

async function navigate(target, { replace = false } = {}) {
  const nextPath = normalizePath(getPathnameFromTarget(target));
  setHistoryPath(nextPath, { replace });
  return renderCurrentPath();
}

async function navigateView(viewName, { replace = false } = {}) {
  return navigate(getPathForView(viewName), { replace });
}

function syncFromView(viewName, { replace = false } = {}) {
  if (!state.appInitialized) return;
  const nextPath = getPathForView(viewName);
  setHistoryPath(nextPath, { replace });
}

function hasExplicitPathRoute(pathname = window.location.pathname) {
  const segment = getRouteSegment(pathname);
  return segment.length > 0;
}

async function loadRouteFromPathOrFallback(fallbackView) {
  const handled = await renderCurrentPath();
  if (handled) return true;

  if (fallbackView) {
    await navigateView(fallbackView, { replace: true });
    return true;
  }

  return false;
}

function initRouter() {
  if (routerInitialized) return;
  routerInitialized = true;

  restorePathFromFallbackQuery();

  window.addEventListener('popstate', async () => {
    if (state.appInitialized) {
      await renderCurrentPath();
      return;
    }
    applyAuthPaneFromPath();
  });
}

const router = {
  initRouter,
  navigate,
  navigateView,
  syncFromView,
  hasExplicitPathRoute,
  loadRouteFromPathOrFallback,
  getPathForView,
  getAuthPaneFromPath,
  getPathForAuthPane,
  syncFromAuthPane,
  applyAuthPaneFromPath,
};

export {
  router,
  initRouter,
  navigate,
  navigateView,
  syncFromView,
  hasExplicitPathRoute,
  loadRouteFromPathOrFallback,
  getPathForView,
  getAuthPaneFromPath,
  getPathForAuthPane,
  syncFromAuthPane,
  applyAuthPaneFromPath,
};
