// modules/features/opportunities.js
// Opportunity pipeline: kanban, drag-and-drop, modals.
import { state, supabaseClient, loadPersistedState as _loadPersistedState, saveViewState } from '../state.js';
import { viewContainer } from '../ui/dom.js';
import { showToast, escapeHtml, getInitials, triggerConfetti } from '../ui/toast.js';
import { renderSkeletonCards, renderError, getCurrencySymbol } from '../utils/helpers.js';
import { getCompanyLogoUrl, guessDomainAndFavicon } from '../ui/spreadsheet.js';

async function renderOpportunityPipelineView() {
  // renderOpportunityPipelineView start (diagnostics removed)
  // Ensure companies cache is ready before rendering opportunities
  if (!Array.isArray(window.allCompaniesData) || window.allCompaniesData.length === 0) {
    // companies cache empty — loading companies
    try {
      await loadAllCompanies();
      // loadAllCompanies completed
    } catch (e) {
      // loadAllCompanies failed (ignored)
    }
  } else {
    // companies cache present
  }
  let opportunities;
  let error;

  if (state.isManager) {
    // Managers see all opportunities in their org
    let mQ = supabaseClient
      .from('opportunities')
      .select(`*, profiles!inner(id, first_name, last_name, email, role)`)
      .order('created_at', { ascending: false });
    if (state.currentOrganization?.id) mQ = mQ.eq('organization_id', state.currentOrganization.id);
    const result = await mQ;
    opportunities = result.data;
    error = result.error;
  } else {
    // Sales reps only see their own opportunities
    let oppQ = supabaseClient
      .from('opportunities')
      .select('*')
      .eq('user_id', state.currentUser.id)
      .order('created_at', { ascending: false });
    if (state.currentOrganization?.id) oppQ = oppQ.eq('organization_id', state.currentOrganization.id);
    const result = await oppQ;

    opportunities = result.data;
    error = result.error;
  }

  if (error) {
    viewContainer.innerHTML = renderError(error.message);
    return;
  }

  // Define pipeline stages - simplified to 4 columns as requested
  const pipelineStages = [
    { id: 'prospecting', title: 'Lead', color: '#3b82f6' },
    { id: 'qualification', title: 'In Progress', color: '#ec4899' },
    { id: 'closed-won', title: 'Won 🎉', color: '#10b981' },
    { id: 'closed-lost', title: 'Lost', color: '#ef4444' }
  ];

  // Map old stage values to new ones
  const stageMapping = {
    'prospecting': 'prospecting',
    'qualification': 'qualification',
    'proposal': 'qualification', // Map to In Progress
    'negotiation': 'qualification', // Map to In Progress
    'closed-won': 'closed-won',
    'closed-lost': 'closed-lost'
  };

  // Apply mapping to opportunities
  opportunities.forEach(opp => {
    if (stageMapping[opp.stage]) {
      opp.mappedStage = stageMapping[opp.stage];
    } else {
      opp.mappedStage = opp.stage;
    }
  });

  // Group opportunities by stage
  const opportunitiesByStage = {};
  pipelineStages.forEach(stage => {
    opportunitiesByStage[stage.id] = {
      ...stage,
      opportunities: opportunities.filter(opp => opp.mappedStage === stage.id),
      totalValue: opportunities
        .filter(opp => opp.mappedStage === stage.id)
        .reduce((sum, opp) => sum + parseFloat(opp.value || 0), 0)
    };
  });

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
      <div class="pipeline-controls pipeline-controls-primary" style="width: 100%;">
        <div class="pipeline-search">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"/></svg>
          <input type="text" id="pipeline-search" placeholder="Search company, deal, notes...">
        </div>

        <button class="btn btn-secondary crm-filter-toggle-btn" id="pipeline-advanced-toggle" aria-expanded="false">
          <i data-lucide="sliders-horizontal"></i> Filters
        </button>

        <button class="btn btn-primary pipeline-add-btn" id="add-opportunity-btn">
          <i data-lucide="plus" class="u-icon-16"></i> New Opportunity
        </button>
      </div>

      <div class="crm-filter-panel" id="pipeline-advanced-controls">
        <div class="crm-filter-bar" style="padding-top: 0;">
          <select id="pipeline-quick-filter" class="crm-filter-select">
            <option value="all">All Deals</option>
            <option value="high-value">High Value</option>
            <option value="high-probability">High Probability</option>
            <option value="next-step-due">Next Step Due</option>
            ${state.isManager ? '<option value="my-reps">Sales Reps</option>' : ''}
          </select>

          <span class="crm-filter-divider"></span>

          <div class="crm-date-range">
            <span class="crm-date-range-label">Next Step:</span>
            <input type="date" class="crm-date-input" id="pipeline-filter-date-from" placeholder="From">
            <span class="crm-date-range-label">to</span>
            <input type="date" class="crm-date-input" id="pipeline-filter-date-to" placeholder="To">
          </div>

          ${state.isManager ? `
            <span class="crm-filter-divider"></span>
            <select id="pipeline-owner-filter" class="crm-filter-select">
              <option value="all">All Owners</option>
              ${ownerOptions.map(([id, name]) => `<option value="${id}">${name}</option>`).join('')}
            </select>
          ` : ''}

          <span class="crm-filter-divider"></span>
          
          <select id="pipeline-sort" class="crm-filter-select">
            <option value="newest">Sort: Newest</option>
            <option value="oldest">Sort: Oldest</option>
            <option value="value-desc">Sort: Highest Value</option>
            <option value="value-asc">Sort: Lowest Value</option>
            <option value="probability-desc">Sort: Highest Probability</option>
            <option value="next-step">Sort: Next Step Due</option>
          </select>

          <button class="crm-filter-clear" id="pipeline-reset-controls" style="display:none;">✕ Clear</button>
        </div>
      </div>
    </div>

    <div class="pipeline-stages">
  `;

  // Render pipeline stages
  pipelineStages.forEach(stage => {
    const stageData = opportunitiesByStage[stage.id];
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
      const isOverdue = opp.next_step_date && new Date(opp.next_step_date) < new Date();
      const competitors = opp.competitors ? JSON.parse(opp.competitors) : [];
      const isOwnOpportunity = !state.isManager || opp.user_id === state.currentUser.id;
      const stageDays = getStageDays(opp);

      // Get user info from joined data
      const user = opp.profiles;
      const ownerName = user ? `${user.first_name} ${user.last_name}` : 'Unknown';

      // Resolve company object from global cache if available (robust/fuzzy matching)
      const companyObj = findCompanyForOpportunity(opp);

      // Ensure we have a usable logo URL (fallback to favicon or UI Avatars)
      const companyInitials = getInitials((companyObj && companyObj.name) ? companyObj.name : (opp.company_name || ''));
      const companyNameResolved = (companyObj && companyObj.name) ? companyObj.name : (opp.company_name || companyInitials);
      const companyDomain = (companyObj && companyObj.domain) ? companyObj.domain : '';
      let companyLogoUrl = '';
      if (companyObj && companyObj.logo_url) {
        companyLogoUrl = companyObj.logo_url;
      } else if (companyDomain) {
        companyLogoUrl = getCompanyLogoUrl(companyDomain) || `https://ui-avatars.com/api/?name=${encodeURIComponent(companyNameResolved)}&background=ededed&color=444&size=64`;
      } else {
        // No matched company and no domain; try guessing a favicon via Google favicon proxy
        const guessedFavicon = guessDomainAndFavicon(companyNameResolved);
        if (guessedFavicon) {
          companyLogoUrl = guessedFavicon;
        } else {
          companyLogoUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(companyNameResolved)}&background=ededed&color=444&size=64`;
        }
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

      html += `
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
                ${companyLogoUrl ? `<img src="${companyLogoUrl}" class="opp-logo-img" onload="this.style.display='block';this.previousElementSibling.style.display='none'" onerror="this.style.display='none'" />` : ''}
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
    });

    html += `
        </div>
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
    initOpportunityEventListeners(opportunities);
    initPipelineFilters(opportunities);
  }, 100);

  // After render, ensure opportunity logos are updated to use companies' stored logos.
  try {
    // updating opportunity logos from companies table
    await updateOpportunityLogosAsync();
    // updateOpportunityLogosAsync completed
  } catch (e) {
    // updateOpportunityLogosAsync error (ignored)
  }
}

// Try to update opportunity cards to use company.logo_url from the `companies` table when available.
async function updateOpportunityLogosAsync() {
  if (!window.supabaseClient) return;
  const cards = Array.from(document.querySelectorAll('.opportunity-card'));
  for (const card of cards) {
    try {
      const companyName = card.getAttribute('data-company-name') || '';
      if (!companyName) continue;

      // Find cached company first
      let company = (Array.isArray(window.allCompaniesData) ? window.allCompaniesData.find(c => normalizeForMatching(c.name) === normalizeForMatching(companyName)) : null);
      if (!company) {
        // Query supabase for a matching company by name (case-insensitive, partial match)
        const { data, error } = await supabaseClient
          .from('companies')
          .select('id,name,domain,logo_url')
          .ilike('name', `%${companyName}%`)
          .limit(1);
        if (!error && Array.isArray(data) && data.length > 0) {
          company = data[0];
          window.allCompaniesData = window.allCompaniesData || [];
          // Avoid duplicates
          if (!window.allCompaniesData.find(c => String(c.id) === String(company.id))) {
            window.allCompaniesData.push(company);
          }
        }
      }

      if (company && company.logo_url) {
        // Preload the company.logo_url before assigning to DOM to avoid broken images
        const candidate = company.logo_url;
        // testing logo for company (silent)
        const imgEl = card.querySelector('.opp-company-avatar img');
        const placeholder = card.querySelector('.mention-avatar');
        try {
          await new Promise((resolve, reject) => {
            const tester = new Image();
            tester.onload = () => resolve(true);
            tester.onerror = () => reject(new Error('image load failed'));
            // attempt to load via tester
            tester.src = candidate;
            // Add a timeout in case of hanging requests
            setTimeout(() => reject(new Error('image load timeout')), 3000);
          });
          // success — set DOM image
          if (imgEl) {
            imgEl.src = candidate;
            imgEl.style.display = 'block';
          }
          if (placeholder) placeholder.style.display = 'none';
          // loaded logo for company
        } catch (e) {
          // logo failed for company, falling back
          // fallback: try domain favicon if present
          const domainCandidate = company.domain ? getCompanyLogoUrl(company.domain) : '';
          const finalFallback = domainCandidate || `https://ui-avatars.com/api/?name=${encodeURIComponent(companyName || company.name)}&background=ededed&color=444&size=64`;
          if (imgEl) {
            imgEl.src = finalFallback;
            imgEl.style.display = 'block';
          }
          if (placeholder) placeholder.style.display = 'none';
        }
      }
    } catch (e) {
      console.warn('updateOpportunityLogosAsync error', e);
    }
  }
}

