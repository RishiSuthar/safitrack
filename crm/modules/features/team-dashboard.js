// modules/features/team-dashboard.js
// Team visits hub: dashboard, timeline, leaderboard, filters, map.
import { state, supabaseClient, persistedState as _persisted, saveViewState } from '../state.js';
import { viewContainer } from '../ui/dom.js';
import { showToast, escapeHtml, getInitials } from '../ui/toast.js';
import { renderSkeletonCards } from '../utils/helpers.js';

// VISITS HUB - PREMIUM MANAGER VIEW
// ======================

const VISITS_PAGE_SIZE = 20;

const _chevL = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>`;
const _chevR = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`;

function _pgHTML(current, total, size) {
  if (total <= size) return '';
  const totalPages = Math.ceil(total / size);
  const from = (current - 1) * size + 1;
  const to = Math.min(current * size, total);
  const visible = new Set([1, totalPages]);
  for (let i = Math.max(1, current - 2); i <= Math.min(totalPages, current + 2); i++) visible.add(i);
  const pages = [...visible].sort((a, b) => a - b);
  let btns = '';
  for (let i = 0; i < pages.length; i++) {
    if (i > 0 && pages[i] - pages[i - 1] > 1) btns += `<span class="pagination-ellipsis">...</span>`;
    btns += `<button class="pagination-btn${pages[i] === current ? ' active' : ''}" data-pg="${pages[i]}">${pages[i]}</button>`;
  }
  return `<div class="pagination-container">
    <div class="pagination-info">Showing ${from} to ${to} of ${total} records</div>
    <div class="pagination-controls">
      <button class="pagination-btn${current === 1 ? ' disabled' : ''}" data-pg="${current - 1}">${_chevL} Previous</button>
      ${btns}
      <button class="pagination-btn${current === totalPages ? ' disabled' : ''}" data-pg="${current + 1}">Next ${_chevR}</button>
    </div>
  </div>`;
}

