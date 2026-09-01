// modules/features/dashboard.js
import { state, supabaseClient } from '../state.js';
import { showToast } from '../ui/toast.js';
import { renderError, getCurrencySymbol } from '../utils/helpers.js';
import { DEFAULT_SALES_STAGES, normalizeOpportunityStage } from '../utils/pipeline-stages.js';

// ── Helpers ─────────────────────────────────────────────────────

const ORG_ID = () => state.currentOrganization?.id || '00000000-0000-0000-0000-000000000000';

function fmtMoney(n) {
  const sym = getCurrencySymbol();
  const abs = Math.abs(n || 0);
  if (abs >= 1_000_000) return `${sym} ${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sym} ${(n / 1_000).toFixed(1)}K`;
  return `${sym} ${Math.round(n).toLocaleString()}`;
}

function fmtFull(n) {
  return `${getCurrencySymbol()} ${Math.round(n || 0).toLocaleString()}`;
}

function pct(a, b) { return b > 0 ? ((a / b) * 100).toFixed(1) : '0.0'; }

function relTime(date) {
  const now = Date.now();
  const d = new Date(date);
  if (isNaN(d.getTime())) return '—';
  const diff = now - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function daysUntil(dateStr) {
  if (!dateStr) return Infinity;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return Infinity;
  return Math.ceil((d - new Date()) / 86400000);
}

function initials(first, last) {
  return ((first || '')[0] || '') + ((last || '')[0] || '') || '?';
}

const STAGE_META = DEFAULT_SALES_STAGES.map((s) => ({
  key: s.id,
  label: s.title,
  color: s.color,
}));

function esc(s) {
  const el = document.createElement('span');
  el.textContent = s || '';
  return el.innerHTML;
}

function formatVisitType(type) {
  const raw = String(type || 'visit').trim().toLowerCase();
  const label = raw.replace(/[_-]+/g, ' ');
  return label.replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Data layer ──────────────────────────────────────────────────

async function fetchDashboardData() {
  const orgId = ORG_ID();

  const [
    peopleRes,
    companiesRes,
    tasksRes,
    oppsRes,
    visitsRes,
    profilesRes,
    remindersRes,
  ] = await Promise.all([
    supabaseClient.from('people').select('*', { count: 'exact', head: true }).eq('organization_id', orgId),
    supabaseClient.from('companies').select('*', { count: 'exact', head: true }).eq('organization_id', orgId),
    supabaseClient.from('tasks').select('id, title, status, priority, due_date, assigned_to, created_at').eq('organization_id', orgId),
    supabaseClient.from('opportunities').select('id, name, value, stage, created_at, updated_at').eq('organization_id', orgId),
    supabaseClient.from('visits').select('id, user_id, company_name, visit_type, lead_score, notes, created_at').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(200),
    supabaseClient.from('profiles').select('id, first_name, last_name, role').eq('organization_id', orgId),
    supabaseClient.from('reminders').select('id, title, reminder_date, is_completed, created_at').eq('organization_id', orgId).eq('is_completed', false).order('reminder_date', { ascending: true }).limit(10),
  ]);

  const err = [peopleRes, companiesRes, tasksRes, oppsRes, visitsRes, profilesRes, remindersRes].find(r => r.error);
  if (err) throw new Error(err.error.message);

  return {
    peopleCount: peopleRes.count || 0,
    companiesCount: companiesRes.count || 0,
    tasks: tasksRes.data || [],
    opps: oppsRes.data || [],
    visits: visitsRes.data || [],
    profiles: profilesRes.data || [],
    reminders: remindersRes.data || [],
  };
}

// ── Compute metrics ─────────────────────────────────────────────

function compute(raw) {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  // Opportunities
  const opps = raw.opps.map(o => ({
    ...o,
    stage: normalizeOpportunityStage(o.stage),
    val: Number(o.value) || 0,
  }));

  const openOpps   = opps.filter(o => !['closed-won', 'closed-lost'].includes(o.stage));
  const wonOpps    = opps.filter(o => o.stage === 'closed-won');
  const lostOpps   = opps.filter(o => o.stage === 'closed-lost');
  const closedOpps = [...wonOpps, ...lostOpps];

  const pipelineValue = openOpps.reduce((s, o) => s + o.val, 0);
  const wonRevenue    = wonOpps.reduce((s, o) => s + o.val, 0);
  const lostRevenue   = lostOpps.reduce((s, o) => s + o.val, 0);
  const winRate       = closedOpps.length > 0 ? (wonOpps.length / closedOpps.length) * 100 : 0;
  const avgDealSize   = wonOpps.length > 0 ? wonRevenue / wonOpps.length : 0;

  // Weighted pipeline: prospecting 10%, qualification 30%, proposal 60%, negotiation 80%
  const stageWeights = { prospecting: 0.1, qualification: 0.3, proposal: 0.6, negotiation: 0.8 };
  const weightedPipeline = openOpps.reduce((s, o) => s + o.val * (stageWeights[o.stage] || 0.1), 0);

  // Pipeline by stage
  const stageBreakdown = STAGE_META.map(sm => {
    const items = opps.filter(o => o.stage === sm.key);
    return { ...sm, count: items.length, value: items.reduce((s, o) => s + o.val, 0) };
  });

  // Tasks
  const tasks = raw.tasks;
  const completedTasks = tasks.filter(t => (t.status || '').toLowerCase() === 'completed');
  const openTasks      = tasks.filter(t => (t.status || '').toLowerCase() !== 'completed');
  const overdueTasks   = openTasks.filter(t => t.due_date && daysUntil(t.due_date) < 0);
  const dueSoonTasks   = openTasks
    .filter(t => { const d = daysUntil(t.due_date); return d >= 0 && d <= 7; })
    .sort((a, b) => daysUntil(a.due_date) - daysUntil(b.due_date));
  const taskCompletionRate = tasks.length > 0 ? (completedTasks.length / tasks.length) * 100 : 0;

  // Visits
  const visits = raw.visits;
  const visitsToday = visits.filter(v => (v.created_at || '').slice(0, 10) === todayStr).length;
  const visits7d = visits.filter(v => {
    const d = new Date(v.created_at);
    return !isNaN(d) && (now - d) <= 7 * 86400000;
  }).length;
  const visits30d = visits.filter(v => {
    const d = new Date(v.created_at);
    return !isNaN(d) && (now - d) <= 30 * 86400000;
  }).length;

  // Team activity — rep leaderboard (last 30 days)
  const reps = raw.profiles.filter(p => p.role === 'sales_rep' || p.role === 'manager');
  const repMap = new Map(reps.map(p => [p.id, p]));

  const repStats = new Map();
  visits.forEach(v => {
    if (!v.user_id) return;
    const d = new Date(v.created_at);
    if (isNaN(d) || (now - d) > 30 * 86400000) return;
    if (!repStats.has(v.user_id)) repStats.set(v.user_id, { visits: 0, wonValue: 0 });
    repStats.get(v.user_id).visits++;
  });
  wonOpps.forEach(o => {
    const uid = o.profiles ? null : null; // won opps don't carry user_id directly
    // attribution via updated_at within 30d
  });

  const leaderboard = Array.from(repStats.entries())
    .map(([uid, s]) => {
      const p = repMap.get(uid);
      return {
        id: uid,
        name: p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() : 'Unknown',
        initials: p ? initials(p.first_name, p.last_name) : '??',
        visits: s.visits,
      };
    })
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 8);

  const activeRepCount = repStats.size;
  const totalReps = reps.filter(p => p.role === 'sales_rep').length;

  // 6-month trend
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`,
      label: d.toLocaleDateString(undefined, { month: 'short' }),
      created: 0, won: 0, visits: 0,
    });
  }

  opps.forEach(o => {
    const cd = new Date(o.created_at);
    const ck = `${cd.getFullYear()}-${String(cd.getMonth()).padStart(2, '0')}`;
    const bucket = months.find(m => m.key === ck);
    if (bucket) bucket.created += o.val;
    if (o.stage === 'closed-won') {
      const wd = new Date(o.updated_at || o.created_at);
      const wk = `${wd.getFullYear()}-${String(wd.getMonth()).padStart(2, '0')}`;
      const wb = months.find(m => m.key === wk);
      if (wb) wb.won += o.val;
    }
  });

  visits.forEach(v => {
    const vd = new Date(v.created_at);
    const vk = `${vd.getFullYear()}-${String(vd.getMonth()).padStart(2, '0')}`;
    const vb = months.find(m => m.key === vk);
    if (vb) vb.visits++;
  });

  // Deals currently in progress
  const closingSoon = openOpps
    .filter(o => o.stage === 'qualification')
    .sort((a, b) => b.val - a.val)
    .slice(0, 6);

  // Reminders
  const upcomingReminders = (raw.reminders || []).slice(0, 5);

  // Profile lookup map
  const profileMap = new Map(raw.profiles.map(p => [p.id, p]));

  return {
    pipelineValue, wonRevenue, lostRevenue, winRate, avgDealSize, weightedPipeline,
    openOpps, wonOpps, closedOpps, stageBreakdown,
    tasks, completedTasks, openTasks, overdueTasks, dueSoonTasks, taskCompletionRate,
    visitsToday, visits7d, visits30d, visits: visits.slice(0, 10),
    leaderboard, activeRepCount, totalReps,
    peopleCount: raw.peopleCount, companiesCount: raw.companiesCount,
    months, closingSoon, upcomingReminders, profileMap,
  };
}

// ── Render ──────────────────────────────────────────────────────

function buildHTML(m) {
  const maxBar = Math.max(...m.months.map(mo => Math.max(mo.created, mo.won)), 1);
  const maxVisitBar = Math.max(...m.months.map(mo => mo.visits), 1);

  // Pipeline stage bar (horizontal stacked)
  const totalPipeVal = m.stageBreakdown.reduce((s, st) => s + st.value, 0) || 1;

  return `
<div class="db">

  <!-- KPI Row -->
  <div class="db-kpis">
    <div class="db-kpi">
      <div class="db-kpi-top">
        <span class="db-kpi-label">Open Pipeline</span>
        <div class="db-kpi-icon" style="background:rgba(59,130,246,0.1);color:#3b82f6;"><i data-lucide="layers"></i></div>
      </div>
      <div class="db-kpi-val">${fmtMoney(m.pipelineValue)}</div>
      <div class="db-kpi-foot">${m.openOpps.length} open deal${m.openOpps.length !== 1 ? 's' : ''} &middot; weighted ${fmtMoney(m.weightedPipeline)}</div>
    </div>
    <div class="db-kpi">
      <div class="db-kpi-top">
        <span class="db-kpi-label">Won Revenue</span>
        <div class="db-kpi-icon" style="background:rgba(16,185,129,0.1);color:#10b981;"><i data-lucide="trophy"></i></div>
      </div>
      <div class="db-kpi-val">${fmtMoney(m.wonRevenue)}</div>
      <div class="db-kpi-foot">${m.wonOpps.length} won &middot; ${pct(m.wonOpps.length, m.closedOpps.length)}% win rate</div>
    </div>
    <div class="db-kpi">
      <div class="db-kpi-top">
        <span class="db-kpi-label">Avg Deal Size</span>
        <div class="db-kpi-icon" style="background:rgba(139,92,246,0.1);color:#8b5cf6;"><i data-lucide="scale"></i></div>
      </div>
      <div class="db-kpi-val">${fmtMoney(m.avgDealSize)}</div>
      <div class="db-kpi-foot">across ${m.wonOpps.length} closed-won</div>
    </div>
    <div class="db-kpi">
      <div class="db-kpi-top">
        <span class="db-kpi-label">Field Visits</span>
        <div class="db-kpi-icon" style="background:rgba(249,115,22,0.1);color:#f97316;"><i data-lucide="map-pin"></i></div>
      </div>
      <div class="db-kpi-val">${m.visits30d}</div>
      <div class="db-kpi-foot">${m.visitsToday} today &middot; ${m.visits7d} this week</div>
    </div>
    <div class="db-kpi">
      <div class="db-kpi-top">
        <span class="db-kpi-label">Tasks</span>
        <div class="db-kpi-icon" style="background:rgba(245,158,11,0.1);color:#d97706;"><i data-lucide="list-checks"></i></div>
      </div>
      <div class="db-kpi-val">${m.taskCompletionRate.toFixed(0)}%</div>
      <div class="db-kpi-foot">${m.openTasks.length} open &middot; ${m.completedTasks.length} done &middot; ${m.overdueTasks.length} overdue</div>
    </div>
    <div class="db-kpi">
      <div class="db-kpi-top">
        <span class="db-kpi-label">Team</span>
        <div class="db-kpi-icon" style="background:rgba(99,102,241,0.1);color:#6366f1;"><i data-lucide="users"></i></div>
      </div>
      <div class="db-kpi-val">${m.activeRepCount}<span class="db-kpi-of">/${m.totalReps}</span></div>
      <div class="db-kpi-foot">active reps (30d) &middot; ${m.peopleCount} contacts &middot; ${m.companiesCount} companies</div>
    </div>
  </div>

  <!-- Pipeline Stage Bar -->
  <div class="db-card">
    <div class="db-card-head">
      <h2 class="db-card-title">Pipeline by Stage</h2>
      <span class="db-card-sub">${fmtFull(m.pipelineValue + m.wonRevenue + m.lostRevenue)} total value across ${m.stageBreakdown.reduce((s, st) => s + st.count, 0)} opportunities</span>
    </div>
    <div class="db-stage-bar">
      ${m.stageBreakdown.filter(s => s.value > 0).map(s => `<div class="db-stage-seg" style="width:${Math.max((s.value / totalPipeVal) * 100, 2)}%;background:${s.color};" title="${s.label}: ${fmtFull(s.value)} (${s.count})"></div>`).join('')}
      ${m.stageBreakdown.every(s => s.value === 0) ? '<div class="db-stage-seg" style="width:100%;background:var(--border-color);"></div>' : ''}
    </div>
    <div class="db-stage-legend">
      ${m.stageBreakdown.map(s => `
        <div class="db-stage-item">
          <span class="db-dot" style="background:${s.color};"></span>
          <span class="db-stage-name">${s.label}</span>
          <span class="db-stage-val">${fmtMoney(s.value)}</span>
          <span class="db-stage-ct">${s.count}</span>
        </div>
      `).join('')}
    </div>
  </div>

  <!-- Charts Row -->
  <div class="db-row-2">

    <!-- Revenue Trend -->
    <div class="db-card">
      <div class="db-card-head">
        <h2 class="db-card-title">Revenue Trend</h2>
        <div class="db-legend-row">
          <span class="db-legend"><span class="db-dot" style="background:#3b82f6;"></span>Created</span>
          <span class="db-legend"><span class="db-dot" style="background:#10b981;"></span>Won</span>
        </div>
      </div>
      <div class="db-chart-area">
        ${m.months.map(mo => {
          const cH = Math.max((mo.created / maxBar) * 100, mo.created > 0 ? 4 : 0);
          const wH = Math.max((mo.won / maxBar) * 100, mo.won > 0 ? 4 : 0);
          return `
          <div class="db-bar-group">
            <div class="db-bar-pair">
              <div class="db-bar db-bar-c" style="height:${cH}%;" title="Created: ${fmtFull(mo.created)}"></div>
              <div class="db-bar db-bar-w" style="height:${wH}%;" title="Won: ${fmtFull(mo.won)}"></div>
            </div>
            <span class="db-bar-label">${mo.label}</span>
          </div>`;
        }).join('')}
      </div>
    </div>

    <!-- Visit Trend -->
    <div class="db-card">
      <div class="db-card-head">
        <h2 class="db-card-title">Visit Activity</h2>
        <span class="db-card-sub">Last 6 months</span>
      </div>
      <div class="db-chart-area">
        ${m.months.map(mo => {
          const h = Math.max((mo.visits / maxVisitBar) * 100, mo.visits > 0 ? 4 : 0);
          return `
          <div class="db-bar-group">
            <div class="db-bar-pair">
              <div class="db-bar db-bar-v" style="height:${h}%;" title="${mo.visits} visits"></div>
            </div>
            <span class="db-bar-label">${mo.label}</span>
          </div>`;
        }).join('')}
      </div>
    </div>
  </div>

  <!-- Middle Row: Leaderboard + Tasks Due + Closing Soon -->
  <div class="db-row-3">

    <!-- Team Leaderboard -->
    <div class="db-card">
      <div class="db-card-head">
        <h2 class="db-card-title">Team Leaderboard</h2>
        <span class="db-card-sub">Visits (30d)</span>
      </div>
      ${m.leaderboard.length === 0
        ? '<div class="db-empty">No visit activity in the last 30 days</div>'
        : `<div class="db-lb-list">
          ${m.leaderboard.map((rep, i) => `
            <div class="db-lb-row">
              <span class="db-lb-rank">${i + 1}</span>
              <div class="db-avatar" style="background:${['#3b82f6','#8b5cf6','#f97316','#10b981','#ef4444','#6366f1','#ec4899','#14b8a6'][i % 8]};">${esc(rep.initials)}</div>
              <span class="db-lb-name">${esc(rep.name)}</span>
              <span class="db-lb-val">${rep.visits}</span>
              <div class="db-lb-bar-track"><div class="db-lb-bar-fill" style="width:${m.leaderboard[0].visits > 0 ? (rep.visits / m.leaderboard[0].visits) * 100 : 0}%;"></div></div>
            </div>
          `).join('')}
        </div>`
      }
    </div>

    <!-- Tasks Due Soon / Overdue -->
    <div class="db-card">
      <div class="db-card-head">
        <h2 class="db-card-title">Upcoming Tasks</h2>
        ${m.overdueTasks.length > 0 ? `<span class="db-badge-warn">${m.overdueTasks.length} overdue</span>` : ''}
      </div>
      ${[...m.overdueTasks.slice(0, 4), ...m.dueSoonTasks.slice(0, 4)].length === 0
        ? '<div class="db-empty">No tasks due in the next 7 days</div>'
        : `<div class="db-task-list">
          ${m.overdueTasks.slice(0, 4).map(t => {
            const d = daysUntil(t.due_date);
            const ap = t.assigned_to ? m.profileMap.get(t.assigned_to) : null;
            const assignee = ap ? `${ap.first_name || ''} ${ap.last_name || ''}`.trim() : '';
            return `
            <div class="db-task-row db-task-overdue">
              <div class="db-task-pri db-pri-${(t.priority || 'medium').toLowerCase()}"></div>
              <div class="db-task-body">
                <span class="db-task-name">${esc(t.title || 'Untitled')}</span>
                ${assignee ? `<span class="db-task-assignee">${esc(assignee)}</span>` : ''}
              </div>
              <span class="db-task-due db-due-overdue">${Math.abs(d)}d overdue</span>
            </div>`;
          }).join('')}
          ${m.dueSoonTasks.slice(0, 4).map(t => {
            const d = daysUntil(t.due_date);
            const ap2 = t.assigned_to ? m.profileMap.get(t.assigned_to) : null;
            const assignee = ap2 ? `${ap2.first_name || ''} ${ap2.last_name || ''}`.trim() : '';
            return `
            <div class="db-task-row">
              <div class="db-task-pri db-pri-${(t.priority || 'medium').toLowerCase()}"></div>
              <div class="db-task-body">
                <span class="db-task-name">${esc(t.title || 'Untitled')}</span>
                ${assignee ? `<span class="db-task-assignee">${esc(assignee)}</span>` : ''}
              </div>
              <span class="db-task-due">${d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `${d}d`}</span>
            </div>`;
          }).join('')}
        </div>`
      }
    </div>

    <!-- Late-Stage Deals -->
    <div class="db-card">
      <div class="db-card-head">
        <h2 class="db-card-title">In Progress Deals</h2>
        <span class="db-card-sub">Qualification stage</span>
      </div>
      ${m.closingSoon.length === 0
        ? '<div class="db-empty">No deals in the in-progress stage</div>'
        : `<div class="db-close-list">
          ${m.closingSoon.map(o => {
            const stageMeta = STAGE_META.find(s => s.key === o.stage);
            return `
            <div class="db-close-row">
              <div class="db-close-info">
                <span class="db-close-name">${esc(o.name || 'Untitled')}</span>
                <span class="db-close-stage" style="color:${stageMeta?.color || '#888'};">${stageMeta?.label || o.stage}</span>
              </div>
              <div class="db-close-right">
                <span class="db-close-val">${fmtMoney(o.val)}</span>
              </div>
            </div>`;
          }).join('')}
        </div>`
      }
    </div>
  </div>

  <!-- Bottom Row: Recent Visits + Reminders -->
  <div class="db-row-bottom">
    <!-- Recent Visits -->
    <div class="db-card db-card-wide">
      <div class="db-card-head">
        <h2 class="db-card-title">Recent Visits</h2>
        <span class="db-card-sub">Latest field activity</span>
      </div>
      ${m.visits.length === 0
        ? '<div class="db-empty">No visits recorded yet</div>'
        : `<table class="db-table">
          <thead>
            <tr><th>Rep</th><th>Company</th><th>Type</th><th>Score</th><th>When</th></tr>
          </thead>
          <tbody>
            ${m.visits.map(v => {
              const vp = v.user_id ? m.profileMap.get(v.user_id) : null;
              const name = vp ? `${vp.first_name || ''} ${vp.last_name || ''}`.trim() : 'Unknown';
              const ini = vp ? initials(vp.first_name, vp.last_name) : '??';
              const score = Number(v.lead_score);
              const scoreOk = Number.isFinite(score);
              const cls = scoreOk && score >= 80 ? 'hi' : scoreOk && score >= 50 ? 'md' : 'lo';
              return `
              <tr>
                <td><div class="db-user"><div class="db-avatar-sm">${esc(ini)}</div><span>${esc(name)}</span></div></td>
                <td>${esc(v.company_name || '—')}</td>
                <td>${esc(formatVisitType(v.visit_type))}</td>
                <td>${scoreOk ? `<span class="db-score db-score-${cls}">${score}</span>` : '<span class="db-muted">—</span>'}</td>
                <td class="db-muted">${relTime(v.created_at)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>`
      }
    </div>

    <!-- Reminders -->
    <div class="db-card">
      <div class="db-card-head">
        <h2 class="db-card-title">Upcoming Reminders</h2>
      </div>
      ${m.upcomingReminders.length === 0
        ? '<div class="db-empty">No pending reminders</div>'
        : `<div class="db-rem-list">
          ${m.upcomingReminders.map(r => {
            const d = daysUntil(r.reminder_date);
            const overdue = d < 0;
            return `
            <div class="db-rem-row${overdue ? ' db-rem-overdue' : ''}">
              <i data-lucide="bell" class="db-rem-icon"></i>
              <span class="db-rem-title">${esc(r.title || 'Reminder')}</span>
              <span class="db-rem-due ${overdue ? 'db-due-overdue' : ''}">${overdue ? `${Math.abs(d)}d overdue` : d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `in ${d}d`}</span>
            </div>`;
          }).join('')}
        </div>`
      }
    </div>
  </div>

</div>`;
}

// ── Main render function ────────────────────────────────────────

async function renderProfessionalDashboardView() {
  const viewContainer = document.getElementById('view-container');
  const headerTitle = document.querySelector('.header-title');
  if (headerTitle) headerTitle.textContent = 'Dashboard';

  // Loading skeleton
  viewContainer.innerHTML = `
    <div class="db">
      <div class="db-kpis">
        ${Array(6).fill('<div class="db-kpi db-kpi-loading"><div class="db-skel db-skel-block"></div></div>').join('')}
      </div>
      <div class="db-card"><div class="db-skel db-skel-chart"></div></div>
    </div>`;

  try {
    const raw = await fetchDashboardData();
    const metrics = compute(raw);
    viewContainer.innerHTML = buildHTML(metrics);
    if (window.lucide) lucide.createIcons();

    // Animate bars in
    requestAnimationFrame(() => {
      viewContainer.querySelectorAll('.db-bar').forEach(bar => {
        const h = bar.style.height;
        bar.style.height = '0%';
        requestAnimationFrame(() => { bar.style.height = h; });
      });
      viewContainer.querySelectorAll('.db-lb-bar-fill').forEach(bar => {
        const w = bar.style.width;
        bar.style.width = '0%';
        requestAnimationFrame(() => { bar.style.width = w; });
      });
      viewContainer.querySelectorAll('.db-stage-seg').forEach(seg => {
        const w = seg.style.width;
        seg.style.width = '0%';
        requestAnimationFrame(() => { seg.style.width = w; });
      });
    });

  } catch (err) {
    console.error('Dashboard error:', err);
    viewContainer.innerHTML = renderError('Failed to load dashboard: ' + err.message);
  }
}

// ── Exports ────────────────────────────────────────────────────
export { renderProfessionalDashboardView };
