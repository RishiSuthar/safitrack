// modules/features/call-logs.js
// Calls page, call detail and log/schedule modals. Also hosts the company record modal.
import { state, supabaseClient, crmDebugLog, saveViewState } from '../state.js';
import { showToast, escapeHtml, getInitials } from '../ui/toast.js';
import { renderError, getCurrencySymbol } from '../utils/helpers.js';
import { matchesTokenizedQuery } from '../ui/spreadsheet.js';
import { renderCustomFieldsDisplay } from './custom-fields.js';
import { fetchAllPages } from '../utils/analytics.js';

const OUTCOMES = ['Connected', 'Voicemail', 'No Answer', 'Busy', 'Wrong Number', 'Call Failed'];
const SCHEDULED = 'Scheduled';
const OUTCOME_TONES = {
  Connected: 'success',
  Voicemail: 'info',
  'No Answer': 'neutral',
  Busy: 'warning',
  'Wrong Number': 'danger',
  'Call Failed': 'danger',
  Scheduled: 'primary',
};
const EMPTY_FILTERS = { search: '', direction: '', outcome: '', dateFrom: '', dateTo: '' };
const HISTORY_PAGE_SIZE = 200;

const icon = (paths, size = 16) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const PHONE_PATH = '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>';
const ICONS = {
  outbound: icon(`<polyline points="22 8 22 2 16 2"/><line x1="16" x2="22" y1="8" y2="2"/>${PHONE_PATH}`, 15),
  inbound: icon(`<polyline points="16 2 16 8 22 8"/><line x1="22" x2="16" y1="2" y2="8"/>${PHONE_PATH}`, 15),
  phone: icon(PHONE_PATH, 20),
  scheduled: icon('<path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h5"/><path d="M17.5 17.5 16 16.3V14"/><circle cx="16" cy="16" r="6"/>', 15),
  search: icon('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>', 14),
  plus: icon('<path d="M5 12h14"/><path d="M12 5v14"/>', 14),
  close: icon('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', 18),
  edit: icon('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>', 15),
  trash: icon('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>', 15),
  external: icon('<path d="M7 17 17 7"/><path d="M7 7h10v10"/>', 13),
};

// Rows for the current scope (mine or the whole team). Filters run on this
// in memory, so typing in search never refetches or rebuilds the toolbar.
let callsCache = [];
let historyLimit = HISTORY_PAGE_SIZE;
let searchTimer = null;

// ── Data helpers ───────────────────────────────────────────────

const contactNameOf = (log) => log.people?.name || log.contact_name || 'Unknown contact';
const companyNameOf = (log) => log.companies?.name || log.company_name || '';
const repNameOf = (log) => (log.profiles ? `${log.profiles.first_name || ''} ${log.profiles.last_name || ''}`.trim() : '');
const isScheduled = (log) => log.outcome === SCHEDULED;
const isOverdue = (log) => isScheduled(log) && new Date(log.call_at) < new Date();
const canEditCall = (log) => !!state.currentUser && log.user_id === state.currentUser.id;
const isTeamMode = () => state.isManager && state.managerCallLogViewMode === 'team';

