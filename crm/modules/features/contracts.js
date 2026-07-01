// modules/features/contracts.js
// Service Contracts — full feature module.
//   Manager  : add / edit / archive contracts, full calendar & list view.
//   Technician: read-only calendar + list; "Start Service" launches the
//               matching form (UPS or Solar) with company / location pre-filled.
import { state, supabaseClient } from '../state.js';
import { viewContainer } from '../ui/dom.js';
import { showToast, escapeHtml } from '../ui/toast.js';
import { renderSkeletonCards, renderError } from '../utils/helpers.js';

// ════════════════════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════════════════════
const CONTRACT_TYPES = {
  ups_service:   { label: 'UPS Service',   color: '#4f46e5', bg: '#e0e7ff' },
  solar_service: { label: 'Solar Service', color: '#d97706', bg: '#fef3c7' },
  custom:        { label: 'Custom',        color: '#059669', bg: '#d1fae5' },
};

const RECURRENCE_LABELS = {
  once:         'One-time',
  weekly:       'Weekly',
  bi_weekly:    'Every 2 Weeks',
  monthly:      'Monthly',
  quarterly:    'Every 3 Months',
  semi_annual:  'Every 6 Months',
  yearly:       'Yearly',
  custom_weeks: 'Custom (weeks)',
};

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];

// ════════════════════════════════════════════════════════════════
// RECURRENCE HELPERS
// ════════════════════════════════════════════════════════════════

/** Advance a date by one recurrence interval. */
function advanceDate(d, recurrenceType, interval = 1) {
  const r = new Date(d);
  switch (recurrenceType) {
    case 'weekly':      r.setDate(r.getDate() + 7); break;
    case 'bi_weekly':   r.setDate(r.getDate() + 14); break;
    case 'monthly':     r.setMonth(r.getMonth() + 1); break;
    case 'quarterly':   r.setMonth(r.getMonth() + 3); break;
    case 'semi_annual': r.setMonth(r.getMonth() + 6); break;
    case 'yearly':      r.setFullYear(r.getFullYear() + 1); break;
    case 'custom_weeks': r.setDate(r.getDate() + (interval || 1) * 7); break;
    default: break;
  }
  return r;
}

/**
 * Get the next N occurrences of a contract on or after `fromDate`.
 * For 'once' contracts the single date is returned (if it's >= fromDate).
 */
function getNextOccurrences(contract, count = 24, fromDate = new Date()) {
  const start = new Date(contract.start_date + 'T00:00:00');
  const from  = new Date(fromDate);
  from.setHours(0, 0, 0, 0);

  if (!contract.recurrence_type || contract.recurrence_type === 'once') {
    return start >= from ? [start] : [];
  }

  // Walk forward from start until we reach fromDate
  let cur = new Date(start);
  while (cur < from) {
    const next = advanceDate(cur, contract.recurrence_type, contract.recurrence_interval);
    if (next >= from) { cur = next; break; }
    cur = next;
  }

  const results = [];
  for (let i = 0; i < count; i++) {
    results.push(new Date(cur));
    cur = advanceDate(cur, contract.recurrence_type, contract.recurrence_interval);
  }
  return results;
}

/**
 * Build a map of { 'YYYY-MM-DD': [contract, ...] } for a given calendar month.
 * Looks 50 occurrences forward from the month start.
 */
function getOccurrencesForMonth(contracts, year, month) {
  const monthStart = new Date(year, month, 1);
  const monthEnd   = new Date(year, month + 1, 0);
  monthEnd.setHours(23, 59, 59, 999);
  const map = {};

  for (const c of contracts) {
    if (c.status === 'archived') continue;
    const occs = getNextOccurrences(c, 60, monthStart);
    for (const d of occs) {
      if (d > monthEnd) break;
      const key = toDateKey(d);
      if (!map[key]) map[key] = [];
      map[key].push(c);
    }
  }
  return map;
}

function toDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtDate(d) {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d + 'T00:00:00');
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function getCompanyName(c) {
  return c.company?.name || c.company_name || c.custom_company_name || 'Unknown Company';
}

function getTypeLabel(c) {
  if (c.contract_type === 'custom') return c.custom_type_name || 'Custom Service';
  return CONTRACT_TYPES[c.contract_type]?.label || c.contract_type;
}

function getTypeInfo(c) {
  return CONTRACT_TYPES[c.contract_type] || { color: '#6b7280', bg: '#f3f4f6' };
}

function daysUntil(date) {
  if (!date) return null;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const d   = new Date(date); d.setHours(0, 0, 0, 0);
  return Math.ceil((d - now) / 86400000);
}

// ════════════════════════════════════════════════════════════════
// MAIN VIEW
// ════════════════════════════════════════════════════════════════

