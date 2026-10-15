// modules/features/opportunities.js
// Opportunity pipeline: kanban, drag-and-drop, modals.
import { state, supabaseClient, loadPersistedState as _loadPersistedState, saveViewState } from '../state.js';
import { viewContainer } from '../ui/dom.js';
import { showToast, escapeHtml, getInitials, triggerConfetti } from '../ui/toast.js';
import { renderError, formatCurrency } from '../utils/helpers.js';
import { getCompanyLogoUrl } from '../ui/spreadsheet.js';
import { getDefaultSalesStages, LEGACY_STAGE_TO_CANONICAL } from '../utils/pipeline-stages.js';
import { fetchAllPages } from '../utils/analytics.js';

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

/** Deal value is optional; a deal without one shows "—" rather than 0. */
function hasDealValue(opp) {
  return !Number.isNaN(parseFloat(opp?.value));
}

function formatDealValue(opp) {
  return hasDealValue(opp) ? formatCurrency(dealValue(opp)) : '—';
}

function dealProbability(opp) {
  const p = parseInt(opp?.probability, 10);
  return Number.isNaN(p) ? 0 : Math.min(100, Math.max(0, p));
}

// Win chance for the built-in open stages; other open stages are spread between 10% and 90%.
const STAGE_DEFAULT_PROBABILITY = { prospecting: 10, qualification: 50 };

/** The win chance a stage gives a deal: Won 100%, Lost 0%, open stages from the
 *  stage's own setting, the built-in defaults, or their place in the pipeline. */
function getStageProbability(stageId, stages) {
  const outcome = getStageOutcome(stageId);
  if (outcome) return outcome === 'won' ? 100 : 0;
  const own = parseInt(stages.find(s => s.id === stageId)?.probability, 10);
  if (!Number.isNaN(own)) return Math.min(100, Math.max(0, own));
  if (STAGE_DEFAULT_PROBABILITY[stageId] !== undefined) return STAGE_DEFAULT_PROBABILITY[stageId];
  const openStages = stages.filter(s => !getStageOutcome(s.id));
  const index = openStages.findIndex(s => s.id === stageId);
  if (index < 0 || openStages.length < 2) return 50;
  return Math.round(10 + (80 * index) / (openStages.length - 1));
}

