// modules/features/sales-funnel.js
// Sales funnel: how deals created in a period moved through the pipeline,
// plus the open deals most likely to close and the ones that have stalled.
//
// There is no stage history, so the funnel is built from each deal's current
// stage. Stages are ordered Lead → In Progress → Won, so a deal that is In
// Progress or Won has reached In Progress. Lost deals can't be placed: the
// stage they were lost from isn't recorded.
import { state, supabaseClient } from '../state.js';
import { renderError } from '../utils/helpers.js';
import { normalizeOpportunityStage } from '../utils/pipeline-stages.js';
import { navigateView } from '../core/router.js';
import {
  DAY, OPEN_STAGES, STAGE_META,
  esc, money, moneyFull, fullName, initialsOf, plural,
  parseDate, addDays, startOfDay, calendarDaysFrom,
  readStoredChoice, storeChoice, fetchAllRows,
} from '../utils/analytics.js';

// ── Constants ───────────────────────────────────────────────────

const PERIODS = [
  { key: '30d', label: '30D', days: 30, name: 'the last 30 days' },
  { key: '90d', label: '90D', days: 90, name: 'the last 90 days' },
  { key: '12m', label: '12M', days: 365, name: 'the last 12 months' },
  { key: 'all', label: 'All', days: null, name: 'all time' },
];
const PERIOD_STORAGE_KEY = 'safitrack_funnel_period';
const STALLED_DAYS = 14;
const STAGE_ORDER = ['closed-won', 'qualification', 'prospecting', 'closed-lost'];

const ICONS = {
  arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  down: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
};