async function renderContractsView() {
  viewContainer.innerHTML = renderSkeletonCards(3);

  let query = supabaseClient
    .from('service_contracts')
    .select('*, company:companies(id, name)')
    .order('start_date', { ascending: true });

  if (state.currentOrganization?.id) {
    query = query.eq('organization_id', state.currentOrganization.id);
  }

  const { data: raw, error } = await query;
  if (error) { viewContainer.innerHTML = renderError(error.message); return; }

  // Normalise: carry company name from join
  const contracts = (raw || []).map(c => ({
    ...c,
    company_name: c.company?.name || c.custom_company_name || null,
  }));

  const active = contracts.filter(c => c.status !== 'archived');

  // "Due within reminder window" contracts
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const upcoming = [];
  for (const c of active) {
    const occs = getNextOccurrences(c, 1, now);
    if (occs.length) upcoming.push({ contract: c, nextDate: occs[0] });
  }
  upcoming.sort((a, b) => a.nextDate - b.nextDate);
  const due30 = upcoming.filter(x => {
    const diff = daysUntil(x.nextDate);
    return diff !== null && diff <= 30;
  });

  // ── Render shell ──────────────────────────────────────────────
  viewContainer.innerHTML = `
    <div class="contracts-page">
      <!-- Header -->
      <!-- Stats + Add button row -->
      <div class="contracts-top-bar">
        <button class="btn btn-primary" id="contract-add-btn">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12h14"/><path d="M12 5v14"/>
          </svg>
          Add Contract
        </button>
      </div>

      <div class="contracts-stats-row">
        <div class="contracts-stat-card">
          <div class="contracts-stat-value">${active.length}</div>
          <div class="contracts-stat-label">Active Contracts</div>
        </div>
        <div class="contracts-stat-card contracts-stat-card--alert">
          <div class="contracts-stat-value">${due30.length}</div>
          <div class="contracts-stat-label">Due This Month</div>
        </div>
        <div class="contracts-stat-card">
          <div class="contracts-stat-value">${active.filter(c => c.contract_type === 'ups_service').length}</div>
          <div class="contracts-stat-label">UPS Contracts</div>
        </div>
        <div class="contracts-stat-card">
          <div class="contracts-stat-value">${active.filter(c => c.contract_type === 'solar_service').length}</div>
          <div class="contracts-stat-label">Solar Contracts</div>
        </div>
      </div>

      <!-- Calendar -->
      <div class="contracts-calendar-section">
        <div class="contracts-cal-header">
          <button class="contracts-cal-nav-btn" id="cal-prev" aria-label="Previous month">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
          </button>
          <h3 class="contracts-cal-title" id="cal-month-label"></h3>
          <button class="contracts-cal-nav-btn" id="cal-next" aria-label="Next month">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </button>
        </div>
        <div id="contracts-cal-grid"></div>
        <div class="contracts-cal-detail" id="contracts-cal-detail" style="display:none;"></div>
      </div>

      <!-- Due / Upcoming alerts -->
      ${due30.length > 0 ? `
        <div class="contracts-section">
          <h3 class="contracts-section-title">
            <span class="contracts-alert-dot"></span>
            Due Within 30 Days
          </h3>
          <div class="contracts-upcoming-list" id="contracts-upcoming-list">
            ${due30.map(({ contract: c, nextDate }) => renderCompactCard(c, nextDate)).join('')}
          </div>
        </div>
      ` : ''}

      <!-- All Contracts List -->
      <div class="contracts-section">
        <div class="contracts-list-header">
          <h3 class="contracts-section-title" style="margin:0;">All Contracts</h3>
          <div class="contracts-list-filters">
            <input type="text" id="contracts-search" class="ups-input contracts-filter-input"
              placeholder="Search…" autocomplete="off">
            ${window.buildCrmDropdown ? window.buildCrmDropdown({
              id: 'contracts-filter-type',
              placeholder: 'All Types',
              options: [
                { value: '', label: 'All Types' },
                { value: 'ups_service', label: 'UPS Service' },
                { value: 'solar_service', label: 'Solar Service' },
                { value: 'custom', label: 'Custom' },
              ],
              value: '',
              variant: 'filter',
              className: 'contracts-filter-dd',
            }) : '<select id="contracts-filter-type" class="ups-input contracts-filter-input"><option value="">All Types</option><option value="ups_service">UPS Service</option><option value="solar_service">Solar Service</option><option value="custom">Custom</option></select>'}
            ${window.buildCrmDropdown ? window.buildCrmDropdown({
              id: 'contracts-filter-status',
              placeholder: 'Status',
              options: [
                { value: 'active', label: 'Active' },
                { value: 'all', label: 'All' },
                { value: 'paused', label: 'Paused' },
                { value: 'archived', label: 'Archived' },
              ],
              value: 'active',
              variant: 'filter',
              className: 'contracts-filter-dd',
            }) : '<select id="contracts-filter-status" class="ups-input contracts-filter-input"><option value="active">Active</option><option value="all">All</option><option value="paused">Paused</option><option value="archived">Archived</option></select>'}
          </div>
        </div>
        <div id="contracts-list-container"></div>
      </div>
    </div>
  `;

  // ── Calendar state ─────────────────────────────────────────────
  let calYear  = now.getFullYear();
  let calMonth = now.getMonth();

  function renderCal() {
    renderCalendarGrid(active, calYear, calMonth);
  }

  renderCal();

  document.getElementById('cal-prev').addEventListener('click', () => {
    calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
    renderCal();
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
    renderCal();
  });

  // ── Contract list ───────────────────────────────────────────────
  const searchEl  = document.getElementById('contracts-search');
  const typeEl    = document.getElementById('contracts-filter-type');
  const statusEl  = document.getElementById('contracts-filter-status');

  function applyFilters() {
    const q      = (searchEl.value || '').trim().toLowerCase();
    const type   = typeEl.value;
    const status = statusEl.value;

    const filtered = contracts.filter(c => {
      const name   = getCompanyName(c).toLowerCase();
      const label  = getTypeLabel(c).toLowerCase();
      const subdiv = (c.subdivision || '').toLowerCase();
      const loc    = (c.location || '').toLowerCase();

      const matchQ = !q || name.includes(q) || label.includes(q) || subdiv.includes(q) || loc.includes(q);
      const matchT = !type || c.contract_type === type;
      let matchS = true;
      if (status === 'active')   matchS = c.status === 'active';
      else if (status === 'paused') matchS = c.status === 'paused';
      else if (status === 'archived') matchS = c.status === 'archived';
      // 'all' shows everything

      return matchQ && matchT && matchS;
    });
    renderContractsList(filtered);
  }

  searchEl.addEventListener('input', applyFilters);
  typeEl.addEventListener('change', applyFilters);
  statusEl.addEventListener('change', applyFilters);

  // Initial render with default filter (Active)
  applyFilters();

  // ── Add button ────────────────────────────────────────────────
  document.getElementById('contract-add-btn').addEventListener('click', () => {
    openContractModal(null, contracts);
  });

  // ── Global handlers (inline onclick refs) ─────────────────────
  window._editContract     = (id) => { const c = contracts.find(x => x.id === id); if (c) openContractModal(c, contracts); };
  window._archiveContract  = (id, curStatus) => archiveContract(id, curStatus);
  window._startContractService = (id) => {
    const c = contracts.find(x => x.id === id);
    if (c) startServiceFromContract(c);
    else showToast('Contract not found', 'error');
  };

  if (window.lucide) lucide.createIcons();
}

