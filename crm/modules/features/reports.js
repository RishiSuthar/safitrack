// modules/features/reports.js
// ═══════════════════════════════════════════════════════════════════════════════
// SafiTrack Reports — Dashboard + Builder with side-by-side layout + Export
// ═══════════════════════════════════════════════════════════════════════════════

import { state, supabaseClient } from '../state.js';
import { showToast } from '../ui/toast.js';
import { renderError, getCurrencySymbol } from '../utils/helpers.js';
import {
  DATA_SOURCES, FILTER_OPERATORS, METRIC_TYPES, VIZ_TYPES, DATE_INTERVALS,
  executeReport, saveReport, loadSavedReports, deleteReport,
  getOrgProfiles, getProfileName, computeMetrics, computeGrouping,
} from './report-engine.js';

// ── State ───────────────────────────────────────────────────────────────────

let _currentConfig = null;
let _reportResult = null;
let _savedReports = [];
let _builderMode = 'dashboard'; // 'dashboard' | 'builder'
let _editingReportId = null;
let _isExecuting = false;
let _liveDebounce = null;
let _refreshTimer = null;

// ── Main View ───────────────────────────────────────────────────────────────

async function renderReportsView() {
  const vc = document.getElementById('view-container');
  if (!vc) return;

  vc.innerHTML = `
    <div class="rpt-root">
      <div class="rpt-header">
        <div class="rpt-header-left">
          <h2 class="rpt-title" id="rpt-title" style="display:none"></h2>
        </div>
        <div class="rpt-header-actions" id="rpt-header-actions">
          <button class="btn btn-secondary btn-sm" id="rpt-back-btn" style="display:none;">
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            Back
          </button>
          <button class="btn btn-ghost btn-sm btn-icon" id="rpt-refresh-btn" title="Refresh dashboard">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
          </button>
          <button class="btn btn-primary btn-sm" id="rpt-new-btn">
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
            New Report
          </button>
        </div>
      </div>
      <div id="rpt-content" class="rpt-content"></div>
    </div>
  `;

  document.getElementById('rpt-new-btn').onclick = () => openBuilder();
  document.getElementById('rpt-back-btn').onclick = () => { switchMode('dashboard'); renderDashboardView(); };
  document.getElementById('rpt-refresh-btn').onclick = () => refreshDashboard();

  _builderMode = 'dashboard';
  await renderDashboardView();
  startAutoRefresh();
}

function switchMode(mode) {
  _builderMode = mode;
  const backBtn = document.getElementById('rpt-back-btn');
  const newBtn = document.getElementById('rpt-new-btn');
  const refreshBtn = document.getElementById('rpt-refresh-btn');
  const title = document.getElementById('rpt-title');

  if (backBtn) backBtn.style.display = mode === 'dashboard' ? 'none' : '';
  if (newBtn) newBtn.style.display = mode === 'dashboard' ? '' : 'none';
  if (refreshBtn) refreshBtn.style.display = mode === 'dashboard' ? '' : 'none';
  if (title) {
    title.style.display = mode === 'dashboard' ? 'none' : '';
    title.textContent = mode === 'builder' ? (_editingReportId ? 'Edit Report' : 'New Report') : '';
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD VIEW — Shows saved reports as live widgets + report cards
// ═══════════════════════════════════════════════════════════════════════════════

async function renderDashboardView() {
  switchMode('dashboard');
  const container = document.getElementById('rpt-content');
  if (!container) return;

  container.innerHTML = '<div class="rpt-loading"><div class="rpt-spinner"></div></div>';

  try {
    _savedReports = await loadSavedReports();
  } catch (e) {
    container.innerHTML = renderError('Failed to load reports');
    return;
  }

  if (!_savedReports.length) {
    container.innerHTML = `
      <div class="rpt-empty">
        <div class="rpt-empty-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
        </div>
        <h3>No reports yet</h3>
        <p>Create your first report to start analyzing your CRM data.</p>
        <button class="btn btn-primary btn-sm" id="rpt-empty-create">Create Report</button>
      </div>
    `;
    document.getElementById('rpt-empty-create')?.addEventListener('click', () => openBuilder());
    return;
  }

  const pinnedReports = _savedReports.filter(r => r.is_favorite)
    .sort((a, b) => ((a.config && a.config.pin_order) || 0) - ((b.config && b.config.pin_order) || 0));
  const unpinnedReports = _savedReports.filter(r => !r.is_favorite);

  let html = '';

  // Pinned reports as live dashboard widgets
  if (pinnedReports.length) {
    html += '<div class="rdash-grid" id="rdash-grid">';
    pinnedReports.forEach((report, i) => {
      html += `
        <div class="rdash-widget rdash-widget--medium" data-report-id="${esc(report.id)}" style="cursor:pointer;">
          <div class="rdash-widget-header" style="cursor:grab;">
            <span class="rdash-widget-title">${esc(report.name)}</span>
            <div class="rdash-widget-controls">
              <button class="btn btn-ghost btn-icon" data-unpin-id="${esc(report.id)}" title="Unpin from dashboard">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
              </button>
            </div>
          </div>
          <div class="rdash-widget-body" id="rdash-widget-body-${i}">
            <div class="rpt-loading rpt-loading-sm"><div class="rpt-spinner rpt-spinner-sm"></div></div>
          </div>
        </div>
      `;
    });
    html += '</div>';
  }

  // Report cards section
  if (unpinnedReports.length || pinnedReports.length) {
    html += '<div class="rpt-dash-section"><div class="rpt-dash-section-header"><h3>All Reports</h3></div><div class="rpt-grid">';
  }

  for (const report of _savedReports) {
    const src = DATA_SOURCES[report.data_source];
    const vizType = VIZ_TYPES.find(v => v.key === report.visualization);
    const metricsLabel = (report.metrics || []).map(m => m.label || m.type).join(', ') || 'Count';
    const pinTitle = report.is_favorite ? 'Unpin from dashboard' : 'Pin to dashboard';
    const pinFill = report.is_favorite ? 'currentColor' : 'none';
    html += `
      <div class="rpt-card" data-report-id="${esc(report.id)}">
        <div class="rpt-card-header">
          <div class="rpt-card-icon rpt-card-icon--${esc(report.data_source)}">
            <i data-lucide="${esc(src?.icon || 'file-text')}"></i>
          </div>
          <div class="rpt-card-meta">
            <h4 class="rpt-card-name">${esc(report.name)}</h4>
            <span class="rpt-card-source">${esc(src?.label || report.data_source)}</span>
          </div>
          <div class="rpt-card-actions">
            <button class="btn btn-ghost btn-icon rpt-card-fav ${report.is_favorite ? 'active' : ''}" title="${pinTitle}" data-pin-id="${esc(report.id)}">
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="${pinFill}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
            </button>
            <button class="btn btn-ghost btn-icon" title="Export Excel" data-export-excel="${esc(report.id)}">
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13h2"/><path d="M8 17h2"/><path d="M14 13h2"/><path d="M14 17h2"/></svg>
            </button>
            <button class="btn btn-ghost btn-icon" title="Export PDF" data-export-pdf="${esc(report.id)}">
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            </button>
            <button class="btn btn-ghost btn-icon" title="Delete" data-delete-id="${esc(report.id)}">
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
        <div class="rpt-card-body">
          <div class="rpt-card-pills">
            <span class="rpt-pill">${esc(vizType?.label || report.visualization)}</span>
            <span class="rpt-pill">${esc(metricsLabel)}</span>
            ${report.grouping?.field ? '<span class="rpt-pill">by ' + esc(report.grouping.field) + '</span>' : ''}
          </div>
          <span class="rpt-card-date">${relTime(report.updated_at)}</span>
        </div>
      </div>
    `;
  }

  html += '</div></div>';
  container.innerHTML = html;
  bindDashboardEvents(container);
  if (pinnedReports.length) {
    loadPinnedWidgets(pinnedReports);
    initWidgetSortable(pinnedReports);
  }
  if (window.lucide) setTimeout(() => lucide.createIcons(), 0);
}

function bindDashboardEvents(container) {
  // Card clicks -> open in builder
  container.querySelectorAll('.rpt-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-delete-id]') || e.target.closest('[data-pin-id]') ||
          e.target.closest('[data-export-excel]') || e.target.closest('[data-export-pdf]')) return;
      const report = _savedReports.find(r => r.id === card.dataset.reportId);
      if (report) openBuilder(report);
    });
  });

  // Delete
  container.querySelectorAll('[data-delete-id]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const confirmed = await window.showConfirmDialog('Delete Report', 'Are you sure you want to delete this report?');
      if (!confirmed) return;
      try {
        await deleteReport(btn.dataset.deleteId);
        showToast('Report deleted', 'info');
        await renderDashboardView();
      } catch { showToast('Failed to delete report', 'error'); }
    });
  });

  // Pin / Unpin toggle (from cards)
  container.querySelectorAll('[data-pin-id]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const report = _savedReports.find(r => r.id === btn.dataset.pinId);
      if (!report) return;
      try {
        report.is_favorite = !report.is_favorite;
        await saveReport(report);
        showToast(report.is_favorite ? 'Pinned to dashboard' : 'Unpinned', 'info');
        await renderDashboardView();
      } catch { showToast('Failed to update', 'error'); }
    });
  });

  // Unpin from widget header
  container.querySelectorAll('[data-unpin-id]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const report = _savedReports.find(r => r.id === btn.dataset.unpinId);
      if (!report) return;
      try {
        report.is_favorite = false;
        await saveReport(report);
        showToast('Unpinned', 'info');
        await renderDashboardView();
      } catch { showToast('Failed to update', 'error'); }
    });
  });

  // Click widget body -> open full in builder
  container.querySelectorAll('.rdash-widget').forEach(widget => {
    widget.addEventListener('click', (e) => {
      if (e.target.closest('[data-unpin-id]') || e.target.closest('button')) return;
      const report = _savedReports.find(r => r.id === widget.dataset.reportId);
      if (report) openBuilder(report);
    });
  });

  // Export Excel
  container.querySelectorAll('[data-export-excel]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const report = _savedReports.find(r => r.id === btn.dataset.exportExcel);
      if (report) await exportReportToExcel(report);
    });
  });

  // Export PDF
  container.querySelectorAll('[data-export-pdf]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const report = _savedReports.find(r => r.id === btn.dataset.exportPdf);
      if (report) await exportReportToPDF(report);
    });
  });
}

