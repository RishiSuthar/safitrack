/**
 * crm/app.js  —  SafiTrack CRM Entry Point  (ES Module)
 *
 * This file is the thin orchestrator for the modular SafiTrack CRM.
 * All business logic lives in ./modules/*.
 *
 * Responsibilities:
 *  1. Import every module so the browser loads and executes it.
 *  2. Expose public functions to window for HTML inline handlers
 *     and non-module sibling scripts (aichat.js, ai.js, onboarding.js).
 *  3. Create live-binding proxies so bare identifiers like `currentUser`
 *     still work in non-module scripts.
 *  4. Bootstrap the application on DOMContentLoaded.
 */

// ── State & Client ────────────────────────────────────────────────────────────
import { state, supabaseClient } from './modules/state.js';

// ── Core ──────────────────────────────────────────────────────────────────────
import {
  initTheme, initAuth, initEventListeners,
  handleLogin, handleLogout, switchAuthPane, handleGoogleAuth,
  handleCompleteGoogleProfile, goToSignupStep, handleSignup,
  handleResendVerification, openInviteModal, closeInviteModal, handleInviteSubmit,
} from './modules/core/auth.js';

import {
  initApp, loadAllPeople, loadAllCompanies, updateUserDisplay, updateNavigationForRole,
} from './modules/core/app-init.js';

import { openSidebar, closeSidebar, updateActiveNav, loadView } from './modules/core/navigation.js';

// ── UI modules ────────────────────────────────────────────────────────────────
import {
  escapeHtml, showInlineSuccess, showToast, handleImageError, triggerConfetti, getInitials,
} from './modules/ui/toast.js';

import './modules/ui/modals.js';

import {
  renderEditableDataTable, getDeepValue, getCompanyLogoUrl, normalizeSearchText,
  normalizeForMatching, findCompanyForOpportunity, slugifyForDomain, getGoogleFaviconUrl,
  guessDomainAndFavicon, matchesTokenizedQuery, normalizeEmailValue, normalizePhoneValue,
  findDuplicateCompanyByName, findDuplicatePersonContact, makeCellEditable,
  initResize, handleResizeMove, handleGenerateCompanyDescription, stopResize,
  handleCellUpdate, sortData, handleHeaderSort, refreshCurrentView,
} from './modules/ui/spreadsheet.js';

import { updateBottomActionBar, clearSelection, handleBatchDelete } from './modules/ui/batch-selection.js';
import { openCommandPalette, closeCommandPalette, openQuickActions, closeQuickActions, openSearchRecords, closeSearchRecords } from './modules/ui/command-palette.js';
import { initPWA, attemptShowPWABanner } from './modules/ui/pwa.js';
import { showCompressionProgress, hideCompressionProgress } from './modules/ui/sidebar-resize.js';
import { showMentionSuggestions, setActiveMention, insertMentionFromSuggestion } from './modules/ui/mention.js';
import { initMobileOptimizations } from './modules/ui/mobile-optimize.js';
import { initMobileNavigation } from './modules/ui/mobile-navigation.js';

// ── Utils ─────────────────────────────────────────────────────────────────────
import {
  formatDate, getDisplayNameFromProfile, getLeadScoreBadge, parseMarkdown,
  renderSkeletonCards, renderError, renderAccessDenied, renderNotFound, renderTags,
} from './modules/utils/helpers.js';

import {
  geocodeAddressWithOSM, calculateDistance, buildOverpassQuery, searchNearbyOverpass, renderNearbySuggestions,
} from './modules/utils/geo.js';

// ── Realtime ──────────────────────────────────────────────────────────────────
import {
  clearSafiNudgeTimers, getSafiNudgeContainer, queueSafiNudge, hideSafiNudgeCard,
  renderNextSafiNudge, handleIncomingSafiNudge, stopSafiNudgeRealtime,
  scheduleSafiNudgeReconnect, startSafiNudgeRealtime, ensureSafiNudgeReady,
  getSafiNudgeModal, populateSafiNudgeRecipients, sendSafiNudge,
} from './modules/realtime/nudge.js';

