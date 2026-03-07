// Keys are loaded from crm/config.js (gitignored).
// Copy crm/config.example.js → crm/config.js and fill in your values.
const SUPABASE_URL = (window.APP_CONFIG || {}).SUPABASE_URL || '';
const SUPABASE_KEY = (window.APP_CONFIG || {}).SUPABASE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[SafiTrack] Missing Supabase config. Did you create crm/config.js from crm/config.example.js?');
}

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = null;
let isManager = false;
let isSalesRep = false; // sales reps have restricted permissions for companies
let currentView = 'log-visit';
let visitTags = [];
let chartInstances = {};
let selectedRepId = null;
let companyCategories = [];
let personPhoneNumbers = [];
let mentionedPeople = [];
let allPeople = [];
let isTechnician = false;
let managerCallLogViewMode = 'my'; // 'my' or 'team'
let lastToastMeta = { key: '', at: 0 };
let dueNotificationsPollId = null;
let duePopupHideTimers = [];
let currentUserProfile = null;
let currentOrganization = null;   // The tenant/org this user belongs to
let safiNudgeChannel = null;
let safiNudgeSubscribed = false;
let safiNudgeQueue = [];
let safiNudgeShowing = false;
let safiNudgeTimers = [];
let safiNudgeLastStatus = 'idle';
let safiNudgeReconnectTimer = null;
let safiNudgeReconnectAttempt = 0;
let safiNudgeStarting = false;
let _pendingSettingsSection = null;

const SAFI_NUDGE_EVENT = 'safi-nudge';
const SAFI_NUDGE_CHANNEL = 'safitrack-team-nudges';
const SAFI_NUDGE_BOT_GIF = 'https://assets-v2.lottiefiles.com/a/b942abb8-d62e-11ee-a179-af4105107ebe/tPZDd31PcO.gif';

const DUE_NOTIFIED_STORAGE_KEY = 'safitrack_due_notified_v1';
const DUE_READ_STORAGE_KEY = 'safitrack_due_read_v1';

let dueNotificationState = {
  items: [],
  unreadCount: 0
};

function isCrmDebugEnabled() {
  try {
    return localStorage.getItem('safitrack_debug') === '1';
  } catch (e) {
    return false;
  }
}

function crmDebugLog(label, payload) {
  if (!isCrmDebugEnabled()) return;
  const timestamp = new Date().toISOString();
  console.warn(`[${timestamp}] ${label}`, payload ?? '');
}

// ── Per-view State Persistence (localStorage) ──────────────────────
const _VIEW_STATE_LS_KEY = 'safitrack_view_state_v1';
function _loadPersistedState() {
  try { return JSON.parse(localStorage.getItem(_VIEW_STATE_LS_KEY) || '{}'); } catch { return {}; }
}
function saveViewState(updates) {
  try {
    const s = _loadPersistedState();
    localStorage.setItem(_VIEW_STATE_LS_KEY, JSON.stringify(Object.assign(s, updates)));
  } catch { }
}
function clearViewState() {
  try { localStorage.removeItem(_VIEW_STATE_LS_KEY); } catch { }
}
// Snapshot loaded once at JS parse time so render functions can read it synchronously
const _persisted = _loadPersistedState();

// Call log filters – seeded from localStorage
let callLogFilters = Object.assign(
  { search: '', direction: '', outcome: '' },
  _persisted.callLogs || {}
);
let filterDebounceTimer = null;

// Spreadsheet State
let currentSortKey = 'name';
let currentSortDir = 'asc';
let currentFilters = {
  company_type: (_persisted.companies && _persisted.companies.companyType) || '',
  person_company: (_persisted.people && _persisted.people.companyId) || ''
};

const tableViewState = {
  companies: {
    searchQuery: (_persisted.companies && _persisted.companies.searchQuery) || '',
    currentPage: (_persisted.companies && _persisted.companies.currentPage) || 1,
    companyType: (_persisted.companies && _persisted.companies.companyType) || '',
    sortKey: (_persisted.companies && _persisted.companies.sortKey) || 'name',
    sortDir: (_persisted.companies && _persisted.companies.sortDir) || 'asc'
  },
  people: {
    searchQuery: (_persisted.people && _persisted.people.searchQuery) || '',
    currentPage: (_persisted.people && _persisted.people.currentPage) || 1,
    companyId: (_persisted.people && _persisted.people.companyId) || '',
    sortKey: (_persisted.people && _persisted.people.sortKey) || 'name',
    sortDir: (_persisted.people && _persisted.people.sortDir) || 'asc'
  }
};

// ======================
// DOM ELEMENTS
// ======================

const loadingScreen = document.getElementById('loading-screen');
const authScreen = document.getElementById('auth-screen');
const mainApp = document.getElementById('main-app');
const viewContainer = document.getElementById('view-container');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
const sidebarClose = document.getElementById('sidebar-close');
const userMenu = document.getElementById('user-menu');
const userAvatarBtn = document.getElementById('user-avatar-btn');
const pageLabel = document.getElementById('page-label');
const pageLabelIcon = document.getElementById('page-label-icon');
const pageLabelText = document.getElementById('page-label-text');
// const themeToggle = document.getElementById('theme-toggle');
const commandPaletteBtn = document.getElementById('command-palette-btn');
const commandPalette = document.getElementById('command-palette');
const logoutBtn = document.getElementById('logout-btn');
const notificationsMenu = document.getElementById('notifications-menu');
const notificationsBtn = document.getElementById('notifications-btn');
const notificationsCount = document.getElementById('notifications-count');
const notificationsList = document.getElementById('notifications-list');
const notificationsEnableBtn = document.getElementById('enable-notifications-btn');
const safiNudgeLauncher = document.getElementById('safi-nudge-launcher');

const APP_BOOT_STARTED_AT = performance.now();
const FAST_BOOT_SKIP_MS = 500;
const LOADER_FADE_MS = 180;
let authBootstrapHandled = false;

// Company description AI UI elements (queried after DOM ready inside initEventListeners)

// ======================
// SPREADSHEET ENGINE
// ======================

/**
 * Universal Editable Data Table
 * @param {Array} data - Paginated data array
 * @param {Array} columns - Column definitions
 * @param {string} tableId - Unique ID for the table
 * @param {string} supabaseTable - Supabase table name for updates
 */
function renderEditableDataTable(data, columns, tableId, supabaseTable) {
  const isMobileView = window.matchMedia('(max-width: 767px)').matches;
  const defaultColumnWidth = isMobileView ? '120px' : '160px';

  let html = `
    <div class="spreadsheet-container">
      <table class="spreadsheet-table" id="${tableId}">
        <thead>
      <tr>
        ${columns.map(col => {
    const columnWidth = col.width || defaultColumnWidth;
    const isSortable = col.sortable !== false;
    const sortIcon = isSortable
      ? `<i data-lucide="${currentSortKey === col.key ? (currentSortDir === 'asc' ? 'chevron-up' : 'chevron-down') : 'chevrons-up-down'}" 
                 style="width: 12px; height: 12px; opacity: ${currentSortKey === col.key ? 1 : 0.3};"></i>`
      : '';
    return `
          <th style="width: ${columnWidth}; min-width: ${columnWidth}; max-width: ${columnWidth}; position: relative; cursor: ${isSortable ? 'pointer' : 'default'};" 
              ${isSortable ? `onclick="handleHeaderSort('${col.key}', true)"` : ''}
              class="sortable-header ${isSortable && currentSortKey === col.key ? 'active-sort' : ''}">
            <div style="display: flex; align-items: center; gap: 8px;">
              ${col.icon ? `<i data-lucide="${col.icon}" style="width: 14px; height: 14px; opacity: 0.6;"></i>` : ''}
              <span style="flex: 1; overflow: hidden; text-overflow: ellipsis;">${col.label}</span>
              ${sortIcon}
            </div>
            ${isMobileView ? '' : '<div class="resize-handle" onmousedown="initResize(event, this)"></div>'}
          </th>
        `;
  }).join('')}
      </tr>
    </thead>
        <tbody>
  `;

  if (data.length === 0) {
    html += `<tr><td colspan="${columns.length}" style="text-align: center; padding: 40px; color: var(--text-muted);">No records found</td></tr>`;
  } else {
    data.forEach((row, rowIndex) => {
      html += `<tr data-row-id="${row.id}">`;
      columns.forEach(col => {
        const rawValue = getDeepValue(row, col.key); // Get the raw value for data-value
        const displayValue = col.render ? col.render(rawValue, row) : (rawValue || '-');
        const isReadOnly = col.readOnly ? 'true' : 'false';
        const type = col.type || 'text';
        const options = JSON.stringify(col.options || []);
        const columnWidth = col.width || defaultColumnWidth;

        html += `<td class="spreadsheet-cell-wrapper" style="width: ${columnWidth}; min-width: ${columnWidth}; max-width: ${columnWidth};">
          <div class="spreadsheet-cell"
               data-row-id="${row.id}"
               data-column="${col.key}"
               data-read-only="${isReadOnly}"
               data-type="${type}"
               data-options='${options}'
               data-value="${rawValue !== undefined && rawValue !== null ? rawValue : ''}"
               onclick="if(this.dataset.readOnly !== 'true') makeCellEditable(this, '${row.id}', '${supabaseTable}')">
            ${displayValue}
          </div>
        </td>`;
      });
      html += `</tr>`;
    });
  }

  html += `
        </tbody>
      </table>
    </div>
  `;

  return html;
}

function getDeepValue(obj, path) {
  return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}

// Return a Google S2 favicon URL for a domain (sanitizes input)
function getCompanyLogoUrl(domain) {
  if (!domain) return '';
  try {
    let d = String(domain || '').trim().toLowerCase();
    d = d.replace(/^https?:\/\//, '');
    d = d.replace(/^www\./, '');
    d = d.split('/')[0];
    // Use Google's S2 favicon service; request a slightly larger size
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=64`;
  } catch (e) {
    return '';
  }
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// More robust company name normalizer for matching (removes diacritics and punctuation)
function normalizeForMatching(value) {
  if (!value) return '';
  // Remove diacritics, convert to lower, replace non-alphanum with space, collapse spaces
  try {
    value = String(value).normalize('NFD').replace(/\p{Diacritic}/gu, '');
  } catch (e) {
    // older engines may not support unicode property escapes
    value = String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function findCompanyForOpportunity(opp) {
  if (!Array.isArray(window.allCompaniesData)) return null;

  // Try id match first
  if (opp.company_id) {
    const byId = window.allCompaniesData.find(c => String(c.id) === String(opp.company_id));
    if (byId) return byId;
  }

  const oppName = opp.company_name || '';
  const normOpp = normalizeForMatching(oppName);
  if (!normOpp) return null;

  // Exact normalized match
  let found = window.allCompaniesData.find(c => normalizeForMatching(c.name) === normOpp);
  if (found) return found;

  // token subset check: every word the user supplied appears in candidate name.
  // also handle fused tokens like "nextgen" matching "next gen" or "next-gen".
  const oppTokens = new Set(normOpp.split(/\s+/).filter(Boolean));
  if (oppTokens.size > 0) {
    found = window.allCompaniesData.find(c => {
      const n = normalizeForMatching(c.name);
      if (!n) return false;
      const tokens = n.split(/\s+/).filter(Boolean);
      // helper to test one user token against candidate tokens
      const tokenMatches = (userTok) => {
        if (tokens.includes(userTok)) return true;
        // check if userTok equals concatenation of all tokens
        const joined = tokens.join('');
        if (userTok === joined) return true;
        // also check if userTok contains the joined string (e.g. extra chars?)
        if (joined && userTok.includes(joined)) return true;
        // try splitting userTok into parts roughly equal to candidate tokens;
        // e.g. userTok="nextgen" and tokens=['next','gen']
        if (tokens.length > 1) {
          const recombined = tokens.join('');
          if (userTok === recombined) return true;
        }
        return false;
      };
      return [...oppTokens].every(t => tokenMatches(t));
    });
    if (found) return found;
  }

  // Inclusion match (company name contained in opportunity name or vice versa)
  found = window.allCompaniesData.find(c => {
    const n = normalizeForMatching(c.name);
    return n && (normOpp.includes(n) || n.includes(normOpp));
  });
  if (found) return found;

  // Token overlap fuzzy match: require at least half tokens overlap
  let best = null;
  let bestScore = 0;
  window.allCompaniesData.forEach(c => {
    const n = normalizeForMatching(c.name);
    if (!n) return;
    const tokens = n.split(/\s+/).filter(Boolean);
    let common = 0;
    tokens.forEach(t => { if (oppTokens.has(t)) common++; });
    const score = tokens.length > 0 ? (common / tokens.length) : 0;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  });
  if (bestScore >= 0.5) return best;

  return null;
}

function slugifyForDomain(name) {
  if (!name) return '';
  // Remove punctuation, diacritics, parentheses content, and common separators
  const cleaned = String(name)
    .replace(/\(.*?\)/g, ' ')
    .replace(/[’'“”"\u2013\u2014–—]/g, ' ')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
  // Use first two meaningful words to form a slug
  const parts = cleaned.split(' ').filter(Boolean).slice(0, 2);
  return parts.join('');
}

function getGoogleFaviconUrl(domain) {
  if (!domain) return '';
  // Use the Google favicon proxy used by Chrome/Google services
  // Example: https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://carrefour.com&size=64
  return `https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://${encodeURIComponent(domain)}&size=64`;
}

function guessDomainAndFavicon(name) {
  const slug = slugifyForDomain(name);
  if (!slug) return '';
  const candidates = [
    `${slug}.com`,
    `${slug}.co.ke`,
    `${slug}.org`,
    `${slug}.net`
  ];
  // Return first candidate's Google favicon URL (browser will attempt to load it)
  return getGoogleFaviconUrl(candidates[0]);
}

function matchesTokenizedQuery(query, ...fields) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;

  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;

  const haystack = normalizeSearchText(fields.filter(Boolean).join(' '));
  if (!haystack) return false;

  return tokens.every(token => haystack.includes(token));
}

function normalizeEmailValue(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePhoneValue(value) {
  return String(value || '').replace(/\D+/g, '');
}

function findDuplicateCompanyByName(name, excludeCompanyId = null) {
  const normalizedName = normalizeSearchText(name);
  if (!normalizedName) return null;

  const companies = Array.isArray(window.allCompaniesData) ? window.allCompaniesData : [];
  return companies.find((item) => {
    if (!item) return false;
    if (excludeCompanyId && String(item.id) === String(excludeCompanyId)) return false;
    return normalizeSearchText(item.name) === normalizedName;
  }) || null;
}

function findDuplicatePersonContact({ name, email, phoneNumbers, companyId, excludePersonId = null }) {
  const normalizedName = normalizeSearchText(name);
  const normalizedEmail = normalizeEmailValue(email);
  const normalizedPhones = (phoneNumbers || [])
    .map(normalizePhoneValue)
    .filter((phone) => phone.length >= 7);

  if (!normalizedName || !companyId) return null;
  if (!normalizedEmail && normalizedPhones.length === 0) return null;

  const people = Array.isArray(window.allPeopleData) ? window.allPeopleData : [];
  return people.find((item) => {
    if (!item) return false;
    if (excludePersonId && String(item.id) === String(excludePersonId)) return false;
    if (String(item.company_id || '') !== String(companyId)) return false;
    if (normalizeSearchText(item.name) !== normalizedName) return false;

    const emailMatches = normalizedEmail && normalizeEmailValue(item.email) === normalizedEmail;
    const existingPhones = (Array.isArray(item.phone_numbers) ? item.phone_numbers : [])
      .map(normalizePhoneValue)
      .filter((phone) => phone.length >= 7);
    const phoneMatches = normalizedPhones.length > 0 && normalizedPhones.some((phone) => existingPhones.includes(phone));

    return Boolean(emailMatches || phoneMatches);
  }) || null;
}

function makeCellEditable(cell, rowId, tableName) {
  if (cell.classList.contains('editing')) return;

  const column = cell.dataset.column;
  const type = cell.dataset.type;
  const options = JSON.parse(cell.dataset.options || '[]');
  const initialValue = cell.dataset.value || ''; // Use data-value for initial value
  const cellWrapper = cell.closest('.spreadsheet-cell-wrapper');

  cell.classList.add('editing');
  cellWrapper?.classList.add('editing-cell');

  let input;
  if (type === 'select') {
    input = document.createElement('select');
    options.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt;
      option.text = opt;
      if (opt === initialValue) option.selected = true;
      input.appendChild(option);
    });
  } else {
    input = document.createElement('input');
    input.type = type || 'text';
    input.value = initialValue;
    input.classList.add('spreadsheet-inline-editor');
  }

  cell.innerHTML = '';
  cell.appendChild(input);
  input.focus();

  // Select all text if it's an input
  if (input.select) input.select();

  const save = async () => {
    const newValue = input.value;
    if (newValue !== initialValue) { // Compare with initialValue
      cell.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      const success = await handleCellUpdate(tableName, rowId, column, newValue); // Use 'column'
      if (success) {
        // Re-render the cell content based on column definition
        // We'll use a simplified version for now or find the col def
        cell.dataset.value = newValue;

        // Find column definition to see if we need special render (like avatars)
        let colDef;
        if (tableName === 'companies') {
          // We might need to pass col defs or find them
        }

        // For now, let's just refresh the view or re-render row content
        // A simple fix for avatars: if it's 'name' and we see an avatar, re-gen it
        if (column === 'name' && cell.querySelector('.mention-avatar')) {
          cell.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
              <div class="mention-avatar" style="width: 24px; height: 24px; font-size: 0.75rem;">${getInitials(newValue)}</div>
              <span>${newValue}</span>
            </div>
          `;
        } else {
          cell.innerText = newValue || '-';
        }
        showInlineSuccess(cellWrapper || cell);
      } else {
        cell.innerText = initialValue || '-';
        cell.dataset.value = initialValue; // Revert data-value
      }
    } else {
      cell.innerText = initialValue || '-';
    }
    cell.classList.remove('editing');
    cellWrapper?.classList.remove('editing-cell');
  };

  input.onblur = save;
  input.onkeydown = (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') {
      cell.innerText = initialValue || '-';
      cell.dataset.value = initialValue; // Revert data-value
      cell.classList.remove('editing');
      cellWrapper?.classList.remove('editing-cell');
    }
  };
}

// Column Resizing Logic
let currentResizer;
let currentTh;
let startX;
let startWidth;

function initResize(e, resizer) {
  currentResizer = resizer;
  currentTh = resizer.parentElement;
  startX = e.pageX;
  startWidth = currentTh.offsetWidth;

  currentResizer.classList.add('resizing');
  document.addEventListener('mousemove', handleResizeMove);
  document.addEventListener('mouseup', stopResize);

  // Prevent text selection during resize
  document.body.style.userSelect = 'none';
  document.body.style.cursor = 'col-resize';
}

function handleResizeMove(e) {
  if (!currentTh) return;
  const diff = e.pageX - startX;
  const newWidth = Math.max(50, startWidth + diff);
  currentTh.style.width = newWidth + 'px';
  currentTh.style.minWidth = newWidth + 'px';
  currentTh.style.maxWidth = newWidth + 'px';

  const table = currentTh.closest('table');
  if (!table) return;

  const columnIndex = currentTh.cellIndex + 1;
  table.querySelectorAll(`tbody tr td:nth-child(${columnIndex})`).forEach(td => {
    td.style.width = newWidth + 'px';
    td.style.minWidth = newWidth + 'px';
    td.style.maxWidth = newWidth + 'px';
  });
}

// Generate company description using AI helper
async function handleGenerateCompanyDescription() {
  const companyNameInput = document.getElementById('company-name-input');
  const companyDescriptionTextarea = document.getElementById('company-description');
  const generateCompanyDescBtn = document.getElementById('generate-company-desc-btn');
  const generateCompanyDescSpinner = document.getElementById('generate-company-desc-spinner');

  if (!generateCompanyDescBtn) return;
  const name = (companyNameInput && companyNameInput.value) ? companyNameInput.value.trim() : '';
  if (!name) {
    showToast('Please enter a company name first', 'error');
    return;
  }

  try {
    generateCompanyDescBtn.disabled = true;
    if (generateCompanyDescSpinner) generateCompanyDescSpinner.style.display = 'inline-block';

    const desc = await generateCompanyDescription(name);
    if (desc && desc.trim()) {
      if (companyDescriptionTextarea) companyDescriptionTextarea.value = desc.trim();
      showToast('Generated description added', 'success');
    } else {
      showToast('No description returned from AI', 'error');
    }
  } catch (err) {
    console.error('AI generate error', err);
    showToast('Failed to generate description', 'error');
  } finally {
    generateCompanyDescBtn.disabled = false;
    if (generateCompanyDescSpinner) generateCompanyDescSpinner.style.display = 'none';
  }
}

function stopResize() {
  if (currentResizer) currentResizer.classList.remove('resizing');
  document.removeEventListener('mousemove', handleResizeMove);
  document.removeEventListener('mouseup', stopResize);
  document.body.style.userSelect = '';
  document.body.style.cursor = '';
  currentResizer = null;
  currentTh = null;
}

async function handleCellUpdate(tableName, rowId, key, value) {
  const column = key.includes('.') ? key.split('.')[0] : key;

  // Phone numbers bug fix: if column is phone_numbers and value is a string, check if it should be an array
  let finalValue = value;
  if (column === 'phone_numbers' && typeof value === 'string') {
    finalValue = value.split(',').map(p => p.trim()).filter(p => p !== '');
  }

  const { error } = await supabaseClient
    .from(tableName)
    .update({ [column]: finalValue })
    .eq('id', rowId);

  if (error) {
    console.error('Update error:', error);
    showToast('Failed to update: ' + error.message, 'error');
    return false;
  }

  // Update local window data
  if (tableName === 'companies') {
    const item = window.allCompaniesData.find(c => c.id === rowId);
    if (item) item[column] = finalValue;
  } else if (tableName === 'people') {
    const item = window.allPeopleData.find(p => p.id === rowId);
    if (item) item[column] = finalValue;
  }

  return true;
}

// Full Sort & Filter Logic
function sortData(data, key, direction = 'asc') {
  return [...data].sort((a, b) => {
    let valA = getDeepValue(a, key);
    let valB = getDeepValue(b, key);

    if (valA == null) valA = '';
    if (valB == null) valB = '';

    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();

    if (valA < valB) return direction === 'asc' ? -1 : 1;
    if (valA > valB) return direction === 'asc' ? 1 : -1;
    return 0;
  });
}

function handleHeaderSort(key, isSortable = true) {
  if (!isSortable) return;

  if (currentSortKey === key) {
    currentSortDir = currentSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    currentSortKey = key;
    currentSortDir = 'asc';
  }

  // Persist sort intent to the active view's state
  if (currentView === 'companies') {
    tableViewState.companies.sortKey = currentSortKey;
    tableViewState.companies.sortDir = currentSortDir;
    saveViewState({ companies: tableViewState.companies });
  } else if (currentView === 'people') {
    tableViewState.people.sortKey = currentSortKey;
    tableViewState.people.sortDir = currentSortDir;
    saveViewState({ people: tableViewState.people });
  }

  refreshCurrentView();
}

function refreshCurrentView() {
  const activeNavItem = document.querySelector('.nav-item.active');
  const view = activeNavItem ? activeNavItem.dataset.view : '';

  if (view === 'companies') {
    renderCompaniesView();
  } else if (view === 'people') {
    renderPeopleView();
  }
}

// ======================
// INITIALIZATION
// ======================

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initAuth();
  initEventListeners();
  initPWA();
});

function initTheme() {
  const savedTheme = localStorage.getItem('safitrack_theme') || localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
}

function initAuth() {
  const finishBootstrap = (session) => {
    if (authBootstrapHandled) return;
    authBootstrapHandled = true;

    const elapsed = performance.now() - APP_BOOT_STARTED_AT;
    const skipFade = elapsed <= FAST_BOOT_SKIP_MS;

    const continueInit = () => {
      if (session) {
        currentUser = session.user;
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
      currentUser = session.user;
      loadingScreen.style.display = 'none';
      initApp();
    } else if (event === 'SIGNED_OUT') {
      stopDueNotificationsMonitor();
      stopSafiNudgeRealtime();
      currentUser = null;
      currentUserProfile = null;
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
    if (notificationsMenu?.classList.contains('active')) {
      markAllDueNotificationsRead();
    }
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
    notificationsMenu?.classList.remove('active');
    if (targetView && targetView !== currentView) {
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

  // Command palette
  commandPaletteBtn?.addEventListener('click', openCommandPalette);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      openCommandPalette();
    }
    if (e.key === 'Escape') {
      closeCommandPalette();
      closeSidebar();
    }
  });

  document.querySelector('.command-palette-backdrop')?.addEventListener('click', closeCommandPalette);

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
    if (currentOrganization?.name) {
      if (orgLabel) orgLabel.textContent = currentOrganization.name;
      if (orgAvatar) orgAvatar.textContent = currentOrganization.name[0].toUpperCase();
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
        _pendingSettingsSection = 'profile';
        await loadView('settings');
        break;
      case 'workspace':
        _pendingSettingsSection = 'organization';
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

  currentUser = data.user;
  submitBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-icon lucide-check"><path d="M20 6 9 17l-5-5"/></svg> Success!';
}

async function handleLogout() {
  stopDueNotificationsMonitor();
  stopSafiNudgeRealtime();
  clearViewState();
  appInitialized = false;
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
// APP INITIALIZATION
// ======================

let appInitialized = false;

async function initApp() {
  if (appInitialized) return;
  authScreen.style.display = 'none';
  mainApp.style.display = 'flex';

  const { data: profile, error: profileError } = await supabaseClient
    .from('profiles')
    .select('role, first_name, last_name, email, date_format, organization_id')
    .eq('id', currentUser.id)
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
        const nameArr = (currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || '').split(' ');
        fnameInput.value = currentUser.user_metadata?.first_name || nameArr[0] || '';
        if (nameArr.length > 1 && lnameInput) {
          lnameInput.value = currentUser.user_metadata?.last_name || nameArr.slice(1).join(' ');
        }
      }
    }
    return;
  }

  // If we reach here, user has a profile AND an organization
  appInitialized = true;
  authScreen.style.display = 'none';
  mainApp.style.display = 'flex';

  const completePane = document.getElementById('complete-profile-pane');
  if (completePane) completePane.style.display = 'none';
  isManager = profile.role === 'manager';
  isTechnician = profile.role === 'technician';
  isSalesRep = profile.role === 'sales_rep';
  currentUserProfile = profile;

  // Load organization for this user (used in invite flow, member list, etc.)
  if (profile.organization_id) {
    try {
      const { data: org } = await supabaseClient
        .from('organizations')
        .select('id, name, owner_id, max_members')
        .eq('id', profile.organization_id)
        .single();
      currentOrganization = org || null;
      const orgNameEl = document.getElementById('ws-btn-org-name');
      const orgAvatarEl = document.getElementById('ws-btn-avatar');
      const headerOrgNameEl = document.getElementById('header-org-name');
      if (currentOrganization?.name) {
        const truncated = currentOrganization.name.length > 16
          ? currentOrganization.name.slice(0, 16) + '…'
          : currentOrganization.name;
        if (orgNameEl) orgNameEl.textContent = truncated;
        if (orgAvatarEl) orgAvatarEl.textContent = currentOrganization.name[0].toUpperCase();
        if (headerOrgNameEl) headerOrgNameEl.textContent = currentOrganization.name;
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
  if (isManager) {
    defaultView = 'team-dashboard';
  } else if (isTechnician) {
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
  const orgId = currentOrganization?.id;
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

  allPeople = (people || []).map((person) => {
    const company = person.company_id ? companiesById.get(String(person.company_id)) || null : null;
    return {
      ...person,
      company,
      companies: company
    };
  });

  crmDebugLog('loadAllPeople.mappedPeople', {
    count: allPeople.length,
    sample: allPeople.length > 0 ? allPeople[0] : null
  });
}

async function loadAllCompanies() {
  try {
    // diagnostic logs removed
    const doFetch = async () => {
      let q = supabaseClient.from('companies').select('id, name, domain').order('name', { ascending: true });
      if (currentOrganization?.id) q = q.eq('organization_id', currentOrganization.id);
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
  const displayName = profile.first_name ? `${profile.first_name} ${profile.last_name || ''}` : currentUser.email;
  const initials = getInitials(displayName);
  const email = profile.email || currentUser.email;

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

  if (isManager) {
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
  } else if (isTechnician) {
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
  if (isTechnician) {
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

function openSidebar() {
  sidebar.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeSidebar() {
  sidebar.classList.remove('active');
  document.body.style.overflow = '';
}

function updateActiveNav(viewName) {
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-view') === viewName);
  });
  // Update small page label (icon + text) shown to the right of the sidebar
  try {
    const navBtn = document.querySelector(`[data-view="${viewName}"]`);
    if (navBtn && pageLabel && pageLabelIcon && pageLabelText) {
      // Prefer explicit icon mapping for reliability (lucide or named icons)
      const VIEW_ICON_OVERRIDES = {
        'opportunity-pipeline': 'circle-dollar-sign',
        'people': 'users',
        'companies': 'building'
      };
      pageLabelIcon.innerHTML = '';
      if (VIEW_ICON_OVERRIDES[viewName]) {
        pageLabelIcon.innerHTML = `<i data-lucide="${VIEW_ICON_OVERRIDES[viewName]}"></i>`;
        try { if (window.lucide) lucide.createIcons(); } catch (e) {}
      } else {
        // Fallback: clone any existing SVG/icon inside the nav button into the label
        const iconNode = navBtn.querySelector('svg, .icon-bg, i')?.cloneNode(true);
        if (iconNode) pageLabelIcon.appendChild(iconNode);
      }
      // Prefer any span that contains visible text (skip icon wrappers)
      const spanEls = navBtn.querySelectorAll('span');
      let textNode = '';
      spanEls.forEach(s => {
        const t = (s.textContent || '').trim();
        if (t) textNode = t;
      });
      // Some views may render dynamic content and confuse scraping; use explicit overrides
      const VIEW_LABEL_OVERRIDES = {
        'opportunity-pipeline': 'Opportunities',
        'people': 'People',
        'companies': 'Companies'
      };
      if (VIEW_LABEL_OVERRIDES[viewName]) textNode = VIEW_LABEL_OVERRIDES[viewName];
      // Fallback to button's data-view (nicely formatted)
      if (!textNode) {
        const dv = navBtn.getAttribute('data-view') || '';
        textNode = dv.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      }
      pageLabelText.textContent = textNode;
      pageLabel.style.display = 'flex';
    } else if (pageLabel) {
      pageLabel.style.display = 'none';
    }
  } catch (e) {
    // Fail silently if DOM shape is unexpected
  }
}

// ======================
// VIEW ROUTER
// ======================
async function loadView(viewName) {
  currentView = viewName;
  updateActiveNav(viewName);

  try {
    const mainContent = document.querySelector('.main-content');
    const fullBleedViews = ['companies', 'people'];
    if (mainContent) {
      mainContent.classList.toggle('full-bleed', fullBleedViews.includes(viewName));
    }
  } catch (e) {}

  // Prevent technicians from accessing certain views
  const blockedForTechnician = ['sales-funnel', 'opportunity-pipeline', 'call-logs', 'companies', 'people'];
  if (isTechnician && blockedForTechnician.includes(viewName)) {
    showToast('You do not have permission to access this view', 'error');
    return;
  }

  // Destroy existing charts
  Object.keys(chartInstances).forEach(chartId => {
    if (chartInstances[chartId]) {
      chartInstances[chartId].destroy();
      delete chartInstances[chartId];
    }
  });

  localStorage.setItem('lastActiveView', viewName);

  switch (viewName) {
    case 'log-visit':
      await renderLogVisitView();
      break;
    case 'my-activity':
      await renderMyActivityView();
      break;
    // Add this case to your loadView function
    case 'notes':
      await renderNotesView();
      break;
    case 'sales-funnel':
      await renderSalesFunnelView();
      break;
    case 'opportunity-pipeline':
      await renderOpportunityPipelineView();
      break;
    case 'main-dashboard':
      if (isManager) {
        await renderProfessionalDashboardView();
      } else {
        viewContainer.innerHTML = renderAccessDenied();
      }
      break;
    case 'team-dashboard':
      if (isManager) {
        await renderTeamDashboardView();
      } else {
        viewContainer.innerHTML = renderAccessDenied();
      }
      break;
    case 'route-planning':
      if (isManager) {
        await renderRoutePlanningView();
      } else {
        viewContainer.innerHTML = renderAccessDenied();
      }
      break;
    case 'my-routes':
      await renderMyRoutesView();
      break;
    case 'user-management':
      await renderUserManagementView();
      break;
    case 'companies':
      await renderCompaniesView();
      break;
    case 'people':
      await renderPeopleView();
      break;
    case 'tasks':
      await renderTasksView();
      break;
    case 'technician-log-visit':
      if (isTechnician) {
        await renderTechnicianLogVisitView();
      } else {
        viewContainer.innerHTML = renderAccessDenied();
      }
      break;
    case 'technician-activity':
      if (isTechnician) {
        await renderTechnicianActivityView();
      } else {
        viewContainer.innerHTML = renderAccessDenied();
      }
      break;
    case 'technicians-dashboard':
      if (isManager) {
        await renderTechniciansDashboardView();
      } else {
        viewContainer.innerHTML = renderAccessDenied();
      }
      break;
    case 'reminders':
      await renderRemindersView();
      break;
    case 'call-logs':
      await renderCallLogsView();
      break;
    case 'settings':
      await renderSettingsView();
      break;
    default:
      viewContainer.innerHTML = renderNotFound();
  }
  checkDueReminders();

  // Always try to initialize Lucide icons after a view switch
  if (window.lucide) {
    setTimeout(() => lucide.createIcons(), 0);
  }
}

// ======================
// COMPANIES VIEW
// ======================

// ======================
// SETTINGS VIEW (REDESIGN v2)
// ======================


async function renderSettingsView() {
  const dateFormatPref = (typeof getUserDateFormat === 'function') ? getUserDateFormat() : (localStorage.getItem('safitrack_date_format') || 'DD/MM/YYYY');
  const emailNotifPref = (localStorage.getItem('safitrack_email_notifs') || 'true') === 'true';
  const currentTheme = localStorage.getItem('safitrack_theme') || localStorage.getItem('theme') || 'dark';
  function escH(s) { return (s || '').toString().replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  const maxSeats = currentOrganization?.max_members ?? 2;
  const getPlan = (seats) => seats <= 2 ? 'Free' : seats <= 20 ? 'Core' : 'Pro';
  const currentPlan = getPlan(maxSeats);
  const planPrice = { Free: '0', Core: '19', Pro: '79' };
  const planDesc = {
    Free: 'Basic access for small teams. Upgrade to unlock advanced features, higher limits, and priority support.',
    Core: 'Core plan — extended team access with higher limits and priority support.',
    Pro: 'Pro plan — unlimited members, advanced features, and dedicated support.',
  };

  const firstNameEsc = escH((currentUserProfile && currentUserProfile.first_name) ? currentUserProfile.first_name : '');
  const lastNameEsc = escH((currentUserProfile && currentUserProfile.last_name) ? currentUserProfile.last_name : '');
  const userEmailEsc = escH((currentUser && currentUser.email) ? currentUser.email : '');
  const roleEsc = escH((currentUserProfile && currentUserProfile.role) ? currentUserProfile.role : 'User');
  const initials = ((firstNameEsc ? firstNameEsc[0] : '') + (lastNameEsc ? lastNameEsc[0] : '')).toUpperCase() || (userEmailEsc ? userEmailEsc[0].toUpperCase() : 'U');
  const fullName = [firstNameEsc, lastNameEsc].filter(Boolean).join(' ') || 'Your Name';

  viewContainer.innerHTML = `
    <div class="sv-root">

      <!-- LEFT SIDEBAR NAV -->
      <nav class="sv-nav">
        <div class="sv-nav-section-label">Account</div>
        <button class="sv-nav-item active" data-section="profile">
          <svg class="sv-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
          Profile
        </button>
        <button class="sv-nav-item" data-section="security">
          <svg class="sv-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          Security
        </button>
        <button class="sv-nav-item" data-section="preferences">
          <svg class="sv-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a7 7 0 1 0 10 10"/></svg>
          Appearance
        </button>
        <button class="sv-nav-item" data-section="notifications">
          <svg class="sv-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          Notifications
        </button>

        <div class="sv-nav-section-label" style="margin-top:24px;">Workspace</div>
        <button class="sv-nav-item" data-section="organization">
          <svg class="sv-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
          Organization
        </button>
        <button class="sv-nav-item" data-section="members">
          <svg class="sv-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          Members
        </button>
        <button class="sv-nav-item" data-section="billing">
          <svg class="sv-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></svg>
          Billing
        </button>

        <div class="sv-nav-divider"></div>

        <button class="sv-nav-item" data-section="export">
          <svg class="sv-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Export Data
        </button>
        <button class="sv-nav-item sv-nav-danger" data-section="danger">
          <svg class="sv-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          Delete Account
        </button>
      </nav>

      <!-- MAIN CONTENT -->
      <main class="sv-content">

        <!-- ═══════════════════ PROFILE ═══════════════════ -->
        <section class="sv-section" data-section="profile">
          <div class="sv-page-header">
            <div>
              <h2 class="sv-page-title">Profile</h2>
              <p class="sv-page-subtitle">Manage how you appear across your workspace.</p>
            </div>
            <div id="profile-save-status" class="sv-saved-pill">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              Saved
            </div>
          </div>

          <div class="sv-field-group">
            <div class="sv-field-row">
              <div class="sv-field-meta">
                <div class="sv-field-label">Avatar</div>
                <div class="sv-field-hint">Shown on comments, assignments, and mentions.</div>
              </div>
              <div class="sv-field-control">
                <div class="sv-avatar-wrap">
                  <div class="sv-avatar-circle">
                    ${initials}
                    <div class="sv-avatar-overlay">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                    </div>
                  </div>
                  <div class="sv-avatar-info">
                    <span class="sv-avatar-name">${fullName}</span>
                    <button class="sv-ghost-btn">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                      Upload photo
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div class="sv-field-row">
              <div class="sv-field-meta">
                <div class="sv-field-label">Full name</div>
                <div class="sv-field-hint">Your name as it appears to other members.</div>
              </div>
              <div class="sv-field-control">
                <div class="sv-input-pair">
                  <input id="profile-firstname" class="sv-input" type="text" placeholder="First name" value="${firstNameEsc}">
                  <input id="profile-lastname" class="sv-input" type="text" placeholder="Last name" value="${lastNameEsc}">
                </div>
              </div>
            </div>

            <div class="sv-field-row">
              <div class="sv-field-meta">
                <div class="sv-field-label">Role</div>
                <div class="sv-field-hint">Your permission level in this workspace.</div>
              </div>
              <div class="sv-field-control">
                <span class="sv-role-chip" data-role="${roleEsc.toLowerCase()}">${roleEsc}</span>
              </div>
            </div>
          </div>
        </section>

        <!-- ═══════════════════ SECURITY ═══════════════════ -->
        <section class="sv-section" data-section="security" style="display:none;">
          <div class="sv-page-header">
            <div>
              <h2 class="sv-page-title">Security</h2>
              <p class="sv-page-subtitle">Control access and authentication for your account.</p>
            </div>
          </div>

          <div class="sv-field-group">
            <div class="sv-field-row">
              <div class="sv-field-meta">
                <div class="sv-field-label">Email address</div>
                <div class="sv-field-hint">Used for sign-in and system notifications.</div>
              </div>
              <div class="sv-field-control">
                <div class="sv-locked-field">
                  <svg class="sv-locked-field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  <span class="sv-locked-field-val">${userEmailEsc}</span>
                  <span class="sv-verified-chip">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:10px;height:10px;"><polyline points="20 6 9 17 4 12"/></svg>
                    Verified
                  </span>
                  <button class="sv-locked-field-btn">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    Change
                  </button>
                </div>
              </div>
            </div>

            <div class="sv-field-row">
              <div class="sv-field-meta">
                <div class="sv-field-label">Password</div>
                <div class="sv-field-hint">Keep your account secure with a strong password.</div>
              </div>
              <div class="sv-field-control">
                <button id="profile-change-password-btn" class="sv-ghost-btn">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  Update password
                </button>
              </div>
            </div>

            <div class="sv-field-row">
              <div class="sv-field-meta">
                <div class="sv-field-label">Two-factor authentication</div>
                <div class="sv-field-hint">Require a verification code in addition to your password.</div>
              </div>
              <div class="sv-field-control" style="gap:12px;">
                <span class="sv-2fa-status">
                  <span class="sv-status-dot sv-status-dot--active"></span>
                  Active
                </span>
                <label class="sv-toggle">
                  <input type="checkbox" checked>
                  <span class="sv-toggle-track"><span class="sv-toggle-thumb"></span></span>
                </label>
              </div>
            </div>
          </div>
        </section>

        <!-- ═══════════════════ APPEARANCE ═══════════════════ -->
        <section class="sv-section" data-section="preferences" style="display:none;">
          <div class="sv-page-header">
            <div>
              <h2 class="sv-page-title">Appearance</h2>
              <p class="sv-page-subtitle">Customize how SafiTrack looks and feels for you.</p>
            </div>
            <div id="pref-save-status" class="sv-saved-pill">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              Saved
            </div>
          </div>

          <div class="sv-field-group">
            <div class="sv-field-row sv-field-row--block">
              <div class="sv-field-meta">
                <div class="sv-field-label">Theme</div>
                <div class="sv-field-hint">Choose a color scheme for the interface.</div>
              </div>
              <div class="sv-theme-grid">
                <button class="sv-theme-tile ${currentTheme === 'light' ? 'is-active' : ''}" data-theme-val="light">
                  <div class="sv-theme-mock sv-theme-mock--light">
                    <div class="sv-mock-sidebar-strip"></div>
                    <div class="sv-mock-body">
                      <div class="sv-mock-header-bar"></div>
                      <div class="sv-mock-rows">
                        <div class="sv-mock-row-item"></div>
                        <div class="sv-mock-row-item"></div>
                        <div class="sv-mock-row-item"></div>
                      </div>
                    </div>
                  </div>
                  <div class="sv-theme-tile-footer">
                    <span class="sv-theme-tile-dot"></span>
                    Light
                  </div>
                </button>

                <button class="sv-theme-tile ${currentTheme === 'dark' ? 'is-active' : ''}" data-theme-val="dark">
                  <div class="sv-theme-mock sv-theme-mock--dark">
                    <div class="sv-mock-sidebar-strip"></div>
                    <div class="sv-mock-body">
                      <div class="sv-mock-header-bar"></div>
                      <div class="sv-mock-rows">
                        <div class="sv-mock-row-item"></div>
                        <div class="sv-mock-row-item"></div>
                        <div class="sv-mock-row-item"></div>
                      </div>
                    </div>
                  </div>
                  <div class="sv-theme-tile-footer">
                    <span class="sv-theme-tile-dot"></span>
                    Dark
                  </div>
                </button>

                <button class="sv-theme-tile ${currentTheme === 'system' ? 'is-active' : ''}" data-theme-val="system">
                  <div class="sv-theme-mock sv-theme-mock--system">
                    <div class="sv-theme-mock-half sv-theme-mock-half--light">
                      <div class="sv-mock-sidebar-strip"></div>
                      <div class="sv-mock-body">
                        <div class="sv-mock-header-bar"></div>
                        <div class="sv-mock-rows">
                          <div class="sv-mock-row-item"></div>
                          <div class="sv-mock-row-item"></div>
                        </div>
                      </div>
                    </div>
                    <div class="sv-theme-mock-half sv-theme-mock-half--dark">
                      <div class="sv-mock-sidebar-strip"></div>
                      <div class="sv-mock-body">
                        <div class="sv-mock-header-bar"></div>
                        <div class="sv-mock-rows">
                          <div class="sv-mock-row-item"></div>
                          <div class="sv-mock-row-item"></div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div class="sv-theme-tile-footer">
                    <span class="sv-theme-tile-dot"></span>
                    System
                  </div>
                </button>
              </div>
            </div>

            <div class="sv-field-row">
              <div class="sv-field-meta">
                <div class="sv-field-label">Date format</div>
                <div class="sv-field-hint">Controls how dates are displayed across the app.</div>
              </div>
              <div class="sv-field-control">
                <div class="sv-seg sv-date-segmented">
                  <button class="sv-seg-btn ${dateFormatPref === 'DD/MM/YYYY' ? 'is-active' : ''}" data-value="DD/MM/YYYY">DD/MM/YYYY</button>
                  <button class="sv-seg-btn ${dateFormatPref === 'MM/DD/YYYY' ? 'is-active' : ''}" data-value="MM/DD/YYYY">MM/DD/YYYY</button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- ═══════════════════ NOTIFICATIONS ═══════════════════ -->
        <section class="sv-section" data-section="notifications" style="display:none;">
          <div class="sv-page-header">
            <div>
              <h2 class="sv-page-title">Notifications</h2>
              <p class="sv-page-subtitle">Choose what you want to be notified about.</p>
            </div>
          </div>

          <div class="sv-field-group">
            <div class="sv-field-row">
              <div class="sv-field-meta">
                <div class="sv-field-label">Email notifications</div>
                <div class="sv-field-hint">Summaries, activity updates, and important alerts by email.</div>
              </div>
              <div class="sv-field-control">
                <label class="sv-toggle">
                  <input id="pref-email-notifs" type="checkbox" ${emailNotifPref ? 'checked' : ''}>
                  <span class="sv-toggle-track"><span class="sv-toggle-thumb"></span></span>
                </label>
              </div>
            </div>

            <div class="sv-field-row">
              <div class="sv-field-meta">
                <div class="sv-field-label">Browser push notifications</div>
                <div class="sv-field-hint">Instant alerts for reminders and @mentions in your browser.</div>
              </div>
              <div class="sv-field-control">
                <button id="enable-browser-notifs" class="sv-ghost-btn">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                  Enable push
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- ═══════════════════ ORGANIZATION ═══════════════════ -->
        <section class="sv-section" data-section="organization" style="display:none;">
          <div class="sv-page-header">
            <div>
              <h2 class="sv-page-title">Organization</h2>
              <p class="sv-page-subtitle">Workspace identity and plan information.</p>
            </div>
          </div>

          <div class="sv-org-identity-card">
            <div class="sv-org-identity-avatar">${((currentOrganization?.name || 'W').match(/\b\w/g) || []).slice(0, 2).join('').toUpperCase()}</div>
            <div class="sv-org-identity-body">
              <div class="sv-org-identity-name">${escH(currentOrganization?.name || '—')}</div>
              <div class="sv-org-identity-id">
                <span class="sv-mono-chip">${escH((currentOrganization?.id || '').slice(0, 8).toUpperCase()) || '—'}</span>
              </div>
            </div>
            ${isManager ? `
            <button class="sv-ghost-btn" id="sv-org-name-edit-trigger">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Rename
            </button>` : ''}
          </div>

          ${isManager ? `
          <div class="sv-org-rename-block" id="sv-org-rename-form" style="display:none;">
            <label class="sv-field-label" style="display:block;margin-bottom:8px;" for="org-name-input">Workspace name</label>
            <div class="sv-org-rename-row">
              <input id="org-name-input" class="sv-input" type="text" value="${escH(currentOrganization?.name || '')}" placeholder="Organization name" autocomplete="off" style="max-width:260px;">
              <button id="org-name-save-btn" class="sv-primary-btn">Save</button>
              <button type="button" class="sv-ghost-btn" id="sv-org-rename-cancel">Cancel</button>
            </div>
            <p class="sv-field-hint" style="margin-top:8px;">Appears in your sidebar and email invitations.</p>
          </div>` : ''}

          <div class="sv-stat-row">
            <div class="sv-stat-tile">
              <div class="sv-stat-tile-label">Your role</div>
              <div class="sv-stat-tile-value"><span class="sv-role-chip" data-role="${roleEsc.toLowerCase()}">${roleEsc}</span></div>
            </div>
            <div class="sv-stat-tile">
              <div class="sv-stat-tile-label">Current plan</div>
              <div class="sv-stat-tile-value" style="gap:8px;">
                <span class="sv-plan-chip" data-plan="${currentPlan.toLowerCase()}">${currentPlan}</span>
                ${currentPlan === 'Free' ? `<a href="https://safitrack.netlify.app/pages/pricing" target="_blank" class="sv-stat-upgrade-link">Upgrade <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;"><path d="M13 7l5 5-5 5M6 12h12"/></svg></a>` : ''}
              </div>
            </div>
            <div class="sv-stat-tile">
              <div class="sv-stat-tile-label">Seats used</div>
              <div class="sv-stat-tile-value--mono" id="sv-seat-count">— / ${currentOrganization?.max_members ?? 2}</div>
              <div class="sv-seat-bar-track">
                <div class="sv-seat-bar-fill" id="sv-seat-bar" style="width:0%"></div>
              </div>
            </div>
          </div>
        </section>

        <!-- ═══════════════════ MEMBERS ═══════════════════ -->
        <section class="sv-section" data-section="members" style="display:none;">
          <div class="sv-page-header">
            <div>
              <h2 class="sv-page-title">Members</h2>
              ${currentOrganization ? `<p class="sv-page-subtitle">${escH(currentOrganization.name)}</p>` : '<p class="sv-page-subtitle">Manage who has access to this workspace.</p>'}
            </div>
            ${isManager ? '<button class="sv-primary-btn" id="invite-member-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;margin-right:6px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Invite member</button>' : ''}
          </div>

          <div class="sv-members-search-bar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" placeholder="Search by name or email…" id="sv-member-search">
          </div>

          <div class="sv-members-table-wrap">
            <table class="sv-members-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody id="sv-members-container">
                <tr><td colspan="4" class="sv-table-empty">Loading members…</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- ═══════════════════ BILLING ═══════════════════ -->
        <section class="sv-section" data-section="billing" style="display:none;">
          <div class="sv-page-header">
            <div>
              <h2 class="sv-page-title">Billing</h2>
              <p class="sv-page-subtitle">Your subscription and plan details.</p>
            </div>
          </div>

          <div class="sv-billing-block">

            <!-- Current plan header -->
            <div class="sv-billing-plan-header">
              <div class="sv-billing-plan-left">
                <span class="sv-plan-chip" data-plan="${currentPlan.toLowerCase()}">${currentPlan}</span>
                <div class="sv-billing-plan-name">${currentPlan} Plan</div>
                <div class="sv-billing-plan-desc">${planDesc[currentPlan]}</div>
              </div>
              <div class="sv-billing-price-block">
                <div class="sv-billing-price-amount">
                  <span class="sv-billing-price-currency">$</span>
                  <span class="sv-billing-price-number">${planPrice[currentPlan]}</span>
                </div>
                <div class="sv-billing-price-meta">per user / month</div>
                <a href="https://safitrack.netlify.app/pages/pricing" target="_blank" class="sv-primary-btn" style="text-decoration:none;margin-top:12px;">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;margin-right:6px;"><path d="M13 7l5 5-5 5M6 12h12"/></svg>
                  ${currentPlan === 'Pro' ? 'Manage plan' : 'Upgrade plan'}
                </a>
              </div>
            </div>

            <!-- Plan comparison tiers -->
            <div class="sv-billing-tiers">
              <div class="sv-billing-tier ${currentPlan === 'Free' ? 'is-current' : ''}">
                <div class="sv-billing-tier-top">
                  <span class="sv-billing-tier-name">Free</span>
                  ${currentPlan === 'Free' ? '<span class="sv-billing-tier-badge">Current</span>' : ''}
                </div>
                <div class="sv-billing-tier-price"><span class="sv-billing-tier-amount">$0</span><span class="sv-billing-tier-cadence">/user/mo</span></div>
                <div class="sv-billing-tier-seats">Up to 2 seats</div>
              </div>
              <div class="sv-billing-tier ${currentPlan === 'Core' ? 'is-current' : ''}">
                <div class="sv-billing-tier-top">
                  <span class="sv-billing-tier-name">Core</span>
                  ${currentPlan === 'Core' ? '<span class="sv-billing-tier-badge">Current</span>' : ''}
                </div>
                <div class="sv-billing-tier-price"><span class="sv-billing-tier-amount">$19</span><span class="sv-billing-tier-cadence">/user/mo</span></div>
                <div class="sv-billing-tier-seats">Up to 20 seats</div>
              </div>
              <div class="sv-billing-tier ${currentPlan === 'Pro' ? 'is-current' : ''}">
                <div class="sv-billing-tier-top">
                  <span class="sv-billing-tier-name">Pro</span>
                  ${currentPlan === 'Pro' ? '<span class="sv-billing-tier-badge">Current</span>' : ''}
                </div>
                <div class="sv-billing-tier-price"><span class="sv-billing-tier-amount">$79</span><span class="sv-billing-tier-cadence">/user/mo</span></div>
                <div class="sv-billing-tier-seats">Unlimited seats</div>
              </div>
            </div>

            <div class="sv-billing-notice">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              Plan changes cannot be made from the CRM. The button above links to our pricing page.
            </div>
          </div>

          <!-- Invoices -->
          <div class="sv-invoices-block">
            <div class="sv-invoices-header">
              <div class="sv-invoices-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                Invoices
              </div>
              <span class="sv-invoices-note">Generated monthly on your billing date</span>
            </div>
            <table class="sv-invoices-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Period</th>
                  <th>Plan</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody id="sv-invoices-body">
                ${(() => {
      const rows = [];
      const now = new Date();
      for (let i = 0; i < 6; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const periodStart = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const periodEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const invoiceNum = `ST-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
        const pricePerSeat = parseFloat(planPrice[currentPlan]) || 0;
        const amount = pricePerSeat === 0 ? '$0.00' : `$${(pricePerSeat * maxSeats).toFixed(2)}`;
        const isPaid = true;
        rows.push(`
                      <tr>
                        <td class="sv-invoice-num">${invoiceNum}</td>
                        <td class="sv-invoice-period">${periodStart} – ${periodEnd}</td>
                        <td><span class="sv-plan-chip" data-plan="${currentPlan.toLowerCase()}" style="font-size:0.68rem;padding:2px 7px;">${currentPlan}</span></td>
                        <td class="sv-invoice-amount">${amount}</td>
                        <td><span class="sv-invoice-status ${isPaid ? 'is-paid' : 'is-pending'}">${isPaid ? 'Paid' : 'Pending'}</span></td>
                        <td class="sv-invoice-action-cell">
                          <button class="sv-invoice-dl-btn" data-invoice="${invoiceNum}" data-period-start="${periodStart}" data-period-end="${periodEnd}" data-amount="${amount}" data-plan="${currentPlan}" title="Download PDF">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            PDF
                          </button>
                        </td>
                      </tr>`);
      }
      return rows.join('');
    })()}
              </tbody>
            </table>
          </div>
        </section>

        <!-- ═══════════════════ EXPORT ═══════════════════ -->
        <section class="sv-section" data-section="export" style="display:none;">
          <div class="sv-page-header">
            <div>
              <h2 class="sv-page-title">Export Data</h2>
              <p class="sv-page-subtitle">Download a copy of your data and activity records.</p>
            </div>
          </div>

          <div class="sv-field-group">
            <div class="sv-field-row">
              <div class="sv-field-meta">
                <div class="sv-field-label">Personal data export</div>
                <div class="sv-field-hint">A JSON file containing your profile, activity, and records.</div>
              </div>
              <div class="sv-field-control">
                <button id="export-data-btn" class="sv-ghost-btn">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Export as JSON
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- ═══════════════════ DANGER ═══════════════════ -->
        <section class="sv-section" data-section="danger" style="display:none;">
          <div class="sv-page-header">
            <div>
              <h2 class="sv-page-title">Delete Account</h2>
              <p class="sv-page-subtitle">Permanently remove your account and all associated data.</p>
            </div>
          </div>

          <div class="sv-danger-callout">
            <div class="sv-danger-callout-header">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <span>Danger zone — these actions are irreversible</span>
            </div>

            <div class="sv-danger-field-row">
              <div class="sv-field-meta">
                <div class="sv-field-label">Deactivate account</div>
                <div class="sv-field-hint">Temporarily suspends your access. You can reactivate by signing in again.</div>
              </div>
              <div class="sv-field-control">
                <button class="sv-ghost-btn sv-ghost-btn--danger">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                  Deactivate
                </button>
              </div>
            </div>

            <div class="sv-danger-divider"></div>

            <div class="sv-danger-field-row">
              <div class="sv-field-meta">
                <div class="sv-field-label">Delete account permanently</div>
                <div class="sv-field-hint">Removes your account, data, and workspace access from SafiTrack forever.</div>
              </div>
              <div class="sv-field-control">
                <button id="delete-account-btn" class="sv-danger-btn">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                  Delete account
                </button>
              </div>
            </div>
          </div>
        </section>

      </main>
    </div>
  `;

  /* ─────────────── STYLES ─────────────── */
  if (!document.getElementById('sv-styles')) {
    const style = document.createElement('style');
    style.id = 'sv-styles';
    style.textContent = `
      /* ── Root shell ── */
      .sv-root {
        display: flex;
        height: 720px;
        max-height: 90vh;
        width: 100%;
        max-width: 1100px;
        margin: 0 auto;
        overflow: hidden;
        background: var(--bg-primary);
        font-family: 'Manrope', -apple-system, BlinkMacSystemFont, sans-serif;
        border-radius: 12px;
        border: 1px solid var(--border-color);
        box-shadow: 0 8px 40px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06);
      }

      /* ── Sidebar ── */
      .sv-nav {
        width: 210px;
        flex-shrink: 0;
        padding: 20px 10px;
        border-right: 1px solid var(--border-color);
        background: var(--bg-secondary);
        display: flex;
        flex-direction: column;
        gap: 1px;
        overflow-y: auto;
      }
      .sv-nav-section-label {
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--text-muted);
        padding: 6px 10px 4px;
        margin-top: 4px;
      }
      .sv-nav-item {
        display: flex;
        align-items: center;
        gap: 9px;
        width: 100%;
        padding: 7px 10px;
        border: none;
        background: transparent;
        border-radius: 6px;
        font-size: 0.9rem;
        font-weight: 500;
        color: var(--text-secondary);
        cursor: pointer;
        text-align: left;
        font-family: inherit;
        transition: background 0.1s, color 0.1s;
        letter-spacing: -0.01em;
      }
      .sv-nav-item:hover { background: var(--bg-tertiary, rgba(0,0,0,0.04)); color: var(--text-primary); }
      .sv-nav-item.active {
        background: color-mix(in srgb, var(--color-primary) 10%, transparent);
        color: var(--color-primary);
        font-weight: 600;
      }
      .sv-nav-icon {
        width: 15px;
        height: 15px;
        flex-shrink: 0;
        opacity: 0.7;
      }
      .sv-nav-item.active .sv-nav-icon { opacity: 1; }
      .sv-nav-divider { height: 1px; background: var(--border-color); margin: 10px 10px; }
      .sv-nav-danger { color: #dc2626 !important; }
      .sv-nav-danger:hover { background: rgba(220,38,38,0.06) !important; }
      .sv-nav-danger.active { background: rgba(220,38,38,0.08) !important; color: #dc2626 !important; }

      /* ── Main content ── */
      .sv-content {
        flex: 1;
        min-width: 0;
        overflow-y: auto;
        padding: 40px 52px;
        background: var(--bg-primary);
        scroll-behavior: smooth;
      }
      .sv-section { max-width: 680px; }

      /* ── Page header ── */
      .sv-page-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 32px;
        padding-bottom: 24px;
        border-bottom: 1px solid var(--border-color);
      }
      .sv-page-header > div:first-child {
        padding-left: 14px;
        border-left: 2.5px solid var(--color-primary);
      }
      .sv-page-title {
        font-size: 1.25rem;
        font-weight: 700;
        color: var(--text-primary);
        letter-spacing: -0.025em;
        margin: 0 0 4px;
        line-height: 1.2;
      }
      .sv-page-subtitle {
        font-size: 0.9rem;
        color: var(--text-muted);
        margin: 0;
        line-height: 1.5;
      }

      /* ── Saved pill ── */
      .sv-saved-pill {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 0.8rem;
        font-weight: 550;
        color: #059669;
        background: rgba(5,150,105,0.08);
        border: 1px solid rgba(5,150,105,0.18);
        border-radius: 100px;
        padding: 4px 10px;
        opacity: 0;
        transition: opacity 0.25s;
        white-space: nowrap;
        flex-shrink: 0;
        margin-top: 4px;
      }
      .sv-saved-pill svg { width: 11px; height: 11px; }

      /* ── Field groups ── */
      .sv-field-group {
        display: flex;
        flex-direction: column;
      }
      .sv-field-group--danger .sv-field-row { border-color: rgba(220,38,38,0.12); }
      .sv-field-row {
        display: flex;
        align-items: center;
        gap: 32px;
        padding: 20px 0;
        border-bottom: 1px solid var(--border-color);
      }
      .sv-field-row:first-child { padding-top: 0; }
      .sv-field-row:last-child { border-bottom: none; padding-bottom: 0; }
      .sv-field-row--block { flex-direction: column; align-items: flex-start; gap: 16px; }
      .sv-field-meta { flex: 0 0 220px; }
      .sv-field-label {
        font-size: 0.92rem;
        font-weight: 600;
        color: var(--text-primary);
        letter-spacing: -0.01em;
        margin-bottom: 3px;
      }
      .sv-field-hint {
        font-size: 0.84rem;
        color: var(--text-muted);
        line-height: 1.5;
      }
      .sv-field-control {
        flex: 1;
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 8px;
      }
      .sv-field-control--split { justify-content: flex-end; gap: 12px; }
      .sv-field-row--block .sv-field-meta { flex: none; }
      .sv-field-row--block .sv-field-control { justify-content: flex-start; width: 100%; }

      /* ── Inputs ── */
      .sv-input {
        width: 100%;
        padding: 8px 12px;
        border-radius: 6px;
        border: 1px solid var(--border-color);
        background: var(--bg-primary);
        color: var(--text-primary);
        font-size: 0.92rem;
        font-family: inherit;
        transition: border-color 0.12s, box-shadow 0.12s;
        outline: none;
        box-sizing: border-box;
        letter-spacing: -0.01em;
      }
      .sv-input:focus {
        border-color: var(--color-primary);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 14%, transparent);
      }
      .sv-input-pair { display: flex; gap: 8px; width: 100%; justify-content: flex-end; }
      .sv-input-pair .sv-input { max-width: 180px; }

      /* ── Buttons ── */
      .sv-primary-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 7px 14px;
        border-radius: 6px;
        border: none;
        background: var(--color-primary);
        color: #fff;
        font-size: 0.88rem;
        font-weight: 600;
        cursor: pointer;
        transition: opacity 0.12s;
        font-family: inherit;
        letter-spacing: -0.01em;
      }
      .sv-primary-btn:hover { opacity: 0.88; }

      .sv-ghost-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 11px;
        border-radius: 6px;
        border: 1px solid var(--border-color);
        background: transparent;
        color: var(--text-secondary);
        font-size: 0.86rem;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.1s, border-color 0.1s, color 0.1s;
        font-family: inherit;
        letter-spacing: -0.01em;
      }
      .sv-ghost-btn:hover { background: var(--bg-secondary); color: var(--text-primary); border-color: color-mix(in srgb, var(--border-color) 60%, var(--text-primary)); }
      .sv-ghost-btn--danger { color: #dc2626 !important; border-color: rgba(220,38,38,0.25) !important; }
      .sv-ghost-btn--danger:hover { background: rgba(220,38,38,0.05) !important; border-color: rgba(220,38,38,0.4) !important; }

      .sv-danger-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        border-radius: 6px;
        border: 1px solid rgba(220,38,38,0.3);
        background: rgba(220,38,38,0.05);
        color: #dc2626;
        font-size: 0.86rem;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.12s, border-color 0.12s;
        font-family: inherit;
      }
      .sv-danger-btn:hover { background: rgba(220,38,38,0.1); border-color: #dc2626; }

      /* ── Role / plan chips ── */
      .sv-role-chip, .sv-plan-chip {
        display: inline-flex;
        align-items: center;
        padding: 3px 10px;
        border-radius: 100px;
        font-size: 0.74rem;
        font-weight: 700;
        letter-spacing: 0.02em;
        white-space: nowrap;
      }
      .sv-role-chip {
        background: color-mix(in srgb, var(--color-primary) 10%, transparent);
        color: var(--color-primary);
        border: 1px solid color-mix(in srgb, var(--color-primary) 22%, transparent);
        text-transform: capitalize;
      }
      .sv-role-chip[data-role="manager"] {
        background: rgba(167,139,250,0.14);
        color: #a78bfa;
        border-color: rgba(167,139,250,0.28);
      }
      .sv-role-chip[data-role="sales_rep"] {
        background: rgba(5,150,105,0.10);
        color: #059669;
        border-color: rgba(5,150,105,0.22);
      }
      .sv-role-chip[data-role="technician"] {
        background: rgba(234,88,12,0.10);
        color: #ea580c;
        border-color: rgba(234,88,12,0.22);
      }
      .sv-role-chip[data-role="member"] {
        background: rgba(100,116,139,0.10);
        color: #64748b;
        border-color: rgba(100,116,139,0.22);
      }
      .sv-plan-chip {
        background: color-mix(in srgb, var(--color-primary) 10%, transparent);
        color: var(--color-primary);
        border: 1px solid color-mix(in srgb, var(--color-primary) 22%, transparent);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        padding: 3px 8px;
        font-size: 0.7rem;
      }
      .sv-plan-chip[data-plan="core"] {
        background: rgba(5,150,105,0.10);
        color: #059669;
        border-color: rgba(5,150,105,0.22);
      }
      .sv-plan-chip[data-plan="pro"] {
        background: rgba(124,58,237,0.10);
        color: #a78bfa;
        border-color: rgba(167,139,250,0.28);
      }

      /* ── Chips / display elements ── */
      .sv-verified-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 0.74rem;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: #059669;
        background: rgba(5,150,105,0.08);
        border: 1px solid rgba(5,150,105,0.16);
        border-radius: 4px;
        padding: 2px 7px;
      }
      .sv-mono-chip {
        font-family: 'Geist Mono', 'Fira Code', ui-monospace, monospace;
        font-size: 0.72rem;
        color: var(--text-muted);
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: 4px;
        padding: 2px 7px;
        letter-spacing: 0.08em;
      }

      /* ── Email row ── */
      .sv-email-row { display: flex; align-items: center; gap: 10px; }
      .sv-email-val { font-size: 0.92rem; font-weight: 500; color: var(--text-primary); letter-spacing: -0.01em; }

      /* ── Toggle ── */
      .sv-toggle { position: relative; display: inline-block; width: 40px; height: 22px; flex-shrink: 0; cursor: pointer; }
      .sv-toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
      .sv-toggle-track { position: absolute; inset: 0; border-radius: 100px; background: var(--border-color); transition: background 0.2s; }
      .sv-toggle input:checked + .sv-toggle-track { background: var(--color-primary); }
      .sv-toggle-thumb { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.18); transition: transform 0.2s cubic-bezier(0.4,0,0.2,1); }
      .sv-toggle input:checked ~ .sv-toggle-track .sv-toggle-thumb { transform: translateX(18px); }

      /* ── Profile avatar ── */
      .sv-avatar-wrap { display: flex; align-items: center; gap: 16px; }
      .sv-avatar-circle {
        width: 52px;
        height: 52px;
        border-radius: 50%;
        background: linear-gradient(135deg, var(--color-primary) 0%, #818cf8 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.15rem;
        font-weight: 700;
        color: #fff;
        flex-shrink: 0;
        letter-spacing: -0.03em;
        position: relative;
        cursor: pointer;
        overflow: hidden;
      }
      .sv-avatar-overlay {
        position: absolute;
        inset: 0;
        border-radius: 50%;
        background: rgba(0,0,0,0.45);
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.18s;
      }
      .sv-avatar-overlay svg { width: 18px; height: 18px; color: #fff; }
      .sv-avatar-circle:hover .sv-avatar-overlay { opacity: 1; }
      .sv-avatar-info { display: flex; flex-direction: column; gap: 5px; }
      .sv-avatar-name { font-size: 0.96rem; font-weight: 600; color: var(--text-primary); letter-spacing: -0.02em; }

      /* ── Theme tiles ── */
      .sv-theme-grid { display: flex; gap: 12px; width: 100%; }
      .sv-theme-tile {
        flex: 1;
        border: 1.5px solid var(--border-color);
        border-radius: 8px;
        background: transparent;
        padding: 0;
        cursor: pointer;
        overflow: hidden;
        transition: border-color 0.15s;
        text-align: left;
        font-family: inherit;
      }
      .sv-theme-tile:hover { border-color: color-mix(in srgb, var(--border-color) 50%, var(--text-primary)); }
      .sv-theme-tile.is-active { border-color: var(--color-primary); box-shadow: 0 0 0 1px var(--color-primary); }

      .sv-theme-mock {
        height: 90px;
        display: flex;
        border-bottom: 1.5px solid var(--border-color);
        overflow: hidden;
      }
      .sv-theme-tile.is-active .sv-theme-mock { border-bottom-color: var(--color-primary); }
      .sv-theme-mock--light { background: #f8fafc; }
      .sv-theme-mock--dark { background: #0d1117; }
      .sv-theme-mock--system { background: transparent; }

      .sv-theme-mock-half { flex: 1; display: flex; }
      .sv-theme-mock-half--light { background: #f8fafc; }
      .sv-theme-mock-half--dark { background: #0d1117; }

      .sv-mock-sidebar-strip {
        width: 28px;
        flex-shrink: 0;
        border-right: 1px solid rgba(0,0,0,0.07);
      }
      .sv-theme-mock--dark .sv-mock-sidebar-strip,
      .sv-theme-mock-half--dark .sv-mock-sidebar-strip { border-right-color: rgba(255,255,255,0.06); }

      .sv-mock-body { flex: 1; padding: 10px 8px; }
      .sv-mock-header-bar { height: 3px; border-radius: 2px; background: rgba(0,0,0,0.08); margin-bottom: 8px; width: 55%; }
      .sv-theme-mock--dark .sv-mock-header-bar,
      .sv-theme-mock-half--dark .sv-mock-header-bar { background: rgba(255,255,255,0.1); }

      .sv-mock-rows { display: flex; flex-direction: column; gap: 5px; }
      .sv-mock-row-item { height: 2px; border-radius: 1px; background: rgba(0,0,0,0.06); }
      .sv-mock-row-item:nth-child(2) { width: 75%; }
      .sv-mock-row-item:nth-child(3) { width: 50%; }
      .sv-theme-mock--dark .sv-mock-row-item,
      .sv-theme-mock-half--dark .sv-mock-row-item { background: rgba(255,255,255,0.07); }

      .sv-theme-tile-footer {
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 9px 12px;
        font-size: 0.84rem;
        font-weight: 500;
        color: var(--text-muted);
        background: var(--bg-primary);
        letter-spacing: -0.01em;
      }
      .sv-theme-tile.is-active .sv-theme-tile-footer { color: var(--color-primary); }
      .sv-theme-tile-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        border: 1.5px solid var(--border-color);
        flex-shrink: 0;
        transition: background 0.15s, border-color 0.15s;
      }
      .sv-theme-tile.is-active .sv-theme-tile-dot { background: var(--color-primary); border-color: var(--color-primary); }

      /* ── Segmented ── */
      .sv-seg {
        display: inline-flex;
        border: 1px solid var(--border-color);
        border-radius: 6px;
        padding: 2px;
        background: var(--bg-secondary);
        gap: 2px;
      }
      .sv-seg-btn {
        padding: 6px 14px;
        border: none;
        background: transparent;
        font-size: 0.86rem;
        font-weight: 500;
        color: var(--text-muted);
        cursor: pointer;
        font-family: inherit;
        border-radius: 4px;
        transition: background 0.12s, color 0.12s;
        letter-spacing: -0.01em;
      }
      .sv-seg-btn:hover { color: var(--text-primary); }
      .sv-seg-btn.is-active { background: var(--color-primary); color: #ffffff; font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,0.15); }

      /* ── Organization identity card ── */
      .sv-org-identity-card {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 18px 20px;
        border: 1px solid var(--border-color);
        border-radius: 8px;
        background: var(--bg-secondary);
        margin-bottom: 16px;
      }
      .sv-org-identity-avatar {
        width: 42px;
        height: 42px;
        border-radius: 8px;
        background: linear-gradient(135deg, var(--color-primary) 0%, #818cf8 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.95rem;
        font-weight: 800;
        color: #fff;
        letter-spacing: -0.04em;
        flex-shrink: 0;
      }
      .sv-org-identity-body { flex: 1; min-width: 0; }
      .sv-org-identity-name { font-size: 0.98rem; font-weight: 700; color: var(--text-primary); letter-spacing: -0.02em; margin-bottom: 4px; }
      .sv-org-identity-id { display: flex; align-items: center; }

      /* ── Org rename block ── */
      .sv-org-rename-block {
        padding: 16px 20px;
        border: 1px solid var(--border-color);
        border-radius: 8px;
        background: var(--bg-secondary);
        margin-bottom: 16px;
      }
      .sv-org-rename-row { display: flex; align-items: center; gap: 8px; }

      /* ── Stat row ── */
      .sv-stat-row { display: flex; gap: 10px; }
      .sv-stat-tile {
        flex: 1;
        padding: 14px 16px;
        border: 1px solid var(--border-color);
        border-radius: 8px;
        background: var(--bg-secondary);
      }
      .sv-stat-tile-label { font-size: 0.74rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-muted); margin-bottom: 8px; }
      .sv-stat-tile-value { display: flex; align-items: center; }
      .sv-stat-tile-value--mono { font-size: 1rem; font-weight: 700; color: var(--text-primary); font-family: 'Geist Mono', ui-monospace, monospace; letter-spacing: -0.02em; margin-bottom: 10px; }
      .sv-stat-upgrade-link {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--color-primary);
        text-decoration: none;
        opacity: 0.8;
        transition: opacity 0.12s;
      }
      .sv-stat-upgrade-link:hover { opacity: 1; }

      /* ── Seat progress bar ── */
      .sv-seat-bar-track {
        height: 4px;
        border-radius: 100px;
        background: var(--border-color);
        margin-top: 10px;
        overflow: hidden;
      }
      .sv-seat-bar-fill {
        height: 100%;
        border-radius: 100px;
        background: var(--color-primary);
        transition: width 0.4s cubic-bezier(0.4,0,0.2,1);
      }
      .sv-seat-bar-fill.is-full { background: #ef4444; }

      /* ── Locked field (Security email) ── */
      .sv-locked-field {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 9px 14px;
        border: 1px solid var(--border-color);
        border-radius: 8px;
        background: var(--bg-secondary);
        max-width: 100%;
      }
      .sv-locked-field-icon {
        width: 14px;
        height: 14px;
        color: var(--text-muted);
        flex-shrink: 0;
      }
      .sv-locked-field-val {
        font-size: 0.9rem;
        font-weight: 500;
        color: var(--text-primary);
        letter-spacing: -0.01em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sv-locked-field-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        margin-left: 4px;
        padding: 4px 9px;
        border-radius: 5px;
        border: 1px solid var(--border-color);
        background: var(--bg-primary);
        color: var(--text-secondary);
        font-size: 0.78rem;
        font-weight: 500;
        font-family: inherit;
        cursor: pointer;
        flex-shrink: 0;
        transition: background 0.1s, color 0.1s, border-color 0.1s;
      }
      .sv-locked-field-btn:hover { background: var(--bg-tertiary, var(--bg-secondary)); color: var(--text-primary); border-color: color-mix(in srgb, var(--border-color) 60%, var(--text-primary)); }

      /* ── Members table ── */
      .sv-members-search-bar {
        display: flex;
        align-items: center;
        gap: 9px;
        border: 1px solid var(--border-color);
        border-radius: 7px;
        padding: 0 12px;
        background: var(--bg-secondary);
        margin-bottom: 16px;
        max-width: 360px;
      }
      .sv-members-search-bar svg { width: 14px; height: 14px; color: var(--text-muted); flex-shrink: 0; }
      .sv-members-search-bar input { flex: 1; border: none; background: transparent; outline: none; padding: 9px 0; font-size: 0.9rem; color: var(--text-primary); font-family: inherit; }
      .sv-members-table-wrap { border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; }
      .sv-members-table { width: 100%; border-collapse: collapse; text-align: left; }
      .sv-members-table th { font-size: 0.72rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.07em; padding: 11px 16px; border-bottom: 1px solid var(--border-color); background: var(--bg-secondary); }
      .sv-members-table td { padding: 13px 16px; border-bottom: 1px solid var(--border-color); vertical-align: middle; font-size: 0.9rem; }
      .sv-members-table tbody tr:last-child td { border-bottom: none; }
      .sv-members-table tbody tr { transition: background 0.1s; }
      .sv-members-table tbody tr:hover { background: color-mix(in srgb, var(--bg-secondary) 60%, transparent); }
      .sv-table-empty { padding: 48px; text-align: center; color: var(--text-muted); font-size: 0.9rem; }

      .sv-member-cell { display: flex; align-items: center; gap: 12px; }
      .sv-member-avatar {
        width: 30px;
        height: 30px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 700;
        font-size: 0.72rem;
        color: #fff;
        flex-shrink: 0;
        letter-spacing: -0.02em;
      }
      .sv-member-avatar[data-color="0"] { background: linear-gradient(135deg, #3b82f6, #6366f1); }
      .sv-member-avatar[data-color="1"] { background: linear-gradient(135deg, #0d9488, #06b6d4); }
      .sv-member-avatar[data-color="2"] { background: linear-gradient(135deg, #f59e0b, #f97316); }
      .sv-member-avatar[data-color="3"] { background: linear-gradient(135deg, #ec4899, #f43f5e); }
      .sv-member-avatar[data-color="4"] { background: linear-gradient(135deg, #8b5cf6, #a78bfa); }
      .sv-member-avatar[data-color="5"] { background: linear-gradient(135deg, #10b981, #34d399); }
      .sv-member-info { display: flex; flex-direction: column; gap: 2px; }
      .sv-member-name { font-size: 0.9rem; font-weight: 600; color: var(--text-primary); letter-spacing: -0.01em; }
      .sv-member-email { font-size: 0.82rem; color: var(--text-muted); }
      .sv-you-badge { font-size: 0.64rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 3px; padding: 1px 5px; margin-left: 6px; }

      .sv-status-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; margin-right: 6px; }
      .sv-status-dot--active { background: #10b981; }
      .sv-status-dot--invited { background: #f59e0b; }
      .sv-status-text { font-size: 0.86rem; color: var(--text-muted); }



      .sv-member-remove-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: 5px;
        border: none;
        background: transparent;
        color: var(--text-muted);
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.12s, background 0.12s, color 0.12s;
      }
      .sv-members-table tbody tr:hover .sv-member-remove-btn { opacity: 1; }
      .sv-member-remove-btn:hover { background: rgba(220,38,38,0.08); color: #dc2626; }
      .sv-member-actions-cell { text-align: right; width: 48px; }

      /* ── Billing ── */
      .sv-billing-block {
        border: 1px solid var(--border-color);
        border-radius: 10px;
        overflow: hidden;
        background: var(--bg-secondary);
      }
      .sv-billing-plan-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 24px;
        padding: 24px 24px 20px;
        border-bottom: 1px solid var(--border-color);
      }
      .sv-billing-plan-left { display: flex; flex-direction: column; gap: 7px; }
      .sv-billing-plan-name { font-size: 1.05rem; font-weight: 700; color: var(--text-primary); letter-spacing: -0.02em; }
      .sv-billing-plan-desc { font-size: 0.84rem; color: var(--text-muted); line-height: 1.55; max-width: 280px; }

      .sv-billing-price-block {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        flex-shrink: 0;
      }
      .sv-billing-price-amount {
        display: flex;
        align-items: flex-start;
        gap: 2px;
        line-height: 1;
      }
      .sv-billing-price-currency {
        font-size: 1rem;
        font-weight: 700;
        color: var(--text-muted);
        margin-top: 4px;
      }
      .sv-billing-price-number {
        font-size: 2.6rem;
        font-weight: 800;
        color: var(--text-primary);
        letter-spacing: -0.04em;
        line-height: 1;
      }
      .sv-billing-price-meta {
        font-size: 0.76rem;
        color: var(--text-muted);
        font-weight: 500;
        margin-top: 4px;
        text-align: right;
      }

      /* ── Plan tier comparison row ── */
      .sv-billing-tiers {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        border-bottom: 1px solid var(--border-color);
      }
      .sv-billing-tier {
        padding: 16px 20px;
        border-right: 1px solid var(--border-color);
        transition: background 0.12s;
      }
      .sv-billing-tier:last-child { border-right: none; }
      .sv-billing-tier.is-current {
        background: color-mix(in srgb, var(--color-primary) 5%, transparent);
      }
      .sv-billing-tier-top {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
      }
      .sv-billing-tier-name {
        font-size: 0.8rem;
        font-weight: 700;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .sv-billing-tier.is-current .sv-billing-tier-name { color: var(--color-primary); }
      .sv-billing-tier-badge {
        font-size: 0.65rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-primary);
        background: color-mix(in srgb, var(--color-primary) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-primary) 22%, transparent);
        border-radius: 100px;
        padding: 1px 7px;
      }
      .sv-billing-tier-price {
        display: flex;
        align-items: baseline;
        gap: 3px;
        margin-bottom: 4px;
      }
      .sv-billing-tier-amount {
        font-size: 1.3rem;
        font-weight: 800;
        color: var(--text-primary);
        letter-spacing: -0.03em;
      }
      .sv-billing-tier.is-current .sv-billing-tier-amount { color: var(--color-primary); }
      .sv-billing-tier-cadence {
        font-size: 0.75rem;
        color: var(--text-muted);
        font-weight: 500;
      }
      .sv-billing-tier-seats {
        font-size: 0.78rem;
        color: var(--text-muted);
        font-weight: 500;
      }

      .sv-billing-notice {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 13px 24px;
        background: var(--bg-primary);
        font-size: 0.82rem;
        color: var(--text-muted);
        line-height: 1.5;
      }
      .sv-billing-notice svg { width: 13px; height: 13px; flex-shrink: 0; margin-top: 1px; }

      /* ── 2FA status badge ── */
      .sv-2fa-status {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 0.8rem;
        font-weight: 600;
        color: #059669;
        background: rgba(5,150,105,0.08);
        border: 1px solid rgba(5,150,105,0.18);
        border-radius: 100px;
        padding: 3px 9px;
      }

      /* ── Danger zone card ── */
      .sv-danger-callout {
        border: 1px solid rgba(220,38,38,0.25);
        border-radius: 10px;
        background: rgba(220,38,38,0.03);
        overflow: hidden;
      }
      .sv-danger-callout-header {
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 12px 20px;
        background: rgba(220,38,38,0.06);
        border-bottom: 1px solid rgba(220,38,38,0.15);
        font-size: 0.8rem;
        font-weight: 700;
        color: #dc2626;
        letter-spacing: 0.01em;
      }
      .sv-danger-callout-header svg { width: 15px; height: 15px; flex-shrink: 0; }
      .sv-danger-field-row {
        display: flex;
        align-items: center;
        gap: 32px;
        padding: 20px;
      }
      .sv-danger-field-row .sv-field-meta { flex: 0 0 220px; }
      .sv-danger-field-row .sv-field-control { flex: 1; display: flex; justify-content: flex-end; }
      .sv-danger-field-row .sv-field-label { color: var(--text-primary); }
      .sv-danger-divider { height: 1px; background: rgba(220,38,38,0.12); margin: 0 20px; }

      /* ── Invoices ── */
      .sv-invoices-block {
        margin-top: 24px;
        border: 1px solid var(--border-color);
        border-radius: 10px;
        overflow: hidden;
        background: var(--bg-secondary);
      }
      .sv-invoices-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 20px;
        border-bottom: 1px solid var(--border-color);
        background: var(--bg-secondary);
      }
      .sv-invoices-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.88rem;
        font-weight: 700;
        color: var(--text-primary);
        letter-spacing: -0.01em;
      }
      .sv-invoices-title svg { color: var(--text-muted); }
      .sv-invoices-note {
        font-size: 0.76rem;
        color: var(--text-muted);
        font-weight: 500;
      }
      .sv-invoices-table { width: 100%; border-collapse: collapse; }
      .sv-invoices-table th {
        font-size: 0.68rem;
        font-weight: 700;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.07em;
        padding: 10px 16px;
        border-bottom: 1px solid var(--border-color);
        background: var(--bg-primary);
        text-align: left;
      }
      .sv-invoices-table td {
        padding: 12px 16px;
        border-bottom: 1px solid var(--border-color);
        font-size: 0.85rem;
        vertical-align: middle;
      }
      .sv-invoices-table tbody tr:last-child td { border-bottom: none; }
      .sv-invoices-table tbody tr { transition: background 0.1s; }
      .sv-invoices-table tbody tr:hover { background: color-mix(in srgb, var(--bg-primary) 60%, transparent); }
      .sv-invoice-num { font-family: 'Courier New', monospace; font-size: 0.8rem; color: var(--text-muted); font-weight: 600; letter-spacing: 0.02em; }
      .sv-invoice-period { font-size: 0.84rem; color: var(--text-secondary); }
      .sv-invoice-amount { font-size: 0.88rem; font-weight: 700; color: var(--text-primary); letter-spacing: -0.01em; }
      .sv-invoice-status {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 0.74rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        padding: 3px 8px;
        border-radius: 100px;
      }
      .sv-invoice-status.is-paid { background: rgba(5,150,105,0.1); color: #059669; border: 1px solid rgba(5,150,105,0.2); }
      .sv-invoice-status.is-pending { background: rgba(245,158,11,0.1); color: #d97706; border: 1px solid rgba(245,158,11,0.2); }
      .sv-invoice-action-cell { text-align: right; width: 80px; }
      .sv-invoice-dl-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 5px 10px;
        border-radius: 5px;
        border: 1px solid var(--border-color);
        background: var(--bg-primary);
        color: var(--text-secondary);
        font-size: 0.78rem;
        font-weight: 600;
        font-family: inherit;
        cursor: pointer;
        transition: all 0.1s;
        opacity: 0;
      }
      .sv-invoices-table tbody tr:hover .sv-invoice-dl-btn { opacity: 1; }
      .sv-invoice-dl-btn:hover { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }

      /* ── Responsive ── */
      @media (max-width: 860px) {
        .sv-root { flex-direction: column; height: auto; max-height: none; border-radius: 8px; }
        .sv-nav { width: 100%; flex-direction: row; flex-wrap: nowrap; overflow-x: auto; padding: 10px; border-right: none; border-bottom: 1px solid var(--border-color); gap: 2px; }
        .sv-nav-section-label, .sv-nav-divider { display: none; }
        .sv-nav-item { white-space: nowrap; width: auto; padding: 7px 12px; border-radius: 100px; font-size: 0.86rem; }
        .sv-nav-icon { display: none; }
        .sv-content { padding: 28px 20px; }
        .sv-field-row { flex-direction: column; gap: 12px; align-items: flex-start; }
        .sv-field-meta { flex: none; width: 100%; }
        .sv-field-control { justify-content: flex-start; }
        .sv-input-pair { flex-direction: column; }
        .sv-input-pair .sv-input { max-width: 100%; }
        .sv-theme-grid { flex-direction: column; }
        .sv-stat-row { flex-direction: column; }
      }
    `;
    document.head.appendChild(style);
  }

  /* ─────────────── SECTION NAV ─────────────── */
  function setActiveSection(name) {
    document.querySelectorAll('.sv-nav-item').forEach(b => b.classList.toggle('active', b.dataset.section === name));
    document.querySelectorAll('.sv-section').forEach(s => s.style.display = s.dataset.section === name ? 'block' : 'none');
  }
  document.querySelectorAll('.sv-nav-item').forEach(btn => btn.addEventListener('click', () => setActiveSection(btn.dataset.section)));

  /* ─────────────── AUTO-SAVE ─────────────── */
  let saveTimeout;
  const showSaveStatus = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.opacity = '1';
    setTimeout(() => { el.style.opacity = '0'; }, 2500);
  };

  const autoSaveSettings = async (sectionId) => {
    try {
      const firstName = document.getElementById('profile-firstname')?.value?.trim();
      const lastName = document.getElementById('profile-lastname')?.value?.trim();
      const dateFormat = document.querySelector('.sv-date-segmented .is-active')?.dataset?.value || dateFormatPref;
      const emailNotifs = document.getElementById('pref-email-notifs')?.checked || false;

      localStorage.setItem('safitrack_date_format', dateFormat);
      localStorage.setItem('safitrack_email_notifs', emailNotifs ? 'true' : 'false');

      if (typeof supabaseClient !== 'undefined' && currentUser?.id) {
        const updates = {};
        if (firstName) updates.first_name = firstName;
        if (lastName) updates.last_name = lastName;
        updates.date_format = dateFormat;
        updates.email_notifications = emailNotifs;
        const { data: updated, error } = await supabaseClient.from('profiles').update(updates).eq('id', currentUser.id).select().single();
        if (!error) {
          try { currentUserProfile = { ...(currentUserProfile || {}), ...(updated || {}) }; } catch (e) { }
          showSaveStatus(sectionId === 'profile' ? 'profile-save-status' : 'pref-save-status');
          const fName = updated.first_name || '';
          const lName = updated.last_name || '';
          const email = currentUser?.email || '';
          const init = ((fName ? fName[0] : '') + (lName ? lName[0] : '')).toUpperCase() || (email ? email[0].toUpperCase() : 'U');
          const full = [fName, lName].filter(Boolean).join(' ') || 'Your Name';
          document.querySelectorAll('.sv-nav-avatar, .sv-avatar-circle').forEach(el => el.textContent = init);
          document.querySelectorAll('.sv-nav-user-name, .sv-avatar-name').forEach(el => el.textContent = full);
        }
      } else {
        showSaveStatus(sectionId === 'profile' ? 'profile-save-status' : 'pref-save-status');
      }
      if (sectionId !== 'profile') refreshCurrentView();
    } catch (e) { console.error(e); }
  };

  const debounceSave = (sectionId) => {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => autoSaveSettings(sectionId), 700);
  };

  /* ─────────────── DATE SEGMENT ─────────────── */
  document.querySelectorAll('.sv-date-segmented .sv-seg-btn').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.sv-date-segmented .sv-seg-btn').forEach(x => x.classList.remove('is-active'));
    b.classList.add('is-active');
    autoSaveSettings('preferences');
  }));

  /* ─────────────── THEME TILES ─────────────── */
  document.querySelectorAll('.sv-theme-tile').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sv-theme-tile').forEach(x => x.classList.remove('is-active'));
      btn.classList.add('is-active');
      const newTheme = btn.dataset.themeVal;
      localStorage.setItem('safitrack_theme', newTheme);
      let actualTheme = newTheme;
      if (newTheme === 'system') actualTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', actualTheme);
      if (typeof updateChartColors === 'function') setTimeout(updateChartColors, 50);
    });
  });

  /* ─────────────── CHANGE PASSWORD ─────────────── */
  document.getElementById('profile-change-password-btn')?.addEventListener('click', () => {
    try { openChangePasswordModal(); } catch (e) { console.error(e); }
  });

  /* ─────────────── BROWSER NOTIFS ─────────────── */
  document.getElementById('enable-browser-notifs')?.addEventListener('click', async () => {
    try {
      const perm = await Notification.requestPermission();
      showToast(perm === 'granted' ? 'Browser notifications enabled' : 'Browser notifications not enabled', perm === 'granted' ? 'success' : 'warning');
    } catch (e) { showToast('Unable to enable notifications', 'error'); }
  });

  /* ─────────────── DELETE ACCOUNT ─────────────── */
  document.getElementById('delete-account-btn')?.addEventListener('click', () => {
    if (confirm('Delete your account and all owned data? This cannot be undone.'))
      showToast('Account deletion requested. Contact support to complete the process.', 'warning');
  });

  /* ─────────────── EXPORT ─────────────── */
  document.getElementById('export-data-btn')?.addEventListener('click', () => showToast('Preparing export…', 'info'));

  /* ─────────────── INVOICE PDF GENERATOR ─────────────── */
  const loadJsPDF = () => new Promise((resolve, reject) => {
    if (window.jspdf) return resolve(window.jspdf.jsPDF);
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload = () => resolve(window.jspdf.jsPDF);
    s.onerror = reject;
    document.head.appendChild(s);
  });

  const fetchLogoBase64 = () => new Promise((resolve) => {
    fetch('https://safitrack.netlify.app/assets/icons/transparentMain.png')
      .then(r => r.blob())
      .then(blob => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      })
      .catch(() => resolve(null));
  });

  const generateInvoicePDF = async (btn) => {
    const { dataset } = btn;
    const origHTML = btn.innerHTML;
    btn.textContent = '…';
    btn.disabled = true;

    try {
      const [JsPDF, logoDataUrl] = await Promise.all([loadJsPDF(), fetchLogoBase64()]);
      const doc = new JsPDF({ unit: 'pt', format: 'a4' });
      const W = doc.internal.pageSize.getWidth();
      const H = doc.internal.pageSize.getHeight();
      const M = 52; // margin

      // ── Palette ──
      const black = [11, 12, 14];
      const body = [55, 65, 81];
      const muted = [107, 114, 128];
      const label = [156, 163, 175];
      const border = [229, 231, 235];
      const bg = [248, 250, 252];
      const white = [255, 255, 255];
      const accent = [37, 99, 235];
      const green = [5, 150, 105];

      // ── Data ──
      const orgName = currentOrganization?.name || 'Your Organization';
      const invoiceNum = dataset.invoice;
      const periodStart = dataset.periodStart;
      const periodEnd = dataset.periodEnd;
      const planName = dataset.plan;
      const seats = parseInt(dataset.seats || maxSeats, 10);
      const pricePerSeat = parseFloat(planPrice[planName]) || 0;
      const unitPrice = `$${pricePerSeat.toFixed(2)}`;
      const amount = pricePerSeat === 0 ? '$0.00' : `$${(pricePerSeat * seats).toFixed(2)}`;
      const issueDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

      // helpers
      const setLabel = (x, y) => { doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...label); };
      const setBody = (bold = false) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(9.5); doc.setTextColor(...body); };

      // ── White bg ──
      doc.setFillColor(...white); doc.rect(0, 0, W, H, 'F');

      // ── Top blue bar ──
      doc.setFillColor(...accent); doc.rect(0, 0, W, 3, 'F');

      // ── Logo ──
      if (logoDataUrl) {
        const img = new Image();
        img.src = logoDataUrl;
        await new Promise(r => { img.onload = r; img.onerror = r; });
        const lh = 30, lw = lh * (img.naturalWidth / img.naturalHeight || 4);
        doc.addImage(logoDataUrl, 'PNG', M, 18, lw, lh);
      } else {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(...accent);
        doc.text('SafiTrack', M, 40);
      }

      // ── INVOICE heading ──
      doc.setFont('helvetica', 'bold'); doc.setFontSize(32); doc.setTextColor(...black);
      doc.text('INVOICE', W - M, 40, { align: 'right' });

      // ── Divider ──
      doc.setDrawColor(...border); doc.setLineWidth(0.6);
      doc.line(M, 58, W - M, 58);

      // ══════════════════════════════
      // META  —  3 columns
      // ══════════════════════════════
      const mY = 78;
      const c1 = M, c2 = M + 178, c3 = M + 370;

      // helper: stacked label+value
      const metaBlock = (lbl, lines, x, y) => {
        setLabel(x, y); doc.text(lbl.toUpperCase(), x, y);
        lines.forEach((ln, i) => {
          setBody(i === 0);          // first line bold (name), rest normal
          doc.text(ln, x, y + 13 + i * 14);
        });
      };

      metaBlock('From', ['SafiTrack Inc.', 'Toronto, Ontario', 'Canada', 'support@safitrack.netlify.app'], c1, mY);
      metaBlock('Bill to', [orgName, currentUser?.email || ''].filter(Boolean), c2, mY);

      // Right column — stacked pairs, all labels in muted gray
      let ry = mY;
      const detailRow = (lbl, val) => {
        setLabel(c3, ry); doc.text(lbl.toUpperCase(), c3, ry);
        ry += 12; setBody(false); doc.text(val, c3, ry); ry += 18;
      };
      detailRow('Invoice number', invoiceNum);
      detailRow('Date of issue', issueDate);
      detailRow('Period', `${periodStart} – ${periodEnd}`);

      // ══════════════════════════════
      // AMOUNT DUE HERO
      // ══════════════════════════════
      const heroY = mY + 84;
      doc.setFillColor(...bg);
      doc.roundedRect(M, heroY, W - M * 2, 60, 5, 5, 'F');

      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...muted);
      doc.text('Amount due', M + 16, heroY + 18);

      doc.setFont('helvetica', 'bold'); doc.setFontSize(26); doc.setTextColor(...black);
      doc.text(`${amount} USD`, M + 16, heroY + 46);

      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...muted);
      doc.text(`Due ${issueDate}`, W - M - 16, heroY + 36, { align: 'right' });

      // ══════════════════════════════
      // LINE ITEMS TABLE
      // ══════════════════════════════
      const tY = heroY + 80;
      const tW = W - M * 2;
      const cDesc = M;
      const cQty = M + 318;
      const cUnit = M + 390;
      const cAmt = W - M;

      // Header
      doc.setFillColor(...bg);
      doc.rect(M, tY, tW, 24, 'F');
      doc.setDrawColor(...border); doc.setLineWidth(0.5);
      doc.line(M, tY, W - M, tY);
      doc.line(M, tY + 24, W - M, tY + 24);

      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...muted);
      doc.text('DESCRIPTION', cDesc + 4, tY + 15.5);
      doc.text('QTY', cQty, tY + 15.5);
      doc.text('UNIT PRICE', cUnit, tY + 15.5);
      doc.text('AMOUNT', cAmt, tY + 15.5, { align: 'right' });

      // Row
      const rY = tY + 24;
      doc.setFillColor(...white); doc.rect(M, rY, tW, 48, 'F');

      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...black);
      doc.text(`${planName} Plan (per seat)`, cDesc + 4, rY + 17);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...muted);
      doc.text(`${periodStart} – ${periodEnd}`, cDesc + 4, rY + 31);

      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...body);
      doc.text(String(seats), cQty, rY + 17);
      doc.text(unitPrice, cUnit, rY + 17);
      doc.text(amount, cAmt, rY + 17, { align: 'right' });

      doc.setDrawColor(...border);
      doc.line(M, rY + 48, W - M, rY + 48);

      // Totals — Subtotal / Total  (no Tax row, matching Attio)
      let totY = rY + 66;
      const totals = [
        ['Subtotal', amount, false],
        ['Total', amount, false],
        ['Amount due', amount, true],
      ];
      totals.forEach(([lbl, val, bold]) => {
        if (bold) {
          doc.setFillColor(...bg);
          doc.rect(M + tW * 0.52, totY - 13, tW * 0.48, 22, 'F');
        }
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        doc.setFontSize(bold ? 10 : 9.5);
        doc.setTextColor(...(bold ? black : body));
        doc.text(lbl, M + tW * 0.54, totY);
        doc.text(val, cAmt, totY, { align: 'right' });
        totY += 22;
      });

      // ── PAID badge ──
      const badgeY = totY + 24;
      doc.setFillColor(...green);
      doc.roundedRect(M, badgeY, 58, 22, 5, 5, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...white);
      doc.text('PAID', M + 29, badgeY + 14.5, { align: 'center' });

      // ── Footer ──
      const fY = H - 46;
      doc.setDrawColor(...border); doc.setLineWidth(0.5);
      doc.line(M, fY, W - M, fY);

      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...muted);
      doc.text('SafiTrack Inc. · Toronto, Ontario, Canada · support@safitrack.netlify.app', M, fY + 14);
      doc.setTextColor(...accent);
      doc.textWithLink('Terms & Conditions', M, fY + 27, { url: 'https://safitrack.netlify.app/pages/legal/terms' });
      doc.setTextColor(...muted);
      doc.text('  ·  All amounts in USD', M + doc.getTextWidth('Terms & Conditions') + 2, fY + 27);
      doc.text('Page 1 of 1', W - M, fY + 27, { align: 'right' });

      doc.save(`SafiTrack-Invoice-${invoiceNum}.pdf`);

    } catch (e) {
      console.error(e);
      showToast('Failed to generate invoice PDF', 'error');
    } finally {
      btn.innerHTML = origHTML;
      btn.disabled = false;
    }
  };

  document.querySelectorAll('.sv-invoice-dl-btn').forEach(btn => {
    btn.addEventListener('click', () => generateInvoicePDF(btn));
  });

  /* ─────────────── ORG RENAME ─────────────── */
  document.getElementById('sv-org-name-edit-trigger')?.addEventListener('click', () => {
    const form = document.getElementById('sv-org-rename-form');
    if (!form) return;
    form.style.display = 'block';
    document.getElementById('org-name-input')?.focus();
    document.getElementById('sv-org-name-edit-trigger').style.display = 'none';
  });

  document.getElementById('sv-org-rename-cancel')?.addEventListener('click', () => {
    const form = document.getElementById('sv-org-rename-form');
    if (form) form.style.display = 'none';
    const trigger = document.getElementById('sv-org-name-edit-trigger');
    if (trigger) trigger.style.display = '';
    const input = document.getElementById('org-name-input');
    if (input) input.value = currentOrganization?.name || '';
  });

  document.getElementById('org-name-save-btn')?.addEventListener('click', async () => {
    const input = document.getElementById('org-name-input');
    const btn = document.getElementById('org-name-save-btn');
    if (!input || !currentOrganization?.id) return;
    const newName = input.value.trim();
    if (!newName) { showToast('Organization name cannot be empty.', 'error'); return; }
    if (newName === currentOrganization.name) { showToast('No changes to save.', 'info'); return; }
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const { data, error } = await supabaseClient.from('organizations').update({ name: newName }).eq('id', currentOrganization.id).select('name').single();
      if (error) throw error;
      if (!data) throw new Error('Update blocked — no rows returned. Check RLS policy.');
      currentOrganization.name = data.name;
      document.querySelectorAll('.org-name-display').forEach(el => el.textContent = data.name);
      const orgNameEl = document.getElementById('org-name');
      if (orgNameEl) orgNameEl.textContent = data.name;
      const headerOrgEl = document.getElementById('header-org-name');
      if (headerOrgEl) headerOrgEl.textContent = data.name;
      const wsBtnName = document.getElementById('ws-btn-org-name');
      if (wsBtnName) wsBtnName.textContent = data.name.length > 16 ? data.name.slice(0, 16) + '\u2026' : data.name;
      const wsBtnAvatar = document.getElementById('ws-btn-avatar');
      if (wsBtnAvatar) wsBtnAvatar.textContent = data.name[0].toUpperCase();
      const cardName = document.querySelector('.sv-org-identity-name');
      if (cardName) cardName.textContent = data.name;
      const form = document.getElementById('sv-org-rename-form');
      if (form) form.style.display = 'none';
      const trigger = document.getElementById('sv-org-name-edit-trigger');
      if (trigger) trigger.style.display = '';
      showToast('Organization name updated.', 'success');
    } catch (e) {
      console.error(e);
      showToast('Failed to update organization name.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save';
    }
  });

  /* ─────────────── INPUT DEBOUNCE ─────────────── */
  document.getElementById('profile-firstname')?.addEventListener('input', () => debounceSave('profile'));
  document.getElementById('profile-lastname')?.addEventListener('input', () => debounceSave('profile'));
  document.getElementById('pref-email-notifs')?.addEventListener('change', () => autoSaveSettings('preferences'));

  /* ─────────────── LOAD MEMBERS ─────────────── */
  const loadMembers = async () => {
    const listContainer = document.getElementById('sv-members-container');
    if (!listContainer || typeof supabaseClient === 'undefined') return;
    listContainer.innerHTML = `<tr><td colspan="4" class="sv-table-empty">Loading…</td></tr>`;

    const orgId = currentOrganization?.id;
    let pQ = supabaseClient.from('profiles').select('*').order('created_at', { ascending: false });
    if (orgId) pQ = pQ.eq('organization_id', orgId);

    const [profilesResult, invitesResult] = await Promise.all([
      pQ,
      isManager
        ? supabaseClient.from('invitations').select('*').eq('status', 'pending').order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (profilesResult.error) {
      listContainer.innerHTML = `<tr><td colspan="4" class="sv-table-empty" style="color:#dc2626;">Failed to load members: ${escH(profilesResult.error.message)}</td></tr>`;
      return;
    }

    const users = profilesResult.data || [];
    const invites = invitesResult.data || [];

    if (!users.length && !invites.length) {
      listContainer.innerHTML = `<tr><td colspan="4" class="sv-table-empty">No members yet. Invite your team!</td></tr>`;
      return;
    }

    const roleLabel = r => r === 'manager' ? 'Manager' : r === 'sales_rep' ? 'Sales Rep' : r === 'technician' ? 'Technician' : 'Member';
    const roleChip = r => `<span class="sv-role-chip" data-role="${r || 'member'}">${roleLabel(r)}</span>`;
    const nameColor = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 6; };

    const memberRows = users.map(u => {
      const uFullName = (`${u.first_name || ''} ${u.last_name || ''}`).trim() || u.email || 'Teammate';
      const uInitials = getInitials(uFullName);
      const isMe = u.id === currentUser?.id;
      const actionsHtml = (isManager && !isMe)
        ? `<button class="sv-member-remove-btn" title="Remove member" onclick="if(typeof deleteUser==='function') deleteUser('${u.id}','${uFullName.replace(/'/g, "\\'")}','${u.role || ''}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`
        : '';
      return `
        <tr>
          <td><div class="sv-member-cell">
            <div class="sv-member-avatar" data-color="${nameColor(uFullName)}">${escH(uInitials)}</div>
            <div class="sv-member-info">
              <div class="sv-member-name">${escH(uFullName)}${isMe ? '<span class="sv-you-badge">You</span>' : ''}</div>
              <div class="sv-member-email">${escH(u.email || '')}</div>
            </div>
          </div></td>
          <td>${roleChip(u.role)}</td>
          <td><span class="sv-status-dot sv-status-dot--active"></span><span class="sv-status-text">Active</span></td>
          <td class="sv-member-actions-cell">${actionsHtml}</td>
        </tr>`;
    });

    const inviteRows = invites.map(inv => {
      const initials = (inv.email || '?')[0].toUpperCase();
      const revokeHtml = isManager
        ? `<button class="sv-member-remove-btn" title="Revoke invitation"
              onclick="(async()=>{if(!confirm('Revoke this invitation?'))return;const{error}=await supabaseClient.from('invitations').update({status:'revoked'}).eq('id','${inv.id}');if(!error){this.closest('tr').remove();showToast('Invitation revoked','info');}else{showToast('Failed to revoke: '+error.message,'error');}})()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>` : '';
      return `
        <tr style="opacity:0.65;">
          <td><div class="sv-member-cell">
            <div class="sv-member-avatar" data-color="${nameColor(inv.email || '?')}">${escH(initials)}</div>
            <div class="sv-member-info">
              <div class="sv-member-name">${escH(inv.email)}</div>
              <div class="sv-member-email">Invite sent · expires ${new Date(inv.expires_at).toLocaleDateString()}</div>
            </div>
          </div></td>
          <td>${roleChip(inv.role)}</td>
          <td><span class="sv-status-dot sv-status-dot--invited"></span><span class="sv-status-text">Pending</span></td>
          <td class="sv-member-actions-cell">${revokeHtml}</td>
        </tr>`;
    });

    listContainer.innerHTML = [...memberRows, ...inviteRows].join('');

    if (currentOrganization) {
      const total = users.length + invites.length;
      const maxSlots = currentOrganization.max_members || 2;
      const usedSlotsEl = document.querySelector('.sv-usage-labels span:last-child');
      const usageBarEl = document.querySelector('.sv-usage-fill');
      if (usedSlotsEl) usedSlotsEl.textContent = `${total} / ${maxSlots}`;
      if (usageBarEl) usageBarEl.style.width = `${Math.min(100, Math.round((total / maxSlots) * 100))}%`;
      // Update org stats tile seat bar
      const seatCount = document.getElementById('sv-seat-count');
      const seatBar = document.getElementById('sv-seat-bar');
      if (seatCount) seatCount.textContent = `${total} / ${maxSlots}`;
      if (seatBar) {
        const pct = Math.min(100, Math.round((total / maxSlots) * 100));
        seatBar.style.width = `${pct}%`;
        if (pct >= 100) seatBar.classList.add('is-full');
      }

      // Update invoice rows now that we know actual used seats
      const pricePerSeat = parseFloat(planPrice[currentPlan]) || 0;
      const invoiceTotal = pricePerSeat === 0 ? '$0.00' : `$${(pricePerSeat * total).toFixed(2)}`;
      document.querySelectorAll('.sv-invoice-dl-btn').forEach(btn => {
        btn.dataset.amount = invoiceTotal;
        btn.dataset.seats = String(total);
      });
      document.querySelectorAll('.sv-invoice-amount').forEach(el => {
        el.textContent = invoiceTotal;
      });
    }

    const searchInput = document.getElementById('sv-member-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase();
        document.querySelectorAll('#sv-members-container tr').forEach(row => {
          const text = row.querySelector('.sv-member-cell')?.textContent?.toLowerCase() || '';
          row.style.display = text.includes(val) ? '' : 'none';
        });
      });
    }
  };

  loadMembers();

  const _initSection = _pendingSettingsSection || 'profile';
  _pendingSettingsSection = null;
  setActiveSection(_initSection);
}


async function renderCompaniesView() {
  const companiesState = tableViewState.companies;
  currentFilters.company_type = companiesState.companyType || '';

  // Restore per-view sort — avoids sorting from another view leaking in
  currentSortKey = companiesState.sortKey || 'name';
  currentSortDir = companiesState.sortDir || 'asc';

  const sortableCompanyColumns = ['name', 'address', 'company_type'];
  const safeSortKey = sortableCompanyColumns.includes(currentSortKey) ? currentSortKey : 'name';
  if (currentSortKey !== safeSortKey) {
    currentSortKey = safeSortKey;
    currentSortDir = 'asc';
  }

  // Fetch all companies (we'll paginate in the UI)
  // Primary query includes category relation for industry labels.
  let companies = [];
  let error = null;

  let primaryQ = supabaseClient
    .from('companies')
    .select(`*, company_categories(categories(id, name))`)
    .order(safeSortKey, { ascending: currentSortDir === 'asc' });
  if (currentOrganization?.id) primaryQ = primaryQ.eq('organization_id', currentOrganization.id);
  const primaryQuery = await primaryQ;

  companies = primaryQuery.data || [];
  error = primaryQuery.error;
  crmDebugLog('renderCompaniesView.primaryQuery', {
    error,
    count: companies.length,
    sample: companies.length > 0 ? companies[0] : null
  });

  // Fallback: if relation query returns no rows without an explicit error,
  // retry a flat companies query so table data is never blocked by relation access.
  if (!error && companies.length === 0) {
    let fallbackQ = supabaseClient.from('companies').select('*').order(safeSortKey, { ascending: currentSortDir === 'asc' });
    if (currentOrganization?.id) fallbackQ = fallbackQ.eq('organization_id', currentOrganization.id);
    const fallbackQuery = await fallbackQ;

    crmDebugLog('renderCompaniesView.fallbackQuery', {
      error: fallbackQuery.error || null,
      count: Array.isArray(fallbackQuery.data) ? fallbackQuery.data.length : 0,
      sample: Array.isArray(fallbackQuery.data) && fallbackQuery.data.length > 0 ? fallbackQuery.data[0] : null
    });

    if (!fallbackQuery.error && Array.isArray(fallbackQuery.data) && fallbackQuery.data.length > 0) {
      companies = fallbackQuery.data;
    }
  }

  if (error) {
    crmDebugLog('renderCompaniesView.error', error);
    viewContainer.innerHTML = renderError(error.message);
    return;
  }

  // Store for global access
  window.allCompaniesData = Array.isArray(companies) ? companies : [];
  crmDebugLog('renderCompaniesView.window.allCompaniesData', {
    count: window.allCompaniesData.length,
    sample: window.allCompaniesData.length > 0 ? window.allCompaniesData[0] : null
  });

  // Initial pagination state
  let currentPage = companiesState.currentPage || 1;
  const recordsPerPage = 15; // Number of records per page
  let searchQuery = companiesState.searchQuery || ''; // Separate search state

  // Function to render the companies table
  function renderCompaniesTable(companiesToRender, paginationInfo) {
    const allowEditDelete = !isSalesRep;
    const columns = [
      { key: 'rank', label: '#', width: '50px', readOnly: true, sortable: false, render: (val, row) => (paginationInfo.currentPage - 1) * paginationInfo.recordsPerPage + companiesToRender.indexOf(row) + 1 },
      {
        key: 'name', label: 'Company Name', width: '300px', icon: 'building', sortable: true, readOnly: isSalesRep, render: (val, row) => {
          const domain = (row && row.domain) ? row.domain : '';
          const logoUrl = getCompanyLogoUrl(domain);
          const initials = getInitials(row.name || '');
          return `
            <div style="display:flex;align-items:center;gap:10px;">
              <div style="width:28px;height:28px;flex-shrink:0;position:relative;">
                <div class="mention-avatar">${initials}</div>
                ${logoUrl ? `<img src="${logoUrl}" style="display:none;width:28px;height:28px;object-fit:contain;border-radius:50%;position:absolute;left:0;top:0;" onload="this.style.display='block'; this.previousElementSibling.style.display='none'" onerror="this.style.display='none'" />` : ''}
              </div>
              <div style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${row.name || '-'}</div>
            </div>
          `;
        }
      },
      { key: 'industry', label: 'Industry', width: '150px', readOnly: true, icon: 'briefcase', sortable: false, render: (val, row) => val || row.company_categories?.map(c => c.categories.name).join(', ') || 'N/A' },
      { key: 'address', label: 'Location', width: '190px', icon: 'map-pin', readOnly: isSalesRep },
      {
        key: 'company_type',
        label: 'Type',
        width: '120px',
        icon: 'tag',
        sortable: true,
        type: 'select',
        readOnly: isSalesRep,
        options: ['Competitor', 'Customer', 'Distributor', 'Investor', 'Partner', 'Reseller', 'Supplier', 'Vendor', 'Other']
      },
      {
        key: 'actions', label: 'Actions', width: '120px', readOnly: true, sortable: false, render: (val, row) => {
          let buttons = `<button class="action-btn view-company" data-id="${row.id}" title="View company"><i data-lucide="eye"></i></button>`;
          if (allowEditDelete) {
            buttons += `<button class="action-btn edit-company" data-id="${row.id}" title="Edit company"><i data-lucide="square-pen"></i></button>`;
            buttons += `<button class="action-btn delete-company" data-id="${row.id}" title="Delete company"><i data-lucide="trash-2"></i></button>`;
          }
          return `<div class="table-actions">${buttons}</div>`;
        }}
    ];

    let html = `


      <div class="view-toolbar">
        <div class="search-container u-flex-1 u-maxw-320">
          <i data-lucide="search" class="u-icon-16 u-search-icon-muted"></i>
          <input type="text" id="companies-search" placeholder="Search companies...">
          <div id="clear-companies-search" class="search-clear-btn hidden" title="Clear search">
            <i data-lucide="x" class="u-icon-16"></i>
          </div>
        </div>
        
        <div class="u-flex-1"></div>

        ${isSalesRep ? '' : `
        <button class="toolbar-btn" id="companies-import-export-btn">
          <i data-lucide="file-up"></i> Import / Export
        </button>
    `}

        <button class="toolbar-btn toolbar-btn-primary" id="add-company-btn">
          <i data-lucide="plus" class="u-icon-16"></i> New Company
        </button>
      </div>
      
      ${renderEditableDataTable(companiesToRender, columns, 'companies-spreadsheet', 'companies')}
      
      <div id="companies-pagination" class="u-p-md"></div>
    `;

    viewContainer.innerHTML = html;

    // Initialize Lucide icons immediately
    if (window.lucide) lucide.createIcons();

    // Restore search value after rendering
    const searchInput = document.getElementById('companies-search');
    if (searchInput && searchInput.value !== searchQuery) {
      searchInput.value = searchQuery;
    }

    // Create pagination controls
    createPaginationControls(
      paginationInfo.currentPage,
      paginationInfo.totalPages,
      paginationInfo.totalRecords,
      paginationInfo.recordsPerPage,
      'companies-pagination',
      (newPage) => {
        currentPage = newPage;
        companiesState.currentPage = currentPage;
        saveViewState({ companies: companiesState });
        const result = searchAndPaginate(
          window.allCompaniesData,
          searchQuery,
          currentPage,
          recordsPerPage,
          (item, query) => filterAndSearchCompany(item, query)
        );
        renderCompaniesTable(result.data, result);
      }
    );

    // Initialize event listeners
    initializeCompaniesEventListeners();
  }

  // Separate function to initialize event listeners
  function initializeCompaniesEventListeners() {

    if (!isSalesRep) {
      document.getElementById('companies-import-export-btn')?.addEventListener('click', () => {
        openCompaniesImportExportModal();
      });
    }

    const searchInput = document.getElementById('companies-search');
    if (searchInput) {
      // Remove any existing listeners by cloning and replacing
      const newSearchInput = searchInput.cloneNode(true);
      searchInput.parentNode.replaceChild(newSearchInput, searchInput);

      // Add new listener
      newSearchInput.addEventListener('input', (e) => {
        // Store the current cursor position
        const cursorPosition = e.target.selectionStart;
        const searchValue = e.target.value;

        searchQuery = searchValue;
        companiesState.searchQuery = searchQuery;
        saveViewState({ companies: companiesState });

        // Use a small delay to avoid too many rapid searches
        clearTimeout(newSearchInput.searchTimeout);
        newSearchInput.searchTimeout = setTimeout(() => {
          currentPage = 1; // Reset to first page when searching
          companiesState.currentPage = currentPage;
          saveViewState({ companies: companiesState });
          const result = searchAndPaginate(
            window.allCompaniesData,
            searchQuery,
            currentPage,
            recordsPerPage,
            (item, query) => filterAndSearchCompany(item, query)
          );

          // Store the active element and cursor position before re-rendering
          const activeElement = document.activeElement;
          const wasSearchInput = activeElement && activeElement.id === 'companies-search';

          renderCompaniesTable(result.data, result);

          // Restore focus and cursor position to the search input if it was the active element
          if (wasSearchInput) {
            setTimeout(() => {
              const searchElement = document.getElementById('companies-search');
              searchElement.focus();
              // Set the cursor position to where it was before
              searchElement.setSelectionRange(cursorPosition, cursorPosition);
            }, 0);
          }
        }, 300); // 300ms delay
      });
    }
    // Add company button
    document.getElementById('add-company-btn')?.addEventListener('click', () => {
      openCompanyModal();
    });

    // View, edit and delete buttons
    document.querySelectorAll('.view-company').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const companyId = btn.dataset.id;
        const company = window.allCompaniesData.find(c => c.id === companyId);
        if (company) {
          openCompanyViewModal(company);
        }
      });
    });

    if (!isSalesRep) {
      document.querySelectorAll('.edit-company').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const companyId = btn.dataset.id;
          const company = window.allCompaniesData.find(c => c.id === companyId);
          if (company) {
            openCompanyModal(company);
          }
        });
      });

      document.querySelectorAll('.delete-company').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const companyId = btn.dataset.id;
          const company = window.allCompaniesData.find(c => c.id === companyId);

          const confirmed = await showConfirmDialog(
            'Delete Company',
            `Are you sure you want to delete ${company.name}?`
          );

          if (!confirmed) return;

          const { error } = await supabaseClient
            .from('companies')
            .delete()
            .eq('id', companyId);

        if (error) {
          showToast('Error deleting company: ' + error.message, 'error');
          return;
        }

        // Remove from local data and refresh
        window.allCompaniesData = window.allCompaniesData.filter(c => c.id !== companyId);

        showToast('Company deleted successfully', 'success');

        // Re-render with current page
        const result = searchAndPaginate(
          window.allCompaniesData,
          searchQuery,
          currentPage,
          recordsPerPage,
          (item, query) => filterAndSearchCompany(item, query)
        );

        // Adjust current page if necessary
        if (result.data.length === 0 && result.currentPage > 1) {
          currentPage--;
          const adjustedResult = searchAndPaginate(
            window.allCompaniesData,
            searchQuery,
            currentPage,
            recordsPerPage,
            (item, query) => filterAndSearchCompany(item, query)
          );
          renderCompaniesTable(adjustedResult.data, adjustedResult);
        } else {
          renderCompaniesTable(result.data, result);
        }
      });
    });
    } // end if (!isSalesRep)

    // Clear search event
    const clearSearchBtn = document.getElementById('clear-companies-search');
    if (clearSearchBtn) {
      if (searchQuery) clearSearchBtn.classList.remove('hidden');
      clearSearchBtn.onclick = () => {
        searchQuery = '';
        companiesState.searchQuery = searchQuery;
        searchInput.value = '';
        clearSearchBtn.classList.add('hidden');
        currentPage = 1;
        companiesState.currentPage = currentPage;
        saveViewState({ companies: companiesState });
        const result = searchAndPaginate(
          window.allCompaniesData,
          searchQuery,
          1,
          recordsPerPage,
          (item, query) => filterAndSearchCompany(item, query)
        );
        renderCompaniesTable(result.data, result);
      };
    }

    // Company type filter event
    const typeFilter = document.getElementById('company-type-filter');
    if (typeFilter) {
      typeFilter.value = currentFilters.company_type || '';
      typeFilter.onchange = (e) => {
        currentFilters.company_type = e.target.value;
        companiesState.companyType = currentFilters.company_type;
        currentPage = 1;
        companiesState.currentPage = currentPage;
        saveViewState({ companies: companiesState });
        const result = searchAndPaginate(
          window.allCompaniesData,
          searchQuery,
          1,
          recordsPerPage,
          (item, query) => filterAndSearchCompany(item, query)
        );
        renderCompaniesTable(result.data, result);
      };
    }

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        companiesState.searchQuery = searchQuery;
        if (searchQuery) {
          clearSearchBtn?.classList.remove('hidden');
        } else {
          clearSearchBtn?.classList.add('hidden');
        }

        currentPage = 1;
        companiesState.currentPage = currentPage;
        const result = searchAndPaginate(
          window.allCompaniesData,
          searchQuery,
          1,
          recordsPerPage,
          (item, query) => filterAndSearchCompany(item, query)
        );
        renderCompaniesTable(result.data, result);
      });
    }

    // Sort event
    const sortBtn = document.getElementById('companies-sort-btn');
    if (sortBtn) {
      sortBtn.onclick = () => {
        handleHeaderSort('name');
      };
    }
  }

  // Helper for combined filter/search

  // Initialize Lucide icons
  if (window.lucide) lucide.createIcons();
  // Initial data processing
  const initialData = searchAndPaginate(
    window.allCompaniesData,
    searchQuery,
    currentPage,
    recordsPerPage,
    (item, query) => filterAndSearchCompany(item, query)
  );
  renderCompaniesTable(initialData.data, initialData);

  // Explicitly initialize icons after rendering table
  if (window.lucide) lucide.createIcons();
  // Helper for combined filter/search
  function filterAndSearchCompany(company, query) {
    if (currentFilters.company_type && company.company_type !== currentFilters.company_type) return false;
    if (!query) return true;
    return matchesTokenizedQuery(
      query,
      company.name,
      company.description,
      company.address
    );
  }
}



// Update the openCompanyModal function to use the global data
function openCompanyModal(company = null) {
  const modal = document.getElementById('company-modal');
  const modalTitle = document.getElementById('company-modal-title');
  const saveBtn = document.getElementById('save-company-btn');
  const addMoreWrapper = document.getElementById('company-add-more-wrapper');

  // Reset form
  document.getElementById('company-name-input').value = '';
  document.getElementById('company-type').value = '';
  document.getElementById('company-description').value = '';
  document.getElementById('company-domain') && (document.getElementById('company-domain').value = '');
  document.getElementById('company-address').value = '';
  document.getElementById('company-latitude').value = '';
  document.getElementById('company-longitude').value = '';
  document.getElementById('company-radius').value = '200';

  // Clear categories
  document.getElementById('categories-container').innerHTML = '<input type="text" class="categories-input" id="categories-input" placeholder="Add category...">';
  companyCategories = [];

  // Set modal title and show manual coordinates section
  const salesRepViewOnly = company && isSalesRep;
  if (company) {
    modalTitle.innerHTML = salesRepViewOnly ? 'View Company' : 'Edit Company';
    if (addMoreWrapper) addMoreWrapper.style.display = 'none';

    // Fill form with company data
    document.getElementById('company-name-input').value = company.name || '';
    document.getElementById('company-type').value = company.company_type || '';
    document.getElementById('company-description').value = company.description || '';
    document.getElementById('company-domain') && (document.getElementById('company-domain').value = company.domain || '');
    document.getElementById('company-address').value = company.address || '';
    document.getElementById('company-latitude').value = company.latitude?.toString() || '';
    document.getElementById('company-longitude').value = company.longitude?.toString() || '';
    document.getElementById('company-radius').value = company.radius?.toString() || '200';

    // Fill categories
    if (company.company_categories && company.company_categories.length > 0) {
      company.company_categories.forEach(c => {
        addCategory(c.categories.name);
      });
    }
  } else {
    modalTitle.innerHTML = 'New Company';
    if (addMoreWrapper) addMoreWrapper.style.display = 'inline-flex';
  }

  // Show modal
  modal.style.display = 'flex';
  document.body.classList.add('modal-active');

  // Initialize event listeners
  initCompanyModalListeners(company, salesRepViewOnly);
}


function initCompanyModalListeners(company, viewOnly = false) {
  const categoriesInput = document.getElementById('categories-input');
  const saveBtn = document.getElementById('save-company-btn');
  const companyNameInput = document.getElementById('company-name-input');
  const duplicateWarning = document.getElementById('company-duplicate-warning');

  // disable editing if viewOnly (sales rep opening existing company)
  if (viewOnly) {
    // hide save button and disable all inputs/selects/textareas
    if (saveBtn) saveBtn.style.display = 'none';
    const inputs = document.querySelectorAll('#company-modal input, #company-modal select, #company-modal textarea, #company-modal button');
    inputs.forEach(el => {
      // keep close/cancel buttons enabled
      if (el.id === 'cancel-company-btn' || el.classList.contains('modal-close')) return;
      el.disabled = true;
    });
  }

  function updateCompanyDuplicateState() {
    if (company) {
      if (duplicateWarning) {
        duplicateWarning.textContent = '';
        duplicateWarning.classList.add('hidden');
      }
      return false;
    }

    const duplicate = findDuplicateCompanyByName(companyNameInput?.value || '');
    if (duplicateWarning) {
      if (duplicate) {
        duplicateWarning.textContent = `Duplicate detected: ${duplicate.name}`;
        duplicateWarning.classList.remove('hidden');
      } else {
        duplicateWarning.textContent = '';
        duplicateWarning.classList.add('hidden');
      }
    }

    return Boolean(duplicate);
  }

  // Get buttons after they exist in the DOM
  const geocodeBtn = document.getElementById('geocode-address-btn');
  const useCurrentLocationBtn = document.getElementById('use-current-location-btn');

  // Categories input
  categoriesInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && categoriesInput.value.trim()) {
      e.preventDefault();
      addCategory(categoriesInput.value.trim());
      categoriesInput.value = '';
    }
  });

  if (companyNameInput) {
    companyNameInput.addEventListener('input', updateCompanyDuplicateState);
  }

  updateCompanyDuplicateState();

  // Geocode button (Updated to use OpenStreetMap Nominatim)
  if (geocodeBtn) {
    const newGeocodeBtn = geocodeBtn.cloneNode(true);
    geocodeBtn.parentNode.replaceChild(newGeocodeBtn, geocodeBtn);

    newGeocodeBtn.addEventListener('click', async () => {
      const addressInput = document.getElementById('company-address');
      const address = addressInput.value.trim();

      if (!address) {
        showToast('Please enter an address to geocode', 'error');
        return;
      }

      // Set loading state
      newGeocodeBtn.disabled = true;
      newGeocodeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Geocoding...';

      try {
        // CALL THE NEW NOMINATIM FUNCTION
        const geo = await geocodeAddressWithOSM(address);

        // Update coordinates fields
        document.getElementById('company-latitude').value = geo.latitude.toFixed(6);
        document.getElementById('company-longitude').value = geo.longitude.toFixed(6);
        document.getElementById('company-radius').value = '200';

        // Hide manual coordinate input section
        const manualCoordsSection = document.getElementById('manual-coords-section');
        if (manualCoordsSection) {
          manualCoordsSection.classList.add('hidden');
        }

        showToast(`Address found: ${geo.displayName}`, 'success');

      } catch (error) {
        showToast(error.message, 'error');
      } finally {
        // Restore button state
        newGeocodeBtn.disabled = false;
        newGeocodeBtn.innerHTML = `
          Search Address
        `;
      }
    });
  }

  // Use current location button
  if (useCurrentLocationBtn) {
    const newUseLocationBtn = useCurrentLocationBtn.cloneNode(true);
    useCurrentLocationBtn.parentNode.replaceChild(newUseLocationBtn, useCurrentLocationBtn);

    newUseLocationBtn.addEventListener('click', () => {
      if (navigator.geolocation) {
        newUseLocationBtn.disabled = true;
        newUseLocationBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Getting location...';

        navigator.geolocation.getCurrentPosition(
          (position) => {
            const { latitude, longitude } = position.coords;
            document.getElementById('company-latitude').value = latitude.toFixed(6);
            document.getElementById('company-longitude').value = longitude.toFixed(6);
            document.getElementById('company-radius').value = '200';

            // Hide manual section
            document.getElementById('manual-coords-section').classList.add('hidden');

            showToast('Current location set successfully', 'success');
          },
          (error) => {
            showToast('Unable to get location', 'error');
          },
          { enableHighAccuracy: true, timeout: 10000 }
        );
      } else {
        showToast('Geolocation not supported', 'error');
      }

      newUseLocationBtn.disabled = false;
      newUseLocationBtn.innerHTML = 'Use Current Location';
    });
  }

  // Nearby search moved to company view modal initialization

  // Save company
  // In initCompanyModalListeners function, update the save button handler:
  saveBtn.onclick = async () => {
    if (company && isSalesRep) {
      showToast('Sales representatives are not allowed to edit companies', 'error');
      return;
    }
    const name = document.getElementById('company-name-input').value.trim();
    const companyType = document.getElementById('company-type').value.trim();
    const description = document.getElementById('company-description').value.trim();
    const address = document.getElementById('company-address').value.trim(); // This is correct
    const latitude = parseFloat(document.getElementById('company-latitude').value);
    const longitude = parseFloat(document.getElementById('company-longitude').value);
    const radius = parseInt(document.getElementById('company-radius').value);

    // Validate
    if (!name || !companyType || !address || (!latitude && !longitude)) {
      showToast('Please enter company name, type, address, and coordinates', 'error');
      return;
    }

    if (!company && updateCompanyDuplicateState()) {
      showToast('Potential duplicate company found. Please review before saving.', 'error');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

    try {
      const domain = document.getElementById('company-domain')?.value.trim();
      const companyData = {
        name,
        company_type: companyType,
        description: description || null,
        domain: domain || null,
        address: address, // Make sure this is included
        latitude,
        longitude,
        radius,
        created_by: currentUser.id,
        organization_id: currentOrganization?.id
      };

      let result;
      let companyId;

      if (company) {
        // Update existing company
        result = await supabaseClient
          .from('companies')
          .update(companyData)
          .eq('id', company.id)
          .select(); // Add .select() to return the updated data

        if (result.error) throw result.error;
        companyId = company.id;

        const index = window.allCompaniesData.findIndex(c => c.id === companyId);
        if (index !== -1) {
          window.allCompaniesData[index] = { ...window.allCompaniesData[index], ...companyData };
        }

      } else {
        // Create new company
        result = await supabaseClient
          .from('companies')
          .insert([companyData])
          .select(); // Add .select() to return the inserted data

        if (result.error) throw result.error;

        // Check if result.data exists and has elements before accessing
        if (!result.data || result.data.length === 0) {
          throw new Error('Company was created but no data was returned');
        }

        companyId = result.data[0].id;
        window.allCompaniesData.push(result.data[0]);

      }

      // Handle categories - ONLY if there are categories to process
      if (companyCategories && companyCategories.length > 0) {
        // Delete existing categories ONLY if editing an existing company
        if (company) {
          await supabaseClient
            .from('company_categories')
            .delete()
            .eq('company_id', companyId);
        }

        // Add categories
        for (const categoryName of companyCategories) {
          // First, ensure all categories exist
          const { data: existingCategory, error: categoryError } = await supabaseClient
            .from('categories')
            .select('id')
            .eq('name', categoryName)
            .single();

          if (categoryError && categoryError.code !== 'PGRST116') { // Not found error
            throw categoryError;
          }

          let categoryId;
          if (existingCategory) {
            categoryId = existingCategory.id;
          } else {
            // Create new category
            const { data: newCategory, error: insertError } = await supabaseClient
              .from('categories')
              .insert([{ name: categoryName }])
              .select();

            if (insertError) throw insertError;

            // Check if newCategory exists and has elements before accessing
            if (!newCategory || newCategory.length === 0) {
              throw new Error('Category was created but no data was returned');
            }

            categoryId = newCategory[0].id;
          }

          // Link category to company
          const { error: linkError } = await supabaseClient
            .from('company_categories')
            .insert([{
              company_id: companyId,
              category_id: categoryId
            }]);

          if (linkError) throw linkError;
        }
      }

      const shouldAddMore = !company && Boolean(document.getElementById('company-add-more-toggle')?.checked);

      showToast(`Company ${company ? 'updated' : 'created'} successfully!`, 'success');
      closeModal('company-modal');
      await renderCompaniesView();

      if (shouldAddMore) {
        openCompanyModal();
        const addMoreToggle = document.getElementById('company-add-more-toggle');
        if (addMoreToggle) addMoreToggle.checked = true;
      }

    } catch (error) {
      console.error('Error saving company:', error);
      showToast(`Error ${company ? 'updating' : 'creating'} company: ${error.message}`, 'error');

    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = 'Save Company';
      if (!company) updateCompanyDuplicateState();
    }
  };
}

function addCategory(name) {
  if (!companyCategories.includes(name)) {
    companyCategories.push(name);
    renderCategories();
  }
}

function removeCategory(name) {
  companyCategories = companyCategories.filter(c => c !== name);
  renderCategories();
}

function renderCategories() {
  const container = document.getElementById('categories-container');
  if (!container) return;

  const categoriesHTML = companyCategories.map(category => `
    <span class="category-tag">
      ${category}
      <button class="tag-remove" onclick="removeCategory('${category}')">×</button>
    </span>
  `).join('');

  container.innerHTML = categoriesHTML + `<input type="text" class="categories-input" id="categories-input" placeholder="Add category...">`;

  const newInput = document.getElementById('categories-input');
  newInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && newInput.value.trim()) {
      e.preventDefault();
      addCategory(newInput.value.trim());
      newInput.value = '';
    }
  });
}

// ======================
// PEOPLE VIEW
// ======================

async function renderPeopleView() {
  const peopleState = tableViewState.people;
  currentFilters.person_company = peopleState.companyId || '';

  // Restore per-view sort — avoids sorting from another view leaking in
  currentSortKey = peopleState.sortKey || 'name';
  currentSortDir = peopleState.sortDir || 'asc';

  const sortablePeopleColumns = ['name', 'email', 'job_title', 'phone_numbers'];
  const safeSortKey = sortablePeopleColumns.includes(currentSortKey) ? currentSortKey : 'name';
  if (currentSortKey !== safeSortKey) {
    currentSortKey = safeSortKey;
    currentSortDir = 'asc';
  }

  const orgId = currentOrganization?.id;
  let rpQ = supabaseClient.from('people').select('*').order(safeSortKey, { ascending: currentSortDir === 'asc' });
  let rcQ = supabaseClient.from('companies').select('id, name').order('name', { ascending: true });
  let roQ = supabaseClient.from('opportunities').select('id, name').order('name', { ascending: true });
  if (orgId) {
    rpQ = rpQ.eq('organization_id', orgId);
    rcQ = rcQ.eq('organization_id', orgId);
    roQ = roQ.eq('organization_id', orgId);
  }
  const [peopleResult, companiesResult, opportunitiesResult] = await Promise.all([rpQ, rcQ, roQ]);

  const { data: people, error: peopleError } = peopleResult;
  const { data: companies } = companiesResult;
  const { data: opportunities } = opportunitiesResult;

  crmDebugLog('renderPeopleView.peopleResult', {
    error: peopleError || null,
    count: Array.isArray(people) ? people.length : 0,
    sample: Array.isArray(people) && people.length > 0 ? people[0] : null
  });
  crmDebugLog('renderPeopleView.companiesResult', {
    error: companiesResult.error || null,
    count: Array.isArray(companies) ? companies.length : 0,
    sample: Array.isArray(companies) && companies.length > 0 ? companies[0] : null
  });
  crmDebugLog('renderPeopleView.opportunitiesResult', {
    error: opportunitiesResult.error || null,
    count: Array.isArray(opportunities) ? opportunities.length : 0,
    sample: Array.isArray(opportunities) && opportunities.length > 0 ? opportunities[0] : null
  });

  if (peopleError) {
    crmDebugLog('renderPeopleView.error', peopleError);
    viewContainer.innerHTML = renderError(peopleError.message);
    return;
  }

  // Store for global access
  window.companiesData = companies || [];
  window.opportunitiesData = opportunities || [];

  const companiesById = new Map((window.companiesData || []).map((company) => [String(company.id), company]));
  const opportunitiesById = new Map((window.opportunitiesData || []).map((opportunity) => [String(opportunity.id), opportunity]));

  window.allPeopleData = (people || []).map((person) => {
    const company = person.company_id ? companiesById.get(String(person.company_id)) || null : null;
    const opportunity = person.opportunity_id ? opportunitiesById.get(String(person.opportunity_id)) || null : null;

    return {
      ...person,
      company,
      companies: company,
      opportunity
    };
  });

  crmDebugLog('renderPeopleView.windowData', {
    peopleCount: window.allPeopleData.length,
    companiesCount: window.companiesData.length,
    opportunitiesCount: window.opportunitiesData.length,
    samplePerson: window.allPeopleData.length > 0 ? window.allPeopleData[0] : null
  });

  // Initial pagination state
  let currentPage = peopleState.currentPage || 1;
  const recordsPerPage = 15; // Number of records per page
  let searchQuery = peopleState.searchQuery || ''; // Separate search state

  // Function to render the people table
  function renderPeopleTable(peopleToRender, paginationInfo) {
    const columns = [
      { key: 'rank', label: '#', width: '50px', readOnly: true, sortable: false, render: (val, row) => (paginationInfo.currentPage - 1) * paginationInfo.recordsPerPage + peopleToRender.indexOf(row) + 1 },
      {
        key: 'name', label: 'Name', width: '210px', icon: 'user', sortable: true, render: (val) => `
        <div style="display: flex; align-items: center; gap: 8px;">
          <div class="mention-avatar" style="width: 24px; height: 24px; font-size: 0.75rem;">${getInitials(val)}</div>
          <span>${val}</span>
        </div>
      `},
      { key: 'email', label: 'Email', width: '250px', icon: 'mail', sortable: true },
      { key: 'company.name', label: 'Company', width: '160px', icon: 'building', readOnly: true, sortable: false, render: (val, row) => row.company ? row.company.name : 'No company' },
      { key: 'job_title', label: 'Job Title', width: '150px', icon: 'briefcase', sortable: true },
      { key: 'phone_numbers', label: 'Phone', width: '150px', icon: 'phone', sortable: true, render: (phones) => phones && Array.isArray(phones) ? phones.join(', ') : (phones || 'N/A') },
      {
        key: 'actions', label: 'Actions', width: '140px', readOnly: true, sortable: false, render: (val, row) => `
        <div class="table-actions">
          <button class="action-btn view-person" data-id="${row.id}" title="View person"><i data-lucide="eye"></i></button>
          <button class="action-btn edit-person" data-id="${row.id}" title="Edit person"><i data-lucide="square-pen"></i></button>
          <button class="action-btn delete-person" data-id="${row.id}" title="Delete person"><i data-lucide="trash-2"></i></button>
        </div>
      `},
    ];

    let html = `

      <div class="view-toolbar">
        <div class="search-container u-flex-1 u-maxw-320">
          <i data-lucide="search" class="u-icon-16 u-search-icon-muted"></i>
          <input type="text" id="people-search" placeholder="Search people...">
          <div id="clear-people-search" class="search-clear-btn hidden" title="Clear search">
            <i data-lucide="x" class="u-icon-16"></i>
          </div>
        </div>
        
        <div class="u-flex-1"></div>
        <button class="toolbar-btn toolbar-btn-primary" id="add-person-btn">
          <i data-lucide="plus" class="u-icon-16"></i> New Person
        </button>
      </div>
      
      ${renderEditableDataTable(peopleToRender, columns, 'people-spreadsheet', 'people')}
      
      <div id="people-pagination" class="u-p-md"></div>
    `;

    viewContainer.innerHTML = html;

    // Initialize Lucide icons immediately
    if (window.lucide) lucide.createIcons();

    // Restore search value after rendering
    const searchInput = document.getElementById('people-search');
    if (searchInput && searchInput.value !== searchQuery) {
      searchInput.value = searchQuery;
    }

    // Create pagination controls
    createPaginationControls(
      paginationInfo.currentPage,
      paginationInfo.totalPages,
      paginationInfo.totalRecords,
      paginationInfo.recordsPerPage,
      'people-pagination',
      (newPage) => {
        currentPage = newPage;
        peopleState.currentPage = currentPage;
        saveViewState({ people: peopleState });
        const result = searchAndPaginate(
          window.allPeopleData,
          searchQuery,
          currentPage,
          recordsPerPage,
          (item, query) => filterAndSearchPerson(item, query)
        );
        renderPeopleTable(result.data, result);
      }
    );

    // Initialize event listeners
    initializePeopleEventListeners();
  }

  // Separate function to initialize event listeners
  function initializePeopleEventListeners() {
    const searchInput = document.getElementById('people-search');
    // Clear search event
    const clearSearchBtn = document.getElementById('clear-people-search');
    if (clearSearchBtn) {
      if (searchQuery) clearSearchBtn.classList.remove('hidden');
      clearSearchBtn.onclick = () => {
        searchQuery = '';
        peopleState.searchQuery = searchQuery;
        searchInput.value = '';
        clearSearchBtn.classList.add('hidden');
        currentPage = 1;
        peopleState.currentPage = currentPage;
        saveViewState({ people: peopleState });
        const result = searchAndPaginate(
          window.allPeopleData,
          searchQuery,
          1,
          recordsPerPage,
          (item, query) => filterAndSearchPerson(item, query)
        );
        renderPeopleTable(result.data, result);
      };
    }

    // Company filter event
    const companyFilter = document.getElementById('people-company-filter');
    if (companyFilter) {
      companyFilter.onchange = (e) => {
        currentFilters.person_company = e.target.value;
        peopleState.companyId = currentFilters.person_company;
        currentPage = 1;
        peopleState.currentPage = currentPage;
        saveViewState({ people: peopleState });
        const result = searchAndPaginate(
          window.allPeopleData,
          searchQuery,
          1,
          recordsPerPage,
          (item, query) => filterAndSearchPerson(item, query)
        );
        renderPeopleTable(result.data, result);
      };
    }

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const cursorPosition = e.target.selectionStart;
        const searchValue = e.target.value;

        searchQuery = searchValue;
        peopleState.searchQuery = searchQuery;
        saveViewState({ people: peopleState });
        if (searchQuery) {
          clearSearchBtn?.classList.remove('hidden');
        } else {
          clearSearchBtn?.classList.add('hidden');
        }

        clearTimeout(searchInput.searchTimeout);
        searchInput.searchTimeout = setTimeout(() => {
          currentPage = 1;
          peopleState.currentPage = currentPage;
          saveViewState({ people: peopleState });

          const activeElement = document.activeElement;
          const wasSearchInput = activeElement && activeElement.id === 'people-search';

          const result = searchAndPaginate(
            window.allPeopleData,
            searchQuery,
            1,
            recordsPerPage,
            (item, query) => filterAndSearchPerson(item, query)
          );
          renderPeopleTable(result.data, result);

          if (wasSearchInput) {
            setTimeout(() => {
              const searchElement = document.getElementById('people-search');
              if (!searchElement) return;
              searchElement.focus();
              searchElement.setSelectionRange(cursorPosition, cursorPosition);
            }, 0);
          }
        }, 250);
      });
    }

    // Sort event
    const sortBtn = document.getElementById('people-sort-btn');
    if (sortBtn) {
      sortBtn.onclick = () => {
        handleHeaderSort('name');
      };
    }

    // Add person button
    document.getElementById('add-person-btn')?.addEventListener('click', () => {
      openPersonModal();
    });

    // Edit and delete buttons
    document.querySelectorAll('.edit-person').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const personId = btn.dataset.id;
        const person = window.allPeopleData.find(p => p.id === personId);
        if (person) {
          openPersonModal(person);
        }
      });
    });

    // View person handlers
    document.querySelectorAll('.view-person').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const personId = btn.dataset.id;
        const person = window.allPeopleData.find(p => String(p.id) === String(personId));
        if (person) {
          openPersonViewModal(person);
        }
      });
    });

    document.querySelectorAll('.delete-person').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const personId = btn.dataset.id;
        const person = window.allPeopleData.find(p => p.id === personId);

        const confirmed = await showConfirmDialog(
          'Delete Person',
          `Are you sure you want to delete ${person.name}?`
        );

        if (!confirmed) return;

        const { error } = await supabaseClient
          .from('people')
          .delete()
          .eq('id', personId);

        if (error) {
          showToast('Error deleting person: ' + error.message, 'error');
          return;
        }

        // Remove from local data and refresh
        window.allPeopleData = window.allPeopleData.filter(p => p.id !== personId);

        showToast('Person deleted successfully', 'success');

        // Re-render with current page
        const result = searchAndPaginate(
          window.allPeopleData,
          searchQuery,
          currentPage,
          recordsPerPage,
          (item, query) => filterAndSearchPerson(item, query)
        );

        // Adjust current page if necessary
        if (result.data.length === 0 && result.currentPage > 1) {
          currentPage--;
          const adjustedResult = searchAndPaginate(
            window.allPeopleData,
            searchQuery,
            currentPage,
            recordsPerPage,
            (item, query) => filterAndSearchPerson(item, query)
          );
          renderPeopleTable(adjustedResult.data, adjustedResult);
        } else {
          renderPeopleTable(result.data, result);
        }
      });
    });
  }

  // Helper for combined filter/search
  function filterAndSearchPerson(person, query) {
    if (currentFilters.person_company && String(person.company_id || '') !== String(currentFilters.person_company)) return false;
    if (!query) return true;
    return matchesTokenizedQuery(
      query,
      person.name,
      person.email,
      person.job_title,
      person.company && person.company.name
    );
  }

  // Initial data processing
  const initialPeopleData = searchAndPaginate(
    window.allPeopleData,
    searchQuery,
    currentPage,
    recordsPerPage,
    (item, query) => filterAndSearchPerson(item, query)
  );
  renderPeopleTable(initialPeopleData.data, initialPeopleData);

  // Explicitly initialize icons after rendering table
  if (window.lucide) lucide.createIcons();
}


// Update the openPersonModal function to use the global data
function openPersonModal(person = null) {
  const modal = document.getElementById('person-modal');
  const modalTitle = document.getElementById('person-modal-title');
  const saveBtn = document.getElementById('save-person-btn');
  const companyInput = document.getElementById('person-company');
  const opportunitySelect = document.getElementById('person-opportunity');
  const addMoreWrapper = document.getElementById('person-add-more-wrapper');

  // Reset form
  document.getElementById('person-name').value = '';
  document.getElementById('person-email').value = '';
  document.getElementById('person-job-title').value = '';
  companyInput.value = '';
  companyInput.dataset.companyId = '';

  // Clear phone numbers
  document.getElementById('phone-numbers-container').innerHTML = `
    <div class="phone-number-input">
      <input type="tel" class="phone-number" placeholder="e.g., +254 712 345 678">
      <button type="button" class="btn btn-sm btn-ghost add-phone-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-plus-icon lucide-plus"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
      </button>
    </div>
  `;
  personPhoneNumbers = [];

  // Populate opportunity dropdown using global data
  if (window.opportunitiesData) {
    opportunitySelect.innerHTML = '<option value="">Select an opportunity</option>';
    window.opportunitiesData.forEach(opportunity => {
      opportunitySelect.innerHTML += `<option value="${opportunity.id}">${opportunity.name}</option>`;
    });
  }

  // Set modal title
  if (person) {
    modalTitle.innerHTML = 'Edit Person';
    if (addMoreWrapper) addMoreWrapper.style.display = 'none';

    // Fill form with person data
    document.getElementById('person-name').value = person.name || '';
    document.getElementById('person-email').value = person.email || '';
    document.getElementById('person-job-title').value = person.job_title || '';

    if (person.company_id) {
      // Find and set company name
      const company = window.companiesData?.find(c => c.id === person.company_id);
      if (company) {
        companyInput.value = company.name;
        companyInput.dataset.companyId = person.company_id;
      }
    }

    if (person.opportunity_id) {
      opportunitySelect.value = person.opportunity_id;
    }

    // Add phone numbers
    if (person.phone_numbers && person.phone_numbers.length > 0) {
      personPhoneNumbers = [...person.phone_numbers];
      renderPhoneNumbers();
    }
  } else {
    modalTitle.innerHTML = 'New Person';
    if (addMoreWrapper) addMoreWrapper.style.display = 'inline-flex';
  }

  // Show modal
  modal.style.display = 'flex';
  document.body.classList.add('modal-active');

  // Initialize event listeners
  initPersonModalListeners(person);
}

/**
 * Person view modal — show a quick profile summary and related activity tabs.
 * Accepts a person object or person id.
 */
async function openPersonViewModal(personOrId) {
  const modal = document.getElementById('person-view-modal');
  if (!modal) {
    showToast('Person view modal not found', 'error');
    return;
  }

  let person = personOrId;
  if (!person || (typeof person === 'string' || typeof person === 'number')) {
    const personId = person || personOrId;
    person = (Array.isArray(window.allPeopleData) ? window.allPeopleData.find(p => String(p.id) === String(personId)) : null);
  }

  if (!person) {
    showToast('Unable to load person', 'error');
    return;
  }

  // If the person object doesn't include extended fields (like phone_numbers), fetch full record
  if ((!person.phone_numbers || !Array.isArray(person.phone_numbers)) || (!person.notes && !person.job_title && !person.company)) {
    try {
      const { data: fullPerson, error: personErr } = await supabaseClient
        .from('people')
        .select('*')
        .eq('id', person.id)
        .single();

      if (!personErr && fullPerson) {
        // Merge fetched fields onto the person reference used below
        person = { ...person, ...fullPerson };
      }
    } catch (fetchErr) {
      crmDebugLog('openPersonViewModal.fetchErr', fetchErr);
    }
  }

  document.getElementById('person-view-modal-title').textContent = person.name || 'Person';

  // ── Populate Hero Section ──
  const personHeroAvatar = document.getElementById('person-view-hero-avatar');
  if (personHeroAvatar) {
    const initials = getInitials(person.name || 'U');
    personHeroAvatar.innerHTML = `<span style="position:relative;z-index:1">${initials}</span>`;
  }

  const personSubtitle = document.getElementById('person-view-hero-subtitle');
  if (personSubtitle) {
    const jobTitle = person.job_title ? escapeHtml(person.job_title) : '';
    const companyName = (person.company && person.company.name) ? escapeHtml(person.company.name) : (person.company_name ? escapeHtml(person.company_name) : '');
    const companyId = person.company && person.company.id ? person.company.id : null;
    const companyHtml = companyName
      ? (companyId ? `<a href="#" class="person-view-company-link" data-id="${escapeHtml(String(companyId))}">${companyName}</a>` : companyName)
      : '';
    personSubtitle.innerHTML = jobTitle && companyHtml ? `${jobTitle} <span style="opacity:0.5;margin:0 4px">·</span> ${companyHtml}` : (jobTitle || companyHtml || '');
    if (companyId) {
      personSubtitle.querySelector('.person-view-company-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        closeModal('person-view-modal');
        setTimeout(() => openCompanyViewModal(companyId), 140);
      });
    }
  }

  // Hero contact chips
  const personChips = document.getElementById('person-view-hero-chips');
  if (personChips) {
    const emailChip = person.email ? `<a class="record-hero-chip" href="mailto:${escapeHtml(person.email)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>${escapeHtml(person.email)}</a>` : '';
    const phone = person.phone_numbers && Array.isArray(person.phone_numbers) && person.phone_numbers.length ? person.phone_numbers[0] : (person.phone || '');
    const phoneChip = phone ? `<a class="record-hero-chip" href="tel:${escapeHtml(phone)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.79 19.79 0 0 1 11.63 19a19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72"/></svg>${escapeHtml(phone)}</a>` : '';
    personChips.innerHTML = emailChip + phoneChip;
  }

  // Wire Edit button
  const personEditBtn = document.getElementById('person-view-edit-btn');
  if (personEditBtn) {
    personEditBtn.onclick = () => {
      closeModal('person-view-modal');
      setTimeout(() => openPersonModal(person), 100);
    };
  }

  // ── Populate Sidebar Fields ──
  const emailEl = document.getElementById('person-view-email');
  if (emailEl) emailEl.innerHTML = person.email ? `<a href="mailto:${escapeHtml(person.email)}">${escapeHtml(person.email)}</a>` : '—';
  const phoneEl = document.getElementById('person-view-phone');
  if (phoneEl) phoneEl.innerHTML = (person.phone_numbers && person.phone_numbers.length) ? person.phone_numbers.map(p => `<a href="tel:${escapeHtml(p)}">${escapeHtml(p)}</a>`).join('<br>') : (person.phone || '—');
  const companyEl = document.getElementById('person-view-company');
  if (companyEl) {
    const pCompany = (person.company && person.company.name) ? person.company : null;
    if (pCompany && pCompany.id) {
      companyEl.innerHTML = `<a href="#" class="person-view-company-link" data-id="${escapeHtml(String(pCompany.id))}">${escapeHtml(pCompany.name)}</a>`;
      companyEl.querySelector('.person-view-company-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        closeModal('person-view-modal');
        setTimeout(() => openCompanyViewModal(pCompany.id), 140);
      });
    } else {
      companyEl.textContent = (person.company && person.company.name) ? person.company.name : (person.company_name || '—');
    }
  }
  const titleEl = document.getElementById('person-view-title'); if (titleEl) titleEl.textContent = person.job_title || '—';
  const notesEl = document.getElementById('person-view-notes'); if (notesEl) notesEl.textContent = person.notes || '—';

  // Tab placeholder
  document.getElementById('person-view-opps').innerHTML = '<div class="record-empty-state"><div class="record-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div><div class="record-empty-title">Loading...</div></div>';

  modal.style.display = 'flex';

  // Tab switching
  const personTabs = modal.querySelectorAll('.person-view-tab');
  personTabs.forEach(tab => {
    tab.onclick = () => {
      personTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const name = tab.dataset.tab;
      document.getElementById('person-view-opps').style.display = name === 'opps' ? 'block' : 'none';
    };
  });

  // Populate Opportunities for this person (use attached object or fetch by id)
  (async () => {
    const oppsEl = document.getElementById('person-view-opps');
    try {
      let opps = [];
      if (person.opportunity && person.opportunity.id) {
        // If person.opportunity is present but likely a minimal object, fetch full opportunity
        const { data, error } = await supabaseClient.from('opportunities').select('*').eq('id', person.opportunity.id).single();
        if (!error && data) opps = [data];
      } else if (person.opportunity_id) {
        const { data, error } = await supabaseClient.from('opportunities').select('*').eq('id', person.opportunity_id).limit(1);
        if (!error && data && data.length) opps = data;
      }

      // If still empty, try to find opportunities that reference this person by contact or person id
      if (opps.length === 0 && person.id) {
        const { data, error } = await supabaseClient.from('opportunities').select('*').or(`contact_id.eq.${person.id},person_id.eq.${person.id}`).limit(50);
        if (!error && data && data.length) opps = data;
      }

      if (!opps || opps.length === 0) {
        oppsEl.innerHTML = `<div class="record-empty-state"><div class="record-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div><div class="record-empty-title">No opportunities linked</div><div class="record-empty-desc">This person is not linked to any active opportunities yet.</div></div>`;
      } else {
        const stageColors = { prospecting: '#6366f1', qualification: '#f59e0b', proposal: '#3b82f6', negotiation: '#f97316', won: '#22c55e', lost: '#ef4444' };
        oppsEl.innerHTML = opps.map(opp => {
          const stage = opp.stage || opp.status || '—';
          const rawValue = opp.value || opp.amount || opp.estimated_value || opp.deal_value || 0;
          const numeric = Number(String(rawValue).replace(/[^0-9.-]+/g, '')) || 0;
          const displayValue = numeric ? numeric.toLocaleString() : '0';
          const prob = (opp.probability || opp.win_probability || opp.prob || 0);
          const stageKey = stage.toLowerCase();
          const stageColor = stageColors[stageKey] || 'var(--color-primary)';
          return `
            <div class="record-opp-card" data-id="${opp.id}">
              <div class="record-opp-card-stage" style="background:${stageColor}"></div>
              <div class="record-opp-card-body">
                <div class="record-opp-card-name">${escapeHtml(opp.name || '—')}</div>
                <div class="record-opp-card-meta">
                  <span class="stage-pill" style="background:${stageColor}1a;color:${stageColor};border-color:${stageColor}40">${escapeHtml(stage)}</span>
                  <span>${prob}% probability</span>
                </div>
              </div>
              <div class="record-opp-card-value">Ksh ${displayValue}</div>
              <div class="record-opp-card-action"><button class="btn btn-sm btn-ghost view-opportunity" data-id="${opp.id}">View</button></div>
            </div>
          `;
        }).join('');


        // Attach view handlers
        oppsEl.querySelectorAll('.view-opportunity').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            const opp = (opps || []).find(o => String(o.id) === String(id));
            if (opp) {
              closeModal('person-view-modal');
              const isOwnOpportunity = !isManager || opp.user_id === currentUser.id;
              setTimeout(() => openOpportunityModal(opp, !isOwnOpportunity), 140);
            }
          });
        });
      }
    } catch (e) {
      oppsEl.innerHTML = '<div class="text-center p-6">Error loading opportunities</div>';
      crmDebugLog('person-view-opps-error', e);
    }
  })();

}


function initPersonModalListeners(person) {
  // Company search functionality
  const companyInput = document.getElementById('person-company');
  const searchResults = document.getElementById('person-company-search-results');
  const nameInput = document.getElementById('person-name');
  const emailInput = document.getElementById('person-email');
  const duplicateWarning = document.getElementById('person-duplicate-warning');

  function updatePersonDuplicateState() {
    if (person) {
      if (duplicateWarning) {
        duplicateWarning.textContent = '';
        duplicateWarning.classList.add('hidden');
      }
      return false;
    }

    const phoneInputs = document.querySelectorAll('#phone-numbers-container .phone-number');
    const phoneNumbers = Array.from(phoneInputs)
      .map((input) => input.value.trim())
      .filter((phone) => phone !== '');

    const duplicate = findDuplicatePersonContact({
      name: nameInput?.value || '',
      email: emailInput?.value || '',
      phoneNumbers,
      companyId: companyInput?.dataset?.companyId || ''
    });

    if (duplicateWarning) {
      if (duplicate) {
        duplicateWarning.textContent = `Duplicate detected: ${duplicate.name}`;
        duplicateWarning.classList.remove('hidden');
      } else {
        duplicateWarning.textContent = '';
        duplicateWarning.classList.add('hidden');
      }
    }

    return Boolean(duplicate);
  }

  if (companyInput) {
    crmDebugLog('personModal.init', {
      companiesDataCount: Array.isArray(window.companiesData) ? window.companiesData.length : 0,
      companiesDataSample: Array.isArray(window.companiesData) && window.companiesData.length > 0 ? window.companiesData[0] : null
    });

    companyInput.addEventListener('input', (e) => {
      const searchTerm = e.target.value.toLowerCase().trim();

      if (searchTerm.length === 0) {
        searchResults.style.display = 'none';
        companyInput.dataset.companyId = '';
        updatePersonDuplicateState();
        return;
      }

      // Filter companies
      const filteredCompanies = window.companiesData?.filter(company =>
        matchesTokenizedQuery(searchTerm, company.name, company.description, company.address)
      ) || [];

      crmDebugLog('personModal.companySearch', {
        term: searchTerm,
        companiesDataCount: Array.isArray(window.companiesData) ? window.companiesData.length : 0,
        matchCount: filteredCompanies.length,
        firstMatch: filteredCompanies.length > 0 ? filteredCompanies[0] : null
      });

      if (filteredCompanies.length > 0) {
        searchResults.innerHTML = filteredCompanies.slice(0, 5).map(company => `
          <div class="search-result-item" data-company-id="${company.id}" data-company-name="${company.name}">
            <div class="search-result-name">${company.name}</div>
            ${company.address ? `<div class="search-result-meta">${company.address}</div>` : ''}
          </div>
        `).join('');
        searchResults.style.display = 'block';

        // Add click handlers to results
        searchResults.querySelectorAll('.search-result-item').forEach(item => {
          item.addEventListener('click', () => {
            companyInput.value = item.dataset.companyName;
            companyInput.dataset.companyId = item.dataset.companyId;
            searchResults.style.display = 'none';
            updatePersonDuplicateState();
          });
        });
      } else {
        searchResults.innerHTML = '<div class="search-result-empty">No companies found</div>';
        searchResults.style.display = 'block';
        crmDebugLog('personModal.companySearch.noMatches', {
          term: searchTerm,
          companiesDataCount: Array.isArray(window.companiesData) ? window.companiesData.length : 0
        });
      }

      updatePersonDuplicateState();
    });

    // Hide results when clicking outside
    document.addEventListener('click', (e) => {
      if (!companyInput.contains(e.target) && !searchResults.contains(e.target)) {
        searchResults.style.display = 'none';
      }
    });
  }

  // Add phone number button
  const addPhoneBtn = document.querySelector('.add-phone-btn');
  if (addPhoneBtn) {
    const newAddPhoneBtn = addPhoneBtn.cloneNode(true);
    addPhoneBtn.parentNode.replaceChild(newAddPhoneBtn, addPhoneBtn);
    newAddPhoneBtn.addEventListener('click', (e) => {
      e.preventDefault();
      addPhoneNumber();
      setTimeout(updatePersonDuplicateState, 0);
    });
  }

  if (nameInput) nameInput.addEventListener('input', updatePersonDuplicateState);
  if (emailInput) emailInput.addEventListener('input', updatePersonDuplicateState);

  const phoneNumbersContainer = document.getElementById('phone-numbers-container');
  if (phoneNumbersContainer) {
    phoneNumbersContainer.addEventListener('input', (event) => {
      if (event.target && event.target.classList && event.target.classList.contains('phone-number')) {
        updatePersonDuplicateState();
      }
    });
    phoneNumbersContainer.addEventListener('click', (event) => {
      const removeBtn = event.target.closest('.remove-phone-btn');
      if (removeBtn) {
        setTimeout(updatePersonDuplicateState, 0);
      }
    });
  }

  updatePersonDuplicateState();

  // Save person
  const saveBtn = document.getElementById('save-person-btn');

  saveBtn.onclick = async () => {
    const name = document.getElementById('person-name').value.trim();
    const email = document.getElementById('person-email').value.trim();
    const companyId = companyInput.dataset.companyId; // Use dataset instead of value
    const jobTitle = document.getElementById('person-job-title').value.trim();
    const opportunityId = document.getElementById('person-opportunity').value;

    // Collect phone numbers
    const phoneInputs = document.querySelectorAll('.phone-number');
    const phoneNumbers = Array.from(phoneInputs)
      .map(input => input.value.trim())
      .filter(phone => phone !== '');

    // Validate
    if (!name || !companyId) {
      showToast('Please enter a name and select a company', 'error');
      return;
    }

    if (!person && updatePersonDuplicateState()) {
      showToast('Potential duplicate person found. Please review before saving.', 'error');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

    try {
      const personData = {
        name,
        email: email || null,
        company_id: companyId,
        job_title: jobTitle || null,
        phone_numbers: phoneNumbers.length > 0 ? phoneNumbers : null,
        opportunity_id: opportunityId || null,
        created_by: currentUser.id,
        organization_id: currentOrganization?.id
      };

      let result;

      if (person) {
        // Update existing person
        result = await supabaseClient
          .from('people')
          .update(personData)
          .eq('id', person.id);


        const index = window.allPeopleData.findIndex(p => p.id === person.id);
        if (index !== -1) {
          window.allPeopleData[index] = { ...window.allPeopleData[index], ...personData };
        }

      } else {
        // Create new person
        result = await supabaseClient
          .from('people')
          .insert([personData]);

        if (result.data && result.data.length > 0) {
          window.allPeopleData.push(result.data[0]);
        }
      }

      if (result.error) throw result.error;

      const shouldAddMore = !person && Boolean(document.getElementById('person-add-more-toggle')?.checked);

      showToast(`Person ${person ? 'updated' : 'created'} successfully!`, 'success');
      closeModal('person-modal');
      await renderPeopleView();

      if (shouldAddMore) {
        openPersonModal();
        const addMoreToggle = document.getElementById('person-add-more-toggle');
        if (addMoreToggle) addMoreToggle.checked = true;
      }
    } catch (error) {
      showToast(`Error ${person ? 'updating' : 'creating'} person: ${error.message}`, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = 'Save Person';
      if (!person) updatePersonDuplicateState();
    }
  };
}

function addPhoneNumber() {
  const container = document.getElementById('phone-numbers-container');
  const phoneInput = document.createElement('div');
  phoneInput.className = 'phone-number-input';
  phoneInput.innerHTML = `
    <input type="tel" class="phone-number" placeholder="Enter phone number">
    <button type="button" class="btn btn-sm btn-ghost remove-phone-btn">
      <i class="fas fa-minus"></i>
    </button>
  `;
  container.appendChild(phoneInput);

  // Add event listener to remove button
  phoneInput.querySelector('.remove-phone-btn').addEventListener('click', () => {
    phoneInput.remove();
  });
}

function renderPhoneNumbers() {
  const container = document.getElementById('phone-numbers-container');
  container.innerHTML = '';

  personPhoneNumbers.forEach(phone => {
    const phoneInput = document.createElement('div');
    phoneInput.className = 'phone-number-input';
    phoneInput.innerHTML = `
      <input type="tel" class="phone-number" value="${phone}" placeholder="Enter phone number">
      <button type="button" class="btn btn-sm btn-ghost remove-phone-btn">
        <i class="fas fa-minus"></i>
      </button>
    `;
    container.appendChild(phoneInput);

    // Add event listener to remove button
    phoneInput.querySelector('.remove-phone-btn').addEventListener('click', () => {
      phoneInput.remove();
    });
  });

  // Add one empty input
  addPhoneNumber();
}

// ======================
// LOG VISIT VIEW (Updated to use companies)
// ======================

async function renderLogVisitView() {
  const { data: companies } = await supabaseClient
    .from('companies')
    .select('*')
    .order('name', { ascending: true });

  viewContainer.innerHTML = `
    <div class="log-visit-shell">
      <div class="log-visit-flow">
        <section class="log-visit-step" data-step="1">
          <div class="log-visit-step-head">
            <span class="log-visit-step-num">1</span>
            <h3 class="log-visit-section-title">Choose Company</h3>
          </div>

          <div class="form-field">
            <label for="company-name">Company Name *</label>
            <div class="search-container">
              <i class="fas fa-search"></i>
              <input type="text" id="company-name" placeholder="Search for a company..." required />
              <div id="company-search-results" class="search-results" style="display: none;"></div>
            </div>
          </div>

          <div class="form-field" id="selected-company" style="display: none;">
            <div class="selected-location-info log-visit-selected-company">
              <div id="selected-company-name"></div>
              <div id="selected-company-address" class="text-muted"></div>
            </div>
          </div>

          <button type="button" id="verify-location" class="btn btn-secondary w-full" disabled>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-pin-icon lucide-map-pin"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>
            Verify Location
          </button>

          <div id="location-status" class="location-status" style="display: none;"></div>
          <div id="location-map" class="location-map" style="display: none;"></div>
        </section>

        <section class="log-visit-step" data-step="2">
          <div class="log-visit-step-head">
            <span class="log-visit-step-num">2</span>
            <h3 class="log-visit-section-title">Visit Details</h3>
          </div>

          <div class="log-visit-row">
            <div class="form-field">
              <label for="contact-name">Contact Person</label>
              <input type="text" id="contact-name" placeholder="Client contact name" />
            </div>

            <div class="form-field">
              <label for="visit-type">Visit Type</label>
              <select id="visit-type">
                <option value="new_lead">New Lead</option>
                <option value="follow_up">Follow-up</option>
                <option value="demo">Product Demo</option>
                <option value="closing">Closing</option>
                <option value="support">Customer Support</option>
              </select>
            </div>

            <div class="form-field log-visit-row-span">
              <label for="travel-time">Travel Time (minutes)</label>
              <input type="number" id="travel-time" placeholder="How long did it take to get here?" min="0" />
            </div>
          </div>
        </section>

        <section class="log-visit-step" data-step="3">
          <div class="log-visit-step-head">
            <span class="log-visit-step-num">3</span>
            <h3 class="log-visit-section-title">Notes & Tags</h3>
          </div>

          <div class="form-field">
            <label for="notes">Notes *</label>
            <div class="mention-container">
              <textarea id="notes" class="mention-input" placeholder="What happened during the visit? Key takeaways, objections, and next steps..." rows="6" required></textarea>
              <div id="mention-suggestions" class="mention-suggestions" style="display: none;"></div>
            </div>
            <div class="text-right text-muted mt-1"><span id="char-count">0</span>/1000</div>
          </div>

          <div class="form-field">
            <label>Tags</label>
            <div class="tags-input-container" id="tags-container">
              <input type="text" class="tags-input" id="tags-input" placeholder="Add tags...">
            </div>
            <div class="tag-suggestions">
              <button type="button" class="tag-suggestion" onclick="addTag('urgent')">urgent</button>
              <button type="button" class="tag-suggestion" onclick="addTag('high-value')">high-value</button>
              <button type="button" class="tag-suggestion" onclick="addTag('decision-maker')">decision-maker</button>
              <button type="button" class="tag-suggestion" onclick="addTag('follow-up')">follow-up</button>
            </div>
          </div>
        </section>

        <section class="log-visit-step" data-step="4">
          <div class="log-visit-step-head">
            <span class="log-visit-step-num">4</span>
            <h3 class="log-visit-section-title">Evidence & Save</h3>
          </div>

          <div class="form-field">
            <label>Visit Photo</label>
            <input type="file" id="visit-photo" accept="image/*" style="display: none;" />
            <div class="photo-upload-area" id="photo-upload-area">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-camera-icon lucide-camera"><path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"/><circle cx="12" cy="13" r="3"/></svg>
              <span>Tap to take photo</span>
            </div>
            <div id="photo-preview" class="photo-preview"></div>
          </div>

          <div class="log-visit-actionbar">
            <button type="button" id="submit-visit" class="btn btn-primary btn-lg log-visit-submit" disabled>
              Save Visit
            </button>
          </div>
          <p id="log-visit-submit-hint" class="log-visit-submit-hint">Select a company and verify location to enable saving.</p>
        </section>
      </div>
    </div>
  `;

  initLogVisitForm(companies);
}

function initLogVisitForm(companies) {
  const companyNameInput = document.getElementById('company-name');
  const companySearchResults = document.getElementById('company-search-results');
  const selectedCompanyDiv = document.getElementById('selected-company');
  const selectedCompanyName = document.getElementById('selected-company-name');
  const selectedCompanyAddress = document.getElementById('selected-company-address');
  // sales rep should select a company from search; no custom company input here
  const notesEl = document.getElementById('notes');
  const charCountEl = document.getElementById('char-count');
  const verifyLocationBtn = document.getElementById('verify-location');
  const locationStatus = document.getElementById('location-status');
  const locationMapEl = document.getElementById('location-map');
  const submitBtn = document.getElementById('submit-visit');
  const submitHint = document.getElementById('log-visit-submit-hint');
  const contactNameInput = document.getElementById('contact-name');
  const visitTypeSelect = document.getElementById('visit-type');
  const travelTimeInput = document.getElementById('travel-time');
  const stepOneEl = document.querySelector('.log-visit-step[data-step="1"]');
  const stepTwoEl = document.querySelector('.log-visit-step[data-step="2"]');
  const stepThreeEl = document.querySelector('.log-visit-step[data-step="3"]');
  const stepFourEl = document.querySelector('.log-visit-step[data-step="4"]');
  const photoUploadArea = document.getElementById('photo-upload-area');
  const photoInput = document.getElementById('visit-photo');
  const photoPreview = document.getElementById('photo-preview');
  const tagsInput = document.getElementById('tags-input');
  const mentionSuggestions = document.getElementById('mention-suggestions');

  let locationVerified = false;
  let map = null;
  let mentionStartIndex = -1;
  let currentMentionQuery = '';
  const defaultVisitType = visitTypeSelect?.value || '';

  const resetLocationVerificationState = () => {
    locationVerified = false;
    submitBtn.disabled = true;
    locationStatus.style.display = 'none';
    locationMapEl.style.display = 'none';
    if (map) {
      map.remove();
      map = null;
    }
    verifyLocationBtn.disabled = !window.selectedCompanyData;
    verifyLocationBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-pin-icon lucide-map-pin"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg> Verify Location';
  };

  const updateLogVisitStepState = () => {
    const hasCompany = Boolean(window.selectedCompanyData && window.selectedCompanyData.id);
    const hasDetails = Boolean(
      (contactNameInput?.value || '').trim() ||
      (travelTimeInput?.value || '').trim() ||
      (visitTypeSelect?.value || '') !== defaultVisitType
    );
    const hasNotes = Boolean((notesEl?.value || '').trim().length > 0);

    stepOneEl?.classList.toggle('is-complete', hasCompany);
    stepTwoEl?.classList.toggle('is-complete', hasDetails);
    stepThreeEl?.classList.toggle('is-complete', hasNotes);
    stepFourEl?.classList.toggle('is-complete', locationVerified);

    if (submitHint) {
      if (!hasCompany) {
        submitHint.textContent = 'Select a company first.';
      } else if (!locationVerified) {
        submitHint.textContent = 'Verify location to enable saving.';
      } else {
        submitHint.textContent = 'Ready to save this visit.';
      }
    }
  };

  window.updateLogVisitStepState = updateLogVisitStepState;

  // Store for global access
  window.companiesData = companies;

  // Company search functionality
  companyNameInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();

    if (window.selectedCompanyData && e.target.value.trim() !== window.selectedCompanyData.name) {
      window.selectedCompanyData = null;
      selectedCompanyDiv.style.display = 'none';
      resetLocationVerificationState();
      updateLogVisitStepState();
    }

    if (query.length === 0) {
      companySearchResults.style.display = 'none';
      return;
    }

    const filtered = companies.filter(company =>
      matchesTokenizedQuery(query, company.name, company.description, company.address)
    );

    if (filtered.length === 0) {
      companySearchResults.innerHTML = `<div class="search-result-item">No companies found</div>`;
    } else {
      companySearchResults.innerHTML = filtered.map(company => `
        <div class="search-result-item" onclick="selectCompany('${company.id}')">
          <div class="search-result-icon"></div>
          <div>
            <div class="search-result-name">${company.name}</div>
            <div class="search-result-role">${company.description || 'No description'}</div>
          </div>
        </div>
      `).join('');
    }

    companySearchResults.style.display = 'block';
  });

  // Character counter
  notesEl.addEventListener('input', () => {
    charCountEl.textContent = notesEl.value.length;
    updateLogVisitStepState();
  });

  contactNameInput?.addEventListener('input', updateLogVisitStepState);
  visitTypeSelect?.addEventListener('change', updateLogVisitStepState);
  travelTimeInput?.addEventListener('input', updateLogVisitStepState);

  // Initialize mention system for notes
  notesEl.addEventListener('input', (e) => {
    const text = e.target.value;
    const cursorPos = e.target.selectionStart;

    // Check if user is typing a mention (@)
    const beforeCursor = text.substring(0, cursorPos);
    const mentionMatch = beforeCursor.match(/@([^@]*)$/);

    if (mentionMatch) {
      mentionStartIndex = cursorPos - mentionMatch[0].length;
      currentMentionQuery = mentionMatch[1];

      // Show suggestions if query is not empty
      if (currentMentionQuery.length > 0) {
        showMentionSuggestions(currentMentionQuery);
      } else {
        hideMentionSuggestions();
      }
    } else {
      hideMentionSuggestions();
      mentionStartIndex = -1;
      currentMentionQuery = '';
    }
  });

  // Handle mention selection
  notesEl.addEventListener('keydown', (e) => {
    if (mentionSuggestions.style.display !== 'none') {
      const items = mentionSuggestions.querySelectorAll('.mention-suggestion');
      let activeIndex = -1;

      // Find active item
      for (let i = 0; i < items.length; i++) {
        if (items[i].classList.contains('active')) {
          activeIndex = i;
          break;
        }
      }

      // Handle navigation
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIndex = (activeIndex + 1) % items.length;
        updateActiveMention(items, activeIndex);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIndex = activeIndex <= 0 ? items.length - 1 : activeIndex - 1;
        updateActiveMention(items, activeIndex);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (activeIndex >= 0) {
          selectMentionedPerson(items[activeIndex].dataset.personId);
        }
      } else if (e.key === 'Escape') {
        hideMentionSuggestions();
      }
    }
  });

  // Handle click on mention suggestions (before document click handler)
  mentionSuggestions.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    const suggestion = e.target.closest('.mention-suggestion');
    if (suggestion && suggestion.dataset.personId) {
      setTimeout(() => {
        window.selectMentionedPerson(suggestion.dataset.personId);
      }, 0);
    }
  }, true); // Use capture phase to ensure this fires first

  // Handle click outside to close suggestions
  document.addEventListener('click', (e) => {
    if (e.target !== notesEl && !mentionSuggestions.contains(e.target)) {
      hideMentionSuggestions();
    }
  });

  function showMentionSuggestions(query) {
    const filteredPeople = allPeople.filter(person =>
      matchesTokenizedQuery(query, person.name, person.email, person.job_title, person.companies?.name)
    );

    if (filteredPeople.length === 0) {
      mentionSuggestions.innerHTML = '<div class="mention-suggestion">No people found</div>';
    } else {
      mentionSuggestions.innerHTML = filteredPeople.map(person => `
        <div class="mention-suggestion" data-person-id="${person.id}">
          <div class="mention-avatar">${getInitials(person.name)}</div>
          <div class="mention-info">
            <div class="mention-name">${person.name}</div>
            <div class="mention-details">${person.email || ''} ${person.companies ? `• ${person.companies.name}` : ''}</div>
          </div>
        </div>
      `).join('');
    }

    mentionSuggestions.style.display = 'block';
  }

  function hideMentionSuggestions() {
    mentionSuggestions.style.display = 'none';
  }

  function updateActiveMention(items, activeIndex) {
    items.forEach((item, index) => {
      item.classList.toggle('active', index === activeIndex);
    });
  }

  window.selectMentionedPerson = function (personId) {
    const person = allPeople.find(p => p.id === parseInt(personId));
    if (!person) return;

    const text = notesEl.value;
    const beforeMention = text.substring(0, mentionStartIndex);
    const afterMention = text.substring(mentionStartIndex + currentMentionQuery.length + 1);

    // Replace with mention format
    notesEl.value = `${beforeMention}@${person.name} (${person.id})${afterMention}`;

    // Add to mentioned people array
    if (!mentionedPeople.find(p => p.id === parseInt(personId))) {
      mentionedPeople.push({
        id: parseInt(personId),
        name: person.name
      });
    }

    // Reset mention state
    hideMentionSuggestions();
    mentionStartIndex = -1;
    currentMentionQuery = '';

    // Update cursor position
    const newCursorPos = beforeMention.length + person.name.length + person.id.toString().length + 4;
    notesEl.focus();
    notesEl.setSelectionRange(newCursorPos, newCursorPos);
  };

  // Tags
  visitTags = [];
  tagsInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && tagsInput.value.trim()) {
      e.preventDefault();
      addTag(tagsInput.value.trim());
      tagsInput.value = '';
    }
  });

  // Photo upload
  photoUploadArea.addEventListener('click', () => photoInput.click());
  photoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        photoPreview.innerHTML = `<img src="${e.target.result}" alt="Visit photo">`;
        photoUploadArea.style.display = 'none';
      };
      reader.readAsDataURL(file);
    }
  });

  // Verify location
  // In the initLogVisitForm function, update the verifyLocationBtn event listener
  verifyLocationBtn.addEventListener('click', () => {
    if (!window.selectedCompanyData) {
      showToast('Please select a company first', 'error');
      return;
    }

    // Validate selected company data
    if (isNaN(window.selectedCompanyData.latitude) || isNaN(window.selectedCompanyData.longitude)) {
      showToast('Invalid company coordinates. Please update company location.', 'error');
      return;
    }

    if (!navigator.geolocation) {
      showToast('Geolocation not supported', 'error');
      return;
    }

    verifyLocationBtn.disabled = true;
    verifyLocationBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Detecting...';
    locationStatus.style.display = 'flex';
    locationStatus.className = 'location-status';
    locationStatus.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Getting your location...';

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const userLat = position.coords.latitude;
        const userLng = position.coords.longitude;
        const accuracy = position.coords.accuracy;

        // Calculate distance with error handling
        const distance = calculateDistance(
          userLat,
          userLng,
          window.selectedCompanyData.latitude,
          window.selectedCompanyData.longitude
        );

        // Check if distance calculation was successful
        if (isNaN(distance)) {
          locationStatus.className = 'location-status error';
          locationStatus.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x-icon lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg> Error calculating distance. Please check company coordinates.`;
          verifyLocationBtn.disabled = false;
          verifyLocationBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-pin-icon lucide-map-pin"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg> Verify Location';
          return;
        }

        const isWithinRadius = distance <= (window.selectedCompanyData.radius + accuracy);

        if (isWithinRadius) {
          locationStatus.className = 'location-status success';
          locationStatus.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-icon lucide-check"><path d="M20 6 9 17l-5-5"/></svg> Location verified! You are ${distance.toFixed(0)}m from ${window.selectedCompanyData.name}`;
          locationVerified = true;
          submitBtn.disabled = false;
          initVerificationMap(userLat, userLng, window.selectedCompanyData);
        } else {
          locationStatus.className = 'location-status error';
          locationStatus.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x-icon lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg> Too far from ${window.selectedCompanyData.name}. You are ${distance.toFixed(0)}m away (max: ${window.selectedCompanyData.radius}m)`;
          locationVerified = false;
          submitBtn.disabled = true;
        }

        updateLogVisitStepState();

        verifyLocationBtn.disabled = false;
        verifyLocationBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-pin-icon lucide-map-pin"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg> Verify Location';
      },
      (error) => {
        let errorMsg = 'Unable to get location';
        if (error.code === error.PERMISSION_DENIED) errorMsg = 'Location permission denied';
        if (error.code === error.POSITION_UNAVAILABLE) errorMsg = 'Location unavailable';
        if (error.code === error.TIMEOUT) errorMsg = 'Location request timed out';

        locationStatus.className = 'location-status error';
        locationStatus.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x-icon lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg> ${errorMsg}`;
        locationVerified = false;
        submitBtn.disabled = true;
        verifyLocationBtn.disabled = false;
        verifyLocationBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-pin-icon lucide-map-pin"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg> Verify Location';
        updateLogVisitStepState();
        showToast(errorMsg, 'error');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });

  function initVerificationMap(userLat, userLng, company) {
    locationMapEl.style.display = 'block';

    if (map) {
      map.remove();
    }

    map = L.map('location-map').setView([userLat, userLng], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(map);

    L.marker([userLat, userLng]).addTo(map).bindPopup('You are here').openPopup();
    L.circle([company.latitude, company.longitude], {
      radius: company.radius,
      color: '#4f46e5',
      fillColor: '#4f46e5',
      fillOpacity: 0.1
    }).addTo(map);
    L.marker([company.latitude, company.longitude]).addTo(map).bindPopup(company.name);
  }

  // Submit visit
  submitBtn.addEventListener('click', async () => {
    if (!locationVerified) {
      showToast('Please verify your location first', 'error');
      return;
    }

    const company = companyNameInput.value.trim();
    const contact = document.getElementById('contact-name').value.trim();
    const visitType = document.getElementById('visit-type').value;
    const notes = notesEl.value.trim();
    const travelTime = document.getElementById('travel-time').value;
    const photoFile = document.getElementById('visit-photo').files[0];

    if (!company || !notes) {
      showToast('Please fill in all required fields', 'error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

    try {
      let photoUrl = null;

      if (photoFile) {
        const photoPath = `visit-photos/${currentUser.id}/${Date.now()}-${photoFile.name}`;
        const { error: uploadError } = await supabaseClient.storage
          .from('safitrack')
          .upload(photoPath, photoFile);

        if (!uploadError) {
          const { data: urlData } = supabaseClient.storage.from('safitrack').getPublicUrl(photoPath);
          photoUrl = urlData.publicUrl;
        }
      }

      const aiSummary = typeof generateConciseVisitSummary === 'function'
        ? await generateConciseVisitSummary(company, contact, notes)
        : null;
      const leadScore = typeof predictLeadScore === 'function'
        ? await predictLeadScore(company, contact, notes, visitType)
        : null;

      const visitData = {
        user_id: currentUser.id,
        company_name: company,
        contact_name: contact || null,
        visit_type: visitType,
        notes: notes,
        ai_summary: aiSummary,
        lead_score: leadScore,
        location_name: window.selectedCompanyData.name,
        location_address: `${window.selectedCompanyData.latitude}, ${window.selectedCompanyData.longitude}`,
        latitude: window.selectedCompanyData.latitude,
        longitude: window.selectedCompanyData.longitude,
        photo_url: photoUrl,
        travel_time: travelTime ? parseInt(travelTime) : null,
        tags: visitTags,
        mentioned_people: mentionedPeople,
        created_at: new Date().toISOString(),
        organization_id: currentOrganization?.id
      };

      const { error } = await supabaseClient.from('visits').insert([visitData]);

      if (error) throw error;

      showToast('Visit logged successfully!', 'success');

      if (leadScore >= 70 || visitTags.includes('high-value')) {
        triggerConfetti();
      }

      // Reset mentioned people array for next visit
      mentionedPeople = [];

      loadView('my-activity');
    } catch (err) {
      showToast('Failed to save visit: ' + err.message, 'error');
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'Save Visit';
    }
  });

  updateLogVisitStepState();
}

async function geocodeAddress(address) {
  try {
    // Using Nominatim OpenStreetMap geocoding API
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`);
    const data = await response.json();

    if ((data && data.length > 0) && data[0]) {
      const { lat, lon } = data[0];
      return {
        latitude: lat,
        longitude: lon,
        displayName: data[0].display_name || address
      };
    } else {
      throw new Error('Location not found');
    }
  } catch (error) {
    console.error('Geocoding error:', error);
    throw new Error('Unable to geocode address');
  }
}

// Replace the existing selectCompany function with this updated version
window.selectCompany = function (companyId) {
  const companies = window.companiesData;
  const company = companies.find(c => c.id === companyId);
  if (!company) return;

  // Update company name input
  document.getElementById('company-name').value = company.name;

  // Show selected company info
  document.getElementById('selected-company').style.display = 'block';
  document.getElementById('selected-company-name').textContent = company.name;
  document.getElementById('selected-company-address').textContent = company.description || 'No description';

  // Hide search results
  document.getElementById('company-search-results').style.display = 'none';

  // Validate and parse coordinates
  const latitude = parseFloat(company.latitude);
  const longitude = parseFloat(company.longitude);

  // Check if coordinates are valid numbers
  if (isNaN(latitude) || isNaN(longitude)) {
    showToast('Invalid coordinates for this company. Please update company location.', 'error');
    document.getElementById('verify-location').disabled = true;
    return;
  }

  // Set selected company data with radius
  const selectedCompany = {
    id: company.id,
    name: company.name,
    latitude: latitude,
    longitude: longitude,
    radius: parseInt(company.radius) || 200 // Include the radius
  };

  // Store it in a way that can be accessed by the event listener
  window.selectedCompanyData = selectedCompany;

  // Enable verify location button
  document.getElementById('verify-location').disabled = false;
  if (typeof window.updateLogVisitStepState === 'function') {
    window.updateLogVisitStepState();
  }
};

// Allow selecting a custom company entered by the user in the Log Visit form
// custom company helper removed for sales rep flow; technicians may use their own helper
// ======================
// MY ACTIVITY VIEW
// ======================

async function renderMyActivityView() {
  const { data: visits, error } = await supabaseClient
    .from('visits')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false });

  if (error) {
    viewContainer.innerHTML = renderError(error.message);
    return;
  }

  // companies cache is preloaded during app init


  let html = `
  `;

  if (visits.length === 0) {
    html += `
      <div class="card">
        <div class="empty-state">
          <h3 class="empty-state-title">No visits yet</h3>
          <p class="empty-state-description">Start logging your field visits to see them here.</p>
          <button class="btn btn-primary" onclick="loadView('log-visit')">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-plus-icon lucide-plus"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
            Log Your First Visit
          </button>
        </div>
      </div>
    `;
  } else {
    visits.forEach(visit => {
      html += renderVisitCard(visit);
    });
  }

  viewContainer.innerHTML = html;
}

function renderVisitCard(visit, showRepName = false) {
  const date = formatDate(visit.created_at);
  const leadScoreBadge = visit.lead_score ? getLeadScoreBadge(visit.lead_score) : '';

  // Build processed notes and convert mentions to clickable spans
  let processedNotes = escapeHtml(visit.notes || '');
  if (visit.mentioned_people && Array.isArray(visit.mentioned_people) && visit.mentioned_people.length > 0) {
    visit.mentioned_people.forEach(person => {
      if (!person || !person.name) return;
      const safeName = escapeRegExp(String(person.name).trim());
      const pattern = new RegExp(`@${safeName}\\b`, 'gi');
      processedNotes = processedNotes.replace(pattern, `<span class="mentioned-person" data-person-id="${person.id}">@${escapeHtml(person.name)}</span>`);
    });
  } else {
    processedNotes = processedNotes.replace(/@([A-Za-z0-9_\-]+)\b/g, '<span class="mentioned-person" data-person-name="$1">@$1</span>');
  }

  const contactHtml = visit.contact_name ? `<span class="visit-meta-item"><svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-user-icon lucide-user"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> ${escapeHtml(visit.contact_name)}</span>` : '';
  const locationHtml = visit.location_name ? `<span class="visit-meta-item"><svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-pin-icon lucide-map-pin"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>${escapeHtml(visit.location_name)}</span>` : '';
  const typeHtml = visit.visit_type ? `<span class="visit-meta-item"><svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-tag-icon lucide-tag"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/></svg> ${escapeHtml(String(visit.visit_type).replace('_', ' '))}</span>` : '';
  const travelHtml = visit.travel_time ? `<span class="visit-meta-item"><i class="fas fa-clock"></i> ${escapeHtml(String(visit.travel_time))} min travel</span>` : '';

  const tagsHtml = visit.tags && Array.isArray(visit.tags) && visit.tags.length > 0 ? `<div class="visit-tags mb-2">${visit.tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>` : '';
  const photoHtml = visit.photo_url ? `<div class="photo-preview mb-2"><img src="${escapeHtml(visit.photo_url)}" alt="Visit photo" onerror="handleImageError(this)"></div>` : '';

  const repHtml = showRepName && visit.user ? `<div class="text-prim" style="font-size: 1rem;">by ${escapeHtml(getDisplayNameFromProfile(visit.user))}</div>` : '';

  const html = `
    <div class="visit-card" data-id="${escapeHtml(String(visit.id || ''))}">
      <div class="visit-header">
        <div class="visit-title">${escapeHtml(visit.title || visit.company_name || 'Visit')}</div>
        ${repHtml}
      </div>
      <div class="visit-date">${escapeHtml(date)}</div>
      <div class="visit-meta">
        ${contactHtml}
        ${locationHtml}
        ${typeHtml}
        ${travelHtml}
      </div>
      ${leadScoreBadge ? `<div class="mb-2">${leadScoreBadge}</div>` : ''}
      ${tagsHtml}
      ${photoHtml}
      <div class="visit-notes">${processedNotes}</div>
      ${visit.ai_summary ? `<div class="ai-insight"><div class="ai-insight-header">AI Summary</div><div class="ai-insight-content">${parseMarkdown(visit.ai_summary)}</div></div>` : ''}
    </div>`;

  return html;
}

// ======================
// SALES FUNNEL VIEW
// ======================

async function renderSalesFunnelView() {
  let visits;
  let error;

  if (isManager) {
    // Managers see all visits within their org
    let mVisitsQ = supabaseClient.from('visits').select('*').order('created_at', { ascending: false });
    if (currentOrganization?.id) mVisitsQ = mVisitsQ.eq('organization_id', currentOrganization.id);
    const result = await mVisitsQ;
    visits = result.data;
    error = result.error;
  } else {
    // Sales reps see only their own visits
    const result = await supabaseClient
      .from('visits')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false });
    visits = result.data;
    error = result.error;
  }

  if (error) {
    viewContainer.innerHTML = renderError(error.message);
    return;
  }

  const funnelStages = {
    new_lead: { title: 'New Leads', icon: 'sparkles', visits: [], color: '#3b82f6', gradient: 'linear-gradient(135deg, #3b82f6, #1d4ed8)' },
    follow_up: { title: 'Follow-ups', icon: 'refresh', visits: [], color: '#8b5cf6', gradient: 'linear-gradient(135deg, #8b5cf6, #6d28d9)' },
    demo: { title: 'Product Demos', icon: 'presentation', visits: [], color: '#f59e0b', gradient: 'linear-gradient(135deg, #f59e0b, #d97706)' },
    closing: { title: 'Closing', icon: 'handshake', visits: [], color: '#10b981', gradient: 'linear-gradient(135deg, #10b981, #059669)' },
    support: { title: 'Support', icon: 'headset', visits: [], color: '#6b7280', gradient: 'linear-gradient(135deg, #6b7280, #4b5563)' }
  };

  visits.forEach(visit => {
    const type = visit.visit_type || 'new_lead';
    if (funnelStages[type]) {
      funnelStages[type].visits.push(visit);
    }
  });

  const totalVisits = visits.length;
  const thisWeekVisits = visits.filter(v => isThisWeek(new Date(v.created_at))).length;
  const lastWeekVisits = visits.filter(v => isLastWeek(new Date(v.created_at))).length;
  const weekTrend = lastWeekVisits > 0 ? Math.round(((thisWeekVisits - lastWeekVisits) / lastWeekVisits) * 100) : 100;

  // Calculate conversion rates
  const newLeads = funnelStages.new_lead.visits.length;
  const followUps = funnelStages.follow_up.visits.length;
  const demos = funnelStages.demo.visits.length;
  const closings = funnelStages.closing.visits.length;

  const leadToFollowUp = newLeads > 0 ? Math.round((followUps / newLeads) * 100) : 0;
  const followUpToDemo = followUps > 0 ? Math.round((demos / followUps) * 100) : 0;
  const demoToClose = demos > 0 ? Math.round((closings / demos) * 100) : 0;
  const overallConversion = newLeads > 0 ? Math.round((closings / newLeads) * 100) : 0;

  // High priority leads
  const highPriorityLeads = visits.filter(v => v.lead_score && v.lead_score >= 70).slice(0, 6);

  // Recent activity
  const recentVisits = visits.slice(0, 8);

  // Stage icons
  const stageIcons = {
    new_lead: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>',
    follow_up: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>',
    demo: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/></svg>',
    closing: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/></svg>',
    support: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm0 0a9 9 0 1 1 18 0m0 0v5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3Z"/></svg>'
  };

  let html = `
    <div class="funnel-hub">
      <!-- Hero Stats -->
      <div class="funnel-hero">
        <div class="funnel-hero-stat">
          <div class="funnel-stat-icon" style="background: linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(59, 130, 246, 0.05)); color: #3b82f6;">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </div>
          <div class="funnel-stat-content">
            <span class="funnel-stat-value">${totalVisits}</span>
            <span class="funnel-stat-label">Total Visits</span>
          </div>
          <div class="funnel-stat-trend ${weekTrend >= 0 ? 'positive' : 'negative'}">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="${weekTrend >= 0 ? 'M18 15l-6-6-6 6' : 'M6 9l6 6 6-6'}"/></svg>
            ${Math.abs(weekTrend)}%
          </div>
        </div>

        <div class="funnel-hero-stat">
          <div class="funnel-stat-icon" style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(16, 185, 129, 0.05)); color: #10b981;">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          </div>
          <div class="funnel-stat-content">
            <span class="funnel-stat-value">${overallConversion}%</span>
            <span class="funnel-stat-label">Conversion Rate</span>
          </div>
        </div>

        <div class="funnel-hero-stat">
          <div class="funnel-stat-icon" style="background: linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(245, 158, 11, 0.05)); color: #f59e0b;">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          </div>
          <div class="funnel-stat-content">
            <span class="funnel-stat-value">${highPriorityLeads.length}</span>
            <span class="funnel-stat-label">Hot Leads</span>
          </div>
        </div>

        <div class="funnel-hero-stat">
          <div class="funnel-stat-icon" style="background: linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(139, 92, 246, 0.05)); color: #8b5cf6;">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
          </div>
          <div class="funnel-stat-content">
            <span class="funnel-stat-value">${thisWeekVisits}</span>
            <span class="funnel-stat-label">This Week</span>
          </div>
        </div>
      </div>

      <div class="funnel-main-grid">
        <!-- Main Funnel Section -->
        <div class="funnel-main-content">
          <!-- Visual Funnel -->
          <div class="funnel-visual-section">
            <h2 class="funnel-section-title">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
              Sales Pipeline
            </h2>
            
            <div class="funnel-visual">
              ${Object.entries(funnelStages).map(([key, stage], index) => {
    const count = stage.visits.length;
    const percentage = totalVisits > 0 ? Math.round((count / totalVisits) * 100) : 0;
    const width = 100 - (index * 12);

    return `
                  <div class="funnel-level" style="--funnel-width: ${width}%; --funnel-color: ${stage.color};">
                    <div class="funnel-level-bar">
                      <div class="funnel-level-fill" style="background: ${stage.gradient};"></div>
                      <div class="funnel-level-content">
                        <span class="funnel-level-icon">${stageIcons[key]}</span>
                        <span class="funnel-level-title">${stage.title}</span>
                        <span class="funnel-level-count">${count}</span>
                        <span class="funnel-level-percent">${percentage}%</span>
                      </div>
                    </div>
                    ${index < 4 ? `
                      <div class="funnel-connector">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>
                      </div>
                    ` : ''}
                  </div>
                `;
  }).join('')}
            </div>
          </div>

          <!-- Conversion Flow -->
          <div class="funnel-conversion-section">
            <h2 class="funnel-section-title">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
              Conversion Flow
            </h2>
            
            <div class="conversion-flow">
              <div class="conversion-step">
                <div class="conversion-step-label">Lead → Follow-up</div>
                <div class="conversion-step-bar">
                  <div class="conversion-step-fill" style="width: ${leadToFollowUp}%; background: linear-gradient(90deg, #3b82f6, #8b5cf6);"></div>
                </div>
                <div class="conversion-step-value">${leadToFollowUp}%</div>
              </div>
              
              <div class="conversion-step">
                <div class="conversion-step-label">Follow-up → Demo</div>
                <div class="conversion-step-bar">
                  <div class="conversion-step-fill" style="width: ${followUpToDemo}%; background: linear-gradient(90deg, #8b5cf6, #f59e0b);"></div>
                </div>
                <div class="conversion-step-value">${followUpToDemo}%</div>
              </div>
              
              <div class="conversion-step">
                <div class="conversion-step-label">Demo → Close</div>
                <div class="conversion-step-bar">
                  <div class="conversion-step-fill" style="width: ${demoToClose}%; background: linear-gradient(90deg, #f59e0b, #10b981);"></div>
                </div>
                <div class="conversion-step-value">${demoToClose}%</div>
              </div>
            </div>
          </div>

          <!-- Stage Cards -->
          <div class="funnel-stages-grid">
            ${Object.entries(funnelStages).map(([key, stage]) => {
    const count = stage.visits.length;
    const percentage = totalVisits > 0 ? Math.round((count / totalVisits) * 100) : 0;
    const recentInStage = stage.visits.slice(0, 3);

    return `
                <div class="funnel-stage-card" style="--stage-color: ${stage.color};">
                  <div class="funnel-stage-card-header">
                    <div class="funnel-stage-card-icon" style="background: ${stage.gradient};">
                      ${stageIcons[key]}
                    </div>
                    <div class="funnel-stage-card-info">
                      <h3 class="funnel-stage-card-title">${stage.title}</h3>
                      <span class="funnel-stage-card-count">${count} visit${count !== 1 ? 's' : ''}</span>
                    </div>
                    <div class="funnel-stage-card-badge">${percentage}%</div>
                  </div>
                  
                  <div class="funnel-stage-card-progress">
                    <div class="funnel-stage-card-progress-fill" style="width: ${percentage}%; background: ${stage.gradient};"></div>
                  </div>
                  
                  ${recentInStage.length > 0 ? `
                    <div class="funnel-stage-card-items">
                      ${recentInStage.map(v => `
                        <div class="funnel-stage-item">
                          <span class="funnel-stage-item-company">${v.company_name || 'Unknown'}</span>
                          <span class="funnel-stage-item-date">${getRelativeTime(new Date(v.created_at))}</span>
                        </div>
                      `).join('')}
                    </div>
                  ` : `
                    <div class="funnel-stage-card-empty">No visits in this stage</div>
                  `}
                </div>
              `;
  }).join('')}
          </div>
        </div>

        <!-- Sidebar -->
        <div class="funnel-sidebar">
          <!-- Hot Leads -->
          <div class="funnel-sidebar-card">
            <div class="funnel-sidebar-header">
              <h3 class="funnel-sidebar-title">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>
                Hot Leads
              </h3>
              <span class="funnel-sidebar-badge">${highPriorityLeads.length}</span>
            </div>
            
            <div class="funnel-sidebar-content">
              ${highPriorityLeads.length > 0 ? highPriorityLeads.map(visit => `
                <div class="hot-lead-item">
                  <div class="hot-lead-avatar">${getInitials(visit.company_name || 'U')}</div>
                  <div class="hot-lead-info">
                    <span class="hot-lead-company">${visit.company_name || 'Unknown'}</span>
                    <span class="hot-lead-contact">${visit.contact_name || 'No contact'}</span>
                  </div>
                  <div class="hot-lead-score ${visit.lead_score >= 80 ? 'score-hot' : 'score-warm'}">
                    ${visit.lead_score}%
                  </div>
                </div>
              `).join('') : `
                <div class="funnel-sidebar-empty">
                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>
                  <p>No hot leads yet</p>
                  <span>Leads with 70%+ score appear here</span>
                </div>
              `}
            </div>
          </div>

          <!-- Recent Activity -->
          <div class="funnel-sidebar-card">
            <div class="funnel-sidebar-header">
              <h3 class="funnel-sidebar-title">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="10"/></svg>
                Recent Activity
              </h3>
            </div>
            
            <div class="funnel-activity-timeline">
              ${recentVisits.map(visit => {
    const stageColor = funnelStages[visit.visit_type]?.color || '#6b7280';
    const stageTitle = funnelStages[visit.visit_type]?.title || 'Visit';
    return `
                  <div class="funnel-activity-item">
                    <div class="funnel-activity-dot" style="background: ${stageColor};"></div>
                    <div class="funnel-activity-content">
                      <span class="funnel-activity-company">${visit.company_name || 'Unknown'}</span>
                      <span class="funnel-activity-meta">
                        <span class="funnel-activity-stage" style="color: ${stageColor};">${stageTitle}</span>
                        <span class="funnel-activity-time">${getRelativeTime(new Date(visit.created_at))}</span>
                      </span>
                    </div>
                  </div>
                `;
  }).join('')}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  viewContainer.innerHTML = html;
}

// ======================
// OPPORTUNITY PIPELINE VIEW
// ======================

// ======================
// OPPORTUNITY PIPELINE VIEW (Updated)
// ======================

async function renderOpportunityPipelineView() {
  // renderOpportunityPipelineView start (diagnostics removed)
  // Ensure companies cache is ready before rendering opportunities
  if (!Array.isArray(window.allCompaniesData) || window.allCompaniesData.length === 0) {
    // companies cache empty — loading companies
    try {
      await loadAllCompanies();
      // loadAllCompanies completed
    } catch (e) {
      // loadAllCompanies failed (ignored)
    }
  } else {
    // companies cache present
  }
  let opportunities;
  let error;

  if (isManager) {
    // Managers see all opportunities in their org
    let mQ = supabaseClient
      .from('opportunities')
      .select(`*, profiles!inner(id, first_name, last_name, email, role)`)
      .order('created_at', { ascending: false });
    if (currentOrganization?.id) mQ = mQ.eq('organization_id', currentOrganization.id);
    const result = await mQ;
    opportunities = result.data;
    error = result.error;
  } else {
    // Sales reps only see their own opportunities
    const result = await supabaseClient
      .from('opportunities')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false });

    opportunities = result.data;
    error = result.error;
  }

  if (error) {
    viewContainer.innerHTML = renderError(error.message);
    return;
  }

  // Define pipeline stages - simplified to 4 columns as requested
  const pipelineStages = [
    { id: 'prospecting', title: 'Lead', color: '#3b82f6' },
    { id: 'qualification', title: 'In Progress', color: '#ec4899' },
    { id: 'closed-won', title: 'Won 🎉', color: '#10b981' },
    { id: 'closed-lost', title: 'Lost', color: '#ef4444' }
  ];

  // Map old stage values to new ones
  const stageMapping = {
    'prospecting': 'prospecting',
    'qualification': 'qualification',
    'proposal': 'qualification', // Map to In Progress
    'negotiation': 'qualification', // Map to In Progress
    'closed-won': 'closed-won',
    'closed-lost': 'closed-lost'
  };

  // Apply mapping to opportunities
  opportunities.forEach(opp => {
    if (stageMapping[opp.stage]) {
      opp.mappedStage = stageMapping[opp.stage];
    } else {
      opp.mappedStage = opp.stage;
    }
  });

  // Group opportunities by stage
  const opportunitiesByStage = {};
  pipelineStages.forEach(stage => {
    opportunitiesByStage[stage.id] = {
      ...stage,
      opportunities: opportunities.filter(opp => opp.mappedStage === stage.id),
      totalValue: opportunities
        .filter(opp => opp.mappedStage === stage.id)
        .reduce((sum, opp) => sum + parseFloat(opp.value || 0), 0)
    };
  });

  // Calculate pipeline summary
  const totalValue = opportunities.reduce((sum, opp) => sum + parseFloat(opp.value || 0), 0);
  const avgProbability = opportunities.length > 0
    ? opportunities.reduce((sum, opp) => sum + parseInt(opp.probability || 0), 0) / opportunities.length
    : 0;
  const wonValue = opportunitiesByStage['closed-won'].totalValue;
  const lostValue = opportunitiesByStage['closed-lost'].totalValue;
  const activeValue = totalValue - wonValue - lostValue;
  const weightedForecast = opportunities.reduce((sum, opp) => {
    const value = parseFloat(opp.value || 0);
    const probability = parseFloat(opp.probability || 0);
    return sum + (value * probability) / 100;
  }, 0);
  const closedCount = opportunities.filter(opp => opp.mappedStage === 'closed-won' || opp.mappedStage === 'closed-lost').length;
  const wonCount = opportunities.filter(opp => opp.mappedStage === 'closed-won').length;
  const winRate = closedCount > 0 ? Math.round((wonCount / closedCount) * 100) : 0;
  const activeCount = opportunities.filter(opp => opp.mappedStage !== 'closed-won' && opp.mappedStage !== 'closed-lost').length;
  const ownerOptions = isManager
    ? Array.from(new Map(opportunities.map(opp => {
      const user = opp.profiles;
      const ownerName = user ? `${user.first_name} ${user.last_name}` : 'Unknown';
      return [opp.user_id, ownerName];
    })).entries())
    : [];

  const getStageDays = (opp) => {
    const stageAnchor = opp.updated_at || opp.created_at;
    if (!stageAnchor) return 0;
    const stageDate = new Date(stageAnchor);
    if (Number.isNaN(stageDate.getTime())) return 0;
    const diffMs = Date.now() - stageDate.getTime();
    return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  };

  let html = `
    <div class="pipeline-summary">
      <div class="pipeline-summary-card">
        <div class="pipeline-summary-title">Pipeline</div>
        <div class="pipeline-summary-value">Ksh ${totalValue.toLocaleString()}</div>
        <div class="pipeline-summary-change">
          <i class="fas fa-briefcase"></i> Active Ksh ${Math.max(activeValue, 0).toLocaleString()}
        </div>
      </div>
      <div class="pipeline-summary-card">
        <div class="pipeline-summary-title">Active</div>
        <div class="pipeline-summary-value">${activeCount}</div>
        <div class="pipeline-summary-change">
          <i class="fas fa-flag-checkered"></i> Won: ${wonCount}
        </div>
      </div>
      <div class="pipeline-summary-card">
        <div class="pipeline-summary-title">Weighted Forecast</div>
        <div class="pipeline-summary-value">Ksh ${Math.round(weightedForecast).toLocaleString()}</div>
        <div class="pipeline-summary-change">
          <i class="fas fa-percent"></i> Avg probability: ${Math.round(avgProbability)}%
        </div>
      </div>
      <div class="pipeline-summary-card">
        <div class="pipeline-summary-title">Win Rate</div>
        <div class="pipeline-summary-value">${winRate}%</div>
        <div class="pipeline-summary-change">
          <i class="fas fa-trophy"></i> Closed won value: Ksh ${wonValue.toLocaleString()}
        </div>
      </div>
    </div>

    <div class="pipeline-toolbar">
      <div class="pipeline-controls pipeline-controls-primary">
        <div class="pipeline-search">
          <i data-lucide="search"></i>
          <input type="text" id="pipeline-search" placeholder="Search company, deal, notes...">
        </div>

        <select id="pipeline-quick-filter" class="pipeline-select pipeline-quick-filter">
          <option value="all">All Opportunities</option>
          <option value="high-value">High Value</option>
          <option value="high-probability">High Probability</option>
          <option value="next-step-due">Next Step Due</option>
          ${isManager ? '<option value="my-reps">Sales Reps</option>' : ''}
        </select>

        <button class="btn btn-secondary" id="pipeline-advanced-toggle" aria-expanded="false">
          <i data-lucide="sliders-horizontal"></i> More Filters
        </button>

        <button class="btn btn-primary pipeline-add-btn" id="add-opportunity-btn">
          <i class="fas fa-plus"></i> New Opportunity
        </button>
      </div>

      <div class="pipeline-controls pipeline-controls-advanced" id="pipeline-advanced-controls" hidden>

        ${isManager ? `
          <select id="pipeline-owner-filter" class="pipeline-select">
            <option value="all">All Owners</option>
            ${ownerOptions.map(([id, name]) => `<option value="${id}">${name}</option>`).join('')}
          </select>
        ` : ''}

        <select id="pipeline-sort" class="pipeline-select">
          <option value="newest">Sort: Newest</option>
          <option value="oldest">Sort: Oldest</option>
          <option value="value-desc">Sort: Highest Value</option>
          <option value="value-asc">Sort: Lowest Value</option>
          <option value="probability-desc">Sort: Highest Probability</option>
          <option value="next-step">Sort: Next Step Due</option>
        </select>

        <button class="btn btn-ghost" id="pipeline-reset-controls">
          Reset
        </button>
      </div>
    </div>

    <div class="pipeline-stages">
  `;

  // Render pipeline stages
  pipelineStages.forEach(stage => {
    const stageData = opportunitiesByStage[stage.id];
    html += `
      <div class="pipeline-stage" data-stage="${stage.id}">
        <div class="pipeline-stage-header">
          <div class="pipeline-stage-title"><span class="pipeline-stage-dot" style="background:${stage.color}"></span>${stage.title}</div>
          <div class="pipeline-stage-count">${stageData.opportunities.length}</div>
        </div>
        <div class="pipeline-stage-value">Ksh ${stageData.totalValue.toLocaleString()}</div>
        <button class="pipeline-inline-add" data-stage="${stage.id}">+ New</button>
        <div class="opportunity-list" id="opportunities-${stage.id}">
    `;

    // Render opportunities in this stage
    stageData.opportunities.forEach(opp => {
      const isOverdue = opp.next_step_date && new Date(opp.next_step_date) < new Date();
      const competitors = opp.competitors ? JSON.parse(opp.competitors) : [];
      const isOwnOpportunity = !isManager || opp.user_id === currentUser.id;
      const stageDays = getStageDays(opp);

      // Get user info from joined data
      const user = opp.profiles;
      const ownerName = user ? `${user.first_name} ${user.last_name}` : 'Unknown';

      // Resolve company object from global cache if available (robust/fuzzy matching)
      const companyObj = findCompanyForOpportunity(opp);

      // Ensure we have a usable logo URL (fallback to favicon or UI Avatars)
      const companyInitials = getInitials((companyObj && companyObj.name) ? companyObj.name : (opp.company_name || ''));
      const companyNameResolved = (companyObj && companyObj.name) ? companyObj.name : (opp.company_name || companyInitials);
      const companyDomain = (companyObj && companyObj.domain) ? companyObj.domain : '';
      let companyLogoUrl = '';
      if (companyObj && companyObj.logo_url) {
        companyLogoUrl = companyObj.logo_url;
      } else if (companyDomain) {
        companyLogoUrl = getCompanyLogoUrl(companyDomain) || `https://ui-avatars.com/api/?name=${encodeURIComponent(companyNameResolved)}&background=ededed&color=444&size=64`;
      } else {
        // No matched company and no domain; try guessing a favicon via Google favicon proxy
        const guessedFavicon = guessDomainAndFavicon(companyNameResolved);
        if (guessedFavicon) {
          companyLogoUrl = guessedFavicon;
        } else {
          companyLogoUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(companyNameResolved)}&background=ededed&color=444&size=64`;
        }
      }
      // Cache computed logo_url for future renders when companyObj present
      if (companyObj && !companyObj.logo_url) companyObj.logo_url = companyLogoUrl;
      // Debug: log which logo URL we're using for this opportunity
      // opportunity logo info (silent)

      // Process mentioned people in notes using explicit mentioned_people from DB
      let processedNotes = opp.notes || '';
      // helper to escape regex special chars
      const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      if (opp.mentioned_people && Array.isArray(opp.mentioned_people) && opp.mentioned_people.length > 0) {
        // Each mentioned person object should have `id` and `name` fields
        opp.mentioned_people.forEach(person => {
          if (!person || !person.name) return;
          const safeName = escapeRegExp(person.name.trim());
          // match @Name as whole word (case-insensitive)
          const pattern = new RegExp(`@${safeName}\\b`, 'gi');
          processedNotes = processedNotes.replace(pattern, (match) => {
            // preserve original casing inside the span
            const displayName = person.name;
            return `<span class="mentioned-person">@${displayName}</span>`;
          });
        });
      } else {
        // Fallback: simple regex for single-word mentions (no DB info available)
        processedNotes = processedNotes.replace(/@([A-Za-z0-9_\-]+)\b/g, '<span class="mentioned-person">@$1</span>');
      }

      html += `
        <div class="opportunity-card ${!isOwnOpportunity ? 'readonly' : ''}"
          data-id="${opp.id}"
          data-company-name="${escapeHtml(opp.company_name || '')}"
          data-user-id="${opp.user_id}"
          data-owner-id="${opp.user_id}"
          data-value="${parseFloat(opp.value || 0)}"
          data-probability="${parseInt(opp.probability || 0, 10)}"
          data-created-ts="${new Date(opp.created_at).getTime() || 0}"
          data-next-step-ts="${opp.next_step_date ? new Date(opp.next_step_date).getTime() : ''}"
          draggable="${isOwnOpportunity}">

          <div class="opp-card-header">
            <div class="opp-company-row">
              <div class="opp-company-avatar">
                <div class="mention-avatar" style="width:22px;height:22px;font-size:0.6rem;border-radius:5px;flex-shrink:0;">${companyInitials}</div>
                ${companyLogoUrl ? `<img src="${companyLogoUrl}" class="opp-logo-img" onload="this.style.display='block';this.previousElementSibling.style.display='none'" onerror="this.style.display='none'" />` : ''}
              </div>
              <span class="opp-company-label">${escapeHtml(opp.company_name || 'No Company')}</span>
            </div>
            ${isOwnOpportunity ? `
              <button class="opp-drag-handle" title="Drag to move" onclick="event.stopPropagation()">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>
              </button>
            ` : ''}
          </div>

          <div class="opp-name">${escapeHtml(opp.name)}</div>

          <div class="opp-value-row">
            <span class="opp-value">Ksh ${parseFloat(opp.value || 0).toLocaleString()}</span>
            ${isManager && user ? `
              <span class="opp-owner-chip">
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                ${escapeHtml(ownerName)}
              </span>
            ` : ''}
          </div>

          <div class="opp-probability-row">
            <div class="opp-prob-bar">
              <div class="opp-prob-fill" style="width:${opp.probability || 0}%;background:${getProbabilityColor(opp.probability || 0)};"></div>
            </div>
            <span class="opp-prob-label">${opp.probability || 0}%</span>
          </div>

          ${opp.next_step ? `
            <div class="opp-next-step ${isOverdue ? 'overdue' : ''}">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="opp-step-icon"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/></svg>
              <span>${escapeHtml(opp.next_step)}</span>
              ${opp.next_step_date ? `<time class="opp-step-date">${formatDate(opp.next_step_date)}</time>` : ''}
            </div>
          ` : ''}

          ${competitors.length > 0 ? `
            <div class="opp-competitors">
              ${competitors.slice(0, 2).map(comp => `<span class="competitor-tag">${escapeHtml(comp)}</span>`).join('')}
              ${competitors.length > 2 ? `<span class="competitor-tag">+${competitors.length - 2}</span>` : ''}
            </div>
          ` : ''}

          ${opp.notes ? `
            <div class="opp-notes">${processedNotes.substring(0, 120)}${processedNotes.length > 120 ? '\u2026' : ''}</div>
          ` : ''}

          <div class="opp-card-footer">
            <span class="opp-stage-age">
              <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>
              ${stageDays}d
            </span>
            <span class="opp-created-date">${formatDate(opp.created_at)}</span>
            <div class="opp-actions-group">
              ${isOwnOpportunity ? `
                <button class="opportunity-action-btn edit-opportunity" data-id="${opp.id}" title="Edit">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/></svg>
                </button>
                <button class="opportunity-action-btn delete-opportunity" data-id="${opp.id}" title="Delete">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
              ` : `
                <button class="opportunity-action-btn view-opportunity" data-id="${opp.id}" title="View">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>
                </button>
              `}
            </div>
          </div>
        </div>
      `;
    });

    html += `
        </div>
      </div>
    `;
  });

  html += `</div>`;

  viewContainer.innerHTML = html;

  if (window.lucide) {
    lucide.createIcons();
  }

  // Initialize drag and drop with a small delay to ensure DOM is ready
  setTimeout(() => {
    initPipelineDragAndDrop(opportunities);
    initOpportunityEventListeners(opportunities);
    initPipelineFilters(opportunities);
  }, 100);

  // After render, ensure opportunity logos are updated to use companies' stored logos.
  try {
    // updating opportunity logos from companies table
    await updateOpportunityLogosAsync();
    // updateOpportunityLogosAsync completed
  } catch (e) {
    // updateOpportunityLogosAsync error (ignored)
  }
}

// Try to update opportunity cards to use company.logo_url from the `companies` table when available.
async function updateOpportunityLogosAsync() {
  if (!window.supabaseClient) return;
  const cards = Array.from(document.querySelectorAll('.opportunity-card'));
  for (const card of cards) {
    try {
      const companyName = card.getAttribute('data-company-name') || '';
      if (!companyName) continue;

      // Find cached company first
      let company = (Array.isArray(window.allCompaniesData) ? window.allCompaniesData.find(c => normalizeForMatching(c.name) === normalizeForMatching(companyName)) : null);
      if (!company) {
        // Query supabase for a matching company by name (case-insensitive, partial match)
        const { data, error } = await supabaseClient
          .from('companies')
          .select('id,name,domain,logo_url')
          .ilike('name', `%${companyName}%`)
          .limit(1);
        if (!error && Array.isArray(data) && data.length > 0) {
          company = data[0];
          window.allCompaniesData = window.allCompaniesData || [];
          // Avoid duplicates
          if (!window.allCompaniesData.find(c => String(c.id) === String(company.id))) {
            window.allCompaniesData.push(company);
          }
        }
      }

      if (company && company.logo_url) {
        // Preload the company.logo_url before assigning to DOM to avoid broken images
        const candidate = company.logo_url;
        // testing logo for company (silent)
        const imgEl = card.querySelector('.opp-company-avatar img');
        const placeholder = card.querySelector('.mention-avatar');
        try {
          await new Promise((resolve, reject) => {
            const tester = new Image();
            tester.onload = () => resolve(true);
            tester.onerror = () => reject(new Error('image load failed'));
            // attempt to load via tester
            tester.src = candidate;
            // Add a timeout in case of hanging requests
            setTimeout(() => reject(new Error('image load timeout')), 3000);
          });
          // success — set DOM image
          if (imgEl) {
            imgEl.src = candidate;
            imgEl.style.display = 'block';
          }
          if (placeholder) placeholder.style.display = 'none';
          // loaded logo for company
        } catch (e) {
          // logo failed for company, falling back
          // fallback: try domain favicon if present
          const domainCandidate = company.domain ? getCompanyLogoUrl(company.domain) : '';
          const finalFallback = domainCandidate || `https://ui-avatars.com/api/?name=${encodeURIComponent(companyName || company.name)}&background=ededed&color=444&size=64`;
          if (imgEl) {
            imgEl.src = finalFallback;
            imgEl.style.display = 'block';
          }
          if (placeholder) placeholder.style.display = 'none';
        }
      }
    } catch (e) {
      console.warn('updateOpportunityLogosAsync error', e);
    }
  }
}

function initOpportunityEventListeners(opportunities) {
  // Add opportunity button
  document.getElementById('add-opportunity-btn')?.addEventListener('click', () => {
    openOpportunityModal();
  });

  document.querySelectorAll('.pipeline-inline-add').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const stage = btn.dataset.stage || 'prospecting';
      openOpportunityModal();
      setTimeout(() => {
        const stageField = document.getElementById('opportunity-stage');
        if (stageField) {
          stageField.value = stage;
        }
      }, 0);
    });
  });

  // Edit opportunity buttons
  document.querySelectorAll('.edit-opportunity').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const opportunityId = btn.dataset.id;
      const opportunity = opportunities.find(opp => opp.id === opportunityId);
      if (opportunity) {
        openOpportunityModal(opportunity);
      }
    });
  });

  // Delete opportunity buttons
  document.querySelectorAll('.delete-opportunity').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const opportunityId = btn.dataset.id;
      const opportunity = opportunities.find(opp => opp.id === opportunityId);

      const confirmed = await showConfirmDialog(
        'Delete Opportunity',
        `Are you sure you want to delete ${opportunity.name}?`
      );

      if (!confirmed) return;

      const { error } = await supabaseClient
        .from('opportunities')
        .delete()
        .eq('id', opportunityId);

      if (error) {
        showToast('Error deleting opportunity: ' + error.message, 'error');
        return;
      }

      showToast('Opportunity deleted successfully', 'success');
      renderOpportunityPipelineView();
    });
  });

  // View opportunity buttons (for managers viewing others' opportunities)
  document.querySelectorAll('.view-opportunity').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const opportunityId = btn.dataset.id;
      const opportunity = opportunities.find(opp => opp.id === opportunityId);
      if (opportunity) {
        const isOwnOpportunity = !isManager || opportunity.user_id === currentUser.id;
        openOpportunityModal(opportunity, !isOwnOpportunity); // read-only if not own opportunity
      }
    });
  });

  // Click on opportunity card to view details
  document.querySelectorAll('.opportunity-card').forEach(card => {
    card.addEventListener('click', () => {
      const opportunityId = card.dataset.id;
      const opportunity = opportunities.find(opp => opp.id === opportunityId);
      if (opportunity) {
        const isOwnOpportunity = !isManager || opportunity.user_id === currentUser.id;
        openOpportunityModal(opportunity, !isOwnOpportunity); // read-only if not own opportunity
      }
    });
  });

  // Make mentioned person spans clickable to open the person view modal
  document.querySelectorAll('.opportunity-card .mentioned-person').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const personId = el.dataset.personId;
      const personName = el.dataset.personName || el.textContent.replace(/^@/, '').trim();
      if (personId) {
        openPersonViewModal(personId);
        return;
      }
      // Fallback: try to find by name
      const person = allPeople.find(p => String(p.name).trim().toLowerCase() === String(personName).toLowerCase());
      if (person) openPersonViewModal(person);
    });
  });
}


function initPipelineDragAndDrop(opportunities) {
  const opportunityLists = document.querySelectorAll('.opportunity-list');

  if (typeof Sortable === 'undefined') {
    console.error('Sortable.js library is not loaded!');
    showToast('Drag-and-drop functionality requires Sortable.js library', 'error');
    return;
  }

  opportunityLists.forEach(list => {
    new Sortable(list, {
      group: 'pipeline',
      animation: 200,
      easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
      swapThreshold: 0.5,
      fallbackOnBody: true,
      invertSwap: false,
      emptyInsertThreshold: 10,
      delay: 0,
      delayOnTouchOnly: false,
      touchStartThreshold: 3,
      draggable: '.opportunity-card:not(.readonly)',
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      preventOnFilter: false,
      filter: '.opportunity-action-btn',
      onStart: function (evt) {
        document.body.classList.add('is-dragging');
        evt.item.classList.add('dragging');
      },
      onEnd: function (evt) {
        document.body.classList.remove('is-dragging');
        evt.item.classList.remove('dragging');
      },
      onAdd: async function (evt) {
        const opportunityId = evt.item.dataset.id;
        const newStage = evt.to.closest('.pipeline-stage').dataset.stage;
        const oldStage = evt.from.closest('.pipeline-stage').dataset.stage;

        // Only update if stage changed
        if (newStage !== oldStage) {
          try {
            const { error } = await supabaseClient
              .from('opportunities')
              .update({
                stage: newStage,
                updated_at: new Date().toISOString()
              })
              .eq('id', opportunityId);

            if (error) throw error;

            // Update local state so that subsequent edits reflect the new stage
            const opportunity = opportunities.find(opp => opp.id === opportunityId);
            if (opportunity) {
              opportunity.stage = newStage;
              opportunity.updated_at = new Date().toISOString();

              // Map old stage values to new ones for the mappedStage property
              const stageMapping = {
                'prospecting': 'prospecting',
                'qualification': 'qualification',
                'proposal': 'qualification',
                'negotiation': 'qualification',
                'closed-won': 'closed-won',
                'closed-lost': 'closed-lost'
              };
              opportunity.mappedStage = stageMapping[newStage] || newStage;
            }

            const stageAgeEl = evt.item.querySelector('.opp-stage-age');
            if (stageAgeEl) {
              stageAgeEl.lastChild.textContent = ' 0d';
            }
            showInlineSuccess(evt.item);
            showToast('Opportunity moved', 'success', { subtle: true, duration: 1400, dedupeMs: 1200 });

            // Update stage counts
            updatePipelineStageCounts();

          } catch (error) {
            showToast('Error updating opportunity: ' + error.message, 'error');
            // Move item back to original position on error
            evt.from.appendChild(evt.item);
          }
        }
      }
    });
  });
}

function updatePipelineStageCounts() {
  document.querySelectorAll('.pipeline-stage').forEach(stage => {
    const stageId = stage.dataset.stage;
    const opportunities = stage.querySelectorAll('.opportunity-card:not([style*="display: none"])');
    const count = opportunities.length;

    // Update count badge
    const countBadge = stage.querySelector('.pipeline-stage-count');
    if (countBadge) {
      countBadge.textContent = count;
    }

    // Calculate and update total value
    let totalValue = 0;
    opportunities.forEach(card => {
      const valueText = card.querySelector('.opp-value')?.textContent;
      if (valueText) {
        totalValue += parseCurrencyValue(valueText);
      }
    });

    const valueElement = stage.querySelector('.pipeline-stage-value');
    if (valueElement) {
      valueElement.textContent = `Ksh ${totalValue.toLocaleString()}`;
    }
  });

  // Also update the main summary cards at the top
  updatePipelineSummary();
}

/**
 * Updates the summary cards at the top of the pipeline view based on current cards in the DOM.
 */
function updatePipelineSummary() {
  const visibleCards = document.querySelectorAll('.opportunity-card:not([style*="display: none"])');

  let totalValue = 0;
  let wonValue = 0;
  let lostValue = 0;
  let weightedForecast = 0;
  let totalProbability = 0;
  let activeCount = 0;
  let closedCount = 0;
  let wonCount = 0;

  visibleCards.forEach(card => {
    const valueText = card.querySelector('.opp-value')?.textContent;
    const value = parseCurrencyValue(valueText);
    totalValue += value;

    const probText = card.querySelector('.opp-prob-label')?.textContent;
    const probability = parseInt(probText?.replace('%', '') || 0);
    totalProbability += probability;
    weightedForecast += (value * probability) / 100;

    const stageId = card.closest('.pipeline-stage')?.dataset.stage;
    if (stageId === 'closed-won') {
      wonValue += value;
      closedCount++;
      wonCount++;
    } else if (stageId === 'closed-lost') {
      lostValue += value;
      closedCount++;
    } else if (stageId !== 'closed-lost') {
      activeCount++;
    }
  });

  const avgProbability = visibleCards.length > 0 ? Math.round(totalProbability / visibleCards.length) : 0;
  const winRate = closedCount > 0 ? Math.round((wonCount / closedCount) * 100) : 0;

  // Update DOM elements
  const summaryValues = document.querySelectorAll('.pipeline-summary-value');
  if (summaryValues.length >= 4) {
    summaryValues[0].textContent = `Ksh ${totalValue.toLocaleString()}`;
    summaryValues[1].textContent = activeCount;
    summaryValues[2].textContent = `Ksh ${Math.round(weightedForecast).toLocaleString()}`;
    summaryValues[3].textContent = `${winRate}%`;

    const summaryChanges = document.querySelectorAll('.pipeline-summary-change');
    if (summaryChanges.length >= 4) {
      summaryChanges[0].innerHTML = `<i class="fas fa-briefcase"></i> Active: Ksh ${Math.max(totalValue - wonValue - lostValue, 0).toLocaleString()}`;
      summaryChanges[1].innerHTML = `<i class="fas fa-flag-checkered"></i> Won: ${wonCount}`;
      summaryChanges[2].innerHTML = `<i class="fas fa-percent"></i> Avg probability: ${avgProbability}%`;
      summaryChanges[3].innerHTML = `<i class="fas fa-trophy"></i> Closed won value: Ksh ${wonValue.toLocaleString()}`;
    }
  }
}

function initPipelineFilters(opportunities) {
  const quickFilterSelect = document.getElementById('pipeline-quick-filter');
  const searchInput = document.getElementById('pipeline-search');
  const ownerSelect = document.getElementById('pipeline-owner-filter');
  const sortSelect = document.getElementById('pipeline-sort');
  const advancedToggle = document.getElementById('pipeline-advanced-toggle');
  const advancedControls = document.getElementById('pipeline-advanced-controls');
  const resetBtn = document.getElementById('pipeline-reset-controls');

  // Load persisted state
  const persistedState = _loadPersistedState().pipeline || {};
  if (searchInput && persistedState.search) searchInput.value = persistedState.search;
  if (quickFilterSelect && persistedState.quickFilter) quickFilterSelect.value = persistedState.quickFilter;
  if (ownerSelect && persistedState.owner) ownerSelect.value = persistedState.owner;
  if (sortSelect && persistedState.sort) sortSelect.value = persistedState.sort;
  if (persistedState.advancedOpen && advancedToggle && advancedControls) {
    advancedControls.removeAttribute('hidden');
    advancedToggle.setAttribute('aria-expanded', 'true');
    advancedToggle.classList.add('is-open');
  }

  const compareBySort = (a, b, sort) => {
    const aValue = Number(a.dataset.value || 0);
    const bValue = Number(b.dataset.value || 0);
    const aProb = Number(a.dataset.probability || 0);
    const bProb = Number(b.dataset.probability || 0);
    const aCreated = Number(a.dataset.createdTs || 0);
    const bCreated = Number(b.dataset.createdTs || 0);
    const aNext = Number(a.dataset.nextStepTs || Number.MAX_SAFE_INTEGER);
    const bNext = Number(b.dataset.nextStepTs || Number.MAX_SAFE_INTEGER);

    if (sort === 'oldest') return aCreated - bCreated;
    if (sort === 'value-desc') return bValue - aValue;
    if (sort === 'value-asc') return aValue - bValue;
    if (sort === 'probability-desc') return bProb - aProb;
    if (sort === 'next-step') return aNext - bNext;
    return bCreated - aCreated;
  };

  const applyPipelineControls = () => {
    const activeFilter = quickFilterSelect?.value || 'all';
    const query = (searchInput?.value || '').trim().toLowerCase();
    const owner = ownerSelect?.value || 'all';
    const sort = sortSelect?.value || 'newest';

    saveViewState({
      pipeline: {
        search: searchInput?.value || '',
        quickFilter: activeFilter,
        owner: owner,
        sort: sort,
        advancedOpen: advancedToggle?.classList.contains('is-open') || false
      }
    });

    document.querySelectorAll('.opportunity-card').forEach(card => {
      let show = true;

      if (activeFilter === 'my-reps') {
        const opportunity = opportunities.find(opp => opp.id === card.dataset.id);
        show = opportunity && opportunity.profiles && opportunity.profiles.role === 'sales_rep';
      } else if (activeFilter === 'high-value') {
        show = Number(card.dataset.value || 0) >= 100000;
      } else if (activeFilter === 'high-probability') {
        show = Number(card.dataset.probability || 0) >= 70;
      } else if (activeFilter === 'next-step-due') {
        show = !!card.querySelector('.opp-next-step');
      }

      if (show && owner !== 'all') {
        show = card.dataset.ownerId === owner;
      }

      if (show && query) {
        show = (card.textContent || '').toLowerCase().includes(query);
      }

      card.style.display = show ? 'block' : 'none';
    });

    document.querySelectorAll('.opportunity-list').forEach(list => {
      const visibleCards = Array.from(list.querySelectorAll('.opportunity-card')).filter(card => card.style.display !== 'none');
      visibleCards.sort((a, b) => compareBySort(a, b, sort));
      visibleCards.forEach(card => list.appendChild(card));
    });

    updatePipelineStageCounts();
  };

  advancedToggle?.addEventListener('click', () => {
    const isHidden = advancedControls?.hasAttribute('hidden');
    if (isHidden) {
      advancedControls?.removeAttribute('hidden');
      advancedToggle.setAttribute('aria-expanded', 'true');
      advancedToggle.classList.add('is-open');
    } else {
      advancedControls?.setAttribute('hidden', '');
      advancedToggle.setAttribute('aria-expanded', 'false');
      advancedToggle.classList.remove('is-open');
    }
    // Re-save state to capture panel toggle
    applyPipelineControls();
  });

  resetBtn?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    if (quickFilterSelect) quickFilterSelect.value = 'all';
    if (ownerSelect) ownerSelect.value = 'all';
    if (sortSelect) sortSelect.value = 'newest';
    applyPipelineControls();
  });

  quickFilterSelect?.addEventListener('change', applyPipelineControls);
  searchInput?.addEventListener('input', applyPipelineControls);
  ownerSelect?.addEventListener('change', applyPipelineControls);
  sortSelect?.addEventListener('change', applyPipelineControls);

  applyPipelineControls();
}

function openOpportunityModal(opportunity = null, readOnly = false) {
  const modal = document.getElementById('opportunity-modal');
  const modalTitle = document.getElementById('opportunity-modal-title');
  const saveBtn = document.getElementById('save-opportunity-btn');

  // Reset form
  document.getElementById('opportunity-name').value = '';
  document.getElementById('opportunity-company').value = '';
  document.getElementById('opportunity-value').value = '';
  document.getElementById('opportunity-probability').value = 50;
  document.getElementById('probability-display').textContent = '50';
  document.getElementById('opportunity-stage').value = 'prospecting'; // Default to first stage
  document.getElementById('opportunity-next-step').value = '';
  document.getElementById('opportunity-next-step-date').value = '';

  const notesTextarea = document.getElementById('opportunity-notes');
  if (notesTextarea) {
    notesTextarea.value = '';
    notesTextarea.style.display = '';
  }
  const existingNotesDisplay = document.getElementById('opportunity-notes-display');
  if (existingNotesDisplay) {
    try { existingNotesDisplay.remove(); } catch (e) { /* ignore */ }
  }

  // Clear competitors
  document.getElementById('competitors-container').innerHTML = '<input type="text" class="competitors-input" id="competitors-input" placeholder="Add competitor...">';

  // Reset mentioned people
  mentionedPeople = opportunity && opportunity.mentioned_people ? [...opportunity.mentioned_people] : [];

  // Set modal title
  if (opportunity) {
    modalTitle.innerHTML = readOnly
      ? `${opportunity.name}`
      : `Edit Opportunity`;

    // Fill form with opportunity data
    document.getElementById('opportunity-name').value = opportunity.name || '';
    document.getElementById('opportunity-company').value = opportunity.company_name || '';
    document.getElementById('opportunity-value').value = opportunity.value || '';
    document.getElementById('opportunity-probability').value = opportunity.probability || 50;
    document.getElementById('probability-display').textContent = opportunity.probability || 50;

    // Map old stage values to new ones
    let stageValue = opportunity.stage || 'prospecting';
    if (opportunity.stage === 'qualification') stageValue = 'qualification'; // Map to In Progress
    if (opportunity.stage === 'proposal' || opportunity.stage === 'negotiation') stageValue = 'qualification'; // Map to In Progress
    if (opportunity.stage === 'closed-won') stageValue = 'closed-won'; // Map to Won/Invoiced

    document.getElementById('opportunity-stage').value = stageValue;

    document.getElementById('opportunity-next-step').value = opportunity.next_step || '';
    document.getElementById('opportunity-next-step-date').value = opportunity.next_step_date || '';
    document.getElementById('opportunity-notes').value = opportunity.notes || '';

    // Add competitors
    if (opportunity.competitors) {
      const competitors = JSON.parse(opportunity.competitors);
      competitors.forEach(comp => addCompetitor(comp));
    }

    // Set read-only mode if needed
    if (readOnly) {
      document.querySelectorAll('#opportunity-modal input, #opportunity-modal select, #opportunity-modal textarea').forEach(el => {
        el.disabled = true;
      });
      saveBtn.style.display = 'none';
      // Render a read-only notes display with clickable mentions
      const notesTextarea = document.getElementById('opportunity-notes');
      let notesDisplay = document.getElementById('opportunity-notes-display');
      if (!notesDisplay) {
        notesDisplay = document.createElement('div');
        notesDisplay.id = 'opportunity-notes-display';
        notesDisplay.className = 'opportunity-notes-display';
        notesTextarea.parentNode.appendChild(notesDisplay);
      }

      // Build processed notes HTML (convert mentions to clickable spans)
      let displayHtml = escapeHtml(opportunity.notes || '');
      if (opportunity.mentioned_people && Array.isArray(opportunity.mentioned_people)) {
        opportunity.mentioned_people.forEach(person => {
          if (!person || !person.name) return;
          const safeName = escapeRegExp(person.name.trim());
          const pattern = new RegExp(`@${safeName}\\b`, 'gi');
          displayHtml = displayHtml.replace(pattern, ` <span class="mentioned-person" data-person-id="${person.id}">@${person.name}</span>`);
        });
      } else {
        displayHtml = displayHtml.replace(/@([A-Za-z0-9_\-]+)\b/g, '<span class="mentioned-person" data-person-name="$1">@$1</span>');
      }

      notesDisplay.innerHTML = displayHtml || '<div class="text-muted">No notes</div>';
      notesTextarea.style.display = 'none';
      // Attach click handlers to mentions inside modal
      notesDisplay.querySelectorAll('.mentioned-person').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const pid = el.dataset.personId;
          const pname = el.dataset.personName || el.textContent.replace(/^@/, '').trim();
          if (pid) return openPersonViewModal(pid);
          const person = allPeople.find(p => String(p.name).trim().toLowerCase() === String(pname).toLowerCase());
          if (person) openPersonViewModal(person);
        });
      });
    } else {
      document.querySelectorAll('#opportunity-modal input, #opportunity-modal select, #opportunity-modal textarea').forEach(el => {
        el.disabled = false;
      });
      saveBtn.style.display = 'block';
    }
  } else {
    modalTitle.innerHTML = 'New Opportunity';
    document.querySelectorAll('#opportunity-modal input, #opportunity-modal select, #opportunity-modal textarea').forEach(el => {
      el.disabled = false;
    });
    saveBtn.style.display = 'block';
  }

  // Show modal
  modal.style.display = 'flex';
  document.body.classList.add('modal-active');

  // Initialize event listeners
  initOpportunityModalListeners(opportunity);
}




function initOpportunityModalListeners(opportunity) {
  // Probability slider
  const probabilitySlider = document.getElementById('opportunity-probability');
  const probabilityDisplay = document.getElementById('probability-display');

  if (probabilitySlider) {
    const newSlider = probabilitySlider.cloneNode(true);
    probabilitySlider.parentNode.replaceChild(newSlider, probabilitySlider);
    newSlider.addEventListener('input', () => {
      probabilityDisplay.textContent = newSlider.value;
    });
  }

  // Company search
  const companyInput = document.getElementById('opportunity-company');
  const companySearchResults = document.getElementById('opportunity-company-search-results');

  const newCompanyInput = companyInput.cloneNode(true);
  companyInput.parentNode.replaceChild(newCompanyInput, companyInput);

  newCompanyInput.addEventListener('input', async (e) => {
    const query = e.target.value.toLowerCase().trim();

    if (query.length === 0) {
      companySearchResults.style.display = 'none';
      return;
    }

    // Use a small delay for search
    clearTimeout(companyInput.searchTimeout);
    companyInput.searchTimeout = setTimeout(async () => {
      let companies = window.allCompaniesData || [];

      // If companies not loaded, fetch them
      if (companies.length === 0) {
        const { data } = await supabaseClient
          .from('companies')
          .select('*')
          .order('name', { ascending: true });
        companies = data || [];
        window.allCompaniesData = companies; // Cache for future use
      }

      // Filter companies using tokenized search
      const filteredCompanies = companies.filter(company =>
        matchesTokenizedQuery(query, company.name, company.description, company.address)
      ).slice(0, 5);

      let resultsHTML = '';

      if (filteredCompanies.length > 0) {
        resultsHTML = filteredCompanies.map(company => {
          const initials = getInitials(company.name);
          const logoUrl = company.logo_url
            ? company.logo_url
            : (company.domain ? getCompanyLogoUrl(company.domain) : '');
          const avatarInner = logoUrl
            ? `<img src="${logoUrl}" class="opp-suggest-logo" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><span class="opp-suggest-initials" style="display:none">${initials}</span>`
            : `<span class="opp-suggest-initials">${initials}</span>`;
          return `
          <div class="search-result-item" onclick="selectOpportunityCompany('${escapeHtml(company.name)}')">
            <div class="opp-suggest-avatar">${avatarInner}</div>
            <div>
              <div class="search-result-name">${escapeHtml(company.name)}</div>
              <div class="search-result-role">${escapeHtml(company.description || company.domain || 'Company')}</div>
            </div>
          </div>`;
        }).join('');
      }

      // Always show option to use custom name if it's different from found companies
      const customNameOption = `
        <div class="search-result-item" onclick="selectOpportunityCompany('${escapeHtml(e.target.value.trim())}')">
          <div class="opp-suggest-avatar opp-suggest-avatar--custom">
            <span>+</span>
          </div>
          <div>
            <div class="search-result-name">Use "${escapeHtml(e.target.value.trim())}"</div>
            <div class="search-result-role">Add as custom company name</div>
          </div>
        </div>
      `;

      companySearchResults.innerHTML = resultsHTML + customNameOption;
      companySearchResults.style.display = 'block';
    }, 300);
  });

  // Allow pressing Enter to confirm custom company name
  newCompanyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && newCompanyInput.value.trim()) {
      e.preventDefault();
      selectOpportunityCompany(newCompanyInput.value.trim());
    }
  });

  // Close search results when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-container')) {
      companySearchResults.style.display = 'none';
    }
  });

  // Initialize mention system for notes
  let notesEl = document.getElementById('opportunity-notes');
  const mentionSuggestionsContainer = document.getElementById('opportunity-mention-suggestions');



  let mentionStartIndex = -1;
  let currentMentionQuery = '';
  let lastMentionStartIndex = -1;

  // Input event - detect @ and show suggestions
  const newNotesEl = notesEl.cloneNode(true);
  notesEl.parentNode.replaceChild(newNotesEl, notesEl);
  // Update reference so other handlers target the active textarea
  notesEl = newNotesEl;

  newNotesEl.addEventListener('input', (e) => {
    const text = newNotesEl.value;
    const cursorPos = newNotesEl.selectionStart;
    const beforeCursor = text.substring(0, cursorPos);
    const mentionMatch = beforeCursor.match(/@([^@\s]*)$/);

    if (mentionMatch) {
      mentionStartIndex = cursorPos - mentionMatch[0].length;
      currentMentionQuery = mentionMatch[1];

      showMentionSuggestions(currentMentionQuery, mentionSuggestionsContainer);
    } else {
      mentionSuggestionsContainer.style.display = 'none';
      mentionStartIndex = -1;
      currentMentionQuery = '';
    }
  });

  // Keyboard navigation for suggestions
  newNotesEl.addEventListener('keydown', (e) => {
    if (mentionSuggestionsContainer.style.display === 'none') return;

    const items = Array.from(mentionSuggestionsContainer.querySelectorAll('.mention-suggestion'));
    if (items.length === 0) return;

    let activeIndex = items.findIndex(item => item.classList.contains('active'));



    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % items.length;
      setActiveMention(items, activeIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + items.length) % items.length;
      setActiveMention(items, activeIndex);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      if (activeIndex >= 0) {

        insertMentionFromSuggestion(items[activeIndex], notesEl, mentionStartIndex, currentMentionQuery, mentionSuggestionsContainer);
      }
    } else if (e.key === 'Escape') {
      mentionSuggestionsContainer.style.display = 'none';
    }
  });

  // Handle mousedown on suggestions (before focus is lost)
  mentionSuggestionsContainer.addEventListener('mousedown', (e) => {
    const suggestion = e.target.closest('.mention-suggestion');
    if (suggestion) {
      e.preventDefault();
      e.stopPropagation();

      insertMentionFromSuggestion(suggestion, notesEl, mentionStartIndex, currentMentionQuery, mentionSuggestionsContainer);
    }
  }, true); // Capture phase

  // Close suggestions when clicking outside
  document.addEventListener('click', (e) => {
    if (e.target !== notesEl && !mentionSuggestionsContainer.contains(e.target)) {
      mentionSuggestionsContainer.style.display = 'none';
    }
  });

  // Competitors input
  const competitorsInput = document.getElementById('competitors-input');

  competitorsInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && competitorsInput.value.trim()) {
      e.preventDefault();
      addCompetitor(competitorsInput.value.trim());
      competitorsInput.value = '';
    }
  });

  // Save opportunity
  const saveBtn = document.getElementById('save-opportunity-btn');

  saveBtn.onclick = async () => {
    const name = document.getElementById('opportunity-name').value.trim();
    const companyName = document.getElementById('opportunity-company').value.trim();
    const value = document.getElementById('opportunity-value').value;
    const probability = document.getElementById('opportunity-probability').value;
    const stage = document.getElementById('opportunity-stage').value;
    const nextStep = document.getElementById('opportunity-next-step').value.trim();
    const nextStepDate = document.getElementById('opportunity-next-step-date').value;
    const notes = document.getElementById('opportunity-notes').value.trim();

    // Get competitors
    const competitorTags = document.querySelectorAll('.competitor-tag');
    const competitors = Array.from(competitorTags).map(tag =>
      tag.textContent.replace('×', '').trim()
    );

    // Validate
    if (!name || !companyName || !value) {
      showToast('Please fill in all required fields', 'error');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

    try {
      const opportunityData = {
        user_id: currentUser.id,
        name,
        company_name: companyName,
        value,
        probability,
        stage,
        next_step: nextStep || null,
        next_step_date: nextStepDate || null,
        notes: notes || null,
        competitors: competitors.length > 0 ? JSON.stringify(competitors) : null,
        mentioned_people: mentionedPeople,
        organization_id: currentOrganization?.id
      };

      let result;

      if (opportunity) {
        // Update existing opportunity
        result = await supabaseClient
          .from('opportunities')
          .update(opportunityData)
          .eq('id', opportunity.id);
      } else {
        // Create new opportunity
        result = await supabaseClient
          .from('opportunities')
          .insert([opportunityData]);
      }

      if (result.error) throw result.error;

      showToast(`Opportunity ${opportunity ? 'updated' : 'created'} successfully!`, 'success');
      closeModal('opportunity-modal');
      renderOpportunityPipelineView();

      // Set reminder for next step if date is provided
      if (nextStepDate) {
        scheduleNextStepReminder(name, nextStep, nextStepDate);
      }
    } catch (error) {
      showToast(`Error ${opportunity ? 'updating' : 'creating'} opportunity: ${error.message}`, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = 'Save Opportunity';
    }
  };
}

function addCompetitor(name) {
  const container = document.getElementById('competitors-container');
  const input = document.getElementById('competitors-input');

  // Check if competitor already exists
  const existingTags = container.querySelectorAll('.competitor-tag');
  for (const tag of existingTags) {
    if (tag.textContent.replace('×', '').trim() === name) {
      return; // Already exists
    }
  }

  // Create competitor tag
  const tag = document.createElement('span');
  tag.className = 'competitor-tag';
  tag.innerHTML = `
    ${name}
    <button class="remove" onclick="removeCompetitor(this)">×</button>
  `;

  // Insert before input
  container.insertBefore(tag, input);
}

window.removeCompetitor = function (element) {
  element.parentElement.remove();
};

window.selectOpportunityCompany = function (name) {
  document.getElementById('opportunity-company').value = name;
  document.getElementById('opportunity-company-search-results').style.display = 'none';
};

function getProbabilityColor(probability) {
  if (probability >= 70) return 'var(--color-success)';
  if (probability >= 40) return 'var(--color-warning)';
  return 'var(--color-danger)';
}

function scheduleNextStepReminder(opportunityName, nextStep, dueDate) {
  // Keep legacy local reminder support for existing flows
  const reminders = JSON.parse(localStorage.getItem('opportunityReminders') || '[]');

  reminders.push({
    opportunityName,
    nextStep,
    dueDate,
    acknowledged: false
  });

  localStorage.setItem('opportunityReminders', JSON.stringify(reminders));

  refreshDueNotifications({ forcePopup: true });
}

function getNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    showToast('This browser does not support notifications.', 'error');
    return 'unsupported';
  }

  if (Notification.permission === 'granted') {
    return 'granted';
  }

  const permission = await Notification.requestPermission();

  if (permission === 'granted') {
    showToast('Device notifications enabled.', 'success');
  } else if (permission === 'denied') {
    showToast('Notifications blocked. You can enable them in browser settings.', 'error');
  }

  return permission;
}

function readJsonStorage(key, fallback = {}) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // no-op
  }
}

function formatDueLabel(dateObj) {
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return '';
  return dateObj.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getDueStatus(dueAt) {
  const now = Date.now();
  const dueTs = dueAt.getTime();

  if (dueTs < now) return 'overdue';

  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);
  const endToday = new Date(startToday);
  endToday.setDate(endToday.getDate() + 1);

  if (dueTs >= startToday.getTime() && dueTs < endToday.getTime()) {
    return 'due-today';
  }

  return 'due-soon';
}

function mapTaskToDueNotification(task) {
  const dueAt = task?.due_date ? new Date(task.due_date) : null;
  if (!dueAt || Number.isNaN(dueAt.getTime())) return null;
  if (task.status === 'completed') return null;

  return {
    key: `task:${task.id}:${dueAt.toISOString()}`,
    id: String(task.id),
    entityType: 'task',
    view: 'tasks',
    title: task.title || 'Task due',
    message: `Task due ${formatDueLabel(dueAt)}`,
    dueAt,
    status: getDueStatus(dueAt)
  };
}

function mapReminderToDueNotification(reminder) {
  const dueAt = reminder?.reminder_date ? new Date(reminder.reminder_date) : null;
  if (!dueAt || Number.isNaN(dueAt.getTime())) return null;
  if (reminder.is_completed) return null;

  return {
    key: `reminder:${reminder.id}:${dueAt.toISOString()}`,
    id: String(reminder.id),
    entityType: 'reminder',
    view: 'reminders',
    title: reminder.title || 'Reminder due',
    message: `Reminder due ${formatDueLabel(dueAt)}`,
    dueAt,
    status: getDueStatus(dueAt)
  };
}

function mapOpportunityToDueNotification(opportunity) {
  const dueAt = opportunity?.next_step_date ? new Date(opportunity.next_step_date) : null;
  if (!dueAt || Number.isNaN(dueAt.getTime())) return null;

  const stageRaw = String(opportunity.stage || '').toLowerCase();
  if (stageRaw === 'closed-won' || stageRaw === 'closed-lost') return null;

  const company = opportunity.company_name || 'Deal';
  const step = opportunity.next_step || 'Next step';

  return {
    key: `deal:${opportunity.id}:${dueAt.toISOString()}`,
    id: String(opportunity.id),
    entityType: 'deal',
    view: 'opportunity-pipeline',
    title: company,
    message: `${step} due ${formatDueLabel(dueAt)}`,
    dueAt,
    status: getDueStatus(dueAt)
  };
}

async function fetchDueNotificationItems() {
  if (!currentUser?.id) return [];

  const horizon = new Date();
  horizon.setDate(horizon.getDate() + 1);
  const horizonIso = horizon.toISOString();
  const horizonDate = horizonIso.split('T')[0];

  let tasksQuery = supabaseClient
    .from('tasks')
    .select('id, title, due_date, status, assigned_to, created_by')
    .not('due_date', 'is', null)
    .neq('status', 'completed')
    .lte('due_date', horizonIso)
    .or(`assigned_to.eq.${currentUser.id},created_by.eq.${currentUser.id}`);
  if (currentOrganization?.id) tasksQuery = tasksQuery.eq('organization_id', currentOrganization.id);

  let remindersQuery = supabaseClient
    .from('reminders')
    .select('id, title, reminder_date, is_completed, assigned_to, created_by')
    .not('reminder_date', 'is', null)
    .neq('is_completed', true)
    .lte('reminder_date', horizonIso)
    .or(`assigned_to.eq.${currentUser.id},created_by.eq.${currentUser.id}`);
  if (currentOrganization?.id) remindersQuery = remindersQuery.eq('organization_id', currentOrganization.id);

  let opportunitiesQuery = supabaseClient
    .from('opportunities')
    .select('id, name, company_name, next_step, next_step_date, stage, user_id')
    .not('next_step_date', 'is', null)
    .lte('next_step_date', horizonDate)
    .neq('stage', 'closed-won')
    .neq('stage', 'closed-lost');

  if (!isManager) {
    opportunitiesQuery = opportunitiesQuery.eq('user_id', currentUser.id);
  }
  if (currentOrganization?.id) opportunitiesQuery = opportunitiesQuery.eq('organization_id', currentOrganization.id);

  const [tasksRes, remindersRes, opportunitiesRes] = await Promise.all([
    tasksQuery,
    remindersQuery,
    opportunitiesQuery
  ]);

  const taskItems = (tasksRes.data || []).map(mapTaskToDueNotification).filter(Boolean);
  const reminderItems = (remindersRes.data || []).map(mapReminderToDueNotification).filter(Boolean);
  const dealItems = (opportunitiesRes.data || []).map(mapOpportunityToDueNotification).filter(Boolean);

  return [...taskItems, ...reminderItems, ...dealItems]
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
    .slice(0, 25);
}

function renderDueNotificationsUI() {
  if (!notificationsList || !notificationsCount) return;

  const readMap = readJsonStorage(DUE_READ_STORAGE_KEY, {});
  const unreadCount = dueNotificationState.items.filter(item => !readMap[item.key]).length;
  dueNotificationState.unreadCount = unreadCount;

  if (unreadCount > 0) {
    notificationsCount.style.display = 'inline-flex';
    notificationsCount.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
  } else {
    notificationsCount.style.display = 'none';
  }

  if (dueNotificationState.items.length === 0) {
    notificationsList.innerHTML = '<div class="notifications-empty">No due alerts right now.</div>';
    return;
  }

  notificationsList.innerHTML = dueNotificationState.items.map(item => {
    const unreadClass = readMap[item.key] ? '' : ' unread';
    const typeLabel = item.entityType === 'deal' ? 'Deal' : (item.entityType === 'task' ? 'Task' : 'Reminder');
    const timeLabel = formatDueLabel(item.dueAt);
    return `
      <button class="notification-item ${item.status}${unreadClass}" data-view="${item.view}">
        <div class="notification-item-head">
          <span class="notification-item-type">${typeLabel}</span>
          <span class="notification-item-time">${timeLabel}</span>
        </div>
        <div class="notification-item-title">${item.title}</div>
        <div class="notification-item-message">${item.message}</div>
      </button>
    `;
  }).join('');
}

function updateNotificationPermissionCTA() {
  if (!notificationsEnableBtn) return;

  const permission = getNotificationPermission();
  if (permission === 'default') {
    notificationsEnableBtn.style.display = 'inline-flex';
    notificationsEnableBtn.textContent = 'Enable device alerts';
  } else if (permission === 'denied') {
    notificationsEnableBtn.style.display = 'inline-flex';
    notificationsEnableBtn.textContent = 'Alerts blocked in browser';
  } else {
    notificationsEnableBtn.style.display = 'none';
  }
}

async function pushDeviceNotification(item) {
  if (!('serviceWorker' in navigator)) return;
  if (getNotificationPermission() !== 'granted') return;

  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return;

  const titlePrefix = item.status === 'overdue' ? 'Overdue' : (item.status === 'due-today' ? 'Due today' : 'Due soon');
  const title = `${titlePrefix}: ${item.entityType === 'deal' ? 'Deal' : (item.entityType === 'task' ? 'Task' : 'Reminder')}`;

  await registration.showNotification(title, {
    body: `${item.title} — ${item.message}`,
    icon: '/assets/icons/whiteblue.png',
    badge: '/assets/icons/whiteblue.png',
    tag: item.key,
    renotify: false,
    data: {
      url: `/crm/`,
      view: item.view
    }
  });
}

function getDuePopupContainer() {
  let container = document.getElementById('due-popup-container');
  if (container) return container;

  container = document.createElement('div');
  container.id = 'due-popup-container';
  container.className = 'due-popup-container';
  document.body.appendChild(container);
  return container;
}

function clearDuePopupTimers() {
  duePopupHideTimers.forEach(timer => clearTimeout(timer));
  duePopupHideTimers = [];
}

function showDuePopup(items) {
  if (!Array.isArray(items) || items.length === 0) return;

  const container = getDuePopupContainer();
  clearDuePopupTimers();

  const renderItems = items.slice(0, 3);
  container.innerHTML = renderItems.map((item) => {
    const typeLabel = item.entityType === 'deal' ? 'Deal' : (item.entityType === 'task' ? 'Task' : 'Reminder');
    const dueText = formatDueLabel(item.dueAt);
    return `
      <button class="due-popup-card ${item.status}" data-view="${item.view}">
        <div class="due-popup-head">
          <span class="due-popup-type">${typeLabel}</span>
          <span class="due-popup-time">${dueText}</span>
        </div>
        <div class="due-popup-title">${item.title}</div>
        <div class="due-popup-message">${item.message}</div>
      </button>
    `;
  }).join('');

  container.classList.add('active');

  container.onclick = async (e) => {
    const card = e.target.closest('.due-popup-card');
    if (!card) return;
    const view = card.dataset.view;
    container.classList.remove('active');
    if (view && view !== currentView) {
      await loadView(view);
    }
  };

  const hideTimer = setTimeout(() => {
    container.classList.remove('active');
  }, 6000);
  duePopupHideTimers.push(hideTimer);
}

async function notifyForNewDueItems(items, forcePopup = false) {
  const now = Date.now();
  const notifiedMap = readJsonStorage(DUE_NOTIFIED_STORAGE_KEY, {});
  const fresh = [];

  items.forEach(item => {
    if (!notifiedMap[item.key]) {
      fresh.push(item);
      notifiedMap[item.key] = now;
    }
  });

  const retentionMs = 7 * 24 * 60 * 60 * 1000;
  Object.keys(notifiedMap).forEach(key => {
    if (now - notifiedMap[key] > retentionMs) {
      delete notifiedMap[key];
    }
  });

  writeJsonStorage(DUE_NOTIFIED_STORAGE_KEY, notifiedMap);

  if (fresh.length === 0 && !forcePopup) return;

  const toNotify = fresh.slice(0, 3);
  for (const item of toNotify) {
    await pushDeviceNotification(item);
  }

  const dueNowItems = items.filter(item => item.status === 'overdue' || item.status === 'due-today');
  const popupItems = fresh.length > 0 ? fresh : dueNowItems;

  if (popupItems.length > 0) {
    showDuePopup(popupItems);
  }
}

function markAllDueNotificationsRead() {
  const readMap = readJsonStorage(DUE_READ_STORAGE_KEY, {});
  dueNotificationState.items.forEach(item => {
    readMap[item.key] = Date.now();
  });
  writeJsonStorage(DUE_READ_STORAGE_KEY, readMap);
  renderDueNotificationsUI();
}

async function refreshDueNotifications({ forcePopup = false } = {}) {
  try {
    const items = await fetchDueNotificationItems();
    dueNotificationState.items = items;
    renderDueNotificationsUI();
    updateNotificationPermissionCTA();
    await notifyForNewDueItems(items, forcePopup);
  } catch (error) {
    console.error('Due notifications refresh failed:', error);
  }
}

function startDueNotificationsMonitor() {
  stopDueNotificationsMonitor();

  refreshDueNotifications();

  dueNotificationsPollId = window.setInterval(() => {
    refreshDueNotifications();
  }, 120000);

  document.addEventListener('visibilitychange', handleDueNotificationVisibility);
}

function stopDueNotificationsMonitor() {
  if (dueNotificationsPollId) {
    clearInterval(dueNotificationsPollId);
    dueNotificationsPollId = null;
  }
  document.removeEventListener('visibilitychange', handleDueNotificationVisibility);
}

function handleDueNotificationVisibility() {
  if (!document.hidden) {
    refreshDueNotifications();
  }
}

function checkDueReminders() {
  refreshDueNotifications();
}

function getDisplayNameFromProfile(profileLike) {
  if (!profileLike) return 'Teammate';
  const first = String(profileLike.first_name || '').trim();
  const last = String(profileLike.last_name || '').trim();
  const full = `${first} ${last}`.trim();
  if (full) return full;
  return String(profileLike.email || 'Teammate');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clearSafiNudgeTimers() {
  safiNudgeTimers.forEach((timer) => clearTimeout(timer));
  safiNudgeTimers = [];
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
  safiNudgeQueue.push(nudge);
  if (!safiNudgeShowing) {
    renderNextSafiNudge();
  }
}

function hideSafiNudgeCard() {
  const container = document.getElementById('safi-nudge-container');
  if (!container) return;

  container.classList.remove('show-message');
  container.classList.remove('active');

  const completeHideTimer = window.setTimeout(() => {
    if (!safiNudgeShowing) {
      container.innerHTML = '';
      return;
    }
    safiNudgeShowing = false;
    renderNextSafiNudge();
  }, 320);

  safiNudgeTimers.push(completeHideTimer);
}

function renderNextSafiNudge() {
  if (safiNudgeQueue.length === 0) {
    safiNudgeShowing = false;
    const container = document.getElementById('safi-nudge-container');
    if (container) {
      container.classList.remove('active');
      container.innerHTML = '';
    }
    return;
  }

  safiNudgeShowing = true;
  clearSafiNudgeTimers();

  const nudge = safiNudgeQueue.shift();
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
  safiNudgeTimers.push(revealTimer);

  container.onclick = () => {
    hideSafiNudgeCard();
  };

  const hideTimer = window.setTimeout(() => {
    hideSafiNudgeCard();
  }, 5600);
  safiNudgeTimers.push(hideTimer);
}

function handleIncomingSafiNudge(payload) {
  if (!payload || !currentUser?.id) return;
  if (String(payload.toUserId || '') !== String(currentUser.id)) return;
  if (String(payload.fromUserId || '') === String(currentUser.id)) return;

  queueSafiNudge(payload);
}

function stopSafiNudgeRealtime() {
  if (safiNudgeChannel) {
    supabaseClient.removeChannel(safiNudgeChannel);
    safiNudgeChannel = null;
  }
  safiNudgeSubscribed = false;
  safiNudgeLastStatus = 'stopped';
  safiNudgeStarting = false;
  safiNudgeReconnectAttempt = 0;
  if (safiNudgeReconnectTimer) {
    clearTimeout(safiNudgeReconnectTimer);
    safiNudgeReconnectTimer = null;
  }
  safiNudgeQueue = [];
  safiNudgeShowing = false;
  clearSafiNudgeTimers();

  const container = document.getElementById('safi-nudge-container');
  if (container) {
    container.classList.remove('active');
    container.innerHTML = '';
  }
}

function scheduleSafiNudgeReconnect(reason = 'unknown') {
  if (!currentUser?.id) return;
  if (safiNudgeReconnectTimer) return;

  safiNudgeReconnectAttempt += 1;
  const delayMs = Math.min(4000, 500 + (safiNudgeReconnectAttempt - 1) * 700);

  safiNudgeReconnectTimer = window.setTimeout(() => {
    safiNudgeReconnectTimer = null;
    startSafiNudgeRealtime();
  }, delayMs);
}

async function startSafiNudgeRealtime() {
  if (!currentUser?.id) return;
  if (safiNudgeStarting) {
    return;
  }

  safiNudgeStarting = true;
  if (safiNudgeReconnectTimer) {
    clearTimeout(safiNudgeReconnectTimer);
    safiNudgeReconnectTimer = null;
  }

  if (safiNudgeChannel) {
    supabaseClient.removeChannel(safiNudgeChannel);
    safiNudgeChannel = null;
  }
  safiNudgeSubscribed = false;
  safiNudgeLastStatus = 'starting';

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

  const nudgeChannelName = currentOrganization?.id
    ? `${SAFI_NUDGE_CHANNEL}:${currentOrganization.id}`
    : SAFI_NUDGE_CHANNEL;
  safiNudgeChannel = supabaseClient.channel(nudgeChannelName, {
    config: {
      broadcast: { self: false }
    }
  });

  safiNudgeChannel
    .on('broadcast', { event: SAFI_NUDGE_EVENT }, ({ payload }) => {
      handleIncomingSafiNudge(payload);
    })
    .subscribe((status) => {
      safiNudgeLastStatus = status;
      safiNudgeSubscribed = status === 'SUBSCRIBED';

      if (status === 'SUBSCRIBED') {
        safiNudgeStarting = false;
        safiNudgeReconnectAttempt = 0;
        return;
      }

      if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR' || status === 'CLOSED') {
        safiNudgeStarting = false;
        safiNudgeSubscribed = false;
        scheduleSafiNudgeReconnect(status);
      }
    });

  window.setTimeout(() => {
    if (safiNudgeLastStatus === 'starting') {
      safiNudgeStarting = false;
      scheduleSafiNudgeReconnect('startup-no-status');
    }
  }, 2600);
}

async function ensureSafiNudgeReady(timeoutMs = 5200) {
  if (!currentUser?.id) return false;

  if (!safiNudgeChannel) {
    await startSafiNudgeRealtime();
  }

  if (safiNudgeSubscribed) {
    return true;
  }

  const startedAt = Date.now();
  let iterations = 0;
  while (Date.now() - startedAt < timeoutMs) {
    iterations += 1;
    await new Promise((resolve) => setTimeout(resolve, 120));
    if (safiNudgeSubscribed) {
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
  const orgId = currentOrganization?.id;
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
    if (id === String(currentUser?.id || '')) return;

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
  if (!currentUser?.id) return;
  if (targetUserId && String(targetUserId) === String(currentUser.id)) {
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
  if (!isReady || !safiNudgeChannel) {
    showToast(`SafiNudge could not connect (status: ${safiNudgeLastStatus}).`, 'error');
    return false;
  }

  const safeMessage = String(message || '').trim().slice(0, 160);
  if (!safeMessage) {
    showToast('Nudge message cannot be empty', 'error');
    return false;
  }

  const fromName = getDisplayNameFromProfile(currentUserProfile);
  const payload = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fromUserId: currentUser.id,
    fromName,
    toUserId,
    toUserName,
    message: safeMessage,
    sentAt: new Date().toISOString()
  };

  try {
    const result = await safiNudgeChannel.send({
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
  if (!currentUser?.id) return;

  queueSafiNudge({
    id: `test-${Date.now()}`,
    fromUserId: 'safibot',
    fromName: 'SafiBot',
    toUserId: currentUser.id,
    toUserName: getDisplayNameFromProfile(currentUserProfile),
    message: 'Debug ping! Your SafiNudge bot is alive and adorable ✨',
    sentAt: new Date().toISOString()
  });

  showToast('Test SafiNudge triggered', 'info', { subtle: true, duration: 1400, dedupeMs: 800 });
};

// ======================
// VISITS HUB - PREMIUM MANAGER VIEW
// ======================

let visitsHubState = {
  visits: [],
  salesReps: [],
  filteredVisits: [],
  currentView: (_persisted.teamDashboard && _persisted.teamDashboard.currentView) || 'cards',
  selectedVisitId: null,
  filters: Object.assign({
    search: '',
    rep: '',
    type: '',
    dateFrom: '',
    dateTo: '',
    scoreMin: ''
  }, _persisted.teamDashboard?.filters || {}),
  sortBy: (_persisted.teamDashboard && _persisted.teamDashboard.sortBy) || 'newest'
};

async function renderTeamDashboardView() {
  // Show loading state
  viewContainer.innerHTML = `
    <div class="visits-hub">
      <div class="visits-hero">
        ${[1, 2, 3, 4].map(() => '<div class="visits-skeleton" style="height: 120px;"></div>').join('')}
      </div>
      <div class="visits-skeleton" style="height: 60px;"></div>
      <div class="visits-skeleton" style="height: 400px;"></div>
    </div>
  `;

  // Fetch all data
  let tpQ = supabaseClient.from('profiles').select('*').order('first_name', { ascending: true });
  if (currentOrganization?.id) tpQ = tpQ.eq('organization_id', currentOrganization.id);
  const { data: allProfiles, error: profilesError } = await tpQ;

  if (profilesError) {
    viewContainer.innerHTML = renderError('Unable to load team data: ' + profilesError.message);
    return;
  }

  let tvQ = supabaseClient.from('visits').select('*').order('created_at', { ascending: false });
  if (currentOrganization?.id) tvQ = tvQ.eq('organization_id', currentOrganization.id);
  const { data: visits, error: visitsError } = await tvQ;

  if (visitsError) {
    viewContainer.innerHTML = renderError(visitsError.message);
    return;
  }

  // Hydrate visits with user data
  const visitsWithProfiles = visits.map(visit => {
    const userProfile = allProfiles.find(p => p.id === visit.user_id);
    return {
      ...visit,
      user: userProfile || { id: visit.user_id, first_name: 'Unknown', last_name: 'User', email: '', role: 'sales_rep' }
    };
  });

  // Get sales reps only
  const salesReps = allProfiles.filter(p => p.role === 'sales_rep');

  // Store in state
  visitsHubState.visits = visitsWithProfiles;
  visitsHubState.salesReps = salesReps;
  visitsHubState.filteredVisits = visitsWithProfiles;

  // Calculate stats
  const totalVisits = visitsWithProfiles.length;
  const todayVisits = visitsWithProfiles.filter(v => isToday(new Date(v.created_at))).length;
  const weekVisits = visitsWithProfiles.filter(v => isThisWeek(new Date(v.created_at))).length;
  const lastWeekVisits = visitsWithProfiles.filter(v => isLastWeek(new Date(v.created_at))).length;
  const weekTrend = lastWeekVisits > 0 ? Math.round(((weekVisits - lastWeekVisits) / lastWeekVisits) * 100) : 100;

  const avgLeadScore = visitsWithProfiles.filter(v => v.lead_score).length > 0
    ? Math.round(visitsWithProfiles.reduce((sum, v) => sum + (v.lead_score || 0), 0) / visitsWithProfiles.filter(v => v.lead_score).length)
    : 0;

  const verifiedVisits = visitsWithProfiles.filter(v => v.location_verified).length;
  const verificationRate = totalVisits > 0 ? Math.round((verifiedVisits / totalVisits) * 100) : 0;

  // Build leaderboard
  const repStats = {};
  salesReps.forEach(rep => {
    repStats[rep.id] = { ...rep, visitCount: 0 };
  });
  visitsWithProfiles.forEach(visit => {
    if (repStats[visit.user_id]) {
      repStats[visit.user_id].visitCount++;
    }
  });
  const leaderboard = Object.values(repStats).sort((a, b) => b.visitCount - a.visitCount).slice(0, 5);

  // Generate recent activity
  const recentActivity = visitsWithProfiles.slice(0, 10).map(visit => ({
    id: visit.id,
    user: visit.user,
    company: visit.company_name,
    type: visit.visit_type,
    time: visit.created_at,
    score: visit.lead_score
  }));

  // Render the hub
  viewContainer.innerHTML = `
    <div class="visits-hub">
      <!-- Hero Stats -->
      <div class="visits-hero">
        <div class="visits-hero-stat accent-blue">
          <div class="visits-stat-header">
            <div class="visits-stat-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </div>
            ${weekTrend !== 0 ? `
              <span class="visits-stat-trend ${weekTrend > 0 ? 'up' : 'down'}">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="${weekTrend > 0 ? '18 15 12 9 6 15' : '6 9 12 15 18 9'}"></polyline></svg>
                ${Math.abs(weekTrend)}%
              </span>
            ` : ''}
          </div>
          <div class="visits-stat-value">${totalVisits}</div>
          <div class="visits-stat-label">Total Visits</div>
        </div>
        
        <div class="visits-hero-stat accent-green">
          <div class="visits-stat-header">
            <div class="visits-stat-icon green">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4"/><path d="m4.93 4.93 2.83 2.83"/><path d="M2 12h4"/><path d="m4.93 19.07 2.83-2.83"/><path d="M12 18v4"/><path d="m16.24 16.24 2.83 2.83"/><path d="M18 12h4"/><path d="m16.24 7.76 2.83-2.83"/><circle cx="12" cy="12" r="4"/></svg>
            </div>
          </div>
          <div class="visits-stat-value">${todayVisits}</div>
          <div class="visits-stat-label">Today's Visits</div>
        </div>
        
        <div class="visits-hero-stat accent-orange">
          <div class="visits-stat-header">
            <div class="visits-stat-icon orange">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/></svg>
            </div>
          </div>
          <div class="visits-stat-value">${avgLeadScore}%</div>
          <div class="visits-stat-label">Avg Lead Score</div>
        </div>
        
        <div class="visits-hero-stat accent-purple">
          <div class="visits-stat-header">
            <div class="visits-stat-icon purple">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>
            </div>
          </div>
          <div class="visits-stat-value">${verificationRate}%</div>
          <div class="visits-stat-label">Location Verified</div>
        </div>
      </div>

      <!-- Command Bar -->
      <div class="visits-command-bar">
        <div class="visits-search-box">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input type="text" id="visits-search" placeholder="Search visits by company, rep, or notes...">
        </div>
        
        <div class="visits-view-toggle">
          <button class="visits-view-btn active" data-view="cards" title="Card View">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>
          </button>
          <button class="visits-view-btn" data-view="timeline" title="Timeline View">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" x2="21" y1="6" y2="6"/><line x1="3" x2="21" y1="12" y2="12"/><line x1="3" x2="21" y1="18" y2="18"/></svg>
          </button>
          <button class="visits-view-btn" data-view="map" title="Map View">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/></svg>
          </button>
        </div>

        <button class="visits-filters-toggle" id="toggle-filters">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
          Filters
          <span class="visits-filters-count" id="filters-count" style="display: none;">0</span>
        </button>
        
        <div class="visits-actions-group">
          <button class="btn btn-secondary btn-sm" onclick="exportVisitsToCSV()">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
            Export
          </button>
        </div>
      </div>

      <!-- Filters Panel -->
      <div class="visits-filters-panel" id="filters-panel">
        <div class="visits-filters-grid">
          <div class="visits-filter-group">
            <label class="visits-filter-label">Sales Rep</label>
            <select class="visits-filter-select" id="filter-rep">
              <option value="">All Reps</option>
              ${salesReps.map(rep => `<option value="${rep.id}">${rep.first_name} ${rep.last_name}</option>`).join('')}
            </select>
          </div>
          
          <div class="visits-filter-group">
            <label class="visits-filter-label">Visit Type</label>
            <select class="visits-filter-select" id="filter-type">
              <option value="">All Types</option>
              <option value="new_lead">New Lead</option>
              <option value="follow_up">Follow-up</option>
              <option value="demo">Product Demo</option>
              <option value="closing">Closing</option>
              <option value="support">Customer Support</option>
            </select>
          </div>
          
          <div class="visits-filter-group">
            <label class="visits-filter-label">Lead Score</label>
            <select class="visits-filter-select" id="filter-score">
              <option value="">Any Score</option>
              <option value="70">High (70%+)</option>
              <option value="40">Medium (40-69%)</option>
              <option value="0">Low (< 40%)</option>
            </select>
          </div>
          
          <div class="visits-filter-group span-2">
            <label class="visits-filter-label">Date Range</label>
            <div class="visits-date-range">
              <input type="date" id="filter-date-from">
              <span>to</span>
              <input type="date" id="filter-date-to">
            </div>
          </div>
        </div>
        
        <div class="visits-filters-footer">
          <button class="btn btn-ghost btn-sm" id="clear-all-filters">Clear All</button>
          <button class="btn btn-primary btn-sm" id="apply-filters">Apply Filters</button>
        </div>
      </div>

      <!-- Main Content -->
      <div class="visits-main-content">
        <div class="visits-list-section">
          <div class="visits-list-header">
            <div>
              <span class="visits-list-title">All Visits</span>
              <span class="visits-list-count" id="visits-count">${visitsWithProfiles.length} visits</span>
            </div>
            <div class="visits-list-sort">
              <label>Sort by:</label>
              <select class="visits-sort-select" id="visits-sort">
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="score-high">Highest Score</option>
                <option value="score-low">Lowest Score</option>
                <option value="company">Company A-Z</option>
              </select>
            </div>
          </div>
          
          <!-- Cards View -->
          <div class="visits-list-container" id="visits-cards-view">
            ${renderVisitsCards(visitsWithProfiles)}
          </div>
          
          <!-- Timeline View -->
          <div class="visits-timeline-view" id="visits-timeline-view">
            ${renderVisitsTimeline(visitsWithProfiles)}
          </div>
          
          <!-- Map View -->
          <div class="visits-map-view" id="visits-map-view">
            <div class="visits-map-container" id="visits-map"></div>
            <div class="visits-map-legend">
              <div class="map-legend-item"><span class="map-legend-dot" style="background: #3b82f6;"></span> New Lead</div>
              <div class="map-legend-item"><span class="map-legend-dot" style="background: #8b5cf6;"></span> Follow-up</div>
              <div class="map-legend-item"><span class="map-legend-dot" style="background: #f59e0b;"></span> Demo</div>
              <div class="map-legend-item"><span class="map-legend-dot" style="background: #10b981;"></span> Closing</div>
              <div class="map-legend-item"><span class="map-legend-dot" style="background: #6b7280;"></span> Support</div>
            </div>
          </div>
        </div>

        <!-- Activity Sidebar -->
        <div class="visits-activity-sidebar">
          <div class="activity-sidebar-header">
            <span class="activity-sidebar-title">Team Activity</span>
            <span class="activity-live-dot"></span>
          </div>
          
          <div class="activity-sidebar-tabs">
            <button class="activity-tab active" data-tab="activity">Activity</button>
            <button class="activity-tab" data-tab="leaderboard">Leaderboard</button>
          </div>
          
          <div class="activity-sidebar-content">
            <div id="activity-tab-content">
              <div class="activity-timeline">
                ${renderActivityTimeline(recentActivity)}
              </div>
            </div>
            <div id="leaderboard-tab-content" style="display: none;">
              <div class="team-leaderboard">
                ${renderLeaderboard(leaderboard)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Visit Detail Panel -->
    <div class="visit-detail-backdrop" id="visit-detail-backdrop"></div>
    <div class="visit-detail-panel" id="visit-detail-panel">
      <div class="visit-detail-header">
        <button class="visit-detail-close" id="close-visit-detail">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
        <div class="visit-detail-actions">
          <button class="btn btn-ghost btn-sm" id="visit-detail-pdf">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>
            PDF
          </button>
        </div>
      </div>
      <div class="visit-detail-body" id="visit-detail-body">
        <!-- Content loaded dynamically -->
      </div>
    </div>
  `;

  // Initialize interactions
  initVisitsHub();

  // Re-apply filters and show correct view based on state
  applyVisitsFilters();
  switchVisitsView(visitsHubState.currentView, false); // false = don't save state again during initial render
}

// Helper functions for date checks
function isToday(date) {
  const today = new Date();
  return date.toDateString() === today.toDateString();
}

function isThisWeek(date) {
  const now = new Date();
  const weekStart = new Date(now.setDate(now.getDate() - now.getDay()));
  weekStart.setHours(0, 0, 0, 0);
  return date >= weekStart;
}

function isLastWeek(date) {
  const now = new Date();
  const lastWeekStart = new Date(now.setDate(now.getDate() - now.getDay() - 7));
  const lastWeekEnd = new Date(now.setDate(now.getDate() - now.getDay()));
  lastWeekStart.setHours(0, 0, 0, 0);
  lastWeekEnd.setHours(23, 59, 59, 999);
  return date >= lastWeekStart && date < lastWeekEnd;
}

function renderVisitsCards(visits) {
  if (visits.length === 0) {
    return `
      <div class="visits-empty-state">
        <div class="visits-empty-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </div>
        <h3 class="visits-empty-title">No visits found</h3>
        <p class="visits-empty-description">Visits from your sales team will appear here once they start logging their activities.</p>
      </div>
    `;
  }

  return visits.map(visit => {
    const userName = visit.user ? `${visit.user.first_name} ${visit.user.last_name}` : 'Unknown';
    const initials = getInitials(userName);
    const relativeTime = getRelativeTime(new Date(visit.created_at));
    const dateStr = formatDate(visit.created_at);

    const visitTypeLabels = {
      'new_lead': 'New Lead',
      'follow_up': 'Follow-up',
      'demo': 'Demo',
      'closing': 'Closing',
      'support': 'Support'
    };

    const scoreClass = visit.lead_score >= 70 ? 'score-high' : visit.lead_score >= 40 ? 'score-medium' : 'score-low';

    return `
      <div class="visit-card-premium" data-visit-id="${visit.id}" data-type="${visit.visit_type || 'new_lead'}" onclick="openVisitDetail('${visit.id}')">
        <div class="visit-card-top">
          <div class="visit-card-avatar">${initials}</div>
          <div class="visit-card-main">
            <div class="visit-card-company">${visit.company_name || 'Unknown Company'}</div>
            <div class="visit-card-rep">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              ${userName}
            </div>
          </div>
          <div class="visit-card-time">
            <div class="visit-card-time-relative">${relativeTime}</div>
            <div>${dateStr}</div>
          </div>
        </div>
        
        <div class="visit-card-meta">
          <span class="visit-card-badge type-${visit.visit_type || 'new_lead'}">${visitTypeLabels[visit.visit_type] || 'Visit'}</span>
          ${visit.lead_score ? `<span class="visit-card-badge ${scoreClass}">${visit.lead_score}% Score</span>` : ''}
          ${visit.location_verified ? `<span class="visit-card-badge verified"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> Verified</span>` : ''}
        </div>
        
        ${visit.notes ? `<div class="visit-card-notes">${visit.notes}</div>` : ''}
        
        <div class="visit-card-footer">
          <div class="visit-card-tags">
            ${(visit.tags || []).slice(0, 3).map(tag => `<span class="visit-card-tag">${tag}</span>`).join('')}
            ${(visit.tags || []).length > 3 ? `<span class="visit-card-tag">+${visit.tags.length - 3}</span>` : ''}
          </div>
          <div class="visit-card-actions">
            ${visit.latitude && visit.longitude ? `
              <button class="visit-card-action" onclick="event.stopPropagation(); viewLocationOnMap(${visit.latitude}, ${visit.longitude}, '${visit.company_name}')" title="View on Map">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>
              </button>
            ` : ''}
            <button class="visit-card-action" onclick="event.stopPropagation(); openVisitDetail('${visit.id}')" title="View Details">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderVisitsTimeline(visits) {
  if (visits.length === 0) {
    return `<div class="visits-empty-state"><h3>No visits to display</h3></div>`;
  }

  // Group visits by date
  const grouped = {};
  visits.forEach(visit => {
    const dateKey = new Date(visit.created_at).toDateString();
    if (!grouped[dateKey]) {
      grouped[dateKey] = [];
    }
    grouped[dateKey].push(visit);
  });

  let html = '';
  Object.entries(grouped).forEach(([dateKey, dayVisits]) => {
    const date = new Date(dateKey);
    const dateLabel = isToday(date) ? 'Today' :
      isYesterday(date) ? 'Yesterday' :
        date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

    html += `
      <div class="timeline-group">
        <div class="timeline-group-header">
          <span class="timeline-group-date">${dateLabel}</span>
          <span class="timeline-group-line"></span>
          <span class="timeline-group-count">${dayVisits.length} visit${dayVisits.length !== 1 ? 's' : ''}</span>
        </div>
        ${dayVisits.map(visit => {
      const userName = visit.user ? `${visit.user.first_name} ${visit.user.last_name}` : 'Unknown';
      const time = new Date(visit.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      return `
            <div class="visit-card-premium timeline-visit-card" data-visit-id="${visit.id}" onclick="openVisitDetail('${visit.id}')">
              <div class="visit-card-top">
                <div class="visit-card-main">
                  <div class="visit-card-company">${visit.company_name || 'Unknown'}</div>
                  <div class="visit-card-rep">${userName} at ${time}</div>
                </div>
              </div>
              ${visit.notes ? `<div class="visit-card-notes">${visit.notes}</div>` : ''}
            </div>
          `;
    }).join('')}
      </div>
    `;
  });

  return html;
}

function isYesterday(date) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return date.toDateString() === yesterday.toDateString();
}

function renderActivityTimeline(activities) {
  return activities.map(activity => {
    const userName = activity.user ? `${activity.user.first_name}` : 'Someone';
    const relativeTime = getRelativeTime(new Date(activity.time));
    const iconClass = activity.score && activity.score >= 70 ? 'success' :
      activity.type === 'closing' ? 'success' : '';

    return `
      <div class="activity-timeline-item">
        <div class="activity-timeline-icon ${iconClass}">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </div>
        <div class="activity-timeline-content">
          <div class="activity-timeline-title">
            <strong>${userName}</strong> visited ${activity.company || 'a company'}
          </div>
          <div class="activity-timeline-meta">${relativeTime}</div>
        </div>
      </div>
    `;
  }).join('');
}

function renderLeaderboard(leaderboard) {
  return leaderboard.map((rep, index) => {
    const name = `${rep.first_name} ${rep.last_name}`;
    const initials = getInitials(name);

    return `
      <div class="leaderboard-item">
        <div class="leaderboard-rank">${index + 1}</div>
        <div class="leaderboard-avatar">${initials}</div>
        <div class="leaderboard-info">
          <div class="leaderboard-name">${name}</div>
          <div class="leaderboard-stats">${rep.visitCount} visits</div>
        </div>
        <div class="leaderboard-value">${rep.visitCount}</div>
      </div>
    `;
  }).join('');
}

function getRelativeTime(date) {
  const now = new Date();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function initVisitsHub() {
  // Restore filter values in DOM
  const searchInput = document.getElementById('visits-search');
  if (searchInput) {
    searchInput.value = visitsHubState.filters.search || '';
    searchInput.addEventListener('input', debounce((e) => {
      visitsHubState.filters.search = e.target.value.toLowerCase();
      saveViewState({ teamDashboard: { currentView: visitsHubState.currentView, filters: visitsHubState.filters, sortBy: visitsHubState.sortBy } });
      applyVisitsFilters();
    }, 300));
  }

  // Restore other filter elements
  if (visitsHubState.filters.rep) document.getElementById('filter-rep').value = visitsHubState.filters.rep;
  if (visitsHubState.filters.type) document.getElementById('filter-type').value = visitsHubState.filters.type;
  if (visitsHubState.filters.scoreMin) document.getElementById('filter-score').value = visitsHubState.filters.scoreMin;
  if (visitsHubState.filters.dateFrom) document.getElementById('filter-date-from').value = visitsHubState.filters.dateFrom;
  if (visitsHubState.filters.dateTo) document.getElementById('filter-date-to').value = visitsHubState.filters.dateTo;

  // Update filter count badge
  updateFilterCountBadge();

  // Initialize Sort Select
  const sortSelect = document.getElementById('visits-sort');
  if (sortSelect) {
    sortSelect.value = visitsHubState.sortBy;
    sortSelect.addEventListener('change', (e) => {
      visitsHubState.sortBy = e.target.value;
      saveViewState({ teamDashboard: { currentView: visitsHubState.currentView, filters: visitsHubState.filters, sortBy: visitsHubState.sortBy } });
      applyVisitsFilters();
    });
  }

  // View toggle
  document.querySelectorAll('.visits-view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      switchVisitsView(view);
    });
  });

  // Filters toggle
  const filtersToggle = document.getElementById('toggle-filters');
  const filtersPanel = document.getElementById('filters-panel');
  if (filtersToggle && filtersPanel) {
    filtersToggle.addEventListener('click', () => {
      filtersPanel.classList.toggle('open');
      filtersToggle.classList.toggle('has-filters', filtersPanel.classList.contains('open'));
    });
  }

  // Filter controls
  ['filter-rep', 'filter-type', 'filter-score', 'filter-date-from', 'filter-date-to'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => {
        updateFilterState();
      });
    }
  });

  // Apply filters button
  const applyBtn = document.getElementById('apply-filters');
  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      applyVisitsFilters();
      document.getElementById('filters-panel').classList.remove('open');
    });
  }

  // Clear filters
  const clearBtn = document.getElementById('clear-all-filters');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      clearAllFilters();
    });
  }



  // Activity tabs
  document.querySelectorAll('.activity-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.activity-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const tabName = tab.dataset.tab;
      document.getElementById('activity-tab-content').style.display = tabName === 'activity' ? 'block' : 'none';
      document.getElementById('leaderboard-tab-content').style.display = tabName === 'leaderboard' ? 'block' : 'none';
    });
  });

  // Visit detail panel
  const closeDetailBtn = document.getElementById('close-visit-detail');
  const backdrop = document.getElementById('visit-detail-backdrop');
  if (closeDetailBtn) {
    closeDetailBtn.addEventListener('click', closeVisitDetail);
  }
  if (backdrop) {
    backdrop.addEventListener('click', closeVisitDetail);
  }

  // PDF button in detail panel
  const pdfBtn = document.getElementById('visit-detail-pdf');
  if (pdfBtn) {
    pdfBtn.addEventListener('click', () => {
      if (visitsHubState.selectedVisitId) {
        generateVisitPDF(visitsHubState.selectedVisitId);
      }
    });
  }
}

function switchVisitsView(view, save = true) {
  visitsHubState.currentView = view;

  // Update buttons
  document.querySelectorAll('.visits-view-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  // Update visible container
  document.getElementById('visits-cards-view').style.display = view === 'cards' ? 'block' : 'none';
  document.getElementById('visits-timeline-view').classList.toggle('active', view === 'timeline');
  document.getElementById('visits-map-view').classList.toggle('active', view === 'map');

  // Initialize map if needed
  if (view === 'map') {
    initVisitsMap();
  }

  if (save) {
    saveViewState({ teamDashboard: { currentView: visitsHubState.currentView, filters: visitsHubState.filters, sortBy: visitsHubState.sortBy } });
  }
}

function updateFilterCountBadge() {
  const activeFilters = Object.values(visitsHubState.filters).filter(v => v).length;
  const countEl = document.getElementById('filters-count');
  if (countEl) {
    countEl.textContent = activeFilters;
    countEl.style.display = activeFilters > 0 ? 'inline-flex' : 'none';
  }
}

function updateFilterState() {
  visitsHubState.filters.rep = document.getElementById('filter-rep')?.value || '';
  visitsHubState.filters.type = document.getElementById('filter-type')?.value || '';
  visitsHubState.filters.scoreMin = document.getElementById('filter-score')?.value || '';
  visitsHubState.filters.dateFrom = document.getElementById('filter-date-from')?.value || '';
  visitsHubState.filters.dateTo = document.getElementById('filter-date-to')?.value || '';

  updateFilterCountBadge();

  saveViewState({ teamDashboard: { currentView: visitsHubState.currentView, filters: visitsHubState.filters, sortBy: visitsHubState.sortBy } });
}

function applyVisitsFilters() {
  let filtered = [...visitsHubState.visits];
  const { search, rep, type, scoreMin, dateFrom, dateTo } = visitsHubState.filters;

  // Search filter
  if (search) {
    filtered = filtered.filter(v =>
      (v.company_name || '').toLowerCase().includes(search) ||
      (v.notes || '').toLowerCase().includes(search) ||
      (v.user?.first_name || '').toLowerCase().includes(search) ||
      (v.user?.last_name || '').toLowerCase().includes(search)
    );
  }

  // Rep filter
  if (rep) {
    filtered = filtered.filter(v => v.user_id === rep);
  }

  // Type filter
  if (type) {
    filtered = filtered.filter(v => v.visit_type === type);
  }

  // Score filter
  if (scoreMin) {
    const min = parseInt(scoreMin);
    if (min === 70) {
      filtered = filtered.filter(v => v.lead_score >= 70);
    } else if (min === 40) {
      filtered = filtered.filter(v => v.lead_score >= 40 && v.lead_score < 70);
    } else {
      filtered = filtered.filter(v => !v.lead_score || v.lead_score < 40);
    }
  }

  // Date filter
  if (dateFrom) {
    const fromDate = new Date(dateFrom);
    filtered = filtered.filter(v => new Date(v.created_at) >= fromDate);
  }
  if (dateTo) {
    const toDate = new Date(dateTo);
    toDate.setHours(23, 59, 59, 999);
    filtered = filtered.filter(v => new Date(v.created_at) <= toDate);
  }

  // Sort
  switch (visitsHubState.sortBy) {
    case 'oldest':
      filtered.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      break;
    case 'score-high':
      filtered.sort((a, b) => (b.lead_score || 0) - (a.lead_score || 0));
      break;
    case 'score-low':
      filtered.sort((a, b) => (a.lead_score || 0) - (b.lead_score || 0));
      break;
    case 'company':
      filtered.sort((a, b) => (a.company_name || '').localeCompare(b.company_name || ''));
      break;
    default: // newest
      filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  visitsHubState.filteredVisits = filtered;

  // Update count
  document.getElementById('visits-count').textContent = `${filtered.length} visit${filtered.length !== 1 ? 's' : ''}`;

  // Re-render views
  document.getElementById('visits-cards-view').innerHTML = renderVisitsCards(filtered);
  document.getElementById('visits-timeline-view').innerHTML = renderVisitsTimeline(filtered);
}

function clearAllFilters() {
  visitsHubState.filters = {
    search: '',
    rep: '',
    type: '',
    dateFrom: '',
    dateTo: '',
    scoreMin: ''
  };

  // Reset form elements
  document.getElementById('visits-search').value = '';
  document.getElementById('filter-rep').value = '';
  document.getElementById('filter-type').value = '';
  document.getElementById('filter-score').value = '';
  document.getElementById('filter-date-from').value = '';
  document.getElementById('filter-date-to').value = '';
  document.getElementById('filters-count').style.display = 'none';

  applyVisitsFilters();
}

window.openVisitDetail = function (visitId) {
  const visit = visitsHubState.visits.find(v => v.id === visitId || v.id === parseInt(visitId));
  if (!visit) {
    showToast('Visit not found', 'error');
    return;
  }
  visitsHubState.selectedVisitId = visitId;

  const userName = visit.user ? `${visit.user.first_name} ${visit.user.last_name}` : 'Unknown';
  const dateStr = new Date(visit.created_at).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });

  const visitTypeLabels = {
    'new_lead': 'New Lead',
    'follow_up': 'Follow-up',
    'demo': 'Product Demo',
    'closing': 'Closing',
    'support': 'Customer Support'
  };

  const detailBody = document.getElementById('visit-detail-body');
  if (!detailBody) {
    console.error('Detail body element not found!');
    return;
  }
  detailBody.innerHTML = `
    <div class="visit-detail-section">
      <div class="visit-detail-company">${visit.company_name || 'Unknown Company'}</div>
      <p class="text-muted">${dateStr}</p>
    </div>
    
    <div class="visit-detail-section">
      <h4 class="visit-detail-section-title">Visit Information</h4>
      <div class="visit-detail-meta-grid">
        <div class="visit-detail-meta-item">
          <span class="visit-detail-meta-label">Sales Rep</span>
          <span class="visit-detail-meta-value">${userName}</span>
        </div>
        <div class="visit-detail-meta-item">
          <span class="visit-detail-meta-label">Visit Type</span>
          <span class="visit-detail-meta-value">${visitTypeLabels[visit.visit_type] || 'N/A'}</span>
        </div>
        ${visit.contact_name ? `
          <div class="visit-detail-meta-item">
            <span class="visit-detail-meta-label">Contact Person</span>
            <span class="visit-detail-meta-value">${visit.contact_name}</span>
          </div>
        ` : ''}
        ${visit.lead_score ? `
          <div class="visit-detail-meta-item">
            <span class="visit-detail-meta-label">Lead Score</span>
            <span class="visit-detail-meta-value">${visit.lead_score}%</span>
          </div>
        ` : ''}
        ${visit.travel_time ? `
          <div class="visit-detail-meta-item">
            <span class="visit-detail-meta-label">Travel Time</span>
            <span class="visit-detail-meta-value">${visit.travel_time} minutes</span>
          </div>
        ` : ''}
        <div class="visit-detail-meta-item">
          <span class="visit-detail-meta-label">Location Verified</span>
          <span class="visit-detail-meta-value">${visit.location_verified ? 'Yes ✓' : 'No'}</span>
        </div>
      </div>
    </div>
    
    ${visit.notes ? `
      <div class="visit-detail-section">
        <h4 class="visit-detail-section-title">Notes</h4>
        <div class="visit-detail-notes">${visit.notes}</div>
      </div>
    ` : ''}
    
    ${visit.ai_summary ? `
      <div class="visit-detail-section">
        <h4 class="visit-detail-section-title">AI Summary</h4>
        <div class="ai-insight">
          <div class="ai-insight-content">${parseMarkdown(visit.ai_summary)}</div>
        </div>
      </div>
    ` : ''}
    
    ${visit.tags && visit.tags.length > 0 ? `
      <div class="visit-detail-section">
        <h4 class="visit-detail-section-title">Tags</h4>
        <div class="visit-card-tags" style="gap: 0.5rem;">
          ${visit.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
        </div>
      </div>
    ` : ''}
    
    ${visit.photo_url ? `
      <div class="visit-detail-section">
        <h4 class="visit-detail-section-title">Photo</h4>
        <div class="visit-detail-photo">
          <img src="${visit.photo_url}" alt="Visit photo" onclick="openPhotoModal('${visit.photo_url}')" style="cursor: pointer;">
        </div>
      </div>
    ` : ''}
    
    ${visit.latitude && visit.longitude ? `
      <div class="visit-detail-section">
        <h4 class="visit-detail-section-title">Location</h4>
        <div id="visit-detail-map" style="height: 200px; border-radius: var(--radius-md); overflow: hidden;"></div>
        <p class="text-muted text-center mt-2" style="font-size: 0.75rem;">${visit.latitude.toFixed(6)}, ${visit.longitude.toFixed(6)}</p>
      </div>
    ` : ''}
  `;

  // Show panel
  const panel = document.getElementById('visit-detail-panel');
  const backdrop = document.getElementById('visit-detail-backdrop');

  if (!panel || !backdrop) {
    console.error('Detail panel elements not found!');
    console.log('Panel:', panel);
    console.log('Backdrop:', backdrop);
    return;
  }

  panel.classList.add('open');
  backdrop.classList.add('open');
  console.log('Panel opened successfully');

  // Initialize mini map if coordinates exist
  if (visit.latitude && visit.longitude) {
    setTimeout(() => {
      const mapEl = document.getElementById('visit-detail-map');
      if (mapEl && typeof L !== 'undefined') {
        const miniMap = L.map(mapEl).setView([visit.latitude, visit.longitude], 15);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap'
        }).addTo(miniMap);
        L.marker([visit.latitude, visit.longitude]).addTo(miniMap);
      }
    }, 300);
  }
};

function closeVisitDetail() {
  document.getElementById('visit-detail-panel').classList.remove('open');
  document.getElementById('visit-detail-backdrop').classList.remove('open');
  visitsHubState.selectedVisitId = null;
}

// Ensure a visit exists in the visitsHubState; fetch from server when missing, then open detail.
async function fetchAndOpenVisit(visitId) {
  // normalize
  const vid = String(visitId);
  let visit = (visitsHubState.visits || []).find(v => String(v.id) === vid);
  if (!visit) {
    try {
      const { data, error } = await supabaseClient.from('visits').select('*, user:profiles(first_name,last_name)').eq('id', visitId).single();
      if (error || !data) {
        showToast('Visit not found', 'error');
        return;
      }
      // add to local cache so openVisitDetail can find it
      visitsHubState.visits = visitsHubState.visits || [];
      visitsHubState.visits.push(data);
      visit = data;
    } catch (e) {
      showToast('Error loading visit', 'error');
      return;
    }
  }
  // If the Visits side-panel exists, use it. Otherwise create the same side-panel UI so behavior is consistent.
  const detailBody = document.getElementById('visit-detail-body');
  if (!detailBody) {
    // create backdrop if missing
    let backdrop = document.getElementById('visit-detail-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'visit-detail-backdrop';
      backdrop.className = 'visit-detail-backdrop';
      backdrop.onclick = closeVisitDetail;
      document.body.appendChild(backdrop);
    }

    // create panel if missing
    let panel = document.getElementById('visit-detail-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'visit-detail-panel';
      panel.className = 'visit-detail-panel';
      panel.innerHTML = `
        <div class="visit-detail-header">
          <button class="visit-detail-close" id="close-visit-detail" onclick="closeVisitDetail()">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
        <div class="visit-detail-body" id="visit-detail-body"></div>
      `;
      document.body.appendChild(panel);
    }
  }

  // Now open the side-panel view
  if (window.openVisitDetail) {
    openVisitDetail(visitId);
  }
}

function openPhotoModal(photoUrl) {
  // Create modal if it doesn't exist
  let modal = document.getElementById('photo-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'photo-modal';
    modal.className = 'photo-modal';
    modal.innerHTML = `
      <div class="photo-modal-backdrop" onclick="closePhotoModal()"></div>
      <div class="photo-modal-content">
        <button class="photo-modal-close" onclick="closePhotoModal()">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
        <img class="photo-modal-image" src="" alt="Visit photo">
      </div>
    `;
    document.body.appendChild(modal);
  }

  modal.querySelector('.photo-modal-image').src = photoUrl;
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closePhotoModal() {
  const modal = document.getElementById('photo-modal');
  if (modal) {
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }
}

function initVisitsMap() {
  const mapEl = document.getElementById('visits-map');
  if (!mapEl || typeof L === 'undefined') return;

  // Skip if already initialized
  if (mapEl.dataset.initialized) return;
  mapEl.dataset.initialized = 'true';

  const visitsWithCoords = visitsHubState.filteredVisits.filter(v => v.latitude && v.longitude);

  if (visitsWithCoords.length === 0) {
    mapEl.innerHTML = '<div class="visits-empty-state"><h3>No visits with location data</h3></div>';
    return;
  }

  const map = L.map(mapEl).setView([visitsWithCoords[0].latitude, visitsWithCoords[0].longitude], 10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
  }).addTo(map);

  const typeColors = {
    'new_lead': '#3b82f6',
    'follow_up': '#8b5cf6',
    'demo': '#f59e0b',
    'closing': '#10b981',
    'support': '#6b7280'
  };

  visitsWithCoords.forEach(visit => {
    const color = typeColors[visit.visit_type] || '#3b82f6';
    const marker = L.circleMarker([visit.latitude, visit.longitude], {
      radius: 8,
      fillColor: color,
      color: '#fff',
      weight: 2,
      opacity: 1,
      fillOpacity: 0.8
    }).addTo(map);

    const userName = visit.user ? `${visit.user.first_name} ${visit.user.last_name}` : 'Unknown';
    marker.bindPopup(`
      <strong>${visit.company_name || 'Unknown'}</strong><br>
      ${userName}<br>
      <small>${formatDate(visit.created_at)}</small>
    `);
  });

  // Fit bounds
  const bounds = L.latLngBounds(visitsWithCoords.map(v => [v.latitude, v.longitude]));
  map.fitBounds(bounds, { padding: [50, 50] });
}

window.exportVisitsToCSV = function () {
  const visits = visitsHubState.filteredVisits;
  if (visits.length === 0) {
    showToast('No visits to export', 'warning');
    return;
  }

  const headers = ['Date', 'Company', 'Sales Rep', 'Visit Type', 'Contact', 'Lead Score', 'Notes', 'Location Verified'];
  const pref = (typeof getUserDateFormat === 'function') ? getUserDateFormat() : (localStorage.getItem('safitrack_date_format') || 'DD/MM/YYYY');
  const rows = visits.map(v => [
    pref === 'MM/DD/YYYY' ? (new Date(v.created_at) instanceof Date ? `${String(new Date(v.created_at).getMonth() + 1).padStart(2, '0')}/${String(new Date(v.created_at).getDate()).padStart(2, '0')}/${new Date(v.created_at).getFullYear()}` : '') : formatDateDDMMYYYY(v.created_at),
    v.company_name || '',
    v.user ? `${v.user.first_name} ${v.user.last_name}` : '',
    v.visit_type || '',
    v.contact_name || '',
    v.lead_score || '',
    (v.notes || '').replace(/"/g, '""'),
    v.location_verified ? 'Yes' : 'No'
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `visits-export-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);

  showToast('Export complete', 'success');
};

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Generate PDF for a sales visit
async function generateVisitPDF(visitId) {
  const vid = String(visitId);
  const visit = (visitsHubState.visits || []).find(v => String(v.id) === vid);
  if (!visit) {
    showToast('Visit not found', 'error');
    return;
  }

  showToast('Generating PDF report...', 'info');

  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    let yPos = 20;

    // Color scheme
    const colors = {
      primary: [47, 95, 208],
      dark: [31, 41, 55],
      light: [243, 244, 246],
      white: [255, 255, 255],
      success: [16, 185, 129]
    };

    // Helper: Add gradient header
    const addGradientHeader = () => {
      doc.setFillColor(...colors.primary);
      doc.rect(0, 0, pageWidth, 50, 'F');
    };

    // Helper: Add footer
    const addFooter = (pageNum) => {
      doc.setFillColor(...colors.light);
      doc.rect(0, pageHeight - 15, pageWidth, 15, 'F');
      doc.setFontSize(8);
      doc.setTextColor(100, 100, 100);
      doc.text(`SafiTrack Sales Report - Generated ${new Date().toLocaleDateString()}`, 20, pageHeight - 7);
      doc.text(`Page ${pageNum}`, pageWidth - 30, pageHeight - 7);
    };

    // Helper: Section header
    const addSectionHeader = (title) => {
      if (yPos > pageHeight - 40) {
        doc.addPage();
        addGradientHeader();
        yPos = 60;
      }
      doc.setFillColor(...colors.primary);
      doc.roundedRect(20, yPos - 5, pageWidth - 40, 12, 2, 2, 'F');
      doc.setFontSize(12);
      doc.setTextColor(...colors.white);
      doc.setFont(undefined, 'bold');
      doc.text(title, 25, yPos + 3);
      yPos += 18;
      doc.setTextColor(...colors.dark);
      doc.setFont(undefined, 'normal');
    };

    // Helper: Info row
    const addInfoRow = (label, value) => {
      if (yPos > pageHeight - 25) {
        doc.addPage();
        addGradientHeader();
        addFooter(doc.internal.getNumberOfPages());
        yPos = 60;
      }
      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      doc.text('>', 22, yPos);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(...colors.dark);
      doc.text(label + ':', 27, yPos);
      doc.setFont(undefined, 'normal');
      const labelWidth = doc.getTextWidth(label + ':   ');
      const maxWidth = pageWidth - 60;
      const lines = doc.splitTextToSize(String(value || 'N/A'), maxWidth);
      lines.forEach((line, index) => {
        if (index === 0) {
          doc.text(line, 27 + labelWidth, yPos);
        } else {
          yPos += 6;
          doc.text(line, 27 + labelWidth, yPos);
        }
      });
      yPos += 8;
    };

    // ===== PAGE 1 =====
    addGradientHeader();

    // Title
    doc.setFontSize(24);
    doc.setTextColor(...colors.white);
    doc.setFont(undefined, 'bold');
    doc.text('SafiTrack Sales Report', 20, 30);
    doc.setFontSize(11);
    doc.setFont(undefined, 'normal');
    doc.text('Sales Visit Information', 20, 40);

    // Lead score badge
    if (visit.lead_score) {
      const scoreColor = visit.lead_score >= 70 ? colors.success : visit.lead_score >= 40 ? [245, 158, 11] : [107, 114, 128];
      doc.setFillColor(...scoreColor);
      doc.roundedRect(pageWidth - 55, 15, 35, 10, 2, 2, 'F');
      doc.setFontSize(8);
      doc.setTextColor(...colors.white);
      doc.setFont(undefined, 'bold');
      doc.text(`${visit.lead_score}% SCORE`, pageWidth - 52, 21);
      doc.setFont(undefined, 'normal');
    }

    yPos = 60;

    // Metadata box
    doc.setFillColor(250, 251, 252);
    doc.roundedRect(20, yPos, pageWidth - 40, 20, 3, 3, 'F');
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text('VISIT ID:', 25, yPos + 7);
    doc.setTextColor(...colors.dark);
    doc.setFont(undefined, 'bold');
    doc.text(String(visit.id).substring(0, 16), 50, yPos + 7);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text('DATE:', 25, yPos + 14);
    doc.setTextColor(...colors.dark);
    const pdfDatePref = (typeof getUserDateFormat === 'function') ? getUserDateFormat() : (localStorage.getItem('safitrack_date_format') || 'DD/MM/YYYY');
    const created = new Date(visit.created_at);
    const createdDateStr = pdfDatePref === 'MM/DD/YYYY' ? `${String(created.getMonth() + 1).padStart(2, '0')}/${String(created.getDate()).padStart(2, '0')}/${created.getFullYear()}` : `${String(created.getDate()).padStart(2, '0')}/${String(created.getMonth() + 1).padStart(2, '0')}/${created.getFullYear()}`;
    doc.text(`${createdDateStr} ${created.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, 50, yPos + 14);
    yPos += 30;

    // Company Section
    addSectionHeader('COMPANY INFORMATION');
    addInfoRow('Company Name', visit.company_name || 'Unknown');
    if (visit.contact_name) addInfoRow('Contact Person', visit.contact_name);
    if (visit.latitude && visit.longitude) {
      // Add coordinates and a 'View in Google Maps' button
      const lat = visit.latitude.toFixed(6);
      const lng = visit.longitude.toFixed(6);
      const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      doc.text('>', 22, yPos);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(...colors.dark);
      doc.text('Coordinates:', 27, yPos);
      doc.setFont(undefined, 'normal');
      const labelWidth = doc.getTextWidth('Coordinates:   ');
      doc.text(`${lat}, ${lng}`, 27 + labelWidth, yPos);
      // Draw 'View in Google Maps' button
      // Improved button placement and design
      const coordsText = `${lat}, ${lng}`;
      const coordsX = 27 + labelWidth;
      doc.text(coordsText, coordsX, yPos);
      yPos += 8;
      // Draw 'View in Google Maps' button below coordinates, aligned left
      const btnLabel = 'View in Google Maps';
      const btnWidth = doc.getTextWidth(btnLabel) + 12;
      const btnHeight = 6; // smaller height
      const btnX = 27; // push left, align with label
      const btnY = yPos - 4;
      doc.setFillColor(47, 95, 208);
      doc.roundedRect(btnX, btnY, btnWidth, btnHeight, 2, 2, 'F');
      doc.setFontSize(8);
      doc.setTextColor(255, 255, 255);
      const textX = btnX + btnWidth / 2 - doc.getTextWidth(btnLabel) / 2;
      const textY = btnY + btnHeight / 2 + 1;
      doc.textWithLink(btnLabel, textX, textY, { url: mapsUrl });
      yPos += btnHeight + 4;
      doc.setTextColor(...colors.dark);
      addInfoRow('Location Verified', visit.location_verified ? 'Yes ✓' : 'No');
    }
    yPos += 5;

    // Visit Details
    addSectionHeader('VISIT DETAILS');
    const visitTypeLabels = {
      'new_lead': 'New Lead',
      'follow_up': 'Follow-up',
      'demo': 'Product Demo',
      'closing': 'Closing',
      'support': 'Customer Support'
    };
    addInfoRow('Visit Type', visitTypeLabels[visit.visit_type] || visit.visit_type || 'N/A');
    if (visit.travel_time) addInfoRow('Travel Time', `${visit.travel_time} minutes`);
    if (visit.lead_score) addInfoRow('Lead Score', `${visit.lead_score}%`);
    yPos += 5;

    // Sales Rep Info
    addSectionHeader('SALES REPRESENTATIVE');
    if (visit.user) {
      addInfoRow('Name', `${visit.user.first_name} ${visit.user.last_name}`);
      addInfoRow('Email', visit.user.email);
    }

    addFooter(1);

    // ===== PAGE 2: Notes =====
    if (visit.notes || visit.ai_summary || (visit.tags && visit.tags.length > 0)) {
      doc.addPage();
      addGradientHeader();
      yPos = 60;

      if (visit.notes) {
        addSectionHeader('VISIT NOTES');
        doc.setFontSize(10);
        doc.setTextColor(...colors.dark);
        const noteLines = doc.splitTextToSize(visit.notes, pageWidth - 50);
        noteLines.forEach(line => {
          if (yPos > pageHeight - 25) {
            doc.addPage();
            addGradientHeader();
            yPos = 60;
          }
          doc.text(line, 25, yPos);
          yPos += 6;
        });
        yPos += 10;
      }

      if (visit.ai_summary) {
        addSectionHeader('AI SUMMARY');
        doc.setFontSize(10);
        doc.setTextColor(...colors.dark);
        const summaryLines = doc.splitTextToSize(visit.ai_summary, pageWidth - 50);
        summaryLines.forEach(line => {
          if (yPos > pageHeight - 25) {
            doc.addPage();
            addGradientHeader();
            yPos = 60;
          }
          doc.text(line, 25, yPos);
          yPos += 6;
        });
        yPos += 10;
      }

      if (visit.tags && visit.tags.length > 0) {
        addSectionHeader('TAGS');
        doc.setFontSize(10);
        doc.text(visit.tags.join(', '), 25, yPos);
        yPos += 10;
      }

      addFooter(2);
    }

    // Save
    const fileName = `SafiTrack_Sales_Visit_${(visit.company_name || 'Unknown').replace(/\s+/g, '_')}_${new Date(visit.created_at).toISOString().split('T')[0]}.pdf`;
    doc.save(fileName);
    showToast('PDF generated successfully!', 'success');

  } catch (error) {
    console.error('Error generating PDF:', error);
    showToast('Failed to generate PDF: ' + error.message, 'error');
  }
}

// ======================
// USER MANAGEMENT VIEW
// ======================

async function renderUserManagementView() {
  let usersQ = supabaseClient.from('profiles').select('*').order('created_at', { ascending: false });
  if (currentOrganization?.id) usersQ = usersQ.eq('organization_id', currentOrganization.id);
  const { data: users, error } = await usersQ;

  if (error) {
    viewContainer.innerHTML = renderError(error.message);
    return;
  }

  let html = `

  `;

  const canManageUsers = isManager;

  users.forEach(user => {
    const initials = getInitials(`${user.first_name} ${user.last_name}`);
    const isCurrentUser = user.id === currentUser.id;
    const canDeleteUser = user.role !== 'manager';
    const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email || 'Teammate';

    html += `
      <div class="card user-card">
        <div class="user-avatar" style="width: 48px; height: 48px; font-size: 1rem;">${initials}</div>
        <div class="user-card-info">
          <div class="user-card-name">${fullName}</div>
          <div class="user-card-email">${user.email}</div>
        </div>
        <div class="user-card-actions">
          <span class="tag ${user.role === 'manager' ? '' : 'text-muted'}" style="background: ${user.role === 'manager' ? 'var(--color-primary-bg)' : 'var(--bg-tertiary)'};">
            ${user.role === 'manager' ? 'Manager' : user.role === 'technician' ? 'Technician' : user.role === 'sales_rep' ? 'Sales Rep' : (user.role || '')}
          </span>
           ${isCurrentUser ? `` : ''}
          ${canManageUsers && !isCurrentUser && canDeleteUser ? `
            <button class="btn btn-ghost btn-sm" onclick="deleteUser('${user.id}', '${user.first_name} ${user.last_name}', '${user.role || ''}')">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-icon lucide-trash"><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          ` : ''}
        </div>
      </div>
    `;
  });

  viewContainer.innerHTML = html;

  if (window.lucide) lucide.createIcons();
}

window.deleteUser = async function (userId, userName, userRole = '') {
  if (!isManager) {
    showToast('Only managers can delete users', 'error');
    return;
  }

  if (userRole === 'manager') {
    showToast('Managers cannot delete other managers', 'error');
    return;
  }

  const { data: targetUser, error: targetUserError } = await supabaseClient
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();

  if (targetUserError) {
    showToast('Failed to validate user role: ' + targetUserError.message, 'error');
    return;
  }

  if (targetUser?.role === 'manager') {
    showToast('Managers cannot delete other managers', 'error');
    return;
  }

  const confirmed = await showConfirmDialog(
    'Delete User',
    `Are you sure you want to delete ${userName}?`
  );

  if (!confirmed) return;

  const { error } = await supabaseClient.from('profiles').delete().eq('id', userId);

  if (error) {
    showToast('Failed to delete user: ' + error.message, 'error');
    return;
  }

  showToast('User deleted successfully', 'success');
  renderUserManagementView();
};

// ======================
// ROUTE PLANNING VIEW
// ======================

// Group routes that have the same locations (same stops) together
function groupRoutesByLocations(routes, routeLocations) {
  // Create a map of route_id to its location signature (sorted company IDs)
  const routeSignatures = {};

  routes.forEach(route => {
    const locations = routeLocations
      .filter(loc => loc.route_id === route.id)
      .sort((a, b) => a.position - b.position)
      .map(loc => loc.company_id);

    // Create a signature from the company IDs in order
    routeSignatures[route.id] = locations.join(',');
  });

  // Group routes by name AND location signature
  const groups = {};

  routes.forEach(route => {
    const signature = routeSignatures[route.id];
    // Use route name + location signature as key to group identical routes
    const groupKey = `${route.name}|${signature}`;

    if (!groups[groupKey]) {
      groups[groupKey] = {
        name: route.name,
        routeIds: [],
        assignees: [],
        created_at: route.created_at,
        estimated_duration: route.estimated_duration,
        total_distance: route.total_distance,
        stopsCount: signature ? signature.split(',').filter(Boolean).length : 0
      };
    }

    groups[groupKey].routeIds.push(route.id);

    if (route.assigned_to) {
      // Avoid duplicates
      const existing = groups[groupKey].assignees.find(a => a.id === route.assigned_to.id);
      if (!existing) {
        groups[groupKey].assignees.push(route.assigned_to);
      }
    }
  });

  // Convert to array and sort by created date
  return Object.values(groups).sort((a, b) =>
    new Date(b.created_at) - new Date(a.created_at)
  );
}

async function renderRoutePlanningView() {
  // Fetch companies, sales reps, and existing routes
  const orgId = currentOrganization?.id;
  let companiesQ = supabaseClient.from('companies').select('*').order('name', { ascending: true });
  let profilesQ = supabaseClient.from('profiles').select('*').eq('role', 'sales_rep').order('first_name', { ascending: true });
  if (orgId) {
    companiesQ = companiesQ.eq('organization_id', orgId);
    profilesQ = profilesQ.eq('organization_id', orgId);
  }
  const [companiesResult, profilesResult, routesResult, routeLocationsResult] = await Promise.all([
    companiesQ,
    profilesQ,
    supabaseClient
      .from('routes')
      .select(`*, assigned_to:profiles!routes_assigned_to_fkey(id, first_name, last_name)`)
      .eq('created_by', currentUser.id)
      .order('created_at', { ascending: false }),
    supabaseClient
      .from('route_locations')
      .select('route_id, company_id, position')
      .order('position', { ascending: true })
  ]);

  const { data: companies, error: companiesError } = companiesResult;
  const { data: salesReps, error: profilesError } = profilesResult;
  const { data: routes, error: routesError } = routesResult;
  const { data: routeLocations, error: routeLocationsError } = routeLocationsResult;

  if (companiesError || profilesError || routesError || routeLocationsError) {
    viewContainer.innerHTML = renderError('Error loading data');
    return;
  }

  // Group routes by their locations (same stops = same route)
  const groupedRoutes = groupRoutesByLocations(routes, routeLocations);

  // Filter companies with valid coordinates
  const validCompanies = companies.filter(c => c.latitude && c.longitude);

  let html = `
    <div class="page-header" style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem;">
      <button class="btn btn-primary ai-safi-plan-btn" id="open-ai-safi-plan">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v8"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m8 6 4-4 4 4"/><path d="M16 18a4 4 0 0 0-8 0"/></svg>
        A.I SAFI PLAN
      </button>
    </div>

    <div class="route-planning-container">
      <!-- Left Panel: Company Selection -->
      <div class="company-selection-panel">
        <div class="panel-header">
          <div class="panel-title">Available Companies</div>
          <div class="panel-subtitle">${validCompanies.length} locations</div>
        </div>
        
        <div class="panel-search">
          <input type="text" id="company-search-input" placeholder="Search companies...">
        </div>
        
        <div class="panel-body" id="companies-list">
          ${validCompanies.length === 0 ? `
            <div class="panel-empty">
              <div class="panel-empty-icon">📍</div>
              <div class="panel-empty-text">No companies with coordinates</div>
            </div>
          ` : validCompanies.map(company => `
            <div class="company-quick-card" data-company-id="${company.id}" data-lat="${company.latitude}" data-lng="${company.longitude}">
              <div class="company-card-name">
                ${company.name}
              </div>
              <div class="company-card-address">${company.address || 'No address'}</div>
              <div class="company-card-footer">
                <div class="company-card-distance"></div>
                <button class="company-card-add-btn">+ Add</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Center Panel: Route Builder -->
      <div class="route-builder-panel">
        <div class="route-stats-card">
          <div class="route-stats-grid">
            <div class="route-stat-item">
              <span class="route-stat-value" id="route-stops-count">0</span>
              <span class="route-stat-label">Stops</span>
            </div>
            <div class="route-stat-item">
              <span class="route-stat-value" id="route-distance">0 km</span>
              <span class="route-stat-label">Distance</span>
            </div>
            <div class="route-stat-item">
              <span class="route-stat-value" id="route-duration">0 min</span>
              <span class="route-stat-label">Est. Time</span>
            </div>
          </div>
          
          <div class="route-assignment">
            <input type="text" id="route-name-input" placeholder="Route name (e.g., Downtown Route)">
            <select id="route-rep-select">
              <option value="">Assign to...</option>
              ${salesReps.map(rep => `
                <option value="${rep.id}">${rep.first_name} ${rep.last_name}</option>
              `).join('')}
            </select>
          </div>
        </div>
        
        <div class="route-stops-container" id="route-stops-container">
          <div class="route-stops-empty">
            <div class="route-stops-empty-icon">🗺️</div>
            <div class="route-stops-empty-text">No stops added yet</div>
            <div class="route-stops-empty-hint">Click "+ Add" on companies to build your route</div>
          </div>
        </div>
        
        <div class="route-actions">
          <button class="btn btn-secondary" id="optimize-route-btn" style="display: none;">
            Optimize
          </button>
          <button class="btn btn-primary" id="save-route-btn" style="display: none;">
            Save Route
          </button>
        </div>
      </div>

      <!-- Right Panel: Map Preview -->
      <div class="map-preview-panel">
        <div class="panel-header">
          <div class="panel-title">Route Preview</div>
          <div class="panel-subtitle">Live map view</div>
        </div>
        
        <div class="route-map-container">
          <div id="route-planning-map" style="display: none;"></div>
          <div class="map-empty-state" id="map-empty-state">
            <div class="map-empty-icon">🗺️</div>
            <div>Add stops to see route on map</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Existing Routes Section -->
    <div class="card mt-3">
      <div class="card-header">
        <h3 class="card-title">Existing Routes</h3>
      </div>
      <div class="routes-list">
        ${groupedRoutes.length === 0 ?
      '<p class="text-muted text-center u-p-xl">No routes created yet</p>' :
      groupedRoutes.map(group => `
            <div class="route-item" data-id="${group.routeIds[0]}" data-route-ids="${group.routeIds.join(',')}">
              <div class="route-info">
                <h4>${group.name}</h4>
                <div class="route-assignees">
                  <span class="route-assignees-label">Assigned to:</span>
                  <div class="route-assignees-list">
                    ${group.assignees.length === 0 ? '<span class="text-muted">Unassigned</span>' :
          group.assignees.map(assignee => `
                        <span class="route-assignee-tag">
                          <span class="assignee-avatar">${assignee.first_name.charAt(0)}${assignee.last_name.charAt(0)}</span>
                          ${assignee.first_name} ${assignee.last_name}
                        </span>
                      `).join('')}
                  </div>
                </div>
                <p class="route-meta-info">
                  <span>Created: ${formatDate(group.created_at)}</span>
                  ${group.estimated_duration ? `<span>• Est. duration: ${group.estimated_duration} min</span>` : ''}
                  ${group.stopsCount ? `<span>• ${group.stopsCount} stops</span>` : ''}
                </p>
              </div>
              <div class="route-actions">
                <button class="btn btn-sm btn-ghost view-route-btn" data-id="${group.routeIds[0]}">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-eye-icon lucide-eye"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>
                </button>
                <button class="btn btn-sm btn-ghost edit-route-btn" data-id="${group.routeIds[0]}">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-square-pen-icon lucide-square-pen"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/></svg>
                </button>
                <button class="btn btn-sm btn-ghost delete-route-btn" data-id="${group.routeIds.join(',')}" data-route-name="${group.name}">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-icon lucide-trash"><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
              </div>
            </div>
          `).join('')
    }
      </div>
    </div>
  `;

  viewContainer.innerHTML = html;

  // Initialize route planning functionality
  initRoutePlanning(validCompanies, salesReps);

  // Initialize route list functionality
  initRouteList();

  // Initialize AI SAFI PLAN
  initAISafiPlan(companies, salesReps);
}

function initRoutePlanning(companies, salesReps) {
  let routeStops = [];
  let map = null;
  let markers = [];
  let routeLine = null;
  let sortable = null;

  const searchInput = document.getElementById('company-search-input');
  const companiesList = document.getElementById('companies-list');
  const stopsContainer = document.getElementById('route-stops-container');
  const optimizeBtn = document.getElementById('optimize-route-btn');
  const saveBtn = document.getElementById('save-route-btn');
  const routeNameInput = document.getElementById('route-name-input');
  const routeRepSelect = document.getElementById('route-rep-select');
  const mapContainer = document.getElementById('route-planning-map');
  const mapEmptyState = document.getElementById('map-empty-state');

  // Restore active route builder state
  const savedState = _loadPersistedState().routePlan || {};
  if (savedState.stops && savedState.stops.length > 0) {
    routeStops = savedState.stops;
  }
  if (savedState.name && routeNameInput) routeNameInput.value = savedState.name;
  if (savedState.rep && routeRepSelect) routeRepSelect.value = savedState.rep;

  function saveRouteBuilderState() {
    const currentSearch = _loadPersistedState().routePlan?.search || '';
    saveViewState({
      routePlan: {
        search: currentSearch,
        stops: routeStops,
        name: routeNameInput ? routeNameInput.value : '',
        rep: routeRepSelect ? routeRepSelect.value : ''
      }
    });
  }

  if (routeNameInput) routeNameInput.addEventListener('input', saveRouteBuilderState);
  if (routeRepSelect) routeRepSelect.addEventListener('change', saveRouteBuilderState);

  // Restore visual added state on company cards 
  if (routeStops.length > 0) {
    setTimeout(() => {
      routeStops.forEach(stop => {
        const card = companiesList.querySelector(`[data-company-id="${stop.id}"]`);
        if (card) {
          card.classList.add('added');
          const addBtn = card.querySelector('.company-card-add-btn');
          if (addBtn) addBtn.textContent = '✓ Added';
        }
      });
      updateRouteDisplay();
    }, 50);
  }

  // Search functionality
  if (searchInput) {
    const savedSearch = _loadPersistedState().routePlan?.search || '';
    if (savedSearch) {
      searchInput.value = savedSearch;
      setTimeout(() => searchInput.dispatchEvent(new Event('input')), 50);
    }

    searchInput.addEventListener('input', (e) => {
      const searchTerm = e.target.value.toLowerCase();
      saveViewState({ routePlan: { search: e.target.value } });
      const companyCards = companiesList.querySelectorAll('.company-quick-card');

      companyCards.forEach(card => {
        const name = card.querySelector('.company-card-name').textContent.toLowerCase();
        const address = card.querySelector('.company-card-address').textContent.toLowerCase();

        if (name.includes(searchTerm) || address.includes(searchTerm)) {
          card.style.display = '';
        } else {
          card.style.display = 'none';
        }
      });
    });
  }

  // Add company to route
  companiesList.addEventListener('click', (e) => {
    const addBtn = e.target.closest('.company-card-add-btn');
    if (!addBtn) return;

    const card = addBtn.closest('.company-quick-card');
    const companyId = card.dataset.companyId;

    // Check if already added
    if (routeStops.find(stop => stop.id === companyId)) {
      showToast('Company already added to route', 'warning');
      return;
    }

    const company = companies.find(c => c.id === companyId);
    if (!company) return;

    // Add to route
    routeStops.push({
      id: company.id,
      name: company.name,
      address: company.address,
      latitude: parseFloat(company.latitude),
      longitude: parseFloat(company.longitude)
    });

    // Mark as added
    card.classList.add('added');
    addBtn.textContent = '✓ Added';

    updateRouteDisplay();
  });

  function updateRouteDisplay() {
    // Update stats
    document.getElementById('route-stops-count').textContent = routeStops.length;

    if (routeStops.length === 0) {
      stopsContainer.innerHTML = `
        <div class="route-stops-empty">
          <div class="route-stops-empty-icon">🗺️</div>
          <div class="route-stops-empty-text">No stops added yet</div>
          <div class="route-stops-empty-hint">Click "+ Add" on companies to build your route</div>
        </div>
      `;
      optimizeBtn.style.display = 'none';
      saveBtn.style.display = 'none';

      // Hide map
      if (map) {
        mapContainer.style.display = 'none';
        mapEmptyState.style.display = 'flex';
      }

      return;
    }

    // Show action buttons
    if (routeStops.length >= 2) {
      optimizeBtn.style.display = 'block';
    }
    saveBtn.style.display = 'block';

    // Render stops
    stopsContainer.innerHTML = routeStops.map((stop, index) => `
      <div class="route-stop-item" data-stop-id="${stop.id}">
        <div class="route-stop-number">${index + 1}</div>
        <div class="route-stop-info">
          <div class="route-stop-name">${stop.name}</div>
          <div class="route-stop-address">${stop.address || 'No address'}</div>
        </div>
        <button class="route-stop-remove" data-stop-id="${stop.id}">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
          </svg>
        </button>
      </div>
    `).join('');

    // Initialize sortable
    if (sortable) {
      sortable.destroy();
    }

    sortable = new Sortable(stopsContainer, {
      animation: 120,
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      delayOnTouchOnly: true,
      touchStartThreshold: 4,
      handle: '.route-stop-item',
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      onStart: function () {
        document.body.classList.add('is-dragging');
      },
      onEnd: function () {
        document.body.classList.remove('is-dragging');
        // Update routeStops array based on new order
        const newOrder = [];
        stopsContainer.querySelectorAll('.route-stop-item').forEach(item => {
          const stopId = item.dataset.stopId;
          const stop = routeStops.find(s => s.id === stopId);
          if (stop) newOrder.push(stop);
        });
        routeStops = newOrder;
        updateRouteDisplay();
      }
    });

    // Add remove button listeners
    stopsContainer.querySelectorAll('.route-stop-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const stopId = btn.dataset.stopId;
        removeStop(stopId);
      });
    });

    // Calculate and update distance/time
    updateRouteMetrics();

    // Update map
    updateMap();
    saveRouteBuilderState();
  }

  function removeStop(stopId) {
    routeStops = routeStops.filter(stop => stop.id !== stopId);

    // Unmark company card
    const card = companiesList.querySelector(`[data-company-id="${stopId}"]`);
    if (card) {
      card.classList.remove('added');
      const btn = card.querySelector('.company-card-add-btn');
      if (btn) btn.textContent = '+ Add';
    }

    updateRouteDisplay();
  }

  function updateRouteMetrics() {
    if (routeStops.length < 2) {
      document.getElementById('route-distance').textContent = '0 km';
      document.getElementById('route-duration').textContent = '0 min';
      return;
    }

    let totalDistance = 0;
    for (let i = 0; i < routeStops.length - 1; i++) {
      const dist = calculateDistance(
        routeStops[i].latitude,
        routeStops[i].longitude,
        routeStops[i + 1].latitude,
        routeStops[i + 1].longitude
      );
      totalDistance += dist;
    }

    const avgSpeed = 40; // km/h average speed
    const estimatedTime = Math.round((totalDistance / avgSpeed) * 60);

    document.getElementById('route-distance').textContent = totalDistance.toFixed(1) + ' km';
    document.getElementById('route-duration').textContent = estimatedTime + ' min';
  }

  function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function updateMap() {
    if (routeStops.length === 0) return;

    // Initialize map if needed
    if (!map) {
      mapEmptyState.style.display = 'none';
      mapContainer.style.display = 'block';

      map = L.map('route-planning-map').setView([routeStops[0].latitude, routeStops[0].longitude], 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(map);
    }

    // Clear existing markers and lines
    markers.forEach(marker => map.removeLayer(marker));
    markers = [];
    if (routeLine) {
      map.removeLayer(routeLine);
    }

    // Add markers for each stop
    const bounds = [];
    routeStops.forEach((stop, index) => {
      const marker = L.marker([stop.latitude, stop.longitude], {
        icon: L.divIcon({
          className: 'custom-marker',
          html: `<div style="background: #2f5fd0; color: white; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">${index + 1}</div>`,
          iconSize: [32, 32]
        })
      }).addTo(map);

      marker.bindPopup(`<strong>${stop.name}</strong><br>${stop.address || ''}`);
      markers.push(marker);
      bounds.push([stop.latitude, stop.longitude]);
    });

    // Draw route line
    if (routeStops.length >= 2) {
      const latlngs = routeStops.map(stop => [stop.latitude, stop.longitude]);
      routeLine = L.polyline(latlngs, {
        color: '#2f5fd0',
        weight: 3,
        opacity: 0.7
      }).addTo(map);
    }

    // Fit map to bounds
    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }

  // Optimize route (nearest neighbor algorithm)
  optimizeBtn.addEventListener('click', () => {
    if (routeStops.length < 2) return;

    const optimized = [routeStops[0]]; // Start with first stop
    let remaining = routeStops.slice(1);

    while (remaining.length > 0) {
      const current = optimized[optimized.length - 1];
      let nearestIndex = 0;
      let nearestDistance = Infinity;

      remaining.forEach((stop, index) => {
        const dist = calculateDistance(
          current.latitude,
          current.longitude,
          stop.latitude,
          stop.longitude
        );
        if (dist < nearestDistance) {
          nearestDistance = dist;
          nearestIndex = index;
        }
      });

      optimized.push(remaining[nearestIndex]);
      remaining.splice(nearestIndex, 1);
    }

    routeStops = optimized;
    updateRouteDisplay();
    showToast('Route optimized!', 'success');
  });

  // Save route
  saveBtn.addEventListener('click', async () => {
    const routeName = routeNameInput.value.trim();
    const assignedTo = routeRepSelect.value;

    if (!routeName) {
      showToast('Please enter a route name', 'error');
      return;
    }

    if (routeStops.length === 0) {
      showToast('Please add at least one stop', 'error');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

    try {
      // Calculate total distance
      let totalDistance = 0;
      for (let i = 0; i < routeStops.length - 1; i++) {
        totalDistance += calculateDistance(
          routeStops[i].latitude,
          routeStops[i].longitude,
          routeStops[i + 1].latitude,
          routeStops[i + 1].longitude
        );
      }

      // Create route in database
      const routeData = {
        name: routeName,
        assigned_to: assignedTo || null,
        estimated_duration: parseInt(document.getElementById('route-duration').textContent),
        total_distance: Math.round(totalDistance * 1000), // Convert to meters
        created_by: currentUser.id,
        organization_id: currentOrganization?.id
      };

      const { data: route, error: routeError } = await supabaseClient
        .from('routes')
        .insert([routeData])
        .select();

      if (routeError) throw routeError;

      if (!route || route.length === 0) {
        throw new Error('Route was created but no data was returned');
      }

      const newRouteId = route[0].id;

      // Create route locations
      const routeLocationsData = routeStops.map((stop, index) => ({
        route_id: newRouteId,
        company_id: stop.id,
        position: index + 1
      }));

      const { error: locationsError } = await supabaseClient
        .from('route_locations')
        .insert(routeLocationsData);

      if (locationsError) throw locationsError;

      showToast('Route saved successfully!', 'success');

      // Reset form
      routeStops = [];
      routeNameInput.value = '';
      routeRepSelect.value = '';

      // Unmark all company cards
      companiesList.querySelectorAll('.company-quick-card.added').forEach(card => {
        card.classList.remove('added');
        const btn = card.querySelector('.company-card-add-btn');
        if (btn) btn.textContent = '+ Add';
      });

      // Clear stats
      document.getElementById('route-stops-count').textContent = '0';
      document.getElementById('route-distance').textContent = '0 km';
      document.getElementById('route-duration').textContent = '0 min';

      updateRouteDisplay();

      // Refresh the entire view to show new route in the list
      setTimeout(() => {
        renderRoutePlanningView();
      }, 500);

    } catch (error) {
      console.error('Error saving route:', error);
      showToast('Error saving route: ' + error.message, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = 'Save Route';
    }
  });

  // AI Nearest Location Recommendation
  function showNearestLocationRecommendation() {
    if (routeStops.length === 0) return;

    const lastStop = routeStops[routeStops.length - 1];
    let nearestCompany = null;
    let shortestDistance = Infinity;

    // Find nearest company that's not already in route
    companies.forEach(company => {
      // Skip if already in route
      if (routeStops.find(stop => stop.id === company.id)) return;

      const dist = calculateDistance(
        lastStop.latitude,
        lastStop.longitude,
        parseFloat(company.latitude),
        parseFloat(company.longitude)
      );

      if (dist < shortestDistance) {
        shortestDistance = dist;
        nearestCompany = company;
      }
    });

    if (nearestCompany && shortestDistance < 50) { // Only show if within 50km
      // Highlight the nearest company card
      const nearestCard = companiesList.querySelector(`[data-company-id="${nearestCompany.id}"]`);
      if (nearestCard && !nearestCard.classList.contains('added')) {
        // Remove previous highlights
        companiesList.querySelectorAll('.company-quick-card').forEach(card => {
          card.style.boxShadow = '';
          card.style.border = '';
        });

        // Highlight nearest
        nearestCard.style.boxShadow = '0 0 0 2px var(--color-primary)';
        nearestCard.style.border = '1.5px solid var(--color-primary)';

        // Scroll into view
        nearestCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        // Show toast with AI suggestion
        showToast(`💡 AI Suggestion: ${nearestCompany.name} is ${shortestDistance.toFixed(1)}km away`, 'info', 5000);
      }
    }
  }

  // Call AI recommendation after adding a stop
  const originalUpdateRouteDisplay = updateRouteDisplay;
  updateRouteDisplay = function () {
    originalUpdateRouteDisplay();
    if (routeStops.length > 0) {
      setTimeout(() => showNearestLocationRecommendation(), 300);
    }
  };
}


// Global function to select recommended location
window.selectRecommendedLocation = function (locationId) {
  const checkbox = document.querySelector(`#loc-${locationId}`);
  if (checkbox && !checkbox.checked) {
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
  }
};

function initRouteList() {
  // View route details
  document.querySelectorAll('.view-route-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const routeId = btn.dataset.id;
      await viewRouteDetails(routeId);
    });
  });

  // Edit route
  document.querySelectorAll('.edit-route-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const routeId = btn.dataset.id;
      await editRoute(routeId);
    });
  });

  // Delete route
  document.querySelectorAll('.delete-route-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const routeIds = btn.dataset.id.split(','); // Can be multiple IDs
      const routeItem = btn.closest('.route-item');
      const routeName = btn.dataset.routeName || routeItem.querySelector('h4').textContent;
      const assigneeCount = routeIds.length;

      const confirmMessage = assigneeCount > 1
        ? `Are you sure you want to delete route "${routeName}"? This will remove it for all ${assigneeCount} assigned reps.`
        : `Are you sure you want to delete route "${routeName}"?`;

      const confirmed = await showConfirmDialog('Delete Route', confirmMessage);

      if (!confirmed) return;

      try {
        // Delete all route records with these IDs
        const { error } = await supabaseClient
          .from('routes')
          .delete()
          .in('id', routeIds);

        if (error) throw error;

        showToast('Route deleted successfully', 'success');
        routeItem.remove();
      } catch (error) {
        showToast('Error deleting route: ' + error.message, 'error');
      }
    });
  });
}

// ======================
// A.I SAFI PLAN - Intelligent Route Planning
// ======================

function initAISafiPlan(companies, salesReps) {
  const openBtn = document.getElementById('open-ai-safi-plan');
  if (!openBtn) return;

  openBtn.addEventListener('click', () => {
    openAISafiPlanModal(companies, salesReps);
  });
}

function openAISafiPlanModal(companies, salesReps) {
  // Remove existing modal if present
  const existingModal = document.getElementById('ai-safi-plan-modal');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.id = 'ai-safi-plan-modal';
  modal.style.display = 'flex';

  modal.innerHTML = `
    <div class="modal-backdrop" onclick="closeModal('ai-safi-plan-modal')"></div>
    <div class="modal-container ai-safi-modal">
      <div class="modal-header ai-safi-header">
        <div class="ai-safi-header-content">
          <div class="ai-safi-logo">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v8"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m8 6 4-4 4 4"/><path d="M16 18a4 4 0 0 0-8 0"/></svg>
          </div>
          <div>
            <h3>A.I SAFI PLAN</h3>
            <p class="ai-safi-subtitle">Intelligent Route Distribution</p>
          </div>
        </div>
        <button class="modal-close" onclick="closeModal('ai-safi-plan-modal')">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>

      <!-- Wizard Steps Indicator -->
      <div class="ai-safi-steps">
        <div class="ai-safi-step active" data-step="1">
          <div class="step-number">1</div>
          <div class="step-label">Select Reps</div>
        </div>
        <div class="ai-safi-step-line"></div>
        <div class="ai-safi-step" data-step="2">
          <div class="step-number">2</div>
          <div class="step-label">Select Companies</div>
        </div>
        <div class="ai-safi-step-line"></div>
        <div class="ai-safi-step" data-step="3">
          <div class="step-number">3</div>
          <div class="step-label">Generate Routes</div>
        </div>
        <div class="ai-safi-step-line"></div>
        <div class="ai-safi-step" data-step="4">
          <div class="step-number">4</div>
          <div class="step-label">Review & Assign</div>
        </div>
      </div>

      <div class="modal-body ai-safi-body">
        <!-- Step 1: Select Sales Reps -->
        <div class="ai-safi-step-content active" id="ai-safi-step-1">
          <div class="step-intro">
            <h4>Select Sales Representatives</h4>
            <p>Choose the reps you want to assign routes to. The companies will be intelligently distributed based on geographic proximity.</p>
          </div>

          <div class="ai-safi-stats-preview">
            <div class="stat-card">
              <div class="stat-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
              </div>
              <div class="stat-info">
                <span class="stat-value">${companies.length}</span>
                <span class="stat-label">Companies</span>
              </div>
            </div>
            <div class="stat-card">
              <div class="stat-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              </div>
              <div class="stat-info">
                <span class="stat-value">${salesReps.length}</span>
                <span class="stat-label">Available Reps</span>
              </div>
            </div>
            <div class="stat-card highlight">
              <div class="stat-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              </div>
              <div class="stat-info">
                <span class="stat-value" id="routes-to-create">0</span>
                <span class="stat-label">Routes to Create</span>
              </div>
            </div>
          </div>

          <div class="rep-selection-container">
            <div class="rep-selection-header">
              <span class="selection-count"><span id="selected-reps-count">0</span> reps selected</span>
              <button class="btn btn-ghost btn-sm" id="select-all-reps">Select All</button>
            </div>
            <div class="rep-grid" id="rep-selection-grid">
              ${salesReps.map(rep => `
                <div class="rep-selection-card" data-rep-id="${rep.id}">
                  <div class="rep-checkbox">
                    <input type="checkbox" id="rep-${rep.id}" value="${rep.id}">
                    <label for="rep-${rep.id}"></label>
                  </div>
                  <div class="rep-avatar">${rep.first_name.charAt(0)}${rep.last_name.charAt(0)}</div>
                  <div class="rep-details">
                    <div class="rep-name">${rep.first_name} ${rep.last_name}</div>
                    <div class="rep-email">${rep.email || 'No email'}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- Step 2: Select Companies -->
        <div class="ai-safi-step-content" id="ai-safi-step-2">
          <div class="step-intro">
            <h4>Select Companies to Include</h4>
            <p>All companies are selected by default. Uncheck any companies you want to exclude from route planning.</p>
          </div>

          <div class="selection-summary-bar" id="company-selection-summary">
            <span class="selection-summary-text"><strong id="selected-companies-count">${companies.length}</strong> of ${companies.length} companies selected</span>
            <div class="company-selection-actions">
              <button class="btn btn-ghost btn-sm" id="select-all-companies">Select All</button>
              <button class="btn btn-ghost btn-sm" id="deselect-all-companies">Deselect All</button>
            </div>
          </div>

          <div class="company-selection-step">
            <div class="company-selection-header">
              <div class="company-selection-search">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                <input type="text" id="company-search" placeholder="Search companies...">
              </div>
            </div>
            <div class="company-grid-container">
              <div class="company-grid" id="company-selection-grid">
                ${companies.map(company => `
                  <div class="company-select-card selected" data-company-id="${company.id}">
                    <div class="company-select-checkbox">
                      <input type="checkbox" id="company-${company.id}" value="${company.id}" checked>
                      <label for="company-${company.id}"></label>
                    </div>
                    <div class="company-select-icon">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
                    </div>
                    <div class="company-select-info">
                      <div class="company-select-name">${company.name}</div>
                      <div class="company-select-address">${company.address || 'No address'}</div>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        </div>

        <!-- Step 3: Generating Routes (Processing) -->
        <div class="ai-safi-step-content" id="ai-safi-step-3">
          <div class="ai-processing-container">
            <div class="ai-data-stream">
              <div class="data-particle"></div>
              <div class="data-particle"></div>
              <div class="data-particle"></div>
              <div class="data-particle"></div>
              <div class="data-particle"></div>
              <div class="data-particle"></div>
            </div>
            <div class="ai-processing-animation">
              <div class="ai-brain">
                <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/><path d="M17.599 6.5a3 3 0 0 0 .399-1.375"/><path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"/><path d="M3.477 10.896a4 4 0 0 1 .585-.396"/><path d="M19.938 10.5a4 4 0 0 1 .585.396"/><path d="M6 18a4 4 0 0 1-1.967-.516"/><path d="M19.967 17.484A4 4 0 0 1 18 18"/></svg>
              </div>
              <div class="ai-pulse-rings">
                <div class="pulse-ring"></div>
                <div class="pulse-ring"></div>
                <div class="pulse-ring"></div>
              </div>
            </div>
            <div class="ai-processing-text">
              <h4>🧠 SAFI Neural Engine Active</h4>
              <p id="ai-processing-status">Initializing route optimization matrix</p>
            </div>
            <div class="ai-progress-bar">
              <div class="ai-progress-fill" id="ai-progress-fill"></div>
            </div>
            <div class="ai-processing-steps">
              <div class="processing-step" id="proc-step-1">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>
                <span>Parsing geospatial coordinates</span>
              </div>
              <div class="processing-step" id="proc-step-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>
                <span>Running anomaly detection</span>
              </div>
              <div class="processing-step" id="proc-step-3">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>
                <span>Computing spatial clusters</span>
              </div>
              <div class="processing-step" id="proc-step-4">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>
                <span>Optimizing traveling salesman</span>
              </div>
              <div class="processing-step" id="proc-step-5">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>
                <span>Finalizing route assignments</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Step 4: Review & Assign Routes -->
        <div class="ai-safi-step-content" id="ai-safi-step-4">
          <div class="step-intro">
            <h4>Review Generated Routes</h4>
            <p>Here are the optimized routes. You can reassign reps or add additional reps to any route.</p>
          </div>

          <!-- Outlier Warning will be inserted here dynamically -->
          <div id="outlier-warning-container"></div>

          <div class="ai-routes-overview" id="ai-routes-overview">
            <!-- Routes will be rendered here -->
          </div>
        </div>
      </div>

      <div class="modal-footer ai-safi-footer">
        <button class="btn btn-secondary" id="ai-safi-back" style="display: none;">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          Back
        </button>
        <div class="footer-spacer"></div>
        <button class="btn btn-secondary" onclick="closeModal('ai-safi-plan-modal')">Cancel</button>
        <button class="btn btn-primary" id="ai-safi-next" disabled>
          Continue
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
        </button>
        <button class="btn btn-primary btn-success" id="ai-safi-save" style="display: none;">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          Save All Routes
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  initAISafiPlanLogic(modal, companies, salesReps);
}

function initAISafiPlanLogic(modal, companies, salesReps) {
  let currentStep = 1;
  let selectedReps = [];
  let selectedCompanies = companies.map(c => c.id); // All companies selected by default
  let generatedRoutes = [];
  let outlierCompanies = []; // Companies that are too far (>100km from centroid)
  const OUTLIER_THRESHOLD_KM = 100; // Distance threshold for outliers

  const nextBtn = modal.querySelector('#ai-safi-next');
  const backBtn = modal.querySelector('#ai-safi-back');
  const saveBtn = modal.querySelector('#ai-safi-save');
  const repGrid = modal.querySelector('#rep-selection-grid');
  const selectAllBtn = modal.querySelector('#select-all-reps');
  const selectedCountEl = modal.querySelector('#selected-reps-count');
  const routesToCreateEl = modal.querySelector('#routes-to-create');

  // Company selection elements
  const companyGrid = modal.querySelector('#company-selection-grid');
  const companySearch = modal.querySelector('#company-search');
  const selectedCompaniesCountEl = modal.querySelector('#selected-companies-count');
  const selectAllCompaniesBtn = modal.querySelector('#select-all-companies');
  const deselectAllCompaniesBtn = modal.querySelector('#deselect-all-companies');

  // Rep selection logic
  repGrid.addEventListener('click', (e) => {
    const card = e.target.closest('.rep-selection-card');
    if (!card) return;

    const checkbox = card.querySelector('input[type="checkbox"]');
    const repId = card.dataset.repId;

    // Only toggle if not clicking directly on checkbox (checkbox handles itself)
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'LABEL') {
      checkbox.checked = !checkbox.checked;
    }

    // Sync state with checkbox
    if (checkbox.checked) {
      card.classList.add('selected');
      if (!selectedReps.includes(repId)) {
        selectedReps.push(repId);
      }
    } else {
      card.classList.remove('selected');
      selectedReps = selectedReps.filter(id => id !== repId);
    }

    updateSelectionUI();
  });

  // Also handle direct checkbox changes
  repGrid.addEventListener('change', (e) => {
    if (e.target.type !== 'checkbox') return;
    const card = e.target.closest('.rep-selection-card');
    if (!card) return;

    const repId = card.dataset.repId;

    if (e.target.checked) {
      card.classList.add('selected');
      if (!selectedReps.includes(repId)) {
        selectedReps.push(repId);
      }
    } else {
      card.classList.remove('selected');
      selectedReps = selectedReps.filter(id => id !== repId);
    }

    updateSelectionUI();
  });

  selectAllBtn.addEventListener('click', () => {
    const allSelected = selectedReps.length === salesReps.length;

    repGrid.querySelectorAll('.rep-selection-card').forEach(card => {
      const checkbox = card.querySelector('input[type="checkbox"]');
      checkbox.checked = !allSelected;
      card.classList.toggle('selected', !allSelected);
    });

    selectedReps = allSelected ? [] : salesReps.map(r => r.id);
    selectAllBtn.textContent = allSelected ? 'Select All' : 'Deselect All';
    updateSelectionUI();
  });

  // Company selection logic
  companyGrid.addEventListener('click', (e) => {
    const card = e.target.closest('.company-select-card');
    if (!card) return;

    const checkbox = card.querySelector('input[type="checkbox"]');
    const companyId = card.dataset.companyId;

    // Only toggle if not clicking directly on checkbox (checkbox handles itself)
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'LABEL') {
      checkbox.checked = !checkbox.checked;
    }

    // Sync state with checkbox
    if (checkbox.checked) {
      card.classList.add('selected');
      if (!selectedCompanies.includes(companyId)) {
        selectedCompanies.push(companyId);
      }
    } else {
      card.classList.remove('selected');
      selectedCompanies = selectedCompanies.filter(id => id !== companyId);
    }

    updateCompanySelectionUI();
  });

  // Also handle direct checkbox changes
  companyGrid.addEventListener('change', (e) => {
    if (e.target.type !== 'checkbox') return;
    const card = e.target.closest('.company-select-card');
    if (!card) return;

    const companyId = card.dataset.companyId;

    if (e.target.checked) {
      card.classList.add('selected');
      if (!selectedCompanies.includes(companyId)) {
        selectedCompanies.push(companyId);
      }
    } else {
      card.classList.remove('selected');
      selectedCompanies = selectedCompanies.filter(id => id !== companyId);
    }

    updateCompanySelectionUI();
  });

  selectAllCompaniesBtn.addEventListener('click', () => {
    companyGrid.querySelectorAll('.company-select-card').forEach(card => {
      const checkbox = card.querySelector('input[type="checkbox"]');
      checkbox.checked = true;
      card.classList.add('selected');
    });
    selectedCompanies = companies.map(c => c.id);
    updateCompanySelectionUI();
  });

  deselectAllCompaniesBtn.addEventListener('click', () => {
    companyGrid.querySelectorAll('.company-select-card').forEach(card => {
      const checkbox = card.querySelector('input[type="checkbox"]');
      checkbox.checked = false;
      card.classList.remove('selected');
    });
    selectedCompanies = [];
    updateCompanySelectionUI();
  });

  // Company search
  companySearch.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    companyGrid.querySelectorAll('.company-select-card').forEach(card => {
      const companyId = card.dataset.companyId;
      const company = companies.find(c => c.id === companyId);
      const match = !query || (company && matchesTokenizedQuery(query, company.name, company.description, company.address));
      card.style.display = match ? '' : 'none';
    });
  });

  function updateCompanySelectionUI() {
    selectedCompaniesCountEl.textContent = selectedCompanies.length;
    nextBtn.disabled = selectedCompanies.length === 0;
  }

  function updateSelectionUI() {
    selectedCountEl.textContent = selectedReps.length;
    routesToCreateEl.textContent = selectedReps.length;
    nextBtn.disabled = selectedReps.length === 0;

    // Animate the routes count
    routesToCreateEl.classList.add('animate-pop');
    setTimeout(() => routesToCreateEl.classList.remove('animate-pop'), 300);
  }

  // Navigation
  nextBtn.addEventListener('click', async () => {
    if (currentStep === 1) {
      goToStep(2);
    } else if (currentStep === 2) {
      goToStep(3);
      await generateRoutes();
    }
  });

  backBtn.addEventListener('click', () => {
    if (currentStep === 2) {
      goToStep(1);
    } else if (currentStep === 4) {
      goToStep(2);
    }
  });

  saveBtn.addEventListener('click', async () => {
    await saveAllRoutes();
  });

  function goToStep(step) {
    currentStep = step;

    // Update step indicators
    modal.querySelectorAll('.ai-safi-step').forEach(s => {
      const stepNum = parseInt(s.dataset.step);
      s.classList.remove('active', 'completed');
      if (stepNum === step) s.classList.add('active');
      if (stepNum < step) s.classList.add('completed');
    });

    // Update step content visibility
    modal.querySelectorAll('.ai-safi-step-content').forEach(c => c.classList.remove('active'));
    modal.querySelector(`#ai-safi-step-${step}`).classList.add('active');

    // Update buttons based on step
    if (step === 1) {
      backBtn.style.display = 'none';
      nextBtn.style.display = 'flex';
      saveBtn.style.display = 'none';
      nextBtn.disabled = selectedReps.length === 0;
    } else if (step === 2) {
      backBtn.style.display = 'flex';
      nextBtn.style.display = 'flex';
      saveBtn.style.display = 'none';
      nextBtn.disabled = selectedCompanies.length === 0;
    } else if (step === 3) {
      backBtn.style.display = 'none';
      nextBtn.style.display = 'none';
      saveBtn.style.display = 'none';
    } else if (step === 4) {
      backBtn.style.display = 'flex';
      nextBtn.style.display = 'none';
      saveBtn.style.display = 'flex';
    }
  }

  async function generateRoutes() {
    const progressFill = modal.querySelector('#ai-progress-fill');
    const statusText = modal.querySelector('#ai-processing-status');

    // AI-like status messages for each step
    const aiMessages = {
      step1: [
        'Parsing geospatial input vectors',
        'Loading coordinate matrices',
        'Indexing location data points'
      ],
      step2: [
        'Running K-means anomaly detection',
        'Calculating distance thresholds',
        'Flagging outlier coordinates'
      ],
      step3: [
        'Applying DBSCAN clustering',
        'Computing cluster centroids',
        'Building proximity graphs'
      ],
      step4: [
        'Solving TSP with nearest neighbor',
        'Minimizing total travel distance',
        'Reordering waypoints'
      ],
      step5: [
        'Mapping clusters to agents',
        'Balancing workload distribution',
        'Finalizing allocations'
      ]
    };

    // Animate processing steps with tech-y messages
    const animateStep = async (stepId, stepKey, progress) => {
      const stepEl = modal.querySelector(`#${stepId}`);
      stepEl.classList.add('active');
      stepEl.querySelector('svg').innerHTML = '<circle cx="12" cy="12" r="10" class="spinner-circle"/>';

      const messages = aiMessages[stepKey];
      for (let i = 0; i < messages.length; i++) {
        statusText.textContent = messages[i] + '...';
        await delay(200);
      }

      progressFill.style.width = `${progress}%`;
      stepEl.classList.remove('active');
      stepEl.classList.add('completed');
      stepEl.querySelector('svg').innerHTML = '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>';
    };

    await animateStep('proc-step-1', 'step1', 20);
    await animateStep('proc-step-2', 'step2', 40);
    await animateStep('proc-step-3', 'step3', 60);
    await animateStep('proc-step-4', 'step4', 80);
    await animateStep('proc-step-5', 'step5', 100);

    // Get selected companies
    const selectedCompanyObjects = companies.filter(c => selectedCompanies.includes(c.id));

    // Detect outliers and generate routes
    const result = distributeCompaniesToRoutes(selectedCompanyObjects, selectedReps, salesReps);
    generatedRoutes = result.routes;
    outlierCompanies = result.outliers;

    statusText.textContent = '✓ Optimization complete';
    const titleEl = modal.querySelector('.ai-processing-text h4');
    if (titleEl) titleEl.textContent = '✨ Routes optimized successfully';
    await delay(600);

    // Render routes preview with outlier warning
    renderRoutesPreview(modal, generatedRoutes, salesReps, outlierCompanies);

    goToStep(4);
  }

  function distributeCompaniesToRoutes(companiesForRoutes, selectedRepIds, allReps) {
    const numRoutes = selectedRepIds.length;
    if (numRoutes === 0 || companiesForRoutes.length === 0) return { routes: [], outliers: [] };

    // Get centroid of all companies for initial distribution
    const centroid = {
      lat: companiesForRoutes.reduce((sum, c) => sum + parseFloat(c.latitude), 0) / companiesForRoutes.length,
      lng: companiesForRoutes.reduce((sum, c) => sum + parseFloat(c.longitude), 0) / companiesForRoutes.length
    };

    // Add angle from centroid for initial clustering
    const companiesWithAngle = companiesForRoutes.map(c => ({
      ...c,
      angle: Math.atan2(
        parseFloat(c.longitude) - centroid.lng,
        parseFloat(c.latitude) - centroid.lat
      )
    })).sort((a, b) => a.angle - b.angle);

    // Initial distribution by angle
    const initialRoutes = [];
    const companiesPerRoute = Math.ceil(companiesWithAngle.length / numRoutes);

    for (let i = 0; i < numRoutes; i++) {
      const startIdx = i * companiesPerRoute;
      const endIdx = Math.min(startIdx + companiesPerRoute, companiesWithAngle.length);
      const routeCompanies = companiesWithAngle.slice(startIdx, endIdx);
      if (routeCompanies.length > 0) {
        initialRoutes.push(routeCompanies);
      }
    }

    // Now optimize each route and exclude locations > 100km apart
    const routes = [];
    const outliers = [];

    initialRoutes.forEach((routeCompanies, i) => {
      if (routeCompanies.length === 0) return;

      // Build optimized route excluding far locations
      const { optimized, excluded } = optimizeRouteWithDistanceLimit(routeCompanies, OUTLIER_THRESHOLD_KM);

      // Add excluded to outliers
      excluded.forEach(company => {
        outliers.push({
          ...company,
          reason: 'distance',
          nearestRouteDistance: company.excludedDistance
        });
      });

      if (optimized.length === 0) return;

      // Calculate route metrics
      let totalDistance = 0;
      for (let j = 0; j < optimized.length - 1; j++) {
        totalDistance += calculateDistanceBetween(
          optimized[j].latitude,
          optimized[j].longitude,
          optimized[j + 1].latitude,
          optimized[j + 1].longitude
        );
      }

      const avgSpeed = 40; // km/h
      const estimatedDuration = Math.round((totalDistance / avgSpeed) * 60);

      routes.push({
        id: `route-${routes.length + 1}`,
        name: `Route ${String.fromCharCode(65 + routes.length)}`,
        companies: optimized,
        assignedReps: [selectedRepIds[i]],
        totalDistance: totalDistance,
        estimatedDuration: estimatedDuration,
        color: getRouteColor(routes.length)
      });
    });

    return { routes, outliers };
  }

  // Optimize route order while excluding locations that are > maxDistance km from any other location in the route
  function optimizeRouteWithDistanceLimit(companies, maxDistance) {
    if (companies.length === 0) return { optimized: [], excluded: [] };
    if (companies.length === 1) return { optimized: companies, excluded: [] };

    const optimized = [companies[0]];
    let remaining = companies.slice(1);
    const excluded = [];

    while (remaining.length > 0) {
      const current = optimized[optimized.length - 1];
      let nearestIndex = 0;
      let nearestDistance = Infinity;

      // Find nearest company
      remaining.forEach((company, index) => {
        const dist = calculateDistanceBetween(
          current.latitude, current.longitude,
          company.latitude, company.longitude
        );
        if (dist < nearestDistance) {
          nearestDistance = dist;
          nearestIndex = index;
        }
      });

      // If nearest is within limit, add to route
      if (nearestDistance <= maxDistance) {
        optimized.push(remaining[nearestIndex]);
        remaining.splice(nearestIndex, 1);
      } else {
        // All remaining companies are too far - exclude them
        remaining.forEach(company => {
          // Calculate nearest distance to any company in optimized route
          let minDist = Infinity;
          optimized.forEach(opt => {
            const dist = calculateDistanceBetween(
              company.latitude, company.longitude,
              opt.latitude, opt.longitude
            );
            if (dist < minDist) minDist = dist;
          });
          excluded.push({
            ...company,
            excludedDistance: Math.round(minDist)
          });
        });
        break;
      }
    }

    return { optimized, excluded };
  }

  function optimizeRouteOrder(companies) {
    if (companies.length <= 2) return companies;

    const optimized = [companies[0]];
    let remaining = companies.slice(1);

    while (remaining.length > 0) {
      const current = optimized[optimized.length - 1];
      let nearestIndex = 0;
      let nearestDistance = Infinity;

      remaining.forEach((company, index) => {
        const dist = calculateDistanceBetween(
          current.latitude, current.longitude,
          company.latitude, company.longitude
        );
        if (dist < nearestDistance) {
          nearestDistance = dist;
          nearestIndex = index;
        }
      });

      optimized.push(remaining[nearestIndex]);
      remaining.splice(nearestIndex, 1);
    }

    return optimized;
  }

  function calculateDistanceBetween(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function getRouteColor(index) {
    const colors = ['#2f5fd0', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
    return colors[index % colors.length];
  }

  function renderRoutesPreview(modal, routes, allReps, outliers = []) {
    const container = modal.querySelector('#ai-routes-overview');
    const outlierContainer = modal.querySelector('#outlier-warning-container');

    // Render outlier warning if any
    if (outliers.length > 0) {
      outlierContainer.innerHTML = `
        <div class="outlier-warning">
          <div class="outlier-warning-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
          </div>
          <div class="outlier-warning-content">
            <div class="outlier-warning-title">Locations Left Out</div>
            <div class="outlier-warning-text">
              The following ${outliers.length} location${outliers.length > 1 ? 's were' : ' was'} left out because ${outliers.length > 1 ? 'they are' : 'it is'} more than 100km from any nearby location in the assigned routes. <strong>There are not enough reps to cover all areas.</strong> Consider adding more reps to include these locations.
            </div>
            <div class="outlier-locations">
              ${outliers.map(company => `
                <div class="outlier-location-tag">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
                  <span class="outlier-name">${company.name}</span>
                  <span class="outlier-distance">${company.nearestRouteDistance || Math.round(company.excludedDistance)} km to nearest stop</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    } else {
      outlierContainer.innerHTML = '';
    }

    if (routes.length === 0) {
      container.innerHTML = '<p class="text-muted text-center">No routes generated</p>';
      return;
    }

    let html = `
      <div class="routes-summary-bar">
        <div class="summary-item">
          <strong>${routes.length}</strong> Routes Created
        </div>
        <div class="summary-item">
          <strong>${routes.reduce((sum, r) => sum + r.companies.length, 0)}</strong> Companies Distributed
        </div>
        <div class="summary-item">
          <strong>${routes.reduce((sum, r) => sum + r.totalDistance, 0).toFixed(1)} km</strong> Total Distance
        </div>
      </div>

      <div class="routes-preview-grid">
        ${routes.map((route, routeIndex) => `
          <div class="route-preview-card" data-route-index="${routeIndex}">
            <div class="route-preview-header" style="border-left: 4px solid ${route.color}">
              <div class="route-header-info">
                <input type="text" class="route-name-input" value="${route.name}" data-route-index="${routeIndex}">
                <div class="route-meta">
                  <span><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg> ${route.companies.length} stops</span>
                  <span><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${route.estimatedDuration} min</span>
                  <span><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg> ${route.totalDistance.toFixed(1)} km</span>
                </div>
              </div>
              <button class="btn btn-ghost btn-sm toggle-route-details">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
              </button>
            </div>

            <div class="route-preview-reps">
              <label>Assigned to:</label>
              <div class="assigned-reps-container" data-route-index="${routeIndex}">
                ${route.assignedReps.map(repId => {
      const rep = allReps.find(r => r.id === repId);
      return rep ? `
                    <div class="assigned-rep-tag switchable" data-rep-id="${repId}" data-route-index="${routeIndex}" title="Click to switch rep">
                      <span class="rep-avatar-sm">${rep.first_name.charAt(0)}${rep.last_name.charAt(0)}</span>
                      <span>${rep.first_name} ${rep.last_name}</span>
                      <svg class="switch-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>
                      ${route.assignedReps.length > 1 ? `<button class="remove-rep-btn" data-rep-id="${repId}">×</button>` : ''}
                    </div>
                  ` : '';
    }).join('')}
                <button class="add-rep-btn" data-route-index="${routeIndex}">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/></svg>
                  Add Rep
                </button>
              </div>
            </div>

            <div class="route-preview-companies collapsed">
              <div class="companies-list-header">Companies in this route:</div>
              <div class="route-companies-list">
                ${route.companies.map((company, idx) => `
                  <div class="route-company-item">
                    <div class="company-order" style="background: ${route.color}">${idx + 1}</div>
                    <div class="company-info">
                      <div class="company-name">${company.name}</div>
                      <div class="company-address">${company.address || 'No address'}</div>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>

            <div class="route-preview-map" id="route-preview-map-${routeIndex}"></div>
          </div>
        `).join('')}
      </div>
    `;

    container.innerHTML = html;

    // Initialize route maps
    setTimeout(() => {
      routes.forEach((route, index) => {
        initRoutePreviewMap(`route-preview-map-${index}`, route);
      });
    }, 100);

    // Toggle route details
    container.querySelectorAll('.toggle-route-details').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.route-preview-card');
        const companies = card.querySelector('.route-preview-companies');
        companies.classList.toggle('collapsed');
        btn.querySelector('svg').style.transform = companies.classList.contains('collapsed') ? '' : 'rotate(180deg)';
      });
    });

    // Route name editing
    container.querySelectorAll('.route-name-input').forEach(input => {
      input.addEventListener('change', (e) => {
        const routeIndex = parseInt(e.target.dataset.routeIndex);
        generatedRoutes[routeIndex].name = e.target.value;
      });
    });

    // Switch rep - click on rep tag to change
    container.querySelectorAll('.assigned-rep-tag.switchable').forEach(tag => {
      tag.addEventListener('click', (e) => {
        // Don't trigger if clicking remove button
        if (e.target.closest('.remove-rep-btn')) return;

        const routeIndex = parseInt(tag.dataset.routeIndex);
        const currentRepId = tag.dataset.repId;
        showSwitchRepDropdown(tag, routeIndex, currentRepId, allReps, generatedRoutes, container, outliers);
      });
    });

    // Add rep button
    container.querySelectorAll('.add-rep-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const routeIndex = parseInt(btn.dataset.routeIndex);
        showAddRepDropdown(btn, routeIndex, allReps, generatedRoutes, container, outliers);
      });
    });

    // Remove rep button
    container.querySelectorAll('.remove-rep-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const repId = btn.dataset.repId;
        const card = btn.closest('.route-preview-card');
        const routeIndex = parseInt(card.dataset.routeIndex);
        generatedRoutes[routeIndex].assignedReps = generatedRoutes[routeIndex].assignedReps.filter(id => id !== repId);
        renderRoutesPreview(modal, generatedRoutes, allReps, outliers);
      });
    });
  }

  // Dropdown for switching a rep on a route
  function showSwitchRepDropdown(tag, routeIndex, currentRepId, allReps, routes, container, outliers) {
    // Remove existing dropdowns
    document.querySelectorAll('.add-rep-dropdown').forEach(d => d.remove());

    const route = routes[routeIndex];
    // Get reps not already on this route (excluding current)
    const availableReps = allReps.filter(r => r.id !== currentRepId && !route.assignedReps.includes(r.id));

    if (availableReps.length === 0) {
      showToast('No other reps available to switch to', 'info');
      return;
    }

    const dropdown = document.createElement('div');
    dropdown.className = 'add-rep-dropdown switch-dropdown';
    dropdown.innerHTML = `
      <div class="dropdown-header">Switch to:</div>
      ${availableReps.map(rep => `
        <div class="dropdown-rep-option" data-rep-id="${rep.id}">
          <span class="rep-avatar-sm">${rep.first_name.charAt(0)}${rep.last_name.charAt(0)}</span>
          <span>${rep.first_name} ${rep.last_name}</span>
        </div>
      `).join('')}
    `;

    tag.style.position = 'relative';
    tag.appendChild(dropdown);

    dropdown.querySelectorAll('.dropdown-rep-option').forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const newRepId = opt.dataset.repId;
        // Replace the current rep with new one
        const repIndex = routes[routeIndex].assignedReps.indexOf(currentRepId);
        if (repIndex > -1) {
          routes[routeIndex].assignedReps[repIndex] = newRepId;
        }
        dropdown.remove();
        renderRoutesPreview(modal, routes, allReps, outliers);
      });
    });

    // Close dropdown on outside click
    setTimeout(() => {
      document.addEventListener('click', function closeDropdown(e) {
        if (!dropdown.contains(e.target) && !tag.contains(e.target)) {
          dropdown.remove();
          document.removeEventListener('click', closeDropdown);
        }
      });
    }, 10);
  }

  function initRoutePreviewMap(containerId, route) {
    const container = document.getElementById(containerId);
    if (!container || route.companies.length === 0) return;

    const map = L.map(containerId, {
      zoomControl: false,
      attributionControl: false
    }).setView([route.companies[0].latitude, route.companies[0].longitude], 12);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    // Add markers
    const bounds = [];
    route.companies.forEach((company, idx) => {
      const marker = L.marker([company.latitude, company.longitude], {
        icon: L.divIcon({
          className: 'custom-marker',
          html: `<div style="background: ${route.color}; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 12px; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">${idx + 1}</div>`,
          iconSize: [24, 24]
        })
      }).addTo(map);
      bounds.push([company.latitude, company.longitude]);
    });

    // Draw route line
    if (route.companies.length >= 2) {
      const latlngs = route.companies.map(c => [c.latitude, c.longitude]);
      L.polyline(latlngs, { color: route.color, weight: 3, opacity: 0.8 }).addTo(map);
    }

    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [20, 20] });
    }
  }

  function showAddRepDropdown(btn, routeIndex, allReps, routes, container, outliers) {
    // Remove existing dropdown
    document.querySelectorAll('.add-rep-dropdown').forEach(d => d.remove());

    const route = routes[routeIndex];
    const availableReps = allReps.filter(r => !route.assignedReps.includes(r.id));

    if (availableReps.length === 0) {
      showToast('All reps are already assigned to this route', 'info');
      return;
    }

    const dropdown = document.createElement('div');
    dropdown.className = 'add-rep-dropdown';
    dropdown.innerHTML = `
      <div class="dropdown-header">Add rep:</div>
      ${availableReps.map(rep => `
        <div class="dropdown-rep-option" data-rep-id="${rep.id}">
          <span class="rep-avatar-sm">${rep.first_name.charAt(0)}${rep.last_name.charAt(0)}</span>
          <span>${rep.first_name} ${rep.last_name}</span>
        </div>
      `).join('')}
    `;

    btn.style.position = 'relative';
    btn.appendChild(dropdown);

    dropdown.querySelectorAll('.dropdown-rep-option').forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const repId = opt.dataset.repId;
        routes[routeIndex].assignedReps.push(repId);
        dropdown.remove();
        renderRoutesPreview(modal, routes, allReps, outliers);
      });
    });

    // Close dropdown on outside click
    setTimeout(() => {
      document.addEventListener('click', function closeDropdown(e) {
        if (!dropdown.contains(e.target) && !btn.contains(e.target)) {
          dropdown.remove();
          document.removeEventListener('click', closeDropdown);
        }
      });
    }, 10);
  }

  async function saveAllRoutes() {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<svg class="spinner" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" stroke-dasharray="60" stroke-dashoffset="20"/></svg> Saving...';

    try {
      for (const route of generatedRoutes) {
        // Create route for each assigned rep
        for (const repId of route.assignedReps) {
          const routeData = {
            name: route.name,
            assigned_to: repId,
            estimated_duration: route.estimatedDuration,
            total_distance: Math.round(route.totalDistance * 1000),
            created_by: currentUser.id,
            organization_id: currentOrganization?.id
          };

          const { data: savedRoute, error: routeError } = await supabaseClient
            .from('routes')
            .insert([routeData])
            .select();

          if (routeError) throw routeError;

          // Create route locations
          const routeLocations = route.companies.map((company, idx) => ({
            route_id: savedRoute[0].id,
            company_id: company.id,
            position: idx + 1
          }));

          const { error: locationsError } = await supabaseClient
            .from('route_locations')
            .insert(routeLocations);

          if (locationsError) throw locationsError;
        }
      }

      showToast(`Successfully created ${generatedRoutes.length} routes!`, 'success');
      closeModal('ai-safi-plan-modal');

      // Refresh the route planning view
      setTimeout(() => {
        renderRoutePlanningView();
      }, 500);

    } catch (error) {
      console.error('Error saving routes:', error);
      showToast('Error saving routes: ' + error.message, 'error');
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save All Routes';
    }
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Updated viewRouteDetails function
// Replace the existing viewRouteDetails function with this updated version
async function viewRouteDetails(routeId) {
  const oldModal = document.getElementById('route-details-modal');
  if (oldModal) {
    oldModal.remove();
  }

  try {
    // Use the correct table name 'routes' instead of 'route_details'
    const { data: route, error: routeError } = await supabaseClient
      .from('routes')
      .select(`
        *,
        assigned_to_profile:profiles!routes_assigned_to_fkey(first_name, last_name),
        created_by_profile:profiles!routes_created_by_fkey(first_name, last_name)
      `)
      .eq('id', routeId)
      .single();

    if (routeError) throw routeError;

    // Use the correct table name 'route_locations' with a join to companies
    const { data: routeLocations, error: locationsError } = await supabaseClient
      .from('route_locations')
      .select(`
        *,
        companies(id, name, address, latitude, longitude)
      `)
      .eq('route_id', routeId)
      .order('position');

    if (locationsError) throw locationsError;

    // Create modal to show route details
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.id = 'route-details-modal';
    modal.innerHTML = `
      <div class="modal-backdrop" onclick="closeModal('route-details-modal')"></div>
      <div class="modal-container modal-size-lg">
        <div class="modal-header">
          <h3>${route.name}</h3>
          <button class="modal-close" onclick="closeModal('route-details-modal')">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x-icon lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="route-details">
            <div class="route-info">
              <p><strong>Assigned to:</strong> ${route.assigned_to_profile ? `${route.assigned_to_profile.first_name} ${route.assigned_to_profile.last_name}` : 'Unassigned'}</p>
              <p><strong>Created by:</strong> ${route.created_by_profile ? `${route.created_by_profile.first_name} ${route.created_by_profile.last_name}` : 'Unknown'}</p>
              <p><strong>Created:</strong> ${formatDate(route.created_at)}</p>
              ${route.estimated_duration ? `<p><strong>Est. duration:</strong> ${route.estimated_duration} min</p>` : ''}
              ${route.total_distance ? `<p><strong>Total distance:</strong> ${(route.total_distance / 1000).toFixed(2)} km</p>` : ''}
            </div>
            
            <div class="route-map u-map-md u-my-md" id="route-details-map"></div>
            
            <h4>Route Stops</h4>
            <ol class="route-stops">
              ${routeLocations.map((stop, index) => `
                <li>
                  <strong>${stop.companies.name}</strong><br>
                  ${stop.companies.address || 'No address'}
                </li>
              `).join('')}
            </ol>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Initialize map with a delay to ensure DOM is ready
    setTimeout(() => {
      // Filter for valid locations with coordinates
      const validStops = routeLocations.filter(stop =>
        stop.companies &&
        stop.companies.latitude &&
        stop.companies.longitude &&
        !isNaN(stop.companies.latitude) &&
        !isNaN(stop.companies.longitude)
      );

      if (validStops.length > 0) {
        const map = L.map('route-details-map').setView(
          [validStops[0].companies.latitude, validStops[0].companies.longitude],
          13
        );

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap'
        }).addTo(map);

        // Add markers for each location
        const markers = validStops.map((stop, index) => {
          return L.marker([stop.companies.latitude, stop.companies.longitude])
            .bindPopup(`<b>${index + 1}. ${stop.companies.name}</b><br>${stop.companies.address || 'No address'}`)
            .addTo(map);
        });

        // Draw route line
        const latlngs = validStops.map(stop => [stop.companies.latitude, stop.companies.longitude]);
        L.polyline(latlngs, { color: '#4f46e5', weight: 4 }).addTo(map);

        // Fit map to show entire route
        const group = new L.featureGroup(markers);
        map.fitBounds(group.getBounds().pad(0.1));
      } else {
        const mapElement = document.getElementById('route-details-map');
        if (mapElement) {
          mapElement.innerHTML = '<div class="text-center u-p-xl">No valid location data available for this route</div>';
        }
      }
    }, 100);
  } catch (error) {
    console.error('Error loading route details:', error);
    showToast('Error loading route details: ' + error.message, 'error');
  }
}

async function editRoute(routeId) {
  // Similar to viewRouteDetails but with editing capabilities
  // This would allow managers to modify route order or locations
  showToast('Edit route functionality to be implemented', 'info');
}

// ======================
// MY ROUTES VIEW
// ======================

async function renderMyRoutesView() {
  try {
    const { data: routes, error: routesError } = await supabaseClient
      .from('routes')
      .select('*')
      .eq('assigned_to', currentUser.id)
      // Note: we no longer filter by is_active. Sales reps should still see completed
      // routes in their list so they can run them again if needed.
      .order('created_at', { ascending: false });

    if (routesError) throw routesError;

    let html = `

    `;

    let routeIds = [];
    let allRouteLocations = [];
    let companies = [];

    if (routes.length === 0) {
      html += `
        <div class="card">
          <div class="empty-state">
            <h3 class="empty-state-title">No routes assigned</h3>
            <p class="empty-state-description">
              Your manager will assign routes to you here.
            </p>
          </div>
        </div>
      `;
    } else {
      routeIds = routes.map(r => r.id);

      // Get route locations with more flexible approach
      try {
        const { data: routeLocationsData, error: locationsError } =
          await supabaseClient
            .from('route_locations')
            .select('*')
            .in('route_id', routeIds)
            .order('position');

        if (!locationsError) {
          allRouteLocations = routeLocationsData || [];
        }
      } catch (e) {
        console.error('Error fetching route locations:', e);
      }

      // Extract location IDs with more flexible approach
      const locationIds = allRouteLocations
        .map(rl => {
          // Try different possible column names
          return rl.location_id || rl.company_id || rl.stop_id || rl.point_id || rl.company;
        })
        .filter(Boolean); // Filter out null/undefined values

      if (locationIds.length > 0) {
        try {
          const { data: companiesData } = await supabaseClient
            .from('companies')
            .select('*')
            .in('id', locationIds);

          if (companiesData) companies = companiesData;
        } catch (e) {
          console.error('Error fetching companies:', e);
        }
      }

      for (const route of routes) {
        const routeLocations = allRouteLocations
          .filter(rl => rl.route_id === route.id)
          .sort((a, b) => a.position - b.position)
          .map(rl => {
            // Try different possible column names
            const locationId = rl.location_id || rl.company_id || rl.stop_id || rl.point_id || rl.company;

            const company = companies.find(c => c.id === locationId);

            // If no company found, create a placeholder with available data
            return {
              ...rl,
              company: company || {
                id: locationId,
                name: rl.name || 'Unknown Location',
                address: rl.address || 'No address',
                latitude: rl.latitude,
                longitude: rl.longitude
              }
            };
          });

        const completedBadge = route.is_active ? '' : '<span class="badge badge-secondary" style="margin-left:8px;">Completed</span>';
        const startBtnText = route.is_active ? 'Start Route' : 'Run Again';

        html += `
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">${route.name}${completedBadge}</h3>
              <button class="btn btn-primary start-route-btn"
                      data-id="${route.id}">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-navigation2-icon lucide-navigation-2"><polygon points="12 2 19 21 12 17 5 21 12 2"/></svg>
                ${startBtnText}
              </button>
            </div>

            <div class="route-summary">
              <p><strong>Created:</strong> ${formatDate(route.created_at)}</p>
              ${route.estimated_duration
            ? `<p><strong>Est. duration:</strong> ${route.estimated_duration} min</p>`
            : ''
          }
              ${route.total_distance
            ? `<p><strong>Total distance:</strong> ${(route.total_distance / 1000).toFixed(2)} km</p>`
            : ''
          }
            </div>

            <div class="route-map"
                id="route-preview-${route.id}"
                style="height:200px;margin:1rem 0;"></div>

            <h4>Route Stops</h4>
            <ol class="route-stops">
              ${routeLocations
            .map(
              loc => `
                    <li>
                      <strong>${loc.company.name}</strong><br>
                      ${loc.company.address || 'No address'}
                    </li>
                  `
            )
            .join('')}
            </ol>
          </div>
        `;
      }
    }

    viewContainer.innerHTML = html;

    // Initialize map previews for routes with valid locations
    for (const route of routes) {
      const routeLocations = allRouteLocations
        .filter(rl => rl.route_id === route.id)
        .sort((a, b) => a.position - b.position)
        .map(rl => {
          // Try different possible column names
          const locationId = rl.location_id || rl.company_id || rl.stop_id || rl.point_id || rl.company;
          const company = companies.find(c => c.id === locationId);

          return {
            ...rl,
            company: company || {
              id: locationId,
              name: rl.name || 'Unknown Location',
              address: rl.address || 'No address',
              latitude: rl.latitude,
              longitude: rl.longitude
            }
          };
        });

      // Filter for valid locations with coordinates
      const validLocations = routeLocations.filter(loc =>
        loc.company &&
        loc.company.latitude &&
        loc.company.longitude &&
        !isNaN(loc.company.latitude) &&
        !isNaN(loc.company.longitude)
      );

      if (validLocations.length > 0) {
        setTimeout(() => {
          try {
            const map = L.map(`route-preview-${route.id}`).setView(
              [validLocations[0].company.latitude, validLocations[0].company.longitude],
              13
            );

            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
              attribution: '© OpenStreetMap'
            }).addTo(map);

            // Add markers for each location
            const markers = validLocations.map((location, index) => {
              return L.marker([location.company.latitude, location.company.longitude])
                .bindPopup(`<b>${index + 1}. ${location.company.name}</b><br>${location.company.address || 'No address'}`)
                .addTo(map);
            });

            // Draw route line
            const latlngs = validLocations.map(loc => [loc.company.latitude, loc.company.longitude]);
            L.polyline(latlngs, { color: '#4f46e5', weight: 4 }).addTo(map);

            // Fit map to show entire route
            const group = new L.featureGroup(markers);
            map.fitBounds(group.getBounds().pad(0.1));
          } catch (e) {
            console.error('Error initializing map for route', route.id, ':', e);
            const mapElement = document.getElementById(`route-preview-${route.id}`);
            if (mapElement) {
              mapElement.innerHTML = '<div class="text-center u-p-xl">Map unavailable</div>';
            }
          }
        }, 100);
      } else {
        const mapElement = document.getElementById(`route-preview-${route.id}`);
        if (mapElement) {
          mapElement.innerHTML = '<div class="text-center u-p-xl">No valid location data</div>';
        }
      }
    }

    document.querySelectorAll('.start-route-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        startRouteNavigation(btn.dataset.id);
      });
    });

  } catch (error) {
    console.error('Error rendering routes:', error);
    viewContainer.innerHTML = renderError(error.message);
  }
}

// ======================
// ROUTE NAVIGATION
// ======================

async function startRouteNavigation(routeId) {
  try {
    // Fetch route details
    const { data: route, error: routeError } = await supabaseClient
      .from('routes')
      .select('*')
      .eq('id', routeId)
      .single();

    if (routeError) {
      showToast('Error loading route: ' + routeError.message, 'error');
      return;
    }

    // Get route locations with more flexible approach
    let routeLocationsData = [];
    try {
      const { data: locations, error: locationsError } = await supabaseClient
        .from('route_locations')
        .select('*')
        .eq('route_id', routeId)
        .order('position');

      if (!locationsError) {
        routeLocationsData = locations || [];
      }
    } catch (e) {
      console.error('Error fetching route locations:', e);
    }

    // Get company details for each location
    const locationIds = routeLocationsData
      .map(rl => {
        // Try different possible column names
        return rl.location_id || rl.company_id || rl.stop_id || rl.point_id || rl.company;
      })
      .filter(Boolean);

    let companies = [];
    if (locationIds.length > 0) {
      try {
        const { data: companiesData } = await supabaseClient
          .from('companies')
          .select('*')
          .in('id', locationIds);

        if (companiesData) companies = companiesData;
      } catch (e) {
        console.error('Error fetching companies:', e);
      }
    }

    // Combine data
    const locations = routeLocationsData
      .sort((a, b) => a.position - b.position)
      .map(rl => {
        // Try different possible column names
        const locationId = rl.location_id || rl.company_id || rl.stop_id || rl.point_id || rl.company;
        const company = companies.find(c => c.id === locationId);

        // If no company found, create a placeholder with available data
        return {
          ...rl,
          company: company || {
            id: locationId,
            name: rl.name || 'Unknown Location',
            address: rl.address || 'No address',
            latitude: rl.latitude,
            longitude: rl.longitude
          }
        };
      });

    // Filter for valid locations with coordinates
    const validLocations = locations.filter(loc =>
      loc.company &&
      loc.company.name &&
      loc.company.latitude &&
      loc.company.longitude &&
      !isNaN(loc.company.latitude) &&
      !isNaN(loc.company.longitude)
    );

    if (validLocations.length === 0) {
      showToast('No valid locations found for this route', 'error');
      return;
    }

    // Create navigation view
    let html = `
      <div class="route-navigation">
        <div class="route-navigation-header">
          <button class="btn btn-ghost" onclick="loadView('my-routes')">
            <i data-lucide="arrow-left"></i> Back
          </button>
          <h2>${route.name}</h2>
          <button class="btn btn-secondary" id="complete-route-btn">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-icon lucide-check"><path d="M20 6 9 17l-5-5"/></svg>
            Complete
          </button>
        </div>
        
        <div class="route-navigation-map" id="navigation-map"></div>
        
        <div class="route-navigation-info">
          <div class="current-stop" id="current-stop">
            <h3>Current Stop</h3>
            <div class="stop-info">
              <h4 id="current-stop-name">${validLocations[0].company.name}</h4>
              <p id="current-stop-address">${validLocations[0].company.address || 'No address'}</p>
              <div class="stop-actions">
                <button class="btn btn-primary" id="arrived-btn">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-icon lucide-check"><path d="M20 6 9 17l-5-5"/></svg>I've Arrived
                </button>
                <button class="btn btn-secondary" id="get-directions-btn">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-locate-icon lucide-locate"><line x1="2" x2="5" y1="12" y2="12"/><line x1="19" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="5"/><line x1="12" x2="12" y1="19" y2="22"/><circle cx="12" cy="12" r="7"/></svg>
                  Get Directions
                </button>
              </div>
            </div>
          </div>
          
          <div class="next-stops">
            <h3>Upcoming Stops</h3>
            <div class="stops-list" id="stops-list">
              ${validLocations.slice(1).map((location, index) => `
                <div class="stop-item" data-index="${index + 1}">
                  <div class="stop-number">${index + 2}</div>
                  <div class="stop-details">
                    <h4>${location.company.name}</h4>
                    <p>${location.company.address || 'No address'}</p>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    viewContainer.innerHTML = html;

    // Initialize navigation
    let currentStopIndex = 0;
    let map = null;
    let userMarker = null;
    let routeLine = null;
    let stopMarkers = [];

    // Initialize map with a delay to ensure DOM is ready
    setTimeout(() => {
      try {
        map = L.map('navigation-map').setView(
          [validLocations[0].company.latitude, validLocations[0].company.longitude],
          15
        );

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap'
        }).addTo(map);

        // Add markers for each location
        validLocations.forEach((location, index) => {
          const isCurrentStop = index === currentStopIndex;
          const isCompletedStop = index < currentStopIndex;

          const marker = L.marker([location.company.latitude, location.company.longitude], {
            icon: L.divIcon({
              className: 'route-marker',
              html: `<div class="route-marker-icon ${isCurrentStop ? 'current' : ''} ${isCompletedStop ? 'completed' : ''}">${index + 1}</div>`,
              iconSize: [30, 30],
              iconAnchor: [15, 15]
            })
          })
            .bindPopup(`<b>${index + 1}. ${location.company.name}</b><br>${location.company.address || 'No address'}`)
            .addTo(map);

          stopMarkers.push(marker);
        });

        // Draw route line
        const latlngs = validLocations.map(loc => [loc.company.latitude, loc.company.longitude]);
        routeLine = L.polyline(latlngs, { color: '#4f46e5', weight: 4, opacity: 0.7 }).addTo(map);

        // Fit map to show entire route
        const group = new L.featureGroup(stopMarkers);
        map.fitBounds(group.getBounds().pad(0.1));

        // Try to get user's location
        if (navigator.geolocation) {
          navigator.geolocation.watchPosition(
            (position) => {
              const { latitude, longitude } = position.coords;

              // Update or create user marker
              if (userMarker) {
                userMarker.setLatLng([latitude, longitude]);
              } else {
                userMarker = L.marker([latitude, longitude], {
                  icon: L.divIcon({
                    className: 'user-marker',
                    html: '<div class="user-marker-icon"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-user-icon lucide-user"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>',
                    iconSize: [30, 30],
                    iconAnchor: [15, 15]
                  })
                }).addTo(map);
              }

              // Check if user is near current stop
              const currentLocation = validLocations[currentStopIndex];
              const distance = calculateDistance(
                latitude, longitude,
                currentLocation.company.latitude, currentLocation.company.longitude
              );

              // If within 100 meters, show notification
              if (distance < 100) {
                document.getElementById('arrived-btn').classList.add('pulse');
              }
            },
            (error) => {
              console.error('Error getting location:', error);
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
          );
        }
      } catch (e) {
        console.error('Error initializing map:', e);
        const mapElement = document.getElementById('navigation-map');
        if (mapElement) {
          mapElement.innerHTML = '<div class="text-center u-p-xl">Map unavailable</div>';
        }
      }
    }, 100);

    // Handle button clicks
    document.getElementById('arrived-btn').addEventListener('click', () => {
      // Mark current stop as completed
      currentStopIndex++;

      // If there are more stops, update UI
      if (currentStopIndex < validLocations.length) {
        // Update current stop
        document.getElementById('current-stop-name').textContent = validLocations[currentStopIndex].company.name;
        document.getElementById('current-stop-address').textContent = validLocations[currentStopIndex].company.address || 'No address';

        // Update stops list
        const firstStop = document.querySelector('.stop-item');
        if (firstStop) {
          firstStop.remove();
        }

        // Update map markers
        if (stopMarkers[currentStopIndex - 1]) {
          stopMarkers[currentStopIndex - 1].setIcon(
            L.divIcon({
              className: 'route-marker',
              html: `<div class="route-marker-icon completed">${currentStopIndex}</div>`,
              iconSize: [30, 30],
              iconAnchor: [15, 15]
            })
          );
        }

        if (stopMarkers[currentStopIndex]) {
          stopMarkers[currentStopIndex].setIcon(
            L.divIcon({
              className: 'route-marker',
              html: `<div class="route-marker-icon current">${currentStopIndex + 1}</div>`,
              iconSize: [30, 30],
              iconAnchor: [15, 15]
            })
          );
        }

        // Center map on new current stop
        if (map) {
          map.setView([validLocations[currentStopIndex].company.latitude, validLocations[currentStopIndex].company.longitude], 15);
        }

        showToast(`Proceeding to stop ${currentStopIndex + 1}`, 'info');
      } else {
        // Route completed
        completeRoute(routeId);
      }
    });

    document.getElementById('get-directions-btn').addEventListener('click', () => {
      const currentLocation = validLocations[currentStopIndex];
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${currentLocation.company.latitude},${currentLocation.company.longitude}`, '_blank');
    });

    document.getElementById('complete-route-btn').addEventListener('click', async () => {
      const confirmed = await showConfirmDialog(
        'Complete Route',
        'Are you sure you want to mark this route as completed?'
      );

      if (!confirmed) return;

      completeRoute(routeId);
    });
  } catch (error) {
    console.error('Error starting route navigation:', error);
    showToast('Error starting route: ' + error.message, 'error');
  }
}

async function completeRoute(routeId) {
  try {
    // We intentionally do *not* deactivate the route. Sales reps may want to
    // run the same route again, so keep it listed. The previous behaviour
    // flipped `is_active` to false which hid the route from the "My Routes"
    // view. That update has been removed per the new requirements.
    // If you have a column such as `last_completed_at` you could update it
    // here for auditing, e.g.:
    // await supabaseClient.from('routes').update({ last_completed_at: new Date().toISOString() }).eq('id', routeId);
    
    showToast('Route completed successfully. It will remain available so you can run it again.', 'success');
    loadView('my-routes');
  } catch (error) {
    console.error('Error completing route:', error);
    showToast('Error completing route: ' + error.message, 'error');
  }
}

// ======================
// TASKS VIEW
// ======================

// State for task view preference
let currentTaskViewMode = 'kanban'; // 'kanban' or 'list'

async function renderTasksView() {
  // Fetch tasks based on user role
  let tasks;
  let error;

  if (isManager) {
    const result = await supabaseClient
      .from('tasks')
      .select(`
        *,
        assigned_to_profile:profiles!tasks_assigned_to_fkey(first_name, last_name, email),
        created_by_profile:profiles!tasks_created_by_fkey(first_name, last_name, email)
      `)
      .eq('created_by', currentUser.id)
      .order('created_at', { ascending: false });

    tasks = result.data;
    error = result.error;
  } else {
    const result = await supabaseClient
      .from('tasks')
      .select('*')
      .or(`assigned_to.eq.${currentUser.id},created_by.eq.${currentUser.id}`)
      .order('created_at', { ascending: false });

    tasks = result.data;
    error = result.error;
  }

  if (error) {
    viewContainer.innerHTML = renderError(error.message);
    return;
  }

  // Store tasks globally for edit/delete access
  window.allTasksData = tasks;

  // Fetch sales reps for assignment dropdown (managers only)
  let salesReps = [];
  if (isManager) {
    let repsQ = supabaseClient.from('profiles').select('id, first_name, last_name, email').eq('role', 'sales_rep').order('first_name', { ascending: true });
    if (currentOrganization?.id) repsQ = repsQ.eq('organization_id', currentOrganization.id);
    const { data: reps } = await repsQ;
    salesReps = reps || [];
  }
  // Store globally for editTask access
  window.salesRepsData = salesReps;

  let html = `

    <div class="tasks-kanban-header">
      <div class="tasks-search-bar">
        <i class="fas fa-search"></i>
        <input type="text" id="task-search-input" placeholder="Search tasks...">
      </div>
      <div class="tasks-header-actions">
        <button class="btn btn-secondary" id="filter-tasks-btn">
          <i class="fas fa-filter"></i> Filter
        </button>
        <button class="btn btn-primary" id="add-task-btn">
          <i class="fas fa-plus"></i> New Task
        </button>
      </div>
    </div>
  `;

  // Always render Kanban
  // Group tasks by status
  const todoTasks = tasks.filter(t => t.status === 'pending');
  const inProgressTasks = tasks.filter(t => t.status === 'in_progress');
  const doneTasks = tasks.filter(t => t.status === 'completed');

  html += `
    <div class="tasks-kanban-container">
      <!-- To Do Column -->
      <div class="kanban-column" data-status="pending">
        <div class="kanban-column-header">
          <div class="kanban-column-title">
            <div class="kanban-column-icon todo">📋</div>
            <span>To Do</span>
            <span class="kanban-column-count">${todoTasks.length} Tasks</span>
          </div>
          <button class="kanban-add-btn" data-status="pending">
            <i class="fas fa-plus"></i>
          </button>
        </div>
        <div class="kanban-cards-container" id="kanban-todo">
          ${todoTasks.length === 0 ? `
            <div class="kanban-empty-state">
              <div class="kanban-empty-icon">📝</div>
              <div class="kanban-empty-text">No tasks</div>
            </div>
          ` : todoTasks.map(task => renderKanbanTaskCard(task, isManager)).join('')}
        </div>
      </div>

      <!-- In Progress Column -->
      <div class="kanban-column" data-status="in_progress">
        <div class="kanban-column-header">
          <div class="kanban-column-title">
            <div class="kanban-column-icon in-progress">🔄</div>
            <span>In Progress</span>
            <span class="kanban-column-count">${inProgressTasks.length} Tasks</span>
          </div>
          <button class="kanban-add-btn" data-status="in_progress">
            <i class="fas fa-plus"></i>
          </button>
        </div>
        <div class="kanban-cards-container" id="kanban-in-progress">
          ${inProgressTasks.length === 0 ? `
            <div class="kanban-empty-state">
              <div class="kanban-empty-icon">⚙️</div>
              <div class="kanban-empty-text">No tasks</div>
            </div>
          ` : inProgressTasks.map(task => renderKanbanTaskCard(task, isManager)).join('')}
        </div>
      </div>

      <!-- Done Column -->
      <div class="kanban-column" data-status="completed">
        <div class="kanban-column-header">
          <div class="kanban-column-title">
            <div class="kanban-column-icon done">✅</div>
            <span>Done</span>
            <span class="kanban-column-count">${doneTasks.length} Tasks</span>
          </div>
          <button class="kanban-add-btn" data-status="completed">
            <i class="fas fa-plus"></i>
          </button>
        </div>
        <div class="kanban-cards-container" id="kanban-completed">
          ${doneTasks.length === 0 ? `
            <div class="kanban-empty-state">
              <div class="kanban-empty-icon">🎉</div>
              <div class="kanban-empty-text">No tasks</div>
            </div>
          ` : doneTasks.map(task => renderKanbanTaskCard(task, isManager)).join('')}
        </div>
      </div>
    </div>
  `;

  // Add Task Modal Container
  html += `
    <div class="task-detail-modal" id="task-detail-modal">
      <div class="task-detail-container" id="task-detail-content">
        <!-- Content will be populated dynamically -->
      </div>
    </div>
  `;

  viewContainer.innerHTML = html;

  // Initialize functionality
  initKanbanBoard(tasks, salesReps);

  // Common listeners setup (Search, Add Task)
  // ... (Listeners are set up below in existing code)
}

function renderKanbanTaskCard(task, isManager) {
  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'completed';

  // Robust Assignee Logic
  let assigneeHtml = '<span style="font-size:0.75rem; color:var(--text-muted);">Unassigned</span>';
  let assigneeName = 'Unassigned';

  if (task.assigned_to_profile) {
    assigneeName = `${task.assigned_to_profile.first_name} ${task.assigned_to_profile.last_name}`;
    const initials = (task.assigned_to_profile.first_name?.[0] || '') + (task.assigned_to_profile.last_name?.[0] || '');
    assigneeHtml = `
            <div class="task-card-assignee">
              ${initials}
            </div>
            <span class="task-card-assignee-name">${task.assigned_to_profile.first_name}</span>
      `;
  } else if (task.assigned_to === currentUser.id) {
    assigneeName = 'Me';
    assigneeHtml = `
            <div class="task-card-assignee" style="background:var(--color-primary); color: white;">
              Me
            </div>
            <span class="task-card-assignee-name">Me</span>
      `;
  }

  return `
    <div class="kanban-task-card" data-task-id="${task.id}" data-status="${task.status}">
      <div class="task-card-header">
        <div class="task-card-title">${task.title}</div>
        <!-- Menu hidden/removed per design -->
      </div>
      ${task.description ? `
        <div class="task-card-description">${task.description}</div>
      ` : ''}
      <div class="task-card-tags">
        ${task.priority ? `
          <span class="task-tag priority-${task.priority}">
            ${task.priority === 'high' ? '🔴' : task.priority === 'medium' ? '🟡' : '🔵'}
            ${task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}
          </span>
        ` : ''}
      </div>
      <div class="task-card-footer">
        <div class="task-card-due-date ${isOverdue ? 'overdue' : ''}">
          <i class="fas fa-calendar"></i>
          ${task.due_date ? formatDate(task.due_date) : 'No date'}
        </div>
        <div class="task-card-meta">
          <div class="task-card-assignee-wrapper" title="${assigneeName}">
            ${assigneeHtml}
          </div>
        </div>
      </div>
    </div>
  `;
}

function initKanbanBoard(tasks, salesReps) {
  // Initialize drag-and-drop for each column
  const columns = ['todo', 'in-progress', 'completed'];
  const statusMap = {
    'todo': 'pending',
    'in-progress': 'in_progress',
    'completed': 'completed'
  };

  columns.forEach(columnId => {
    const container = document.getElementById(`kanban-${columnId}`);
    if (!container) return;

    new Sortable(container, {
      group: 'kanban',
      animation: 120,
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      delayOnTouchOnly: true,
      touchStartThreshold: 4,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      onStart: function () {
        document.body.classList.add('is-dragging');
      },
      onAdd: function (evt) {
        // Remove empty state if present
        const emptyState = evt.to.querySelector('.kanban-empty-state');
        if (emptyState) {
          emptyState.remove();
        }
        updateColumnCounts();
      },
      onRemove: function (evt) {
        // Add empty state if column becomes empty
        if (evt.from.querySelectorAll('.kanban-task-card').length === 0) {
          let icon, text;
          if (evt.from.id === 'kanban-todo') { icon = '📝'; text = 'No tasks'; }
          else if (evt.from.id === 'kanban-in-progress') { icon = '⚙️'; text = 'No tasks'; }
          else { icon = '🎉'; text = 'No tasks'; }

          evt.from.innerHTML = `
            <div class="kanban-empty-state">
              <div class="kanban-empty-icon">${icon}</div>
              <div class="kanban-empty-text">${text}</div>
            </div>`;
        }
        updateColumnCounts();
      },
      onEnd: async function (evt) {
        document.body.classList.remove('is-dragging');
        const taskId = evt.item.dataset.taskId;
        const newStatus = statusMap[evt.to.id.replace('kanban-', '')];
        const oldStatus = evt.item.dataset.status;

        if (newStatus && newStatus !== oldStatus) {
          // Update task status in database
          const { error } = await supabaseClient
            .from('tasks')
            .update({ status: newStatus })
            .eq('id', taskId);

          if (error) {
            showToast('Error updating task status', 'error');
            // Revert will be tricky without reload, so we reload
            renderTasksView();
          } else {
            // Update local data immediate to prevent stale state issues
            if (window.allTasksData) {
              const taskIndex = window.allTasksData.findIndex(t => t.id === taskId);
              if (taskIndex !== -1) {
                window.allTasksData[taskIndex].status = newStatus;
              }
            }

            // Update DOM attributes
            evt.item.dataset.status = newStatus;
            showInlineSuccess(evt.item);

            // If the card has a status badge/text that needs updating, we can do it here
            // But currently the column implies status. 
            // We might want to update the "detail view" if it's open, but it shouldn't be open during drag.
          }
        }
      }
    });
  });

  // Column add buttons
  document.querySelectorAll('.kanban-add-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const status = btn.dataset.status;
      openTaskModal(null, salesReps, status);
    });
  });

  // Task card click to view details
  document.querySelectorAll('.kanban-task-card').forEach(card => {
    card.addEventListener('click', (e) => {
      // Don't trigger if clicking menu button, though we hid it for now as per design tweak
      if (e.target.closest('.task-card-menu')) return;
      const taskId = card.dataset.taskId;
      const task = tasks.find(t => t.id === taskId);
      if (task) {
        showTaskDetail(task, salesReps);
      }
    });
  });

  // Header Search functionality
  const searchInput = document.getElementById('task-search-input');
  if (searchInput) {
    // Restore saved search
    const persistedSearch = _loadPersistedState().tasks?.search || '';
    if (persistedSearch) {
      searchInput.value = persistedSearch;
      // Trigger initial filter
      setTimeout(() => searchInput.dispatchEvent(new Event('input')), 50);
    }

    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();
      saveViewState({ tasks: { search: query } });
      document.querySelectorAll('.kanban-task-card').forEach(card => {
        const title = card.querySelector('.task-card-title').textContent.toLowerCase();
        const description = card.querySelector('.task-card-description')?.textContent.toLowerCase() || '';
        const matches = title.includes(query) || description.includes(query);
        card.style.display = matches ? 'flex' : 'none';
      });
      // Update column counts after filtering
      updateColumnCounts();
    });
  }

  // Header Add Task button
  const addTaskBtn = document.getElementById('add-task-btn');
  if (addTaskBtn) {
    addTaskBtn.addEventListener('click', () => {
      openTaskModal(null, salesReps);
    });
  }

  // Header Filter button
  const filterBtn = document.getElementById('filter-tasks-btn');
  if (filterBtn) {
    filterBtn.addEventListener('click', () => {
      showToast('Task filtering is currently being enhanced!', 'info');
    });
  }
}

function updateColumnCounts() {
  const columns = {
    'pending': document.querySelectorAll('#kanban-todo .kanban-task-card').length,
    'in_progress': document.querySelectorAll('#kanban-in-progress .kanban-task-card').length,
    'completed': document.querySelectorAll('#kanban-completed .kanban-task-card').length
  };

  document.querySelector('[data-status="pending"] .kanban-column-count').textContent = `${columns.pending} Tasks`;
  document.querySelector('[data-status="in_progress"] .kanban-column-count').textContent = `${columns.in_progress} Tasks`;
  document.querySelector('[data-status="completed"] .kanban-column-count').textContent = `${columns.completed} Tasks`;
}

function showTaskDetail(task, salesReps) {
  const modal = document.getElementById('task-detail-modal');
  const content = document.getElementById('task-detail-content');

  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'completed';
  const assigneeName = task.assigned_to_profile
    ? `${task.assigned_to_profile.first_name} ${task.assigned_to_profile.last_name}`
    : 'Unassigned';

  // Permission Logic: STRICT
  // Manager can always edit.
  // Sales Rep can only edit/delete if they created the task.
  // If assigned to Sales Rep but created by Manager (or anyone else), Sales Rep CANNOT edit details or delete.
  const canEditDetails = isManager || task.created_by === currentUser.id;

  // Assigned By Info (Show if created by someone else)
  let assignedByHtml = '';
  if (task.created_by !== currentUser.id && task.created_by_profile) {
    assignedByHtml = `
      <div class="task-detail-meta-item">
        <div class="task-detail-meta-label">Assigned By</div>
        <div class="task-detail-meta-value">${task.created_by_profile.first_name} ${task.created_by_profile.last_name}</div>
      </div>`;
  }

  content.innerHTML = `
    <div class="task-detail-header">
      <div class="task-detail-title">${task.title}</div>
      <button class="task-detail-close" onclick="document.getElementById('task-detail-modal').classList.remove('active')">
        <i class="fas fa-times"></i>
      </button>
    </div>
    <div class="task-detail-body">
      <div class="task-detail-section">
        <div class="task-detail-section-title">Description</div>
        <div class="task-detail-description">${task.description || 'No description provided'}</div>
      </div>
      
      <div class="task-detail-section">
        <div class="task-detail-meta">
          <div class="task-detail-meta-item">
            <div class="task-detail-meta-label">Status</div>
            <div class="task-detail-meta-value">
              ${task.status === 'pending' ? '📋 To Do' : task.status === 'in_progress' ? '🔄 In Progress' : '✅ Done'}
            </div>
          </div>
          <div class="task-detail-meta-item">
            <div class="task-detail-meta-label">Priority</div>
            <div class="task-detail-meta-value">
              ${task.priority ? task.priority.charAt(0).toUpperCase() + task.priority.slice(1) : 'Not set'}
            </div>
          </div>
          <div class="task-detail-meta-item">
            <div class="task-detail-meta-label">Due Date</div>
            <div class="task-detail-meta-value ${isOverdue ? 'task-overdue' : ''}">
              ${task.due_date ? formatDate(task.due_date) : 'No due date'}
            </div>
          </div>
          <div class="task-detail-meta-item">
            <div class="task-detail-meta-label">Assigned To</div>
            <div class="task-detail-meta-value">${assigneeName}</div>
          </div>
          ${assignedByHtml}
        </div>
      </div>

      <div class="task-detail-section">
        ${canEditDetails ? `
        <button class="btn btn-secondary" onclick="editTask('${task.id}')">
          Edit Task
        </button>
        <button class="btn btn-secondary" onclick="deleteTask('${task.id}')" style="margin-left: 0.5rem;">
          Delete
        </button>
        ` : `
        <div class="alert alert-info">
            <i class="fas fa-lock"></i> Only the manager can edit or delete this task.
        </div>
        `}
      </div>
    </div>
  `;

  modal.classList.add('active');

  // Close on backdrop click
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.classList.remove('active');
    }
  };
}

// Global functions for task actions
window.editTask = function (taskId) {
  document.getElementById('task-detail-modal').classList.remove('active');
  // This will call the existing openTaskModal function
  const task = window.allTasksData?.find(t => t.id === taskId);
  if (task) {
    // Use globally stored sales reps
    openTaskModal(task, window.salesRepsData || []);
  }
};

window.deleteTask = async function (taskId) {
  const confirmed = await showConfirmDialog('Delete Task', 'Are you sure you want to delete this task?');
  if (!confirmed) return;

  const { error } = await supabaseClient
    .from('tasks')
    .delete()
    .eq('id', taskId);

  if (error) {
    showToast('Error deleting task', 'error');
  } else {
    showToast('Task deleted successfully', 'success');
    document.getElementById('task-detail-modal').classList.remove('active');
    renderTasksView();
  }
};

function renderTaskCard(task, isManager) {
  const isAssignedToMe = task.assigned_to === currentUser.id;
  const isCreatedByMe = task.created_by === currentUser.id;
  const isCreatedByManager = isManager && task.created_by !== currentUser.id;

  // Permissions:
  // - Managers can edit any task.
  // - Sales reps can only edit tasks they created themselves (not tasks assigned to them by a manager).
  const canEdit = isManager || isCreatedByMe;

  // Completion permission:
  // - Managers can mark any task complete.
  // - Sales reps can mark a task complete if it is assigned to them or if they created it.
  const canComplete = isManager || isAssignedToMe || isCreatedByMe;

  const dueDate = task.due_date ? new Date(task.due_date) : null;
  const isOverdue = dueDate && dueDate < new Date();
  const dueDateStr = dueDate ? formatDate(dueDate) : '';

  // Get assigned to name
  let assignedToName = 'Unassigned';
  if (task.assigned_to_profile) {
    assignedToName = `${task.assigned_to_profile.first_name} ${task.assigned_to_profile.last_name}`;
  } else if (task.assigned_to === currentUser.id) {
    assignedToName = 'Me';
  }

  // Get created by name
  let createdByName = 'Unknown';
  if (task.created_by_profile) {
    createdByName = `${task.created_by_profile.first_name} ${task.created_by_profile.last_name}`;
  } else if (task.created_by === currentUser.id) {
    createdByName = 'Me';
  }

  return `
    <div class="task-card" data-id="${task.id}" data-status="${task.status}" data-overdue="${isOverdue}">
      <div class="task-header">
        <div class="task-title">${task.title}</div>
        <div class="task-status ${task.status}">${getStatusLabel(task.status)}</div>
      </div>
      
      ${task.description ? `<div class="task-description">${task.description}</div>` : ''}
      
      <div class="task-meta">
        ${task.due_date ? `
          <div class="task-meta-item ${isOverdue ? 'task-overdue' : ''}">
            <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-calendar-icon lucide-calendar"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>
            <span>Due: ${dueDateStr}</span>
            ${isOverdue ? '<i class="fas fa-exclamation-triangle"></i>' : ''}
          </div>
        ` : ''}
        
        <div class="task-meta-item">
          <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-flag-icon lucide-flag"><path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/></svg>
          <span>Priority: ${task.priority || 'medium'}</span>
        </div>
        
        ${isManager || task.assigned_to ? `
          <div class="task-meta-item">
            <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-user-icon lucide-user"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            <span>Assigned to: ${assignedToName}</span>
          </div>
        ` : ''}
      </div>
      
      <div class="task-actions">
        <div class="task-priority ${task.priority || 'medium'}">${(task.priority || 'medium').charAt(0).toUpperCase() + (task.priority || 'medium').slice(1)}</div>
        <div class="task-action-buttons">
          ${canEdit ? `
            <button class="task-action-btn edit-task" data-id="${task.id}">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-square-pen-icon lucide-square-pen"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/></svg>
            </button>
          ` : ''}
          ${canComplete && task.status !== 'completed' ? `
            <button class="task-action-btn complete-task" data-id="${task.id}">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-icon lucide-check"><path d="M20 6 9 17l-5-5"/></svg>
            </button>
          ` : ''}
          ${isManager || isCreatedByMe ? `
            <button class="task-action-btn delete-task" data-id="${task.id}">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-icon lucide-trash"><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          ` : ''}
        </div>
      </div>
      
      ${!isManager && isCreatedByManager ? `
        <div class="task-creator">
          <i class="fas fa-info-circle"></i>
          <span>This task was assigned to you by a manager</span>
        </div>
      ` : ''}
    </div>
  `;
}

function getStatusLabel(status) {
  switch (status) {
    case 'pending': return 'Pending';
    case 'in_progress': return 'In Progress';
    case 'completed': return 'Completed';
    default: return status;
  }
}

function initTaskFilters(tasks) {
  const filterButtons = document.querySelectorAll('.task-filter');

  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      // Update active state
      filterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const filter = btn.dataset.filter;

      // Apply filter
      document.querySelectorAll('.task-card').forEach(card => {
        let show = true;

        if (filter === 'assigned') {
          // Only show tasks created by current user
          const taskId = card.dataset.id;
          const task = tasks.find(t => t.id === taskId);
          show = task && task.created_by === currentUser.id;
        } else if (filter === 'overdue') {
          const isOverdue = card.dataset.overdue === 'true';
          show = isOverdue;
        } else {
          const status = card.dataset.status;
          show = status === filter;
        }

        card.style.display = show ? 'block' : 'none';
      });
    });
  });
}

function initTaskActionButtons(tasks, salesReps) {
  // Edit task buttons
  document.querySelectorAll('.edit-task').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const taskId = btn.dataset.id;
      const task = tasks.find(t => t.id === taskId);
      if (task) {
        openTaskModal(task, salesReps);
      }
    });
  });

  // Complete task buttons
  document.querySelectorAll('.complete-task').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const taskId = btn.dataset.id;

      const { error } = await supabaseClient
        .from('tasks')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', taskId);

      if (error) {
        showToast('Error completing task: ' + error.message, 'error');
        return;
      }

      showToast('Task completed successfully', 'success');
      renderTasksView();
    });
  });

  // Delete task buttons
  document.querySelectorAll('.delete-task').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const taskId = btn.dataset.id;

      const confirmed = await showConfirmDialog(
        'Delete Task',
        'Are you sure you want to delete this task?'
      );

      if (!confirmed) return;

      const { error } = await supabaseClient
        .from('tasks')
        .delete()
        .eq('id', taskId);

      if (error) {
        showToast('Error deleting task: ' + error.message, 'error');
        return;
      }

      showToast('Task deleted successfully', 'success');
      renderTasksView();
    });
  });
}

function openTaskModal(task = null, salesReps = [], initialStatus = 'pending') {
  const modal = document.getElementById('task-modal');
  const modalTitle = document.getElementById('task-modal-title');
  const saveBtn = document.getElementById('save-task-btn');
  const assignField = document.getElementById('task-assign-field');
  const assignSelect = document.getElementById('task-assign-to');

  // Reset form
  document.getElementById('task-title').value = '';
  document.getElementById('task-description').value = '';
  document.getElementById('task-due-date').value = '';
  document.getElementById('task-priority').value = 'medium';
  document.getElementById('task-status').value = initialStatus;

  // Populate sales reps dropdown for managers
  if (isManager && salesReps.length > 0) {
    assignField.style.display = 'block';
    assignSelect.innerHTML = '<option value="">Select a sales rep</option>';

    // Add option for self
    assignSelect.innerHTML += `<option value="${currentUser.id}">Me</option>`;

    // Add options for sales reps
    salesReps.forEach(rep => {
      assignSelect.innerHTML += `<option value="${rep.id}">${rep.first_name} ${rep.last_name}</option>`;
    });
  } else {
    assignField.style.display = 'none';
  }

  // Set modal title
  if (task) {
    modalTitle.innerHTML = 'Edit Task';

    // Fill form with task data
    document.getElementById('task-title').value = task.title || '';
    document.getElementById('task-description').value = task.description || '';

    // Fix for time display issue
    if (task.due_date) {
      const dueDate = new Date(task.due_date);
      // Format as YYYY-MM-DDTHH:MM for datetime-local input
      const year = dueDate.getFullYear();
      const month = String(dueDate.getMonth() + 1).padStart(2, '0');
      const day = String(dueDate.getDate()).padStart(2, '0');
      const hours = String(dueDate.getHours()).padStart(2, '0');
      const minutes = String(dueDate.getMinutes()).padStart(2, '0');

      document.getElementById('task-due-date').value = `${year}-${month}-${day}T${hours}:${minutes}`;
    } else {
      document.getElementById('task-due-date').value = '';
    }

    document.getElementById('task-priority').value = task.priority || 'medium';
    document.getElementById('task-status').value = task.status || 'pending';

    if (isManager && task.assigned_to) {
      assignSelect.value = task.assigned_to;
    }
  } else {
    modalTitle.innerHTML = 'New Task';
  }

  // Show modal
  modal.style.display = 'flex';
  document.body.classList.add('modal-active');

  // Initialize event listeners
  initTaskModalListeners(task);
}

function initTaskModalListeners(task) {
  // Save task
  const saveBtn = document.getElementById('save-task-btn');

  saveBtn.onclick = async () => {
    const title = document.getElementById('task-title').value.trim();
    const description = document.getElementById('task-description').value.trim();
    const dueDate = document.getElementById('task-due-date').value;
    const priority = document.getElementById('task-priority').value;
    const status = document.getElementById('task-status').value;

    // Get assigned to
    let assignedTo = null;
    if (isManager) {
      assignedTo = document.getElementById('task-assign-to').value || null;
    } else {
      // Non-managers can only create tasks for themselves
      assignedTo = currentUser.id;
    }

    // Validate
    if (!title) {
      showToast('Please enter a task title', 'error');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

    try {
      const taskData = {
        title,
        description: description || null,
        assigned_to: assignedTo,
        created_by: currentUser.id,
        due_date: dueDate ? new Date(dueDate).toISOString() : null,
        priority,
        status,
        organization_id: currentOrganization?.id
      };

      let result;

      if (task) {
        // Update existing task
        result = await supabaseClient
          .from('tasks')
          .update(taskData)
          .eq('id', task.id);
      } else {
        // Create new task
        result = await supabaseClient
          .from('tasks')
          .insert([taskData]);
      }

      if (result.error) throw result.error;

      showToast(`Task ${task ? 'updated' : 'created'} successfully!`, 'success');
      closeModal('task-modal');
      renderTasksView();
    } catch (error) {
      showToast(`Error ${task ? 'updating' : 'creating'} task: ${error.message}`, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = 'Save Task';
    }
  };
}

// ======================
// REMINDERS VIEW
// ======================

async function renderRemindersView() {
  let reminders;
  let error;

  if (isManager) {
    const result = await supabaseClient
      .from('reminders')
      .select(`
        *,
        assigned_to_profile:profiles!reminders_assigned_to_fkey(first_name, last_name, email),
        created_by_profile:profiles!reminders_created_by_fkey(first_name, last_name, email)
      `)
      .eq('created_by', currentUser.id)
      .order('reminder_date', { ascending: true });

    reminders = result.data;
    error = result.error;
  } else {
    const result = await supabaseClient
      .from('reminders')
      .select(`
        *,
        assigned_to_profile:profiles!reminders_assigned_to_fkey(first_name, last_name, email),
        created_by_profile:profiles!reminders_created_by_fkey(first_name, last_name, email)
      `)
      .or(`assigned_to.eq.${currentUser.id},created_by.eq.${currentUser.id}`)
      .order('reminder_date', { ascending: true });

    reminders = result.data;
    error = result.error;
  }

  if (error) {
    viewContainer.innerHTML = renderError(error.message);
    return;
  }

  let salesReps = [];
  if (isManager) {
    let repsQ = supabaseClient.from('profiles').select('id, first_name, last_name, email').eq('role', 'sales_rep').order('first_name', { ascending: true });
    if (currentOrganization?.id) repsQ = repsQ.eq('organization_id', currentOrganization.id);
    const { data: reps } = await repsQ;
    salesReps = reps || [];
  }

  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endToday = new Date(startToday);
  endToday.setDate(endToday.getDate() + 1);

  const remindersSorted = [...(reminders || [])].sort((a, b) => {
    const aTs = a.reminder_date ? new Date(a.reminder_date).getTime() : Number.MAX_SAFE_INTEGER;
    const bTs = b.reminder_date ? new Date(b.reminder_date).getTime() : Number.MAX_SAFE_INTEGER;
    return aTs - bTs;
  });

  const totalReminders = remindersSorted.length;
  const pendingReminders = remindersSorted.filter(item => !item.is_completed).length;
  const completedReminders = remindersSorted.filter(item => item.is_completed).length;
  const todayReminders = remindersSorted.filter(item => !item.is_completed && item.reminder_date && new Date(item.reminder_date) >= startToday && new Date(item.reminder_date) < endToday).length;
  const overdueReminders = remindersSorted.filter(item => !item.is_completed && item.reminder_date && new Date(item.reminder_date) < now).length;
  const dueNow = remindersSorted.filter(item => !item.is_completed && item.reminder_date && new Date(item.reminder_date) <= now);

  const formatReminderDue = (isoDate) => {
    if (!isoDate) return 'No due date';
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return 'Invalid date';
    return date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const cardsMarkup = remindersSorted.map(reminder => {
    const dueDate = reminder.reminder_date ? new Date(reminder.reminder_date) : null;
    const dueTs = dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate.getTime() : 0;
    const isOverdue = !reminder.is_completed && dueTs > 0 && dueTs < now.getTime();
    const isToday = !reminder.is_completed && dueTs >= startToday.getTime() && dueTs < endToday.getTime();
    const isAssignedToMe = reminder.assigned_to === currentUser.id;
    const isCreatedByMe = reminder.created_by === currentUser.id;
    const canComplete = isAssignedToMe;
    const canEdit = (isManager && isCreatedByMe) || (!isManager && (isAssignedToMe || isCreatedByMe));
    const canDelete = (isManager && isCreatedByMe) || (!isManager && isCreatedByMe);

    const assignedToText = reminder.assigned_to_profile
      ? `${reminder.assigned_to_profile.first_name} ${reminder.assigned_to_profile.last_name}`
      : 'Unassigned';

    const assignedByText = reminder.created_by_profile
      ? `${reminder.created_by_profile.first_name} ${reminder.created_by_profile.last_name}`
      : 'Unknown';

    return `
      <article class="remx-card reminder-card ${reminder.is_completed ? 'is-completed' : ''} ${isOverdue ? 'is-overdue' : ''}"
               data-id="${reminder.id}"
               data-completed="${reminder.is_completed}"
               data-reminder-date="${reminder.reminder_date || ''}"
               data-due-ts="${dueTs}"
               data-created-by="${reminder.created_by || ''}">
        <div class="remx-card-head reminder-header">
          <h4 class="remx-title reminder-title">${reminder.title}</h4>
          <span class="remx-state reminder-status ${reminder.is_completed ? 'completed' : 'pending'}">
            ${reminder.is_completed ? 'Completed' : (isOverdue ? 'Overdue' : (isToday ? 'Today' : 'Pending'))}
          </span>
        </div>

        ${reminder.description ? `<p class="remx-desc reminder-description">${reminder.description}</p>` : ''}

        <div class="remx-meta reminder-meta">
          <span class="remx-chip reminder-meta-item"><i data-lucide="calendar"></i> ${formatReminderDue(reminder.reminder_date)}</span>
          ${isManager ? `<span class="remx-chip reminder-meta-item"><i data-lucide="user"></i> Assigned to: ${assignedToText}</span>` : `<span class="remx-chip reminder-meta-item"><i data-lucide="user"></i> Assigned by: ${assignedByText}</span>`}
        </div>

        <div class="remx-actions reminder-actions">
          <div class="remx-due reminder-date"><i data-lucide="bell"></i> ${formatDate(reminder.reminder_date, true)}</div>
          <div class="reminder-action-buttons">
            ${canEdit ? `
              <button class="reminder-action-btn edit-reminder" data-id="${reminder.id}" title="Edit reminder">
                <i data-lucide="square-pen"></i>
              </button>
            ` : ''}
            ${canComplete && !reminder.is_completed ? `
              <button class="reminder-action-btn complete-reminder" data-id="${reminder.id}" title="Mark completed">
                <i data-lucide="check"></i>
              </button>
            ` : ''}
            ${canDelete ? `
              <button class="reminder-action-btn delete-reminder" data-id="${reminder.id}" title="Delete reminder">
                <i data-lucide="trash-2"></i>
              </button>
            ` : ''}
          </div>
        </div>
      </article>
    `;
  }).join('');

  const dueNowMarkup = dueNow.slice(0, 6).map(reminder => {
    const dueText = formatReminderDue(reminder.reminder_date);
    const canComplete = reminder.assigned_to === currentUser.id;
    return `
      <div class="remx-focus-item">
        <div>
          <div class="remx-focus-title">${reminder.title}</div>
          <div class="remx-focus-time">${dueText}</div>
        </div>
        ${canComplete ? `<button class="reminder-action-btn complete-reminder" data-id="${reminder.id}" title="Complete"><i data-lucide="check"></i></button>` : ''}
      </div>
    `;
  }).join('');

  viewContainer.innerHTML = `
    <div class="remx-page">
      <div class="remx-header">
        <div>
        </div>
        <button class="btn btn-primary" id="add-reminder-btn"><i data-lucide="plus"></i> New Reminder</button>
      </div>

      <section class="remx-kpis reminder-stats">
        <div class="reminder-stat-card"><div class="reminder-stat-title">Total</div><div class="reminder-stat-value">${totalReminders}</div><div class="reminder-stat-meta">All reminders</div></div>
        <div class="reminder-stat-card"><div class="reminder-stat-title">Pending</div><div class="reminder-stat-value">${pendingReminders}</div><div class="reminder-stat-meta">Awaiting action</div></div>
        <div class="reminder-stat-card"><div class="reminder-stat-title">Due Today</div><div class="reminder-stat-value">${todayReminders}</div><div class="reminder-stat-meta">Must close today</div></div>
        <div class="reminder-stat-card"><div class="reminder-stat-title">Completed</div><div class="reminder-stat-value">${completedReminders}</div><div class="reminder-stat-meta">Finished items</div></div>
        <div class="reminder-stat-card ${overdueReminders > 0 ? 'reminder-stat-card-overdue' : ''}"><div class="reminder-stat-title">Overdue</div><div class="reminder-stat-value ${overdueReminders > 0 ? 'task-overdue' : ''}">${overdueReminders}</div><div class="reminder-stat-meta">Past due</div></div>
      </section>

      <div class="remx-layout">
        <aside class="remx-focus">
          <div class="remx-focus-card">
            <div class="remx-focus-head">
              <h3>Due Now</h3>
              <span>${dueNow.length}</span>
            </div>
            ${dueNow.length === 0 ? '<p class="remx-focus-empty">No reminders due right now. Great momentum.</p>' : `<div class="remx-focus-list">${dueNowMarkup}</div>`}
          </div>
        </aside>

        <section class="remx-main">
          <div class="remx-toolbar">
            <div class="reminder-filters">
              <button class="reminder-filter active" data-filter="all">All</button>
              <button class="reminder-filter" data-filter="pending">Pending</button>
              <button class="reminder-filter" data-filter="today">Today</button>
              <button class="reminder-filter" data-filter="overdue">Overdue</button>
              <button class="reminder-filter" data-filter="completed">Completed</button>
              ${isManager ? '<button class="reminder-filter" data-filter="assigned">Assigned by Me</button>' : ''}
            </div>
            <div class="search-input-wrapper" style="width: 100%; max-width: 320px;">
              <i data-lucide="search" class="search-icon"></i>
              <input type="text" id="reminder-search" class="search-input-padded" placeholder="Search reminders..." style="width: 100%; padding: 10px 14px 10px 36px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary); font-size: 0.875rem; transition: border-color 0.2s; outline: none;">
            </div>
          </div>

          <div id="remx-filter-empty" class="remx-filter-empty" style="display:none;">No reminders match the current filter/search.</div>

          <div id="reminders-container" class="remx-cards">
            ${totalReminders === 0 ? `
              <div class="empty-state reminder-empty-state">
                <h3 class="empty-state-title">No reminders yet</h3>
                <p class="empty-state-description">Create your first reminder with a due date to start tracking follow-ups.</p>
                <button class="btn btn-primary" onclick="openReminderModal()"><i data-lucide="plus"></i> Add Reminder</button>
              </div>
            ` : cardsMarkup}
          </div>
        </section>
      </div>
    </div>
  `;

  window.salesRepsData = salesReps;

  document.getElementById('add-reminder-btn')?.addEventListener('click', () => {
    openReminderModal(null, salesReps);
  });

  initReminderActionButtons(reminders, salesReps);
  initReminderFilters(reminders);

  if (window.lucide) lucide.createIcons();
}

function initReminderFilters(reminders) {
  const filterButtons = document.querySelectorAll('.reminder-filter');
  const searchInput = document.getElementById('reminder-search');
  const cards = document.querySelectorAll('.reminder-card');
  const emptyState = document.getElementById('remx-filter-empty');

  const applyFilters = () => {
    const activeFilter = document.querySelector('.reminder-filter.active')?.dataset.filter || 'all';
    const query = (searchInput?.value || '').trim().toLowerCase();
    const now = Date.now();
    const startToday = new Date();
    startToday.setHours(0, 0, 0, 0);
    const endToday = new Date(startToday);
    endToday.setDate(endToday.getDate() + 1);

    let visibleCount = 0;

    cards.forEach(card => {
      const completed = card.dataset.completed === 'true';
      const dueTs = Number(card.dataset.dueTs || 0);
      const createdBy = card.dataset.createdBy || '';
      const contentText = (card.textContent || '').toLowerCase();

      let show = true;

      if (activeFilter === 'assigned') {
        show = createdBy === currentUser.id;
      } else if (activeFilter === 'today') {
        show = !completed && dueTs >= startToday.getTime() && dueTs < endToday.getTime();
      } else if (activeFilter === 'overdue') {
        show = !completed && dueTs > 0 && dueTs < now;
      } else if (activeFilter === 'completed') {
        show = completed;
      } else if (activeFilter === 'pending') {
        show = !completed;
      }

      if (show && query) {
        show = contentText.includes(query);
      }

      card.style.display = show ? 'block' : 'none';
      if (show) visibleCount++;
    });

    if (emptyState) {
      emptyState.style.display = visibleCount === 0 ? 'block' : 'none';
    }
  };

  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      filterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyFilters();
    });
  });

  searchInput?.addEventListener('input', applyFilters);

  applyFilters();
}

function initReminderActionButtons(reminders, salesReps) {
  // Edit reminder buttons
  document.querySelectorAll('.edit-reminder').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const reminderId = btn.dataset.id;
      const reminder = reminders.find(r => r.id === reminderId);
      if (reminder) {
        openReminderModal(reminder, salesReps);
      }
    });
  });

  // Complete reminder buttons
  document.querySelectorAll('.complete-reminder').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const reminderId = btn.dataset.id;

      const { error } = await supabaseClient
        .from('reminders')
        .update({ is_completed: true, updated_at: new Date().toISOString() })
        .eq('id', reminderId);

      if (error) {
        showToast('Error completing reminder: ' + error.message, 'error');
        return;
      }

      showToast('Reminder completed successfully', 'success');
      renderRemindersView();
    });
  });

  // Delete reminder buttons
  document.querySelectorAll('.delete-reminder').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const reminderId = btn.dataset.id;

      const confirmed = await showConfirmDialog(
        'Delete Reminder',
        'Are you sure you want to delete this reminder?'
      );

      if (!confirmed) return;

      const { error } = await supabaseClient
        .from('reminders')
        .delete()
        .eq('id', reminderId);

      if (error) {
        showToast('Error deleting reminder: ' + error.message, 'error');
        return;
      }

      showToast('Reminder deleted successfully', 'success');
      renderRemindersView();
    });
  });
}

function openReminderModal(reminder = null, salesReps = []) {
  const modal = document.getElementById('reminder-modal');
  const modalTitle = document.getElementById('reminder-modal-title');
  const saveBtn = document.getElementById('save-reminder-btn');
  const assignField = document.getElementById('reminder-assign-field');
  const assignSelect = document.getElementById('reminder-assign-to');

  // Reset form
  document.getElementById('reminder-title').value = '';
  document.getElementById('reminder-description').value = '';
  document.getElementById('reminder-date').value = '';

  // Populate sales reps dropdown for managers
  if (isManager && salesReps.length > 0) {
    assignField.style.display = 'block';
    assignSelect.innerHTML = '<option value="">Select a sales rep</option>';

    // Add option for self
    assignSelect.innerHTML += `<option value="${currentUser.id}">Me</option>`;

    // Add options for sales reps
    salesReps.forEach(rep => {
      assignSelect.innerHTML += `<option value="${rep.id}">${rep.first_name} ${rep.last_name}</option>`;
    });
  } else {
    assignField.style.display = 'none';
  }

  // Set modal title
  if (reminder) {
    modalTitle.innerHTML = 'Edit Reminder';

    // Fill form with reminder data
    document.getElementById('reminder-title').value = reminder.title || '';
    document.getElementById('reminder-description').value = reminder.description || '';

    // Fix for time display issue
    if (reminder.reminder_date) {
      const reminderDate = new Date(reminder.reminder_date);
      // Format as YYYY-MM-DDTHH:MM for datetime-local input
      const year = reminderDate.getFullYear();
      const month = String(reminderDate.getMonth() + 1).padStart(2, '0');
      const day = String(reminderDate.getDate()).padStart(2, '0');
      const hours = String(reminderDate.getHours()).padStart(2, '0');
      const minutes = String(reminderDate.getMinutes()).padStart(2, '0');

      document.getElementById('reminder-date').value = `${year}-${month}-${day}T${hours}:${minutes}`;
    } else {
      document.getElementById('reminder-date').value = '';
    }

    if (isManager && reminder.assigned_to) {
      assignSelect.value = reminder.assigned_to;
    }
  } else {
    modalTitle.innerHTML = 'New Reminder';
  }

  // Show modal
  modal.style.display = 'flex';
  document.body.classList.add('modal-active');

  // Initialize event listeners
  initReminderModalListeners(reminder);
}

function initReminderModalListeners(reminder) {
  // Save reminder
  const saveBtn = document.getElementById('save-reminder-btn');

  saveBtn.onclick = async () => {
    const title = document.getElementById('reminder-title').value.trim();
    const description = document.getElementById('reminder-description').value.trim();
    const reminderDate = document.getElementById('reminder-date').value;

    // Get assigned to
    let assignedTo = null;
    if (isManager) {
      assignedTo = document.getElementById('reminder-assign-to').value || null;
    } else {
      // Non-managers can only create reminders for themselves
      assignedTo = currentUser.id;
    }

    // Validate
    if (!title || !reminderDate) {
      showToast('Please enter a title and reminder date', 'error');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

    try {
      const reminderData = {
        title,
        description: description || null,
        assigned_to: assignedTo,
        created_by: currentUser.id,
        reminder_date: new Date(reminderDate).toISOString(),
        is_completed: false,
        organization_id: currentOrganization?.id
      };

      let result;

      if (reminder) {
        // Update existing reminder
        result = await supabaseClient
          .from('reminders')
          .update(reminderData)
          .eq('id', reminder.id);
      } else {
        // Create new reminder
        result = await supabaseClient
          .from('reminders')
          .insert([reminderData]);
      }

      if (result.error) throw result.error;

      showToast(`Reminder ${reminder ? 'updated' : 'created'} successfully!`, 'success');
      closeModal('reminder-modal');
      renderRemindersView();
    } catch (error) {
      showToast(`Error ${reminder ? 'updating' : 'creating'} reminder: ${error.message}`, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = 'Save Reminder';
    }
  };
}

// ======================
// EXPORT FUNCTIONALITY
// ======================

// openExportModal removed (export modal markup was deleted)

const COMPANY_IMPORT_TYPES = ['Competitor', 'Customer', 'Distributor', 'Investor', 'Partner', 'Reseller', 'Supplier', 'Vendor', 'Other'];

window.openCompaniesImportExportModal = function () {
  if (isSalesRep) {
    showToast('Sales representatives are not permitted to import or export companies', 'error');
    return;
  }
  let modal = document.getElementById('companies-transfer-modal');

  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'companies-transfer-modal';
    modal.className = 'modal';
    modal.style.display = 'none';
    modal.innerHTML = `
      <div class="modal-backdrop" onclick="closeModal('companies-transfer-modal')"></div>
      <div class="modal-container companies-transfer-modal-container modal-size-transfer">
        <div class="modal-header">
          <h3><i data-lucide="file-up"></i> Companies Import / Export</h3>
          <button class="modal-close" onclick="closeModal('companies-transfer-modal')">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
              class="lucide lucide-x-icon lucide-x">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div class="modal-body">
          <div class="form-section">
            <div class="form-section-header" style="margin-bottom: 0; border-bottom: none; padding-bottom: 0;">
              <div class="form-section-icon"><i data-lucide="shuffle"></i></div>
              <div>
                <div class="form-section-title">Choose Action</div>
                <div class="form-section-description">Import companies from CSV or export all companies to CSV</div>
              </div>
            </div>
            <div class="companies-transfer-switch" style="margin-top: 1rem;">
              <button type="button" class="date-range-btn active" id="companies-mode-import">Import CSV</button>
              <button type="button" class="date-range-btn" id="companies-mode-export">Export CSV</button>
            </div>
          </div>

          <div class="form-section" id="companies-import-panel">
            <div class="form-section-header">
              <div class="form-section-icon"><i data-lucide="file-input"></i></div>
              <div>
                <div class="form-section-title">CSV Format Requirements</div>
                <div class="form-section-description">Use the required columns and correct data types</div>
              </div>
            </div>

            <div class="field-helper" style="margin-top: 0;">
              <span><strong>Required columns:</strong> name, company_type, address, latitude, longitude</span>
            </div>
            <div class="field-helper" style="margin-top: 0.5rem;">
              <span><strong>Optional columns:</strong> description, radius, categories</span>
            </div>
            <div class="field-helper" style="margin-top: 0.5rem;">
              <span><strong>Categories format:</strong> separate multiple values with <code>|</code> (example: Retail|Supermarket)</span>
            </div>
            <div class="field-helper mt-sm">
              <span><strong>Supported company types:</strong> ${COMPANY_IMPORT_TYPES.join(', ')}</span>
            </div>

            <div class="btn-group-inline mt-md">
              <button type="button" class="btn btn-secondary" id="download-companies-sample-btn">
                <i data-lucide="download"></i> Download Sample CSV
              </button>
            </div>

            <div class="form-field mt-md">
              <label for="companies-import-file">Upload CSV File</label>
              <input type="file" id="companies-import-file" accept=".csv,text/csv">
              <div class="field-helper">
                <span>Maximum recommended size: 5MB. Larger files may take longer to process.</span>
              </div>
            </div>

            <div id="companies-import-feedback" class="field-helper" style="display:none;"></div>
            <div id="companies-import-errors" style="display:none;"></div>

            <div class="btn-group-end mt-md">
              <button type="button" class="btn btn-primary" id="run-companies-import-btn">
                <i data-lucide="upload"></i> Import Companies
              </button>
            </div>
          </div>

          <div class="form-section" id="companies-export-panel" style="display:none;">
            <div class="form-section-header">
              <div class="form-section-icon"><i data-lucide="file-output"></i></div>
              <div>
                <div class="form-section-title">Export All Companies</div>
                <div class="form-section-description">Download all company data as CSV, including categories</div>
              </div>
            </div>
            <div class="field-helper">
              <span>This export includes: name, type, description, address, latitude, longitude, radius, categories.</span>
            </div>

            <div class="btn-group-end mt-md">
              <button type="button" class="btn btn-primary" id="run-companies-export-btn">
                <i data-lucide="download"></i> Export Companies CSV
              </button>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="closeModal('companies-transfer-modal')">Close</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const importBtn = document.getElementById('companies-mode-import');
    const exportBtn = document.getElementById('companies-mode-export');
    const importPanel = document.getElementById('companies-import-panel');
    const exportPanel = document.getElementById('companies-export-panel');

    importBtn?.addEventListener('click', () => {
      importBtn.classList.add('active');
      exportBtn?.classList.remove('active');
      if (importPanel) importPanel.style.display = 'block';
      if (exportPanel) exportPanel.style.display = 'none';
    });

    exportBtn?.addEventListener('click', () => {
      exportBtn.classList.add('active');
      importBtn?.classList.remove('active');
      if (importPanel) importPanel.style.display = 'none';
      if (exportPanel) exportPanel.style.display = 'block';
    });

    document.getElementById('download-companies-sample-btn')?.addEventListener('click', downloadCompaniesSampleCsv);
    document.getElementById('run-companies-export-btn')?.addEventListener('click', exportAllCompaniesToCsv);
    document.getElementById('run-companies-import-btn')?.addEventListener('click', runCompaniesImportFromCsv);

    document.getElementById('companies-import-file')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      const feedback = document.getElementById('companies-import-feedback');
      if (!feedback) return;

      if (!file) {
        feedback.style.display = 'none';
        return;
      }

      feedback.style.display = 'flex';
      feedback.style.color = 'var(--text-muted)';
      feedback.innerHTML = `<span>Selected file: <strong>${file.name}</strong> (${Math.ceil(file.size / 1024)} KB)</span>`;
    });
  }

  modal.style.display = 'flex';
  if (window.lucide) lucide.createIcons();
};

function escapeCsvValue(value) {
  if (value === null || value === undefined) return '';
  const stringValue = String(value);
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function downloadCsvFile(filename, rows) {
  const csvText = rows.map(row => row.map(escapeCsvValue).join(',')).join('\n');
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function downloadCompaniesSampleCsv() {
  const sampleRows = [
    ['name', 'company_type', 'address', 'description', 'latitude', 'longitude', 'radius', 'categories'],
    ['Acme Corporation', 'Customer', '123 Main Street, Nairobi, Kenya', 'Retail partner account', '-1.286389', '36.817223', '200', 'Retail|Supermarket'],
    ['Northwind Supplies', 'Supplier', '45 Industrial Road, Mombasa, Kenya', 'Primary distributor for region', '-4.043477', '39.668206', '250', 'Distribution|Logistics']
  ];

  downloadCsvFile('companies_import_sample.csv', sampleRows);
  showToast('Sample CSV downloaded', 'success');
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        index++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(value.trim());
      value = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index++;
      row.push(value.trim());
      if (row.some(cell => cell !== '')) {
        rows.push(row);
      }
      row = [];
      value = '';
      continue;
    }

    value += char;
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value.trim());
    if (row.some(cell => cell !== '')) {
      rows.push(row);
    }
  }

  return rows;
}

function normalizeCompanyCsvHeader(header) {
  const normalized = (header || '').toLowerCase().trim().replace(/\s+/g, '_');
  const map = {
    company_name: 'name',
    type: 'company_type',
    location: 'address',
    location_address: 'address',
    lat: 'latitude',
    lng: 'longitude',
    long: 'longitude'
  };
  return map[normalized] || normalized;
}

function parseCompanyType(value) {
  if (!value) return null;
  const match = COMPANY_IMPORT_TYPES.find(type => type.toLowerCase() === value.toLowerCase().trim());
  return match || null;
}

function parseCategoriesCell(value) {
  if (!value) return [];
  return value
    .split(/\||;/)
    .map(item => item.trim())
    .filter(Boolean)
    .filter((item, idx, arr) => arr.findIndex(v => v.toLowerCase() === item.toLowerCase()) === idx);
}

async function exportAllCompaniesToCsv() {
  const exportBtn = document.getElementById('run-companies-export-btn');
  if (exportBtn) {
    exportBtn.disabled = true;
    exportBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Exporting...';
  }

  try {
    const { data: companies, error } = await supabaseClient
      .from('companies')
      .select(`
        name,
        company_type,
        description,
        address,
        latitude,
        longitude,
        radius,
        company_categories(
          categories(name)
        )
      `)
      .order('name', { ascending: true });

    if (error) throw error;

    const rows = [
      ['name', 'company_type', 'description', 'address', 'latitude', 'longitude', 'radius', 'categories']
    ];

    (companies || []).forEach(company => {
      const categories = (company.company_categories || []).map(item => item.categories?.name).filter(Boolean).join('|');
      rows.push([
        company.name || '',
        company.company_type || '',
        company.description || '',
        company.address || '',
        company.latitude ?? '',
        company.longitude ?? '',
        company.radius ?? '',
        categories
      ]);
    });

    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsvFile(`companies_export_${stamp}.csv`, rows);
    showToast(`Exported ${companies?.length || 0} companies`, 'success');
  } catch (error) {
    showToast('Export failed: ' + error.message, 'error');
  } finally {
    if (exportBtn) {
      exportBtn.disabled = false;
      exportBtn.innerHTML = '<i data-lucide="download"></i> Export Companies CSV';
      if (window.lucide) lucide.createIcons();
    }
  }
}

async function runCompaniesImportFromCsv() {
  const fileInput = document.getElementById('companies-import-file');
  const importBtn = document.getElementById('run-companies-import-btn');
  const feedback = document.getElementById('companies-import-feedback');
  const errorListContainer = document.getElementById('companies-import-errors');
  const file = fileInput?.files?.[0];

  if (!file) {
    showToast('Please choose a CSV file to import', 'error');
    return;
  }

  if (importBtn) {
    importBtn.disabled = true;
    importBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importing...';
  }

  try {
    if (errorListContainer) {
      errorListContainer.style.display = 'none';
      errorListContainer.innerHTML = '';
    }

    const csvText = await file.text();
    const rows = parseCsv(csvText);

    if (rows.length < 2) {
      throw new Error('CSV is empty or missing data rows');
    }

    const rawHeaders = rows[0].map(normalizeCompanyCsvHeader);
    const requiredHeaders = ['name', 'company_type', 'address', 'latitude', 'longitude'];
    const missingHeaders = requiredHeaders.filter(header => !rawHeaders.includes(header));

    if (missingHeaders.length > 0) {
      throw new Error(`Missing required columns: ${missingHeaders.join(', ')}`);
    }

    const hasCategoriesColumn = rawHeaders.includes('categories');

    const { data: existingCompanies, error: existingError } = await supabaseClient
      .from('companies')
      .select('id, name, address');

    if (existingError) throw existingError;

    const existingMap = new Map((existingCompanies || []).map(company => [
      `${(company.name || '').trim().toLowerCase()}::${(company.address || '').trim().toLowerCase()}`,
      company.id
    ]));

    const { data: categoryData, error: categoryReadError } = await supabaseClient
      .from('categories')
      .select('id, name');

    if (categoryReadError) throw categoryReadError;

    const categoryCache = new Map((categoryData || []).map(cat => [cat.name.toLowerCase(), cat.id]));

    const errors = [];
    let created = 0;
    let updated = 0;

    for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      const rowData = {};

      rawHeaders.forEach((header, idx) => {
        rowData[header] = (row[idx] || '').trim();
      });

      const displayRow = rowIndex + 1;
      const companyType = parseCompanyType(rowData.company_type);
      const latitude = Number(rowData.latitude);
      const longitude = Number(rowData.longitude);
      const radius = rowData.radius ? Number(rowData.radius) : 200;

      if (!rowData.name) {
        errors.push({ row: displayRow, reason: 'name is required' });
        continue;
      }
      if (!companyType) {
        errors.push({ row: displayRow, reason: 'invalid company_type' });
        continue;
      }
      if (!rowData.address) {
        errors.push({ row: displayRow, reason: 'address is required' });
        continue;
      }
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        errors.push({ row: displayRow, reason: 'latitude/longitude must be valid numbers' });
        continue;
      }
      if (!Number.isFinite(radius)) {
        errors.push({ row: displayRow, reason: 'radius must be a valid number' });
        continue;
      }

      const companyPayload = {
        name: rowData.name,
        company_type: companyType,
        description: rowData.description || null,
        address: rowData.address,
        latitude,
        longitude,
        radius: Math.min(Math.max(Math.round(radius), 50), 1000)
      };

      const dedupeKey = `${rowData.name.toLowerCase()}::${rowData.address.toLowerCase()}`;
      let companyId = existingMap.get(dedupeKey);

      try {
        if (companyId) {
          const { error: updateError } = await supabaseClient
            .from('companies')
            .update(companyPayload)
            .eq('id', companyId);

          if (updateError) throw updateError;
          updated++;
        } else {
          const { data: inserted, error: insertError } = await supabaseClient
            .from('companies')
            .insert([{ ...companyPayload, created_by: currentUser.id, organization_id: currentOrganization?.id }])
            .select('id')
            .single();

          if (insertError) throw insertError;
          companyId = inserted.id;
          existingMap.set(dedupeKey, companyId);
          created++;
        }

        if (hasCategoriesColumn) {
          const categories = parseCategoriesCell(rowData.categories || '');

          await supabaseClient
            .from('company_categories')
            .delete()
            .eq('company_id', companyId);

          if (categories.length > 0) {
            const links = [];

            for (const categoryName of categories) {
              let categoryId = categoryCache.get(categoryName.toLowerCase());

              if (!categoryId) {
                const { data: newCategory, error: createCategoryError } = await supabaseClient
                  .from('categories')
                  .insert([{ name: categoryName }])
                  .select('id, name')
                  .single();

                if (createCategoryError) throw createCategoryError;
                categoryId = newCategory.id;
                categoryCache.set((newCategory.name || categoryName).toLowerCase(), categoryId);
              }

              links.push({ company_id: companyId, category_id: categoryId });
            }

            if (links.length > 0) {
              const { error: linkError } = await supabaseClient
                .from('company_categories')
                .insert(links);

              if (linkError) throw linkError;
            }
          }
        }
      } catch (error) {
        errors.push({ row: displayRow, reason: error.message });
      }
    }

    const processed = rows.length - 1;
    const failed = errors.length;

    if (feedback) {
      feedback.style.display = 'flex';
      feedback.style.color = failed > 0 ? 'var(--color-warning)' : 'var(--color-success)';
      feedback.innerHTML = `<span>Processed ${processed} rows • Created: ${created} • Updated: ${updated} • Failed: ${failed}</span>`;
    }

    if (errorListContainer && failed > 0) {
      const errorItemsHtml = errors
        .map(item => `<li><strong>Row ${item.row}:</strong> ${item.reason}</li>`)
        .join('');

      errorListContainer.style.display = 'block';
      errorListContainer.innerHTML = `
        <div class="companies-import-errors-card">
          <div class="companies-import-errors-title">Rows with issues</div>
          <ul class="companies-import-errors-list">${errorItemsHtml}</ul>
        </div>
      `;
    }

    if (failed > 0) {
      showToast(`Import finished with ${failed} issue(s). Check browser console for row details.`, 'error');
    } else {
      showToast(`Import successful. Created ${created}, updated ${updated}.`, 'success');
    }

    await renderCompaniesView();
  } catch (error) {
    showToast('Import failed: ' + error.message, 'error');
    if (feedback) {
      feedback.style.display = 'flex';
      feedback.style.color = 'var(--color-danger)';
      feedback.innerHTML = `<span>${error.message}</span>`;
    }
  } finally {
    if (importBtn) {
      importBtn.disabled = false;
      importBtn.innerHTML = '<i data-lucide="upload"></i> Import Companies';
      if (window.lucide) lucide.createIcons();
    }
  }
}

window.closeModal = function (modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = 'none';
  }
  // For dynamically created modals
  if (!modal) {
    document.querySelectorAll('.modal').forEach(m => {
      if (m.id === modalId) m.remove();
    });
  }

  // Remove active class if no other modals are visible
  const visibleModals = Array.from(document.querySelectorAll('.modal')).filter(m => m.style.display !== 'none');
  if (visibleModals.length === 0) {
    document.body.classList.remove('modal-active');
  }
};

// setDateRange removed (export modal removed)

// executeExport removed (export modal removed)

// Export-to-PDF/Excel/CSV helpers removed along with export modal

// ======================
// UTILITY FUNCTIONS
// ======================


function showInlineSuccess(elementOrSelector) {
  const element = typeof elementOrSelector === 'string'
    ? document.querySelector(elementOrSelector)
    : elementOrSelector;
  if (!element) return;

  element.classList.remove('ui-success-flash');
  void element.offsetWidth;
  element.classList.add('ui-success-flash');
  setTimeout(() => element.classList.remove('ui-success-flash'), 850);
}

function showToast(message, type = 'info', options = {}) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const normalizedMessage = String(message || '').trim();
  if (!normalizedMessage) return;

  const now = Date.now();
  const toastKey = `${type}:${normalizedMessage.toLowerCase()}`;
  const dedupeMs = Number.isFinite(options.dedupeMs)
    ? options.dedupeMs
    : (type === 'success' ? 1800 : 1200);

  if ((type === 'success' || type === 'info') &&
    lastToastMeta.key === toastKey &&
    now - lastToastMeta.at < dedupeMs) {
    return;
  }

  const maxVisible = Number.isFinite(options.maxVisible)
    ? options.maxVisible
    : 2;
  if ((type === 'success' || type === 'info') && container.children.length >= maxVisible) {
    const removableToast = container.querySelector('.toast:not(.error)') || container.firstElementChild;
    if (removableToast) removableToast.remove();
  }

  lastToastMeta.key = toastKey;
  lastToastMeta.at = now;

  const toast = document.createElement('div');
  const isSubtle = options.subtle === true || type === 'success';
  toast.className = `toast ${type}${isSubtle ? ' subtle' : ''}`;

  const iconMap = {
    success: 'fa-check-circle',
    error: 'fa-times-circle',
    info: 'fa-info-circle'
  };

  toast.innerHTML = `
    <i class="fas ${iconMap[type] || iconMap.info} toast-icon"></i>
    <span class="toast-message">${normalizedMessage}</span>
  `;

  container.appendChild(toast);

  const timeoutMs = Number.isFinite(options.duration)
    ? options.duration
    : (type === 'success' ? 1800 : type === 'info' ? 2300 : 3200);
  toast.style.setProperty('--toast-timeout', `${Math.max(900, timeoutMs)}ms`);

  setTimeout(() => {
    toast.remove();
  }, Math.max(900, timeoutMs) + 120);
}

// Try to repair broken image links from Supabase storage by requesting a signed URL
async function handleImageError(img) {
  try {
    // Prevent retry loops
    if (img.dataset._tried) return;
    img.dataset._tried = '1';

    const src = img.src || '';
    const bucketMarker = '/safitrack/';
    const idx = src.indexOf(bucketMarker);
    if (idx === -1) {
      img.onerror = null;
      img.src = '../assets/illustrations/image-missing.png';
      return;
    }

    const storagePath = decodeURIComponent(src.substring(idx + bucketMarker.length));

    const { data, error } = await supabaseClient.storage.from('safitrack').createSignedUrl(storagePath, 60);
    if (!error && data && data.signedUrl) {
      img.onerror = null;
      img.src = data.signedUrl;
      return;
    }

    img.onerror = null;
    img.src = '../assets/illustrations/image-missing.png';
  } catch (err) {
    console.error('handleImageError failed', err);
    img.onerror = null;
    img.src = '../assets/illustrations/image-missing.png';
  }
}

function triggerConfetti() {
  if (typeof confetti === 'function') {
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']
    });
  }
}

function getInitials(name) {
  return name
    .split(' ')
    .map(n => n.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function formatDate(dateString, shortFormat = false) {
  if (!dateString) return '';

  // Safe local date parsing for YYYY-MM-DD format
  let date;
  if (typeof dateString === 'string' && dateString.length === 10 && dateString.includes('-')) {
    const [y, m, d] = dateString.split('-').map(Number);
    date = new Date(y, m - 1, d, 12, 0, 0); // Midday local
  } else {
    date = new Date(dateString);
  }

  const pref = (typeof getUserDateFormat === 'function') ? getUserDateFormat() : (localStorage.getItem('safitrack_date_format') || 'DD/MM/YYYY');

  if (shortFormat) {
    if (pref === 'MM/DD/YYYY') {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    return date.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
  }

  // Long format with time
  const timePart = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (pref === 'MM/DD/YYYY') {
    const d = String(date.getMonth() + 1).padStart(2, '0');
    const m = String(date.getDate()).padStart(2, '0');
    const y = date.getFullYear();
    return `${d}/${m}/${y} ${timePart}`;
  }
  // default DD/MM/YYYY
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy} ${timePart}`;
}

/**
 * Geocode an address using OpenStreetMap (Nominatim) API
 * @param {string} address - The address to search for
 * @returns {Promise<Object>} - Object containing latitude, longitude, and display name
 */
async function geocodeAddressWithOSM(address) {
  try {
    // URL encode the address to handle spaces and special characters
    const encodedAddress = encodeURIComponent(address);

    // Nominatim Search Endpoint
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodedAddress}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'SafiTrack-CRM/1.0' // User-Agent is recommended to avoid blocking
      }
    });

    if (!response.ok) {
      // Handle rate limits (HTTP 429)
      if (response.status === 429) {
        throw new Error('Too many requests. Please wait a moment.');
      }
      throw new Error('Geocoding service unavailable. Please enter coordinates manually.');
    }

    const data = await response.json();

    // Check if we got results back
    if (!data || !Array.isArray(data) || data.length === 0) {
      throw new Error('Address not found. Please try a more specific address or enter coordinates manually.');
    }

    // Extract the first (most relevant) result
    const result = data[0];

    return {
      latitude: parseFloat(result.lat),
      longitude: parseFloat(result.lon),
      displayName: result.display_name || address
    };

  } catch (error) {
    console.error('Geocoding error:', error);
    throw new Error(error.message || 'Geocoding failed. Please enter coordinates manually.');
  }
}




// Replace the existing calculateDistance function with this improved version
function calculateDistance(lat1, lon1, lat2, lon2) {
  // Validate input parameters
  if (isNaN(lat1) || isNaN(lon1) || isNaN(lat2) || isNaN(lon2)) {
    console.error('Invalid coordinates for distance calculation', { lat1, lon1, lat2, lon2 });
    return NaN;
  }

  const R = 6371e3; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function buildOverpassQuery(lat, lon, radiusMeters, types = ['shop', 'office']) {
  const categoryMap = {
    'shop': ['shop'],
    'office': ['office'],
    'industrial': ['industrial', 'man_made=works', 'craft'],
    'medical': ['amenity=hospital', 'amenity=doctors', 'amenity=clinic', 'amenity=pharmacy', 'amenity=dentist'],
    'food': ['amenity=restaurant', 'amenity=cafe', 'amenity=fast_food', 'amenity=pub', 'amenity=bar'],
    'education': ['amenity=school', 'amenity=university', 'amenity=college', 'amenity=kindergarten'],
    'both': ['shop', 'office', 'industrial', 'amenity']
  };

  const tagClauses = [];
  const typeKey = Array.isArray(types) ? types[0] : (types || 'both');
  const mapped = categoryMap[typeKey] || categoryMap['both'];

  mapped.forEach(tag => {
    if (tag.includes('=')) {
      const [k, v] = tag.split('=');
      tagClauses.push(`node["${k}"="${v}"]["name"](around:${radiusMeters},${lat},${lon});`);
      tagClauses.push(`way["${k}"="${v}"]["name"](around:${radiusMeters},${lat},${lon});`);
    } else {
      tagClauses.push(`node["${tag}"]["name"](around:${radiusMeters},${lat},${lon});`);
      tagClauses.push(`way["${tag}"]["name"](around:${radiusMeters},${lat},${lon});`);
    }
  });

  return `[out:json][timeout:30];
(
  ${tagClauses.join('\n  ')}
);
out center;`;
}

/**
 * Query Overpass API for nearby POIs and return parsed results
 * @param {number} lat
 * @param {number} lon
 * @param {number} radiusMeters
 * @returns {Promise<Array>} array of { id, name, lat, lon, tags, distance, displayName }
 */
async function searchNearbyOverpass(lat, lon, radiusMeters = 2000, types = ['shop', 'office']) {
  const query = buildOverpassQuery(lat, lon, radiusMeters, types);
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter'
  ];

  let lastError = null;
  let data = null;

  for (const url of endpoints) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=UTF-8',
          'User-Agent': 'SafiTrack-CRM/1.0'
        },
        body: query
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        lastError = new Error(`Overpass endpoint ${url} responded ${resp.status}: ${text}`);
        console.warn('Overpass non-ok response', { url, status: resp.status, body: text });
        // try the next endpoint
        continue;
      }

      data = await resp.json();
      break;
    } catch (err) {
      lastError = err;
      console.warn('Overpass fetch failed for', url, err);
      // try next endpoint
    }
  }

  if (!data || !Array.isArray(data.elements)) {
    throw lastError || new Error('Overpass API error');
  }

  const results = data.elements.map(el => {
    const tags = el.tags || {};
    const name = tags.name || null;
    let rLat = el.lat, rLon = el.lon;
    if ((!rLat || !rLon) && el.center) {
      rLat = el.center.lat;
      rLon = el.center.lon;
    }

    const distance = (typeof rLat === 'number' && typeof rLon === 'number') ? calculateDistance(lat, lon, rLat, rLon) : NaN;

    return {
      id: el.id,
      type: el.type,
      name,
      lat: rLat,
      lon: rLon,
      tags,
      distance,
      displayName: tags['addr:full'] || tags['addr:street'] || tags['addr:housenumber'] || tags['addr:city'] || name || ''
    };
  }).filter(r => r.name);

  // Sort by distance ascending
  results.sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity));
  return results;
}

/**
 * Render nearby suggestions into the company modal
 * Creates or updates a container with id 'nearby-suggestions'
 */
function renderNearbySuggestions(items = [], targetModalId = 'company-modal') {
  const modal = document.getElementById(targetModalId);
  if (!modal) return;
  const body = modal.querySelector('.modal-body');
  if (!body) return;

  // Container id scoped per modal
  let container = document.getElementById(targetModalId + '-nearby-suggestions');
  if (!container) {
    container = document.createElement('div');
    container.id = targetModalId + '-nearby-suggestions';
    container.className = 'form-section';
    container.style.marginTop = '12px';
    body.appendChild(container);
  }

  if (!items || items.length === 0) {
    container.innerHTML = `
      <div class="form-section-header">
        <div class="form-section-icon"><i data-lucide="search"></i></div>
        <div><div class="form-section-title">Nearby Suggestions</div><div class="form-section-description">No suggestions found</div></div>
      </div>`;
    if (window.lucide) lucide.createIcons();
    return;
  }

  const listHtml = items.map(it => `
    <div class="nearby-item" style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(it.name)}</div>
        <div style="font-size:12px;color:var(--text-muted);">${it.displayName || ''} • ${(isNaN(it.distance) ? '-' : Math.round(it.distance))} m</div>
      </div>
      <div style="margin-left:12px;display:flex;gap:8px;align-items:center;">
        <button class="btn btn-sm btn-ghost" data-nearby-action="view" data-id="${it.id}" data-type="${it.type}">View</button>
        <button class="btn btn-sm btn-primary" data-nearby-action="add" data-lat="${it.lat}" data-lon="${it.lon}" data-name="${escapeHtml(it.name)}">Add to CRM</button>
      </div>
    </div>
  `).join('');

  container.innerHTML = `
    <div class="form-section-header">
      <div class="form-section-icon"><i data-lucide="search"></i></div>
      <div><div class="form-section-title">Nearby Suggestions</div><div class="form-section-description">Potential companies within chosen radius</div></div>
    </div>
    <div class="form-field" style="padding-top:8px;">${listHtml}</div>
  `;

  // Wire buttons
  container.querySelectorAll('[data-nearby-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const action = btn.dataset.nearbyAction;
      if (action === 'view') {
        // Open element in OpenStreetMap (new tab) using type/node/way/relation
        const elId = btn.dataset.id;
        const elType = (btn.dataset.type || 'node');
        const typePath = (elType === 'way' || elType === 'relation' || elType === 'node') ? elType : 'node';
        if (elId) {
          const osmUrl = `https://www.openstreetmap.org/${typePath}/${elId}`;
          window.open(osmUrl, '_blank');
        } else {
          showToast('Unable to open place in OpenStreetMap', 'error');
        }
        return;
      }

      if (action === 'add') {
        const name = btn.dataset.name || '';
        const lat = btn.dataset.lat;
        const lon = btn.dataset.lon;

        // Close the SafiFind modal (if open) so the edit modal appears on top
        try { closeModal('safifind-modal'); } catch (e) { /* ignore */ }
        // Close the current company view modal as a fallback so the edit modal appears on top
        try { closeModal('company-view-modal'); } catch (e) { /* ignore */ }
        // Open the edit modal pre-filled for creating a new company from suggestion
        openCompanyModal();
        // small timeout to ensure modal inputs exist
        setTimeout(() => {
          const nameEl = document.getElementById('company-name-input');
          const latEl = document.getElementById('company-latitude');
          const lonEl = document.getElementById('company-longitude');
          const addrEl = document.getElementById('company-address');
          if (nameEl) nameEl.value = name;
          if (latEl && lonEl && lat && lon) {
            latEl.value = parseFloat(lat).toFixed(6);
            lonEl.value = parseFloat(lon).toFixed(6);
          }
          if (addrEl) addrEl.value = '';
        }, 80);
        showToast(`Prepared new company: ${name}. Check details and Save.`, 'success');
      }
    });
  });

  if (window.lucide) lucide.createIcons();
}

function getLeadScoreBadge(score) {
  let className = 'low';
  let label = 'Low';

  if (score >= 70) {
    className = 'high';
    label = 'High';
  } else if (score >= 40) {
    className = 'medium';
    label = 'Medium';
  }

  return `<span class="lead-score-badge ${className}"> Lead Score : <i data-lucide="target" style="width:14px; height:14px; vertical-align:middle;"></i> ${label}(${score}%)</span>`;
}

function parseMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}



function renderSkeletonCards(count = 3) {
  let html = '';

  // UPDATE: Add data-hide-scrollbar to the first div
  html += `<div class="page-header" data-hide-scrollbar>
    <h1 class="page-title">Loading...</h1>
  </div>`; // Make sure this div closes! 

  // ... rest of the function remains the same
  for (let i = 0; i < count; i++) {
    html += `
      <div class="card">
        <div class="skeleton skeleton-title"></div>
        <div class="skeleton skeleton-text"></div>
        <div class="skeleton skeleton-text"></div>
        <div class="skeleton skeleton-text short"></div>
      </div>
    `;
  }

  return html;
}

function renderError(message) {
  return `
    <div class="card">
      <div class="empty-state empty-state-alert">
        <i data-lucide="alert-circle" class="empty-state-icon text-danger"></i>
        <h3 class="empty-state-title">Error</h3>
        <p class="empty-state-description">${message}</p>
      </div>
    </div>
  `;
}

function renderAccessDenied() {
  return `
    <div class="card">
      <div class="empty-state empty-state-alert">
        <i data-lucide="lock" class="empty-state-icon"></i>
        <h3 class="empty-state-title">Access Denied</h3>
        <p class="empty-state-description">You don't have permission to view this page.</p>
      </div>
    </div>
  `;
}

function renderNotFound() {
  return `
    <div class="card">
      <div class="empty-state empty-state-alert">
        <i data-lucide="search" class="empty-state-icon"></i>
        <h3 class="empty-state-title">Not Found</h3>
        <p class="empty-state-description">The requested page does not exist.</p>
      </div>
    </div>
  `;
}

// Tags functions
window.addTag = function (tag) {
  if (!visitTags.includes(tag)) {
    visitTags.push(tag);
    renderTags();
  }
};

window.removeTag = function (tag) {
  visitTags = visitTags.filter(t => t !== tag);
  renderTags();
};

function renderTags() {
  const container = document.getElementById('tags-container');
  if (!container) return;

  const tagsHTML = visitTags.map(tag => `
    <span class="tag">
      ${tag}
      <button class="tag-remove" onclick="removeTag('${tag}')">×</button>
    </span>
  `).join('');

  container.innerHTML = tagsHTML + `<input type="text" class="tags-input" id="tags-input" placeholder="Add tags...">`;

  const newInput = document.getElementById('tags-input');
  newInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && newInput.value.trim()) {
      e.preventDefault();
      addTag(newInput.value.trim());
      newInput.value = '';
    }
  });
}

// ======================
// CUSTOM CONFIRM DIALOG
// ======================

window.showConfirmDialog = function (title, message) {
  return new Promise((resolve) => {
    const dialog = document.getElementById('confirm-dialog');
    const container = dialog?.querySelector('.confirm-dialog-container');
    const backdrop = dialog?.querySelector('.modal-backdrop');
    const titleEl = document.getElementById('confirm-title');
    const messageEl = document.getElementById('confirm-message');
    const helperEl = document.getElementById('confirm-helper');
    const cancelBtn = document.getElementById('confirm-cancel');
    const okBtn = document.getElementById('confirm-ok');
    const isDestructive = /\b(delete|remove)\b/i.test(`${title} ${message}`);

    // Set content
    titleEl.textContent = title;
    messageEl.textContent = message;
    if (helperEl) {
      helperEl.textContent = 'This action cannot be undone.';
    }
    okBtn.textContent = isDestructive ? 'Delete' : 'Confirm';
    okBtn.classList.toggle('btn-danger', isDestructive);
    okBtn.classList.toggle('btn-primary', !isDestructive);
    container?.classList.toggle('confirm-dialog-danger', isDestructive);
    container?.setAttribute('data-intent', isDestructive ? 'danger' : 'default');

    // Show dialog
    dialog.style.display = 'flex';
    cancelBtn.focus();

    // Handle buttons
    const handleCancel = () => {
      dialog.style.display = 'none';
      cleanup();
      resolve(false);
    };

    const handleOk = () => {
      dialog.style.display = 'none';
      cleanup();
      resolve(true);
    };

    const handleBackdropClick = (event) => {
      if (event.target === dialog || event.target === backdrop) {
        handleCancel();
      }
    };

    const handleKeydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleCancel();
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        handleOk();
      }
    };

    const cleanup = () => {
      cancelBtn.removeEventListener('click', handleCancel);
      okBtn.removeEventListener('click', handleOk);
      dialog.removeEventListener('click', handleBackdropClick);
      document.removeEventListener('keydown', handleKeydown);
      container?.classList.remove('confirm-dialog-danger');
      container?.removeAttribute('data-intent');
      okBtn.classList.remove('btn-danger');
      okBtn.classList.add('btn-primary');
      okBtn.textContent = 'Confirm';
    };

    cancelBtn.addEventListener('click', handleCancel);
    okBtn.addEventListener('click', handleOk);
    dialog.addEventListener('click', handleBackdropClick);
    document.addEventListener('keydown', handleKeydown);
  });
};

// ======================
// COMMAND PALETTE
// ======================

const commands = [
  { id: 'log-visit', title: 'Log New Visit', description: 'Record a field visit', icon: 'fa-plus-circle', action: () => loadView('log-visit') },
  { id: 'my-activity', title: 'My Activity', description: 'View your visits', icon: 'fa-clipboard-list', action: () => loadView('my-activity') },
  { id: 'sales-funnel', title: 'Sales Funnel', description: 'View pipeline', icon: 'fa-filter', action: () => loadView('sales-funnel') },
  { id: 'team-dashboard', title: 'Team Dashboard', description: 'Team performance', icon: 'fa-users', action: () => loadView('team-dashboard') },
  { id: 'companies', title: 'Companies', description: 'Manage companies', icon: 'fa-building', action: () => loadView('companies') },
  { id: 'people', title: 'People', description: 'Manage people', icon: 'fa-users', action: () => loadView('people') },
  { id: 'user-management', title: 'Users', description: 'Manage users', icon: 'fa-user', action: () => loadView('user-management') },
  { id: 'tasks', title: 'Tasks', description: 'Manage tasks', icon: 'fa-tasks', action: () => loadView('tasks') },
  { id: 'reminders', title: 'Reminders', description: 'View reminders', icon: 'fa-bell', action: () => loadView('reminders') },
  // Export command removed from command palette (user profile export removed)
  { id: 'theme', title: 'Toggle Theme', description: 'Switch dark/light', icon: 'fa-moon', action: () => toggleTheme() },
  { id: 'logout', title: 'Sign Out', description: 'Log out of account', icon: 'fa-sign-out-alt', action: () => handleLogout() }
];

function openCommandPalette() {
  commandPalette.style.display = 'flex';
  document.getElementById('command-input').focus();
  renderCommandResults(commands);
}

function closeCommandPalette() {
  commandPalette.style.display = 'none';
  document.getElementById('command-input').value = '';
}

document.getElementById('command-input')?.addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase();
  const filtered = commands.filter(cmd =>
    cmd.title.toLowerCase().includes(query) ||
    cmd.description.toLowerCase().includes(query)
  );
  renderCommandResults(filtered);
});

function renderCommandResults(results) {
  const container = document.getElementById('command-results');
  if (results.length === 0) {
    container.innerHTML = '<div style="padding: 2rem; text-align: center; color: var(--text-muted);">No commands found</div>';
    return;
  }

  container.innerHTML = results.map((cmd, i) => `
    <div class="command-item ${i === 0 ? 'active' : ''}" onclick="executeCommand('${cmd.id}')">
      <div class="command-item-icon"><i class="fas ${cmd.icon}"></i></div>
      <div class="command-item-text">
        <div class="command-item-title">${cmd.title}</div>
        <div class="command-item-description">${cmd.description}</div>
      </div>
    </div>
  `).join('');
}

window.executeCommand = function (commandId) {
  const command = commands.find(cmd => cmd.id === commandId);
  if (command) {
    command.action();
    closeCommandPalette();
  }
};



// ======================
// TECHNICIAN LOG VISIT VIEW
// ======================

// ======================
// TECHNICIAN LOG VISIT VIEW (LOCATION SELECT)
// ======================

async function renderTechnicianLogVisitView() {
  const { data: companies } = await supabaseClient
    .from('companies')
    .select('*')
    .order('name', { ascending: true });

  viewContainer.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Select Work Location</h1>
      <p class="text-muted">Choose a company or enter a custom location to proceed.</p>
    </div>

    <div class="card max-w-2xl mx-auto">
      <div class="form-field">
        <label for="technician-company-name">Search Company</label>
        <div class="search-container">
          <input type="text" id="technician-company-name" placeholder="Search for a company..." autocomplete="off" />
          <div id="technician-company-search-results" class="search-results" style="display: none;"></div>
        </div>
      </div>

      <div class="text-center my-4 text-muted">- OR -</div>

      <div class="form-field">
        <label for="technician-custom-location">Custom Location</label>
        <input type="text" id="technician-custom-location" placeholder="Enter custom location name" />
      </div>

      <div class="form-field mt-6">
        <button id="continue-to-dashboard-btn" class="btn btn-primary w-full" disabled>
          Continue to Dashboard
        </button>
      </div>
    </div>
  `;

  if (window.lucide) lucide.createIcons();

  initTechnicianLocationSelect(companies);
}

function initTechnicianLocationSelect(companies) {
  const searchInput = document.getElementById('technician-company-name');
  const resultsDiv = document.getElementById('technician-company-search-results');
  const customInput = document.getElementById('technician-custom-location');
  const continueBtn = document.getElementById('continue-to-dashboard-btn');

  let selectedCompany = null;

  // Search Logic
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    if (customInput.value) customInput.value = ''; // Clear custom if searching
    selectedCompany = null;
    checkContinue();

    if (query.length === 0) {
      resultsDiv.style.display = 'none';
      return;
    }

    const filtered = companies.filter(c =>
      c.name.toLowerCase().includes(query) ||
      (c.address && c.address.toLowerCase().includes(query))
    );

    if (filtered.length === 0) {
      resultsDiv.innerHTML = '<div class="search-result-item">No companies found</div>';
    } else {
      resultsDiv.innerHTML = filtered.map(c => `
         <div class="search-result-item" onclick="selectTechnicianCompanySelection('${c.id}')">
           <div>
             <div class="search-result-name">${c.name}</div>
             <div class="search-result-role">${c.address || 'No address'}</div>
           </div>
         </div>
       `).join('');
      if (window.lucide) lucide.createIcons();
    }
    resultsDiv.style.display = 'block';
  });

  // Global handler for selection
  window.selectTechnicianCompanySelection = (id) => {
    const company = companies.find(c => c.id === id);
    if (!company) return;
    selectedCompany = company;
    searchInput.value = company.name;
    resultsDiv.style.display = 'none';
    checkContinue();
  };

  customInput.addEventListener('input', () => {
    if (searchInput.value) searchInput.value = '';
    selectedCompany = null;
    checkContinue();
  });

  function checkContinue() {
    const customValue = customInput.value.trim();
    if (selectedCompany || customValue.length > 0) {
      continueBtn.disabled = false;
    } else {
      continueBtn.disabled = true;
    }
  }

  continueBtn.addEventListener('click', () => {
    const locationData = selectedCompany ?
      { type: 'company', id: selectedCompany.id, name: selectedCompany.name, address: selectedCompany.address } :
      { type: 'custom', id: null, name: customInput.value.trim(), address: 'Custom Location' };

    renderTechnicianCompanyDashboard(locationData);
  });
}

// ======================
// TECHNICIAN LOCATION DASHBOARD
// ======================

async function renderTechnicianCompanyDashboard(locationData) {
  // locationData: { type: 'company'|'custom', id, name, address }

  viewContainer.innerHTML = `
    <div class="page-header">
      <button class="btn btn-back mb-2" onclick="renderTechnicianLogVisitView()" aria-label="Change location" title="Change location">
        <span class="btn-back-icon"><i data-lucide="arrow-left"></i></span>
        <span class="btn-back-text">Change Location</span>
      </button>
      <h1 class="page-title">${locationData.name}</h1>
      <p class="text-muted">${locationData.address || 'Custom Location'}</p>
    </div>

    <!-- Actions Grid -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
      <div class="card hover:shadow-lg transition-all cursor-pointer" onclick="renderTechnicianForm('survey_visit', '${encodeURIComponent(JSON.stringify(locationData))}')">
        <div class="flex flex-col items-center text-center p-4">
          <div class="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center mb-3 text-blue-600">
            <i data-lucide="clipboard-list" style="width: 24px; height: 24px;"></i>
          </div>
          <h3 class="font-semibold text-lg">Survey Visit</h3>
          <p class="text-sm text-muted mt-1">Standard site survey</p>
        </div>
      </div>

      <div class="card hover:shadow-lg transition-all cursor-pointer" onclick="renderTechnicianForm('installation_visit', '${encodeURIComponent(JSON.stringify(locationData))}')">
        <div class="flex flex-col items-center text-center p-4">
          <div class="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mb-3 text-green-600">
            <i data-lucide="zap" style="width: 24px; height: 24px;"></i>
          </div>
          <h3 class="font-semibold text-lg">Installation Visit</h3>
          <p class="text-sm text-muted mt-1">Full system installation</p>
        </div>
      </div>

      <div class="card hover:shadow-lg transition-all cursor-pointer" onclick="renderTechnicianForm('maintenance_visit', '${encodeURIComponent(JSON.stringify(locationData))}')">
        <div class="flex flex-col items-center text-center p-4">
          <div class="w-12 h-12 rounded-full bg-purple-100 flex items-center justify-center mb-3 text-purple-600">
            <i data-lucide="settings" style="width: 24px; height: 24px;"></i>
          </div>
          <h3 class="font-semibold text-lg">Maintenance Visit</h3>
          <p class="text-sm text-muted mt-1">Routine AMC & Repair</p>
        </div>
      </div>
    </div>
    </div>
  `;

  if (window.lucide) lucide.createIcons();

  // history removed per design revamp
}

// Helper to load history
async function loadLocationHistory(locationData) {
  const listContainer = document.getElementById('location-history-list');

  let query = supabaseClient
    .from('technician_visits')
    .select(`
      *,
      technician:users!technician_id(name)
    `)
    .order('created_at', { ascending: false })
    .limit(10);

  if (locationData.type === 'company') {
    query = query.eq('company_id', locationData.id);
  } else {
    // For custom locations, we filter by name for now
    query = query.eq('company_name', locationData.name);
  }

  const { data: visits, error } = await query;

  if (error || !visits || visits.length === 0) {
    listContainer.innerHTML = `
      <div class="card p-6 text-center">
        <p class="text-muted">No recent forms found for this location.</p>
      </div>
    `;
    return;
  }

  listContainer.innerHTML = visits.map(visit => `
    <div class="card p-4 flex justify-between items-center">
      <div>
        <div class="font-medium">${formatFormType(visit.form_type)}</div>
        <div class="text-sm text-muted">
          ${formatDate(visit.created_at)} • ${visit.technician?.name || 'Unknown User'}
        </div>
      </div>
      <div class="text-sm">
        <span class="badge badge-outline">Submitted</span>
      </div>
    </div>
  `).join('');
}

function formatFormType(type) {
  if (type === 'survey_visit') return 'Survey Visit';
  if (type === 'installation_visit') return 'Installation Visit';
  if (type === 'maintenance_visit') return 'Maintenance Visit';
  return type || 'Unknown Form';
}

// ======================
// GENERIC FORM RENDERER
// ======================

window.renderTechnicianForm = function (formType, locationDataStr) {
  const locationData = JSON.parse(decodeURIComponent(locationDataStr));

  if (formType === 'survey_visit') {
    renderSurveyVisitForm(locationData);
    return;
  }
  if (formType === 'installation_visit') {
    renderInstallationVisitForm(locationData);
    return;
  }
  if (formType === 'maintenance_visit') {
    renderMaintenanceVisitForm(locationData);
    return;
  }

  viewContainer.innerHTML = `
    <div class="page-header">
      <button class="btn btn-back mb-2" onclick='renderTechnicianCompanyDashboard(${JSON.stringify(locationData)})' aria-label="Back to dashboard" title="Back to dashboard">
        <span class="btn-back-icon"><i data-lucide="arrow-left"></i></span>
        <span class="btn-back-text">Back to Dashboard</span>
      </button>
      <h1 class="page-title">${formatFormType(formType)}</h1>
      <p class="text-muted">${locationData.name}</p>
    </div>

    <div class="card p-8 text-center">
      <i data-lucide="hammer" class="w-16 h-16 text-muted mb-4 mx-auto"></i>
      <h2 class="text-xl font-bold mb-2">Form Under Construction</h2>
      <p class="text-muted mb-6">This form template is being implemented. Please provide the details for ${formatFormType(formType)}.</p>
      <button class="btn btn-primary" onclick='renderTechnicianCompanyDashboard(${JSON.stringify(locationData)})'>
        Return to Location Dashboard
      </button>
    </div>
  `;
  if (window.lucide) lucide.createIcons();
};

// ======================
// FORM 1: SURVEY VISIT
// ======================

function renderSurveyVisitForm(locationData) {
  viewContainer.innerHTML = `
    <div class="page-header">
      <button class="btn btn-back mb-2" onclick='renderTechnicianCompanyDashboard(${JSON.stringify(locationData)})' aria-label="Back to dashboard" title="Back to dashboard">
        <span class="btn-back-icon"><i data-lucide="arrow-left"></i></span>
        <span class="btn-back-text">Back to Dashboard</span>
      </button>
      <h1 class="page-title">Survey Visit</h1>
      <p class="text-muted">${locationData.name}</p>
    </div>

    <div class="card max-w-3xl mx-auto">
      <div class="card-body">
        
        <!-- SECTION: VISIT INFO -->
        <div class="section-container mb-6">
          <h3 class="card-title text-lg mb-4 border-b pb-2">Visit Information</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-field">
              <label>Technician Name</label>
              <input type="text" value="${currentUser.first_name} ${currentUser.last_name}" disabled class="bg-slate-100">
            </div>
            <div class="form-field">
              <label>Visit Date</label>
              <input type="date" id="visit-date" value="${new Date().toISOString().split('T')[0]}" required>
            </div>
            <div class="form-field md:col-span-2">
              <label>GPS Location</label>
              <div class="flex gap-2">
                <button type="button" id="capture-gps-btn" class="btn btn-secondary flex-1">
                  <i data-lucide="map-pin"></i> Capture GPS
                </button>
                <input type="text" id="gps-coordinates" placeholder="Lat, Long" readonly class="flex-1 bg-slate-100">
              </div>
            </div>
          </div>
        </div>

        <!-- SECTION: CLIENT INFORMATION -->
        <div class="section-container mb-6">
          <h3 class="card-title text-lg mb-4 border-b pb-2">Client Information</h3>
          <div class="form-field">
            <label>Company / Client Name</label>
            <input type="text" value="${locationData.name}" disabled class="bg-slate-100">
          </div>
          <div class="form-field">
            <label>Address / Location</label>
            <input type="text" id="client-address" value="${locationData.address || ''}" ${locationData.type === 'company' ? 'disabled' : ''} placeholder="Enter address">
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-field">
              <label>Phone Number</label>
              <input type="tel" id="client-phone" placeholder="Enter phone number">
            </div>
            <div class="form-field">
              <label>Email</label>
              <input type="email" id="client-email" placeholder="Enter email">
            </div>
          </div>
        </div>

        <!-- SECTION: LOAD REQUIREMENTS -->
        <div class="section-container mb-6">
          <h3 class="card-title text-lg mb-4 border-b pb-2">Load Requirements</h3>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div class="form-field">
              <label>Total Load (Watts)</label>
              <input type="number" id="total-load" placeholder="e.g. 5000">
            </div>
            <div class="form-field">
              <label>Backup Time (Hours)</label>
              <input type="number" id="backup-time" placeholder="e.g. 4">
            </div>
            <div class="form-field">
              <label>No. of Appliances</label>
              <input type="number" id="appliance-count" placeholder="e.g. 10">
            </div>
          </div>
          <div class="form-field mt-4">
            <label>Appliance Details</label>
            <textarea id="appliance-details" rows="3" placeholder="List major appliances (e.g. 2 ACs, 1 Fridge, 5 Computers)"></textarea>
          </div>
        </div>

        <!-- SECTION: BATTERY REQUIREMENTS -->
        <div class="section-container mb-6">
          <h3 class="card-title text-lg mb-4 border-b pb-2">Battery Requirements</h3>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div class="form-field">
              <label>Battery Type</label>
              <select id="battery-type">
                <option value="">Select Type</option>
                <option value="Lithium">Lithium</option>
                <option value="Tubular">Tubular</option>
                <option value="SMF">SMF</option>
                <option value="Gel">Gel</option>
                <option value="Flooded">Flooded</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div class="form-field">
              <label>Quantity</label>
              <input type="number" id="battery-quantity" placeholder="Qty">
            </div>
            <div class="form-field">
              <label>Voltage</label>
              <select id="battery-voltage">
                <option value="">Select Voltage</option>
                <option value="12V">12V</option>
                <option value="24V">24V</option>
                <option value="48V">48V</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>
        </div>

        <!-- SECTION: INSTALLATION DETAILS -->
        <div class="section-container mb-6">
          <h3 class="card-title text-lg mb-4 border-b pb-2">Installation Details</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-field">
              <label>Installation Location</label>
              <select id="install-location">
                <option value="">Select Location</option>
                <option value="Indoor">Indoor</option>
                <option value="Outdoor">Outdoor</option>
                <option value="Utility Room">Utility Room</option>
                <option value="Garage">Garage</option>
                <option value="Office">Office</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div class="form-field">
              <label>Distance from Inverter (m)</label>
              <input type="number" id="install-distance" placeholder="Meters">
            </div>
            <div class="form-field">
              <label>Cable Size Required</label>
              <input type="text" id="cable-size" placeholder="e.g. 16mm">
            </div>
            <div class="form-field">
              <label>Feasibility</label>
              <select id="install-feasibility">
                <option value="">Select Feasibility</option>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
                <option value="Needs Review">Needs Review</option>
              </select>
            </div>
          </div>
        </div>

        <!-- SECTION: NOTES & VERIFICATION -->
        <div class="section-container mb-6">
          <h3 class="card-title text-lg mb-4 border-b pb-2">Notes & Verification</h3>
          
          <div class="form-field">
            <label>Technician Notes</label>
            <textarea id="technician-notes" rows="4" placeholder="Enter findings, recommendations, etc."></textarea>
          </div>

          <div class="form-field mt-4">
            <label>Photos (Max 10)</label>
            <input type="file" id="technician-photos" accept="image/*" multiple style="display: none;" />
            <div class="photo-upload-multiple" id="photo-upload-multiple">
              <i data-lucide="camera" class="w-6 h-6 mb-2"></i>
              <p>Tap to add photos</p>
            </div>
            <div class="photo-grid mt-4" id="photo-preview-grid"></div>
          </div>

          <div class="form-field mt-6">
            <label>Technician Signature</label>
            <div class="signature-container bg-slate-50 dark:bg-slate-900 border rounded-lg h-40 relative">
              <canvas id="technician-signature-canvas" class="signature-canvas w-full h-full"></canvas>
              <div class="signature-placeholder absolute inset-0 flex items-center justify-center text-muted pointer-events-none" id="technician-signature-placeholder">
                Sign Here
              </div>
            </div>
            <button type="button" class="btn btn-sm btn-ghost mt-2" id="clear-technician-signature">Clear</button>
          </div>
        </div>

        <div class="form-field mt-8">
          <button id="submit-survey-visit" class="btn btn-primary w-full py-3 text-lg">
            Submit Survey Visit
          </button>
        </div>
      </div>
    </div>
  `;

  if (window.lucide) lucide.createIcons();

  initSurveyVisitForm(locationData);
}

function initSurveyVisitForm(locationData) {
  window.technicianVisitForm = {
    selectedCompany: locationData.type === 'company' ? locationData : null,
    capturedLocation: null,
    technicianSignature: null,
    photos: [],
    technicianSignatureCanvas: null,
    technicianSignatureCtx: null,
    isTechnicianDrawing: false
  };

  // 1. GPS Logic
  const gpsBtn = document.getElementById('capture-gps-btn');
  const gpsInput = document.getElementById('gps-coordinates');

  if (gpsBtn) {
    gpsBtn.addEventListener('click', () => {
      if (!navigator.geolocation) {
        showToast('Geolocation not supported', 'error');
        return;
      }
      gpsBtn.disabled = true;
      gpsBtn.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> Capturing...';
      if (window.lucide) lucide.createIcons();

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          window.technicianVisitForm.capturedLocation = { latitude, longitude };
          gpsInput.value = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
          gpsBtn.className = 'btn btn-success flex-1';
          gpsBtn.innerHTML = '<i data-lucide="check"></i> Captured';
          gpsBtn.disabled = false;
          if (window.lucide) lucide.createIcons();
        },
        (err) => {
          console.error(err);
          gpsBtn.disabled = false;
          gpsBtn.innerHTML = '<i data-lucide="map-pin"></i> Retry';
          showToast('Location capture failed', 'error');
          if (window.lucide) lucide.createIcons();
        }
      );
    });
  }

  // 2. Photo Logic
  const photoInput = document.getElementById('technician-photos');
  const photoUploadArea = document.getElementById('photo-upload-multiple');

  if (photoUploadArea) {
    photoUploadArea.addEventListener('click', () => photoInput.click());

    photoInput.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files).slice(0, 10);
      if (files.length === 0) return;

      window.technicianVisitForm.photos = [];
      const grid = document.getElementById('photo-preview-grid');
      grid.innerHTML = '<div class="text-center w-full"><i data-lucide="loader" class="animate-spin"></i> Compressing...</div>';
      if (window.lucide) lucide.createIcons();

      const processedPhotos = [];
      for (const file of files) {
        if (!file.type.startsWith('image/')) continue;
        processedPhotos.push(await compressImage(file));
      }
      window.technicianVisitForm.photos = processedPhotos;

      grid.innerHTML = processedPhotos.map((p) => {
        const url = p.dataUrl || (p instanceof File ? URL.createObjectURL(p) : 'https://via.placeholder.com/300x300?text=No+Preview');
        return `
          <div class="relative aspect-square bg-slate-100 rounded overflow-hidden">
            <img src="${url}" class="w-full h-full object-cover" />
          </div>
        `;
      }).join('');
    });
  }

  // 3. Signature Logic
  setTimeout(() => {
    const canvas = document.getElementById('technician-signature-canvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';

    let isDrawing = false;

    const getPos = (e) => {
      const r = canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return { x: clientX - r.left, y: clientY - r.top };
    };

    const start = (e) => {
      isDrawing = true;
      ctx.beginPath();
      const { x, y } = getPos(e);
      ctx.moveTo(x, y);
      const placeholder = document.getElementById('technician-signature-placeholder');
      if (placeholder) placeholder.style.display = 'none';
      e.preventDefault();
    };

    const move = (e) => {
      if (!isDrawing) return;
      const { x, y } = getPos(e);
      ctx.lineTo(x, y);
      ctx.stroke();
      e.preventDefault();
    };

    const end = () => {
      if (!isDrawing) return;
      isDrawing = false;
      window.technicianVisitForm.technicianSignature = canvas.toDataURL();
    };

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start);
    canvas.addEventListener('touchmove', move);
    canvas.addEventListener('touchend', end);

    const clearBtn = document.getElementById('clear-technician-signature');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const placeholder = document.getElementById('technician-signature-placeholder');
        if (placeholder) placeholder.style.display = 'flex';
        window.technicianVisitForm.technicianSignature = null;
      });
    }
  }, 100);

  // 4. Submit Logic
  const submitBtn = document.getElementById('submit-survey-visit');
  if (submitBtn) {
    submitBtn.addEventListener('click', async () => {
      // Basic Validation
      if (!window.technicianVisitForm.technicianSignature) {
        showToast('Technician signature is required', 'error');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> Submitting...';
      if (window.lucide) lucide.createIcons();

      try {
        // Upload photos
        const photoUrls = [];
        for (const p of window.technicianVisitForm.photos) {
          const fileToUpload = p.file || (p instanceof File ? p : null);
          if (!fileToUpload) continue;
          const fileName = fileToUpload.name ? fileToUpload.name.replace(/[^a-zA-Z0-9.]/g, '_') : `photo-${Date.now()}.jpg`;
          const path = `technician-photos/${currentUser.id}/${Date.now()}-${fileName}`;
          const { error } = await supabaseClient.storage.from('safitrack').upload(path, fileToUpload, {
            contentType: 'image/jpeg',
            upsert: true
          });
          if (!error) {
            const { data } = supabaseClient.storage.from('safitrack').getPublicUrl(path);
            photoUrls.push(data.publicUrl);
          } else {
            console.error('Upload error detail:', error);
          }
        }

        // Construct Data
        const formData = {
          client_phone: document.getElementById('client-phone')?.value,
          client_email: document.getElementById('client-email')?.value,
          client_address: document.getElementById('client-address')?.value,
          total_load_watts: document.getElementById('total-load')?.value,
          backup_time_hours: document.getElementById('backup-time')?.value,
          appliance_count: document.getElementById('appliance-count')?.value,
          appliance_details: document.getElementById('appliance-details')?.value,
          battery_type: document.getElementById('battery-type')?.value,
          battery_quantity: document.getElementById('battery-quantity')?.value,
          battery_voltage: document.getElementById('battery-voltage')?.value,
          install_location: document.getElementById('install-location')?.value,
          install_distance: document.getElementById('install-distance')?.value,
          cable_size: document.getElementById('cable-size')?.value,
          install_feasibility: document.getElementById('install-feasibility')?.value,
          technician_notes: document.getElementById('technician-notes')?.value,
          visit_date: document.getElementById('visit-date')?.value
        };

        const visitData = {
          technician_id: currentUser.id,
          company_id: locationData.type === 'company' ? locationData.id : null,
          company_name: locationData.name,
          location_name: locationData.type === 'custom' ? locationData.name : null,
          form_type: 'survey_visit',
          visit_type: 'survey',
          visit_notes: formData.technician_notes || 'Service Survey',
          technician_signature: window.technicianVisitForm.technicianSignature,
          photos: photoUrls.length > 0 ? photoUrls : null,
          latitude: window.technicianVisitForm.capturedLocation?.latitude,
          longitude: window.technicianVisitForm.capturedLocation?.longitude,
          created_at: new Date().toISOString(),
          form_data: formData,
          organization_id: currentOrganization?.id
        };

        const { error } = await supabaseClient.from('technician_visits').insert([visitData]);
        if (error) throw error;

        showToast('Survey Visit Submitted!', 'success');
        setTimeout(() => {
          renderTechnicianCompanyDashboard(locationData);
        }, 1500);

      } catch (e) {
        console.error(e);
        showToast('Submission failed: ' + e.message, 'error');
        submitBtn.disabled = false;
        submitBtn.innerHTML = 'Submit Survey Visit';
      }
    });
  }
}

const INVERTER_MODELS = {
  'Kstar': [
    { model: 'Kstar 3.6Kva - 24V', kva: '3.6', voltage: '24V' },
    { model: 'Kstar 3.6Kva - 48V', kva: '3.6', voltage: '48V' },
    { model: 'Kstar 6Kva - 48V', kva: '6', voltage: '48V' }
  ],
  'Fortuner': [
    { model: 'Fortuner 0.7kVA (450W) - 12V', kva: '0.7', voltage: '12V' },
    { model: 'Fortuner 1.5kVA (1200W) - 24V', kva: '1.5', voltage: '24V' },
    { model: 'Fortuner 2.2kVA (1400W) - 24V', kva: '2.2', voltage: '24V' },
    { model: 'Fortuner 10kVA - 48V', kva: '10', voltage: '48V' }
  ]
};

// ======================
// FORM 2: INSTALLATION VISIT
// ======================

function renderInstallationVisitForm(locationData) {
  viewContainer.innerHTML = `
    <div class="page-header">
      <button class="btn btn-back mb-2" onclick='renderTechnicianCompanyDashboard(${JSON.stringify(locationData)})' aria-label="Back to dashboard" title="Back to dashboard">
        <span class="btn-back-icon"><i data-lucide="arrow-left"></i></span>
        <span class="btn-back-text">Back to Dashboard</span>
      </button>
      <h1 class="page-title">Installation Visit</h1>
      <p class="text-muted">${locationData.name}</p>
    </div>

    <div class="card max-w-3xl mx-auto">
      <div class="card-body">
        
        <!-- Section: Visit Info -->
        <div class="section-container mb-6">
          <h3 class="card-title text-lg mb-4 border-b pb-2">Visit Info</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-field">
              <label>Technician Name</label>
              <input type="text" value="${currentUser.first_name} ${currentUser.last_name}" disabled class="bg-slate-100">
            </div>
            <div class="form-field">
              <label>Visit Date</label>
              <input type="date" id="install-visit-date" value="${new Date().toISOString().split('T')[0]}" required>
            </div>
            <div class="form-field md:col-span-2">
              <label>GPS Location</label>
              <div class="flex gap-2">
                <button type="button" id="install-capture-gps-btn" class="btn btn-secondary flex-1">
                  <i data-lucide="map-pin"></i> Capture GPS
                </button>
                <input type="text" id="install-gps-coordinates" placeholder="Lat, Long" readonly class="flex-1 bg-slate-100">
              </div>
            </div>
          </div>
        </div>

        <!-- Section: Client Information -->
        <div class="section-container mb-6">
          <h3 class="card-title text-lg mb-4 border-b pb-2">Client Information</h3>
          <div class="form-field">
            <label>Company / Client Name</label>
            <input type="text" value="${locationData.name}" disabled class="bg-slate-100">
          </div>
          <div class="form-field">
            <label>Address / Location</label>
            <input type="text" id="install-client-address" value="${locationData.address || ''}" ${locationData.type === 'company' ? 'disabled' : ''} placeholder="Enter address">
          </div>
          <div class="form-field">
            <label>Reference Number</label>
            <input type="text" id="install-reference" placeholder="e.g. ST-2024-001">
          </div>
        </div>

        <!-- Section: Inverter Information -->
        <div class="section-container mb-6">
          <h3 class="card-title text-lg mb-4 border-b pb-2">Inverter Information</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-field">
              <label>Manufacturer</label>
              <select id="inverter-manufacturer">
                <option value="">Select Manufacturer</option>
                <option value="Kstar">Kstar</option>
                <option value="Fortuner">Fortuner</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div class="form-field">
              <label>Model</label>
              <div id="model-input-container">
                <input type="text" id="inverter-model-custom" placeholder="Enter model" style="display: none;">
                <select id="inverter-model-list">
                  <option value="">Select Model</option>
                </select>
              </div>
            </div>
            <div class="form-field">
              <label>Serial Number</label>
              <input type="text" id="inverter-serial" placeholder="Enter serial number">
            </div>
            <div class="form-field">
              <label>KVA Rating</label>
              <input type="text" id="inverter-kva" placeholder="e.g. 5Kva">
            </div>
            <div class="form-field">
              <label>Inverter Type</label>
              <select id="inverter-type">
                <option value="">Select Type</option>
                <option value="Pure Sine Wave">Pure Sine Wave</option>
                <option value="Hybrid">Hybrid</option>
                <option value="Off-Grid">Off-Grid</option>
                <option value="On-Grid">On-Grid</option>
                <option value="UPS">UPS</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Section: Battery Information -->
        <div class="section-container mb-6">
          <h3 class="card-title text-lg mb-4 border-b pb-2">Battery Information</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-field">
              <label>Battery Brand</label>
              <select id="battery-brand">
                <option value="">Select Brand</option>
                <option value="Delta">Delta</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div class="form-field">
              <label>Quantity</label>
              <input type="number" id="battery-qty" placeholder="Qty">
            </div>
            <div class="form-field">
              <label>Voltage</label>
              <select id="battery-volts">
                <option value="">Select Voltage</option>
                <option value="12V">12V</option>
                <option value="24V">24V</option>
                <option value="48V">48V</option>
              </select>
            </div>
            <div class="form-field">
              <label>Amp Rating (Ah)</label>
              <input type="number" id="battery-ah" placeholder="e.g. 200">
            </div>
          </div>
        </div>

        <!-- Section: Electrical Measurements -->
        <div class="section-container mb-6">
          <h3 class="card-title text-lg mb-4 border-b pb-2">Electrical Measurements</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-field">
              <label>Input Voltage (VAC)</label>
              <input type="number" id="input-vac" placeholder="e.g. 230">
            </div>
            <div class="form-field">
              <label>Output Voltage (VAC)</label>
              <input type="number" id="output-vac" placeholder="e.g. 230">
            </div>
            <div class="form-field">
              <label>Charging Voltage (VDC)</label>
              <input type="number" id="charging-vdc" placeholder="e.g. 54.4">
            </div>
            <div class="form-field">
              <label>Output Frequency</label>
              <select id="output-freq">
                <option value="50 Hz">50 Hz</option>
                <option value="60 Hz">60 Hz</option>
              </select>
            </div>
            <div class="form-field">
              <label>Backup Time (Minutes)</label>
              <input type="number" id="backup-min" placeholder="e.g. 120">
            </div>
          </div>
        </div>

        <!-- Section: Inspection Checklist -->
        <div class="section-container mb-6">
          <h3 class="card-title text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">Inspection Checklist</h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            ${[
      'General Wiring Checked', 'Fuses Checked', 'Ventilation / Fans Checked',
      'Load Test Completed', 'Battery Mode Test Completed', 'Display Checked',
      'Terminal Labelled', 'Operation Manual Provided', 'Manual Bypass Checked',
      'Neutral Continuity Checked'
    ].map((item, i) => `
              <label class="flex items-center gap-3 p-3 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl hover:border-primary/50 transition-colors cursor-pointer group">
                <div class="relative flex items-center">
                  <input type="checkbox" class="install-checklist-item w-5 h-5 rounded border-slate-300 text-primary focus:ring-primary/20 transition-all cursor-pointer" data-item="${item}">
                </div>
                <span class="text-sm font-medium text-slate-700 dark:text-slate-200 group-hover:text-primary transition-colors">${item}</span>
              </label>
            `).join('')}
          </div>
        </div>

        <!-- Section: Notes & Verification -->
        <div class="section-container mb-6">
          <h3 class="card-title text-lg mb-4 border-b pb-2">Notes & Verification</h3>
          <div class="form-field">
            <label>Technician Notes</label>
            <textarea id="install-notes" rows="4" placeholder="Enter findings, recommendations, etc."></textarea>
          </div>

          <div class="form-field mt-4">
            <label>Photos (Max 10)</label>
            <input type="file" id="install-photos" accept="image/*" multiple style="display: none;" />
            <div class="photo-upload-multiple" id="install-photo-upload">
              <i data-lucide="camera" class="w-6 h-6 mb-2"></i>
              <p>Tap to add photos</p>
            </div>
            <div class="photo-grid mt-4" id="install-photo-grid"></div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
            <div class="form-field">
              <label>Technician Signature</label>
              <div class="signature-container bg-slate-50 dark:bg-slate-900 border rounded-lg h-40 relative">
                <canvas id="install-tech-sig-canvas" class="signature-canvas w-full h-full"></canvas>
                <div class="signature-placeholder absolute inset-0 flex items-center justify-center text-muted pointer-events-none" id="install-tech-sig-placeholder">
                  Sign Here
                </div>
              </div>
              <button type="button" class="btn btn-sm btn-ghost mt-2" id="clear-install-tech-sig">Clear</button>
            </div>

            <div class="form-field">
              <label>Client Signature</label>
              <div class="signature-container bg-slate-50 dark:bg-slate-900 border rounded-lg h-40 relative">
                <canvas id="install-client-sig-canvas" class="signature-canvas w-full h-full"></canvas>
                <div class="signature-placeholder absolute inset-0 flex items-center justify-center text-muted pointer-events-none" id="install-client-sig-placeholder">
                  Sign Here
                </div>
              </div>
              <button type="button" class="btn btn-sm btn-ghost mt-2" id="clear-install-client-sig">Clear</button>
            </div>
          </div>
        </div>

        <div class="form-field mt-8">
          <button id="submit-install-visit" class="btn btn-primary w-full py-3 text-lg">
            Submit Installation Visit
          </button>
        </div>
      </div>
    </div>
  `;

  if (window.lucide) lucide.createIcons();

  initInstallationVisitForm(locationData);
}

function initInstallationVisitForm(locationData) {
  window.technicianVisitForm = {
    selectedCompany: locationData.type === 'company' ? locationData : null,
    capturedLocation: null,
    technicianSignature: null,
    clientSignature: null,
    photos: []
  };

  // 1. Inverter Auto-fill Logic
  const manufacturerSelect = document.getElementById('inverter-manufacturer');
  const modelList = document.getElementById('inverter-model-list');
  const modelCustom = document.getElementById('inverter-model-custom');
  const kvaInput = document.getElementById('inverter-kva');
  const batteryVolts = document.getElementById('battery-volts');

  manufacturerSelect.addEventListener('change', (e) => {
    const brand = e.target.value;
    modelList.innerHTML = '<option value="">Select Model</option>';

    if (brand === 'Other' || !brand) {
      modelList.style.display = 'none';
      modelCustom.style.display = 'block';
    } else {
      modelList.style.display = 'block';
      modelCustom.style.display = 'none';
      if (INVERTER_MODELS[brand]) {
        INVERTER_MODELS[brand].forEach(m => {
          const opt = document.createElement('option');
          opt.value = m.model;
          opt.textContent = m.model;
          opt.dataset.kva = m.kva;
          opt.dataset.voltage = m.voltage;
          modelList.appendChild(opt);
        });
      }
    }
  });

  modelList.addEventListener('change', (e) => {
    const opt = e.target.selectedOptions[0];
    if (opt && opt.value) {
      kvaInput.value = opt.dataset.kva + ' Kva';
      batteryVolts.value = opt.dataset.voltage;
    }
  });

  // 2. GPS Logic
  const gpsBtn = document.getElementById('install-capture-gps-btn');
  const gpsInput = document.getElementById('install-gps-coordinates');
  gpsBtn.addEventListener('click', () => {
    gpsBtn.disabled = true;
    gpsBtn.innerHTML = '<i data-lucide="loader" class="animate-spin"></i>';
    if (window.lucide) lucide.createIcons();
    navigator.geolocation.getCurrentPosition((pos) => {
      window.technicianVisitForm.capturedLocation = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      gpsInput.value = `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`;
      gpsBtn.className = 'btn btn-success flex-1';
      gpsBtn.innerHTML = '<i data-lucide="check"></i> Captured';
      gpsBtn.disabled = false;
      if (window.lucide) lucide.createIcons();
    });
  });

  // 3. Photo Logic
  const photoInput = document.getElementById('install-photos');
  const photoArea = document.getElementById('install-photo-upload');
  photoArea.addEventListener('click', () => photoInput.click());
  photoInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files).slice(0, 10);
    const grid = document.getElementById('install-photo-grid');
    grid.innerHTML = '<p class="text-center w-full">Compressing...</p>';
    window.technicianVisitForm.photos = [];
    const processed = [];
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      processed.push(await compressImage(file));
    }
    window.technicianVisitForm.photos = processed;
    grid.innerHTML = processed.map(p => {
      const url = p.dataUrl || (p instanceof File ? URL.createObjectURL(p) : 'https://via.placeholder.com/300x300?text=No+Preview');
      return `<img src="${url}" class="aspect-square object-cover rounded">`;
    }).join('');
  });

  // 4. Signature Logic (Simplified setup)
  setTimeout(() => {
    setupInstallCanvas('install-tech-sig-canvas', 'tech');
    setupInstallCanvas('install-client-sig-canvas', 'client');
  }, 100);

  function setupInstallCanvas(id, type) {
    const canvas = document.getElementById(id);
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width; canvas.height = rect.height;
    ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    let drawing = false;
    const getPos = (e) => {
      const r = canvas.getBoundingClientRect();
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      return { x: cx - r.left, y: cy - r.top };
    };
    const start = (e) => { drawing = true; ctx.beginPath(); const { x, y } = getPos(e); ctx.moveTo(x, y); document.getElementById(`install-${type}-sig-placeholder`).style.display = 'none'; e.preventDefault(); };
    const move = (e) => { if (!drawing) return; const { x, y } = getPos(e); ctx.lineTo(x, y); ctx.stroke(); e.preventDefault(); };
    const end = () => { drawing = false; window.technicianVisitForm[`${type === 'tech' ? 'technician' : 'client'}Signature`] = canvas.toDataURL(); };
    canvas.addEventListener('mousedown', start); canvas.addEventListener('mousemove', move); canvas.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start); canvas.addEventListener('touchmove', move); canvas.addEventListener('touchend', end);
    document.getElementById(`clear-install-${type}-sig`).addEventListener('click', () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      document.getElementById(`install-${type}-sig-placeholder`).style.display = 'flex';
      window.technicianVisitForm[`${type === 'tech' ? 'technician' : 'client'}Signature`] = null;
    });
  }

  // 5. Submit Logic
  document.getElementById('submit-install-visit').addEventListener('click', async () => {
    const btn = document.getElementById('submit-install-visit');
    if (!window.technicianVisitForm.technicianSignature) { showToast('Technician signature required', 'error'); return; }
    btn.disabled = true; btn.innerHTML = 'Submitting...';

    try {
      const photoUrls = [];
      for (const p of window.technicianVisitForm.photos) {
        const fileToUpload = p.file || (p instanceof File ? p : null);
        if (!fileToUpload) continue;
        const fileName = fileToUpload.name ? fileToUpload.name.replace(/[^a-zA-Z0-9.]/g, '_') : `photo-${Date.now()}.jpg`;
        const path = `technician-photos/${currentUser.id}/${Date.now()}-${fileName}`;
        const { error } = await supabaseClient.storage.from('safitrack').upload(path, fileToUpload, {
          contentType: 'image/jpeg',
          upsert: true
        });
        if (!error) {
          const { data } = supabaseClient.storage.from('safitrack').getPublicUrl(path);
          photoUrls.push(data.publicUrl);
        } else {
          console.error('Install: Upload error', error);
        }
      }

      const checklist = [];
      document.querySelectorAll('.install-checklist-item:checked').forEach(i => checklist.push(i.dataset.item));

      const formData = {
        visit_date: document.getElementById('install-visit-date').value,
        client_address: document.getElementById('install-client-address').value,
        reference_number: document.getElementById('install-reference').value,
        inverter_manufacturer: manufacturerSelect.value,
        inverter_model: manufacturerSelect.value === 'Other' ? modelCustom.value : modelList.value,
        inverter_serial: document.getElementById('inverter-serial').value,
        inverter_kva: kvaInput.value,
        inverter_type: document.getElementById('inverter-type').value,
        battery_brand: document.getElementById('battery-brand').value,
        battery_qty: document.getElementById('battery-qty').value,
        battery_volts: batteryVolts.value,
        battery_ah: document.getElementById('battery-ah').value,
        input_vac: document.getElementById('input-vac').value,
        output_vac: document.getElementById('output-vac').value,
        charging_vdc: document.getElementById('charging-vdc').value,
        output_freq: document.getElementById('output-freq').value,
        backup_min: document.getElementById('backup-min').value,
        checklist: checklist,
        technician_notes: document.getElementById('install-notes').value
      };

      const visitData = {
        technician_id: currentUser.id,
        company_id: locationData.type === 'company' ? locationData.id : null,
        company_name: locationData.name,
        location_name: locationData.type === 'custom' ? locationData.name : null,
        form_type: 'installation_visit',
        visit_type: 'installation',
        visit_notes: formData.technician_notes || 'Installation completed',
        technician_signature: window.technicianVisitForm.technicianSignature,
        client_signature: window.technicianVisitForm.clientSignature,
        photos: photoUrls.length > 0 ? photoUrls : null,
        latitude: window.technicianVisitForm.capturedLocation?.latitude,
        longitude: window.technicianVisitForm.capturedLocation?.longitude,
        created_at: new Date().toISOString(),
        form_data: formData,
        organization_id: currentOrganization?.id
      };

      const { error } = await supabaseClient.from('technician_visits').insert([visitData]);
      if (error) throw error;
      showToast('Installation Visit Submitted!', 'success');
      setTimeout(() => renderTechnicianCompanyDashboard(locationData), 1500);
    } catch (e) {
      console.error(e); showToast('Error: ' + e.message, 'error'); btn.disabled = false; btn.innerHTML = 'Submit Installation Visit';
    }
  });
}
// ======================
// FORM 3: MAINTENANCE VISIT
// ======================

function renderMaintenanceVisitForm(locationData) {
  viewContainer.innerHTML = `
    <div class="page-header">
      <button class="btn btn-ghost mb-2" onclick='renderTechnicianCompanyDashboard(${JSON.stringify(locationData)})'>
        <i data-lucide="arrow-left"></i> Back to Dashboard
      </button>
      <h1 class="page-title">Maintenance Visit</h1>
      <p class="text-muted">${locationData.name}</p>
    </div>

    <div class="card max-w-3xl mx-auto">
      <div class="card-body">
        
        <!-- Section: Visit Info -->
        <div class="section-container mb-6">
          <h3 class="card-title text-lg mb-4 border-b pb-2">Visit Info</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-field">
              <label>Technician Name</label>
              <input type="text" value="${currentUser.first_name} ${currentUser.last_name}" disabled class="bg-slate-100">
            </div>
            <div class="form-field">
              <label>Visit Date</label>
              <input type="date" id="maint-visit-date" value="${new Date().toISOString().split('T')[0]}" required>
            </div>
            <div class="form-field md:col-span-2">
              <label>GPS Location</label>
              <div class="flex gap-2">
                <button type="button" id="maint-capture-gps-btn" class="btn btn-secondary flex-1">
                  <i data-lucide="map-pin"></i> Capture GPS
                </button>
                <input type="text" id="maint-gps-coordinates" placeholder="Lat, Long" readonly class="flex-1 bg-slate-100">
              </div>
            </div>
          </div>
        </div>

        <!-- Section: Client Information -->
        <div class="section-container mb-6">
          <h3 class="card-title text-lg mb-4 border-b pb-2">Client Information</h3>
          <div class="form-field">
            <label>Company / Client Name</label>
            <input type="text" value="${locationData.name}" disabled class="bg-slate-100">
          </div>
          <div class="form-field">
            <label>AMC / Maintenance Reference</label>
            <input type="text" id="maint-reference" placeholder="e.g. AMC-2024-001">
          </div>
        </div>

        <!-- Section: System Details (Inverter/Battery) -->
        <div class="section-container mb-6">
          <h3 class="card-title text-lg mb-4 border-b pb-2">System Details</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-field">
              <label>Manufacturer</label>
              <select id="maint-inverter-manufacturer">
                <option value="">Select Manufacturer</option>
                <option value="Kstar">Kstar</option>
                <option value="Fortuner">Fortuner</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div class="form-field">
              <label>Inverter Model</label>
              <select id="maint-inverter-model">
                <option value="">Select Model</option>
              </select>
            </div>
            <div class="form-field">
              <label>Battery Brand</label>
              <input type="text" id="maint-battery-brand" placeholder="e.g. Delta">
            </div>
            <div class="form-field">
              <label>Battery Qty & Voltage</label>
              <input type="text" id="maint-battery-specs" placeholder="e.g. 4x 12V 200Ah">
            </div>
          </div>
        </div>

        <!-- Section: Testing Results -->
        <div class="section-container mb-6">
          <h3 class="card-title text-lg mb-4 border-b pb-2">Testing Results</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-field">
              <label>Charging Current (Amps)</label>
              <input type="number" id="maint-charging-amps" placeholder="e.g. 20">
            </div>
            <div class="form-field">
              <label>Backup Time Observed (Mins)</label>
              <input type="number" id="maint-backup-obs" placeholder="e.g. 45">
            </div>
            <div class="form-field">
              <label>Voltage Per Battery (Avg)</label>
              <input type="number" step="0.1" id="maint-batt-vdc" placeholder="e.g. 13.6">
            </div>
            <div class="form-field">
              <label>System Cleanliness</label>
              <select id="maint-cleanliness">
                <option value="Excellent">Excellent</option>
                <option value="Good">Good</option>
                <option value="Fair">Fair</option>
                <option value="Poor">Poor (Needs Cleaning)</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Section: Maintenance Checklist -->
        <div class="section-container mb-6">
          <h3 class="card-title text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">Maintenance Checklist</h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            ${[
      'Inverter Cleaned', 'Battery Terminals Greased', 'Tightened Connections',
      'Ventilation Fans Checked', 'Input/Output Voltage Checked',
      'Auto-Changeover Tested', 'Bypass Switch Checked',
      'Visual Inspection of Comps', 'Firmware Updated',
      'User Training Refreshed'
    ].map((item, i) => `
              <label class="flex items-center gap-3 p-3 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl hover:border-primary/50 transition-colors cursor-pointer group">
                <div class="relative flex items-center">
                  <input type="checkbox" class="maint-checklist-item w-5 h-5 rounded border-slate-300 text-primary focus:ring-primary/20 transition-all cursor-pointer" data-item="${item}">
                </div>
                <span class="text-sm font-medium text-slate-700 dark:text-slate-200 group-hover:text-primary transition-colors">${item}</span>
              </label>
            `).join('')}
          </div>
        </div>

        <!-- Section: Notes & Verification -->
        <div class="section-container mb-6">
          <h3 class="card-title text-lg mb-4 border-b pb-2">Notes & Verification</h3>
          <div class="form-field">
            <label>Technician Notes/Findings</label>
            <textarea id="maint-notes" rows="4" placeholder="Enter findings, recommendations, etc."></textarea>
          </div>

          <div class="form-field mt-4">
            <label>Photos (Max 10)</label>
            <input type="file" id="maint-photos" accept="image/*" multiple style="display: none;" />
            <div class="photo-upload-multiple" id="maint-photo-upload">
              <i data-lucide="camera" class="w-6 h-6 mb-2"></i>
              <p>Tap to add photos</p>
            </div>
            <div class="photo-grid mt-4" id="maint-photo-grid"></div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
            <div class="form-field">
              <label>Technician Signature</label>
              <div class="signature-container bg-slate-50 dark:bg-slate-900 border rounded-lg h-40 relative">
                <canvas id="maint-tech-sig-canvas" class="signature-canvas w-full h-full"></canvas>
                <div class="signature-placeholder absolute inset-0 flex items-center justify-center text-muted pointer-events-none" id="maint-tech-sig-placeholder">
                  Sign Here
                </div>
              </div>
              <button type="button" class="btn btn-sm btn-ghost mt-2" id="clear-maint-tech-sig">Clear</button>
            </div>

            <div class="form-field">
              <label>Client Signature</label>
              <div class="signature-container bg-slate-50 dark:bg-slate-900 border rounded-lg h-40 relative">
                <canvas id="maint-client-sig-canvas" class="signature-canvas w-full h-full"></canvas>
                <div class="signature-placeholder absolute inset-0 flex items-center justify-center text-muted pointer-events-none" id="maint-client-sig-placeholder">
                  Sign Here
                </div>
              </div>
              <button type="button" class="btn btn-sm btn-ghost mt-2" id="clear-maint-client-sig">Clear</button>
            </div>
          </div>
        </div>

        <div class="form-field mt-8">
          <button id="submit-maint-visit" class="btn btn-primary w-full py-3 text-lg">
            Submit Maintenance Visit
          </button>
        </div>
      </div>
    </div>
  `;

  if (window.lucide) lucide.createIcons();

  initMaintenanceVisitForm(locationData);
}

function initMaintenanceVisitForm(locationData) {
  window.technicianVisitForm = {
    selectedCompany: locationData.type === 'company' ? locationData : null,
    capturedLocation: null,
    technicianSignature: null,
    clientSignature: null,
    photos: []
  };

  // 1. Inverter Auto-fill
  const manufacturerSelect = document.getElementById('maint-inverter-manufacturer');
  const modelList = document.getElementById('maint-inverter-model');
  manufacturerSelect.addEventListener('change', (e) => {
    const brand = e.target.value;
    modelList.innerHTML = '<option value="">Select Model</option>';
    if (INVERTER_MODELS[brand]) {
      INVERTER_MODELS[brand].forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.model; opt.textContent = m.model;
        modelList.appendChild(opt);
      });
    }
  });

  // 2. GPS Logic
  const gpsBtn = document.getElementById('maint-capture-gps-btn');
  const gpsInput = document.getElementById('maint-gps-coordinates');
  gpsBtn.addEventListener('click', () => {
    gpsBtn.disabled = true; gpsBtn.innerHTML = '...';
    navigator.geolocation.getCurrentPosition((pos) => {
      window.technicianVisitForm.capturedLocation = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      gpsInput.value = `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`;
      gpsBtn.className = 'btn btn-success flex-1'; gpsBtn.innerHTML = 'Captured'; gpsBtn.disabled = false;
    });
  });

  // 3. Photo Logic
  const photoInput = document.getElementById('maint-photos');
  const photoArea = document.getElementById('maint-photo-upload');
  photoArea.addEventListener('click', () => photoInput.click());
  photoInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files).slice(0, 10);
    const grid = document.getElementById('maint-photo-grid');
    grid.innerHTML = 'Compressing...';
    const processed = [];
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      processed.push(await compressImage(file));
    }
    window.technicianVisitForm.photos = processed;
    grid.innerHTML = processed.map(p => {
      const url = p.dataUrl || (p instanceof File ? URL.createObjectURL(p) : 'https://via.placeholder.com/300x300?text=No+Preview');
      return `<img src="${url}" class="aspect-square object-cover rounded">`;
    }).join('');
  });

  // 4. Signature Logic
  setTimeout(() => {
    setupMaintCanvas('maint-tech-sig-canvas', 'tech');
    setupMaintCanvas('maint-client-sig-canvas', 'client');
  }, 100);

  function setupMaintCanvas(id, type) {
    const canvas = document.getElementById(id);
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width; canvas.height = rect.height;
    ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    let drawing = false;
    const getPos = (e) => {
      const r = canvas.getBoundingClientRect();
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      return { x: cx - r.left, y: cy - r.top };
    };
    canvas.addEventListener('mousedown', (e) => { drawing = true; ctx.beginPath(); const { x, y } = getPos(e); ctx.moveTo(x, y); document.getElementById(`maint-${type}-sig-placeholder`).style.display = 'none'; });
    canvas.addEventListener('mousemove', (e) => { if (!drawing) return; const { x, y } = getPos(e); ctx.lineTo(x, y); ctx.stroke(); });
    canvas.addEventListener('mouseup', () => { drawing = false; window.technicianVisitForm[`${type === 'tech' ? 'technician' : 'client'}Signature`] = canvas.toDataURL(); });
    canvas.addEventListener('touchstart', (e) => { drawing = true; ctx.beginPath(); const { x, y } = getPos(e); ctx.moveTo(x, y); document.getElementById(`maint-${type}-sig-placeholder`).style.display = 'none'; e.preventDefault(); });
    canvas.addEventListener('touchmove', (e) => { if (!drawing) return; const { x, y } = getPos(e); ctx.lineTo(x, y); ctx.stroke(); e.preventDefault(); });
    canvas.addEventListener('touchend', () => { drawing = false; window.technicianVisitForm[`${type === 'tech' ? 'technician' : 'client'}Signature`] = canvas.toDataURL(); });
    document.getElementById(`clear-maint-${type}-sig`).addEventListener('click', () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      document.getElementById(`maint-${type}-sig-placeholder`).style.display = 'flex';
      window.technicianVisitForm[`${type === 'tech' ? 'technician' : 'client'}Signature`] = null;
    });
  }

  // 5. Submit Logic
  document.getElementById('submit-maint-visit').addEventListener('click', async () => {
    const btn = document.getElementById('submit-maint-visit');
    if (!window.technicianVisitForm.technicianSignature) { showToast('Technician signature required', 'error'); return; }
    btn.disabled = true; btn.innerHTML = 'Submitting...';

    try {
      const photoUrls = [];

      for (const p of window.technicianVisitForm.photos) {
        const fileToUpload = p.file || (p instanceof File ? p : null);
        if (!fileToUpload) { console.warn('Maint: Invalid photo object', p); continue; }
        const fileName = fileToUpload.name ? fileToUpload.name.replace(/[^a-zA-Z0-9.]/g, '_') : `photo-${Date.now()}.jpg`;
        const path = `technician-photos/${currentUser.id}/${Date.now()}-${fileName}`;

        const { error } = await supabaseClient.storage.from('safitrack').upload(path, fileToUpload, {
          contentType: 'image/jpeg',
          upsert: true
        });
        if (!error) {
          const { data } = supabaseClient.storage.from('safitrack').getPublicUrl(path);

          photoUrls.push(data.publicUrl);
        } else {
          console.error('Maint: Upload error detail:', error);
        }
      }

      const checklist = [];
      document.querySelectorAll('.maint-checklist-item:checked').forEach(i => checklist.push(i.dataset.item));

      const formData = {
        visit_date: document.getElementById('maint-visit-date').value,
        amc_reference: document.getElementById('maint-reference').value,
        inverter_manufacturer: manufacturerSelect.value,
        inverter_model: modelList.value,
        battery_brand: document.getElementById('maint-battery-brand').value,
        battery_specs: document.getElementById('maint-battery-specs').value,
        charging_amps: document.getElementById('maint-charging-amps').value,
        backup_obs: document.getElementById('maint-backup-obs').value,
        batt_vdc: document.getElementById('maint-batt-vdc').value,
        cleanliness: document.getElementById('maint-cleanliness').value,
        checklist: checklist,
        technician_notes: document.getElementById('maint-notes').value
      };

      const visitData = {
        technician_id: currentUser.id,
        company_id: locationData.type === 'company' ? locationData.id : null,
        company_name: locationData.name,
        location_name: locationData.type === 'custom' ? locationData.name : null,
        form_type: 'maintenance_visit',
        visit_type: 'maintenance',
        visit_notes: formData.technician_notes || 'Maintenance completed',
        technician_signature: window.technicianVisitForm.technicianSignature,
        client_signature: window.technicianVisitForm.clientSignature,
        photos: photoUrls.length > 0 ? photoUrls : null,
        latitude: window.technicianVisitForm.capturedLocation?.latitude,
        longitude: window.technicianVisitForm.capturedLocation?.longitude,
        created_at: new Date().toISOString(),
        form_data: formData,
        organization_id: currentOrganization?.id
      };

      const { error } = await supabaseClient.from('technician_visits').insert([visitData]);
      if (error) throw error;
      showToast('Maintenance Visit Submitted!', 'success');
      setTimeout(() => renderTechnicianCompanyDashboard(locationData), 1500);
    } catch (e) {
      console.error(e); showToast('Error: ' + e.message, 'error'); btn.disabled = false; btn.innerHTML = 'Submit Maintenance Visit';
    }
  });
}

async function compressImage(file, maxWidth = 1200, quality = 0.7) {

  return new Promise((resolve) => {
    try {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);


      img.onload = () => {

        URL.revokeObjectURL(objectUrl);
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = (maxWidth / width) * height;
          width = maxWidth;

        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          if (!blob) {
            console.error('Canvas toBlob failed, returning original file');
            resolve({ file: file, dataUrl: canvas.toDataURL('image/jpeg', quality) });
            return;
          }
          const compressedFile = new File([blob], file.name || 'photo.jpg', {
            type: 'image/jpeg',
            lastModified: Date.now(),
          });

          resolve({ file: compressedFile, dataUrl: canvas.toDataURL('image/jpeg', quality) });
        }, 'image/jpeg', quality);
      };

      img.onerror = (err) => {
        console.error('Image element failed to load file:', err);
        URL.revokeObjectURL(objectUrl);
        resolve({ file: file, dataUrl: null });
      };

      img.src = objectUrl;
    } catch (err) {
      console.error('Compression crash error:', err);
      resolve({ file: file, dataUrl: null });
    }
  });
}

function handleImageError(img) {
  img.src = 'https://via.placeholder.com/300x300?text=No+Preview';
}

// Update the renderTechnicianActivityView function to properly display photos
async function renderTechnicianActivityView() {
  const { data: visits, error } = await supabaseClient
    .from('technician_visits')
    .select(`
      *,
      companies(
        name,
        description
      )
    `)
    .eq('technician_id', currentUser.id)
    .order('created_at', { ascending: false });

  if (error) {
    viewContainer.innerHTML = renderError(error.message);
    return;
  }

  let html = `
    <div class="page-header">
      <h1 class="page-title">My Service Visits</h1>
    </div>
  `;

  if (visits.length === 0) {
    html += `
      <div class="card">
        <div class="empty-state">
          <i data-lucide="construction" class="empty-state-icon"></i>
          <h3 class="empty-state-title">No service visits yet</h3>
          <p class="empty-state-description">Start logging your service visits to see them here.</p>
          <button class="btn btn-primary" onclick="loadView('technician-log-visit')">
            <i data-lucide="plus"></i> Log Your First Visit
          </button>
        </div>
      </div>
    `;
  } else {
    visits.forEach(visit => {
      html += renderTechnicianVisitCard(visit);
    });
  }

  viewContainer.innerHTML = html;
}

function renderTechnicianVisitCard(visit) {
  const date = formatDate(visit.created_at);
  const companyName = visit.company_name || visit.companies?.name || 'Unknown Company';



  const visitTypeLabels = {
    'installation': 'Installation',
    'maintenance': 'Maintenance',
    'repair': 'Repair',
    'inspection': 'Inspection',
    'emergency': 'Emergency / Call-out'
  };

  return `
    <div class="technician-visit-card">
      <div class="technician-visit-header">
        <div>
          <div class="technician-visit-company">${companyName}</div>
          <div class="text-muted" style="font-size: 0.875rem;">${date}</div>
        </div>
      </div>
      
      <div class="technician-visit-meta">
        <span class="technician-visit-meta-item">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-wrench-icon lucide-wrench"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"/></svg>
          ${visitTypeLabels[visit.visit_type]}
        </span>
        <span class="technician-visit-meta-item">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-boxes-icon lucide-boxes"><path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z"/><path d="m7 16.5-4.74-2.85"/><path d="m7 16.5 5-3"/><path d="M7 16.5v5.17"/><path d="M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z"/><path d="m17 16.5-5-3"/><path d="m17 16.5 4.74-2.85"/><path d="M17 16.5v5.17"/><path d="M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z"/><path d="M12 8 7.26 5.15"/><path d="m12 8 4.74-2.85"/><path d="M12 13.5V8"/></svg>
          ${visit.work_category}
        </span>
        ${visit.latitude && visit.longitude ? `
          <span class="technician-visit-meta-item">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-pin-icon lucide-map-pin"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>
            Location captured
          </span>
        ` : ''}
      </div>

      ${visit.visit_notes ? `
        <div class="visit-notes mb-2">${visit.visit_notes}</div>
      ` : ''}

      ${visit.follow_up_notes ? `
        <div class="ai-insight">
          <div class="ai-insight-header">
            <i data-lucide="alert-circle"></i> Follow-up Required
          </div>
          <div class="ai-insight-content">${visit.follow_up_notes}</div>
        </div>
      ` : ''}

          ${visit.photos && visit.photos.length > 0 ? `
        <div class="photo-grid photo-grid-3 mb-2">
          ${visit.photos.map((photo, index) => `
            <div class="photo-item" onclick="openPhotoModal('${photo}')">
              <img src="${photo}" alt="Visit photo ${index + 1}" onerror="handleImageError(this)">
            </div>
          `).join('')}
          ${visit.photos.length > 3 ? `
            <div class="photo-item photo-item-more">
              <span class="text-muted">+${visit.photos.length - 3} more</span>
            </div>
          ` : ''}
        </div>
      ` : ''}

      <div class="flex items-center justify-between mt-2">
        <div class="flex gap-2">
          ${visit.client_signature ? `
            <span class="tag" style="background: var(--color-success-bg); color: var(--color-success);">
              <i class="fas fa-signature"></i> Client signed
            </span>
          ` : ''}
          ${visit.technician_signature ? `
            <span class="tag" style="background: var(--color-primary-bg); color: var(--color-primary);">
              <i class="fas fa-signature"></i> Technician signed
            </span>
          ` : ''}
        </div>
      </div>
    </div>
  `;
}


function renderTechnicianVisitCard(visit) {
  const date = formatDate(visit.created_at);
  const companyName = visit.company_name || visit.companies?.name || 'Unknown Company';



  const visitTypeLabels = {
    'installation': 'Installation',
    'maintenance': 'Maintenance',
    'repair': 'Repair',
    'inspection': 'Inspection',
    'emergency': 'Emergency / Call-out'
  };

  const workCategoryLabels = {
    'electrical': 'Electrical',
    'solar': 'Solar',
    'networking': 'Networking',
    'mechanical': 'Mechanical',
    'other': visit.other_work_category || 'Other'
  };

  return `
    <div class="technician-visit-card">
      <div class="technician-visit-header">
        <div>
          <div class="technician-visit-company">${companyName}</div>
          <div class="text-muted" style="font-size: 0.875rem;">${date}</div>
        </div>
      </div>
      
      <div class="technician-visit-meta">
        <span class="technician-visit-meta-item">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-wrench-icon lucide-wrench"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"/></svg>
          ${visitTypeLabels[visit.visit_type]}
        </span>
        <span class="technician-visit-meta-item">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-boxes-icon lucide-boxes"><path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z"/><path d="m7 16.5-4.74-2.85"/><path d="m7 16.5 5-3"/><path d="M7 16.5v5.17"/><path d="M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z"/><path d="m17 16.5-5-3"/><path d="m17 16.5 4.74-2.85"/><path d="M17 16.5v5.17"/><path d="M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z"/><path d="M12 8 7.26 5.15"/><path d="m12 8 4.74-2.85"/><path d="M12 13.5V8"/></svg>
          ${workCategoryLabels[visit.work_category]}
        </span>
        ${visit.latitude && visit.longitude ? `
          <span class="technician-visit-meta-item">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-pin-icon lucide-map-pin"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>
            Location captured
          </span>
        ` : ''}
      </div>

      ${visit.visit_notes ? `
        <div class="visit-notes mb-2">${visit.visit_notes}</div>
      ` : ''}

      ${visit.follow_up_notes ? `
        <div class="ai-insight">
          <div class="ai-insight-header">
            <i class="fas fa-exclamation-circle"></i> Follow-up Required
          </div>
          <div class="ai-insight-content">${visit.follow_up_notes}</div>
        </div>
      ` : ''}

          ${visit.photos && visit.photos.length > 0 ? `
        <div class="photo-grid photo-grid-3 mb-2">
          ${visit.photos.slice(0, 3).map(photo => `
            <div class="photo-item">
              <img src="${photo}" alt="Visit photo" onclick="openPhotoModal('${photo}')" onerror="handleImageError(this)">
            </div>
          `).join('')}
          ${visit.photos.length > 3 ? `
            <div class="photo-item photo-item-more">
              <span class="text-muted">+${visit.photos.length - 3} more</span>
            </div>
          ` : ''}
        </div>
      ` : ''}

      <div class="flex items-center justify-between mt-2">
        <div class="flex gap-2">
          ${visit.client_signature ? `
            <span class="tag" style="background: var(--color-success-bg); color: var(--color-success);">
              <i class="fas fa-signature"></i> Client signed
            </span>
          ` : ''}
          ${visit.technician_signature ? `
            <span class="tag" style="background: var(--color-primary-bg); color: var(--color-primary);">
              <i class="fas fa-signature"></i> Technician signed
            </span>
          ` : ''}
        </div>
        
        ${isManager ? `
          <button class="btn btn-sm btn-secondary" onclick="generateTechnicianVisitPDF('${visit.id}')">
            <i data-lucide="file-text"></i> PDF
          </button>
        ` : ''}
      </div>
    </div>
  `;
}

// ======================
// TECHNICIANS DASHBOARD VIEW (for managers)
// ======================

async function renderTechniciansDashboardView() {
  // Fetch technician visits without relation joins (avoids FK alias/schema cache issues)
  let visitsQ = supabaseClient.from('technician_visits').select('*').order('created_at', { ascending: false });
  let techQ = supabaseClient.from('profiles').select('id, first_name, last_name, email').eq('role', 'technician').order('first_name', { ascending: true });
  if (currentOrganization?.id) {
    visitsQ = visitsQ.eq('organization_id', currentOrganization.id);
    techQ = techQ.eq('organization_id', currentOrganization.id);
  }

  // Fetch technician visits and all technicians
  const { data: rawVisits, error: visitsError } = await visitsQ;
  const { data: technicians, error: techError } = await techQ;

  if (visitsError || techError) {
    crmDebugLog('renderTechniciansDashboardView.error', {
      visitsError,
      techError
    });
    viewContainer.innerHTML = renderError('Error loading technician data');
    return;
  }

  const visits = rawVisits || [];

  const companyIds = [...new Set(visits.map((visit) => visit.company_id).filter(Boolean))];
  let companiesById = new Map();

  if (companyIds.length > 0) {
    const { data: companies, error: companiesError } = await supabaseClient
      .from('companies')
      .select('id, name, description')
      .in('id', companyIds);

    if (companiesError) {
      crmDebugLog('renderTechniciansDashboardView.companiesError', companiesError);
    } else {
      companiesById = new Map((companies || []).map((company) => [String(company.id), company]));
    }
  }

  const techniciansById = new Map((technicians || []).map((technician) => [String(technician.id), technician]));

  const hydratedVisits = visits.map((visit) => ({
    ...visit,
    technician: techniciansById.get(String(visit.technician_id)) || null,
    companies: visit.company_id ? companiesById.get(String(visit.company_id)) || null : null
  }));

  crmDebugLog('renderTechniciansDashboardView.data', {
    visitsCount: hydratedVisits.length,
    techniciansCount: (technicians || []).length,
    companyRefsCount: companyIds.length,
    sampleVisit: hydratedVisits.length > 0 ? hydratedVisits[0] : null
  });

  // Calculate statistics
  const totalVisits = hydratedVisits.length;
  const totalTechnicians = technicians.length;
  const todayVisits = hydratedVisits.filter(v => {
    const visitDate = new Date(v.created_at).toDateString();
    return visitDate === new Date().toDateString();
  }).length;



  let html = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${totalVisits}</div>
        <div class="stat-label">Total Service Visits</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${totalTechnicians}</div>
        <div class="stat-label">Active Technicians</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${todayVisits}</div>
        <div class="stat-label">Visits Today</div>
      </div>
    </div>

    
    <!-- Filters -->
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Filter Visits</h3>
      </div>
      <div class="technician-filters-row">
        <select class="technician-filter-control" id="filter-company">
          <option value="">All Companies</option>
          ${Array.from(companiesById.values()).map(c => `
            <option value="${c.id}">${c.name}</option>
          `).join('')}
        </select>
        <select class="technician-filter-control" id="filter-technician">
          <option value="">All Technicians</option>
          ${technicians.map(tech => `
            <option value="${tech.id}">${tech.first_name} ${tech.last_name}</option>
          `).join('')}
        </select>

        <select class="technician-filter-control" id="filter-type">
          <option value="">All Types</option>
          <option value="installation">Installation</option>
          <option value="maintenance">Maintenance</option>
          <option value="repair">Repair</option>
          <option value="inspection">Inspection</option>
          <option value="emergency">Emergency</option>
        </select>
        <input type="date" class="technician-filter-control" id="filter-date">
        <button class="btn btn-secondary" id="clear-filters">
          Clear Filters
        </button>
      </div>
    </div>

    <!-- Visits List -->
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Recent Service Visits</h3>
        <span class="text-muted">${hydratedVisits.length} total visits</span>
      </div>
      
      <div id="technician-visits-list">
  `;

  if (hydratedVisits.length === 0) {
    html += `
      <div class="empty-state">
        <i class="fas fa-tools empty-state-icon"></i>
        <h3 class="empty-state-title">No service visits yet</h3>
        <p class="empty-state-description">Technicians will appear here when they start logging visits.</p>
      </div>
    `;
  } else {
    hydratedVisits.slice(0, 20).forEach(visit => {
      html += renderTechnicianVisitCardForManager(visit);
    });
  }

  html += `
      </div>
      ${hydratedVisits.length > 20 ? `
        <div class="text-center mt-3">
          <button class="btn btn-secondary" id="load-more-visits">
            Load More (${hydratedVisits.length - 20} remaining)
          </button>
        </div>
      ` : ''}
    </div>
  `;

  viewContainer.innerHTML = html;

  // Technician locations map removed per request

  // Initialize filters
  const companiesArray = Array.from(companiesById.values());
  initTechnicianFilters(hydratedVisits, technicians, companiesArray);
}

function renderTechnicianVisitCardForManager(visit) {
  const date = formatDate(visit.created_at);
  // Use visit.company_name first (for custom locations), then fallback to joined companies data
  const companyName = visit.company_name || visit.companies?.name || 'Unknown Company';
  const technicianName = visit.technician ?
    `${visit.technician.first_name} ${visit.technician.last_name}` : 'Unknown Technician';



  const visitTypeLabels = {
    'installation': 'Installation',
    'maintenance': 'Maintenance',
    'repair': 'Repair',
    'inspection': 'Inspection',
    'emergency': 'Emergency / Call-out'
  };

  return `
    <div class="technician-visit-card" 
        data-technician="${visit.technician_id}"
        data-type="${visit.visit_type}"
        data-date="${new Date(visit.created_at).toISOString().split('T')[0]}">
      <div class="technician-visit-header">
        <div>
          <div class="technician-visit-company">${companyName}</div>
          <div class="text-prim" style="font-size: 0.875rem;">
            <span class="badge badge-sm badge-outline mr-2">${formatFormType(visit.form_type)}</span>
          </div>
        </div>
      </div>
      
      <div class="technician-visit-meta">
        <span class="technician-visit-meta-item">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-wrench-icon lucide-wrench"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"/></svg>
          ${visitTypeLabels[visit.visit_type]}
        </span>
        <span class="technician-visit-meta-item">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-boxes-icon lucide-boxes"><path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z"/><path d="m7 16.5-4.74-2.85"/><path d="m7 16.5 5-3"/><path d="M7 16.5v5.17"/><path d="M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z"/><path d="m17 16.5-5-3"/><path d="m17 16.5 4.74-2.85"/><path d="M17 16.5v5.17"/><path d="M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z"/><path d="M12 8 7.26 5.15"/><path d="m12 8 4.74-2.85"/><path d="M12 13.5V8"/></svg>
          ${visit.work_category}
        </span>
        ${visit.latitude && visit.longitude ? `
          <span class="technician-visit-meta-item">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-pin-icon lucide-map-pin"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>
            ${visit.latitude.toFixed(4)}, ${visit.longitude.toFixed(4)}
          </span>
        ` : ''}
      </div>

      ${visit.visit_notes ? `
        <div class="visit-notes mb-2">${visit.visit_notes}</div>
      ` : ''}

      ${visit.form_data && Object.keys(visit.form_data).length > 0 ? `
        <div class="mt-4 mb-4">
          <button class="btn btn-xs btn-ghost text-primary flex items-center gap-1" onclick="this.nextElementSibling.classList.toggle('hidden'); if(window.lucide) lucide.createIcons();">
             <i data-lucide="info" style="width: 14px; height: 14px;"></i> View Detailed Technical Report
          </button>
          <div class="hidden mt-3 p-5 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-slate-200/60 dark:border-slate-800 shadow-sm">
            <div class="flex items-center justify-between mb-4 border-b border-slate-200 dark:border-slate-800 pb-2">
              <h4 class="text-sm font-bold text-slate-700 dark:text-slate-200">Technical Report Details</h4>
              <span class="text-[10px] font-bold text-primary uppercase tracking-widest bg-primary/10 px-2 py-0.5 rounded-full">${formatFormType(visit.form_type).replace('Visit', '')}</span>
            </div>
            
            <div class="space-y-6">
              ${(() => {
        const data = visit.form_data;
        const groups = {
          'System Configuration': ['inverter_manufacturer', 'inverter_model', 'inverter_serial', 'inverter_kva', 'inverter_type', 'system_size', 'roof_type', 'inverter_location', 'battery_location'],
          'Battery Specifications': ['battery_brand', 'battery_qty', 'battery_volts', 'battery_ah', 'battery_specs', 'batt_vdc'],
          'Performance Metrics': ['input_vac', 'output_vac', 'pv_voltage', 'pv_amps', 'charging_amps', 'cleanliness'],
          'Visit Information': ['visit_date', 'client_address', 'reference_number', 'amc_reference']
        };

        let groupsHtml = '';

        // Render Categorized Groups
        for (const [groupName, keys] of Object.entries(groups)) {
          const groupData = keys.filter(k => data[k] && data[k] !== '');
          if (groupData.length > 0) {
            groupsHtml += `
                    <div>
                      <h5 class="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">${groupName}</h5>
                      <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
                        ${groupData.map(key => {
              const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
              return `
                            <div>
                              <div class="text-[10px] text-slate-500 mb-0.5">${label}</div>
                              <div class="text-sm font-semibold text-slate-800 dark:text-slate-200">${data[key]}</div>
                            </div>
                          `;
            }).join('')}
                      </div>
                    </div>
                  `;
          }
        }

        // Render Checklist separately
        if (data.checklist && Array.isArray(data.checklist) && data.checklist.length > 0) {
          groupsHtml += `
                  <div>
                    <h5 class="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Service Checklist</h5>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      ${data.checklist.map(item => `
                        <div class="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-800 p-2 rounded-lg border border-slate-100 dark:border-slate-700">
                          <i data-lucide="check-circle-2" class="text-success w-3.5 h-3.5"></i>
                          <span>${item}</span>
                        </div>
                      `).join('')}
                    </div>
                  </div>
                `;
        }

        // Render Notes
        if (data.technician_notes || data.notes) {
          groupsHtml += `
                  <div class="pt-2 border-t border-slate-200 dark:border-slate-800">
                    <h5 class="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Technician Notes</h5>
                    <p class="text-sm text-slate-700 dark:text-slate-300 italic">"${data.technician_notes || data.notes}"</p>
                  </div>
                `;
        }

        return groupsHtml || '<p class="text-sm text-muted">No additional data available.</p>';
      })()}
            </div>
          </div>
        </div>
      ` : ''}

      ${visit.follow_up_notes ? `
        <div class="ai-insight">
          <div class="ai-insight-header">
            <i class="fas fa-exclamation-circle"></i> Follow-up Required
          </div>
          <div class="ai-insight-content">${visit.follow_up_notes}</div>
        </div>
      ` : ''}

      <div class="flex items-center justify-between mt-2">
        <div class="flex gap-2">
          ${visit.photos && visit.photos.length > 0 ? `
            <span class="tag" style="background: var(--color-primary-bg); color: var(--color-primary);">
              <i class="fas fa-camera"></i> ${visit.photos.length} photo(s)
            </span>
          ` : ''}
          ${visit.client_signature ? `
            <span class="tag" style="background: var(--color-success-bg); color: var(--color-success);">
              <i class="fas fa-signature"></i> Client signed
            </span>
          ` : ''}
        </div>
        
        <div class="flex gap-2">
          ${visit.latitude && visit.longitude ? `
            <button class="btn btn-sm btn-ghost" onclick="viewLocationOnMap(${visit.latitude}, ${visit.longitude}, '${companyName}')">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-icon lucide-map"><path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/></svg>View Map
            </button>
          ` : ''}
          <button class="btn btn-sm btn-secondary" onclick="generateTechnicianVisitPDF('${visit.id}')">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-file-text-icon lucide-file-text"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>PDF
          </button>
          <button class="btn btn-sm btn-ghost" onclick="viewTechnicianVisitDetails('${visit.id}')">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-eye-icon lucide-eye"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>Details
          </button>
        </div>
      </div>
    </div>
  `;
}
function initTechniciansMap(visits) {
  const mapElement = document.getElementById('technicians-map');
  if (!mapElement) return;

  // Filter visits with valid coordinates
  const validVisits = visits.filter(v => v.latitude && v.longitude);

  if (validVisits.length === 0) {
    mapElement.innerHTML = `
      <div class="flex items-center justify-center h-full">
        <div class="text-center">
          <i class="fas fa-map-marker-alt text-4xl text-muted mb-2"></i>
          <p class="text-muted">No location data available</p>
        </div>
      </div>
    `;
    return;
  }

  // Initialize map
  const map = L.map('technicians-map').setView(
    [validVisits[0].latitude, validVisits[0].longitude],
    12
  );

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
  }).addTo(map);

  // Add markers for each visit
  const markers = validVisits.map(visit => {
    // Use visit.company_name first (for custom locations), then fallback to joined companies data
    const companyName = visit.company_name || visit.companies?.name || 'Unknown Company';
    const technicianName = visit.technician ?
      `${visit.technician.first_name} ${visit.technician.last_name}` : 'Unknown';

    const statusColors = {
      'completed': 'green',
      'partially_completed': 'orange',
      'pending': 'blue',
      'follow_up': 'red'
    };

    const marker = L.marker([visit.latitude, visit.longitude], {
      icon: L.divIcon({
        className: 'technician-marker',
        html: `
          <div style="
            background: 'var(--color-primary)';
            color: white;
            width: 24px;
            height: 24px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            font-weight: bold;
            border: 2px solid white;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
          ">
            <i class="fas fa-wrench"></i>
          </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      })
    })
      .addTo(map)
      .bindPopup(`
        <div style="min-width: 200px;">
          <strong>${companyName}</strong><br>
          <small>${technicianName}</small><br>
          <hr style="margin: 8px 0;">
          <div><strong>Type:</strong> ${visit.visit_type}</div>

          <div><strong>Date:</strong> ${formatDate(visit.created_at)}</div>
          ${visit.visit_notes ? `<div><strong>Notes:</strong> ${visit.visit_notes.substring(0, 100)}${visit.visit_notes.length > 100 ? '...' : ''}</div>` : ''}
          <button class="btn btn-sm btn-primary w-full mt-2" onclick="viewTechnicianVisitDetails('${visit.id}')">
            View Details
          </button>
        </div>
      `);

    return marker;
  });

  // Fit map to show all markers
  if (markers.length > 0) {
    const group = new L.featureGroup(markers);
    map.fitBounds(group.getBounds().pad(0.1));
  }

  // Store map reference for refresh
  window.techniciansMap = map;
  window.techniciansMarkers = markers;
}

function initTechnicianFilters(visits, technicians, companies) {
  const companyFilter = document.getElementById('filter-company');
  const technicianFilter = document.getElementById('filter-technician');
  const typeFilter = document.getElementById('filter-type');
  const dateFilter = document.getElementById('filter-date');
  const clearFiltersBtn = document.getElementById('clear-filters');
  const loadMoreBtn = document.getElementById('load-more-visits');

  let filteredVisits = [...visits];
  let displayedCount = 20;

  function applyFilters() {
    const companyId = companyFilter ? companyFilter.value : '';
    const technicianId = technicianFilter.value;
    const type = typeFilter.value;
    const date = dateFilter.value;

    saveViewState({ technicianDashboard: { companyId, technicianId, type, date } });

    filteredVisits = visits.filter(visit => {
      if (companyId && String(visit.company_id) !== String(companyId)) return false;
      if (technicianId && visit.technician_id !== technicianId) return false;
      if (type && visit.visit_type !== type) return false;
      if (date) {
        const visitDate = new Date(visit.created_at).toISOString().split('T')[0];
        if (visitDate !== date) return false;
      }
      return true;
    });

    renderFilteredVisits();
  }

  function renderFilteredVisits() {
    const container = document.getElementById('technician-visits-list');
    const visitsToShow = filteredVisits.slice(0, displayedCount);

    if (visitsToShow.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i data-lucide="search" class="empty-state-icon"></i>
          <h3 class="empty-state-title">No visits found</h3>
          <p class="empty-state-description">Try adjusting your filters</p>
        </div>
      `;
    } else {
      container.innerHTML = visitsToShow.map(visit =>
        renderTechnicianVisitCardForManager(visit)
      ).join('');
    }

    // Update load more button
    if (loadMoreBtn) {
      const remaining = filteredVisits.length - displayedCount;
      if (remaining > 0) {
        loadMoreBtn.innerHTML = `Load More (${remaining} remaining)`;
        loadMoreBtn.style.display = 'block';
      } else {
        loadMoreBtn.style.display = 'none';
      }
    }
  }

  // Restore state
  const savedState = _loadPersistedState().technicianDashboard || {};
  if (companyFilter && savedState.companyId !== undefined) companyFilter.value = savedState.companyId;
  if (technicianFilter && savedState.technicianId !== undefined) technicianFilter.value = savedState.technicianId;
  if (typeFilter && savedState.type !== undefined) typeFilter.value = savedState.type;
  if (dateFilter && savedState.date !== undefined) dateFilter.value = savedState.date;

  // Add event listeners
  if (companyFilter) companyFilter.addEventListener('change', applyFilters);
  technicianFilter.addEventListener('change', applyFilters);
  typeFilter.addEventListener('change', applyFilters);
  dateFilter.addEventListener('change', applyFilters);

  // Apply filters initially to reflect restored state
  if (Object.keys(savedState).length > 0) {
    applyFilters();
  }

  clearFiltersBtn.addEventListener('click', () => {
    if (companyFilter) companyFilter.value = '';
    technicianFilter.value = '';
    typeFilter.value = '';
    dateFilter.value = '';
    displayedCount = 20;
    applyFilters();
  });

  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => {
      displayedCount += 20;
      renderFilteredVisits();
    });
  }

  // Technician locations map and refresh removed per request
}

// ======================
// PDF GENERATION FOR TECHNICIAN VISITS
// ======================

async function generateTechnicianVisitPDF(visitId) {
  showToast('Generating PDF report...', 'info');

  try {
    // Fetch visit data
    const { data: visit, error } = await supabaseClient
      .from('technician_visits')
      .select(`
        *,
        technician:profiles!technician_visits_technician_id_fkey(
          first_name,
          last_name,
          email
        ),
        companies(
          name,
          address,
          description
        )
      `)
      .eq('id', visitId)
      .single();

    if (error) throw error;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    let yPos = 20;

    // Color scheme
    const colors = {
      primary: [47, 95, 208],
      secondary: [99, 102, 241],
      success: [16, 185, 129],
      warning: [245, 158, 11],
      danger: [239, 68, 68],
      dark: [31, 41, 55],
      light: [243, 244, 246],
      white: [255, 255, 255]
    };

    // Helper: Add gradient header
    const addGradientHeader = () => {
      // Create gradient effect with overlapping rectangles
      doc.setFillColor(...colors.primary);
      doc.rect(0, 0, pageWidth, 50, 'F');

      doc.setFillColor(99, 102, 241, 0.3);
      doc.triangle(0, 0, pageWidth, 0, pageWidth, 50, 'F');
    };

    // Helper: Add footer
    const addFooter = (pageNum) => {
      doc.setFillColor(...colors.light);
      doc.rect(0, pageHeight - 15, pageWidth, 15, 'F');

      doc.setFontSize(8);
      doc.setTextColor(100, 100, 100);
      doc.text(`SafiTrack Service Report - Generated ${new Date().toLocaleDateString()}`, 20, pageHeight - 7);
      doc.text(`Page ${pageNum}`, pageWidth - 30, pageHeight - 7);
    };

    // Helper: Section header
    const addSectionHeader = (title, icon = '') => {
      if (yPos > pageHeight - 40) {
        doc.addPage();
        addGradientHeader();
        yPos = 60;
      }

      doc.setFillColor(...colors.primary);
      doc.roundedRect(20, yPos - 5, pageWidth - 40, 12, 2, 2, 'F');

      doc.setFontSize(12);
      doc.setTextColor(...colors.white);
      doc.setFont(undefined, 'bold');
      doc.text(title, 25, yPos + 3);

      yPos += 18;
      doc.setTextColor(...colors.dark);
      doc.setFont(undefined, 'normal');
    };

    // Helper: Info row with proper spacing
    const addInfoRow = (label, value) => {
      if (yPos > pageHeight - 25) {
        doc.addPage();
        addGradientHeader();
        addFooter(doc.internal.getNumberOfPages());
        yPos = 60;
      }

      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      doc.text('>', 22, yPos);

      doc.setFont(undefined, 'bold');
      doc.setTextColor(...colors.dark);
      doc.text(label + ':', 27, yPos);

      doc.setFont(undefined, 'normal');
      // Add extra spacing (3 spaces) after the colon
      const labelWidth = doc.getTextWidth(label + ':   ');

      // Handle long text with wrapping
      const maxWidth = pageWidth - 60;
      const lines = doc.splitTextToSize(value, maxWidth);

      lines.forEach((line, index) => {
        if (index === 0) {
          doc.text(line, 27 + labelWidth, yPos);
        } else {
          yPos += 6;
          if (yPos > pageHeight - 25) {
            doc.addPage();
            addGradientHeader();
            addFooter(doc.internal.getNumberOfPages());
            yPos = 60;
          }
          doc.text(line, 27 + labelWidth, yPos);
        }
      });

      yPos += 8;
    };



    // Helper: Fetch image with error handling
    const fetchImageAsBase64 = async (url) => {
      try {
        const response = await fetch(url);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch (err) {
        console.error('Error fetching image:', url, err);
        return null;
      }
    };

    // Fetch all media
    let photoDataUrls = [];
    if (visit.photos && visit.photos.length > 0) {
      showToast('Processing photos...', 'info');
      photoDataUrls = await Promise.all(visit.photos.map(url => fetchImageAsBase64(url)));
    }

    const clientSig = visit.client_signature ? await fetchImageAsBase64(visit.client_signature) : null;
    const techSig = visit.technician_signature ? await fetchImageAsBase64(visit.technician_signature) : null;

    // ==========================================
    // PAGE 1: HEADER & OVERVIEW
    // ==========================================
    let currentPage = 1;
    addGradientHeader();

    // Logo/Title - UPDATED
    doc.setFontSize(24);
    doc.setTextColor(...colors.white);
    doc.setFont(undefined, 'bold');
    doc.text('SafiTrack Technician Report', 20, 30);

    doc.setFontSize(11);
    doc.setFont(undefined, 'normal');
    doc.text('Service Visit Information', 20, 40);



    yPos = 60;

    // Report metadata box
    doc.setFillColor(250, 251, 252);
    doc.roundedRect(20, yPos, pageWidth - 40, 25, 3, 3, 'F');

    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text('REPORT ID:', 25, yPos + 7);
    doc.setTextColor(...colors.dark);
    doc.setFont(undefined, 'bold');
    doc.text(visit.id.substring(0, 16), 53, yPos + 7);

    doc.setFont(undefined, 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text('DATE:', 25, yPos + 14);
    doc.setTextColor(...colors.dark);
    const pdfDatePref2 = (typeof getUserDateFormat === 'function') ? getUserDateFormat() : (localStorage.getItem('safitrack_date_format') || 'DD/MM/YYYY');
    const created2 = new Date(visit.created_at);
    const createdDateStr2 = pdfDatePref2 === 'MM/DD/YYYY' ? `${String(created2.getMonth() + 1).padStart(2, '0')}/${String(created2.getDate()).padStart(2, '0')}/${created2.getFullYear()}` : `${String(created2.getDate()).padStart(2, '0')}/${String(created2.getMonth() + 1).padStart(2, '0')}/${created2.getFullYear()}`;
    doc.text(`${createdDateStr2} ${created2.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, 53, yPos + 14);

    doc.setTextColor(100, 100, 100);
    doc.text('GENERATED:', 25, yPos + 21);
    doc.setTextColor(...colors.dark);
    const now = new Date();
    const nowDateStr = pdfDatePref2 === 'MM/DD/YYYY' ? `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${now.getFullYear()}` : `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
    doc.text(`${nowDateStr} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, 53, yPos + 21);

    yPos += 35;

    // Company Information
    addSectionHeader('LOCATION & COMPANY');
    const companyName = visit.company_name || visit.companies?.name || 'Unknown Location';
    addInfoRow('Company Name', companyName);

    if (visit.companies?.address) {
      addInfoRow('Address', visit.companies.address);
    }
    if (visit.companies?.description) {
      addInfoRow('Description', visit.companies.description);
    }

    if (visit.latitude && visit.longitude) {
      const coordsStr = `${visit.latitude.toFixed(6)}, ${visit.longitude.toFixed(6)}`;
      addInfoRow('Coordinates', coordsStr);

      // Add 'View in Google Maps' button below coordinates, aligned left (match visit PDF style)
      const btnLabel = 'View in Google Maps';
      const btnWidth = doc.getTextWidth(btnLabel) + 12;
      const btnHeight = 6;
      const btnX = 27; // align with info row value
      const btnY = yPos - 4;
      const mapsUrl = `https://www.google.com/maps?q=${visit.latitude.toFixed(6)},${visit.longitude.toFixed(6)}`;
      doc.setFillColor(47, 95, 208);
      doc.roundedRect(btnX, btnY, btnWidth, btnHeight, 2, 2, 'F');
      doc.setFontSize(8);
      doc.setTextColor(255, 255, 255);
      const textX = btnX + btnWidth / 2 - doc.getTextWidth(btnLabel) / 2;
      const textY = btnY + btnHeight / 2 + 1;
      doc.textWithLink(btnLabel, textX, textY, { url: mapsUrl });
      yPos += btnHeight + 4;
      doc.setTextColor(0, 0, 0);
    }

    yPos += 5;

    // Visit Details
    addSectionHeader('SERVICE DETAILS');

    const visitTypeLabels = {
      'installation': 'Installation',
      'maintenance': 'Maintenance',
      'repair': 'Repair',
      'inspection': 'Inspection',
      'emergency': 'Emergency / Call-out'
    };

    addInfoRow('Form Type', formatFormType(visit.form_type));
    addInfoRow('Visit Type', visitTypeLabels[visit.visit_type] || visit.visit_type);

    const workCategory = visit.work_category + (visit.other_work_category ? ` (${visit.other_work_category})` : '');
    addInfoRow('Work Category', workCategory);



    yPos += 5;

    // Technician Info
    addSectionHeader('TECHNICIAN INFORMATION');
    if (visit.technician) {
      addInfoRow('Name', `${visit.technician.first_name} ${visit.technician.last_name}`);
      addInfoRow('Email', visit.technician.email);
    }

    // Add footer to first page
    addFooter(currentPage);

    // ==========================================
    // PAGE 2: NOTES & DETAILS
    // ==========================================
    doc.addPage();
    currentPage++;
    addGradientHeader();
    yPos = 60;

    // Visit Notes
    if (visit.visit_notes) {
      addSectionHeader('VISIT NOTES');

      doc.setFillColor(255, 251, 235);
      const notesLines = doc.splitTextToSize(visit.visit_notes, pageWidth - 50);
      const notesHeight = notesLines.length * 6 + 10;

      doc.roundedRect(20, yPos, pageWidth - 40, notesHeight, 3, 3, 'F');
      doc.setFontSize(10);
      doc.setTextColor(...colors.dark);
      notesLines.forEach((line, i) => {
        doc.text(line, 25, yPos + 7 + (i * 6));
      });
      yPos += notesHeight + 10;
    }

    // Improved: Grouped & All-inclusive Form Data
    if (visit.form_data && Object.keys(visit.form_data).length > 0) {
      const data = visit.form_data;
      const groups = {
        'System Configuration': ['inverter_manufacturer', 'inverter_model', 'inverter_serial', 'inverter_kva', 'inverter_type', 'system_size', 'roof_type', 'inverter_location', 'battery_location'],
        'Battery Specifications': ['battery_brand', 'battery_qty', 'battery_volts', 'battery_ah', 'battery_specs', 'batt_vdc'],
        'Performance Metrics': ['input_vac', 'output_vac', 'pv_voltage', 'pv_amps', 'charging_amps', 'cleanliness', 'charging_vdc', 'output_freq', 'backup_min'],
        'Visit Information': ['visit_date', 'client_address', 'reference_number', 'amc_reference']
      };

      // Track which keys have been rendered
      const renderedKeys = new Set();

      Object.entries(groups).forEach(([section, keys]) => {
        const sectionData = keys.filter(k => data[k] !== undefined && data[k] !== null && data[k] !== '');
        if (sectionData.length > 0) {
          addSectionHeader(section);
          sectionData.forEach(key => {
            const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            const value = data[key];
            if (Array.isArray(value)) {
              addInfoRow(label, value.join(', '));
            } else {
              addInfoRow(label, String(value));
            }
            renderedKeys.add(key);
          });
          yPos += 5;
        }
      });

      // Checklist
      if (data.checklist && Array.isArray(data.checklist) && data.checklist.length > 0) {
        addSectionHeader('Service Checklist');
        data.checklist.forEach(item => {
          addInfoRow('Checklist Item', item);
        });
        renderedKeys.add('checklist');
        yPos += 5;
      }

      // Technician Notes
      if (data.technician_notes || data.notes) {
        addSectionHeader('Technician Notes');
        addInfoRow('Notes', data.technician_notes || data.notes);
        renderedKeys.add('technician_notes');
        renderedKeys.add('notes');
        yPos += 5;
      }

      // Render any remaining fields not in groups
      const remaining = Object.entries(data).filter(([key, value]) => !renderedKeys.has(key) && value !== undefined && value !== null && value !== '');
      if (remaining.length > 0) {
        addSectionHeader('Additional Data');
        remaining.forEach(([key, value]) => {
          const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          if (Array.isArray(value)) {
            addInfoRow(label, value.join(', '));
          } else {
            addInfoRow(label, String(value));
          }
        });
        yPos += 5;
      }
    }

    // Follow-up Notes
    if (visit.follow_up_notes) {
      if (yPos > pageHeight - 60) {
        doc.addPage();
        currentPage++;
        addGradientHeader();
        addFooter(currentPage - 1);
        yPos = 60;
      }

      addSectionHeader('FOLLOW-UP REQUIRED');

      doc.setFillColor(254, 243, 199);
      const followUpLines = doc.splitTextToSize(visit.follow_up_notes, pageWidth - 50);
      const followUpHeight = followUpLines.length * 6 + 10;

      doc.roundedRect(20, yPos, pageWidth - 40, followUpHeight, 3, 3, 'F');

      doc.setFontSize(10);
      doc.setTextColor(...colors.dark);

      followUpLines.forEach((line, index) => {
        doc.text(line, 25, yPos + 8 + (index * 5));
      });

      yPos += followUpHeight + 10;
    }

    addFooter(currentPage);

    // ==========================================
    // PHOTOS SECTION
    // ==========================================
    if (photoDataUrls.length > 0) {
      doc.addPage();
      currentPage++;
      addGradientHeader();
      yPos = 60;

      addSectionHeader(`PHOTOS (${photoDataUrls.length} Total)`);

      const photosPerPage = 2;
      const photoWidth = pageWidth - 50;
      const photoHeight = 100;
      let photoCount = 0;

      for (let i = 0; i < photoDataUrls.length; i++) {
        const imgData = photoDataUrls[i];

        if (!imgData) continue;

        // Check if we need a new page
        if (yPos + photoHeight + 20 > pageHeight - 20) {
          addFooter(currentPage);
          doc.addPage();
          currentPage++;
          addGradientHeader();
          yPos = 60;

          if (photoCount % photosPerPage === 0) {
            addSectionHeader('PHOTOS (Continued)');
          }
        }

        try {
          // Add photo border/frame
          doc.setDrawColor(...colors.light);
          doc.setLineWidth(0.5);
          doc.roundedRect(20, yPos, photoWidth, photoHeight, 2, 2, 'S');

          // Add photo
          doc.addImage(imgData, 'JPEG', 22, yPos + 2, photoWidth - 4, photoHeight - 4);

          // Add photo caption
          doc.setFontSize(8);
          doc.setTextColor(100, 100, 100);
          doc.text(`Photo ${i + 1} of ${photoDataUrls.length}`, 25, yPos + photoHeight + 8);

          yPos += photoHeight + 15;
          photoCount++;

        } catch (err) {
          console.warn('Failed to add image:', err);
          doc.setFontSize(10);
          doc.setTextColor(...colors.danger);
          doc.text(`[Photo ${i + 1} could not be loaded]`, 25, yPos + 10);
          yPos += 20;
        }
      }

      addFooter(currentPage);
    }

    // ==========================================
    // SIGNATURES PAGE
    // ==========================================
    if (clientSig || techSig) {
      doc.addPage();
      currentPage++;
      addGradientHeader();
      yPos = 60;

      addSectionHeader('SIGNATURES');

      const sigWidth = (pageWidth - 50) / 2;
      const sigHeight = 60;

      // Client Signature
      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      doc.text('CLIENT SIGNATURE', 25, yPos);
      yPos += 8;

      if (clientSig) {
        try {
          doc.setDrawColor(...colors.light);
          doc.setLineWidth(0.5);
          doc.roundedRect(20, yPos, sigWidth, sigHeight, 2, 2, 'S');
          doc.addImage(clientSig, 'PNG', 22, yPos + 2, sigWidth - 4, sigHeight - 4);
        } catch (e) {
          doc.text('[Signature unavailable]', 25, yPos + 30);
        }
      } else {
        doc.setFillColor(...colors.light);
        doc.roundedRect(20, yPos, sigWidth, sigHeight, 2, 2, 'F');
        doc.setTextColor(150, 150, 150);
        doc.text('Not provided', 25, yPos + 30);
      }

      // Technician Signature
      doc.setTextColor(100, 100, 100);
      doc.text('TECHNICIAN SIGNATURE', pageWidth - sigWidth - 5, yPos - 8);

      if (techSig) {
        try {
          doc.setDrawColor(...colors.light);
          doc.roundedRect(pageWidth - sigWidth - 10, yPos, sigWidth, sigHeight, 2, 2, 'S');
          doc.addImage(techSig, 'PNG', pageWidth - sigWidth - 8, yPos + 2, sigWidth - 4, sigHeight - 4);
        } catch (e) {
          doc.text('[Signature unavailable]', pageWidth - sigWidth - 5, yPos + 30);
        }
      } else {
        doc.setFillColor(...colors.light);
        doc.roundedRect(pageWidth - sigWidth - 10, yPos, sigWidth, sigHeight, 2, 2, 'F');
        doc.setTextColor(150, 150, 150);
        doc.text('Not provided', pageWidth - sigWidth - 5, yPos + 30);
      }

      yPos += sigHeight + 20;

      // Certification statement
      doc.setFillColor(240, 253, 244);
      doc.roundedRect(20, yPos, pageWidth - 40, 25, 3, 3, 'F');

      doc.setFontSize(9);
      doc.setTextColor(...colors.dark);
      const certText = 'This service report certifies that the work described above was performed on the specified date. All information provided is accurate to the best of our knowledge.';
      const certLines = doc.splitTextToSize(certText, pageWidth - 50);

      certLines.forEach((line, index) => {
        doc.text(line, 25, yPos + 8 + (index * 5));
      });

      addFooter(currentPage);
    }

    // ==========================================
    // SAVE PDF
    // ==========================================
    const fileName = `SafiTrack_Service_Report_${companyName.replace(/\s+/g, '_')}_${new Date(visit.created_at).toISOString().split('T')[0]}.pdf`;

    doc.save(fileName);

    showToast('PDF generated successfully!', 'success');

  } catch (error) {
    console.error('Error generating PDF:', error);
    showToast('Failed to generate PDF: ' + error.message, 'error');
  }
}


// ======================
// UTILITY FUNCTIONS FOR TECHNICIANS
// ======================

window.viewLocationOnMap = function (latitude, longitude, title) {

  const oldModal = document.getElementById('location-modal');
  if (oldModal) {
    oldModal.remove();
  }


  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'flex';
  modal.id = 'location-modal';

  modal.innerHTML = `
    <div class="modal-backdrop" onclick="closeModal('location-modal')"></div>
    <div class="modal-container modal-size-lg">
      <div class="modal-header">
        <h3><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-locate-fixed-icon lucide-locate-fixed"><line x1="2" x2="5" y1="12" y2="12"/><line x1="19" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="5"/><line x1="12" x2="12" y1="19" y2="22"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/></svg>${title || 'Location'}</h3>
        <button class="modal-close" onclick="closeModal('location-modal')">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x-icon lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <div id="location-modal-map" class="u-map-lg"></div>
        <div class="mt-3">
          <p><strong>Coordinates:</strong> ${latitude.toFixed(6)}, ${longitude.toFixed(6)}</p>
          <a href="https://www.google.com/maps?q=${latitude},${longitude}" target="_blank" class="btn btn-sm btn-primary mt-2">
            <i class="fas fa-external-link-alt"></i> Open in Google Maps
          </a>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Initialize map
  setTimeout(() => {
    const map = L.map('location-modal-map').setView([latitude, longitude], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(map);

    L.marker([latitude, longitude])
      .addTo(map)
      .bindPopup(title || 'Visit Location')
      .openPopup();
  }, 100);
};

window.viewTechnicianVisitDetails = async function (visitId) {

  const oldModal = document.getElementById('visit-details-modal');
  if (oldModal) {
    oldModal.remove();
  }

  showToast('Loading visit details...', 'info');

  try {
    const { data: visit, error } = await supabaseClient
      .from('technician_visits')
      .select(`
        *,
        technician:profiles!technician_visits_technician_id_fkey(
          first_name,
          last_name,
          email
        ),
        companies(
          name,
          address,
          description
        )
      `)
      .eq('id', visitId)
      .single();

    if (error) throw error;




    const visitTypeLabels = {
      'installation': 'Installation',
      'maintenance': 'Maintenance',
      'repair': 'Repair',
      'inspection': 'Inspection',
      'emergency': 'Emergency / Call-out'
    };

    const companyName = visit.company_name || visit.companies?.name || 'Unknown Location';
    const companyAddress = visit.companies?.address || 'N/A';
    const companyDescription = visit.companies?.description || 'N/A';

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.id = 'visit-details-modal';

    modal.innerHTML = `
      <div class="modal-backdrop" onclick="closeModal('visit-details-modal')"></div>
      <div class="modal-container modal-size-lg">
        <div class="modal-header">
          <h3>Service Visit Details</h3>
          <div class="flex gap-2">
            <button class="btn btn-sm btn-secondary" onclick="generateTechnicianVisitPDF('${visitId}')">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-file-text-icon lucide-file-text"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v9a2 2 0 0 1 2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg> PDF
            </button>
            <button class="modal-close" onclick="closeModal('visit-details-modal')">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x-icon lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
        </div>
        <div class="modal-body">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h4>Company Information</h4>
              <p><strong>Name:</strong> ${companyName}</p>
              ${visit.companies ? `<p><strong>Address:</strong> ${companyAddress}</p>` : ''}
              ${visit.companies ? `<p><strong>Description:</strong> ${companyDescription}</p>` : ''}
            </div>
            <div>
              <h4>Visit Information</h4>
              <p><strong>Visit Type:</strong> ${visit.visit_type}</p>
              <p><strong>Work Category:</strong> ${visit.work_category}${visit.other_work_category ? ` (${visit.other_work_category})` : ''}</p>

            </div>
          </div>
          
          ${visit.latitude && visit.longitude ? `
            <div class="mt-4">
              <h4>Location</h4>
              <div id="visit-details-map" class="u-map-sm u-mt-md"></div>
            </div>
          ` : ''}

          ${visit.visit_notes ? `
            <div class="mt-4">
              <h4>Visit Notes</h4>
              <div class="bg-gray-50 p-3 rounded">${visit.visit_notes}</div>
            </div>
          ` : ''}

          ${visit.follow_up_notes ? `
            <div class="mt-4">
              <h4>Follow-up Required</h4>
              <div class="bg-yellow-50 p-3 rounded">${visit.follow_up_notes}</div>
            </div>
          ` : ''}
          
          ${visit.photos && visit.photos.length > 0 ? `
            <div class="mt-4">
              <h4>Photos (${visit.photos.length})</h4>
              <div class="photo-grid photo-grid-3">
                ${visit.photos.slice(0, 3).map(photo => `
                  <div class="photo-item">
                    <img src="${photo}" alt="Visit photo" onclick="openPhotoModal('${photo}')" onerror="handleImageError(this)">
                  </div>
                `).join('')}
                ${visit.photos.length > 3 ? `
                  <div class="photo-item photo-item-more">
                    <span class="text-muted">+${visit.photos.length - 3} more</span>
                  </div>
                ` : ''}
              </div>
            </div>
          ` : ''}
          
          <div class="mt-4">
            <h4>Signatures</h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p class="text-sm text-muted">Client Signature</p>
                ${visit.client_signature ? `<img src="${visit.client_signature}" alt="Client signature" style="max-height: 100px;" onerror="handleImageError(this)">` : 'Not provided'}
              </div>
              <div>
                <p class="text-sm text-muted">Technician Signature</p>
                ${visit.technician_signature ? `<img src="${visit.technician_signature}" alt="Technician signature" style="max-height: 100px;" onerror="handleImageError(this)">` : 'Not provided'}
              </div>
            </div>
          </div>

          ${visit.form_data && Object.keys(visit.form_data).length > 0 ? `
            <div class="mt-6 p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-100 dark:border-slate-800">
              <h4 class="text-sm font-bold text-muted uppercase tracking-wider mb-4">Detailed Form Data</h4>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                ${Object.entries(visit.form_data).map(([key, value]) => {
      if (value === undefined || value === null || value === '') return '';
      const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

      if (Array.isArray(value)) {
        return `<div class="col-span-2">
                      <span class="text-muted block text-xs uppercase font-semibold mb-1">${label}</span>
                      <div class="flex flex-wrap gap-1">
                        ${value.map(v => `<span class="tag tag-sm">${v}</span>`).join('')}
                      </div>
                    </div>`;
      }

      return `<div>
                    <span class="text-muted block text-xs uppercase font-semibold mb-1">${label}</span>
                    <span class="font-medium text-slate-900 dark:text-slate-100">${value}</span>
                  </div>`;
    }).join('')}
              </div>
            </div>
          ` : ''}
          
          <div class="mt-4">
            <h4>Technician</h4>
            <p><strong>Name:</strong> ${visit.technician.first_name} ${visit.technician.last_name}</p>
            <p><strong>Email:</strong> ${visit.technician.email}</p>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="closeModal('visit-details-modal')">
            Close
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Initialize map if location exists
    if (visit.latitude && visit.longitude) {
      setTimeout(() => {
        const map = L.map('visit-details-map').setView([visit.latitude, visit.longitude], 16);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap'
        }).addTo(map);

        // FIX: Use the 'companyName' variable (calculated earlier in the function)
        // instead of visit.companies.name. This handles custom locations safely.
        L.marker([visit.latitude, visit.longitude])
          .addTo(map)
          .bindPopup(companyName)
          .openPopup();

        // FIX: Force size recalculation to prevent blank map in modal
        setTimeout(() => {
          map.invalidateSize();
        }, 200);
      }, 100);
    }

  } catch (error) {
    console.error('Error loading visit details:', error);
    showToast('Error loading visit details: ' + error.message, 'error');
  }
};


window.openPhotoModal = function (photoUrl) {

  const oldModal = document.getElementById('photo-modal');
  if (oldModal) {
    oldModal.remove();
  }

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'flex';
  modal.id = 'photo-modal';

  modal.innerHTML = `
    <div class="modal-backdrop" onclick="closeModal('photo-modal')"></div>
    <div class="modal-container modal-size-photo">
      <div class="modal-header">
        <h3><i class="fas fa-camera"></i> Photo</h3>
        <button class="modal-close" onclick="closeModal('photo-modal')">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x-icon lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>
      <div class="modal-body u-flex-center">
        <img src="${photoUrl}" alt="Visit photo" class="u-photo-contain" onerror="handleImageError(this)">
      </div>
    </div>
  `;

  document.body.appendChild(modal);
};

// ==================== MENTION SYSTEM HELPERS ====================

function showMentionSuggestions(query, container) {
  const filteredPeople = allPeople.filter(person =>
    matchesTokenizedQuery(query, person.name, person.email, person.job_title, person.companies?.name)
  );


  if (filteredPeople.length === 0) {
    container.innerHTML = '<div class="mention-suggestion">No people found</div>';
  } else {
    container.innerHTML = filteredPeople.map(person => `
      <div class="mention-suggestion" data-person-id="${person.id}">
        <div class="mention-avatar">${getInitials(person.name)}</div>
        <div class="mention-info">
          <div class="mention-name">${person.name}</div>
          <div class="mention-details">${person.email || ''} ${person.companies ? `• ${person.companies.name}` : ''}</div>
        </div>
      </div>
    `).join('');
  }

  container.style.display = 'block';
}

function setActiveMention(items, activeIndex) {
  items.forEach((item, index) => {
    item.classList.toggle('active', index === activeIndex);
  });
}

function insertMentionFromSuggestion(suggestionEl, textareaEl, startIndex, query, containerEl) {


  const personId = suggestionEl.dataset.personId;
  const person = allPeople.find(p => String(p.id) === String(personId)); // Use string comparison for robustness



  if (!person) {
    console.error('❌ Person not found with ID:', personId);
    return;
  }

  const text = textareaEl.value;
  const cursorPos = textareaEl.selectionStart;
  const beforeMention = text.substring(0, startIndex);
  // Calculate afterMention from cursor position (accounts for partial typing)
  const afterMention = text.substring(cursorPos);



  // Insert mention with styling markup
  const mentionHTML = `@${person.name}`;
  const newText = `${beforeMention}${mentionHTML} ${afterMention}`;
  textareaEl.value = newText;



  // Add to mentioned people array
  if (!mentionedPeople.find(p => String(p.id) === String(personId))) {
    mentionedPeople.push({
      id: personId,
      name: person.name
    });
  }

  // Close suggestions
  containerEl.style.display = 'none';

  // Update cursor position (after the mention and space)
  const newCursorPos = beforeMention.length + mentionHTML.length + 1;
  textareaEl.focus();
  textareaEl.setSelectionRange(newCursorPos, newCursorPos);


}


// ======================
// SIDEBAR COLLAPSE LOGIC
// ======================

// ======================
// SIDEBAR COLLAPSE LOGIC (UPDATED WITH CUSTOM ICONS)
// ======================

document.addEventListener('DOMContentLoaded', () => {
  const sidebar = document.getElementById('sidebar');
  const sidebarToggle = document.getElementById('sidebar-toggle');

  if (!sidebar || !sidebarToggle) return;

  // Helper function to update the icon SVG based on sidebar state
  const updateSidebarIcon = () => {
    const isCollapsed = sidebar.classList.contains('collapsed');

    if (isCollapsed) {
      // Sidebar is HIDDEN (Collapsed): Show "Open" Icon (Arrows pointing OUT)
      sidebarToggle.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-panel-right-close-icon lucide-panel-right-close"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/><path d="m8 9 3 3-3 3"/></svg>`;
    } else {
      // Sidebar is VISIBLE (Expanded): Show "Close" Icon (Arrows pointing IN)
      sidebarToggle.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-panel-right-open-icon lucide-panel-right-open"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/><path d="m10 15-3-3 3-3"/></svg>`;
    }
  };


  // Helper to force layout update
  // Helper to force layout update
  const adjustMainContent = (isCollapsed) => {
    // Find the main content element
    const mainContent = document.querySelector('.main-content');

    if (isCollapsed) {
      // --- SIDEBAR IS COLLAPSED (60px) ---
      // 1. Calculate exact remaining width: Full Screen Width - Sidebar Width
      mainContent.style.width = 'calc(100vw - 60px)';

      // 2. Reduce margin to match the small sidebar
      mainContent.style.marginLeft = '60px';
    } else {
      // --- SIDEBAR IS EXPANDED (210px) ---
      // 1. Clear inline width so your existing CSS media query handles it
      mainContent.style.width = '';

      // 2. Clear inline margin so CSS handles it
      mainContent.style.marginLeft = '';
    }
  };


  // 1. Set the correct icon immediately on page load
  updateSidebarIcon();

  // 2. Add the click listener
  // Find your existing toggle listener and update it like this:
  sidebarToggle.addEventListener('click', () => {
    // Toggle the class
    const isNowCollapsed = sidebar.classList.toggle('collapsed');

    // Update the icon
    updateSidebarIcon();

    // <--- NEW: Force layout change --->
    adjustMainContent(isNowCollapsed);

    // Save state
    localStorage.setItem('sidebarCollapsed', isNowCollapsed);
  });

  // 3. Restore state on reload
  // Restore state on load
  const sidebarCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';

  if (sidebarCollapsed && window.innerWidth >= 768) {
    sidebar.classList.add('collapsed');
    updateSidebarIcon();

    // <--- NEW: Apply layout on load --->
    adjustMainContent(true);
  }

});

// Handle window resize to ensure icons stay correct if CSS forces a state change
window.addEventListener('resize', () => {
  const sidebar = document.getElementById('sidebar');
  const sidebarToggle = document.getElementById('sidebar-toggle');

  // If we switch to mobile, the sidebar is forced open/hidden by CSS media queries.
  // We force remove the collapsed class and reset the icon.
  if (window.innerWidth < 768) {
    sidebar.classList.remove('collapsed');
    // On mobile, the toggle button is usually hidden, but if visible:
    if (sidebarToggle) {
      sidebarToggle.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-panel-right-close-icon lucide-panel-right-close"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/><path d="m8 9 3 3-3 3"/></svg>`;
    }
  }
});


/**
 * Compress an image file
 * @param {File} file - The image file to compress
 * @param {number} quality - Compression quality (0.1 to 1.0)
 * @param {number} maxWidth - Maximum width (default 1200)
 * @param {number} maxHeight - Maximum height (default 1200)
 * @returns {Promise<File>} - Compressed file
 */




/**
 * Show compression progress
 * @param {string} message - Progress message
 */
function showCompressionProgress(message) {
  // Create or update progress toast
  let progressToast = document.getElementById('compression-progress-toast');

  if (!progressToast) {
    progressToast = document.createElement('div');
    progressToast.id = 'compression-progress-toast';
    progressToast.className = 'toast info';
    progressToast.style.position = 'fixed';
    progressToast.style.top = '20px';
    progressToast.style.right = '20px';
    progressToast.style.zIndex = '9999';
    document.body.appendChild(progressToast);
  }

  progressToast.innerHTML = `
    <i class="fas fa-compress fa-spin toast-icon"></i>
    <span class="toast-message">${message}</span>
  `;

  progressToast.style.display = 'flex';
}

function hideCompressionProgress() {
  const progressToast = document.getElementById('compression-progress-toast');
  if (progressToast) {
    progressToast.style.display = 'none';
  }
}

// ======================
// NOTES VIEW
// ======================

async function renderNotesView() {
  // Fetch user's notes
  const { data: notes, error } = await supabaseClient
    .from('notes')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('is_pinned', { ascending: false })
    .order('updated_at', { ascending: false });

  if (error) {
    viewContainer.innerHTML = renderError(error.message);
    return;
  }

  // Fetch companies and people for tagging
  const [companiesResult, peopleResult] = await Promise.all([
    supabaseClient.from('companies').select('id, name').order('name'),
    supabaseClient.from('people').select('id, name, company_id').order('name')
  ]);

  const companies = companiesResult.data || [];
  const people = (peopleResult.data || []).map((person) => {
    const company = companies.find((item) => String(item.id) === String(person.company_id)) || null;
    return {
      ...person,
      company,
      companies: company
    };
  });

  // Check if user has no notes
  if (notes.length === 0) {
    // Instead of showing empty state, directly open a new note editor
    let html = `
      <div class="notes-container">
        <!-- Left Sidebar -->
        <div class="notes-sidebar">
          <div class="notes-sidebar-header">
            <div class="search-container">
              <i class="fas fa-search"></i>
              <input type="text" id="notes-search" placeholder="Search notes...">
            </div>
            <button class="btn btn-primary btn-sm" id="add-note-btn">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-plus-icon lucide-plus"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
            </button>
          </div>
          
          <div class="notes-list" id="notes-list">
            <div class="empty-state">
              <i class="fas fa-sticky-note empty-state-icon"></i>
              <h3 class="empty-state-title">No notes yet</h3>
              <p class="empty-state-description">Creating your first note...</p>
            </div>
          </div>
        </div>

        <!-- Right Content Area -->
        <div class="notes-content">
          <div class="note-editor" id="note-editor">
            <!-- Note editor will be initialized here -->
          </div>
        </div>
      </div>
    `;

    viewContainer.innerHTML = html;

    // Initialize notes functionality
    initNotesView(notes, companies, people);

    // Automatically create a new note
    setTimeout(() => {
      createNewNote();
    }, 100);

    return;
  }

  // Original code for when notes exist
  let html = `
    <div class="notes-container">
      <!-- Left Sidebar -->
      <div class="notes-sidebar">
        <div class="notes-sidebar-header">
          <div class="search-container">
            <i class="fas fa-search"></i>
            <input type="text" id="notes-search" placeholder="Search notes...">
          </div>
          <button class="btn btn-primary btn-sm" id="add-note-btn">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-plus-icon lucide-plus"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
          </button>
        </div>
        
        <div class="notes-list" id="notes-list">
  `;

  notes.forEach(note => {
    const preview = note.content.replace(/<[^>]*>/g, '').substring(0, 100);
    html += `
      <div class="note-item ${note.id === (window.selectedNoteId || '') ? 'active' : ''}" data-id="${note.id}">
        <div class="note-item-header">
          <h4 class="note-item-title">${note.title}</h4>
          ${note.is_pinned ? '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2954be" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-pin-icon lucide-pin"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>' : ''}
        </div>
        <div class="note-item-preview">${preview}${preview.length >= 100 ? '...' : ''}</div>
        <div class="note-item-date">${formatDate(note.updated_at)}</div>
      </div>
    `;
  });

  html += `
        </div>
      </div>

      <!-- Right Content Area -->
      <div class="notes-content">
        <div class="note-editor" id="note-editor">
          <!-- Note content will be loaded here -->
        </div>
      </div>
    </div>
  `;

  viewContainer.innerHTML = html;

  // Initialize notes functionality
  initNotesView(notes, companies, people);

  // If there are notes, select the first one
  if (notes.length > 0) {
    selectNote(notes[0].id);
  }
}

function initNotesView(notes, companies, people) {
  // Store for global access
  window.allNotesData = notes;
  window.companiesData = companies;
  window.peopleData = people;
  window.selectedNoteId = null;
  window.isCreatingNewNote = false;

  // Add note button
  document.getElementById('add-note-btn').addEventListener('click', () => {
    createNewNote();
  });

  // Search functionality
  const searchInput = document.getElementById('notes-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();

      const filteredNotes = notes.filter(note =>
        note.title.toLowerCase().includes(query) ||
        note.content.toLowerCase().includes(query)
      );

      renderNotesList(filteredNotes);
    });
  }

  // Note item click handlers
  document.querySelectorAll('.note-item').forEach(item => {
    item.addEventListener('click', () => {
      const noteId = item.dataset.id;
      selectNote(noteId);
    });
  });

  // If there are notes, select the first one
  if (notes.length > 0) {
    selectNote(notes[0].id);
  }
}



function createNewNote() {
  // Set flags immediately
  window.isCreatingNewNote = true;
  window.selectedNoteId = null;

  // Update active state in sidebar immediately
  document.querySelectorAll('.note-item').forEach(item => {
    item.classList.remove('active');
  });

  // Get the note editor element
  const noteEditor = document.getElementById('note-editor');
  if (!noteEditor) return;

  // Create the HTML once and set it directly
  const editorHTML = `
    <div class="note-editor-header">
      <input type="text" id="note-title" class="note-title-input" placeholder="Note Title" value="New Note">
      <div class="note-editor-actions">
        <button class="btn btn-sm btn-ghost" id="save-new-note-btn" title="Save Note">
          <i class="fas fa-save"></i>
        </button>
      </div>
    </div>
    
    <div class="note-editor-toolbar">
      <div class="toolbar-group">
        <button class="toolbar-btn" data-command="bold" title="Bold">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-bold-icon lucide-bold"><path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/></svg>
        </button>
        <button class="toolbar-btn" data-command="italic" title="Italic">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-italic-icon lucide-italic"><line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/></svg>
        </button>
        <button class="toolbar-btn" data-command="underline" title="Underline">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-underline-icon lucide-underline"><path d="M6 4v6a6 6 0 0 0 12 0V4"/><line x1="4" x2="20" y1="20" y2="20"/></svg>
        </button>
      </div>
      
      <div class="toolbar-separator"></div>
      
      <div class="toolbar-group color-picker-group">
        <button class="color-option" data-color="#000000" title="Black" style="background-color: #000000;"></button>
        <button class="color-option" data-color="#ffffff" title="White" style="background-color: #ffffff; border: 1px solid #ddd;"></button>
        <button class="color-option" data-color="#3b82f6" title="Blue" style="background-color: #3b82f6;"></button>
        <button class="color-option" data-color="#10b981" title="Green" style="background-color: #10b981;"></button>
        <button class="color-option" data-color="#f59e0b" title="Yellow" style="background-color: #f59e0b;"></button>
        <button class="color-option" data-color="#f97316" title="Orange" style="background-color: #f97316;"></button>
      </div>
      
      <div class="toolbar-separator"></div>
      
      <div class="toolbar-group">
        <button class="toolbar-btn" data-command="undo" title="Undo">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-undo-icon lucide-undo"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
        </button>
        <button class="toolbar-btn" data-command="redo" title="Redo">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-redo-icon lucide-redo"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/></svg>
        </button>
      </div>
    </div>
    
    <div class="note-editor-content">
      <div class="note-title-separator"></div>
      <div id="note-content" class="note-content-editable" contenteditable="true" placeholder="Start typing your note..."></div>
    </div>
    
    <div class="note-editor-footer">
      <div class="text-muted text-sm">Creating new note</div>
    </div>
  `;

  // Set HTML directly - this is much faster than innerHTML
  noteEditor.innerHTML = editorHTML;

  // Use requestAnimationFrame for smoother initialization
  requestAnimationFrame(() => {
    initNewNoteEditor();

    // Focus on the title input immediately
    const titleInput = document.getElementById('note-title');
    if (titleInput) {
      titleInput.focus();
      // Select all text for easy editing
      titleInput.select();
    }
  });
}


function initNewNoteEditor() {
  // Cache elements to avoid repeated DOM queries
  const titleInput = document.getElementById('note-title');
  const contentDiv = document.getElementById('note-content');
  const saveBtn = document.getElementById('save-new-note-btn');

  // Auto-save functionality
  let autoSaveTimeout;

  const autoSave = () => {
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = setTimeout(async () => {
      await saveNewNote(false);
    }, 1000); // Save after 1 second of inactivity
  };

  // Create a single event listener for all toolbar buttons using event delegation
  const toolbar = document.querySelector('.note-editor-toolbar');
  if (toolbar) {
    toolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('.toolbar-btn');
      if (btn) {
        const command = btn.dataset.command;
        if (command) {
          // Get current selection
          const selection = window.getSelection();
          const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

          // Apply the formatting
          document.execCommand(command, false, null);

          // Clear selection after applying format
          if (selection.rangeCount > 0) {
            selection.removeAllRanges();
          }

          // Move cursor to the end of the formatted text
          if (range) {
            const newRange = document.createRange();
            newRange.setStart(range.endContainer, range.endOffset);
            newRange.collapse(true);
            selection.addRange(newRange);
          }

          if (contentDiv) contentDiv.focus();
          autoSave();
        }
      }

      const colorBtn = e.target.closest('.color-option');
      if (colorBtn) {
        const color = colorBtn.dataset.color;

        // Get current selection
        const selection = window.getSelection();
        const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

        // Apply the color
        document.execCommand('foreColor', false, color);

        // Clear selection after applying color
        if (selection.rangeCount > 0) {
          selection.removeAllRanges();
        }

        // Move cursor to the end of the colored text
        if (range) {
          const newRange = document.createRange();
          newRange.setStart(range.endContainer, range.endOffset);
          newRange.collapse(true);
          selection.addRange(newRange);
        }

        if (contentDiv) contentDiv.focus();
        autoSave();
      }
    });
  }

  // Title change
  if (titleInput) {
    titleInput.addEventListener('input', autoSave);
  }

  // Content change
  if (contentDiv) {
    contentDiv.addEventListener('input', autoSave);
  }

  // Tagging functionality - debounce for better performance
  if (contentDiv) {
    let taggingTimeout;
    contentDiv.addEventListener('input', (e) => {
      clearTimeout(taggingTimeout);
      taggingTimeout = setTimeout(() => {
        handleTagging(e);
      }, 100); // Reduced debounce time for better responsiveness
    });
  }

  // Save button
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      await saveNewNote(true);
    });
  }
}

async function saveNewNote(showNotification = true) {
  const titleInput = document.getElementById('note-title');
  const contentDiv = document.getElementById('note-content');

  if (!titleInput || !contentDiv) return;

  const title = titleInput.value.trim();
  const content = contentDiv.innerHTML;

  if (!title || !content || content === '<br>') {
    showToast('Title and content are required', 'error');
    return;
  }

  const noteData = {
    user_id: currentUser.id,
    title,
    content,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    organization_id: currentOrganization?.id
  };

  const { data, error } = await supabaseClient
    .from('notes')
    .insert([noteData])
    .select();

  if (error) {
    showToast('Error creating note: ' + error.message, 'error');
    return;
  }

  if (data && data.length > 0) {
    // Add to local data
    window.allNotesData.unshift(data[0]);

    // Re-render notes list
    renderNotesList(window.allNotesData);

    // Select the newly created note
    selectNote(data[0].id);

    if (showNotification) {
      showToast('Note created successfully', 'success');
    }
  }
}




function renderNotesList(notes) {
  const notesList = document.getElementById('notes-list');

  if (notes.length === 0) {
    notesList.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-sticky-note empty-state-icon"></i>
        <h3 class="empty-state-title">No notes found</h3>
        <p class="empty-state-description">Try adjusting your search or create a new note.</p>
      </div>
    `;
    return;
  }

  notesList.innerHTML = notes.map(note => {
    const preview = note.content.replace(/<[^>]*>/g, '').substring(0, 100);
    return `
      <div class="note-item ${note.id === (window.selectedNoteId || '') ? 'active' : ''}" data-id="${note.id}">
        <div class="note-item-header">
          <h4 class="note-item-title">${note.title}</h4>
          ${note.is_pinned ? '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2954be" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-pin-icon lucide-pin"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>' : ''}
        </div>
        <div class="note-item-preview">${preview}${preview.length >= 100 ? '...' : ''}</div>
        <div class="note-item-date">${formatDate(note.updated_at)}</div>
      </div>
    `;
  }).join('');

  // Re-attach click handlers
  document.querySelectorAll('.note-item').forEach(item => {
    item.addEventListener('click', () => {
      const noteId = item.dataset.id;
      selectNote(noteId);
    });
  });
}



async function selectNote(noteId) {
  // Update active state in sidebar
  document.querySelectorAll('.note-item').forEach(item => {
    item.classList.toggle('active', item.dataset.id === noteId);
  });

  // Store selected note ID
  window.selectedNoteId = noteId;
  window.isCreatingNewNote = false;

  // Find the note data
  const note = window.allNotesData.find(n => n.id === noteId);

  if (!note) return;

  // Render note editor
  const noteEditor = document.getElementById('note-editor');
  if (!noteEditor) return;

  noteEditor.innerHTML = `
    <div class="note-editor-header">
      <input type="text" id="note-title" class="note-title-input" value="${note.title}">
      <div class="note-editor-actions">
        <button class="btn btn-sm btn-ghost" id="pin-note-btn" title="${note.is_pinned ? 'Unpin note' : 'Pin note'}">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-pin-icon lucide-pin"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>
        </button>
        <button class="btn btn-sm btn-ghost" id="delete-note-btn" title="Delete note">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-icon lucide-trash"><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    </div>
    
    <div class="note-editor-toolbar">
      <div class="toolbar-group">
        <button class="toolbar-btn" data-command="bold" title="Bold">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-bold-icon lucide-bold"><path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/></svg>
        </button>
        <button class="toolbar-btn" data-command="italic" title="Italic">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-italic-icon lucide-italic"><line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/></svg>
        </button>
        <button class="toolbar-btn" data-command="underline" title="Underline">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-underline-icon lucide-underline"><path d="M6 4v6a6 6 0 0 0 12 0V4"/><line x1="4" x2="20" y1="20" y2="20"/></svg>
        </button>
      </div>
      
      <div class="toolbar-separator"></div>
      
      <div class="toolbar-group color-picker-group">
        <button class="color-option" data-color="#000000" title="Black" style="background-color: #000000;"></button>
        <button class="color-option" data-color="#ffffff" title="White" style="background-color: #ffffff; border: 1px solid #ddd;"></button>
        <button class="color-option" data-color="#3b82f6" title="Blue" style="background-color: #3b82f6;"></button>
        <button class="color-option" data-color="#10b981" title="Green" style="background-color: #10b981;"></button>
        <button class="color-option" data-color="#f59e0b" title="Yellow" style="background-color: #f59e0b;"></button>
        <button class="color-option" data-color="#f97316" title="Orange" style="background-color: #f97316;"></button>
      </div>
      
      <div class="toolbar-separator"></div>
      
      <div class="toolbar-group">
        <button class="toolbar-btn" data-command="undo" title="Undo">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-undo-icon lucide-undo"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
        </button>
        <button class="toolbar-btn" data-command="redo" title="Redo">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-redo-icon lucide-redo"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/></svg>
        </button>
      </div>
    </div>
    
    <div class="note-editor-content">
      <div class="note-title-separator"></div>
      <div id="note-content" class="note-content-editable" contenteditable="true">${note.content}</div>
    </div>
    
    <div class="note-editor-footer">
      <div class="text-muted text-sm">Last updated: ${formatDate(note.updated_at)}</div>
    </div>
  `;

  // Initialize note editor after a short delay to ensure DOM is ready
  setTimeout(() => {
    initNoteEditor(noteId);
  }, 100);
}


function initNoteEditor(noteId) {
  const note = window.allNotesData.find(n => n.id === noteId);
  if (!note) return;

  const titleInput = document.getElementById('note-title');
  const contentDiv = document.getElementById('note-content');
  const pinBtn = document.getElementById('pin-note-btn');
  const deleteBtn = document.getElementById('delete-note-btn');

  // Auto-save functionality
  let autoSaveTimeout;

  const autoSave = () => {
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = setTimeout(async () => {
      await saveNote(noteId, false);
    }, 1000); // Save after 1 second of inactivity
  };

  // Title change
  if (titleInput) {
    titleInput.addEventListener('input', autoSave);
  }

  // Content change
  if (contentDiv) {
    contentDiv.addEventListener('input', autoSave);
  }

  // Toolbar buttons
  // Update this part in both initNoteEditor and initNewNoteEditor functions

  // Toolbar buttons
  document.querySelectorAll('.toolbar-btn[data-command]').forEach(btn => {
    btn.addEventListener('click', () => {
      const command = btn.dataset.command;

      // Get current selection
      const selection = window.getSelection();
      const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

      // Apply the formatting
      document.execCommand(command, false, null);

      // Clear selection after applying format
      if (selection.rangeCount > 0) {
        selection.removeAllRanges();
      }

      // Move cursor to the end of the formatted text
      if (range) {
        const newRange = document.createRange();
        newRange.setStart(range.endContainer, range.endOffset);
        newRange.collapse(true);
        selection.addRange(newRange);
      }

      if (contentDiv) contentDiv.focus();
      autoSave();
    });
  });

  // Color options
  document.querySelectorAll('.color-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.dataset.color;

      // Get current selection
      const selection = window.getSelection();
      const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

      // Apply the color
      document.execCommand('foreColor', false, color);

      // Clear selection after applying color
      if (selection.rangeCount > 0) {
        selection.removeAllRanges();
      }

      // Move cursor to the end of the colored text
      if (range) {
        const newRange = document.createRange();
        newRange.setStart(range.endContainer, range.endOffset);
        newRange.collapse(true);
        selection.addRange(newRange);
      }

      if (contentDiv) contentDiv.focus();
      autoSave();
    });
  });

  // Tagging functionality
  if (contentDiv) {
    contentDiv.addEventListener('input', handleTagging);
  }

  // Pin button
  if (pinBtn) {
    pinBtn.addEventListener('click', async () => {
      const { error } = await supabaseClient
        .from('notes')
        .update({ is_pinned: !note.is_pinned })
        .eq('id', noteId);

      if (error) {
        showToast('Error updating note: ' + error.message, 'error');
        return;
      }

      note.is_pinned = !note.is_pinned;
      pinBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-pin-icon lucide-pin"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>`;
      pinBtn.title = note.is_pinned ? 'Unpin note' : 'Pin note';

      // Re-render notes list to update pin status
      renderNotesList(window.allNotesData);

      showToast(note.is_pinned ? 'Note pinned' : 'Note unpinned', 'success');
    });
  }

  // Delete button
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      const confirmed = await showConfirmDialog(
        'Delete Note',
        'Are you sure you want to delete this note?'
      );

      if (!confirmed) return;

      const { error } = await supabaseClient
        .from('notes')
        .delete()
        .eq('id', noteId);

      if (error) {
        showToast('Error deleting note: ' + error.message, 'error');
        return;
      }

      // Remove from local data
      window.allNotesData = window.allNotesData.filter(n => n.id !== noteId);

      // Re-render notes list
      renderNotesList(window.allNotesData);

      // Clear editor if this was the selected note
      if (window.selectedNoteId === noteId) {
        window.selectedNoteId = null;
        const noteEditor = document.getElementById('note-editor');
        if (noteEditor) {
          noteEditor.innerHTML = `
            <div class="empty-state">
              <i class="fas fa-sticky-note empty-state-icon"></i>
              <h3 class="empty-state-title">Select a note to view</h3>
              <p class="empty-state-description">Choose a note from the sidebar to view or edit it.</p>
            </div>
          `;
        }
      }

      showToast('Note deleted successfully', 'success');
    });
  }
}

let taggingTimeout;
let currentMentionType = null;
let mentionStartPos = 0;
let mentionRange = null;


function handleTagging(e) {
  try {
    const contentDiv = e.target;
    const selection = window.getSelection();

    // Get the current cursor position
    const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    if (!range) return;

    // Store the current range for later use
    mentionRange = range.cloneRange();

    // Get the text content up to the cursor
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(contentDiv);
    preCaretRange.setEnd(range.endContainer, range.endOffset);

    const text = preCaretRange.toString();
    const cursorPos = text.length;

    // Check if user is typing a person mention (@)
    const personMatch = text.match(/@([^\s@]*)$/);
    if (personMatch) {
      currentMentionType = 'person';
      mentionStartPos = cursorPos - personMatch[0].length;
      const query = personMatch[1];

      clearTimeout(taggingTimeout);
      taggingTimeout = setTimeout(() => {
        showPersonSuggestions(query, contentDiv);
      }, 300);
      return;
    }

    // Check if user is typing a company name (no special symbol, just regular text)
    // Look for the last word that might be a company name
    const words = text.split(/\s+/);
    const lastWord = words[words.length - 1] || '';

    // Only show company suggestions if the last word is at least 2 characters and doesn't start with @
    if (lastWord.length >= 2 && !lastWord.startsWith('@')) {
      currentMentionType = 'company';
      mentionStartPos = cursorPos - lastWord.length;
      const query = lastWord;

      clearTimeout(taggingTimeout);
      taggingTimeout = setTimeout(() => {
        showCompanySuggestions(query, contentDiv);
      }, 300);
      return;
    }

    // Hide suggestions if no match
    hideTaggingSuggestions();
  } catch (error) {
    console.error('Error in handleTagging:', error);
  }
}



function showCompanySuggestions(query, contentDiv) {
  hideTaggingSuggestions();

  if (query.length < 2) return;

  const filteredCompanies = window.companiesData.filter(company =>
    matchesTokenizedQuery(query, company.name, company.description, company.address)
  );

  if (filteredCompanies.length === 0) return;

  // Create suggestions popup
  const suggestions = document.createElement('div');
  suggestions.className = 'tagging-suggestions';
  suggestions.id = 'tagging-suggestions';

  suggestions.innerHTML = filteredCompanies.slice(0, 5).map(company => `
    <div class="suggestion-item company-suggestion" data-id="${company.id}" data-name="${company.name}">
      <i class="fas fa-building"></i>
      <span>${company.name}</span>
    </div>
  `).join('');

  document.body.appendChild(suggestions);

  // Position suggestions near the cursor
  const rect = mentionRange.getBoundingClientRect();

  suggestions.style.left = `${rect.left + window.scrollX}px`;
  suggestions.style.top = `${rect.bottom + window.scrollY + 5}px`;

  // Add event listeners
  suggestions.querySelectorAll('.company-suggestion').forEach(item => {
    item.addEventListener('click', () => {
      const companyId = item.dataset.id;
      const companyName = item.dataset.name;

      // Get current cursor position and content
      const selection = window.getSelection();
      const currentRange = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

      if (currentRange) {
        // Get all content as HTML
        const contentHTML = contentDiv.innerHTML;

        // Create a temporary div to work with the content
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = contentHTML;

        // Find all text nodes and replace the matching text
        const walker = document.createTreeWalker(
          tempDiv,
          NodeFilter.SHOW_TEXT,
          null,
          false
        );

        let textNode;
        let totalOffset = 0;
        let foundMatch = false;
        let replacementNode = null;

        while (textNode = walker.nextNode()) {
          const nodeText = textNode.textContent;

          // Check if this text node contains our match
          const matchStart = Math.max(0, mentionStartPos - totalOffset);
          const matchEnd = Math.min(nodeText.length, matchStart + query.length);

          if (matchEnd > matchStart && nodeText.substring(matchStart, matchEnd).toLowerCase() === query.toLowerCase()) {
            // Get text before and after the match
            const beforeText = nodeText.substring(0, matchStart);
            const afterText = nodeText.substring(matchEnd);

            // Create the tag element
            const tagSpan = document.createElement('span');
            tagSpan.className = 'company-tag';
            tagSpan.setAttribute('data-id', companyId);
            tagSpan.contentEditable = false;
            tagSpan.textContent = companyName;

            // Create a document fragment with the new content
            const fragment = document.createDocumentFragment();

            if (beforeText) {
              fragment.appendChild(document.createTextNode(beforeText));
            }

            fragment.appendChild(tagSpan);

            // Add a space after the tag
            const spaceNode = document.createTextNode(' ');
            fragment.appendChild(spaceNode);

            if (afterText) {
              fragment.appendChild(document.createTextNode(afterText));
            }

            // Replace the text node with the fragment
            textNode.parentNode.replaceChild(fragment, textNode);

            // Store reference to the space node for cursor positioning
            replacementNode = spaceNode;

            foundMatch = true;
            break;
          }

          totalOffset += nodeText.length;
        }

        if (foundMatch) {
          // Update the content div with the new HTML
          contentDiv.innerHTML = tempDiv.innerHTML;

          // Restore cursor position after the tag
          setTimeout(() => {
            if (replacementNode) {
              // Find the corresponding node in the updated DOM
              const tags = contentDiv.querySelectorAll('.company-tag');
              const targetTag = Array.from(tags).find(tag =>
                tag.getAttribute('data-id') === companyId &&
                tag.textContent === companyName
              );

              if (targetTag && targetTag.nextSibling) {
                const newRange = document.createRange();
                newRange.setStart(targetTag.nextSibling, 0);
                newRange.collapse(true);
                selection.removeAllRanges();
                selection.addRange(newRange);
              } else {
                // Fallback: place cursor at the end
                const newRange = document.createRange();
                newRange.selectNodeContents(contentDiv);
                newRange.collapse(false);
                selection.removeAllRanges();
                selection.addRange(newRange);
              }
            }

            contentDiv.focus();
          }, 0);
        }
      }

      hideTaggingSuggestions();
    });
  });

  // Hide suggestions when clicking outside
  setTimeout(() => {
    document.addEventListener('click', hideTaggingSuggestions, { once: true });
  }, 100);
}



function showPersonSuggestions(query, contentDiv) {
  hideTaggingSuggestions();

  if (query.length < 2) return;

  const filteredPeople = window.peopleData.filter(person =>
    matchesTokenizedQuery(query, person.name, person.email, person.job_title, person.companies?.name)
  );

  if (filteredPeople.length === 0) return;

  // Create suggestions popup
  const suggestions = document.createElement('div');
  suggestions.className = 'tagging-suggestions';
  suggestions.id = 'tagging-suggestions';

  suggestions.innerHTML = filteredPeople.slice(0, 5).map(person => {
    const companyName = person.companies ? person.companies.name : '';
    return `
      <div class="suggestion-item person-suggestion" data-id="${person.id}" data-name="${person.name}">
        <i class="fas fa-user"></i>
        <div>
          <span>${person.name}</span>
          ${companyName ? `<small>${companyName}</small>` : ''}
        </div>
      </div>
    `;
  }).join('');

  document.body.appendChild(suggestions);

  // Position suggestions near the cursor
  const rect = mentionRange.getBoundingClientRect();

  suggestions.style.left = `${rect.left + window.scrollX}px`;
  suggestions.style.top = `${rect.bottom + window.scrollY + 5}px`;

  // Add event listeners
  suggestions.querySelectorAll('.person-suggestion').forEach(item => {
    item.addEventListener('click', () => {
      const personId = item.dataset.id;
      const personName = item.dataset.name;

      // Get current cursor position and content
      const selection = window.getSelection();
      const currentRange = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

      if (currentRange) {
        // Get all content as HTML
        const contentHTML = contentDiv.innerHTML;

        // Create a temporary div to work with the content
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = contentHTML;

        // Find all text nodes and replace the matching text
        const walker = document.createTreeWalker(
          tempDiv,
          NodeFilter.SHOW_TEXT,
          null,
          false
        );

        let textNode;
        let totalOffset = 0;
        let foundMatch = false;
        let replacementNode = null;

        while (textNode = walker.nextNode()) {
          const nodeText = textNode.textContent;

          // Check if this text node contains our match (including @)
          const matchStart = Math.max(0, mentionStartPos - totalOffset);
          const matchEnd = Math.min(nodeText.length, matchStart + query.length + 1); // +1 for @

          if (matchEnd > matchStart && nodeText.substring(matchStart, matchEnd).toLowerCase() === '@' + query.toLowerCase()) {
            // Get text before and after the match
            const beforeText = nodeText.substring(0, matchStart);
            const afterText = nodeText.substring(matchEnd);

            // Create the tag element
            const tagSpan = document.createElement('span');
            tagSpan.className = 'person-tag';
            tagSpan.setAttribute('data-id', personId);
            tagSpan.contentEditable = false;
            tagSpan.textContent = personName;

            // Create a document fragment with the new content
            const fragment = document.createDocumentFragment();

            if (beforeText) {
              fragment.appendChild(document.createTextNode(beforeText));
            }

            fragment.appendChild(tagSpan);

            // Add a space after the tag
            const spaceNode = document.createTextNode(' ');
            fragment.appendChild(spaceNode);

            if (afterText) {
              fragment.appendChild(document.createTextNode(afterText));
            }

            // Replace the text node with the fragment
            textNode.parentNode.replaceChild(fragment, textNode);

            // Store reference to the space node for cursor positioning
            replacementNode = spaceNode;

            foundMatch = true;
            break;
          }

          totalOffset += nodeText.length;
        }

        if (foundMatch) {
          // Update the content div with the new HTML
          contentDiv.innerHTML = tempDiv.innerHTML;

          // Restore cursor position after the tag
          setTimeout(() => {
            if (replacementNode) {
              // Find the corresponding node in the updated DOM
              const tags = contentDiv.querySelectorAll('.person-tag');
              const targetTag = Array.from(tags).find(tag =>
                tag.getAttribute('data-id') === personId &&
                tag.textContent === personName
              );

              if (targetTag && targetTag.nextSibling) {
                const newRange = document.createRange();
                newRange.setStart(targetTag.nextSibling, 0);
                newRange.collapse(true);
                selection.removeAllRanges();
                selection.addRange(newRange);
              } else {
                // Fallback: place cursor at the end
                const newRange = document.createRange();
                newRange.selectNodeContents(contentDiv);
                newRange.collapse(false);
                selection.removeAllRanges();
                selection.addRange(newRange);
              }
            }

            contentDiv.focus();
          }, 0);
        }
      }

      hideTaggingSuggestions();
    });
  });

  // Hide suggestions when clicking outside
  setTimeout(() => {
    document.addEventListener('click', hideTaggingSuggestions, { once: true });
  }, 100);
}


function hideTaggingSuggestions() {
  const suggestions = document.getElementById('tagging-suggestions');
  if (suggestions) {
    suggestions.remove();
  }
}


async function saveNote(noteId, showNotification = true) {
  const titleInput = document.getElementById('note-title');
  const contentDiv = document.getElementById('note-content');

  if (!titleInput || !contentDiv) return;

  const title = titleInput.value.trim();
  const content = contentDiv.innerHTML;

  if (!title || !content) {
    showToast('Title and content are required', 'error');
    return;
  }

  const { error } = await supabaseClient
    .from('notes')
    .update({
      title,
      content,
      updated_at: new Date().toISOString()
    })
    .eq('id', noteId);

  if (error) {
    showToast('Error saving note: ' + error.message, 'error');
    return;
  }

  // Update local data
  const note = window.allNotesData.find(n => n.id === noteId);
  if (note) {
    note.title = title;
    note.content = content;
    note.updated_at = new Date().toISOString();
  }

  // Update the preview in the sidebar without repositioning
  updateNotePreview(noteId, title, content);

  // Update date in footer
  const footer = document.querySelector('.note-editor-footer .text-muted');
  if (footer) {
    footer.textContent = `Last updated: ${formatDate(note.updated_at)}`;
  }

  if (showNotification) {
    showToast('Note saved', 'success');
  }
}

// New function to update just the preview without repositioning
function updateNotePreview(noteId, title, content) {
  const noteItem = document.querySelector(`.note-item[data-id="${noteId}"]`);
  if (!noteItem) return;

  // Update title
  const titleElement = noteItem.querySelector('.note-item-title');
  if (titleElement) {
    titleElement.textContent = title;
  }

  // Update preview
  const previewElement = noteItem.querySelector('.note-item-preview');
  if (previewElement) {
    const preview = content.replace(/<[^>]*>/g, '').substring(0, 100);
    previewElement.textContent = `${preview}${preview.length >= 100 ? '...' : ''}`;
  }

  // Update date
  const dateElement = noteItem.querySelector('.note-item-date');
  if (dateElement) {
    dateElement.textContent = formatDate(new Date().toISOString());
  }
}


function openNoteModal(note = null) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'flex';
  modal.id = 'note-modal';

  modal.innerHTML = `
    <div class="modal-backdrop" onclick="closeModal('note-modal')"></div>
    <div class="modal-container modal-size-md">
      <div class="modal-header">
        <h3>${note ? 'Edit Note' : 'New Note'}</h3>
        <button class="modal-close" onclick="closeModal('note-modal')">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x-icon lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="form-field">
          <label for="modal-note-title">Title</label>
          <input type="text" id="modal-note-title" class="form-input" value="${note ? note.title : ''}" placeholder="Enter note title">
        </div>
        <div class="form-field">
          <label for="modal-note-content">Content</label>
          <div id="modal-note-content" class="note-content-editable" contenteditable="true" placeholder="Start typing your note...">${note ? note.content : ''}</div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal('note-modal')">Cancel</button>
        <button class="btn btn-primary" id="save-modal-note-btn">${note ? 'Update' : 'Create'}</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Initialize modal editor
  const contentDiv = document.getElementById('modal-note-content');

  // Text selection popup
  contentDiv.addEventListener('mouseup', handleTextSelection);
  contentDiv.addEventListener('keyup', handleTextSelection);

  // Tagging functionality
  contentDiv.addEventListener('input', handleTagging);

  // Save button
  document.getElementById('save-modal-note-btn').addEventListener('click', async () => {
    const titleInput = document.getElementById('modal-note-title');
    const title = titleInput.value.trim();
    const content = contentDiv.innerHTML;

    if (!title || !content) {
      showToast('Title and content are required', 'error');
      return;
    }

    const noteData = {
      user_id: currentUser.id,
      title,
      content,
      updated_at: new Date().toISOString(),
      organization_id: currentOrganization?.id
    };

    let result;

    if (note) {
      // Update existing note
      result = await supabaseClient
        .from('notes')
        .update(noteData)
        .eq('id', note.id);
    } else {
      // Create new note
      result = await supabaseClient
        .from('notes')
        .insert([noteData]);
    }

    if (result.error) {
      showToast(`Error ${note ? 'updating' : 'creating'} note: ` + result.error.message, 'error');
      return;
    }

    showToast(`Note ${note ? 'updated' : 'created'} successfully`, 'success');
    closeModal('note-modal');
    renderNotesView(); // Refresh the notes view
  });
}
// ======================
// PROFESSIONAL DASHBOARD
// ======================

async function renderProfessionalDashboardView() {
  const viewContainer = document.getElementById('view-container');
  const headerTitle = document.querySelector('.header-title');
  if (headerTitle) headerTitle.textContent = 'Dashboard';

  try {
    const [
      contactsResult,
      companiesResult,
      tasksResult,
      opportunitiesResult,
      visitsResult,
      repsResult
    ] = await Promise.all([
      supabaseClient.from('people').select('*', { count: 'exact', head: true }).eq('organization_id', currentOrganization?.id || '00000000-0000-0000-0000-000000000000'),
      supabaseClient.from('companies').select('*', { count: 'exact', head: true }).eq('organization_id', currentOrganization?.id || '00000000-0000-0000-0000-000000000000'),
      supabaseClient.from('tasks').select('id, status, due_date, created_at').eq('organization_id', currentOrganization?.id || '00000000-0000-0000-0000-000000000000'),
      supabaseClient.from('opportunities').select('id, value, stage, created_at, updated_at').eq('organization_id', currentOrganization?.id || '00000000-0000-0000-0000-000000000000'),
      supabaseClient
        .from('visits')
        .select('id, user_id, company_name, visit_type, lead_score, created_at, profiles(first_name, last_name)')
        .eq('organization_id', currentOrganization?.id || '00000000-0000-0000-0000-000000000000')
        .order('created_at', { ascending: false })
        .limit(100),
      supabaseClient.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'sales_rep').eq('organization_id', currentOrganization?.id || '00000000-0000-0000-0000-000000000000')
    ]);

    if (contactsResult.error || companiesResult.error || tasksResult.error || opportunitiesResult.error || visitsResult.error || repsResult.error) {
      throw new Error(
        contactsResult.error?.message ||
        companiesResult.error?.message ||
        tasksResult.error?.message ||
        opportunitiesResult.error?.message ||
        visitsResult.error?.message ||
        repsResult.error?.message ||
        'Unable to load dashboard data'
      );
    }

    const contactsCount = contactsResult.count || 0;
    const companiesCount = companiesResult.count || 0;
    const tasks = tasksResult.data || [];
    const opportunities = opportunitiesResult.data || [];
    const recentVisits = visitsResult.data || [];
    const totalSalesReps = repsResult.count || 0;

    const normalizeStage = (stage) => {
      const value = String(stage || '').toLowerCase().replace(/_/g, '-');
      if (value === 'closed-won') return 'closed-won';
      if (value === 'closed-lost') return 'closed-lost';
      if (['prospecting', 'qualification', 'proposal', 'negotiation'].includes(value)) return value;
      return 'prospecting';
    };

    const formatMoney = (amount) => `$${Math.round(amount || 0).toLocaleString()}`;
    const now = new Date();
    const todayYMD = now.toISOString().slice(0, 10);
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);

    const completedTasks = tasks.filter(t => String(t.status || '').toLowerCase() === 'completed').length;
    const openTasks = tasks.length - completedTasks;
    const taskCompletionRate = tasks.length > 0 ? (completedTasks / tasks.length) * 100 : 0;

    const enrichedOpps = opportunities.map(opp => ({
      ...opp,
      normalizedStage: normalizeStage(opp.stage),
      numericValue: Number(opp.value) || 0
    }));

    const openOpps = enrichedOpps.filter(o => !['closed-won', 'closed-lost'].includes(o.normalizedStage));
    const wonOpps = enrichedOpps.filter(o => o.normalizedStage === 'closed-won');
    const closedOpps = enrichedOpps.filter(o => ['closed-won', 'closed-lost'].includes(o.normalizedStage));
    const pipelineOpenValue = openOpps.reduce((sum, o) => sum + o.numericValue, 0);
    const wonRevenue = wonOpps.reduce((sum, o) => sum + o.numericValue, 0);
    const winRate = closedOpps.length > 0 ? (wonOpps.length / closedOpps.length) * 100 : 0;
    const avgDealSize = openOpps.length > 0 ? pipelineOpenValue / openOpps.length : 0;

    const visitsToday = recentVisits.filter(v => {
      const visitDate = (v.date || v.created_at || '').toString().slice(0, 10);
      return visitDate === todayYMD;
    }).length;

    const visitsThisWeek = recentVisits.filter(v => {
      const visitDate = new Date(v.date || v.created_at);
      return !Number.isNaN(visitDate.getTime()) && visitDate >= weekStart;
    }).length;

    const activeRepIds30d = new Set(
      recentVisits
        .filter(v => {
          const visitDate = new Date(v.date || v.created_at);
          const daysAgo = (now - visitDate) / (1000 * 60 * 60 * 24);
          return !Number.isNaN(visitDate.getTime()) && daysAgo <= 30;
        })
        .map(v => v.user_id)
        .filter(Boolean)
    );

    const leadScoreValues = recentVisits
      .map(v => Number(v.lead_score))
      .filter(score => Number.isFinite(score) && score > 0);
    const avgLeadScore = leadScoreValues.length
      ? (leadScoreValues.reduce((sum, score) => sum + score, 0) / leadScoreValues.length)
      : 0;

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const trendMonths = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      trendMonths.push({
        key: `${d.getFullYear()}-${d.getMonth()}`,
        name: monthNames[d.getMonth()],
        pipelineValue: 0,
        wonValue: 0
      });
    }

    enrichedOpps.forEach(opp => {
      const createdAt = new Date(opp.created_at);
      const createdKey = `${createdAt.getFullYear()}-${createdAt.getMonth()}`;
      const createdBucket = trendMonths.find(m => m.key === createdKey);
      if (createdBucket) createdBucket.pipelineValue += opp.numericValue;

      if (opp.normalizedStage === 'closed-won') {
        const wonAt = new Date(opp.updated_at || opp.created_at);
        const wonKey = `${wonAt.getFullYear()}-${wonAt.getMonth()}`;
        const wonBucket = trendMonths.find(m => m.key === wonKey);
        if (wonBucket) wonBucket.wonValue += opp.numericValue;
      }
    });

    const maxTrendValue = Math.max(...trendMonths.map(m => Math.max(m.pipelineValue, m.wonValue)), 1);

    const stageMeta = [
      { key: 'prospecting', label: 'Prospecting', color: '#3b82f6' },
      { key: 'qualification', label: 'Qualification', color: '#8b5cf6' },
      { key: 'proposal', label: 'Proposal', color: '#f59e0b' },
      { key: 'negotiation', label: 'Negotiation', color: '#f97316' },
      { key: 'closed-won', label: 'Closed Won', color: '#10b981' },
      { key: 'closed-lost', label: 'Closed Lost', color: '#ef4444' }
    ];

    const stageSummary = stageMeta.map(meta => {
      const stageOpps = enrichedOpps.filter(o => o.normalizedStage === meta.key);
      return {
        ...meta,
        count: stageOpps.length,
        value: stageOpps.reduce((sum, o) => sum + o.numericValue, 0)
      };
    });

    const donutTotal = Math.max(enrichedOpps.length, 1);
    let running = 0;
    const donutSegments = stageSummary
      .filter(item => item.count > 0)
      .map(item => {
        const start = running;
        const pct = (item.count / donutTotal) * 100;
        running += pct;
        return `${item.color} ${start}% ${running}%`;
      });
    const donutBackground = donutSegments.length
      ? `conic-gradient(${donutSegments.join(', ')})`
      : 'conic-gradient(#e5e7eb 0% 100%)';

    const html = `
      <div class="dashboard-container">
        <div class="dashboard-header">
           <div>
         <h1 class="dashboard-title">Revenue & Activity Overview</h1>
         <p class="dashboard-subtitle">Live metrics from contacts, tasks, opportunities, and visits</p>
           </div>
           <div class="dashboard-actions">
          <button class="btn btn-secondary btn-sm" id="dashboard-refresh-btn">
           <i class="fas fa-rotate-right"></i>
           Refresh
          </button>
           </div>
        </div>

        <div class="stats-grid">
           <div class="stat-card">
              <div class="stat-header">
            <span class="stat-title">Open Pipeline</span>
            <div class="stat-icon green"><i class="fas fa-sack-dollar"></i></div>
          </div>
          <div class="stat-value-container">
            <span class="stat-value">${formatMoney(pipelineOpenValue)}</span>
          </div>
          <div class="stat-meta">${openOpps.length} open opportunities</div>
        </div>

        <div class="stat-card">
          <div class="stat-header">
            <span class="stat-title">Closed Revenue</span>
            <div class="stat-icon blue"><i class="fas fa-chart-line"></i></div>
          </div>
          <div class="stat-value-container">
            <span class="stat-value">${formatMoney(wonRevenue)}</span>
          </div>
          <div class="stat-meta">Win rate ${winRate.toFixed(1)}%</div>
        </div>

        <div class="stat-card">
          <div class="stat-header">
            <span class="stat-title">Task Completion</span>
            <div class="stat-icon orange"><i class="fas fa-list-check"></i></div>
          </div>
          <div class="stat-value-container">
            <span class="stat-value">${taskCompletionRate.toFixed(0)}%</span>
          </div>
          <div class="stat-meta">${openTasks} open • ${completedTasks} done</div>
        </div>

        <div class="stat-card">
          <div class="stat-header">
            <span class="stat-title">Visits</span>
            <div class="stat-icon purple"><i class="fas fa-handshake"></i></div>
          </div>
          <div class="stat-value-container">
            <span class="stat-value">${visitsThisWeek}</span>
          </div>
          <div class="stat-meta">${visitsToday} today</div>
        </div>

        <div class="stat-card">
          <div class="stat-header">
            <span class="stat-title">Active Reps (30d)</span>
                 <div class="stat-icon purple"><i class="fas fa-address-book"></i></div>
              </div>
              <div class="stat-value-container">
            <span class="stat-value">${activeRepIds30d.size}</span>
              </div>
          <div class="stat-meta">of ${totalSalesReps} sales reps</div>
           </div>

           <div class="stat-card">
              <div class="stat-header">
            <span class="stat-title">Coverage</span>
            <div class="stat-icon blue"><i class="fas fa-building"></i></div>
              </div>
              <div class="stat-value-container">
            <span class="stat-value">${contactsCount}</span>
              </div>
          <div class="stat-meta">${companiesCount} companies • avg lead ${avgLeadScore.toFixed(0)}%</div>
           </div>
        </div>

        <div class="charts-grid">
           <div class="chart-card">
              <div class="chart-header">
            <h3 class="chart-title">6-Month Opportunity Value Trend</h3>
            <span class="chart-caption">Created vs Closed Won</span>
              </div>
          <div class="chart-placeholder trend-chart-placeholder">
            <div class="css-chart dual-series-chart">
              ${trendMonths.map(m => {
      const createdHeight = Math.max((m.pipelineValue / maxTrendValue) * 100, m.pipelineValue > 0 ? 5 : 0);
      const wonHeight = Math.max((m.wonValue / maxTrendValue) * 100, m.wonValue > 0 ? 5 : 0);
      return `
                        <div class="chart-bar-group">
                   <div class="chart-bars-pair">
                    <div class="chart-bar chart-bar-created" style="height: ${createdHeight}%;" data-value="Created ${formatMoney(m.pipelineValue)}"></div>
                    <div class="chart-bar chart-bar-won" style="height: ${wonHeight}%;" data-value="Won ${formatMoney(m.wonValue)}"></div>
                   </div>
                            <span class="chart-label">${m.name}</span>
                        </div>
                        `;
    }).join('')}
                 </div>
            <div class="trend-legend">
              <span><span class="legend-dot created"></span>Created</span>
              <span><span class="legend-dot won"></span>Closed Won</span>
            </div>
              </div>
           </div>

           <div class="chart-card">
              <div class="chart-header">
                 <h3 class="chart-title">Pipeline Stages</h3>
              </div>
              <div class="donut-chart-container">
            <div class="donut-chart" style="background: ${donutBackground};">
                    <div class="donut-inner">
                <span class="donut-total">${enrichedOpps.length}</span>
                       <span class="donut-label">Opportunities</span>
                    </div>
                 </div>
                 <div class="donut-legend">
              ${stageSummary.map(item => `
               <div class="legend-item">
                <div class="legend-dot" style="background:${item.color};"></div>
                ${item.label} (${item.count})
               </div>
              `).join('')}
                 </div>
              </div>
           </div>
        </div>

      <div class="stage-breakdown-card">
       <div class="chart-header">
        <h3 class="chart-title">Stage Value Breakdown</h3>
       </div>
       <div class="stage-breakdown-grid">
        ${stageSummary.map(item => `
          <div class="stage-breakdown-item">
           <div class="stage-breakdown-top">
            <span class="legend-dot" style="background:${item.color};"></span>
            <span>${item.label}</span>
           </div>
           <div class="stage-breakdown-value">${formatMoney(item.value)}</div>
           <div class="stage-breakdown-count">${item.count} deals</div>
          </div>
        `).join('')}
       </div>
      </div>

        <div class="recent-activity-card">
           <div class="chart-header">
          <h3 class="chart-title">Recent Visit Activity</h3>
           </div>
           <div class="table-responsive">
              <table class="dashboard-table">
                 <thead>
                    <tr>
                       <th>Representative</th>
                       <th>Company</th>
                <th>Visit Type</th>
                <th>Lead Score</th>
                       <th>Date</th>
                    </tr>
                 </thead>
                 <tbody>
              ${recentVisits.slice(0, 8).map(visit => {
      const repName = visit.profiles ? `${visit.profiles.first_name} ${visit.profiles.last_name}` : 'Unknown';
      const initials = repName.split(' ').map(n => n[0]).join('').substring(0, 2);
      const score = Number(visit.lead_score);
      const scoreClass = Number.isFinite(score) && score >= 80 ? 'high' : Number.isFinite(score) && score >= 50 ? 'medium' : 'low';
      const visitDate = new Date(visit.date || visit.created_at);
      return `
                        <tr>
                           <td>
                              <div class="user-cell">
                                 <div class="user-img-circle">${initials}</div>
                                 <span style="font-weight:500;">${repName}</span>
                              </div>
                           </td>
                           <td>${visit.company_name || 'N/A'}</td>
                  <td>${visit.visit_type || 'General Visit'}</td>
                  <td>${Number.isFinite(score) ? `<span class="lead-score-pill ${scoreClass}">${score}%</span>` : '<span class="text-muted">—</span>'}</td>
                  <td>${Number.isNaN(visitDate.getTime()) ? '—' : visitDate.toLocaleDateString()}</td>
                        </tr>
                        `;
    }).join('') || '<tr><td colspan="5">No recent visits</td></tr>'}
                 </tbody>
              </table>
           </div>
        </div>

      </div>
    `;

    viewContainer.innerHTML = html;

    document.getElementById('dashboard-refresh-btn')?.addEventListener('click', () => {
      renderProfessionalDashboardView();
      showToast('Dashboard refreshed', 'success', { subtle: true, duration: 1200 });
    });

  } catch (err) {
    console.error('Error rendering dashboard:', err);
    viewContainer.innerHTML = renderError('Failed to load dashboard data: ' + err.message);
  }
}

// ======================
// CHANGE PASSWORD MODAL
// ======================
window.openChangePasswordModal = function () {
  const modal = document.getElementById('change-password-modal');
  if (modal) {
    document.getElementById('change-password-form').reset();
    modal.style.display = 'flex';

    const saveBtn = document.getElementById('save-new-password-btn');
    saveBtn.onclick = submitChangePassword;
  }
};


// ======================
// PASSWORD VISIBILITY TOGGLE (EXTERNAL BUTTON)
// ======================
window.togglePasswordVisibility = function (inputId, btn) {
  const input = document.getElementById(inputId);
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
};

async function submitChangePassword() {
  const newPass = document.getElementById('new-password').value;
  const confirmPass = document.getElementById('confirm-new-password').value;

  if (newPass !== confirmPass) {
    showToast('Passwords do not match', 'error');
    return;
  }

  const btn = document.getElementById('save-new-password-btn');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';

  const { data, error } = await supabaseClient.auth.updateUser({
    password: newPass
  });

  if (error) {
    showToast(error.message, 'error');
    btn.disabled = false;
    btn.innerHTML = originalText;
  } else {
    showToast('Password updated successfully', 'success');
    closeModal('change-password-modal');
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

// ======================
// PWA LOGIC
// ======================
let deferredPrompt;

function initPWA() {
  // Register Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js')
        .catch(err => console.error('SW: Registration failed', err));
    });
  }

  const installBtn = document.getElementById('pwa-install-btn');

  // Listen for the install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;

    // Show menu button always (non-intrusive)
    if (installBtn) installBtn.style.display = 'flex';

    // Attempt showing banner (checks onboarding)
    attemptShowPWABanner();
  });
}

function attemptShowPWABanner() {
  const installBanner = document.getElementById('pwa-install-banner');
  const bannerInstallBtn = document.getElementById('pwa-banner-install-btn');
  const bannerCloseBtn = document.getElementById('pwa-banner-close-btn');

  if (!deferredPrompt || !installBanner) return;

  // DON'T show if onboarding is active (wait for reload/completion)
  const hasCompletedTour = localStorage.getItem('safitrack_onboarding_completed');
  if (!hasCompletedTour) return;

  // DON'T show if user dismissed it recently
  const isBannerDismissed = localStorage.getItem('pwa_banner_dismissed');
  if (isBannerDismissed) return;

  // All checks passed, show it after a short delay
  setTimeout(() => {
    installBanner.style.display = 'block';
  }, 3000);

  const triggerInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    const installBtn = document.getElementById('pwa-install-btn');
    if (installBtn) installBtn.style.display = 'none';
    if (installBanner) installBanner.style.display = 'none';
  };

  // Bind clicks
  bannerInstallBtn.onclick = triggerInstall;
  bannerCloseBtn.onclick = () => {
    installBanner.style.display = 'none';
    localStorage.setItem('pwa_banner_dismissed', 'true');
  };

  // Handle menu button too
  const installBtn = document.getElementById('pwa-install-btn');
  if (installBtn) installBtn.onclick = triggerInstall;
}

// Log when app is successfully installed
window.addEventListener('appinstalled', (event) => {
  const installBtn = document.getElementById('pwa-install-btn');
  const installBanner = document.getElementById('pwa-install-banner');
  if (installBtn) installBtn.style.display = 'none';
  if (installBanner) installBanner.style.display = 'none';
  showToast('SafiTrack CRM installed successfully!', 'success');
});

// ======================
// CALL LOGS VIEW
// ======================

async function renderCallLogsView() {
  const viewContainer = document.getElementById('view-container');

  // Fetch reps if manager
  let reps = [];
  if (isManager && managerCallLogViewMode === 'team') {
    let repsQ = supabaseClient.from('profiles').select('id, first_name, last_name').eq('role', 'sales_rep');
    if (currentOrganization?.id) repsQ = repsQ.eq('organization_id', currentOrganization.id);
    const { data } = await repsQ;
    reps = data || [];
  }

  // Ensure companies are loaded for search fallback
  if (!window.allCompaniesData) {
    let companiesCacheQ = supabaseClient.from('companies').select('id, name, address').order('name', { ascending: true });
    if (currentOrganization?.id) companiesCacheQ = companiesCacheQ.eq('organization_id', currentOrganization.id);
    const { data: companies } = await companiesCacheQ;
    window.allCompaniesData = companies || [];
  }

  // Default fetch - order by newest first (descending by created_at)
  let query = supabaseClient
    .from('call_logs')
    .select(`
            *,
            profiles:user_id(first_name, last_name),
            people:contact_id(name),
            companies:company_id(name)
        `)
    .order('created_at', { ascending: false });

  if (!isManager || managerCallLogViewMode === 'my') {
    query = query.eq('user_id', currentUser.id);
  } else if (selectedRepId) {
    query = query.eq('user_id', selectedRepId);
  }

  const { data: logs, error } = await query;

  if (error) {
    viewContainer.innerHTML = renderError(error.message);
    return;
  }

  // Apply filters to logs
  const filteredLogs = logs.filter(log => {
    const contactName = log.people ? log.people.name : log.contact_name;
    const companyName = log.companies ? log.companies.name : log.company_name;

    // Search filter
    if (callLogFilters.search) {
      const searchLower = callLogFilters.search.toLowerCase();
      const matchesContact = (contactName || '').toLowerCase().includes(searchLower);
      const matchesCompany = (companyName || '').toLowerCase().includes(searchLower);
      if (!matchesContact && !matchesCompany) return false;
    }

    // Direction filter
    if (callLogFilters.direction && log.direction !== callLogFilters.direction) {
      return false;
    }

    // Outcome filter
    if (callLogFilters.outcome && log.outcome !== callLogFilters.outcome) {
      return false;
    }

    return true;
  });

  let html = `
        <div class="page-header">
            <div class="page-header-row">
                <div>
                </div>
                <div class="call-logs-filters">
                    ${isManager ? `
                        <div class="view-toggle">
                            <button class="toggle-btn ${managerCallLogViewMode === 'my' ? 'active' : ''}" id="view-my-logs">My Logs</button>
                            <button class="toggle-btn ${managerCallLogViewMode === 'team' ? 'active' : ''}" id="view-team-logs">Team Logs</button>
                        </div>
                        ${managerCallLogViewMode === 'team' ? `
                            <select id="rep-filter" class="filter-select">
                                <option value="">All Representatives</option>
                                ${reps.map(rep => `
                                    <option value="${rep.id}" ${selectedRepId === rep.id ? 'selected' : ''}>
                                        ${rep.first_name} ${rep.last_name}
                                    </option>
                                `).join('')}
                            </select>
                        ` : ''}
                    ` : ''}
                    ${(!isManager || managerCallLogViewMode === 'my') ? `
                    <button class="btn btn-primary" id="log-call-btn">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-plus-icon"><path d="M5 12h14"/><path d="M12 5v14"/></svg> <span>Log Call</span>
                    </button>
                    ` : ''}
                </div>
            </div>
        </div>

        <div class="card">
            <div class="filters-section">
                <div class="search-input-wrapper">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-search-icon search-icon">
                        <path d="m21 21-4.34-4.34" />
                        <circle cx="11" cy="11" r="8" />
                    </svg>
                    <input type="text" id="call-search" placeholder="Search by contact or company..." value="${callLogFilters.search}" class="filter-select search-input-padded">
                </div>
                
                <select id="call-direction-filter" class="filter-select">
                    <option value="">All Directions</option>
                    <option value="Inbound" ${callLogFilters.direction === 'Inbound' ? 'selected' : ''}>Inbound</option>
                    <option value="Outbound" ${callLogFilters.direction === 'Outbound' ? 'selected' : ''}>Outbound</option>
                </select>
                
                <select id="call-outcome-filter" class="filter-select">
                    <option value="">All Outcomes</option>
                    <option value="Connected" ${callLogFilters.outcome === 'Connected' ? 'selected' : ''}>Connected</option>
                    <option value="Voicemail" ${callLogFilters.outcome === 'Voicemail' ? 'selected' : ''}>Voicemail</option>
                    <option value="No Answer" ${callLogFilters.outcome === 'No Answer' ? 'selected' : ''}>No Answer</option>
                    <option value="Busy" ${callLogFilters.outcome === 'Busy' ? 'selected' : ''}>Busy</option>
                    <option value="Wrong Number" ${callLogFilters.outcome === 'Wrong Number' ? 'selected' : ''}>Wrong Number</option>
                    <option value="Call Failed" ${callLogFilters.outcome === 'Call Failed' ? 'selected' : ''}>Call Failed</option>
                </select>

                <div class="filter-actions">
                    <button id="clear-filters" class="btn btn-secondary">
                        Clear Filters
                    </button>
                </div>
            </div>

            <div class="table-container">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>DateTime</th>
                            ${(isManager && managerCallLogViewMode === 'team') ? '<th>Representative</th>' : ''}
                            <th>Contact</th>
                            <th>Company</th>
                            <th>Direction</th>
                            <th>Duration</th>
                            <th>Outcome</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filteredLogs.length === 0 ? `
                            <tr>
                                <td colspan="${(isManager && managerCallLogViewMode === 'team') ? '8' : '7'}" class="text-center">No call logs found</td>
                            </tr>
                        ` : filteredLogs.map(log => {
    const outcomeClass = (log.outcome || '').toLowerCase().replace(' ', '-');
    const contactName = log.people ? log.people.name : log.contact_name;
    const companyName = log.companies ? log.companies.name : log.company_name;
    const repName = log.profiles ? `${log.profiles.first_name} ${log.profiles.last_name}` : 'Unknown';

    return `
                                <tr>
                                    <td>${formatDateWithTime(log.call_at)}</td>
                                    ${(isManager && managerCallLogViewMode === 'team') ? `<td>${repName}</td>` : ''}
                                    <td>${contactName || 'N/A'}</td>
                                    <td>${companyName || 'N/A'}</td>
                                    <td>
                                        <span class="direction-badge ${log.direction === 'Inbound' ? 'inbound' : 'outbound'}">
                                            ${log.direction === 'Inbound' ? `
                                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-down-left"><path d="M17 7 7 17"/><path d="M17 17H7V7"/></svg>
                                            ` : `
                                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-up-right"><path d="M7 17 17 7"/><path d="M7 7h10v10"/></svg>
                                            `}
                                            ${log.direction}
                                        </span>
                                    </td>
                                    <td>${log.duration_seconds ? Math.floor(log.duration_seconds / 60) + 'm' : 'N/A'}</td>
                                    <td>
                                        <span class="outcome-badge ${outcomeClass}">${log.outcome}</span>
                                    </td>
                                    <td>
                                        <div class="table-actions">
                                            <button class="action-btn view-call-log" data-id="${log.id}" title="View Log">
                                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-eye"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>
                                            </button>
                                            ${(!isManager || log.user_id === currentUser.id) ? `
                                            <button class="action-btn edit-call-log" data-id="${log.id}" title="Edit Log">
                                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-pencil"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                                            </button>
                                            <button class="action-btn delete-call-log" data-id="${log.id}" title="Delete Log">
                                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
                                            </button>
                                            ` : ''}
                                        </div>
                                    </td>
                                </tr>
                            `;
  }).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;

  viewContainer.innerHTML = html;

  // Listeners
  document.getElementById('log-call-btn')?.addEventListener('click', () => openCallLogModal());

  document.querySelectorAll('.view-call-log').forEach(btn => {
    btn.addEventListener('click', () => {
      const log = logs.find(l => l.id === btn.dataset.id);
      openCallLogViewModal(log);
    });
  });

  document.querySelectorAll('.edit-call-log').forEach(btn => {
    btn.addEventListener('click', () => {
      const log = logs.find(l => l.id === btn.dataset.id);
      openCallLogModal(log);
    });
  });

  if (isManager) {
    document.getElementById('view-my-logs')?.addEventListener('click', () => {
      managerCallLogViewMode = 'my';
      renderCallLogsView();
    });
    document.getElementById('view-team-logs')?.addEventListener('click', () => {
      managerCallLogViewMode = 'team';
      renderCallLogsView();
    });
    document.getElementById('rep-filter')?.addEventListener('change', (e) => {
      selectedRepId = e.target.value || null;
      renderCallLogsView();
    });
  }

  // Filter listeners
  const searchInput = document.getElementById('call-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      callLogFilters.search = e.target.value;
      saveViewState({ callLogs: callLogFilters });
      // Debounce the search to avoid excessive re-renders
      clearTimeout(filterDebounceTimer);
      filterDebounceTimer = setTimeout(() => {
        renderCallLogsView();
      }, 300);
    });
  }

  document.getElementById('call-direction-filter')?.addEventListener('change', (e) => {
    callLogFilters.direction = e.target.value;
    saveViewState({ callLogs: callLogFilters });
    renderCallLogsView();
  });

  document.getElementById('call-outcome-filter')?.addEventListener('change', (e) => {
    callLogFilters.outcome = e.target.value;
    saveViewState({ callLogs: callLogFilters });
    renderCallLogsView();
  });

  document.getElementById('clear-filters')?.addEventListener('click', () => {
    callLogFilters = { search: '', direction: '', outcome: '' };
    saveViewState({ callLogs: callLogFilters });
    clearTimeout(filterDebounceTimer);
    renderCallLogsView();
  });

  // Use event delegation for delete button
  const tableContainer = viewContainer.querySelector('.table-container');
  if (tableContainer) {
    tableContainer.addEventListener('click', (e) => {
      const deleteBtn = e.target.closest('.delete-call-log');
      if (deleteBtn) {
        e.preventDefault();
        e.stopPropagation();
        deleteCallLog(deleteBtn.dataset.id);
      }
    });
  };
}

async function deleteCallLog(id) {
  const confirmed = await showConfirmDialog('Delete Call Log', 'Are you sure you want to delete this call log?');
  if (!confirmed) return;

  try {
    // Fetch the log to check ownership
    const { data: log, error: fetchError } = await supabaseClient
      .from('call_logs')
      .select('user_id, id')
      .eq('id', id)
      .single();

    if (fetchError || !log) {
      showToast('Log not found', 'error');
      return;
    }

    // Check if user owns the log
    if (log.user_id !== currentUser.id) {
      showToast('You can only delete your own call logs', 'error');
      return;
    }

    // Delete the log
    const { error: deleteError } = await supabaseClient
      .from('call_logs')
      .delete()
      .eq('id', id);

    if (deleteError) {
      showToast('Error deleting log: ' + deleteError.message, 'error');
    } else {
      showToast('Log deleted', 'success');
      await new Promise(resolve => setTimeout(resolve, 500));
      renderCallLogsView();
    }
  } catch (e) {
    showToast('Error deleting log: ' + e.message, 'error');
  }
}

function openCallLogViewModal(log) {
  const modal = document.getElementById('call-log-view-modal');
  if (!modal) {
    showToast('View modal not found', 'error');
    return;
  }

  // Populate view modal
  const contactName = log.people ? log.people.name : log.contact_name;
  const companyName = log.companies ? log.companies.name : log.company_name;
  const repName = log.profiles ? `${log.profiles.first_name} ${log.profiles.last_name}` : 'Unknown';

  document.getElementById('view-call-datetime').textContent = formatDateWithTime(log.call_at);
  document.getElementById('view-call-contact').textContent = contactName || 'N/A';
  document.getElementById('view-call-company').textContent = companyName || 'N/A';
  document.getElementById('view-call-rep').textContent = repName;
  document.getElementById('view-call-direction').textContent = log.direction;
  document.getElementById('view-call-direction').className = `direction-badge ${log.direction === 'Inbound' ? 'inbound' : 'outbound'}`;
  document.getElementById('view-call-duration').textContent = log.duration_seconds ? Math.floor(log.duration_seconds / 60) + ' minutes' : 'N/A';
  document.getElementById('view-call-outcome').textContent = log.outcome;
  const outcomeClass = (log.outcome || '').toLowerCase().replace(' ', '-');
  document.getElementById('view-call-outcome').className = `outcome-badge ${outcomeClass}`;
  document.getElementById('view-call-notes').textContent = log.notes || 'No notes';

  modal.style.display = 'flex';
}

/**
 * Company view modal — shows linked opportunities, call logs and recent visits in tabs.
 * Accepts a company object or company id.
 */
async function openCompanyViewModal(companyOrId) {
  const modal = document.getElementById('company-view-modal');
  if (!modal) {
    showToast('Company view modal not found', 'error');
    return;
  }

  // Resolve company object
  let company = companyOrId;
  if (!company || (typeof company === 'string' || typeof company === 'number')) {
    const companyId = company || companyOrId;
    company = (Array.isArray(window.allCompaniesData) ? window.allCompaniesData.find(c => String(c.id) === String(companyId)) : null);
    if (!company) {
      const { data, error } = await supabaseClient.from('companies').select('*, company_categories(categories(id,name))').eq('id', companyId).single();
      if (error) {
        showToast('Unable to load company', 'error');
        return;
      }
      company = data;
    }
  }

  // ── Populate Hero Section ──
  const heroTitle = document.getElementById('company-view-modal-title');
  if (heroTitle) heroTitle.textContent = company.name || 'Company';

  // Hero Avatar (logo or initials)
  const heroAvatar = document.getElementById('company-view-hero-avatar');
  if (heroAvatar) {
    const initials = getInitials(company.name || 'C');
    const resolvedLogoUrl = company.logo_url || getCompanyLogoUrl(company.domain || '');
    heroAvatar.innerHTML = `<span style="position:relative;z-index:1">${initials}</span>${resolvedLogoUrl ? `<img src="${resolvedLogoUrl}" alt="${escapeHtml(company.name || '')}" onload="this.style.display='block';this.previousElementSibling.style.display='none'" onerror="this.style.display='none'" />` : ''}`;
  }

  // Hero type badge
  const heroBadge = document.getElementById('company-view-hero-type');
  if (heroBadge) {
    if (company.company_type) {
      heroBadge.textContent = company.company_type;
      heroBadge.style.display = 'inline-flex';
    } else {
      heroBadge.style.display = 'none';
    }
  }

  // Hero domain link
  const heroDomain = document.getElementById('company-view-hero-domain');
  if (heroDomain) {
    const rawDomain = company.domain ? String(company.domain).trim() : '';
    if (rawDomain) {
      let url = rawDomain;
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      const safeUrl = url.replace(/"/g, '&quot;');
      const displayDomain = rawDomain.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
      heroDomain.innerHTML = `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(displayDomain)}<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-left:3px"><path d="M18 13v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>`;
    } else {
      heroDomain.innerHTML = '';
    }
  }

  // Hero category chips
  const heroCats = document.getElementById('company-view-hero-cats');
  if (heroCats) {
    const cats = (company.company_categories && company.company_categories.length)
      ? company.company_categories.map(c => c.categories && c.categories.name ? c.categories.name : (c.name || '')).filter(Boolean)
      : [];
    heroCats.innerHTML = cats.map(cat => `<span class="record-hero-cat-chip">${escapeHtml(cat)}</span>`).join('');
  }

  // Wire Edit button
  const editBtn = document.getElementById('company-view-edit-btn');
  if (editBtn) {
    editBtn.onclick = () => {
      closeModal('company-view-modal');
      setTimeout(() => openCompanyModal(company), 100);
    };
  }

  // ── Populate Sidebar Fields ──
  const addressEl = document.getElementById('company-view-address'); if (addressEl) addressEl.textContent = company.address || '—';
  const coordsEl = document.getElementById('company-view-coordinates');
  if (coordsEl) {
    if (company.latitude && company.longitude) {
      const lat = company.latitude.toFixed(6);
      const lng = company.longitude.toFixed(6);
      coordsEl.innerHTML = `
        <a href="https://www.google.com/maps?q=${lat},${lng}" 
           target="_blank" 
           rel="noopener noreferrer" 
           style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;background:var(--bg-secondary);color:var(--color-primary);border-radius:6px;font-size:0.8rem;font-weight:600;text-decoration:none;transition:all 0.2s;border:1px solid var(--border-color);" 
           onmouseover="this.style.background='var(--bg-tertiary)';this.style.borderColor='var(--color-primary)';this.style.transform='translateY(-1px)'" 
           onmouseout="this.style.background='var(--bg-secondary)';this.style.borderColor='var(--border-color)';this.style.transform='none'">
          ${lat}, ${lng}
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.7"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        </a>`;
    } else {
      coordsEl.textContent = '—';
    }
  }
  const descEl = document.getElementById('company-view-desc'); if (descEl) descEl.textContent = company.description || '—';
  const catsEl = document.getElementById('company-view-categories');
  if (catsEl) {
    const catNames = (company.company_categories && company.company_categories.length)
      ? company.company_categories.map(c => c.categories && c.categories.name ? c.categories.name : (c.name || '')).filter(Boolean)
      : [];
    catsEl.innerHTML = catNames.length ? catNames.map(n => `<span class="record-hero-cat-chip">${escapeHtml(n)}</span>`).join(' ') : '—';
  }

  // Domain in sidebar (show/hide card)
  const domainEl = document.getElementById('company-view-domain');
  const domainCard = document.getElementById('company-view-domain-card');
  if (domainEl) {
    const rawDomainSidebar = company.domain ? String(company.domain).trim() : '';
    if (rawDomainSidebar) {
      let url2 = rawDomainSidebar;
      if (!/^https?:\/\//i.test(url2)) url2 = 'https://' + url2;
      const safeUrl2 = url2.replace(/"/g, '&quot;');
      domainEl.innerHTML = `<a href="${safeUrl2}" target="_blank" rel="noopener noreferrer">${rawDomainSidebar}</a>`;
      if (domainCard) domainCard.style.display = 'flex';
    } else {
      domainEl.textContent = '—';
      if (domainCard) domainCard.style.display = 'none';
    }
  }

  // Add a SafiFind button that opens a dedicated modal for searching nearby companies
  try {
    const headerActions = document.getElementById('company-view-header-actions');
    if (headerActions) {
      headerActions.innerHTML = '';
      const safiBtn = document.createElement('button');
      safiBtn.type = 'button';
      safiBtn.id = 'company-view-safifind-btn';
      safiBtn.className = 'record-hero-edit-btn';
      safiBtn.style.cssText = 'background:linear-gradient(135deg,var(--color-primary),#6366f1);color:#fff;border-color:transparent;';
      safiBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 17v4"/><path d="M14 3v8a2 2 0 0 0 2 2h5.865"/><path d="M17 17v4"/><path d="M18 17a4 4 0 0 0 4-4 8 6 0 0 0-8-6 6 5 0 0 0-6 5v3a2 2 0 0 0 2 2z"/><path d="M2 10v5"/><path d="M6 3h16"/><path d="M7 21h14"/><path d="M8 13H2"/></svg>
        SafiFind`;

      headerActions.appendChild(safiBtn);

      safiBtn.addEventListener('click', () => {
        try { closeModal('safifind-modal'); } catch (e) { /* ignore */ }
        const safiModal = document.getElementById('safifind-modal');
        if (!safiModal) {
          showToast('SafiFind modal not available', 'error');
          return;
        }

        // Store company coords on the modal dataset
        if (company && company.latitude && company.longitude) {
          safiModal.dataset.lat = company.latitude;
          safiModal.dataset.lon = company.longitude;
          const coordsEl = safiModal.querySelector('#safifind-coords');
          if (coordsEl) coordsEl.textContent = `${company.latitude.toFixed(6)}, ${company.longitude.toFixed(6)}`;
        } else {
          safiModal.dataset.lat = '';
          safiModal.dataset.lon = '';
          const coordsEl = safiModal.querySelector('#safifind-coords');
          if (coordsEl) coordsEl.textContent = 'Not available for this company';
        }

        // Prefill defaults
        const radiusInput = safiModal.querySelector('#safifind-radius');
        const filterSelect = safiModal.querySelector('#safifind-filter');
        if (radiusInput) radiusInput.value = company.radius || 2000;
        if (filterSelect) filterSelect.value = 'both';

        // Clear previous results
        document.getElementById('safifind-results').innerHTML = '';

        safiModal.style.display = 'flex';

        // Initialize Map
        setTimeout(() => {
          if (window.safifindMap) {
            window.safifindMap.remove();
            window.safifindMap = null;
          }

          const lat = parseFloat(safiModal.dataset.lat);
          const lon = parseFloat(safiModal.dataset.lon);
          const mapEl = document.getElementById('safifind-map');
          if (!mapEl) {
            console.error('SafiFind map container not found in DOM');
            return;
          }

          if (!isNaN(lat) && !isNaN(lon)) {
            window.safifindMap = L.map('safifind-map').setView([lat, lon], 14);
            L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
              attribution: '&copy; OpenStreetMap contributors'
            }).addTo(window.safifindMap);

            // Force redraw to handle flex sizing
            setTimeout(() => window.safifindMap.invalidateSize(), 50);

            // Add center marker (enhanced)
            L.marker([lat, lon], {
              icon: L.divIcon({
                className: 'custom-div-icon',
                html: `
                  <div style="position:relative; width:16px; height:16px;">
                    <div style="position:absolute; top:0; left:0; background:var(--color-primary); width:16px; height:16px; border:2.5px solid #fff; border-radius:50%; box-shadow:0 0 15px var(--color-primary); z-index:2;"></div>
                    <div style="position:absolute; top:0; left:0; width:16px; height:16px; background:var(--color-primary); border-radius:50%; animation: pulse-marker 2s infinite; opacity:0.5; z-index:1;"></div>
                  </div>
                  <style>
                    @keyframes pulse-marker {
                      0% { transform: scale(1); opacity: 0.5; }
                      70% { transform: scale(3); opacity: 0; }
                      100% { transform: scale(3); opacity: 0; }
                    }
                  </style>`,
                iconSize: [16, 16],
                iconAnchor: [8, 8]
              })
            }).addTo(window.safifindMap).bindPopup('Current Location');

            // Add radius circle
            window.safifindRadiusCircle = L.circle([lat, lon], {
              radius: parseInt(radiusInput.value) || 2000,
              color: 'var(--color-primary)',
              fillColor: 'var(--color-primary)',
              fillOpacity: 0.1,
              weight: 1
            }).addTo(window.safifindMap);

            radiusInput.oninput = () => {
              const r = parseInt(radiusInput.value) || 2000;
              if (window.safifindRadiusCircle) window.safifindRadiusCircle.setRadius(r);
            };
          }
        }, 100);
      });
    }
  } catch (e) {
    console.warn('Failed to init SafiFind button', e);
  }

  // Wire up find button
  try {
    const safiModal = document.getElementById('safifind-modal');
    if (safiModal) {
      const findBtn = safiModal.querySelector('#safifind-find-btn');
      if (findBtn) {
        findBtn.onclick = async () => {
          const lat = parseFloat(safiModal.dataset.lat);
          const lon = parseFloat(safiModal.dataset.lon);
          const radius = parseInt(safiModal.querySelector('#safifind-radius').value) || 2000;
          const filterVal = (safiModal.querySelector('#safifind-filter')?.value) || 'both';

          if (isNaN(lat) || isNaN(lon)) {
            showToast('Coordinates required for search.', 'error');
            return;
          }

          findBtn.disabled = true;
          findBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Searching...';

          try {
            const results = await searchNearbyOverpass(lat, lon, radius, [filterVal]);
            const existingNames = (Array.isArray(window.allCompaniesData) ? window.allCompaniesData : []).map(c => normalizeSearchText(c.name || ''));
            const filtered = (results || []).filter(r => r.name && !existingNames.includes(normalizeSearchText(r.name))).slice(0, 150);

            // Clear old search markers immediately
            if (window.safifindMap) {
              if (window.safifindMarkers) window.safifindMarkers.forEach(m => window.safifindMap.removeLayer(m));
              window.safifindMarkers = [];
            }

            // Render result cards
            const resultsEl = document.getElementById('safifind-results');
            const countEl = document.getElementById('safifind-count');
            if (countEl) countEl.textContent = `${results.length > 150 ? '150+' : results.length} shown`;

            if (filtered.length === 0) {
              resultsEl.innerHTML = '<div class="empty-results">No new companies found in this area.</div>';
            } else {
              resultsEl.innerHTML = filtered.map(it => `
                <div id="safifind-result-card">
                  <div class="safifind-result-info">
                    <div class="safifind-result-name" title="${escapeHtml(it.name)}">${escapeHtml(it.name)}</div>
                    <div class="safifind-result-meta">
                      <span class="safifind-category-badge">${escapeHtml(it.tags.shop || it.tags.office || it.tags.amenity || 'Company')}</span>
                      <span>·</span>
                      <span>${Math.round(it.distance)}m away</span>
                    </div>
                  </div>
                  <div class="safifind-result-actions">
                    <button class="btn btn-sm btn-ghost" onclick="window.open('https://www.openstreetmap.org/${it.type}/${it.id}', '_blank')">Info</button>
                    <button class="btn btn-sm btn-primary add-safifind" data-name="${escapeHtml(it.name)}" data-lat="${it.lat}" data-lon="${it.lon}" data-addr="${escapeHtml(it.displayName)}" data-site="${escapeHtml(it.tags.website || '')}" data-phone="${escapeHtml(it.tags.phone || '')}">Add to CRM</button>
                  </div>
                </div>
              `).join('');

              // Wire Add buttons
              resultsEl.querySelectorAll('.add-safifind').forEach(btn => {
                btn.onclick = () => {
                  const d = btn.dataset;
                  closeModal('safifind-modal');
                  closeModal('company-view-modal');
                  openCompanyModal();
                  setTimeout(() => {
                    if (document.getElementById('company-name-input')) document.getElementById('company-name-input').value = d.name;
                    if (document.getElementById('company-latitude')) document.getElementById('company-latitude').value = parseFloat(d.lat).toFixed(6);
                    if (document.getElementById('company-longitude')) document.getElementById('company-longitude').value = parseFloat(d.lon).toFixed(6);
                    if (document.getElementById('company-address')) document.getElementById('company-address').value = d.addr;
                    const domainEl = document.getElementById('company-domain');
                    if (domainEl && d.site) domainEl.value = d.site;
                    // Note: If you have a phone field for companies, set it here.
                  }, 100);
                };
              });

              // Add markers to map (dots instead of pins)
              if (window.safifindMap) {
                filtered.forEach(it => {
                  const m = L.circleMarker([it.lat, it.lon], {
                    radius: 7,
                    fillColor: 'var(--color-primary)',
                    color: '#fff',
                    weight: 2,
                    opacity: 1,
                    fillOpacity: 0.9
                  }).addTo(window.safifindMap);

                  m.bindPopup(`<b>${escapeHtml(it.name)}</b><br>${escapeHtml(it.displayName)}`);
                  window.safifindMarkers.push(m);
                });

                const group = new L.featureGroup([L.marker([lat, lon]), ...window.safifindMarkers]);
                window.safifindMap.fitBounds(group.getBounds().pad(0.1));
              }
            }
          } catch (err) {
            console.error('SafiFind search error', err);
            showToast('Search failed: ' + err.message, 'error');
          } finally {
            findBtn.disabled = false;
            findBtn.innerHTML = 'Find Nearby';
          }
        };
      }
    }
  } catch (e) {
    console.warn('Failed to wire SafiFind modal', e);
  }


  // Loading placeholders for tabs
  document.getElementById('company-view-opps').innerHTML = '<div class="record-empty-state"><div class="record-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div><div class="record-empty-title">Loading...</div></div>';
  const employeesContainer = document.getElementById('company-view-employees');
  if (employeesContainer) employeesContainer.innerHTML = '<div class="record-empty-state"><div class="record-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></div><div class="record-empty-title">Loading...</div></div>';
  document.getElementById('company-view-calls').innerHTML = '<div class="record-empty-state"><div class="record-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.79 19.79 0 0 1 11.63 19"/></svg></div><div class="record-empty-title">Loading...</div></div>';
  document.getElementById('company-view-visits').innerHTML = '<div class="record-empty-state"><div class="record-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/></svg></div><div class="record-empty-title">Loading...</div></div>';

  modal.style.display = 'flex';

  // Tab switching for the company view modal
  const companyTabs = modal.querySelectorAll('.company-view-tab');
  companyTabs.forEach(tab => {
    tab.onclick = () => {
      companyTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const name = tab.dataset.tab;
      document.getElementById('company-view-opps').style.display = name === 'opps' ? 'block' : 'none';
      const employeesEl = document.getElementById('company-view-employees');
      if (employeesEl) employeesEl.style.display = name === 'employees' ? 'block' : 'none';
      document.getElementById('company-view-calls').style.display = name === 'calls' ? 'block' : 'none';
      document.getElementById('company-view-visits').style.display = name === 'visits' ? 'block' : 'none';
    };
  });



  // Fetch related records in parallel (by id and by name to be safe)
  const [oppsById, oppsByName, callsById, callsByName, visitsById, visitsByName, peopleById, peopleByName] = await Promise.all([
    supabaseClient.from('opportunities').select('*').eq('company_id', company.id),
    supabaseClient.from('opportunities').select('*').eq('company_name', company.name),
    supabaseClient.from('call_logs').select('*, people(*), profiles(*)').eq('company_id', company.id).order('call_at', { ascending: false }).limit(50),
    supabaseClient.from('call_logs').select('*, people(*), profiles(*)').eq('company_name', company.name).order('call_at', { ascending: false }).limit(50),
    supabaseClient.from('visits').select('*, user:profiles(first_name,last_name)').eq('company_id', company.id).order('created_at', { ascending: false }).limit(10),
    supabaseClient.from('visits').select('*, user:profiles(first_name,last_name)').eq('company_name', company.name).order('created_at', { ascending: false }).limit(10),
    // Query people by company_id (most reliable). Avoid ordering by potentially missing columns.
    supabaseClient.from('people').select('*').eq('company_id', company.id).limit(200),
    // Fallback: try to find people where the name contains the company name (less reliable but avoids using non-existent company_name column).
    supabaseClient.from('people').select('*').ilike('name', `%${String(company.name || '').replace(/%/g, '')}%`).limit(200)
  ]);

  const dedupeById = (arr) => {
    const map = new Map();
    (arr || []).forEach(i => { if (i && i.id) map.set(String(i.id), i); });
    return Array.from(map.values());
  };

  const opportunities = dedupeById([...(oppsById.data || []), ...(oppsByName.data || [])]);
  const calls = (dedupeById([...(callsById.data || []), ...(callsByName.data || [])]) || []).slice(0, 50);
  const visits = (dedupeById([...(visitsById.data || []), ...(visitsByName.data || [])]) || []).slice(0, 10);
  console.debug('openCompanyViewModal called for company', { id: company.id, name: company.name });
  const peopleFromWindow = Array.isArray(window.allPeopleData) ? (window.allPeopleData.filter(p => String(p.company_id || '') === String(company.id) || String((p.company_name || '')).trim() === String((company.name || '')).trim())) : [];

  let employees = dedupeById([...(peopleFromWindow || []), ...(peopleById.data || []), ...(peopleByName.data || [])]);


  // If the combined list is empty, try a more forgiving fallback query
  if ((!employees || employees.length === 0) && typeof supabaseClient !== 'undefined') {
    try {
      const nameFilter = String(company.name || '').replace(/'/g, "''");
      const orFilter = `company_id.eq.${company.id},company_name.ilike.%${nameFilter}%`;
      const { data: peopleFallback, error: peopleFallbackError } = await supabaseClient.from('people').select('*').or(orFilter).limit(200);
      if (!peopleFallbackError && Array.isArray(peopleFallback) && peopleFallback.length > 0) {
        employees = dedupeById([...(employees || []), ...peopleFallback]);
      }
    } catch (err) {
      crmDebugLog('company-view-people-fallback-error', err);
    }
  }

  // Render a richer summary area with avatar, key stats and actions
  try {
    const summaryEl = document.getElementById('company-view-summary');
    if (summaryEl) {
      const resolvedLogoUrl = company.logo_url || getCompanyLogoUrl(company.domain || '');
      const initials = getInitials(company.name || 'U');
      const logoHtml = `
        <div style="position:relative;width:48px;height:48px;">
          <div class="company-summary-initials" style="width:48px;height:48px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-weight:600">${initials}</div>
          ${resolvedLogoUrl ? `<img src="${resolvedLogoUrl}" alt="${company.name}" style="display:none;width:48px;height:48px;object-fit:contain;border-radius:6px;position:absolute;left:0;top:0;" onload="this.style.display='block'; this.previousElementSibling.style.display='none'" onerror="this.style.display='none'" />` : ''}
        </div>
      `;
      const shortAddress = company.address ? (String(company.address).split(',')[0]) : '—';
      const cats = (company.company_categories && company.company_categories.length) ? company.company_categories.map(c => c.categories && c.categories.name ? c.categories.name : (c.name || '')).filter(Boolean) : [];

      // Keep the summary read-only: show only primary identity (name + type).
      // Full description, address and categories are shown in the right-hand sidebar to avoid duplication.
      // Render domain link next to name (no explicit label)
      const rawDomain = company.domain ? String(company.domain).trim() : '';
      let domainHtml = '';
      if (rawDomain) {
        let domainUrl = rawDomain;
        if (!/^https?:\/\//i.test(domainUrl)) domainUrl = 'https://' + domainUrl;
        const safeUrl = domainUrl.replace(/"/g, '&quot;');
        const displayDomain = rawDomain.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
        // Render as a distinct pill with a small external-link icon
        domainHtml = `<span class="company-summary-domain"><a class="company-summary-domain-link" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(displayDomain)} <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg></a></span>`;
      }

      summaryEl.innerHTML = `
        <div class="company-summary">
          <div class="company-summary-head">
            <div class="company-summary-avatar">${logoHtml}</div>
            <div class="company-summary-main">
              <div style="display:flex;align-items:center;gap:8px;">
                <div class="company-summary-name">${escapeHtml(company.name || '—')}</div>
                ${domainHtml}
              </div>
              <div class="company-summary-meta">${escapeHtml(company.company_type || '—')}</div>
            </div>
          </div>
        </div>
      `;
    }
  } catch (e) {
    crmDebugLog('company-view-summary-render-error', e);
  }


  // Render Opportunities tab (premium cards)
  const oppsEl = document.getElementById('company-view-opps');
  if (!opportunities || opportunities.length === 0) {
    oppsEl.innerHTML = `<div class="record-empty-state"><div class="record-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div><div class="record-empty-title">No opportunities linked</div><div class="record-empty-desc">This company is not linked to any active opportunities yet.</div></div>`;
  } else {
    const stageColors = { prospecting: '#6366f1', qualification: '#f59e0b', proposal: '#3b82f6', negotiation: '#f97316', won: '#22c55e', lost: '#ef4444' };
    oppsEl.innerHTML = opportunities.map(opp => {
      const stageKey = (opp.stage || '').toLowerCase();
      const stageColor = stageColors[stageKey] || 'var(--color-primary)';
      const val = parseFloat(opp.value || 0);
      return `
        <div class="record-opp-card" data-id="${opp.id}">
          <div class="record-opp-card-stage" style="background:${stageColor}"></div>
          <div class="record-opp-card-body">
            <div class="record-opp-card-name">${escapeHtml(opp.name || '—')}</div>
            <div class="record-opp-card-meta">
              <span class="stage-pill" style="background:${stageColor}1a;color:${stageColor};border-color:${stageColor}40">${escapeHtml(opp.stage || '—')}</span>
              <span>${opp.probability || 0}% probability</span>
            </div>
          </div>
          <div class="record-opp-card-value">Ksh ${val.toLocaleString()}</div>
          <div class="record-opp-card-action"><button class="btn btn-sm btn-ghost view-opportunity" data-id="${opp.id}">View</button></div>
        </div>
      `;
    }).join('');

    // Attach view handlers
    oppsEl.querySelectorAll('.view-opportunity').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const opp = opportunities.find(o => String(o.id) === String(id));
        if (opp) {
          closeModal('company-view-modal');
          const isOwnOpportunity = !isManager || opp.user_id === currentUser.id;
          openOpportunityModal(opp, !isOwnOpportunity);
        }
      });
    });
  }

  // Render Call Logs tab (premium rows)
  const callsEl = document.getElementById('company-view-calls');
  if (!calls || calls.length === 0) {
    callsEl.innerHTML = `<div class="record-empty-state"><div class="record-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.79 19.79 0 0 1 11.63 19a19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72"/></svg></div><div class="record-empty-title">No call logs</div><div class="record-empty-desc">No call records found for this company.</div></div>`;
  } else {
    callsEl.innerHTML = calls.map(log => {
      const isInbound = (log.direction || '').toLowerCase() === 'inbound';
      const phoneIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.79 19.79 0 0 1 11.63 19a19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3"/></svg>`;
      const contactName = escapeHtml(log.people ? (log.people.name || '') : (log.contact_name || 'Unknown'));
      const repName = escapeHtml(log.profiles ? `${log.profiles.first_name || ''} ${log.profiles.last_name || ''}`.trim() : '');
      return `
        <div class="record-call-row" data-id="${log.id}">
          <div class="record-call-icon${isInbound ? ' record-call-icon--inbound' : ''}">${phoneIcon}</div>
          <div class="record-call-body">
            <div class="record-call-contact">${contactName}</div>
            <div class="record-call-meta">${formatDateWithTime(log.call_at)}${repName ? ` · ${repName}` : ''}</div>
          </div>
          <div class="record-call-right">
            <span class="record-call-outcome-pill">${escapeHtml(log.outcome || 'N/A')}</span>
            <button class="btn btn-sm btn-ghost view-call-log" data-id="${log.id}">View</button>
          </div>
        </div>
      `;
    }).join('');

    callsEl.querySelectorAll('.view-call-log').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const log = calls.find(l => String(l.id) === String(id));
        if (log) {
          closeModal('company-view-modal');
          openCallLogViewModal(log);
        }
      });
    });
  }

  // Render Recent Visits tab (premium rows)
  const visitsEl = document.getElementById('company-view-visits');
  if (!visits || visits.length === 0) {
    visitsEl.innerHTML = `<div class="record-empty-state"><div class="record-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg></div><div class="record-empty-title">No recent visits</div><div class="record-empty-desc">No visits have been recorded for this company yet.</div></div>`;
  } else {
    const pinSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
    visitsEl.innerHTML = visits.map(v => {
      const repName = v.user ? `${v.user.first_name || ''} ${v.user.last_name || ''}`.trim() : '';
      return `
        <div class="record-visit-row" data-id="${v.id}">
          <div class="record-visit-dot">${pinSvg}</div>
          <div class="record-visit-body">
            <div class="record-visit-type">${escapeHtml(v.contact_name || v.visit_type || 'Visit')}</div>
            <div class="record-visit-meta">${escapeHtml(v.visit_type || '')} · ${formatDate(v.created_at)}${repName ? ` · ${repName}` : ''}</div>
            ${v.notes ? `<div class="record-visit-notes">${escapeHtml(v.notes)}</div>` : ''}
          </div>
          <div class="record-visit-action"><button class="btn btn-sm btn-ghost view-visit" data-id="${v.id}">View</button></div>
        </div>
      `;
    }).join('');

    // Attach visit view handlers
    visitsEl.querySelectorAll('.view-visit').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        closeModal('company-view-modal');
        await fetchAndOpenVisit(id);
      });
    });
  }

  // Render Employees tab (premium rows)
  try {
    const employeesEl = document.getElementById('company-view-employees');
    if (employeesEl) {
      if (!employees || employees.length === 0) {
        employeesEl.innerHTML = `<div class="record-empty-state"><div class="record-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></div><div class="record-empty-title">No people linked</div><div class="record-empty-desc">No contacts are linked to this company yet.</div></div>`;
      } else {
        employeesEl.innerHTML = employees.map(p => {
          const fullName = escapeHtml(p.name || (p.first_name ? `${p.first_name} ${p.last_name}` : '—'));
          const initials = getInitials(p.name || (p.first_name ? `${p.first_name} ${p.last_name}` : ''));
          return `
            <div class="record-employee-row" data-id="${p.id}">
              <div class="record-employee-avatar">${initials}</div>
              <div class="record-employee-body">
                <div class="record-employee-name">${fullName}</div>
                <div class="record-employee-role">${escapeHtml(p.job_title || p.role || '—')}</div>
              </div>
              <div class="record-employee-action"><button class="btn btn-sm btn-ghost view-employee" data-id="${p.id}">View</button></div>
            </div>
          `;
        }).join('');

        employeesEl.querySelectorAll('.view-employee').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            const personObj = (employees || []).find(p => String(p.id) === String(id));
            if (personObj) {
              closeModal('company-view-modal');
              openPersonViewModal(personObj);
            } else {
              closeModal('company-view-modal');
              openPersonViewModal(id);
            }
          });
        });
      }
    }
  } catch (err) {
    crmDebugLog('company-view-employees-render-error', err);
  }

  if (window.lucide) lucide.createIcons();
}


function openCallLogModal(log = null) {
  const modal = document.getElementById('call-log-modal');
  const title = document.getElementById('call-log-modal-title');
  const saveBtn = document.getElementById('save-call-log-btn');

  title.textContent = log ? 'Edit Call Log' : 'Log New Call';

  // Reset form
  document.getElementById('call-contact-input').value = log ? (log.people ? log.people.name : log.contact_name) : '';
  document.getElementById('call-contact-id').value = log ? log.contact_id || '' : '';
  document.getElementById('call-company-input').value = log ? (log.companies ? log.companies.name : log.company_name) : '';
  document.getElementById('call-company-id').value = log ? log.company_id || '' : '';
  document.getElementById('call-direction').value = log ? log.direction : 'Outbound';
  document.getElementById('call-datetime').value = log ? new Date(log.call_at).toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16);
  document.getElementById('call-duration').value = log ? Math.floor(log.duration_seconds / 60) : '';
  document.getElementById('call-notes').value = log ? log.notes || '' : '';

  // Outcome selection
  if (log) {
    const radio = document.querySelector(`input[name = "call-outcome"][value = "${log.outcome}"]`);
    if (radio) radio.checked = true;
  } else {
    document.querySelectorAll('input[name="call-outcome"]').forEach(r => r.checked = false);
  }

  // Direction radio sync
  const dirVal = log ? log.direction : 'Outbound';
  document.getElementById('call-direction').value = dirVal;
  document.querySelectorAll('input[name="call-direction-radio"]').forEach(r => {
    r.checked = r.value === dirVal;
    r.onchange = () => { document.getElementById('call-direction').value = r.value; };
  });

  modal.style.display = 'flex';

  // Live Search Handlers
  initCallLogSearch();

  saveBtn.onclick = () => saveCallLog(log?.id);
}

function initCallLogSearch() {
  const contactInput = document.getElementById('call-contact-input');
  const contactResults = document.getElementById('call-contact-results');
  const companyInput = document.getElementById('call-company-input');
  const companyResults = document.getElementById('call-company-results');

  const handleSearch = (input, resultsContainer, type, idField) => {
    // Clear existing listeners by cloning
    const newInput = input.cloneNode(true);
    input.parentNode.replaceChild(newInput, input);

    newInput.addEventListener('input', async (e) => {
      const val = e.target.value.toLowerCase();
      if (val.length < 1) {
        resultsContainer.classList.remove('active');
        return;
      }

      let matches = [];
      if (type === 'people') {
        matches = allPeople.filter(p => matchesTokenizedQuery(val, p.name, p.email, p.job_title, p.companies?.name)).slice(0, 5);
      } else {
        matches = (window.allCompaniesData || []).filter(c => matchesTokenizedQuery(val, c.name, c.description, c.address)).slice(0, 5);
      }

      let html = matches.map(m => {
        let avatarHtml;
        if (type === 'people') {
          const initials = escapeHtml(getInitials(m.name));
          avatarHtml = `<div class="opp-suggest-avatar opp-suggest-avatar--person"><span>${initials}</span></div>`;
        } else {
          const initials = escapeHtml(getInitials(m.name));
          const domain = m.website ? m.website.replace(/^https?:\/\//, '').split('/')[0] : null;
          const logoUrl = domain ? getCompanyLogoUrl(domain) : null;
          avatarHtml = `<div class="opp-suggest-avatar">
            ${logoUrl ? `<img class="opp-suggest-logo" src="${logoUrl}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
            <span>${initials}</span>
          </div>`;
        }
        const subtitle = type === 'people'
          ? escapeHtml(m.companies?.name || m.job_title || '')
          : escapeHtml(m.address || m.description || '');
        return `<div class="search-result-item" data-id="${m.id}" data-name="${escapeHtml(m.name)}">
          ${avatarHtml}
          <div class="search-result-text">
            <span class="title">${escapeHtml(m.name)}</span>
            ${subtitle ? `<span class="subtitle">${subtitle}</span>` : ''}
          </div>
        </div>`;
      }).join('');

      html += `<div class="search-result-item add-new" data-id="" data-name="${escapeHtml(e.target.value)}">
        <div class="opp-suggest-avatar opp-suggest-avatar--custom"><span>+</span></div>
        <div class="search-result-text">
          <span class="title">Use: "${escapeHtml(e.target.value)}"</span>
        </div>
      </div>`;

      resultsContainer.innerHTML = html;
      resultsContainer.classList.add('active');

      resultsContainer.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', () => {
          newInput.value = item.dataset.name;
          document.getElementById(idField).value = item.dataset.id;
          resultsContainer.classList.remove('active');
        });
      });
    });

    // Close results on blur after short delay
    newInput.addEventListener('blur', () => {
      setTimeout(() => resultsContainer.classList.remove('active'), 200);
    });
  };

  handleSearch(contactInput, contactResults, 'people', 'call-contact-id');
  handleSearch(companyInput, companyResults, 'companies', 'call-company-id');
}

async function saveCallLog(logId = null) {
  const contactName = document.getElementById('call-contact-input').value;
  const contactId = document.getElementById('call-contact-id').value || null;
  const companyName = document.getElementById('call-company-input').value;
  const companyId = document.getElementById('call-company-id').value || null;
  const direction = document.getElementById('call-direction').value;
  const callAt = document.getElementById('call-datetime').value;
  const durationMins = document.getElementById('call-duration').value;
  const notes = document.getElementById('call-notes').value;
  const outcomeEl = document.querySelector('input[name="call-outcome"]:checked');

  if (!contactName || !outcomeEl) {
    showToast('Contact and Outcome are required', 'error');
    return;
  }

  const logData = {
    user_id: currentUser.id,
    contact_name: contactId ? null : contactName,
    contact_id: contactId,
    company_name: companyId ? null : companyName,
    company_id: companyId,
    direction,
    call_at: new Date(callAt).toISOString(),
    duration_seconds: durationMins ? durationMins * 60 : null,
    outcome: outcomeEl.value,
    notes,
    organization_id: currentOrganization?.id
  };

  const saveBtn = document.getElementById('save-call-log-btn');
  saveBtn.disabled = true;

  let res;
  if (logId) {
    res = await supabaseClient.from('call_logs').update(logData).eq('id', logId);
  } else {
    res = await supabaseClient.from('call_logs').insert([logData]);
  }

  saveBtn.disabled = false;

  if (res.error) {
    showToast('Error saving log: ' + res.error.message, 'error');
  } else {
    showToast('Call log saved', 'success');
    closeModal('call-log-modal');
    renderCallLogsView();
  }
}
