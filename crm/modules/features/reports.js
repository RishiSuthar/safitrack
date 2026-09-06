// modules/features/reports.js
// ═══════════════════════════════════════════════════════════════════════════════
// SafiTrack CRM — Reports & Analytics Hub
// Built from scratch: Attio-inspired, flat, high-density, role-aware.
// Zero AI slop, zero glassmorphism, completely native data mapping.
// ═══════════════════════════════════════════════════════════════════════════════

import { state, supabaseClient } from '../state.js';
import { showToast } from '../ui/toast.js';
import { renderError, getCurrencySymbol } from '../utils/helpers.js';

// ── State & Registry ─────────────────────────────────────────────────────────

let _activeTab = 'executive'; // 'executive' | 'sales' | 'field' | 'comms' | 'builder'
let _dateFilter = 'all';      // 'all' | 'today' | '7d' | '30d' | 'month' | 'quarter' | 'year'
let _selectedRepId = 'all';   // 'all' or profile UUID
let _customStartDate = null;
let _customEndDate = null;

let _cachedData = {
  profiles: [],
  opportunities: [],
  visits: [],
  callLogs: [],
  tasks: [],
  companies: [],
  people: [],
  loadedAt: 0,
};

let _chartRegistry = {};
let _builderConfig = {
  dataset: 'opportunities',
  groupBy: 'none',
  metric: 'count',
  vizType: 'table',
  searchQuery: '',
};

const SAVED_REPORTS_STORAGE_KEY = 'safitrack_saved_custom_reports_v2';

// ── Canonical Opportunity Stage Mapping ───────────────────────────────────────
// Uses the CRM's native 4 stages: Lead, In Progress, Won, Lost

export function normalizeStage(rawStage) {
  const s = String(rawStage || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (s === 'closed-won' || s === 'won') return 'won';
  if (s === 'closed-lost' || s === 'lost') return 'lost';
  if (s === 'qualification' || s === 'in-progress' || s === 'proposal' || s === 'negotiation') {
    return 'in-progress';
  }
  return 'lead'; // default for prospecting, lead, or empty
}

export const STAGE_CONFIG = {
  'lead':        { key: 'lead',        label: 'Lead',        color: '#3b82f6', badgeClass: 'reports-badge-pipeline' },
  'in-progress': { key: 'in-progress', label: 'In Progress', color: '#f59e0b', badgeClass: 'reports-badge-warn' },
  'won':         { key: 'won',         label: 'Won',         color: '#10b981', badgeClass: 'reports-badge-won' },
  'lost':        { key: 'lost',        label: 'Lost',        color: '#ef4444', badgeClass: 'reports-badge-lost' },
};

// ── Chart Helper ─────────────────────────────────────────────────────────────

function isDarkMode() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ||
    document.body.classList.contains('dark-theme') ||
    window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function getChartColors() {
  const dark = isDarkMode();
  return {
    primary: '#2f5fd0',
    primaryLight: dark ? 'rgba(47, 95, 208, 0.25)' : 'rgba(47, 95, 208, 0.12)',
    success: '#10b981',
    warning: '#f59e0b',
    danger: '#ef4444',
    purple: '#8b5cf6',
    cyan: '#06b6d4',
    slate: dark ? '#94a3b8' : '#64748b',
    text: dark ? '#cbd5e1' : '#475569',
    grid: dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
    palette: [
      '#2f5fd0', '#10b981', '#f59e0b', '#8b5cf6',
      '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1'
    ],
  };
}

function renderChart(canvasId, config) {
  if (typeof window.Chart === 'undefined') return null;

  if (_chartRegistry[canvasId]) {
    try {
      _chartRegistry[canvasId].destroy();
    } catch { }
    delete _chartRegistry[canvasId];
  }

  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const colors = getChartColors();
  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: config.options?.plugins?.legend?.display ?? true,
        position: config.options?.plugins?.legend?.position ?? 'bottom',
        labels: {
          color: colors.text,
          boxWidth: 10,
          font: { family: "'Manrope', sans-serif", size: 11 },
          padding: 12,
        },
      },
      tooltip: {
        backgroundColor: isDarkMode() ? '#1e293b' : '#0f172a',
        titleFont: { family: "'Manrope', sans-serif", size: 12 },
        bodyFont: { family: "'Manrope', sans-serif", size: 12 },
        padding: 8,
        cornerRadius: 4,
      },
    },
    scales: config.options?.scales ? {
      x: {
        grid: { color: colors.grid, drawBorder: false },
        ticks: { color: colors.text, font: { family: "'Manrope', sans-serif", size: 11 } },
        ...(config.options.scales.x || {}),
      },
      y: {
        grid: { color: colors.grid, drawBorder: false },
        ticks: { color: colors.text, font: { family: "'Manrope', sans-serif", size: 11 } },
        ...(config.options.scales.y || {}),
      },
    } : undefined,
  };

  const finalConfig = {
    type: config.type,
    data: config.data,
    options: {
      ...baseOptions,
      ...(config.options || {}),
      plugins: {
        ...baseOptions.plugins,
        ...(config.options?.plugins || {}),
      },
    },
  };

  try {
    const instance = new window.Chart(ctx, finalConfig);
    _chartRegistry[canvasId] = instance;
    return instance;
  } catch (err) {
    console.error(`[Reports] Error creating chart ${canvasId}:`, err);
    return null;
  }
}

function destroyAllCharts() {
  for (const id in _chartRegistry) {
    try {
      _chartRegistry[id].destroy();
    } catch { }
  }
  _chartRegistry = {};
}

// ── Date Filtering Logic ─────────────────────────────────────────────────────

function isWithinRange(dateStr) {
  if (!dateStr || _dateFilter === 'all') return true;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (_dateFilter) {
    case 'today':
      return d >= startOfDay;
    case '7d': {
      const past7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return d >= past7;
    }
    case '30d': {
      const past30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return d >= past30;
    }
    case 'month': {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      return d >= startOfMonth;
    }
    case 'quarter': {
      const qMonth = Math.floor(now.getMonth() / 3) * 3;
      const startOfQuarter = new Date(now.getFullYear(), qMonth, 1);
      return d >= startOfQuarter;
    }
    case 'year': {
      const startOfYear = new Date(now.getFullYear(), 0, 1);
      return d >= startOfYear;
    }
    case 'custom': {
      if (_customStartDate && d < new Date(_customStartDate)) return false;
      if (_customEndDate && d > new Date(_customEndDate)) return false;
      return true;
    }
    default:
      return true;
  }
}

// ── Currency & Format Utilities ──────────────────────────────────────────────

