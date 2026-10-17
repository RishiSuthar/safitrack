// modules/features/people.js
// People list, person modal, phone numbers.
import { state, supabaseClient, crmDebugLog, saveViewState } from '../state.js';
import { viewContainer } from '../ui/dom.js';
import { showToast, escapeHtml, getInitials } from '../ui/toast.js';
import { renderSkeletonCards, renderError, getCurrencySymbol } from '../utils/helpers.js';
import { renderEditableDataTable, normalizeSearchText, normalizeForMatching, findDuplicatePersonContact } from '../ui/spreadsheet.js';
import { renderCustomFieldsForm, collectCustomFieldValues, validateCustomFields, saveCustomFieldValues, fetchCustomFieldValues, renderCustomFieldsDisplay } from './custom-fields.js';
import { fetchAllPages } from '../utils/analytics.js';

// ======================
// PEOPLE VIEW
// ======================

async function renderPeopleView() {
  const peopleState = state.tableViewState.people;
  state.currentFilters.person_company = peopleState.companyId || '';

  // Restore per-view sort — avoids sorting from another view leaking in
  state.currentSortKey = peopleState.sortKey || 'name';
  state.currentSortDir = peopleState.sortDir || 'asc';

  const sortablePeopleColumns = ['name', 'email', 'company.name', 'job_title', 'phone_numbers'];
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
    const { data: opportunities, error } = await fetchAllPages(roQ);
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
    let valA, valB;
    if (safeSortKey === 'company.name') {
      valA = a.company?.name || '';
      valB = b.company?.name || '';
    } else {
      valA = a[safeSortKey] || '';
      valB = b[safeSortKey] || '';
    }
    if (Array.isArray(valA)) valA = valA.length; // for phone_numbers
    if (Array.isArray(valB)) valB = valB.length;
    if (typeof valA === 'string') valA = valA.toLowerCase().trim();
    if (typeof valB === 'string') valB = valB.toLowerCase().trim();
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
        label: '<label class="custom-chk-container" title="Select all"><input type="checkbox" class="selection-checkbox" id="people-select-all"><span class="custom-chk-visual"></span></label>',
        width: '44px',
        readOnly: true,
        sortable: false,
        render: (val, row) => `<label class="custom-chk-container"><input type="checkbox" class="selection-checkbox row-select" data-id="${row.id}" ${state.selectedRecordIds.has(row.id) ? 'checked' : ''}><span class="custom-chk-visual"></span></label>`
      },
      {
        key: 'name', label: 'Name', width: '210px', icon: 'user', sortable: true, render: (val) => `
        <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
          <div class="company-badge-icon" style="border-radius: 50%;">
            <span class="company-badge-fallback">${getInitials(val || '')}</span>
          </div>
          <span class="company-title-text">${escapeHtml(val || '-')}</span>
        </div>
      `},
      { key: 'email', label: 'Email', width: '240px', icon: 'mail', sortable: true, render: (val) => val ? escapeHtml(val) : '<span class="cell-empty">-</span>' },
      { key: 'company.name', label: 'Company', width: '170px', icon: 'building-2', readOnly: true, sortable: true, render: (val, row) => row.company ? escapeHtml(row.company.name) : '<span class="cell-empty">No company</span>' },
      { key: 'job_title', label: 'Job Title', width: '150px', icon: 'briefcase', sortable: true, render: (val) => val ? escapeHtml(val) : '<span class="cell-empty">-</span>' },
      { key: 'phone_numbers', label: 'Phone', width: '150px', icon: 'phone', sortable: true, render: (phones) => phones && Array.isArray(phones) && phones.length ? escapeHtml(phones.join(', ')) : '<span class="cell-empty">N/A</span>' },
      {
        key: 'actions', label: 'Actions', width: '96px', readOnly: true, sortable: false, render: (val, row) => `
        <div class="table-actions">
          <button class="action-btn view-person" data-id="${row.id}" title="View person"><i data-lucide="eye"></i></button>
          <button class="action-btn edit-person" data-id="${row.id}" title="Edit person"><i data-lucide="square-pen"></i></button>
          <button class="action-btn delete-person" data-id="${row.id}" title="Delete person"><i data-lucide="trash-2"></i></button>
        </div>
      `},
    ];

    let html = `

      <div class="view-toolbar">
        <div class="search-container">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="u-icon-16 u-search-icon-muted"><path d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"/></svg>
          <input type="text" id="people-search" placeholder="Search people...">
          <div id="clear-people-search" class="search-clear-btn hidden" title="Clear search">
            <i data-lucide="x" class="u-icon-16"></i>
          </div>
        </div>
        
        <div class="u-flex-1"></div>

        ${state.isSalesRep ? '' : `
        <button class="toolbar-btn" id="people-import-export-btn">
          <i data-lucide="file-up"></i> Import / Export
        </button>
        `}

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

    // Import / Export button
    document.getElementById('people-import-export-btn')?.addEventListener('click', () => {
      if (window.openPeopleImportExportModal) window.openPeopleImportExportModal();
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
      opportunitySelect.innerHTML += `<option value="${opportunity.id}">${escapeHtml(opportunity.name)}</option>`;
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
  // The person panel lives with the company panel in record-views.js
  const { openPersonPanel } = await import('./record-views.js');
  return openPersonPanel(personOrId);
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
          <div class="search-result-item" data-company-id="${company.id}" data-company-name="${escapeHtml(company.name)}">
            <div class="search-result-name">${escapeHtml(company.name)}</div>
            ${company.address ? `<div class="search-result-meta">${escapeHtml(company.address)}</div>` : ''}
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
