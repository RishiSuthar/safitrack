const SUPABASE_URL = 'https://ndrkncirkekpqjjkasiy.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5kcmtuY2lya2VrcHFqamthc2l5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU2MDU2MTEsImV4cCI6MjA4MTE4MTYxMX0.SGVLqU6-u1ALj_P1nsyytYe7cNbAyxCVbV6kjAaiGU4';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = null;
let isManager = false;
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

const CRM_DEBUG = false;
function crmDebugLog(label, payload) {
  return;
}

// Call log filters
let callLogFilters = {
  search: '',
  direction: '',
  outcome: ''
};
let filterDebounceTimer = null;

// Spreadsheet State
let currentSortKey = 'name';
let currentSortDir = 'asc';
let currentFilters = {
  company_type: '',
  person_company: ''
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
const themeToggle = document.getElementById('theme-toggle');
const commandPaletteBtn = document.getElementById('command-palette-btn');
const commandPalette = document.getElementById('command-palette');
const exportBtn = document.getElementById('export-btn');
const logoutBtn = document.getElementById('logout-btn');

const APP_BOOT_STARTED_AT = performance.now();
const FAST_BOOT_SKIP_MS = 500;
const LOADER_FADE_MS = 180;
let authBootstrapHandled = false;

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
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme);
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
      authScreen.style.display = 'none';
      initApp();
    } else if (event === 'SIGNED_OUT') {
      currentUser = null;
      mainApp.style.display = 'none';
      authScreen.style.display = 'flex';
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

  // Logout
  logoutBtn.addEventListener('click', handleLogout);

  // Mobile menu
  mobileMenuToggle?.addEventListener('click', openSidebar);
  sidebarClose?.addEventListener('click', closeSidebar);
  sidebarOverlay?.addEventListener('click', closeSidebar);

  // User menu
  userAvatarBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    userMenu.classList.toggle('active');
  });

  document.addEventListener('click', (e) => {
    if (!userMenu?.contains(e.target)) {
      userMenu?.classList.remove('active');
    }
  });

  // Theme toggle
  themeToggle?.addEventListener('click', toggleTheme);

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

  // Export
  exportBtn?.addEventListener('click', () => {
    userMenu?.classList.remove('active');
    openExportModal();
  });

  // Navigation
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const view = e.currentTarget.getAttribute('data-view');
      loadView(view);
      closeSidebar();
    });
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
  await supabaseClient.auth.signOut();
  location.reload();
}

// ======================
// APP INITIALIZATION
// ======================

