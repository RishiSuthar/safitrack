// modules/features/opportunities.js
// Opportunity pipeline: kanban, drag-and-drop, modals.
import { state, supabaseClient, loadPersistedState as _loadPersistedState, saveViewState } from '../state.js';
import { viewContainer } from '../ui/dom.js';
import { showToast, escapeHtml, getInitials, triggerConfetti } from '../ui/toast.js';
import { renderSkeletonCards, renderError, getCurrencySymbol } from '../utils/helpers.js';
import { getCompanyLogoUrl, guessDomainAndFavicon } from '../ui/spreadsheet.js';
import { getDefaultSalesStages, LEGACY_STAGE_TO_CANONICAL } from '../utils/pipeline-stages.js';

// ── Pipeline helpers ──────────────────────────────────────────────────────────

/** Stage color palette for custom pipelines */
const STAGE_COLORS = ['#3b82f6', '#ec4899', '#10b981', '#ef4444', '#f59e0b', '#8b5cf6', '#06b6d4', '#f97316'];
const OPPORTUNITY_STAGE_PAGE_SIZE = 25;

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

/** Update the stage dropdown in the opportunity modal to reflect the active pipeline's stages */
function updateStageDropdownForPipeline(pipeline, currentValue) {
  if (!pipeline?.stages?.length) return;
  const options = pipeline.stages.map(s => ({ value: s.id, label: s.title }));
  window.updateCrmDropdownOptions?.('opportunity-stage', options, false);
  const defaultVal = currentValue || pipeline.stages[0]?.id;
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

  if (opp.company_id != null) {
    const byId = lookup.byId.get(String(opp.company_id));
    if (byId) return byId;
  }

  const normalizedOppName = (window.normalizeForMatching?.(opp.company_name) || String(opp.company_name || '').toLowerCase().trim());
  if (normalizedOppName) {
    const byName = lookup.byName.get(normalizedOppName);
    if (byName) return byName;
  }

  // Keep existing fuzzy behavior as fallback for edge-case name mismatches.
  return window.findCompanyForOpportunity?.(opp) || null;
}

