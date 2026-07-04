// modules/features/people.js
// People list, person modal, phone numbers.
import { state, supabaseClient, crmDebugLog, saveViewState } from '../state.js';
import { viewContainer } from '../ui/dom.js';
import { showToast, escapeHtml, getInitials } from '../ui/toast.js';
import { renderSkeletonCards, renderError, getCurrencySymbol } from '../utils/helpers.js';
import { renderEditableDataTable, normalizeSearchText, normalizeForMatching, findDuplicatePersonContact } from '../ui/spreadsheet.js';
import { renderCustomFieldsForm, collectCustomFieldValues, validateCustomFields, saveCustomFieldValues, fetchCustomFieldValues, renderCustomFieldsDisplay } from './custom-fields.js';

// ======================
// PEOPLE VIEW
// ======================

async function renderPeopleView() {
  const peopleState = state.tableViewState.people;
  state.currentFilters.person_company = peopleState.companyId || '';

  // Restore per-view sort — avoids sorting from another view leaking in
  state.currentSortKey = peopleState.sortKey || 'name';
  state.currentSortDir = peopleState.sortDir || 'asc';

  const sortablePeopleColumns = ['name', 'email', 'job_title', 'phone_numbers'];
  const safeSortKey = sortablePeopleColumns.includes(state.currentSortKey) ? state.currentSortKey : 'name';
  if (state.currentSortKey !== safeSortKey) {
    state.currentSortKey = safeSortKey;
    state.currentSortDir = 'asc';
  }

  // Ensure the global data is loaded
  if (window.allPeoplePromise) await window.allPeoplePromise;
  if (window.allCompaniesPromise) await window.allCompaniesPromise;

  if (!window.opportunitiesData) {
    const orgId = state.currentOrganization?.id;
    let roQ = supabaseClient.from('opportunities').select('id, name').order('name', { ascending: true });
    if (orgId) {
      roQ = roQ.eq('organization_id', orgId);
    }
    const { data: opportunities, error } = await roQ;
    if (error) {
      crmDebugLog('renderPeopleView.opportunitiesError', error);
      viewContainer.innerHTML = renderError(error.message);
      return;
    }
    window.opportunitiesData = opportunities || [];
  }

  // Use the cached data
  window.companiesData = window.allCompaniesData || [];
  if (!window.allPeopleData || window.allPeopleData.length === 0) {
    window.allPeopleData = state.allPeople || [];
  }

  // Sort people in memory
  window.allPeopleData.sort((a, b) => {
    let valA = a[safeSortKey] || '';
    let valB = b[safeSortKey] || '';
    if (Array.isArray(valA)) valA = valA.length; // for phone_numbers
    if (Array.isArray(valB)) valB = valB.length;
    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();
    if (valA < valB) return state.currentSortDir === 'asc' ? -1 : 1;
    if (valA > valB) return state.currentSortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const companiesById = new Map((window.companiesData || []).map((company) => [String(company.id), company]));
  const opportunitiesById = new Map((window.opportunitiesData || []).map((opportunity) => [String(opportunity.id), opportunity]));

  // Ensure relationships are mapped
  window.allPeopleData = window.allPeopleData.map((person) => {
    const company = person.company_id ? companiesById.get(String(person.company_id)) || null : null;
    const opportunity = person.opportunity_id ? opportunitiesById.get(String(person.opportunity_id)) || null : null;

    return {
      ...person,
      company,
      companies: company,
      opportunity
    };
  });

  crmDebugLog('renderPeopleView.cachedData', {
    peopleCount: window.allPeopleData.length,
    companiesCount: window.companiesData.length,
    opportunitiesCount: window.opportunitiesData.length,
    samplePerson: window.allPeopleData.length > 0 ? window.allPeopleData[0] : null
  });

  // Initial pagination state
  let currentPage = peopleState.currentPage || 1;
  const recordsPerPage = 15; // Number of records per page
  let searchQuery = peopleState.searchQuery || ''; // Separate search state

  // Function to render the people table
  function renderPeopleTable(peopleToRender, paginationInfo) {
    const columns = [
      {
        key: 'selection',
        label: '<input type="checkbox" class="selection-checkbox" id="people-select-all">',
        width: '50px',
        readOnly: true,
        sortable: false,
        render: (val, row) => `<input type="checkbox" class="selection-checkbox row-select" data-id="${row.id}" ${state.selectedRecordIds.has(row.id) ? 'checked' : ''}>`
      },
      {
        key: 'name', label: 'Name', width: '210px', icon: 'user', sortable: true, render: (val) => `
        <div style="display: flex; align-items: center; gap: 8px;">
          <div class="mention-avatar" style="width: 24px; height: 24px; font-size: 0.75rem;">${getInitials(val)}</div>
          <span>${val}</span>
        </div>
      `},
      { key: 'email', label: 'Email', width: '250px', icon: 'mail', sortable: true },
      { key: 'company.name', label: 'Company', width: '160px', icon: 'building', readOnly: true, sortable: false, render: (val, row) => row.company ? row.company.name : 'No company' },
      { key: 'job_title', label: 'Job Title', width: '150px', icon: 'briefcase', sortable: true },
      { key: 'phone_numbers', label: 'Phone', width: '150px', icon: 'phone', sortable: true, render: (phones) => phones && Array.isArray(phones) ? phones.join(', ') : (phones || 'N/A') },
      {
        key: 'actions', label: 'Actions', width: '140px', readOnly: true, sortable: false, render: (val, row) => `
        <div class="table-actions">
          <button class="action-btn view-person" data-id="${row.id}" title="View person"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"/><path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg></button>
          <button class="action-btn edit-person" data-id="${row.id}" title="Edit person"><i data-lucide="square-pen"></i></button>
          <button class="action-btn delete-person" data-id="${row.id}" title="Delete person"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"/></svg></button>
        </div>
      `},
    ];

    let html = `

      <div class="view-toolbar">
        <div class="search-container u-flex-1 u-maxw-320">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="u-icon-16 u-search-icon-muted"><path d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"/></svg>
          <input type="text" id="people-search" placeholder="Search people...">
          <div id="clear-people-search" class="search-clear-btn hidden" title="Clear search">
            <i data-lucide="x" class="u-icon-16"></i>
          </div>
        </div>
        
        <div class="u-flex-1"></div>
        <button class="toolbar-btn toolbar-btn-primary" id="add-person-btn">
          <i data-lucide="plus" class="u-icon-16"></i> New Person
        </button>
      </div>
      
      ${renderEditableDataTable(peopleToRender, columns, 'people-spreadsheet', 'people')}
      
      <div id="people-pagination" class="u-p-md"></div>
    `;

    viewContainer.innerHTML = html;

    // Initialize Lucide icons immediately
    if (window.lucide) lucide.createIcons();

    // Restore search value after rendering
    const searchInput = document.getElementById('people-search');
    if (searchInput && searchInput.value !== searchQuery) {
      searchInput.value = searchQuery;
    }

    // Create pagination controls
    createPaginationControls(
      paginationInfo.currentPage,
      paginationInfo.totalPages,
      paginationInfo.totalRecords,
      paginationInfo.recordsPerPage,
      'people-pagination',
      (newPage) => {
        currentPage = newPage;
        peopleState.currentPage = currentPage;
        saveViewState({ people: peopleState });
        const result = searchAndPaginate(
          window.allPeopleData,
          searchQuery,
          currentPage,
          recordsPerPage,
          (item, query) => filterAndSearchPerson(item, query)
        );
        renderPeopleTable(result.data, result);
      }
    );

    // Initialize event listeners
    initializePeopleEventListeners();
  }

  // Separate function to initialize event listeners
  function initializePeopleEventListeners() {
    const searchInput = document.getElementById('people-search');
    // Clear search event
    const clearSearchBtn = document.getElementById('clear-people-search');
    if (clearSearchBtn) {
      if (searchQuery) clearSearchBtn.classList.remove('hidden');
      clearSearchBtn.onclick = () => {
        searchQuery = '';
        peopleState.searchQuery = searchQuery;
        searchInput.value = '';
        clearSearchBtn.classList.add('hidden');
        currentPage = 1;
        peopleState.currentPage = currentPage;
        saveViewState({ people: peopleState });
        const result = searchAndPaginate(
          window.allPeopleData,
          searchQuery,
          1,
          recordsPerPage,
          (item, query) => filterAndSearchPerson(item, query)
        );
        renderPeopleTable(result.data, result);
      };
    }

    // Company filter event
    const companyFilter = document.getElementById('people-company-filter');
    if (companyFilter) {
      companyFilter.onchange = (e) => {
        state.currentFilters.person_company = e.target.value;
        peopleState.companyId = state.currentFilters.person_company;
        currentPage = 1;
        peopleState.currentPage = currentPage;
        saveViewState({ people: peopleState });
        const result = searchAndPaginate(
          window.allPeopleData,
          searchQuery,
          1,
          recordsPerPage,
          (item, query) => filterAndSearchPerson(item, query)
        );
        renderPeopleTable(result.data, result);
      };
    }

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const cursorPosition = e.target.selectionStart;
        const searchValue = e.target.value;

        searchQuery = searchValue;
        peopleState.searchQuery = searchQuery;
        saveViewState({ people: peopleState });
        if (searchQuery) {
          clearSearchBtn?.classList.remove('hidden');
        } else {
          clearSearchBtn?.classList.add('hidden');
        }

        clearTimeout(searchInput.searchTimeout);
        searchInput.searchTimeout = setTimeout(() => {
          currentPage = 1;
          peopleState.currentPage = currentPage;
          saveViewState({ people: peopleState });

          const activeElement = document.activeElement;
          const wasSearchInput = activeElement && activeElement.id === 'people-search';

          const result = searchAndPaginate(
            window.allPeopleData,
            searchQuery,
            1,
            recordsPerPage,
            (item, query) => filterAndSearchPerson(item, query)
          );
          renderPeopleTable(result.data, result);

          if (wasSearchInput) {
            setTimeout(() => {
              const searchElement = document.getElementById('people-search');
              if (!searchElement) return;
              searchElement.focus();
              searchElement.setSelectionRange(cursorPosition, cursorPosition);
            }, 0);
          }
        }, 250);
      });
    }

    // Sort event
    const sortBtn = document.getElementById('people-sort-btn');
    if (sortBtn) {
      sortBtn.onclick = () => {
        handleHeaderSort('name');
      };
    }

    // Add person button
    document.getElementById('add-person-btn')?.addEventListener('click', () => {
      openPersonModal();
    });

    // Edit and delete buttons
    document.querySelectorAll('.edit-person').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const personId = btn.dataset.id;
        const person = window.allPeopleData.find(p => p.id === personId);
        if (person) {
          openPersonModal(person);
        }
      });
    });

    // View person handlers
    document.querySelectorAll('.view-person').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const personId = btn.dataset.id;
        const person = window.allPeopleData.find(p => String(p.id) === String(personId));
        if (person) {
          openPersonViewModal(person);
        }
      });
    });

    document.querySelectorAll('.delete-person').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const personId = btn.dataset.id;
        const person = window.allPeopleData.find(p => p.id === personId);

        const confirmed = await showConfirmDialog(
          'Delete Person',
          `Are you sure you want to delete ${person.name}?`
        );

        if (!confirmed) return;

        const { error } = await supabaseClient
          .from('people')
          .delete()
          .eq('id', personId);

        if (error) {
          showToast('Error deleting person: ' + error.message, 'error');
          return;
        }

        // Remove from local data and refresh
        window.allPeopleData = window.allPeopleData.filter(p => p.id !== personId);

        showToast('Person deleted successfully', 'success');

        // Re-render with current page
        const result = searchAndPaginate(
          window.allPeopleData,
          searchQuery,
          currentPage,
          recordsPerPage,
          (item, query) => filterAndSearchPerson(item, query)
        );

        // Adjust current page if necessary
        if (result.data.length === 0 && result.currentPage > 1) {
          currentPage--;
          const adjustedResult = searchAndPaginate(
            window.allPeopleData,
            searchQuery,
            currentPage,
            recordsPerPage,
            (item, query) => filterAndSearchPerson(item, query)
          );
          renderPeopleTable(adjustedResult.data, adjustedResult);
        } else {
          renderPeopleTable(result.data, result);
        }
      });
    });
  }

  // Helper for combined filter/search
  function filterAndSearchPerson(person, query) {
    if (state.currentFilters.person_company && String(person.company_id || '') !== String(state.currentFilters.person_company)) return false;
    if (!query) return true;
    return matchesTokenizedQuery(
      query,
      person.name,
      person.email,
      person.job_title,
      person.company && person.company.name
    );
  }

  // Initial data processing
  const initialPeopleData = searchAndPaginate(
    window.allPeopleData,
    searchQuery,
    currentPage,
    recordsPerPage,
    (item, query) => filterAndSearchPerson(item, query)
  );
  renderPeopleTable(initialPeopleData.data, initialPeopleData);

  // Explicitly initialize icons after rendering table
  if (window.lucide) lucide.createIcons();
}