/** A deal's win chance follows its stage until someone sets it by hand. */
function probabilityFollowsStage(opp, stageId, stages) {
  if (opp.probability == null || opp.probability === '') return true;
  return Boolean(getStageOutcome(stageId)) || dealProbability(opp) === getStageProbability(stageId, stages);
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

  // Owner's photo and short name ("Jane S."); tagged teammates as "+N", everyone in the tooltip
  const team = getOpportunityTeam(opp);
  let teamHtml = '';
  if (team.length > 0) {
    const lead = team[0];
    const others = team.slice(1);
    const isOwner = Boolean(opp.profiles) && lead.user_id === opp.user_id;
    const [first, ...rest] = String(lead.name || '').trim().split(/\s+/);
    const shortName = rest.length ? `${first} ${rest[rest.length - 1][0]}.` : (first || 'Teammate');
    const tooltip = [
      `${isOwner ? 'Owner' : 'Teammate'}: ${lead.name}`,
      others.length ? `With ${others.map(m => m.name).join(', ')}` : '',
    ].filter(Boolean).join(' · ');
    teamHtml = `
      <span class="opp-owner" title="${escapeHtml(tooltip)}">
        <span class="opp-assignee-bubble opp-owner-avatar" style="background:${getAssigneeColor(lead.user_id)}">${renderAvatarContent(lead.name, lead.avatar_url)}</span>
        <span class="opp-owner-name">${escapeHtml(shortName)}</span>
        ${others.length ? `<span class="opp-owner-more">+${others.length}</span>` : ''}
      </span>`;
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
        <span class="opp-value${hasDealValue(opp) ? '' : ' is-empty'}"${hasDealValue(opp) ? '' : ' title="No deal value yet"'}>${formatDealValue(opp)}</span>
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

  const [pipelines, opportunitiesResult] = await Promise.all([loadPipelines(), fetchAllPages(opportunitiesQuery)]);
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

  // A deal's next step is its earliest open task. Deals with no tasks the viewer
  // can see keep the next step stored on the deal.
  if (opportunities.length > 0) {
    const { data: taskRows, error: taskError } = await supabaseClient
      .from('tasks')
      .select('opportunity_id, title, due_date, status, created_at, updated_at')
      .in('opportunity_id', opportunities.map(o => o.id));
    if (taskError) {
      console.warn('Deal tasks:', taskError.message);
    } else if (taskRows?.length) {
      const tasksByOppId = new Map();
      taskRows.forEach(t => {
        if (!tasksByOppId.has(t.opportunity_id)) tasksByOppId.set(t.opportunity_id, []);
        tasksByOppId.get(t.opportunity_id).push(t);
      });
      opportunities.forEach(opp => {
        const tasks = tasksByOppId.get(opp.id);
        if (tasks) Object.assign(opp, nextStepFieldsFromTasks(tasks));
      });
    }
  }

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

        // The win chance moves with the stage (Won/Lost always settle it),
        // unless someone set it by hand
        const outcome = getStageOutcome(newStage);
        const stages = getPipelineStages(getCachedActivePipeline());
        const now = new Date().toISOString();
        const updates = { stage: newStage, updated_at: now };
        if (outcome || (opportunity && probabilityFollowsStage(opportunity, oldStage, stages))) {
          updates.probability = getStageProbability(newStage, stages);
        }

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
  document.getElementById('competitors-container').innerHTML = '<input type="text" class="opp-token-input" id="competitors-input" placeholder="Add a competitor" autocomplete="off">';

  // Reset mentioned people
  state.mentionedPeople = opportunity && opportunity.mentioned_people ? [...opportunity.mentioned_people] : [];

  // Fetch fresh assignees from DB (or empty for new opportunity)
  // Always fetches from DB to avoid stale/missing data on edit.
  // The next step edits the deal's earliest open task, if it has one.
  const [assignees, dealTasks] = opportunity
    ? await Promise.all([fetchOpportunityAssignees(opportunity.id), fetchDealTasks(opportunity.id)])
    : [[], []];
  state.opportunityAssignees = assignees;
  state.opportunityFormNextTask = getNextOpenTask(dealTasks || []);

  // Reset assignees picker UI
  const chipsEl = document.getElementById('opp-assignees-chips');
  if (chipsEl) {
    chipsEl.innerHTML = '';
    // When editing: show the owner as a non-removable chip first so the full
    // team is always visible. Owner is NOT stored in state.opportunityAssignees
    // (they're tracked via opportunity.user_id), so saving never overwrites them.
    // Managers see the owner in the Owner dropdown instead.
    if (!state.isManager && opportunity && opportunity.profiles && opportunity.user_id) {
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
    modalTitle.textContent = 'Edit deal';
    saveBtn.textContent = 'Save changes';

    // Fill form with opportunity data
    document.getElementById('opportunity-name').value = opportunity.name || '';
    document.getElementById('opportunity-company').value = opportunity.company_name || '';
    const matchedCompany = findCompanyForOpportunityFast(opportunity, buildCompanyLookup(window.allCompaniesData));
    window.selectedOpportunityCompanyData = matchedCompany || null;
    document.getElementById('opportunity-subsector').value = opportunity.subsector || matchedCompany?.subsector || '';
    document.getElementById('opportunity-value').value = hasDealValue(opportunity) ? opportunity.value : '';

    const stageId = resolveStageId(opportunity.stage, pipelineStages, activePipeline.is_default);
    updateStageDropdownForPipeline(activePipeline, stageId);
    // 0% is a real value (lost deals), so only fall back to the stage when nothing is stored
    setProbabilityInput(opportunity.probability == null || opportunity.probability === ''
      ? getStageProbability(stageId, pipelineStages)
      : dealProbability(opportunity));

    const nextTask = state.opportunityFormNextTask;
    document.getElementById('opportunity-next-step').value = nextTask ? nextTask.title : (opportunity.next_step || '');
    document.getElementById('opportunity-next-step-date').value = nextTask
      ? timestampToDay(nextTask.due_date)
      : (opportunity.next_step_date ? String(opportunity.next_step_date).slice(0, 10) : '');

    parseCompetitors(opportunity.competitors).forEach(comp => addCompetitor(comp));
  } else {
    modalTitle.textContent = 'New deal';
    saveBtn.textContent = 'Create deal';
    window.selectedOpportunityCompanyData = null;

    // "+ New" in a column starts the deal in that column
    const stageId = options?.stageId && pipelineStages.some(s => s.id === options.stageId)
      ? options.stageId
      : firstStageId;
    updateStageDropdownForPipeline(activePipeline, stageId);
    setProbabilityInput(getStageProbability(stageId, pipelineStages));
  }

  // Managers can hand a deal to someone else; everyone else owns what they create
  const ownerField = document.getElementById('opportunity-owner-field');
  if (ownerField) ownerField.style.display = state.isManager ? '' : 'none';
  if (state.isManager) {
    const members = await loadOrgTeamMembers();
    const ownerId = opportunity ? (opportunity.user_id || '') : state.currentUser.id;
    const ownerOptions = members.map(m => ({ value: m.id, label: fullName(m) || m.email || 'Team member' }));
    // Keep an owner who has left selectable, so saving doesn't quietly reassign the deal
    if (ownerId && !members.some(m => m.id === ownerId)) {
      ownerOptions.unshift({ value: ownerId, label: fullName(opportunity?.profiles) || 'Former team member' });
    }
    if (!ownerId) ownerOptions.unshift({ value: '', label: 'No owner' });
    window.updateCrmDropdownOptions?.('opportunity-owner', ownerOptions, false);
    window.setCrmDropdownValue?.('opportunity-owner', ownerId);
  }

  document.getElementById('opportunity-next-step-hint').textContent = state.opportunityFormNextTask
    ? 'Changes update its task in Tasks'
    : 'Added to Tasks for the deal owner';
  // Competitors and teammates sit under "More" unless the deal already has some
  const more = document.getElementById('opportunity-more');
  if (more) more.open = Boolean(opportunity && (parseCompetitors(opportunity.competitors).length || state.opportunityAssignees.length));

  document.querySelectorAll('#opportunity-modal input, #opportunity-modal select, #opportunity-modal textarea').forEach(el => {
    el.disabled = false;
  });
  saveBtn.style.display = '';

  // Show modal
  modal.style.display = 'flex';
  document.body.classList.add('modal-active');

  // Initialize event listeners
  initOpportunityModalListeners(opportunity);
}

// ── Deal tasks and notes ──────────────────────────────────────────────────────
// A deal's next step is its earliest open task, and notes written on a deal are
// CRM notes, so both also show on the Tasks and Notes pages. The deal's
// next_step / next_step_date columns mirror that task for the board, filters
// and reports.

const DEAL_TASK_SELECT = '*, assigned_to_profile:profiles!tasks_assigned_to_fkey(first_name, last_name, email), created_by_profile:profiles!tasks_created_by_fkey(first_name, last_name, email)';

const pad2 = (n) => String(n).padStart(2, '0');

/** A date picked for a task ("2026-10-14") as 09:00 that day, local time */
function dueDateToTimestamp(day) {
  return day ? new Date(`${day}T09:00:00`).toISOString() : null;
}

/** A task's due timestamp as the local day ("2026-10-14"), or '' */
function timestampToDay(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Open tasks soonest first (undated after dated), then finished ones */
function sortDealTasks(tasks) {
  const dueTime = (t) => (t.due_date ? new Date(t.due_date).getTime() : Infinity);
  return [...tasks].sort((a, b) => {
    const doneA = a.status === 'completed';
    const doneB = b.status === 'completed';
    if (doneA !== doneB) return doneA ? 1 : -1;
    if (doneA) return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
    return dueTime(a) - dueTime(b) || new Date(a.created_at || 0) - new Date(b.created_at || 0);
  });
}

function getNextOpenTask(tasks) {
  return sortDealTasks(tasks || []).find(t => t.status !== 'completed') || null;
}

function nextStepFieldsFromTasks(tasks) {
  const next = getNextOpenTask(tasks);
  return { next_step: next?.title || null, next_step_date: next ? (timestampToDay(next.due_date) || null) : null };
}

/** The deal's tasks, or null when they can't be loaded */
async function fetchDealTasks(opportunityId) {
  const { data, error } = await supabaseClient.from('tasks').select(DEAL_TASK_SELECT).eq('opportunity_id', opportunityId);
  if (error) {
    console.warn('Deal tasks:', error.message);
    return null;
  }
  return data || [];
}

/** The deal's notes, newest first, or null when they can't be loaded */
async function fetchDealNotes(opportunityId) {
  const { data, error } = await supabaseClient
    .from('notes')
    .select('*')
    .eq('opportunity_id', opportunityId)
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('Deal notes:', error.message);
    return null;
  }
  return data || [];
}

/** A task on the deal, assigned to the deal owner */
async function createDealTask(deal, { title, day }) {
  const { data, error } = await supabaseClient
    .from('tasks')
    .insert([{
      title,
      description: null,
      assigned_to: deal.user_id || state.currentUser.id,
      created_by: state.currentUser.id,
      due_date: dueDateToTimestamp(day),
      priority: 'medium',
      status: 'pending',
      organization_id: state.currentOrganization?.id,
      opportunity_id: deal.id,
    }])
    .select(DEAL_TASK_SELECT)
    .single();
  if (error) throw error;
  document.dispatchEvent(new CustomEvent('safitrack:notification-refresh'));
  return data;
}

/** Notes are rich text (HTML) on the Notes page; show them here as plain text with line breaks */
function noteContentToText(content) {
  const raw = String(content || '');
  if (!/[<&]/.test(raw)) return raw;
  const withBreaks = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|h[1-6])>/gi, '\n')
    .replace(/<(ul|ol)[^>]*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ');
  // DOMParser doesn't run scripts or load images, so it's a safe way to decode the text
  const text = new DOMParser().parseFromString(withBreaks, 'text/html').body.textContent || '';
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

/** A CRM note on the deal; it shows on the author's Notes page too */
async function createDealNote(deal, text) {
  const { data, error } = await supabaseClient
    .from('notes')
    .insert([{
      title: `Deal: ${deal.name || 'Untitled deal'}`,
      // The Notes page edits notes as HTML, so keep line breaks as <br>
      content: escapeHtml(text).replace(/\n/g, '<br>'),
      user_id: state.currentUser.id,
      organization_id: state.currentOrganization?.id,
      opportunity_id: deal.id,
    }])
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/** Re-derive a deal's next step from its tasks after one changed elsewhere
 *  (the Tasks page, the task panel). Quietly skips deals the viewer can't edit. */
async function refreshDealNextStep(opportunityId) {
  if (!opportunityId) return;
  const [{ data: tasks, error }, { data: deal }] = await Promise.all([
    supabaseClient.from('tasks').select('title, due_date, status, created_at, updated_at').eq('opportunity_id', opportunityId),
    supabaseClient.from('opportunities').select('id, next_step, next_step_date').eq('id', opportunityId).maybeSingle(),
  ]);
  if (error || !deal) return;
  const fields = nextStepFieldsFromTasks(tasks || []);
  const currentDay = deal.next_step_date ? String(deal.next_step_date).slice(0, 10) : null;
  if ((deal.next_step || null) === fields.next_step && currentDay === fields.next_step_date) return;
  await supabaseClient.from('opportunities').update(fields).eq('id', opportunityId);
  refreshPipelineIfVisible();
}

/** Open a deal's panel from just its id (e.g. from one of its tasks) */
async function openOpportunityById(opportunityId) {
  const { data: opportunity, error } = await supabaseClient
    .from('opportunities')
    .select(OPPORTUNITY_SELECT)
    .eq('id', opportunityId)
    .maybeSingle();
  if (error || !opportunity) {
    showToast("This deal couldn't be opened. It may have been deleted, or you may not have access.", 'error');
    return;
  }
  // The panel reads teammates as { user_id, profiles }
  opportunity.assignees = (await fetchOpportunityAssignees(opportunity.id)).map(a => ({
    user_id: a.user_id,
    profiles: { first_name: a.first_name, last_name: a.last_name, role: a.role, avatar_url: a.avatar_url },
  }));
  openOpportunityViewModal(opportunity);
}

// ── Deal detail ───────────────────────────────────────────────────────────────
// One panel: header, a property list whose fields edit in place, then notes,
// activity and tasks. The full form (pencil) stays for company, competitors
// and teammates.

// The deal on screen, the open tab, and listeners removed when another deal opens
let detail = null;

const detailIcon = (paths) => `<svg class="od-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const DETAIL_ICONS = {
  stage: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>',
  value: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
  probability: '<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  owner: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  nextStep: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m9 12 2 2 4-4"/>',
  contact: '<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  competitors: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  team: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  company: '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4M10 10h4M10 14h4M10 18h4"/>',
  edit: '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
};

/** Team members for the owner picker, if already loaded for this org */
function getCachedTeamMembers() {
  return window._orgTeamMembersOrgId === state.currentOrganization?.id ? window._orgTeamMembers : null;
}

function renderPersonChip(userId, name, avatarUrl) {
  return `<span class="od-person"><span class="od-person-avatar" style="background:${getAssigneeColor(userId)}">${renderAvatarContent(name, avatarUrl)}</span>${escapeHtml(name)}</span>`;
}

/** Notes with @mentions turned into links to the person */
function renderNotesHtml(opportunity) {
  let html = escapeHtml(opportunity.notes || '');
  if (Array.isArray(opportunity.mentioned_people)) {
    opportunity.mentioned_people.forEach(person => {
      if (!person?.name) return;
      // The notes are already escaped, so match the escaped form of the name
      const safeName = escapeHtml(person.name.trim());
      const pattern = new RegExp(`@${escapeRegExp(safeName)}\\b`, 'gi');
      html = html.replace(pattern, `<button type="button" class="mentioned-person" data-person-id="${escapeHtml(person.id)}">@${safeName}</button>`);
    });
  }
  return html;
}

function openOpportunityViewModal(opportunity) {
  const modal = document.getElementById('opportunity-view-modal');
  const panel = document.getElementById('opportunity-detail');
  if (!modal || !panel || !opportunity) return;

  detail?.listeners.abort();
  // tasks / notes: undefined while loading, null if they couldn't be loaded
  detail = { opportunity, tab: 'notes', calls: [], tasks: undefined, notes: undefined, drafts: {}, listeners: new AbortController() };
  const { signal } = detail.listeners;

  panel.addEventListener('click', onDetailClick, { signal });
  panel.addEventListener('submit', onDetailSubmit, { signal });
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.target.matches('[data-composer="note"] textarea')) {
      e.preventDefault();
      e.target.form.requestSubmit();
      return;
    }
    // The earlier-notes block is a div, so give it button-like keyboard access
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.od-notes[data-edit]')) {
      e.preventDefault();
      startDetailEdit('notes', e.target);
    }
  }, { signal });
  // Stage and owner use the shared dropdown, which reports picks as a change on its hidden input
  panel.addEventListener('change', (e) => {
    if (e.target.id === 'od-stage') saveDetailStage(e.target.value);
    if (e.target.id === 'od-owner') saveDetailOwner(e.target.value);
  }, { signal });
  // Escape closes the deal, unless it is closing a dropdown, an editor or a dialog on top
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || modal.style.display === 'none') return;
    if (document.querySelector('.crm-dd.is-open')) return;
    // An open date picker closes first
    const dayPicker = document.querySelector('#opportunity-detail [data-draft="task-day"]')?._customCalendar;
    if (dayPicker?.isOpen) {
      dayPicker.close();
      return;
    }
    if (document.activeElement?.classList.contains('od-input')) return;
    // In an add box, Escape just leaves the box so a half-typed note isn't lost
    if (document.activeElement?.closest?.('[data-composer]')) {
      document.activeElement.blur();
      return;
    }
    if (document.getElementById('confirm-dialog')?.style.display === 'flex') return;
    closeModal('opportunity-view-modal');
  }, { capture: true, signal });

  renderOpportunityDetail();
  modal.style.display = 'flex';
  document.body.classList.add('modal-active');
  panel.querySelector('.od-body')?.scrollTo(0, 0);

  // Tasks, notes and the team (owner picker, note authors) load after the panel shows
  const current = detail;
  Promise.all([
    fetchDealTasks(opportunity.id),
    fetchDealNotes(opportunity.id),
    getCachedTeamMembers() || loadOrgTeamMembers(),
  ]).then(([tasks, notes]) => {
    if (detail !== current) return;
    detail.tasks = tasks;
    detail.notes = notes;
    renderOpportunityDetail();
  });
}

function renderOpportunityDetail() {
  const panel = document.getElementById('opportunity-detail');
  if (!panel || !detail) return;
  const opp = detail.opportunity;

  const pipeline = getCachedActivePipeline();
  const stages = getPipelineStages(pipeline);
  const stageId = opp.mappedStage || resolveStageId(opp.stage, stages, pipeline.is_default);
  const stage = stages.find(s => s.id === stageId) || stages[0];
  const stageTitle = plainStageTitle(stage?.title);
  const isClosed = Boolean(getStageOutcome(stageId));
  const canEdit = canEditOpportunity(opp);

  const company = findCompanyForOpportunity(opp);
  const isCrmCompany = Boolean(company?.id);
  const companyName = opp.company_name || company?.name || '';
  const subsector = (opp.subsector || company?.subsector || '').trim();
  const logoUrl = getOpportunityLogoUrl(company);

  // A value the user can click to edit, or plain text for people who can't edit
  const editable = (field, html, emptyText) => {
    if (!canEdit) return `<span class="od-readonly${html ? '' : ' is-empty'}">${html || '—'}</span>`;
    return `<button type="button" class="od-editable${html ? '' : ' is-empty'}" data-edit="${field}">${html || escapeHtml(emptyText)}</button>`;
  };
  const prop = (key, label, iconKey, valueHtml) => `
    <div class="od-prop" data-prop="${key}">
      <dt class="od-prop-label">${detailIcon(DETAIL_ICONS[iconKey])}${label}</dt>
      <dd class="od-prop-value">${valueHtml}</dd>
    </div>`;

  // Stage, and how long the deal has sat in it
  const stageDays = daysSince(getStageEnteredAt(opp));
  const isStale = !isClosed && stageDays >= STALE_STAGE_DAYS;
  const stageAge = `<span class="od-muted${isStale ? ' is-warning' : ''}"${isStale ? ' title="No stage change in a while, may be stuck"' : ''}>${stageDays === 0 ? 'since today' : `for ${stageDays} day${stageDays === 1 ? '' : 's'}`}</span>`;
  const stageControl = canEdit
    ? window.buildCrmDropdown({
      id: 'od-stage',
      options: stages.map(s => ({ value: s.id, label: plainStageTitle(s.title) })),
      value: stageId,
      variant: 'inline',
    })
    : `<span class="od-readonly">${escapeHtml(stageTitle)}</span>`;
  const stageHtml = `<span class="od-stage" style="--stage-color:${escapeHtml(stage?.color || '#94a3b8')}">${stageControl}</span>${stageAge}`;

  // Value, with the weighted amount for open deals
  const value = dealValue(opp);
  const probability = dealProbability(opp);
  const weighted = !isClosed && hasDealValue(opp)
    ? `<span class="od-muted">${escapeHtml(formatMoney(value * probability / 100))} weighted</span>`
    : '';
  const valueHtml = editable('value', hasDealValue(opp) ? escapeHtml(formatCurrency(value)) : '', 'Add value') + weighted;

  // Win chance: set by the stage, editable on open deals
  const stageProbability = getStageProbability(stageId, stages);
  let probabilityHtml;
  if (isClosed) {
    probabilityHtml = `<span class="od-readonly">${probability}%</span><span class="od-muted">set by stage</span>`;
  } else {
    probabilityHtml = editable('probability', `${probability}%`, '');
    if (canEdit && probability !== stageProbability) {
      probabilityHtml += `<button type="button" class="od-link" data-action="reset-probability">Reset to ${stageProbability}%</button>`;
    } else if (probability === stageProbability) {
      probabilityHtml += `<span class="od-muted">${escapeHtml(stageTitle)} default</span>`;
    }
  }

  // Owner: managers can reassign
  const ownerName = fullName(opp.profiles);
  const members = state.isManager && canEdit ? getCachedTeamMembers() : null;
  let ownerHtml;
  if (members) {
    const ownerId = opp.user_id || '';
    const options = members.map(m => ({ value: m.id, label: fullName(m) || m.email || 'Team member' }));
    // Keep an owner who has left selectable, so the picker shows who it is
    if (ownerId && !members.some(m => m.id === ownerId)) options.unshift({ value: ownerId, label: ownerName || 'Former team member' });
    if (!ownerId) options.unshift({ value: '', label: 'No owner' });
    ownerHtml = window.buildCrmDropdown({ id: 'od-owner', options, value: ownerId, placeholder: 'No owner', variant: 'inline', searchable: options.length > 8, searchPlaceholder: 'Search team…' });
  } else {
    ownerHtml = ownerName
      ? renderPersonChip(opp.user_id, ownerName, opp.profiles?.avatar_url)
      : '<span class="od-readonly is-empty">No owner</span>';
  }

  // Next step: the earliest open task on the deal
  const dueHtml = (day) => {
    const label = formatDueDate(day);
    if (!label) return '';
    const status = getDueStatus(day);
    return `<span class="od-due${status ? ` is-${status}` : ''}">${escapeHtml(label)}${status === 'overdue' ? ' · overdue' : ''}</span>`;
  };
  const nextTask = Array.isArray(detail.tasks) ? getNextOpenTask(detail.tasks) : null;
  let nextStepHtml;
  if (nextTask) {
    nextStepHtml = `
      <span class="od-next-step">
        ${canEdit ? `<button type="button" class="od-check" data-action="toggle-task" data-task-id="${escapeHtml(nextTask.id)}" title="Mark done" aria-label="Mark “${escapeHtml(nextTask.title)}” done"></button>` : ''}
        <button type="button" class="od-plain-link" data-action="open-task-id" data-task-id="${escapeHtml(nextTask.id)}">${escapeHtml(nextTask.title)}</button>
      </span>${dueHtml(timestampToDay(nextTask.due_date))}`;
  } else if (opp.next_step && detail.tasks !== undefined) {
    // Typed on the deal before next steps were tasks
    nextStepHtml = `<span class="od-readonly">${escapeHtml(opp.next_step)}</span>${dueHtml(opp.next_step_date)}`
      + (canEdit ? '<button type="button" class="od-link" data-action="add-next-step">Make it a task</button>' : '');
  } else if (detail.tasks === undefined) {
    nextStepHtml = `<span class="od-readonly is-empty">${opp.next_step ? escapeHtml(opp.next_step) : 'Loading…'}</span>`;
  } else {
    nextStepHtml = canEdit
      ? '<button type="button" class="od-editable is-empty" data-action="add-next-step">Add next step</button>'
      : '<span class="od-readonly is-empty">None</span>';
  }

  // Only someone actually tagged on the deal, never a guess from whoever works at the company
  const contact = Array.isArray(opp.mentioned_people) ? opp.mentioned_people.find(p => p?.name) : null;
  const contactHtml = contact
    ? `<button type="button" class="od-link od-link--strong" data-action="open-contact">${escapeHtml(contact.name)}</button>`
    : '<span class="od-readonly is-empty">None</span>';

  const competitors = parseCompetitors(opp.competitors);
  const competitorsHtml = competitors.length
    ? competitors.map(c => `<span class="od-tag">${escapeHtml(c)}</span>`).join('')
    : '<span class="od-readonly is-empty">None</span>';

  const teammates = (opp.assignees || []).filter(a => a.user_id !== opp.user_id);
  const teamHtml = teammates.length
    ? teammates.map(a => renderPersonChip(a.user_id, fullName(a.profiles) || 'Team member', a.profiles?.avatar_url)).join('')
    : '<span class="od-readonly is-empty">None</span>';

  // Calls for the deal's company
  const matchesCompany = (companyId, name) => (isCrmCompany && companyId != null && String(companyId) === String(company.id))
    || (!isCrmCompany && opp.company_name && name && name.trim().toLowerCase() === opp.company_name.trim().toLowerCase());
  detail.calls = Array.isArray(window.allCallLogsData)
    ? window.allCallLogsData.filter(c => matchesCompany(c.company_id, c.company_name))
    : [];

  const loadingHtml = '<p class="od-empty">Loading…</p>';
  const memberFullName = (userId) => fullName((getCachedTeamMembers() || []).find(m => m.id === userId))
    || (userId === state.currentUser?.id ? 'You' : 'Teammate');
  const memberName = (userId) => (userId === state.currentUser?.id ? 'You' : memberFullName(userId));

  let tabHtml;
  if (detail.tab === 'activity') {
    tabHtml = detail.calls.length
      ? `<div class="od-list">${detail.calls.map((c, i) => `
          <button type="button" class="od-item" data-action="open-call" data-index="${i}">
            <span class="od-item-dot" style="background:${c.direction === 'Inbound' ? 'var(--color-success)' : 'var(--color-primary)'}"></span>
            <span class="od-item-main">
              <span class="od-item-title">${escapeHtml(c.contact_name || c.people?.name || 'Call')}</span>
              <span class="od-item-meta">${[c.outcome || 'Logged', c.duration_seconds ? `${Math.round(c.duration_seconds / 60)} min` : '', fullName(c.profiles), formatDateWithTime(c.call_at)].filter(Boolean).map(escapeHtml).join(' · ')}</span>
              ${c.notes ? `<span class="od-item-note">${escapeHtml(c.notes.slice(0, 140))}${c.notes.length > 140 ? '…' : ''}</span>` : ''}
            </span>
          </button>`).join('')}</div>`
      : `<p class="od-empty">No calls logged for ${companyName ? escapeHtml(companyName) : 'this company'} yet.</p>`;
  } else if (detail.tab === 'tasks') {
    const composer = canEdit ? `
      <form class="od-composer od-composer--task" data-composer="task" autocomplete="off">
        <input type="text" name="title" class="od-composer-input" data-draft="task-title" placeholder="Add a task, e.g. Send the price list" aria-label="New task" required>
        <input type="date" name="day" class="od-composer-date" data-draft="task-day" aria-label="Due date">
        <button type="submit" class="od-composer-btn">Add</button>
      </form>` : '';
    let list;
    if (detail.tasks === undefined) list = loadingHtml;
    else if (detail.tasks === null) list = '<p class="od-empty">Couldn\'t load tasks for this deal.</p>';
    else if (!detail.tasks.length) list = `<p class="od-empty">${canEdit ? 'No tasks yet. The first open task is the deal\'s next step.' : 'No tasks yet.'}</p>`;
    else {
      list = `<div class="od-list">${sortDealTasks(detail.tasks).map(t => {
        const done = t.status === 'completed';
        const day = timestampToDay(t.due_date);
        const assignee = t.assigned_to ? memberName(t.assigned_to) : '';
        return `
          <div class="od-task${done ? ' is-done' : ''}">
            ${canEdit ? `<button type="button" class="od-check${done ? ' is-checked' : ''}" data-action="toggle-task" data-task-id="${escapeHtml(t.id)}" title="${done ? 'Mark not done' : 'Mark done'}" aria-label="${done ? 'Mark not done' : 'Mark done'}: ${escapeHtml(t.title)}"></button>` : ''}
            <button type="button" class="od-task-main" data-action="open-task-id" data-task-id="${escapeHtml(t.id)}">
              <span class="od-item-title">${escapeHtml(t.title)}</span>
              <span class="od-item-meta">${[day ? (done ? formatDueDate(day) : dueHtml(day)) : 'No due date', assignee ? escapeHtml(assignee) : ''].filter(Boolean).join(' · ')}</span>
            </button>
          </div>`;
      }).join('')}</div>`;
    }
    tabHtml = composer + list;
  } else {
    const composer = canEdit ? `
      <form class="od-composer od-composer--note" data-composer="note">
        <textarea name="content" class="od-composer-input" data-draft="note" rows="2" placeholder="Write a note…" aria-label="New note" required></textarea>
        <div class="od-composer-actions">
          <span class="od-muted">Saved to Notes · ⌘↵ to add</span>
          <button type="submit" class="od-composer-btn">Add note</button>
        </div>
      </form>` : '';
    let list;
    if (detail.notes === undefined) list = loadingHtml;
    else if (detail.notes === null) list = '<p class="od-empty">Couldn\'t load notes for this deal.</p>';
    else {
      list = detail.notes.map(n => `
        <article class="od-note">
          <header class="od-note-head">
            <span class="od-person-avatar" style="background:${getAssigneeColor(n.user_id)}">${escapeHtml(getInitials(memberFullName(n.user_id)))}</span>
            <span class="od-note-author">${escapeHtml(memberName(n.user_id))}</span>
            <span class="od-muted">${escapeHtml(formatDateWithTime(n.created_at))}</span>
            ${n.user_id === state.currentUser?.id ? `<button type="button" class="od-icon-btn od-note-delete is-danger" data-action="delete-note" data-note-id="${escapeHtml(n.id)}" title="Delete note" aria-label="Delete note">${detailIcon(DETAIL_ICONS.trash)}</button>` : ''}
          </header>
          <div class="od-note-body">${escapeHtml(noteContentToText(n.content))}</div>
        </article>`).join('');
    }
    // Notes typed on the deal itself before notes were linked
    const legacyHtml = renderNotesHtml(opp);
    if (legacyHtml) {
      list += `
        <article class="od-note od-note--legacy">
          <header class="od-note-head"><span class="od-note-author">Earlier notes on this deal</span></header>
          ${canEdit
            ? `<div class="od-notes" data-edit="notes" role="button" tabindex="0" aria-label="Edit earlier notes">${legacyHtml}</div>`
            : `<div class="od-notes is-readonly">${legacyHtml}</div>`}
        </article>`;
    }
    if (!list) list = '<p class="od-empty">No notes yet.</p>';
    tabHtml = composer + `<div class="od-notes-list">${list}</div>`;
  }
  const openTaskCount = Array.isArray(detail.tasks) ? detail.tasks.filter(t => t.status !== 'completed').length : null;
  const noteCount = Array.isArray(detail.notes) ? detail.notes.length + (opp.notes ? 1 : 0) : null;
  const tab = (key, label, count) => `<button type="button" role="tab" class="od-tab${detail.tab === key ? ' is-active' : ''}" data-tab="${key}" aria-selected="${detail.tab === key}">${label}${count != null ? `<span class="od-count">${count}</span>` : ''}</button>`;

  const showCompany = companyName && (isCrmCompany || !dealNameRepeatsCompany(opp.name, companyName));
  const companyHtml = !showCompany ? '' : isCrmCompany
    ? `<button type="button" class="od-company is-link" data-action="open-company" title="Open ${escapeHtml(companyName)}">${detailIcon(DETAIL_ICONS.company)}${escapeHtml(companyName)}</button>`
    : `<span class="od-company">${detailIcon(DETAIL_ICONS.company)}${escapeHtml(companyName)}</span>`;
  const subtitle = [companyHtml, subsector ? `<span>${escapeHtml(subsector)}</span>` : ''].filter(Boolean).join('<span class="od-dot">·</span>');

  const title = escapeHtml(opp.name || 'Untitled deal');
  const updated = opp.updated_at || opp.created_at;

  // Keep the scroll position, and anything typed in the add boxes, when a save re-renders the panel
  const scrollTop = panel.querySelector('.od-body')?.scrollTop || 0;
  panel.querySelectorAll('[data-draft]').forEach(el => { detail.drafts[el.dataset.draft] = el.value; });
  const focusedDraft = panel.contains(document.activeElement) ? document.activeElement.dataset?.draft : null;

  panel.innerHTML = `
    <header class="od-header">
      <span class="od-avatar" aria-hidden="true">
        <span class="opp-avatar-initials">${escapeHtml(getInitials(companyName || opp.name || '?'))}</span>
        ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="" onload="this.previousElementSibling.style.visibility='hidden'" onerror="this.remove()" />` : ''}
      </span>
      <div class="od-heading">
        ${canEdit
          ? `<button type="button" class="od-title od-editable" id="od-title" data-edit="name">${title}</button>`
          : `<h2 class="od-title" id="od-title">${title}</h2>`}
        ${subtitle ? `<div class="od-subtitle">${subtitle}</div>` : ''}
      </div>
      <div class="od-actions">
        ${canEdit ? `
          <button type="button" class="od-icon-btn" data-action="edit" title="Edit all fields" aria-label="Edit all fields">${detailIcon(DETAIL_ICONS.edit)}</button>
          <button type="button" class="od-icon-btn is-danger" data-action="delete" title="Delete deal" aria-label="Delete deal">${detailIcon(DETAIL_ICONS.trash)}</button>` : ''}
        <button type="button" class="od-icon-btn" data-action="close" title="Close" aria-label="Close">${detailIcon(DETAIL_ICONS.close)}</button>
      </div>
    </header>

    <div class="od-body">
      <dl class="od-props">
        ${prop('stage', 'Stage', 'stage', stageHtml)}
        ${prop('value', 'Value', 'value', valueHtml)}
        ${prop('probability', 'Win chance', 'probability', probabilityHtml)}
        ${prop('owner', 'Owner', 'owner', ownerHtml)}
        ${prop('next_step', 'Next step', 'nextStep', nextStepHtml)}
        ${prop('contact', 'Contact', 'contact', contactHtml)}
        ${prop('competitors', 'Competitors', 'competitors', competitorsHtml)}
        ${prop('team', 'Teammates', 'team', teamHtml)}
      </dl>

      <div class="od-tabs" role="tablist">
        ${tab('notes', 'Notes', noteCount)}
        ${tab('tasks', 'Tasks', openTaskCount)}
        ${tab('activity', 'Calls', detail.calls.length)}
      </div>
      <div class="od-tab-panel" role="tabpanel">${tabHtml}</div>
    </div>

    <footer class="od-footer">
      <span>Created ${escapeHtml(formatDate(opp.created_at))}</span>
      ${updated && updated !== opp.created_at ? `<span class="od-dot">·</span><span>Updated ${escapeHtml(formatDate(updated))}</span>` : ''}
    </footer>`;

  window.initAllCrmDropdowns?.(panel);
  panel.querySelectorAll('[data-draft]').forEach(el => { el.value = detail.drafts[el.dataset.draft] || ''; });
  // The task due date uses the app's date picker, like the deal form
  window.initCustomCalendar?.('#opportunity-detail [data-draft="task-day"]', { type: 'date' });
  if (focusedDraft) panel.querySelector(`[data-draft="${focusedDraft}"]`)?.focus();
  const body = panel.querySelector('.od-body');
  if (body) body.scrollTop = scrollTop;
}

function onDetailClick(e) {
  if (!detail) return;
  const opp = detail.opportunity;

  const mention = e.target.closest('.mentioned-person');
  if (mention) {
    e.stopPropagation();
    closeModal('opportunity-view-modal');
    setTimeout(() => openPersonViewModal(mention.dataset.personId), 120);
    return;
  }

  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) {
    detail.tab = tabBtn.dataset.tab;
    renderOpportunityDetail();
    return;
  }

  const editTarget = e.target.closest('[data-edit]');
  if (editTarget) {
    startDetailEdit(editTarget.dataset.edit, editTarget);
    return;
  }

  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  const index = Number(e.target.closest('[data-index]')?.dataset.index);

  if (action === 'close') {
    closeModal('opportunity-view-modal');
  } else if (action === 'edit') {
    closeModal('opportunity-view-modal');
    openOpportunityModal(opp);
  } else if (action === 'delete') {
    deleteOpportunity(opp).then(deleted => { if (deleted) closeModal('opportunity-view-modal'); });
  } else if (action === 'open-company') {
    const company = findCompanyForOpportunity(opp);
    if (!company?.id) return;
    closeModal('opportunity-view-modal');
    setTimeout(() => openCompanyViewModal(company.id), 120);
  } else if (action === 'open-contact') {
    const contact = (opp.mentioned_people || []).find(p => p?.name);
    if (!contact) return;
    closeModal('opportunity-view-modal');
    setTimeout(() => openPersonViewModal(contact.id || contact), 120);
  } else if (action === 'reset-probability') {
    const stages = getPipelineStages(getCachedActivePipeline());
    const stageId = opp.mappedStage || opp.stage;
    saveDealPatch({ probability: getStageProbability(stageId, stages) }).then(renderOpportunityDetail);
  } else if (action === 'open-call' && detail.calls[index]) {
    const call = detail.calls[index];
    closeModal('opportunity-view-modal');
    setTimeout(() => openCallLogViewModal(call), 120);
  } else if (action === 'add-next-step') {
    // Next steps are tasks: open the Tasks tab with the old next step ready to add
    detail.tab = 'tasks';
    if (!detail.drafts['task-title'] && opp.next_step && !getNextOpenTask(detail.tasks || [])) {
      detail.drafts['task-title'] = opp.next_step;
      detail.drafts['task-day'] = opp.next_step_date ? String(opp.next_step_date).slice(0, 10) : '';
    }
    renderOpportunityDetail();
    document.querySelector('#opportunity-detail [data-draft="task-title"]')?.focus();
  } else if (action === 'toggle-task') {
    toggleDealTask(e.target.closest('[data-task-id]').dataset.taskId);
  } else if (action === 'open-task-id') {
    const task = (detail.tasks || []).find(t => t.id === e.target.closest('[data-task-id]').dataset.taskId);
    if (!task) return;
    closeModal('opportunity-view-modal');
    setTimeout(() => showTaskDetail(task, window.salesRepsData || []), 120);
  } else if (action === 'delete-note') {
    deleteDealNote(e.target.closest('[data-note-id]').dataset.noteId);
  }
}

/** The add-task and add-note boxes */
async function onDetailSubmit(e) {
  const form = e.target.closest('[data-composer]');
  if (!form || !detail) return;
  e.preventDefault();
  const opp = detail.opportunity;
  const button = form.querySelector('[type="submit"]');
  const kind = form.dataset.composer;

  if (kind === 'task') {
    const title = form.elements.title.value.trim();
    const day = form.elements.day.value;
    if (!title) return;
    button.disabled = true;
    try {
      const task = await createDealTask(opp, { title, day });
      detail.tasks = [...(detail.tasks || []), task];
      detail.drafts['task-title'] = '';
      detail.drafts['task-day'] = '';
      form.reset();
      showToast('Task added', 'success');
      await syncDealNextStep();
    } catch (err) {
      showToast(`Couldn't add the task: ${err.message}`, 'error');
    }
  } else if (kind === 'note') {
    const content = form.elements.content.value.trim();
    if (!content) return;
    button.disabled = true;
    try {
      const note = await createDealNote(opp, content);
      detail.notes = [note, ...(detail.notes || [])];
      detail.drafts.note = '';
      form.reset();
      showToast('Note added', 'success');
    } catch (err) {
      showToast(`Couldn't add the note: ${err.message}`, 'error');
    }
  }
  button.disabled = false;
  renderOpportunityDetail();
}

async function toggleDealTask(taskId) {
  const task = (detail?.tasks || []).find(t => t.id === taskId);
  if (!task) return;
  const status = task.status === 'completed' ? 'pending' : 'completed';
  const updated_at = new Date().toISOString();
  const { data, error } = await supabaseClient.from('tasks').update({ status, updated_at }).eq('id', taskId).select('id');
  if (error || !data?.length) {
    showToast(error ? `Couldn't update the task: ${error.message}` : "You can't change this task.", 'error');
    return;
  }
  Object.assign(task, { status, updated_at });
  if (status === 'completed') showToast('Task done', 'success');
  document.dispatchEvent(new CustomEvent('safitrack:mutation', { detail: { table: 'tasks', action: status === 'completed' ? 'complete' : 'update', id: taskId } }));
  await syncDealNextStep();
  renderOpportunityDetail();
}

async function deleteDealNote(noteId) {
  if (!detail?.notes) return;
  if (!await showConfirmDialog('Delete note', 'Delete this note? It will also be removed from Notes.')) return;
  const { data, error } = await supabaseClient.from('notes').delete().eq('id', noteId).select('id');
  if (error || !data?.length) {
    showToast(error ? `Couldn't delete the note: ${error.message}` : "This note couldn't be deleted.", 'error');
    return;
  }
  detail.notes = detail.notes.filter(n => n.id !== noteId);
  renderOpportunityDetail();
}

/** Copy the earliest open task onto the deal's next_step fields, which the board,
 *  filters and reports read */
async function syncDealNextStep() {
  const opp = detail?.opportunity;
  if (!opp || !Array.isArray(detail.tasks)) return;
  const fields = nextStepFieldsFromTasks(detail.tasks);
  const currentDay = opp.next_step_date ? String(opp.next_step_date).slice(0, 10) : null;
  if ((opp.next_step || null) === fields.next_step && currentDay === fields.next_step_date) {
    refreshPipelineIfVisible();
    return;
  }
  await saveDealPatch(fields);
}

/** Swap a value for an input. Enter or leaving the field saves, Escape cancels. */
function startDetailEdit(field, anchor) {
  const opp = detail?.opportunity;
  if (!opp || !canEditOpportunity(opp)) return;

  const config = {
    name: { type: 'text', value: opp.name || '', placeholder: 'Deal name' },
    value: { type: 'number', value: hasDealValue(opp) ? String(opp.value) : '', placeholder: 'e.g. 25000', min: '0', step: '0.01' },
    probability: { type: 'number', value: String(dealProbability(opp)), min: '0', max: '100', step: '1' },
    notes: { type: 'textarea', value: opp.notes || '', placeholder: 'Add notes…' },
  }[field];
  if (!config) return;

  const input = document.createElement(config.type === 'textarea' ? 'textarea' : 'input');
  if (config.type !== 'textarea') input.type = config.type;
  input.className = `od-input od-input--${field}`;
  input.value = config.value;
  if (config.placeholder) input.placeholder = config.placeholder;
  ['min', 'max', 'step'].forEach(attr => { if (config[attr]) input.setAttribute(attr, config[attr]); });
  if (config.type === 'textarea') input.rows = Math.max(5, config.value.split('\n').length + 1);

  anchor.replaceWith(input);
  input.focus();
  if (config.type === 'text' || config.type === 'number') input.select();

  let finished = false;
  const finish = async (save, { refocus = false } = {}) => {
    if (finished) return;
    finished = true;
    const patch = save ? parseDetailEdit(field, input.value, opp) : null;
    if (!patch) {
      // Nothing to save: put the value back without redrawing, so a click that
      // moved focus to another field still lands on it
      input.replaceWith(anchor);
      if (refocus) anchor.focus();
      return;
    }
    input.disabled = true;
    await saveDealPatch(patch);
    // If another field was opened meanwhile, it redraws the panel when it closes
    if (!document.querySelector('#opportunity-detail .od-input:not(:disabled)')) renderOpportunityDetail();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      finish(false, { refocus: true });
    } else if (e.key === 'Enter' && (config.type !== 'textarea' || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      finish(true, { refocus: true });
    }
  });
  input.addEventListener('blur', () => finish(true));
}

