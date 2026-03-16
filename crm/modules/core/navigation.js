// modules/core/navigation.js
// Sidebar open/close, active nav highlight, view loader.
import { state, saveViewState } from '../state.js';

import { sidebar, sidebarOverlay, viewContainer, pageLabel, pageLabelIcon, pageLabelText } from '../ui/dom.js';
import { showToast } from '../ui/toast.js';
import { renderAccessDenied, renderNotFound } from '../utils/helpers.js';
import { checkDueReminders } from '../features/notifications.js';
import { renderLogVisitView } from '../features/log-visit.js';
import { renderMyActivityView } from '../features/my-activity.js';
import { renderSalesFunnelView } from '../features/sales-funnel.js';
import { renderOpportunityPipelineView } from '../features/opportunities.js';
import { renderProfessionalDashboardView } from '../features/dashboard.js';
import { renderTeamDashboardView } from '../features/team-dashboard.js';
import { renderRoutePlanningView } from '../features/route-planning.js';
import { renderMyRoutesView } from '../features/my-routes.js';
import { renderUserManagementView } from '../features/user-management.js';
import { renderCompaniesView } from '../features/companies.js';
import { renderPeopleView } from '../features/people.js';
import { renderTasksView } from '../features/tasks.js';
import { renderTechnicianLogVisitView, renderTechnicianActivityView, renderTechniciansDashboardView } from '../features/technician.js';
import { renderRemindersView } from '../features/reminders.js';
import { renderCallLogsView } from '../features/call-logs.js';
import { renderSettingsView } from '../features/settings.js';
import { renderNotesView } from '../features/notes.js';

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
  if (state.isTechnician && blockedForTechnician.includes(viewName)) {
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
      if (state.isManager) {
        await renderProfessionalDashboardView();
      } else {
        viewContainer.innerHTML = renderAccessDenied();
      }
      break;
    case 'team-dashboard':
      if (state.isManager) {
        await renderTeamDashboardView();
      } else {
        viewContainer.innerHTML = renderAccessDenied();
      }
      break;
    case 'route-planning':
      if (state.isManager) {
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
      if (state.isTechnician) {
        await renderTechnicianLogVisitView();
      } else {
        viewContainer.innerHTML = renderAccessDenied();
      }
      break;
    case 'technician-activity':
      if (state.isTechnician) {
        await renderTechnicianActivityView();
      } else {
        viewContainer.innerHTML = renderAccessDenied();
      }
      break;
    case 'technicians-dashboard':
      if (state.isManager) {
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


// ── Exports ────────────────────────────────────────────────────────────────────
export {
  openSidebar,
  closeSidebar,
  updateActiveNav,
  loadView,
};
