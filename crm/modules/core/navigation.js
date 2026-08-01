// modules/core/navigation.js
// Sidebar open/close, active nav highlight, view loader.
import { state, saveViewState } from '../state.js';

import { sidebar, sidebarOverlay, viewContainer, pageLabel, pageLabelIcon, pageLabelText } from '../ui/dom.js';
import { showToast } from '../ui/toast.js';
import { renderAccessDenied, renderNotFound } from '../utils/helpers.js';
import { checkDueReminders } from '../features/notifications.js';
// Feature views are loaded via lazy-load proxy wrappers defined on the global window object.

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
  _expandSectionForView(viewName);
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
        try { if (window.lucide) lucide.createIcons(); } catch (e) { }
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
  // Preserve the previously active view so settings can return the user back.
  if (viewName === 'settings' && state.currentView !== 'settings') {
    state.previousView = state.currentView;
  }
  state.currentView = viewName;
  updateActiveNav(viewName);

  try {
    const mainContent = document.querySelector('.main-content');
    const notesView = document.getElementById('notes-view-container');
    const isNotes = viewName === 'notes';
    
    if (mainContent) {
      const fullBleedViews = ['companies', 'people'];
      mainContent.classList.toggle('full-bleed', fullBleedViews.includes(viewName));
      mainContent.style.display = isNotes ? 'none' : '';
    }
    
    if (notesView) {
      notesView.style.display = isNotes ? 'flex' : 'none';
      // If entering notes view, ensure the main viewContainer is empty to prevent ghosting
      if (isNotes && viewContainer) viewContainer.innerHTML = '';
    }
  } catch (e) { }

  // Prevent technicians from accessing certain views
  const blockedForTechnician = ['sales-funnel', 'opportunity-pipeline', 'call-logs', 'companies', 'people'];
  // Managers-only views that technicians cannot access
  const managerOnlyViews = ['submissions', 'forms', 'workflows', 'reports', 'route-planning', 'team-dashboard', 'main-dashboard', 'user-management'];
  if (state.isTechnician && (blockedForTechnician.includes(viewName) || managerOnlyViews.includes(viewName))) {
    showToast('You do not have permission to access this view', 'error');
    return;
  }

  // Destroy existing charts
  Object.keys(state.chartInstances).forEach(chartId => {
    if (state.chartInstances[chartId]) {
      state.chartInstances[chartId].destroy();
      delete state.chartInstances[chartId];
    }
  });

  localStorage.setItem('lastActiveView', viewName);

  switch (viewName) {
    case 'log-visit':
      await window.renderLogVisitView();
      break;
    case 'my-activity':
      await window.renderMyActivityView();
      break;
    case 'notes':
      await window.renderNotesView();
      break;
    case 'sales-funnel':
      await window.renderSalesFunnelView();
      break;
    case 'opportunity-pipeline':
      await window.renderOpportunityPipelineView();
      break;
    case 'main-dashboard':
      if (state.isManager) {
        await window.renderProfessionalDashboardView();
      } else {
        viewContainer.innerHTML = renderAccessDenied();
      }
      break;
    case 'team-dashboard':
      if (state.isManager) {
        await window.renderTeamDashboardView();
      } else {
        viewContainer.innerHTML = renderAccessDenied();
      }
      break;
    case 'route-planning':
      if (state.isManager) {
        await window.renderRoutePlanningView();
      } else {
        viewContainer.innerHTML = renderAccessDenied();
      }
      break;
    case 'my-routes':
      await window.renderMyRoutesView();
      break;
    case 'user-management':
      await window.renderUserManagementView();
      break;
    case 'companies':
      await window.renderCompaniesView();
      break;
    case 'people':
      await window.renderPeopleView();
      break;
    case 'tasks':
      await window.renderTasksView();
      break;
    case 'technician-log-visit':
      if (state.isTechnician) {
        await window.renderTechnicianLogVisitView();
      } else {
        viewContainer.innerHTML = renderAccessDenied();
      }
      break;
    case 'technician-activity':
      if (state.isTechnician) {
        await window.renderTechnicianActivityView();
      } else {
        viewContainer.innerHTML = renderAccessDenied();
      }
      break;
    case 'technicians-dashboard': // backward compat — redirect to submissions
      state.currentView = 'submissions';
      localStorage.setItem('lastActiveView', 'submissions');
      updateActiveNav('submissions');
      /* falls through */
    case 'submissions':
      if (state.isManager) {
        await window.renderSubmissionsView();
      } else {
        viewContainer.innerHTML = renderAccessDenied();
      }
      break;
    case 'forms':
      if (state.isManager) {
        await window.renderFormsView();
      } else {
        viewContainer.innerHTML = renderAccessDenied();
      }
      break;
    case 'contracts':
      await window.renderContractsView();
      break;
    case 'reminders':
      await window.renderRemindersView();
      break;
    case 'call-logs':
      await window.renderCallLogsView();
      break;
    case 'settings':
      await window.renderSettingsView();
      break;
    case 'reports':
      await window.renderReportsView();
      break;
    case 'workflows':
      await window.renderWorkflowsView();
      break;
    case 'manuals':
      await window.renderManualsView();
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


// ── Collapsible nav sections ───────────────────────────────────────────────────

const _NAV_COLLAPSED_KEY = 'safitrack_nav_collapsed';

function _getCollapsed() {
  try { return new Set(JSON.parse(localStorage.getItem(_NAV_COLLAPSED_KEY) || '[]')); } catch { return new Set(); }
}

function _saveCollapsed(set) {
  try { localStorage.setItem(_NAV_COLLAPSED_KEY, JSON.stringify([...set])); } catch {}
}

export function initCollapsibleSections() {
  const collapsed = _getCollapsed();

  document.querySelectorAll('.sidebar-nav .nav-section').forEach(section => {
    const titleEl = section.querySelector(':scope > .nav-section-title');
    if (!titleEl) return;

    // Capture name before any DOM changes
    const sectionName = titleEl.textContent.trim().toLowerCase();
    section.dataset.sectionName = sectionName;

    // Wrap items: outer = grid container (1 row), inner = single grid child
    const itemsWrap = document.createElement('div');
    itemsWrap.className = 'nav-section-items';
    const itemsInner = document.createElement('div');
    [...section.children]
      .filter(el => !el.classList.contains('nav-section-title'))
      .forEach(el => itemsInner.appendChild(el));
    itemsWrap.appendChild(itemsInner);
    section.appendChild(itemsWrap);

    // Add chevron SVG to the title
    const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chevron.setAttribute('class', 'nav-section-chevron');
    chevron.setAttribute('viewBox', '0 0 24 24');
    chevron.setAttribute('fill', 'none');
    chevron.setAttribute('stroke', 'currentColor');
    chevron.setAttribute('stroke-width', '2.5');
    chevron.setAttribute('stroke-linecap', 'round');
    chevron.setAttribute('stroke-linejoin', 'round');
    chevron.setAttribute('aria-hidden', 'true');
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    poly.setAttribute('points', '6 9 12 15 18 9');
    chevron.appendChild(poly);
    titleEl.appendChild(chevron);

    // Apply persisted collapsed state (never collapse a section with the active item)
    const hasActiveItem = section.querySelector('.nav-item.active');
    if (collapsed.has(sectionName) && !hasActiveItem) {
      section.classList.add('collapsed');
    }

    titleEl.addEventListener('click', () => {
      const isNowCollapsed = section.classList.toggle('collapsed');
      const set = _getCollapsed();
      if (isNowCollapsed) set.add(sectionName);
      else set.delete(sectionName);
      _saveCollapsed(set);
    });

    titleEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); titleEl.click(); }
    });
  });
}

// Auto-expand the section containing the newly active nav item
function _expandSectionForView(viewName) {
  const btn = document.querySelector(`.sidebar-nav [data-view="${viewName}"]`);
  if (!btn) return;
  const section = btn.closest('.nav-section');
  if (!section || !section.classList.contains('collapsed')) return;
  section.classList.remove('collapsed');
  const sectionName = section.dataset.sectionName;
  if (sectionName) {
    const set = _getCollapsed();
    set.delete(sectionName);
    _saveCollapsed(set);
  }
}


// ── Exports ────────────────────────────────────────────────────────────────────
export {
  openSidebar,
  closeSidebar,
  updateActiveNav,
  loadView,
};