// ── Features ──────────────────────────────────────────────────────────────────
import { renderSettingsView } from './modules/features/settings.js';

import {
  renderCompaniesView, openCompanyModal, initCompanyModalListeners,
  addCategory, removeCategory, renderCategories,
} from './modules/features/companies.js';

import {
  renderPeopleView, openPersonModal, openPersonViewModal, initPersonModalListeners,
  addPhoneNumber, renderPhoneNumbers,
} from './modules/features/people.js';

import { renderLogVisitView, initLogVisitForm, geocodeAddress } from './modules/features/log-visit.js';
import { renderMyActivityView, renderVisitCard } from './modules/features/my-activity.js';
import { renderSalesFunnelView } from './modules/features/sales-funnel.js';

import {
  renderOpportunityPipelineView, updateOpportunityLogosAsync, initOpportunityEventListeners,
  initPipelineDragAndDrop, updatePipelineStageCounts, updatePipelineSummary,
  initPipelineFilters, openOpportunityModal, openOpportunityViewModal,
  initOpportunityModalListeners, addCompetitor, getProbabilityColor, scheduleNextStepReminder,
} from './modules/features/opportunities.js';

import {
  getNotificationPermission, requestNotificationPermission, readJsonStorage, writeJsonStorage,
  formatDueLabel, getDueStatus, mapTaskToDueNotification, mapReminderToDueNotification,
  mapOpportunityToDueNotification, fetchDueNotificationItems, renderDueNotificationsUI,
  updateNotificationPermissionCTA, pushDeviceNotification, getDuePopupContainer,
  clearDuePopupTimers, showDuePopup, notifyForNewDueItems, markAllDueNotificationsRead,
  refreshDueNotifications, startDueNotificationsMonitor, stopDueNotificationsMonitor,
  handleDueNotificationVisibility, checkDueReminders,
} from './modules/features/notifications.js';

import {
  renderTeamDashboardView, isToday, isThisWeek, isLastWeek, isYesterday,
  renderVisitsCards, renderVisitsTimeline, renderActivityTimeline, renderLeaderboard,
  getRelativeTime, initVisitsHub, switchVisitsView, updateFilterCountBadge,
  updateFilterState, applyVisitsFilters, clearAllFilters, closeVisitDetail,
  fetchAndOpenVisit, openPhotoModal, closePhotoModal, initVisitsMap, debounce, generateVisitPDF,
} from './modules/features/team-dashboard.js';

import { renderUserManagementView } from './modules/features/user-management.js';

import {
  groupRoutesByLocations, renderRoutePlanningView, initRoutePlanning, initRouteList,
  initAISafiPlan, openAISafiPlanModal, initAISafiPlanLogic, viewRouteDetails, editRoute,
} from './modules/features/route-planning.js';

import { renderMyRoutesView } from './modules/features/my-routes.js';
import { startRouteNavigation, completeRoute } from './modules/features/route-navigation.js';

import {
  renderTasksView, renderKanbanTaskCard, initKanbanBoard, updateColumnCounts,
  showTaskDetail, renderTaskCard, getStatusLabel, initTaskFilters,
  initTaskActionButtons, openTaskModal, initTaskModalListeners,
} from './modules/features/tasks.js';

import {
  renderRemindersView, initReminderFilters, initReminderActionButtons,
  openReminderModal, initReminderModalListeners,
} from './modules/features/reminders.js';

import {
  escapeCsvValue, downloadCsvFile, downloadCompaniesSampleCsv, parseCsv,
  normalizeCompanyCsvHeader, parseCompanyType, parseCategoriesCell,
  exportAllCompaniesToCsv, runCompaniesImportFromCsv,
} from './modules/features/import-export.js';