function fmtMoney(amount) {
  const sym = getCurrencySymbol();
  const val = parseFloat(amount) || 0;
  if (Math.abs(val) >= 1_000_000) {
    return `${sym}${(val / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(val) >= 1_000) {
    return `${sym}${(val / 1_000).toFixed(1)}K`;
  }
  return `${sym}${Math.round(val).toLocaleString()}`;
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function esc(val) {
  if (val === null || val === undefined) return '';
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ── Data Fetcher ─────────────────────────────────────────────────────────────

async function loadAllReportsData(forceRefresh = false) {
  const orgId = state.currentOrganization?.id;
  if (!orgId) {
    throw new Error('No active organization loaded.');
  }

  // Use cache if fresh within 30 seconds unless forceRefresh
  if (!forceRefresh && _cachedData.loadedAt && Date.now() - _cachedData.loadedAt < 30000) {
    return _cachedData;
  }

  const isManager = Boolean(state.isManager || state.isOrgOwner);
  const currentUserId = state.currentUser?.id;

  // Build queries
  let profilesQ = supabaseClient
    .from('profiles')
    .select('id, first_name, last_name, email, role')
    .eq('organization_id', orgId)
    .order('first_name', { ascending: true });

  let oppsQ = supabaseClient
    .from('opportunities')
    .select('id, name, company_name, subsector, value, probability, stage, user_id, next_step, next_step_date, created_at, updated_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false });

  let visitsQ = supabaseClient
    .from('visits')
    .select('id, company_name, contact_name, subsector, visit_type, lead_score, travel_time, fare_amount, user_id, location_name, notes, created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false });

  // Call logs: accurate columns matching schema
  let callsQ = supabaseClient
    .from('call_logs')
    .select('id, user_id, company_id, company_name, contact_id, contact_name, direction, outcome, duration_seconds, notes, call_at, created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false });

  let tasksQ = supabaseClient
    .from('tasks')
    .select('id, title, status, priority, due_date, assigned_to, created_by, created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false });

  let companiesQ = supabaseClient
    .from('companies')
    .select('id, name, company_type, subsector, address, lead_score, created_at')
    .eq('organization_id', orgId)
    .order('name', { ascending: true });

  let peopleQ = supabaseClient
    .from('people')
    .select('id, name, email, job_title, company_id, created_at')
    .eq('organization_id', orgId)
    .order('name', { ascending: true });

  // Apply role restrictions if not manager
  if (!isManager && currentUserId) {
    oppsQ = oppsQ.eq('user_id', currentUserId);
    visitsQ = visitsQ.eq('user_id', currentUserId);
    callsQ = callsQ.eq('user_id', currentUserId);
    tasksQ = tasksQ.or(`assigned_to.eq.${currentUserId},created_by.eq.${currentUserId}`);
  }

  const [
    profilesRes,
    oppsRes,
    visitsRes,
    callsRes,
    tasksRes,
    companiesRes,
    peopleRes,
  ] = await Promise.all([
    profilesQ,
    oppsQ,
    visitsQ,
    callsQ,
    tasksQ,
    companiesQ,
    peopleQ,
  ]);

  if (profilesRes.error) console.warn('[Reports] profiles load error:', profilesRes.error);
  if (oppsRes.error) console.warn('[Reports] opps load error:', oppsRes.error);
  if (visitsRes.error) console.warn('[Reports] visits load error:', visitsRes.error);
  if (callsRes.error) console.warn('[Reports] calls load error:', callsRes.error);
  if (tasksRes.error) console.warn('[Reports] tasks load error:', tasksRes.error);
  if (companiesRes.error) console.warn('[Reports] companies load error:', companiesRes.error);
  if (peopleRes.error) console.warn('[Reports] people load error:', peopleRes.error);

  _cachedData = {
    profiles: profilesRes.data || [],
    opportunities: oppsRes.data || [],
    visits: visitsRes.data || [],
    callLogs: callsRes.data || [],
    tasks: tasksRes.data || [],
    companies: companiesRes.data || [],
    people: peopleRes.data || [],
    loadedAt: Date.now(),
  };

  return _cachedData;
}

function getFilteredData() {
  const { profiles, opportunities, visits, callLogs, tasks, companies, people } = _cachedData;

  const repFilterMatches = (userId) => {
    if (_selectedRepId === 'all') return true;
    return userId === _selectedRepId;
  };

  return {
    profiles,
    opportunities: opportunities.filter(o => isWithinRange(o.created_at) && repFilterMatches(o.user_id)),
    visits: visits.filter(v => isWithinRange(v.created_at) && repFilterMatches(v.user_id)),
    callLogs: callLogs.filter(c => isWithinRange(c.call_at || c.created_at) && repFilterMatches(c.user_id)),
    tasks: tasks.filter(t => isWithinRange(t.created_at) && (_selectedRepId === 'all' || t.assigned_to === _selectedRepId)),
    companies: companies.filter(c => isWithinRange(c.created_at)),
    people: people.filter(p => isWithinRange(p.created_at)),
  };
}

function getProfileName(profiles, userId) {
  if (!userId) return 'Unassigned';
  const p = profiles.find(item => item.id === userId);
  if (!p) return 'Unknown User';
  const full = `${p.first_name || ''} ${p.last_name || ''}`.trim();
  return full || p.email || 'Unknown User';
}

function getCompanyName(companies, companyId) {
  if (!companyId) return '—';
  const c = companies.find(item => item.id === companyId);
  return c ? c.name : '—';
}

function getPersonName(people, personId) {
  if (!personId) return '—';
  const p = people.find(item => item.id === personId);
  return p ? p.name : '—';
}

// ── Export to CSV Utility ────────────────────────────────────────────────────

function exportTableToCsv(filename, columns, rows) {
  if (!rows || !rows.length) {
    showToast('No records to export', 'warning');
    return;
  }

  const headerRow = columns.map(c => `"${c.label.replace(/"/g, '""')}"`).join(',');
  const bodyRows = rows.map(row => {
    return columns.map(col => {
      let val = col.get ? col.get(row) : (row[col.key] ?? '');
      if (typeof val === 'number') return val;
      val = String(val).replace(/"/g, '""');
      return `"${val}"`;
    }).join(',');
  });

  const csvContent = '\uFEFF' + [headerRow, ...bodyRows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showToast(`Exported ${rows.length} records to CSV`, 'success');
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN SHELL RENDERER
// ═══════════════════════════════════════════════════════════════════════════════

export async function renderReportsView() {
  const container = document.getElementById('view-container');
  if (!container) return;

  destroyAllCharts();

  // Load data first so dropdown options are available
  try {
    await loadAllReportsData();
  } catch (err) {
    container.innerHTML = renderError('Failed to load reports: ' + err.message);
    return;
  }

  const isManager = Boolean(state.isManager || state.isOrgOwner);

  // Native site design dropdown for Date filter
  const dateDdHtml = window.buildCrmDropdown ? window.buildCrmDropdown({
    id: 'reports-date-filter',
    variant: 'filter',
    value: _dateFilter,
    placeholder: 'All Time',
    options: [
      { value: 'all', label: 'All Time' },
      { value: 'today', label: 'Today' },
      { value: '7d', label: 'Last 7 Days' },
      { value: '30d', label: 'Last 30 Days' },
      { value: 'month', label: 'This Month' },
      { value: 'quarter', label: 'This Quarter' },
      { value: 'year', label: 'This Year' },
    ]
  }) : `
    <select id="reports-date-filter" class="reports-select">
      <option value="all">All Time</option>
      <option value="today">Today</option>
      <option value="7d">Last 7 Days</option>
      <option value="30d">Last 30 Days</option>
      <option value="month">This Month</option>
      <option value="quarter">This Quarter</option>
      <option value="year">This Year</option>
    </select>
  `;

  // Native site design dropdown with LIVE SEARCH for Team Members
  const repOptions = [{ value: 'all', label: 'All Team Members' }];
  const teamProfiles = _cachedData.profiles.filter(p => p.role === 'sales_rep' || p.role === 'manager' || p.role === 'technician');
  teamProfiles.forEach(p => {
    const name = `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.email;
    repOptions.push({
      value: p.id,
      label: `${name} (${p.role || 'Member'})`
    });
  });

  const repDdHtml = isManager ? (window.buildCrmDropdown ? window.buildCrmDropdown({
    id: 'reports-rep-filter',
    variant: 'filter',
    value: _selectedRepId,
    placeholder: 'All Team Members',
    searchable: true,
    searchPlaceholder: 'Search team members...',
    options: repOptions,
  }) : `
    <select id="reports-rep-filter" class="reports-select">
      <option value="all">All Team Members</option>
      ${teamProfiles.map(p => `<option value="${p.id}">${esc(p.first_name)} ${esc(p.last_name)}</option>`).join('')}
    </select>
  `) : '';

  container.innerHTML = `
    <div class="reports-container">
      <!-- Top Toolbar -->
      <header class="reports-header">
        <div class="reports-toolbar">
          <div class="reports-toolbar-filters">
            <!-- Date Range Filter (Native Dropdown) -->
            <div class="reports-toolbar-item" id="wrap-reports-date-filter">
              ${dateDdHtml}
            </div>

            <!-- Sales Rep Filter (Native Dropdown with Live Search) -->
            ${isManager ? `
              <div class="reports-toolbar-item" id="wrap-reports-rep-filter">
                ${repDdHtml}
              </div>
            ` : ''}
          </div>

          <div class="reports-toolbar-actions">
            <!-- Export CSV -->
            <button id="reports-export-btn" class="reports-btn reports-btn-secondary" title="Export current view data to CSV">
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Export CSV
            </button>

            <!-- Print / PDF -->
            <button id="reports-print-btn" class="reports-btn reports-btn-secondary reports-btn-icon" title="Print or save as PDF">
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/></svg>
            </button>

            <!-- Refresh -->
            <button id="reports-refresh-btn" class="reports-btn reports-btn-secondary reports-btn-icon" title="Refresh data">
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
            </button>
          </div>
        </div>
      </header>

      <!-- Navigation Tabs -->
      <nav class="reports-tabs" id="reports-nav-tabs">
        <button class="reports-tab-btn ${_activeTab === 'executive' ? 'active' : ''}" data-tab="executive">
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>
          Executive Overview
        </button>
        <button class="reports-tab-btn ${_activeTab === 'sales' ? 'active' : ''}" data-tab="sales">
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg>
          Sales & Pipeline
        </button>
        <button class="reports-tab-btn ${_activeTab === 'field' ? 'active' : ''}" data-tab="field">
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
          Field Operations
        </button>
        <button class="reports-tab-btn ${_activeTab === 'comms' ? 'active' : ''}" data-tab="comms">
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          Communications
        </button>
        <button class="reports-tab-btn ${_activeTab === 'builder' ? 'active' : ''}" data-tab="builder">
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          Custom Report Explorer
        </button>
      </nav>

      <!-- Tab Content Area -->
      <main id="reports-tab-content">
        <div class="reports-loading-state">
          <div class="reports-spinner"></div>
          <span>Rendering analytics...</span>
        </div>
      </main>
    </div>
  `;

  // Init native dropdowns
  if (window.initAllCrmDropdowns) {
    window.initAllCrmDropdowns(container);
  }

  // Attach Header Events to the hidden inputs of the custom dropdowns (which fire change events)
  const dateInput = document.getElementById('reports-date-filter');
  dateInput?.addEventListener('change', (e) => {
    _dateFilter = e.target.value;
    renderCurrentTab();
  });

  const repInput = document.getElementById('reports-rep-filter');
  repInput?.addEventListener('change', (e) => {
    _selectedRepId = e.target.value;
    renderCurrentTab();
  });

  document.getElementById('reports-refresh-btn')?.addEventListener('click', () => {
    refreshReportsData();
  });

  document.getElementById('reports-print-btn')?.addEventListener('click', () => {
    window.print();
  });

  document.getElementById('reports-export-btn')?.addEventListener('click', () => {
    triggerCurrentTabExport();
  });

  // Tab switching
  document.getElementById('reports-nav-tabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.reports-tab-btn');
    if (!btn) return;
    const tab = btn.getAttribute('data-tab');
    if (tab && tab !== _activeTab) {
      _activeTab = tab;
      document.querySelectorAll('.reports-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderCurrentTab();
    }
  });

  renderCurrentTab();
}

async function refreshReportsData() {
  const content = document.getElementById('reports-tab-content');
  if (content) {
    content.innerHTML = `
      <div class="reports-loading-state">
        <div class="reports-spinner"></div>
        <span>Refreshing data...</span>
      </div>
    `;
  }
  try {
    await loadAllReportsData(true);
    renderReportsView();
    showToast('Analytics refreshed', 'success');
  } catch (err) {
    showToast('Refresh failed: ' + err.message, 'error');
  }
}

function renderCurrentTab() {
  destroyAllCharts();
  switch (_activeTab) {
    case 'executive':
      renderExecutiveTab();
      break;
    case 'sales':
      renderSalesTab();
      break;
    case 'field':
      renderFieldTab();
      break;
    case 'comms':
      renderCommsTab();
      break;
    case 'builder':
      renderBuilderTab();
      break;
    default:
      renderExecutiveTab();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 1: EXECUTIVE OVERVIEW
// ═══════════════════════════════════════════════════════════════════════════════

function renderExecutiveTab() {
  const content = document.getElementById('reports-tab-content');
  if (!content) return;

  const data = getFilteredData();
  const { opportunities, visits, callLogs, tasks, profiles } = data;

  // Key Aggregations
  const totalPipeline = opportunities.reduce((acc, o) => acc + (parseFloat(o.value) || 0), 0);
  const wonDeals = opportunities.filter(o => normalizeStage(o.stage) === 'won');
  const wonRevenue = wonDeals.reduce((acc, o) => acc + (parseFloat(o.value) || 0), 0);
  const lostDeals = opportunities.filter(o => normalizeStage(o.stage) === 'lost');
  const closedCount = wonDeals.length + lostDeals.length;
  const winRate = closedCount > 0 ? Math.round((wonDeals.length / closedCount) * 100) : 0;

  const totalVisits = visits.length;
  const scores = visits.map(v => parseFloat(v.lead_score)).filter(n => !isNaN(n) && n > 0);
  const avgLeadScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : '—';

  const totalCalls = callLogs.length;
  const connectedCalls = callLogs.filter(c => (c.outcome || '').toLowerCase() === 'connected').length;
  const connRate = totalCalls > 0 ? Math.round((connectedCalls / totalCalls) * 100) : 0;

  const completedTasks = tasks.filter(t => t.status === 'done').length;
  const taskCompletionRate = tasks.length > 0 ? Math.round((completedTasks / tasks.length) * 100) : 100;
  const overdueTasks = tasks.filter(t => t.status !== 'done' && t.due_date && new Date(t.due_date) < new Date()).length;

  content.innerHTML = `
    <div class="reports-section">
      <!-- KPI Metric Row -->
      <div class="reports-kpi-grid">
        <div class="reports-kpi-card">
          <div class="reports-kpi-top">
            <span class="reports-kpi-label">Pipeline Value</span>
            <div class="reports-kpi-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg>
            </div>
          </div>
          <div class="reports-kpi-value">${fmtMoney(totalPipeline)}</div>
          <div class="reports-kpi-subtext">
            <span>${opportunities.length} total deals in pipeline</span>
          </div>
        </div>

        <div class="reports-kpi-card">
          <div class="reports-kpi-top">
            <span class="reports-kpi-label">Won Revenue</span>
            <div class="reports-kpi-icon" style="color: #10b981; background: rgba(16, 185, 129, 0.1);">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20"/><path d="m17 5-5-3-5 3"/><path d="m17 19-5 3-5-3"/><rect width="18" height="10" x="3" y="7" rx="2"/></svg>
            </div>
          </div>
          <div class="reports-kpi-value">${fmtMoney(wonRevenue)}</div>
          <div class="reports-kpi-subtext positive">
            <span>${wonDeals.length} won deals · ${winRate}% win rate</span>
          </div>
        </div>

        <div class="reports-kpi-card">
          <div class="reports-kpi-top">
            <span class="reports-kpi-label">Field Visits</span>
            <div class="reports-kpi-icon" style="color: #f59e0b; background: rgba(245, 158, 11, 0.1);">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
            </div>
          </div>
          <div class="reports-kpi-value">${totalVisits}</div>
          <div class="reports-kpi-subtext">
            <span>Avg Lead Score: ${avgLeadScore}</span>
          </div>
        </div>

        <div class="reports-kpi-card">
          <div class="reports-kpi-top">
            <span class="reports-kpi-label">Outreach Calls</span>
            <div class="reports-kpi-icon" style="color: #8b5cf6; background: rgba(139, 92, 246, 0.1);">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            </div>
          </div>
          <div class="reports-kpi-value">${totalCalls}</div>
          <div class="reports-kpi-subtext">
            <span>${connRate}% connection rate</span>
          </div>
        </div>

        <div class="reports-kpi-card">
          <div class="reports-kpi-top">
            <span class="reports-kpi-label">Task Health</span>
            <div class="reports-kpi-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            </div>
          </div>
          <div class="reports-kpi-value">${taskCompletionRate}%</div>
          <div class="reports-kpi-subtext ${overdueTasks > 0 ? 'negative' : 'positive'}">
            <span>${overdueTasks} overdue · ${tasks.length} total tasks</span>
          </div>
        </div>
      </div>

      <!-- Charts Row -->
      <div class="reports-grid-2">
        <!-- Canonical 4 Stages: Lead, In Progress, Won, Lost -->
        <div class="reports-chart-card">
          <div class="reports-chart-card-header">
            <h3 class="reports-chart-title">Pipeline Value by Stage</h3>
            <span class="reports-chart-legend-badge">Total: ${fmtMoney(totalPipeline)}</span>
          </div>
          <div class="reports-chart-canvas-wrap">
            <canvas id="chart-exec-stages"></canvas>
          </div>
        </div>

        <!-- Monthly Velocity Trend -->
        <div class="reports-chart-card">
          <div class="reports-chart-card-header">
            <h3 class="reports-chart-title">Activity Volume Trend</h3>
            <span class="reports-chart-legend-badge">Monthly Growth</span>
          </div>
          <div class="reports-chart-canvas-wrap">
            <canvas id="chart-exec-trend"></canvas>
          </div>
        </div>
      </div>

      <!-- Team Activity Leaderboard Table -->
      <div class="reports-table-card">
        <div class="reports-table-header">
          <h3 class="reports-table-title">Team Performance Leaderboard</h3>
          <span class="reports-section-desc">Comparison of sales, visits, calls, and completed tasks</span>
        </div>
        <div class="reports-table-responsive">
          <table class="reports-table">
            <thead>
              <tr>
                <th>Team Member</th>
                <th>Role</th>
                <th class="reports-table-num">Deals Won</th>
                <th class="reports-table-num">Won Revenue</th>
                <th class="reports-table-num">Active Pipeline</th>
                <th class="reports-table-num">Field Visits</th>
                <th class="reports-table-num">Calls</th>
                <th class="reports-table-num">Tasks Done</th>
              </tr>
            </thead>
            <tbody>
              ${renderLeaderboardRows(profiles, opportunities, visits, callLogs, tasks)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  // Render 4 Canonical Stages (Lead, In Progress, Won, Lost)
  const canonicalStages = [
    STAGE_CONFIG['lead'],
    STAGE_CONFIG['in-progress'],
    STAGE_CONFIG['won'],
    STAGE_CONFIG['lost'],
  ];

  const stageValues = canonicalStages.map(s => {
    return opportunities
      .filter(o => normalizeStage(o.stage) === s.key)
      .reduce((sum, o) => sum + (parseFloat(o.value) || 0), 0);
  });

  renderChart('chart-exec-stages', {
    type: 'bar',
    data: {
      labels: canonicalStages.map(s => s.label),
      datasets: [{
        label: 'Value',
        data: stageValues,
        backgroundColor: canonicalStages.map(s => s.color),
        borderRadius: 4,
      }],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: {
          ticks: {
            callback: (val) => fmtMoney(val),
          },
        },
      },
    },
  });

  // Render Monthly Trend Chart
  const months = getPastMonthsLabels(6);
  const monthlyDeals = new Array(6).fill(0);
  const monthlyVisits = new Array(6).fill(0);
  const monthlyCalls = new Array(6).fill(0);

  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const targetMonth = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    const m = targetMonth.getMonth();
    const y = targetMonth.getFullYear();

    monthlyDeals[i] = opportunities.filter(o => {
      const d = new Date(o.created_at);
      return d.getMonth() === m && d.getFullYear() === y;
    }).length;

    monthlyVisits[i] = visits.filter(v => {
      const d = new Date(v.created_at);
      return d.getMonth() === m && d.getFullYear() === y;
    }).length;

    monthlyCalls[i] = callLogs.filter(c => {
      const d = new Date(c.call_at || c.created_at);
      return d.getMonth() === m && d.getFullYear() === y;
    }).length;
  }

  const colors = getChartColors();
  renderChart('chart-exec-trend', {
    type: 'line',
    data: {
      labels: months,
      datasets: [
        {
          label: 'Deals Created',
          data: monthlyDeals,
          borderColor: colors.primary,
          backgroundColor: colors.primaryLight,
          tension: 0.3,
          fill: true,
        },
        {
          label: 'Field Visits',
          data: monthlyVisits,
          borderColor: colors.warning,
          backgroundColor: 'transparent',
          tension: 0.3,
        },
        {
          label: 'Calls Logged',
          data: monthlyCalls,
          borderColor: colors.success,
          backgroundColor: 'transparent',
          tension: 0.3,
        },
      ],
    },
  });
}

function renderLeaderboardRows(profiles, opportunities, visits, callLogs, tasks) {
  const reps = profiles.filter(p => p.role === 'sales_rep' || p.role === 'manager' || p.role === 'technician');
  if (!reps.length) {
    return `<tr><td colspan="8" style="text-align: center; color: var(--text-muted);">No team members found</td></tr>`;
  }

  const stats = reps.map(p => {
    const pDeals = opportunities.filter(o => o.user_id === p.id);
    const pWon = pDeals.filter(o => normalizeStage(o.stage) === 'won');
    const pWonVal = pWon.reduce((s, o) => s + (parseFloat(o.value) || 0), 0);
    const pActiveVal = pDeals.filter(o => normalizeStage(o.stage) !== 'won' && normalizeStage(o.stage) !== 'lost')
      .reduce((s, o) => s + (parseFloat(o.value) || 0), 0);

    const pVisits = visits.filter(v => v.user_id === p.id).length;
    const pCalls = callLogs.filter(c => c.user_id === p.id).length;
    const pTasksDone = tasks.filter(t => t.assigned_to === p.id && t.status === 'done').length;

    return {
      name: `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.email,
      role: p.role,
      wonCount: pWon.length,
      wonVal: pWonVal,
      activeVal: pActiveVal,
      visitsCount: pVisits,
      callsCount: pCalls,
      tasksDone: pTasksDone,
    };
  });

  stats.sort((a, b) => b.wonVal - a.wonVal);

  return stats.map(r => `
    <tr>
      <td style="font-weight: 600;">${esc(r.name)}</td>
      <td><span class="reports-badge reports-badge-neutral">${esc(r.role)}</span></td>
      <td class="reports-table-num">${r.wonCount}</td>
      <td class="reports-table-num" style="font-weight: 600; color: #10b981;">${fmtMoney(r.wonVal)}</td>
      <td class="reports-table-num">${fmtMoney(r.activeVal)}</td>
      <td class="reports-table-num">${r.visitsCount}</td>
      <td class="reports-table-num">${r.callsCount}</td>
      <td class="reports-table-num">${r.tasksDone}</td>
    </tr>
  `).join('');
}

function getPastMonthsLabels(count) {
  const labels = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    labels.push(d.toLocaleDateString(undefined, { month: 'short' }));
  }
  return labels;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 2: SALES & PIPELINE
// ═══════════════════════════════════════════════════════════════════════════════

function renderSalesTab() {
  const content = document.getElementById('reports-tab-content');
  if (!content) return;

  const data = getFilteredData();
  const { opportunities, profiles } = data;

  const totalValue = opportunities.reduce((s, o) => s + (parseFloat(o.value) || 0), 0);
  const weightedValue = opportunities.reduce((s, o) => {
    const v = parseFloat(o.value) || 0;
    const p = parseFloat(o.probability) || 0;
    return s + (v * (p / 100));
  }, 0);

  const wonDeals = opportunities.filter(o => normalizeStage(o.stage) === 'won');
  const lostDeals = opportunities.filter(o => normalizeStage(o.stage) === 'lost');
  const openDeals = opportunities.filter(o => normalizeStage(o.stage) !== 'won' && normalizeStage(o.stage) !== 'lost');
  const closedCount = wonDeals.length + lostDeals.length;
  const winRate = closedCount > 0 ? Math.round((wonDeals.length / closedCount) * 100) : 0;
  const avgDeal = opportunities.length ? Math.round(totalValue / opportunities.length) : 0;

  content.innerHTML = `
    <div class="reports-section">
      <!-- Sales KPIs -->
      <div class="reports-kpi-grid">
        <div class="reports-kpi-card">
          <div class="reports-kpi-top">
            <span class="reports-kpi-label">Pipeline Value</span>
            <div class="reports-kpi-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg>
            </div>
          </div>
          <div class="reports-kpi-value">${fmtMoney(totalValue)}</div>
          <div class="reports-kpi-subtext">
            <span>${opportunities.length} total opportunities</span>
          </div>
        </div>

        <div class="reports-kpi-card">
          <div class="reports-kpi-top">
            <span class="reports-kpi-label">Weighted Forecast</span>
            <div class="reports-kpi-icon" style="color: #06b6d4; background: rgba(6, 182, 212, 0.1);">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
            </div>
          </div>
          <div class="reports-kpi-value">${fmtMoney(weightedValue)}</div>
          <div class="reports-kpi-subtext">
            <span>Probability-adjusted forecast</span>
          </div>
        </div>

        <div class="reports-kpi-card">
          <div class="reports-kpi-top">
            <span class="reports-kpi-label">Win Rate</span>
            <div class="reports-kpi-icon" style="color: #10b981; background: rgba(16, 185, 129, 0.1);">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>
            </div>
          </div>
          <div class="reports-kpi-value">${winRate}%</div>
          <div class="reports-kpi-subtext positive">
            <span>${wonDeals.length} Won / ${lostDeals.length} Lost</span>
          </div>
        </div>

        <div class="reports-kpi-card">
          <div class="reports-kpi-top">
            <span class="reports-kpi-label">Average Deal</span>
            <div class="reports-kpi-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.91 8.84 8.56 2.23a1.93 1.93 0 0 0-1.81 0L3.1 4.13a2.12 2.12 0 0 0-.05 3.69l12.22 6.93a2 2 0 0 0 1.94 0L21 12.5a2.12 2.12 0 0 0-.09-3.66Z"/><path d="M3.09 8.84v7.41a2 2 0 0 0 1 1.73l3.35 1.94"/></svg>
            </div>
          </div>
          <div class="reports-kpi-value">${fmtMoney(avgDeal)}</div>
          <div class="reports-kpi-subtext">
            <span>${openDeals.length} open deals active</span>
          </div>
        </div>
      </div>

      <!-- Funnel & Subsector Row -->
      <div class="reports-grid-2">
        <!-- Canonical 4 Stages Funnel: Lead, In Progress, Won, Lost -->
        <div class="reports-chart-card">
          <div class="reports-chart-card-header">
            <h3 class="reports-chart-title">Deal Pipeline Funnel</h3>
            <span class="reports-chart-legend-badge">Stages: Lead · In Progress · Won · Lost</span>
          </div>
          <div style="padding-top: 8px;">
            ${renderPipelineFunnelBars(opportunities)}
          </div>
        </div>

        <!-- Pipeline Forecast by Confidence -->
        <div class="reports-chart-card">
          <div class="reports-chart-card-header">
            <h3 class="reports-chart-title">Pipeline Forecast by Confidence</h3>
            <span class="reports-chart-legend-badge">Probability Tiers</span>
          </div>
          <div class="reports-chart-canvas-wrap">
            <canvas id="chart-sales-forecast-tiers"></canvas>
          </div>
        </div>
      </div>

      <!-- Opportunities Data Table -->
      <div class="reports-table-card">
        <div class="reports-table-header">
          <h3 class="reports-table-title">Opportunities Detail</h3>
          <input type="text" id="sales-table-search" class="reports-table-search" placeholder="Search opportunities...">
        </div>
        <div class="reports-table-responsive">
          <table class="reports-table" id="sales-opportunities-table">
            <thead>
              <tr>
                <th>Deal Name</th>
                <th>Company</th>
                <th>Next Step</th>
                <th>Stage</th>
                <th class="reports-table-num">Value</th>
                <th class="reports-table-num">Prob %</th>
                <th>Owner</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody id="sales-table-tbody">
              ${renderDealsTableRows(opportunities, profiles)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  // Search filter
  document.getElementById('sales-table-search')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    const filtered = opportunities.filter(o => {
      const stageObj = STAGE_CONFIG[normalizeStage(o.stage)];
      return (o.name && o.name.toLowerCase().includes(q)) ||
        (o.company_name && o.company_name.toLowerCase().includes(q)) ||
        (o.next_step && o.next_step.toLowerCase().includes(q)) ||
        (stageObj && stageObj.label.toLowerCase().includes(q));
    });
    const tbody = document.getElementById('sales-table-tbody');
    if (tbody) tbody.innerHTML = renderDealsTableRows(filtered, profiles);
  });

  // Render Pipeline Forecast by Confidence Tiers Chart
  const highConfidence = [];
  const moderateConfidence = [];
  const earlyStage = [];

  opportunities.forEach(o => {
    const stage = normalizeStage(o.stage);
    if (stage === 'lost' || stage === 'won') return;
    const prob = parseFloat(o.probability) || 0;
    if (prob >= 70) {
      highConfidence.push(o);
    } else if (prob >= 40) {
      moderateConfidence.push(o);
    } else {
      earlyStage.push(o);
    }
  });

  const tiers = [
    { label: 'High (≥70%)', deals: highConfidence, color: '#10b981' },
    { label: 'Moderate (40–69%)', deals: moderateConfidence, color: '#3b82f6' },
    { label: 'Early (<40%)', deals: earlyStage, color: '#f59e0b' },
  ];
  if (wonDeals.length > 0) {
    tiers.push({ label: 'Closed Won', deals: wonDeals, color: '#059669' });
  }

  const tierLabels = tiers.map(t => t.label);
  const tierValues = tiers.map(t => t.deals.reduce((s, o) => s + (parseFloat(o.value) || 0), 0));
  const tierCounts = tiers.map(t => t.deals.length);

  renderChart('chart-sales-forecast-tiers', {
    type: 'doughnut',
    data: {
      labels: tierLabels,
      datasets: [{
        data: tierValues,
        backgroundColor: tiers.map(t => t.color),
        borderWidth: 1,
        borderColor: isDarkMode() ? '#1a1d24' : '#ffffff',
      }],
    },
    options: {
      cutout: '65%',
      plugins: {
        legend: {
          position: 'right',
          labels: {
            boxWidth: 12,
            font: { family: 'Manrope', size: 11, weight: '500' },
            generateLabels: function(chart) {
              const data = chart.data;
              return data.labels.map((label, i) => {
                const count = tierCounts[i];
                const val = fmtMoney(tierValues[i]);
                return {
                  text: `${label}: ${val} (${count})`,
                  fillStyle: data.datasets[0].backgroundColor[i],
                  strokeStyle: data.datasets[0].borderColor,
                  lineWidth: 1,
                  hidden: isNaN(data.datasets[0].data[i]) || chart.getDatasetMeta(0).data[i]?.hidden,
                  index: i,
                };
              });
            },
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const count = tierCounts[ctx.dataIndex];
              return ` ${ctx.label}: ${fmtMoney(ctx.raw)} (${count} ${count === 1 ? 'deal' : 'deals'})`;
            },
          },
        },
      },
    },
  });
}

function renderPipelineFunnelBars(opportunities) {
  const stages = [
    STAGE_CONFIG['lead'],
    STAGE_CONFIG['in-progress'],
    STAGE_CONFIG['won'],
    STAGE_CONFIG['lost'],
  ];

  const total = opportunities.length || 1;

  return stages.map(st => {
    const count = opportunities.filter(o => normalizeStage(o.stage) === st.key).length;
    const val = opportunities.filter(o => normalizeStage(o.stage) === st.key)
      .reduce((s, o) => s + (parseFloat(o.value) || 0), 0);
    const pct = Math.round((count / total) * 100);

    return `
      <div class="reports-funnel-row">
        <div class="reports-funnel-meta">
          <span>${st.label} (${count})</span>
          <span style="font-weight: 600;">${fmtMoney(val)} · ${pct}%</span>
        </div>
        <div class="reports-funnel-track">
          <div class="reports-funnel-fill" style="width: ${Math.max(pct, count > 0 ? 5 : 0)}%; background-color: ${st.color};"></div>
        </div>
      </div>
    `;
  }).join('');
}

function renderDealsTableRows(opportunities, profiles) {
  if (!opportunities.length) {
    return `<tr><td colspan="8" style="text-align: center; color: var(--text-muted);">No opportunities found in this period</td></tr>`;
  }

  return opportunities.slice(0, 100).map(o => {
    const stageKey = normalizeStage(o.stage);
    const stageObj = STAGE_CONFIG[stageKey] || STAGE_CONFIG['lead'];

    return `
      <tr>
        <td style="font-weight: 600;">${esc(o.name)}</td>
        <td>${esc(o.company_name || '—')}</td>
        <td><span style="font-size: 12px; color: ${o.next_step ? 'var(--text-primary)' : 'var(--text-muted)'};">${esc(o.next_step || 'None scheduled')}</span></td>
        <td><span class="reports-badge ${stageObj.badgeClass}">${esc(stageObj.label)}</span></td>
        <td class="reports-table-num" style="font-weight: 600;">${fmtMoney(o.value)}</td>
        <td class="reports-table-num">${o.probability || 0}%</td>
        <td>${esc(getProfileName(profiles, o.user_id))}</td>
        <td style="color: var(--text-muted); font-size: 12px;">${fmtDate(o.created_at)}</td>
      </tr>
    `;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 3: FIELD OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

function renderFieldTab() {
  const content = document.getElementById('reports-tab-content');
  if (!content) return;

  const data = getFilteredData();
  const { visits, profiles } = data;

  const totalVisits = visits.length;
  const newLeadVisits = visits.filter(v => v.visit_type === 'new_lead').length;
  const followUpVisits = visits.filter(v => v.visit_type === 'follow_up' || v.visit_type === 'demo' || v.visit_type === 'closing').length;
  const totalTravelMins = visits.reduce((s, v) => s + (parseInt(v.travel_time) || 0), 0);
  const totalFare = visits.reduce((s, v) => s + (parseFloat(v.fare_amount) || 0), 0);

  const travelHrs = Math.floor(totalTravelMins / 60);
  const travelRemMins = totalTravelMins % 60;
  const travelStr = travelHrs > 0 ? `${travelHrs}h ${travelRemMins}m` : `${travelRemMins}m`;

  content.innerHTML = `
    <div class="reports-section">
      <!-- Field Operations KPIs -->
      <div class="reports-kpi-grid">
        <div class="reports-kpi-card">
          <div class="reports-kpi-top">
            <span class="reports-kpi-label">Total Visits</span>
            <div class="reports-kpi-icon" style="color: #2f5fd0; background: rgba(47, 95, 208, 0.1);">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
            </div>
          </div>
          <div class="reports-kpi-value">${totalVisits}</div>
          <div class="reports-kpi-subtext">
            <span>Logged field engagements</span>
          </div>
        </div>

        <div class="reports-kpi-card">
          <div class="reports-kpi-top">
            <span class="reports-kpi-label">New Lead Visits</span>
            <div class="reports-kpi-icon" style="color: #10b981; background: rgba(16, 185, 129, 0.1);">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/></svg>
            </div>
          </div>
          <div class="reports-kpi-value">${newLeadVisits}</div>
          <div class="reports-kpi-subtext positive">
            <span>${totalVisits ? Math.round((newLeadVisits / totalVisits) * 100) : 0}% first-time prospect visits</span>
          </div>
        </div>

        <div class="reports-kpi-card">
          <div class="reports-kpi-top">
            <span class="reports-kpi-label">Follow-up / Demos</span>
            <div class="reports-kpi-icon" style="color: #f59e0b; background: rgba(245, 158, 11, 0.1);">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
            </div>
          </div>
          <div class="reports-kpi-value">${followUpVisits}</div>
          <div class="reports-kpi-subtext">
            <span>Nurturing & demo engagements</span>
          </div>
        </div>

        <div class="reports-kpi-card">
          <div class="reports-kpi-top">
            <span class="reports-kpi-label">Travel Time</span>
            <div class="reports-kpi-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </div>
          </div>
          <div class="reports-kpi-value">${travelStr}</div>
          <div class="reports-kpi-subtext">
            <span>${totalTravelMins} total minutes on transit</span>
          </div>
        </div>

        <div class="reports-kpi-card">
          <div class="reports-kpi-top">
            <span class="reports-kpi-label">Fare Expenses</span>
            <div class="reports-kpi-icon" style="color: #8b5cf6; background: rgba(139, 92, 246, 0.1);">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
            </div>
          </div>
          <div class="reports-kpi-value">${fmtMoney(totalFare)}</div>
          <div class="reports-kpi-subtext">
            <span>Logged reimbursement claims</span>
          </div>
        </div>
      </div>

      <!-- Field Charts Grid -->
      <div class="reports-grid-2">
        <!-- Visits by Type -->
        <div class="reports-chart-card">
          <div class="reports-chart-card-header">
            <h3 class="reports-chart-title">Visits by Type</h3>
            <span class="reports-chart-legend-badge">Activity Mix</span>
          </div>
          <div class="reports-chart-canvas-wrap">
            <canvas id="chart-field-types"></canvas>
          </div>
        </div>

        <!-- Visits per Rep -->
        <div class="reports-chart-card">
          <div class="reports-chart-card-header">
            <h3 class="reports-chart-title">Field Visits by Team Member</h3>
            <span class="reports-chart-legend-badge">Coverage</span>
          </div>
          <div class="reports-chart-canvas-wrap">
            <canvas id="chart-field-reps"></canvas>
          </div>
        </div>
      </div>

      <!-- Visits Data Table -->
      <div class="reports-table-card">
        <div class="reports-table-header">
          <h3 class="reports-table-title">Field Visit Logs</h3>
          <input type="text" id="visits-table-search" class="reports-table-search" placeholder="Search visits, companies...">
        </div>
        <div class="reports-table-responsive">
          <table class="reports-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Contact</th>
                <th>Type</th>
                <th>Rep / Agent</th>
                <th class="reports-table-num">Lead Score</th>
                <th class="reports-table-num">Travel</th>
                <th class="reports-table-num">Fare</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody id="visits-table-tbody">
              ${renderVisitsTableRows(visits, profiles)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  // Search filter
  document.getElementById('visits-table-search')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    const filtered = visits.filter(v => {
      return (v.company_name && v.company_name.toLowerCase().includes(q)) ||
        (v.contact_name && v.contact_name.toLowerCase().includes(q)) ||
        (v.visit_type && v.visit_type.toLowerCase().includes(q)) ||
        (v.location_name && v.location_name.toLowerCase().includes(q));
    });
    const tbody = document.getElementById('visits-table-tbody');
    if (tbody) tbody.innerHTML = renderVisitsTableRows(filtered, profiles);
  });

  // Chart 1: Visits by Type
  const typeMap = {};
  visits.forEach(v => {
    const t = (v.visit_type || 'new_lead').replace(/_/g, ' ');
    typeMap[t] = (typeMap[t] || 0) + 1;
  });

  const colors = getChartColors();
  const typeLabels = Object.keys(typeMap);
  renderChart('chart-field-types', {
    type: 'doughnut',
    data: {
      labels: typeLabels.map(s => s.charAt(0).toUpperCase() + s.slice(1)),
      datasets: [{
        data: Object.values(typeMap),
        backgroundColor: colors.palette.slice(0, typeLabels.length),
        borderWidth: 1,
        borderColor: isDarkMode() ? '#1a1d24' : '#ffffff',
      }],
    },
    options: {
      plugins: { legend: { position: 'right' } },
    },
  });

  // Chart 2: Visits per Rep
  const repMap = {};
  visits.forEach(v => {
    const repName = getProfileName(profiles, v.user_id);
    repMap[repName] = (repMap[repName] || 0) + 1;
  });

  const repLabels = Object.keys(repMap).slice(0, 8);
  const repCounts = repLabels.map(k => repMap[k]);

  renderChart('chart-field-reps', {
    type: 'bar',
    data: {
      labels: repLabels,
      datasets: [{
        label: 'Visits',
        data: repCounts,
        backgroundColor: colors.primary,
        borderRadius: 4,
      }],
    },
    options: {
      plugins: { legend: { display: false } },
    },
  });
}

function renderVisitsTableRows(visits, profiles) {
  if (!visits.length) {
    return `<tr><td colspan="8" style="text-align: center; color: var(--text-muted);">No field visits found in this period</td></tr>`;
  }

  return visits.slice(0, 100).map(v => {
    const formattedType = (v.visit_type || 'visit').replace(/_/g, ' ');
    return `
      <tr>
        <td style="font-weight: 600;">${esc(v.company_name || '—')}</td>
        <td>${esc(v.contact_name || '—')}</td>
        <td><span class="reports-badge reports-badge-neutral">${esc(formattedType)}</span></td>
        <td>${esc(getProfileName(profiles, v.user_id))}</td>
        <td class="reports-table-num">
          ${v.lead_score ? `<span class="reports-badge reports-badge-won">${v.lead_score}</span>` : '—'}
        </td>
        <td class="reports-table-num">${v.travel_time ? `${v.travel_time}m` : '—'}</td>
        <td class="reports-table-num">${v.fare_amount ? fmtMoney(v.fare_amount) : '—'}</td>
        <td style="color: var(--text-muted); font-size: 12px;">${fmtDate(v.created_at)}</td>
      </tr>
    `;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 4: COMMUNICATIONS & OUTREACH
// ═══════════════════════════════════════════════════════════════════════════════

function renderCommsTab() {
  const content = document.getElementById('reports-tab-content');
  if (!content) return;

  const data = getFilteredData();
  const { callLogs, profiles, companies, people } = data;

  const totalCalls = callLogs.length;
  const outbound = callLogs.filter(c => (c.direction || '').toLowerCase() === 'outbound').length;
  const inbound = callLogs.filter(c => (c.direction || '').toLowerCase() === 'inbound').length;
  const connected = callLogs.filter(c => (c.outcome || '').toLowerCase() === 'connected').length;
  const connRate = totalCalls > 0 ? Math.round((connected / totalCalls) * 100) : 0;

  const totalSecs = callLogs.reduce((s, c) => s + (parseInt(c.duration_seconds) || 0), 0);
  const totalDurationMins = Math.round(totalSecs / 60);
  const avgDurationMins = totalCalls > 0 ? (totalSecs / totalCalls / 60).toFixed(1) : 0;

  content.innerHTML = `
    <div class="reports-section">
      <!-- Comms KPIs -->
      <div class="reports-kpi-grid">
        <div class="reports-kpi-card">
          <div class="reports-kpi-top">
            <span class="reports-kpi-label">Total Calls Logged</span>
            <div class="reports-kpi-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            </div>
          </div>
          <div class="reports-kpi-value">${totalCalls}</div>
          <div class="reports-kpi-subtext">
            <span>${outbound} Outbound · ${inbound} Inbound</span>
          </div>
        </div>

        <div class="reports-kpi-card">
          <div class="reports-kpi-top">
            <span class="reports-kpi-label">Connection Rate</span>
            <div class="reports-kpi-icon" style="color: #10b981; background: rgba(16, 185, 129, 0.1);">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
          </div>
          <div class="reports-kpi-value">${connRate}%</div>
          <div class="reports-kpi-subtext positive">
            <span>${connected} answered/connected calls</span>
          </div>
        </div>

        <div class="reports-kpi-card">
          <div class="reports-kpi-top">
            <span class="reports-kpi-label">Total Talk Time</span>
            <div class="reports-kpi-icon" style="color: #f59e0b; background: rgba(245, 158, 11, 0.1);">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </div>
          </div>
          <div class="reports-kpi-value">${totalDurationMins}m</div>
          <div class="reports-kpi-subtext">
            <span>${avgDurationMins}m average call duration</span>
          </div>
        </div>

        <div class="reports-kpi-card">
          <div class="reports-kpi-top">
            <span class="reports-kpi-label">Outbound Focus</span>
            <div class="reports-kpi-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 10 5 5-5 5"/><path d="M4 4v7a4 4 0 0 0 4 4h12"/></svg>
            </div>
          </div>
          <div class="reports-kpi-value">${totalCalls ? Math.round((outbound / totalCalls) * 100) : 0}%</div>
          <div class="reports-kpi-subtext">
            <span>Proactive sales calls</span>
          </div>
        </div>
      </div>

      <!-- Comms Charts Grid -->
      <div class="reports-grid-2">
        <!-- Call Outcomes Breakdown -->
        <div class="reports-chart-card">
          <div class="reports-chart-card-header">
            <h3 class="reports-chart-title">Call Outcomes</h3>
            <span class="reports-chart-legend-badge">Conversion Distribution</span>
          </div>
          <div class="reports-chart-canvas-wrap">
            <canvas id="chart-comms-outcomes"></canvas>
          </div>
        </div>

        <!-- Calls by Sales Rep -->
        <div class="reports-chart-card">
          <div class="reports-chart-card-header">
            <h3 class="reports-chart-title">Calls by Team Member</h3>
            <span class="reports-chart-legend-badge">Outreach Volume</span>
          </div>
          <div class="reports-chart-canvas-wrap">
            <canvas id="chart-comms-reps"></canvas>
          </div>
        </div>
      </div>

      <!-- Call Logs Table -->
      <div class="reports-table-card">
        <div class="reports-table-header">
          <h3 class="reports-table-title">Recent Call Logs (${callLogs.length})</h3>
          <input type="text" id="comms-table-search" class="reports-table-search" placeholder="Search calls, reps, outcomes...">
        </div>
        <div class="reports-table-responsive">
          <table class="reports-table">
            <thead>
              <tr>
                <th>Rep / Caller</th>
                <th>Contact</th>
                <th>Company</th>
                <th>Direction</th>
                <th>Outcome</th>
                <th class="reports-table-num">Duration</th>
                <th>Notes / Summary</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody id="comms-table-tbody">
              ${renderCallLogsTableRows(callLogs, profiles, companies, people)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  // Search filter
  document.getElementById('comms-table-search')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    const filtered = callLogs.filter(c => {
      const rep = getProfileName(profiles, c.user_id).toLowerCase();
      const comp = (c.company_name || getCompanyName(companies, c.company_id)).toLowerCase();
      const contact = (c.contact_name || getPersonName(people, c.contact_id)).toLowerCase();
      return rep.includes(q) || comp.includes(q) || contact.includes(q) ||
        (c.outcome && c.outcome.toLowerCase().includes(q)) ||
        (c.direction && c.direction.toLowerCase().includes(q)) ||
        (c.notes && c.notes.toLowerCase().includes(q));
    });
    const tbody = document.getElementById('comms-table-tbody');
    if (tbody) tbody.innerHTML = renderCallLogsTableRows(filtered, profiles, companies, people);
  });

  // Chart: Call Outcomes
  const outcomesMap = {};
  callLogs.forEach(c => {
    const out = (c.outcome || 'Connected').replace(/_/g, ' ');
    outcomesMap[out] = (outcomesMap[out] || 0) + 1;
  });

  const colors = getChartColors();
  const outcomeLabels = Object.keys(outcomesMap);

  renderChart('chart-comms-outcomes', {
    type: 'doughnut',
    data: {
      labels: outcomeLabels.map(s => s.charAt(0).toUpperCase() + s.slice(1)),
      datasets: [{
        data: Object.values(outcomesMap),
        backgroundColor: colors.palette.slice(0, outcomeLabels.length),
        borderWidth: 1,
        borderColor: isDarkMode() ? '#1a1d24' : '#ffffff',
      }],
    },
    options: {
      plugins: { legend: { position: 'right' } },
    },
  });

  // Chart: Calls by Rep
  const repMap = {};
  callLogs.forEach(c => {
    const repName = getProfileName(profiles, c.user_id);
    repMap[repName] = (repMap[repName] || 0) + 1;
  });

  const repLabels = Object.keys(repMap).slice(0, 8);
  const repCounts = repLabels.map(k => repMap[k]);

  renderChart('chart-comms-reps', {
    type: 'bar',
    data: {
      labels: repLabels,
      datasets: [{
        label: 'Calls',
        data: repCounts,
        backgroundColor: colors.success,
        borderRadius: 4,
      }],
    },
    options: {
      plugins: { legend: { display: false } },
    },
  });
}

function renderCallLogsTableRows(callLogs, profiles, companies, people) {
  if (!callLogs.length) {
    return `<tr><td colspan="8" style="text-align: center; color: var(--text-muted);">No call logs recorded in this period</td></tr>`;
  }

  return callLogs.slice(0, 100).map(c => {
    const outcomeLower = (c.outcome || '').toLowerCase();
    let outcomeBadgeClass = 'reports-badge-neutral';
    if (outcomeLower === 'connected') outcomeBadgeClass = 'reports-badge-won';
    else if (outcomeLower === 'no_answer' || outcomeLower === 'no answer' || outcomeLower === 'busy') outcomeBadgeClass = 'reports-badge-lost';

    const durSecs = parseInt(c.duration_seconds) || 0;
    const durMins = Math.floor(durSecs / 60);
    const remSecs = durSecs % 60;
    const durStr = durMins > 0 ? `${durMins}m ${remSecs}s` : `${remSecs}s`;

    const contactName = c.contact_name || getPersonName(people, c.contact_id);
    const companyName = c.company_name || getCompanyName(companies, c.company_id);

    return `
      <tr>
        <td style="font-weight: 600;">${esc(getProfileName(profiles, c.user_id))}</td>
        <td>${esc(contactName)}</td>
        <td>${esc(companyName)}</td>
        <td><span class="reports-badge reports-badge-neutral">${esc(c.direction || 'Outbound')}</span></td>
        <td><span class="reports-badge ${outcomeBadgeClass}">${esc((c.outcome || 'Connected').replace(/_/g, ' '))}</span></td>
        <td class="reports-table-num">${durStr}</td>
        <td style="max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary);">
          ${esc(c.notes || '—')}
        </td>
        <td style="color: var(--text-muted); font-size: 12px;">${fmtDate(c.call_at || c.created_at)}</td>
      </tr>
    `;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 5: CUSTOM REPORT EXPLORER
// ═══════════════════════════════════════════════════════════════════════════════

function renderBuilderTab() {
  const content = document.getElementById('reports-tab-content');
  if (!content) return;

  const savedReports = getSavedReports();

  // Native custom dropdowns for Builder
  const datasetDd = window.buildCrmDropdown ? window.buildCrmDropdown({
    id: 'builder-dataset-select',
    variant: 'filter',
    value: _builderConfig.dataset,
    placeholder: 'Dataset',
    options: [
      { value: 'opportunities', label: 'Opportunities / Deals' },
      { value: 'visits', label: 'Field Visits' },
      { value: 'callLogs', label: 'Call Logs' },
      { value: 'tasks', label: 'Tasks' },
      { value: 'companies', label: 'Companies / Accounts' },
      { value: 'people', label: 'People / Contacts' },
    ]
  }) : '';

  const groupbyDd = window.buildCrmDropdown ? window.buildCrmDropdown({
    id: 'builder-groupby-select',
    variant: 'filter',
    value: _builderConfig.groupBy,
    placeholder: 'Group By',
    options: [
      { value: 'none', label: 'No Grouping (Raw Rows)' },
      { value: 'rep', label: 'Sales Rep / User' },
      { value: 'status', label: 'Stage / Status / Type' },
      { value: 'subsector', label: 'Subsector / Industry' },
      { value: 'month', label: 'Month Created' },
    ]
  }) : '';

  const metricDd = window.buildCrmDropdown ? window.buildCrmDropdown({
    id: 'builder-metric-select',
    variant: 'filter',
    value: _builderConfig.metric,
    placeholder: 'Metric',
    options: [
      { value: 'count', label: 'Count of Records' },
      { value: 'sum_value', label: 'Sum of Value ($)' },
      { value: 'avg_value', label: 'Average Value ($)' },
    ]
  }) : '';

  const vizDd = window.buildCrmDropdown ? window.buildCrmDropdown({
    id: 'builder-viz-select',
    variant: 'filter',
    value: _builderConfig.vizType,
    placeholder: 'Visualization',
    options: [
      { value: 'table', label: 'Data Table' },
      { value: 'bar', label: 'Bar Chart' },
      { value: 'doughnut', label: 'Doughnut Chart' },
    ]
  }) : '';

  content.innerHTML = `
    <div class="reports-section">
      <!-- Saved Presets Bar -->
      ${savedReports.length ? `
        <div class="reports-saved-reports-chips" id="reports-saved-chips">
          <span style="font-size: 12px; font-weight: 600; color: var(--text-muted); margin-right: 4px;">Saved Reports:</span>
          ${savedReports.map((r, i) => `
            <div class="reports-chip" data-report-index="${i}">
              <span>${esc(r.name)}</span>
              <button class="reports-chip-remove" data-delete-index="${i}" title="Delete report">×</button>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <!-- Query Builder Controls (All using native site design dropdowns) -->
      <div class="reports-builder-bar">
        <div class="reports-builder-field">
          <label class="reports-builder-label">Dataset</label>
          ${datasetDd}
        </div>

        <div class="reports-builder-field">
          <label class="reports-builder-label">Group By</label>
          ${groupbyDd}
        </div>

        <div class="reports-builder-field">
          <label class="reports-builder-label">Metric</label>
          ${metricDd}
        </div>

        <div class="reports-builder-field">
          <label class="reports-builder-label">Visualization</label>
          ${vizDd}
        </div>

        <div class="reports-builder-field" style="margin-left: auto; align-self: flex-end;">
          <button id="builder-save-btn" class="reports-btn reports-btn-secondary" title="Save this custom report preset">
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
            Save Preset
          </button>
        </div>
      </div>

      <!-- Live Builder Output Area -->
      <div id="builder-output-container">
        <!-- Injected dynamically -->
      </div>
    </div>
  `;

  // Init dropdowns inside builder
  if (window.initAllCrmDropdowns) {
    window.initAllCrmDropdowns(content);
  }

  // Attach Builder Event Handlers to hidden inputs
  document.getElementById('builder-dataset-select')?.addEventListener('change', (e) => {
    _builderConfig.dataset = e.target.value;
    renderBuilderOutput();
  });

  document.getElementById('builder-groupby-select')?.addEventListener('change', (e) => {
    _builderConfig.groupBy = e.target.value;
    renderBuilderOutput();
  });

  document.getElementById('builder-metric-select')?.addEventListener('change', (e) => {
    _builderConfig.metric = e.target.value;
    renderBuilderOutput();
  });

  document.getElementById('builder-viz-select')?.addEventListener('change', (e) => {
    _builderConfig.vizType = e.target.value;
    renderBuilderOutput();
  });

  document.getElementById('builder-save-btn')?.addEventListener('click', () => {
    saveCurrentBuilderReport();
  });

  document.getElementById('reports-saved-chips')?.addEventListener('click', (e) => {
    const delBtn = e.target.closest('.reports-chip-remove');
    if (delBtn) {
      e.stopPropagation();
      const idx = parseInt(delBtn.getAttribute('data-delete-index'));
      deleteSavedReport(idx);
      return;
    }

    const chip = e.target.closest('.reports-chip');
    if (chip) {
      const idx = parseInt(chip.getAttribute('data-report-index'));
      loadSavedReportPreset(idx);
    }
  });

  renderBuilderOutput();
}

function renderBuilderOutput() {
  destroyAllCharts();
  const outputContainer = document.getElementById('builder-output-container');
  if (!outputContainer) return;

  const data = getFilteredData();
  const rows = data[_builderConfig.dataset] || [];
  const profiles = data.profiles || [];
  const companies = data.companies || [];
  const people = data.people || [];

  if (!rows.length) {
    outputContainer.innerHTML = `
      <div class="reports-empty-state">
        <h4 class="reports-empty-title">No Records Found</h4>
        <p class="reports-empty-desc">There are no records in the "${_builderConfig.dataset}" dataset matching your current filters.</p>
      </div>
    `;
    return;
  }

  // If Grouped:
  if (_builderConfig.groupBy !== 'none') {
    renderGroupedBuilderOutput(outputContainer, rows, profiles);
  } else {
    // Raw Table Output
    renderRawBuilderOutput(outputContainer, rows, profiles, companies, people);
  }
}

function renderGroupedBuilderOutput(container, rows, profiles) {
  const groups = {};
  const isDateInterval = _builderConfig.groupBy === 'month';

  rows.forEach(r => {
    let key = 'Other';
    if (_builderConfig.groupBy === 'rep') {
      const uid = r.user_id || r.assigned_to;
      key = getProfileName(profiles, uid);
    } else if (_builderConfig.groupBy === 'status') {
      if (_builderConfig.dataset === 'opportunities') {
        const sKey = normalizeStage(r.stage);
        key = STAGE_CONFIG[sKey]?.label || 'Lead';
      } else {
        key = r.status || r.visit_type || r.outcome || r.company_type || 'Unknown';
      }
    } else if (_builderConfig.groupBy === 'subsector') {
      key = r.subsector || 'Unclassified';
    } else if (_builderConfig.groupBy === 'month') {
      const dateVal = r.created_at || r.call_at;
      if (dateVal) {
        const d = new Date(dateVal);
        key = !isNaN(d.getTime()) ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : 'Unknown';
      }
    }

    if (!groups[key]) groups[key] = { key, count: 0, sumVal: 0 };
    groups[key].count += 1;
    groups[key].sumVal += (parseFloat(r.value) || 0);
  });

  const groupList = Object.values(groups);
  if (isDateInterval) {
    groupList.sort((a, b) => a.key.localeCompare(b.key));
  } else {
    groupList.sort((a, b) => b.count - a.count);
  }

  const chartLabels = groupList.map(g => g.key);
  const chartData = groupList.map(g => {
    if (_builderConfig.metric === 'sum_value') return Math.round(g.sumVal);
    if (_builderConfig.metric === 'avg_value') return g.count ? Math.round(g.sumVal / g.count) : 0;
    return g.count;
  });

  const metricTitle = _builderConfig.metric === 'sum_value' ? 'Sum of Value ($)'
    : _builderConfig.metric === 'avg_value' ? 'Average Value ($)'
      : 'Count';

  let vizHtml = '';
  if (_builderConfig.vizType !== 'table') {
    vizHtml = `
      <div class="reports-chart-card" style="margin-bottom: var(--space-4);">
        <div class="reports-chart-card-header">
          <h3 class="reports-chart-title">Grouped Visualization (${metricTitle})</h3>
        </div>
        <div class="reports-chart-canvas-wrap">
          <canvas id="chart-builder-grouped"></canvas>
        </div>
      </div>
    `;
  }

  container.innerHTML = `
    ${vizHtml}
    <div class="reports-table-card">
      <div class="reports-table-header">
        <h3 class="reports-table-title">Grouped Summary (${groupList.length} groups)</h3>
      </div>
      <div class="reports-table-responsive">
        <table class="reports-table">
          <thead>
            <tr>
              <th>Group (${_builderConfig.groupBy})</th>
              <th class="reports-table-num">Record Count</th>
              <th class="reports-table-num">Total Value</th>
              <th class="reports-table-num">Average Value</th>
            </tr>
          </thead>
          <tbody>
            ${groupList.map(g => `
              <tr>
                <td style="font-weight: 600;">${esc(g.key)}</td>
                <td class="reports-table-num">${g.count}</td>
                <td class="reports-table-num" style="font-weight: 600;">${fmtMoney(g.sumVal)}</td>
                <td class="reports-table-num">${g.count ? fmtMoney(g.sumVal / g.count) : '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  if (_builderConfig.vizType !== 'table') {
    const colors = getChartColors();
    renderChart('chart-builder-grouped', {
      type: _builderConfig.vizType,
      data: {
        labels: chartLabels,
        datasets: [{
          label: metricTitle,
          data: chartData,
          backgroundColor: _builderConfig.vizType === 'doughnut' ? colors.palette.slice(0, chartLabels.length) : colors.primary,
          borderRadius: 4,
        }],
      },
      options: {
        plugins: {
          legend: { display: _builderConfig.vizType === 'doughnut' },
        },
      },
    });
  }
}

function renderRawBuilderOutput(container, rows, profiles, companies, people) {
  let columns = [];
  const dataset = _builderConfig.dataset;

  if (dataset === 'opportunities') {
    columns = [
      { key: 'name', label: 'Opportunity Name' },
      { key: 'company_name', label: 'Company' },
      { key: 'stage', label: 'Stage', fmt: st => STAGE_CONFIG[normalizeStage(st)]?.label || 'Lead' },
      { key: 'value', label: 'Value', fmt: val => fmtMoney(val), num: true },
      { key: 'user_id', label: 'Owner', fmt: uid => getProfileName(profiles, uid) },
      { key: 'created_at', label: 'Created', fmt: d => fmtDate(d) },
    ];
  } else if (dataset === 'visits') {
    columns = [
      { key: 'company_name', label: 'Company' },
      { key: 'contact_name', label: 'Contact' },
      { key: 'visit_type', label: 'Type' },
      { key: 'lead_score', label: 'Score', num: true },
      { key: 'user_id', label: 'Rep', fmt: uid => getProfileName(profiles, uid) },
      { key: 'created_at', label: 'Date', fmt: d => fmtDate(d) },
    ];
  } else if (dataset === 'callLogs') {
    columns = [
      { key: 'user_id', label: 'Rep', fmt: uid => getProfileName(profiles, uid) },
      { key: 'contact_name', label: 'Contact', fmt: (cname, r) => cname || getPersonName(people, r.contact_id) },
      { key: 'company_name', label: 'Company', fmt: (cname, r) => cname || getCompanyName(companies, r.company_id) },
      { key: 'direction', label: 'Direction' },
      { key: 'outcome', label: 'Outcome' },
      { key: 'duration_seconds', label: 'Duration (s)', num: true },
      { key: 'created_at', label: 'Date', fmt: (d, r) => fmtDate(r.call_at || d) },
    ];
  } else if (dataset === 'tasks') {
    columns = [
      { key: 'title', label: 'Task Title' },
      { key: 'status', label: 'Status' },
      { key: 'priority', label: 'Priority' },
      { key: 'assigned_to', label: 'Assignee', fmt: uid => getProfileName(profiles, uid) },
      { key: 'due_date', label: 'Due Date', fmt: d => fmtDate(d) },
    ];
  } else if (dataset === 'companies') {
    columns = [
      { key: 'name', label: 'Company Name' },
      { key: 'company_type', label: 'Type' },
      { key: 'subsector', label: 'Subsector' },
      { key: 'address', label: 'Address' },
      { key: 'created_at', label: 'Created', fmt: d => fmtDate(d) },
    ];
  } else {
    columns = [
      { key: 'name', label: 'Contact Name' },
      { key: 'email', label: 'Email' },
      { key: 'company_id', label: 'Company', fmt: cid => getCompanyName(companies, cid) },
      { key: 'created_at', label: 'Created', fmt: d => fmtDate(d) },
    ];
  }

  container.innerHTML = `
    <div class="reports-table-card">
      <div class="reports-table-header">
        <h3 class="reports-table-title">Raw Records (${rows.length} rows)</h3>
        <span class="reports-section-desc">Showing first 100 rows</span>
      </div>
      <div class="reports-table-responsive">
        <table class="reports-table">
          <thead>
            <tr>
              ${columns.map(c => `<th class="${c.num ? 'reports-table-num' : ''}">${c.label}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${rows.slice(0, 100).map(r => `
              <tr>
                ${columns.map(c => {
                  let val = r[c.key];
                  if (c.fmt) val = c.fmt(val, r);
                  return `<td class="${c.num ? 'reports-table-num' : ''}">${esc(val)}</td>`;
                }).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ── Saved Custom Report Presets (localStorage) ───────────────────────────────

function getSavedReports() {
  try {
    return JSON.parse(localStorage.getItem(SAVED_REPORTS_STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveCurrentBuilderReport() {
  document.getElementById('reports-save-modal')?.remove();

  const defaultName = `${_builderConfig.dataset} - ${_builderConfig.groupBy}`;

  const modalHtml = `
    <div class="modal" id="reports-save-modal" style="display:flex; z-index:9999;" role="dialog" aria-modal="true" aria-labelledby="reports-save-modal-title">
      <div class="modal-backdrop" id="reports-save-backdrop"></div>
      <div class="modal-container modal-size-sm" style="max-width: 440px; margin: auto;">
        <div class="modal-header">
          <h3 id="reports-save-modal-title" style="margin: 0; font-size: 0.9375rem; font-weight: 600;">Save Custom Report Preset</h3>
          <button class="modal-close" id="reports-save-close" type="button" aria-label="Close" style="background: none; border: none; cursor: pointer; padding: 4px; display: flex; align-items: center; justify-content: center; color: var(--text-muted, #868e96); border-radius: 4px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
        <form id="reports-save-form" style="margin: 0;">
          <div class="modal-body" style="padding: 18px 20px;">
            <div class="form-field" style="display: flex; flex-direction: column; gap: 6px; margin: 0;">
              <label for="reports-save-name-input" style="font-weight: 600; font-size: 0.8125rem; color: var(--text-primary, #1a1d21);">
                Preset Name <span class="required-indicator" style="color: var(--color-danger, #ef4444); font-weight: 500;">*</span>
              </label>
              <input type="text" id="reports-save-name-input" class="reports-select" style="width: 100%; height: 38px; cursor: text; padding: 0 12px; font-size: 0.875rem; box-sizing: border-box;" value="${esc(defaultName)}" placeholder="e.g. Opportunities by Stage" required autocomplete="off" />
              <p style="margin: 6px 0 0; font-size: 0.75rem; color: var(--text-muted, #868e96); line-height: 1.4;">
                Save your dataset selection, metric, grouping, and visualization settings to quickly load anytime.
              </p>
            </div>
          </div>
          <div class="modal-footer" style="padding: 12px 20px; display: flex; justify-content: flex-end; gap: 8px; border-top: 1px solid var(--border-color, rgba(0,0,0,0.08)); background: var(--bg-secondary, #ffffff);">
            <button type="button" class="btn btn-secondary" id="reports-save-cancel" style="height: 36px; padding: 0 14px; font-size: 0.8125rem; font-weight: 500; border-radius: var(--btn-radius, 6px); cursor: pointer;">Cancel</button>
            <button type="submit" class="btn btn-primary" id="reports-save-submit" style="height: 36px; padding: 0 16px; font-size: 0.8125rem; font-weight: 600; border-radius: var(--btn-radius, 6px); cursor: pointer; background: var(--color-primary, #2f5fd0); color: #fff; border: none;">Save Preset</button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);

  const modalEl = document.getElementById('reports-save-modal');
  const inputEl = document.getElementById('reports-save-name-input');
  const formEl = document.getElementById('reports-save-form');
  const closeBtn = document.getElementById('reports-save-close');
  const cancelBtn = document.getElementById('reports-save-cancel');
  const backdrop = document.getElementById('reports-save-backdrop');

  const closeDialog = () => {
    document.removeEventListener('keydown', handleKeydown);
    modalEl?.remove();
  };

  const handleKeydown = (e) => {
    if (e.key === 'Escape') {
      closeDialog();
    }
  };

  document.addEventListener('keydown', handleKeydown);
  closeBtn?.addEventListener('click', closeDialog);
  cancelBtn?.addEventListener('click', closeDialog);
  backdrop?.addEventListener('click', closeDialog);

  formEl?.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = inputEl?.value?.trim();
    if (!name) {
      inputEl?.focus();
      return;
    }

    const currentSaved = getSavedReports();
    currentSaved.push({
      name,
      config: { ..._builderConfig },
      savedAt: new Date().toISOString(),
    });

    try {
      localStorage.setItem(SAVED_REPORTS_STORAGE_KEY, JSON.stringify(currentSaved));
      closeDialog();
      showToast(`Saved report "${name}"`, 'success');
      renderBuilderTab();
    } catch (err) {
      showToast('Failed to save preset: ' + err.message, 'error');
    }
  });

  setTimeout(() => {
    if (inputEl) {
      inputEl.focus();
      inputEl.select();
    }
  }, 50);
}

async function deleteSavedReport(index) {
  const currentSaved = getSavedReports();
  if (index >= 0 && index < currentSaved.length) {
    const reportName = currentSaved[index]?.name || 'preset';
    if (window.showConfirmDialog) {
      const ok = await window.showConfirmDialog('Delete Preset', `Are you sure you want to delete preset "${reportName}"?`);
      if (!ok) return;
    }
    currentSaved.splice(index, 1);
    localStorage.setItem(SAVED_REPORTS_STORAGE_KEY, JSON.stringify(currentSaved));
    showToast('Report preset removed', 'info');
    renderBuilderTab();
  }
}

function loadSavedReportPreset(index) {
  const currentSaved = getSavedReports();
  const preset = currentSaved[index];
  if (!preset || !preset.config) return;

  _builderConfig = { ...preset.config };
  showToast(`Loaded preset "${preset.name}"`, 'success');
  renderBuilderTab();
}

// ── Tab CSV Export Handler ───────────────────────────────────────────────────

function triggerCurrentTabExport() {
  const data = getFilteredData();
  const { opportunities, visits, callLogs, tasks, companies, people, profiles } = data;

  if (_activeTab === 'executive' || _activeTab === 'sales') {
    exportTableToCsv('opportunities_report', [
      { key: 'name', label: 'Opportunity Name' },
      { key: 'company_name', label: 'Company Name' },
      { key: 'next_step', label: 'Next Step', get: r => r.next_step || 'None' },
      { key: 'stage', label: 'Stage', get: r => STAGE_CONFIG[normalizeStage(r.stage)]?.label || 'Lead' },
      { key: 'value', label: 'Value ($)' },
      { key: 'probability', label: 'Probability (%)' },
      { key: 'user_id', label: 'Owner', get: r => getProfileName(profiles, r.user_id) },
      { key: 'created_at', label: 'Created At' },
    ], opportunities);
  } else if (_activeTab === 'field') {
    exportTableToCsv('field_visits_report', [
      { key: 'company_name', label: 'Company Name' },
      { key: 'contact_name', label: 'Contact Name' },
      { key: 'visit_type', label: 'Visit Type' },
      { key: 'lead_score', label: 'Lead Score' },
      { key: 'travel_time', label: 'Travel Time (mins)' },
      { key: 'fare_amount', label: 'Fare Amount' },
      { key: 'user_id', label: 'Agent', get: r => getProfileName(profiles, r.user_id) },
      { key: 'location_name', label: 'Location' },
      { key: 'created_at', label: 'Date' },
    ], visits);
  } else if (_activeTab === 'comms') {
    exportTableToCsv('call_logs_report', [
      { key: 'user_id', label: 'Caller', get: r => getProfileName(profiles, r.user_id) },
      { key: 'contact_name', label: 'Contact', get: r => r.contact_name || getPersonName(people, r.contact_id) },
      { key: 'company_name', label: 'Company', get: r => r.company_name || getCompanyName(companies, r.company_id) },
      { key: 'direction', label: 'Direction' },
      { key: 'outcome', label: 'Outcome' },
      { key: 'duration_seconds', label: 'Duration (sec)' },
      { key: 'notes', label: 'Notes' },
      { key: 'created_at', label: 'Date', get: r => r.call_at || r.created_at },
    ], callLogs);
  } else if (_activeTab === 'builder') {
    const activeRows = data[_builderConfig.dataset] || [];
    exportTableToCsv(`${_builderConfig.dataset}_custom_report`, [
      { key: 'id', label: 'ID' },
      { key: 'name', label: 'Name', get: r => r.name || r.title || r.company_name || 'Record' },
      { key: 'created_at', label: 'Created' },
    ], activeRows);
  }
}

// ── Global Public Helpers ────────────────────────────────────────────────────

export function openReportBuilder() {
  _activeTab = 'builder';
  renderReportsView();
}

export function refreshAllWidgets() {
  return refreshReportsData();
}
