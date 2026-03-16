// modules/features/dashboard.js
// Professional dashboard view.
import { state, supabaseClient } from '../state.js';
import { viewContainer } from '../ui/dom.js';
import { showToast, escapeHtml, getInitials } from '../ui/toast.js';
import { renderSkeletonCards } from '../utils/helpers.js';

async function renderProfessionalDashboardView() {
  const viewContainer = document.getElementById('view-container');
  const headerTitle = document.querySelector('.header-title');
  if (headerTitle) headerTitle.textContent = 'Dashboard';

  try {
    const [
      contactsResult,
      companiesResult,
      tasksResult,
      opportunitiesResult,
      visitsResult,
      repsResult
    ] = await Promise.all([
      supabaseClient.from('people').select('*', { count: 'exact', head: true }).eq('organization_id', state.currentOrganization?.id || '00000000-0000-0000-0000-000000000000'),
      supabaseClient.from('companies').select('*', { count: 'exact', head: true }).eq('organization_id', state.currentOrganization?.id || '00000000-0000-0000-0000-000000000000'),
      supabaseClient.from('tasks').select('id, status, due_date, created_at').eq('organization_id', state.currentOrganization?.id || '00000000-0000-0000-0000-000000000000'),
      supabaseClient.from('opportunities').select('id, value, stage, created_at, updated_at').eq('organization_id', state.currentOrganization?.id || '00000000-0000-0000-0000-000000000000'),
      supabaseClient
        .from('visits')
        .select('id, user_id, company_name, visit_type, lead_score, created_at, profiles(first_name, last_name)')
        .eq('organization_id', state.currentOrganization?.id || '00000000-0000-0000-0000-000000000000')
        .order('created_at', { ascending: false })
        .limit(100),
      supabaseClient.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'sales_rep').eq('organization_id', state.currentOrganization?.id || '00000000-0000-0000-0000-000000000000')
    ]);

    if (contactsResult.error || companiesResult.error || tasksResult.error || opportunitiesResult.error || visitsResult.error || repsResult.error) {
      throw new Error(
        contactsResult.error?.message ||
        companiesResult.error?.message ||
        tasksResult.error?.message ||
        opportunitiesResult.error?.message ||
        visitsResult.error?.message ||
        repsResult.error?.message ||
        'Unable to load dashboard data'
      );
    }

    const contactsCount = contactsResult.count || 0;
    const companiesCount = companiesResult.count || 0;
    const tasks = tasksResult.data || [];
    const opportunities = opportunitiesResult.data || [];
    const recentVisits = visitsResult.data || [];
    const totalSalesReps = repsResult.count || 0;

    const normalizeStage = (stage) => {
      const value = String(stage || '').toLowerCase().replace(/_/g, '-');
      if (value === 'closed-won') return 'closed-won';
      if (value === 'closed-lost') return 'closed-lost';
      if (['prospecting', 'qualification', 'proposal', 'negotiation'].includes(value)) return value;
      return 'prospecting';
    };

    const formatMoney = (amount) => `$${Math.round(amount || 0).toLocaleString()}`;
    const now = new Date();
    const todayYMD = now.toISOString().slice(0, 10);
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);

    const completedTasks = tasks.filter(t => String(t.status || '').toLowerCase() === 'completed').length;
    const openTasks = tasks.length - completedTasks;
    const taskCompletionRate = tasks.length > 0 ? (completedTasks / tasks.length) * 100 : 0;

    const enrichedOpps = opportunities.map(opp => ({
      ...opp,
      normalizedStage: normalizeStage(opp.stage),
      numericValue: Number(opp.value) || 0
    }));

    const openOpps = enrichedOpps.filter(o => !['closed-won', 'closed-lost'].includes(o.normalizedStage));
    const wonOpps = enrichedOpps.filter(o => o.normalizedStage === 'closed-won');
    const closedOpps = enrichedOpps.filter(o => ['closed-won', 'closed-lost'].includes(o.normalizedStage));
    const pipelineOpenValue = openOpps.reduce((sum, o) => sum + o.numericValue, 0);
    const wonRevenue = wonOpps.reduce((sum, o) => sum + o.numericValue, 0);
    const winRate = closedOpps.length > 0 ? (wonOpps.length / closedOpps.length) * 100 : 0;
    const avgDealSize = openOpps.length > 0 ? pipelineOpenValue / openOpps.length : 0;

    const visitsToday = recentVisits.filter(v => {
      const visitDate = (v.date || v.created_at || '').toString().slice(0, 10);
      return visitDate === todayYMD;
    }).length;

    const visitsThisWeek = recentVisits.filter(v => {
      const visitDate = new Date(v.date || v.created_at);
      return !Number.isNaN(visitDate.getTime()) && visitDate >= weekStart;
    }).length;

    const activeRepIds30d = new Set(
      recentVisits
        .filter(v => {
          const visitDate = new Date(v.date || v.created_at);
          const daysAgo = (now - visitDate) / (1000 * 60 * 60 * 24);
          return !Number.isNaN(visitDate.getTime()) && daysAgo <= 30;
        })
        .map(v => v.user_id)
        .filter(Boolean)
    );

    const leadScoreValues = recentVisits
      .map(v => Number(v.lead_score))
      .filter(score => Number.isFinite(score) && score > 0);
    const avgLeadScore = leadScoreValues.length
      ? (leadScoreValues.reduce((sum, score) => sum + score, 0) / leadScoreValues.length)
      : 0;

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const trendMonths = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      trendMonths.push({
        key: `${d.getFullYear()}-${d.getMonth()}`,
        name: monthNames[d.getMonth()],
        pipelineValue: 0,
        wonValue: 0
      });
    }

    enrichedOpps.forEach(opp => {
      const createdAt = new Date(opp.created_at);
      const createdKey = `${createdAt.getFullYear()}-${createdAt.getMonth()}`;
      const createdBucket = trendMonths.find(m => m.key === createdKey);
      if (createdBucket) createdBucket.pipelineValue += opp.numericValue;

      if (opp.normalizedStage === 'closed-won') {
        const wonAt = new Date(opp.updated_at || opp.created_at);
        const wonKey = `${wonAt.getFullYear()}-${wonAt.getMonth()}`;
        const wonBucket = trendMonths.find(m => m.key === wonKey);
        if (wonBucket) wonBucket.wonValue += opp.numericValue;
      }
    });

    const maxTrendValue = Math.max(...trendMonths.map(m => Math.max(m.pipelineValue, m.wonValue)), 1);

    const stageMeta = [
      { key: 'prospecting', label: 'Prospecting', color: '#3b82f6' },
      { key: 'qualification', label: 'Qualification', color: '#8b5cf6' },
      { key: 'proposal', label: 'Proposal', color: '#f59e0b' },
      { key: 'negotiation', label: 'Negotiation', color: '#f97316' },
      { key: 'closed-won', label: 'Closed Won', color: '#10b981' },
      { key: 'closed-lost', label: 'Closed Lost', color: '#ef4444' }
    ];

    const stageSummary = stageMeta.map(meta => {
      const stageOpps = enrichedOpps.filter(o => o.normalizedStage === meta.key);
      return {
        ...meta,
        count: stageOpps.length,
        value: stageOpps.reduce((sum, o) => sum + o.numericValue, 0)
      };
    });

    const donutTotal = Math.max(enrichedOpps.length, 1);
    let running = 0;
    const donutSegments = stageSummary
      .filter(item => item.count > 0)
      .map(item => {
        const start = running;
        const pct = (item.count / donutTotal) * 100;
        running += pct;
        return `${item.color} ${start}% ${running}%`;
      });
    const donutBackground = donutSegments.length
      ? `conic-gradient(${donutSegments.join(', ')})`
      : 'conic-gradient(#e5e7eb 0% 100%)';

    const html = `
      <div class="dashboard-container">
        <div class="dashboard-header">
           <div>
         <h1 class="dashboard-title">Revenue & Activity Overview</h1>
         <p class="dashboard-subtitle">Live metrics from contacts, tasks, opportunities, and visits</p>
           </div>
           <div class="dashboard-actions">
          <button class="btn btn-secondary btn-sm" id="dashboard-refresh-btn">
           <i class="fas fa-rotate-right"></i>
           Refresh
          </button>
           </div>
        </div>

        <div class="stats-grid">
           <div class="stat-card">
              <div class="stat-header">
            <span class="stat-title">Open Pipeline</span>
            <div class="stat-icon green"><i class="fas fa-sack-dollar"></i></div>
          </div>
          <div class="stat-value-container">
            <span class="stat-value">${formatMoney(pipelineOpenValue)}</span>
          </div>
          <div class="stat-meta">${openOpps.length} open opportunities</div>
        </div>

        <div class="stat-card">
          <div class="stat-header">
            <span class="stat-title">Closed Revenue</span>
            <div class="stat-icon blue"><i class="fas fa-chart-line"></i></div>
          </div>
          <div class="stat-value-container">
            <span class="stat-value">${formatMoney(wonRevenue)}</span>
          </div>
          <div class="stat-meta">Win rate ${winRate.toFixed(1)}%</div>
        </div>

        <div class="stat-card">
          <div class="stat-header">
            <span class="stat-title">Task Completion</span>
            <div class="stat-icon orange"><i class="fas fa-list-check"></i></div>
          </div>
          <div class="stat-value-container">
            <span class="stat-value">${taskCompletionRate.toFixed(0)}%</span>
          </div>
          <div class="stat-meta">${openTasks} open • ${completedTasks} done</div>
        </div>

        <div class="stat-card">
          <div class="stat-header">
            <span class="stat-title">Visits</span>
            <div class="stat-icon purple"><i class="fas fa-handshake"></i></div>
          </div>
          <div class="stat-value-container">
            <span class="stat-value">${visitsThisWeek}</span>
          </div>
          <div class="stat-meta">${visitsToday} today</div>
        </div>

        <div class="stat-card">
          <div class="stat-header">
            <span class="stat-title">Active Reps (30d)</span>
                 <div class="stat-icon purple"><i class="fas fa-address-book"></i></div>
              </div>
              <div class="stat-value-container">
            <span class="stat-value">${activeRepIds30d.size}</span>
              </div>
          <div class="stat-meta">of ${totalSalesReps} sales reps</div>
           </div>

           <div class="stat-card">
              <div class="stat-header">
            <span class="stat-title">Coverage</span>
            <div class="stat-icon blue"><i class="fas fa-building"></i></div>
              </div>
              <div class="stat-value-container">
            <span class="stat-value">${contactsCount}</span>
              </div>
          <div class="stat-meta">${companiesCount} companies • avg lead ${avgLeadScore.toFixed(0)}%</div>
           </div>
        </div>

        <div class="charts-grid">
           <div class="chart-card">
              <div class="chart-header">
            <h3 class="chart-title">6-Month Opportunity Value Trend</h3>
            <span class="chart-caption">Created vs Closed Won</span>
              </div>
          <div class="chart-placeholder trend-chart-placeholder">
            <div class="css-chart dual-series-chart">
              ${trendMonths.map(m => {
      const createdHeight = Math.max((m.pipelineValue / maxTrendValue) * 100, m.pipelineValue > 0 ? 5 : 0);
      const wonHeight = Math.max((m.wonValue / maxTrendValue) * 100, m.wonValue > 0 ? 5 : 0);
      return `
                        <div class="chart-bar-group">
                   <div class="chart-bars-pair">
                    <div class="chart-bar chart-bar-created" style="height: ${createdHeight}%;" data-value="Created ${formatMoney(m.pipelineValue)}"></div>
                    <div class="chart-bar chart-bar-won" style="height: ${wonHeight}%;" data-value="Won ${formatMoney(m.wonValue)}"></div>
                   </div>
                            <span class="chart-label">${m.name}</span>
                        </div>
                        `;
    }).join('')}
                 </div>
            <div class="trend-legend">
              <span><span class="legend-dot created"></span>Created</span>
              <span><span class="legend-dot won"></span>Closed Won</span>
            </div>
              </div>
           </div>

           <div class="chart-card">
              <div class="chart-header">
                 <h3 class="chart-title">Pipeline Stages</h3>
              </div>
              <div class="donut-chart-container">
            <div class="donut-chart" style="background: ${donutBackground};">
                    <div class="donut-inner">
                <span class="donut-total">${enrichedOpps.length}</span>
                       <span class="donut-label">Opportunities</span>
                    </div>
                 </div>
                 <div class="donut-legend">
              ${stageSummary.map(item => `
               <div class="legend-item">
                <div class="legend-dot" style="background:${item.color};"></div>
                ${item.label} (${item.count})
               </div>
              `).join('')}
                 </div>
              </div>
           </div>
        </div>

      <div class="stage-breakdown-card">
       <div class="chart-header">
        <h3 class="chart-title">Stage Value Breakdown</h3>
       </div>
       <div class="stage-breakdown-grid">
        ${stageSummary.map(item => `
          <div class="stage-breakdown-item">
           <div class="stage-breakdown-top">
            <span class="legend-dot" style="background:${item.color};"></span>
            <span>${item.label}</span>
           </div>
           <div class="stage-breakdown-value">${formatMoney(item.value)}</div>
           <div class="stage-breakdown-count">${item.count} deals</div>
          </div>
        `).join('')}
       </div>
      </div>

        <div class="recent-activity-card">
           <div class="chart-header">
          <h3 class="chart-title">Recent Visit Activity</h3>
           </div>
           <div class="table-responsive">
              <table class="dashboard-table">
                 <thead>
                    <tr>
                       <th>Representative</th>
                       <th>Company</th>
                <th>Visit Type</th>
                <th>Lead Score</th>
                       <th>Date</th>
                    </tr>
                 </thead>
                 <tbody>
              ${recentVisits.slice(0, 8).map(visit => {
      const repName = visit.profiles ? `${visit.profiles.first_name} ${visit.profiles.last_name}` : 'Unknown';
      const initials = repName.split(' ').map(n => n[0]).join('').substring(0, 2);
      const score = Number(visit.lead_score);
      const scoreClass = Number.isFinite(score) && score >= 80 ? 'high' : Number.isFinite(score) && score >= 50 ? 'medium' : 'low';
      const visitDate = new Date(visit.date || visit.created_at);
      return `
                        <tr>
                           <td>
                              <div class="user-cell">
                                 <div class="user-img-circle">${initials}</div>
                                 <span style="font-weight:500;">${repName}</span>
                              </div>
                           </td>
                           <td>${visit.company_name || 'N/A'}</td>
                  <td>${visit.visit_type || 'General Visit'}</td>
                  <td>${Number.isFinite(score) ? `<span class="lead-score-pill ${scoreClass}">${score}%</span>` : '<span class="text-muted">—</span>'}</td>
                  <td>${Number.isNaN(visitDate.getTime()) ? '—' : visitDate.toLocaleDateString()}</td>
                        </tr>
                        `;
    }).join('') || '<tr><td colspan="5">No recent visits</td></tr>'}
                 </tbody>
              </table>
           </div>
        </div>

      </div>
    `;

    viewContainer.innerHTML = html;

    document.getElementById('dashboard-refresh-btn')?.addEventListener('click', () => {
      renderProfessionalDashboardView();
      showToast('Dashboard refreshed', 'success', { subtle: true, duration: 1200 });
    });

  } catch (err) {
    console.error('Error rendering dashboard:', err);
    viewContainer.innerHTML = renderError('Failed to load dashboard data: ' + err.message);
  }
}

// ======================
// CHANGE PASSWORD MODAL
// ======================


// ── Exports ────────────────────────────────────────────────────
export {
  renderProfessionalDashboardView,
};
