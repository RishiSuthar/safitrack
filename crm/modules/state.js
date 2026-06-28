// modules/state.js
// Shared mutable application state and Supabase client.
// Import `state` and `supabaseClient` from this module in every feature module.

const SUPABASE_URL = (window.APP_CONFIG || {}).SUPABASE_URL || '';
const SUPABASE_KEY = (window.APP_CONFIG || {}).SUPABASE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[SafiTrack] Missing Supabase config. Did you create crm/config.js from crm/config.example.js?');
}

export const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Per-view State Persistence (localStorage) ────────────────────────────────
const _VIEW_STATE_LS_KEY = 'safitrack_view_state_v1';
function _loadPersistedState() {
  try { return JSON.parse(localStorage.getItem(_VIEW_STATE_LS_KEY) || '{}'); } catch { return {}; }
}

export function saveViewState(updates) {
  try {
    const s = _loadPersistedState();
    localStorage.setItem(_VIEW_STATE_LS_KEY, JSON.stringify(Object.assign(s, updates)));
  } catch { }
}

export function clearViewState() {
  try { localStorage.removeItem(_VIEW_STATE_LS_KEY); } catch { }
}

const _persisted = _loadPersistedState();

// ── Debug helpers ────────────────────────────────────────────────────────────
export function isCrmDebugEnabled() {
  try { return localStorage.getItem('safitrack_debug') === '1'; } catch { return false; }
}

export function crmDebugLog(label, payload) {
  if (!isCrmDebugEnabled()) return;
  console.warn(`[${new Date().toISOString()}] ${label}`, payload ?? '');
}

// ── Centralized mutable state ─────────────────────────────────────────────────
// All modules read/write shared state through this single object.
// Using a plain object ensures ES-module live bindings are not needed for
// reassignable values – any module can do `state.currentUser = user`.
export const state = {
  // Auth
  currentUser: null,
  currentUserProfile: null,
  currentOrganization: null,
  orgCurrency: 'USD',
  isManager: false,
  isSalesRep: false,
  isTechnician: false,
  isOrgOwner: false,
  authBootstrapHandled: false,
  appInitialized: false,

  // Navigation
  currentView: 'log-visit',
  previousView: null,
  _pendingSettingsSection: null,

  // People / companies
  allPeople: [],
  mentionedPeople: [],
  opportunityAssignees: [],
  companyCategories: [],
  personPhoneNumbers: [],
  visitTags: [],

  // Shared UI
  chartInstances: {},
  selectedRepId: null,
  managerCallLogViewMode: 'my',
  lastToastMeta: { key: '', at: 0 },

  // Batch selection
  selectedRecordIds: new Set(),

  // Due notifications
  dueNotificationsPollId: null,
  duePopupHideTimers: [],
  dueNotificationState: { items: [], unreadCount: 0 },

  // Safi Nudge real-time
  safiNudgeChannel: null,
  safiNudgeSubscribed: false,
  safiNudgeQueue: [],
  safiNudgeShowing: false,
  safiNudgeTimers: [],
  safiNudgeLastStatus: 'idle',
  safiNudgeReconnectTimer: null,
  safiNudgeReconnectAttempt: 0,
  safiNudgeStarting: false,

  // Spreadsheet / table
  currentSortKey: 'name',
  currentSortDir: 'asc',
  currentFilters: {
    company_type: (_persisted.companies && _persisted.companies.companyType) || '',
    person_company: (_persisted.people && _persisted.people.companyId) || '',
  },
  tableViewState: {
    companies: {
      searchQuery: (_persisted.companies && _persisted.companies.searchQuery) || '',
      currentPage: (_persisted.companies && _persisted.companies.currentPage) || 1,
      companyType: (_persisted.companies && _persisted.companies.companyType) || '',
      sortKey: (_persisted.companies && _persisted.companies.sortKey) || 'name',
      sortDir: (_persisted.companies && _persisted.companies.sortDir) || 'asc',
    },
    people: {
      searchQuery: (_persisted.people && _persisted.people.searchQuery) || '',
      currentPage: (_persisted.people && _persisted.people.currentPage) || 1,
      companyId: (_persisted.people && _persisted.people.companyId) || '',
      sortKey: (_persisted.people && _persisted.people.sortKey) || 'name',
      sortDir: (_persisted.people && _persisted.people.sortDir) || 'asc',
    },
  },
  callLogFilters: Object.assign(
    { search: '', direction: '', outcome: '', dateFrom: '', dateTo: '' },
    _persisted.callLogs || {}
  ),
  filterDebounceTimer: null,

  // PWA install prompt
  deferredPrompt: null,
};

// Constants
export const SAFI_NUDGE_EVENT = 'safi-nudge';
export const SAFI_NUDGE_CHANNEL = 'safitrack-team-nudges';
export const SAFI_NUDGE_BOT_GIF = 'https://assets-v2.lottiefiles.com/a/b942abb8-d62e-11ee-a179-af4105107ebe/tPZDd31PcO.gif';
export const DUE_NOTIFIED_STORAGE_KEY = 'safitrack_due_notified_v1';
export const DUE_READ_STORAGE_KEY = 'safitrack_due_read_v1';

export const APP_BOOT_STARTED_AT = performance.now();
export const FAST_BOOT_SKIP_MS = 500;
export const LOADER_FADE_MS = 180;

export { _persisted as persistedState, _loadPersistedState as loadPersistedState };