// ── Drag & Drop Reorder ─────────────────────────────────────────────────────

function initWidgetSortable(pinnedReports) {
  const grid = document.getElementById('rdash-grid');
  if (!grid || typeof Sortable === 'undefined') return;
  Sortable.create(grid, {
    animation: 150,
    handle: '.rdash-widget-header',
    ghostClass: 'rdash-widget--ghost',
    chosenClass: 'rdash-widget--chosen',
    dragClass: 'rdash-widget--drag',
    onEnd: async () => {
      // persist new order using config.pin_order
      const widgets = grid.querySelectorAll('.rdash-widget');
      const updates = [];
      widgets.forEach((w, i) => {
        const report = _savedReports.find(r => r.id === w.dataset.reportId);
        if (report) {
          report.config = report.config || {};
          report.config.pin_order = i;
          updates.push(saveReport(report));
        }
      });
      await Promise.all(updates);
    }
  });
}

// ── Pinned Widget Data Loading ──────────────────────────────────────────────

async function loadPinnedWidgets(pinnedReports) {
  const promises = pinnedReports.map(async (report, i) => {
    try {
      const result = await executeReport(report);
      renderPinnedWidget(i, report, result);
    } catch {
      const body = document.getElementById('rdash-widget-body-' + i);
      if (body) body.innerHTML = '<div class="rpt-text-muted">Failed to load</div>';
    }
  });
  await Promise.all(promises);
}

