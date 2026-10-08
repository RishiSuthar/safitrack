// modules/features/dashboard.js
// Manager dashboard: period metrics vs. the previous period, an attention
// queue, open deals, pipeline health, team activity and recent visits.
import { state, supabaseClient } from '../state.js';
import { renderError, getCurrencySymbol } from '../utils/helpers.js';
import { DEFAULT_SALES_STAGES, normalizeOpportunityStage } from '../utils/pipeline-stages.js';
import { navigateView } from '../core/router.js';

// ── Constants ───────────────────────────────────────────────────

const DAY = 86400000;
const PERIODS = [
  { key: '7d', label: '7D', days: 7, name: '7 days' },
  { key: '30d', label: '30D', days: 30, name: '30 days' },
  { key: '90d', label: '90D', days: 90, name: '90 days' },
];
const PERIOD_STORAGE_KEY = 'safitrack_dashboard_period';
const STALE_DEAL_DAYS = 21;
const INACTIVE_REP_DAYS = 7;
// Visits are fetched for two full periods of the longest range so every
// period can be compared with the one before it.
const VISIT_LOOKBACK_DAYS = PERIODS[PERIODS.length - 1].days * 2;

const OPEN_STAGES = ['prospecting', 'qualification'];
const STAGE_META = Object.fromEntries(DEFAULT_SALES_STAGES.map((s) => [s.id, {
  label: s.title.replace(/[\p{Extended_Pictographic}‍️]/gu, '').trim(),
  color: s.color,
}]));

const METRICS = [
  { key: 'revenue', label: 'Revenue won', kind: 'money' },
  { key: 'pipeline', label: 'New pipeline', kind: 'money' },
  { key: 'winRate', label: 'Win rate', kind: 'percent' },
  { key: 'visits', label: 'Field visits', kind: 'count' },
];

const ICONS = {
  task: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/>',
  deal: '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
  reminder: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  stale: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
};

function icon(name, size = 14) {
  return `<svg class="db-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

// ── Module state ────────────────────────────────────────────────

const ui = {
  period: readStoredPeriod(),
  metric: 'revenue',
  raw: null,
  model: null,
  resizeObserver: null,
};

function readStoredPeriod() {
  try {
    const v = localStorage.getItem(PERIOD_STORAGE_KEY);
    if (PERIODS.some((p) => p.key === v)) return v;
  } catch { /* storage unavailable */ }
  return '30d';
}

function storePeriod(key) {
  try { localStorage.setItem(PERIOD_STORAGE_KEY, key); } catch { /* storage unavailable */ }
}

// ── Formatting ──────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function compactNumber(n) {
  const abs = Math.abs(n);
  const trim = (x) => x.toFixed(1).replace(/\.0$/, '');
  if (abs >= 1e9) return `${trim(n / 1e9)}B`;
  if (abs >= 1e6) return `${trim(n / 1e6)}M`;
  if (abs >= 1e4) return `${Math.round(n / 1e3)}K`;
  if (abs >= 1e3) return `${trim(n / 1e3)}K`;
  return `${Math.round(n)}`;
}

function money(n) {
  return `${getCurrencySymbol()} ${compactNumber(n || 0)}`;
}

function moneyFull(n) {
  return `${getCurrencySymbol()} ${Math.round(n || 0).toLocaleString()}`;
}

function formatMetric(kind, v, { full = false } = {}) {
  if (v == null || Number.isNaN(v)) return '—';
  if (kind === 'money') return full ? moneyFull(v) : money(v);
  if (kind === 'percent') return `${Math.round(v)}%`;
  return Math.round(v).toLocaleString();
}

function fullName(p) {
  if (!p) return 'Unknown';
  return `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown';
}

