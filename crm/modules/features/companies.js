// modules/features/companies.js
// Companies list, modal, categories.
import { state, supabaseClient, crmDebugLog, saveViewState } from '../state.js';
import { viewContainer } from '../ui/dom.js';
import { showToast, escapeHtml, getInitials, triggerConfetti } from '../ui/toast.js';
import { renderSkeletonCards, renderError, getLeadScoreBadge } from '../utils/helpers.js';
import { renderEditableDataTable, getCompanyLogoUrl, normalizeSearchText, normalizeForMatching, findDuplicateCompanyByName, guessDomainAndFavicon } from '../ui/spreadsheet.js';
import { geocodeAddressWithOSM, searchNearbyOverpass, renderNearbySuggestions } from '../utils/geo.js';
import { exportAllCompaniesToCsv, runCompaniesImportFromCsv, downloadCompaniesSampleCsv } from './import-export.js';
import { renderCustomFieldsForm, collectCustomFieldValues, validateCustomFields, saveCustomFieldValues, fetchCustomFieldValues } from './custom-fields.js';

async function renderCompaniesView() {
  const companiesState = state.tableViewState.companies;
  state.currentFilters.company_type = companiesState.companyType || '';

  // Restore per-view sort — avoids sorting from another view leaking in
  state.currentSortKey = companiesState.sortKey || 'name';
  state.currentSortDir = companiesState.sortDir || 'asc';

  const sortableCompanyColumns = ['name', 'industry', 'address', 'company_type', 'subsector'];
  const safeSortKey = sortableCompanyColumns.includes(state.currentSortKey) ? state.currentSortKey : 'name';
  if (state.currentSortKey !== safeSortKey) {
    state.currentSortKey = safeSortKey;
    state.currentSortDir = 'asc';
  }

  // Ensure the global data is loaded
  if (window.allCompaniesPromise) {
    await window.allCompaniesPromise;
  }

  // Use the cached data
  let companies = window.allCompaniesData || [];

  // Sort data in memory across all sortable columns
  companies.sort((a, b) => {
    let valA, valB;
    if (safeSortKey === 'industry') {
      valA = a.industry || a.company_categories?.map(c => c.categories?.name).join(', ') || '';
      valB = b.industry || b.company_categories?.map(c => c.categories?.name).join(', ') || '';
    } else {
      valA = a[safeSortKey] || '';
      valB = b[safeSortKey] || '';
    }
    if (typeof valA === 'string') valA = valA.toLowerCase().trim();
    if (typeof valB === 'string') valB = valB.toLowerCase().trim();
    if (valA < valB) return state.currentSortDir === 'asc' ? -1 : 1;
    if (valA > valB) return state.currentSortDir === 'asc' ? 1 : -1;
    return 0;
  });

  crmDebugLog('renderCompaniesView.cachedData', {
    count: companies.length,
    sample: companies.length > 0 ? companies[0] : null
  });

  // Initial pagination state
  let currentPage = companiesState.currentPage || 1;
  const recordsPerPage = 15; // Number of records per page
  let searchQuery = companiesState.searchQuery || ''; // Separate search state

  // Function to render the companies table
  function renderCompaniesTable(companiesToRender, paginationInfo) {
    const allowEditDelete = !state.isSalesRep;
    const columns = [
      {
        key: 'selection',
        label: '<label class="custom-chk-container" title="Select all"><input type="checkbox" class="selection-checkbox" id="companies-select-all"><span class="custom-chk-visual"></span></label>',
        width: '44px',
        readOnly: true,
        sortable: false,
        render: (val, row) => `<label class="custom-chk-container"><input type="checkbox" class="selection-checkbox row-select" data-id="${row.id}" ${state.selectedRecordIds.has(row.id) ? 'checked' : ''}><span class="custom-chk-visual"></span></label>`
      },
      {
        key: 'name', label: 'Company Name', width: '250px', icon: 'building-2', sortable: true, readOnly: state.isSalesRep, render: (val, row) => {
          const domain = (row && row.domain) ? row.domain : '';
          const faviconUrl = row.logo_url || (domain ? getCompanyLogoUrl(domain) : guessDomainAndFavicon(row.name));
          const initials = getInitials(row.name || '');
          const nameEscaped = escapeHtml(row.name || '-');
          return `
            <div class="company-cell-name">
              <div class="company-badge-icon">
                ${faviconUrl ? `<img src="${faviconUrl}" class="company-badge-img" onload="this.style.display='block';if(this.nextElementSibling)this.nextElementSibling.style.display='none'" onerror="this.remove()" />` : ''}
                <div class="company-badge-fallback">
                  <span>${initials}</span>
                </div>
              </div>
              <span class="company-title-text" title="${nameEscaped}">${nameEscaped}</span>
            </div>
          `;
        }
      },
      {
        key: 'industry',
        label: 'Industry',
        width: '130px',
        readOnly: true,
        icon: 'briefcase',
        sortable: true,
        render: (val, row) => {
          const text = val || row.company_categories?.map(c => c.categories?.name).join(', ');
          return text ? escapeHtml(text) : '<span class="cell-empty">N/A</span>';
        }
      },
      {
        key: 'address',
        label: 'Location',
        width: '170px',
        icon: 'map-pin',
        sortable: true,
        readOnly: state.isSalesRep,
        render: (val) => val && val.trim() ? escapeHtml(val) : '<span class="cell-empty">-</span>'
      },
      {
        key: 'company_type',
        label: 'Type',
        width: '110px',
        icon: 'tag',
        sortable: true,
        type: 'select',
        readOnly: state.isSalesRep,
        options: ['Competitor', 'Customer', 'Distributor', 'Investor', 'Partner', 'Reseller', 'Supplier', 'Vendor', 'Other'],
        render: (val) => {
          if (!val || !val.trim() || val === '-') return '<span class="cell-empty">-</span>';
          const pillClass = 'company-type-' + val.toLowerCase().replace(/[^a-z0-9]/g, '-');
          return `<span class="company-type-pill ${pillClass}">${escapeHtml(val)}</span>`;
        }
      },
      {
        key: 'subsector',
        label: 'Subsector',
        width: '130px',
        icon: 'layers-3',
        sortable: true,
        readOnly: state.isSalesRep,
        render: (val) => val && val.trim() && val !== 'Unassigned' ? escapeHtml(val) : '<span class="cell-empty">Unassigned</span>'
      },
      {
        key: 'actions',
        label: 'Actions',
        width: '96px',
        readOnly: true,
        sortable: false,
        render: (val, row) => {
          let buttons = `<button class="action-btn view-company" data-id="${row.id}" title="View company"><i data-lucide="eye"></i></button>`;
          if (allowEditDelete) {
            buttons += `<button class="action-btn edit-company" data-id="${row.id}" title="Edit company"><i data-lucide="square-pen"></i></button>`;
            buttons += `<button class="action-btn delete-company" data-id="${row.id}" title="Delete company"><i data-lucide="trash-2"></i></button>`;
          }
          return `<div class="table-actions">${buttons}</div>`;
        }
      }
    ];

    let html = `

      <div class="view-toolbar">
        <div class="search-container u-flex-1 u-maxw-320">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="u-icon-16 u-search-icon-muted"><path d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"/></svg>
          <input type="text" id="companies-search" placeholder="Search companies...">
          <div id="clear-companies-search" class="search-clear-btn hidden" title="Clear search">
            <i data-lucide="x" class="u-icon-16"></i>
          </div>
        </div>
        
        <div class="u-flex-1"></div>

        ${state.isSalesRep ? '' : `
        <button class="toolbar-btn" id="companies-import-export-btn">
          <i data-lucide="file-up"></i> Import / Export
        </button>
    `}

        <button class="toolbar-btn toolbar-btn-primary" id="add-company-btn">
          <i data-lucide="plus" class="u-icon-16"></i> New Company
        </button>
      </div>
      
      ${renderEditableDataTable(companiesToRender, columns, 'companies-spreadsheet', 'companies')}
      
      <div id="companies-pagination" class="u-p-md"></div>
    `;

    viewContainer.innerHTML = html;

    // Initialize Lucide icons immediately
    if (window.lucide) lucide.createIcons();

    // Restore search value after rendering
    const searchInput = document.getElementById('companies-search');
    if (searchInput && searchInput.value !== searchQuery) {
      searchInput.value = searchQuery;
    }

    // Create pagination controls
    createPaginationControls(
      paginationInfo.currentPage,
      paginationInfo.totalPages,
      paginationInfo.totalRecords,
      paginationInfo.recordsPerPage,
      'companies-pagination',
      (newPage) => {
        currentPage = newPage;
        companiesState.currentPage = currentPage;
        saveViewState({ companies: companiesState });
        const result = searchAndPaginate(
          window.allCompaniesData,
          searchQuery,
          currentPage,
          recordsPerPage,
          (item, query) => filterAndSearchCompany(item, query)
        );
        renderCompaniesTable(result.data, result);
      }
    );

    // Initialize event listeners
    initializeCompaniesEventListeners();
  }

  // Separate function to initialize event listeners
  function initializeCompaniesEventListeners() {

    if (!state.isSalesRep) {
      document.getElementById('companies-import-export-btn')?.addEventListener('click', () => {
        openCompaniesImportExportModal();
      });
    }

        const searchInput = document.getElementById('companies-search');
    if (searchInput) {
      // Remove any existing listeners by cloning and replacing
      const newSearchInput = searchInput.cloneNode(true);
      searchInput.parentNode.replaceChild(newSearchInput, searchInput);

      // Add new listener
      newSearchInput.addEventListener('input', (e) => {
        // Store the current cursor position
        const cursorPosition = e.target.selectionStart;
        const searchValue = e.target.value;

        searchQuery = searchValue;
        companiesState.searchQuery = searchQuery;
        saveViewState({ companies: companiesState });

        // Use a small delay to avoid too many rapid searches
        clearTimeout(newSearchInput.searchTimeout);
        newSearchInput.searchTimeout = setTimeout(() => {
          currentPage = 1; // Reset to first page when searching
          companiesState.currentPage = currentPage;
          saveViewState({ companies: companiesState });
          const result = searchAndPaginate(
            window.allCompaniesData,
            searchQuery,
            currentPage,
            recordsPerPage,
            (item, query) => filterAndSearchCompany(item, query)
          );

          // Store the active element and cursor position before re-rendering
          const activeElement = document.activeElement;
          const wasSearchInput = activeElement && activeElement.id === 'companies-search';

          renderCompaniesTable(result.data, result);

          // Restore focus and cursor position to the search input if it was the active element
          if (wasSearchInput) {
            setTimeout(() => {
              const searchElement = document.getElementById('companies-search');
              searchElement.focus();
              // Set the cursor position to where it was before
              searchElement.setSelectionRange(cursorPosition, cursorPosition);
            }, 0);
          }
        }, 300); // 300ms delay
      });
    }
    // Add company button
    document.getElementById('add-company-btn')?.addEventListener('click', () => {
      openCompanyModal();
    });

    // View, edit and delete buttons
    document.querySelectorAll('.view-company').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const companyId = btn.dataset.id;
        const company = window.allCompaniesData.find(c => c.id === companyId);
        if (company) {
          openCompanyViewModal(company);
        }
      });
    });

    if (!state.isSalesRep) {
      document.querySelectorAll('.edit-company').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const companyId = btn.dataset.id;
          const company = window.allCompaniesData.find(c => c.id === companyId);
          if (company) {
            openCompanyModal(company);
          }
        });
      });

      document.querySelectorAll('.delete-company').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const companyId = btn.dataset.id;
          const company = window.allCompaniesData.find(c => c.id === companyId);

          const confirmed = await showConfirmDialog(
            'Delete Company',
            `Are you sure you want to delete ${company.name}?`
          );

          if (!confirmed) return;

          const { error } = await supabaseClient
            .from('companies')
            .delete()
            .eq('id', companyId);

          if (error) {
            showToast('Error deleting company: ' + error.message, 'error');
            return;
          }

          // Remove from local data and refresh
          window.allCompaniesData = window.allCompaniesData.filter(c => c.id !== companyId);

          showToast('Company deleted successfully', 'success');

          // Re-render with current page
          const result = searchAndPaginate(
            window.allCompaniesData,
            searchQuery,
            currentPage,
            recordsPerPage,
            (item, query) => filterAndSearchCompany(item, query)
          );

          // Adjust current page if necessary
          if (result.data.length === 0 && result.currentPage > 1) {
            currentPage--;
            const adjustedResult = searchAndPaginate(
              window.allCompaniesData,
              searchQuery,
              currentPage,
              recordsPerPage,
              (item, query) => filterAndSearchCompany(item, query)
            );
            renderCompaniesTable(adjustedResult.data, adjustedResult);
          } else {
            renderCompaniesTable(result.data, result);
          }
        });
      });
    } // end if (!state.isSalesRep)

    // Clear search event
    const clearSearchBtn = document.getElementById('clear-companies-search');
    if (clearSearchBtn) {
      if (searchQuery) clearSearchBtn.classList.remove('hidden');
      clearSearchBtn.onclick = () => {
        searchQuery = '';
        companiesState.searchQuery = searchQuery;
        searchInput.value = '';
        clearSearchBtn.classList.add('hidden');
        currentPage = 1;
        companiesState.currentPage = currentPage;
        saveViewState({ companies: companiesState });
        const result = searchAndPaginate(
          window.allCompaniesData,
          searchQuery,
          1,
          recordsPerPage,
          (item, query) => filterAndSearchCompany(item, query)
        );
        renderCompaniesTable(result.data, result);
      };
    }

    // Company type filter event
    const typeFilter = document.getElementById('company-type-filter');
    if (typeFilter) {
      typeFilter.value = state.currentFilters.company_type || '';
      typeFilter.onchange = (e) => {
        state.currentFilters.company_type = e.target.value;
        companiesState.companyType = state.currentFilters.company_type;
        currentPage = 1;
        companiesState.currentPage = currentPage;
        saveViewState({ companies: companiesState });
        const result = searchAndPaginate(
          window.allCompaniesData,
          searchQuery,
          1,
          recordsPerPage,
          (item, query) => filterAndSearchCompany(item, query)
        );
        renderCompaniesTable(result.data, result);
      };
    }

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        companiesState.searchQuery = searchQuery;
        if (searchQuery) {
          clearSearchBtn?.classList.remove('hidden');
        } else {
          clearSearchBtn?.classList.add('hidden');
        }

        currentPage = 1;
        companiesState.currentPage = currentPage;
        const result = searchAndPaginate(
          window.allCompaniesData,
          searchQuery,
          1,
          recordsPerPage,
          (item, query) => filterAndSearchCompany(item, query)
        );
        renderCompaniesTable(result.data, result);
      });
    }

    // Sort event
    const sortBtn = document.getElementById('companies-sort-btn');
    if (sortBtn) {
      sortBtn.onclick = () => {
        handleHeaderSort('name');
      };
    }
  }

  // Helper for combined filter/search

  // Initialize Lucide icons
  if (window.lucide) lucide.createIcons();
  // Initial data processing
  const initialData = searchAndPaginate(
    window.allCompaniesData,
    searchQuery,
    currentPage,
    recordsPerPage,
    (item, query) => filterAndSearchCompany(item, query)
  );
  renderCompaniesTable(initialData.data, initialData);

  // Explicitly initialize icons after rendering table
  if (window.lucide) lucide.createIcons();
  // Helper for combined filter/search
  function filterAndSearchCompany(company, query) {
    if (state.currentFilters.company_type && company.company_type !== state.currentFilters.company_type) return false;
    if (!query) return true;
    return matchesTokenizedQuery(
      query,
      company.name,
      company.subsector,
      company.description,
      company.address
    );
  }
}