async function renderOpportunityPipelineView() {
  // renderOpportunityPipelineView start (diagnostics removed)
  // Ensure companies cache is ready before rendering opportunities
  if (!Array.isArray(window.allCompaniesData) || window.allCompaniesData.length === 0) {
    try { await loadAllCompanies(); } catch (e) { /* ignored */ }
  }

  // ── Load pipelines & opportunities ───────────────────────────────────────
  const pipelinesPromise = loadPipelines();

  let opportunities;
  let error;

  let opportunitiesPromise;
  if (state.isManager) {
    // Managers see all opportunities in their org
    let mQ = supabaseClient
      .from('opportunities')
      .select(`*, profiles!inner(id, first_name, last_name, email, role, avatar_url)`)
      .order('created_at', { ascending: false });
    if (state.currentOrganization?.id) mQ = mQ.eq('organization_id', state.currentOrganization.id);
    opportunitiesPromise = mQ;
  } else {
    // Sales reps only see their own opportunities
    let oppQ = supabaseClient
      .from('opportunities')
      .select('*')
      .eq('user_id', state.currentUser.id)
      .order('created_at', { ascending: false });
    if (state.currentOrganization?.id) oppQ = oppQ.eq('organization_id', state.currentOrganization.id);
    opportunitiesPromise = oppQ;
  }

  const [pipelines, opportunitiesResult] = await Promise.all([pipelinesPromise, opportunitiesPromise]);
  const activePipeline = getActivePipeline(pipelines);
  setActivePipeline(activePipeline.id);
  opportunities = opportunitiesResult.data;
  error = opportunitiesResult.error;

  if (error) {
    viewContainer.innerHTML = renderError(error.message);
    return;
  }

  // For sales reps: load extra opportunities where they are an assignee but not the owner.
  // Do this BEFORE the assignee batch-load so all opp IDs are known upfront.
  if (!state.isManager) {
    const { data: myAssignedRows } = await supabaseClient
      .from('opportunity_assignees')
      .select('opportunity_id')
      .eq('user_id', state.currentUser.id);
    const myAssignedIds = (myAssignedRows || []).map(r => r.opportunity_id);
    const existingOppIds = new Set((opportunities || []).map(o => o.id));
    const newIds = myAssignedIds.filter(id => !existingOppIds.has(id));
    if (newIds.length > 0) {
      const { data: extraOpps } = await supabaseClient
        .from('opportunities')
        .select('*, profiles!inner(id, first_name, last_name, email, role, avatar_url)')
        .in('id', newIds);
      (extraOpps || []).forEach(opp => {
        // Mark explicitly so isOwnOpportunity stays true even if assignees fail to load
        opp._isAssignedToMe = true;
        opportunities.push(opp);
      });
    }
  }

  // Batch-load assignees for ALL opportunities (owned + assigned) in two steps.
  // Cannot use embedded profiles(...) join because opportunity_assignees.user_id
  // references auth.users, not profiles — Supabase can't resolve that join.
  let assigneesByOppId = {};
  if (opportunities.length > 0) {
    const allOppIds = opportunities.map(o => o.id);
    const { data: assigneeRows } = await supabaseClient
      .from('opportunity_assignees')
      .select('opportunity_id, user_id')
      .in('opportunity_id', allOppIds);

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

  // ── Filter to the active pipeline ────────────────────────────────────────
  opportunities = opportunities.filter(opp => oppMatchesPipeline(opp, activePipeline));

  // Define pipeline stages from the active pipeline
  const pipelineStages = activePipeline.stages || getDefaultPipeline().stages;

  // Map old stage values to new ones (default pipeline only — legacy compat)
  const stageMapping = activePipeline.is_default ? LEGACY_STAGE_TO_CANONICAL : {};

  // Apply mapping to opportunities
  opportunities.forEach(opp => {
    if (stageMapping[opp.stage]) {
      opp.mappedStage = stageMapping[opp.stage];
    } else {
      opp.mappedStage = opp.stage;
    }
  });

  // Group opportunities by stage in a single pass to avoid repeated array scans.
  const opportunitiesByStage = {};
  pipelineStages.forEach(stage => {
    opportunitiesByStage[stage.id] = {
      ...stage,
      opportunities: [],
      totalValue: 0,
    };
  });
  opportunities.forEach((opp) => {
    const stageBucket = opportunitiesByStage[opp.mappedStage];
    if (!stageBucket) return;
    stageBucket.opportunities.push(opp);
    stageBucket.totalValue += parseFloat(opp.value || 0);
  });

  const opportunitiesById = new Map(opportunities.map(opp => [opp.id, opp]));
  const companyLookup = buildCompanyLookup(window.allCompaniesData);
  const paginationState = {};

  const ownerOptions = state.isManager
    ? Array.from(new Map(opportunities.map(opp => {
      const user = opp.profiles;
      const ownerName = user ? `${user.first_name} ${user.last_name}` : 'Unknown';
      return [opp.user_id, ownerName];
    })).entries())
    : [];

  const getStageDays = (opp) => {
    const stageAnchor = opp.updated_at || opp.created_at;
    if (!stageAnchor) return 0;
    const stageDate = new Date(stageAnchor);
    if (Number.isNaN(stageDate.getTime())) return 0;
    const diffMs = Date.now() - stageDate.getTime();
    return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  };

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
          <div class="crm-dd crm-dd--filter" data-dd-id="pipeline-quick-filter">
            <button type="button" class="crm-dd-trigger has-value" aria-haspopup="listbox" aria-expanded="false">
              <span class="crm-dd-label">All Deals</span>
              <span class="crm-dd-chevron"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>
            </button>
            <div class="crm-dd-panel" role="listbox">
              <ul class="crm-dd-list">
                <li class="crm-dd-option is-selected" role="option" aria-selected="true" data-value="all" data-label="All Deals" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>All Deals</li>
                <li class="crm-dd-option" role="option" data-value="high-value" data-label="High Value" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>High Value</li>
                <li class="crm-dd-option" role="option" data-value="high-probability" data-label="High Probability" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>High Probability</li>
                <li class="crm-dd-option" role="option" data-value="next-step-due" data-label="Next Step Due" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Next Step Due</li>
                ${state.isManager ? '<li class="crm-dd-option" role="option" data-value="my-reps" data-label="Sales Reps" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Sales Reps</li>' : ''}
              </ul>
            </div>
            <input class="crm-dd-value-input" type="hidden" id="pipeline-quick-filter" value="all">
          </div>

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
            <div class="crm-dd crm-dd--filter" data-dd-id="pipeline-owner-filter">
              <button type="button" class="crm-dd-trigger has-value" aria-haspopup="listbox" aria-expanded="false">
                <span class="crm-dd-label">All Owners</span>
                <span class="crm-dd-chevron"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>
              </button>
              <div class="crm-dd-panel" role="listbox">
                <ul class="crm-dd-list">
                  <li class="crm-dd-option is-selected" role="option" aria-selected="true" data-value="all" data-label="All Owners" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>All Owners</li>
                  ${ownerOptions.map(([id, name]) => `<li class="crm-dd-option" role="option" data-value="${id}" data-label="${name}" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>${name}</li>`).join('')}
                </ul>
              </div>
              <input class="crm-dd-value-input" type="hidden" id="pipeline-owner-filter" value="all">
            </div>
          ` : ''}

          <span class="crm-filter-divider"></span>
          
          <div class="crm-dd crm-dd--filter" data-dd-id="pipeline-sort">
            <button type="button" class="crm-dd-trigger has-value" aria-haspopup="listbox" aria-expanded="false">
              <span class="crm-dd-label">Sort: Newest</span>
              <span class="crm-dd-chevron"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>
            </button>
            <div class="crm-dd-panel" role="listbox">
              <ul class="crm-dd-list">
                <li class="crm-dd-option is-selected" role="option" aria-selected="true" data-value="newest" data-label="Sort: Newest" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Sort: Newest</li>
                <li class="crm-dd-option" role="option" data-value="oldest" data-label="Sort: Oldest" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Sort: Oldest</li>
                <li class="crm-dd-option" role="option" data-value="value-desc" data-label="Sort: Highest Value" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Sort: Highest Value</li>
                <li class="crm-dd-option" role="option" data-value="value-asc" data-label="Sort: Lowest Value" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Sort: Lowest Value</li>
                <li class="crm-dd-option" role="option" data-value="probability-desc" data-label="Sort: Highest Probability" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Sort: Highest Probability</li>
                <li class="crm-dd-option" role="option" data-value="next-step" data-label="Sort: Next Step Due" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Sort: Next Step Due</li>
              </ul>
            </div>
            <input class="crm-dd-value-input" type="hidden" id="pipeline-sort" value="newest">
          </div>

          <button class="crm-filter-clear" id="pipeline-reset-controls" style="display:none;">✕ Clear</button>
        </div>
      </div>
    </div>

    <div class="pipeline-stages">
  `;

  // Render pipeline stages
  pipelineStages.forEach(stage => {
    const stageData = opportunitiesByStage[stage.id];
    const deferredCards = [];
    let renderedCount = 0;

    paginationState[stage.id] = {
      pageSize: OPPORTUNITY_STAGE_PAGE_SIZE,
      rendered: 0,
      deferredCards,
      total: stageData.opportunities.length,
    };

    html += `
      <div class="pipeline-stage" data-stage="${stage.id}">
        <div class="pipeline-stage-header">
          <div class="pipeline-stage-title"><span class="pipeline-stage-dot" style="background:${stage.color}"></span>${stage.title}</div>
          <div class="pipeline-stage-count">${stageData.opportunities.length}</div>
        </div>
        <div class="pipeline-stage-value">${getCurrencySymbol()} ${stageData.totalValue.toLocaleString()}</div>
        <button class="pipeline-inline-add" data-stage="${stage.id}">+ New</button>
        <div class="opportunity-list" id="opportunities-${stage.id}">
    `;

    // Render opportunities in this stage
    stageData.opportunities.forEach(opp => {
      const shouldRenderNow = renderedCount < OPPORTUNITY_STAGE_PAGE_SIZE;
      const isOverdue = opp.next_step_date && new Date(opp.next_step_date) < new Date();
      const competitors = opp.competitors ? JSON.parse(opp.competitors) : [];
      // Full edit access: owner, explicitly-fetched assignee, or confirmed via assignees list
      const isAssignee = opp._isAssignedToMe === true
        || (opp.assignees || []).some(a => a.user_id === state.currentUser.id);
      const isOwnOpportunity = opp.user_id === state.currentUser.id || isAssignee;
      const stageDays = getStageDays(opp);

      // Get user info from joined data
      const user = opp.profiles;
      const ownerName = user ? `${user.first_name} ${user.last_name}` : 'Unknown';

      // Resolve company object from global cache if available (robust/fuzzy matching)
      const companyObj = findCompanyForOpportunityFast(opp, companyLookup);

      // Ensure we have a usable logo URL (favicon only for real domains; ui-avatars otherwise)
      const companyInitials = getInitials((companyObj && companyObj.name) ? companyObj.name : (opp.company_name || ''));
      const companyNameResolved = (companyObj && companyObj.name) ? companyObj.name : (opp.company_name || companyInitials);
      const companyDomain = (companyObj && companyObj.domain) ? companyObj.domain : '';
      const uiAvatarFallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(companyNameResolved)}&background=ededed&color=444&size=64`;
      let companyLogoUrl = '';
      if (companyObj && companyObj.logo_url) {
        companyLogoUrl = companyObj.logo_url;
      } else if (companyDomain) {
        // Only use favicon service for real domain fields (getCompanyLogoUrl rejects emails)
        companyLogoUrl = getCompanyLogoUrl(companyDomain) || uiAvatarFallback;
      } else {
        // No domain — skip speculative guessing, go straight to ui-avatars
        companyLogoUrl = uiAvatarFallback;
      }
      // Cache computed logo_url for future renders when companyObj present
      if (companyObj && !companyObj.logo_url) companyObj.logo_url = companyLogoUrl;
      // Debug: log which logo URL we're using for this opportunity
      // opportunity logo info (silent)

      // Process mentioned people in notes using explicit mentioned_people from DB
      let processedNotes = opp.notes || '';
      // helper to escape regex special chars
      const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      if (opp.mentioned_people && Array.isArray(opp.mentioned_people) && opp.mentioned_people.length > 0) {
        // Each mentioned person object should have `id` and `name` fields
        opp.mentioned_people.forEach(person => {
          if (!person || !person.name) return;
          const safeName = escapeRegExp(person.name.trim());
          // match @Name as whole word (case-insensitive)
          const pattern = new RegExp(`@${safeName}\\b`, 'gi');
          processedNotes = processedNotes.replace(pattern, (match) => {
            // preserve original casing inside the span
            const displayName = person.name;
            return `<span class="mentioned-person">@${displayName}</span>`;
          });
        });
      } else {
        // Fallback: simple regex for single-word mentions (no DB info available)
        processedNotes = processedNotes.replace(/@([A-Za-z0-9_\-]+)\b/g, '<span class="mentioned-person">@$1</span>');
      }

      const cardHtml = `
        <div class="opportunity-card ${!isOwnOpportunity ? 'readonly' : ''}"
          data-id="${opp.id}"
          data-company-name="${escapeHtml(opp.company_name || '')}"
          data-user-id="${opp.user_id}"
          data-owner-id="${opp.user_id}"
          data-value="${parseFloat(opp.value || 0)}"
          data-probability="${parseInt(opp.probability || 0, 10)}"
          data-created-ts="${new Date(opp.created_at).getTime() || 0}"
          data-next-step-ts="${opp.next_step_date ? new Date(opp.next_step_date).getTime() : ''}"
          draggable="${isOwnOpportunity}">

          <div class="opp-card-header">
            <div class="opp-company-row">
              <div class="opp-company-avatar">
                <div class="mention-avatar" style="width:22px;height:22px;font-size:0.6rem;border-radius:5px;flex-shrink:0;">${companyInitials}</div>
                ${companyLogoUrl ? `<img src="${companyLogoUrl}" class="opp-logo-img" onload="this.style.display='block';var p=this.previousElementSibling;if(p)p.style.display='none'" onerror="this.style.display='none'" />` : ''}
              </div>
              <span class="opp-company-label">${escapeHtml(opp.company_name || 'No Company')}</span>
            </div>
            ${isOwnOpportunity ? `
              <button class="opp-drag-handle" title="Drag to move" onclick="event.stopPropagation()">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>
              </button>
            ` : ''}
          </div>

          <div class="opp-name">${escapeHtml(opp.name)}</div>

          <div class="opp-value-row">
            <span class="opp-value">${getCurrencySymbol()} ${parseFloat(opp.value || 0).toLocaleString()}</span>
            ${state.isManager && user ? `
              <span class="opp-owner-chip">
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                ${escapeHtml(ownerName)}
              </span>
            ` : ''}
          </div>

          <div class="opp-probability-row">
            <div class="opp-prob-bar">
              <div class="opp-prob-fill" style="width:${opp.probability || 0}%;background:${getProbabilityColor(opp.probability || 0)};"></div>
            </div>
            <span class="opp-prob-label">${opp.probability || 0}%</span>
          </div>

          ${opp.next_step ? `
            <div class="opp-next-step ${isOverdue ? 'overdue' : ''}">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="opp-step-icon"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/></svg>
              <span>${escapeHtml(opp.next_step)}</span>
              ${opp.next_step_date ? `<time class="opp-step-date">${formatDate(opp.next_step_date)}</time>` : ''}
            </div>
          ` : ''}

          ${competitors.length > 0 ? `
            <div class="opp-competitors">
              ${competitors.slice(0, 2).map(comp => `<span class="competitor-tag">${escapeHtml(comp)}</span>`).join('')}
              ${competitors.length > 2 ? `<span class="competitor-tag">+${competitors.length - 2}</span>` : ''}
            </div>
          ` : ''}

          ${opp.notes ? `
            <div class="opp-notes">${processedNotes.substring(0, 120)}${processedNotes.length > 120 ? '\u2026' : ''}</div>
          ` : ''}

          ${(() => {
            // Build full team: owner first, then assignees (excluding owner if also tagged)
            const ownerProfile = opp.profiles;
            const ownerEntry = ownerProfile
              ? [{ user_id: opp.user_id, name: `${ownerProfile.first_name} ${ownerProfile.last_name}`, avatar_url: ownerProfile.avatar_url }]
              : [];
            const assigneeEntries = (opp.assignees || [])
              .filter(a => a.user_id !== opp.user_id)
              .map(a => {
                const p = a.profiles;
                return { user_id: a.user_id, name: p ? `${p.first_name} ${p.last_name}` : 'Member', avatar_url: p?.avatar_url };
              });
            const team = [...ownerEntry, ...assigneeEntries];
            if (team.length === 0) return '';
            const visible = team.slice(0, 3);
            const overflow = team.length - 3;
            const bubbles = visible.map((m, i) => {
              const color = getAssigneeColor(m.user_id);
              const initialsOrImage = m.avatar_url 
                ? `<span style="position:relative;z-index:1;display:none;">${getInitials(m.name)}</span><img src="${m.avatar_url}" alt="" onload="this.style.display='block'" onerror="this.style.display='none';var p=this.previousElementSibling;if(p)p.style.display='block'" />` 
                : getInitials(m.name);
              return `<div class="opp-assignee-bubble" title="${escapeHtml(m.name)}" style="background:${color};z-index:${10 - i}">${initialsOrImage}</div>`;
            }).join('');
            return `
            <div class="opp-card-assignees">
              <span class="opp-card-assignees-label">Team</span>
              <div class="opp-assignees-stack">
                ${bubbles}
                ${overflow > 0 ? `<div class="opp-assignee-bubble opp-assignee-overflow" title="${overflow} more">+${overflow}</div>` : ''}
              </div>
            </div>`;
          })()}

          <div class="opp-card-footer">
            <span class="opp-stage-age">
              <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>
              ${stageDays}d
            </span>
            <span class="opp-created-date">${formatDate(opp.created_at)}</span>
            <div class="opp-actions-group">
              ${isOwnOpportunity ? `
                <button class="opportunity-action-btn edit-opportunity" data-id="${opp.id}" title="Edit">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/></svg>
                </button>
                <button class="opportunity-action-btn delete-opportunity" data-id="${opp.id}" title="Delete">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"/></svg>
                </button>
              ` : `
                <button class="opportunity-action-btn view-opportunity" data-id="${opp.id}" title="View">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"/><path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg>
                </button>
              `}
            </div>
          </div>
        </div>
      `;

      if (shouldRenderNow) {
        html += cardHtml;
      } else {
        deferredCards.push(cardHtml);
      }

      renderedCount += 1;
    });

    paginationState[stage.id].rendered = Math.min(renderedCount, OPPORTUNITY_STAGE_PAGE_SIZE);

    html += `
        </div>
        ${deferredCards.length > 0 ? `
          <div class="pipeline-load-more-wrap">
            <button class="btn btn-ghost pipeline-load-more" data-stage-id="${stage.id}">
              <span class="pipeline-load-more-main">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="m5 12 7 7 7-7"/></svg>
                <span class="pipeline-load-more-label">Load more deals</span>
              </span>
              <span class="pipeline-load-more-meta">
                <span class="pipeline-load-more-count">${Math.min(OPPORTUNITY_STAGE_PAGE_SIZE, deferredCards.length)}</span>
                <span class="pipeline-load-more-sep">of</span>
                <span class="pipeline-load-more-remaining">${deferredCards.length}</span>
                <span class="pipeline-load-more-sep">left</span>
              </span>
            </button>
          </div>
        ` : ''}
      </div>
    `;
  });

  html += `</div>`;

  viewContainer.innerHTML = html;

  if (window.lucide) {
    lucide.createIcons();
  }

  // Initialize drag and drop with a small delay to ensure DOM is ready
  setTimeout(() => {
    initPipelineDragAndDrop(opportunities);
    initOpportunityEventListeners(opportunitiesById, paginationState);
    initPipelineFilters(opportunities);
  }, 100);

  // Fire logo upgrades in the background — never await so the kanban is immediately usable.
  updateOpportunityLogosAsync().catch(() => {});
}

// Upgrade opportunity card logos using the in-memory companies cache.
// Cache-only: avoids Supabase queries and sequential image-loading that blocked the UI.
// Images are updated via onload/onerror so the browser handles them fully async.
function updateOpportunityLogosAsync() {
  const cards = Array.from(document.querySelectorAll('.opportunity-card'));
  for (const card of cards) {
    const companyName = card.getAttribute('data-company-name') || '';
    if (!companyName) continue;

    const company = Array.isArray(window.allCompaniesData)
      ? window.allCompaniesData.find(c => normalizeForMatching(c.name) === normalizeForMatching(companyName))
      : null;
    if (!company?.logo_url) continue;

    const imgEl    = card.querySelector('.opp-company-avatar img');
    const initials = card.querySelector('.opp-company-avatar .mention-avatar');
    if (!imgEl) continue;

    // Only update if the src is actually different
    if (imgEl.src === company.logo_url) continue;

    imgEl.onload = function () {
      this.style.display = 'block';
      if (initials) initials.style.display = 'none';
    };
    imgEl.onerror = function () {
      this.style.display = 'none';
      if (initials) initials.style.display = '';
    };
    imgEl.src = company.logo_url;
  }
  return Promise.resolve();
}

function initOpportunityEventListeners(opportunitiesOrMap, paginationState = null) {
  const opportunitiesById = opportunitiesOrMap instanceof Map
    ? opportunitiesOrMap
    : new Map((opportunitiesOrMap || []).map(opp => [opp.id, opp]));

  const loadStageCards = (stageId, options = {}) => {
    if (!paginationState || !stageId) return;
    const { all = false } = options;
    const stageState = paginationState[stageId];
    if (!stageState || !Array.isArray(stageState.deferredCards) || stageState.deferredCards.length === 0) return;

    const stageEl = document.querySelector(`.pipeline-stage[data-stage="${stageId}"]`);
    const listEl = stageEl?.querySelector('.opportunity-list');
    const buttonEl = stageEl?.querySelector('.pipeline-load-more');
    if (!listEl) return;

    const takeCount = all ? stageState.deferredCards.length : Math.min(stageState.pageSize, stageState.deferredCards.length);
    const htmlChunk = stageState.deferredCards.splice(0, takeCount).join('');
    if (!htmlChunk) return;

    listEl.insertAdjacentHTML('beforeend', htmlChunk);
    stageState.rendered += takeCount;

    if (stageState.deferredCards.length === 0) {
      buttonEl?.closest('.pipeline-load-more-wrap')?.remove();
    } else if (buttonEl) {
      const previewCount = Math.min(stageState.pageSize, stageState.deferredCards.length);
      const countEl = buttonEl.querySelector('.pipeline-load-more-count');
      const remainingEl = buttonEl.querySelector('.pipeline-load-more-remaining');
      if (countEl) countEl.textContent = String(previewCount);
      if (remainingEl) remainingEl.textContent = String(stageState.deferredCards.length);
    }

    // Bind handlers for newly inserted cards only.
    initOpportunityEventListeners(opportunitiesById, paginationState);
  };

  if (paginationState) {
    window.expandAllOpportunityColumns = () => {
      Object.keys(paginationState).forEach((stageId) => loadStageCards(stageId, { all: true }));
    };
  }

  // Pipeline tab switcher
  document.querySelectorAll('.pipeline-tab[data-pipeline-id]').forEach(tab => {
    if (tab.dataset.boundClick === '1') return;
    tab.dataset.boundClick = '1';
    tab.addEventListener('click', () => {
      const pipelineId = tab.dataset.pipelineId;
      if (pipelineId && pipelineId !== state.activePipelineId) {
        setActivePipeline(pipelineId);
        renderOpportunityPipelineView();
      }
    });
  });

  // Manage Pipelines button (managers only)
  const managePipelinesBtn = document.getElementById('manage-pipelines-btn');
  if (managePipelinesBtn && managePipelinesBtn.dataset.boundClick !== '1') {
    managePipelinesBtn.dataset.boundClick = '1';
    managePipelinesBtn.addEventListener('click', () => {
      openManagePipelinesModal();
    });
  }

  // Add opportunity button
  const addOpportunityBtn = document.getElementById('add-opportunity-btn');
  if (addOpportunityBtn && addOpportunityBtn.dataset.boundClick !== '1') {
    addOpportunityBtn.dataset.boundClick = '1';
    addOpportunityBtn.addEventListener('click', () => {
      openOpportunityModal();
    });
  }

  document.querySelectorAll('.pipeline-load-more').forEach(btn => {
    if (btn.dataset.boundClick === '1') return;
    btn.dataset.boundClick = '1';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const stageId = btn.getAttribute('data-stage-id');
      loadStageCards(stageId);
    });
  });

  document.querySelectorAll('.pipeline-inline-add').forEach(btn => {
    if (btn.dataset.boundClick === '1') return;
    btn.dataset.boundClick = '1';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const stage = btn.dataset.stage;
      openOpportunityModal();
      setTimeout(() => {
        if (stage) window.setCrmDropdownValue?.('opportunity-stage', stage);
      }, 50);
    });
  });

  // Edit opportunity buttons
  document.querySelectorAll('.edit-opportunity').forEach(btn => {
    if (btn.dataset.boundClick === '1') return;
    btn.dataset.boundClick = '1';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const opportunityId = btn.dataset.id;
      const opportunity = opportunitiesById.get(opportunityId);
      if (opportunity) {
        openOpportunityModal(opportunity);
      }
    });
  });

  // Delete opportunity buttons
  document.querySelectorAll('.delete-opportunity').forEach(btn => {
    if (btn.dataset.boundClick === '1') return;
    btn.dataset.boundClick = '1';
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const opportunityId = btn.dataset.id;
      const opportunity = opportunitiesById.get(opportunityId);

      const confirmed = await showConfirmDialog(
        'Delete Opportunity',
        `Are you sure you want to delete ${opportunity.name}?`
      );

      if (!confirmed) return;

      const { error } = await supabaseClient
        .from('opportunities')
        .delete()
        .eq('id', opportunityId);

      if (error) {
        showToast('Error deleting opportunity: ' + error.message, 'error');
        return;
      }

      showToast('Opportunity deleted successfully', 'success');
      renderOpportunityPipelineView();
    });
  });

  // View opportunity buttons (for managers viewing others' opportunities)
  document.querySelectorAll('.view-opportunity').forEach(btn => {
    if (btn.dataset.boundClick === '1') return;
    btn.dataset.boundClick = '1';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const opportunityId = btn.dataset.id;
      const opportunity = opportunitiesById.get(opportunityId);
      if (opportunity) {
        openOpportunityViewModal(opportunity);
      }
    });
  });

  // Click on opportunity card to view details
  document.querySelectorAll('.opportunity-card').forEach(card => {
    if (card.dataset.boundClick === '1') return;
    card.dataset.boundClick = '1';
    card.addEventListener('click', () => {
      const opportunityId = card.dataset.id;
      const opportunity = opportunitiesById.get(opportunityId);
      if (opportunity) {
        openOpportunityViewModal(opportunity);
      }
    });
  });

  // Make mentioned person spans clickable to open the person view modal
  document.querySelectorAll('.opportunity-card .mentioned-person').forEach(el => {
    if (el.dataset.boundClick === '1') return;
    el.dataset.boundClick = '1';
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const personId = el.dataset.personId;
      const personName = el.dataset.personName || el.textContent.replace(/^@/, '').trim();
      if (personId) {
        openPersonViewModal(personId);
        return;
      }
      // Fallback: try to find by name
      const person = state.allPeople.find(p => String(p.name).trim().toLowerCase() === String(personName).toLowerCase());
      if (person) openPersonViewModal(person);
    });
  });
}


function initPipelineDragAndDrop(opportunities) {
  const opportunityLists = document.querySelectorAll('.opportunity-list');

  if (typeof Sortable === 'undefined') {
    console.error('Sortable.js library is not loaded!');
    showToast('Drag-and-drop functionality requires Sortable.js library', 'error');
    return;
  }

  opportunityLists.forEach(list => {
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
      preventOnFilter: false,
      filter: '.opportunity-action-btn',
      onStart: function (evt) {
        document.body.classList.add('is-dragging');
        evt.item.classList.add('dragging');
      },
      onEnd: function (evt) {
        document.body.classList.remove('is-dragging');
        evt.item.classList.remove('dragging');
      },
      onAdd: async function (evt) {
        const opportunityId = evt.item.dataset.id;
        const newStage = evt.to.closest('.pipeline-stage').dataset.stage;
        const oldStage = evt.from.closest('.pipeline-stage').dataset.stage;

        // Only update if stage changed
        if (newStage !== oldStage) {
          try {
            const { error } = await supabaseClient
              .from('opportunities')
              .update({
                stage: newStage,
                updated_at: new Date().toISOString()
              })
              .eq('id', opportunityId);

            if (error) throw error;

            // Update local state so that subsequent edits reflect the new stage
            const opportunity = opportunities.find(opp => opp.id === opportunityId);
            if (opportunity) {
              opportunity.stage = newStage;
              opportunity.updated_at = new Date().toISOString();

              // For default pipeline: keep legacy stage mapping; custom pipelines use stage as-is
              const activePipeline = (state.pipelines && state.activePipelineId
                ? state.pipelines.find(p => p.id === state.activePipelineId)
                : null) || getDefaultPipeline();
              if (activePipeline.is_default) {
                opportunity.mappedStage = LEGACY_STAGE_TO_CANONICAL[newStage] || newStage;
              } else {
                opportunity.mappedStage = newStage;
              }
            }

            const stageAgeEl = evt.item.querySelector('.opp-stage-age');
            if (stageAgeEl) {
              stageAgeEl.lastChild.textContent = ' 0d';
            }
            showInlineSuccess(evt.item);
            showToast('Opportunity moved', 'success', { subtle: true, duration: 1400, dedupeMs: 1200 });

            // Update stage counts
            updatePipelineStageCounts();

          } catch (error) {
            showToast('Error updating opportunity: ' + error.message, 'error');
            // Move item back to original position on error
            evt.from.appendChild(evt.item);
          }
        }
      }
    });
  });
}

function updatePipelineStageCounts() {
  document.querySelectorAll('.pipeline-stage').forEach(stage => {
    const stageId = stage.dataset.stage;
    const opportunities = stage.querySelectorAll('.opportunity-card:not([style*="display: none"])');
    const count = opportunities.length;

    // Update count badge
    const countBadge = stage.querySelector('.pipeline-stage-count');
    if (countBadge) {
      countBadge.textContent = count;
    }

    // Calculate and update total value
    let totalValue = 0;
    opportunities.forEach(card => {
      const valueText = card.querySelector('.opp-value')?.textContent;
      if (valueText) {
        totalValue += parseCurrencyValue(valueText);
      }
    });

    const valueElement = stage.querySelector('.pipeline-stage-value');
    if (valueElement) {
      valueElement.textContent = `${getCurrencySymbol()} ${totalValue.toLocaleString()}`;
    }
  });

  // Also update the main summary cards at the top
  updatePipelineSummary();
}

/**
 * Updates the summary cards at the top of the pipeline view based on current cards in the DOM.
 */
function updatePipelineSummary() {
  const visibleCards = document.querySelectorAll('.opportunity-card:not([style*="display: none"])');

  let totalValue = 0;
  let wonValue = 0;
  let lostValue = 0;
  let weightedForecast = 0;
  let totalProbability = 0;
  let activeCount = 0;
  let closedCount = 0;
  let wonCount = 0;

  visibleCards.forEach(card => {
    const valueText = card.querySelector('.opp-value')?.textContent;
    const value = parseCurrencyValue(valueText);
    totalValue += value;

    const probText = card.querySelector('.opp-prob-label')?.textContent;
    const probability = parseInt(probText?.replace('%', '') || 0);
    totalProbability += probability;
    weightedForecast += (value * probability) / 100;

    const stageId = card.closest('.pipeline-stage')?.dataset.stage;
    if (stageId === 'closed-won') {
      wonValue += value;
      closedCount++;
      wonCount++;
    } else if (stageId === 'closed-lost') {
      lostValue += value;
      closedCount++;
    } else if (stageId !== 'closed-lost') {
      activeCount++;
    }
  });

  const avgProbability = visibleCards.length > 0 ? Math.round(totalProbability / visibleCards.length) : 0;
  const winRate = closedCount > 0 ? Math.round((wonCount / closedCount) * 100) : 0;

  // Update DOM elements
  const summaryValues = document.querySelectorAll('.pipeline-summary-value');
  if (summaryValues.length >= 4) {
    summaryValues[0].textContent = `${getCurrencySymbol()} ${totalValue.toLocaleString()}`;
    summaryValues[1].textContent = activeCount;
    summaryValues[2].textContent = `${getCurrencySymbol()} ${Math.round(weightedForecast).toLocaleString()}`;
    summaryValues[3].textContent = `${winRate}%`;

    const summaryChanges = document.querySelectorAll('.pipeline-summary-change');
    if (summaryChanges.length >= 4) {
      summaryChanges[0].innerHTML = `<i class="fas fa-briefcase"></i> Active: ${getCurrencySymbol()} ${Math.max(totalValue - wonValue - lostValue, 0).toLocaleString()}`;
      summaryChanges[1].innerHTML = `<i class="fas fa-flag-checkered"></i> Won: ${wonCount}`;
      summaryChanges[2].innerHTML = `<i class="fas fa-percent"></i> Avg probability: ${avgProbability}%`;
      summaryChanges[3].innerHTML = `<i class="fas fa-trophy"></i> Closed won value: ${getCurrencySymbol()} ${wonValue.toLocaleString()}`;
    }
  }
}

function initPipelineFilters(opportunities) {
    const opportunitiesById = new Map((opportunities || []).map(opp => [opp.id, opp]));

  const quickFilterSelect = document.getElementById('pipeline-quick-filter');
  const searchInput = document.getElementById('pipeline-search');
  const ownerSelect = document.getElementById('pipeline-owner-filter');
  const sortSelect = document.getElementById('pipeline-sort');
  const advancedToggle = document.getElementById('pipeline-advanced-toggle');
  const advancedControls = document.getElementById('pipeline-advanced-controls');
  const resetBtn = document.getElementById('pipeline-reset-controls');
  let expandedForFiltering = false;

  // Load persisted state
  const persistedState = _loadPersistedState().pipeline || {};
  if (searchInput && persistedState.search) searchInput.value = persistedState.search;
  if (quickFilterSelect && persistedState.quickFilter) window.setCrmDropdownValue?.('pipeline-quick-filter', persistedState.quickFilter) || (quickFilterSelect.value = persistedState.quickFilter);
  if (ownerSelect && persistedState.owner) window.setCrmDropdownValue?.('pipeline-owner-filter', persistedState.owner) || (ownerSelect.value = persistedState.owner);
  if (sortSelect && persistedState.sort) window.setCrmDropdownValue?.('pipeline-sort', persistedState.sort) || (sortSelect.value = persistedState.sort);
  if (persistedState.advancedOpen && advancedToggle && advancedControls) {
    advancedControls.removeAttribute('hidden');
    advancedToggle.setAttribute('aria-expanded', 'true');
    advancedToggle.classList.add('is-open');
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

    if (sort === 'oldest') return aCreated - bCreated;
    if (sort === 'value-desc') return bValue - aValue;
    if (sort === 'value-asc') return aValue - bValue;
    if (sort === 'probability-desc') return bProb - aProb;
    if (sort === 'next-step') return aNext - bNext;
    return bCreated - aCreated;
  };

  const applyPipelineControls = () => {
    const activeFilter = quickFilterSelect?.value || 'all';
    const query = (searchInput?.value || '').trim().toLowerCase();
    const owner = ownerSelect?.value || 'all';
    const sort = sortSelect?.value || 'newest';
    const dateFrom = document.getElementById('pipeline-filter-date-from')?.value || '';
    const dateTo = document.getElementById('pipeline-filter-date-to')?.value || '';

    saveViewState({
      pipeline: {
        search: searchInput?.value || '',
        quickFilter: activeFilter,
        owner: owner,
        sort: sort,
        advancedOpen: advancedToggle?.classList.contains('is-active') || false
      }
    });

    const hasFilters = activeFilter !== 'all' || owner !== 'all' || sort !== 'newest' || dateFrom || dateTo || query;

    if (hasFilters && !expandedForFiltering) {
      window.expandAllOpportunityColumns?.();
      expandedForFiltering = true;
    } else if (!hasFilters) {
      expandedForFiltering = false;
    }

    if (resetBtn) resetBtn.style.display = hasFilters ? 'inline-flex' : 'none';

    const dateClearBtn = document.getElementById('pipeline-date-clear');
    if (dateClearBtn) dateClearBtn.style.display = (dateFrom || dateTo) ? 'inline-flex' : 'none';

    document.querySelectorAll('.opportunity-card').forEach(card => {
      let show = true;
      const oppId = card.dataset.id;
      const opportunity = opportunitiesById.get(oppId);

      if (activeFilter === 'my-reps') {
        show = opportunity && opportunity.profiles && opportunity.profiles.role === 'sales_rep';
      } else if (activeFilter === 'high-value') {
        show = Number(card.dataset.value || 0) >= 100000;
      } else if (activeFilter === 'high-probability') {
        show = Number(card.dataset.probability || 0) >= 70;
      } else if (activeFilter === 'next-step-due') {
        show = !!card.querySelector('.opp-next-step');
      }

      if (show && owner !== 'all') {
        show = card.dataset.ownerId === owner;
      }

      if (show && (dateFrom || dateTo) && opportunity) {
        if (!opportunity.next_step_date) {
          show = false;
        } else {
          const nextDate = new Date(opportunity.next_step_date);
          if (dateFrom && nextDate < new Date(dateFrom)) show = false;
          if (dateTo) {
            const toEnd = new Date(dateTo);
            toEnd.setHours(23, 59, 59, 999);
            if (nextDate > toEnd) show = false;
          }
        }
      }

      if (show && query) {
        show = (card.textContent || '').toLowerCase().includes(query);
      }

      card.style.display = show ? 'block' : 'none';
    });

    document.querySelectorAll('.opportunity-list').forEach(list => {
      const visibleCards = Array.from(list.querySelectorAll('.opportunity-card')).filter(card => card.style.display !== 'none');
      visibleCards.sort((a, b) => compareBySort(a, b, sort));
      visibleCards.forEach(card => list.appendChild(card));
    });

    updatePipelineStageCounts();
  };

  advancedToggle?.addEventListener('click', () => {
    const isOpen = advancedControls?.classList.toggle('open');
    advancedToggle?.classList.toggle('is-active', isOpen);
    advancedToggle?.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    applyPipelineControls();
  });

  resetBtn?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    window.setCrmDropdownValue?.('pipeline-quick-filter', 'all') || (quickFilterSelect && (quickFilterSelect.value = 'all'));
    window.setCrmDropdownValue?.('pipeline-owner-filter', 'all') || (ownerSelect && (ownerSelect.value = 'all'));
    window.setCrmDropdownValue?.('pipeline-sort', 'newest') || (sortSelect && (sortSelect.value = 'newest'));
    const dfrom = document.getElementById('pipeline-filter-date-from');
    const dto = document.getElementById('pipeline-filter-date-to');
    if (dfrom) dfrom.value = '';
    if (dto) dto.value = '';
    applyPipelineControls();
  });

  document.getElementById('pipeline-date-clear')?.addEventListener('click', () => {
    const dfrom = document.getElementById('pipeline-filter-date-from');
    const dto = document.getElementById('pipeline-filter-date-to');
    if (dfrom) dfrom.value = '';
    if (dto) dto.value = '';
    applyPipelineControls();
  });

  quickFilterSelect?.addEventListener('change', applyPipelineControls);
  searchInput?.addEventListener('input', applyPipelineControls);
  ownerSelect?.addEventListener('change', applyPipelineControls);
  sortSelect?.addEventListener('change', applyPipelineControls);
  document.getElementById('pipeline-filter-date-from')?.addEventListener('change', applyPipelineControls);
  document.getElementById('pipeline-filter-date-to')?.addEventListener('change', applyPipelineControls);

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

async function openOpportunityModal(opportunity = null) {
  const modal = document.getElementById('opportunity-modal');
  const modalTitle = document.getElementById('opportunity-modal-title');
  const saveBtn = document.getElementById('save-opportunity-btn');

  // Resolve active pipeline and update stage dropdown before reset
  const activePipeline = (state.pipelines && state.activePipelineId
    ? state.pipelines.find(p => p.id === state.activePipelineId)
    : null) || getDefaultPipeline();
  const firstStageId = activePipeline.stages?.[0]?.id || 'prospecting';

  // Reset form
  document.getElementById('opportunity-name').value = '';
  document.getElementById('opportunity-company').value = '';
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
    document.getElementById('opportunity-value').value = opportunity.value || '';
    document.getElementById('opportunity-probability').value = opportunity.probability || 50;
    document.getElementById('probability-display').textContent = opportunity.probability || 50;

    // Resolve stage value — for default pipeline apply legacy mapping, for custom use as-is
    let stageValue = opportunity.stage || firstStageId;
    if (activePipeline.is_default) {
      if (opportunity.stage === 'proposal' || opportunity.stage === 'negotiation') stageValue = 'qualification';
    }
    // Ensure the stage exists in the active pipeline; fall back to first stage
    const stageExists = activePipeline.stages?.some(s => s.id === stageValue);
    if (!stageExists) stageValue = firstStageId;
    updateStageDropdownForPipeline(activePipeline, stageValue);

    document.getElementById('opportunity-next-step').value = opportunity.next_step || '';
    document.getElementById('opportunity-next-step-date').value = opportunity.next_step_date || '';
    document.getElementById('opportunity-notes').value = opportunity.notes || '';

    // Add competitors
    if (opportunity.competitors) {
      const competitors = JSON.parse(opportunity.competitors);
      competitors.forEach(comp => addCompetitor(comp));
    }
  } else {
    modalTitle.innerHTML = 'New Opportunity';
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

  // Hero info
  const titleEl = document.getElementById('opportunity-view-title');
  const stageEl = document.getElementById('opportunity-view-stage-badge');
  const companyEl = document.getElementById('opportunity-view-company');
  const avatarEl = document.getElementById('opportunity-view-avatar');

  if (titleEl) titleEl.textContent = opportunity.name || 'Untitled Opportunity';

  // Stage badge
  if (stageEl) {
    // Use active pipeline stages (fall back to default for orphaned opps)
    const viewPipeline = (state.pipelines && state.activePipelineId
      ? state.pipelines.find(p => p.id === state.activePipelineId)
      : null) || getDefaultPipeline();
    const pipelineStages = viewPipeline.stages;
    const stageInfo = pipelineStages.find(s => s.id === opportunity.mappedStage) || pipelineStages[0];
    stageEl.textContent = stageInfo.title;
    stageEl.style.background = `color-mix(in srgb, ${stageInfo.color} 12%, transparent)`;
    stageEl.style.color = stageInfo.color;
  }

  if (companyEl) companyEl.textContent = opportunity.company_name || 'No Company';

  // Avatar (Company initials or Logo)
  if (avatarEl) {
    const initials = getInitials(opportunity.company_name || 'U');
    avatarEl.textContent = initials;
    avatarEl.className = 'record-hero-avatar'; // Reset

    // Check if we have a company logo
    const companyObj = findCompanyForOpportunity(opportunity);
    const resolvedLogoUrl = (companyObj && companyObj.logo_url) || getCompanyLogoUrl(opportunity.company_name || '');

    avatarEl.innerHTML = `<span style="position:relative;z-index:1">${initials}</span>${resolvedLogoUrl ? `<img src="${resolvedLogoUrl}" alt="${escapeHtml(opportunity.company_name || '')}" onload="this.style.display='block';var p=this.previousElementSibling;if(p)p.style.display='none'" onerror="this.style.display='none'" />` : ''}`;

    if (!resolvedLogoUrl) {
      avatarEl.style.background = 'linear-gradient(135deg, var(--color-primary), var(--color-primary-light))';
    }
  }

  // Details
  const valueEl = document.getElementById('opportunity-view-value');
  const probEl = document.getElementById('opportunity-view-probability');
  const createdEl = document.getElementById('opportunity-view-created');
  const ownerEl = document.getElementById('opportunity-view-owner');

  if (valueEl) valueEl.textContent = `${getCurrencySymbol()} ${parseFloat(opportunity.value || 0).toLocaleString()}`;
  if (probEl) probEl.innerHTML = `<span style="color:${getProbabilityColor(opportunity.probability || 0)}; font-weight:700;">${opportunity.probability || 0}%</span>`;
  if (createdEl) createdEl.textContent = formatDate(opportunity.created_at);
  if (ownerEl) {
    const ownerName = opportunity.profiles ? `${opportunity.profiles.first_name} ${opportunity.profiles.last_name}` : 'Unknown';
    ownerEl.textContent = ownerName;
  }

  // Timeline
  const nextStepEl = document.getElementById('opportunity-view-next-step');
  const dueDateEl = document.getElementById('opportunity-view-next-step-date');

  if (nextStepEl) nextStepEl.textContent = opportunity.next_step || 'No next step scheduled';
  if (dueDateEl) dueDateEl.textContent = (opportunity.next_step_date && opportunity.next_step_date !== 'None') ? formatDate(opportunity.next_step_date) : 'No due date';

  // Notes
  const notesEl = document.getElementById('opportunity-view-notes');
  if (notesEl) {
    let notesHtml = escapeHtml(opportunity.notes || '');
    // Process mentions
    if (opportunity.mentioned_people && Array.isArray(opportunity.mentioned_people)) {
      opportunity.mentioned_people.forEach(person => {
        if (!person || !person.name) return;
        const safeName = escapeRegExp(person.name.trim());
        const pattern = new RegExp(`@${safeName}\\b`, 'gi');
        notesHtml = notesHtml.replace(pattern, `<span class="mentioned-person" data-person-id="${person.id}">@${person.name}</span>`);
      });
    } else {
      notesHtml = notesHtml.replace(/@([A-Za-z0-9_\-]+)\b/g, '<span class="mentioned-person" data-person-name="$1">@$1</span>');
    }
    notesEl.innerHTML = notesHtml || '<div class="text-muted" style="font-size:0.85rem; opacity:0.6;">No internal notes added to this deal.</div>';

    // Attach click handlers to mentions
    notesEl.querySelectorAll('.mentioned-person').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const pid = el.dataset.personId;
        const pname = el.dataset.personName || el.textContent.replace(/^@/, '').trim();
        if (pid) return openPersonViewModal(pid);
        const p = state.allPeople.find(p => String(p.name).trim().toLowerCase() === String(pname).toLowerCase());
        if (p) openPersonViewModal(p);
      });
    });
  }

  // Competitors
  const competitorsEl = document.getElementById('opportunity-view-competitors');
  if (competitorsEl) {
    const competitors = opportunity.competitors ? (typeof opportunity.competitors === 'string' ? JSON.parse(opportunity.competitors) : opportunity.competitors) : [];
    if (competitors.length > 0) {
      competitorsEl.innerHTML = competitors.map(c => `<span class="ov-comp-tag">${escapeHtml(c)}</span>`).join('');
    } else {
      competitorsEl.innerHTML = '<span class="text-muted" style="font-size:0.8rem;">No competitors identified</span>';
    }
  }

  // Metadata
  const orgIdEl = document.getElementById('opportunity-view-org-id');
  const updatedEl = document.getElementById('opportunity-view-updated');
  if (orgIdEl) orgIdEl.textContent = opportunity.organization_id || '—';
  if (updatedEl) updatedEl.textContent = opportunity.updated_at ? formatDate(opportunity.updated_at) : formatDate(opportunity.created_at);

  // Assignees
  const assigneesEl = document.getElementById('opportunity-view-assignees');
  if (assigneesEl) {
    const assignees = opportunity.assignees || [];
    const ownerProfile = opportunity.profiles;

    // Build rows: owner first (always shown), then additional tagged members
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

    // Additional assignees (skip owner if also tagged to avoid duplication)
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
    const isAssignee = opportunity._isAssignedToMe === true
      || (opportunity.assignees || []).some(a => a.user_id === state.currentUser.id);
    const canEdit = opportunity.user_id === state.currentUser.id || isAssignee;
    editBtn.style.display = canEdit ? 'flex' : 'none';
    editBtn.onclick = () => {
      closeModal('opportunity-view-modal');
      openOpportunityModal(opportunity);
    };
  }

  // Show modal
  modal.style.display = 'flex';
  document.body.classList.add('modal-active');

  if (window.lucide) lucide.createIcons();
}




function initOpportunityModalListeners(opportunity) {
  // Initialize assignees picker
  initAssigneesPicker();

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

  // Company search
  const companyInput = document.getElementById('opportunity-company');
  const companySearchResults = document.getElementById('opportunity-company-search-results');

  const newCompanyInput = companyInput.cloneNode(true);
  companyInput.parentNode.replaceChild(newCompanyInput, companyInput);

  newCompanyInput.addEventListener('input', async (e) => {
    const query = e.target.value.toLowerCase().trim();

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
            ? `<img src="${logoUrl}" class="opp-suggest-logo" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><span class="opp-suggest-initials" style="display:none">${initials}</span>`
            : `<span class="opp-suggest-initials">${initials}</span>`;
          return `
          <div class="search-result-item" onclick="selectOpportunityCompany('${escapeHtml(company.name)}')">
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
        <div class="search-result-item" onclick="selectOpportunityCompany('${escapeHtml(e.target.value.trim())}')">
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

  // Close search results when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-container')) {
      companySearchResults.style.display = 'none';
    }
  });

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
  }, true); // Capture phase

  // Close suggestions when clicking outside
  document.addEventListener('click', (e) => {
    if (e.target !== notesEl && !mentionSuggestionsContainer.contains(e.target)) {
      mentionSuggestionsContainer.style.display = 'none';
    }
  });

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
    const value = document.getElementById('opportunity-value').value;
    const probability = document.getElementById('opportunity-probability').value;
    const stage = document.getElementById('opportunity-stage').value;
    const nextStep = document.getElementById('opportunity-next-step').value.trim();
    const nextStepDate = document.getElementById('opportunity-next-step-date').value;
    const notes = document.getElementById('opportunity-notes').value.trim();

    // Get competitors
    const competitorTags = document.querySelectorAll('.competitor-tag');
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
        value,
        probability,
        stage,
        next_step: nextStep || null,
        next_step_date: nextStepDate || null,
        notes: notes || null,
        competitors: competitors.length > 0 ? JSON.stringify(competitors) : null,
        mentioned_people: state.mentionedPeople,
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
      closeModal('opportunity-modal');
      renderOpportunityPipelineView();

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
    ${name}
    <button class="remove" onclick="removeCompetitor(this)">×</button>
  `;

  // Insert before input
  container.insertBefore(tag, input);
}

window.removeCompetitor = function (element) {
  element.parentElement.remove();
};

window.selectOpportunityCompany = function (name) {
  document.getElementById('opportunity-company').value = name;
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
function initAssigneesPicker() {
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
  document.querySelector('.modal-body')?.addEventListener('scroll', positionDropdown, { passive: true });
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

      const warningMsg = oppCount > 0
        ? `Delete "${pipeline.name}"?\n\n⚠️ This will permanently delete ${oppCount} opportunit${oppCount === 1 ? 'y' : 'ies'} in this pipeline. This cannot be undone.`
        : `Delete "${pipeline.name}"? This cannot be undone.`;

      const confirmed = await showConfirmDialog('Delete Pipeline', warningMsg);
      if (!confirmed) return;

      // Delete all opportunities in this pipeline first
      if (oppCount > 0) {
        const { error: oppErr } = await supabaseClient
          .from('opportunities')
          .delete()
          .eq('pipeline_id', pipeline.id);
        if (oppErr) { showToast('Error deleting opportunities: ' + oppErr.message, 'error'); return; }
      }

      const { error } = await supabaseClient.from('pipelines').delete().eq('id', pipeline.id);
      if (error) { showToast('Error deleting pipeline: ' + error.message, 'error'); return; }

      // If user was on the deleted pipeline, fall back to default
      if (state.activePipelineId === pipeline.id) {
        const remaining = pipelines.filter(p => p.id !== pipeline.id);
        const fallback = remaining.find(p => p.is_default) || remaining[0];
        if (fallback) setActivePipeline(fallback.id);
      }

      showToast(`Pipeline deleted${oppCount > 0 ? ` along with ${oppCount} opportunit${oppCount === 1 ? 'y' : 'ies'}` : ''}`, 'success');
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
  updateOpportunityLogosAsync,
  initOpportunityEventListeners,
  initPipelineDragAndDrop,
  updatePipelineStageCounts,
  updatePipelineSummary,
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