function dateLocale() {
  return typeof getUserDateFormat === 'function' && getUserDateFormat() === 'MM/DD/YYYY' ? 'en-US' : 'en-GB';
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// 'YYYY-MM-DD' as local midnight (new Date('YYYY-MM-DD') would be UTC).
function parseDateInput(value) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatTime(date) {
  return date.toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
}

function formatDay(date, { weekday = 'long', month = 'long' } = {}) {
  const diff = Math.round((startOfDay(date) - startOfDay(new Date())) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff === 1) return 'Tomorrow';
  const opts = { weekday, day: 'numeric', month };
  if (date.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return date.toLocaleDateString(dateLocale(), opts);
}

function formatWhen(date) {
  return `${formatDay(date, { weekday: 'short', month: 'short' })}, ${formatTime(date)}`;
}

function formatDuration(seconds, { long = false } = {}) {
  if (!seconds) return '';
  if (seconds < 60) return long ? `${seconds} sec` : `${seconds}s`;
  const totalMins = Math.round(seconds / 60);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (!h) return long ? `${m} min` : `${m}m`;
  if (!m) return long ? `${h} h` : `${h}h`;
  return long ? `${h} h ${m} min` : `${h}h ${m}m`;
}

function outcomeTag(outcome, label = outcome) {
  const tone = OUTCOME_TONES[outcome] || 'neutral';
  return `<span class="calls-outcome calls-outcome--${tone}">${escapeHtml(label || '—')}</span>`;
}

function hasActiveFilters() {
  const f = state.callLogFilters;
  return !!(f.search || f.direction || f.outcome || f.dateFrom || f.dateTo || (isTeamMode() && state.selectedRepId));
}

function applyFilters(rows) {
  const f = state.callLogFilters;
  const from = f.dateFrom ? parseDateInput(f.dateFrom) : null;
  const to = f.dateTo ? new Date(parseDateInput(f.dateTo).getTime() + 864e5 - 1) : null;
  const repId = isTeamMode() ? state.selectedRepId : null;

  return rows.filter((log) => {
    if (repId && log.user_id !== repId) return false;
    if (f.direction && log.direction !== f.direction) return false;
    if (f.outcome && log.outcome !== f.outcome) return false;
    const at = new Date(log.call_at);
    if (from && at < from) return false;
    if (to && at > to) return false;
    return !f.search || matchesTokenizedQuery(f.search, contactNameOf(log), companyNameOf(log), log.notes, repNameOf(log));
  });
}

async function fetchCalls() {
  let query = supabaseClient
    .from('call_logs')
    .select('*, profiles:user_id(first_name, last_name), people:contact_id(id, name), companies:company_id(id, name)')
    .order('call_at', { ascending: false });
  if (state.currentOrganization?.id) query = query.eq('organization_id', state.currentOrganization.id);
  if (!isTeamMode()) query = query.eq('user_id', state.currentUser.id);
  return fetchAllPages(query);
}

// The log modal's company search reads window.allCompaniesData.
function ensureCompaniesLoaded() {
  if (window.allCompaniesData || window.allCompaniesPromise) return;
  let query = supabaseClient.from('companies').select('id, name, address, domain').order('name', { ascending: true });
  if (state.currentOrganization?.id) query = query.eq('organization_id', state.currentOrganization.id);
  window.allCompaniesPromise = fetchAllPages(query).then(({ data }) => {
    window.allCompaniesData = data || [];
  });
}

function refreshCallsPageIfOpen() {
  if (document.querySelector('.calls-page')) renderCallLogsView();
}

// ── Calls page ─────────────────────────────────────────────────

async function renderCallLogsView() {
  const container = document.getElementById('view-container');
  container.querySelector('.calls-results')?.classList.add('is-loading');
  ensureCompaniesLoaded();

  const { data, error } = await fetchCalls();
  if (state.currentView !== 'call-logs') return;
  if (error) {
    container.innerHTML = renderError(error.message);
    return;
  }

  callsCache = data || [];
  historyLimit = HISTORY_PAGE_SIZE;
  container.innerHTML = `
    <div class="calls-page">
      ${renderToolbar()}
      <div class="calls-results" id="calls-results"></div>
    </div>`;
  bindToolbar(container);
  renderResults();
}

function renderToolbar() {
  const f = state.callLogFilters;
  const team = isTeamMode();
  const seg = (attr, options, current, label) => `
    <div class="calls-seg" role="group" aria-label="${label}">
      ${options.map(([value, text]) => `<button type="button" class="calls-seg-btn${value === current ? ' is-active' : ''}" data-${attr}="${value}" aria-pressed="${value === current}">${text}</button>`).join('')}
    </div>`;

  // Rep options come from the loaded calls, so everyone who has logged a call is listed.
  const reps = new Map();
  if (team) callsCache.forEach((log) => { if (log.user_id && !reps.has(log.user_id)) reps.set(log.user_id, repNameOf(log) || 'Unknown member'); });
  const repOptions = [...reps].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));

  return `
    <div class="calls-toolbar">
      <div class="calls-toolbar-row">
        <label class="calls-search">
          ${ICONS.search}
          <input type="search" id="call-search" placeholder="Search calls" value="${escapeHtml(f.search)}" autocomplete="off" aria-label="Search calls">
        </label>
        <div class="calls-toolbar-actions">
          ${state.isManager ? seg('scope', [['my', 'My calls'], ['team', 'Team']], state.managerCallLogViewMode, 'Whose calls') : ''}
          <button type="button" class="btn btn-primary calls-new-btn" id="log-call-btn">${ICONS.plus}<span>Log call</span></button>
        </div>
      </div>
      <div class="calls-toolbar-row calls-filters">
        ${seg('direction', [['', 'All'], ['Outbound', 'Outbound'], ['Inbound', 'Inbound']], f.direction, 'Direction')}
        ${window.buildCrmDropdown({
          id: 'call-outcome-filter',
          variant: 'filter',
          className: 'calls-dd',
          value: f.outcome,
          placeholder: 'Any outcome',
          options: [{ value: '', label: 'Any outcome' }, ...OUTCOMES.map((o) => ({ value: o, label: o }))],
        })}
        ${team ? window.buildCrmDropdown({
          id: 'call-rep-filter',
          variant: 'filter',
          className: 'calls-dd',
          value: state.selectedRepId || '',
          placeholder: 'Everyone',
          options: [{ value: '', label: 'Everyone' }, ...repOptions],
        }) : ''}
        <div class="calls-range" role="group" aria-label="Date range">
          <input type="date" id="call-date-from" value="${escapeHtml(f.dateFrom)}" aria-label="From date">
          <span class="calls-range-sep">to</span>
          <input type="date" id="call-date-to" value="${escapeHtml(f.dateTo)}" aria-label="To date">
        </div>
        <button type="button" class="crm-filter-clear" id="calls-clear-filters"${hasActiveFilters() ? '' : ' hidden'}>Clear</button>
        <span class="calls-total" id="calls-total"></span>
      </div>
    </div>`;
}

