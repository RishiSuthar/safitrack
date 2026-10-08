// modules/features/opportunities.js
// Opportunity pipeline: kanban, drag-and-drop, modals.
import { state, supabaseClient, loadPersistedState as _loadPersistedState, saveViewState } from '../state.js';
import { viewContainer } from '../ui/dom.js';
import { showToast, escapeHtml, getInitials, triggerConfetti } from '../ui/toast.js';
import { renderError, getCurrencySymbol, formatCurrency } from '../utils/helpers.js';
import { getCompanyLogoUrl } from '../ui/spreadsheet.js';
import { getDefaultSalesStages, LEGACY_STAGE_TO_CANONICAL } from '../utils/pipeline-stages.js';

// ── Pipeline helpers ──────────────────────────────────────────────────────────

/** Stage color palette for custom pipelines */
const STAGE_COLORS = ['#3b82f6', '#ec4899', '#10b981', '#ef4444', '#f59e0b', '#8b5cf6', '#06b6d4', '#f97316'];
const OPPORTUNITY_STAGE_PAGE_SIZE = 25;
const DAY_MS = 24 * 60 * 60 * 1000;
// Won/Lost columns only show deals closed this recently unless the user picks "All time".
const CLOSED_RECENT_DAYS = 90;
// Open deals this long in one stage are flagged as possibly stuck.
const STALE_STAGE_DAYS = 30;
const DEFAULT_SORT = 'recent';
// Owner filter value for deals whose owner was removed
const NO_OWNER = '__none__';
const OPPORTUNITY_SELECT = '*, profiles(id, first_name, last_name, email, role, avatar_url)';

// The board currently on screen: deals by id, per-stage "Load more" state and
// the search text for each deal. Column headers and totals count deals that are
// still behind "Load more" too.
let board = null;

// Listeners the opportunity form adds outside its own (re-cloned) inputs.
// Aborted every time the form opens so they don't pile up.
let opportunityModalListeners = null;

/** The built-in fallback used when Supabase is unavailable */
function getDefaultPipeline() {
  return {
    id: '__default__',
    name: 'Sales',
    is_default: true,
    stages: getDefaultSalesStages(),
  };
}

/** Load pipelines from Supabase (cached in state.pipelines). Auto-creates the
 *  default "Sales" pipeline on first run if none exist. */
async function loadPipelines() {
  if (state.pipelines && state.pipelines.length > 0) return state.pipelines;

  let q = supabaseClient.from('pipelines').select('*').order('created_at');
  if (state.currentOrganization?.id) q = q.eq('organization_id', state.currentOrganization.id);
  const { data, error } = await q;

  if (error) {
    console.warn('loadPipelines error:', error.message);
    return [getDefaultPipeline()];
  }

  let pipelines = data || [];

  if (pipelines.length === 0 && state.isManager && state.currentOrganization?.id) {
    // First-time setup: seed the default Sales pipeline
    const seed = getDefaultPipeline();
    const { data: created, error: insertErr } = await supabaseClient
      .from('pipelines')
      .insert([{
        name: seed.name,
        stages: seed.stages,
        organization_id: state.currentOrganization.id,
        created_by: state.currentUser?.id,
        is_default: true,
      }])
      .select()
      .single();
    if (!insertErr && created) {
      pipelines = [created];
    } else {
      pipelines = [seed]; // offline fallback
    }
  } else if (pipelines.length === 0) {
    pipelines = [getDefaultPipeline()];
  }

  state.pipelines = pipelines;
  return pipelines;
}

/** Returns the pipeline object the user is currently viewing */
function getActivePipeline(pipelines) {
  const orgId = state.currentOrganization?.id || '';
  const savedId = localStorage.getItem(`safi_pipeline_${orgId}`);
  const found = savedId && pipelines.find(p => p.id === savedId);
  // If previously active pipeline was deleted, fall back gracefully
  return found || pipelines[0] || getDefaultPipeline();
}

/** The active pipeline from the cache, without fetching */
function getCachedActivePipeline() {
  return (state.pipelines && state.activePipelineId
    ? state.pipelines.find(p => p.id === state.activePipelineId)
    : null) || getDefaultPipeline();
}

/** Stages of a pipeline, falling back to the default set if it has none */
function getPipelineStages(pipeline) {
  return pipeline?.stages?.length ? pipeline.stages : getDefaultSalesStages();
}

/** Persist the active pipeline choice to localStorage */
function setActivePipeline(pipelineId) {
  const orgId = state.currentOrganization?.id || '';
  state.activePipelineId = pipelineId;
  try { localStorage.setItem(`safi_pipeline_${orgId}`, pipelineId); } catch { /* ignore */ }
}

/** True if an opportunity belongs to the given pipeline (handles null = default) */
function oppMatchesPipeline(opp, pipeline) {
  if (pipeline.is_default) {
    return !opp.pipeline_id || opp.pipeline_id === pipeline.id;
  }
  return opp.pipeline_id === pipeline.id;
}

/**
 * The column a deal belongs in. Legacy stage names (proposal, Closed_Won, ...)
 * are mapped on the default pipeline; anything else that doesn't match a stage
 * lands in the first column rather than disappearing from the board.
 */
function resolveStageId(rawStage, stages, isDefaultPipeline) {
  if (stages.some(s => s.id === rawStage)) return rawStage;
  if (isDefaultPipeline) {
    const key = String(rawStage || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
    const mapped = LEGACY_STAGE_TO_CANONICAL[key];
    if (mapped && stages.some(s => s.id === mapped)) return mapped;
  }
  return stages[0]?.id;
}

/** 'won' / 'lost' for the closing stages, null for open ones */
function getStageOutcome(stageId) {
  if (stageId === 'closed-won') return 'won';
  if (stageId === 'closed-lost') return 'lost';
  return null;
}

/** Stage titles can carry decoration (e.g. "Won 🎉"); the board shows them plain. */
function plainStageTitle(title) {
  return String(title || '').replace(/[\p{Extended_Pictographic}‍️]/gu, '').trim();
}

/** Update the stage dropdown in the opportunity modal to reflect the active pipeline's stages */
function updateStageDropdownForPipeline(pipeline, currentValue) {
  const stages = getPipelineStages(pipeline);
  const options = stages.map(s => ({ value: s.id, label: plainStageTitle(s.title) }));
  window.updateCrmDropdownOptions?.('opportunity-stage', options, false);
  const defaultVal = currentValue || stages[0]?.id;
  if (defaultVal) window.setCrmDropdownValue?.('opportunity-stage', defaultVal);
}

function buildCompanyLookup(companies) {
  const safeCompanies = Array.isArray(companies) ? companies : [];
  const byId = new Map();
  const byName = new Map();

  safeCompanies.forEach((company) => {
    if (!company) return;
    if (company.id != null) byId.set(String(company.id), company);
    const normalizedName = (window.normalizeForMatching?.(company.name) || String(company.name || '').toLowerCase().trim());
    if (normalizedName && !byName.has(normalizedName)) byName.set(normalizedName, company);
  });

  return { byId, byName };
}

function findCompanyForOpportunityFast(opp, lookup) {
  if (!opp || !lookup) return null;

  if (opp.company_id != null && String(opp.company_id).trim() !== '') {
    const byId = lookup.byId.get(String(opp.company_id));
    if (byId) return byId;
  }

  const normalizedOppName = (window.normalizeForMatching?.(opp.company_name) || String(opp.company_name || '').toLowerCase().trim());
  if (normalizedOppName) {
    const byName = lookup.byName.get(normalizedOppName);
    if (byName) return byName;
  }

  // Strict match only: if not in CRM by id or exact name, do not match random companies
  return null;
}

// ── Deal helpers ──────────────────────────────────────────────────────────────

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fullName(profile) {
  return profile ? [profile.first_name, profile.last_name].filter(Boolean).join(' ') : '';
}

function dealValue(opp) {
  return parseFloat(opp?.value) || 0;
}

function dealProbability(opp) {
  const p = parseInt(opp?.probability, 10);
  return Number.isNaN(p) ? 0 : Math.min(100, Math.max(0, p));
}

/** Totals are shown rounded; card values keep their decimals. */
function formatMoney(amount) {
  return formatCurrency(Math.round(amount));
}

/** Competitors are stored as a JSON string; a malformed value must not break the board. */
function parseCompetitors(raw) {
  if (Array.isArray(raw)) return raw.filter(Boolean).map(String);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : [];
  } catch {
    return [];
  }
}

/** A date-only value ("2026-10-08") as local midnight. new Date() would read it as UTC. */
function toLocalDay(value) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  const day = match ? new Date(+match[1], +match[2] - 1, +match[3]) : new Date(value);
  if (Number.isNaN(day.getTime())) return null;
  day.setHours(0, 0, 0, 0);
  return day;
}

/** 'overdue', 'today' or null for a next-step due date */
function getDueStatus(dateValue) {
  const due = toLocalDay(dateValue);
  if (!due) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (due < today) return 'overdue';
  if (due.getTime() === today.getTime()) return 'today';
  return null;
}

/** Next-step due date relative to today: "Today", "Tomorrow", "Yesterday", else "12 Oct".
 *  (The shared formatDate treats every date as past, so future steps read "3 days ago".) */
function formatDueDate(dateValue) {
  const due = toLocalDay(dateValue);
  if (!due) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((due - today) / DAY_MS);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  return due.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(due.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  });
}

/** When the deal entered its current stage. stage_changed_at is kept by a DB trigger;
 *  older databases without that column fall back to the last update. */
function getStageEnteredAt(opp) {
  return opp.stage_changed_at || opp.updated_at || opp.created_at;
}

function daysSince(value) {
  const time = value ? new Date(value).getTime() : NaN;
  if (Number.isNaN(time)) return 0;
  return Math.max(0, Math.floor((Date.now() - time) / DAY_MS));
}

function isAssignedToMe(opp) {
  return opp._isAssignedToMe === true
    || (opp.assignees || []).some(a => a.user_id === state.currentUser.id);
}

/** Owners and tagged assignees can edit their deals; managers can edit any deal in the org. */
function canEditOpportunity(opp) {
  if (!opp) return false;
  return state.isManager || opp.user_id === state.currentUser.id || isAssignedToMe(opp);
}

/** Owner first, then tagged assignees (excluding the owner if also tagged) */
function getOpportunityTeam(opp) {
  const team = [];
  if (opp.profiles) {
    team.push({ user_id: opp.user_id, name: fullName(opp.profiles) || 'Owner', avatar_url: opp.profiles.avatar_url });
  }
  (opp.assignees || [])
    .filter(a => a.user_id !== opp.user_id)
    .forEach(a => team.push({ user_id: a.user_id, name: fullName(a.profiles) || 'Member', avatar_url: a.profiles?.avatar_url }));
  return team;
}

/** Initials with an optional photo on top that hides itself if it fails to load */
function renderAvatarContent(name, avatarUrl) {
  if (!avatarUrl) return escapeHtml(getInitials(name));
  return `<span style="position:relative;z-index:1;display:none;">${escapeHtml(getInitials(name))}</span><img src="${escapeHtml(avatarUrl)}" alt="" onload="this.style.display='block'" onerror="this.style.display='none';var p=this.previousElementSibling;if(p)p.style.display='block'" />`;
}

/** A real logo for the deal's company, or '' to fall back to initials */
function getOpportunityLogoUrl(company) {
  if (company?.logo_url) return company.logo_url;
  // Only use favicon service for real domain fields (getCompanyLogoUrl rejects emails)
  return company?.domain ? getCompanyLogoUrl(company.domain) : '';
}

const COMPANY_SUFFIXES = /\b(ltd|limited|inc|incorporated|co|company|plc|llc|llp)\b/g;