async function renderPinnedWidget(idx, report, result) {
  const body = document.getElementById('rdash-widget-body-' + idx);
  if (!body) return;
  const { rows, metrics, groups } = result;
  const viz = report.visualization || 'kpi';

  if (viz === 'kpi') {
    const entries = Object.entries(metrics);
    body.innerHTML = entries.length ? '<div class="rdash-kpi-grid">' + entries.map(([label, value]) =>
      '<div class="rdash-kpi"><span class="rdash-kpi-value">' + formatMetricValue(value, label) +
      '</span><span class="rdash-kpi-label">' + esc(label) + '</span></div>'
    ).join('') + '</div>' : '<div class="rpt-text-muted">No metrics</div>';
  } else if (viz === 'table') {
    const source = DATA_SOURCES[report.data_source];
    if (!source) return;
    const fields = source.fields.slice(0, 4);
    const displayRows = rows.slice(0, 8);
    const profiles = await getOrgProfiles();
    body.innerHTML = '<table class="rpt-table rpt-table--compact"><thead><tr>' +
      fields.map(f => '<th>' + esc(f.label) + '</th>').join('') +
      '</tr></thead><tbody>' +
      displayRows.map(row => '<tr>' + fields.map(f => {
        let val = row[f.key];
        if (f.type === 'date' && val) val = new Date(val).toLocaleDateString();
        else if (f.type === 'number' && val != null) val = Number(val).toLocaleString();
        else if (f.type === 'relation' && val) val = getProfileName(profiles, val);
        return '<td>' + esc(String(val ?? '\u2014')) + '</td>';
      }).join('') + '</tr>').join('') +
      '</tbody></table>' +
      (rows.length > 8 ? '<div class="rpt-table-footer">' + rows.length + ' total</div>' : '');
  } else if (viz === 'bar' || viz === 'line') {
    if (!groups?.length) { body.innerHTML = '<div class="rpt-text-muted">No grouped data</div>'; return; }
    const canvasId = 'rdash-chart-' + idx + '-' + Date.now();
    body.innerHTML = '<canvas id="' + canvasId + '" style="width:100%;height:100%;"></canvas>';
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx || typeof Chart === 'undefined') return;
    const labels = groups.map(g => formatLabel(g.label));
    const metricKey = Object.keys(groups[0]?.metrics || {})[0];
    const values = groups.map(g => metricKey ? g.metrics[metricKey] : g.count);
    if (state.chartInstances[canvasId]) state.chartInstances[canvasId].destroy();
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const dataset = viz === 'line' ? {
      label: metricKey || 'Count', data: values, borderColor: '#2f5fd0',
      backgroundColor: 'rgba(47,95,208,0.08)', fill: true, tension: 0.3, pointRadius: 2,
    } : {
      label: metricKey || 'Count', data: values, backgroundColor: getChartColors(labels.length),
      borderRadius: 3, maxBarThickness: 32,
    };
    state.chartInstances[canvasId] = new Chart(ctx, {
      type: viz, data: { labels, datasets: [dataset] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: isDark ? '#c9d1d9' : '#6e7681', font: { size: 10 } }, grid: { display: false } },
          y: { ticks: { color: isDark ? '#c9d1d9' : '#6e7681', font: { size: 10 } }, grid: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }, beginAtZero: true },
        },
      },
    });
  } else if (viz === 'funnel') {
    if (!groups?.length) { body.innerHTML = '<div class="rpt-text-muted">No grouped data</div>'; return; }
    const metricKey = Object.keys(groups[0]?.metrics || {})[0];
    const sorted = [...groups].sort((a, b) => (metricKey ? b.metrics[metricKey] : b.count) - (metricKey ? a.metrics[metricKey] : a.count));
    const maxVal = metricKey ? sorted[0]?.metrics[metricKey] : sorted[0]?.count;
    const colors = getChartColors(sorted.length);
    body.innerHTML = '<div class="rpt-funnel rpt-funnel--compact">' +
      sorted.slice(0, 6).map((g, i) => {
        const val = metricKey ? g.metrics[metricKey] : g.count;
        const pct = maxVal > 0 ? (val / maxVal * 100) : 0;
        return '<div class="rpt-funnel-stage rpt-funnel-stage--sm"><div class="rpt-funnel-bar-wrap"><div class="rpt-funnel-bar" style="width:' + Math.max(pct, 8) + '%;background:' + colors[i] + '"></div></div><div class="rpt-funnel-info"><span>' + esc(formatLabel(g.label)) + '</span><span>' + formatMetricValue(val) + '</span></div></div>';
      }).join('') + '</div>';
  }
}

async function refreshDashboard() {
  await renderDashboardView();
  showToast('Dashboard refreshed', 'info');
}

function startAutoRefresh() {
  stopAutoRefresh();
  _refreshTimer = setInterval(() => {
    if (state.currentView === 'reports' && _builderMode === 'dashboard') refreshDashboard();
    else stopAutoRefresh();
  }, 300000);
}