function bindToolbar(container) {
  const filters = state.callLogFilters;
  const persist = () => saveViewState({ callLogs: filters });
  const rerender = () => {
    historyLimit = HISTORY_PAGE_SIZE;
    persist();
    renderResults();
  };

  container.querySelector('#log-call-btn').addEventListener('click', () => openCallLogModal());

  container.querySelector('#call-search').addEventListener('input', (e) => {
    filters.search = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(rerender, 120);
  });

  container.querySelectorAll('[data-direction]').forEach((btn) => {
    btn.addEventListener('click', () => {
      filters.direction = btn.dataset.direction;
      container.querySelectorAll('[data-direction]').forEach((b) => {
        const active = b === btn;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-pressed', String(active));
      });
      rerender();
    });
  });

  container.querySelectorAll('[data-scope]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (state.managerCallLogViewMode === btn.dataset.scope) return;
      state.managerCallLogViewMode = btn.dataset.scope;
      state.selectedRepId = null;
      renderCallLogsView();
    });
  });

  container.querySelector('#call-outcome-filter').addEventListener('change', (e) => {
    filters.outcome = e.target.value;
    rerender();
  });

  container.querySelector('#call-rep-filter')?.addEventListener('change', (e) => {
    state.selectedRepId = e.target.value || null;
    rerender();
  });

  if (window.initCustomCalendar) {
    window.initCustomCalendar('#call-date-from', { type: 'date' });
    window.initCustomCalendar('#call-date-to', { type: 'date' });
  }
  container.querySelector('#call-date-from').addEventListener('change', (e) => {
    filters.dateFrom = e.target.value;
    rerender();
  });
  container.querySelector('#call-date-to').addEventListener('change', (e) => {
    filters.dateTo = e.target.value;
    rerender();
  });

  container.querySelector('#calls-clear-filters').addEventListener('click', clearFilters);

  // One delegated handler for every row, rebuilt or not.
  const results = container.querySelector('#calls-results');
  results.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]');
    if (action) {
      const log = callsCache.find((l) => l.id === action.dataset.id);
      if (action.dataset.action === 'clear-filters') return clearFilters();
      if (action.dataset.action === 'log-first') return openCallLogModal();
      if (action.dataset.action === 'show-more') {
        historyLimit += HISTORY_PAGE_SIZE;
        return renderResults();
      }
      if (!log) return;
      if (action.dataset.action === 'edit') return openCallLogModal(log);
      if (action.dataset.action === 'log-outcome') return openCallLogModal(log, { mode: 'log' });
      if (action.dataset.action === 'delete') return deleteCallLog(log.id);
      return;
    }
    const row = e.target.closest('.calls-row');
    if (row && !window.getSelection()?.toString()) {
      const log = callsCache.find((l) => l.id === row.dataset.id);
      if (log) openCallLogViewModal(log);
    }
  });
}

function clearFilters() {
  state.callLogFilters = { ...EMPTY_FILTERS };
  state.selectedRepId = null;
  saveViewState({ callLogs: state.callLogFilters });
  clearTimeout(searchTimer);
  renderCallLogsView();
}

function renderResults() {
  const el = document.getElementById('calls-results');
  if (!el) return;

  const rows = applyFilters(callsCache);
  const upcoming = rows.filter(isScheduled).sort((a, b) => new Date(a.call_at) - new Date(b.call_at));
  const history = rows.filter((log) => !isScheduled(log));
  const filtered = hasActiveFilters();

  document.getElementById('calls-clear-filters')?.toggleAttribute('hidden', !filtered);
  const total = document.getElementById('calls-total');
  if (total) total.textContent = rows.length ? `${rows.length} ${rows.length === 1 ? 'call' : 'calls'}` : '';

  el.classList.remove('is-loading');
  if (!rows.length) {
    el.innerHTML = filtered ? renderEmpty({
      title: 'No calls match these filters',
      body: 'Try a different search or widen the date range.',
      action: '<button type="button" class="btn btn-secondary" data-action="clear-filters">Clear filters</button>',
    }) : renderEmpty({
      title: isTeamMode() ? 'Your team has not logged any calls' : 'No calls yet',
      body: 'Log a call when you hang up, or schedule one and get a reminder.',
      action: `<button type="button" class="btn btn-primary" data-action="log-first">${ICONS.plus}<span>Log a call</span></button>`,
    });
    return;
  }

  const team = isTeamMode();
  el.innerHTML = `
    ${upcoming.length ? `
      <section class="calls-section" aria-labelledby="calls-upcoming-title">
        <h2 class="calls-section-title" id="calls-upcoming-title">Upcoming <span class="calls-section-count">${upcoming.length}</span></h2>
        <ul class="calls-panel${team ? ' calls-panel--team' : ''}">${upcoming.map(renderUpcomingRow).join('')}</ul>
      </section>` : ''}
    ${history.length ? `
      <section class="calls-section" aria-labelledby="calls-history-title">
        ${upcoming.length ? `<h2 class="calls-section-title" id="calls-history-title">History <span class="calls-section-count">${history.length}</span></h2>` : '<h2 class="visually-hidden" id="calls-history-title">History</h2>'}
        <div class="calls-panel${team ? ' calls-panel--team' : ''}">${renderHistoryGroups(history.slice(0, historyLimit))}</div>
        ${history.length > historyLimit ? `<button type="button" class="btn btn-secondary calls-more" data-action="show-more">Show ${Math.min(HISTORY_PAGE_SIZE, history.length - historyLimit)} more</button>` : ''}
      </section>` : ''}`;
}