function initialsOf(p) {
  if (!p) return '?';
  return (((p.first_name || '')[0] || '') + ((p.last_name || '')[0] || '')).toUpperCase() || '?';
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function titleCase(s) {
  return String(s || '').replace(/[_-]+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Dates ───────────────────────────────────────────────────────

// Plain YYYY-MM-DD values are calendar dates; parse them as local midnight so
// they don't drift a day in timezones behind UTC.
function parseDate(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function calendarDaysFrom(from, to) {
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY);
}

function relTime(date, now) {
  if (!date) return '—';
  const mins = Math.floor((now - date) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = calendarDaysFrom(date, now);
  if (days <= 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function shortDate(d) {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function greeting(now) {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

// ── Data layer ──────────────────────────────────────────────────

// PostgREST caps responses (1000 rows by default), so page through results.
async function fetchAllRows(buildQuery, { pageSize = 1000, maxRows = 20000 } = {}) {
  const rows = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function fetchDashboardData() {
  const orgId = state.currentOrganization?.id || '00000000-0000-0000-0000-000000000000';
  const visitsSince = addDays(startOfDay(new Date()), -VISIT_LOOKBACK_DAYS).toISOString();

  const [opps, visits, tasks, profilesRes, remindersRes] = await Promise.all([
    fetchAllRows(() => supabaseClient
      .from('opportunities')
      .select('id, name, company_name, value, probability, stage, user_id, next_step, next_step_date, created_at, updated_at')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })),
    fetchAllRows(() => supabaseClient
      .from('visits')
      .select('id, user_id, company_name, visit_type, created_at')
      .eq('organization_id', orgId)
      .gte('created_at', visitsSince)
      .order('created_at', { ascending: false })),
    fetchAllRows(() => supabaseClient
      .from('tasks')
      .select('id, title, status, priority, due_date, assigned_to')
      .eq('organization_id', orgId)
      .not('due_date', 'is', null)
      .order('due_date', { ascending: true })),
    supabaseClient
      .from('profiles')
      .select('id, first_name, last_name, role')
      .eq('organization_id', orgId),
    supabaseClient
      .from('reminders')
      .select('id, title, reminder_date, is_completed')
      .eq('organization_id', orgId)
      .eq('is_completed', false)
      .order('reminder_date', { ascending: true })
      .limit(50),
  ]);

  const failed = [profilesRes, remindersRes].find((r) => r.error);
  if (failed) throw new Error(failed.error.message);

  return {
    opps,
    visits,
    tasks,
    profiles: profilesRes.data || [],
    reminders: remindersRes.data || [],
    fetchedAt: new Date(),
  };
}

// ── Model ───────────────────────────────────────────────────────

function prepare(raw) {
  const opps = raw.opps.map((o) => ({
    ...o,
    stage: normalizeOpportunityStage(o.stage),
    val: Number(o.value) || 0,
    prob: Math.min(Math.max(Number(o.probability) || 0, 0), 100),
    createdAt: parseDate(o.created_at),
    // There is no dedicated close timestamp; the last update of a closed deal
    // is the same proxy the pipeline view uses for "time in stage".
    touchedAt: parseDate(o.updated_at) || parseDate(o.created_at),
    nextStepAt: parseDate(o.next_step_date),
  }));
  const visits = raw.visits
    .map((v) => ({ ...v, at: parseDate(v.created_at) }))
    .filter((v) => v.at);
  return { ...raw, opps, visits, profileMap: new Map(raw.profiles.map((p) => [p.id, p])) };
}

function buildModel(data, periodKey) {
  const period = PERIODS.find((p) => p.key === periodKey) || PERIODS[1];
  const n = period.days;
  const now = new Date();
  const today = startOfDay(now);
  const start = addDays(today, -(n - 1));
  // The previous window is the current one shifted back by n days, so the
  // comparison is "same point in the period", not a full period vs. a partial one.
  const prevStart = addDays(start, -n);
  const prevEnd = new Date(now.getTime() - n * DAY);

  const inCur = (d) => d && d >= start && d <= now;
  const inPrev = (d) => d && d >= prevStart && d <= prevEnd;
  const dayIndex = (d, from) => calendarDaysFrom(from, d);

  const won = data.opps.filter((o) => o.stage === 'closed-won');
  const lost = data.opps.filter((o) => o.stage === 'closed-lost');
  const open = data.opps.filter((o) => OPEN_STAGES.includes(o.stage));

  // Daily series for both windows; each chart point is cumulative to that day.
  const blank = () => Array.from({ length: n }, () => 0);
  const series = {
    cur: { revenue: blank(), pipeline: blank(), won: blank(), lost: blank(), visits: blank() },
    prev: { revenue: blank(), pipeline: blank(), won: blank(), lost: blank(), visits: blank() },
  };
  const bump = (d, key, amount) => {
    if (inCur(d)) series.cur[key][dayIndex(d, start)] += amount;
    else if (inPrev(d)) series.prev[key][dayIndex(d, prevStart)] += amount;
  };
  won.forEach((o) => { bump(o.touchedAt, 'revenue', o.val); bump(o.touchedAt, 'won', 1); });
  lost.forEach((o) => bump(o.touchedAt, 'lost', 1));
  data.opps.forEach((o) => bump(o.createdAt, 'pipeline', o.val));
  data.visits.forEach((v) => bump(v.at, 'visits', 1));

  const cumulative = (arr) => { let s = 0; return arr.map((x) => (s += x)); };
  const winRateSeries = (w, l) => {
    const cw = cumulative(w);
    const cl = cumulative(l);
    return cw.map((x, i) => (x + cl[i] > 0 ? (x / (x + cl[i])) * 100 : null));
  };
  const lastDefined = (arr) => [...arr].reverse().find((x) => x != null) ?? null;
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);

  const chart = {
    revenue: { cur: cumulative(series.cur.revenue), prev: cumulative(series.prev.revenue) },
    pipeline: { cur: cumulative(series.cur.pipeline), prev: cumulative(series.prev.pipeline) },
    visits: { cur: cumulative(series.cur.visits), prev: cumulative(series.prev.visits) },
    winRate: {
      cur: winRateSeries(series.cur.won, series.cur.lost),
      prev: winRateSeries(series.prev.won, series.prev.lost),
    },
  };

  const wonCur = won.filter((o) => inCur(o.touchedAt));
  const lostCur = lost.filter((o) => inCur(o.touchedAt));
  const metrics = {
    revenue: { cur: sum(series.cur.revenue), prev: sum(series.prev.revenue) },
    pipeline: { cur: sum(series.cur.pipeline), prev: sum(series.prev.pipeline) },
    visits: { cur: sum(series.cur.visits), prev: sum(series.prev.visits) },
    winRate: { cur: lastDefined(chart.winRate.cur), prev: lastDefined(chart.winRate.prev) },
  };
  metrics.revenue.foot = `${plural(wonCur.length, 'deal')} won`;
  metrics.pipeline.foot = `${plural(data.opps.filter((o) => inCur(o.createdAt)).length, 'deal')} created`;
  metrics.winRate.foot = wonCur.length + lostCur.length > 0
    ? `${wonCur.length} won · ${lostCur.length} lost`
    : 'No deals closed';
  metrics.visits.foot = `${new Set(data.visits.filter((v) => inCur(v.at)).map((v) => v.user_id)).size} reps in the field`;

  // ── Pipeline health
  const openValue = sum(open.map((o) => o.val));
  const stages = OPEN_STAGES.map((key) => {
    const items = open.filter((o) => o.stage === key);
    return { key, ...STAGE_META[key], count: items.length, value: sum(items.map((o) => o.val)) };
  });
  const cycleDays = wonCur
    .filter((o) => o.createdAt && o.touchedAt)
    .map((o) => Math.max(0, (o.touchedAt - o.createdAt) / DAY));
  const pipeline = {
    openValue,
    openCount: open.length,
    stages,
    weighted: sum(open.map((o) => (o.val * o.prob) / 100)),
    hasProbabilities: open.some((o) => o.prob > 0),
    avgWon: wonCur.length ? sum(wonCur.map((o) => o.val)) / wonCur.length : null,
    cycle: cycleDays.length ? sum(cycleDays) / cycleDays.length : null,
    lostCount: lostCur.length,
    lostValue: sum(lostCur.map((o) => o.val)),
  };

  // ── Top open deals
  const topDeals = [...open].sort((a, b) => b.val - a.val).slice(0, 5);

  // ── Needs attention
  const attention = [];
  data.tasks.forEach((t) => {
    if (String(t.status || '').toLowerCase() === 'completed') return;
    const due = parseDate(t.due_date);
    if (!due) return;
    const late = calendarDaysFrom(due, now);
    if (late < 0) return;
    const assignee = data.profileMap.get(t.assigned_to);
    attention.push({
      type: 'task', view: 'tasks', late, urgent: true,
      title: t.title || 'Untitled task',
      meta: assignee ? `Task · ${fullName(assignee)}` : 'Task',
      due: late === 0 ? 'Due today' : `${late}d overdue`,
      tone: late === 0 ? 'warn' : 'danger',
    });
  });
  open.forEach((o) => {
    const owner = data.profileMap.get(o.user_id);
    const ownerName = owner ? fullName(owner) : 'Unassigned';
    if (o.nextStepAt && calendarDaysFrom(o.nextStepAt, now) > 0) {
      const late = calendarDaysFrom(o.nextStepAt, now);
      attention.push({
        type: 'deal', view: 'opportunity-pipeline', late, urgent: true,
        title: o.next_step || o.name || 'Untitled deal',
        meta: o.next_step ? `${o.name || 'Untitled deal'} · ${ownerName}` : `Next step · ${ownerName}`,
        due: `${late}d late`,
        tone: 'danger',
      });
      return;
    }
    const idle = o.touchedAt ? calendarDaysFrom(o.touchedAt, now) : 0;
    if (idle >= STALE_DEAL_DAYS) {
      attention.push({
        type: 'stale', view: 'opportunity-pipeline', late: idle, urgent: false,
        title: o.name || 'Untitled deal',
        meta: `No updates · ${money(o.val)} · ${ownerName}`,
        due: `${idle}d idle`,
        tone: 'muted',
      });
    }
  });
  data.reminders.forEach((r) => {
    const at = parseDate(r.reminder_date);
    if (!at || at > now) return;
    const late = calendarDaysFrom(at, now);
    attention.push({
      type: 'reminder', view: 'reminders', late, urgent: true,
      title: r.title || 'Reminder',
      meta: 'Reminder',
      due: late === 0 ? 'Today' : `${late}d overdue`,
      tone: late === 0 ? 'warn' : 'danger',
    });
  });
  // Missed dates first (most overdue on top), then stalled deals.
  attention.sort((a, b) => (b.urgent - a.urgent) || (b.late - a.late));

  // ── Team
  const lastVisit = new Map();
  const visitsCur = new Map();
  data.visits.forEach((v) => {
    if (!v.user_id) return;
    if (!lastVisit.has(v.user_id) || lastVisit.get(v.user_id) < v.at) lastVisit.set(v.user_id, v.at);
    if (inCur(v.at)) visitsCur.set(v.user_id, (visitsCur.get(v.user_id) || 0) + 1);
  });
  const wonByRep = new Map();
  wonCur.forEach((o) => {
    if (!o.user_id) return;
    const s = wonByRep.get(o.user_id) || { count: 0, value: 0 };
    s.count += 1;
    s.value += o.val;
    wonByRep.set(o.user_id, s);
  });
  const repIds = new Set([
    ...data.profiles.filter((p) => p.role === 'sales_rep').map((p) => p.id),
    ...visitsCur.keys(),
    ...wonByRep.keys(),
  ]);
  const team = [...repIds]
    .filter((id) => data.profileMap.has(id))
    .map((id) => {
      const p = data.profileMap.get(id);
      const last = lastVisit.get(id) || null;
      return {
        id,
        name: fullName(p),
        initials: initialsOf(p),
        visits: visitsCur.get(id) || 0,
        wonCount: wonByRep.get(id)?.count || 0,
        wonValue: wonByRep.get(id)?.value || 0,
        last,
        inactive: !last || calendarDaysFrom(last, now) >= INACTIVE_REP_DAYS,
      };
    })
    .sort((a, b) => b.wonValue - a.wonValue || b.visits - a.visits || a.name.localeCompare(b.name));
  const activeReps = team.filter((r) => !r.inactive).length;

  return {
    period, now, start, prevStart,
    metrics, chart, pipeline, topDeals, attention, team, activeReps,
    recentVisits: data.visits.slice(0, 7),
    profileMap: data.profileMap,
    fetchedAt: data.fetchedAt,
  };
}

// ── Render: pieces ──────────────────────────────────────────────

function deltaHTML(metric, kind) {
  const { cur, prev } = metric;
  // Nothing to compare: say nothing rather than print a meaningless "0%".
  if (cur == null || (!cur && !prev)) return '';
  if (prev == null) return '<span class="db-delta db-delta-none">—</span>';
  if (kind === 'percent') {
    const d = cur - prev;
    if (Math.abs(d) < 0.05) return '<span class="db-delta db-delta-flat">0 pts</span>';
    return `<span class="db-delta ${d > 0 ? 'db-delta-up' : 'db-delta-down'}">${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} pts</span>`;
  }
  if (prev === 0) return '<span class="db-delta db-delta-none" title="Nothing in the previous period">New</span>';
  const d = ((cur - prev) / prev) * 100;
  if (Math.abs(d) < 0.05) return '<span class="db-delta db-delta-flat">0%</span>';
  const txt = Math.abs(d) >= 100 ? Math.round(Math.abs(d)).toLocaleString() : Math.abs(d).toFixed(1);
  return `<span class="db-delta ${d > 0 ? 'db-delta-up' : 'db-delta-down'}">${d > 0 ? '+' : '−'}${txt}%</span>`;
}

function avatar(initials, cls = '') {
  return `<span class="db-avatar ${cls}" aria-hidden="true">${esc(initials)}</span>`;
}

function cardHead(title, sub, link) {
  return `
    <div class="db-card-head">
      <div class="db-card-heading">
        <h2 class="db-card-title">${title}</h2>
        ${sub ? `<span class="db-card-sub">${sub}</span>` : ''}
      </div>
      ${link ? `<button type="button" class="db-link" data-nav="${link.view}">${link.label}${icon('arrow', 13)}</button>` : ''}
    </div>`;
}

function renderHeader(m) {
  const firstName = state.currentUserProfile?.first_name;
  const dateLabel = m.now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  return `
    <header class="db-head">
      <div class="db-head-text">
        <p class="db-date">${esc(dateLabel)}</p>
        <h1 class="db-title">${greeting(m.now)}${firstName ? `, ${esc(firstName)}` : ''}</h1>
      </div>
      <div class="db-head-actions">
        <div class="db-seg" role="group" aria-label="Time period">
          ${PERIODS.map((p) => `<button type="button" class="db-seg-btn${p.key === m.period.key ? ' is-active' : ''}" data-period="${p.key}" aria-pressed="${p.key === m.period.key}" title="Last ${p.name}">${p.label}</button>`).join('')}
        </div>
        <button type="button" class="db-icon-btn" data-action="refresh" aria-label="Refresh data" title="Refresh">${icon('refresh', 15)}</button>
      </div>
    </header>`;
}

function renderPerformance(m) {
  const active = METRICS.find((x) => x.key === ui.metric) || METRICS[0];
  return `
    <section class="db-card db-perf" aria-label="Performance">
      <div class="db-tabs" role="tablist">
        ${METRICS.map((x) => {
          const v = m.metrics[x.key];
          const selected = x.key === active.key;
          return `
          <button type="button" class="db-tab${selected ? ' is-active' : ''}" role="tab" aria-selected="${selected}" data-metric="${x.key}">
            <span class="db-tab-label">${x.label}</span>
            <span class="db-tab-value">${formatMetric(x.kind, v.cur)}</span>
            <span class="db-tab-foot">${deltaHTML(v, x.kind)}<span class="db-tab-note">${esc(v.foot)}</span></span>
          </button>`;
        }).join('')}
      </div>
      <div class="db-chart" data-chart>
        <div class="db-chart-legend">
          <span class="db-legend-item"><span class="db-swatch db-swatch-cur"></span>Last ${m.period.name}</span>
          <span class="db-legend-item"><span class="db-swatch db-swatch-prev"></span>Previous ${m.period.name}</span>
        </div>
        <div class="db-chart-plot" data-chart-plot></div>
        <div class="db-tooltip" data-chart-tip hidden></div>
      </div>
    </section>`;
}

function renderAttention(m) {
  const items = m.attention.slice(0, 7);
  const urgent = m.attention.filter((a) => a.urgent).length;
  const more = m.attention.length - items.length;
  return `
    <section class="db-card db-attention">
      ${cardHead('Needs attention', urgent ? `<span class="db-count" title="Overdue or due today">${urgent}</span>` : '')}
      ${items.length === 0 ? `
        <div class="db-empty">
          <span class="db-empty-icon">${icon('check', 16)}</span>
          <p class="db-empty-title">All clear</p>
          <p class="db-empty-text">Overdue tasks, missed next steps and deals idle for ${STALE_DEAL_DAYS}+ days show up here.</p>
        </div>` : `
        <ul class="db-list">
          ${items.map((a) => `
            <li>
              <button type="button" class="db-row db-att" data-nav="${a.view}">
                <span class="db-att-icon">${icon(a.type)}</span>
                <span class="db-row-main">
                  <span class="db-row-title">${esc(a.title)}</span>
                  <span class="db-row-meta">${esc(a.meta)}</span>
                </span>
                <span class="db-att-due db-tone-${a.tone}">${esc(a.due)}</span>
              </button>
            </li>`).join('')}
        </ul>
        ${more > 0 ? `<p class="db-more">+${more} more</p>` : ''}`}
    </section>`;
}

function renderDeals(m) {
  const p = m.pipeline;
  return `
    <section class="db-card db-deals">
      ${cardHead('Top open deals', `${plural(p.openCount, 'open deal')}`, { view: 'opportunity-pipeline', label: 'Pipeline' })}
      ${m.topDeals.length === 0 ? `
        <div class="db-empty">
          <p class="db-empty-title">No open deals</p>
          <p class="db-empty-text">Deals in Lead or In Progress will be ranked here by value.</p>
        </div>` : `
        <div class="db-table-wrap">
          <table class="db-table">
            <thead>
              <tr>
                <th>Deal</th>
                <th class="db-col-owner">Owner</th>
                <th class="db-col-stage">Stage</th>
                <th class="db-col-next">Next step</th>
                <th class="db-num">Value</th>
              </tr>
            </thead>
            <tbody>
              ${m.topDeals.map((o) => {
                const owner = m.profileMap.get(o.user_id);
                const stage = STAGE_META[o.stage];
                const lateDays = o.nextStepAt ? calendarDaysFrom(o.nextStepAt, m.now) : null;
                return `
                <tr data-nav="opportunity-pipeline">
                  <td>
                    <span class="db-cell-title">${esc(o.name || 'Untitled deal')}</span>
                    ${o.company_name ? `<span class="db-cell-sub">${esc(o.company_name)}</span>` : ''}
                  </td>
                  <td class="db-col-owner">${owner ? `<span class="db-person">${avatar(initialsOf(owner), 'db-avatar-xs')}<span>${esc(owner.first_name || fullName(owner))}</span></span>` : '<span class="db-faint">Unassigned</span>'}</td>
                  <td class="db-col-stage"><span class="db-stage"><span class="db-dot" style="background:${stage.color}"></span>${esc(stage.label)}</span></td>
                  <td class="db-col-next">${o.nextStepAt
                    ? `<span class="${lateDays > 0 ? 'db-tone-danger' : ''}" title="${esc(o.next_step || '')}">${shortDate(o.nextStepAt)}</span>`
                    : '<span class="db-faint">—</span>'}</td>
                  <td class="db-num db-strong">${money(o.val)}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`}
    </section>`;
}

function renderPipeline(m) {
  const p = m.pipeline;
  const maxStage = Math.max(...p.stages.map((s) => s.value), 1);
  return `
    <section class="db-card db-pipeline">
      ${cardHead('Pipeline', 'Open deals right now')}
      <div class="db-pipe-total">
        <span class="db-pipe-value">${money(p.openValue)}</span>
        <span class="db-pipe-count">${plural(p.openCount, 'deal')}</span>
      </div>
      <div class="db-stages">
        ${p.stages.map((s) => `
          <div class="db-stage-row">
            <div class="db-stage-line">
              <span class="db-stage"><span class="db-dot" style="background:${s.color}"></span>${esc(s.label)}</span>
              <span class="db-stage-figs"><span class="db-faint">${s.count}</span><span class="db-strong">${money(s.value)}</span></span>
            </div>
            <div class="db-meter"><span style="width:${s.value > 0 ? Math.max((s.value / maxStage) * 100, 1.5) : 0}%;background:${s.color}"></span></div>
          </div>`).join('')}
      </div>
      <dl class="db-stats">
        <div class="db-stat">
          <dt>Weighted forecast</dt>
          <dd title="${p.hasProbabilities ? 'Open deal value × win probability' : 'Set win probability on deals to forecast'}">${p.hasProbabilities ? money(p.weighted) : '—'}</dd>
        </div>
        <div class="db-stat">
          <dt>Avg. won deal</dt>
          <dd>${p.avgWon != null ? money(p.avgWon) : '—'}</dd>
        </div>
        <div class="db-stat">
          <dt>Avg. days to close</dt>
          <dd>${p.cycle != null ? Math.round(p.cycle) : '—'}</dd>
        </div>
        <div class="db-stat">
          <dt>Lost</dt>
          <dd>${p.lostCount}${p.lostCount ? ` <span class="db-faint">· ${money(p.lostValue)}</span>` : ''}</dd>
        </div>
      </dl>
    </section>`;
}

function renderTeam(m) {
  const rows = m.team.slice(0, 8);
  const maxVisits = Math.max(...rows.map((r) => r.visits), 1);
  return `
    <section class="db-card db-team">
      ${cardHead('Team', m.team.length ? `${m.activeReps} of ${m.team.length} active this week` : '', { view: 'team-dashboard', label: 'Visits' })}
      ${rows.length === 0 ? `
        <div class="db-empty">
          <p class="db-empty-title">No sales reps yet</p>
          <p class="db-empty-text">Invite reps from User management to track their field activity.</p>
        </div>` : `
        <div class="db-table-wrap">
          <table class="db-table">
            <thead>
              <tr>
                <th>Rep</th>
                <th class="db-num db-col-visits">Visits</th>
                <th class="db-num db-col-won">Won</th>
                <th class="db-num">Revenue</th>
                <th class="db-num db-col-last">Last visit</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((r) => `
                <tr>
                  <td><span class="db-person">${avatar(r.initials)}<span class="db-cell-title">${esc(r.name)}</span></span></td>
                  <td class="db-num db-col-visits">
                    <span class="db-bar-cell">
                      <span class="db-minibar"><span style="width:${(r.visits / maxVisits) * 100}%"></span></span>
                      <span class="db-bar-num">${r.visits}</span>
                    </span>
                  </td>
                  <td class="db-num db-col-won">${r.wonCount || '<span class="db-faint">0</span>'}</td>
                  <td class="db-num db-strong">${r.wonValue ? money(r.wonValue) : '<span class="db-faint">—</span>'}</td>
                  <td class="db-num db-col-last ${r.inactive ? 'db-tone-warn' : 'db-faint'}">${r.last ? relTime(r.last, m.now) : 'Never'}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`}
    </section>`;
}

function renderRecentVisits(m) {
  return `
    <section class="db-card db-recent">
      ${cardHead('Recent visits', '', { view: 'team-dashboard', label: 'All' })}
      ${m.recentVisits.length === 0 ? `
        <div class="db-empty">
          <p class="db-empty-title">No visits yet</p>
          <p class="db-empty-text">Visits logged by your team appear here as they happen.</p>
        </div>` : `
        <ul class="db-list">
          ${m.recentVisits.map((v) => {
            const rep = m.profileMap.get(v.user_id);
            return `
            <li>
              <button type="button" class="db-row" data-visit="${esc(v.id)}">
                ${avatar(initialsOf(rep))}
                <span class="db-row-main">
                  <span class="db-row-title">${esc(v.company_name || 'Unnamed company')}</span>
                  <span class="db-row-meta">${esc(fullName(rep))} · ${esc(titleCase(v.visit_type || 'visit'))}</span>
                </span>
                <span class="db-row-time">${relTime(v.at, m.now)}</span>
              </button>
            </li>`;
          }).join('')}
        </ul>`}
    </section>`;
}

function renderDashboard(m) {
  return `
    <div class="db">
      ${renderHeader(m)}
      <div class="db-grid">
        ${renderPerformance(m)}
        ${renderAttention(m)}
        ${renderDeals(m)}
        ${renderPipeline(m)}
        ${renderTeam(m)}
        ${renderRecentVisits(m)}
      </div>
    </div>`;
}

function renderSkeleton() {
  const block = (cls) => `<div class="db-skel ${cls}"></div>`;
  return `
    <div class="db" aria-busy="true">
      <header class="db-head">
        <div class="db-head-text">${block('db-skel-date')}${block('db-skel-title')}</div>
      </header>
      <div class="db-grid">
        <div class="db-card db-perf">${block('db-skel-tabs')}${block('db-skel-chart')}</div>
        <div class="db-card db-attention">${block('db-skel-list')}</div>
        <div class="db-card db-deals">${block('db-skel-list')}</div>
        <div class="db-card db-pipeline">${block('db-skel-list')}</div>
      </div>
    </div>`;
}

// ── Chart ───────────────────────────────────────────────────────

function niceTicks(max, count = 4) {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw);
  const ticks = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

function drawChart(root, m) {
  const plot = root.querySelector('[data-chart-plot]');
  const tip = root.querySelector('[data-chart-tip]');
  if (!plot) return;

  const metric = METRICS.find((x) => x.key === ui.metric) || METRICS[0];
  const { cur, prev } = m.chart[metric.key];
  const n = cur.length;
  const W = Math.max(plot.clientWidth, 240);
  const H = plot.clientHeight || 220;
  const pad = { top: 8, right: 4, bottom: 26, left: 0 };

  const values = [...cur, ...prev].filter((v) => v != null);
  const isEmpty = !values.some((v) => v > 0);
  const ticks = metric.kind === 'percent' || isEmpty ? [0, 25, 50, 75, 100] : niceTicks(Math.max(...values, 0));
  const yMax = ticks[ticks.length - 1] || 1;
  const fmtTick = (v) => (isEmpty ? '' : metric.kind === 'percent' ? `${v}%` : compactNumber(v));
  // Reserve room for the widest y label (approx. 6.5px per glyph at 11px).
  pad.left = Math.max(...ticks.map((t) => fmtTick(t).length)) * 6.5 + 12;

  const iw = W - pad.left - pad.right;
  const ih = H - pad.top - pad.bottom;
  const x = (i) => pad.left + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v) => pad.top + ih - (v / yMax) * ih;

  const linePath = (arr) => {
    let d = '';
    let pen = false;
    arr.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const firstIdx = cur.findIndex((v) => v != null);
  const lastIdx = cur.length - 1 - [...cur].reverse().findIndex((v) => v != null);
  const areaPath = firstIdx >= 0
    ? `${linePath(cur)}L${x(lastIdx).toFixed(1)},${y(0)}L${x(firstIdx).toFixed(1)},${y(0)}Z`
    : '';

  const labelCount = n <= 7 ? n : 5;
  const labelIdx = [...new Set(Array.from({ length: labelCount }, (_, k) => Math.round((k * (n - 1)) / Math.max(labelCount - 1, 1))))];
  const dayLabel = (i) => {
    const d = addDays(m.start, i);
    return n <= 7 ? d.toLocaleDateString(undefined, { weekday: 'short' }) : shortDate(d);
  };

  const gradientId = `db-area-${metric.key}`;
  plot.innerHTML = `
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(metric.label)}, cumulative over the last ${esc(m.period.name)} compared with the previous ${esc(m.period.name)}">
      <defs>
        <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" class="db-area-stop-top"/>
          <stop offset="100%" class="db-area-stop-bottom"/>
        </linearGradient>
      </defs>
      ${ticks.map((t) => `
        <line class="db-grid-line${t === 0 ? ' is-base' : ''}" x1="${pad.left}" x2="${W - pad.right}" y1="${y(t)}" y2="${y(t)}"/>
        <text class="db-axis" x="${pad.left - 10}" y="${y(t)}" text-anchor="end" dominant-baseline="middle">${fmtTick(t)}</text>`).join('')}
      ${labelIdx.map((i, k) => `
        <text class="db-axis" x="${x(i)}" y="${H - 6}" text-anchor="${n > 1 && k === 0 ? 'start' : n > 1 && k === labelIdx.length - 1 ? 'end' : 'middle'}">${esc(dayLabel(i))}</text>`).join('')}
      <path class="db-line-prev" d="${linePath(prev)}"/>
      ${areaPath ? `<path d="${areaPath}" fill="url(#${gradientId})"/>` : ''}
      <path class="db-line-cur" d="${linePath(cur)}"/>
      <g class="db-hover" data-hover hidden>
        <line class="db-hover-line" y1="${pad.top}" y2="${pad.top + ih}"/>
        <circle class="db-hover-dot-prev" r="3"/>
        <circle class="db-hover-dot-cur" r="3.5"/>
      </g>
      ${isEmpty ? '' : `<rect class="db-hit" x="${pad.left}" y="0" width="${iw}" height="${H}" fill="transparent"/>`}
    </svg>
    ${isEmpty ? `<p class="db-chart-empty">No ${esc(metric.label.toLowerCase())} in the last ${esc(m.period.name)} or the ${esc(m.period.name)} before</p>` : ''}`;

  if (isEmpty) { tip.hidden = true; return; }
  const svg = plot.querySelector('svg');
  const hover = svg.querySelector('[data-hover]');
  const hit = svg.querySelector('.db-hit');
  const hoverLine = hover.querySelector('line');
  const dotCur = hover.querySelector('.db-hover-dot-cur');
  const dotPrev = hover.querySelector('.db-hover-dot-prev');

  const show = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const px = clientX - rect.left;
    const i = Math.min(n - 1, Math.max(0, Math.round(((px - pad.left) / iw) * (n - 1))));
    const cx = x(i);
    hoverLine.setAttribute('x1', cx);
    hoverLine.setAttribute('x2', cx);
    const place = (dot, v) => {
      dot.toggleAttribute('hidden', v == null);
      if (v != null) { dot.setAttribute('cx', cx); dot.setAttribute('cy', y(v)); }
    };
    place(dotCur, cur[i]);
    place(dotPrev, prev[i]);
    hover.removeAttribute('hidden');

    const curDate = addDays(m.start, i);
    const prevDate = addDays(m.prevStart, i);
    tip.innerHTML = `
      <div class="db-tip-row"><span class="db-swatch db-swatch-cur"></span><span class="db-tip-label">${shortDate(curDate)}</span><span class="db-tip-val">${formatMetric(metric.kind, cur[i], { full: true })}</span></div>
      <div class="db-tip-row"><span class="db-swatch db-swatch-prev"></span><span class="db-tip-label">${shortDate(prevDate)}</span><span class="db-tip-val">${formatMetric(metric.kind, prev[i], { full: true })}</span></div>`;
    tip.hidden = false;
    const plotLeft = plot.offsetLeft;
    const tipW = tip.offsetWidth;
    const left = Math.min(Math.max(plotLeft + cx - tipW / 2, plotLeft), plotLeft + W - tipW);
    tip.style.left = `${left}px`;
    tip.style.top = `${plot.offsetTop}px`;
  };
  const hide = () => { hover.setAttribute('hidden', ''); tip.hidden = true; };

  hit.addEventListener('pointermove', (e) => show(e.clientX));
  hit.addEventListener('pointerdown', (e) => show(e.clientX));
  hit.addEventListener('pointerleave', hide);
}

// ── Mount & events ──────────────────────────────────────────────

function mount(container) {
  ui.model = buildModel(ui.raw, ui.period);
  container.innerHTML = renderDashboard(ui.model);
  const chart = container.querySelector('[data-chart]');
  drawChart(chart, ui.model);

  ui.resizeObserver?.disconnect();
  if ('ResizeObserver' in window) {
    const plot = chart.querySelector('[data-chart-plot]');
    let last = `${plot.clientWidth}x${plot.clientHeight}`;
    ui.resizeObserver = new ResizeObserver(() => {
      if (!plot.isConnected) { ui.resizeObserver.disconnect(); return; }
      const size = `${plot.clientWidth}x${plot.clientHeight}`;
      if (size === last) return;
      last = size;
      drawChart(chart, ui.model);
    });
    ui.resizeObserver.observe(plot);
  }
}

function bindEvents(container) {
  container.addEventListener('click', (e) => {
    const periodBtn = e.target.closest('[data-period]');
    if (periodBtn) {
      if (periodBtn.dataset.period === ui.period) return;
      ui.period = periodBtn.dataset.period;
      storePeriod(ui.period);
      mount(container);
      return;
    }

    const tab = e.target.closest('[data-metric]');
    if (tab) {
      ui.metric = tab.dataset.metric;
      container.querySelectorAll('[data-metric]').forEach((t) => {
        const on = t === tab;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', String(on));
      });
      drawChart(container.querySelector('[data-chart]'), ui.model);
      return;
    }

    if (e.target.closest('[data-action="refresh"]')) {
      load(container);
      return;
    }

    const visit = e.target.closest('[data-visit]');
    if (visit) {
      window.fetchAndOpenVisit?.(visit.dataset.visit);
      return;
    }

    const nav = e.target.closest('[data-nav]');
    if (nav) navigateView(nav.dataset.nav);
  });

  // Arrow keys move between metric tabs, per the WAI-ARIA tabs pattern.
  container.addEventListener('keydown', (e) => {
    const tab = e.target.closest('[data-metric]');
    if (!tab || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const tabs = [...container.querySelectorAll('[data-metric]')];
    const next = tabs[(tabs.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    next.focus();
    next.click();
  });
}

async function load(container) {
  const hadData = Boolean(ui.raw);
  const refreshBtn = container.querySelector('[data-action="refresh"]');
  if (hadData) refreshBtn?.classList.add('is-spinning');
  else container.innerHTML = renderSkeleton();

  try {
    ui.raw = prepare(await fetchDashboardData());
    mount(container);
  } catch (err) {
    console.error('Dashboard error:', err);
    if (!hadData) container.innerHTML = renderError('Failed to load dashboard: ' + err.message);
    else refreshBtn?.classList.remove('is-spinning');
  }
}

async function renderProfessionalDashboardView() {
  const viewContainer = document.getElementById('view-container');
  const headerTitle = document.querySelector('.header-title');
  if (headerTitle) headerTitle.textContent = 'Dashboard';

  // The view container is reused across views; wrap the dashboard in its own
  // root so delegated listeners die with it on navigation.
  viewContainer.innerHTML = '<div class="db-root"></div>';
  const root = viewContainer.firstElementChild;
  ui.raw = null;
  bindEvents(root);
  await load(root);
}

// ── Exports ────────────────────────────────────────────────────
export { renderProfessionalDashboardView };