function stopAutoRefresh() {
  if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BUILDER — Side-by-side: live preview (left) + config panel (right)
// ═══════════════════════════════════════════════════════════════════════════════

function openBuilder(existingReport) {
  switchMode('builder');

  if (existingReport) {
    _currentConfig = { ...existingReport };
    _editingReportId = existingReport.id;
  } else {
    _currentConfig = {
      name: '',
      data_source: 'companies',
      filters: [],
      relationships: [],
      metrics: [{ type: 'count', field: null, label: 'Count' }],
      grouping: {},
      visualization: 'kpi',
      config: {},
    };
    _editingReportId = null;
  }

  _reportResult = null;
  renderBuilderUI();
  if (_currentConfig.data_source) scheduleLivePreview();
}

function renderBuilderUI() {
  const container = document.getElementById('rpt-content');
  if (!container) return;

  const cfg = _currentConfig;
  const sources = Object.entries(DATA_SOURCES);
  const source = DATA_SOURCES[cfg.data_source];

  container.innerHTML = `
    <div class="rpt-split-builder">
      <div class="rpt-builder-preview" id="rpt-live-preview">
        <div class="rpt-live-header">
          <input type="text" class="rpt-live-name" id="rpt-name" value="${esc(cfg.name)}" placeholder="Describe this report...">
          <div class="rpt-live-actions">
            <button class="btn btn-secondary btn-sm" id="rpt-discard-btn">Discard</button>
            <button class="btn btn-primary btn-sm" id="rpt-save-btn">Save</button>
          </div>
        </div>
        <div class="rpt-live-body" id="rpt-live-body">
          <div class="rpt-loading"><div class="rpt-spinner"></div></div>
        </div>
      </div>
      <div class="rpt-builder-config">
        <div class="rpt-config-section">
          <div class="rpt-config-label">Data source</div>
          <div class="rpt-config-select-wrap">
            <div class="crm-dd crm-dd--form" data-dd-id="rpt-source-select">
              <button type="button" class="crm-dd-trigger has-value" aria-haspopup="listbox" aria-expanded="false">
                <span class="crm-dd-label">${DATA_SOURCES[cfg.data_source]?.label || 'Select…'}</span>
                <span class="crm-dd-chevron"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>
              </button>
              <div class="crm-dd-panel" role="listbox">
                <ul class="crm-dd-list">
                  ${sources.map(([key, src]) => '<li class="crm-dd-option' + (cfg.data_source === key ? ' is-selected' : '') + '" role="option" data-value="' + key + '" data-label="' + src.label + '" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>' + src.label + '</li>').join('')}
                </ul>
              </div>
              <input class="crm-dd-value-input" type="hidden" id="rpt-source-select" value="${cfg.data_source || ''}">
            </div>
          </div>
        </div>
        <div class="rpt-config-section">
          <div class="rpt-config-label">Filters</div>
          <div id="rpt-filters-area"></div>
          <button class="rpt-config-add-btn" id="rpt-add-filter"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg> Add filter</button>
        </div>
        <div class="rpt-config-section" ${!source?.relationships?.length ? 'style="display:none"' : ''}>
          <div class="rpt-config-label">Relationships</div>
          <div id="rpt-rels-area"></div>
          <button class="rpt-config-add-btn" id="rpt-add-rel"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> Add relationship</button>
        </div>
        <div class="rpt-config-section">
          <div class="rpt-config-label">Metrics</div>
          <div id="rpt-metrics-area"></div>
          <button class="rpt-config-add-btn" id="rpt-add-metric" style="margin-top:var(--space-2);"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg> Add metric</button>
        </div>
        <div class="rpt-config-section">
          <div class="rpt-config-label">Group by</div>
          <div id="rpt-grouping-area"></div>
        </div>
        <div class="rpt-config-section">
          <div class="rpt-config-label">Visualization</div>
          <div class="rpt-config-select-wrap">
            <div class="crm-dd crm-dd--form" data-dd-id="rpt-viz-select">
              <button type="button" class="crm-dd-trigger has-value" aria-haspopup="listbox" aria-expanded="false">
                <span class="crm-dd-label">${VIZ_TYPES.find(v => v.key === cfg.visualization)?.label || 'Select…'}</span>
                <span class="crm-dd-chevron"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>
              </button>
              <div class="crm-dd-panel" role="listbox">
                <ul class="crm-dd-list">
                  ${VIZ_TYPES.map(v => '<li class="crm-dd-option' + (cfg.visualization === v.key ? ' is-selected' : '') + '" role="option" data-value="' + v.key + '" data-label="' + v.label + '" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>' + v.label + '</li>').join('')}
                </ul>
              </div>
              <input class="crm-dd-value-input" type="hidden" id="rpt-viz-select" value="${cfg.visualization || ''}">
            </div>
          </div>
        </div>
        <div class="rpt-config-section rpt-config-export">
          <div class="rpt-config-label">Export</div>
          <div class="rpt-config-export-btns">
            <button class="btn btn-secondary btn-sm" id="rpt-export-excel"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13h2"/><path d="M8 17h2"/><path d="M14 13h2"/><path d="M14 17h2"/></svg> Excel</button>
            <button class="btn btn-secondary btn-sm" id="rpt-export-pdf"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg> PDF</button>
          </div>
        </div>
      </div>
    </div>
  `;

  renderConfigFilters();
  renderConfigRelationships();
  renderConfigMetrics();
  renderConfigGrouping();
  bindBuilderEvents();
  if (window.lucide) setTimeout(() => lucide.createIcons(), 0);
}

function bindBuilderEvents() {
  document.getElementById('rpt-source-select')?.addEventListener('change', function() {
    _currentConfig.data_source = this.value;
    _currentConfig.filters = [];
    _currentConfig.relationships = [];
    _currentConfig.grouping = {};
    _currentConfig.metrics = [{ type: 'count', field: null, label: 'Count' }];
    renderBuilderUI();
    scheduleLivePreview();
  });

  document.getElementById('rpt-viz-select')?.addEventListener('change', function() {
    _currentConfig.visualization = this.value;
    renderLivePreview();
  });

  document.getElementById('rpt-name')?.addEventListener('input', function() {
    _currentConfig.name = this.value;
  });

  document.getElementById('rpt-add-filter')?.addEventListener('click', () => {
    _currentConfig.filters.push({ field: '', operator: '', value: '' });
    renderConfigFilters();
  });

  document.getElementById('rpt-add-rel')?.addEventListener('click', () => {
    _currentConfig.relationships.push({ target: '', condition: '_exists', operator: '', value: '' });
    renderConfigRelationships();
  });

  document.getElementById('rpt-add-metric')?.addEventListener('click', () => {
    _currentConfig.metrics.push({ type: 'count', field: null, label: '' });
    renderConfigMetrics();
  });

  document.getElementById('rpt-save-btn')?.addEventListener('click', () => handleSave());
  document.getElementById('rpt-discard-btn')?.addEventListener('click', () => { switchMode('dashboard'); renderDashboardView(); });

  document.getElementById('rpt-export-excel')?.addEventListener('click', () => {
    if (_reportResult) exportResultToExcel(_currentConfig, _reportResult);
    else showToast('Run preview first', 'info');
  });
  document.getElementById('rpt-export-pdf')?.addEventListener('click', () => {
    if (_reportResult) exportResultToPDF(_currentConfig, _reportResult);
    else showToast('Run preview first', 'info');
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildDropdownStr(options, selectedValue, placeholder, inputClasses, dataIdxAttr = '') {
  const selOpt = options.find(o => o.value === selectedValue);
  const label = selOpt ? selOpt.label : placeholder;
  const hasValClass = selectedValue ? ' has-value' : '';
  const idxData = dataIdxAttr !== '' ? ` data-idx="${dataIdxAttr}"` : '';

  let html = `<div class="crm-dd crm-dd--form">`;
  html += `<button type="button" class="crm-dd-trigger${hasValClass}" aria-haspopup="listbox" aria-expanded="false">`;
  html += `<span class="crm-dd-label">${esc(label)}</span>`;
  html += `<span class="crm-dd-chevron"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>`;
  html += `</button><div class="crm-dd-panel" role="listbox"><ul class="crm-dd-list">`;

  if (!selectedValue) {
    html += `<li class="crm-dd-option is-selected" role="option" data-value="" data-label="${esc(placeholder)}"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>${esc(placeholder)}</li>`;
  }

  for (const o of options) {
    const isSel = o.value === selectedValue ? ' is-selected' : '';
    html += `<li class="crm-dd-option${isSel}" role="option" data-value="${esc(o.value)}" data-label="${esc(o.label)}"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>${esc(o.label)}</li>`;
  }

  html += `</ul></div><input class="crm-dd-value-input ${inputClasses}" type="hidden"${idxData} value="${esc(selectedValue || '')}"></div>`;
  return html;
}

function buildDropdownIdStr(id, options, selectedValue, placeholder, inputClasses = '') {
  const selOpt = options.find(o => o.value === selectedValue);
  const label = selOpt ? selOpt.label : placeholder;
  const hasValClass = selectedValue ? ' has-value' : '';

  let html = `<div class="crm-dd crm-dd--form" data-dd-id="${id}">`;
  html += `<button type="button" class="crm-dd-trigger${hasValClass}" aria-haspopup="listbox" aria-expanded="false">`;
  html += `<span class="crm-dd-label">${esc(label)}</span>`;
  html += `<span class="crm-dd-chevron"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>`;
  html += `</button><div class="crm-dd-panel" role="listbox"><ul class="crm-dd-list">`;

  if (!selectedValue && placeholder) {
    html += `<li class="crm-dd-option is-selected" role="option" data-value="" data-label="${esc(placeholder)}"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>${esc(placeholder)}</li>`;
  }

  for (const o of options) {
    const isSel = o.value === selectedValue ? ' is-selected' : '';
    html += `<li class="crm-dd-option${isSel}" role="option" data-value="${esc(o.value)}" data-label="${esc(o.label)}"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>${esc(o.label)}</li>`;
  }

  html += `</ul></div><input class="crm-dd-value-input ${inputClasses}" type="hidden" id="${id}" value="${esc(selectedValue || '')}"></div>`;
  return html;
}

// ── Config Panel: Filters ───────────────────────────────────────────────────

function renderConfigFilters() {
  const area = document.getElementById('rpt-filters-area');
  if (!area) return;
  const source = DATA_SOURCES[_currentConfig.data_source];
  if (!source || !_currentConfig.filters.length) { area.innerHTML = ''; return; }

  area.innerHTML = _currentConfig.filters.map((f, i) => {
    const fieldDef = source.fields.find(fd => fd.key === f.field);
    const fieldType = fieldDef?.type || 'text';
    const operators = FILTER_OPERATORS[fieldType] || FILTER_OPERATORS.text;
    const needsValue = !['is_null', 'not_null'].includes(f.operator);

    const fieldOpts = source.fields.map(fd => ({ value: fd.key, label: fd.label }));
    const opOpts = operators.map(op => ({ value: op.key, label: op.label }));

    return '<div class="rpt-config-filter-row" data-idx="' + i + '">' +
      buildDropdownStr(fieldOpts, f.field, 'Field', 'rpt-cf-field', i) +
      buildDropdownStr(opOpts, f.operator, 'Op', 'rpt-cf-op', i) +
      (needsValue ? renderConfigFilterValue(f, fieldDef, i) : '') +
      '<button class="rpt-config-remove-btn" data-remove-filter="' + i + '"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></div>';
  }).join('');

  area.querySelectorAll('.rpt-cf-field').forEach(sel => {
    sel.addEventListener('change', () => {
      const idx = parseInt(sel.dataset.idx);
      _currentConfig.filters[idx].field = sel.value;
      _currentConfig.filters[idx].operator = '';
      _currentConfig.filters[idx].value = '';
      renderConfigFilters();
    });
  });
  area.querySelectorAll('.rpt-cf-op').forEach(sel => {
    sel.addEventListener('change', () => {
      _currentConfig.filters[parseInt(sel.dataset.idx)].operator = sel.value;
      renderConfigFilters();
      scheduleLivePreview();
    });
  });
  area.querySelectorAll('.rpt-cf-value').forEach(input => {
    input.addEventListener('change', () => {
      _currentConfig.filters[parseInt(input.dataset.idx)].value = input.value;
      scheduleLivePreview();
    });
  });
  area.querySelectorAll('[data-remove-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      _currentConfig.filters.splice(parseInt(btn.dataset.removeFilter), 1);
      renderConfigFilters();
      scheduleLivePreview();
    });
  });
}

function renderConfigFilterValue(filter, fieldDef, idx) {
  if (fieldDef?.type === 'select' && fieldDef.options) {
    const valOpts = fieldDef.options.map(o => ({ value: o, label: formatLabel(o) }));
    return buildDropdownStr(valOpts, filter.value, 'Select...', 'rpt-cf-value', idx);
  }
  if (fieldDef?.type === 'date') return '<input type="date" class="rpt-config-input rpt-cf-value" data-idx="' + idx + '" value="' + esc(filter.value || '') + '">';
  if (fieldDef?.type === 'number') return '<input type="number" class="rpt-config-input rpt-cf-value" data-idx="' + idx + '" value="' + esc(filter.value || '') + '" placeholder="Value">';
  return '<input type="text" class="rpt-config-input rpt-cf-value" data-idx="' + idx + '" value="' + esc(filter.value || '') + '" placeholder="Value">';
}

// ── Config Panel: Relationships ─────────────────────────────────────────────

function renderConfigRelationships() {
  const area = document.getElementById('rpt-rels-area');
  if (!area) return;
  const source = DATA_SOURCES[_currentConfig.data_source];
  if (!source || !_currentConfig.relationships.length) { area.innerHTML = ''; return; }

  area.innerHTML = _currentConfig.relationships.map((rel, i) => {
    const targetSource = DATA_SOURCES[rel.target];
    const targetFields = targetSource?.fields || [];
    const conditionField = targetFields.find(f => f.key === rel.condition);
    const conditionType = conditionField?.type || 'text';
    const operators = FILTER_OPERATORS[conditionType] || FILTER_OPERATORS.text;

    const targetOpts = (source.relationships || []).map(rk => ({ value: rk, label: DATA_SOURCES[rk]?.label || rk }));
    const condOpts = [{ value: '_exists', label: 'exist' }].concat(targetFields.map(f => ({ value: f.key, label: f.label })));

    let row = '<div class="rpt-config-filter-row" data-idx="' + i + '">' +
      buildDropdownStr(targetOpts, rel.target, 'Related to...', 'rpt-cr-target', i) +
      buildDropdownStr(condOpts, rel.condition || '_exists', 'exist', 'rpt-cr-condition', i);

    if (rel.condition && rel.condition !== '_exists') {
      const opOpts = operators.map(op => ({ value: op.key, label: op.label }));
      row += buildDropdownStr(opOpts, rel.operator, 'Op', 'rpt-cr-op', i) +
        '<input type="text" class="rpt-config-input rpt-cr-value" data-idx="' + i + '" value="' + esc(rel.value || '') + '" placeholder="Value">';
    }

    row += '<button class="rpt-config-remove-btn" data-remove-rel="' + i + '"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></div>';
    return row;
  }).join('');

  area.querySelectorAll('.rpt-cr-target').forEach(sel => {
    sel.addEventListener('change', () => {
      const idx = parseInt(sel.dataset.idx);
      _currentConfig.relationships[idx].target = sel.value;
      _currentConfig.relationships[idx].condition = '_exists';
      _currentConfig.relationships[idx].operator = '';
      _currentConfig.relationships[idx].value = '';
      renderConfigRelationships();
      scheduleLivePreview();
    });
  });
  area.querySelectorAll('.rpt-cr-condition').forEach(sel => {
    sel.addEventListener('change', () => {
      _currentConfig.relationships[parseInt(sel.dataset.idx)].condition = sel.value;
      renderConfigRelationships();
    });
  });
  area.querySelectorAll('.rpt-cr-op').forEach(sel => {
    sel.addEventListener('change', () => {
      _currentConfig.relationships[parseInt(sel.dataset.idx)].operator = sel.value;
      scheduleLivePreview();
    });
  });
  area.querySelectorAll('.rpt-cr-value').forEach(input => {
    input.addEventListener('change', () => {
      _currentConfig.relationships[parseInt(input.dataset.idx)].value = input.value;
      scheduleLivePreview();
    });
  });
  area.querySelectorAll('[data-remove-rel]').forEach(btn => {
    btn.addEventListener('click', () => {
      _currentConfig.relationships.splice(parseInt(btn.dataset.removeRel), 1);
      renderConfigRelationships();
      scheduleLivePreview();
    });
  });
}

// ── Config Panel: Metrics ───────────────────────────────────────────────────

function renderConfigMetrics() {
  const area = document.getElementById('rpt-metrics-area');
  if (!area) return;
  const source = DATA_SOURCES[_currentConfig.data_source];
  if (!source) { area.innerHTML = ''; return; }

  const numericFields = source.fields.filter(f => f.type === 'number');

  area.innerHTML = _currentConfig.metrics.map((m, i) => {
    const metricDef = METRIC_TYPES.find(mt => mt.key === m.type);
    const showField = metricDef?.needsField;

    const typeOpts = METRIC_TYPES.map(mt => ({ value: mt.key, label: mt.label }));
    let row = '<div class="rpt-config-metric-row" data-idx="' + i + '">' +
      buildDropdownStr(typeOpts, m.type, 'Type', 'rpt-cm-type', i);

    if (showField) {
      const fieldOpts = numericFields.map(f => ({ value: f.key, label: f.label }));
      row += buildDropdownStr(fieldOpts, m.field, 'Field', 'rpt-cm-field', i);
    }

    if (_currentConfig.metrics.length > 1) {
      row += '<button class="rpt-config-remove-btn" data-remove-metric="' + i + '"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>';
    }

    row += '</div>';
    return row;
  }).join('');

  area.querySelectorAll('.rpt-cm-type').forEach(sel => {
    sel.addEventListener('change', () => {
      const idx = parseInt(sel.dataset.idx);
      _currentConfig.metrics[idx].type = sel.value;
      const mt = METRIC_TYPES.find(m => m.key === sel.value);
      if (!mt?.needsField) _currentConfig.metrics[idx].field = null;
      _currentConfig.metrics[idx].label = mt?.label || sel.value;
      renderConfigMetrics();
      scheduleLivePreview();
    });
  });
  area.querySelectorAll('.rpt-cm-field').forEach(sel => {
    sel.addEventListener('change', () => {
      _currentConfig.metrics[parseInt(sel.dataset.idx)].field = sel.value;
      scheduleLivePreview();
    });
  });
  area.querySelectorAll('[data-remove-metric]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (_currentConfig.metrics.length <= 1) return;
      _currentConfig.metrics.splice(parseInt(btn.dataset.removeMetric), 1);
      renderConfigMetrics();
      scheduleLivePreview();
    });
  });
}