function renderHistoryGroups(history) {
  const groups = [];
  history.forEach((log) => {
    const day = startOfDay(new Date(log.call_at)).getTime();
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.logs.push(log);
    else groups.push({ day, logs: [log] });
  });

  return groups.map(({ day, logs }) => {
    const talk = formatDuration(logs.reduce((sum, l) => sum + (l.duration_seconds || 0), 0));
    return `
      <div class="calls-group">
        <div class="calls-group-head">
          <h3>${escapeHtml(formatDay(new Date(day)))}</h3>
          <span>${logs.length} ${logs.length === 1 ? 'call' : 'calls'}${talk ? ` · ${talk} talk time` : ''}</span>
        </div>
        <ul class="calls-list">${logs.map(renderHistoryRow).join('')}</ul>
      </div>`;
  }).join('');
}

function renderRowCommon(log) {
  const company = companyNameOf(log);
  return `
    <div class="calls-who">
      <button type="button" class="calls-name">${escapeHtml(contactNameOf(log))}</button>
      ${company ? `<span class="calls-company">${escapeHtml(company)}</span>` : ''}
    </div>
    <p class="calls-note">${escapeHtml((log.notes || '').replace(/\s+/g, ' ').trim())}</p>
    ${isTeamMode() ? `<span class="calls-rep">${escapeHtml(repNameOf(log) || 'Former member')}</span>` : ''}`;
}

function renderRowActions(log) {
  if (!canEditCall(log)) return '<div class="calls-actions"></div>';
  return `
    <div class="calls-actions">
      <button type="button" class="calls-icon-btn" data-action="edit" data-id="${log.id}" title="Edit" aria-label="Edit call">${ICONS.edit}</button>
      <button type="button" class="calls-icon-btn calls-icon-btn--danger" data-action="delete" data-id="${log.id}" title="Delete" aria-label="Delete call">${ICONS.trash}</button>
    </div>`;
}

function renderHistoryRow(log) {
  const inbound = log.direction === 'Inbound';
  const at = new Date(log.call_at);
  const duration = formatDuration(log.duration_seconds);
  return `
    <li class="calls-row" data-id="${log.id}">
      <span class="calls-dir" title="${inbound ? 'Inbound' : 'Outbound'} call">${inbound ? ICONS.inbound : ICONS.outbound}</span>
      ${renderRowCommon(log)}
      <span class="calls-status">${outcomeTag(log.outcome)}</span>
      <span class="calls-duration">${duration}</span>
      <time class="calls-time" datetime="${escapeHtml(log.call_at)}">${formatTime(at)}</time>
      ${renderRowActions(log)}
    </li>`;
}

function renderUpcomingRow(log) {
  const at = new Date(log.call_at);
  const overdue = isOverdue(log);
  return `
    <li class="calls-row calls-row--upcoming${overdue ? ' is-overdue' : ''}" data-id="${log.id}">
      <span class="calls-dir calls-dir--scheduled" title="Scheduled call">${ICONS.scheduled}</span>
      ${renderRowCommon(log)}
      <span class="calls-when">
        ${overdue ? '<span class="calls-overdue">Overdue</span>' : ''}
        <time datetime="${escapeHtml(log.call_at)}">${escapeHtml(formatWhen(at))}</time>
      </span>
      <span class="calls-log-outcome">${canEditCall(log) ? `<button type="button" class="btn btn-secondary btn-sm" data-action="log-outcome" data-id="${log.id}">Log outcome</button>` : ''}</span>
      ${renderRowActions(log)}
    </li>`;
}

function renderEmpty({ title, body, action }) {
  return `
    <div class="calls-empty">
      <span class="calls-empty-icon">${ICONS.phone}</span>
      <h2>${title}</h2>
      <p>${body}</p>
      ${action}
    </div>`;
}

async function deleteCallLog(id) {
  const confirmed = await showConfirmDialog('Delete call', 'Delete this call from your history?');
  if (!confirmed) return false;

  let log = callsCache.find((l) => l.id === id);
  if (!log) {
    const { data } = await supabaseClient.from('call_logs').select('id, user_id').eq('id', id).maybeSingle();
    log = data;
  }
  if (!log) {
    showToast('That call no longer exists', 'error');
    return false;
  }
  if (!canEditCall(log)) {
    showToast('You can only delete calls you logged', 'error');
    return false;
  }

  const { error } = await supabaseClient.from('call_logs').delete().eq('id', id);
  if (error) {
    showToast(`Could not delete the call: ${error.message}`, 'error');
    return false;
  }
  showToast('Call deleted', 'success');
  refreshCallsPageIfOpen();
  return true;
}

// ── Call detail modal ──────────────────────────────────────────