// Update the openPersonModal function to use the global data
async function openPersonModal(person = null) {
  const modal = document.getElementById('person-modal');
  const modalTitle = document.getElementById('person-modal-title');
  const saveBtn = document.getElementById('save-person-btn');
  const companyInput = document.getElementById('person-company');
  const opportunitySelect = document.getElementById('person-opportunity');
  const addMoreWrapper = document.getElementById('person-add-more-wrapper');

  // Reset form
  document.getElementById('person-name').value = '';
  document.getElementById('person-email').value = '';
  document.getElementById('person-job-title').value = '';
  companyInput.value = '';
  companyInput.dataset.companyId = '';

  // Clear phone numbers
  document.getElementById('phone-numbers-container').innerHTML = `
    <div class="phone-number-input">
      <input type="tel" class="phone-number" placeholder="e.g., +254 712 345 678">
      <button type="button" class="btn btn-sm btn-ghost add-phone-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-plus-icon lucide-plus"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
      </button>
    </div>
  `;
  state.personPhoneNumbers = [];

  // Populate opportunity dropdown using global data
  if (window.opportunitiesData) {
    opportunitySelect.innerHTML = '<option value="">Select an opportunity</option>';
    window.opportunitiesData.forEach(opportunity => {
      opportunitySelect.innerHTML += `<option value="${opportunity.id}">${opportunity.name}</option>`;
    });
  }

  // Set modal title
  if (person) {
    modalTitle.innerHTML = 'Edit Person';
    if (addMoreWrapper) addMoreWrapper.style.display = 'none';

    // Fill form with person data
    document.getElementById('person-name').value = person.name || '';
    document.getElementById('person-email').value = person.email || '';
    document.getElementById('person-job-title').value = person.job_title || '';

    if (person.company_id) {
      // Find and set company name
      const company = window.companiesData?.find(c => c.id === person.company_id);
      if (company) {
        companyInput.value = company.name;
        companyInput.dataset.companyId = person.company_id;
      }
    }

    if (person.opportunity_id) {
      opportunitySelect.value = person.opportunity_id;
    }

    // Add phone numbers
    if (person.phone_numbers && person.phone_numbers.length > 0) {
      state.personPhoneNumbers = [...person.phone_numbers];
      renderPhoneNumbers();
    }
  } else {
    modalTitle.innerHTML = 'New Person';
    if (addMoreWrapper) addMoreWrapper.style.display = 'inline-flex';
  }

  // Show modal
  modal.style.display = 'flex';
  document.body.classList.add('modal-active');

  // Render custom fields
  if (person) {
    const existingValues = await fetchCustomFieldValues('person', person.id);
    await renderCustomFieldsForm('person', 'person-custom-fields-section', existingValues);
  } else {
    await renderCustomFieldsForm('person', 'person-custom-fields-section');
  }

  // Initialize event listeners
  initPersonModalListeners(person);
}