// ── Config Panel: Grouping ──────────────────────────────────────────────────

function renderConfigGrouping() {
  const area = document.getElementById('rpt-grouping-area');
  if (!area) return;
  const source = DATA_SOURCES[_currentConfig.data_source];
  if (!source) { area.innerHTML = ''; return; }

  const g = _currentConfig.grouping || {};
  const fieldDef = source.fields.find(f => f.key === g.field);
  const isDate = fieldDef?.type === 'date';

  const fieldOpts = source.fields.map(f => ({ value: f.key, label: f.label }));
  const intervalOpts = DATE_INTERVALS.map(d => ({ value: d.key, label: d.label }));

  area.innerHTML = '<div class="rpt-config-grouping-row">' +
    buildDropdownIdStr('rpt-group-field', fieldOpts, g.field, 'No grouping') +
    (isDate ? buildDropdownIdStr('rpt-group-interval', intervalOpts, g.interval, 'Interval') : '') + '</div>';

  document.getElementById('rpt-group-field')?.addEventListener('change', function() {
    _currentConfig.grouping = { field: this.value || undefined };
    const fd = source.fields.find(f => f.key === this.value);
    if (fd?.type === 'date') _currentConfig.grouping.interval = 'month';
    renderConfigGrouping();
    scheduleLivePreview();
  });
  document.getElementById('rpt-group-interval')?.addEventListener('change', function() {
    _currentConfig.grouping.interval = this.value;
    scheduleLivePreview();
  });
}