function openCallLogViewModal(log) {
  const modal = document.getElementById('call-log-view-modal');
  if (!modal || !log) return;
  const panel = modal.querySelector('.calls-detail');

  const contactName = contactNameOf(log);
  const companyName = companyNameOf(log);
  const at = new Date(log.call_at);
  const scheduled = isScheduled(log);
  const duration = formatDuration(log.duration_seconds, { long: true });
  const editable = canEditCall(log);
  const longDate = `${at.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, ${formatTime(at)}`;

  const facts = [
    ['Outcome', isOverdue(log) ? outcomeTag(SCHEDULED, 'Overdue') : outcomeTag(log.outcome)],
    ['Direction', escapeHtml(log.direction || '—')],
    [scheduled ? 'Scheduled for' : 'When', escapeHtml(longDate)],
    !scheduled && ['Duration', duration ? escapeHtml(duration) : '<span class="calls-muted">Not recorded</span>'],
    ['Logged by', escapeHtml(repNameOf(log) || 'Former member')],
  ].filter(Boolean);

  panel.innerHTML = `
    <div class="calls-detail-head">
      <span class="calls-detail-avatar" aria-hidden="true">${escapeHtml(getInitials(contactName))}</span>
      <div class="calls-detail-heading">
        <h3 id="call-detail-title">
          ${log.contact_id ? `<button type="button" class="calls-link" data-open="person">${escapeHtml(contactName)}</button>` : escapeHtml(contactName)}
        </h3>
        ${companyName ? `<p>${log.company_id ? `<button type="button" class="calls-link calls-link--muted" data-open="company">${escapeHtml(companyName)}${ICONS.external}</button>` : escapeHtml(companyName)}</p>` : ''}
      </div>
      <button type="button" class="modal-close" data-close aria-label="Close">${ICONS.close}</button>
    </div>
    <dl class="calls-detail-facts">
      ${facts.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}
    </dl>
    <div class="calls-detail-notes">
      <h4>Notes</h4>
      ${log.notes ? `<p>${escapeHtml(log.notes)}</p>` : '<p class="calls-muted">No notes for this call.</p>'}
    </div>
    ${editable ? `
      <div class="modal-footer calls-detail-foot">
        <button type="button" class="btn btn-ghost calls-delete-btn" data-do="delete">${ICONS.trash}<span>Delete</span></button>
        <button type="button" class="btn btn-secondary" data-do="edit">Edit</button>
        ${scheduled ? '<button type="button" class="btn btn-primary" data-do="log-outcome">Log outcome</button>' : ''}
      </div>` : ''}`;

  const close = () => closeModal('call-log-view-modal');
  const thenClose = (fn) => () => { close(); setTimeout(fn, 80); };
  panel.querySelector('[data-close]').onclick = close;
  panel.querySelector('[data-open="person"]')?.addEventListener('click', thenClose(() => openPersonViewModal(log.contact_id)));
  panel.querySelector('[data-open="company"]')?.addEventListener('click', thenClose(() => openCompanyViewModal(log.company_id)));
  panel.querySelector('[data-do="edit"]')?.addEventListener('click', thenClose(() => openCallLogModal(log)));
  panel.querySelector('[data-do="log-outcome"]')?.addEventListener('click', thenClose(() => openCallLogModal(log, { mode: 'log' })));
  panel.querySelector('[data-do="delete"]')?.addEventListener('click', async () => {
    if (await deleteCallLog(log.id)) close();
  });

  modal.style.display = 'flex';
  document.body.classList.add('modal-active');
  panel.tabIndex = -1;
  panel.focus();
}

// Escape closes the call modals, unless a picker or the confirm dialog on top of them should get it.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (document.querySelector('.custom-calendar-picker')) return;
  if (document.getElementById('confirm-dialog')?.style.display === 'flex') return;
  ['call-log-view-modal', 'call-log-modal'].forEach((id) => {
    const modal = document.getElementById(id);
    if (modal && modal.style.display !== 'none') closeModal(id);
  });
});