// Update the openCompanyModal function to use the global data
async function openCompanyModal(company = null) {
  const modal = document.getElementById('company-modal');
  const modalTitle = document.getElementById('company-modal-title');
  const saveBtn = document.getElementById('save-company-btn');
  const addMoreWrapper = document.getElementById('company-add-more-wrapper');

  // Reset form
  document.getElementById('company-name-input').value = '';
  document.getElementById('company-type').value = '';
  document.getElementById('company-subsector').value = '';
  document.getElementById('company-description').value = '';
  document.getElementById('company-domain') && (document.getElementById('company-domain').value = '');
  document.getElementById('company-address').value = '';
  document.getElementById('company-latitude').value = '';
  document.getElementById('company-longitude').value = '';
  document.getElementById('company-radius').value = '200';

  // Clear categories
  document.getElementById('categories-container').innerHTML = '<input type="text" class="categories-input" id="categories-input" placeholder="Add category...">';
  state.companyCategories = [];

  // Set modal title and show manual coordinates section
  const salesRepViewOnly = company && state.isSalesRep;
  if (company) {
    modalTitle.innerHTML = salesRepViewOnly ? 'View Company' : 'Edit Company';
    if (addMoreWrapper) addMoreWrapper.style.display = 'none';

    // Fill form with company data
    document.getElementById('company-name-input').value = company.name || '';
    document.getElementById('company-type').value = company.company_type || '';
    document.getElementById('company-subsector').value = company.subsector || '';
    document.getElementById('company-description').value = company.description || '';
    document.getElementById('company-domain') && (document.getElementById('company-domain').value = company.domain || '');
    document.getElementById('company-address').value = company.address || '';
    document.getElementById('company-latitude').value = company.latitude?.toString() || '';
    document.getElementById('company-longitude').value = company.longitude?.toString() || '';
    document.getElementById('company-radius').value = company.radius?.toString() || '200';

    // Fill categories
    if (company.company_categories && company.company_categories.length > 0) {
      company.company_categories.forEach(c => {
        addCategory(c.categories.name);
      });
    }
  } else {
    modalTitle.innerHTML = 'New Company';
    if (addMoreWrapper) addMoreWrapper.style.display = 'inline-flex';
  }

  // Show modal
  modal.style.display = 'flex';
  document.body.classList.add('modal-active');

  // Render custom fields
  if (company) {
    const existingValues = await fetchCustomFieldValues('company', company.id);
    await renderCustomFieldsForm('company', 'company-custom-fields-section', existingValues);
  } else {
    await renderCustomFieldsForm('company', 'company-custom-fields-section');
  }

  // Reset manual coords section visibility
  const manualCoordsSection = document.getElementById('manual-coords-section');
  if (manualCoordsSection) manualCoordsSection.classList.add('hidden');

  // Initialize event listeners
  initCompanyModalListeners(company, salesRepViewOnly);
}