// ════════════════════════════════════════════════════════════════
// CALENDAR
// ════════════════════════════════════════════════════════════════

function renderCalendarGrid(contracts, year, month) {
  const titleEl = document.getElementById('cal-month-label');
  const gridEl  = document.getElementById('contracts-cal-grid');
  if (!titleEl || !gridEl) return;

  titleEl.textContent = `${MONTH_NAMES[month]} ${year}`;

  const occMap   = getOccurrencesForMonth(contracts, year, month);
  const firstDay = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();

  const today    = new Date();
  const todayKey = toDateKey(today);

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  let html = `
    <div class="contracts-cal-weekdays">
      ${DAY_NAMES.map(d => `<div class="contracts-cal-weekday">${d}</div>`).join('')}
    </div>
    <div class="contracts-cal-cells">
  `;

  for (let i = 0; i < firstDay; i++) {
    html += `<div class="contracts-cal-cell contracts-cal-cell--empty"></div>`;
  }

  for (let day = 1; day <= totalDays; day++) {
    const key  = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const evts = occMap[key] || [];
    const isToday = key === todayKey;
    const hasEvts = evts.length > 0;

    const eventChips = evts.slice(0, 2).map(c => {
      const ti   = getTypeInfo(c);
      const name = getCompanyName(c);
      // Truncate long names so chips stay compact
      const label = name.length > 12 ? name.slice(0, 11) + '…' : name;
      return `<div class="contracts-cal-chip" style="background:${ti.bg};color:${ti.color};">${escapeHtml(label)}</div>`;
    }).join('');
    const overflow = evts.length > 2
      ? `<div class="contracts-cal-chip-more">+${evts.length - 2} more</div>`
      : '';

    html += `
      <div class="contracts-cal-cell${isToday ? ' contracts-cal-cell--today' : ''}${hasEvts ? ' contracts-cal-cell--has-events' : ''}"
           data-date="${key}"
           ${hasEvts ? `role="button" tabindex="0" aria-label="${day}, ${evts.length} contract(s)"` : ''}>
        <span class="contracts-cal-day-num">${day}</span>
        ${hasEvts ? `<div class="contracts-cal-chips">${eventChips}${overflow}</div>` : ''}
      </div>
    `;
  }

  html += `</div>`;
  gridEl.innerHTML = html;

  // Click / keyboard handlers for days with events
  gridEl.querySelectorAll('.contracts-cal-cell--has-events').forEach(cell => {
    const show = () => {
      gridEl.querySelectorAll('.contracts-cal-cell--selected')
        .forEach(c => c.classList.remove('contracts-cal-cell--selected'));
      cell.classList.add('contracts-cal-cell--selected');
      showDayDetail(cell.dataset.date, occMap[cell.dataset.date] || []);
    };
    cell.addEventListener('click', show);
    cell.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(); }
    });
  });
}

function showDayDetail(dateKey, contracts) {
  const el = document.getElementById('contracts-cal-detail');
  if (!el) return;

  const d = new Date(dateKey + 'T00:00:00');
  const formatted = d.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  el.style.display = 'block';
  el.innerHTML = `
    <div class="contracts-cal-detail-header">
      <strong class="contracts-cal-detail-date">${formatted}</strong>
      <button class="contracts-cal-detail-close" id="cal-detail-close" aria-label="Close">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
        </svg>
      </button>
    </div>
    <div class="contracts-cal-detail-list">
      ${contracts.map(c => {
        const ti = getTypeInfo(c);
        return `
          <div class="contracts-cal-detail-item">
            <div class="contracts-cal-detail-item-info">
              <span class="contracts-type-pill" style="background:${ti.bg}; color:${ti.color};">${escapeHtml(getTypeLabel(c))}</span>
              <strong>${escapeHtml(getCompanyName(c))}</strong>
              ${c.subdivision ? `<span class="contracts-cal-detail-sub"> · ${escapeHtml(c.subdivision)}</span>` : ''}
              ${c.location ? `<div class="contracts-cal-detail-loc">📍 ${escapeHtml(c.location)}</div>` : ''}
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              ${state.isTechnician ? `
                <button class="btn btn-primary btn-sm contracts-start-btn"
                        data-contract-id="${c.id}" data-due-date="${dateKey}">
                  Start Service
                </button>
              ` : ''}
              <button class="btn btn-secondary btn-sm" onclick="window._editContract('${c.id}')">Edit</button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  el.querySelectorAll('.contracts-start-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cid = btn.dataset.contractId;
      const c   = contracts.find(x => x.id === cid);
      if (c) startServiceFromContract(c, btn.dataset.dueDate);
    });
  });

  document.getElementById('cal-detail-close').addEventListener('click', () => {
    el.style.display = 'none';
    document.querySelectorAll('.contracts-cal-cell--selected')
      .forEach(c => c.classList.remove('contracts-cal-cell--selected'));
  });
}

// ════════════════════════════════════════════════════════════════
// CONTRACT CARDS
// ════════════════════════════════════════════════════════════════

