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
import { router, initRouter, navigate, navigateView } from './modules/core/router.js';

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

// ── Notifications ─────────────────────────────────────────────────────────────
import { notificationStore } from './modules/features/notifications.js';

// ── Features ──────────────────────────────────────────────────────────────────









































// ══════════════════════════════════════════════════════════════════════════════
//  WINDOW BRIDGE
//  Expose functions for HTML inline handlers and non-module sibling scripts.
// ══════════════════════════════════════════════════════════════════════════════
Object.assign(window, {
  supabaseClient,
  state,
  router,
  navigate,
  navigateView,
  loadView, openSidebar, closeSidebar, updateActiveNav,
  handleLogin, handleLogout, switchAuthPane, handleGoogleAuth,
  handleCompleteGoogleProfile, goToSignupStep, handleSignup,
  handleResendVerification, openInviteModal, closeInviteModal, handleInviteSubmit,
  showToast, escapeHtml, showInlineSuccess, triggerConfetti, getInitials, handleImageError,
  formatDate, getDisplayNameFromProfile, getLeadScoreBadge, parseMarkdown,
  renderSkeletonCards, renderError, renderAccessDenied, renderNotFound, renderTags,
  geocodeAddressWithOSM, calculateDistance, buildOverpassQuery, searchNearbyOverpass,
  renderNearbySuggestions, 
  renderEditableDataTable, getDeepValue, getCompanyLogoUrl, normalizeSearchText,
  normalizeForMatching, findCompanyForOpportunity, slugifyForDomain, getGoogleFaviconUrl,
  guessDomainAndFavicon, matchesTokenizedQuery, normalizeEmailValue, normalizePhoneValue,
  findDuplicateCompanyByName, findDuplicatePersonContact, makeCellEditable,
  initResize, handleResizeMove, handleGenerateCompanyDescription, stopResize,
  handleCellUpdate, sortData, handleHeaderSort, refreshCurrentView,
  updateBottomActionBar, clearSelection, handleBatchDelete,
  openCommandPalette, closeCommandPalette,
  openQuickActions, closeQuickActions,
  openSearchRecords, closeSearchRecords,
  initPWA, attemptShowPWABanner, showCompressionProgress, hideCompressionProgress,
  showMentionSuggestions, setActiveMention, insertMentionFromSuggestion,
  startSafiNudgeRealtime, stopSafiNudgeRealtime, sendSafiNudge, populateSafiNudgeRecipients,
  // Notification store (exposed for debugging; avoid direct window access in app code)
  notificationStore,
});


const lazyLoad = (modulePath, exportName) => {
  return async (...args) => {
    const mod = await import(modulePath);
    return mod[exportName](...args);
  };
};