function initCompanyModalListeners(company, viewOnly = false) {
  const categoriesInput = document.getElementById('categories-input');
  const saveBtn = document.getElementById('save-company-btn');
  const companyNameInput = document.getElementById('company-name-input');
  const duplicateWarning = document.getElementById('company-duplicate-warning');

  // disable editing if viewOnly (sales rep opening existing company)
  if (viewOnly) {
    // hide save button and disable all inputs/selects/textareas
    if (saveBtn) saveBtn.style.display = 'none';
    const inputs = document.querySelectorAll('#company-modal input, #company-modal select, #company-modal textarea, #company-modal button');
    inputs.forEach(el => {
      // keep close/cancel buttons enabled
      if (el.id === 'cancel-company-btn' || el.classList.contains('modal-close')) return;
      el.disabled = true;
    });
  }

  function updateCompanyDuplicateState() {
    if (company) {
      if (duplicateWarning) {
        duplicateWarning.textContent = '';
        duplicateWarning.classList.add('hidden');
      }
      return false;
    }

    const duplicate = findDuplicateCompanyByName(companyNameInput?.value || '');
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

  // Categories input
  categoriesInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && categoriesInput.value.trim()) {
      e.preventDefault();
      addCategory(categoriesInput.value.trim());
      categoriesInput.value = '';
    }
  });

  if (companyNameInput) {
    companyNameInput.addEventListener('input', updateCompanyDuplicateState);
  }

  updateCompanyDuplicateState();

  // Nearby search moved to company view modal initialization

  // Save company
  saveBtn.onclick = async () => {
    if (company && state.isSalesRep) {
      showToast('Sales representatives are not allowed to edit companies', 'error');
      return;
    }
    const name = document.getElementById('company-name-input').value.trim();
    const companyType = document.getElementById('company-type').value.trim();
    const subsector = document.getElementById('company-subsector').value.trim();
    const description = document.getElementById('company-description').value.trim();
    const address = document.getElementById('company-address').value.trim();
    const radius = parseInt(document.getElementById('company-radius').value);

    // Validate required fields (address is optional)
    if (!name || !companyType) {
      showToast('Please enter company name and type', 'error');
      return;
    }

    // Validate custom fields
    if (!validateCustomFields('company', 'company-custom-fields-section')) {
      return;
    }

    if (!company && updateCompanyDuplicateState()) {
      showToast('Potential duplicate company found. Please review before saving.', 'error');
      return;
    }

    const manualCoordsSection = document.getElementById('manual-coords-section');
    const manualCoordsVisible = manualCoordsSection && !manualCoordsSection.classList.contains('hidden');
    let latitude = parseFloat(document.getElementById('company-latitude').value);
    let longitude = parseFloat(document.getElementById('company-longitude').value);

    if (manualCoordsVisible) {
      // User is manually entering coords after geocoding failed
      if (isNaN(latitude) || isNaN(longitude)) {
        showToast('Please enter the latitude and longitude manually', 'error');
        return;
      }
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

    // Auto-geocode the address if not in manual-entry mode and an address was provided
    if (!manualCoordsVisible && address) {
      const addressChanged = !company || address !== (company.address || '');
      if (addressChanged) {
        try {
          saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Finding location...';
          const geo = await geocodeAddressWithOSM(address);
          latitude = geo.latitude;
          longitude = geo.longitude;
          document.getElementById('company-latitude').value = geo.latitude.toFixed(6);
          document.getElementById('company-longitude').value = geo.longitude.toFixed(6);
        } catch (geoError) {
          if (manualCoordsSection) manualCoordsSection.classList.remove('hidden');
          // Clear any pre-filled coords so the user starts fresh
          document.getElementById('company-latitude').value = '';
          document.getElementById('company-longitude').value = '';
          latitude = NaN;
          longitude = NaN;
          if (!company) {
            showToast('Could not find coordinates for this address. Please enter them manually.', 'error');
          } else {
            showToast('Could not find coordinates for the new address. Please verify or update them manually.', 'error');
          }
          saveBtn.disabled = false;
          saveBtn.innerHTML = 'Save Company';
          return;
        }
      }
      // Address unchanged when editing — keep existing coordinates as-is
    }

    try {
      const domain = document.getElementById('company-domain')?.value.trim();
      const companyData = {
        name,
        company_type: companyType,
        subsector: subsector || null,
        description: description || null,
        domain: domain || null,
        address: address,
        latitude,
        longitude,
        radius,
        created_by: state.currentUser.id,
        organization_id: state.currentOrganization?.id
      };

      let result;
      let companyId;

      if (company) {
        // Update existing company
        result = await supabaseClient
          .from('companies')
          .update(companyData)
          .eq('id', company.id)
          .select(); // Add .select() to return the updated data

        if (result.error) throw result.error;
        companyId = company.id;

        const index = window.allCompaniesData.findIndex(c => c.id === companyId);
        if (index !== -1) {
          window.allCompaniesData[index] = { ...window.allCompaniesData[index], ...companyData };
        }

      } else {
        // Create new company
        result = await supabaseClient
          .from('companies')
          .insert([companyData])
          .select(); // Add .select() to return the inserted data

        if (result.error) throw result.error;

        // Check if result.data exists and has elements before accessing
        if (!result.data || result.data.length === 0) {
          throw new Error('Company was created but no data was returned');
        }

        companyId = result.data[0].id;
        window.allCompaniesData.push(result.data[0]);

      }

      // Handle categories - ONLY if there are categories to process
      if (state.companyCategories && state.companyCategories.length > 0) {
        // Delete existing categories ONLY if editing an existing company
        if (company) {
          await supabaseClient
            .from('company_categories')
            .delete()
            .eq('company_id', companyId);
        }

        // Add categories
        for (const categoryName of state.companyCategories) {
          // First, ensure all categories exist
          const { data: existingCategory, error: categoryError } = await supabaseClient
            .from('categories')
            .select('id')
            .eq('name', categoryName)
            .single();

          if (categoryError && categoryError.code !== 'PGRST116') { // Not found error
            throw categoryError;
          }

          let categoryId;
          if (existingCategory) {
            categoryId = existingCategory.id;
          } else {
            // Create new category
            const { data: newCategory, error: insertError } = await supabaseClient
              .from('categories')
              .insert([{ name: categoryName }])
              .select();

            if (insertError) throw insertError;

            // Check if newCategory exists and has elements before accessing
            if (!newCategory || newCategory.length === 0) {
              throw new Error('Category was created but no data was returned');
            }

            categoryId = newCategory[0].id;
          }

          // Link category to company
          const { error: linkError } = await supabaseClient
            .from('company_categories')
            .insert([{
              company_id: companyId,
              category_id: categoryId
            }]);

          if (linkError) throw linkError;
        }
      }

      // Save custom field values
      const customValues = collectCustomFieldValues('company', 'company-custom-fields-section');
      if (customValues.length > 0) {
        await saveCustomFieldValues('company', companyId, customValues);
      }

      const shouldAddMore = !company && Boolean(document.getElementById('company-add-more-toggle')?.checked);

      showToast(`Company ${company ? 'updated' : 'created'} successfully!`, 'success');
      closeModal('company-modal');
      await renderCompaniesView();

      if (shouldAddMore) {
        openCompanyModal();
        const addMoreToggle = document.getElementById('company-add-more-toggle');
        if (addMoreToggle) addMoreToggle.checked = true;
      }

    } catch (error) {
      console.error('Error saving company:', error);
      showToast(`Error ${company ? 'updating' : 'creating'} company: ${error.message}`, 'error');

    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = 'Save Company';
      if (!company) updateCompanyDuplicateState();
    }
  };
}

function addCategory(name) {
  if (!state.companyCategories.includes(name)) {
    state.companyCategories.push(name);
    renderCategories();
  }
}

function removeCategory(name) {
  state.companyCategories = state.companyCategories.filter(c => c !== name);
  renderCategories();
}

function renderCategories() {
  const container = document.getElementById('categories-container');
  if (!container) return;

  const categoriesHTML = state.companyCategories.map(category => `
    <span class="category-tag">
      ${category}
      <button class="tag-remove" onclick="removeCategory('${category}')">×</button>
    </span>
  `).join('');

  container.innerHTML = categoriesHTML + `<input type="text" class="categories-input" id="categories-input" placeholder="Add category...">`;

  const newInput = document.getElementById('categories-input');
  newInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && newInput.value.trim()) {
      e.preventDefault();
      addCategory(newInput.value.trim());
      newInput.value = '';
    }
  });
}

// ======================


// ── Exports ────────────────────────────────────────────────────
export {
  renderCompaniesView,
  openCompanyModal,
  initCompanyModalListeners,
  addCategory,
  removeCategory,
  renderCategories,
};
