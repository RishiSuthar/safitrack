// modules/features/team-dashboard.js
// Team visits hub: dashboard, timeline, leaderboard, filters, map.
import { state, supabaseClient, persistedState as _persisted, saveViewState } from '../state.js';
import { viewContainer } from '../ui/dom.js';
import { showToast, escapeHtml, getInitials } from '../ui/toast.js';
import { renderSkeletonCards } from '../utils/helpers.js';

// VISITS HUB - PREMIUM MANAGER VIEW
// ======================

let visitsHubState = {
  visits: [],
  salesReps: [],
  filteredVisits: [],
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
      <div class="visits-hero">
        ${[1, 2, 3, 4].map(() => '<div class="visits-skeleton" style="height: 120px;"></div>').join('')}
      </div>
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
  const totalVisits = visitsWithProfiles.length;
  const todayVisits = visitsWithProfiles.filter(v => isToday(new Date(v.created_at))).length;
  const weekVisits = visitsWithProfiles.filter(v => isThisWeek(new Date(v.created_at))).length;
  const lastWeekVisits = visitsWithProfiles.filter(v => isLastWeek(new Date(v.created_at))).length;
  const weekTrend = lastWeekVisits > 0 ? Math.round(((weekVisits - lastWeekVisits) / lastWeekVisits) * 100) : 100;

  const avgLeadScore = visitsWithProfiles.filter(v => v.lead_score).length > 0
    ? Math.round(visitsWithProfiles.reduce((sum, v) => sum + (v.lead_score || 0), 0) / visitsWithProfiles.filter(v => v.lead_score).length)
    : 0;

  const verifiedVisits = visitsWithProfiles.filter(v => v.location_verified).length;
  const verificationRate = totalVisits > 0 ? Math.round((verifiedVisits / totalVisits) * 100) : 0;

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
      <!-- Hero Stats -->
      <div class="visits-hero">
        <div class="visits-hero-stat accent-blue">
          <div class="visits-stat-header">
            <div class="visits-stat-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </div>
            ${weekTrend !== 0 ? `
              <span class="visits-stat-trend ${weekTrend > 0 ? 'up' : 'down'}">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="${weekTrend > 0 ? '18 15 12 9 6 15' : '6 9 12 15 18 9'}"></polyline></svg>
                ${Math.abs(weekTrend)}%
              </span>
            ` : ''}
          </div>
          <div class="visits-stat-value">${totalVisits}</div>
          <div class="visits-stat-label">Total Visits</div>
        </div>
        
        <div class="visits-hero-stat accent-green">
          <div class="visits-stat-header">
            <div class="visits-stat-icon green">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4"/><path d="m4.93 4.93 2.83 2.83"/><path d="M2 12h4"/><path d="m4.93 19.07 2.83-2.83"/><path d="M12 18v4"/><path d="m16.24 16.24 2.83 2.83"/><path d="M18 12h4"/><path d="m16.24 7.76 2.83-2.83"/><circle cx="12" cy="12" r="4"/></svg>
            </div>
          </div>
          <div class="visits-stat-value">${todayVisits}</div>
          <div class="visits-stat-label">Today's Visits</div>
        </div>
        
        <div class="visits-hero-stat accent-orange">
          <div class="visits-stat-header">
            <div class="visits-stat-icon orange">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/></svg>
            </div>
          </div>
          <div class="visits-stat-value">${avgLeadScore}%</div>
          <div class="visits-stat-label">Avg Lead Score</div>
        </div>
        
        <div class="visits-hero-stat accent-purple">
          <div class="visits-stat-header">
            <div class="visits-stat-icon purple">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>
            </div>
          </div>
          <div class="visits-stat-value">${verificationRate}%</div>
          <div class="visits-stat-label">Location Verified</div>
        </div>
      </div>

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
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
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
            <select class="visits-filter-select" id="filter-rep">
              <option value="">All Reps</option>
              ${salesReps.map(rep => `<option value="${rep.id}">${rep.first_name} ${rep.last_name}</option>`).join('')}
            </select>
          </div>
          
          <div class="visits-filter-group">
            <label class="visits-filter-label">Visit Type</label>
            <select class="visits-filter-select" id="filter-type">
              <option value="">All Types</option>
              <option value="new_lead">New Lead</option>
              <option value="follow_up">Follow-up</option>
              <option value="demo">Product Demo</option>
              <option value="closing">Closing</option>
              <option value="support">Customer Support</option>
            </select>
          </div>
          
          <div class="visits-filter-group">
            <label class="visits-filter-label">Lead Score</label>
            <select class="visits-filter-select" id="filter-score">
              <option value="">Any Score</option>
              <option value="70">High (70%+)</option>
              <option value="40">Medium (40-69%)</option>
              <option value="0">Low (< 40%)</option>
            </select>
          </div>
          
          <div class="visits-filter-group span-2">
            <label class="visits-filter-label">Date Range</label>
            <div class="visits-date-range">
              <input type="date" id="filter-date-from">
              <span>to</span>
              <input type="date" id="filter-date-to">
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
              <select class="visits-sort-select" id="visits-sort">
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="score-high">Highest Score</option>
                <option value="score-low">Lowest Score</option>
                <option value="company">Company A-Z</option>
              </select>
            </div>
          </div>
          
          <!-- Cards View -->
          <div class="visits-list-container" id="visits-cards-view">
            ${renderVisitsCards(visitsWithProfiles)}
          </div>
          
          <!-- Timeline View -->
          <div class="visits-timeline-view" id="visits-timeline-view">
            ${renderVisitsTimeline(visitsWithProfiles)}
          </div>
          
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
          ${visit.lead_score ? `<span class="visit-card-badge ${scoreClass}">${visit.lead_score}% Score</span>` : ''}
          ${visit.location_verified ? `<span class="visit-card-badge verified"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> Verified</span>` : ''}
        </div>
        
        ${visit.notes ? `<div class="visit-card-notes">${visit.notes}</div>` : ''}
        
        <div class="visit-card-footer">
          <div class="visit-card-tags">
            ${(visit.tags || []).slice(0, 3).map(tag => `<span class="visit-card-tag">${tag}</span>`).join('')}
            ${(visit.tags || []).length > 3 ? `<span class="visit-card-tag">+${visit.tags.length - 3}</span>` : ''}
          </div>
          <div class="visit-card-actions">
            ${visit.latitude && visit.longitude ? `
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

  // Update visible container
  document.getElementById('visits-cards-view').style.display = view === 'cards' ? 'block' : 'none';
  document.getElementById('visits-timeline-view').classList.toggle('active', view === 'timeline');
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

  // Update count
  document.getElementById('visits-count').textContent = `${filtered.length} visit${filtered.length !== 1 ? 's' : ''}`;

  // Re-render views
  document.getElementById('visits-cards-view').innerHTML = renderVisitsCards(filtered);
  document.getElementById('visits-timeline-view').innerHTML = renderVisitsTimeline(filtered);
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
  document.getElementById('filters-count').style.display = 'none';

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
          <span class="visit-detail-meta-label">Location Verified</span>
          <span class="visit-detail-meta-value">${visit.location_verified ? 'Yes ✓' : 'No'}</span>
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
    
    ${visit.tags && visit.tags.length > 0 ? `
      <div class="visit-detail-section">
        <h4 class="visit-detail-section-title">Tags</h4>
        <div class="visit-card-tags" style="gap: 0.5rem;">
          ${visit.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
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
    
    ${visit.latitude && visit.longitude ? `
      <div class="visit-detail-section">
        <h4 class="visit-detail-section-title">Location</h4>
        <div id="visit-detail-map" style="height: 200px; border-radius: var(--radius-md); overflow: hidden;"></div>
        <p class="text-muted text-center mt-2" style="font-size: 0.75rem;">${visit.latitude.toFixed(6)}, ${visit.longitude.toFixed(6)}</p>
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
  console.log('Panel opened successfully');

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
  document.getElementById('visit-detail-panel').classList.remove('open');
  document.getElementById('visit-detail-backdrop').classList.remove('open');
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

  const headers = ['Date', 'Company', 'Sales Rep', 'Visit Type', 'Contact', 'Lead Score', 'Notes', 'Location Verified'];
  const pref = (typeof getUserDateFormat === 'function') ? getUserDateFormat() : (localStorage.getItem('safitrack_date_format') || 'DD/MM/YYYY');
  const rows = visits.map(v => [
    pref === 'MM/DD/YYYY' ? (new Date(v.created_at) instanceof Date ? `${String(new Date(v.created_at).getMonth() + 1).padStart(2, '0')}/${String(new Date(v.created_at).getDate()).padStart(2, '0')}/${new Date(v.created_at).getFullYear()}` : '') : formatDateDDMMYYYY(v.created_at),
    v.company_name || '',
    v.user ? `${v.user.first_name} ${v.user.last_name}` : '',
    v.visit_type || '',
    v.contact_name || '',
    v.lead_score || '',
    (v.notes || '').replace(/"/g, '""'),
    v.location_verified ? 'Yes' : 'No'
  ]);

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
    doc.setFontSize(24);
    doc.setTextColor(...colors.white);
    doc.setFont(undefined, 'bold');
    doc.text('SafiTrack Sales Report', 20, 30);
    doc.setFontSize(11);
    doc.setFont(undefined, 'normal');
    doc.text('Sales Visit Information', 20, 40);

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
      addInfoRow('Location Verified', visit.location_verified ? 'Yes ✓' : 'No');
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
      addInfoRow('Email', visit.user.email);
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