// ── Lazy Loaded Features ──────────────────────────────────────────────────────
window.renderSettingsView = lazyLoad('./modules/features/settings.js', 'renderSettingsView');
window.renderCompaniesView = lazyLoad('./modules/features/companies.js', 'renderCompaniesView');
window.openCompanyModal = lazyLoad('./modules/features/companies.js', 'openCompanyModal');
window.initCompanyModalListeners = lazyLoad('./modules/features/companies.js', 'initCompanyModalListeners');
window.addCategory = lazyLoad('./modules/features/companies.js', 'addCategory');
window.removeCategory = lazyLoad('./modules/features/companies.js', 'removeCategory');
window.renderCategories = lazyLoad('./modules/features/companies.js', 'renderCategories');
window.renderPeopleView = lazyLoad('./modules/features/people.js', 'renderPeopleView');
window.openPersonModal = lazyLoad('./modules/features/people.js', 'openPersonModal');
window.openPersonViewModal = lazyLoad('./modules/features/people.js', 'openPersonViewModal');
window.initPersonModalListeners = lazyLoad('./modules/features/people.js', 'initPersonModalListeners');
window.addPhoneNumber = lazyLoad('./modules/features/people.js', 'addPhoneNumber');
window.renderPhoneNumbers = lazyLoad('./modules/features/people.js', 'renderPhoneNumbers');
window.renderLogVisitView = lazyLoad('./modules/features/log-visit.js', 'renderLogVisitView');
window.initLogVisitForm = lazyLoad('./modules/features/log-visit.js', 'initLogVisitForm');
window.geocodeAddress = lazyLoad('./modules/features/log-visit.js', 'geocodeAddress');
window.renderMyActivityView = lazyLoad('./modules/features/my-activity.js', 'renderMyActivityView');
window.renderVisitCard = lazyLoad('./modules/features/my-activity.js', 'renderVisitCard');
window.renderSalesFunnelView = lazyLoad('./modules/features/sales-funnel.js', 'renderSalesFunnelView');
window.renderOpportunityPipelineView = lazyLoad('./modules/features/opportunities.js', 'renderOpportunityPipelineView');
window.updateOpportunityLogosAsync = lazyLoad('./modules/features/opportunities.js', 'updateOpportunityLogosAsync');
window.initOpportunityEventListeners = lazyLoad('./modules/features/opportunities.js', 'initOpportunityEventListeners');
window.initPipelineDragAndDrop = lazyLoad('./modules/features/opportunities.js', 'initPipelineDragAndDrop');
window.updatePipelineStageCounts = lazyLoad('./modules/features/opportunities.js', 'updatePipelineStageCounts');
window.updatePipelineSummary = lazyLoad('./modules/features/opportunities.js', 'updatePipelineSummary');
window.initPipelineFilters = lazyLoad('./modules/features/opportunities.js', 'initPipelineFilters');
window.openOpportunityModal = lazyLoad('./modules/features/opportunities.js', 'openOpportunityModal');
window.openOpportunityViewModal = lazyLoad('./modules/features/opportunities.js', 'openOpportunityViewModal');
window.initOpportunityModalListeners = lazyLoad('./modules/features/opportunities.js', 'initOpportunityModalListeners');
window.addCompetitor = lazyLoad('./modules/features/opportunities.js', 'addCompetitor');
window.getProbabilityColor = lazyLoad('./modules/features/opportunities.js', 'getProbabilityColor');
window.scheduleNextStepReminder = lazyLoad('./modules/features/opportunities.js', 'scheduleNextStepReminder');
window.renderTeamDashboardView = lazyLoad('./modules/features/team-dashboard.js', 'renderTeamDashboardView');
window.isToday = lazyLoad('./modules/features/team-dashboard.js', 'isToday');
window.isThisWeek = lazyLoad('./modules/features/team-dashboard.js', 'isThisWeek');
window.isLastWeek = lazyLoad('./modules/features/team-dashboard.js', 'isLastWeek');
window.isYesterday = lazyLoad('./modules/features/team-dashboard.js', 'isYesterday');
window.renderVisitsCards = lazyLoad('./modules/features/team-dashboard.js', 'renderVisitsCards');
window.renderVisitsTimeline = lazyLoad('./modules/features/team-dashboard.js', 'renderVisitsTimeline');
window.renderActivityTimeline = lazyLoad('./modules/features/team-dashboard.js', 'renderActivityTimeline');
window.renderLeaderboard = lazyLoad('./modules/features/team-dashboard.js', 'renderLeaderboard');
window.getRelativeTime = lazyLoad('./modules/features/team-dashboard.js', 'getRelativeTime');
window.initVisitsHub = lazyLoad('./modules/features/team-dashboard.js', 'initVisitsHub');
window.switchVisitsView = lazyLoad('./modules/features/team-dashboard.js', 'switchVisitsView');
window.updateFilterCountBadge = lazyLoad('./modules/features/team-dashboard.js', 'updateFilterCountBadge');
window.updateFilterState = lazyLoad('./modules/features/team-dashboard.js', 'updateFilterState');
window.applyVisitsFilters = lazyLoad('./modules/features/team-dashboard.js', 'applyVisitsFilters');
window.clearAllFilters = lazyLoad('./modules/features/team-dashboard.js', 'clearAllFilters');
window.closeVisitDetail = lazyLoad('./modules/features/team-dashboard.js', 'closeVisitDetail');
window.fetchAndOpenVisit = lazyLoad('./modules/features/team-dashboard.js', 'fetchAndOpenVisit');
window.openPhotoModal = lazyLoad('./modules/features/team-dashboard.js', 'openPhotoModal');
window.closePhotoModal = lazyLoad('./modules/features/team-dashboard.js', 'closePhotoModal');
window.initVisitsMap = lazyLoad('./modules/features/team-dashboard.js', 'initVisitsMap');
window.debounce = lazyLoad('./modules/features/team-dashboard.js', 'debounce');
window.generateVisitPDF = lazyLoad('./modules/features/team-dashboard.js', 'generateVisitPDF');
window.renderUserManagementView = lazyLoad('./modules/features/user-management.js', 'renderUserManagementView');
window.groupRoutesByLocations = lazyLoad('./modules/features/route-planning.js', 'groupRoutesByLocations');
window.renderRoutePlanningView = lazyLoad('./modules/features/route-planning.js', 'renderRoutePlanningView');
window.initRoutePlanning = lazyLoad('./modules/features/route-planning.js', 'initRoutePlanning');
window.initRouteList = lazyLoad('./modules/features/route-planning.js', 'initRouteList');
window.initAISafiPlan = lazyLoad('./modules/features/route-planning.js', 'initAISafiPlan');
window.openAISafiPlanModal = lazyLoad('./modules/features/route-planning.js', 'openAISafiPlanModal');
window.initAISafiPlanLogic = lazyLoad('./modules/features/route-planning.js', 'initAISafiPlanLogic');
window.viewRouteDetails = lazyLoad('./modules/features/route-planning.js', 'viewRouteDetails');
window.editRoute = lazyLoad('./modules/features/route-planning.js', 'editRoute');
window.renderMyRoutesView = lazyLoad('./modules/features/my-routes.js', 'renderMyRoutesView');
window.startRouteNavigation = lazyLoad('./modules/features/route-navigation.js', 'startRouteNavigation');
window.completeRoute = lazyLoad('./modules/features/route-navigation.js', 'completeRoute');
window.renderTasksView = lazyLoad('./modules/features/tasks.js', 'renderTasksView');
window.renderKanbanTaskCard = lazyLoad('./modules/features/tasks.js', 'renderKanbanTaskCard');
window.initKanbanBoard = lazyLoad('./modules/features/tasks.js', 'initKanbanBoard');
window.updateColumnCounts = lazyLoad('./modules/features/tasks.js', 'updateColumnCounts');
window.showTaskDetail = lazyLoad('./modules/features/tasks.js', 'showTaskDetail');
window.renderTaskCard = lazyLoad('./modules/features/tasks.js', 'renderTaskCard');
window.getStatusLabel = lazyLoad('./modules/features/tasks.js', 'getStatusLabel');
window.initTaskFilters = lazyLoad('./modules/features/tasks.js', 'initTaskFilters');
window.initTaskActionButtons = lazyLoad('./modules/features/tasks.js', 'initTaskActionButtons');
window.openTaskModal = lazyLoad('./modules/features/tasks.js', 'openTaskModal');
window.initTaskModalListeners = lazyLoad('./modules/features/tasks.js', 'initTaskModalListeners');
window.renderRemindersView = lazyLoad('./modules/features/reminders.js', 'renderRemindersView');
window.initReminderFilters = lazyLoad('./modules/features/reminders.js', 'initReminderFilters');
window.initReminderActionButtons = lazyLoad('./modules/features/reminders.js', 'initReminderActionButtons');
window.openReminderModal = lazyLoad('./modules/features/reminders.js', 'openReminderModal');
window.initReminderModalListeners = lazyLoad('./modules/features/reminders.js', 'initReminderModalListeners');
window.escapeCsvValue = lazyLoad('./modules/features/import-export.js', 'escapeCsvValue');
window.downloadCsvFile = lazyLoad('./modules/features/import-export.js', 'downloadCsvFile');
window.downloadCompaniesSampleCsv = lazyLoad('./modules/features/import-export.js', 'downloadCompaniesSampleCsv');
window.parseCsv = lazyLoad('./modules/features/import-export.js', 'parseCsv');
window.normalizeCompanyCsvHeader = lazyLoad('./modules/features/import-export.js', 'normalizeCompanyCsvHeader');
window.parseCompanyType = lazyLoad('./modules/features/import-export.js', 'parseCompanyType');
window.parseCategoriesCell = lazyLoad('./modules/features/import-export.js', 'parseCategoriesCell');
// Import / Export
window.exportAllCompaniesToCsv = lazyLoad('./modules/features/import-export.js', 'exportAllCompaniesToCsv');
window.runCompaniesImportFromCsv = lazyLoad('./modules/features/import-export.js', 'runCompaniesImportFromCsv');
window.openPeopleImportExportModal = lazyLoad('./modules/features/import-export.js', 'openPeopleImportExportModal');
window.exportAllPeopleToCsv = lazyLoad('./modules/features/import-export.js', 'exportAllPeopleToCsv');
window.runPeopleImportFromCsv = lazyLoad('./modules/features/import-export.js', 'runPeopleImportFromCsv');
window.downloadPeopleSampleCsv = lazyLoad('./modules/features/import-export.js', 'downloadPeopleSampleCsv');
window.renderTechnicianLogVisitView = lazyLoad('./modules/features/technician.js', 'renderTechnicianLogVisitView');
window.renderTechnicianActivityView = lazyLoad('./modules/features/technician.js', 'renderTechnicianActivityView');
window.renderTechniciansDashboardView = lazyLoad('./modules/features/technician.js', 'renderTechniciansDashboardView');
window.renderSubmissionsView = lazyLoad('./modules/features/technician.js', 'renderSubmissionsView');
window.renderUPSVisitFormWithContract = lazyLoad('./modules/features/technician.js', 'renderUPSVisitFormWithContract');
window.renderFormsView = lazyLoad('./modules/features/forms.js', 'renderFormsView');
window.renderContractsView = lazyLoad('./modules/features/contracts.js', 'renderContractsView');
window.renderNotesView = lazyLoad('./modules/features/notes.js', 'renderNotesView');
window.updateNotesSidebar = lazyLoad('./modules/features/notes.js', 'updateNotesSidebar');
window.renderNotesTags = lazyLoad('./modules/features/notes.js', 'renderNotesTags');
window.renderNotesGrid = lazyLoad('./modules/features/notes.js', 'renderNotesGrid');
window.attachNotesViewEvents = lazyLoad('./modules/features/notes.js', 'attachNotesViewEvents');
window.openNoteSlideOver = lazyLoad('./modules/features/notes.js', 'openNoteSlideOver');
window.closeNoteSlideOver = lazyLoad('./modules/features/notes.js', 'closeNoteSlideOver');
window.deleteNoteRecord = lazyLoad('./modules/features/notes.js', 'deleteNoteRecord');
window.saveActiveNote = lazyLoad('./modules/features/notes.js', 'saveActiveNote');
window.createNewNoteV2 = lazyLoad('./modules/features/notes.js', 'createNewNoteV2');
window.togglePinActiveNote = lazyLoad('./modules/features/notes.js', 'togglePinActiveNote');
window.deleteActiveNote = lazyLoad('./modules/features/notes.js', 'deleteActiveNote');
window.handleNoteTagging = lazyLoad('./modules/features/notes.js', 'handleNoteTagging');
window.showNotePersonSuggestions = lazyLoad('./modules/features/notes.js', 'showNotePersonSuggestions');
window.showNoteCompanySuggestions = lazyLoad('./modules/features/notes.js', 'showNoteCompanySuggestions');
window.renderNoteSuggestions = lazyLoad('./modules/features/notes.js', 'renderNoteSuggestions');
window.hideNoteTaggingSuggestions = lazyLoad('./modules/features/notes.js', 'hideNoteTaggingSuggestions');
window.insertNoteTag = lazyLoad('./modules/features/notes.js', 'insertNoteTag');
window.renderProfessionalDashboardView = lazyLoad('./modules/features/dashboard.js', 'renderProfessionalDashboardView');
window.renderReportsView = lazyLoad('./modules/features/reports.js', 'renderReportsView');
window.openReportBuilder = lazyLoad('./modules/features/reports.js', 'openReportBuilder');
window.refreshAllWidgets = lazyLoad('./modules/features/reports.js', 'refreshAllWidgets');
window.renderWorkflowsView = lazyLoad('./modules/features/workflows.js', 'renderWorkflowsView');
window.openWorkflowBuilder = lazyLoad('./modules/features/workflows.js', 'openWorkflowBuilder');
window.closeWorkflowBuilder = lazyLoad('./modules/features/workflows.js', 'closeWorkflowBuilder');
window.saveWorkflow = lazyLoad('./modules/features/workflows.js', 'saveWorkflow');
window.renderManualsView = lazyLoad('./modules/features/manuals.js', 'renderManualsView');
window.deleteWorkflow = lazyLoad('./modules/features/workflows.js', 'deleteWorkflow');
window.toggleWorkflowActive = lazyLoad('./modules/features/workflows.js', 'toggleWorkflowActive');
window.openTriggerPicker = lazyLoad('./modules/features/workflows.js', 'openTriggerPicker');
window.removeTrigger = lazyLoad('./modules/features/workflows.js', 'removeTrigger');
window.openActionPicker = lazyLoad('./modules/features/workflows.js', 'openActionPicker');
window.openActionEditor = lazyLoad('./modules/features/workflows.js', 'openActionEditor');
window.removeAction = lazyLoad('./modules/features/workflows.js', 'removeAction');
window.confirmActionEdit = lazyLoad('./modules/features/workflows.js', 'confirmActionEdit');
window.closeWorkflowPanel = lazyLoad('./modules/features/workflows.js', 'closePanel');
window.onWorkflowNameChange = lazyLoad('./modules/features/workflows.js', 'onWorkflowNameChange');
window.toggleBuilderActive = lazyLoad('./modules/features/workflows.js', 'toggleBuilderActive');
window.renderCallLogsView = lazyLoad('./modules/features/call-logs.js', 'renderCallLogsView');
window.deleteCallLog = lazyLoad('./modules/features/call-logs.js', 'deleteCallLog');
window.openCallLogViewModal = lazyLoad('./modules/features/call-logs.js', 'openCallLogViewModal');
window.openCompanyViewModal = lazyLoad('./modules/features/call-logs.js', 'openCompanyViewModal');
window.openCallLogModal = lazyLoad('./modules/features/call-logs.js', 'openCallLogModal');
window.initCallLogSearch = lazyLoad('./modules/features/call-logs.js', 'initCallLogSearch');
window.saveCallLog = lazyLoad('./modules/features/call-logs.js', 'saveCallLog');

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
  initRouter();
  initTheme();
  initAuth();
  initEventListeners();
  initPWA();
});