async function initApp() {
  authScreen.style.display = 'none';
  mainApp.style.display = 'flex';

  const { data: profile, error } = await supabaseClient
    .from('profiles')
    .select('role, first_name, last_name, email')
    .eq('id', currentUser.id)
    .single();

  if (error) {
    showToast('Error loading profile: ' + error.message, 'error');
    return;
  }

  isManager = profile.role === 'manager';
  isTechnician = profile.role === 'technician';

  // Update UI based on role
  updateUserDisplay(profile);
  updateNavigationForRole();

  // Load all people for mention functionality
  await loadAllPeople();

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
  const [peopleResult, companiesResult] = await Promise.all([
    supabaseClient
      .from('people')
      .select('id, name, email, company_id')
      .order('name', { ascending: true }),
    supabaseClient
      .from('companies')
      .select('id, name')
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
    ['sales-funnel', 'opportunity-pipeline', 'call-logs', 'companies', 'people', 'user-management'].forEach(view => {
      document.querySelectorAll(`.sidebar-nav [data-view="${view}"]`).forEach(el => el.style.display = 'none');
    });
    // Hide manager navigation
    managerNavSection.style.display = 'none';
  } else {
    // Sales rep view
    managerNavSection.style.display = 'none';
    technicianNavSection.style.display = 'none';
    if (managerBottomNav) managerBottomNav.style.display = 'none';


    // Ensure records are shown
    ['companies', 'people'].forEach(view => {
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
}

// ======================
// VIEW ROUTER
// ======================
async function loadView(viewName) {
  currentView = viewName;
  updateActiveNav(viewName);

  // Prevent technicians from accessing certain views
  const blockedForTechnician = ['sales-funnel', 'opportunity-pipeline', 'call-logs', 'companies', 'people', 'user-management'];
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

async function renderCompaniesView() {
  currentFilters.company_type = '';

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

  const primaryQuery = await supabaseClient
    .from('companies')
    .select(`
      *,
      company_categories(
        categories(
          id,
          name
        )
      )
    `)
    .order(safeSortKey, { ascending: currentSortDir === 'asc' });

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
    const fallbackQuery = await supabaseClient
      .from('companies')
      .select('*')
      .order(safeSortKey, { ascending: currentSortDir === 'asc' });

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
  let currentPage = 1;
  const recordsPerPage = 15; // Number of records per page
  let searchQuery = ''; // Separate search state

  // Function to render the companies table
  function renderCompaniesTable(companiesToRender, paginationInfo) {
    const columns = [
      { key: 'rank', label: '#', width: '50px', readOnly: true, sortable: false, render: (val, row) => (paginationInfo.currentPage - 1) * paginationInfo.recordsPerPage + companiesToRender.indexOf(row) + 1 },
      { key: 'name', label: 'Company Name', width: '250px', icon: 'building', sortable: true },
      { key: 'industry', label: 'Industry', width: '150px', readOnly: true, icon: 'briefcase', sortable: false, render: (val, row) => val || row.company_categories?.map(c => c.categories.name).join(', ') || 'N/A' },
      { key: 'address', label: 'Location', width: '190px', icon: 'map-pin' },
      {
        key: 'company_type',
        label: 'Type',
        width: '120px',
        icon: 'tag',
        sortable: true,
        type: 'select',
        options: ['Competitor', 'Customer', 'Distributor', 'Investor', 'Partner', 'Reseller', 'Supplier', 'Vendor', 'Other']
      },
      {
        key: 'actions', label: 'Actions', width: '100px', readOnly: true, sortable: false, render: (val, row) => `
        <div class="table-actions">
          <button class="action-btn edit-company" data-id="${row.id}" title="Edit company"><i data-lucide="square-pen"></i></button>
          <button class="action-btn delete-company" data-id="${row.id}" title="Delete company"><i data-lucide="trash-2"></i></button>
        </div>
      `}
    ];

    let html = `
      <div class="view-header-minimal">
        <div class="view-breadcrumb">
          <span>Companies</span>
        </div>
        <div class="view-actions">
          <button class="toolbar-btn" id="companies-import-export-btn">
            <i data-lucide="file-up"></i> Import / Export
          </button>
        </div>
      </div>

      <div class="view-toolbar">
        <div class="search-container" style="flex: 1; max-width: 320px;">
          <i data-lucide="search" style="width: 16px; height: 16px; margin-left: 12px; color: var(--text-muted);"></i>
          <input type="text" id="companies-search" placeholder="Search companies...">
          <div id="clear-companies-search" class="search-clear-btn hidden" title="Clear search">
            <i data-lucide="x" style="width: 16px; height: 16px;"></i>
          </div>
        </div>
        
        <div style="flex: 1;"></div>
        <button class="toolbar-btn toolbar-btn-primary" id="add-company-btn">
          <i data-lucide="plus" style="width: 16px; height: 16px;"></i> New Company
        </button>
      </div>
      
      ${renderEditableDataTable(companiesToRender, columns, 'companies-spreadsheet', 'companies')}
      
      <div id="companies-pagination" style="padding: 16px;"></div>
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
        const result = searchAndPaginate(
          window.allCompaniesData,
          searchQuery,
          currentPage,
          recordsPerPage,
          (company, query) =>
            company.name.toLowerCase().includes(query) ||
            (company.description && company.description.toLowerCase().includes(query))
        );
        renderCompaniesTable(result.data, result);
      }
    );

    // Initialize event listeners
    initializeCompaniesEventListeners();
  }

  // Separate function to initialize event listeners
  function initializeCompaniesEventListeners() {

    document.getElementById('companies-import-export-btn')?.addEventListener('click', () => {
      openCompaniesImportExportModal();
    });

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

        // Use a small delay to avoid too many rapid searches
        clearTimeout(newSearchInput.searchTimeout);
        newSearchInput.searchTimeout = setTimeout(() => {
          currentPage = 1; // Reset to first page when searching
          const result = searchAndPaginate(
            window.allCompaniesData,
            searchQuery,
            currentPage,
            recordsPerPage,
            (company, query) =>
              company.name.toLowerCase().includes(query) ||
              (company.description && company.description.toLowerCase().includes(query))
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

    // Edit and delete buttons
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
          (company, query) =>
            company.name.toLowerCase().includes(query) ||
            (company.description && company.description.toLowerCase().includes(query))
        );

        // Adjust current page if necessary
        if (result.data.length === 0 && result.currentPage > 1) {
          currentPage--;
          const adjustedResult = searchAndPaginate(
            window.allCompaniesData,
            searchQuery,
            currentPage,
            recordsPerPage,
            (company, query) =>
              company.name.toLowerCase().includes(query) ||
              (company.description && company.description.toLowerCase().includes(query))
          );
          renderCompaniesTable(adjustedResult.data, adjustedResult);
        } else {
          renderCompaniesTable(result.data, result);
        }
      });
    });

    // Clear search event
    const clearSearchBtn = document.getElementById('clear-companies-search');
    if (clearSearchBtn) {
      if (searchQuery) clearSearchBtn.classList.remove('hidden');
      clearSearchBtn.onclick = () => {
        searchQuery = '';
        searchInput.value = '';
        clearSearchBtn.classList.add('hidden');
        currentPage = 1;
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
        currentPage = 1;
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
        if (searchQuery) {
          clearSearchBtn?.classList.remove('hidden');
        } else {
          clearSearchBtn?.classList.add('hidden');
        }

        currentPage = 1;
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
    1,
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
    const q = query.toLowerCase();
    return company.name.toLowerCase().includes(q) ||
      (company.description && company.description.toLowerCase().includes(q)) ||
      (company.address && company.address.toLowerCase().includes(q));
  }
}



// Update the openCompanyModal function to use the global data
function openCompanyModal(company = null) {
  const modal = document.getElementById('company-modal');
  const modalTitle = document.getElementById('company-modal-title');
  const saveBtn = document.getElementById('save-company-btn');

  // Reset form
  document.getElementById('company-name-input').value = '';
  document.getElementById('company-type').value = '';
  document.getElementById('company-description').value = '';
  document.getElementById('company-address').value = '';
  document.getElementById('company-latitude').value = '';
  document.getElementById('company-longitude').value = '';
  document.getElementById('company-radius').value = '200';

  // Clear categories
  document.getElementById('categories-container').innerHTML = '<input type="text" class="categories-input" id="categories-input" placeholder="Add category...">';
  companyCategories = [];

  // Set modal title and show manual coordinates section
  if (company) {
    modalTitle.innerHTML = 'Edit Company';

    // Fill form with company data
    document.getElementById('company-name-input').value = company.name || '';
    document.getElementById('company-type').value = company.company_type || '';
    document.getElementById('company-description').value = company.description || '';
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
  }

  // Show modal
  modal.style.display = 'flex';

  // Initialize event listeners
  initCompanyModalListeners(company);
}


function initCompanyModalListeners(company) {
  const categoriesInput = document.getElementById('categories-input');
  const saveBtn = document.getElementById('save-company-btn');

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

  // Save company
  // In initCompanyModalListeners function, update the save button handler:
  saveBtn.onclick = async () => {
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

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

    try {
      const companyData = {
        name,
        company_type: companyType,
        description: description || null,
        address: address, // Make sure this is included
        latitude,
        longitude,
        radius,
        created_by: currentUser.id
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

      showToast(`Company ${company ? 'updated' : 'created'} successfully!`, 'success');
      closeModal('company-modal');
      renderCompaniesView();

    } catch (error) {
      console.error('Error saving company:', error);
      showToast(`Error ${company ? 'updating' : 'creating'} company: ${error.message}`, 'error');

    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = 'Save Company';
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
  currentFilters.person_company = '';

  const sortablePeopleColumns = ['name', 'email', 'job_title', 'phone_numbers'];
  const safeSortKey = sortablePeopleColumns.includes(currentSortKey) ? currentSortKey : 'name';
  if (currentSortKey !== safeSortKey) {
    currentSortKey = safeSortKey;
    currentSortDir = 'asc';
  }

  const [peopleResult, companiesResult, opportunitiesResult] = await Promise.all([
    supabaseClient
      .from('people')
      .select('*')
      .order(safeSortKey, { ascending: currentSortDir === 'asc' }),
    supabaseClient
      .from('companies')
      .select('id, name')
      .order('name', { ascending: true }),
    supabaseClient
      .from('opportunities')
      .select('id, name')
      .order('name', { ascending: true })
  ]);

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
  let currentPage = 1;
  const recordsPerPage = 15; // Number of records per page
  let searchQuery = ''; // Separate search state

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
      { key: 'opportunity.name', label: 'Opportunity', width: '180px', icon: 'target', readOnly: true, sortable: false, render: (val, row) => row.opportunity ? row.opportunity.name : 'N/A' },
      {
        key: 'actions', label: 'Actions', width: '100px', readOnly: true, sortable: false, render: (val, row) => `
        <div class="table-actions">
          <button class="action-btn edit-person" data-id="${row.id}" title="Edit person"><i data-lucide="square-pen"></i></button>
          <button class="action-btn delete-person" data-id="${row.id}" title="Delete person"><i data-lucide="trash-2"></i></button>
        </div>
      `}
    ];

    let html = `
      <div class="view-header-minimal">
        <div class="view-breadcrumb">
          <span>People</span>
        </div>
        <div class="view-actions">
          <button class="toolbar-btn" onclick="showToast('Import/Export coming soon', 'info')">
            <i data-lucide="file-up"></i> Import / Export
          </button>
        </div>
      </div>

      <div class="view-toolbar">
        <div class="search-container" style="flex: 1; max-width: 320px;">
          <i data-lucide="search" style="width: 16px; height: 16px; margin-left: 12px; color: var(--text-muted);"></i>
          <input type="text" id="people-search" placeholder="Search people...">
          <div id="clear-people-search" class="search-clear-btn hidden" title="Clear search">
            <i data-lucide="x" style="width: 16px; height: 16px;"></i>
          </div>
        </div>
        
        <div style="flex: 1;"></div>
        <button class="toolbar-btn toolbar-btn-primary" id="add-person-btn">
          <i data-lucide="plus" style="width: 16px; height: 16px;"></i> New Person
        </button>
      </div>
      
      ${renderEditableDataTable(peopleToRender, columns, 'people-spreadsheet', 'people')}
      
      <div id="people-pagination" style="padding: 16px;"></div>
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
        const result = searchAndPaginate(
          window.allPeopleData,
          searchQuery,
          currentPage,
          recordsPerPage,
          (person, query) =>
            person.name.toLowerCase().includes(query) ||
            (person.email && person.email.toLowerCase().includes(query)) ||
            (person.company && person.company.name && person.company.name.toLowerCase().includes(query)) ||
            (person.job_title && person.job_title.toLowerCase().includes(query))
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
        searchInput.value = '';
        clearSearchBtn.classList.add('hidden');
        currentPage = 1;
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
        currentPage = 1;
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
        if (searchQuery) {
          clearSearchBtn?.classList.remove('hidden');
        } else {
          clearSearchBtn?.classList.add('hidden');
        }

        clearTimeout(searchInput.searchTimeout);
        searchInput.searchTimeout = setTimeout(() => {
          currentPage = 1;

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
          (person, query) =>
            person.name.toLowerCase().includes(query) ||
            (person.email && person.email.toLowerCase().includes(query)) ||
            (person.company && person.company.name && person.company.name.toLowerCase().includes(query)) ||
            (person.job_title && person.job_title.toLowerCase().includes(query))
        );

        // Adjust current page if necessary
        if (result.data.length === 0 && result.currentPage > 1) {
          currentPage--;
          const adjustedResult = searchAndPaginate(
            window.allPeopleData,
            searchQuery,
            currentPage,
            recordsPerPage,
            (person, query) =>
              person.name.toLowerCase().includes(query) ||
              (person.email && person.email.toLowerCase().includes(query)) ||
              (person.company && person.company.name && person.company.name.toLowerCase().includes(query)) ||
              (person.job_title && person.job_title.toLowerCase().includes(query))
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
    const q = query.toLowerCase();
    return person.name.toLowerCase().includes(q) ||
      (person.email && person.email.toLowerCase().includes(q)) ||
      (person.job_title && person.job_title.toLowerCase().includes(q)) ||
      (person.company && person.company.name && person.company.name.toLowerCase().includes(q));
  }

  // Initial data processing
  const initialPeopleData = searchAndPaginate(
    window.allPeopleData,
    searchQuery,
    1,
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
  }

  // Show modal
  modal.style.display = 'flex';

  // Initialize event listeners
  initPersonModalListeners(person);
}

function initPersonModalListeners(person) {
  // Company search functionality
  const companyInput = document.getElementById('person-company');
  const searchResults = document.getElementById('person-company-search-results');

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
        return;
      }

      // Filter companies
      const filteredCompanies = window.companiesData?.filter(company =>
        company.name.toLowerCase().includes(searchTerm)
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
    });
  }

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
        created_by: currentUser.id
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

      showToast(`Person ${person ? 'updated' : 'created'} successfully!`, 'success');
      closeModal('person-modal');
      renderPeopleView();
    } catch (error) {
      showToast(`Error ${person ? 'updating' : 'creating'} person: ${error.message}`, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = 'Save Person';
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
    <div class="page-header">
      <h1 class="page-title">Log Visit</h1>
      <p class="page-subtitle">Record your field visit details</p>
    </div>

    <div class="card">
      <div class="form-field">
        <label for="company-name">Company Name *</label>
        <div class="search-container">
          <i class="fas fa-search"></i>
          <input type="text" id="company-name" placeholder="Search for a company..." required />
          <div id="company-search-results" class="search-results" style="display: none;"></div>
        </div>
      </div>

      <div class="form-field" id="selected-company" style="display: none;">
        <div class="selected-location-info">
          <div id="selected-company-name"></div>
          <div id="selected-company-address" class="text-muted"></div>
        </div>
      </div>
      
      <br>

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

      <div class="form-field">
        <label for="notes">Visit Notes *</label>
        <div class="mention-container">
          <textarea id="notes" placeholder="What happened during the visit? Key takeaways, objections, next steps..." rows="5" required></textarea>
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

      <div class="form-field">
        <label>Visit Photo</label>
        <input type="file" id="visit-photo" accept="image/*" style="display: none;" />
        <div class="photo-upload-area" id="photo-upload-area">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-camera-icon lucide-camera"><path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"/><circle cx="12" cy="13" r="3"/></svg>
          <span>Tap to take photo</span>
        </div>
        <div id="photo-preview" class="photo-preview"></div>
      </div>

      <div class="form-field">
        <label>Location Verification *</label>
        <button type="button" id="verify-location" class="btn btn-secondary w-full" disabled>
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-pin-icon lucide-map-pin"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>
          Verify Location
        </button>
        <div id="location-status" class="location-status" style="display: none;"></div>
        <div id="location-map" class="location-map" style="display: none;"></div>
      </div>

      <div class="form-field">
        <label for="travel-time">Travel Time (minutes)</label>
        <input type="number" id="travel-time" placeholder="How long did it take to get here?" min="0" />
      </div>

      <button type="button" id="submit-visit" class="btn btn-primary btn-lg w-full mt-3" disabled>
        Save Visit
      </button>
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
  const photoUploadArea = document.getElementById('photo-upload-area');
  const photoInput = document.getElementById('visit-photo');
  const photoPreview = document.getElementById('photo-preview');
  const tagsInput = document.getElementById('tags-input');
  const mentionSuggestions = document.getElementById('mention-suggestions');

  let locationVerified = false;
  let map = null;
  let mentionStartIndex = -1;
  let currentMentionQuery = '';

  // Store for global access
  window.companiesData = companies;

  // Company search functionality
  companyNameInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();

    if (query.length === 0) {
      companySearchResults.style.display = 'none';
      return;
    }

    const filtered = companies.filter(company =>
      company.name.toLowerCase().includes(query)
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
  });

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
      person.name.toLowerCase().includes(query.toLowerCase())
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
        verifyLocationBtn.disabled = false;
        verifyLocationBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-pin-icon lucide-map-pin"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg> Verify Location';
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
        created_at: new Date().toISOString()
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

  let html = `
    <div class="page-header">
      <h1 class="page-title">My Activity</h1>
      <p class="page-subtitle">${visits.length} visits logged</p>
    </div>
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

  // Process mentioned people
  let processedNotes = visit.notes || '';
  if (visit.mentioned_people && visit.mentioned_people.length > 0) {
    visit.mentioned_people.forEach(person => {
      const mentionPattern = new RegExp(`@${person.name} \\(${person.id}\\)`, 'g');
      processedNotes = processedNotes.replace(mentionPattern, `<span class="mentioned-person">@${person.name}</span>`);
    });
  }

  return `
    <div class="visit-card">
      <div class="visit-header">
        <div>
          <div class="visit-company">${visit.company_name}</div>
          ${showRepName && visit.user ? `<div class="text-prim" style="font-size: 1rem;">by ${visit.user.first_name} ${visit.user.last_name}</div>` : ''}
        </div>
        <div class="visit-date">${date}</div>
      </div>
      
      <div class="visit-meta">
        ${visit.contact_name ? `<span class="visit-meta-item"><svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-user-icon lucide-user"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> ${visit.contact_name}</span>` : ''}
        ${visit.location_name ? `<span class="visit-meta-item"><svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-pin-icon lucide-map-pin"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>${visit.location_name}</span>` : ''}
        ${visit.visit_type ? `<span class="visit-meta-item"><svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-tag-icon lucide-tag"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/></svg> ${visit.visit_type.replace('_', ' ')}</span>` : ''}
        ${visit.travel_time ? `<span class="visit-meta-item"><i class="fas fa-clock"></i> ${visit.travel_time} min travel</span>` : ''}
      </div>

      ${leadScoreBadge ? `<div class="mb-2">${leadScoreBadge}</div>` : ''}

      ${visit.tags && visit.tags.length > 0 ? `
        <div class="visit-tags mb-2">
          ${visit.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
        </div>
      ` : ''}

      ${visit.photo_url ? `
        <div class="photo-preview mb-2">
          <img src="${visit.photo_url}" alt="Visit photo" onerror="handleImageError(this)">
        </div>
      ` : ''}

      <div class="visit-notes">${processedNotes}</div>

      ${visit.ai_summary ? `
        <div class="ai-insight">
          <div class="ai-insight-header">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-bot-icon lucide-bot"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>
            AI Summary
          </div>
          <div class="ai-insight-content">${parseMarkdown(visit.ai_summary)}</div>
        </div>
      ` : ''}
    </div>
  `;
}

// ======================
// SALES FUNNEL VIEW
// ======================

async function renderSalesFunnelView() {
  const { data: visits, error } = await supabaseClient
    .from('visits')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false });

  if (error) {
    viewContainer.innerHTML = renderError(error.message);
    return;
  }

  const funnelStages = {
    new_lead: { title: 'New Leads', visits: [], color: '#3b82f6' },
    follow_up: { title: 'Follow-ups', visits: [], color: '#8b5cf6' },
    demo: { title: 'Product Demos', visits: [], color: '#f59e0b' },
    closing: { title: 'Closing', visits: [], color: '#10b981' },
    support: { title: 'Customer Support', visits: [], color: '#6b7280' }
  };

  visits.forEach(visit => {
    const type = visit.visit_type || 'new_lead';
    if (funnelStages[type]) {
      funnelStages[type].visits.push(visit);
    }
  });

  const totalVisits = visits.length;

  let html = `
    <div class="page-header">
      <h1 class="page-title">Sales Funnel</h1>
      <p class="page-subtitle">Track your leads through the pipeline</p>
    </div>

    <div class="funnel-container">
  `;

  Object.entries(funnelStages).forEach(([key, stage]) => {
    const count = stage.visits.length;
    const percentage = totalVisits > 0 ? (count / totalVisits * 100) : 0;

    html += `
      <div class="funnel-stage">
        <div class="funnel-stage-header">
          <span class="funnel-stage-title" style="color: ${stage.color}">${stage.title}</span>
          <span class="funnel-stage-count">${count}</span>
        </div>
        <div class="funnel-stage-bar">
          <div class="funnel-stage-progress" style="width: ${percentage}%; background: ${stage.color}"></div>
        </div>
      </div>
    `;
  });

  html += `</div>`;

  // High priority leads
  const highPriorityLeads = visits.filter(v => v.lead_score && v.lead_score >= 70).slice(0, 5);

  html += `
    <div class="card mt-3">
      <div class="card-header">
        <h3 class="card-title"><i class="fas fa-star text-warning"></i> High-Priority Leads</h3>
      </div>
  `;

  if (highPriorityLeads.length > 0) {
    highPriorityLeads.forEach(visit => {
      html += `
        <div class="flex items-center justify-between" style="padding: 0.75rem 0; border-bottom: 1px solid var(--border-color);">
          <div>
            <strong>${visit.company_name}</strong>
            ${visit.contact_name ? `<br><span class="text-muted">${visit.contact_name}</span>` : ''}
          </div>
          ${getLeadScoreBadge(visit.lead_score)}
        </div>
      `;
    });
  } else {
    html += `<p class="text-muted">No high-priority leads yet</p>`;
  }

  html += `</div>`;

  viewContainer.innerHTML = html;
}

// ======================
// OPPORTUNITY PIPELINE VIEW
// ======================

// ======================
// OPPORTUNITY PIPELINE VIEW (Updated)
// ======================

async function renderOpportunityPipelineView() {
  let opportunities;
  let error;

  if (isManager) {
    // Managers can see all opportunities with user info
    const result = await supabaseClient
      .from('opportunities')
      .select(`
        *,
        profiles!inner(
          id,
          first_name,
          last_name,
          email,
          role
        )
      `)
      .order('created_at', { ascending: false });

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
    <div class="page-header deals-page-header">
      <h1 class="page-title">Deals</h1>
      <p class="page-subtitle">
        ${opportunities.length} ${isManager ? 'team' : 'your'} deals
        ${isManager ? '<span class="text-muted"> (Team View)</span>' : ''}
      </p>
    </div>

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
      <div class="pipeline-filters">
        <button class="pipeline-filter active" data-filter="all"><i data-lucide="arrow-down-up"></i> Sorted by Created at</button>
        <button class="pipeline-filter" data-filter="high-value"><i data-lucide="funnel"></i> High Value</button>
        <button class="pipeline-filter" data-filter="high-probability"><i data-lucide="sparkles"></i> High Probability</button>
        <button class="pipeline-filter" data-filter="next-step-due"><i data-lucide="clock-3"></i> Next Step Due</button>
        ${isManager ? `
          <button class="pipeline-filter" data-filter="my-reps"><i data-lucide="users"></i> Sales Reps</button>
        ` : ''}
      </div>

      <div class="pipeline-controls">
        <div class="pipeline-search">
          <i data-lucide="search"></i>
          <input type="text" id="pipeline-search" placeholder="Search company, deal, notes...">
        </div>

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

        <button class="btn btn-primary" id="add-opportunity-btn">
          <i class="fas fa-plus"></i> New Deal
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
        <button class="pipeline-inline-add" data-stage="${stage.id}">+ New Deal</button>
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
            data-user-id="${opp.user_id}"
            data-owner-id="${opp.user_id}"
            data-value="${parseFloat(opp.value || 0)}"
            data-probability="${parseInt(opp.probability || 0, 10)}"
            data-created-ts="${new Date(opp.created_at).getTime() || 0}"
            data-next-step-ts="${opp.next_step_date ? new Date(opp.next_step_date).getTime() : ''}"
            draggable="${isOwnOpportunity}">
          <div class="opportunity-company">${opp.company_name}</div>
          <div class="opportunity-name">${opp.name}</div>
          ${isManager && user ? `
            <div class="opportunity-owner">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-user-icon lucide-user"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> ${ownerName}
            </div>
          ` : ''}
          <div class="opportunity-value"><i data-lucide="circle-dollar-sign"></i> Ksh ${parseFloat(opp.value || 0).toLocaleString()}</div>
          
          <div class="opportunity-probability">
            <div class="probability-bar">
              <div class="probability-fill" style="width: ${opp.probability || 0}%; background-color: ${getProbabilityColor(opp.probability || 0)}"></div>
            </div>
            <div class="probability-text">${opp.probability || 0}%</div>
          </div>
          
          ${opp.next_step ? `
            <div class="opportunity-next-step ${isOverdue ? 'overdue' : ''}">
              <i data-lucide="check-square"></i>
              <span>${opp.next_step}</span>
              ${opp.next_step_date ? `<span> (${formatDate(opp.next_step_date)})</span>` : ''}
            </div>
          ` : ''}

          <div class="opportunity-stage-age"><i data-lucide="hourglass"></i><span>${stageDays}d in stage</span></div>
          
          ${competitors.length > 0 ? `
            <div class="opportunity-competitors">
              ${competitors.slice(0, 2).map(comp => `
                <span class="competitor-tag">${comp}</span>
              `).join('')}
              ${competitors.length > 2 ? `<span class="competitor-tag">+${competitors.length - 2} more</span>` : ''}
            </div>
          ` : ''}
          
          ${opp.notes ? `
            <div class="opportunity-notes" style="overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">
              ${processedNotes.substring(0, 150)}${processedNotes.length > 150 ? '...' : ''}
            </div>
          ` : ''}
          
          <div class="opportunity-actions">
            <div class="opportunity-date"><i data-lucide="clock-3"></i> ${formatDate(opp.created_at)}</div>
            <div class="opportunity-menu">
              ${isOwnOpportunity ? `
                <button class="opportunity-action-btn edit-opportunity" data-id="${opp.id}">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-square-pen-icon lucide-square-pen"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/></svg>
                </button>
                <button class="opportunity-action-btn delete-opportunity" data-id="${opp.id}">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-icon lucide-trash"><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
              ` : `
                <button class="opportunity-action-btn view-opportunity" data-id="${opp.id}">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-eye-icon lucide-eye"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>
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
      animation: 110,
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      swapThreshold: 0.2,
      invertSwap: false,
      emptyInsertThreshold: 6,
      delayOnTouchOnly: true,
      touchStartThreshold: 4,
      draggable: '.opportunity-card',
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      filter: '.readonly, .opportunity-actions', // Prevent dragging readonly cards or non-card controls
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

            const stageAgeEl = evt.item.querySelector('.opportunity-stage-age');
            if (stageAgeEl) {
              const stageAgeText = stageAgeEl.querySelector('span');
              if (stageAgeText) {
                stageAgeText.textContent = '0d in stage';
              }
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
      const valueText = card.querySelector('.opportunity-value')?.textContent;
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
    const valueText = card.querySelector('.opportunity-value')?.textContent;
    const value = parseCurrencyValue(valueText);
    totalValue += value;

    const probText = card.querySelector('.probability-text')?.textContent;
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
  const filterButtons = document.querySelectorAll('.pipeline-filter');
  const searchInput = document.getElementById('pipeline-search');
  const ownerSelect = document.getElementById('pipeline-owner-filter');
  const sortSelect = document.getElementById('pipeline-sort');

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
    const activeFilter = document.querySelector('.pipeline-filter.active')?.dataset.filter || 'all';
    const query = (searchInput?.value || '').trim().toLowerCase();
    const owner = ownerSelect?.value || 'all';
    const sort = sortSelect?.value || 'newest';

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
        show = !!card.querySelector('.opportunity-next-step');
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

  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      filterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyPipelineControls();
    });
  });

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
  document.getElementById('opportunity-notes').value = '';

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
      // Fetch companies for company search
      const { data: companies } = await supabaseClient
        .from('companies')
        .select('*')
        .ilike('name', `%${query}%`)
        .limit(5);

      let resultsHTML = '';

      if (companies.length > 0) {
        resultsHTML = companies.map(company => `
          <div class="search-result-item" onclick="selectOpportunityCompany('${company.name}')">
            <div class="search-result-icon"></div>
            <div>
              <div class="search-result-name">${company.name}</div>
              <div class="search-result-role">${company.description || 'No description'}</div>
            </div>
          </div>
        `).join('');
      }

      // Always show option to use custom name if it's different from found companies
      const customNameOption = `
        <div class="search-result-item" onclick="selectOpportunityCompany('${e.target.value.trim()}')">
          <div>
            <div class="search-result-name">Use "${e.target.value.trim()}"</div>
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
  const notesEl = document.getElementById('opportunity-notes');
  const mentionSuggestionsContainer = document.getElementById('opportunity-mention-suggestions');



  let mentionStartIndex = -1;
  let currentMentionQuery = '';
  let lastMentionStartIndex = -1;

  // Input event - detect @ and show suggestions
  const newNotesEl = notesEl.cloneNode(true);
  notesEl.parentNode.replaceChild(newNotesEl, notesEl);

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
        mentioned_people: mentionedPeople
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
  // In a real implementation, this would set up a notification system
  // For now, we'll just store reminder in localStorage
  const reminders = JSON.parse(localStorage.getItem('opportunityReminders') || '[]');

  reminders.push({
    opportunityName,
    nextStep,
    dueDate,
    acknowledged: false
  });

  localStorage.setItem('opportunityReminders', JSON.stringify(reminders));

  // Check if reminder is due today
  const today = new Date().toISOString().split('T')[0];
  if (dueDate === today) {
    showToast(`Reminder: ${nextStep} for ${opportunityName} is due today!`, 'info');
  }
}

function checkDueReminders() {
  // Check for due reminders on app load
  const reminders = JSON.parse(localStorage.getItem('opportunityReminders') || '[]');
  const today = new Date().toISOString().split('T')[0];

  reminders.forEach(reminder => {
    if (!reminder.acknowledged && reminder.dueDate === today) {
      showToast(`Reminder: ${reminder.nextStep} for ${reminder.opportunityName} is due today!`, 'info');
      reminder.acknowledged = true;
    }
  });

  localStorage.setItem('opportunityReminders', JSON.stringify(reminders));
}

// ======================
// TEAM DASHBOARD VIEW
// ======================

async function renderTeamDashboardView() {


  // First, try to get all profiles separately to ensure we have access
  const { data: allProfiles, error: profilesError } = await supabaseClient
    .from('profiles')
    .select('*')
    .order('first_name', { ascending: true });

  if (profilesError) {
    viewContainer.innerHTML = renderError('Unable to load team data. Please check your permissions: ' + profilesError.message);
    return;
  }

  // Then get visits
  const [visitsResult] = await Promise.all([
    supabaseClient
      .from('visits')
      .select('*')
      .order('created_at', { ascending: false })
  ]);

  const { data: visits, error: visitsError } = visitsResult;

  if (visitsError) {
    viewContainer.innerHTML = renderError(visitsError.message);
    return;
  }

  // Manually join visits with profiles
  const visitsWithProfiles = visits.map(visit => {
    const userProfile = allProfiles.find(p => p.id === visit.user_id);
    return {
      ...visit,
      user: userProfile || { id: visit.user_id, first_name: 'Unknown', last_name: 'User', email: '', role: 'sales_rep' }
    };
  });

  // Group visits by user - include all profiles even if they have no visits
  const users = {};

  // First, initialize all profiles
  allProfiles.forEach(profile => {
    if (profile.role === 'sales_rep') {
      users[profile.id] = {
        ...profile,
        visits: []
      };
    }
  });

  // Then add visits to each user
  visitsWithProfiles.forEach(visit => {
    const userId = visit.user_id;
    if (users[userId]) {
      users[userId].visits.push(visit);
    }
  });

  const salesReps = Object.values(users);
  const totalVisits = visitsWithProfiles.length;
  const totalReps = salesReps.length;
  const avgVisitsPerRep = totalReps > 0 ? (totalVisits / totalReps).toFixed(1) : 0;

  const todayVisits = visitsWithProfiles.filter(v => {
    const visitDate = new Date(v.created_at).toDateString();
    return visitDate === new Date().toDateString();
  }).length;

  const avgLeadScore = visitsWithProfiles.filter(v => v.lead_score).length > 0
    ? (visitsWithProfiles.reduce((sum, v) => sum + (v.lead_score || 0), 0) / visitsWithProfiles.filter(v => v.lead_score).length).toFixed(0)
    : 0;

  let html = `
    <div class="page-header flex justify-between items-center">
      <div>
        <h1 class="page-title">Team Visits</h1>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${totalVisits}</div>
        <div class="stat-label">Total Visits</div>
      </div>
      <div class="stat-card success">
        <div class="stat-value">${totalReps}</div>
        <div class="stat-label">Sales Reps</div>
      </div>
      <div class="stat-card warning">
        <div class="stat-value">${todayVisits}</div>
        <div class="stat-label">Today</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${avgLeadScore}%</div>
        <div class="stat-label">Avg Lead Score</div>
      </div>
    </div>

    <!-- Selected Rep's Visits -->
    <div id="selected-rep-visits" style="display: none;">
      <div class="card">
        <div class="card-header">
          <h3 class="card-title" id="rep-visits-title">Rep Visits</h3>
          <button class="btn btn-ghost btn-sm" id="clear-rep-filter">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x-icon lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg> Clear
          </button>
        </div>
        <div id="rep-visits-container"></div>
      </div>
    </div>

    <!-- Performance Chart -->
    <div class="chart-container">
      <canvas id="performanceChart"></canvas>
    </div>

    <!-- Search for Sales Rep -->
    <div class="card">
      <div class="search-container">
        <i class="fas fa-search"></i>
        <input type="text" id="rep-search-input" placeholder="Search for a sales rep...">
        <div id="rep-search-results" class="search-results" style="display: none;"></div>
      </div>
    </div>

    <!-- Recent Team Visits -->
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Recent Team Activity</h3>
      </div>
      <div id="team-visits-container"></div>
    </div>
  `;

  viewContainer.innerHTML = html;

  // Initialize search
  initRepSearch(salesReps, users);

  // Render recent visits
  renderTeamVisits(visitsWithProfiles.slice(0, 10));

  // Initialize chart
  setTimeout(() => initPerformanceChart(salesReps), 100);
}

function initRepSearch(salesReps, users) {
  const searchInput = document.getElementById('rep-search-input');
  const searchResults = document.getElementById('rep-search-results');
  const selectedRepVisits = document.getElementById('selected-rep-visits');
  const clearBtn = document.getElementById('clear-rep-filter');

  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();

    if (query.length === 0) {
      searchResults.style.display = 'none';
      return;
    }

    const filtered = salesReps.filter(rep =>
      rep.first_name?.toLowerCase().includes(query) ||
      rep.last_name?.toLowerCase().includes(query) ||
      rep.email?.toLowerCase().includes(query)
    );

    if (filtered.length === 0) {
      searchResults.innerHTML = '<div class="search-result-item">No results found</div>';
    } else {
      searchResults.innerHTML = filtered.map(rep => `
        <div class="search-result-item" onclick="selectRep('${rep.id}')">
          <div class="search-result-avatar">${getInitials(rep.first_name + ' ' + rep.last_name)}</div>
          <div>
            <div class="search-result-name">${rep.first_name} ${rep.last_name}</div>
            <div class="search-result-role">${rep.email}</div>
          </div>
        </div>
      `).join('');
    }

    searchResults.style.display = 'block';
  });

  // Store for global access
  window.salesRepsData = { salesReps, users };

  clearBtn.addEventListener('click', () => {
    selectedRepVisits.style.display = 'none';
    selectedRepId = null;
  });
}

window.selectRep = function (repId) {
  const { salesReps, users } = window.salesRepsData;
  const rep = salesReps.find(r => r.id === repId);
  if (!rep) return;

  const repVisits = users[repId]?.visits || [];

  document.getElementById('rep-visits-title').textContent =
    `${rep.first_name} ${rep.last_name}'s Visits (${repVisits.length})`;

  const container = document.getElementById('rep-visits-container');
  if (repVisits.length === 0) {
    container.innerHTML = '<p class="text-muted text-center" style="padding: 2rem;">No visits logged yet</p>';
  } else {
    container.innerHTML = repVisits.map(visit => renderVisitCard(visit)).join('');
  }

  document.getElementById('selected-rep-visits').style.display = 'block';
  document.getElementById('rep-search-results').style.display = 'none';
  document.getElementById('rep-search-input').value = '';
  selectedRepId = repId;
};

function renderTeamVisits(visits) {
  const container = document.getElementById('team-visits-container');
  if (visits.length === 0) {
    container.innerHTML = '<p class="text-muted text-center" style="padding: 2rem;">No visits yet</p>';
  } else {
    container.innerHTML = visits.map(visit => renderVisitCard(visit, true)).join('');
  }
}

function initPerformanceChart(users) {
  const canvas = document.getElementById('performanceChart');
  if (!canvas) return;

  if (chartInstances['performanceChart']) {
    chartInstances['performanceChart'].destroy();
  }

  const ctx = canvas.getContext('2d');
  const labels = users.map(u => `${u.first_name} ${u.last_name?.charAt(0) || ''}.`);
  const data = users.map(u => u.visits.length);

  chartInstances['performanceChart'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Total Visits',
        data: data,
        backgroundColor: '#4f46e5',
        borderRadius: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { precision: 0 }
        }
      }
    }
  });
}