// ── Live Preview ────────────────────────────────────────────────────────────

function scheduleLivePreview() {
  if (_liveDebounce) clearTimeout(_liveDebounce);
  _liveDebounce = setTimeout(() => runLivePreview(), 400);
}

async function runLivePreview() {
  if (_isExecuting) return;
  if (!_currentConfig.data_source) return;

  _isExecuting = true;
  const liveBody = document.getElementById('rpt-live-body');
  if (!liveBody) { _isExecuting = false; return; }

  liveBody.innerHTML = '<div class="rpt-loading"><div class="rpt-spinner"></div><span>Running report\u2026</span></div>';

  try {
    _reportResult = await executeReport(_currentConfig);
    renderLivePreview();
  } catch (e) {
    liveBody.innerHTML = '<div class="rpt-error"><p>Failed to execute report</p><span>' + esc(e.message) + '</span></div>';
  }
  _isExecuting = false;
}

function renderLivePreview() {
  const liveBody = document.getElementById('rpt-live-body');
  if (!liveBody || !_reportResult) return;

  const cfg = _currentConfig;
  const { rows, metrics, groups } = _reportResult;
  const source = DATA_SOURCES[cfg.data_source];
  const viz = cfg.visualization || 'kpi';
  const metricEntries = Object.entries(metrics);

  let html = '';

  if (viz === 'kpi') {
    html += '<div class="rpt-live-kpi">' + metricEntries.map(([label, val]) =>
      '<div class="rpt-live-kpi-item"><div class="rpt-live-kpi-legend"><span class="rpt-live-kpi-dot"></span> ' + esc(label) + '</div><div class="rpt-live-kpi-value">' + formatMetricValue(val, label) + '</div><div class="rpt-live-kpi-unit">Records</div></div>'
    ).join('') + '</div>';
  } else if (viz === 'table') {
    html += renderLiveTable(rows, source, metrics);
  } else if (viz === 'bar' || viz === 'line') {
    html += renderLiveChart(groups, metricEntries);
  } else if (viz === 'funnel') {
    html += renderLiveFunnel(groups);
  }

  html += '<div class="rpt-live-footer">' + rows.length + ' records</div>';
  liveBody.innerHTML = html;

  if ((viz === 'bar' || viz === 'line') && groups?.length) initLiveChart(viz, groups);
  if (window.lucide) setTimeout(() => lucide.createIcons(), 0);
}

function renderLiveTable(rows, source, metrics) {
  if (!source) return '';
  const fields = source.fields.slice(0, 8);
  const displayRows = rows.slice(0, 200);

  return '<div class="rpt-kpi-row rpt-kpi-row--mini">' +
    Object.entries(metrics).map(([label, val]) =>
      '<div class="rpt-kpi-card rpt-kpi-card--mini"><span class="rpt-kpi-value">' + formatMetricValue(val, label) + '</span><span class="rpt-kpi-label">' + esc(label) + '</span></div>'
    ).join('') + '</div><div class="rpt-table-wrap"><table class="rpt-table"><thead><tr>' +
    fields.map(f => '<th>' + esc(f.label) + '</th>').join('') + '</tr></thead><tbody>' +
    displayRows.map(row => '<tr>' + fields.map(f => {
      let val = row[f.key];
      if (f.type === 'date' && val) val = new Date(val).toLocaleDateString();
      else if (f.type === 'number' && val != null) val = Number(val).toLocaleString();
      return '<td>' + esc(String(val ?? '\u2014')) + '</td>';
    }).join('') + '</tr>').join('') + '</tbody></table>' +
    (rows.length > 200 ? '<div class="rpt-table-footer">Showing 200 of ' + rows.length + ' records</div>' : '') + '</div>';
}

