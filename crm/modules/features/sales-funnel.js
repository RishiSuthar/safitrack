// modules/features/sales-funnel.js
// Sales funnel / pipeline analytics view.
import { state, supabaseClient } from '../state.js';
import { viewContainer } from '../ui/dom.js';
import { showToast, escapeHtml, getInitials } from '../ui/toast.js';
import { renderSkeletonCards, renderError } from '../utils/helpers.js';

async function renderSalesFunnelView() {
  let visits;
  let error;

  if (state.isManager) {
    // Managers see all visits within their org
    let mVisitsQ = supabaseClient.from('visits').select('*').order('created_at', { ascending: false });
    if (state.currentOrganization?.id) mVisitsQ = mVisitsQ.eq('organization_id', state.currentOrganization.id);
    const result = await mVisitsQ;
    visits = result.data;
    error = result.error;
  } else {
    // Sales reps see only their own visits
    const result = await supabaseClient
      .from('visits')
      .select('*')
      .eq('user_id', state.currentUser.id)
      .order('created_at', { ascending: false });
    visits = result.data;
    error = result.error;
  }

  if (error) {
    viewContainer.innerHTML = renderError(error.message);
    return;
  }

  const funnelStages = {
    new_lead: { title: 'New Leads', icon: 'sparkles', visits: [], color: '#3b82f6', gradient: 'linear-gradient(135deg, #3b82f6, #1d4ed8)' },
    follow_up: { title: 'Follow-ups', icon: 'refresh', visits: [], color: '#8b5cf6', gradient: 'linear-gradient(135deg, #8b5cf6, #6d28d9)' },
    demo: { title: 'Product Demos', icon: 'presentation', visits: [], color: '#f59e0b', gradient: 'linear-gradient(135deg, #f59e0b, #d97706)' },
    closing: { title: 'Closing', icon: 'handshake', visits: [], color: '#10b981', gradient: 'linear-gradient(135deg, #10b981, #059669)' },
    support: { title: 'Support', icon: 'headset', visits: [], color: '#6b7280', gradient: 'linear-gradient(135deg, #6b7280, #4b5563)' }
  };

  visits.forEach(visit => {
    const type = visit.visit_type || 'new_lead';
    if (funnelStages[type]) {
      funnelStages[type].visits.push(visit);
    }
  });

  const totalVisits = visits.length;
  const thisWeekVisits = visits.filter(v => isThisWeek(new Date(v.created_at))).length;
  const lastWeekVisits = visits.filter(v => isLastWeek(new Date(v.created_at))).length;
  const weekTrend = lastWeekVisits > 0 ? Math.round(((thisWeekVisits - lastWeekVisits) / lastWeekVisits) * 100) : 100;

  // Calculate conversion rates
  const newLeads = funnelStages.new_lead.visits.length;
  const followUps = funnelStages.follow_up.visits.length;
  const demos = funnelStages.demo.visits.length;
  const closings = funnelStages.closing.visits.length;

  const leadToFollowUp = newLeads > 0 ? Math.round((followUps / newLeads) * 100) : 0;
  const followUpToDemo = followUps > 0 ? Math.round((demos / followUps) * 100) : 0;
  const demoToClose = demos > 0 ? Math.round((closings / demos) * 100) : 0;
  const overallConversion = newLeads > 0 ? Math.round((closings / newLeads) * 100) : 0;

  // High priority leads
  const highPriorityLeads = visits.filter(v => v.lead_score && v.lead_score >= 70).slice(0, 6);

  // Recent activity
  const recentVisits = visits.slice(0, 8);

  // Stage icons
  const stageIcons = {
    new_lead: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>',
    follow_up: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>',
    demo: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/></svg>',
    closing: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/></svg>',
    support: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm0 0a9 9 0 1 1 18 0m0 0v5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3Z"/></svg>'
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
            <span class="funnel-stat-value">${totalVisits}</span>
            <span class="funnel-stat-label">Total Visits</span>
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
            <span class="funnel-stat-value">${thisWeekVisits}</span>
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
    const count = stage.visits.length;
    const percentage = totalVisits > 0 ? Math.round((count / totalVisits) * 100) : 0;
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
                <div class="conversion-step-label">Lead → Follow-up</div>
                <div class="conversion-step-bar">
                  <div class="conversion-step-fill" style="width: ${leadToFollowUp}%; background: linear-gradient(90deg, #3b82f6, #8b5cf6);"></div>
                </div>
                <div class="conversion-step-value">${leadToFollowUp}%</div>
              </div>
              
              <div class="conversion-step">
                <div class="conversion-step-label">Follow-up → Demo</div>
                <div class="conversion-step-bar">
                  <div class="conversion-step-fill" style="width: ${followUpToDemo}%; background: linear-gradient(90deg, #8b5cf6, #f59e0b);"></div>
                </div>
                <div class="conversion-step-value">${followUpToDemo}%</div>
              </div>
              
              <div class="conversion-step">
                <div class="conversion-step-label">Demo → Close</div>
                <div class="conversion-step-bar">
                  <div class="conversion-step-fill" style="width: ${demoToClose}%; background: linear-gradient(90deg, #f59e0b, #10b981);"></div>
                </div>
                <div class="conversion-step-value">${demoToClose}%</div>
              </div>
            </div>
          </div>

          <!-- Stage Cards -->
          <div class="funnel-stages-grid">
            ${Object.entries(funnelStages).map(([key, stage]) => {
    const count = stage.visits.length;
    const percentage = totalVisits > 0 ? Math.round((count / totalVisits) * 100) : 0;
    const recentInStage = stage.visits.slice(0, 3);

    return `
                <div class="funnel-stage-card" style="--stage-color: ${stage.color};">
                  <div class="funnel-stage-card-header">
                    <div class="funnel-stage-card-icon" style="background: ${stage.gradient};">
                      ${stageIcons[key]}
                    </div>
                    <div class="funnel-stage-card-info">
                      <h3 class="funnel-stage-card-title">${stage.title}</h3>
                      <span class="funnel-stage-card-count">${count} visit${count !== 1 ? 's' : ''}</span>
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
                          <span class="funnel-stage-item-company">${v.company_name || 'Unknown'}</span>
                          <span class="funnel-stage-item-date">${getRelativeTime(new Date(v.created_at))}</span>
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
                  <div class="hot-lead-avatar">${getInitials(visit.company_name || 'U')}</div>
                  <div class="hot-lead-info">
                    <span class="hot-lead-company">${visit.company_name || 'Unknown'}</span>
                    <span class="hot-lead-contact">${visit.contact_name || 'No contact'}</span>
                  </div>
                  <div class="hot-lead-score ${visit.lead_score >= 80 ? 'score-hot' : 'score-warm'}">
                    ${visit.lead_score}%
                  </div>
                </div>
              `).join('') : `
                <div class="funnel-sidebar-empty">
                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>
                  <p>No hot leads yet</p>
                  <span>Leads with 70%+ score appear here</span>
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
              ${recentVisits.map(visit => {
    const stageColor = funnelStages[visit.visit_type]?.color || '#6b7280';
    const stageTitle = funnelStages[visit.visit_type]?.title || 'Visit';
    return `
                  <div class="funnel-activity-item">
                    <div class="funnel-activity-dot" style="background: ${stageColor};"></div>
                    <div class="funnel-activity-content">
                      <span class="funnel-activity-company">${visit.company_name || 'Unknown'}</span>
                      <span class="funnel-activity-meta">
                        <span class="funnel-activity-stage" style="color: ${stageColor};">${stageTitle}</span>
                        <span class="funnel-activity-time">${getRelativeTime(new Date(visit.created_at))}</span>
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