function renderCompactCard(c, nextDate) {
  const ti     = getTypeInfo(c);
  const diff   = daysUntil(nextDate);
  const over   = diff !== null && diff < 0;
  const today  = diff === 0;

  const dueTxt = over  ? `<span style="color:#ef4444; font-weight:600;">Overdue — </span>` :
                 today ? `<span style="color:#f59e0b; font-weight:600;">Due today</span>` :
                         `<span style="color:var(--text-muted);">Due in ${diff} day${diff !== 1 ? 's' : ''} — </span>`;

  return `
    <div class="contracts-compact-card${over ? ' contracts-compact-card--overdue' : today ? ' contracts-compact-card--today' : ''}">
      <div class="contracts-compact-left">
        <span class="contracts-type-pill" style="background:${ti.bg}; color:${ti.color};">${escapeHtml(getTypeLabel(c))}</span>
        <div class="contracts-compact-company">${escapeHtml(getCompanyName(c))}</div>
        ${c.subdivision ? `<div class="contracts-compact-sub">${escapeHtml(c.subdivision)}</div>` : ''}
        <div class="contracts-compact-date">${dueTxt}${today ? '' : fmtDate(nextDate)}</div>
      </div>
      <div class="contracts-compact-right">
        ${state.isTechnician ? `
          <button class="btn btn-primary btn-sm" onclick="window._startContractService('${c.id}')">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            Start Service
          </button>
        ` : ''}
        <button class="btn btn-secondary btn-sm" onclick="window._editContract('${c.id}')">Edit</button>
      </div>
    </div>
  `;
}