/** The update for an edited field, or nothing when it's unchanged or invalid */
function parseDetailEdit(field, raw, opp) {
  const text = raw.trim();
  if (field === 'name') {
    if (!text) { showToast("Deal name can't be empty", 'error'); return null; }
    return text === opp.name ? null : { name: text };
  }
  if (field === 'value') {
    if (!text) return hasDealValue(opp) ? { value: null } : null;
    const amount = parseFloat(text);
    if (!(amount >= 0)) { showToast('Deal value must be a positive number', 'error'); return null; }
    return hasDealValue(opp) && amount === dealValue(opp) ? null : { value: amount };
  }
  if (field === 'probability') {
    const p = parseInt(text, 10);
    if (Number.isNaN(p) || p < 0 || p > 100) { showToast('Win chance must be between 0 and 100', 'error'); return null; }
    return p === dealProbability(opp) ? null : { probability: p };
  }
  if (field === 'notes') {
    if (text === (opp.notes || '').trim()) return null;
    // Drop links to people whose @mention was deleted from the text
    const mentioned = (opp.mentioned_people || []).filter(p => p?.name && text.toLowerCase().includes(`@${p.name.trim().toLowerCase()}`));
    return { notes: text || null, mentioned_people: mentioned };
  }
  return null;
}

/** Save fields on the open deal, then refresh the board behind it */
async function saveDealPatch(patch) {
  const opp = detail?.opportunity;
  if (!opp) return false;
  const updates = { ...patch, updated_at: new Date().toISOString() };

  const { data, error } = await supabaseClient
    .from('opportunities')
    .update(updates)
    .eq('id', opp.id)
    .select('id');
  if (error) {
    showToast(`Couldn't save: ${error.message}`, 'error');
    return false;
  }
  // Row-level security skips rows it won't update instead of returning an error
  if (!data || data.length === 0) {
    showToast("This deal couldn't be saved. You may not have permission.", 'error');
    return false;
  }

  Object.assign(opp, updates);
  // stage_changed_at is set by the database trigger; mirror it locally
  if ('stage' in patch) Object.assign(opp, { mappedStage: patch.stage, stage_changed_at: updates.updated_at });
  refreshPipelineIfVisible();
  return true;
}

