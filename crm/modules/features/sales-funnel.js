// modules/features/sales-funnel.js
// Sales funnel / pipeline analytics view.
import { state, supabaseClient } from '../state.js';
import { viewContainer } from '../ui/dom.js';
import { showToast, escapeHtml, getInitials } from '../ui/toast.js';
import { renderSkeletonCards, renderError } from '../utils/helpers.js';
import { DEFAULT_SALES_STAGES, normalizeOpportunityStage } from '../utils/pipeline-stages.js';

function getRelativeTimeSafe(date) {
  const now = new Date();
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return 'Unknown';

  const diff = now - d;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

async function renderSalesFunnelView() {
  let opportunities;
  let error;

  if (state.isManager) {
    // Managers see all opportunities within their org
    let mOppsQ = supabaseClient.from('opportunities').select('*').order('created_at', { ascending: false });
    if (state.currentOrganization?.id) mOppsQ = mOppsQ.eq('organization_id', state.currentOrganization.id);
    const result = await mOppsQ;
    opportunities = result.data;
    error = result.error;
  } else {
    // Sales reps see only their own opportunities
    const result = await supabaseClient
      .from('opportunities')
      .select('*')
      .eq('user_id', state.currentUser.id)
      .order('created_at', { ascending: false });
    opportunities = result.data;
    error = result.error;
  }

  if (error) {
    viewContainer.innerHTML = renderError(error.message);
    return;
  }

  const stageMetaById = {
    prospecting: { gradient: 'linear-gradient(135deg, #3b82f6, #1d4ed8)' },
    qualification: { gradient: 'linear-gradient(135deg, #ec4899, #be185d)' },
    'closed-won': { gradient: 'linear-gradient(135deg, #10b981, #059669)' },
    'closed-lost': { gradient: 'linear-gradient(135deg, #ef4444, #dc2626)' },
  };

  const funnelStages = {};
  DEFAULT_SALES_STAGES.forEach((stage) => {
    funnelStages[stage.id] = {
      title: stage.title,
      opportunities: [],
      color: stage.color,
      gradient: stageMetaById[stage.id]?.gradient || `linear-gradient(135deg, ${stage.color}, ${stage.color})`,
    };
  });

  (opportunities || []).forEach((opp) => {
    const stage = normalizeOpportunityStage(opp.stage);
    if (funnelStages[stage]) {
      funnelStages[stage].opportunities.push(opp);
    }
  });

  const totalDeals = (opportunities || []).length;
  const thisWeekDeals = (opportunities || []).filter(v => isThisWeek(new Date(v.created_at))).length;
  const lastWeekDeals = (opportunities || []).filter(v => isLastWeek(new Date(v.created_at))).length;
  const weekTrend = lastWeekDeals > 0 ? Math.round(((thisWeekDeals - lastWeekDeals) / lastWeekDeals) * 100) : (thisWeekDeals > 0 ? 100 : 0);

  // Calculate conversion rates
  const leads = funnelStages.prospecting.opportunities.length;
  const inProgress = funnelStages.qualification.opportunities.length;
  const won = funnelStages['closed-won'].opportunities.length;
  const lost = funnelStages['closed-lost'].opportunities.length;
  const closed = won + lost;

  const leadToInProgress = leads > 0 ? Math.round((inProgress / leads) * 100) : 0;
  const inProgressToWon = inProgress > 0 ? Math.round((won / inProgress) * 100) : 0;
  const inProgressToLost = inProgress > 0 ? Math.round((lost / inProgress) * 100) : 0;
  const overallConversion = closed > 0 ? Math.round((won / closed) * 100) : 0;

  // High priority leads
  const highPriorityLeads = (opportunities || [])
    .filter((opp) => Number(opp.probability || 0) >= 70 && normalizeOpportunityStage(opp.stage) !== 'closed-lost')
    .slice(0, 6);

  // Recent activity
  const recentActivity = (opportunities || []).slice(0, 8);

  // Stage icons
  const stageIcons = {
    prospecting: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>',
    qualification: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>',
    'closed-won': '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    'closed-lost': '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>'
  };

  let html = `
    <div class="funnel-hub">
      <!-- Hero Stats -->
      <div class="funnel-hero">
        <div class="funnel-hero-stat">
          <div class="funnel-stat-icon" style="background: linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(59, 130, 246, 0.05)); color: #3b82f6;">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </div>
          <div class="funnel-stat-content">
            <span class="funnel-stat-value">${totalDeals}</span>
            <span class="funnel-stat-label">Total Deals</span>
          </div>
          <div class="funnel-stat-trend ${weekTrend >= 0 ? 'positive' : 'negative'}">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="${weekTrend >= 0 ? 'M18 15l-6-6-6 6' : 'M6 9l6 6 6-6'}"/></svg>
            ${Math.abs(weekTrend)}%
          </div>
        </div>

        <div class="funnel-hero-stat">
          <div class="funnel-stat-icon" style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(16, 185, 129, 0.05)); color: #10b981;">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          </div>
          <div class="funnel-stat-content">
            <span class="funnel-stat-value">${overallConversion}%</span>
            <span class="funnel-stat-label">Conversion Rate</span>
          </div>
        </div>

        <div class="funnel-hero-stat">
          <div class="funnel-stat-icon" style="background: linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(245, 158, 11, 0.05)); color: #f59e0b;">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          </div>
          <div class="funnel-stat-content">
            <span class="funnel-stat-value">${highPriorityLeads.length}</span>
            <span class="funnel-stat-label">Hot Leads</span>
          </div>
        </div>

        <div class="funnel-hero-stat">
          <div class="funnel-stat-icon" style="background: linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(139, 92, 246, 0.05)); color: #8b5cf6;">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
          </div>
          <div class="funnel-stat-content">
            <span class="funnel-stat-value">${thisWeekDeals}</span>
            <span class="funnel-stat-label">This Week</span>
          </div>
        </div>
      </div>

      <div class="funnel-main-grid">
        <!-- Main Funnel Section -->
        <div class="funnel-main-content">
          <!-- Visual Funnel -->
          <div class="funnel-visual-section">
            <h2 class="funnel-section-title">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
              Sales Pipeline
            </h2>
            
            <div class="funnel-visual">
              ${Object.entries(funnelStages).map(([key, stage], index) => {
    const count = stage.opportunities.length;
    const percentage = totalDeals > 0 ? Math.round((count / totalDeals) * 100) : 0;
    const width = 100 - (index * 12);

    return `
                  <div class="funnel-level" style="--funnel-width: ${width}%; --funnel-color: ${stage.color};">
                    <div class="funnel-level-bar">
                      <div class="funnel-level-fill" style="background: ${stage.gradient};"></div>
                      <div class="funnel-level-content">
                        <span class="funnel-level-icon">${stageIcons[key]}</span>
                        <span class="funnel-level-title">${stage.title}</span>
                        <span class="funnel-level-count">${count}</span>
                        <span class="funnel-level-percent">${percentage}%</span>
                      </div>
                    </div>
                    ${index < 4 ? `
                      <div class="funnel-connector">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>
                      </div>
                    ` : ''}
                  </div>
                `;
  }).join('')}
            </div>
          </div>

          <!-- Conversion Flow -->
          <div class="funnel-conversion-section">
            <h2 class="funnel-section-title">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
              Conversion Flow
            </h2>
            
            <div class="conversion-flow">
              <div class="conversion-step">
                <div class="conversion-step-label">Lead → In Progress</div>
                <div class="conversion-step-bar">
                  <div class="conversion-step-fill" style="width: ${leadToInProgress}%; background: linear-gradient(90deg, #3b82f6, #ec4899);"></div>
                </div>
                <div class="conversion-step-value">${leadToInProgress}%</div>
              </div>
              
              <div class="conversion-step">
                <div class="conversion-step-label">In Progress → Won</div>
                <div class="conversion-step-bar">
                  <div class="conversion-step-fill" style="width: ${inProgressToWon}%; background: linear-gradient(90deg, #ec4899, #10b981);"></div>
                </div>
                <div class="conversion-step-value">${inProgressToWon}%</div>
              </div>
              
              <div class="conversion-step">
                <div class="conversion-step-label">In Progress → Lost</div>
                <div class="conversion-step-bar">
                  <div class="conversion-step-fill" style="width: ${inProgressToLost}%; background: linear-gradient(90deg, #ec4899, #ef4444);"></div>
                </div>
                <div class="conversion-step-value">${inProgressToLost}%</div>
              </div>
            </div>
          </div>

          <!-- Stage Cards -->
          <div class="funnel-stages-grid">
            ${Object.entries(funnelStages).map(([key, stage]) => {
    const count = stage.opportunities.length;
    const percentage = totalDeals > 0 ? Math.round((count / totalDeals) * 100) : 0;
    const recentInStage = stage.opportunities.slice(0, 3);

    return `
                <div class="funnel-stage-card" style="--stage-color: ${stage.color};">
                  <div class="funnel-stage-card-header">
                    <div class="funnel-stage-card-icon" style="background: ${stage.gradient};">
                      ${stageIcons[key]}
                    </div>
                    <div class="funnel-stage-card-info">
                      <h3 class="funnel-stage-card-title">${stage.title}</h3>
                      <span class="funnel-stage-card-count">${count} deal${count !== 1 ? 's' : ''}</span>
                    </div>
                    <div class="funnel-stage-card-badge">${percentage}%</div>
                  </div>
                  
                  <div class="funnel-stage-card-progress">
                    <div class="funnel-stage-card-progress-fill" style="width: ${percentage}%; background: ${stage.gradient};"></div>
                  </div>
                  
                  ${recentInStage.length > 0 ? `
                    <div class="funnel-stage-card-items">
                      ${recentInStage.map(v => `
                        <div class="funnel-stage-item">
                          <span class="funnel-stage-item-company">${v.company_name || v.name || 'Unknown'}</span>
                          <span class="funnel-stage-item-date">${getRelativeTimeSafe(v.updated_at || v.created_at)}</span>
                        </div>
                      `).join('')}
                    </div>
                  ` : `
                    <div class="funnel-stage-card-empty">No visits in this stage</div>
                  `}
                </div>
              `;
  }).join('')}
          </div>
        </div>

        <!-- Sidebar -->
        <div class="funnel-sidebar">
          <!-- Hot Leads -->
          <div class="funnel-sidebar-card">
            <div class="funnel-sidebar-header">
              <h3 class="funnel-sidebar-title">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>
                Hot Leads
              </h3>
              <span class="funnel-sidebar-badge">${highPriorityLeads.length}</span>
            </div>
            
            <div class="funnel-sidebar-content">
              ${highPriorityLeads.length > 0 ? highPriorityLeads.map(visit => `
                <div class="hot-lead-item">
                  <div class="hot-lead-avatar">${getInitials(visit.company_name || visit.name || 'U')}</div>
                  <div class="hot-lead-info">
                    <span class="hot-lead-company">${visit.company_name || visit.name || 'Unknown'}</span>
                    <span class="hot-lead-contact">${visit.name || 'High probability deal'}</span>
                  </div>
                  <div class="hot-lead-score ${Number(visit.probability || 0) >= 80 ? 'score-hot' : 'score-warm'}">
                    ${Number(visit.probability || 0)}%
                  </div>
                </div>
              `).join('') : `
                <div class="funnel-sidebar-empty">
                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>
                  <p>No hot leads yet</p>
                  <span>Deals with 70%+ probability appear here</span>
                </div>
              `}
            </div>
          </div>

          <!-- Recent Activity -->
          <div class="funnel-sidebar-card">
            <div class="funnel-sidebar-header">
              <h3 class="funnel-sidebar-title">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="10"/></svg>
                Recent Activity
              </h3>
            </div>
            
            <div class="funnel-activity-timeline">
              ${recentActivity.map(visit => {
    const mappedStage = normalizeOpportunityStage(visit.stage);
    const stageColor = funnelStages[mappedStage]?.color || '#6b7280';
    const stageTitle = funnelStages[mappedStage]?.title || 'Deal';
    return `
                  <div class="funnel-activity-item">
                    <div class="funnel-activity-dot" style="background: ${stageColor};"></div>
                    <div class="funnel-activity-content">
                      <span class="funnel-activity-company">${visit.company_name || visit.name || 'Unknown'}</span>
                      <span class="funnel-activity-meta">
                        <span class="funnel-activity-stage" style="color: ${stageColor};">${stageTitle}</span>
                        <span class="funnel-activity-time">${getRelativeTimeSafe(visit.updated_at || visit.created_at)}</span>
                      </span>
                    </div>
                  </div>
                `;
  }).join('')}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  viewContainer.innerHTML = html;
}


// ── Exports ────────────────────────────────────────────────────
export {
  renderSalesFunnelView,
};