function renderLiveChart(groups, metricEntries) {
  if (!groups?.length) return '<div class="rpt-text-muted rpt-viz-empty">Add a "Group By" field to generate a chart.</div>';
  return '<div class="rpt-kpi-row rpt-kpi-row--mini">' +
    metricEntries.map(([label, val]) =>
      '<div class="rpt-kpi-card rpt-kpi-card--mini"><span class="rpt-kpi-value">' + formatMetricValue(val, label) + '</span><span class="rpt-kpi-label">' + esc(label) + '</span></div>'
    ).join('') + '</div><div class="rpt-chart-wrap"><canvas id="rpt-live-chart"></canvas></div>';
}

function initLiveChart(viz, groups) {
  const ctx = document.getElementById('rpt-live-chart')?.getContext('2d');
  if (!ctx || typeof Chart === 'undefined') return;

  const labels = groups.map(g => formatLabel(g.label));
  const metricKey = Object.keys(groups[0]?.metrics || {})[0];
  const values = groups.map(g => metricKey ? g.metrics[metricKey] : g.count);

  const canvasId = 'rpt-live-chart';
  if (state.chartInstances[canvasId]) state.chartInstances[canvasId].destroy();

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const textColor = isDark ? '#c9d1d9' : '#3d4249';
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  const dataset = viz === 'line' ? {
    label: metricKey || 'Count', data: values, borderColor: 'rgba(47, 95, 208, 1)',
    backgroundColor: 'rgba(47, 95, 208, 0.08)', fill: true, tension: 0.3, pointRadius: 3, pointHoverRadius: 5,
  } : {
    label: metricKey || 'Count', data: values, backgroundColor: getChartColors(labels.length),
    borderRadius: 4, borderSkipped: false, maxBarThickness: 48,
  };

  state.chartInstances[canvasId] = new Chart(ctx, {
    type: viz, data: { labels, datasets: [dataset] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: {
        backgroundColor: isDark ? '#1c1c1e' : '#fff', titleColor: textColor, bodyColor: textColor,
        borderColor: isDark ? '#333' : '#dee2e6', borderWidth: 1, padding: 10, cornerRadius: 6, displayColors: false,
      }},
      scales: {
        x: { ticks: { color: textColor, font: { size: 11 } }, grid: { display: false } },
        y: { ticks: { color: textColor, font: { size: 11 } }, grid: { color: gridColor }, beginAtZero: true },
      },
    },
  });
}

function renderLiveFunnel(groups) {
  if (!groups?.length) return '<div class="rpt-text-muted rpt-viz-empty">Add a "Group By" field to generate a funnel view.</div>';

  const metricKey = Object.keys(groups[0]?.metrics || {})[0];
  const sorted = [...groups].sort((a, b) => (metricKey ? b.metrics[metricKey] : b.count) - (metricKey ? a.metrics[metricKey] : a.count));
  const maxVal = metricKey ? sorted[0]?.metrics[metricKey] : sorted[0]?.count;
  const colors = getChartColors(sorted.length);

  return '<div class="rpt-funnel">' + sorted.map((g, i) => {
    const val = metricKey ? g.metrics[metricKey] : g.count;
    const pct = maxVal > 0 ? (val / maxVal * 100) : 0;
    return '<div class="rpt-funnel-stage"><div class="rpt-funnel-bar-wrap"><div class="rpt-funnel-bar" style="width:' + Math.max(pct, 8) + '%;background:' + colors[i] + '"></div></div><div class="rpt-funnel-info"><span class="rpt-funnel-label">' + esc(formatLabel(g.label)) + '</span><span class="rpt-funnel-value">' + formatMetricValue(val) + '</span></div></div>';
  }).join('') + '</div>';
}

// ── Save Handler ────────────────────────────────────────────────────────────