async function saveDetailStage(newStage) {
  const opp = detail?.opportunity;
  if (!opp) return;
  const pipeline = getCachedActivePipeline();
  const stages = getPipelineStages(pipeline);
  const oldStage = opp.mappedStage || resolveStageId(opp.stage, stages, pipeline.is_default);
  if (!newStage || newStage === oldStage) return;

  // The win chance moves with the stage (Won/Lost always settle it), unless it was set by hand
  const patch = { stage: newStage };
  if (getStageOutcome(newStage) || probabilityFollowsStage(opp, oldStage, stages)) {
    patch.probability = getStageProbability(newStage, stages);
  }
  if (await saveDealPatch(patch) && getStageOutcome(newStage) === 'won') triggerConfetti();
  renderOpportunityDetail();
}

async function saveDetailOwner(ownerId) {
  const opp = detail?.opportunity;
  if (!opp || (ownerId || null) === (opp.user_id || null)) return;
  const member = (getCachedTeamMembers() || []).find(m => m.id === ownerId);
  if (await saveDealPatch({ user_id: ownerId || null })) {
    opp.profiles = member
      ? { id: member.id, first_name: member.first_name, last_name: member.last_name, email: member.email, role: member.role, avatar_url: member.avatar_url }
      : null;
    showToast(member ? `Deal moved to ${fullName(member) || 'new owner'}` : 'Owner removed', 'success');
  }
  renderOpportunityDetail();
}