/**
 * Company view modal — shows linked opportunities, calls and recent visits in tabs.
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

  // Render custom fields in sidebar
  renderCustomFieldsDisplay('company', 'company-view-custom-fields', company.id);

  // Add a SafiFind button that opens a dedicated modal for searching nearby companies
  try {
    const headerActions = document.getElementById('company-view-header-actions');
    if (headerActions) {
      headerActions.innerHTML = '';
      const safiBtn = document.createElement('button');
      safiBtn.type = 'button';
      safiBtn.id = 'company-view-safifind-btn';
      safiBtn.className = 'btn btn-primary btn-sm';
      safiBtn.setAttribute('aria-label', 'Open SafiFind');
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

  // Reset stats bar and tab counts
  ['company-stat-pipeline', 'company-stat-opps', 'company-stat-people', 'company-stat-activity'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '—'; });
  ['company-tab-opps-count', 'company-tab-people-count', 'company-tab-calls-count', 'company-tab-visits-count'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '0'; });

  // Reset tabs to first tab active
  modal.querySelectorAll('.company-view-tab').forEach((t, i) => t.classList.toggle('active', i === 0));
  document.getElementById('company-view-opps').style.display = 'block';
  const empResetEl = document.getElementById('company-view-employees'); if (empResetEl) empResetEl.style.display = 'none';
  document.getElementById('company-view-calls').style.display = 'none';
  document.getElementById('company-view-visits').style.display = 'none';

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
  const orgId = state.currentOrganization?.id;
  const [oppsById, oppsByName, callsById, callsByName, visitsById, visitsByName, peopleById, peopleByName] = await Promise.all([
    (() => { let q = supabaseClient.from('opportunities').select('*').eq('company_id', company.id); if (orgId) q = q.eq('organization_id', orgId); return q; })(),
    (() => { let q = supabaseClient.from('opportunities').select('*').eq('company_name', company.name); if (orgId) q = q.eq('organization_id', orgId); return q; })(),
    (() => { let q = supabaseClient.from('call_logs').select('*, people(*), profiles(*)').eq('company_id', company.id).order('call_at', { ascending: false }).limit(50); if (orgId) q = q.eq('organization_id', orgId); return q; })(),
    (() => { let q = supabaseClient.from('call_logs').select('*, people(*), profiles(*)').eq('company_name', company.name).order('call_at', { ascending: false }).limit(50); if (orgId) q = q.eq('organization_id', orgId); return q; })(),
    (() => { let q = supabaseClient.from('visits').select('*, user:profiles(first_name,last_name)').eq('company_id', company.id).order('created_at', { ascending: false }).limit(10); if (orgId) q = q.eq('organization_id', orgId); return q; })(),
    (() => { let q = supabaseClient.from('visits').select('*, user:profiles(first_name,last_name)').eq('company_name', company.name).order('created_at', { ascending: false }).limit(10); if (orgId) q = q.eq('organization_id', orgId); return q; })(),
    // Query people by company_id (most reliable). Avoid ordering by potentially missing columns.
    (() => { let q = supabaseClient.from('people').select('*').eq('company_id', company.id).limit(200); if (orgId) q = q.eq('organization_id', orgId); return q; })(),
    // Fallback: try to find people where the name contains the company name (less reliable but avoids using non-existent company_name column).
    (() => { let q = supabaseClient.from('people').select('*').ilike('name', `%${String(company.name || '').replace(/%/g, '')}%`).limit(200); if (orgId) q = q.eq('organization_id', orgId); return q; })()
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

  // ── Populate Stats Bar ──
  try {
    const totalPipeline = opportunities.reduce((sum, o) => sum + (parseFloat(o.value || o.amount || 0) || 0), 0);
    const pipelineStatEl = document.getElementById('company-stat-pipeline');
    if (pipelineStatEl) pipelineStatEl.textContent = totalPipeline ? `${getCurrencySymbol()} ${totalPipeline.toLocaleString()}` : '0';
    const oppsStatEl = document.getElementById('company-stat-opps');
    if (oppsStatEl) oppsStatEl.textContent = String(opportunities.length);
    const peopleStatEl = document.getElementById('company-stat-people');
    if (peopleStatEl) peopleStatEl.textContent = String(employees.length);

    // Determine last activity date
    const activityDates = [];
    if (calls.length && calls[0].call_at) activityDates.push(new Date(calls[0].call_at));
    if (visits.length && visits[0].created_at) activityDates.push(new Date(visits[0].created_at));
    opportunities.forEach(o => { if (o.updated_at) activityDates.push(new Date(o.updated_at)); });
    const activityStatEl = document.getElementById('company-stat-activity');
    if (activityDates.length && activityStatEl) {
      const latest = new Date(Math.max(...activityDates.map(d => d.getTime())));
      const daysAgo = Math.floor((Date.now() - latest.getTime()) / (1000 * 60 * 60 * 24));
      activityStatEl.textContent = daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : `${daysAgo}d ago`;
    }
  } catch (statsErr) {
    crmDebugLog('company-view-stats-error', statsErr);
  }

  // ── Update Tab Count Badges ──
  const companyOppsCountEl = document.getElementById('company-tab-opps-count'); if (companyOppsCountEl) companyOppsCountEl.textContent = String(opportunities.length);
  const companyPeopleCountEl = document.getElementById('company-tab-people-count'); if (companyPeopleCountEl) companyPeopleCountEl.textContent = String(employees.length);
  const companyCallsCountEl = document.getElementById('company-tab-calls-count'); if (companyCallsCountEl) companyCallsCountEl.textContent = String(calls.length);
  const companyVisitsCountEl = document.getElementById('company-tab-visits-count'); if (companyVisitsCountEl) companyVisitsCountEl.textContent = String(visits.length);

  // ── Quick Action Buttons in Sidebar ──
  const companyQuickActions = document.getElementById('company-view-quick-actions');
  if (companyQuickActions) {
    let actionsHtml = '';
    if (company.address && company.latitude && company.longitude) {
      actionsHtml += `<a class="record-quick-action record-quick-action--directions" href="https://www.google.com/maps/dir/?api=1&destination=${company.latitude},${company.longitude}" target="_blank" rel="noopener noreferrer" title="Get directions"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>Directions</a>`;
    }
    if (company.domain) {
      let domainUrl = String(company.domain).trim();
      if (!/^https?:\/\//i.test(domainUrl)) domainUrl = 'https://' + domainUrl;
      actionsHtml += `<a class="record-quick-action" href="${domainUrl.replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer" title="Visit website"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>Website</a>`;
    }
    companyQuickActions.innerHTML = actionsHtml;
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
          <div class="record-opp-card-value">${getCurrencySymbol()} ${val.toLocaleString()}</div>
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
          const isOwnOpportunity = !state.isManager || opp.user_id === state.currentUser.id;
          openOpportunityModal(opp, !isOwnOpportunity);
        }
      });
    });
  }

  // Render Call Logs tab (premium rows)
  const callsEl = document.getElementById('company-view-calls');
  if (!calls || calls.length === 0) {
    callsEl.innerHTML = `<div class="record-empty-state"><div class="record-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.79 19.79 0 0 1 11.63 19a19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72"/></svg></div><div class="record-empty-title">No calls</div><div class="record-empty-desc">No call records found for this company.</div></div>`;
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


// ── Log / schedule modal ───────────────────────────────────────

let modalState = { log: null, scheduling: false, defaultWhen: '' };

function nextFullHour() {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d;
}

function setCallModalMode(scheduling) {
  const modal = document.getElementById('call-log-modal');
  const { log } = modalState;
  modalState.scheduling = scheduling;

  modal.querySelector('.calls-form').classList.toggle('is-scheduling', scheduling);
  [['clm-mode-log', !scheduling], ['clm-mode-schedule', scheduling]].forEach(([id, active]) => {
    const btn = document.getElementById(id);
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  document.getElementById('call-log-modal-title').textContent = scheduling
    ? (log ? 'Edit scheduled call' : 'Schedule a call')
    : (log && !isScheduled(log) ? 'Edit call' : 'Log a call');
  document.getElementById('call-datetime-label').textContent = scheduling ? 'Scheduled for' : 'When';
  document.getElementById('call-notes').placeholder = scheduling ? 'What is the call about?' : 'What was discussed?';
  document.getElementById('save-call-log-btn').textContent = scheduling ? 'Schedule call' : 'Save call';

  // A new call defaults to "now"; once it is a scheduled call, the next full hour is a better guess.
  const when = document.getElementById('call-datetime');
  if (!log && when.value === modalState.defaultWhen) {
    when.value = toLocalInputValue(scheduling ? nextFullHour() : new Date());
    modalState.defaultWhen = when.value;
  }
}

/**
 * Open the log modal. `options.mode` forces 'log' or 'schedule'; by default an
 * existing scheduled call opens in schedule mode and everything else in log mode.
 */