function normalizeCompanyName(value) {
  return String(value || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(COMPANY_SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Deals are often named after their company ("Invmer ltd" at INVMER LTD); don't repeat it. */
function dealNameRepeatsCompany(dealName, companyName) {
  const deal = normalizeCompanyName(dealName);
  const company = normalizeCompanyName(companyName);
  return Boolean(deal && company && deal.startsWith(company));
}

/** Deals in the top 20% by value count as "High Value" */
function getHighValueThreshold(opportunities) {
  const values = opportunities.map(dealValue).filter(v => v > 0).sort((a, b) => b - a);
  if (values.length === 0) return Infinity;
  return values[Math.max(0, Math.ceil(values.length * 0.2) - 1)];
}

function buildSearchText(opp, company) {
  return [
    opp.name,
    opp.company_name,
    company?.name,
    opp.subsector || company?.subsector,
    opp.notes,
    opp.next_step,
    ...parseCompetitors(opp.competitors),
    ...getOpportunityTeam(opp).map(m => m.name),
  ].filter(Boolean).join(' ').toLowerCase();
}

// ── Board markup ──────────────────────────────────────────────────────────────

const CHECK_ICON = '<svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
const CHEVRON_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';

function renderFilterDropdown(id, options, selectedValue) {
  const selected = options.find(o => o.value === selectedValue) || options[0];
  return `
    <div class="crm-dd crm-dd--filter" data-dd-id="${id}">
      <button type="button" class="crm-dd-trigger has-value" aria-haspopup="listbox" aria-expanded="false">
        <span class="crm-dd-label">${escapeHtml(selected.label)}</span>
        <span class="crm-dd-chevron">${CHEVRON_ICON}</span>
      </button>
      <div class="crm-dd-panel" role="listbox">
        <ul class="crm-dd-list">
          ${options.map(o => {
            const isSelected = o.value === selected.value;
            return `<li class="crm-dd-option${isSelected ? ' is-selected' : ''}" role="option"${isSelected ? ' aria-selected="true"' : ''} data-value="${escapeHtml(o.value)}" data-label="${escapeHtml(o.label)}" tabindex="-1">${CHECK_ICON}${escapeHtml(o.label)}</li>`;
          }).join('')}
        </ul>
      </div>
      <input class="crm-dd-value-input" type="hidden" id="${id}" value="${escapeHtml(selected.value)}">
    </div>`;
}

function renderOpportunityCard(opp, companyLookup) {
  const canEdit = canEditOpportunity(opp);
  const isClosed = Boolean(getStageOutcome(opp.mappedStage));
  const company = findCompanyForOpportunityFast(opp, companyLookup);
  const companyName = company?.name || opp.company_name || '';
  const logoUrl = getOpportunityLogoUrl(company);
  const subsector = (opp.subsector || company?.subsector || '').trim();
  const probability = dealProbability(opp);
  const stageDays = daysSince(getStageEnteredAt(opp));
  const isStale = !isClosed && stageDays >= STALE_STAGE_DAYS;
  const dueStatus = getDueStatus(opp.next_step_date);

  const subtitle = [
    companyName && !dealNameRepeatsCompany(opp.name, companyName) ? companyName : '',
    subsector,
  ].filter(Boolean);

  let nextStepHtml = '';
  if (opp.next_step || opp.next_step_date) {
    const dueLabel = formatDueDate(opp.next_step_date);
    nextStepHtml = `
      <div class="opp-next-step${dueStatus ? ` is-${dueStatus === 'overdue' ? 'overdue' : 'due-today'}` : ''}">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="opp-step-icon" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="3"/><path d="m9 12 2 2 4-4"/></svg>
        <span class="opp-step-text">${escapeHtml(opp.next_step || 'Follow-up')}</span>
        ${dueLabel ? `<time class="opp-step-date">${escapeHtml(dueLabel)}</time>` : ''}
      </div>`;
  }

  const team = getOpportunityTeam(opp);
  let teamHtml = '';
  if (team.length > 0) {
    const overflow = team.length - 3;
    teamHtml = `
      <div class="opp-assignees-stack">
        ${team.slice(0, 3).map((m, i) => `<div class="opp-assignee-bubble" title="${escapeHtml(m.name)}" style="background:${getAssigneeColor(m.user_id)};z-index:${10 - i}">${renderAvatarContent(m.name, m.avatar_url)}</div>`).join('')}
        ${overflow > 0 ? `<div class="opp-assignee-bubble opp-assignee-overflow" title="${overflow} more">+${overflow}</div>` : ''}
      </div>`;
  }

  return `
    <div class="opportunity-card ${canEdit ? 'is-mine' : 'readonly'}${isStale ? ' is-stale' : ''}"
      data-id="${escapeHtml(opp.id)}"
      data-owner-id="${escapeHtml(opp.user_id || '')}"
      data-value="${dealValue(opp)}"
      data-probability="${probability}"
      data-created-ts="${new Date(opp.created_at).getTime() || 0}"
      data-updated-ts="${new Date(opp.updated_at || opp.created_at).getTime() || 0}"
      data-next-step-ts="${toLocalDay(opp.next_step_date)?.getTime() ?? ''}"
      title="${canEdit ? 'Click to open, drag to move' : 'Click to open'}">

      <div class="opp-card-head">
        <span class="opp-avatar" aria-hidden="true">
          <span class="opp-avatar-initials">${escapeHtml(getInitials(companyName || opp.name || '?'))}</span>
          ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="" onload="this.previousElementSibling.style.visibility='hidden'" onerror="this.remove()" />` : ''}
        </span>
        <div class="opp-card-titles">
          <div class="opp-name">${escapeHtml(opp.name || 'Untitled deal')}</div>
          ${subtitle.length ? `<div class="opp-company">${subtitle.map(escapeHtml).join('<span class="opp-dot">·</span>')}</div>` : ''}
        </div>
        <span class="opp-stage-age" title="${stageDays} day${stageDays === 1 ? '' : 's'} in this stage${isStale ? ', may be stuck' : ''}">${stageDays}d</span>
      </div>

      <div class="opp-value-row">
        <span class="opp-value">${formatCurrency(dealValue(opp))}</span>
        <span class="opp-prob-label" title="Win chance"${isClosed ? ' hidden' : ''}>${probability}%</span>
        ${teamHtml}
      </div>

      ${nextStepHtml}
    </div>
  `;
}

function renderLoadMoreButton(stageId, remaining) {
  return `
    <div class="pipeline-load-more-wrap">
      <button class="btn btn-ghost pipeline-load-more" data-stage-id="${escapeHtml(stageId)}">
        <span class="pipeline-load-more-main">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="m5 12 7 7 7-7"/></svg>
          <span class="pipeline-load-more-label">Load more deals</span>
        </span>
        <span class="pipeline-load-more-meta">
          <span class="pipeline-load-more-count">${Math.min(OPPORTUNITY_STAGE_PAGE_SIZE, remaining)}</span>
          <span class="pipeline-load-more-sep">of</span>
          <span class="pipeline-load-more-remaining">${remaining}</span>
          <span class="pipeline-load-more-sep">left</span>
        </span>
      </button>
    </div>`;
}

// ── Board render ──────────────────────────────────────────────────────────────

/**
 * Render the kanban for the active pipeline.
 * preserveView keeps "Load more" expansions and scroll positions, for re-renders
 * after the user saves or deletes something on the same pipeline.
 */
async function renderOpportunityPipelineView({ preserveView = false } = {}) {
  const savedView = preserveView ? captureBoardView() : null;

  // Ensure companies cache is ready before rendering opportunities
  if (!Array.isArray(window.allCompaniesData) || window.allCompaniesData.length === 0) {
    try { await loadAllCompanies(); } catch (e) { /* ignored */ }
  }

  // ── Load pipelines & opportunities ───────────────────────────────────────
  // profiles is a left join: deals whose owner was removed (user_id set to
  // null) or whose profile the viewer can't read must still show up.
  let opportunitiesQuery = supabaseClient
    .from('opportunities')
    .select(OPPORTUNITY_SELECT)
    .order('created_at', { ascending: false });
  // Managers see all opportunities in their org; sales reps only their own
  if (!state.isManager) opportunitiesQuery = opportunitiesQuery.eq('user_id', state.currentUser.id);
  if (state.currentOrganization?.id) opportunitiesQuery = opportunitiesQuery.eq('organization_id', state.currentOrganization.id);

  const [pipelines, opportunitiesResult] = await Promise.all([loadPipelines(), opportunitiesQuery]);
  const activePipeline = getActivePipeline(pipelines);
  setActivePipeline(activePipeline.id);

  if (opportunitiesResult.error) {
    viewContainer.innerHTML = renderError(opportunitiesResult.error.message);
    return;
  }
  let opportunities = opportunitiesResult.data || [];

  // For sales reps: load extra opportunities where they are an assignee but not the owner.
  // Do this BEFORE the assignee batch-load so all opp IDs are known upfront.
  if (!state.isManager) {
    const { data: myAssignedRows } = await supabaseClient
      .from('opportunity_assignees')
      .select('opportunity_id')
      .eq('user_id', state.currentUser.id);
    const existingOppIds = new Set(opportunities.map(o => o.id));
    const newIds = (myAssignedRows || []).map(r => r.opportunity_id).filter(id => !existingOppIds.has(id));
    if (newIds.length > 0) {
      const { data: extraOpps } = await supabaseClient
        .from('opportunities')
        .select(OPPORTUNITY_SELECT)
        .in('id', newIds);
      (extraOpps || []).forEach(opp => {
        // Mark explicitly so the deal stays editable even if assignees fail to load
        opp._isAssignedToMe = true;
        opportunities.push(opp);
      });
    }
  }

  // Batch-load assignees for ALL opportunities (owned + assigned) in two steps.
  // Cannot use embedded profiles(...) join because opportunity_assignees.user_id
  // references auth.users, not profiles — Supabase can't resolve that join.
  const assigneesByOppId = {};
  if (opportunities.length > 0) {
    const { data: assigneeRows } = await supabaseClient
      .from('opportunity_assignees')
      .select('opportunity_id, user_id')
      .in('opportunity_id', opportunities.map(o => o.id));

    if (assigneeRows && assigneeRows.length > 0) {
      const uniqueUserIds = [...new Set(assigneeRows.map(a => a.user_id))];
      const { data: profileRows } = await supabaseClient
        .from('profiles')
        .select('id, first_name, last_name, role, avatar_url')
        .in('id', uniqueUserIds);
      const profilesById = {};
      (profileRows || []).forEach(p => { profilesById[p.id] = p; });

      assigneeRows.forEach(a => {
        if (!assigneesByOppId[a.opportunity_id]) assigneesByOppId[a.opportunity_id] = [];
        assigneesByOppId[a.opportunity_id].push({
          opportunity_id: a.opportunity_id,
          user_id: a.user_id,
          profiles: profilesById[a.user_id] || null,
        });
      });
    }
  }
  opportunities.forEach(opp => {
    opp.assignees = assigneesByOppId[opp.id] || [];
  });

  // ── Filter to the active pipeline and place each deal in a column ────────
  const pipelineStages = getPipelineStages(activePipeline);
  opportunities = opportunities.filter(opp => oppMatchesPipeline(opp, activePipeline));
  opportunities.forEach(opp => {
    opp.mappedStage = resolveStageId(opp.stage, pipelineStages, activePipeline.is_default);
  });

  // Won/Lost only keep recent deals unless the user asked for all time
  const persisted = _loadPersistedState().pipeline || {};
  const closedRange = persisted.closedRange === 'all' ? 'all' : 'recent';
  const hasClosedStages = pipelineStages.some(s => getStageOutcome(s.id));
  const olderClosedByStage = {};
  if (closedRange === 'recent') {
    const cutoff = Date.now() - CLOSED_RECENT_DAYS * DAY_MS;
    opportunities = opportunities.filter(opp => {
      if (!getStageOutcome(opp.mappedStage)) return true;
      const closedAt = new Date(getStageEnteredAt(opp)).getTime();
      if (Number.isNaN(closedAt) || closedAt >= cutoff) return true;
      olderClosedByStage[opp.mappedStage] = (olderClosedByStage[opp.mappedStage] || 0) + 1;
      return false;
    });
  }

  // Most recently updated or moved deals first in each column
  opportunities.sort((a, b) => {
    const aTime = new Date(a.updated_at || a.created_at || 0).getTime();
    const bTime = new Date(b.updated_at || b.created_at || 0).getTime();
    return bTime - aTime;
  });

  const opportunitiesByStage = {};
  pipelineStages.forEach(stage => { opportunitiesByStage[stage.id] = []; });
  opportunities.forEach(opp => opportunitiesByStage[opp.mappedStage]?.push(opp));

  const companyLookup = buildCompanyLookup(window.allCompaniesData);
  board = {
    opportunitiesById: new Map(opportunities.map(opp => [opp.id, opp])),
    pagination: {},
    searchText: new Map(opportunities.map(opp => [opp.id, buildSearchText(opp, findCompanyForOpportunityFast(opp, companyLookup))])),
    highValueThreshold: getHighValueThreshold(opportunities),
  };

  const ownerOptions = state.isManager
    ? Array.from(new Map(opportunities.map(opp => [opp.user_id || NO_OWNER, fullName(opp.profiles) || 'Unassigned'])).entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label }))
    : [];

  const quickFilterOptions = [
    { value: 'all', label: 'All Deals' },
    { value: 'high-value', label: 'High Value (top 20%)' },
    { value: 'high-probability', label: 'High Probability (70%+)' },
    { value: 'next-step-due', label: 'Next Step Due or Overdue' },
    ...(state.isManager ? [{ value: 'my-reps', label: 'Sales Reps' }] : []),
  ];

  const sortOptions = [
    { value: 'recent', label: 'Sort: Recently Updated' },
    { value: 'newest', label: 'Sort: Newest' },
    { value: 'oldest', label: 'Sort: Oldest' },
    { value: 'value-desc', label: 'Sort: Highest Value' },
    { value: 'value-asc', label: 'Sort: Lowest Value' },
    { value: 'probability-desc', label: 'Sort: Highest Probability' },
    { value: 'next-step', label: 'Sort: Next Step Due' },
  ];

  let html = `
    <div class="pipeline-toolbar" style="flex-direction: column; align-items: stretch; gap: 8px;">

      <div class="pipeline-switcher-row">
        <div class="pipeline-tabs" id="pipeline-tabs">
          ${pipelines.map(p => `
            <button class="pipeline-tab${p.id === activePipeline.id ? ' is-active' : ''}" data-pipeline-id="${escapeHtml(p.id)}">
              ${escapeHtml(p.name)}
            </button>
          `).join('')}
        </div>
        ${state.isManager ? `
          <button class="btn btn-ghost pipeline-manage-btn" id="manage-pipelines-btn">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
            <span class="manage-btn-label">Manage</span>
          </button>
        ` : ''}
      </div>

      <div class="pipeline-controls pipeline-controls-primary" style="width: 100%;">
        <div class="pipeline-search">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"/></svg>
          <input type="text" id="pipeline-search" placeholder="Search company, deal, notes...">
        </div>

        <button class="btn btn-secondary crm-filter-toggle-btn" id="pipeline-advanced-toggle" aria-expanded="false">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-sliders-horizontal-icon lucide-sliders-horizontal"><path d="M10 5H3"/><path d="M12 19H3"/><path d="M14 3v4"/><path d="M16 17v4"/><path d="M21 12h-9"/><path d="M21 19h-5"/><path d="M21 5h-7"/><path d="M8 10v4"/><path d="M8 12H3"/></svg> Filters
        </button>

        <button class="btn btn-primary pipeline-add-btn" id="add-opportunity-btn">
          <i data-lucide="plus" class="u-icon-16"></i> New Opportunity
        </button>
      </div>

      <div class="crm-filter-panel" id="pipeline-advanced-controls">
        <div class="crm-filter-bar" style="padding-top: 0;">
          ${renderFilterDropdown('pipeline-quick-filter', quickFilterOptions, 'all')}

          <span class="crm-filter-divider"></span>

          <div class="crm-date-range">
            <span class="crm-date-range-label">Next Step:</span>
            <input type="date" class="crm-date-input" id="pipeline-filter-date-from" placeholder="From">
            <span class="crm-date-range-label">to</span>
            <input type="date" class="crm-date-input" id="pipeline-filter-date-to" placeholder="To">
            <button class="crm-filter-clear" id="pipeline-date-clear" style="display:none; padding:4px 8px; font-size:0.75rem;">✕ Clear dates</button>
          </div>

          ${state.isManager ? `
            <span class="crm-filter-divider"></span>
            ${renderFilterDropdown('pipeline-owner-filter', [{ value: 'all', label: 'All Owners' }, ...ownerOptions], 'all')}
          ` : ''}

          <span class="crm-filter-divider"></span>
          ${renderFilterDropdown('pipeline-sort', sortOptions, DEFAULT_SORT)}

          ${hasClosedStages ? `
            <span class="crm-filter-divider"></span>
            ${renderFilterDropdown('pipeline-closed-range', [
              { value: 'recent', label: `Closed: Last ${CLOSED_RECENT_DAYS} Days` },
              { value: 'all', label: 'Closed: All Time' },
            ], closedRange)}
          ` : ''}

          <button class="crm-filter-clear" id="pipeline-reset-controls" style="display:none;">✕ Clear</button>
        </div>
      </div>
    </div>

    <div class="pipeline-stages">
  `;

  pipelineStages.forEach(stage => {
    const stageOpps = opportunitiesByStage[stage.id];
    const rendered = stageOpps.slice(0, OPPORTUNITY_STAGE_PAGE_SIZE);
    const deferred = stageOpps.slice(OPPORTUNITY_STAGE_PAGE_SIZE)
      .map(opp => ({ id: opp.id, html: renderOpportunityCard(opp, companyLookup) }));
    board.pagination[stage.id] = { pageSize: OPPORTUNITY_STAGE_PAGE_SIZE, rendered: rendered.length, deferred };

    const olderHidden = olderClosedByStage[stage.id] || 0;
    const stageColor = escapeHtml(stage.color || '#94a3b8');

    html += `
      <div class="pipeline-stage" data-stage="${escapeHtml(stage.id)}" style="--stage-color: ${stageColor};">
        <div class="pipeline-stage-header">
          <div class="pipeline-stage-title"><span class="pipeline-stage-dot" style="background:${stageColor}"></span>${escapeHtml(plainStageTitle(stage.title))}</div>
          <div class="pipeline-stage-count">${stageOpps.length}</div>
        </div>
        <div class="pipeline-stage-value">
          <span class="pipeline-stage-total"></span>
          <span class="pipeline-stage-weighted"></span>
        </div>
        ${getStageOutcome(stage.id) && closedRange === 'recent' ? `
          <div class="pipeline-stage-note">Last ${CLOSED_RECENT_DAYS} days${olderHidden ? ` · ${olderHidden} older hidden` : ''}</div>
        ` : ''}
        <button class="pipeline-inline-add" data-stage="${escapeHtml(stage.id)}">+ New</button>
        <div class="opportunity-list" id="opportunities-${escapeHtml(stage.id)}">
          ${rendered.map(opp => renderOpportunityCard(opp, companyLookup)).join('')}
        </div>
        ${deferred.length > 0 ? renderLoadMoreButton(stage.id, deferred.length) : ''}
      </div>
    `;
  });

  html += `</div>`;

  viewContainer.innerHTML = html;
  updatePipelineStageCounts();
  if (savedView) restoreBoardView(savedView);

  if (window.lucide) {
    lucide.createIcons();
  }

  // Give the custom dropdowns a tick to initialise before restoring saved filters
  setTimeout(() => {
    initPipelineDragAndDrop();
    initOpportunityEventListeners();
    initPipelineFilters();
  }, 100);
}

// ── Load more / view preservation ─────────────────────────────────────────────

function getStageElement(stageId) {
  return document.querySelector(`.pipeline-stage[data-stage="${CSS.escape(String(stageId))}"]`);
}

/** Render the next page of a column's deals (or a given number, or all of them) */
function loadStageCards(stageId, { all = false, count } = {}) {
  const stageState = board?.pagination[stageId];
  if (!stageState || stageState.deferred.length === 0) return;

  const stageEl = getStageElement(stageId);
  const listEl = stageEl?.querySelector('.opportunity-list');
  if (!listEl) return;

  const takeCount = all
    ? stageState.deferred.length
    : Math.min(count ?? stageState.pageSize, stageState.deferred.length);
  const batch = stageState.deferred.splice(0, takeCount);
  listEl.insertAdjacentHTML('beforeend', batch.map(d => d.html).join(''));
  stageState.rendered += takeCount;

  const buttonEl = stageEl.querySelector('.pipeline-load-more');
  if (stageState.deferred.length === 0) {
    buttonEl?.closest('.pipeline-load-more-wrap')?.remove();
  } else if (buttonEl) {
    buttonEl.querySelector('.pipeline-load-more-count').textContent = String(Math.min(stageState.pageSize, stageState.deferred.length));
    buttonEl.querySelector('.pipeline-load-more-remaining').textContent = String(stageState.deferred.length);
  }
}

function expandAllStages() {
  Object.keys(board?.pagination || {}).forEach(stageId => loadStageCards(stageId, { all: true }));
}

function getScrollRoot() {
  return document.scrollingElement || document.documentElement;
}

function captureBoardView() {
  const boardEl = document.querySelector('.pipeline-stages');
  if (!boardEl || !board) return null;
  const stages = {};
  boardEl.querySelectorAll('.pipeline-stage').forEach(stageEl => {
    const stageId = stageEl.dataset.stage;
    stages[stageId] = {
      rendered: board.pagination[stageId]?.rendered || 0,
      scrollTop: stageEl.querySelector('.opportunity-list')?.scrollTop || 0,
    };
  });
  return {
    pipelineId: state.activePipelineId,
    stages,
    boardScrollLeft: boardEl.scrollLeft,
    containerScrollTop: viewContainer.scrollTop,
    pageScrollTop: getScrollRoot().scrollTop,
  };
}

function restoreBoardView(saved) {
  if (!saved || saved.pipelineId !== state.activePipelineId) return;
  Object.entries(saved.stages).forEach(([stageId, { rendered, scrollTop }]) => {
    const stageState = board?.pagination[stageId];
    if (stageState && rendered > stageState.rendered) {
      loadStageCards(stageId, { count: rendered - stageState.rendered });
    }
    const listEl = getStageElement(stageId)?.querySelector('.opportunity-list');
    if (listEl) listEl.scrollTop = scrollTop;
  });
  const boardEl = document.querySelector('.pipeline-stages');
  if (boardEl) boardEl.scrollLeft = saved.boardScrollLeft;
  viewContainer.scrollTop = saved.containerScrollTop;
  getScrollRoot().scrollTop = saved.pageScrollTop;
  updatePipelineStageCounts();
}

/** Re-render the board after a change, but only if the user is looking at it */
function refreshPipelineIfVisible() {
  if (state.currentView !== 'opportunity-pipeline') return;
  renderOpportunityPipelineView({ preserveView: true });
}

// ── Board events ──────────────────────────────────────────────────────────────

function initOpportunityEventListeners() {
  // Pipeline tab switcher
  document.getElementById('pipeline-tabs')?.addEventListener('click', (e) => {
    const pipelineId = e.target.closest('.pipeline-tab[data-pipeline-id]')?.dataset.pipelineId;
    if (pipelineId && pipelineId !== state.activePipelineId) {
      setActivePipeline(pipelineId);
      renderOpportunityPipelineView();
    }
  });

  // Manage Pipelines button (managers only)
  document.getElementById('manage-pipelines-btn')?.addEventListener('click', () => {
    openManagePipelinesModal();
  });

  document.getElementById('add-opportunity-btn')?.addEventListener('click', () => {
    openOpportunityModal();
  });

  // One delegated handler for everything inside the columns, so cards added
  // by "Load more" need no extra wiring.
  document.querySelector('.pipeline-stages')?.addEventListener('click', (e) => {
    const loadMoreBtn = e.target.closest('.pipeline-load-more');
    if (loadMoreBtn) {
      loadStageCards(loadMoreBtn.dataset.stageId);
      return;
    }

    const inlineAddBtn = e.target.closest('.pipeline-inline-add');
    if (inlineAddBtn) {
      openOpportunityModal(null, { stageId: inlineAddBtn.dataset.stage });
      return;
    }

    const card = e.target.closest('.opportunity-card');
    const opportunity = card && board?.opportunitiesById.get(card.dataset.id);
    if (opportunity) openOpportunityViewModal(opportunity);
  });
}


function initPipelineDragAndDrop() {
  if (typeof Sortable === 'undefined') {
    console.error('Sortable.js library is not loaded!');
    showToast('Drag-and-drop functionality requires Sortable.js library', 'error');
    return;
  }

  document.querySelectorAll('.opportunity-list').forEach(list => {
    new Sortable(list, {
      group: 'pipeline',
      animation: 200,
      easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
      swapThreshold: 0.5,
      fallbackOnBody: true,
      invertSwap: false,
      emptyInsertThreshold: 10,
      delay: 0,
      delayOnTouchOnly: false,
      touchStartThreshold: 3,
      draggable: '.opportunity-card:not(.readonly)',
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      onStart: function (evt) {
        document.body.classList.add('is-dragging');
        evt.item.classList.add('dragging');
      },
      onEnd: function (evt) {
        document.body.classList.remove('is-dragging');
        evt.item.classList.remove('dragging');
        // If moved to a different tab/stage, ensure it stays at the top
        if (evt.to && evt.from && evt.to !== evt.from && evt.item) {
          evt.item.style.transform = '';
          evt.to.prepend(evt.item);
        }
      },
      onAdd: async function (evt) {
        const card = evt.item;
        const opportunityId = card.dataset.id;
        const opportunity = board?.opportunitiesById.get(opportunityId);
        const newStage = evt.to.closest('.pipeline-stage').dataset.stage;
        const oldStage = evt.from.closest('.pipeline-stage').dataset.stage;

        // Ensure moved card goes directly to the top of the destination column
        card.style.transform = '';
        evt.to.prepend(card);
        requestAnimationFrame(() => {
          if (evt.to.firstElementChild !== card) evt.to.prepend(card);
        });

        if (newStage === oldStage) return;

        // Closing a deal settles its win chance
        const outcome = getStageOutcome(newStage);
        const now = new Date().toISOString();
        const updates = { stage: newStage, updated_at: now };
        if (outcome === 'won') updates.probability = 100;
        if (outcome === 'lost') updates.probability = 0;

        updatePipelineStageCounts();

        try {
          const { error } = await supabaseClient
            .from('opportunities')
            .update(updates)
            .eq('id', opportunityId);
          if (error) throw error;

          if (opportunity) {
            // stage_changed_at is set by the database trigger; mirror it locally
            Object.assign(opportunity, updates, { mappedStage: newStage, stage_changed_at: now });
            card.dataset.probability = String(dealProbability(opportunity));
            const probEl = card.querySelector('.opp-prob-label');
            if (probEl) {
              // Win chance means nothing once a deal is closed
              probEl.hidden = Boolean(outcome);
              probEl.textContent = `${dealProbability(opportunity)}%`;
            }
          }
          card.dataset.updatedTs = String(Date.now());
          card.classList.remove('is-stale');
          const stageAgeEl = card.querySelector('.opp-stage-age');
          if (stageAgeEl) {
            stageAgeEl.textContent = '0d';
            stageAgeEl.title = '0 days in this stage';
          }

          showInlineSuccess(card);
          if (outcome === 'won') {
            triggerConfetti();
            showToast('Deal won', 'success');
          } else {
            showToast('Opportunity moved', 'success', { subtle: true, duration: 1400, dedupeMs: 1200 });
          }
        } catch (error) {
          showToast('Error updating opportunity: ' + error.message, 'error');
          // Put the card back where it was
          evt.from.insertBefore(card, evt.from.children[evt.oldIndex] || null);
        }
        updatePipelineStageCounts();
      }
    });
  });
}

/** Deals in a column that are currently shown, plus any still behind "Load more" */
function getStageDeals(stageEl) {
  const stageId = stageEl.dataset.stage;
  const ids = Array.from(stageEl.querySelectorAll('.opportunity-card:not(.is-filtered-out)'), card => card.dataset.id);
  (board?.pagination[stageId]?.deferred || []).forEach(d => ids.push(d.id));
  return ids.map(id => board?.opportunitiesById.get(id)).filter(Boolean);
}

function updatePipelineStageCounts() {
  document.querySelectorAll('.pipeline-stage').forEach(stageEl => {
    const deals = getStageDeals(stageEl);
    const isOpenStage = !getStageOutcome(stageEl.dataset.stage);
    let total = 0;
    let weighted = 0;
    deals.forEach(opp => {
      total += dealValue(opp);
      weighted += dealValue(opp) * dealProbability(opp) / 100;
    });

    const countEl = stageEl.querySelector('.pipeline-stage-count');
    if (countEl) countEl.textContent = String(deals.length);
    const totalEl = stageEl.querySelector('.pipeline-stage-total');
    if (totalEl) totalEl.textContent = formatMoney(total);
    const weightedEl = stageEl.querySelector('.pipeline-stage-weighted');
    if (weightedEl) weightedEl.textContent = isOpenStage && deals.length > 0 ? `${formatMoney(weighted)} weighted` : '';
    stageEl.classList.toggle('is-empty', deals.length === 0);
  });
}

function initPipelineFilters() {
  const quickFilterSelect = document.getElementById('pipeline-quick-filter');
  const searchInput = document.getElementById('pipeline-search');
  const ownerSelect = document.getElementById('pipeline-owner-filter');
  const sortSelect = document.getElementById('pipeline-sort');
  const closedRangeSelect = document.getElementById('pipeline-closed-range');
  const advancedToggle = document.getElementById('pipeline-advanced-toggle');
  const advancedControls = document.getElementById('pipeline-advanced-controls');
  const resetBtn = document.getElementById('pipeline-reset-controls');
  const dateFromInput = document.getElementById('pipeline-filter-date-from');
  const dateToInput = document.getElementById('pipeline-filter-date-to');
  const dateClearBtn = document.getElementById('pipeline-date-clear');

  // Load persisted state
  const persistedState = _loadPersistedState().pipeline || {};
  const setDropdown = (id, el, value) => {
    if (!el || !value) return;
    window.setCrmDropdownValue?.(id, value);
    el.value = value;
  };
  if (searchInput && persistedState.search) searchInput.value = persistedState.search;
  setDropdown('pipeline-quick-filter', quickFilterSelect, persistedState.quickFilter);
  setDropdown('pipeline-owner-filter', ownerSelect, persistedState.owner);
  setDropdown('pipeline-sort', sortSelect, persistedState.sort);
  if (persistedState.advancedOpen && advancedToggle && advancedControls) {
    advancedControls.classList.add('open');
    advancedToggle.classList.add('is-active');
    advancedToggle.setAttribute('aria-expanded', 'true');
  }

  if (window.initCustomCalendar) {
    window.initCustomCalendar('#pipeline-filter-date-from', { type: 'date' });
    window.initCustomCalendar('#pipeline-filter-date-to', { type: 'date' });
  }

  const compareBySort = (a, b, sort) => {
    const aValue = Number(a.dataset.value || 0);
    const bValue = Number(b.dataset.value || 0);
    const aProb = Number(a.dataset.probability || 0);
    const bProb = Number(b.dataset.probability || 0);
    const aCreated = Number(a.dataset.createdTs || 0);
    const bCreated = Number(b.dataset.createdTs || 0);
    const aNext = Number(a.dataset.nextStepTs || Number.MAX_SAFE_INTEGER);
    const bNext = Number(b.dataset.nextStepTs || Number.MAX_SAFE_INTEGER);

    if (sort === 'newest') return bCreated - aCreated;
    if (sort === 'oldest') return aCreated - bCreated;
    if (sort === 'value-desc') return bValue - aValue;
    if (sort === 'value-asc') return aValue - bValue;
    if (sort === 'probability-desc') return bProb - aProb;
    if (sort === 'next-step') return aNext - bNext;
    const aActivity = Number(a.dataset.updatedTs || aCreated);
    const bActivity = Number(b.dataset.updatedTs || bCreated);
    return bActivity - aActivity;
  };

  const getControls = () => ({
    quickFilter: quickFilterSelect?.value || 'all',
    search: searchInput?.value || '',
    owner: ownerSelect?.value || 'all',
    sort: sortSelect?.value || DEFAULT_SORT,
    advancedOpen: advancedToggle?.classList.contains('is-active') || false,
    closedRange: closedRangeSelect?.value || persistedState.closedRange || 'recent',
  });

  const matchesFilters = (opp, controls, tokens, dateFrom, dateTo) => {
    if (controls.quickFilter === 'my-reps' && opp.profiles?.role !== 'sales_rep') return false;
    if (controls.quickFilter === 'high-value' && dealValue(opp) < board.highValueThreshold) return false;
    if (controls.quickFilter === 'high-probability' && dealProbability(opp) < 70) return false;
    if (controls.quickFilter === 'next-step-due' && !getDueStatus(opp.next_step_date)) return false;

    if (controls.owner !== 'all' && (opp.user_id || NO_OWNER) !== controls.owner) return false;

    if (dateFrom || dateTo) {
      const nextDate = toLocalDay(opp.next_step_date);
      if (!nextDate) return false;
      if (dateFrom && nextDate < dateFrom) return false;
      if (dateTo && nextDate > dateTo) return false;
    }

    if (tokens.length > 0) {
      const text = board.searchText.get(opp.id) || '';
      if (!tokens.every(token => text.includes(token))) return false;
    }
    return true;
  };

  const applyPipelineControls = () => {
    const controls = getControls();
    const tokens = controls.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const dateFrom = toLocalDay(dateFromInput?.value);
    const dateTo = toLocalDay(dateToInput?.value);

    saveViewState({ pipeline: controls });

    const hasFilters = controls.quickFilter !== 'all' || controls.owner !== 'all' || controls.sort !== DEFAULT_SORT
      || dateFrom || dateTo || tokens.length > 0;

    // Filtering and sorting work on every deal, not just the first page of each column
    if (hasFilters) expandAllStages();

    if (resetBtn) resetBtn.style.display = hasFilters ? 'inline-flex' : 'none';
    if (dateClearBtn) dateClearBtn.style.display = (dateFrom || dateTo) ? 'inline-flex' : 'none';

    document.querySelectorAll('.opportunity-card').forEach(card => {
      const opp = board?.opportunitiesById.get(card.dataset.id);
      const show = !opp || matchesFilters(opp, controls, tokens, dateFrom, dateTo);
      card.classList.toggle('is-filtered-out', !show);
    });

    document.querySelectorAll('.opportunity-list').forEach(list => {
      const visibleCards = Array.from(list.querySelectorAll('.opportunity-card:not(.is-filtered-out)'));
      visibleCards.sort((a, b) => compareBySort(a, b, controls.sort));
      visibleCards.forEach(card => list.appendChild(card));
    });

    updatePipelineStageCounts();
  };

  advancedToggle?.addEventListener('click', () => {
    const isOpen = advancedControls?.classList.toggle('open');
    advancedToggle.classList.toggle('is-active', isOpen);
    advancedToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    applyPipelineControls();
  });

  const clearDates = () => {
    if (dateFromInput) dateFromInput.value = '';
    if (dateToInput) dateToInput.value = '';
  };

  resetBtn?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    setDropdown('pipeline-quick-filter', quickFilterSelect, 'all');
    setDropdown('pipeline-owner-filter', ownerSelect, 'all');
    setDropdown('pipeline-sort', sortSelect, DEFAULT_SORT);
    clearDates();
    applyPipelineControls();
  });

  dateClearBtn?.addEventListener('click', () => {
    clearDates();
    applyPipelineControls();
  });

  // The closed range decides which deals are loaded into the columns, so it re-renders
  closedRangeSelect?.addEventListener('change', () => {
    saveViewState({ pipeline: getControls() });
    renderOpportunityPipelineView();
  });

  quickFilterSelect?.addEventListener('change', applyPipelineControls);
  searchInput?.addEventListener('input', applyPipelineControls);
  ownerSelect?.addEventListener('change', applyPipelineControls);
  sortSelect?.addEventListener('change', applyPipelineControls);
  dateFromInput?.addEventListener('change', applyPipelineControls);
  dateToInput?.addEventListener('change', applyPipelineControls);

  applyPipelineControls();
}


/** Fetch current assignees for a single opportunity from the DB (two-step, no broken join) */
async function fetchOpportunityAssignees(opportunityId) {
  const { data: rows } = await supabaseClient
    .from('opportunity_assignees')
    .select('user_id')
    .eq('opportunity_id', opportunityId);
  if (!rows || rows.length === 0) return [];

  const userIds = rows.map(r => r.user_id);
  const { data: profileRows } = await supabaseClient
    .from('profiles')
    .select('id, first_name, last_name, role, avatar_url')
    .in('id', userIds);
  const profilesById = {};
  (profileRows || []).forEach(p => { profilesById[p.id] = p; });

  return rows.map(r => ({
    user_id: r.user_id,
    first_name: profilesById[r.user_id]?.first_name || '',
    last_name: profilesById[r.user_id]?.last_name || '',
    role: profilesById[r.user_id]?.role || 'sales_rep',
    avatar_url: profilesById[r.user_id]?.avatar_url || null,
  }));
}

/**
 * Open the create/edit form. options.stageId preselects a column for a new deal.
 * (Some callers pass a boolean second argument; it is ignored.)
 */
async function openOpportunityModal(opportunity = null, options = {}) {
  const modal = document.getElementById('opportunity-modal');
  const modalTitle = document.getElementById('opportunity-modal-title');
  const saveBtn = document.getElementById('save-opportunity-btn');

  // Drop the previous form session's listeners before the reset below fires change events
  opportunityModalListeners?.abort();
  opportunityModalListeners = null;

  // Resolve active pipeline and update stage dropdown before reset
  const activePipeline = getCachedActivePipeline();
  const pipelineStages = getPipelineStages(activePipeline);
  const firstStageId = pipelineStages[0]?.id || 'prospecting';

  // Reset form
  document.getElementById('opportunity-name').value = '';
  document.getElementById('opportunity-company').value = '';
  document.getElementById('opportunity-subsector').value = '';
  document.getElementById('opportunity-value').value = '';
  document.getElementById('opportunity-probability').value = 50;
  document.getElementById('probability-display').textContent = '50';

  // Rebuild stage dropdown for this pipeline's stages
  updateStageDropdownForPipeline(activePipeline, firstStageId);
  document.getElementById('opportunity-next-step').value = '';
  document.getElementById('opportunity-next-step-date').value = '';

  const notesTextarea = document.getElementById('opportunity-notes');
  if (notesTextarea) {
    notesTextarea.value = '';
    notesTextarea.style.display = '';
  }
  const existingNotesDisplay = document.getElementById('opportunity-notes-display');
  if (existingNotesDisplay) {
    try { existingNotesDisplay.remove(); } catch (e) { /* ignore */ }
  }

  // Clear competitors
  document.getElementById('competitors-container').innerHTML = '<input type="text" class="competitors-input" id="competitors-input" placeholder="Add competitor...">';

  // Reset mentioned people
  state.mentionedPeople = opportunity && opportunity.mentioned_people ? [...opportunity.mentioned_people] : [];

  // Fetch fresh assignees from DB (or empty for new opportunity)
  // Always fetches from DB to avoid stale/missing data on edit.
  state.opportunityAssignees = opportunity
    ? await fetchOpportunityAssignees(opportunity.id)
    : [];

  // Reset assignees picker UI
  const chipsEl = document.getElementById('opp-assignees-chips');
  if (chipsEl) {
    chipsEl.innerHTML = '';
    // When editing: show the owner as a non-removable chip first so the full
    // team is always visible. Owner is NOT stored in state.opportunityAssignees
    // (they're tracked via opportunity.user_id), so saving never overwrites them.
    if (opportunity && opportunity.profiles && opportunity.user_id) {
      _prependOwnerChip(opportunity.user_id, opportunity.profiles);
    }
    // Append tagged assignees (owner excluded from this list)
    state.opportunityAssignees
      .filter(a => !opportunity || a.user_id !== opportunity.user_id)
      .forEach(m => _appendAssigneeChip(m));
  }
  const ddEl = document.getElementById('opp-assignees-dropdown');
  if (ddEl) ddEl.style.display = 'none';
  const inputEl = document.getElementById('opp-assignees-input');
  if (inputEl) inputEl.value = '';

  // Set modal title
  if (opportunity) {
    modalTitle.innerHTML = `Edit Opportunity`;

    // Fill form with opportunity data
    document.getElementById('opportunity-name').value = opportunity.name || '';
    document.getElementById('opportunity-company').value = opportunity.company_name || '';
    const matchedCompany = findCompanyForOpportunityFast(opportunity, buildCompanyLookup(window.allCompaniesData));
    window.selectedOpportunityCompanyData = matchedCompany || null;
    document.getElementById('opportunity-subsector').value = opportunity.subsector || matchedCompany?.subsector || '';
    document.getElementById('opportunity-value').value = opportunity.value || '';
    // 0% is a real value (lost deals), so only default when nothing is stored
    const probability = opportunity.probability == null || opportunity.probability === '' ? 50 : dealProbability(opportunity);
    document.getElementById('opportunity-probability').value = probability;
    document.getElementById('probability-display').textContent = String(probability);

    updateStageDropdownForPipeline(activePipeline, resolveStageId(opportunity.stage, pipelineStages, activePipeline.is_default));

    document.getElementById('opportunity-next-step').value = opportunity.next_step || '';
    document.getElementById('opportunity-next-step-date').value = opportunity.next_step_date || '';
    document.getElementById('opportunity-notes').value = opportunity.notes || '';

    parseCompetitors(opportunity.competitors).forEach(comp => addCompetitor(comp));
  } else {
    modalTitle.innerHTML = 'New Opportunity';
    window.selectedOpportunityCompanyData = null;

    // "+ New" in a column starts the deal in that column
    if (options?.stageId && pipelineStages.some(s => s.id === options.stageId)) {
      updateStageDropdownForPipeline(activePipeline, options.stageId);
      const outcomeProbability = { won: 100, lost: 0 }[getStageOutcome(options.stageId)];
      if (outcomeProbability !== undefined) {
        document.getElementById('opportunity-probability').value = outcomeProbability;
        document.getElementById('probability-display').textContent = String(outcomeProbability);
      }
    }
  }

  document.querySelectorAll('#opportunity-modal input, #opportunity-modal select, #opportunity-modal textarea').forEach(el => {
    el.disabled = false;
  });
  saveBtn.style.display = 'block';

  // Show modal
  modal.style.display = 'flex';
  document.body.classList.add('modal-active');

  // Initialize event listeners
  initOpportunityModalListeners(opportunity);
}

function openOpportunityViewModal(opportunity) {
  const modal = document.getElementById('opportunity-view-modal');
  if (!modal) return;

  const companyObj = findCompanyForOpportunity(opportunity);
  const isCrmCompany = Boolean(companyObj && companyObj.id);

  // Hero info
  const titleEl = document.getElementById('opportunity-view-title');
  const stageEl = document.getElementById('opportunity-view-stage-badge');
  const companyNameEl = document.getElementById('opportunity-view-company-name');
  const companyLinkEl = document.getElementById('opportunity-view-company-link');
  const metaChipsEl = document.getElementById('opportunity-view-meta-chips');
  const avatarEl = document.getElementById('opportunity-view-avatar');

  if (titleEl) titleEl.textContent = opportunity.name || 'Untitled Opportunity';

  // Stage badge
  if (stageEl) {
    const viewPipeline = getCachedActivePipeline();
    const pipelineStages = getPipelineStages(viewPipeline);
    const stageId = opportunity.mappedStage || resolveStageId(opportunity.stage, pipelineStages, viewPipeline.is_default);
    const stageInfo = pipelineStages.find(s => s.id === stageId) || pipelineStages[0];
    stageEl.textContent = plainStageTitle(stageInfo.title);
    stageEl.style.background = `color-mix(in srgb, ${stageInfo.color} 12%, transparent)`;
    stageEl.style.color = stageInfo.color;
    stageEl.style.borderColor = `color-mix(in srgb, ${stageInfo.color} 25%, transparent)`;
  }

  const companyName = opportunity.company_name || (isCrmCompany ? companyObj.name : 'No Company');
  if (companyNameEl) {
    if (!isCrmCompany && opportunity.company_name) {
      companyNameEl.innerHTML = `${escapeHtml(companyName)} <span style="font-size:0.72rem; color:var(--text-muted); font-weight:500; opacity:0.85;">(Custom)</span>`;
    } else {
      companyNameEl.textContent = companyName;
    }
  }

  if (companyLinkEl) {
    if (isCrmCompany) {
      companyLinkEl.style.pointerEvents = 'auto';
      companyLinkEl.style.cursor = 'pointer';
      companyLinkEl.style.opacity = '1';
      companyLinkEl.style.color = 'var(--color-primary)';
      companyLinkEl.style.background = 'color-mix(in srgb, var(--color-primary) 8%, transparent)';
      companyLinkEl.style.borderColor = 'color-mix(in srgb, var(--color-primary) 20%, transparent)';
      companyLinkEl.setAttribute('title', `View company: ${companyName}`);
      companyLinkEl.onclick = (e) => {
        e.preventDefault();
        closeModal('opportunity-view-modal');
        setTimeout(() => openCompanyViewModal(companyObj.id), 120);
      };
    } else {
      companyLinkEl.style.pointerEvents = 'none';
      companyLinkEl.style.cursor = 'default';
      companyLinkEl.style.opacity = '0.85';
      companyLinkEl.style.color = 'var(--text-secondary)';
      companyLinkEl.style.background = 'var(--bg-tertiary, rgba(255, 255, 255, 0.05))';
      companyLinkEl.style.borderColor = 'var(--border-color, rgba(255, 255, 255, 0.1))';
      companyLinkEl.setAttribute('title', opportunity.company_name ? `${opportunity.company_name} (Custom company, not in CRM)` : 'No company');
      companyLinkEl.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
      };
    }
  }

  const viewSubsector = (opportunity.subsector || (isCrmCompany ? companyObj?.subsector : '') || '').trim();
  if (metaChipsEl) {
    metaChipsEl.innerHTML = viewSubsector ? `<span class="record-hero-cat-chip">${escapeHtml(viewSubsector)}</span>` : '';
  }

  // Avatar (Company initials or Logo)
  if (avatarEl) {
    const initials = getInitials(companyName || 'O');
    avatarEl.textContent = initials;
    avatarEl.className = 'record-hero-avatar';
    const resolvedLogoUrl = isCrmCompany ? ((companyObj && companyObj.logo_url) || (companyObj && companyObj.domain ? getCompanyLogoUrl(companyObj.domain) : '')) : '';
    avatarEl.innerHTML = `<span style="position:relative;z-index:1">${initials}</span>${resolvedLogoUrl ? `<img src="${resolvedLogoUrl}" alt="${escapeHtml(companyName)}" onload="this.style.display='block';var p=this.previousElementSibling;if(p)p.style.display='none'" onerror="this.style.display='none'" />` : ''}`;
    if (!resolvedLogoUrl) {
      avatarEl.style.background = 'linear-gradient(135deg, var(--color-primary), var(--color-primary-light))';
    }
  }

  // Stats Bar (Deal Value, Win Probability, Expected Value, Pipeline Age)
  const valueEl = document.getElementById('opportunity-view-value');
  const probEl = document.getElementById('opportunity-view-probability');
  const weightedEl = document.getElementById('opportunity-view-weighted');
  const stageAgeEl = document.getElementById('opportunity-view-stage-age');

  const valNum = parseFloat(opportunity.value || 0);
  const probNum = parseFloat(opportunity.probability || 0);
  const weightedNum = Math.round(valNum * (probNum / 100));

  if (valueEl) valueEl.textContent = `${getCurrencySymbol()} ${valNum.toLocaleString()}`;
  if (probEl) probEl.innerHTML = `<span style="color:${getProbabilityColor(probNum)}; font-weight:800;">${probNum}%</span>`;
  if (weightedEl) weightedEl.textContent = `${getCurrencySymbol()} ${weightedNum.toLocaleString()}`;
  if (stageAgeEl) {
    const created = opportunity.created_at ? new Date(opportunity.created_at) : null;
    if (created && !isNaN(created.getTime())) {
      const days = Math.max(0, Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24)));
      stageAgeEl.textContent = days === 0 ? 'Today' : `${days}d in pipeline`;
    } else {
      stageAgeEl.textContent = '—';
    }
  }

  // Next Step Action Item
  const nextStepEl = document.getElementById('opportunity-view-next-step');
  const dueDateEl = document.getElementById('opportunity-view-next-step-date');
  if (nextStepEl) nextStepEl.textContent = opportunity.next_step || 'No next step scheduled';
  if (dueDateEl) dueDateEl.textContent = formatDueDate(opportunity.next_step_date) || 'No due date';

  // Notes & Mentions
  const notesEl = document.getElementById('opportunity-view-notes');
  if (notesEl) {
    let notesHtml = escapeHtml(opportunity.notes || '');
    if (opportunity.mentioned_people && Array.isArray(opportunity.mentioned_people)) {
      opportunity.mentioned_people.forEach(person => {
        if (!person || !person.name) return;
        // The notes are already escaped, so match the escaped form of the name
        const safeName = escapeHtml(person.name.trim());
        const pattern = new RegExp(`@${escapeRegExp(safeName)}\\b`, 'gi');
        notesHtml = notesHtml.replace(pattern, `<span class="mentioned-person" data-person-id="${escapeHtml(person.id)}">@${safeName}</span>`);
      });
    } else {
      notesHtml = notesHtml.replace(/@([A-Za-z0-9_\-]+)\b/g, '<span class="mentioned-person" data-person-name="$1">@$1</span>');
    }
    notesEl.innerHTML = notesHtml || '<div class="text-muted" style="font-size:0.85rem; opacity:0.6;">No internal notes added to this deal.</div>';

    notesEl.querySelectorAll('.mentioned-person').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const pid = el.dataset.personId;
        const pname = el.dataset.personName || el.textContent.replace(/^@/, '').trim();
        closeModal('opportunity-view-modal');
        if (pid) return setTimeout(() => openPersonViewModal(pid), 120);
        const p = (window.allPeopleData || state.allPeople || []).find(p => String(p.name).trim().toLowerCase() === String(pname).toLowerCase());
        if (p) setTimeout(() => openPersonViewModal(p), 120);
      });
    });
  }

  // Activity Tab (Call logs & Visits)
  const activityPanel = document.getElementById('opp-panel-activity');
  const activityCountEl = document.getElementById('opp-tab-activity-count');
  const relatedCalls = Array.isArray(window.allCallLogsData)
    ? window.allCallLogsData.filter(c => 
        (isCrmCompany && String(c.company_id) === String(companyObj.id)) ||
        (!isCrmCompany && opportunity.company_name && c.company_name && c.company_name.trim().toLowerCase() === opportunity.company_name.trim().toLowerCase())
      )
    : [];

  if (activityCountEl) activityCountEl.textContent = String(relatedCalls.length);
  if (activityPanel) {
    if (relatedCalls.length === 0) {
      activityPanel.innerHTML = '<div class="text-muted" style="text-align:center; padding:32px 16px; font-size:0.88rem;">No call logs or recorded activity for this company yet.</div>';
    } else {
      activityPanel.innerHTML = relatedCalls.map(c => `
        <div class="record-opp-card" style="cursor:pointer;" onclick="closeModal('opportunity-view-modal'); setTimeout(() => openCallLogViewModal(${JSON.stringify(c).replace(/"/g, '&quot;')}), 120)">
          <div class="record-opp-card-stage" style="background:${c.direction === 'Inbound' ? '#10b981' : '#3b82f6'};"></div>
          <div class="record-opp-card-body">
            <div class="record-opp-card-name">${escapeHtml(c.contact_name || c.people?.name || 'Call Log')} · <span style="font-weight:500; font-size:0.8rem; color:var(--text-muted);">${formatDateWithTime(c.call_at)}</span></div>
            <div class="record-opp-card-meta">
              <span class="stage-pill">${escapeHtml(c.outcome || 'Logged')}</span>
              <span>${c.duration_seconds ? Math.round(c.duration_seconds / 60) + ' min' : '—'}</span>
              <span>${escapeHtml(c.profiles ? c.profiles.first_name + ' ' + c.profiles.last_name : '')}</span>
            </div>
            ${c.notes ? `<div style="font-size:0.82rem; color:var(--text-secondary); margin-top:4px;">${escapeHtml(c.notes.slice(0, 100))}${c.notes.length > 100 ? '…' : ''}</div>` : ''}
          </div>
          <button class="btn btn-sm btn-ghost" style="flex-shrink:0;">View</button>
        </div>
      `).join('');
    }
  }

  // Tasks Tab
  const tasksPanel = document.getElementById('opp-panel-tasks');
  const tasksCountEl = document.getElementById('opp-tab-tasks-count');
  const relatedTasks = Array.isArray(window.allTasksData)
    ? window.allTasksData.filter(t => 
        (t.opportunity_id && String(t.opportunity_id) === String(opportunity.id)) ||
        (isCrmCompany && t.company_id && String(t.company_id) === String(companyObj.id))
      )
    : [];

  if (tasksCountEl) tasksCountEl.textContent = String(relatedTasks.length);
  if (tasksPanel) {
    if (relatedTasks.length === 0) {
      tasksPanel.innerHTML = '<div class="text-muted" style="text-align:center; padding:32px 16px; font-size:0.88rem;">No tasks scheduled for this opportunity.</div>';
    } else {
      tasksPanel.innerHTML = relatedTasks.map(t => `
        <div class="record-opp-card" style="cursor:pointer;" onclick="closeModal('opportunity-view-modal'); setTimeout(() => { const sReps = window.salesRepsData || []; showTaskDetail(${JSON.stringify(t).replace(/"/g, '&quot;')}, sReps); }, 120)">
          <div class="record-opp-card-stage" style="background:${t.status === 'completed' ? '#10b981' : t.priority === 'high' ? '#ef4444' : '#f59e0b'};"></div>
          <div class="record-opp-card-body">
            <div class="record-opp-card-name" style="${t.status === 'completed' ? 'text-decoration:line-through; opacity:0.7;' : ''}">${escapeHtml(t.title)}</div>
            <div class="record-opp-card-meta">
              <span class="stage-pill">${escapeHtml(t.status || 'pending')}</span>
              ${t.due_date ? `<span>Due: ${formatDate(t.due_date)}</span>` : '<span>No due date</span>'}
              <span style="text-transform:capitalize;">${escapeHtml(t.priority || 'medium')} priority</span>
            </div>
          </div>
          <button class="btn btn-sm btn-ghost" style="flex-shrink:0;">View</button>
        </div>
      `).join('');
    }
  }

  // Wire Tab switching
  const tabs = modal.querySelectorAll('.opp-view-tab');
  tabs.forEach(tab => {
    tab.onclick = () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const tabKey = tab.dataset.tab;
      const pOverview = document.getElementById('opp-panel-overview');
      const pActivity = document.getElementById('opp-panel-activity');
      const pTasks = document.getElementById('opp-panel-tasks');
      if (pOverview) pOverview.style.display = tabKey === 'overview' ? 'block' : 'none';
      if (pActivity) pActivity.style.display = tabKey === 'activity' ? 'block' : 'none';
      if (pTasks) pTasks.style.display = tabKey === 'tasks' ? 'block' : 'none';
    };
  });
  // Reset active tab to overview
  const defaultTab = modal.querySelector('.opp-view-tab[data-tab="overview"]');
  if (defaultTab) defaultTab.click();

  // Sidebar: Company field
  const sidebarCompanyEl = document.getElementById('opportunity-sidebar-company');
  if (sidebarCompanyEl) {
    if (isCrmCompany) {
      sidebarCompanyEl.innerHTML = `<a href="#" style="color:var(--color-primary); font-weight:600; text-decoration:none; display:inline-flex; align-items:center; gap:4px;">${escapeHtml(companyName)} <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>`;
      sidebarCompanyEl.querySelector('a')?.addEventListener('click', (e) => {
        e.preventDefault();
        closeModal('opportunity-view-modal');
        setTimeout(() => openCompanyViewModal(companyObj.id), 120);
      });
    } else {
      sidebarCompanyEl.innerHTML = `<span style="color:var(--text-primary); font-weight:500;">${escapeHtml(companyName)}</span>${opportunity.company_name ? ' <span style="font-size:0.72rem; color:var(--text-muted); background:var(--bg-tertiary, rgba(255,255,255,0.06)); padding:2px 6px; border-radius:4px; font-weight:500; border:1px solid var(--border-color, rgba(255,255,255,0.08));">Custom</span>' : ''}`;
    }
  }

  // Sidebar: Contact person field
  const sidebarContactEl = document.getElementById('opportunity-sidebar-contact');
  if (sidebarContactEl) {
    const primaryPerson = (opportunity.mentioned_people && opportunity.mentioned_people[0]) ||
      (isCrmCompany && Array.isArray(window.allPeopleData) && window.allPeopleData.find(p => String(p.company_id) === String(companyObj.id)));

    if (primaryPerson) {
      sidebarContactEl.innerHTML = `<a href="#" style="color:var(--color-primary); font-weight:600; text-decoration:none; display:inline-flex; align-items:center; gap:4px;">${escapeHtml(primaryPerson.name)} <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>`;
      sidebarContactEl.querySelector('a')?.addEventListener('click', (e) => {
        e.preventDefault();
        closeModal('opportunity-view-modal');
        setTimeout(() => openPersonViewModal(primaryPerson.id || primaryPerson), 120);
      });
    } else {
      sidebarContactEl.textContent = 'None assigned';
    }
  }

  // Sidebar: time in the current stage
  const sidebarStageAgeEl = document.getElementById('opportunity-sidebar-stage-age');
  if (sidebarStageAgeEl) {
    const days = daysSince(getStageEnteredAt(opportunity));
    sidebarStageAgeEl.textContent = days === 0 ? 'Since today' : `${days} day${days === 1 ? '' : 's'}`;
  }

  // Sidebar: Competitors
  const competitorsEl = document.getElementById('opportunity-view-competitors');
  if (competitorsEl) {
    const competitors = parseCompetitors(opportunity.competitors);
    if (competitors.length > 0) {
      competitorsEl.innerHTML = `<div class="ov-competitors-list">${competitors.map(c => `<span class="ov-comp-tag">${escapeHtml(c)}</span>`).join('')}</div>`;
    } else {
      competitorsEl.innerHTML = '<span class="text-muted" style="font-size:0.8rem;">None identified</span>';
    }
  }

  // Sidebar: Metadata
  const orgIdEl = document.getElementById('opportunity-view-org-id');
  const updatedEl = document.getElementById('opportunity-view-updated');
  const createdEl = document.getElementById('opportunity-view-created');
  if (orgIdEl) orgIdEl.textContent = opportunity.organization_id || '—';
  if (createdEl) createdEl.textContent = formatDate(opportunity.created_at);
  if (updatedEl) updatedEl.textContent = opportunity.updated_at ? formatDate(opportunity.updated_at) : formatDate(opportunity.created_at);

  // Sidebar: Assignees
  const assigneesEl = document.getElementById('opportunity-view-assignees');
  if (assigneesEl) {
    const assignees = opportunity.assignees || [];
    const ownerProfile = opportunity.profiles;
    let rows = '';

    if (ownerProfile) {
      const ownerName = `${ownerProfile.first_name} ${ownerProfile.last_name}`;
      const ownerRole = ownerProfile.role || 'manager';
      const ownerRoleLabel = ownerRole === 'manager' ? 'Manager' : ownerRole === 'technician' ? 'Technician' : 'Sales Rep';
      const ownerColor = getAssigneeColor(opportunity.user_id);
      const initialsOrImage = ownerProfile.avatar_url 
        ? `<span style="position:relative;z-index:1;display:none;">${getInitials(ownerName)}</span><img src="${ownerProfile.avatar_url}" alt="" onload="this.style.display='block'" onerror="this.style.display='none';var p=this.previousElementSibling;if(p)p.style.display='block'" />` 
        : getInitials(ownerName);
        
      rows += `
        <div class="ov-assignee-row">
          <div class="ov-assignee-avatar" style="background:${ownerColor}">${initialsOrImage}</div>
          <div class="ov-assignee-info">
            <div class="ov-assignee-name">${escapeHtml(ownerName)}</div>
            <span class="ov-assignee-role-badge role-${ownerRole}">Owner · ${escapeHtml(ownerRoleLabel)}</span>
          </div>
        </div>`;
    }

    const extraAssignees = assignees.filter(a => a.user_id !== opportunity.user_id);
    extraAssignees.forEach(a => {
      const p = a.profiles;
      const name = p ? `${p.first_name} ${p.last_name}` : 'Team Member';
      const role = p?.role || 'sales_rep';
      const roleLabel = role === 'manager' ? 'Manager' : role === 'technician' ? 'Technician' : 'Sales Rep';
      const color = getAssigneeColor(a.user_id);
      const initialsOrImage = p?.avatar_url 
        ? `<span style="position:relative;z-index:1;display:none;">${getInitials(name)}</span><img src="${p.avatar_url}" alt="" onload="this.style.display='block'" onerror="this.style.display='none';var p=this.previousElementSibling;if(p)p.style.display='block'" />` 
        : getInitials(name);
        
      rows += `
        <div class="ov-assignee-row">
          <div class="ov-assignee-avatar" style="background:${color}">${initialsOrImage}</div>
          <div class="ov-assignee-info">
            <div class="ov-assignee-name">${escapeHtml(name)}</div>
            <span class="ov-assignee-role-badge role-${role}">${escapeHtml(roleLabel)}</span>
          </div>
        </div>`;
    });

    assigneesEl.innerHTML = rows || '<span class="ov-assignees-empty">No team members.</span>';
  }

  // Edit Action
  const editBtn = document.getElementById('opportunity-view-edit-btn');
  if (editBtn) {
    editBtn.style.display = canEditOpportunity(opportunity) ? 'flex' : 'none';
    editBtn.onclick = () => {
      closeModal('opportunity-view-modal');
      openOpportunityModal(opportunity);
    };
  }

  // Delete Action
  const deleteBtn = document.getElementById('opportunity-view-delete-btn');
  if (deleteBtn) {
    deleteBtn.style.display = canDeleteOpportunity(opportunity) ? 'flex' : 'none';
    deleteBtn.onclick = async () => {
      if (await deleteOpportunity(opportunity)) closeModal('opportunity-view-modal');
    };
  }

  // Show modal
  modal.style.display = 'flex';
  document.body.classList.add('modal-active');
  if (window.lucide) lucide.createIcons();
}

/** Deleting follows the same rule as editing. */
function canDeleteOpportunity(opportunity) {
  return canEditOpportunity(opportunity);
}

/** Confirm, delete and refresh the pipeline. Resolves true when the deal was deleted. */
async function deleteOpportunity(opportunity) {
  if (!canDeleteOpportunity(opportunity)) return false;

  const ownerName = fullName(opportunity.profiles);
  const message = opportunity.user_id !== state.currentUser.id && ownerName
    ? `Are you sure you want to delete ${opportunity.name}? This deal belongs to ${ownerName}.`
    : `Are you sure you want to delete ${opportunity.name}?`;

  const confirmed = await showConfirmDialog('Delete Opportunity', message);
  if (!confirmed) return false;

  const { data, error } = await supabaseClient
    .from('opportunities')
    .delete()
    .eq('id', opportunity.id)
    .select('id');

  if (error) {
    showToast('Error deleting opportunity: ' + error.message, 'error');
    return false;
  }
  // Row-level security skips rows it won't delete instead of returning an error.
  if (!data || data.length === 0) {
    showToast("This deal couldn't be deleted. You may not have permission.", 'error');
    return false;
  }

  showToast('Opportunity deleted successfully', 'success');
  // Remove just this card so columns the user expanded with "Load more"
  // stay expanded; fall back to a full render if it isn't on the board.
  if (!removeOpportunityFromBoard(opportunity.id)) refreshPipelineIfVisible();
  return true;
}

/** Take a deleted deal off the board and recount its column and the totals. */
function removeOpportunityFromBoard(opportunityId) {
  if (!board?.opportunitiesById.delete(opportunityId)) return false;
  document.querySelector(`.opportunity-card[data-id="${CSS.escape(String(opportunityId))}"]`)?.remove();
  updatePipelineStageCounts();
  return true;
}


function initOpportunityModalListeners(opportunity) {
  opportunityModalListeners?.abort();
  opportunityModalListeners = new AbortController();
  const { signal } = opportunityModalListeners;

  // Initialize assignees picker
  initAssigneesPicker(signal);

  // Probability slider
  const probabilitySlider = document.getElementById('opportunity-probability');
  const probabilityDisplay = document.getElementById('probability-display');

  if (probabilitySlider) {
    const newSlider = probabilitySlider.cloneNode(true);
    probabilitySlider.parentNode.replaceChild(newSlider, probabilitySlider);
    newSlider.addEventListener('input', () => {
      probabilityDisplay.textContent = newSlider.value;
    });
  }

  // Picking Won or Lost settles the win chance
  document.getElementById('opportunity-stage')?.addEventListener('change', (e) => {
    const outcomeProbability = { won: 100, lost: 0 }[getStageOutcome(e.target.value)];
    if (outcomeProbability === undefined) return;
    const slider = document.getElementById('opportunity-probability');
    if (slider) slider.value = outcomeProbability;
    probabilityDisplay.textContent = String(outcomeProbability);
  }, { signal });

  // Company search
  const companyInput = document.getElementById('opportunity-company');
  const subsectorInput = document.getElementById('opportunity-subsector');
  const companySearchResults = document.getElementById('opportunity-company-search-results');

  const newCompanyInput = companyInput.cloneNode(true);
  companyInput.parentNode.replaceChild(newCompanyInput, companyInput);

  newCompanyInput.addEventListener('input', async (e) => {
    const query = e.target.value.toLowerCase().trim();

    if (window.selectedOpportunityCompanyData && e.target.value.trim() !== window.selectedOpportunityCompanyData.name) {
      const selectedSubsector = window.selectedOpportunityCompanyData.subsector || '';
      window.selectedOpportunityCompanyData = null;
      if (subsectorInput && subsectorInput.value.trim() === selectedSubsector) {
        subsectorInput.value = '';
      }
    }

    if (query.length === 0) {
      companySearchResults.style.display = 'none';
      return;
    }

    // Use a small delay for search
    clearTimeout(companyInput.searchTimeout);
    companyInput.searchTimeout = setTimeout(async () => {
      let companies = window.allCompaniesData || [];

      // If companies not loaded, fetch them (scoped to current org)
      if (companies.length === 0) {
        let q = supabaseClient
          .from('companies')
          .select('*')
          .order('name', { ascending: true });
        if (state.currentOrganization?.id) q = q.eq('organization_id', state.currentOrganization.id);
        const { data } = await q;
        companies = data || [];
        window.allCompaniesData = companies; // Cache for future use
      }

      // Filter companies using tokenized search
      const filteredCompanies = companies.filter(company =>
        matchesTokenizedQuery(query, company.name, company.description, company.address)
      ).slice(0, 5);

      let resultsHTML = '';

      if (filteredCompanies.length > 0) {
        resultsHTML = filteredCompanies.map(company => {
          const initials = getInitials(company.name);
          const logoUrl = company.logo_url
            ? company.logo_url
            : (company.domain ? getCompanyLogoUrl(company.domain) : '');
          const avatarInner = logoUrl
            ? `<img src="${escapeHtml(logoUrl)}" class="opp-suggest-logo" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><span class="opp-suggest-initials" style="display:none">${escapeHtml(initials)}</span>`
            : `<span class="opp-suggest-initials">${escapeHtml(initials)}</span>`;
          return `
          <div class="search-result-item" data-company-name="${escapeHtml(company.name)}" data-company-id="${escapeHtml(company.id)}">
            <div class="opp-suggest-avatar">${avatarInner}</div>
            <div>
              <div class="search-result-name">${escapeHtml(company.name)}</div>
              <div class="search-result-role">${escapeHtml(company.description || company.domain || 'Company')}</div>
            </div>
          </div>`;
        }).join('');
      }

      // Always show option to use custom name if it's different from found companies
      const customNameOption = `
        <div class="search-result-item" data-company-name="${escapeHtml(e.target.value.trim())}" data-company-id="">
          <div class="opp-suggest-avatar opp-suggest-avatar--custom">
            <span>+</span>
          </div>
          <div>
            <div class="search-result-name">Use "${escapeHtml(e.target.value.trim())}"</div>
            <div class="search-result-role">Add as custom company name</div>
          </div>
        </div>
      `;

      companySearchResults.innerHTML = resultsHTML + customNameOption;
      companySearchResults.style.display = 'block';
    }, 300);
  });

  // Allow pressing Enter to confirm custom company name
  newCompanyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && newCompanyInput.value.trim()) {
      e.preventDefault();
      selectOpportunityCompany(newCompanyInput.value.trim());
    }
  });

  // Company names go through data attributes, not inline onclick strings, so
  // names with apostrophes (O'Neil Ltd) can be picked.
  companySearchResults.addEventListener('click', (e) => {
    const item = e.target.closest('.search-result-item[data-company-name]');
    if (item) selectOpportunityCompany(item.dataset.companyName, item.dataset.companyId);
  }, { signal });

  // Close search results when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-container')) {
      companySearchResults.style.display = 'none';
    }
  }, { signal });

  // Initialize mention system for notes
  let notesEl = document.getElementById('opportunity-notes');
  const mentionSuggestionsContainer = document.getElementById('opportunity-mention-suggestions');



  let mentionStartIndex = -1;
  let currentMentionQuery = '';
  let lastMentionStartIndex = -1;

  // Input event - detect @ and show suggestions
  const newNotesEl = notesEl.cloneNode(true);
  notesEl.parentNode.replaceChild(newNotesEl, notesEl);
  // Update reference so other handlers target the active textarea
  notesEl = newNotesEl;

  newNotesEl.addEventListener('input', (e) => {
    const text = newNotesEl.value;
    const cursorPos = newNotesEl.selectionStart;
    const beforeCursor = text.substring(0, cursorPos);
    const mentionMatch = beforeCursor.match(/@([^@\s]*)$/);

    if (mentionMatch) {
      mentionStartIndex = cursorPos - mentionMatch[0].length;
      currentMentionQuery = mentionMatch[1];

      showMentionSuggestions(currentMentionQuery, mentionSuggestionsContainer);
    } else {
      mentionSuggestionsContainer.style.display = 'none';
      mentionStartIndex = -1;
      currentMentionQuery = '';
    }
  });

  // Keyboard navigation for suggestions
  newNotesEl.addEventListener('keydown', (e) => {
    if (mentionSuggestionsContainer.style.display === 'none') return;

    const items = Array.from(mentionSuggestionsContainer.querySelectorAll('.mention-suggestion'));
    if (items.length === 0) return;

    let activeIndex = items.findIndex(item => item.classList.contains('active'));



    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % items.length;
      setActiveMention(items, activeIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + items.length) % items.length;
      setActiveMention(items, activeIndex);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      if (activeIndex >= 0) {

        insertMentionFromSuggestion(items[activeIndex], notesEl, mentionStartIndex, currentMentionQuery, mentionSuggestionsContainer);
      }
    } else if (e.key === 'Escape') {
      mentionSuggestionsContainer.style.display = 'none';
    }
  });

  // Handle mousedown on suggestions (before focus is lost)
  mentionSuggestionsContainer.addEventListener('mousedown', (e) => {
    const suggestion = e.target.closest('.mention-suggestion');
    if (suggestion) {
      e.preventDefault();
      e.stopPropagation();

      insertMentionFromSuggestion(suggestion, notesEl, mentionStartIndex, currentMentionQuery, mentionSuggestionsContainer);
    }
  }, { capture: true, signal });

  // Close suggestions when clicking outside
  document.addEventListener('click', (e) => {
    if (e.target !== notesEl && !mentionSuggestionsContainer.contains(e.target)) {
      mentionSuggestionsContainer.style.display = 'none';
    }
  }, { signal });

  // Competitors input
  const competitorsInput = document.getElementById('competitors-input');

  competitorsInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && competitorsInput.value.trim()) {
      e.preventDefault();
      addCompetitor(competitorsInput.value.trim());
      competitorsInput.value = '';
    }
  });

  // Save opportunity
  const saveBtn = document.getElementById('save-opportunity-btn');

  saveBtn.onclick = async () => {
    const name = document.getElementById('opportunity-name').value.trim();
    const companyName = document.getElementById('opportunity-company').value.trim();
    const formSubsector = document.getElementById('opportunity-subsector').value.trim();
    const value = document.getElementById('opportunity-value').value;
    const stage = document.getElementById('opportunity-stage').value;
    const outcome = getStageOutcome(stage);
    // Won and Lost deals always carry 100% / 0%
    const probability = outcome === 'won' ? 100 : outcome === 'lost' ? 0 : document.getElementById('opportunity-probability').value;
    const nextStep = document.getElementById('opportunity-next-step').value.trim();
    const nextStepDate = document.getElementById('opportunity-next-step-date').value;
    const notes = document.getElementById('opportunity-notes').value.trim();

    // Get competitors
    const competitorTags = document.querySelectorAll('#competitors-container .competitor-tag');
    const competitors = Array.from(competitorTags).map(tag =>
      tag.textContent.replace('×', '').trim()
    );

    // Validate
    if (!name || !companyName || !value) {
      showToast('Please fill in all required fields', 'error');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

    try {
      // Fields that are safe to update — user_id is intentionally excluded so
      // that editing never transfers ownership away from the original creator.
      // pipeline_id is NOT updated on edit — the opportunity stays in the pipeline it was created in.
      const activePipelineId = state.activePipelineId && state.activePipelineId !== '__default__'
        ? state.activePipelineId
        : null;

      const editableFields = {
        name,
        company_name: companyName,
        subsector: formSubsector || window.selectedOpportunityCompanyData?.subsector || null,
        value,
        probability,
        stage,
        next_step: nextStep || null,
        next_step_date: nextStepDate || null,
        notes: notes || null,
        competitors: competitors.length > 0 ? JSON.stringify(competitors) : null,
        mentioned_people: state.mentionedPeople,
        updated_at: new Date().toISOString(),
      };

      let result;
      let savedOpportunityId;

      if (opportunity) {
        // Update — preserve original owner (user_id stays unchanged)
        result = await supabaseClient
          .from('opportunities')
          .update(editableFields)
          .eq('id', opportunity.id);
        savedOpportunityId = opportunity.id;
      } else {
        // Create — set the creator as owner and tag the pipeline
        result = await supabaseClient
          .from('opportunities')
          .insert([{
            ...editableFields,
            user_id: state.currentUser.id,
            organization_id: state.currentOrganization?.id,
            pipeline_id: activePipelineId,
          }])
          .select('id')
          .single();
        savedOpportunityId = result.data?.id;
      }

      if (result.error) throw result.error;

      // Sync assignees — owner chip (data-is-owner) is display-only and not in
      // state.opportunityAssignees, so ownership is never accidentally re-written.
      if (savedOpportunityId) {
        await syncOpportunityAssignees(savedOpportunityId, state.opportunityAssignees);
      }

      showToast(`Opportunity ${opportunity ? 'updated' : 'created'} successfully!`, 'success');
      const wasWon = opportunity && getStageOutcome(opportunity.mappedStage || opportunity.stage) === 'won';
      if (outcome === 'won' && !wasWon) triggerConfetti();
      closeModal('opportunity-modal');
      refreshPipelineIfVisible();

      // Set reminder for next step if date is provided
      if (nextStepDate) {
        scheduleNextStepReminder(name, nextStep, nextStepDate);
      }
    } catch (error) {
      showToast(`Error ${opportunity ? 'updating' : 'creating'} opportunity: ${error.message}`, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = 'Save Opportunity';
    }
  };
}

function addCompetitor(name) {
  const container = document.getElementById('competitors-container');
  const input = document.getElementById('competitors-input');

  // Check if competitor already exists
  const existingTags = container.querySelectorAll('.competitor-tag');
  for (const tag of existingTags) {
    if (tag.textContent.replace('×', '').trim() === name) {
      return; // Already exists
    }
  }

  // Create competitor tag
  const tag = document.createElement('span');
  tag.className = 'competitor-tag';
  tag.innerHTML = `
    ${escapeHtml(name)}
    <button class="remove" type="button" onclick="removeCompetitor(this)">×</button>
  `;

  // Insert before input
  container.insertBefore(tag, input);
}

window.removeCompetitor = function (element) {
  element.parentElement.remove();
};

window.selectOpportunityCompany = function (name, companyId = '') {
  document.getElementById('opportunity-company').value = name;
  const subsectorInput = document.getElementById('opportunity-subsector');
  const companies = Array.isArray(window.allCompaniesData) ? window.allCompaniesData : [];

  let selectedCompany = null;
  if (companyId) {
    selectedCompany = companies.find(c => String(c.id) === String(companyId)) || null;
  }
  if (!selectedCompany) {
    const normalizedName = window.normalizeForMatching?.(name) || String(name || '').toLowerCase().trim();
    selectedCompany = companies.find(c => (window.normalizeForMatching?.(c.name) || String(c.name || '').toLowerCase().trim()) === normalizedName) || null;
  }

  window.selectedOpportunityCompanyData = selectedCompany;
  if (subsectorInput) {
    subsectorInput.value = selectedCompany?.subsector || '';
  }
  document.getElementById('opportunity-company-search-results').style.display = 'none';
};

function getProbabilityColor(probability) {
  if (probability >= 70) return 'var(--color-success)';
  if (probability >= 40) return 'var(--color-warning)';
  return 'var(--color-danger)';
}

function scheduleNextStepReminder(opportunityName, nextStep, dueDate) {
  // Keep legacy local reminder support for existing flows
  const reminders = JSON.parse(localStorage.getItem('opportunityReminders') || '[]');

  reminders.push({
    opportunityName,
    nextStep,
    dueDate,
    acknowledged: false
  });

  localStorage.setItem('opportunityReminders', JSON.stringify(reminders));

  // Dispatch a refresh event so the notification store picks up the new reminder
  document.dispatchEvent(new CustomEvent('safitrack:notification-refresh', { detail: { forcePopup: true } }));
}


// ── Assignees: helpers ─────────────────────────────────────────────────────────

/** Deterministic color from a user ID string — palette of accessible hues */
function getAssigneeColor(userId) {
  const palette = [
    '#3b82f6', '#8b5cf6', '#ec4899', '#10b981',
    '#f59e0b', '#06b6d4', '#ef4444', '#84cc16',
    '#f97316', '#6366f1',
  ];
  if (!userId) return palette[0];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return palette[hash % palette.length];
}

/** Fetch (and cache) all active profiles in the current org for the picker */
async function loadOrgTeamMembers() {
  if (window._orgTeamMembers && window._orgTeamMembersOrgId === state.currentOrganization?.id) {
    return window._orgTeamMembers;
  }
  let q = supabaseClient
    .from('profiles')
    .select('id, first_name, last_name, role, email, avatar_url')
    .eq('status', 'active')
    .order('first_name');
  if (state.currentOrganization?.id) q = q.eq('organization_id', state.currentOrganization.id);
  const { data } = await q;
  window._orgTeamMembers = data || [];
  window._orgTeamMembersOrgId = state.currentOrganization?.id;
  return window._orgTeamMembers;
}

/** Prepend a non-removable owner chip to the chips container */
function _prependOwnerChip(ownerId, ownerProfile) {
  const chipsEl = document.getElementById('opp-assignees-chips');
  if (!chipsEl || !ownerProfile) return;

  const name = `${ownerProfile.first_name} ${ownerProfile.last_name}`.trim() || 'Owner';
  const color = getAssigneeColor(ownerId);
  const initialsOrImage = ownerProfile.avatar_url 
    ? `<span style="position:relative;z-index:1;display:none;">${getInitials(name)}</span><img src="${ownerProfile.avatar_url}" alt="" onload="this.style.display='block'" onerror="this.style.display='none';var p=this.previousElementSibling;if(p)p.style.display='block'" />` 
    : getInitials(name);

  const chip = document.createElement('div');
  chip.className = 'opp-assignee-chip opp-assignee-chip--owner';
  chip.dataset.userId = ownerId;
  chip.dataset.isOwner = 'true';
  chip.innerHTML = `
    <div class="opp-assignee-chip-avatar" style="background:${color}">${initialsOrImage}</div>
    <div class="opp-assignee-chip-info">
      <span class="opp-assignee-chip-name">${escapeHtml(name)}</span>
      <span class="opp-assignee-chip-role">Owner</span>
    </div>
    <svg class="opp-owner-chip-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" title="Opportunity owner"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>`;

  chipsEl.insertBefore(chip, chipsEl.firstChild);
}

/** Append a chip for one assignee to the chips container */
function _appendAssigneeChip(member) {
  const chipsEl = document.getElementById('opp-assignees-chips');
  if (!chipsEl) return;

  const chip = document.createElement('div');
  chip.className = 'opp-assignee-chip';
  chip.dataset.userId = member.user_id;

  const name = `${member.first_name} ${member.last_name}`.trim() || 'Member';
  const roleLabel = member.role === 'manager' ? 'Manager' : member.role === 'technician' ? 'Technician' : 'Sales Rep';
  const color = getAssigneeColor(member.user_id);
  const initialsOrImage = member.avatar_url 
    ? `<span style="position:relative;z-index:1;display:none;">${getInitials(name)}</span><img src="${member.avatar_url}" alt="" onload="this.style.display='block'" onerror="this.style.display='none';var p=this.previousElementSibling;if(p)p.style.display='block'" />` 
    : getInitials(name);

  chip.innerHTML = `
    <div class="opp-assignee-chip-avatar" style="background:${color}">${initialsOrImage}</div>
    <div class="opp-assignee-chip-info">
      <span class="opp-assignee-chip-name">${escapeHtml(name)}</span>
      <span class="opp-assignee-chip-role">${escapeHtml(roleLabel)}</span>
    </div>
    <button class="opp-assignee-chip-remove" title="Remove ${escapeHtml(name)}" type="button">
      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
    </button>`;

  chip.querySelector('.opp-assignee-chip-remove').addEventListener('click', (e) => {
    e.stopPropagation();
    state.opportunityAssignees = state.opportunityAssignees.filter(a => a.user_id !== member.user_id);
    chip.remove();
  });

  chipsEl.appendChild(chip);
}

/** Set up the assignees search/picker inside the opportunity modal */
function initAssigneesPicker(signal) {
  const input = document.getElementById('opp-assignees-input');
  const dropdown = document.getElementById('opp-assignees-dropdown');
  if (!input || !dropdown) return;

  // Clone input to strip old listeners
  const freshInput = input.cloneNode(true);
  input.parentNode.replaceChild(freshInput, input);

  let allMembers = [];

  const renderDropdown = (members) => {
    const query = freshInput.value.trim().toLowerCase();
    // Exclude the opportunity owner from the picker — they're shown as a
    // non-removable chip and are not stored in opportunity_assignees.
    const ownerChip = document.querySelector('.opp-assignee-chip--owner');
    const ownerUserId = ownerChip?.dataset.userId;

    const filtered = members.filter(m => {
      if (m.id === ownerUserId) return false;
      const name = `${m.first_name} ${m.last_name}`.toLowerCase();
      return !query || name.includes(query) || (m.email || '').toLowerCase().includes(query);
    });

    if (filtered.length === 0) {
      dropdown.innerHTML = `<div class="opp-assignees-empty">No team members found.</div>`;
      dropdown.style.display = 'block';
      return;
    }

    dropdown.innerHTML = filtered.map(m => {
      const name = `${m.first_name} ${m.last_name}`.trim() || m.email;
      const isSelected = state.opportunityAssignees.some(a => a.user_id === m.id);
      const roleLabel = m.role === 'manager' ? 'Manager' : m.role === 'technician' ? 'Technician' : 'Sales Rep';
      const color = getAssigneeColor(m.id);
      const initialsOrImage = m.avatar_url 
        ? `<span style="position:relative;z-index:1;display:none;">${getInitials(name)}</span><img src="${m.avatar_url}" alt="" onload="this.style.display='block'" onerror="this.style.display='none';var p=this.previousElementSibling;if(p)p.style.display='block'" />` 
        : getInitials(name);
        
      return `
        <div class="opp-assignee-option${isSelected ? ' is-selected' : ''}" data-user-id="${escapeHtml(m.id)}">
          <div class="opp-assignee-opt-avatar" style="background:${color}">${initialsOrImage}</div>
          <div class="opp-assignee-opt-info">
            <div class="opp-assignee-opt-name">${escapeHtml(name)}</div>
            <div class="opp-assignee-opt-role">${escapeHtml(roleLabel)}</div>
          </div>
          <svg class="opp-assignee-opt-check" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
        </div>`;
    }).join('');

    dropdown.querySelectorAll('.opp-assignee-option').forEach(opt => {
      opt.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const uid = opt.dataset.userId;
        const member = allMembers.find(m => m.id === uid);
        if (!member) return;

        const alreadyIdx = state.opportunityAssignees.findIndex(a => a.user_id === uid);
        if (alreadyIdx >= 0) {
          // Deselect — remove chip
          state.opportunityAssignees.splice(alreadyIdx, 1);
          document.querySelector(`.opp-assignee-chip[data-user-id="${uid}"]`)?.remove();
        } else {
          // Select — add chip
          const assignee = {
            user_id: member.id,
            first_name: member.first_name,
            last_name: member.last_name,
            role: member.role,
            avatar_url: member.avatar_url,
          };
          state.opportunityAssignees.push(assignee);
          _appendAssigneeChip(assignee);
        }

        freshInput.value = '';
        dropdown.style.display = 'none';
      });
    });

    dropdown.style.display = 'block';
  };

  const positionDropdown = () => {
    const rect = freshInput.getBoundingClientRect();
    dropdown.style.top    = `${rect.bottom + 4}px`;
    dropdown.style.left   = `${rect.left}px`;
    dropdown.style.width  = `${rect.width}px`;
  };

  freshInput.addEventListener('focus', async () => {
    if (allMembers.length === 0) allMembers = await loadOrgTeamMembers();
    positionDropdown();
    renderDropdown(allMembers);
  });

  freshInput.addEventListener('input', () => {
    positionDropdown();
    renderDropdown(allMembers);
  });

  freshInput.addEventListener('blur', () => {
    setTimeout(() => {
      dropdown.style.display = 'none';
    }, 150);
  });

  freshInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      dropdown.style.display = 'none';
      freshInput.blur();
    }
  });

  // Reposition if modal scrolls while dropdown is open
  document.querySelector('#opportunity-modal .modal-body')?.addEventListener('scroll', positionDropdown, { passive: true, signal });
}


// ── Pipeline Management ────────────────────────────────────────────────────────

/** Open the "Manage Pipelines" modal (managers only) */
async function openManagePipelinesModal() {
  const modal = document.getElementById('manage-pipelines-modal');
  if (!modal) return;

  const listContainer = document.getElementById('pipelines-list-container');
  if (listContainer) listContainer.innerHTML = '<div class="pipeline-loading">Loading pipelines…</div>';

  modal.style.display = 'flex';
  document.body.classList.add('modal-active');

  // Force a fresh fetch
  state.pipelines = null;
  const pipelines = await loadPipelines();
  renderPipelinesList(pipelines);

  const createBtn = document.getElementById('create-pipeline-btn');
  if (createBtn) {
    // Clone to strip previous listeners
    const fresh = createBtn.cloneNode(true);
    createBtn.parentNode.replaceChild(fresh, createBtn);
    fresh.addEventListener('click', () => openPipelineEditorModal(null));
  }
}

/** Render the list of pipelines inside the manage modal */
function renderPipelinesList(pipelines) {
  const listContainer = document.getElementById('pipelines-list-container');
  if (!listContainer) return;

  if (!pipelines || pipelines.length === 0) {
    listContainer.innerHTML = '<p class="pipeline-empty-hint">No pipelines yet. Create one below.</p>';
    return;
  }

  listContainer.innerHTML = pipelines.map(p => `
    <div class="pipeline-list-item" data-pipeline-id="${escapeHtml(p.id)}">
      <div class="pipeline-list-item-info">
        <div class="pipeline-list-item-name">
          ${escapeHtml(p.name)}
          ${p.is_default ? '<span class="pipeline-default-badge">Default</span>' : ''}
        </div>
        <div class="pipeline-list-item-stages">
          ${(p.stages || []).map(s => `
            <span class="pipeline-stage-pill" style="background:color-mix(in srgb,${escapeHtml(s.color)} 15%,transparent);color:${escapeHtml(s.color)}">
              ${escapeHtml(s.title)}
            </span>
          `).join('')}
        </div>
      </div>
      <div class="pipeline-list-item-actions">
        <button class="btn btn-ghost btn-sm pipeline-edit-btn" data-pipeline-id="${escapeHtml(p.id)}" title="Edit pipeline">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/></svg>
          Edit
        </button>
        ${!p.is_default ? `
          <button class="btn btn-ghost btn-sm pipeline-delete-btn" data-pipeline-id="${escapeHtml(p.id)}" title="Delete pipeline" style="color:var(--color-danger)">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"/></svg>
            Delete
          </button>
        ` : ''}
      </div>
    </div>
  `).join('');

  // Bind edit buttons
  listContainer.querySelectorAll('.pipeline-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pipeline = pipelines.find(p => p.id === btn.dataset.pipelineId);
      if (pipeline) openPipelineEditorModal(pipeline);
    });
  });

  // Bind delete buttons
  listContainer.querySelectorAll('.pipeline-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const pipeline = pipelines.find(p => p.id === btn.dataset.pipelineId);
      if (!pipeline) return;

      // Count how many opportunities are in this pipeline
      const { count } = await supabaseClient
        .from('opportunities')
        .select('id', { count: 'exact', head: true })
        .eq('pipeline_id', pipeline.id);
      const oppCount = count || 0;

      // Deals are moved to the default pipeline's first stage, never deleted
      const targetPipeline = pipelines.find(p => p.is_default && p.id !== pipeline.id);
      const targetStage = getPipelineStages(targetPipeline)[0];
      const dealsLabel = `${oppCount} opportunit${oppCount === 1 ? 'y' : 'ies'}`;

      const warningMsg = oppCount > 0
        ? `Delete "${pipeline.name}"?\n\nIts ${dealsLabel} will move to the "${targetPipeline?.name || 'Sales'}" pipeline, in the "${plainStageTitle(targetStage?.title)}" stage.`
        : `Delete "${pipeline.name}"? This cannot be undone.`;

      const confirmed = await showConfirmDialog('Delete Pipeline', warningMsg);
      if (!confirmed) return;

      if (oppCount > 0) {
        const { error: moveErr } = await supabaseClient
          .from('opportunities')
          .update({
            pipeline_id: targetPipeline && targetPipeline.id !== '__default__' ? targetPipeline.id : null,
            stage: targetStage?.id || 'prospecting',
            updated_at: new Date().toISOString(),
          })
          .eq('pipeline_id', pipeline.id);
        if (moveErr) { showToast('Error moving opportunities: ' + moveErr.message, 'error'); return; }
      }

      const { error } = await supabaseClient.from('pipelines').delete().eq('id', pipeline.id);
      if (error) { showToast('Error deleting pipeline: ' + error.message, 'error'); return; }

      // If user was on the deleted pipeline, fall back to default
      if (state.activePipelineId === pipeline.id) {
        const remaining = pipelines.filter(p => p.id !== pipeline.id);
        const fallback = remaining.find(p => p.is_default) || remaining[0];
        if (fallback) setActivePipeline(fallback.id);
      }

      showToast(`Pipeline deleted${oppCount > 0 ? `. ${dealsLabel} moved to ${targetPipeline?.name || 'Sales'}` : ''}`, 'success');
      state.pipelines = null;
      closeModal('manage-pipelines-modal');
      renderOpportunityPipelineView();
    });
  });
}

/** Open the pipeline editor modal (create or edit) */
function openPipelineEditorModal(pipeline) {
  const modal = document.getElementById('pipeline-editor-modal');
  if (!modal) return;

  const titleEl = document.getElementById('pipeline-editor-title');
  if (titleEl) titleEl.textContent = pipeline ? 'Edit Pipeline' : 'New Pipeline';

  const nameInput = document.getElementById('pipeline-name-input');
  if (nameInput) nameInput.value = pipeline?.name || '';

  // Default stage set for brand-new pipelines
  const initialStages = pipeline
    ? [...(pipeline.stages || [])]
    : [
        { id: 'stage-' + Date.now() + '-1', title: 'Stage 1', color: '#3b82f6' },
        { id: 'stage-' + Date.now() + '-2', title: 'Stage 2', color: '#10b981' },
      ];
  renderStagesEditor(initialStages);

  // Add-stage button
  const addStageBtn = document.getElementById('add-stage-btn');
  if (addStageBtn) {
    const freshAdd = addStageBtn.cloneNode(true);
    addStageBtn.parentNode.replaceChild(freshAdd, addStageBtn);
    freshAdd.addEventListener('click', () => {
      const current = getStagesFromEditor();
      if (current.length >= 8) { showToast('Maximum 8 stages per pipeline', 'info'); return; }
      renderStagesEditor([...current, {
        id: 'stage-' + Date.now(),
        title: `Stage ${current.length + 1}`,
        color: STAGE_COLORS[current.length % STAGE_COLORS.length],
      }]);
    });
  }

  // Cancel button
  const cancelBtn = document.getElementById('pipeline-editor-cancel-btn');
  if (cancelBtn) {
    const freshCancel = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(freshCancel, cancelBtn);
    freshCancel.addEventListener('click', () => closeModal('pipeline-editor-modal'));
  }

  // Save button
  const saveBtn = document.getElementById('save-pipeline-btn');
  if (saveBtn) {
    const freshSave = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(freshSave, saveBtn);
    freshSave.addEventListener('click', async () => {
      const name = nameInput?.value.trim();
      if (!name) { showToast('Enter a pipeline name', 'error'); return; }

      const stages = getStagesFromEditor();
      if (stages.length < 2) { showToast('Add at least 2 stages', 'error'); return; }
      if (stages.some(s => !s.title.trim())) { showToast('All stages need a name', 'error'); return; }

      freshSave.disabled = true;
      freshSave.textContent = 'Saving…';

      try {
        let result;
        if (pipeline) {
          // ── Migrate opportunities away from removed stages ──────────────
          const oldStages = pipeline.stages || [];
          const removedStages = oldStages.filter(old => !stages.some(s => s.id === old.id));

          for (const removed of removedStages) {
            // Find the closest preceding stage that still exists; fall back to first new stage
            const oldIndex = oldStages.findIndex(s => s.id === removed.id);
            let replacementId = stages[0]?.id;
            for (let i = oldIndex - 1; i >= 0; i--) {
              if (stages.some(s => s.id === oldStages[i].id)) {
                replacementId = oldStages[i].id;
                break;
              }
            }
            if (!replacementId) continue;

            // For the default pipeline, also catch opps where pipeline_id is NULL
            let migrateQ = supabaseClient
              .from('opportunities')
              .update({ stage: replacementId })
              .eq('stage', removed.id);

            if (pipeline.is_default) {
              // Can't use .or() easily without knowing org, so run two queries
              await supabaseClient
                .from('opportunities')
                .update({ stage: replacementId })
                .eq('stage', removed.id)
                .is('pipeline_id', null);
              migrateQ = migrateQ.eq('pipeline_id', pipeline.id);
            } else {
              migrateQ = migrateQ.eq('pipeline_id', pipeline.id);
            }
            await migrateQ;
          }
          // ───────────────────────────────────────────────────────────────

          result = await supabaseClient
            .from('pipelines')
            .update({ name, stages })
            .eq('id', pipeline.id)
            .select()
            .single();
        } else {
          result = await supabaseClient
            .from('pipelines')
            .insert([{
              name,
              stages,
              organization_id: state.currentOrganization?.id,
              created_by: state.currentUser?.id,
              is_default: false,
            }])
            .select()
            .single();
        }
        if (result.error) throw result.error;

        showToast(`Pipeline ${pipeline ? 'updated' : 'created'}!`, 'success');
        state.pipelines = null;
        closeModal('pipeline-editor-modal');
        closeModal('manage-pipelines-modal');
        // Re-render the kanban to reflect new pipeline / stage changes immediately
        renderOpportunityPipelineView();
      } catch (err) {
        showToast('Error saving pipeline: ' + err.message, 'error');
      } finally {
        freshSave.disabled = false;
        freshSave.textContent = 'Save Pipeline';
      }
    });
  }

  modal.style.display = 'flex';
  document.body.classList.add('modal-active');
}

/** Render the stage rows inside the pipeline editor */
function renderStagesEditor(stages) {
  const container = document.getElementById('pipeline-stages-editor');
  if (!container) return;

  container.innerHTML = stages.map((s, i) => `
    <div class="stage-editor-row" data-stage-id="${escapeHtml(s.id)}">
      <div class="stage-color-palette">
        ${STAGE_COLORS.map(c => `
          <button type="button"
            class="stage-color-dot${c === s.color ? ' is-selected' : ''}"
            data-color="${escapeHtml(c)}"
            style="background:${escapeHtml(c)}"
            title="Use ${escapeHtml(c)}"></button>
        `).join('')}
      </div>
      <input type="text" class="stage-name-input form-control" value="${escapeHtml(s.title)}"
        placeholder="Stage name" maxlength="32" style="flex:1">
      ${stages.length > 2 ? `
        <button type="button" class="stage-remove-btn" title="Remove stage">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      ` : ''}
    </div>
  `).join('');

  // Color dot selection
  container.querySelectorAll('.stage-color-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      const row = dot.closest('.stage-editor-row');
      row.querySelectorAll('.stage-color-dot').forEach(d => d.classList.remove('is-selected'));
      dot.classList.add('is-selected');
    });
  });

  // Remove stage
  container.querySelectorAll('.stage-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const current = getStagesFromEditor();
      const id = btn.closest('.stage-editor-row').dataset.stageId;
      renderStagesEditor(current.filter(s => s.id !== id));
    });
  });
}

/** Read current stages from the editor UI */
function getStagesFromEditor() {
  const container = document.getElementById('pipeline-stages-editor');
  if (!container) return [];
  return Array.from(container.querySelectorAll('.stage-editor-row')).map(row => ({
    id: row.dataset.stageId,
    title: (row.querySelector('.stage-name-input')?.value || '').trim(),
    color: row.querySelector('.stage-color-dot.is-selected')?.dataset.color || '#3b82f6',
  }));
}


/** Delete all existing assignees for an opportunity then insert the new set */
async function syncOpportunityAssignees(opportunityId, assignees) {
  await supabaseClient
    .from('opportunity_assignees')
    .delete()
    .eq('opportunity_id', opportunityId);

  if (!assignees || assignees.length === 0) return;

  const rows = assignees.map(a => ({
    opportunity_id: opportunityId,
    user_id: a.user_id,
    organization_id: state.currentOrganization?.id || null,
    assigned_by: state.currentUser.id,
  }));

  const { error } = await supabaseClient
    .from('opportunity_assignees')
    .insert(rows);

  if (error) console.warn('syncOpportunityAssignees error:', error.message);
}


// ── Exports ────────────────────────────────────────────────────
export {
  renderOpportunityPipelineView,
  initOpportunityEventListeners,
  initPipelineDragAndDrop,
  updatePipelineStageCounts,
  initPipelineFilters,
  openOpportunityModal,
  openOpportunityViewModal,
  initOpportunityModalListeners,
  addCompetitor,
  getProbabilityColor,
  scheduleNextStepReminder,
  loadPipelines,
  openManagePipelinesModal,
  openPipelineEditorModal,
};