import {
  renderTechnicianLogVisitView, renderTechnicianActivityView, renderTechniciansDashboardView,
} from './modules/features/technician.js';

import {
  renderNotesView, updateNotesSidebar, renderNotesTags, renderNotesGrid, attachNotesViewEvents,
  openNoteSlideOver, closeNoteSlideOver, deleteNoteRecord, saveActiveNote, createNewNoteV2,
  togglePinActiveNote, deleteActiveNote, handleNoteTagging, showNotePersonSuggestions,
  showNoteCompanySuggestions, renderNoteSuggestions, hideNoteTaggingSuggestions, insertNoteTag,
} from './modules/features/notes.js';

import { renderProfessionalDashboardView } from './modules/features/dashboard.js';

import { renderReportsView, openReportBuilder, refreshAllWidgets } from './modules/features/reports.js';

import {
  renderWorkflowsView, openWorkflowBuilder, closeWorkflowBuilder, saveWorkflow,
  deleteWorkflow, toggleWorkflowActive, openTriggerPicker, removeTrigger,
  openActionPicker, openActionEditor, removeAction, confirmActionEdit,
  closePanel as closeWorkflowPanel, onWorkflowNameChange, toggleBuilderActive,
} from './modules/features/workflows.js';

import {
  submitChangePassword, renderCallLogsView, deleteCallLog, openCallLogViewModal,
  openCompanyViewModal, openCallLogModal, initCallLogSearch, saveCallLog,
} from './modules/features/call-logs.js';