function openCallLogModal(log = null, options = {}) {
  const modal = document.getElementById('call-log-modal');
  modalState = { log, scheduling: false, defaultWhen: '' };

  const direction = log?.direction || 'Outbound';
  const when = log ? new Date(log.call_at) : new Date();
  const loggingScheduled = log && isScheduled(log) && options.mode === 'log';

  document.getElementById('call-contact-input').value = log ? contactNameOf(log) : '';
  document.getElementById('call-contact-id').value = log?.contact_id || '';
  document.getElementById('call-company-input').value = log ? companyNameOf(log) : '';
  document.getElementById('call-company-id').value = log?.company_id || '';
  document.getElementById('call-direction').value = direction;
  document.querySelectorAll('input[name="call-direction-radio"]').forEach((r) => { r.checked = r.value === direction; });
  // Logging the outcome of a scheduled call that is now past: it happened at the scheduled time.
  document.getElementById('call-datetime').value = toLocalInputValue(loggingScheduled && when > new Date() ? new Date() : when);
  document.getElementById('call-duration').value = log?.duration_seconds ? Math.round(log.duration_seconds / 60) : '';
  document.getElementById('call-notes').value = log?.notes || '';
  document.querySelectorAll('input[name="call-outcome"]').forEach((r) => { r.checked = !!log && r.value === log.outcome; });
  document.querySelectorAll('#call-log-modal .live-search-results').forEach((el) => el.classList.remove('active'));
  modalState.defaultWhen = document.getElementById('call-datetime').value;

  const scheduling = options.mode ? options.mode === 'schedule' : !!log && isScheduled(log);
  setCallModalMode(scheduling);

  if (!modal.dataset.bound) {
    modal.dataset.bound = '1';
    document.getElementById('clm-mode-log').addEventListener('click', () => setCallModalMode(false));
    document.getElementById('clm-mode-schedule').addEventListener('click', () => setCallModalMode(true));
    document.querySelectorAll('input[name="call-direction-radio"]').forEach((r) => {
      r.addEventListener('change', () => { document.getElementById('call-direction').value = r.value; });
    });
    document.getElementById('save-call-log-btn').addEventListener('click', () => saveCallLog(modalState.log?.id || null, modalState.scheduling));
    initCallLogSearch();
  }

  modal.style.display = 'flex';
  document.body.classList.add('modal-active');
  if (!log) setTimeout(() => document.getElementById('call-contact-input').focus(), 50);
}