let visitsHubState = {
  visits: [],
  salesReps: [],
  filteredVisits: [],
  currentPage: 1,
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
      <div class="visits-skeleton" style="height: 60px;"></div>
      <div class="visits-skeleton" style="height: 400px;"></div>
    </div>
  `;

  // Fetch all data
  let tpQ = supabaseClient.from('profiles').select('*').order('first_name', { ascending: true });
  if (state.currentOrganization?.id) tpQ = tpQ.eq('organization_id', state.currentOrganization.id);
  const { data: allProfiles, error: profilesError } = await tpQ;

  if (profilesError) {
    viewContainer.innerHTML = renderError('Unable to load team data: ' + profilesError.message);
    return;
  }

  let tvQ = supabaseClient.from('visits').select('*').order('created_at', { ascending: false });
  if (state.currentOrganization?.id) tvQ = tvQ.eq('organization_id', state.currentOrganization.id);
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
      <!-- Command Bar -->
      <div class="visits-command-bar">
        <div class="visits-search-box">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"/></svg>
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
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-sliders-horizontal-icon lucide-sliders-horizontal"><path d="M10 5H3"/><path d="M12 19H3"/><path d="M14 3v4"/><path d="M16 17v4"/><path d="M21 12h-9"/><path d="M21 19h-5"/><path d="M21 5h-7"/><path d="M8 10v4"/><path d="M8 12H3"/></svg>
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
            <div class="crm-dd crm-dd--form" data-dd-id="filter-rep">
              <button type="button" class="crm-dd-trigger has-value" aria-haspopup="listbox" aria-expanded="false">
                <span class="crm-dd-label">All Reps</span>
                <span class="crm-dd-chevron"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>
              </button>
              <div class="crm-dd-panel" role="listbox">
                <ul class="crm-dd-list">
                  <li class="crm-dd-option is-selected" role="option" aria-selected="true" data-value="" data-label="All Reps" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>All Reps</li>
                  ${salesReps.map(rep => `<li class="crm-dd-option" role="option" data-value="${rep.id}" data-label="${rep.first_name} ${rep.last_name}" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>${rep.first_name} ${rep.last_name}</li>`).join('')}
                </ul>
              </div>
              <input class="crm-dd-value-input" type="hidden" id="filter-rep" value="">
            </div>
          </div>
          
          <div class="visits-filter-group">
            <label class="visits-filter-label">Visit Type</label>
            <div class="crm-dd crm-dd--form" data-dd-id="filter-type">
              <button type="button" class="crm-dd-trigger has-value" aria-haspopup="listbox" aria-expanded="false">
                <span class="crm-dd-label">All Types</span>
                <span class="crm-dd-chevron"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>
              </button>
              <div class="crm-dd-panel" role="listbox">
                <ul class="crm-dd-list">
                  <li class="crm-dd-option is-selected" role="option" aria-selected="true" data-value="" data-label="All Types" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>All Types</li>
                  <li class="crm-dd-option" role="option" data-value="new_lead" data-label="New Lead" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>New Lead</li>
                  <li class="crm-dd-option" role="option" data-value="follow_up" data-label="Follow-up" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Follow-up</li>
                  <li class="crm-dd-option" role="option" data-value="demo" data-label="Product Demo" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Product Demo</li>
                  <li class="crm-dd-option" role="option" data-value="closing" data-label="Closing" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Closing</li>
                  <li class="crm-dd-option" role="option" data-value="support" data-label="Customer Support" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Customer Support</li>
                </ul>
              </div>
              <input class="crm-dd-value-input" type="hidden" id="filter-type" value="">
            </div>
          </div>
          
          <div class="visits-filter-group">
            <label class="visits-filter-label">Lead Score</label>
            <div class="crm-dd crm-dd--form" data-dd-id="filter-score">
              <button type="button" class="crm-dd-trigger has-value" aria-haspopup="listbox" aria-expanded="false">
                <span class="crm-dd-label">Any Score</span>
                <span class="crm-dd-chevron"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>
              </button>
              <div class="crm-dd-panel" role="listbox">
                <ul class="crm-dd-list">
                  <li class="crm-dd-option is-selected" role="option" aria-selected="true" data-value="" data-label="Any Score" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Any Score</li>
                  <li class="crm-dd-option" role="option" data-value="70" data-label="High (70%+)" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>High (70%+)</li>
                  <li class="crm-dd-option" role="option" data-value="40" data-label="Medium (40-69%)" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Medium (40-69%)</li>
                  <li class="crm-dd-option" role="option" data-value="0" data-label="Low (&lt; 40%)" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Low (&lt; 40%)</li>
                </ul>
              </div>
              <input class="crm-dd-value-input" type="hidden" id="filter-score" value="">
            </div>
          </div>
          
          <div class="visits-filter-group span-2">
            <label class="visits-filter-label">Date Range</label>
            <div class="visits-date-range">
              <input type="date" id="filter-date-from">
              <span>to</span>
              <input type="date" id="filter-date-to">
              <button class="crm-filter-clear" id="visits-date-clear" style="display:none; padding:4px 8px; font-size:0.75rem; border:none; background:transparent;">✕ Clear dates</button>
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
              <div class="crm-dd crm-dd--filter" data-dd-id="visits-sort">
                <button type="button" class="crm-dd-trigger has-value" aria-haspopup="listbox" aria-expanded="false">
                  <span class="crm-dd-label">Newest First</span>
                  <span class="crm-dd-chevron"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>
                </button>
                <div class="crm-dd-panel" role="listbox">
                  <ul class="crm-dd-list">
                    <li class="crm-dd-option is-selected" role="option" aria-selected="true" data-value="newest" data-label="Newest First" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Newest First</li>
                    <li class="crm-dd-option" role="option" data-value="oldest" data-label="Oldest First" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Oldest First</li>
                    <li class="crm-dd-option" role="option" data-value="score-high" data-label="Highest Score" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Highest Score</li>
                    <li class="crm-dd-option" role="option" data-value="score-low" data-label="Lowest Score" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Lowest Score</li>
                    <li class="crm-dd-option" role="option" data-value="company" data-label="Company A-Z" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Company A-Z</li>
                  </ul>
                </div>
                <input class="crm-dd-value-input" type="hidden" id="visits-sort" value="newest">
              </div>
            </div>
          </div>
          
          <!-- Cards View -->
          <div class="visits-list-container" id="visits-cards-view">
            ${renderVisitsCards(visitsWithProfiles)}
          </div>
          <div id="visits-cards-pg"></div>
          
          <!-- Timeline View -->
          <div class="visits-timeline-view" id="visits-timeline-view">
            ${renderVisitsTimeline(visitsWithProfiles)}
          </div>
          <div id="visits-timeline-pg"></div>
          
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
    const visitSubsector = (visit.subsector || '').trim();
    
    const distanceTag = (visit.tags || []).find(t => typeof t === 'string' && t.startsWith('__distance:'));
    const distanceVal = distanceTag ? distanceTag.split(':')[1] : null;
    const isUnverified = (visit.tags || []).includes('location-unverified');
    const displayTags = (visit.tags || []).filter(t => typeof t !== 'string' || (!t.startsWith('__distance:') && t !== 'location-unverified'));

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
          <span class="visit-card-badge subsector">Subsector: ${escapeHtml(visitSubsector || 'Unassigned')}</span>
          ${visit.lead_score ? `<span class="visit-card-badge ${scoreClass}">${visit.lead_score}% Score</span>` : ''}
          ${distanceVal != null && !isUnverified ? `<span class="visit-card-badge distance"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> ${distanceVal}m from site</span>` : ''}
          ${isUnverified ? `<span class="visit-card-badge distance" style="color: #ef4444; background: #fef2f2;">Location not verified</span>` : ''}
        </div>
        
        ${visit.notes ? `<div class="visit-card-notes">${visit.notes}</div>` : ''}
        
        <div class="visit-card-footer">
          <div class="visit-card-tags">
            ${displayTags.slice(0, 3).map(tag => `<span class="visit-card-tag">${tag}</span>`).join('')}
            ${displayTags.length > 3 ? `<span class="visit-card-tag">+${displayTags.length - 3}</span>` : ''}
          </div>
          <div class="visit-card-actions">
            ${visit.latitude && visit.longitude && !isUnverified ? `
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
              <div class="visit-card-meta" style="margin-top: 0.4rem;">
                <span class="visit-card-badge subsector">Subsector: ${escapeHtml((visit.subsector || '').trim() || 'Unassigned')}</span>
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
  // Pagination — delegated from the static pg divs
  ['visits-cards-pg', 'visits-timeline-pg'].forEach(pgId => {
    document.getElementById(pgId)?.addEventListener('click', e => {
      const btn = e.target.closest('.pagination-btn');
      if (!btn || btn.classList.contains('disabled') || btn.classList.contains('active')) return;
      const pg = parseInt(btn.dataset.pg, 10);
      if (!isNaN(pg)) {
        visitsHubState.currentPage = pg;
        _renderVisitsPage();
        document.querySelector('.visits-hub-content')?.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  });

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

  // Initialize CustomCalendar on date inputs (replaces native browser date picker)
  if (window.initCustomCalendar) {
    window.initCustomCalendar('#filter-date-from', { type: 'date' });
    window.initCustomCalendar('#filter-date-to', { type: 'date' });
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

  const clearDatesBtn = document.getElementById('visits-date-clear');
  if (clearDatesBtn) {
    clearDatesBtn.addEventListener('click', () => {
      document.getElementById('filter-date-from').value = '';
      document.getElementById('filter-date-to').value = '';
      updateFilterState();
      applyVisitsFilters();
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

  // Update visible containers + paired pagination divs
  document.getElementById('visits-cards-view').style.display = view === 'cards' ? 'block' : 'none';
  const cardsPg = document.getElementById('visits-cards-pg');
  if (cardsPg) cardsPg.style.display = view === 'cards' ? 'block' : 'none';
  document.getElementById('visits-timeline-view').classList.toggle('active', view === 'timeline');
  const timelinePg = document.getElementById('visits-timeline-pg');
  if (timelinePg) timelinePg.style.display = view === 'timeline' ? 'block' : 'none';
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
  visitsHubState.currentPage = 1;

  // Update count
  document.getElementById('visits-count').textContent = `${filtered.length} visit${filtered.length !== 1 ? 's' : ''}`;

  // Re-render views with page 1
  _renderVisitsPage();
}

function _renderVisitsPage() {
  const { filteredVisits, currentPage } = visitsHubState;
  const totalPages = Math.ceil(filteredVisits.length / VISITS_PAGE_SIZE);
  const page = Math.max(1, Math.min(currentPage, totalPages || 1));
  visitsHubState.currentPage = page;
  const start = (page - 1) * VISITS_PAGE_SIZE;
  const pageVisits = filteredVisits.slice(start, start + VISITS_PAGE_SIZE);

  document.getElementById('visits-cards-view').innerHTML = renderVisitsCards(pageVisits);
  document.getElementById('visits-timeline-view').innerHTML = renderVisitsTimeline(pageVisits);

  const cardsPg = document.getElementById('visits-cards-pg');
  const timelinePg = document.getElementById('visits-timeline-pg');
  if (cardsPg) cardsPg.innerHTML = _pgHTML(page, filteredVisits.length, VISITS_PAGE_SIZE);
  if (timelinePg) timelinePg.innerHTML = _pgHTML(page, filteredVisits.length, VISITS_PAGE_SIZE);
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
  
  const clearDatesBtn = document.getElementById('visits-date-clear');
  if (clearDatesBtn) clearDatesBtn.style.display = 'none';

  updateFilterState();
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
  
  const distanceTag = (visit.tags || []).find(t => typeof t === 'string' && t.startsWith('__distance:'));
  const distanceVal = distanceTag ? distanceTag.split(':')[1] : null;
  const isUnverified = (visit.tags || []).includes('location-unverified');
  const displayTags = (visit.tags || []).filter(t => typeof t !== 'string' || (!t.startsWith('__distance:') && t !== 'location-unverified'));

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
        <div class="visit-detail-meta-item">
          <span class="visit-detail-meta-label">Subsector</span>
          <span class="visit-detail-meta-value">${escapeHtml(String(visit.subsector || '').trim() || 'Unassigned')}</span>
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
          <span class="visit-detail-meta-label">Distance from Site</span>
          <span class="visit-detail-meta-value">${isUnverified ? '<span style="color: #ef4444;">Location not verified</span>' : (distanceVal != null ? `${distanceVal}m` : 'Unknown')}</span>
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
    
    ${displayTags.length > 0 ? `
      <div class="visit-detail-section">
        <h4 class="visit-detail-section-title">Tags</h4>
        <div class="visit-card-tags" style="gap: 0.5rem;">
          ${displayTags.map(tag => `<span class="tag">${tag}</span>`).join('')}
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
    
    ${visit.latitude && visit.longitude && !isUnverified ? `
      <div class="visit-detail-section">
        <h4 class="visit-detail-section-title">Location</h4>
        <div id="visit-detail-map" style="height: 200px; border-radius: var(--radius-md); overflow: hidden;"></div>
        <p class="text-muted text-center mt-2" style="font-size: 0.75rem;">${visit.latitude.toFixed(6)}, ${visit.longitude.toFixed(6)}</p>
      </div>
    ` : ''}
    ${isUnverified ? `
      <div class="visit-detail-section">
        <h4 class="visit-detail-section-title">Location</h4>
        <div style="background: var(--bg-secondary); padding: 1.5rem; border-radius: var(--radius-md); text-align: center; color: #ef4444; font-weight: 500; font-size: 0.875rem;">
          Location not verified
        </div>
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
  document.body.style.overflow = 'hidden'; // prevent background scroll on mobile

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
  const panel = document.getElementById('visit-detail-panel');
  const backdrop = document.getElementById('visit-detail-backdrop');
  if (panel) panel.classList.remove('open');
  if (backdrop) backdrop.classList.remove('open');
  document.body.style.overflow = ''; // restore scrolling
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
        <button class="modal-close photo-modal-close" onclick="closePhotoModal()">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
            class="lucide lucide-x-icon lucide-x">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
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

  const headers = ['Date', 'Company', 'Sales Rep', 'Visit Type', 'Contact', 'Lead Score', 'Notes', 'Distance from Site'];
  const pref = (typeof getUserDateFormat === 'function') ? getUserDateFormat() : (localStorage.getItem('safitrack_date_format') || 'DD/MM/YYYY');
  const rows = visits.map(v => {
    const distTag = (v.tags || []).find(t => typeof t === 'string' && t.startsWith('__distance:'));
    const distVal = distTag ? distTag.split(':')[1] + 'm' : 'Unknown';
    
    return [
      pref === 'MM/DD/YYYY' ? (new Date(v.created_at) instanceof Date ? `${String(new Date(v.created_at).getMonth() + 1).padStart(2, '0')}/${String(new Date(v.created_at).getDate()).padStart(2, '0')}/${new Date(v.created_at).getFullYear()}` : '') : formatDateDDMMYYYY(v.created_at),
      v.company_name || '',
      v.user ? `${v.user.first_name} ${v.user.last_name}` : '',
      v.visit_type || '',
      v.contact_name || '',
      v.lead_score || '',
      (v.notes || '').replace(/"/g, '""'),
      distVal
    ];
  });

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
    doc.setFontSize(22);
    doc.setTextColor(...colors.white);
    doc.setFont(undefined, 'bold');
    doc.text('Sangyug Enterprises Limited', 20, 25);
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.text('www.sangyug.com | Email: servicecentre@sangyug.com, info@sangyug.com | Phone: 0743 767960 | 0715 177456', 20, 33);
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text('Sales Visit Report', 20, 43);

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
      const distTag = (visit.tags || []).find(t => typeof t === 'string' && t.startsWith('__distance:'));
      const distVal = distTag ? distTag.split(':')[1] : null;
      addInfoRow('Distance from Site', distVal != null ? `${distVal}m` : 'Unknown');
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
      addInfoRow('Email', 'servicecentre@sangyug.com');
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


// ── Exports ────────────────────────────────────────────────────
export {
  renderTeamDashboardView,
  isToday,
  isThisWeek,
  isLastWeek,
  isYesterday,
  renderVisitsCards,
  renderVisitsTimeline,
  renderActivityTimeline,
  renderLeaderboard,
  getRelativeTime,
  initVisitsHub,
  switchVisitsView,
  updateFilterCountBadge,
  updateFilterState,
  applyVisitsFilters,
  clearAllFilters,
  closeVisitDetail,
  fetchAndOpenVisit,
  openPhotoModal,
  closePhotoModal,
  initVisitsMap,
  debounce,
  generateVisitPDF,
};