function renderContractsList(contracts) {
  const container = document.getElementById('contracts-list-container');
  if (!container) return;

  if (!contracts || contracts.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding:48px 16px;">
        <div class="empty-state-icon" style="margin-bottom:16px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"
            style="opacity:0.3;">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
        </div>
        <h3 class="empty-state-title">No contracts found</h3>
        <p class="empty-state-description">Add your first service contract to get started.</p>
        <button class="btn btn-primary" onclick="window._openAddContract()">Add Contract</button>
      </div>
    `;
    return;
  }

  const now = new Date(); now.setHours(0, 0, 0, 0);

  container.innerHTML = `
    <div class="contracts-full-list">
      ${contracts.map(c => {
        const ti      = getTypeInfo(c);
        const nextOcc = getNextOccurrences(c, 1, now)[0];
        const diff    = nextOcc ? daysUntil(nextOcc) : null;
        const over    = diff !== null && diff < 0 && c.status === 'active';
        const today   = diff === 0 && c.status === 'active';
        const isActive = c.status === 'active';

        return `
          <div class="contracts-list-card${over ? ' contracts-list-card--overdue' : today ? ' contracts-list-card--today' : ''}">
            <div class="contracts-list-card-body">
              <div class="contracts-list-card-left">
                <div class="contracts-list-company">${escapeHtml(getCompanyName(c))}</div>
                ${c.subdivision ? `<div class="contracts-list-subdivision">${escapeHtml(c.subdivision)}</div>` : ''}
                <div class="contracts-list-badges">
                  <span class="contracts-type-pill" style="background:${ti.bg}; color:${ti.color};">${escapeHtml(getTypeLabel(c))}</span>
                  <span class="contracts-recurrence-pill">${RECURRENCE_LABELS[c.recurrence_type] || ''}${c.recurrence_type === 'custom_weeks' ? ` · ${c.recurrence_interval}w` : ''}</span>
                  ${c.status !== 'active' ? `<span class="contracts-status-pill contracts-status-pill--${c.status}">${c.status}</span>` : ''}
                </div>
                <div class="contracts-list-dates">
                  <span>Started: ${fmtDate(c.start_date)}</span>
                  ${nextOcc && isActive ? `
                    <span class="${over ? 'contracts-due-overdue' : today ? 'contracts-due-today' : 'contracts-due-upcoming'}">
                      ${over ? '⚠ Overdue — ' : today ? '📅 Due today' : `Next: `}${today ? '' : fmtDate(nextOcc)}
                    </span>
                  ` : (c.status !== 'active' ? '' : '<span style="color:var(--text-muted);">One-time</span>')}
                </div>
                ${c.location ? `<div class="contracts-list-location">📍 ${escapeHtml(c.location)}</div>` : ''}
                ${c.notes ? `<div class="contracts-list-notes">${escapeHtml(c.notes)}</div>` : ''}
              </div>
              <div class="contracts-list-card-actions">
                ${state.isTechnician && isActive ? `
                  <button class="btn btn-primary btn-sm" onclick="window._startContractService('${c.id}')">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <polygon points="5 3 19 12 5 21 5 3"/>
                    </svg>
                    Start Service
                  </button>
                ` : ''}
                <button class="btn btn-secondary btn-sm" onclick="window._editContract('${c.id}')" title="Edit contract">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                  Edit
                </button>
                <button class="btn btn-sm contracts-archive-btn" title="${c.status === 'archived' ? 'Restore' : 'Archive'}"
                  onclick="window._archiveContract('${c.id}', '${c.status}')">
                  ${c.status === 'archived' ? `
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M3 2v6h6"/><path d="M21 12A9 9 0 0 0 6 5.7L3 8"/>
                      <path d="M21 22v-6h-6"/><path d="M3 12a9 9 0 0 0 15 6.3l3-2.7"/>
                    </svg>
                  ` : `
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="21 8 21 21 3 21 3 8"/>
                      <rect x="1" y="3" width="22" height="5"/>
                      <line x1="10" y1="12" x2="14" y2="12"/>
                    </svg>
                  `}
                </button>
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  if (window.lucide) lucide.createIcons();
}

// ════════════════════════════════════════════════════════════════
// ADD / EDIT MODAL
// ════════════════════════════════════════════════════════════════

function openContractModal(existing = null, allContracts = []) {
  const isEdit    = !!existing;
  const companies = (window.allCompaniesData || []).sort((a, b) => a.name.localeCompare(b.name));
  const initSource = (existing?.company_id) ? 'select' : 'custom';

  // ── Build sub-component HTML strings ─────────────────────────
  // Company: resolved display name for edit pre-fill
  const existingCompanyName = existing?.company_id
    ? (companies.find(c => c.id === existing.company_id)?.name || '')
    : '';

  const recurrenceDdHtml = window.buildCrmDropdown ? window.buildCrmDropdown({
    id: 'ctr-recurrence',
    placeholder: 'Select schedule...',
    options: Object.entries(RECURRENCE_LABELS).map(([val, lbl]) => ({ value: val, label: lbl })),
    value: existing?.recurrence_type || 'monthly',
    variant: 'form',
  }) : `<select class="ups-input" id="ctr-recurrence">${Object.entries(RECURRENCE_LABELS).map(([val, lbl]) => `<option value="${val}"${existing?.recurrence_type === val ? ' selected' : ''}>${lbl}</option>`).join('')}</select>`;

  const PRESET_REMINDERS = [
    { d: 1,  l: '1 day before' },
    { d: 3,  l: '3 days before' },
    { d: 7,  l: '1 week before' },
    { d: 14, l: '2 weeks before' },
    { d: 30, l: '1 month before' },
  ];
  const existingReminderDays = existing?.reminder_days || [];
  const presetVals   = PRESET_REMINDERS.map(r => r.d);
  const customDayVal = existingReminderDays.find(d => !presetVals.includes(d)) || '';

  const modalHTML = `
    <div class="contracts-modal-overlay" id="contracts-modal-overlay" role="dialog"
         aria-modal="true" aria-labelledby="contracts-modal-title">
      <div class="contracts-modal" id="contracts-modal">

        <div class="contracts-modal-header">
          <h2 id="contracts-modal-title">${isEdit ? 'Edit Contract' : 'New Service Contract'}</h2>
          <button class="contracts-modal-close-btn" id="contracts-modal-close" aria-label="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
            </svg>
          </button>
        </div>

        <div class="contracts-modal-body">

          <!-- Company source toggle -->
          <div class="ups-field">
            <label class="ups-field-label">Company / Client <span class="ups-required">*</span></label>
            <div class="ups-toggle-group" id="ctr-source-toggle" style="margin-bottom:8px;">
              <button type="button" class="ups-toggle-btn${initSource === 'select' ? ' selected' : ''}" data-value="select">Select existing</button>
              <button type="button" class="ups-toggle-btn${initSource === 'custom' ? ' selected' : ''}" data-value="custom">Custom name</button>
            </div>
            <div id="ctr-select-wrap" style="${initSource === 'select' ? '' : 'display:none;'}">
              <div class="contracts-company-combobox" id="ctr-company-combobox">
                <input type="text" class="ups-input" id="ctr-company-search"
                  placeholder="Search company…" autocomplete="off"
                  value="${escapeHtml(existingCompanyName)}">
                <div class="contracts-company-results" id="ctr-company-results"></div>
                <input type="hidden" id="ctr-company-id" value="${escapeHtml(existing?.company_id || '')}">
              </div>
            </div>
            <div id="ctr-custom-wrap" style="${initSource === 'custom' ? '' : 'display:none;'}">
              <input type="text" class="ups-input" id="ctr-custom-company"
                placeholder="e.g. ABC Corporation"
                value="${escapeHtml(existing?.custom_company_name || '')}">
            </div>
          </div>

          <!-- Subdivision -->
          <div class="ups-field">
            <label class="ups-field-label">Subdivision / Branch</label>
            <input type="text" class="ups-input" id="ctr-subdivision"
              placeholder="e.g. Nairobi Branch, Server Room B"
              value="${escapeHtml(existing?.subdivision || '')}">
          </div>

          <!-- Contract type — card buttons with explicit color feedback -->
          <div class="ups-field">
            <label class="ups-field-label">Contract Type <span class="ups-required">*</span></label>
            <div class="contracts-type-toggle" id="ctr-type-toggle">
              ${Object.entries(CONTRACT_TYPES).map(([val, info]) => {
                const active = existing?.contract_type === val;
                return `<button type="button"
                  class="contracts-type-btn${active ? ' is-active' : ''}"
                  data-value="${val}"
                  data-color="${info.color}"
                  data-bg="${info.bg}"
                  ${active ? `style="background:${info.bg};color:${info.color};border-color:${info.color};"` : ''}>
                  ${info.label}
                </button>`;
              }).join('')}
            </div>
            <div id="ctr-custom-type-wrap" style="${existing?.contract_type === 'custom' ? '' : 'display:none;'}">
              <input type="text" class="ups-input" id="ctr-custom-type-name" style="margin-top:8px;"
                placeholder="e.g. Generator Service, CCTV Maintenance"
                value="${escapeHtml(existing?.custom_type_name || '')}">
            </div>
          </div>

          <!-- Location -->
          <div class="ups-field">
            <label class="ups-field-label">
              Service Location
              <span style="font-size:11px;color:var(--text-muted);font-weight:400;margin-left:4px;">(auto-fills technician form)</span>
            </label>
            <input type="text" class="ups-input" id="ctr-location"
              placeholder="e.g. Main Building, 3rd Floor"
              value="${escapeHtml(existing?.location || '')}">
          </div>

          <!-- Start date — CRM calendar -->
          <div class="ups-field">
            <label class="ups-field-label">First Service Date <span class="ups-required">*</span></label>
            <input type="text" class="ups-input" id="ctr-start-date"
              placeholder="Select date"
              value="${existing?.start_date || ''}"
              readonly style="cursor:pointer;">
          </div>

          <!-- Recurrence — CRM dropdown -->
          <div class="ups-field">
            <label class="ups-field-label">Schedule / Recurrence <span class="ups-required">*</span></label>
            ${recurrenceDdHtml}
            <div id="ctr-custom-recurrence-wrap"
              style="${existing?.recurrence_type === 'custom_weeks' ? 'display:flex;align-items:center;gap:8px;margin-top:8px;' : 'display:none;'}">
              <span style="font-size:13px;color:var(--text-muted);white-space:nowrap;">Every</span>
              <input type="number" class="ups-input" id="ctr-recurrence-interval"
                min="1" max="52" style="width:72px;"
                value="${existing?.recurrence_interval || 3}">
              <span style="font-size:13px;color:var(--text-muted);">weeks</span>
            </div>
          </div>

          <!-- Reminders -->
          <div class="ups-field">
            <label class="ups-field-label">Alert Reminders</label>
            <div class="contracts-reminder-group">
              ${PRESET_REMINDERS.map(r => `
                <label class="contracts-reminder-label">
                  <input type="checkbox" name="ctr-reminder" value="${r.d}"
                    ${existingReminderDays.includes(r.d) ? 'checked' : ''}>
                  <span>${r.l}</span>
                </label>
              `).join('')}
              <label class="contracts-reminder-label">
                <input type="checkbox" id="ctr-custom-reminder-check" ${customDayVal ? 'checked' : ''}>
                <span>Custom\u2026</span>
              </label>
            </div>
            <div id="ctr-custom-reminder-wrap"
              style="${customDayVal ? 'display:flex;' : 'display:none;'}align-items:center;gap:8px;margin-top:8px;">
              <input type="number" class="ups-input" id="ctr-custom-reminder-days"
                min="1" max="365" style="width:80px;" placeholder="Days"
                value="${customDayVal}">
              <span style="font-size:13px;color:var(--text-muted);">days before</span>
            </div>
            <p style="font-size:11px;color:var(--text-muted);margin:6px 0 0;">
              Contracts within the reminder window will be highlighted in the \u201cDue\u201d section.
            </p>
          </div>

          <!-- Notes -->
          <div class="ups-field">
            <label class="ups-field-label">Notes</label>
            <textarea class="ups-input" id="ctr-notes" rows="3"
              placeholder="Any additional contract notes\u2026">${escapeHtml(existing?.notes || '')}</textarea>
          </div>

          ${isEdit ? `
          <!-- Status -->
          <div class="ups-field">
            <label class="ups-field-label">Contract Status</label>
            <div class="contracts-type-toggle" id="ctr-status-toggle">
              ${[
                { v: 'active',   l: 'Active',   color: '#059669', bg: '#d1fae5' },
                { v: 'paused',   l: 'Paused',   color: '#d97706', bg: '#fef3c7' },
                { v: 'archived', l: 'Archived',  color: '#6b7280', bg: '#f3f4f6' },
              ].map(s => {
                const active = existing?.status === s.v;
                return `<button type="button"
                  class="contracts-type-btn${active ? ' is-active' : ''}"
                  data-value="${s.v}"
                  data-color="${s.color}"
                  data-bg="${s.bg}"
                  ${active ? `style="background:${s.bg};color:${s.color};border-color:${s.color};"` : ''}>
                  ${s.l}
                </button>`;
              }).join('')}
            </div>
          </div>
          ` : ''}

        </div>

        <div class="contracts-modal-footer">
          ${isEdit ? `<button class="btn btn-danger" id="ctr-delete-btn">Delete</button>` : '<div></div>'}
          <div style="display:flex;gap:8px;">
            <button class="btn btn-secondary" id="ctr-cancel-btn">Cancel</button>
            <button class="btn btn-primary" id="ctr-save-btn">
              ${isEdit ? 'Save Changes' : 'Add Contract'}
            </button>
          </div>
        </div>

      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHTML);

  // ── CRM Calendar — bump z-index above modal overlay (9999) ───
  if (window.initCustomCalendar) {
    window.initCustomCalendar('#ctr-start-date', { type: 'date' });
    const calEl = document.getElementById('ctr-start-date');
    if (calEl?._customCalendar?.picker) {
      calEl._customCalendar.picker.style.zIndex = '10000';
    }
  }

  // ── Company live-search combobox ─────────────────────────────
  const companySearchInput = document.getElementById('ctr-company-search');
  const companyResultsEl   = document.getElementById('ctr-company-results');
  const companyIdInput     = document.getElementById('ctr-company-id');

  const renderCompanyResults = (q) => {
    const filtered = q
      ? companies.filter(c => c.name.toLowerCase().includes(q.toLowerCase())).slice(0, 10)
      : companies.slice(0, 10);

    if (!filtered.length) {
      companyResultsEl.innerHTML = '<div class="contracts-company-result--empty">No companies found</div>';
    } else {
      companyResultsEl.innerHTML = filtered.map(c =>
        `<div class="contracts-company-result" data-id="${escapeHtml(c.id)}" data-name="${escapeHtml(c.name)}">${escapeHtml(c.name)}</div>`
      ).join('');
    }
    companyResultsEl.classList.add('is-open');

    companyResultsEl.querySelectorAll('.contracts-company-result').forEach(item => {
      item.addEventListener('mousedown', (e) => {
        e.preventDefault(); // keep focus in input until after selection
        companyIdInput.value     = item.dataset.id;
        companySearchInput.value = item.dataset.name;
        companyResultsEl.classList.remove('is-open');
      });
    });
  };

  if (companySearchInput) {
    companySearchInput.addEventListener('focus', () => renderCompanyResults(companySearchInput.value));
    companySearchInput.addEventListener('input', () => {
      companyIdInput.value = ''; // clear stale id while user re-types
      renderCompanyResults(companySearchInput.value);
    });
    companySearchInput.addEventListener('blur', () => {
      setTimeout(() => companyResultsEl.classList.remove('is-open'), 200);
    });
  }

  // ── Toggle: company source ────────────────────────────────────
  const sourceToggle = document.getElementById('ctr-source-toggle');
  const selectWrap   = document.getElementById('ctr-select-wrap');
  const customWrap   = document.getElementById('ctr-custom-wrap');

  sourceToggle.querySelectorAll('.ups-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      sourceToggle.querySelectorAll('.ups-toggle-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      const isCustom = btn.dataset.value === 'custom';
      selectWrap.style.display = isCustom ? 'none' : '';
      customWrap.style.display = isCustom ? '' : 'none';
    });
  });

  // ── Contract type card buttons ────────────────────────────────
  const typeToggle     = document.getElementById('ctr-type-toggle');
  const customTypeWrap = document.getElementById('ctr-custom-type-wrap');

  typeToggle.querySelectorAll('.contracts-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      typeToggle.querySelectorAll('.contracts-type-btn').forEach(b => {
        b.classList.remove('is-active');
        b.style.cssText = '';
      });
      btn.classList.add('is-active');
      btn.style.cssText = `background:${btn.dataset.bg};color:${btn.dataset.color};border-color:${btn.dataset.color};`;
      customTypeWrap.style.display = btn.dataset.value === 'custom' ? '' : 'none';
    });
  });

  // ── Recurrence: listen to CRM dropdown hidden input ───────────
  const recurrenceHidden = document.getElementById('ctr-recurrence');
  const customRecurWrap  = document.getElementById('ctr-custom-recurrence-wrap');

  const onRecurrenceChange = () => {
    const val = recurrenceHidden?.value;
    if (val === 'custom_weeks') {
      customRecurWrap.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:8px;';
    } else {
      customRecurWrap.style.display = 'none';
    }
  };
  if (recurrenceHidden) {
    recurrenceHidden.addEventListener('change', onRecurrenceChange);
    // Also pick up change bubbled from the crm-dd root
    recurrenceHidden.closest?.('.crm-dd')?.addEventListener('change', onRecurrenceChange);
  }

  // ── Status toggle (edit only) ─────────────────────────────────
  const statusToggle = document.getElementById('ctr-status-toggle');
  if (statusToggle) {
    statusToggle.querySelectorAll('.contracts-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        statusToggle.querySelectorAll('.contracts-type-btn').forEach(b => {
          b.classList.remove('is-active');
          b.style.cssText = '';
        });
        btn.classList.add('is-active');
        btn.style.cssText = `background:${btn.dataset.bg};color:${btn.dataset.color};border-color:${btn.dataset.color};`;
      });
    });
  }

  // ── Custom reminder toggle ────────────────────────────────────
  const customReminderCheck = document.getElementById('ctr-custom-reminder-check');
  const customReminderWrap  = document.getElementById('ctr-custom-reminder-wrap');
  customReminderCheck.addEventListener('change', () => {
    customReminderWrap.style.display = customReminderCheck.checked ? 'flex' : 'none';
  });

  // ── Close / Cancel ────────────────────────────────────────────
  const close = () => {
    const overlay = document.getElementById('contracts-modal-overlay');
    if (overlay) overlay.remove();
  };

  document.getElementById('contracts-modal-close').addEventListener('click', close);
  document.getElementById('ctr-cancel-btn').addEventListener('click', close);
  document.getElementById('contracts-modal-overlay').addEventListener('click', e => {
    if (e.target.id === 'contracts-modal-overlay') close();
  });

  // ── Save ─────────────────────────────────────────────────────
  document.getElementById('ctr-save-btn').addEventListener('click', () => {
    saveContract(existing, close);
  });

  // ── Delete (edit only) ────────────────────────────────────────
  if (isEdit) {
    document.getElementById('ctr-delete-btn').addEventListener('click', async () => {
      const confirmed = await window.showConfirmDialog('Delete Contract', 'Permanently delete this contract? This cannot be undone.');
      if (!confirmed) return;
      const { error } = await supabaseClient.from('service_contracts').delete().eq('id', existing.id);
      if (error) { showToast('Delete failed: ' + error.message, 'error'); return; }
      showToast('Contract deleted', 'success');
      close();
      renderContractsView();
    });
  }

  if (window.lucide) lucide.createIcons();
}