/**
 * Person view modal — show a quick profile summary and related activity tabs.
 * Accepts a person object or person id.
 */
async function openPersonViewModal(personOrId) {
  const modal = document.getElementById('person-view-modal');
  if (!modal) {
    showToast('Person view modal not found', 'error');
    return;
  }

  let person = personOrId;
  if (!person || (typeof person === 'string' || typeof person === 'number')) {
    const personId = person || personOrId;
    person = (Array.isArray(window.allPeopleData) ? window.allPeopleData.find(p => String(p.id) === String(personId)) : null);
  }

  if (!person) {
    showToast('Unable to load person', 'error');
    return;
  }

  // If the person object doesn't include extended fields (like phone_numbers), fetch full record
  if ((!person.phone_numbers || !Array.isArray(person.phone_numbers)) || (!person.notes && !person.job_title && !person.company)) {
    try {
      const { data: fullPerson, error: personErr } = await supabaseClient
        .from('people')
        .select('*')
        .eq('id', person.id)
        .single();

      if (!personErr && fullPerson) {
        // Merge fetched fields onto the person reference used below
        person = { ...person, ...fullPerson };
      }
    } catch (fetchErr) {
      crmDebugLog('openPersonViewModal.fetchErr', fetchErr);
    }
  }

  document.getElementById('person-view-modal-title').textContent = person.name || 'Person';

  // ── Populate Hero Section ──
  const personHeroAvatar = document.getElementById('person-view-hero-avatar');
  if (personHeroAvatar) {
    const initials = getInitials(person.name || 'U');
    personHeroAvatar.innerHTML = `<span style="position:relative;z-index:1">${initials}</span>`;
  }

  const personSubtitle = document.getElementById('person-view-hero-subtitle');
  if (personSubtitle) {
    const jobTitle = person.job_title ? escapeHtml(person.job_title) : '';
    const companyName = (person.company && person.company.name) ? escapeHtml(person.company.name) : (person.company_name ? escapeHtml(person.company_name) : '');
    const companyId = person.company && person.company.id ? person.company.id : null;
    const companyHtml = companyName
      ? (companyId ? `<a href="#" class="person-view-company-link" data-id="${escapeHtml(String(companyId))}">${companyName}</a>` : companyName)
      : '';
    personSubtitle.innerHTML = jobTitle && companyHtml ? `${jobTitle} <span style="opacity:0.5;margin:0 4px">·</span> ${companyHtml}` : (jobTitle || companyHtml || '');
    if (companyId) {
      personSubtitle.querySelector('.person-view-company-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        closeModal('person-view-modal');
        setTimeout(() => openCompanyViewModal(companyId), 140);
      });
    }
  }

  // Wire Edit button
  const personEditBtn = document.getElementById('person-view-edit-btn');
  if (personEditBtn) {
    personEditBtn.onclick = () => {
      closeModal('person-view-modal');
      setTimeout(() => openPersonModal(person), 100);
    };
  }

  // ── Populate Sidebar Fields ──
  const emailEl = document.getElementById('person-view-email');
  if (emailEl) emailEl.innerHTML = person.email ? `<a href="mailto:${escapeHtml(person.email)}">${escapeHtml(person.email)}</a>` : '—';
  const phoneEl = document.getElementById('person-view-phone');
  if (phoneEl) phoneEl.innerHTML = (person.phone_numbers && person.phone_numbers.length) ? person.phone_numbers.map(p => `<a href="tel:${escapeHtml(p)}">${escapeHtml(p)}</a>`).join('<br>') : (person.phone || '—');
  const companyEl = document.getElementById('person-view-company');
  if (companyEl) {
    const pCompany = (person.company && person.company.name) ? person.company : null;
    if (pCompany && pCompany.id) {
      companyEl.innerHTML = `<a href="#" class="person-view-company-link" data-id="${escapeHtml(String(pCompany.id))}">${escapeHtml(pCompany.name)}</a>`;
      companyEl.querySelector('.person-view-company-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        closeModal('person-view-modal');
        setTimeout(() => openCompanyViewModal(pCompany.id), 140);
      });
    } else {
      companyEl.textContent = (person.company && person.company.name) ? person.company.name : (person.company_name || '—');
    }
  }
  const titleEl = document.getElementById('person-view-title'); if (titleEl) titleEl.textContent = person.job_title || '—';
  const notesEl = document.getElementById('person-view-notes'); if (notesEl) notesEl.textContent = person.notes || '—';

  // Render custom fields in sidebar
  renderCustomFieldsDisplay('person', 'person-view-custom-fields', person.id);

  // Tab placeholders
  document.getElementById('person-view-opps').innerHTML = '<div class="record-empty-state"><div class="record-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div><div class="record-empty-title">Loading...</div></div>';
  const personCallsPanel = document.getElementById('person-view-calls');
  if (personCallsPanel) personCallsPanel.innerHTML = '<div class="record-empty-state"><div class="record-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.79 19.79 0 0 1 11.63 19"/></svg></div><div class="record-empty-title">Loading...</div></div>';
  const personVisitsPanel = document.getElementById('person-view-visits');
  if (personVisitsPanel) personVisitsPanel.innerHTML = '<div class="record-empty-state"><div class="record-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/></svg></div><div class="record-empty-title">Loading...</div></div>';

  // Reset stats
  const pipelineStat = document.getElementById('person-stat-pipeline'); if (pipelineStat) pipelineStat.textContent = '—';
  const oppsStat = document.getElementById('person-stat-opps'); if (oppsStat) oppsStat.textContent = '—';
  const callsStat = document.getElementById('person-stat-calls'); if (callsStat) callsStat.textContent = '—';
  const activityStat = document.getElementById('person-stat-activity'); if (activityStat) activityStat.textContent = '—';

  // Reset tab counts
  ['person-tab-opps-count', 'person-tab-calls-count', 'person-tab-visits-count'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '0'; });

  // Reset tabs to first tab active
  modal.querySelectorAll('.person-view-tab').forEach((t, i) => t.classList.toggle('active', i === 0));
  document.getElementById('person-view-opps').style.display = 'block';
  const personCallsReset = document.getElementById('person-view-calls'); if (personCallsReset) personCallsReset.style.display = 'none';
  const personVisitsReset = document.getElementById('person-view-visits'); if (personVisitsReset) personVisitsReset.style.display = 'none';

  modal.style.display = 'flex';

  // Tab switching (updated for new tabs)
  const personTabs = modal.querySelectorAll('.person-view-tab');
  personTabs.forEach(tab => {
    tab.onclick = () => {
      personTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const name = tab.dataset.tab;
      document.getElementById('person-view-opps').style.display = name === 'opps' ? 'block' : 'none';
      const callsEl = document.getElementById('person-view-calls');
      if (callsEl) callsEl.style.display = name === 'calls' ? 'block' : 'none';
      const visitsEl = document.getElementById('person-view-visits');
      if (visitsEl) visitsEl.style.display = name === 'visits' ? 'block' : 'none';
    };
  });

  // Fetch all related data in parallel
  (async () => {
    try {
      // Build opportunity queries
      const oppQueries = [];
      if (person.opportunity && person.opportunity.id) {
        oppQueries.push(supabaseClient.from('opportunities').select('*').eq('id', person.opportunity.id));
      } else if (person.opportunity_id) {
        oppQueries.push(supabaseClient.from('opportunities').select('*').eq('id', person.opportunity_id).limit(1));
      }
      oppQueries.push(supabaseClient.from('opportunities').select('*').or(`contact_id.eq.${person.id},person_id.eq.${person.id}`).limit(50));

      const [callsResult, visitsResult, ...oppResults] = await Promise.all([
        supabaseClient.from('call_logs').select('*, people(*), profiles(*)').eq('person_id', person.id).order('call_at', { ascending: false }).limit(50),
        supabaseClient.from('visits').select('*, user:profiles(first_name,last_name)').eq('person_id', person.id).order('created_at', { ascending: false }).limit(10),
        ...oppQueries
      ]);

      // Dedupe opportunities
      const oppMap = new Map();
      oppResults.forEach(r => { (r.data || []).forEach(o => { if (o && o.id) oppMap.set(String(o.id), o); }); });
      const opps = Array.from(oppMap.values());
      const calls = callsResult.data || [];
      const visits = visitsResult.data || [];

      // ── Populate Stats Bar ──
      const totalPipeline = opps.reduce((sum, o) => sum + (parseFloat(o.value || o.amount || 0) || 0), 0);
      if (pipelineStat) pipelineStat.textContent = totalPipeline ? `${getCurrencySymbol()} ${totalPipeline.toLocaleString()}` : '0';
      if (oppsStat) oppsStat.textContent = String(opps.length);
      if (callsStat) callsStat.textContent = String(calls.length);

      // Determine last activity
      const dates = [];
      if (calls.length) dates.push(new Date(calls[0].call_at));
      if (visits.length) dates.push(new Date(visits[0].created_at));
      opps.forEach(o => { if (o.updated_at) dates.push(new Date(o.updated_at)); });
      if (dates.length) {
        const latest = new Date(Math.max(...dates.map(d => d.getTime())));
        const daysAgo = Math.floor((Date.now() - latest.getTime()) / (1000 * 60 * 60 * 24));
        if (activityStat) activityStat.textContent = daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : `${daysAgo}d ago`;
      }

      // ── Update Tab Counts ──
      const oppsCountEl = document.getElementById('person-tab-opps-count'); if (oppsCountEl) oppsCountEl.textContent = String(opps.length);
      const callsCountEl = document.getElementById('person-tab-calls-count'); if (callsCountEl) callsCountEl.textContent = String(calls.length);
      const visitsCountEl = document.getElementById('person-tab-visits-count'); if (visitsCountEl) visitsCountEl.textContent = String(visits.length);

      // ── Render Opportunities Tab ──
      const oppsEl = document.getElementById('person-view-opps');
      if (opps.length === 0 && person.id) {
        const { data, error } = await supabaseClient.from('opportunities').select('*').or(`contact_id.eq.${person.id},person_id.eq.${person.id}`).limit(50);
        if (!error && data && data.length) opps = data;
      }

      if (!opps || opps.length === 0) {
        oppsEl.innerHTML = `<div class="record-empty-state"><div class="record-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div><div class="record-empty-title">No opportunities linked</div><div class="record-empty-desc">This person is not linked to any active opportunities yet.</div></div>`;
      } else {
        const stageColors = { prospecting: '#6366f1', qualification: '#f59e0b', proposal: '#3b82f6', negotiation: '#f97316', won: '#22c55e', lost: '#ef4444' };
        oppsEl.innerHTML = opps.map(opp => {
          const stage = opp.stage || opp.status || '—';
          const rawValue = opp.value || opp.amount || opp.estimated_value || opp.deal_value || 0;
          const numeric = Number(String(rawValue).replace(/[^0-9.-]+/g, '')) || 0;
          const displayValue = numeric ? numeric.toLocaleString() : '0';
          const prob = (opp.probability || opp.win_probability || opp.prob || 0);
          const stageKey = stage.toLowerCase();
          const stageColor = stageColors[stageKey] || 'var(--color-primary)';
          return `
            <div class="record-opp-card" data-id="${opp.id}">
              <div class="record-opp-card-stage" style="background:${stageColor}"></div>
              <div class="record-opp-card-body">
                <div class="record-opp-card-name">${escapeHtml(opp.name || '—')}</div>
                <div class="record-opp-card-meta">
                  <span class="stage-pill" style="background:${stageColor}1a;color:${stageColor};border-color:${stageColor}40">${escapeHtml(stage)}</span>
                  <span>${prob}% probability</span>
                </div>
              </div>
              <div class="record-opp-card-value">${getCurrencySymbol()} ${displayValue}</div>
              <div class="record-opp-card-action"><button class="btn btn-sm btn-ghost view-opportunity" data-id="${opp.id}">View</button></div>
            </div>
          `;
        }).join('');


        // Attach view handlers
        oppsEl.querySelectorAll('.view-opportunity').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            const opp = (opps || []).find(o => String(o.id) === String(id));
            if (opp) {
              closeModal('person-view-modal');
              const isOwnOpportunity = !state.isManager || opp.user_id === state.currentUser.id;
              setTimeout(() => openOpportunityModal(opp, !isOwnOpportunity), 140);
            }
          });
        });
      }

      // ── Render Call Logs Tab ──
      const personCallsEl = document.getElementById('person-view-calls');
      if (personCallsEl) {
        if (!calls || calls.length === 0) {
          personCallsEl.innerHTML = `<div class="record-empty-state"><div class="record-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.79 19.79 0 0 1 11.63 19a19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72"/></svg></div><div class="record-empty-title">No call logs</div><div class="record-empty-desc">No call records found for this person.</div></div>`;
        } else {
          personCallsEl.innerHTML = calls.map(log => {
            const isInbound = (log.direction || '').toLowerCase() === 'inbound';
            const phoneIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.79 19.79 0 0 1 11.63 19a19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3"/></svg>`;
            const repName = escapeHtml(log.profiles ? `${log.profiles.first_name || ''} ${log.profiles.last_name || ''}`.trim() : '');
            return `
              <div class="record-call-row" data-id="${log.id}">
                <div class="record-call-icon${isInbound ? ' record-call-icon--inbound' : ''}">${phoneIcon}</div>
                <div class="record-call-body">
                  <div class="record-call-contact">${escapeHtml(log.company_name || log.notes || 'Call')}</div>
                  <div class="record-call-meta">${typeof formatDateWithTime === 'function' ? formatDateWithTime(log.call_at) : new Date(log.call_at).toLocaleDateString()}${repName ? ` · ${repName}` : ''}</div>
                </div>
                <div class="record-call-right">
                  <span class="record-call-outcome-pill">${escapeHtml(log.outcome || 'N/A')}</span>
                </div>
              </div>
            `;
          }).join('');
        }
      }

      // ── Render Visits Tab ──
      const personVisitsEl = document.getElementById('person-view-visits');
      if (personVisitsEl) {
        if (!visits || visits.length === 0) {
          personVisitsEl.innerHTML = `<div class="record-empty-state"><div class="record-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg></div><div class="record-empty-title">No recent visits</div><div class="record-empty-desc">No visits have been recorded for this person yet.</div></div>`;
        } else {
          const pinSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
          personVisitsEl.innerHTML = visits.map(v => {
            const repName = v.user ? `${v.user.first_name || ''} ${v.user.last_name || ''}`.trim() : '';
            return `
              <div class="record-visit-row" data-id="${v.id}">
                <div class="record-visit-dot">${pinSvg}</div>
                <div class="record-visit-body">
                  <div class="record-visit-type">${escapeHtml(v.contact_name || v.visit_type || 'Visit')}</div>
                  <div class="record-visit-meta">${escapeHtml(v.visit_type || '')} · ${typeof formatDate === 'function' ? formatDate(v.created_at) : new Date(v.created_at).toLocaleDateString()}${repName ? ` · ${escapeHtml(repName)}` : ''}</div>
                  ${v.notes ? `<div class="record-visit-notes">${escapeHtml(v.notes)}</div>` : ''}
                </div>
              </div>
            `;
          }).join('');
        }
      }

    } catch (e) {
      const oppsEl = document.getElementById('person-view-opps');
      if (oppsEl) oppsEl.innerHTML = '<div class="text-center p-6">Error loading data</div>';
      crmDebugLog('person-view-data-error', e);
    }
  })();

}