// ======================
// USER MANAGEMENT VIEW
// ======================

async function renderUserManagementView() {
  const { data: users, error } = await supabaseClient
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    viewContainer.innerHTML = renderError(error.message);
    return;
  }

  let html = `
    <div class="page-header">
      <h1 class="page-title">User Management</h1>
      <p class="page-subtitle">${users.length} team members</p>
    </div>
  `;

  users.forEach(user => {
    const initials = getInitials(`${user.first_name} ${user.last_name}`);
    const isCurrentUser = user.id === currentUser.id;

    html += `
      <div class="card" style="display: flex; align-items: center; gap: 1rem; padding: 1rem;">
        <div class="user-avatar" style="width: 48px; height: 48px; font-size: 1rem;">${initials}</div>
        <div style="flex: 1;">
          <div style="font-weight: 600;">${user.first_name} ${user.last_name}</div>
          <div class="text-muted" style="font-size: 0.875rem;">${user.email}</div>
        </div>
        <span class="tag ${user.role === 'manager' ? '' : 'text-muted'}" style="background: ${user.role === 'manager' ? 'var(--color-primary-bg)' : 'var(--bg-tertiary)'};">
          ${user.role === 'manager' ? 'Manager' : user.role === 'technician' ? 'Technician' : user.role === 'sales_rep' ? 'Sales Rep' : (user.role || '')}
        </span>
        ${isCurrentUser ? `
        <button class="btn btn-secondary btn-sm" onclick="openChangePasswordModal()" style="margin-left: 1rem; margin-right: 0.5rem;" title="Change your password">
           Change Password
        </button>
        ` : ''}
        ${!isCurrentUser ? `
          <button class="btn btn-ghost btn-sm" onclick="deleteUser('${user.id}', '${user.first_name} ${user.last_name}')">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-icon lucide-trash"><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        ` : ''}
      </div>
    `;
  });

  viewContainer.innerHTML = html;
}

window.deleteUser = async function (userId, userName) {
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

async function renderRoutePlanningView() {
  // Fetch companies, sales reps, and existing routes
  const [companiesResult, profilesResult, routesResult] = await Promise.all([
    supabaseClient
      .from('companies')
      .select('*')
      .order('name', { ascending: true }),
    supabaseClient
      .from('profiles')
      .select('*')
      .eq('role', 'sales_rep')
      .order('first_name', { ascending: true }),
    supabaseClient
      .from('routes')
      .select(`*, assigned_to:profiles!routes_assigned_to_fkey(first_name, last_name)`)
      .eq('created_by', currentUser.id)
      .order('created_at', { ascending: false })
  ]);

  const { data: companies, error: companiesError } = companiesResult;
  const { data: salesReps, error: profilesError } = profilesResult;
  const { data: routes, error: routesError } = routesResult;

  if (companiesError || profilesError || routesError) {
    viewContainer.innerHTML = renderError('Error loading data');
    return;
  }

  // Filter companies with valid coordinates
  const validCompanies = companies.filter(c => c.latitude && c.longitude);

  let html = `
    <div class="page-header">
      <h1 class="page-title">Route Planning</h1>
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
        ${routes.length === 0 ?
      '<p class="text-muted text-center" style="padding: 2rem;">No routes created yet</p>' :
      routes.map(route => `
            <div class="route-item" data-id="${route.id}">
              <div class="route-info">
                <h4>${route.name}</h4>
                <p>Assigned to: ${route.assigned_to ? `${route.assigned_to.first_name} ${route.assigned_to.last_name}` : 'Unassigned'}</p>
                <p>Created: ${formatDate(route.created_at)}</p>
                ${route.estimated_duration ? `<p>Est. duration: ${route.estimated_duration} min</p>` : ''}
              </div>
              <div class="route-actions">
                <button class="btn btn-sm btn-ghost view-route-btn" data-id="${route.id}">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-eye-icon lucide-eye"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>
                </button>
                <button class="btn btn-sm btn-ghost edit-route-btn" data-id="${route.id}">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-square-pen-icon lucide-square-pen"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/></svg>
                </button>
                <button class="btn btn-sm btn-ghost delete-route-btn" data-id="${route.id}">
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

  // Search functionality
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const searchTerm = e.target.value.toLowerCase();
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
        created_by: currentUser.id
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
      const routeId = btn.dataset.id;
      const routeItem = btn.closest('.route-item');
      const routeName = routeItem.querySelector('h4').textContent;

      const confirmed = await showConfirmDialog(
        'Delete Route',
        `Are you sure you want to delete route "${routeName}"?`
      );

      if (!confirmed) return;

      try {
        const { error } = await supabaseClient
          .from('routes')
          .delete()
          .eq('id', routeId);

        if (error) throw error;

        showToast('Route deleted successfully', 'success');
        routeItem.remove();
      } catch (error) {
        showToast('Error deleting route: ' + error.message, 'error');
      }
    });
  });
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
      <div class="modal-container" style="max-width: 800px;">
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
            
            <div class="route-map" id="route-details-map" style="height: 300px; margin: 1rem 0;"></div>
            
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
          mapElement.innerHTML = '<div class="text-center" style="padding: 2rem;">No valid location data available for this route</div>';
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
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (routesError) throw routesError;

    let html = `
      <div class="page-header">
        <h1 class="page-title">My Routes</h1>
        <p class="page-subtitle">${routes.length} assigned routes</p>
      </div>
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

        html += `
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">${route.name}</h3>
              <button class="btn btn-primary start-route-btn"
                      data-id="${route.id}">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-navigation2-icon lucide-navigation-2"><polygon points="12 2 19 21 12 17 5 21 12 2"/></svg>
                Start Route
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
              mapElement.innerHTML = '<div class="text-center" style="padding: 2rem;">Map unavailable</div>';
            }
          }
        }, 100);
      } else {
        const mapElement = document.getElementById(`route-preview-${route.id}`);
        if (mapElement) {
          mapElement.innerHTML = '<div class="text-center" style="padding: 2rem;">No valid location data</div>';
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
          mapElement.innerHTML = '<div class="text-center" style="padding: 2rem;">Map unavailable</div>';
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
    // Mark route as completed
    const { error } = await supabaseClient
      .from('routes')
      .update({ is_active: false })
      .eq('id', routeId);

    if (error) throw error;

    showToast('Route completed successfully', 'success');
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
    const { data: reps } = await supabaseClient
      .from('profiles')
      .select('id, first_name, last_name, email')
      .eq('role', 'sales_rep')
      .order('first_name', { ascending: true });

    salesReps = reps || [];
  }
  // Store globally for editTask access
  window.salesRepsData = salesReps;

  let html = `
    <div class="page-header">
      <div class="header-left">
          <h1 class="page-title">Tasks</h1>
      </div>
    </div>

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
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();
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
        status
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
    const { data: reps } = await supabaseClient
      .from('profiles')
      .select('id, first_name, last_name, email')
      .eq('role', 'sales_rep')
      .order('first_name', { ascending: true });

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
          <h1 class="page-title">Reminders</h1>
          <p class="page-subtitle">Prioritize follow-ups, track deadlines, and keep ownership clear.</p>
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
            <div class="remx-search">
              <i data-lucide="search"></i>
              <input type="text" id="reminder-search" placeholder="Search reminders...">
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
        is_completed: false
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

function openExportModal() {
  document.getElementById('export-modal').style.display = 'flex';
}

const COMPANY_IMPORT_TYPES = ['Competitor', 'Customer', 'Distributor', 'Investor', 'Partner', 'Reseller', 'Supplier', 'Vendor', 'Other'];

window.openCompaniesImportExportModal = function () {
  let modal = document.getElementById('companies-transfer-modal');

  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'companies-transfer-modal';
    modal.className = 'modal';
    modal.style.display = 'none';
    modal.innerHTML = `
      <div class="modal-backdrop" onclick="closeModal('companies-transfer-modal')"></div>
      <div class="modal-container companies-transfer-modal-container" style="max-width: 760px;">
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
            <div class="field-helper" style="margin-top: 0.5rem;">
              <span><strong>Supported company types:</strong> ${COMPANY_IMPORT_TYPES.join(', ')}</span>
            </div>

            <div style="display:flex; gap:0.75rem; margin-top:1rem; flex-wrap: wrap;">
              <button type="button" class="btn btn-secondary" id="download-companies-sample-btn">
                <i data-lucide="download"></i> Download Sample CSV
              </button>
            </div>

            <div class="form-field" style="margin-top:1rem;">
              <label for="companies-import-file">Upload CSV File</label>
              <input type="file" id="companies-import-file" accept=".csv,text/csv">
              <div class="field-helper">
                <span>Maximum recommended size: 5MB. Larger files may take longer to process.</span>
              </div>
            </div>

            <div id="companies-import-feedback" class="field-helper" style="display:none;"></div>
            <div id="companies-import-errors" style="display:none;"></div>

            <div style="display:flex; justify-content:flex-end; margin-top:1rem;">
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
            <div class="field-helper" style="margin-top: 0;">
              <span>This export includes: name, type, description, address, latitude, longitude, radius, categories.</span>
            </div>

            <div style="display:flex; justify-content:flex-end; margin-top:1rem;">
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
            .insert([{ ...companyPayload, created_by: currentUser.id }])
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
  if (modal) modal.style.display = 'none';
  // For dynamically created modals
  if (!modal) {
    document.querySelectorAll('.modal').forEach(m => {
      if (m.id === modalId) m.remove();
    });
  }
};

window.setDateRange = function (range, btn) {
  document.querySelectorAll('.date-range-btn').forEach(b => b.classList.remove('active'));
  btn?.classList.add('active');

  const customRange = document.getElementById('custom-date-range');
  const fromInput = document.getElementById('export-date-from');
  const toInput = document.getElementById('export-date-to');

  const today = new Date();
  let fromDate = new Date();

  switch (range) {
    case 'today':
      fromDate = today;
      break;
    case 'week':
      fromDate.setDate(today.getDate() - 7);
      break;
    case 'month':
      fromDate.setMonth(today.getMonth() - 1);
      break;
    case 'quarter':
      fromDate.setMonth(today.getMonth() - 3);
      break;
    case 'custom':
      customRange.style.display = 'block';
      return;
  }

  customRange.style.display = 'none';
  fromInput.value = fromDate.toISOString().split('T')[0];
  toInput.value = today.toISOString().split('T')[0];
};

window.executeExport = async function () {
  const format = document.querySelector('input[name="export-format"]:checked')?.value || 'pdf';
  const fromDate = document.getElementById('export-date-from').value;
  const toDate = document.getElementById('export-date-to').value;

  if (!fromDate || !toDate) {
    showToast('Please select a date range', 'error');
    return;
  }

  showToast('Preparing export...', 'info');

  try {
    // FIX: Specify relationship to avoid ambiguity
    const { data: visits, error } = await supabaseClient
      .from('visits')
      .select(`*, user:profiles!inner(first_name, last_name, email)`)
      .gte('created_at', fromDate)
      .lte('created_at', toDate)
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (format === 'pdf') {
      await exportToPDF(visits, fromDate, toDate);
    } else if (format === 'excel') {
      await exportToExcel(visits, fromDate, toDate);
    } else if (format === 'csv') {
      await exportToCSV(visits, fromDate, toDate);
    }

    showToast('Export completed!', 'success');
    closeModal('export-modal');
  } catch (err) {
    showToast('Export failed: ' + err.message, 'error');
  }
};

async function exportToPDF(visits, fromDate, toDate) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(20);
  doc.text('SafiTrack Visit Report', 20, 20);
  doc.setFontSize(12);
  doc.text(`Period: ${fromDate} to ${toDate}`, 20, 30);
  doc.text(`Total Visits: ${visits.length}`, 20, 37);

  let yPos = 50;
  doc.setFontSize(10);

  visits.forEach((visit, index) => {
    if (yPos > 270) {
      doc.addPage();
      yPos = 20;
    }

    const userName = visit.user ? `${visit.user.first_name} ${visit.user.last_name}` : 'Unknown';
    const date = new Date(visit.created_at).toLocaleDateString();

    doc.setFont(undefined, 'bold');
    doc.text(`${index + 1}. ${visit.company_name}`, 20, yPos);
    doc.setFont(undefined, 'normal');
    yPos += 6;
    doc.text(`Rep: ${userName} | Date: ${date}`, 20, yPos);
    yPos += 10;

    if (visit.contact_name) {
      doc.text(`Contact: ${visit.contact_name}`, 20, yPos);
      yPos += 6;
    }

    if (visit.location_name) {
      doc.text(`Location: ${visit.location_name}`, 20, yPos);
      yPos += 6;
    }

    if (visit.visit_type) {
      doc.text(`Type: ${visit.visit_type.replace('_', ' ')}`, 20, yPos);
      yPos += 6;
    }

    if (visit.travel_time) {
      doc.text(`Travel Time: ${visit.travel_time} min`, 20, yPos);
      yPos += 6;
    }

    if (visit.notes) {
      doc.text('Notes:', 20, yPos);
      yPos += 6;

      // Split notes into lines to fit in page
      const lines = doc.splitTextToSize(visit.notes, 170);
      lines.forEach(line => {
        doc.text(line, 20, yPos);
        yPos += 5;
      });
    }

    yPos += 10;
  });

  doc.save(`SafiTrack_Report_${fromDate}_to_${toDate}.pdf`);
}

async function exportToExcel(visits, fromDate, toDate) {
  const XLSX = window.XLSX;

  const data = visits.map(visit => ({
    'Date': new Date(visit.created_at).toLocaleDateString(),
    'Company': visit.company_name,
    'Contact': visit.contact_name || '',
    'Sales Rep': visit.user ? `${visit.user.first_name} ${visit.user.last_name}` : '',
    'Location': visit.location_name || '',
    'Type': visit.visit_type || '',
    'Travel Time': visit.travel_time || '',
    'Notes': visit.notes || '',
    'AI Summary': visit.ai_summary || ''
  }));

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, 'Visits');
  XLSX.writeFile(workbook, `SafiTrack_Report_${fromDate}_to_${toDate}.xlsx`);
}

async function exportToCSV(visits, fromDate, toDate) {
  const headers = ['Date', 'Company', 'Contact', 'Sales Rep', 'Location', 'Type', 'Travel Time', 'Notes', 'AI Summary'];
  const rows = visits.map(visit => [
    new Date(visit.created_at).toLocaleDateString(),
    visit.company_name,
    visit.contact_name || '',
    visit.user ? `${visit.user.first_name} ${visit.user.last_name}` : '',
    visit.location_name || '',
    visit.visit_type || '',
    visit.travel_time || '',
    visit.notes || '',
    visit.ai_summary || ''
  ]);

  let csv = headers.join(',') + '\n';
  rows.forEach(row => {
    csv += row.map(cell => `"${cell}"`).join(',') + '\n';
  });

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `SafiTrack_Report_${fromDate}_to_${toDate}.csv`;
  a.click();
  window.URL.revokeObjectURL(url);
}

// ======================
// UTILITY FUNCTIONS
// ======================

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  updateThemeIcon(next);
  showToast(`Switched to ${next} mode`, 'success');
}


function updateThemeIcon(theme) {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;

  // Define the SVG icons
  const darkModeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-moon-icon lucide-moon"><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/></svg>`;

  const lightModeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-sun-icon lucide-sun"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`;

  // Inject the correct SVG based on the theme
  btn.innerHTML = (theme === 'dark') ? darkModeIcon : lightModeIcon;
}

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

  if (shortFormat) {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    });
  }

  return date.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
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
    <p class="page-subtitle">Please wait</p>
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
      <div class="empty-state">
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
      <div class="empty-state">
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
      <div class="empty-state">
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
    const titleEl = document.getElementById('confirm-title');
    const messageEl = document.getElementById('confirm-message');
    const cancelBtn = document.getElementById('confirm-cancel');
    const okBtn = document.getElementById('confirm-ok');

    // Set content
    titleEl.textContent = title;
    messageEl.textContent = message;

    // Show dialog
    dialog.style.display = 'flex';

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

    const cleanup = () => {
      cancelBtn.removeEventListener('click', handleCancel);
      okBtn.removeEventListener('click', handleOk);
    };

    cancelBtn.addEventListener('click', handleCancel);
    okBtn.addEventListener('click', handleOk);
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
  { id: 'export', title: 'Export Reports', description: 'Download data', icon: 'fa-download', action: () => openExportModal() },
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

async function renderTechnicianLogVisitView() {
  const { data: companies } = await supabaseClient
    .from('companies')
    .select('*')
    .order('name', { ascending: true });

  viewContainer.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Log Service Visit</h1>
      <p class="page-subtitle">Record your technical service details</p>
    </div>

    <!-- Step Progress -->
    <div class="form-steps">
      <div class="step active" data-step="1">
        <div class="step-number">1</div>
        <div class="step-title">Location & Company</div>
      </div>
      <div class="step" data-step="2">
        <div class="step-number">2</div>
        <div class="step-title">Visit Details</div>
      </div>
      <div class="step" data-step="3">
        <div class="step-number">3</div>
        <div class="step-title">Photos</div>
      </div>
      <div class="step" data-step="4">
        <div class="step-number">4</div>
        <div class="step-title">Signatures</div>
      </div>
      <div class="step" data-step="5">
        <div class="step-number">5</div>
        <div class="step-title">Review</div>
      </div>
    </div>

    <!-- Step 1: Location & Company -->
    <div class="step-container active" id="step-1">
      <div class="card">
        <h3 class="card-title">Location & Company</h3>
        
        <div class="form-field">
          <label for="technician-company-name">Company Name *</label>
          <div class="search-container">
            <i data-lucide="search"></i>
            <input type="text" id="technician-company-name" placeholder="Search for a company..." required />
            <div id="technician-company-search-results" class="search-results" style="display: none;"></div>
          </div>
        </div>

        <div class="form-field" id="selected-technician-company" style="display: none;">
          <div class="selected-location-info">
            <div id="selected-technician-company-name"></div>
            <div id="selected-technician-company-address" class="text-muted"></div>
          </div>
        </div>

        <div class="form-field">
          <label for="technician-custom-location">Custom Location (optional)</label>
          <input type="text" id="technician-custom-location" placeholder="Enter custom company or location name" />
          <div class="text-muted mt-1">Technicians may enter a custom location if the company isn't listed.</div>
        </div>

        <div class="form-field">
          <label>Location Verification</label>
          <div class="location-verification">
            <button type="button" id="verify-technician-location" class="btn btn-secondary w-full">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-pin-icon lucide-map-pin"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>
              Capture Current Location
            </button>
            <div id="technician-location-status" class="location-status" style="display: none;"></div>
            <div id="technician-location-map" class="location-map" style="display: none; height: 200px;"></div>
          </div>
          <small class="text-muted">Your location will be captured and displayed on the map for the manager</small>
        </div>

        <div class="form-field">
          <button class="btn btn-primary w-full next-step" data-next="2">
            Next: Visit Details
          </button>
        </div>
      </div>
    </div>

    <!-- Step 2: Visit Details -->
    <div class="step-container" id="step-2">
      <div class="card">
        <h3 class="card-title">Visit Details</h3>
        
        <div class="form-field">
          <label for="visit-type">Visit Type *</label>
          <select id="visit-type" required>
            <option value="">Select visit type</option>
            <option value="installation">Installation</option>
            <option value="maintenance">Maintenance</option>
            <option value="repair">Repair</option>
            <option value="inspection">Inspection</option>
            <option value="emergency">Emergency / Call-out</option>
          </select>
        </div>

        <div class="form-field">
          <label for="work-category">Work Category *</label>
          <select id="work-category" required>
            <option value="">Select category</option>
            <option value="electrical">Electrical</option>
            <option value="solar">Solar</option>
            <option value="networking">Networking</option>
            <option value="mechanical">Mechanical</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div class="form-field" id="other-category-field" style="display: none;">
          <label for="other-category">Specify Other Category</label>
          <input type="text" id="other-category" placeholder="Enter category">
        </div>

        <div class="form-field">
          <label for="work-status">Work Status *</label>
          <select id="work-status" required>
            <option value="">Select status</option>
            <option value="completed">Completed</option>
            <option value="partially_completed">Partially Completed</option>
            <option value="pending">Pending</option>
            <option value="follow_up">Follow-up Required</option>
          </select>
        </div>

        <div class="form-field" id="follow-up-field" style="display: none;">
          <label for="follow-up-notes">Follow-up & Next Actions *</label>
          <textarea id="follow-up-notes" placeholder="Describe required follow-up actions..." rows="3"></textarea>
        </div>

        <div class="form-field">
          <label for="visit-notes">Visit Notes *</label>
          <textarea id="visit-notes" placeholder="Describe the work performed, findings, recommendations..." rows="5" required></textarea>
        </div>

        <div class="form-field flex gap-2">
          <button class="btn btn-secondary flex-1 prev-step" data-prev="1">
            <i data-lucide="arrow-left"></i> Back
          </button>
          <button class="btn btn-primary flex-1 next-step" data-next="3">
            Next: Photos
          </button>
        </div>
      </div>
    </div>

    <!-- Step 3: Photos -->
    <div class="step-container" id="step-3">
      <div class="card">
        <h3 class="card-title">Photos</h3>
        <p class="text-muted mb-3">Photos will be automatically deleted after 30 days</p>
        
        <input type="file" id="technician-photos" accept="image/*" multiple style="display: none;" />
        
        <div class="photo-upload-multiple" id="photo-upload-multiple">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-camera-icon lucide-camera"><path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"/><circle cx="12" cy="13" r="3"/></svg>
          <p>Tap to add photos (multiple selection supported)</p>
          <small class="text-muted">Maximum 10 photos, 5MB each</small>
        </div>

        <div class="photo-grid" id="photo-preview-grid"></div>

        <div class="form-field flex gap-2">
          <button class="btn btn-secondary flex-1 prev-step" data-prev="2">
            <i data-lucide="arrow-left"></i> Back
          </button>
          <button class="btn btn-primary flex-1 next-step" data-next="4">
            Next: Signatures
          </button>
        </div>
      </div>
    </div>

    <!-- Step 4: Signatures -->
    <div class="step-container" id="step-4">
      <div class="card">
        <h3 class="card-title">Signatures</h3>
        <p class="text-muted mb-3">Both signatures are required to submit the visit</p>
        
        <div class="form-field">
          <label>Client Signature *</label>
          <div class="signature-container">
            <canvas id="client-signature-canvas" class="signature-canvas"></canvas>
            <div class="signature-placeholder" id="client-signature-placeholder">
              Click and drag to sign
            </div>
          </div>
          <div class="signature-actions">
            <button type="button" class="btn btn-sm btn-secondary" id="clear-client-signature">
              Clear
            </button>
            <button type="button" class="btn btn-sm btn-secondary" id="save-client-signature">
              Save
            </button>
          </div>
          
        </div>

        <div class="form-field">
          <label>Technician Signature *</label>
          <div class="signature-container">
            <canvas id="technician-signature-canvas" class="signature-canvas"></canvas>
            <div class="signature-placeholder" id="technician-signature-placeholder">
              Click and drag to sign
            </div>
          </div>
          <div class="signature-actions">
            <button type="button" class="btn btn-sm btn-secondary" id="clear-technician-signature">
              Clear
            </button>
            <button type="button" class="btn btn-sm btn-secondary" id="save-technician-signature">
              Save
            </button>
          </div>
          
        </div>

        <div class="form-field flex gap-2">
          <button class="btn btn-secondary flex-1 prev-step" data-prev="3">
            <i data-lucide="arrow-left"></i> Back
          </button>
          <button class="btn btn-primary flex-1 next-step" data-next="5" id="next-to-review" disabled>
            Next: Review
          </button>
        </div>
      </div>
    </div>

    <!-- Step 5: Review & Submit -->
    <div class="step-container" id="step-5">
      <div class="card">
        <h3 class="card-title">Review & Submit</h3>
        
        <div class="review-section">
          <h4>Visit Summary</h4>
          <div id="review-summary"></div>
        </div>

        <div class="review-section">
          <h4>Photos</h4>
          <div class="photo-grid" id="review-photos"></div>
        </div>

        <div class="review-section">
          <h4>Signatures</h4>
          <div class="flex gap-4">
            <div>
              <p class="text-sm text-muted">Client Signature</p>
              <div id="review-client-signature"></div>
            </div>
            <div>
              <p class="text-sm text-muted">Technician Signature</p>
              <div id="review-technician-signature"></div>
            </div>
          </div>
        </div>

        <!-- Confirm signatures checkbox removed - not required -->

        <div class="form-field flex gap-2">
          <button class="btn btn-secondary flex-1 prev-step" data-prev="4">
            <i data-lucide="arrow-left"></i> Back
          </button>
          <button class="btn btn-primary flex-1" id="submit-technician-visit" disabled>
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-icon lucide-check"><path d="M20 6 9 17l-5-5"/></svg> Submit Visit
          </button>
        </div>
      </div>
    </div>
  `;

  initTechnicianLogVisitForm(companies);
}

function initTechnicianLogVisitForm(companies) {
  // Create a global state object for the form
  window.technicianVisitForm = {
    currentStep: 1,
    selectedCompany: null,
    capturedLocation: null,
    clientSignature: null,
    technicianSignature: null,
    photos: [],
    clientSignatureCanvas: null,
    technicianSignatureCanvas: null,
    clientSignatureCtx: null,
    technicianSignatureCtx: null,
    isClientDrawing: false,
    isTechnicianDrawing: false,
    map: null
  };

  // Store for global access
  window.companiesData = companies;

  // Company search functionality
  const companyNameInput = document.getElementById('technician-company-name');
  const companySearchResults = document.getElementById('technician-company-search-results');
  const selectedCompanyDiv = document.getElementById('selected-technician-company');
  const selectedCompanyName = document.getElementById('selected-technician-company-name');
  const selectedCompanyAddress = document.getElementById('selected-technician-company-address');
  const customLocationInput = document.getElementById('technician-custom-location');

  companyNameInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();

    if (query.length === 0) {
      companySearchResults.style.display = 'none';
      return;
    }

    const filtered = companies.filter(company =>
      company.name.toLowerCase().includes(query)
    );

    if (filtered.length === 0) {
      companySearchResults.innerHTML = '<div class="search-result-item">No companies found</div>';
    } else {
      companySearchResults.innerHTML = filtered.map(company => `
        <div class="search-result-item" onclick="selectTechnicianCompany('${company.id}')">
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

  // Location verification
  const verifyLocationBtn = document.getElementById('verify-technician-location');
  const locationStatus = document.getElementById('technician-location-status');
  const locationMap = document.getElementById('technician-location-map');

  verifyLocationBtn.addEventListener('click', () => {
    let company = window.technicianVisitForm.selectedCompany;

    // If no selected company but technician provided a custom location name, use that
    if (!company) {
      const customName = customLocationInput && customLocationInput.value.trim() ? customLocationInput.value.trim() : null;
      if (customName) {
        company = { id: null, name: customName, description: 'Custom entry' };
        // store as selectedCompany so submit uses it
        window.technicianVisitForm.selectedCompany = company;
        if (selectedCompanyDiv) selectedCompanyDiv.style.display = 'block';
        if (selectedCompanyName) selectedCompanyName.textContent = company.name;
        if (selectedCompanyAddress) selectedCompanyAddress.textContent = company.description;
      } else {
        showToast('Please select a company or enter a custom location', 'error');
        return;
      }
    }

    if (!navigator.geolocation) {
      showToast('Geolocation not supported', 'error');
      return;
    }

    verifyLocationBtn.disabled = true;
    verifyLocationBtn.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> Capturing location...';
    if (window.lucide) lucide.createIcons();
    locationStatus.style.display = 'flex';
    locationStatus.className = 'location-status';
    locationStatus.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> Getting your location...';
    if (window.lucide) lucide.createIcons();

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const capturedLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy
        };

        // Store in global state
        window.technicianVisitForm.capturedLocation = capturedLocation;

        locationStatus.className = 'location-status success';
        locationStatus.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-icon lucide-check"><path d="M20 6 9 17l-5-5"/></svg> Location captured! Coordinates: ${capturedLocation.latitude.toFixed(6)}, ${capturedLocation.longitude.toFixed(6)}`;

        // Show map
        locationMap.style.display = 'block';
        initTechnicianLocationMap(company, capturedLocation);

        verifyLocationBtn.disabled = false;
        verifyLocationBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-pin-icon lucide-map-pin"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg> Location Captured';
        verifyLocationBtn.classList.add('btn-success');
      },
      (error) => {
        locationStatus.className = 'location-status error';
        locationStatus.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x-icon lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg> Unable to get location`;
        verifyLocationBtn.disabled = false;
        verifyLocationBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-pin-icon lucide-map-pin"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg> Capture Current Location';
        showToast('Location capture failed', 'error');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });

  // Work category other field
  const workCategorySelect = document.getElementById('work-category');
  const otherCategoryField = document.getElementById('other-category-field');

  workCategorySelect.addEventListener('change', (e) => {
    if (e.target.value === 'other') {
      otherCategoryField.style.display = 'block';
    } else {
      otherCategoryField.style.display = 'none';
    }
  });

  // Follow-up field
  const workStatusSelect = document.getElementById('work-status');
  const followUpField = document.getElementById('follow-up-field');
  const followUpNotes = document.getElementById('follow-up-notes');

  workStatusSelect.addEventListener('change', (e) => {
    if (e.target.value === 'follow_up') {
      followUpField.style.display = 'block';
      followUpNotes.required = true;
    } else {
      followUpField.style.display = 'none';
      followUpNotes.required = false;
    }
  });

  // Photo upload
  const photoInput = document.getElementById('technician-photos');
  const photoUploadArea = document.getElementById('photo-upload-multiple');
  const photoPreviewGrid = document.getElementById('photo-preview-grid');

  photoUploadArea.addEventListener('click', () => photoInput.click());

  photoInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);

    if (files.length === 0) {
      window.technicianVisitForm.photos = [];
      renderPhotoPreviews();
      return;
    }

    // Limit to 10 photos
    const filesToProcess = files.slice(0, 10);

    // Clear existing photos
    window.technicianVisitForm.photos = [];

    // Show compression progress
    showCompressionProgress('Compressing images...');

    try {
      // Process each file with compression
      for (let i = 0; i < filesToProcess.length; i++) {
        const file = filesToProcess[i];

        // Update progress message
        showCompressionProgress(`Compressing image ${i + 1} of ${filesToProcess.length}...`);

        // Validate file type
        if (!file.type.startsWith('image/')) {
          showToast(`File ${file.name} is not an image`, 'error');
          continue;
        }

        // Validate file size (before compression)
        if (file.size > 10 * 1024 * 1024) { // 10MB limit before compression
          showToast(`Photo ${file.name} exceeds 10MB limit`, 'error');
          continue;
        }

        try {
          // Compress the image
          const compressedFile = await compressImage(file, 0.6, 1200, 1200);

          // Read compressed file for preview
          const reader = new FileReader();
          reader.onload = (e) => {
            // Create a photo object with both original and compressed info
            const photoObj = {
              dataUrl: e.target.result,
              file: compressedFile,
              originalFile: file,
              name: file.name,
              originalSize: file.size,
              compressedSize: compressedFile.size,
              type: file.type,
              timestamp: new Date().toISOString()
            };

            // Add to global state
            window.technicianVisitForm.photos.push(photoObj);

            // Update preview if this is the last image
            if (window.technicianVisitForm.photos.length === filesToProcess.filter(f => f.type.startsWith('image/')).length) {
              renderPhotoPreviews();
              hideCompressionProgress();

              // Show compression summary
              const totalOriginal = window.technicianVisitForm.photos.reduce((sum, p) => sum + p.originalSize, 0);
              const totalCompressed = window.technicianVisitForm.photos.reduce((sum, p) => sum + p.compressedSize, 0);
              const totalSavings = ((1 - totalCompressed / totalOriginal) * 100).toFixed(0);

              showToast(`Images compressed! Saved ${totalSavings}% storage space`, 'success');
            }
          };

          reader.readAsDataURL(compressedFile);

        } catch (compressionError) {
          console.error('Compression error:', compressionError);
          showToast(`Failed to compress ${file.name}, using original`, 'warning');

          // Fallback to original file if compression fails
          const reader = new FileReader();
          reader.onload = (e) => {
            const photoObj = {
              dataUrl: e.target.result,
              file: file,
              name: file.name,
              originalSize: file.size,
              compressedSize: file.size,
              type: file.type,
              timestamp: new Date().toISOString()
            };

            window.technicianVisitForm.photos.push(photoObj);

            if (window.technicianVisitForm.photos.length === filesToProcess.filter(f => f.type.startsWith('image/')).length) {
              renderPhotoPreviews();
              hideCompressionProgress();
            }
          };

          reader.readAsDataURL(file);
        }
      }

    } catch (error) {
      console.error('Error processing images:', error);
      hideCompressionProgress();
      showToast('Error processing images', 'error');
    }

    // Reset the input value
    e.target.value = '';
  });

  function renderPhotoPreviews() {
    const photos = window.technicianVisitForm.photos;
    const photoPreviewGrid = document.getElementById('photo-preview-grid');

    if (!photoPreviewGrid) return;

    if (photos.length === 0) {
      photoPreviewGrid.innerHTML = '<p class="text-muted text-center">No photos selected</p>';
      return;
    }

    photoPreviewGrid.innerHTML = photos.map((photo, index) => {
      const originalSizeMB = (photo.originalSize / 1024 / 1024).toFixed(2);
      const compressedSizeMB = (photo.compressedSize / 1024 / 1024).toFixed(2);
      const savings = photo.originalSize !== photo.compressedSize ?
        `(-${((1 - photo.compressedSize / photo.originalSize) * 100).toFixed(0)}%)` : '';

      return `
        <div class="photo-item">
          <img src="${photo.dataUrl}" alt="Visit photo ${index + 1}" style="width: 100%; height: 100%; object-fit: cover;">
          <button class="photo-remove" onclick="removeTechnicianPhoto(${index})" title="Remove photo">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x-icon lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
          <div class="photo-info">
            <small>${photo.name}</small>
            <small>${compressedSizeMB} MB ${savings}</small>
          </div>
        </div>
      `;
    }).join('');
  }

  window.removeTechnicianPhoto = function (index) {
    window.technicianVisitForm.photos.splice(index, 1);
    renderPhotoPreviews();
  };

  // Initialize signature canvases
  function initSignatureCanvases() {
    const clientSignatureCanvas = document.getElementById('client-signature-canvas');
    const technicianSignatureCanvas = document.getElementById('technician-signature-canvas');

    // Set canvas dimensions
    clientSignatureCanvas.width = clientSignatureCanvas.offsetWidth;
    clientSignatureCanvas.height = clientSignatureCanvas.offsetHeight;
    technicianSignatureCanvas.width = technicianSignatureCanvas.offsetWidth;
    technicianSignatureCanvas.height = technicianSignatureCanvas.offsetHeight;

    // Get contexts
    const clientSignatureCtx = clientSignatureCanvas.getContext('2d');
    const technicianSignatureCtx = technicianSignatureCanvas.getContext('2d');

    // Store in global state
    window.technicianVisitForm.clientSignatureCanvas = clientSignatureCanvas;
    window.technicianVisitForm.technicianSignatureCanvas = technicianSignatureCanvas;
    window.technicianVisitForm.clientSignatureCtx = clientSignatureCtx;
    window.technicianVisitForm.technicianSignatureCtx = technicianSignatureCtx;

    // Set up drawing
    setupSignatureDrawing(clientSignatureCanvas, clientSignatureCtx, 'client');
    setupSignatureDrawing(technicianSignatureCanvas, technicianSignatureCtx, 'technician');
  }

  function setupSignatureDrawing(canvas, ctx, type) {
    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;
    let drawingTimeout = null;

    // Get current theme
    const isDarkTheme = document.documentElement.getAttribute('data-theme') === 'dark';

    function startDrawing(e) {
      isDrawing = true;
      [lastX, lastY] = getCoordinates(e);
      if (type === 'client') window.technicianVisitForm.isClientDrawing = true;
      if (type === 'technician') window.technicianVisitForm.isTechnicianDrawing = true;
      canvas.style.cursor = 'crosshair';

      // Clear any existing timeout
      if (drawingTimeout) clearTimeout(drawingTimeout);
    }


    function draw(e) {
      if (!isDrawing) return;

      // Use consistent blue color so signatures are visible in both themes
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const [x, y] = getCoordinates(e);

      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(x, y);
      ctx.stroke();

      [lastX, lastY] = [x, y];

      // Clear any existing timeout
      if (drawingTimeout) clearTimeout(drawingTimeout);
    }


    function stopDrawing() {
      if (!isDrawing) return;

      isDrawing = false;
      canvas.style.cursor = 'crosshair';

      // Immediately capture the signature when drawing stops
      try {
        const signatureData = canvas.toDataURL('image/png');
        const preview = document.getElementById(`${type}-signature-preview`);

        if (type === 'client') {
          window.technicianVisitForm.clientSignature = signatureData;
          document.getElementById('client-signature-placeholder').style.display = 'none';
        } else {
          window.technicianVisitForm.technicianSignature = signatureData;
          document.getElementById('technician-signature-placeholder').style.display = 'none';
        }

        if (preview) {
          preview.innerHTML = `<img src="${signatureData}" alt="${type} signature" style="max-height: 100px;">`;
          preview.classList.add('show');
        }

        checkSignatures();

        // Show a brief confirmation
        showToast(`${type === 'client' ? 'Client' : 'Technician'} signature captured`, 'success');
      } catch (err) {
        console.error('Error capturing signature:', err);
      }
    }

    function getCoordinates(e) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      let clientX, clientY;

      if (e.type.includes('touch')) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }

      return [
        (clientX - rect.left) * scaleX,
        (clientY - rect.top) * scaleY
      ];
    }

    // Mouse events
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);

    // Touch events
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      startDrawing(e);
    });
    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      draw(e);
    });
    canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      stopDrawing();
    });

    // Clear signature buttons
    document.getElementById(`clear-${type}-signature`).addEventListener('click', () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (type === 'client') {
        window.technicianVisitForm.clientSignature = null;
        document.getElementById('client-signature-placeholder').style.display = 'block';
        const pv = document.getElementById('client-signature-preview'); if (pv) pv.classList.remove('show');
      } else {
        window.technicianVisitForm.technicianSignature = null;
        document.getElementById('technician-signature-placeholder').style.display = 'block';
        const pv2 = document.getElementById('technician-signature-preview'); if (pv2) pv2.classList.remove('show');
      }
      checkSignatures();
    });

    // Save signature buttons
    document.getElementById(`save-${type}-signature`).addEventListener('click', () => {
      const signatureData = canvas.toDataURL('image/png');
      const preview = document.getElementById(`${type}-signature-preview`);

      if (type === 'client') {
        window.technicianVisitForm.clientSignature = signatureData;
        document.getElementById('client-signature-placeholder').style.display = 'none';
      } else {
        window.technicianVisitForm.technicianSignature = signatureData;
        document.getElementById('technician-signature-placeholder').style.display = 'none';
      }

      if (preview) {
        preview.innerHTML = `<img src="${signatureData}" alt="${type} signature" style="max-height: 100px;">`;
        preview.classList.add('show');
      }

      checkSignatures();
    });
  }


  function checkSignatures() {
    const nextToReviewBtn = document.getElementById('next-to-review');
    // Require only technician signature to proceed
    nextToReviewBtn.disabled = !window.technicianVisitForm.technicianSignature;
  }

  // Step navigation
  document.querySelectorAll('.next-step').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const nextStep = parseInt(e.target.dataset.next);
      if (validateStep(window.technicianVisitForm.currentStep)) {
        goToStep(nextStep);
      }
    });
  });

  document.querySelectorAll('.prev-step').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const prevStep = parseInt(e.target.dataset.prev);
      goToStep(prevStep);
    });
  });

  function goToStep(step) {
    // Update step indicators
    document.querySelectorAll('.step').forEach(stepEl => {
      const stepNum = parseInt(stepEl.dataset.step);
      stepEl.classList.remove('active', 'completed');
      if (stepNum < step) {
        stepEl.classList.add('completed');
      } else if (stepNum === step) {
        stepEl.classList.add('active');
      }
    });

    // Hide all step containers
    document.querySelectorAll('.step-container').forEach(container => {
      container.classList.remove('active');
    });

    // Show current step container
    document.getElementById(`step-${step}`).classList.add('active');

    // Update current step in global state
    window.technicianVisitForm.currentStep = step;

    // Initialize signatures if going to step 4
    if (step === 4 && !window.technicianVisitForm.clientSignatureCanvas) {
      setTimeout(initSignatureCanvases, 100);
    }

    // Generate review if going to step 5
    if (step === 5) {
      generateReview();
    }
  }

  function validateStep(step) {
    switch (step) {
      case 1:
        const company = window.technicianVisitForm.selectedCompany;
        const customLocation = document.getElementById('technician-custom-location').value.trim();

        // Allow submission if we have a selected company OR a custom location name
        if (!company && !customLocation) {
          showToast('Please select a company or enter a custom location', 'error');
          return false;
        }
        if (!window.technicianVisitForm.capturedLocation) {
          showToast('Please capture your location', 'error');
          return false;
        }
        return true;

      case 2:
        const visitType = document.getElementById('visit-type').value;
        const workCategory = document.getElementById('work-category').value;
        const workStatus = document.getElementById('work-status').value;
        const visitNotes = document.getElementById('visit-notes').value;

        if (!visitType || !workCategory || !workStatus || !visitNotes) {
          showToast('Please fill all required fields', 'error');
          return false;
        }

        if (workCategory === 'other' && !document.getElementById('other-category').value) {
          showToast('Please specify work category', 'error');
          return false;
        }

        if (workStatus === 'follow_up' && !document.getElementById('follow-up-notes').value) {
          showToast('Please provide follow-up notes', 'error');
          return false;
        }

        return true;

      case 3:
        // Photos are optional
        return true;

      case 4:
        // Client signature optional; technician signature required
        if (!window.technicianVisitForm.technicianSignature) {
          showToast('Technician signature is required', 'error');
          return false;
        }
        return true;

      default:
        return true;
    }
  }

  function generateReview() {
    const visitType = document.getElementById('visit-type');
    const workCategory = document.getElementById('work-category');
    const workStatus = document.getElementById('work-status');
    const otherCategory = document.getElementById('other-category');
    const followUpNotes = document.getElementById('follow-up-notes');
    const visitNotes = document.getElementById('visit-notes');
    const company = window.technicianVisitForm.selectedCompany;
    const capturedLocation = window.technicianVisitForm.capturedLocation;

    const summaryHTML = `
      <div class="review-item">
        <strong>Company:</strong> ${company ? company.name : 'Not selected'}
      </div>
      <div class="review-item">
        <strong>Visit Type:</strong> ${visitType.options[visitType.selectedIndex]?.text || 'Not selected'}
      </div>
      <div class="review-item">
        <strong>Work Category:</strong> ${workCategory.value === 'other' ? otherCategory.value : workCategory.options[workCategory.selectedIndex]?.text}
      </div>
      <div class="review-item">
        <strong>Work Status:</strong> ${workStatus.options[workStatus.selectedIndex]?.text || 'Not selected'}
      </div>
      ${workStatus.value === 'follow_up' ? `
        <div class="review-item">
          <strong>Follow-up Notes:</strong> ${followUpNotes.value}
        </div>
      ` : ''}
      <div class="review-item">
        <strong>Visit Notes:</strong> ${visitNotes.value}
      </div>
      <div class="review-item">
        <strong>Location:</strong> ${capturedLocation ? 'Captured ✓' : 'Not captured'}
      </div>
    `;

    document.getElementById('review-summary').innerHTML = summaryHTML;

    // Render photos
    const reviewPhotos = document.getElementById('review-photos');
    const photos = window.technicianVisitForm.photos;
    if (photos.length > 0) {
      reviewPhotos.innerHTML = photos.map((photo, index) => `
        <div class="photo-item">
          <img src="${photo.dataUrl}" alt="Visit photo ${index + 1}">
        </div>
      `).join('');
    } else {
      reviewPhotos.innerHTML = '<p class="text-muted">No photos uploaded</p>';
    }

    // Render signatures (client optional)
    document.getElementById('review-client-signature').innerHTML =
      window.technicianVisitForm.clientSignature ? `<img src="${window.technicianVisitForm.clientSignature}" alt="Client signature" style="max-height: 100px;" onerror="handleImageError(this)">` : 'Not provided';

    document.getElementById('review-technician-signature').innerHTML =
      window.technicianVisitForm.technicianSignature ? `<img src="${window.technicianVisitForm.technicianSignature}" alt="Technician signature" style="max-height: 100px;" onerror="handleImageError(this)">` : 'Not provided';

    // Enable submit only if technician signature exists (client signature optional)
    const submitBtn = document.getElementById('submit-technician-visit');
    submitBtn.disabled = !window.technicianVisitForm.technicianSignature;
  }

  // Submit visit
  document.getElementById('submit-technician-visit').addEventListener('click', async () => {
    if (!validateStep(window.technicianVisitForm.currentStep)) {
      showToast('Please complete all required fields', 'error');
      return;
    }

    const submitBtn = document.getElementById('submit-technician-visit');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> Submitting...';
    if (window.lucide) lucide.createIcons();

    try {
      // Upload photos to storage
      const photoUrls = [];
      for (const photo of window.technicianVisitForm.photos) {
        const photoPath = `technician-photos/${currentUser.id}/${Date.now()}-${photo.file.name}`;
        const { error: uploadError } = await supabaseClient.storage
          .from('safitrack')
          .upload(photoPath, photo.file);

        if (!uploadError) {
          const { data: urlData } = supabaseClient.storage.from('safitrack').getPublicUrl(photoPath);
          photoUrls.push(urlData.publicUrl);
        }
      }

      const visitData = {
        technician_id: currentUser.id,

        // 1. Company ID: If selected company, save ID. If custom, save NULL.
        company_id: window.technicianVisitForm.selectedCompany ? window.technicianVisitForm.selectedCompany.id : null,

        // 2. Company Name: If selected company, save name. If custom, save the custom input value.
        // This ensures the "Name: Unknown Company" issue is fixed because we save the name here.
        company_name: window.technicianVisitForm.selectedCompany
          ? window.technicianVisitForm.selectedCompany.name
          : (document.getElementById('technician-custom-location').value.trim() || 'Custom Location'),

        visit_type: document.getElementById('visit-type').value,
        work_category: document.getElementById('work-category').value,
        other_work_category: document.getElementById('work-category').value === 'other' ?
          document.getElementById('other-category').value : null,
        work_status: document.getElementById('work-status').value,
        follow_up_notes: document.getElementById('work-status').value === 'follow_up' ?
          document.getElementById('follow-up-notes').value : null,
        visit_notes: document.getElementById('visit-notes').value,
        client_signature: window.technicianVisitForm.clientSignature,
        technician_signature: window.technicianVisitForm.technicianSignature,
        photos: photoUrls.length > 0 ? photoUrls : null,
        latitude: window.technicianVisitForm.capturedLocation.latitude,
        longitude: window.technicianVisitForm.capturedLocation.longitude,
        verified_location: true,
        created_at: new Date().toISOString()
      };

      const { error } = await supabaseClient
        .from('technician_visits')
        .insert([visitData]);

      if (error) throw error;

      showToast('Service visit submitted successfully!', 'success');

      // Clear form for next entry
      setTimeout(() => {
        loadView('technician-activity');
      }, 1500);

    } catch (err) {
      console.error('Error submitting visit:', err);
      showToast('Failed to submit visit: ' + err.message, 'error');
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-icon lucide-check"><path d="M20 6 9 17l-5-5"/></svg> Submit Visit';
    }
  });

  function initTechnicianLocationMap(company, userLocation) {
    if (window.technicianVisitForm.map) {
      window.technicianVisitForm.map.remove();
    }

    const map = L.map('technician-location-map').setView([userLocation.latitude, userLocation.longitude], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(map);

    // Add technician location marker
    L.marker([userLocation.latitude, userLocation.longitude])
      .addTo(map)
      .bindPopup('Your Location')
      .openPopup();

    // Add company location marker if available
    if (company.latitude && company.longitude) {
      L.marker([company.latitude, company.longitude])
        .addTo(map)
        .bindPopup(company.name);

      // Draw line between technician and company
      const latlngs = [
        [userLocation.latitude, userLocation.longitude],
        [company.latitude, company.longitude]
      ];
      L.polyline(latlngs, { color: '#4f46e5', weight: 2, dashArray: '5, 5' }).addTo(map);
    }

    // Store map reference
    window.technicianVisitForm.map = map;

    // ==========================================================
    // FIX: Force map to recalculate size
    // This prevents the "blank map" issue when initializing
    // on a container that was recently hidden (display: none -> block).
    // ==========================================================
    setTimeout(() => {
      map.invalidateSize();
    }, 100);
  }
}

window.selectTechnicianCompany = function (companyId) {
  const companies = window.companiesData;
  const company = companies.find(c => c.id === companyId);
  if (!company) return;

  // Update company name input
  document.getElementById('technician-company-name').value = company.name;

  // Show selected company info
  document.getElementById('selected-technician-company').style.display = 'block';
  document.getElementById('selected-technician-company-name').textContent = company.name;
  document.getElementById('selected-technician-company-address').textContent =
    company.description || 'No description';

  // Hide search results
  document.getElementById('technician-company-search-results').style.display = 'none';

  // CRITICAL FIX: Store the company in the global state
  window.technicianVisitForm.selectedCompany = company;

  // Enable verify location button
  document.getElementById('verify-technician-location').disabled = false;
};

// Allow selecting a custom company entered by the technician
window.selectCustomTechnicianCompany = function (name) {
  const company = {
    id: null,
    name: name,
    description: 'Custom entry'
  };

  document.getElementById('technician-company-name').value = company.name;
  document.getElementById('selected-technician-company').style.display = 'block';
  document.getElementById('selected-technician-company-name').textContent = company.name;
  document.getElementById('selected-technician-company-address').textContent = company.description;
  document.getElementById('technician-company-search-results').style.display = 'none';

  window.technicianVisitForm.selectedCompany = company;
  document.getElementById('verify-technician-location').disabled = false;
};

// ======================
// TECHNICIAN ACTIVITY VIEW
// ======================

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
      <p class="page-subtitle">${visits.length} service visits logged</p>
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

  const workStatusLabels = {
    'completed': 'Completed',
    'partially_completed': 'Partially Completed',
    'pending': 'Pending',
    'follow_up': 'Follow-up Required'
  };

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
        <span class="work-status-badge ${visit.work_status}">
          ${workStatusLabels[visit.work_status]}
        </span>
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
        <div class="photo-grid mb-2" style="grid-template-columns: repeat(3, 1fr);">
          ${visit.photos.map((photo, index) => `
            <div class="photo-item" onclick="openPhotoModal('${photo}')">
              <img src="${photo}" alt="Visit photo ${index + 1}" style="width: 100%; height: 100%; object-fit: cover;" onerror="handleImageError(this)">
            </div>
          `).join('')}
          ${visit.photos.length > 3 ? `
            <div class="photo-item" style="background: var(--bg-tertiary); display: flex; align-items: center; justify-content: center;">
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

  const workStatusLabels = {
    'completed': 'Completed',
    'partially_completed': 'Partially Completed',
    'pending': 'Pending',
    'follow_up': 'Follow-up Required'
  };

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
        <span class="work-status-badge ${visit.work_status}">
          ${workStatusLabels[visit.work_status]}
        </span>
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
        <div class="photo-grid mb-2" style="grid-template-columns: repeat(3, 1fr);">
          ${visit.photos.slice(0, 3).map(photo => `
            <div class="photo-item">
              <img src="${photo}" alt="Visit photo" onclick="openPhotoModal('${photo}')" onerror="handleImageError(this)">
            </div>
          `).join('')}
          ${visit.photos.length > 3 ? `
            <div class="photo-item" style="background: var(--bg-tertiary); display: flex; align-items: center; justify-content: center;">
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
  const { data: rawVisits, error: visitsError } = await supabaseClient
    .from('technician_visits')
    .select('*')
    .order('created_at', { ascending: false });

  // Fetch all technicians
  const { data: technicians, error: techError } = await supabaseClient
    .from('profiles')
    .select('id, first_name, last_name, email')
    .eq('role', 'technician')
    .order('first_name', { ascending: true });

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

  // Group visits by work status
  const statusCounts = {
    completed: hydratedVisits.filter(v => v.work_status === 'completed').length,
    partially_completed: hydratedVisits.filter(v => v.work_status === 'partially_completed').length,
    pending: hydratedVisits.filter(v => v.work_status === 'pending').length,
    follow_up: hydratedVisits.filter(v => v.work_status === 'follow_up').length
  };

  let html = `
    <div class="page-header">
      <h1 class="page-title">Technicians Dashboard</h1>
    </div>

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
      <div class="stat-card">
        <div class="stat-value">${statusCounts.completed}</div>
        <div class="stat-label">Completed</div>
      </div>
    </div>

    
    <!-- Filters -->
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Filter Visits</h3>
      </div>
      <div class="technician-filters-row">
        <select class="technician-filter-control" id="filter-technician">
          <option value="">All Technicians</option>
          ${technicians.map(tech => `
            <option value="${tech.id}">${tech.first_name} ${tech.last_name}</option>
          `).join('')}
        </select>
        <select class="technician-filter-control" id="filter-status">
          <option value="">All Status</option>
          <option value="completed">Completed</option>
          <option value="partially_completed">Partially Completed</option>
          <option value="pending">Pending</option>
          <option value="follow_up">Follow-up Required</option>
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
  initTechnicianFilters(hydratedVisits, technicians);
}

function renderTechnicianVisitCardForManager(visit) {
  const date = formatDate(visit.created_at);
  // Use visit.company_name first (for custom locations), then fallback to joined companies data
  const companyName = visit.company_name || visit.companies?.name || 'Unknown Company';
  const technicianName = visit.technician ?
    `${visit.technician.first_name} ${visit.technician.last_name}` : 'Unknown Technician';

  const workStatusLabels = {
    'completed': 'Completed',
    'partially_completed': 'Partially Completed',
    'pending': 'Pending',
    'follow_up': 'Follow-up Required'
  };

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
        data-status="${visit.work_status}"
        data-type="${visit.visit_type}"
        data-date="${new Date(visit.created_at).toISOString().split('T')[0]}">
      <div class="technician-visit-header">
        <div>
          <div class="technician-visit-company">${companyName}</div>
          <div class="text-prim" style="font-size: 0.875rem;">
            by ${technicianName} • ${date}
          </div>
        </div>
        <span class="work-status-badge ${visit.work_status}">
          ${workStatusLabels[visit.work_status]}
        </span>
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
            background: ${statusColors[visit.work_status] || 'gray'};
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
          <div><strong>Status:</strong> ${visit.work_status}</div>
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

function initTechnicianFilters(visits, technicians) {
  const technicianFilter = document.getElementById('filter-technician');
  const statusFilter = document.getElementById('filter-status');
  const typeFilter = document.getElementById('filter-type');
  const dateFilter = document.getElementById('filter-date');
  const clearFiltersBtn = document.getElementById('clear-filters');
  const loadMoreBtn = document.getElementById('load-more-visits');

  let filteredVisits = [...visits];
  let displayedCount = 20;

  function applyFilters() {
    const technicianId = technicianFilter.value;
    const status = statusFilter.value;
    const type = typeFilter.value;
    const date = dateFilter.value;

    filteredVisits = visits.filter(visit => {
      if (technicianId && visit.technician_id !== technicianId) return false;
      if (status && visit.work_status !== status) return false;
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

  // Add event listeners
  technicianFilter.addEventListener('change', applyFilters);
  statusFilter.addEventListener('change', applyFilters);
  typeFilter.addEventListener('change', applyFilters);
  dateFilter.addEventListener('change', applyFilters);

  clearFiltersBtn.addEventListener('click', () => {
    technicianFilter.value = '';
    statusFilter.value = '';
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

    // Helper: Status badge
    const addStatusBadge = (status) => {
      const statusConfig = {
        'completed': { color: colors.success, text: 'COMPLETED' },
        'partially_completed': { color: colors.warning, text: 'PARTIAL' },
        'pending': { color: colors.secondary, text: 'PENDING' },
        'follow_up': { color: colors.danger, text: 'FOLLOW-UP' }
      };

      const config = statusConfig[status] || statusConfig.pending;

      doc.setFillColor(...config.color);
      doc.roundedRect(pageWidth - 70, 15, 50, 10, 2, 2, 'F');

      doc.setFontSize(8);
      doc.setTextColor(...colors.white);
      doc.setFont(undefined, 'bold');
      doc.text(config.text, pageWidth - 67, 21);
      doc.setFont(undefined, 'normal');
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

    // Status badge
    addStatusBadge(visit.work_status);

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
    doc.text(new Date(visit.created_at).toLocaleString(), 53, yPos + 14);

    doc.setTextColor(100, 100, 100);
    doc.text('GENERATED:', 25, yPos + 21);
    doc.setTextColor(...colors.dark);
    doc.text(new Date().toLocaleString(), 53, yPos + 21);

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
      addInfoRow('Coordinates', `${visit.latitude.toFixed(6)}, ${visit.longitude.toFixed(6)}`);
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

    addInfoRow('Visit Type', visitTypeLabels[visit.visit_type] || visit.visit_type);

    const workCategory = visit.work_category + (visit.other_work_category ? ` (${visit.other_work_category})` : '');
    addInfoRow('Work Category', workCategory);

    const statusLabels = {
      'completed': 'Completed',
      'partially_completed': 'Partially Completed',
      'pending': 'Pending',
      'follow_up': 'Follow-up Required'
    };
    addInfoRow('Work Status', statusLabels[visit.work_status] || visit.work_status);

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

      notesLines.forEach((line, index) => {
        doc.text(line, 25, yPos + 8 + (index * 6));
      });

      yPos += notesHeight + 10;
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
    <div class="modal-container" style="max-width: 800px;">
      <div class="modal-header">
        <h3><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-locate-fixed-icon lucide-locate-fixed"><line x1="2" x2="5" y1="12" y2="12"/><line x1="19" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="5"/><line x1="12" x2="12" y1="19" y2="22"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/></svg>${title || 'Location'}</h3>
        <button class="modal-close" onclick="closeModal('location-modal')">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x-icon lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <div id="location-modal-map" style="height: 400px;"></div>
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


    const workStatusLabels = {
      'completed': 'Completed',
      'partially_completed': 'Partially Completed',
      'pending': 'Pending',
      'follow_up': 'Follow-up Required'
    };

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
      <div class="modal-container" style="max-width: 800px;">
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
              <p><strong>Work Status:</strong> ${visit.work_status}</p>
            </div>
          </div>
          
          ${visit.latitude && visit.longitude ? `
            <div class="mt-4">
              <h4>Location</h4>
              <div id="visit-details-map" style="height: 200px; margin-top: 1rem;"></div>
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
              <div class="photo-grid" style="grid-template-columns: repeat(3, 1fr);">
                ${visit.photos.slice(0, 3).map(photo => `
                  <div class="photo-item">
                    <img src="${photo}" alt="Visit photo" onclick="openPhotoModal('${photo}')" onerror="handleImageError(this)">
                  </div>
                `).join('')}
                ${visit.photos.length > 3 ? `
                  <div class="photo-item" style="background: var(--bg-tertiary); display: flex; align-items: center; justify-content: center;">
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
    <div class="modal-container" style="max-width: 90%; max-height: 90%;">
      <div class="modal-header">
        <h3><i class="fas fa-camera"></i> Photo</h3>
        <button class="modal-close" onclick="closeModal('photo-modal')">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x-icon lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>
      <div class="modal-body" style="display: flex; justify-content: center; align-items: center;">
        <img src="${photoUrl}" alt="Visit photo" style="max-width: 100%; max-height: 70vh; object-fit: contain;" onerror="handleImageError(this)">
      </div>
    </div>
  `;

  document.body.appendChild(modal);
};

// ==================== MENTION SYSTEM HELPERS ====================

function showMentionSuggestions(query, container) {
  const filteredPeople = allPeople.filter(person =>
    person.name.toLowerCase().includes(query.toLowerCase())
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
  const person = allPeople.find(p => p.id === personId); // Use string comparison, not parseInt



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
  if (!mentionedPeople.find(p => p.id === personId)) {
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
async function compressImage(file, quality = 0.6, maxWidth = 1200, maxHeight = 1200) {
  return new Promise((resolve, reject) => {
    // Create a canvas element
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // Create an image element
    const img = new Image();

    img.onload = function () {
      // Calculate new dimensions
      let { width, height } = img;

      // Calculate aspect ratio
      const aspectRatio = width / height;

      // Resize if dimensions exceed max values
      if (width > maxWidth || height > maxHeight) {
        if (width > height) {
          width = maxWidth;
          height = maxWidth / aspectRatio;
        } else {
          height = maxHeight;
          width = maxHeight * aspectRatio;
        }
      }

      // Set canvas dimensions
      canvas.width = width;
      canvas.height = height;

      // Draw and compress image
      ctx.drawImage(img, 0, 0, width, height);

      // Convert to blob with compression
      canvas.toBlob(
        (blob) => {
          if (blob) {
            // Create a new File object with the compressed blob
            const compressedFile = new File(
              [blob],
              `compressed_${file.name}`,
              {
                type: file.type,
                lastModified: Date.now()
              }
            );

            resolve(compressedFile);
          } else {
            reject(new Error('Failed to compress image'));
          }
        },
        file.type,
        quality
      );
    };

    img.onerror = function () {
      reject(new Error('Failed to load image'));
    };

    // Load the image
    img.src = URL.createObjectURL(file);
  });
}



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
    updated_at: new Date().toISOString()
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
    company.name.toLowerCase().includes(query.toLowerCase())
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
    person.name.toLowerCase().includes(query.toLowerCase())
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
    <div class="modal-container" style="max-width: 600px;">
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
      updated_at: new Date().toISOString()
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
    supabaseClient.from('people').select('*', { count: 'exact', head: true }),
    supabaseClient.from('companies').select('*', { count: 'exact', head: true }),
    supabaseClient.from('tasks').select('id, status, due_date, created_at'),
    supabaseClient.from('opportunities').select('id, value, stage, created_at, updated_at'),
    supabaseClient
      .from('visits')
        .select('id, user_id, company_name, visit_type, lead_score, created_at, profiles(first_name, last_name)')
      .order('created_at', { ascending: false })
      .limit(100),
    supabaseClient.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'sales_rep')
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
    const { data } = await supabaseClient
      .from('profiles')
      .select('id, first_name, last_name')
      .eq('role', 'sales_rep');
    reps = data || [];
  }

  // Ensure companies are loaded for search fallback
  if (!window.allCompaniesData) {
    const { data: companies } = await supabaseClient
      .from('companies')
      .select('id, name, address')
      .order('name', { ascending: true });
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
            <div style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%;">
                <div>
                    <h1 class="page-title">Call Logs</h1>
                    <p class="page-subtitle">Track and manage customer calls</p>
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
                    <button class="btn btn-primary" id="log-call-btn" style="display: inline-flex; align-items: center; gap: 8px;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-plus-icon"><path d="M5 12h14"/><path d="M12 5v14"/></svg> <span>Log Call</span>
                    </button>
                    ` : ''}
                </div>
            </div>
        </div>

        <div class="card">
            <div class="filters-section" style="padding: 1rem; border-bottom: 1px solid var(--border-color); display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
                <div class="search-input-wrapper">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-search-icon" style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-muted);">
                        <path d="m21 21-4.34-4.34" />
                        <circle cx="11" cy="11" r="8" />
                    </svg>
                    <input type="text" id="call-search" placeholder="Search by contact or company..." value="${callLogFilters.search}" style="padding-left: 36px; width: 100%;" class="filter-select">
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

                <div style="display: flex; gap: 0.5rem;">
                    <button id="clear-filters" class="btn btn-secondary" style="flex: 1; padding: 0.5rem 1rem; font-size: 0.875rem;">
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
      // Debounce the search to avoid excessive re-renders
      clearTimeout(filterDebounceTimer);
      filterDebounceTimer = setTimeout(() => {
        renderCallLogsView();
      }, 300);
    });
  }

  document.getElementById('call-direction-filter')?.addEventListener('change', (e) => {
    callLogFilters.direction = e.target.value;
    renderCallLogsView();
  });

  document.getElementById('call-outcome-filter')?.addEventListener('change', (e) => {
    callLogFilters.outcome = e.target.value;
    renderCallLogsView();
  });

  document.getElementById('clear-filters')?.addEventListener('click', () => {
    callLogFilters = { search: '', direction: '', outcome: '' };
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
        matches = allPeople.filter(p => p.name.toLowerCase().includes(val)).slice(0, 5);
      } else {
        matches = (window.allCompaniesData || []).filter(c => c.name.toLowerCase().includes(val)).slice(0, 5);
      }

      let html = matches.map(m => `
                    <div class="search-result-item" data-id="${m.id}" data-name="${m.name}">
                      <span class="title">${m.name}</span>
                      <span class="subtitle">${type === 'people' ? (m.companies?.name || 'N/A') : m.address}</span>
                    </div>
    `).join('');

      html += `
                    <div class="search-result-item add-new" data-id="" data-name="${e.target.value}">
                      <span class="title">Use custom: "${e.target.value}"</span>
                    </div>
    `;

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
    notes
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