// ══════════════════════════════════════════════════════════════════════════════
//  WINDOW BRIDGE
//  Expose functions for HTML inline handlers and non-module sibling scripts.
// ══════════════════════════════════════════════════════════════════════════════
Object.assign(window, {
  // State / client (non-module scripts like aichat.js / ai.js need these)
  supabaseClient,
  state,

  // Core
  loadView, openSidebar, closeSidebar, updateActiveNav,

  // Auth
  handleLogin, handleLogout, switchAuthPane, handleGoogleAuth,
  handleCompleteGoogleProfile, goToSignupStep, handleSignup,
  handleResendVerification, openInviteModal, closeInviteModal, handleInviteSubmit,

  // Utils
  showToast, escapeHtml, showInlineSuccess, triggerConfetti, getInitials, handleImageError,
  formatDate, getDisplayNameFromProfile, getLeadScoreBadge, parseMarkdown,
  renderSkeletonCards, renderError, renderAccessDenied, renderNotFound, renderTags,
  geocodeAddressWithOSM, calculateDistance, buildOverpassQuery, searchNearbyOverpass,
  renderNearbySuggestions, debounce,

  // Spreadsheet / table engine
  renderEditableDataTable, getDeepValue, getCompanyLogoUrl, normalizeSearchText,
  normalizeForMatching, findCompanyForOpportunity, slugifyForDomain, getGoogleFaviconUrl,
  guessDomainAndFavicon, matchesTokenizedQuery, normalizeEmailValue, normalizePhoneValue,
  findDuplicateCompanyByName, findDuplicatePersonContact, makeCellEditable,
  initResize, handleResizeMove, handleGenerateCompanyDescription, stopResize,
  handleCellUpdate, sortData, handleHeaderSort, refreshCurrentView,

  // Batch selection
  updateBottomActionBar, clearSelection, handleBatchDelete,

  // Command palette / Quick Actions / Search Records
  openCommandPalette, closeCommandPalette,
  openQuickActions, closeQuickActions,
  openSearchRecords, closeSearchRecords,

  // PWA
  initPWA, attemptShowPWABanner, showCompressionProgress, hideCompressionProgress,

  // Mention system
  showMentionSuggestions, setActiveMention, insertMentionFromSuggestion,

  // Settings
  renderSettingsView,

  // Companies
  renderCompaniesView, openCompanyModal, addCategory, removeCategory, renderCategories,

  // People
  renderPeopleView, openPersonModal, openPersonViewModal, addPhoneNumber, renderPhoneNumbers,

  // Log Visit
  renderLogVisitView, geocodeAddress,

  // My Activity
  renderMyActivityView, renderVisitCard,

  // Sales Funnel
  renderSalesFunnelView,

  // Opportunities
  renderOpportunityPipelineView, openOpportunityModal, openOpportunityViewModal,
  addCompetitor, getProbabilityColor, initPipelineDragAndDrop,

  // Notifications
  requestNotificationPermission, markAllDueNotificationsRead,
  updateNotificationPermissionCTA, refreshDueNotifications,
  startDueNotificationsMonitor, stopDueNotificationsMonitor, checkDueReminders,

  // Nudge
  startSafiNudgeRealtime, stopSafiNudgeRealtime, sendSafiNudge, populateSafiNudgeRecipients,

  // Team Dashboard
  renderTeamDashboardView, applyVisitsFilters, clearAllFilters, closeVisitDetail,
  fetchAndOpenVisit, openPhotoModal, closePhotoModal, generateVisitPDF, switchVisitsView,

  // User Management
  renderUserManagementView,

  // Route Planning
  renderRoutePlanningView, viewRouteDetails, editRoute, openAISafiPlanModal,

  // My Routes
  renderMyRoutesView,

  // Route Navigation
  startRouteNavigation, completeRoute,

  // Tasks
  renderTasksView, openTaskModal, showTaskDetail,

  // Reminders
  renderRemindersView, openReminderModal,

  // Import / Export
  exportAllCompaniesToCsv, runCompaniesImportFromCsv, downloadCompaniesSampleCsv,

  // Technician
  renderTechnicianLogVisitView, renderTechnicianActivityView,
  renderTechniciansDashboardView,

  // Notes
  renderNotesView, openNoteSlideOver, closeNoteSlideOver, saveActiveNote,
  createNewNoteV2, togglePinActiveNote, deleteActiveNote,

  // Dashboard
  renderProfessionalDashboardView,

  // Call Logs
  renderCallLogsView, deleteCallLog, openCallLogViewModal, openCompanyViewModal,
  openCallLogModal, saveCallLog, submitChangePassword,

  // Reports & Dashboard
  renderReportsView, openReportBuilder, refreshAllWidgets,

  // Workflows
  renderWorkflowsView, openWorkflowBuilder, closeWorkflowBuilder, saveWorkflow,
  deleteWorkflow, toggleWorkflowActive, openTriggerPicker, removeTrigger,
  openActionPicker, openActionEditor, removeAction, confirmActionEdit,
  closePanel: closeWorkflowPanel, onWorkflowNameChange, toggleBuilderActive,
});

// ── Live-binding proxies ───────────────────────────────────────────────────────
// Non-module scripts (aichat.js, etc.) access state vars as plain globals.
// We proxy them through the shared `state` object so mutations in module code
// are immediately visible to non-module scripts and vice-versa.
const STATE_GLOBALS = [
  'currentUser', 'isManager', 'isSalesRep', 'isTechnician',
  'currentView', 'previousView', 'currentUserProfile', 'currentOrganization',
  'orgCurrency',
  'allPeople', 'visitTags', 'companyCategories', 'personPhoneNumbers',
  'mentionedPeople', 'selectedRepId', 'managerCallLogViewMode',
];
STATE_GLOBALS.forEach(key => {
  Object.defineProperty(window, key, {
    get()  { return state[key]; },
    set(v) { state[key] = v; },
    enumerable: true,
    configurable: true,
  });
});

// ── Application Bootstrap ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initMobileOptimizations(); // Initialize mobile-specific enhancements
  initMobileNavigation(); // Initialize mobile menu handling
  initTheme();
  initAuth();
  initEventListeners();
  initPWA();
});