async function handleSave() {
  if (!_currentConfig.data_source) { showToast('Select a data source first', 'error'); return; }
  if (!_currentConfig.name?.trim()) {
    _currentConfig.name = (DATA_SOURCES[_currentConfig.data_source]?.label || 'Report') + ' \u2014 ' + new Date().toLocaleDateString();
  }
  for (const m of _currentConfig.metrics) {
    const mt = METRIC_TYPES.find(t => t.key === m.type);
    if (mt?.needsField && !m.field) { showToast('Metric "' + mt.label + '" requires a numeric field', 'error'); return; }
  }
  try {
    const config = { ..._currentConfig };
    if (_editingReportId) config.id = _editingReportId;
    const saved = await saveReport(config);
    _editingReportId = saved.id;
    showToast('Report saved', 'success');
    switchMode('dashboard');
    await renderDashboardView();
  } catch { showToast('Failed to save report', 'error'); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT — Excel (CSV) & PDF
// ═══════════════════════════════════════════════════════════════════════════════

async function exportReportToExcel(reportConfig) {
  try {
    showToast('Generating Excel...', 'info');
    const result = await executeReport(reportConfig);
    exportResultToExcel(reportConfig, result);
  } catch { showToast('Failed to generate Excel', 'error'); }
}

function exportResultToExcel(config, result) {
  const source = DATA_SOURCES[config.data_source];
  if (!source) { showToast('Unknown data source', 'error'); return; }

  const fields = source.fields;
  const rows = result.rows || [];
  const metrics = result.metrics || {};

  let csv = '"Report: ' + (config.name || 'Untitled').replace(/"/g, '""') + '"\n';
  csv += '"Data Source: ' + source.label + '"\n';
  csv += '"Generated: ' + new Date().toLocaleString() + '"\n';
  csv += '"Total Records: ' + rows.length + '"\n\n';

  const metricEntries = Object.entries(metrics);
  if (metricEntries.length) {
    csv += '"Metrics"\n';
    for (const [label, val] of metricEntries) csv += '"' + label.replace(/"/g, '""') + '","' + val + '"\n';
    csv += '\n';
  }

  if (result.groups?.length) {
    csv += '"Group","Count"';
    const gMetricKeys = Object.keys(result.groups[0]?.metrics || {});
    for (const k of gMetricKeys) csv += ',"' + k.replace(/"/g, '""') + '"';
    csv += '\n';
    for (const g of result.groups) {
      csv += '"' + String(g.label).replace(/"/g, '""') + '","' + g.count + '"';
      for (const k of gMetricKeys) csv += ',"' + (g.metrics[k] ?? '') + '"';
      csv += '\n';
    }
    csv += '\n';
  }

  csv += fields.map(f => '"' + f.label.replace(/"/g, '""') + '"').join(',') + '\n';
  for (const row of rows) {
    csv += fields.map(f => {
      let val = row[f.key];
      if (val == null) return '""';
      if (f.type === 'date' && val) val = new Date(val).toLocaleDateString();
      return '"' + String(val).replace(/"/g, '""') + '"';
    }).join(',') + '\n';
  }

  downloadFile(csv, sanitizeFilename(config.name || 'report') + '.csv', 'text/csv;charset=utf-8;');
  showToast('Excel (CSV) downloaded', 'success');
}

async function exportReportToPDF(reportConfig) {
  try {
    showToast('Generating PDF...', 'info');
    const result = await executeReport(reportConfig);
    exportResultToPDF(reportConfig, result);
  } catch { showToast('Failed to generate PDF', 'error'); }
}

function exportResultToPDF(config, result) {
  const source = DATA_SOURCES[config.data_source];
  if (!source) { showToast('Unknown data source', 'error'); return; }

  const fields = source.fields;
  const rows = result.rows || [];
  const metrics = result.metrics || {};
  const groups = result.groups || [];

  let metricsHtml = '';
  const metricEntries = Object.entries(metrics);
  if (metricEntries.length) {
    metricsHtml = '<div style="display:flex;gap:16px;margin-bottom:20px;flex-wrap:wrap;">' +
      metricEntries.map(([label, val]) =>
        '<div style="background:#f8f9fa;border:1px solid #dee2e6;border-radius:8px;padding:12px 20px;min-width:120px;"><div style="font-size:22px;font-weight:700;color:#1a1a1a;">' + formatMetricValue(val, label) + '</div><div style="font-size:12px;color:#6c757d;">' + escHtml(label) + '</div></div>'
      ).join('') + '</div>';
  }

  let groupsHtml = '';
  if (groups.length) {
    const gMetricKeys = Object.keys(groups[0]?.metrics || {});
    groupsHtml = '<h3 style="font-size:14px;margin:16px 0 8px 0;color:#333;">Grouped Results</h3><table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:20px;"><thead><tr><th style="text-align:left;padding:6px 8px;border-bottom:2px solid #dee2e6;color:#6c757d;font-size:11px;text-transform:uppercase;">Group</th><th style="text-align:right;padding:6px 8px;border-bottom:2px solid #dee2e6;color:#6c757d;font-size:11px;text-transform:uppercase;">Count</th>' +
      gMetricKeys.map(k => '<th style="text-align:right;padding:6px 8px;border-bottom:2px solid #dee2e6;color:#6c757d;font-size:11px;text-transform:uppercase;">' + escHtml(k) + '</th>').join('') +
      '</tr></thead><tbody>' + groups.map(g =>
        '<tr><td style="padding:4px 8px;border-bottom:1px solid #eee;">' + escHtml(String(g.label)) + '</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;">' + g.count + '</td>' +
        Object.values(g.metrics || {}).map(v => '<td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;">' + v + '</td>').join('') + '</tr>'
      ).join('') + '</tbody></table>';
  }

  const maxRows = Math.min(rows.length, 500);
  const tableHtml = '<h3 style="font-size:14px;margin:16px 0 8px 0;color:#333;">Data (' + rows.length + ' records' + (rows.length > 500 ? ', showing first 500' : '') + ')</h3><table style="width:100%;border-collapse:collapse;font-size:11px;"><thead><tr>' +
    fields.map(f => '<th style="text-align:left;padding:4px 6px;border-bottom:2px solid #dee2e6;color:#6c757d;font-size:10px;text-transform:uppercase;white-space:nowrap;">' + escHtml(f.label) + '</th>').join('') +
    '</tr></thead><tbody>' + rows.slice(0, maxRows).map(row =>
      '<tr>' + fields.map(f => {
        let val = row[f.key];
        if (f.type === 'date' && val) val = new Date(val).toLocaleDateString();
        else if (f.type === 'number' && val != null) val = Number(val).toLocaleString();
        return '<td style="padding:3px 6px;border-bottom:1px solid #eee;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;">' + escHtml(String(val ?? '\u2014')) + '</td>';
      }).join('') + '</tr>'
    ).join('') + '</tbody></table>';

  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + escHtml(config.name || 'Report') + '</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:32px;color:#1a1a1a}@media print{body{margin:16px}}</style></head><body><div style="margin-bottom:24px;"><h1 style="font-size:20px;margin:0 0 4px 0;">' + escHtml(config.name || 'Untitled Report') + '</h1><div style="font-size:12px;color:#6c757d;">' + escHtml(source.label) + ' \u00b7 Generated ' + new Date().toLocaleString() + '</div></div>' + metricsHtml + groupsHtml + tableHtml + '</body></html>';

  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
    showToast('PDF print dialog opened', 'success');
  } else {
    showToast('Pop-up blocked. Allow pop-ups for PDF export.', 'error');
  }
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function sanitizeFilename(name) {
  return (name || 'report').replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_').slice(0, 100);
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function esc(s) {
  const el = document.createElement('span');
  el.textContent = String(s ?? '');
  return el.innerHTML;
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatLabel(val) {
  if (!val || val === '(empty)') return '(empty)';
  return String(val).replace(/_/g, ' ').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatMetricValue(val, label) {
  if (typeof val !== 'number') return String(val);
  const lowerLabel = (label || '').toLowerCase();
  if (lowerLabel.includes('value') || lowerLabel.includes('revenue') || lowerLabel.includes('sum')) {
    const sym = getCurrencySymbol();
    if (Math.abs(val) >= 1000000) return sym + (val / 1000000).toFixed(1) + 'M';
    if (Math.abs(val) >= 1000) return sym + (val / 1000).toFixed(1) + 'K';
    return sym + Math.round(val).toLocaleString();
  }
  if (val % 1 !== 0) return val.toFixed(1);
  return val.toLocaleString();
}

function relTime(date) {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 7) return days + 'd ago';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getChartColors(count) {
  const palette = ['#2f5fd0','#8b5cf6','#10b981','#f59e0b','#ef4444','#06b6d4','#ec4899','#84cc16','#f97316','#6366f1','#14b8a6','#e11d48','#a855f7','#0ea5e9','#eab308'];
  return Array.from({ length: count }, (_, i) => palette[i % palette.length]);
}

// ── Exports ─────────────────────────────────────────────────────────────────

export {
  renderReportsView,
  openBuilder as openReportBuilder,
  refreshDashboard as refreshAllWidgets,
};