function initOpportunityEventListeners(opportunities) {
  // Add opportunity button
  document.getElementById('add-opportunity-btn')?.addEventListener('click', () => {
    openOpportunityModal();
  });

  document.querySelectorAll('.pipeline-inline-add').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const stage = btn.dataset.stage || 'prospecting';
      openOpportunityModal();
      setTimeout(() => {
        const stageField = document.getElementById('opportunity-stage');
        if (stageField) {
          stageField.value = stage;
        }
      }, 0);
    });
  });

  // Edit opportunity buttons
  document.querySelectorAll('.edit-opportunity').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const opportunityId = btn.dataset.id;
      const opportunity = opportunities.find(opp => opp.id === opportunityId);
      if (opportunity) {
        openOpportunityModal(opportunity);
      }
    });
  });

  // Delete opportunity buttons
  document.querySelectorAll('.delete-opportunity').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const opportunityId = btn.dataset.id;
      const opportunity = opportunities.find(opp => opp.id === opportunityId);

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
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const opportunityId = btn.dataset.id;
      const opportunity = opportunities.find(opp => opp.id === opportunityId);
      if (opportunity) {
        openOpportunityViewModal(opportunity);
      }
    });
  });

  // Click on opportunity card to view details
  document.querySelectorAll('.opportunity-card').forEach(card => {
    card.addEventListener('click', () => {
      const opportunityId = card.dataset.id;
      const opportunity = opportunities.find(opp => opp.id === opportunityId);
      if (opportunity) {
        openOpportunityViewModal(opportunity);
      }
    });
  });

  // Make mentioned person spans clickable to open the person view modal
  document.querySelectorAll('.opportunity-card .mentioned-person').forEach(el => {
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

              // Map old stage values to new ones for the mappedStage property
              const stageMapping = {
                'prospecting': 'prospecting',
                'qualification': 'qualification',
                'proposal': 'qualification',
                'negotiation': 'qualification',
                'closed-won': 'closed-won',
                'closed-lost': 'closed-lost'
              };
              opportunity.mappedStage = stageMapping[newStage] || newStage;
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
  const quickFilterSelect = document.getElementById('pipeline-quick-filter');
  const searchInput = document.getElementById('pipeline-search');
  const ownerSelect = document.getElementById('pipeline-owner-filter');
  const sortSelect = document.getElementById('pipeline-sort');
  const advancedToggle = document.getElementById('pipeline-advanced-toggle');
  const advancedControls = document.getElementById('pipeline-advanced-controls');
  const resetBtn = document.getElementById('pipeline-reset-controls');

  // Load persisted state
  const persistedState = _loadPersistedState().pipeline || {};
  if (searchInput && persistedState.search) searchInput.value = persistedState.search;
  if (quickFilterSelect && persistedState.quickFilter) quickFilterSelect.value = persistedState.quickFilter;
  if (ownerSelect && persistedState.owner) ownerSelect.value = persistedState.owner;
  if (sortSelect && persistedState.sort) sortSelect.value = persistedState.sort;
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
    if (resetBtn) resetBtn.style.display = hasFilters ? 'inline-flex' : 'none';

    document.querySelectorAll('.opportunity-card').forEach(card => {
      let show = true;
      const oppId = card.dataset.id;
      const opportunity = opportunities.find(opp => opp.id === oppId);

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
    if (quickFilterSelect) quickFilterSelect.value = 'all';
    if (ownerSelect) ownerSelect.value = 'all';
    if (sortSelect) sortSelect.value = 'newest';
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

function openOpportunityModal(opportunity = null) {
  const modal = document.getElementById('opportunity-modal');
  const modalTitle = document.getElementById('opportunity-modal-title');
  const saveBtn = document.getElementById('save-opportunity-btn');

  // Reset form
  document.getElementById('opportunity-name').value = '';
  document.getElementById('opportunity-company').value = '';
  document.getElementById('opportunity-value').value = '';
  document.getElementById('opportunity-probability').value = 50;
  document.getElementById('probability-display').textContent = '50';
  document.getElementById('opportunity-stage').value = 'prospecting'; // Default to first stage
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

  // Set modal title
  if (opportunity) {
    modalTitle.innerHTML = `Edit Opportunity`;

    // Fill form with opportunity data
    document.getElementById('opportunity-name').value = opportunity.name || '';
    document.getElementById('opportunity-company').value = opportunity.company_name || '';
    document.getElementById('opportunity-value').value = opportunity.value || '';
    document.getElementById('opportunity-probability').value = opportunity.probability || 50;
    document.getElementById('probability-display').textContent = opportunity.probability || 50;

    // Map old stage values to new ones
    let stageValue = opportunity.stage || 'prospecting';
    if (opportunity.stage === 'qualification') stageValue = 'qualification'; // Map to In Progress
    if (opportunity.stage === 'proposal' || opportunity.stage === 'negotiation') stageValue = 'qualification'; // Map to In Progress
    if (opportunity.stage === 'closed-won') stageValue = 'closed-won'; // Map to Won/Invoiced

    document.getElementById('opportunity-stage').value = stageValue;

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
    const pipelineStages = [
      { id: 'prospecting', title: 'Lead', color: '#3b82f6' },
      { id: 'qualification', title: 'In Progress', color: '#ec4899' },
      { id: 'closed-won', title: 'Won 🎉', color: '#10b981' },
      { id: 'closed-lost', title: 'Lost', color: '#ef4444' }
    ];
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

    avatarEl.innerHTML = `<span style="position:relative;z-index:1">${initials}</span>${resolvedLogoUrl ? `<img src="${resolvedLogoUrl}" alt="${escapeHtml(opportunity.company_name || '')}" onload="this.style.display='block';this.previousElementSibling.style.display='none'" onerror="this.style.display='none'" />` : ''}`;

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

  // Edit Action
  const editBtn = document.getElementById('opportunity-view-edit-btn');
  if (editBtn) {
    const canEdit = !state.isManager || opportunity.user_id === state.currentUser.id;
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
      const opportunityData = {
        user_id: state.currentUser.id,
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
        organization_id: state.currentOrganization?.id
      };

      let result;

      if (opportunity) {
        // Update existing opportunity
        result = await supabaseClient
          .from('opportunities')
          .update(opportunityData)
          .eq('id', opportunity.id);
      } else {
        // Create new opportunity
        result = await supabaseClient
          .from('opportunities')
          .insert([opportunityData]);
      }

      if (result.error) throw result.error;

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

  refreshDueNotifications({ forcePopup: true });
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
};