/** Deleting follows the same rule as editing. */
function canDeleteOpportunity(opportunity) {
  return canEditOpportunity(opportunity);
}

/** Confirm, delete and refresh the pipeline. Resolves true when the deal was deleted. */
async function deleteOpportunity(opportunity) {
  if (!canDeleteOpportunity(opportunity)) return false;

  // The deal's tasks and notes are deleted with it (the database cascades),
  // so say how many before asking
  const countLinked = (table) => supabaseClient
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('opportunity_id', opportunity.id)
    .then(({ count, error }) => (error ? 0 : count || 0));
  const [taskCount, noteCount] = await Promise.all([countLinked('tasks'), countLinked('notes')]);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const linked = [taskCount && plural(taskCount, 'task'), noteCount && plural(noteCount, 'note')].filter(Boolean);

  const ownerName = fullName(opportunity.profiles);
  const message = [
    `Are you sure you want to delete ${opportunity.name}?`,
    opportunity.user_id !== state.currentUser.id && ownerName ? `This deal belongs to ${ownerName}.` : '',
    linked.length ? `Its ${linked.join(' and ')} will be deleted too.` : '',
  ].filter(Boolean).join(' ');

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

  showToast(linked.length ? `Deal deleted, with its ${linked.join(' and ')}` : 'Deal deleted', 'success');
  if (taskCount) {
    // Task counts and reminders elsewhere in the app drop the deleted tasks
    document.dispatchEvent(new CustomEvent('safitrack:notification-refresh'));
  }
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


function setProbabilityInput(value) {
  const input = document.getElementById('opportunity-probability');
  if (input) input.value = value;
}

/** "Lead default: 10%", plus a Reset button once the win chance was set by hand.
 *  Won and Lost fix the win chance, so the input is locked there. */
function updateProbabilityHint(stageId, stages) {
  const hint = document.getElementById('probability-stage-hint');
  const resetBtn = document.getElementById('probability-reset-btn');
  const input = document.getElementById('opportunity-probability');
  const stage = stages.find(s => s.id === stageId);
  const stageProbability = getStageProbability(stageId, stages);
  const isClosed = Boolean(getStageOutcome(stageId));
  if (hint) hint.textContent = stage ? `${plainStageTitle(stage.title)} ${isClosed ? 'is always' : 'default'} ${stageProbability}%` : '';
  if (resetBtn) resetBtn.hidden = isClosed || Number(input?.value) === stageProbability;
  if (input) input.disabled = isClosed;
}

function initOpportunityModalListeners(opportunity) {
  opportunityModalListeners?.abort();
  opportunityModalListeners = new AbortController();
  const { signal } = opportunityModalListeners;

  // Initialize assignees picker
  initAssigneesPicker(signal);

  // Win chance
  const stages = getPipelineStages(getCachedActivePipeline());
  const stageInput = document.getElementById('opportunity-stage');
  document.getElementById('opportunity-probability')?.addEventListener('input', () => {
    updateProbabilityHint(stageInput?.value, stages);
  }, { signal });

  document.getElementById('probability-reset-btn')?.addEventListener('click', () => {
    setProbabilityInput(getStageProbability(stageInput?.value, stages));
    updateProbabilityHint(stageInput?.value, stages);
  }, { signal });

  // The win chance follows the stage unless it was set by hand; Won and Lost always settle it
  let previousStage = stageInput?.value;
  stageInput?.addEventListener('change', (e) => {
    const newStage = e.target.value;
    const current = Number(document.getElementById('opportunity-probability')?.value);
    if (probabilityFollowsStage({ probability: current }, previousStage, stages) || getStageOutcome(newStage)) {
      setProbabilityInput(getStageProbability(newStage, stages));
    }
    previousStage = newStage;
    updateProbabilityHint(newStage, stages);
  }, { signal });
  updateProbabilityHint(stageInput?.value, stages);

  // The new owner is no longer also a tagged teammate
  document.getElementById('opportunity-owner')?.addEventListener('change', (e) => {
    const ownerId = e.target.value;
    if (!ownerId) return;
    state.opportunityAssignees = state.opportunityAssignees.filter(a => a.user_id !== ownerId);
    document.querySelector(`#opp-assignees-chips .opp-token[data-user-id="${CSS.escape(ownerId)}"]`)?.remove();
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
        const { data } = await fetchAllPages(q);
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
          // Name only: descriptions hold phone numbers and delivery notes that crowd the list
          return `
          <div class="search-result-item" role="option" data-company-name="${escapeHtml(company.name)}" data-company-id="${escapeHtml(company.id)}" title="${escapeHtml(company.name)}">
            <div class="opp-suggest-avatar">${avatarInner}</div>
            <span class="search-result-name">${escapeHtml(company.name)}</span>
          </div>`;
        }).join('');
      }

      // Offer the typed name as-is, unless it exactly matches a company above
      const typed = e.target.value.trim();
      const typedKey = typed.toLowerCase();
      const customNameOption = filteredCompanies.some(c => String(c.name || '').trim().toLowerCase() === typedKey) ? '' : `
        <div class="search-result-item search-result-item--custom" role="option" data-company-name="${escapeHtml(typed)}" data-company-id="">
          <div class="opp-suggest-avatar opp-suggest-avatar--custom"><span>+</span></div>
          <span class="search-result-name">Use “${escapeHtml(typed)}”<span class="search-result-hint"> · not in Companies</span></span>
        </div>`;

      companySearchResults.innerHTML = resultsHTML + customNameOption;
      companySearchResults.style.display = 'block';
    }, 300);
  });

  // Arrow keys move through the suggestions, Enter picks one (or keeps the typed name)
  newCompanyInput.addEventListener('keydown', (e) => {
    const items = companySearchResults.style.display === 'none'
      ? []
      : Array.from(companySearchResults.querySelectorAll('.search-result-item[data-company-name]'));
    const active = items.findIndex(item => item.classList.contains('is-active'));
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && items.length) {
      e.preventDefault();
      const next = e.key === 'ArrowDown'
        ? (active + 1) % items.length
        : (active <= 0 ? items.length - 1 : active - 1);
      items.forEach((item, i) => item.classList.toggle('is-active', i === next));
      items[next].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && newCompanyInput.value.trim()) {
      e.preventDefault();
      const item = items[active];
      if (item) selectOpportunityCompany(item.dataset.companyName, item.dataset.companyId);
      else selectOpportunityCompany(newCompanyInput.value.trim());
    } else if (e.key === 'Escape' && companySearchResults.style.display !== 'none') {
      e.stopPropagation();
      companySearchResults.style.display = 'none';
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

  // Competitors: Enter or comma adds a chip, Backspace in an empty box removes the last one
  const competitorsInput = document.getElementById('competitors-input');
  const competitorsField = document.getElementById('competitors-container');

  competitorsInput.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ',') && competitorsInput.value.trim()) {
      e.preventDefault();
      addCompetitor(competitorsInput.value);
      competitorsInput.value = '';
    } else if (e.key === 'Enter') {
      e.preventDefault();
    } else if (e.key === 'Backspace' && !competitorsInput.value) {
      competitorsField.querySelector('.opp-token:last-of-type')?.remove();
    }
  });
  // Commas split names however they arrive (typed, pasted, autocorrected)
  competitorsInput.addEventListener('input', () => {
    if (!competitorsInput.value.includes(',')) return;
    const parts = competitorsInput.value.split(',');
    competitorsInput.value = parts.pop().trimStart();
    parts.forEach(part => addCompetitor(part));
  });
  // A name typed and then left (without Enter) still counts
  competitorsInput.addEventListener('blur', () => {
    if (competitorsInput.value.trim()) {
      addCompetitor(competitorsInput.value);
      competitorsInput.value = '';
    }
  });
  competitorsField.addEventListener('click', (e) => {
    const remove = e.target.closest('.opp-token-remove');
    if (remove) {
      remove.closest('.opp-token').remove();
      competitorsInput.focus();
    } else if (e.target === competitorsField) {
      competitorsInput.focus();
    }
  }, { signal });

  // Save opportunity
  const saveBtn = document.getElementById('save-opportunity-btn');

  saveBtn.onclick = async () => {
    const name = document.getElementById('opportunity-name').value.trim();
    const companyName = document.getElementById('opportunity-company').value.trim();
    const formSubsector = document.getElementById('opportunity-subsector').value.trim();
    const value = document.getElementById('opportunity-value').value;
    const stage = document.getElementById('opportunity-stage').value;
    const outcome = getStageOutcome(stage);
    // Won and Lost deals always carry 100% / 0%; an empty or odd entry falls back to the stage
    const typedProbability = parseInt(document.getElementById('opportunity-probability').value, 10);
    const probability = outcome || Number.isNaN(typedProbability)
      ? getStageProbability(stage, stages)
      : Math.min(100, Math.max(0, typedProbability));
    const nextStep = document.getElementById('opportunity-next-step').value.trim();
    const nextStepDate = document.getElementById('opportunity-next-step-date').value;
    const noteText = document.getElementById('opportunity-notes').value.trim();

    // Get competitors, including one typed but not yet added
    const pendingCompetitor = document.getElementById('competitors-input')?.value.trim();
    if (pendingCompetitor) addCompetitor(pendingCompetitor);
    const competitors = Array.from(document.querySelectorAll('#competitors-container .opp-token'), tag => tag.dataset.name);

    // Validate — deal value is optional
    if (!name || !companyName) {
      showToast(!name ? 'Give the deal a name' : 'Pick or type a company', 'error');
      document.getElementById(!name ? 'opportunity-name' : 'opportunity-company')?.focus();
      return;
    }
    if (value !== '' && !(parseFloat(value) >= 0)) {
      showToast('Deal value must be a positive number', 'error');
      return;
    }

    // Only managers pick the owner; a new deal otherwise belongs to whoever creates it
    const ownerId = state.isManager ? (document.getElementById('opportunity-owner')?.value || null) : undefined;

    const idleLabel = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    try {
      // Fields that are safe to update. user_id only changes when a manager
      // picks a different owner. pipeline_id is NOT updated on edit — the
      // opportunity stays in the pipeline it was created in.
      const activePipelineId = state.activePipelineId && state.activePipelineId !== '__default__'
        ? state.activePipelineId
        : null;

      const editableFields = {
        name,
        company_name: companyName,
        subsector: formSubsector || window.selectedOpportunityCompanyData?.subsector || null,
        value: value === '' ? null : value,
        probability,
        stage,
        next_step: nextStep || null,
        next_step_date: nextStepDate || null,
        competitors: competitors.length > 0 ? JSON.stringify(competitors) : null,
        mentioned_people: state.mentionedPeople,
        updated_at: new Date().toISOString(),
      };

      let result;
      let savedOpportunityId;

      if (opportunity) {
        if (ownerId !== undefined && ownerId !== (opportunity.user_id || null)) editableFields.user_id = ownerId;
        result = await supabaseClient
          .from('opportunities')
          .update(editableFields)
          .eq('id', opportunity.id);
        savedOpportunityId = opportunity.id;
      } else {
        // Create — owned by the creator unless a manager picked someone, and tag the pipeline
        result = await supabaseClient
          .from('opportunities')
          .insert([{
            ...editableFields,
            user_id: ownerId || state.currentUser.id,
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

      // The next step is a task on the deal, and the note goes to Notes. The deal
      // is already saved, so a failure here is reported without losing it.
      const savedDeal = { id: savedOpportunityId, name, user_id: editableFields.user_id || opportunity?.user_id || ownerId || state.currentUser.id };
      const followUpErrors = [];
      if (savedOpportunityId) {
        try {
          await saveFormNextStep(savedDeal, state.opportunityFormNextTask, nextStep, nextStepDate, opportunity);
        } catch (err) {
          followUpErrors.push(`the next step task (${err.message})`);
        }
        if (noteText) {
          try {
            await createDealNote(savedDeal, noteText);
          } catch (err) {
            followUpErrors.push(`the note (${err.message})`);
          }
        }
      }

      if (followUpErrors.length) {
        showToast(`Deal saved, but couldn't save ${followUpErrors.join(' or ')}`, 'error');
      } else {
        showToast(opportunity ? 'Deal updated' : 'Deal created', 'success');
      }
      const wasWon = opportunity && getStageOutcome(opportunity.mappedStage || opportunity.stage) === 'won';
      if (outcome === 'won' && !wasWon) triggerConfetti();
      closeModal('opportunity-modal');
      refreshPipelineIfVisible();

      // Set reminder for next step if date is provided
      if (nextStepDate) {
        scheduleNextStepReminder(name, nextStep, nextStepDate);
      }
    } catch (error) {
      showToast(`Couldn't ${opportunity ? 'save' : 'create'} the deal: ${error.message}`, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = idleLabel;
    }
  };
}

/** The form's next step becomes (or edits) the deal's open task. A next step that
 *  was only ever typed on the deal becomes a task once it's changed. */
async function saveFormNextStep(deal, existingTask, title, day, previousDeal) {
  if (existingTask) {
    if (!title) return;
    const changes = {};
    if (title !== existingTask.title) changes.title = title;
    if (day !== timestampToDay(existingTask.due_date)) changes.due_date = dueDateToTimestamp(day);
    if (!Object.keys(changes).length) return;
    const { error } = await supabaseClient
      .from('tasks')
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq('id', existingTask.id);
    if (error) throw error;
    return;
  }
  if (!title) return;
  const unchanged = previousDeal
    && title === (previousDeal.next_step || '')
    && day === (previousDeal.next_step_date ? String(previousDeal.next_step_date).slice(0, 10) : '');
  if (unchanged) return;
  await createDealTask(deal, { title, day });
}

const TOKEN_REMOVE_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

function addCompetitor(rawName) {
  const container = document.getElementById('competitors-container');
  const input = document.getElementById('competitors-input');
  const name = String(rawName || '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name || !container || !input) return;

  // Skip a competitor that's already there (ignoring case)
  const exists = Array.from(container.querySelectorAll('.opp-token'))
    .some(tag => tag.dataset.name.toLowerCase() === name.toLowerCase());
  if (exists) return;

  const tag = document.createElement('span');
  tag.className = 'opp-token';
  tag.dataset.name = name;
  tag.innerHTML = `<span class="opp-token-label">${escapeHtml(name)}</span><button type="button" class="opp-token-remove" aria-label="Remove ${escapeHtml(name)}">${TOKEN_REMOVE_ICON}</button>`;
  container.insertBefore(tag, input);
}

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

  const name = fullName(ownerProfile) || 'Owner';
  const chip = document.createElement('span');
  chip.className = 'opp-token opp-token--owner';
  chip.dataset.userId = ownerId;
  chip.dataset.isOwner = 'true';
  chip.title = `${name} owns this deal`;
  chip.innerHTML = `
    <span class="opp-token-avatar" style="background:${getAssigneeColor(ownerId)}">${renderAvatarContent(name, ownerProfile.avatar_url)}</span>
    <span class="opp-token-label">${escapeHtml(name)}</span>
    <span class="opp-token-meta">Owner</span>`;
  chipsEl.insertBefore(chip, chipsEl.firstChild);
}

/** Append a chip for one assignee to the chips container */
function _appendAssigneeChip(member) {
  const chipsEl = document.getElementById('opp-assignees-chips');
  if (!chipsEl) return;

  const name = fullName(member) || 'Member';
  const roleLabel = member.role === 'manager' ? 'Manager' : member.role === 'technician' ? 'Technician' : 'Sales Rep';
  const chip = document.createElement('span');
  chip.className = 'opp-token';
  chip.dataset.userId = member.user_id;
  chip.title = `${name} · ${roleLabel}`;
  chip.innerHTML = `
    <span class="opp-token-avatar" style="background:${getAssigneeColor(member.user_id)}">${renderAvatarContent(name, member.avatar_url)}</span>
    <span class="opp-token-label">${escapeHtml(name)}</span>
    <button type="button" class="opp-token-remove" aria-label="Remove ${escapeHtml(name)}">${TOKEN_REMOVE_ICON}</button>`;

  chip.querySelector('.opp-token-remove').addEventListener('click', (e) => {
    e.stopPropagation();
    state.opportunityAssignees = state.opportunityAssignees.filter(a => a.user_id !== member.user_id);
    chip.remove();
    document.getElementById('opp-assignees-input')?.focus();
  });

  chipsEl.appendChild(chip);
}

/** Set up the assignees search/picker inside the opportunity modal */
function initAssigneesPicker(signal) {
  const input = document.getElementById('opp-assignees-input');
  const dropdown = document.getElementById('opp-assignees-dropdown');
  const field = document.getElementById('opp-assignees-picker');
  if (!input || !dropdown || !field) return;

  // Clone input to strip old listeners
  const freshInput = input.cloneNode(true);
  input.parentNode.replaceChild(freshInput, input);

  let allMembers = [];
  let options = [];
  let activeIndex = -1;

  const roleLabel = (role) => (role === 'manager' ? 'Manager' : role === 'technician' ? 'Technician' : 'Sales Rep');

  // The owner isn't a teammate: managers pick them in the Owner dropdown, others see the owner chip
  const getOwnerId = () => (state.isManager
    ? document.getElementById('opportunity-owner')?.value
    : document.querySelector('#opp-assignees-chips .opp-token--owner')?.dataset.userId) || null;

  const toggleMember = (member) => {
    const index = state.opportunityAssignees.findIndex(a => a.user_id === member.id);
    if (index >= 0) {
      state.opportunityAssignees.splice(index, 1);
      document.querySelector(`#opp-assignees-chips .opp-token[data-user-id="${CSS.escape(member.id)}"]`)?.remove();
    } else {
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
  };

  const positionDropdown = () => {
    // Below the whole field, or above it when the form runs out of room
    const rect = field.getBoundingClientRect();
    const roomBelow = window.innerHeight - rect.bottom;
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.width = `${rect.width}px`;
    if (roomBelow < 260 && rect.top > roomBelow) {
      dropdown.style.top = 'auto';
      dropdown.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    } else {
      dropdown.style.bottom = 'auto';
      dropdown.style.top = `${rect.bottom + 4}px`;
    }
  };

  const renderDropdown = () => {
    const query = freshInput.value.trim().toLowerCase();
    const ownerId = getOwnerId();
    options = allMembers.filter(m => {
      if (m.id === ownerId) return false;
      const name = fullName(m).toLowerCase();
      return !query || name.includes(query) || (m.email || '').toLowerCase().includes(query);
    });
    activeIndex = Math.min(activeIndex, options.length - 1);
    if (query && activeIndex < 0 && options.length) activeIndex = 0;

    dropdown.innerHTML = options.length
      ? options.map((m, i) => {
        const name = fullName(m) || m.email || 'Team member';
        const isSelected = state.opportunityAssignees.some(a => a.user_id === m.id);
        return `
          <div class="opp-assignee-option${isSelected ? ' is-selected' : ''}${i === activeIndex ? ' is-active' : ''}" role="option" aria-selected="${isSelected}" data-index="${i}">
            <span class="opp-token-avatar" style="background:${getAssigneeColor(m.id)}">${renderAvatarContent(name, m.avatar_url)}</span>
            <span class="opp-assignee-opt-name">${escapeHtml(name)}</span>
            <span class="opp-assignee-opt-role">${escapeHtml(roleLabel(m.role))}</span>
            <svg class="opp-assignee-opt-check" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
          </div>`;
      }).join('')
      : '<div class="opp-assignees-empty">No one matches</div>';
    dropdown.style.display = 'block';
    positionDropdown();
    dropdown.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  };

  // Picking someone keeps the list open so several people can be tagged in a row
  dropdown.addEventListener('mousedown', (e) => {
    const option = e.target.closest('.opp-assignee-option');
    if (!option) return;
    e.preventDefault();
    toggleMember(options[Number(option.dataset.index)]);
    freshInput.value = '';
    activeIndex = Number(option.dataset.index);
    renderDropdown();
  }, { signal });

  field.addEventListener('click', (e) => {
    if (e.target === field || e.target.id === 'opp-assignees-chips') freshInput.focus();
  }, { signal });

  freshInput.addEventListener('focus', async () => {
    if (allMembers.length === 0) allMembers = await loadOrgTeamMembers();
    activeIndex = -1;
    renderDropdown();
  });

  freshInput.addEventListener('input', () => {
    activeIndex = -1;
    renderDropdown();
  });

  freshInput.addEventListener('blur', () => {
    setTimeout(() => { dropdown.style.display = 'none'; }, 120);
  });

  freshInput.addEventListener('keydown', (e) => {
    const isOpen = dropdown.style.display !== 'none';
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && options.length) {
      e.preventDefault();
      if (!isOpen) return renderDropdown();
      activeIndex = e.key === 'ArrowDown'
        ? (activeIndex + 1) % options.length
        : (activeIndex <= 0 ? options.length - 1 : activeIndex - 1);
      renderDropdown();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (isOpen && options[activeIndex]) {
        toggleMember(options[activeIndex]);
        freshInput.value = '';
        renderDropdown();
      }
    } else if (e.key === 'Backspace' && !freshInput.value) {
      // Remove the last teammate chip (never the owner)
      const last = Array.from(document.querySelectorAll('#opp-assignees-chips .opp-token:not(.opp-token--owner)')).pop();
      if (!last) return;
      state.opportunityAssignees = state.opportunityAssignees.filter(a => a.user_id !== last.dataset.userId);
      last.remove();
      if (isOpen) renderDropdown();
    } else if (e.key === 'Escape' && isOpen) {
      e.stopPropagation();
      dropdown.style.display = 'none';
    }
  });

  // Keep the list attached to the field while the form scrolls
  document.querySelector('#opportunity-modal .modal-body')?.addEventListener('scroll', () => {
    if (dropdown.style.display !== 'none') positionDropdown();
  }, { passive: true, signal });
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
  openOpportunityById,
  refreshDealNextStep,
  initOpportunityModalListeners,
  addCompetitor,
  getProbabilityColor,
  scheduleNextStepReminder,
  loadPipelines,
  openManagePipelinesModal,
  openPipelineEditorModal,
};