async function saveContract(existing = null, closeFn) {
  const saveBtn = document.getElementById('ctr-save-btn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  try {
    // Company
    const sourceBtn = document.querySelector('#ctr-source-toggle .ups-toggle-btn.selected');
    const isCustomSrc = sourceBtn?.dataset.value === 'custom';
    const companyId = !isCustomSrc ? (document.getElementById('ctr-company-id').value || null) : null;
    const customCompany = isCustomSrc ? (document.getElementById('ctr-custom-company').value.trim() || null) : null;

    if (!companyId && !customCompany) {
      showToast('Please select or enter a company name', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = existing ? 'Save Changes' : 'Add Contract';
      return;
    }

    // Contract type
    const typeBtn = document.querySelector('#ctr-type-toggle .contracts-type-btn.is-active');
    const contractType = typeBtn?.dataset.value;
    if (!contractType) {
      showToast('Please select a contract type', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = existing ? 'Save Changes' : 'Add Contract';
      return;
    }

    const startDate = document.getElementById('ctr-start-date').value;
    if (!startDate) {
      showToast('Please set a first service date', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = existing ? 'Save Changes' : 'Add Contract';
      return;
    }

    const recurrenceType = document.getElementById('ctr-recurrence').value;
    const recurrenceInterval = recurrenceType === 'custom_weeks'
      ? (parseInt(document.getElementById('ctr-recurrence-interval').value) || 3)
      : null;

    const reminderDays = Array.from(
      document.querySelectorAll('input[name="ctr-reminder"]:checked')
    ).map(cb => parseInt(cb.value));

    // Custom reminder days
    const customReminderCheck = document.getElementById('ctr-custom-reminder-check');
    const customReminderDaysEl = document.getElementById('ctr-custom-reminder-days');
    if (customReminderCheck?.checked && customReminderDaysEl?.value) {
      const cd = parseInt(customReminderDaysEl.value);
      if (cd > 0 && !reminderDays.includes(cd)) reminderDays.push(cd);
    }

    const statusToggle = document.getElementById('ctr-status-toggle');
    const statusBtn    = statusToggle?.querySelector('.contracts-type-btn.is-active');
    const status       = statusBtn?.dataset.value || 'active';

    const payload = {
      organization_id:    state.currentOrganization?.id,
      company_id:         companyId,
      custom_company_name: customCompany,
      subdivision:        document.getElementById('ctr-subdivision').value.trim() || null,
      contract_type:      contractType,
      custom_type_name:   contractType === 'custom'
                            ? (document.getElementById('ctr-custom-type-name').value.trim() || null)
                            : null,
      location:           document.getElementById('ctr-location').value.trim() || null,
      start_date:         startDate,
      recurrence_type:    recurrenceType,
      recurrence_interval: recurrenceInterval,
      reminder_days:      reminderDays,
      notes:              document.getElementById('ctr-notes').value.trim() || null,
      status,
      updated_by:         state.currentUser.id,
    };

    let error;
    if (existing) {
      ({ error } = await supabaseClient.from('service_contracts').update(payload).eq('id', existing.id));
    } else {
      payload.created_by = state.currentUser.id;
      ({ error } = await supabaseClient.from('service_contracts').insert([payload]));
    }

    if (error) throw error;

    showToast(existing ? 'Contract updated!' : 'Contract created!', 'success');
    if (closeFn) closeFn();
    renderContractsView();

  } catch (e) {
    showToast('Failed to save: ' + e.message, 'error');
    saveBtn.disabled = false;
    saveBtn.textContent = existing ? 'Save Changes' : 'Add Contract';
  }
}

// ════════════════════════════════════════════════════════════════
// ARCHIVE / RESTORE
// ════════════════════════════════════════════════════════════════

async function archiveContract(contractId, currentStatus) {
  const newStatus = currentStatus === 'archived' ? 'active' : 'archived';
  const { error } = await supabaseClient
    .from('service_contracts')
    .update({ status: newStatus, updated_by: state.currentUser.id })
    .eq('id', contractId);

  if (error) { showToast('Failed: ' + error.message, 'error'); return; }
  showToast(newStatus === 'archived' ? 'Contract archived' : 'Contract restored', 'success');
  renderContractsView();
}

// ════════════════════════════════════════════════════════════════
// START SERVICE FROM CONTRACT
// ════════════════════════════════════════════════════════════════

function startServiceFromContract(contract, dueDateStr = null) {
  const prefill = {
    siteName:         getCompanyName(contract),
    subdivision:      contract.subdivision || null,
    location:         contract.location || null,
    contractId:       contract.id,
    contractType:     contract.contract_type,
    contractTypeLabel: getTypeLabel(contract),
    dueDate:          dueDateStr,
  };

  if (contract.contract_type === 'solar_service') {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => _launchSolarWithPrefill(prefill, pos.coords.latitude, pos.coords.longitude),
        ()  => _launchSolarWithPrefill(prefill, null, null),
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
      );
    } else {
      _launchSolarWithPrefill(prefill, null, null);
    }
  } else {
    // UPS or Custom → UPS form
    if (typeof window.renderUPSVisitFormWithContract === 'function') {
      window.renderUPSVisitFormWithContract(prefill);
    } else {
      showToast('UPS form not available', 'error');
    }
  }
}

function _launchSolarWithPrefill(prefill, lat, lng) {
  if (typeof window.renderSolarSurveyForm !== 'function') {
    showToast('Solar form not available', 'error');
    return;
  }
  // Launch the solar form normally, then prefill fields
  window.renderSolarSurveyForm(null, lat, lng);
  // Use a rAF to ensure the DOM has settled
  requestAnimationFrame(() => {
    const nameEl = document.getElementById('sol-company-name');
    if (nameEl && prefill.siteName) nameEl.value = prefill.siteName;

    // Show contract banner at the top of the solar form container
    const container = document.querySelector('.ups-form-container');
    if (container && prefill.contractId) {
      const subdivisionLine = prefill.subdivision
        ? `<span style="font-size:11px;opacity:0.85;"> · ${escapeHtml(prefill.subdivision)}</span>`
        : '';
      const banner = document.createElement('div');
      banner.className = 'contract-service-banner';
      banner.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <div>
          <strong>Contract Service</strong> · ${escapeHtml(prefill.contractTypeLabel)}
          <div>${escapeHtml(prefill.siteName)}${subdivisionLine}${prefill.dueDate ? ' · Due: ' + prefill.dueDate : ''}</div>
        </div>
      `;
      container.insertBefore(banner, container.firstChild);
    }
  });
}

// ════════════════════════════════════════════════════════════════
// GLOBAL HELPERS (called from window._openAddContract etc.)
// ════════════════════════════════════════════════════════════════

window._openAddContract = function() {
  openContractModal(null, window.allCompaniesData || []);
};

export { renderContractsView };