function icon(name, size = 14) {
  return `<svg class="db-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

function pct(part, whole) {
  return whole > 0 ? (part / whole) * 100 : null;
}

function fmtPct(v) {
  return v == null ? '—' : `${Math.round(v)}%`;
}

function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
}

const sumValue = (list) => list.reduce((s, o) => s + o.val, 0);

// ── Module state ────────────────────────────────────────────────

const ui = {
  period: readStoredChoice(PERIOD_STORAGE_KEY, PERIODS.map((p) => p.key), '90d'),
  owner: 'all',
  data: null,
};

// ── Data ────────────────────────────────────────────────────────

async function fetchFunnelData() {
  const columns = 'id, name, company_name, value, probability, stage, user_id, created_at, updated_at';
  const orgId = state.currentOrganization?.id;

  const oppsQuery = () => {
    let q = supabaseClient.from('opportunities').select(columns).order('created_at', { ascending: false });
    // Managers see the whole org; reps see their own deals.
    if (state.isManager) {
      if (orgId) q = q.eq('organization_id', orgId);
    } else {
      q = q.eq('user_id', state.currentUser.id);
    }
    return q;
  };

  const [opps, profilesRes] = await Promise.all([
    fetchAllRows(oppsQuery),
    state.isManager && orgId
      ? supabaseClient.from('profiles').select('id, first_name, last_name, role').eq('organization_id', orgId)
      : Promise.resolve({ data: [] }),
  ]);
  if (profilesRes.error) throw new Error(profilesRes.error.message);

  return {
    opps: opps.map((o) => ({
      ...o,
      stage: normalizeOpportunityStage(o.stage),
      val: Number(o.value) || 0,
      prob: Math.min(Math.max(Number(o.probability) || 0, 0), 100),
      createdAt: parseDate(o.created_at),
      // No dedicated close/stage-change timestamp; the last update is the
      // same proxy the pipeline view uses.
      touchedAt: parseDate(o.updated_at) || parseDate(o.created_at),
    })),
    profileMap: new Map((profilesRes.data || []).map((p) => [p.id, p])),
  };
}

// ── Model ───────────────────────────────────────────────────────

function summarise(cohort) {
  const by = (stage) => cohort.filter((o) => o.stage === stage);
  const lead = by('prospecting');
  const progress = by('qualification');
  const won = by('closed-won');
  const lost = by('closed-lost');
  const reached = [...progress, ...won];
  return {
    created: cohort, lead, progress, won, lost, reached,
    winRate: pct(won.length, won.length + lost.length),
    leadToWon: pct(won.length, cohort.length),
  };
}

function buildModel(data) {
  const period = PERIODS.find((p) => p.key === ui.period) || PERIODS[1];
  const now = new Date();
  const since = period.days ? addDays(startOfDay(now), -(period.days - 1)) : null;

  const owned = ui.owner === 'all' ? data.opps : data.opps.filter((o) => o.user_id === ui.owner);
  const cohort = owned.filter((o) => o.createdAt && (!since || o.createdAt >= since));
  const s = summarise(cohort);

  const daysToWin = s.won
    .filter((o) => o.createdAt && o.touchedAt)
    .map((o) => Math.max(0, (o.touchedAt - o.createdAt) / DAY));

  const stages = STAGE_ORDER.map((key) => {
    const list = cohort.filter((o) => o.stage === key);
    return {
      key, ...STAGE_META[key],
      count: list.length,
      value: sumValue(list),
      share: pct(list.length, cohort.length),
    };
  });

  // Conversion by rep — only meaningful for managers looking at everyone.
  let reps = [];
  if (state.isManager && ui.owner === 'all') {
    const groups = new Map();
    cohort.forEach((o) => {
      if (!groups.has(o.user_id)) groups.set(o.user_id, []);
      groups.get(o.user_id).push(o);
    });
    reps = [...groups.entries()]
      .map(([id, list]) => {
        const r = summarise(list);
        const p = data.profileMap.get(id);
        return {
          id,
          name: p ? fullName(p) : 'Unassigned',
          initials: p ? initialsOf(p) : '?',
          created: list.length,
          reachedRate: pct(r.reached.length, list.length),
          won: r.won.length,
          winRate: r.winRate,
          wonValue: sumValue(r.won),
        };
      })
      .sort((a, b) => b.wonValue - a.wonValue || b.created - a.created || a.name.localeCompare(b.name));
  }

  // Open deals right now, regardless of when they were created.
  const open = owned.filter((o) => OPEN_STAGES.includes(o.stage));
  const hasProbabilities = open.some((o) => o.prob > 0);
  const likely = [...open]
    .sort((a, b) => (hasProbabilities ? b.val * b.prob - a.val * a.prob : 0) || b.val - a.val)
    .slice(0, 6);
  const stalled = open
    .map((o) => ({ ...o, idle: o.touchedAt ? calendarDaysFrom(o.touchedAt, now) : 0 }))
    .filter((o) => o.idle >= STALLED_DAYS)
    .sort((a, b) => b.idle - a.idle);

  return {
    period, now, s, stages, reps, likely, stalled, hasProbabilities,
    openCount: open.length,
    avgWon: s.won.length ? sumValue(s.won) / s.won.length : null,
    daysToWin: avg(daysToWin),
    profileMap: data.profileMap,
  };
}

// ── Render ──────────────────────────────────────────────────────

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
  const reps = [...m.profileMap.values()]
    .filter((p) => p.role === 'sales_rep' || p.role === 'manager')
    .sort((a, b) => fullName(a).localeCompare(fullName(b)));
  return `
    <header class="db-head sf-head">
      <div class="db-head-actions">
        ${state.isManager && reps.length ? `
          <select class="sf-select" data-owner aria-label="Deal owner">
            <option value="all">All reps</option>
            ${reps.map((p) => `<option value="${esc(p.id)}"${p.id === ui.owner ? ' selected' : ''}>${esc(fullName(p))}</option>`).join('')}
          </select>` : ''}
        <div class="db-seg" role="group" aria-label="Deals created in">
          ${PERIODS.map((p) => `<button type="button" class="db-seg-btn${p.key === m.period.key ? ' is-active' : ''}" data-period="${p.key}" aria-pressed="${p.key === m.period.key}" title="Deals created in ${p.name}">${p.label}</button>`).join('')}
        </div>
      </div>
    </header>`;
}

function renderKpis(m) {
  const { s } = m;
  const cells = [
    { label: 'Deals created', value: s.created.length.toLocaleString(), note: money(sumValue(s.created)) },
    { label: 'Lead → Won', value: fmtPct(s.leadToWon), note: `${plural(s.won.length, 'deal')} won` },
    { label: 'Win rate', value: fmtPct(s.winRate), note: s.won.length + s.lost.length ? `${s.won.length} won · ${s.lost.length} lost` : 'No deals closed' },
    { label: 'Avg. days to win', value: m.daysToWin != null ? Math.round(m.daysToWin).toLocaleString() : '—', note: m.avgWon != null ? `Avg. won deal ${money(m.avgWon)}` : 'No deals won' },
  ];
  return `
    <section class="db-card sf-kpis" aria-label="Summary">
      ${cells.map((c) => `
        <div class="sf-kpi">
          <span class="db-tab-label">${c.label}</span>
          <span class="db-tab-value">${c.value}</span>
          <span class="db-tab-note">${esc(c.note)}</span>
        </div>`).join('')}
    </section>`;
}

function renderFunnel(m) {
  const { s } = m;
  const total = s.created.length;
  const steps = [
    { key: 'created', label: 'Created', list: s.created, color: STAGE_META.prospecting.color },
    { key: 'reached', label: `Reached ${STAGE_META.qualification.label}`, list: s.reached, color: STAGE_META.qualification.color },
    { key: 'won', label: STAGE_META['closed-won'].label, list: s.won, color: STAGE_META['closed-won'].color },
  ];
  const drops = [
    {
      rate: pct(s.reached.length, total),
      verb: `moved to ${STAGE_META.qualification.label}`,
      rest: [
        s.lead.length ? `${s.lead.length} still in ${STAGE_META.prospecting.label}` : '',
        s.lost.length ? `${s.lost.length} lost` : '',
      ],
    },
    {
      rate: pct(s.won.length, s.reached.length),
      verb: 'won',
      rest: [s.progress.length ? `${s.progress.length} still ${STAGE_META.qualification.label}` : ''],
    },
  ];

  if (!total) {
    return `
      <section class="db-card sf-funnel">
        ${cardHead('Funnel')}
        <div class="db-empty">
          <p class="db-empty-title">No deals created in ${esc(m.period.name)}</p>
          <p class="db-empty-text">Pick a longer period, or add deals from the pipeline.</p>
        </div>
      </section>`;
  }

  return `
    <section class="db-card sf-funnel">
      ${cardHead('Funnel', `${plural(total, 'deal')} created in ${esc(m.period.name)}`, { view: 'opportunity-pipeline', label: 'Pipeline' })}
      <ol class="sf-steps">
        ${steps.map((st, i) => {
          const share = pct(st.list.length, total) || 0;
          const drop = drops[i];
          return `
          <li class="sf-step">
            <div class="sf-step-line">
              <span class="sf-step-label">${esc(st.label)}</span>
              <span class="sf-step-figs">
                <span class="db-strong">${st.list.length.toLocaleString()}</span>
                <span class="db-faint" title="${moneyFull(sumValue(st.list))}">${money(sumValue(st.list))}</span>
              </span>
            </div>
            <div class="sf-track" role="img" aria-label="${esc(st.label)}: ${Math.round(share)}% of created deals">
              <span class="sf-bar" style="width:${st.list.length ? Math.max(share, 1) : 0}%;background:${st.color}"></span>
            </div>
            ${drop ? `
              <div class="sf-drop">
                ${icon('down', 13)}
                <span><strong>${fmtPct(drop.rate)}</strong> ${drop.verb}</span>
                ${drop.rest.filter(Boolean).map((t) => `<span class="db-faint">· ${esc(t)}</span>`).join('')}
              </div>` : ''}
          </li>`;
        }).join('')}
      </ol>
      <p class="sf-footnote">Based on each deal's current stage. Lost deals only count as created, since the stage they were lost from isn't recorded. Recent deals may still be moving through.</p>
    </section>`;
}

function renderStages(m) {
  const total = m.s.created.length;
  return `
    <section class="db-card sf-stages">
      ${cardHead('Where they are now')}
      ${total ? `
        <div class="sf-stack" role="img" aria-label="${m.stages.map((st) => `${st.label} ${Math.round(st.share || 0)}%`).join(', ')}">
          ${m.stages.filter((st) => st.count).map((st) => `<span style="flex:${st.count};background:${st.color}" title="${esc(st.label)}: ${st.count}"></span>`).join('')}
        </div>
        <ul class="sf-legend">
          ${m.stages.map((st) => `
            <li class="sf-legend-row">
              <span class="db-stage"><span class="db-dot" style="background:${st.color}"></span>${esc(st.label)}</span>
              <span class="sf-legend-figs">
                <span class="db-faint">${fmtPct(st.share)}</span>
                <span class="sf-legend-count">${st.count.toLocaleString()}</span>
                <span class="db-strong" title="${moneyFull(st.value)}">${money(st.value)}</span>
              </span>
            </li>`).join('')}
        </ul>
        <dl class="db-stats">
          <div class="db-stat">
            <dt>Still open</dt>
            <dd>${(m.s.lead.length + m.s.progress.length).toLocaleString()} <span class="db-faint">· ${money(sumValue([...m.s.lead, ...m.s.progress]))}</span></dd>
          </div>
          <div class="db-stat">
            <dt>Avg. deal size</dt>
            <dd>${money(sumValue(m.s.created) / total)}</dd>
          </div>
        </dl>` : `
        <div class="db-empty">
          <p class="db-empty-text">Nothing to break down yet.</p>
        </div>`}
    </section>`;
}

function renderReps(m) {
  if (!state.isManager || ui.owner !== 'all') return '';
  return `
    <section class="db-card sf-reps">
      ${cardHead('Conversion by rep', `Deals created in ${esc(m.period.name)}`)}
      ${m.reps.length === 0 ? `
        <div class="db-empty"><p class="db-empty-text">No deals created in this period.</p></div>` : `
        <div class="db-table-wrap">
          <table class="db-table">
            <thead>
              <tr>
                <th>Rep</th>
                <th class="db-num">Created</th>
                <th class="db-num sf-col-reached" title="Share of created deals now In Progress or Won">Reached ${esc(STAGE_META.qualification.label)}</th>
                <th class="db-num">Won</th>
                <th class="db-num sf-col-winrate" title="Won ÷ (won + lost)">Win rate</th>
                <th class="db-num sf-col-value">Won value</th>
              </tr>
            </thead>
            <tbody>
              ${m.reps.map((r) => `
                <tr>
                  <td><span class="db-person"><span class="db-avatar" aria-hidden="true">${esc(r.initials)}</span><span class="db-cell-title">${esc(r.name)}</span></span></td>
                  <td class="db-num">${r.created}</td>
                  <td class="db-num sf-col-reached">
                    <span class="db-bar-cell">
                      <span class="db-minibar"><span style="width:${r.reachedRate || 0}%"></span></span>
                      <span class="sf-rate">${fmtPct(r.reachedRate)}</span>
                    </span>
                  </td>
                  <td class="db-num">${r.won || '<span class="db-faint">0</span>'}</td>
                  <td class="db-num sf-col-winrate">${r.winRate == null ? '<span class="db-faint">—</span>' : fmtPct(r.winRate)}</td>
                  <td class="db-num db-strong sf-col-value">${r.wonValue ? money(r.wonValue) : '<span class="db-faint">—</span>'}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`}
    </section>`;
}

function dealRow(o, right, m) {
  const owner = m.profileMap.get(o.user_id);
  const stage = STAGE_META[o.stage];
  const meta = [o.company_name, state.isManager && owner ? fullName(owner) : ''].filter(Boolean).join(' · ');
  return `
    <li>
      <button type="button" class="db-row" data-nav="opportunity-pipeline">
        <span class="db-dot" style="background:${stage.color}" title="${esc(stage.label)}"></span>
        <span class="db-row-main">
          <span class="db-row-title">${esc(o.name || 'Untitled deal')}</span>
          ${meta ? `<span class="db-row-meta">${esc(meta)}</span>` : ''}
        </span>
        ${right}
      </button>
    </li>`;
}

function renderOpenDeals(m) {
  const likely = m.likely.length === 0
    ? '<div class="db-empty"><p class="db-empty-text">No open deals.</p></div>'
    : `<ul class="db-list">${m.likely.map((o) => dealRow(o, `
        <span class="sf-row-figs">
          <span class="db-strong">${money(o.val)}</span>
          ${m.hasProbabilities ? `<span class="db-faint">${o.prob}%</span>` : ''}
        </span>`, m)).join('')}</ul>`;

  const stalled = m.stalled.length === 0
    ? `<div class="db-empty"><p class="db-empty-title">Nothing stalled</p><p class="db-empty-text">Open deals with no updates for ${STALLED_DAYS}+ days show up here.</p></div>`
    : `<ul class="db-list">${m.stalled.slice(0, 6).map((o) => dealRow(o, `
        <span class="sf-row-figs">
          <span class="db-strong">${money(o.val)}</span>
          <span class="db-tone-warn">${o.idle}d idle</span>
        </span>`, m)).join('')}</ul>
       ${m.stalled.length > 6 ? `<p class="db-more">+${m.stalled.length - 6} more</p>` : ''}`;

  return `
    <div class="sf-section-head">
      <h2 class="sf-section-title">Open deals right now</h2>
      <span class="db-card-sub">${plural(m.openCount, 'deal')} in ${esc(STAGE_META.prospecting.label)} or ${esc(STAGE_META.qualification.label)}, any age</span>
    </div>
    <div class="sf-pair">
      <section class="db-card">
        ${cardHead('Most likely to close', m.hasProbabilities ? 'Value × win probability' : 'By value · set win probability to rank by likelihood')}
        ${likely}
      </section>
      <section class="db-card">
        ${cardHead('Stalled', m.stalled.length ? `<span class="db-count sf-count-warn">${m.stalled.length}</span>` : '')}
        ${stalled}
      </section>
    </div>`;
}

function renderPage(m) {
  return `
    <div class="db sf">
      ${renderHeader(m)}
      ${renderKpis(m)}
      <div class="sf-grid">
        ${renderFunnel(m)}
        ${renderStages(m)}
      </div>
      ${renderReps(m)}
      ${renderOpenDeals(m)}
    </div>`;
}

function renderSkeleton() {
  const block = (cls) => `<div class="db-skel ${cls}"></div>`;
  return `
    <div class="db sf" aria-busy="true">
      <div class="db-card sf-kpis">${block('sf-skel-kpis')}</div>
      <div class="sf-grid">
        <div class="db-card">${block('db-skel-list')}</div>
        <div class="db-card">${block('db-skel-list')}</div>
      </div>
    </div>`;
}

// ── Mount & events ──────────────────────────────────────────────

function mount(root) {
  root.innerHTML = renderPage(buildModel(ui.data));
}

function bindEvents(root) {
  root.addEventListener('click', (e) => {
    const periodBtn = e.target.closest('[data-period]');
    if (periodBtn) {
      if (periodBtn.dataset.period === ui.period) return;
      ui.period = periodBtn.dataset.period;
      storeChoice(PERIOD_STORAGE_KEY, ui.period);
      mount(root);
      return;
    }
    const nav = e.target.closest('[data-nav]');
    if (nav) navigateView(nav.dataset.nav);
  });

  root.addEventListener('change', (e) => {
    if (!e.target.matches('[data-owner]')) return;
    ui.owner = e.target.value;
    mount(root);
    root.querySelector('[data-owner]')?.focus();
  });
}

async function renderSalesFunnelView() {
  const viewContainer = document.getElementById('view-container');
  // Own root per render so delegated listeners go away with the view.
  viewContainer.innerHTML = '<div class="db-root"></div>';
  const root = viewContainer.firstElementChild;
  root.innerHTML = renderSkeleton();
  ui.owner = 'all';
  bindEvents(root);

  try {
    ui.data = await fetchFunnelData();
    mount(root);
  } catch (err) {
    console.error('Sales funnel error:', err);
    root.innerHTML = renderError('Failed to load sales funnel: ' + err.message);
  }
}

// ── Exports ────────────────────────────────────────────────────
export {
  renderSalesFunnelView,
};