function initPersonModalListeners(person) {
  // Company search functionality
  const companyInput = document.getElementById('person-company');
  const searchResults = document.getElementById('person-company-search-results');
  const nameInput = document.getElementById('person-name');
  const emailInput = document.getElementById('person-email');
  const duplicateWarning = document.getElementById('person-duplicate-warning');

  function updatePersonDuplicateState() {
    if (person) {
      if (duplicateWarning) {
        duplicateWarning.textContent = '';
        duplicateWarning.classList.add('hidden');
      }
      return false;
    }

    const phoneInputs = document.querySelectorAll('#phone-numbers-container .phone-number');
    const phoneNumbers = Array.from(phoneInputs)
      .map((input) => input.value.trim())
      .filter((phone) => phone !== '');

    const duplicate = findDuplicatePersonContact({
      name: nameInput?.value || '',
      email: emailInput?.value || '',
      phoneNumbers,
      companyId: companyInput?.dataset?.companyId || ''
    });

    if (duplicateWarning) {
      if (duplicate) {
        duplicateWarning.textContent = `Duplicate detected: ${duplicate.name}`;
        duplicateWarning.classList.remove('hidden');
      } else {
        duplicateWarning.textContent = '';
        duplicateWarning.classList.add('hidden');
      }
    }

    return Boolean(duplicate);
  }

  if (companyInput) {
    crmDebugLog('personModal.init', {
      companiesDataCount: Array.isArray(window.companiesData) ? window.companiesData.length : 0,
      companiesDataSample: Array.isArray(window.companiesData) && window.companiesData.length > 0 ? window.companiesData[0] : null
    });

    companyInput.addEventListener('input', (e) => {
      const searchTerm = e.target.value.toLowerCase().trim();

      if (searchTerm.length === 0) {
        searchResults.style.display = 'none';
        companyInput.dataset.companyId = '';
        updatePersonDuplicateState();
        return;
      }

      // Filter companies
      const filteredCompanies = window.companiesData?.filter(company =>
        matchesTokenizedQuery(searchTerm, company.name, company.description, company.address)
      ) || [];

      crmDebugLog('personModal.companySearch', {
        term: searchTerm,
        companiesDataCount: Array.isArray(window.companiesData) ? window.companiesData.length : 0,
        matchCount: filteredCompanies.length,
        firstMatch: filteredCompanies.length > 0 ? filteredCompanies[0] : null
      });

      if (filteredCompanies.length > 0) {
        searchResults.innerHTML = filteredCompanies.slice(0, 5).map(company => `
          <div class="search-result-item" data-company-id="${company.id}" data-company-name="${company.name}">
            <div class="search-result-name">${company.name}</div>
            ${company.address ? `<div class="search-result-meta">${company.address}</div>` : ''}
          </div>
        `).join('');
        searchResults.style.display = 'block';

        // Add click handlers to results
        searchResults.querySelectorAll('.search-result-item').forEach(item => {
          item.addEventListener('click', () => {
            companyInput.value = item.dataset.companyName;
            companyInput.dataset.companyId = item.dataset.companyId;
            searchResults.style.display = 'none';
            updatePersonDuplicateState();
          });
        });
      } else {
        searchResults.innerHTML = '<div class="search-result-empty">No companies found</div>';
        searchResults.style.display = 'block';
        crmDebugLog('personModal.companySearch.noMatches', {
          term: searchTerm,
          companiesDataCount: Array.isArray(window.companiesData) ? window.companiesData.length : 0
        });
      }

      updatePersonDuplicateState();
    });

    // Hide results when clicking outside
    document.addEventListener('click', (e) => {
      if (!companyInput.contains(e.target) && !searchResults.contains(e.target)) {
        searchResults.style.display = 'none';
      }
    });
  }

  // Add phone number button
  const addPhoneBtn = document.querySelector('.add-phone-btn');
  if (addPhoneBtn) {
    const newAddPhoneBtn = addPhoneBtn.cloneNode(true);
    addPhoneBtn.parentNode.replaceChild(newAddPhoneBtn, addPhoneBtn);
    newAddPhoneBtn.addEventListener('click', (e) => {
      e.preventDefault();
      addPhoneNumber();
      setTimeout(updatePersonDuplicateState, 0);
    });
  }

  if (nameInput) nameInput.addEventListener('input', updatePersonDuplicateState);
  if (emailInput) emailInput.addEventListener('input', updatePersonDuplicateState);

  const phoneNumbersContainer = document.getElementById('phone-numbers-container');
  if (phoneNumbersContainer) {
    phoneNumbersContainer.addEventListener('input', (event) => {
      if (event.target && event.target.classList && event.target.classList.contains('phone-number')) {
        updatePersonDuplicateState();
      }
    });
    phoneNumbersContainer.addEventListener('click', (event) => {
      const removeBtn = event.target.closest('.remove-phone-btn');
      if (removeBtn) {
        setTimeout(updatePersonDuplicateState, 0);
      }
    });
  }

  updatePersonDuplicateState();

  // Save person
  const saveBtn = document.getElementById('save-person-btn');

  saveBtn.onclick = async () => {
    const name = document.getElementById('person-name').value.trim();
    const email = document.getElementById('person-email').value.trim();
    const companyId = companyInput.dataset.companyId; // Use dataset instead of value
    const jobTitle = document.getElementById('person-job-title').value.trim();
    const opportunityId = document.getElementById('person-opportunity').value;

    // Collect phone numbers
    const phoneInputs = document.querySelectorAll('.phone-number');
    const phoneNumbers = Array.from(phoneInputs)
      .map(input => input.value.trim())
      .filter(phone => phone !== '');

    // Validate
    if (!name || !companyId) {
      showToast('Please enter a name and select a company', 'error');
      return;
    }

    // Validate custom fields
    if (!validateCustomFields('person', 'person-custom-fields-section')) {
      return;
    }

    if (!person && updatePersonDuplicateState()) {
      showToast('Potential duplicate person found. Please review before saving.', 'error');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

    try {
      const personData = {
        name,
        email: email || null,
        company_id: companyId,
        job_title: jobTitle || null,
        phone_numbers: phoneNumbers.length > 0 ? phoneNumbers : null,
        opportunity_id: opportunityId || null,
        created_by: state.currentUser.id,
        organization_id: state.currentOrganization?.id
      };

      let result;

      if (person) {
        // Update existing person
        result = await supabaseClient
          .from('people')
          .update(personData)
          .eq('id', person.id);


        const index = window.allPeopleData.findIndex(p => p.id === person.id);
        if (index !== -1) {
          window.allPeopleData[index] = { ...window.allPeopleData[index], ...personData };
        }

      } else {
        // Create new person
        result = await supabaseClient
          .from('people')
          .insert([personData]);

        if (result.data && result.data.length > 0) {
          window.allPeopleData.push(result.data[0]);
        }
      }

      if (result.error) throw result.error;

      // Save custom field values
      const customValues = collectCustomFieldValues('person', 'person-custom-fields-section');
      let personId;
      if (person) {
        personId = person.id;
      } else if (result.data && result.data.length > 0) {
        personId = result.data[0].id;
      }
      if (customValues.length > 0 && personId) {
        await saveCustomFieldValues('person', personId, customValues);
      }

      const shouldAddMore = !person && Boolean(document.getElementById('person-add-more-toggle')?.checked);

      showToast(`Person ${person ? 'updated' : 'created'} successfully!`, 'success');
      closeModal('person-modal');
      await renderPeopleView();

      if (shouldAddMore) {
        openPersonModal();
        const addMoreToggle = document.getElementById('person-add-more-toggle');
        if (addMoreToggle) addMoreToggle.checked = true;
      }
    } catch (error) {
      showToast(`Error ${person ? 'updating' : 'creating'} person: ${error.message}`, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = 'Save Person';
      if (!person) updatePersonDuplicateState();
    }
  };
}

function addPhoneNumber() {
  const container = document.getElementById('phone-numbers-container');
  const phoneInput = document.createElement('div');
  phoneInput.className = 'phone-number-input';
  phoneInput.innerHTML = `
    <input type="tel" class="phone-number" placeholder="Enter phone number">
    <button type="button" class="btn btn-sm btn-ghost remove-phone-btn">
      <i class="fas fa-minus"></i>
    </button>
  `;
  container.appendChild(phoneInput);

  // Add event listener to remove button
  phoneInput.querySelector('.remove-phone-btn').addEventListener('click', () => {
    phoneInput.remove();
  });
}

function renderPhoneNumbers() {
  const container = document.getElementById('phone-numbers-container');
  container.innerHTML = '';

  state.personPhoneNumbers.forEach(phone => {
    const phoneInput = document.createElement('div');
    phoneInput.className = 'phone-number-input';
    phoneInput.innerHTML = `
      <input type="tel" class="phone-number" value="${phone}" placeholder="Enter phone number">
      <button type="button" class="btn btn-sm btn-ghost remove-phone-btn">
        <i class="fas fa-minus"></i>
      </button>
    `;
    container.appendChild(phoneInput);

    // Add event listener to remove button
    phoneInput.querySelector('.remove-phone-btn').addEventListener('click', () => {
      phoneInput.remove();
    });
  });

  // Add one empty input
  addPhoneNumber();
}

// ======================
// LOG VISIT VIEW (Updated to use companies)
// ======================



// ── Exports ────────────────────────────────────────────────────
export {
  renderPeopleView,
  openPersonModal,
  openPersonViewModal,
  initPersonModalListeners,
  addPhoneNumber,
  renderPhoneNumbers,
};