function initCallLogSearch() {
  const bind = (inputId, resultsId, idFieldId, search) => {
    const input = document.getElementById(inputId);
    const results = document.getElementById(resultsId);
    const idField = document.getElementById(idFieldId);

    const pick = (item) => {
      input.value = item.dataset.name;
      idField.value = item.dataset.id;
      results.classList.remove('active');
    };

    input.addEventListener('input', () => {
      // Typing breaks any earlier link to a saved record.
      idField.value = '';
      const query = input.value.trim();
      if (!query) {
        results.classList.remove('active');
        return;
      }
      const matches = search(query).slice(0, 5);
      results.innerHTML = matches.map(({ id, name, subtitle, avatar }) => `
        <div class="search-result-item" data-id="${escapeHtml(id)}" data-name="${escapeHtml(name)}">
          ${avatar}
          <div class="search-result-text">
            <span class="title">${escapeHtml(name)}</span>
            ${subtitle ? `<span class="subtitle">${escapeHtml(subtitle)}</span>` : ''}
          </div>
        </div>`).join('') + `
        <div class="search-result-item add-new" data-id="" data-name="${escapeHtml(query)}">
          <div class="opp-suggest-avatar opp-suggest-avatar--custom"><span>+</span></div>
          <div class="search-result-text"><span class="title">Use “${escapeHtml(query)}”</span></div>
        </div>`;
      results.classList.add('active');
    });

    // mousedown fires before blur, so the pick lands before the list closes.
    results.addEventListener('mousedown', (e) => {
      const item = e.target.closest('.search-result-item');
      if (!item) return;
      e.preventDefault();
      pick(item);
    });
    input.addEventListener('blur', () => results.classList.remove('active'));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && results.classList.contains('active')) {
        e.preventDefault();
        const first = results.querySelector('.search-result-item');
        if (first) pick(first);
      }
    });
  };

  bind('call-contact-input', 'call-contact-results', 'call-contact-id', (query) =>
    (state.allPeople || [])
      .filter((p) => matchesTokenizedQuery(query, p.name, p.email, p.job_title, p.companies?.name))
      .map((p) => ({
        id: p.id,
        name: p.name,
        subtitle: p.companies?.name || p.job_title || '',
        avatar: `<div class="opp-suggest-avatar opp-suggest-avatar--person"><span>${escapeHtml(getInitials(p.name))}</span></div>`,
      })));

  bind('call-company-input', 'call-company-results', 'call-company-id', (query) =>
    (window.allCompaniesData || [])
      .filter((c) => matchesTokenizedQuery(query, c.name, c.description, c.address))
      .map((c) => {
        const domain = c.domain ? String(c.domain).replace(/^https?:\/\//, '').split('/')[0] : '';
        const logoUrl = domain ? getCompanyLogoUrl(domain) : '';
        return {
          id: c.id,
          name: c.name,
          subtitle: c.address || '',
          avatar: `<div class="opp-suggest-avatar">${logoUrl ? `<img class="opp-suggest-logo" src="${escapeHtml(logoUrl)}" alt="" loading="lazy" onerror="this.remove()">` : ''}<span>${escapeHtml(getInitials(c.name))}</span></div>`,
        };
      }));
}

async function saveCallLog(logId = null, isScheduling = false) {
  const contactInput = document.getElementById('call-contact-input');
  const contactName = contactInput.value.trim();
  const contactId = document.getElementById('call-contact-id').value || null;
  const companyName = document.getElementById('call-company-input').value.trim();
  const companyId = document.getElementById('call-company-id').value || null;
  const callAt = document.getElementById('call-datetime').value;
  const durationMins = parseFloat(document.getElementById('call-duration').value);
  const notes = document.getElementById('call-notes').value.trim();
  const outcome = document.querySelector('input[name="call-outcome"]:checked')?.value;

  if (!contactName) {
    showToast('Add who the call was with', 'error');
    contactInput.focus();
    return;
  }
  if (!callAt) {
    showToast('Pick a date and time', 'error');
    return;
  }
  if (!isScheduling && !outcome) {
    showToast('Pick an outcome', 'error');
    document.querySelector('input[name="call-outcome"]')?.focus();
    return;
  }

  const logData = {
    contact_name: contactId ? null : contactName,
    contact_id: contactId,
    company_name: companyId ? null : (companyName || null),
    company_id: companyId,
    direction: document.getElementById('call-direction').value,
    call_at: new Date(callAt).toISOString(),
    duration_seconds: !isScheduling && durationMins > 0 ? Math.round(durationMins * 60) : null,
    outcome: isScheduling ? SCHEDULED : outcome,
    notes: notes || null,
  };
  // Ownership and organisation are set once, on insert; editing never reassigns a call.
  if (!logId) {
    logData.user_id = state.currentUser.id;
    logData.organization_id = state.currentOrganization?.id;
  }

  const saveBtn = document.getElementById('save-call-log-btn');
  saveBtn.disabled = true;
  const { error } = logId
    ? await supabaseClient.from('call_logs').update(logData).eq('id', logId)
    : await supabaseClient.from('call_logs').insert([logData]);

  if (!error && !logId && isScheduling) {
    const { error: reminderError } = await supabaseClient.from('reminders').insert([{
      title: `Call ${contactName}`,
      description: notes,
      reminder_date: logData.call_at,
      is_completed: false,
      user_id: state.currentUser.id,
      assigned_to: state.currentUser.id,
      created_by: state.currentUser.id,
      organization_id: state.currentOrganization?.id,
    }]);
    if (reminderError) {
      crmDebugLog('call-reminder-insert-error', reminderError);
      showToast('Call scheduled, but the reminder could not be created', 'warning');
    }
  }
  saveBtn.disabled = false;

  if (error) {
    showToast(`Could not save the call: ${error.message}`, 'error');
    return;
  }
  showToast(isScheduling ? 'Call scheduled' : 'Call saved', 'success');
  closeModal('call-log-modal');
  refreshCallsPageIfOpen();
}


// ── Exports ────────────────────────────────────────────────────
export {
  renderCallLogsView,
  deleteCallLog,
  openCallLogViewModal,
  openCompanyViewModal,
  openCallLogModal,
  initCallLogSearch,
  saveCallLog,
};
