// modules/features/call-logs.js
// Call logs view, log modal, search, delete.
import { state, supabaseClient, crmDebugLog, saveViewState } from '../state.js';
import { viewContainer } from '../ui/dom.js';
import { showToast, escapeHtml, getInitials } from '../ui/toast.js';
import { renderSkeletonCards, renderError, getCurrencySymbol } from '../utils/helpers.js';

// ======================
window.openChangePasswordModal = function () {
  const modal = document.getElementById('change-password-modal');
  if (modal) {
    document.getElementById('change-password-form').reset();
    modal.style.display = 'flex';

    const saveBtn = document.getElementById('save-new-password-btn');
    saveBtn.onclick = submitChangePassword;
  }
};


// ======================
// PASSWORD VISIBILITY TOGGLE (EXTERNAL BUTTON)
// ======================
window.togglePasswordVisibility = function (inputId, btn) {
  const input = document.getElementById(inputId);
  const icon = btn.querySelector('i');
  if (input.type === 'password') {
    input.type = 'text';
    icon.classList.remove('fa-eye');
    icon.classList.add('fa-eye-slash');
  } else {
    input.type = 'password';
    icon.classList.remove('fa-eye-slash');
    icon.classList.add('fa-eye');
  }
};

async function submitChangePassword() {
  const newPass = document.getElementById('new-password').value;
  const confirmPass = document.getElementById('confirm-new-password').value;

  if (newPass !== confirmPass) {
    showToast('Passwords do not match', 'error');
    return;
  }

  const btn = document.getElementById('save-new-password-btn');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';

  const { data, error } = await supabaseClient.auth.updateUser({
    password: newPass
  });

  if (error) {
    showToast(error.message, 'error');
    btn.disabled = false;
    btn.innerHTML = originalText;
  } else {
    showToast('Password updated successfully', 'success');
    closeModal('change-password-modal');
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

// ======================
// PWA LOGIC
// ======================
let deferredPrompt;

async function renderCallLogsView() {
  const viewContainer = document.getElementById('view-container');

  // Fetch reps if manager
  let reps = [];
  if (state.isManager && state.managerCallLogViewMode === 'team') {
    let repsQ = supabaseClient.from('profiles').select('id, first_name, last_name').eq('role', 'sales_rep');
    if (state.currentOrganization?.id) repsQ = repsQ.eq('organization_id', state.currentOrganization.id);
    const { data } = await repsQ;
    reps = data || [];
  }

  // Ensure companies are loaded for search fallback
  if (!window.allCompaniesData) {
    let companiesCacheQ = supabaseClient.from('companies').select('id, name, address').order('name', { ascending: true });
    if (state.currentOrganization?.id) companiesCacheQ = companiesCacheQ.eq('organization_id', state.currentOrganization.id);
    const { data: companies } = await companiesCacheQ;
    window.allCompaniesData = companies || [];
  }

  // Default fetch - order by newest first (descending by created_at)
  let query = supabaseClient
    .from('call_logs')
    .select(`
            *,
            profiles:user_id(first_name, last_name),
            people:contact_id(name),
            companies:company_id(name)
        `)
    .order('created_at', { ascending: false });

  if (!state.isManager || state.managerCallLogViewMode === 'my') {
    query = query.eq('user_id', state.currentUser.id);
  } else if (state.selectedRepId) {
    query = query.eq('user_id', state.selectedRepId);
  }

  const { data: logs, error } = await query;

  if (error) {
    viewContainer.innerHTML = renderError(error.message);
    return;
  }

  // Apply filters to logs
  const filteredLogs = logs.filter(log => {
    const contactName = log.people ? log.people.name : log.contact_name;
    const companyName = log.companies ? log.companies.name : log.company_name;

    // Search filter
    if (state.callLogFilters.search) {
      const searchLower = state.callLogFilters.search.toLowerCase();
      const matchesContact = (contactName || '').toLowerCase().includes(searchLower);
      const matchesCompany = (companyName || '').toLowerCase().includes(searchLower);
      if (!matchesContact && !matchesCompany) return false;
    }

    // Direction filter
    if (state.callLogFilters.direction && log.direction !== state.callLogFilters.direction) {
      return false;
    }

    // Outcome filter
    if (state.callLogFilters.outcome && log.outcome !== state.callLogFilters.outcome) {
      return false;
    }

    return true;
  });

  let html = `
        <div class="page-header">
            <div class="page-header-row">
                <div>
                </div>
                <div class="call-logs-filters">
                    ${state.isManager ? `
                        <div class="view-toggle">
                            <button class="toggle-btn ${state.managerCallLogViewMode === 'my' ? 'active' : ''}" id="view-my-logs">My Logs</button>
                            <button class="toggle-btn ${state.managerCallLogViewMode === 'team' ? 'active' : ''}" id="view-team-logs">Team Logs</button>
                        </div>
                        ${state.managerCallLogViewMode === 'team' ? `
                            <select id="rep-filter" class="filter-select">
                                <option value="">All Representatives</option>
                                ${reps.map(rep => `
                                    <option value="${rep.id}" ${state.selectedRepId === rep.id ? 'selected' : ''}>
                                        ${rep.first_name} ${rep.last_name}
                                    </option>
                                `).join('')}
                            </select>
                        ` : ''}
                    ` : ''}
                    ${(!state.isManager || state.managerCallLogViewMode === 'my') ? `
                    <button class="btn btn-primary" id="log-call-btn">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-plus-icon"><path d="M5 12h14"/><path d="M12 5v14"/></svg> <span>Log Call</span>
                    </button>
                    ` : ''}
                </div>
            </div>
        </div>

        <div class="card">
            <div class="filters-section">
                <div class="search-input-wrapper">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-search-icon search-icon">
                        <path d="m21 21-4.34-4.34" />
                        <circle cx="11" cy="11" r="8" />
                    </svg>
                    <input type="text" id="call-search" placeholder="Search by contact or company..." value="${state.callLogFilters.search}" class="filter-select search-input-padded">
                </div>
                
                <select id="call-direction-filter" class="filter-select">
                    <option value="">All Directions</option>
                    <option value="Inbound" ${state.callLogFilters.direction === 'Inbound' ? 'selected' : ''}>Inbound</option>
                    <option value="Outbound" ${state.callLogFilters.direction === 'Outbound' ? 'selected' : ''}>Outbound</option>
                </select>
                
                <select id="call-outcome-filter" class="filter-select">
                    <option value="">All Outcomes</option>
                    <option value="Connected" ${state.callLogFilters.outcome === 'Connected' ? 'selected' : ''}>Connected</option>
                    <option value="Voicemail" ${state.callLogFilters.outcome === 'Voicemail' ? 'selected' : ''}>Voicemail</option>
                    <option value="No Answer" ${state.callLogFilters.outcome === 'No Answer' ? 'selected' : ''}>No Answer</option>
                    <option value="Busy" ${state.callLogFilters.outcome === 'Busy' ? 'selected' : ''}>Busy</option>
                    <option value="Wrong Number" ${state.callLogFilters.outcome === 'Wrong Number' ? 'selected' : ''}>Wrong Number</option>
                    <option value="Call Failed" ${state.callLogFilters.outcome === 'Call Failed' ? 'selected' : ''}>Call Failed</option>
                </select>

                <div class="filter-actions">
                    <button id="clear-filters" class="btn btn-secondary">
                        Clear Filters
                    </button>
                </div>
            </div>

            <div class="table-container">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>DateTime</th>
                            ${(state.isManager && state.managerCallLogViewMode === 'team') ? '<th>Representative</th>' : ''}
                            <th>Contact</th>
                            <th>Company</th>
                            <th>Direction</th>
                            <th>Duration</th>
                            <th>Outcome</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filteredLogs.length === 0 ? `
                            <tr>
                                <td colspan="${(state.isManager && state.managerCallLogViewMode === 'team') ? '8' : '7'}" class="text-center">No call logs found</td>
                            </tr>
                        ` : filteredLogs.map(log => {
    const outcomeClass = (log.outcome || '').toLowerCase().replace(' ', '-');
    const contactName = log.people ? log.people.name : log.contact_name;
    const companyName = log.companies ? log.companies.name : log.company_name;
    const repName = log.profiles ? `${log.profiles.first_name} ${log.profiles.last_name}` : 'Unknown';

    return `
                                <tr>
                                    <td>${formatDateWithTime(log.call_at)}</td>
                                    ${(state.isManager && state.managerCallLogViewMode === 'team') ? `<td>${repName}</td>` : ''}
                                    <td>${contactName || 'N/A'}</td>
                                    <td>${companyName || 'N/A'}</td>
                                    <td>
                                        <span class="direction-badge ${log.direction === 'Inbound' ? 'inbound' : 'outbound'}">
                                            ${log.direction === 'Inbound' ? `
                                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-down-left"><path d="M17 7 7 17"/><path d="M17 17H7V7"/></svg>
                                            ` : `
                                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-up-right"><path d="M7 17 17 7"/><path d="M7 7h10v10"/></svg>
                                            `}
                                            ${log.direction}
                                        </span>
                                    </td>
                                    <td>${log.duration_seconds ? Math.floor(log.duration_seconds / 60) + 'm' : 'N/A'}</td>
                                    <td>
                                        <span class="outcome-badge ${outcomeClass}">${log.outcome}</span>
                                    </td>
                                    <td>
                                        <div class="table-actions">
                                            <button class="action-btn view-call-log" data-id="${log.id}" title="View Log">
                                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-eye"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>
                                            </button>
                                            ${(!state.isManager || log.user_id === state.currentUser.id) ? `
                                            <button class="action-btn edit-call-log" data-id="${log.id}" title="Edit Log">
                                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-pencil"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                                            </button>
                                            <button class="action-btn delete-call-log" data-id="${log.id}" title="Delete Log">
                                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
                                            </button>
                                            ` : ''}
                                        </div>
                                    </td>
                                </tr>
                            `;
  }).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;

  viewContainer.innerHTML = html;

  // Listeners
  document.getElementById('log-call-btn')?.addEventListener('click', () => openCallLogModal());

  document.querySelectorAll('.view-call-log').forEach(btn => {
    btn.addEventListener('click', () => {
      const log = logs.find(l => l.id === btn.dataset.id);
      openCallLogViewModal(log);
    });
  });

  document.querySelectorAll('.edit-call-log').forEach(btn => {
    btn.addEventListener('click', () => {
      const log = logs.find(l => l.id === btn.dataset.id);
      openCallLogModal(log);
    });
  });

  if (state.isManager) {
    document.getElementById('view-my-logs')?.addEventListener('click', () => {
      state.managerCallLogViewMode = 'my';
      renderCallLogsView();
    });
    document.getElementById('view-team-logs')?.addEventListener('click', () => {
      state.managerCallLogViewMode = 'team';
      renderCallLogsView();
    });
    document.getElementById('rep-filter')?.addEventListener('change', (e) => {
      state.selectedRepId = e.target.value || null;
      renderCallLogsView();
    });
  }

  // Filter listeners
  const searchInput = document.getElementById('call-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.callLogFilters.search = e.target.value;
      saveViewState({ callLogs: state.callLogFilters });
      // Debounce the search to avoid excessive re-renders
      clearTimeout(state.filterDebounceTimer);
      state.filterDebounceTimer = setTimeout(() => {
        renderCallLogsView();
      }, 300);
    });
  }

  document.getElementById('call-direction-filter')?.addEventListener('change', (e) => {
    state.callLogFilters.direction = e.target.value;
    saveViewState({ callLogs: state.callLogFilters });
    renderCallLogsView();
  });

  document.getElementById('call-outcome-filter')?.addEventListener('change', (e) => {
    state.callLogFilters.outcome = e.target.value;
    saveViewState({ callLogs: state.callLogFilters });
    renderCallLogsView();
  });

  document.getElementById('clear-filters')?.addEventListener('click', () => {
    state.callLogFilters = { search: '', direction: '', outcome: '' };
    saveViewState({ callLogs: state.callLogFilters });
    clearTimeout(state.filterDebounceTimer);
    renderCallLogsView();
  });

  // Use event delegation for delete button
  const tableContainer = viewContainer.querySelector('.table-container');
  if (tableContainer) {
    tableContainer.addEventListener('click', (e) => {
      const deleteBtn = e.target.closest('.delete-call-log');
      if (deleteBtn) {
        e.preventDefault();
        e.stopPropagation();
        deleteCallLog(deleteBtn.dataset.id);
      }
    });
  };
}

async function deleteCallLog(id) {
  const confirmed = await showConfirmDialog('Delete Call Log', 'Are you sure you want to delete this call log?');
  if (!confirmed) return;

  try {
    // Fetch the log to check ownership
    const { data: log, error: fetchError } = await supabaseClient
      .from('call_logs')
      .select('user_id, id')
      .eq('id', id)
      .single();

    if (fetchError || !log) {
      showToast('Log not found', 'error');
      return;
    }

    // Check if user owns the log
    if (log.user_id !== state.currentUser.id) {
      showToast('You can only delete your own call logs', 'error');
      return;
    }

    // Delete the log
    const { error: deleteError } = await supabaseClient
      .from('call_logs')
      .delete()
      .eq('id', id);

    if (deleteError) {
      showToast('Error deleting log: ' + deleteError.message, 'error');
    } else {
      showToast('Log deleted', 'success');
      await new Promise(resolve => setTimeout(resolve, 500));
      renderCallLogsView();
    }
  } catch (e) {
    showToast('Error deleting log: ' + e.message, 'error');
  }
}

function openCallLogViewModal(log) {
  const modal = document.getElementById('call-log-view-modal');
  if (!modal) {
    showToast('View modal not found', 'error');
    return;
  }

  // Populate view modal
  const contactName = log.people ? log.people.name : log.contact_name;
  const companyName = log.companies ? log.companies.name : log.company_name;
  const repName = log.profiles ? `${log.profiles.first_name} ${log.profiles.last_name}` : 'Unknown';

  document.getElementById('view-call-datetime').textContent = formatDateWithTime(log.call_at);
  document.getElementById('view-call-contact').textContent = contactName || 'N/A';
  document.getElementById('view-call-company').textContent = companyName || 'N/A';
  document.getElementById('view-call-rep').textContent = repName;
  document.getElementById('view-call-direction').textContent = log.direction;
  document.getElementById('view-call-direction').className = `direction-badge ${log.direction === 'Inbound' ? 'inbound' : 'outbound'}`;
  document.getElementById('view-call-duration').textContent = log.duration_seconds ? Math.floor(log.duration_seconds / 60) + ' minutes' : 'N/A';
  document.getElementById('view-call-outcome').textContent = log.outcome;
  const outcomeClass = (log.outcome || '').toLowerCase().replace(' ', '-');
  document.getElementById('view-call-outcome').className = `outcome-badge ${outcomeClass}`;
  document.getElementById('view-call-notes').textContent = log.notes || 'No notes';

  modal.style.display = 'flex';
}

/**
 * Company view modal — shows linked opportunities, call logs and recent visits in tabs.
 * Accepts a company object or company id.
 */
async function openCompanyViewModal(companyOrId) {
  const modal = document.getElementById('company-view-modal');
  if (!modal) {
    showToast('Company view modal not found', 'error');
    return;
  }

  // Resolve company object
  let company = companyOrId;
  if (!company || (typeof company === 'string' || typeof company === 'number')) {
    const companyId = company || companyOrId;
    company = (Array.isArray(window.allCompaniesData) ? window.allCompaniesData.find(c => String(c.id) === String(companyId)) : null);
    if (!company) {
      const { data, error } = await supabaseClient.from('companies').select('*, company_categories(categories(id,name))').eq('id', companyId).single();
      if (error) {
        showToast('Unable to load company', 'error');
        return;
      }
      company = data;
    }
  }

  // ── Populate Hero Section ──
  const heroTitle = document.getElementById('company-view-modal-title');
  if (heroTitle) heroTitle.textContent = company.name || 'Company';

  // Hero Avatar (logo or initials)
  const heroAvatar = document.getElementById('company-view-hero-avatar');
  if (heroAvatar) {
    const initials = getInitials(company.name || 'C');
    const resolvedLogoUrl = company.logo_url || getCompanyLogoUrl(company.domain || '');
    heroAvatar.innerHTML = `<span style="position:relative;z-index:1">${initials}</span>${resolvedLogoUrl ? `<img src="${resolvedLogoUrl}" alt="${escapeHtml(company.name || '')}" onload="this.style.display='block';this.previousElementSibling.style.display='none'" onerror="this.style.display='none'" />` : ''}`;
  }

  // Hero type badge
  const heroBadge = document.getElementById('company-view-hero-type');
  if (heroBadge) {
    if (company.company_type) {
      heroBadge.textContent = company.company_type;
      heroBadge.style.display = 'inline-flex';
    } else {
      heroBadge.style.display = 'none';
    }
  }

  // Hero domain link
  const heroDomain = document.getElementById('company-view-hero-domain');
  if (heroDomain) {
    const rawDomain = company.domain ? String(company.domain).trim() : '';
    if (rawDomain) {
      let url = rawDomain;
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      const safeUrl = url.replace(/"/g, '&quot;');
      const displayDomain = rawDomain.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
      heroDomain.innerHTML = `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(displayDomain)}<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-left:3px"><path d="M18 13v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>`;
    } else {
      heroDomain.innerHTML = '';
    }
  }

  // Hero category chips
  const heroCats = document.getElementById('company-view-hero-cats');
  if (heroCats) {
    const cats = (company.company_categories && company.company_categories.length)
      ? company.company_categories.map(c => c.categories && c.categories.name ? c.categories.name : (c.name || '')).filter(Boolean)
      : [];
    heroCats.innerHTML = cats.map(cat => `<span class="record-hero-cat-chip">${escapeHtml(cat)}</span>`).join('');
  }

  // Wire Edit button
  const editBtn = document.getElementById('company-view-edit-btn');
  if (editBtn) {
    editBtn.onclick = () => {
      closeModal('company-view-modal');
      setTimeout(() => openCompanyModal(company), 100);
    };
  }

  // ── Populate Sidebar Fields ──
  const addressEl = document.getElementById('company-view-address'); if (addressEl) addressEl.textContent = company.address || '—';
  const coordsEl = document.getElementById('company-view-coordinates');
  if (coordsEl) {
    if (company.latitude && company.longitude) {
      const lat = company.latitude.toFixed(6);
      const lng = company.longitude.toFixed(6);
      coordsEl.innerHTML = `
        <a href="https://www.google.com/maps?q=${lat},${lng}" 
           target="_blank" 
           rel="noopener noreferrer" 
           style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;background:var(--bg-secondary);color:var(--color-primary);border-radius:6px;font-size:0.8rem;font-weight:600;text-decoration:none;transition:all 0.2s;border:1px solid var(--border-color);" 
           onmouseover="this.style.background='var(--bg-tertiary)';this.style.borderColor='var(--color-primary)';this.style.transform='translateY(-1px)'" 
           onmouseout="this.style.background='var(--bg-secondary)';this.style.borderColor='var(--border-color)';this.style.transform='none'">
          ${lat}, ${lng}
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.7"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        </a>`;
    } else {
      coordsEl.textContent = '—';
    }
  }
  const descEl = document.getElementById('company-view-desc'); if (descEl) descEl.textContent = company.description || '—';
  const catsEl = document.getElementById('company-view-categories');
  if (catsEl) {
    const catNames = (company.company_categories && company.company_categories.length)
      ? company.company_categories.map(c => c.categories && c.categories.name ? c.categories.name : (c.name || '')).filter(Boolean)
      : [];
    catsEl.innerHTML = catNames.length ? catNames.map(n => `<span class="record-hero-cat-chip">${escapeHtml(n)}</span>`).join(' ') : '—';
  }

  // Domain in sidebar (show/hide card)
  const domainEl = document.getElementById('company-view-domain');
  const domainCard = document.getElementById('company-view-domain-card');
  if (domainEl) {
    const rawDomainSidebar = company.domain ? String(company.domain).trim() : '';
    if (rawDomainSidebar) {
      let url2 = rawDomainSidebar;
      if (!/^https?:\/\//i.test(url2)) url2 = 'https://' + url2;
      const safeUrl2 = url2.replace(/"/g, '&quot;');
      domainEl.innerHTML = `<a href="${safeUrl2}" target="_blank" rel="noopener noreferrer">${rawDomainSidebar}</a>`;
      if (domainCard) domainCard.style.display = 'flex';
    } else {
      domainEl.textContent = '—';
      if (domainCard) domainCard.style.display = 'none';
    }
  }

  // Add a SafiFind button that opens a dedicated modal for searching nearby companies
  try {
    const headerActions = document.getElementById('company-view-header-actions');
    if (headerActions) {
      headerActions.innerHTML = '';
      const safiBtn = document.createElement('button');
      safiBtn.type = 'button';
      safiBtn.id = 'company-view-safifind-btn';
      safiBtn.className = 'btn btn-primary btn-sm';
      safiBtn.setAttribute('aria-label', 'Open SafiFind');
      safiBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 17v4"/><path d="M14 3v8a2 2 0 0 0 2 2h5.865"/><path d="M17 17v4"/><path d="M18 17a4 4 0 0 0 4-4 8 6 0 0 0-8-6 6 5 0 0 0-6 5v3a2 2 0 0 0 2 2z"/><path d="M2 10v5"/><path d="M6 3h16"/><path d="M7 21h14"/><path d="M8 13H2"/></svg>
        SafiFind`;

      headerActions.appendChild(safiBtn);

      safiBtn.addEventListener('click', () => {
        try { closeModal('safifind-modal'); } catch (e) { /* ignore */ }
        const safiModal = document.getElementById('safifind-modal');
        if (!safiModal) {
          showToast('SafiFind modal not available', 'error');
          return;
        }

        // Store company coords on the modal dataset
        if (company && company.latitude && company.longitude) {
          safiModal.dataset.lat = company.latitude;
          safiModal.dataset.lon = company.longitude;
          const coordsEl = safiModal.querySelector('#safifind-coords');
          if (coordsEl) coordsEl.textContent = `${company.latitude.toFixed(6)}, ${company.longitude.toFixed(6)}`;
        } else {
          safiModal.dataset.lat = '';
          safiModal.dataset.lon = '';
          const coordsEl = safiModal.querySelector('#safifind-coords');
          if (coordsEl) coordsEl.textContent = 'Not available for this company';
        }

        // Prefill defaults
        const radiusInput = safiModal.querySelector('#safifind-radius');
        const filterSelect = safiModal.querySelector('#safifind-filter');
        if (radiusInput) radiusInput.value = company.radius || 2000;
        if (filterSelect) filterSelect.value = 'both';

        // Clear previous results
        document.getElementById('safifind-results').innerHTML = '';

        safiModal.style.display = 'flex';

        // Initialize Map
        setTimeout(() => {
          if (window.safifindMap) {
            window.safifindMap.remove();
            window.safifindMap = null;
          }

          const lat = parseFloat(safiModal.dataset.lat);
          const lon = parseFloat(safiModal.dataset.lon);
          const mapEl = document.getElementById('safifind-map');
          if (!mapEl) {
            console.error('SafiFind map container not found in DOM');
            return;
          }

          if (!isNaN(lat) && !isNaN(lon)) {
            window.safifindMap = L.map('safifind-map').setView([lat, lon], 14);
            L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
              attribution: '&copy; OpenStreetMap contributors'
            }).addTo(window.safifindMap);

            // Force redraw to handle flex sizing
            setTimeout(() => window.safifindMap.invalidateSize(), 50);

            // Add center marker (enhanced)
            L.marker([lat, lon], {
              icon: L.divIcon({
                className: 'custom-div-icon',
                html: `
                  <div style="position:relative; width:16px; height:16px;">
                    <div style="position:absolute; top:0; left:0; background:var(--color-primary); width:16px; height:16px; border:2.5px solid #fff; border-radius:50%; box-shadow:0 0 15px var(--color-primary); z-index:2;"></div>
                    <div style="position:absolute; top:0; left:0; width:16px; height:16px; background:var(--color-primary); border-radius:50%; animation: pulse-marker 2s infinite; opacity:0.5; z-index:1;"></div>
                  </div>
                  <style>
                    @keyframes pulse-marker {
                      0% { transform: scale(1); opacity: 0.5; }
                      70% { transform: scale(3); opacity: 0; }
                      100% { transform: scale(3); opacity: 0; }
                    }
                  </style>`,
                iconSize: [16, 16],
                iconAnchor: [8, 8]
              })
            }).addTo(window.safifindMap).bindPopup('Current Location');

            // Add radius circle
            window.safifindRadiusCircle = L.circle([lat, lon], {
              radius: parseInt(radiusInput.value) || 2000,
              color: 'var(--color-primary)',
              fillColor: 'var(--color-primary)',
              fillOpacity: 0.1,
              weight: 1
            }).addTo(window.safifindMap);

            radiusInput.oninput = () => {
              const r = parseInt(radiusInput.value) || 2000;
              if (window.safifindRadiusCircle) window.safifindRadiusCircle.setRadius(r);
            };
          }
        }, 100);
      });
    }
  } catch (e) {
    console.warn('Failed to init SafiFind button', e);
  }

  // Wire up find button
  try {
    const safiModal = document.getElementById('safifind-modal');
    if (safiModal) {
      const findBtn = safiModal.querySelector('#safifind-find-btn');
      if (findBtn) {
        findBtn.onclick = async () => {
          const lat = parseFloat(safiModal.dataset.lat);
          const lon = parseFloat(safiModal.dataset.lon);
          const radius = parseInt(safiModal.querySelector('#safifind-radius').value) || 2000;
          const filterVal = (safiModal.querySelector('#safifind-filter')?.value) || 'both';

          if (isNaN(lat) || isNaN(lon)) {
            showToast('Coordinates required for search.', 'error');
            return;
          }

          findBtn.disabled = true;
          findBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Searching...';

          try {
            const results = await searchNearbyOverpass(lat, lon, radius, [filterVal]);
            const existingNames = (Array.isArray(window.allCompaniesData) ? window.allCompaniesData : []).map(c => normalizeSearchText(c.name || ''));
            const filtered = (results || []).filter(r => r.name && !existingNames.includes(normalizeSearchText(r.name))).slice(0, 150);

            // Clear old search markers immediately
            if (window.safifindMap) {
              if (window.safifindMarkers) window.safifindMarkers.forEach(m => window.safifindMap.removeLayer(m));
              window.safifindMarkers = [];
            }

            // Render result cards
            const resultsEl = document.getElementById('safifind-results');
            const countEl = document.getElementById('safifind-count');
            if (countEl) countEl.textContent = `${results.length > 150 ? '150+' : results.length} shown`;

            if (filtered.length === 0) {
              resultsEl.innerHTML = '<div class="empty-results">No new companies found in this area.</div>';
            } else {
              resultsEl.innerHTML = filtered.map(it => `
                <div id="safifind-result-card">
                  <div class="safifind-result-info">
                    <div class="safifind-result-name" title="${escapeHtml(it.name)}">${escapeHtml(it.name)}</div>
                    <div class="safifind-result-meta">
                      <span class="safifind-category-badge">${escapeHtml(it.tags.shop || it.tags.office || it.tags.amenity || 'Company')}</span>
                      <span>·</span>
                      <span>${Math.round(it.distance)}m away</span>
                    </div>
                  </div>
                  <div class="safifind-result-actions">
                    <button class="btn btn-sm btn-ghost" onclick="window.open('https://www.openstreetmap.org/${it.type}/${it.id}', '_blank')">Info</button>
                    <button class="btn btn-sm btn-primary add-safifind" data-name="${escapeHtml(it.name)}" data-lat="${it.lat}" data-lon="${it.lon}" data-addr="${escapeHtml(it.displayName)}" data-site="${escapeHtml(it.tags.website || '')}" data-phone="${escapeHtml(it.tags.phone || '')}">Add to CRM</button>
                  </div>
                </div>
              `).join('');

              // Wire Add buttons
              resultsEl.querySelectorAll('.add-safifind').forEach(btn => {
                btn.onclick = () => {
                  const d = btn.dataset;
                  closeModal('safifind-modal');
                  closeModal('company-view-modal');
                  openCompanyModal();
                  setTimeout(() => {
                    if (document.getElementById('company-name-input')) document.getElementById('company-name-input').value = d.name;
                    if (document.getElementById('company-latitude')) document.getElementById('company-latitude').value = parseFloat(d.lat).toFixed(6);
                    if (document.getElementById('company-longitude')) document.getElementById('company-longitude').value = parseFloat(d.lon).toFixed(6);
                    if (document.getElementById('company-address')) document.getElementById('company-address').value = d.addr;
                    const domainEl = document.getElementById('company-domain');
                    if (domainEl && d.site) domainEl.value = d.site;
                    // Note: If you have a phone field for companies, set it here.
                  }, 100);
                };
              });

              // Add markers to map (dots instead of pins)
              if (window.safifindMap) {
                filtered.forEach(it => {
                  const m = L.circleMarker([it.lat, it.lon], {
                    radius: 7,
                    fillColor: 'var(--color-primary)',
                    color: '#fff',
                    weight: 2,
                    opacity: 1,
                    fillOpacity: 0.9
                  }).addTo(window.safifindMap);

                  m.bindPopup(`<b>${escapeHtml(it.name)}</b><br>${escapeHtml(it.displayName)}`);
                  window.safifindMarkers.push(m);
                });

                const group = new L.featureGroup([L.marker([lat, lon]), ...window.safifindMarkers]);
                window.safifindMap.fitBounds(group.getBounds().pad(0.1));
              }
            }
          } catch (err) {
            console.error('SafiFind search error', err);
            showToast('Search failed: ' + err.message, 'error');
          } finally {
            findBtn.disabled = false;
            findBtn.innerHTML = 'Find Nearby';
          }
        };
      }
    }
  } catch (e) {
    console.warn('Failed to wire SafiFind modal', e);
  }


  // Loading placeholders for tabs
  document.getElementById('company-view-opps').innerHTML = '<div class="record-empty-state"><div class="record-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div><div class="record-empty-title">Loading...</div></div>';
  const employeesContainer = document.getElementById('company-view-employees');
  if (employeesContainer) employeesContainer.innerHTML = '<div class="record-empty-state"><div class="record-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></div><div class="record-empty-title">Loading...</div></div>';
  document.getElementById('company-view-calls').innerHTML = '<div class="record-empty-state"><div class="record-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.79 19.79 0 0 1 11.63 19"/></svg></div><div class="record-empty-title">Loading...</div></div>';
  document.getElementById('company-view-visits').innerHTML = '<div class="record-empty-state"><div class="record-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/></svg></div><div class="record-empty-title">Loading...</div></div>';

  modal.style.display = 'flex';

  // Tab switching for the company view modal
  const companyTabs = modal.querySelectorAll('.company-view-tab');
  companyTabs.forEach(tab => {
    tab.onclick = () => {
      companyTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const name = tab.dataset.tab;
      document.getElementById('company-view-opps').style.display = name === 'opps' ? 'block' : 'none';
      const employeesEl = document.getElementById('company-view-employees');
      if (employeesEl) employeesEl.style.display = name === 'employees' ? 'block' : 'none';
      document.getElementById('company-view-calls').style.display = name === 'calls' ? 'block' : 'none';
      document.getElementById('company-view-visits').style.display = name === 'visits' ? 'block' : 'none';
    };
  });



  // Fetch related records in parallel (by id and by name to be safe)
  const [oppsById, oppsByName, callsById, callsByName, visitsById, visitsByName, peopleById, peopleByName] = await Promise.all([
    supabaseClient.from('opportunities').select('*').eq('company_id', company.id),
    supabaseClient.from('opportunities').select('*').eq('company_name', company.name),
    supabaseClient.from('call_logs').select('*, people(*), profiles(*)').eq('company_id', company.id).order('call_at', { ascending: false }).limit(50),
    supabaseClient.from('call_logs').select('*, people(*), profiles(*)').eq('company_name', company.name).order('call_at', { ascending: false }).limit(50),
    supabaseClient.from('visits').select('*, user:profiles(first_name,last_name)').eq('company_id', company.id).order('created_at', { ascending: false }).limit(10),
    supabaseClient.from('visits').select('*, user:profiles(first_name,last_name)').eq('company_name', company.name).order('created_at', { ascending: false }).limit(10),
    // Query people by company_id (most reliable). Avoid ordering by potentially missing columns.
    supabaseClient.from('people').select('*').eq('company_id', company.id).limit(200),
    // Fallback: try to find people where the name contains the company name (less reliable but avoids using non-existent company_name column).
    supabaseClient.from('people').select('*').ilike('name', `%${String(company.name || '').replace(/%/g, '')}%`).limit(200)
  ]);

  const dedupeById = (arr) => {
    const map = new Map();
    (arr || []).forEach(i => { if (i && i.id) map.set(String(i.id), i); });
    return Array.from(map.values());
  };

  const opportunities = dedupeById([...(oppsById.data || []), ...(oppsByName.data || [])]);
  const calls = (dedupeById([...(callsById.data || []), ...(callsByName.data || [])]) || []).slice(0, 50);
  const visits = (dedupeById([...(visitsById.data || []), ...(visitsByName.data || [])]) || []).slice(0, 10);
  console.debug('openCompanyViewModal called for company', { id: company.id, name: company.name });
  const peopleFromWindow = Array.isArray(window.allPeopleData) ? (window.allPeopleData.filter(p => String(p.company_id || '') === String(company.id) || String((p.company_name || '')).trim() === String((company.name || '')).trim())) : [];

  let employees = dedupeById([...(peopleFromWindow || []), ...(peopleById.data || []), ...(peopleByName.data || [])]);


  // If the combined list is empty, try a more forgiving fallback query
  if ((!employees || employees.length === 0) && typeof supabaseClient !== 'undefined') {
    try {
      const nameFilter = String(company.name || '').replace(/'/g, "''");
      const orFilter = `company_id.eq.${company.id},company_name.ilike.%${nameFilter}%`;
      const { data: peopleFallback, error: peopleFallbackError } = await supabaseClient.from('people').select('*').or(orFilter).limit(200);
      if (!peopleFallbackError && Array.isArray(peopleFallback) && peopleFallback.length > 0) {
        employees = dedupeById([...(employees || []), ...peopleFallback]);
      }
    } catch (err) {
      crmDebugLog('company-view-people-fallback-error', err);
    }
  }

  // Render a richer summary area with avatar, key stats and actions
  try {
    const summaryEl = document.getElementById('company-view-summary');
    if (summaryEl) {
      const resolvedLogoUrl = company.logo_url || getCompanyLogoUrl(company.domain || '');
      const initials = getInitials(company.name || 'U');
      const logoHtml = `
        <div style="position:relative;width:48px;height:48px;">
          <div class="company-summary-initials" style="width:48px;height:48px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-weight:600">${initials}</div>
          ${resolvedLogoUrl ? `<img src="${resolvedLogoUrl}" alt="${company.name}" style="display:none;width:48px;height:48px;object-fit:contain;border-radius:6px;position:absolute;left:0;top:0;" onload="this.style.display='block'; this.previousElementSibling.style.display='none'" onerror="this.style.display='none'" />` : ''}
        </div>
      `;
      const shortAddress = company.address ? (String(company.address).split(',')[0]) : '—';
      const cats = (company.company_categories && company.company_categories.length) ? company.company_categories.map(c => c.categories && c.categories.name ? c.categories.name : (c.name || '')).filter(Boolean) : [];

      // Keep the summary read-only: show only primary identity (name + type).
      // Full description, address and categories are shown in the right-hand sidebar to avoid duplication.
      // Render domain link next to name (no explicit label)
      const rawDomain = company.domain ? String(company.domain).trim() : '';
      let domainHtml = '';
      if (rawDomain) {
        let domainUrl = rawDomain;
        if (!/^https?:\/\//i.test(domainUrl)) domainUrl = 'https://' + domainUrl;
        const safeUrl = domainUrl.replace(/"/g, '&quot;');
        const displayDomain = rawDomain.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
        // Render as a distinct pill with a small external-link icon
        domainHtml = `<span class="company-summary-domain"><a class="company-summary-domain-link" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(displayDomain)} <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg></a></span>`;
      }

      summaryEl.innerHTML = `
        <div class="company-summary">
          <div class="company-summary-head">
            <div class="company-summary-avatar">${logoHtml}</div>
            <div class="company-summary-main">
              <div style="display:flex;align-items:center;gap:8px;">
                <div class="company-summary-name">${escapeHtml(company.name || '—')}</div>
                ${domainHtml}
              </div>
              <div class="company-summary-meta">${escapeHtml(company.company_type || '—')}</div>
            </div>
          </div>
        </div>
      `;
    }
  } catch (e) {
    crmDebugLog('company-view-summary-render-error', e);
  }


  // Render Opportunities tab (premium cards)
  const oppsEl = document.getElementById('company-view-opps');
  if (!opportunities || opportunities.length === 0) {
    oppsEl.innerHTML = `<div class="record-empty-state"><div class="record-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div><div class="record-empty-title">No opportunities linked</div><div class="record-empty-desc">This company is not linked to any active opportunities yet.</div></div>`;
  } else {
    const stageColors = { prospecting: '#6366f1', qualification: '#f59e0b', proposal: '#3b82f6', negotiation: '#f97316', won: '#22c55e', lost: '#ef4444' };
    oppsEl.innerHTML = opportunities.map(opp => {
      const stageKey = (opp.stage || '').toLowerCase();
      const stageColor = stageColors[stageKey] || 'var(--color-primary)';
      const val = parseFloat(opp.value || 0);
      return `
        <div class="record-opp-card" data-id="${opp.id}">
          <div class="record-opp-card-stage" style="background:${stageColor}"></div>
          <div class="record-opp-card-body">
            <div class="record-opp-card-name">${escapeHtml(opp.name || '—')}</div>
            <div class="record-opp-card-meta">
              <span class="stage-pill" style="background:${stageColor}1a;color:${stageColor};border-color:${stageColor}40">${escapeHtml(opp.stage || '—')}</span>
              <span>${opp.probability || 0}% probability</span>
            </div>
          </div>
          <div class="record-opp-card-value">${getCurrencySymbol()} ${val.toLocaleString()}</div>
          <div class="record-opp-card-action"><button class="btn btn-sm btn-ghost view-opportunity" data-id="${opp.id}">View</button></div>
        </div>
      `;
    }).join('');

    // Attach view handlers
    oppsEl.querySelectorAll('.view-opportunity').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const opp = opportunities.find(o => String(o.id) === String(id));
        if (opp) {
          closeModal('company-view-modal');
          const isOwnOpportunity = !state.isManager || opp.user_id === state.currentUser.id;
          openOpportunityModal(opp, !isOwnOpportunity);
        }
      });
    });
  }

  // Render Call Logs tab (premium rows)
  const callsEl = document.getElementById('company-view-calls');
  if (!calls || calls.length === 0) {
    callsEl.innerHTML = `<div class="record-empty-state"><div class="record-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.79 19.79 0 0 1 11.63 19a19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72"/></svg></div><div class="record-empty-title">No call logs</div><div class="record-empty-desc">No call records found for this company.</div></div>`;
  } else {
    callsEl.innerHTML = calls.map(log => {
      const isInbound = (log.direction || '').toLowerCase() === 'inbound';
      const phoneIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.79 19.79 0 0 1 11.63 19a19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3"/></svg>`;
      const contactName = escapeHtml(log.people ? (log.people.name || '') : (log.contact_name || 'Unknown'));
      const repName = escapeHtml(log.profiles ? `${log.profiles.first_name || ''} ${log.profiles.last_name || ''}`.trim() : '');
      return `
        <div class="record-call-row" data-id="${log.id}">
          <div class="record-call-icon${isInbound ? ' record-call-icon--inbound' : ''}">${phoneIcon}</div>
          <div class="record-call-body">
            <div class="record-call-contact">${contactName}</div>
            <div class="record-call-meta">${formatDateWithTime(log.call_at)}${repName ? ` · ${repName}` : ''}</div>
          </div>
          <div class="record-call-right">
            <span class="record-call-outcome-pill">${escapeHtml(log.outcome || 'N/A')}</span>
            <button class="btn btn-sm btn-ghost view-call-log" data-id="${log.id}">View</button>
          </div>
        </div>
      `;
    }).join('');

    callsEl.querySelectorAll('.view-call-log').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const log = calls.find(l => String(l.id) === String(id));
        if (log) {
          closeModal('company-view-modal');
          openCallLogViewModal(log);
        }
      });
    });
  }

  // Render Recent Visits tab (premium rows)
  const visitsEl = document.getElementById('company-view-visits');
  if (!visits || visits.length === 0) {
    visitsEl.innerHTML = `<div class="record-empty-state"><div class="record-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg></div><div class="record-empty-title">No recent visits</div><div class="record-empty-desc">No visits have been recorded for this company yet.</div></div>`;
  } else {
    const pinSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
    visitsEl.innerHTML = visits.map(v => {
      const repName = v.user ? `${v.user.first_name || ''} ${v.user.last_name || ''}`.trim() : '';
      return `
        <div class="record-visit-row" data-id="${v.id}">
          <div class="record-visit-dot">${pinSvg}</div>
          <div class="record-visit-body">
            <div class="record-visit-type">${escapeHtml(v.contact_name || v.visit_type || 'Visit')}</div>
            <div class="record-visit-meta">${escapeHtml(v.visit_type || '')} · ${formatDate(v.created_at)}${repName ? ` · ${repName}` : ''}</div>
            ${v.notes ? `<div class="record-visit-notes">${escapeHtml(v.notes)}</div>` : ''}
          </div>
          <div class="record-visit-action"><button class="btn btn-sm btn-ghost view-visit" data-id="${v.id}">View</button></div>
        </div>
      `;
    }).join('');

    // Attach visit view handlers
    visitsEl.querySelectorAll('.view-visit').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        closeModal('company-view-modal');
        await fetchAndOpenVisit(id);
      });
    });
  }

  // Render Employees tab (premium rows)
  try {
    const employeesEl = document.getElementById('company-view-employees');
    if (employeesEl) {
      if (!employees || employees.length === 0) {
        employeesEl.innerHTML = `<div class="record-empty-state"><div class="record-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></div><div class="record-empty-title">No people linked</div><div class="record-empty-desc">No contacts are linked to this company yet.</div></div>`;
      } else {
        employeesEl.innerHTML = employees.map(p => {
          const fullName = escapeHtml(p.name || (p.first_name ? `${p.first_name} ${p.last_name}` : '—'));
          const initials = getInitials(p.name || (p.first_name ? `${p.first_name} ${p.last_name}` : ''));
          return `
            <div class="record-employee-row" data-id="${p.id}">
              <div class="record-employee-avatar">${initials}</div>
              <div class="record-employee-body">
                <div class="record-employee-name">${fullName}</div>
                <div class="record-employee-role">${escapeHtml(p.job_title || p.role || '—')}</div>
              </div>
              <div class="record-employee-action"><button class="btn btn-sm btn-ghost view-employee" data-id="${p.id}">View</button></div>
            </div>
          `;
        }).join('');

        employeesEl.querySelectorAll('.view-employee').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            const personObj = (employees || []).find(p => String(p.id) === String(id));
            if (personObj) {
              closeModal('company-view-modal');
              openPersonViewModal(personObj);
            } else {
              closeModal('company-view-modal');
              openPersonViewModal(id);
            }
          });
        });
      }
    }
  } catch (err) {
    crmDebugLog('company-view-employees-render-error', err);
  }

  if (window.lucide) lucide.createIcons();
}


function openCallLogModal(log = null) {
  const modal = document.getElementById('call-log-modal');
  const title = document.getElementById('call-log-modal-title');
  const saveBtn = document.getElementById('save-call-log-btn');

  title.textContent = log ? 'Edit Call Log' : 'Log New Call';

  // Reset form
  document.getElementById('call-contact-input').value = log ? (log.people ? log.people.name : log.contact_name) : '';
  document.getElementById('call-contact-id').value = log ? log.contact_id || '' : '';
  document.getElementById('call-company-input').value = log ? (log.companies ? log.companies.name : log.company_name) : '';
  document.getElementById('call-company-id').value = log ? log.company_id || '' : '';
  document.getElementById('call-direction').value = log ? log.direction : 'Outbound';
  document.getElementById('call-datetime').value = log ? new Date(log.call_at).toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16);
  document.getElementById('call-duration').value = log ? Math.floor(log.duration_seconds / 60) : '';
  document.getElementById('call-notes').value = log ? log.notes || '' : '';

  // Outcome selection
  if (log) {
    const radio = document.querySelector(`input[name = "call-outcome"][value = "${log.outcome}"]`);
    if (radio) radio.checked = true;
  } else {
    document.querySelectorAll('input[name="call-outcome"]').forEach(r => r.checked = false);
  }

  // Direction radio sync
  const dirVal = log ? log.direction : 'Outbound';
  document.getElementById('call-direction').value = dirVal;
  document.querySelectorAll('input[name="call-direction-radio"]').forEach(r => {
    r.checked = r.value === dirVal;
    r.onchange = () => { document.getElementById('call-direction').value = r.value; };
  });

  modal.style.display = 'flex';

  // Live Search Handlers
  initCallLogSearch();

  saveBtn.onclick = () => saveCallLog(log?.id);
}

function initCallLogSearch() {
  const contactInput = document.getElementById('call-contact-input');
  const contactResults = document.getElementById('call-contact-results');
  const companyInput = document.getElementById('call-company-input');
  const companyResults = document.getElementById('call-company-results');

  const handleSearch = (input, resultsContainer, type, idField) => {
    // Clear existing listeners by cloning
    const newInput = input.cloneNode(true);
    input.parentNode.replaceChild(newInput, input);

    newInput.addEventListener('input', async (e) => {
      const val = e.target.value.toLowerCase();
      if (val.length < 1) {
        resultsContainer.classList.remove('active');
        return;
      }

      let matches = [];
      if (type === 'people') {
        matches = state.allPeople.filter(p => matchesTokenizedQuery(val, p.name, p.email, p.job_title, p.companies?.name)).slice(0, 5);
      } else {
        matches = (window.allCompaniesData || []).filter(c => matchesTokenizedQuery(val, c.name, c.description, c.address)).slice(0, 5);
      }

      let html = matches.map(m => {
        let avatarHtml;
        if (type === 'people') {
          const initials = escapeHtml(getInitials(m.name));
          avatarHtml = `<div class="opp-suggest-avatar opp-suggest-avatar--person"><span>${initials}</span></div>`;
        } else {
          const initials = escapeHtml(getInitials(m.name));
          const domain = m.website ? m.website.replace(/^https?:\/\//, '').split('/')[0] : null;
          const logoUrl = domain ? getCompanyLogoUrl(domain) : null;
          avatarHtml = `<div class="opp-suggest-avatar">
            ${logoUrl ? `<img class="opp-suggest-logo" src="${logoUrl}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
            <span>${initials}</span>
          </div>`;
        }
        const subtitle = type === 'people'
          ? escapeHtml(m.companies?.name || m.job_title || '')
          : escapeHtml(m.address || m.description || '');
        return `<div class="search-result-item" data-id="${m.id}" data-name="${escapeHtml(m.name)}">
          ${avatarHtml}
          <div class="search-result-text">
            <span class="title">${escapeHtml(m.name)}</span>
            ${subtitle ? `<span class="subtitle">${subtitle}</span>` : ''}
          </div>
        </div>`;
      }).join('');

      html += `<div class="search-result-item add-new" data-id="" data-name="${escapeHtml(e.target.value)}">
        <div class="opp-suggest-avatar opp-suggest-avatar--custom"><span>+</span></div>
        <div class="search-result-text">
          <span class="title">Use: "${escapeHtml(e.target.value)}"</span>
        </div>
      </div>`;

      resultsContainer.innerHTML = html;
      resultsContainer.classList.add('active');

      resultsContainer.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', () => {
          newInput.value = item.dataset.name;
          document.getElementById(idField).value = item.dataset.id;
          resultsContainer.classList.remove('active');
        });
      });
    });

    // Close results on blur after short delay
    newInput.addEventListener('blur', () => {
      setTimeout(() => resultsContainer.classList.remove('active'), 200);
    });
  };

  handleSearch(contactInput, contactResults, 'people', 'call-contact-id');
  handleSearch(companyInput, companyResults, 'companies', 'call-company-id');
}

async function saveCallLog(logId = null) {
  const contactName = document.getElementById('call-contact-input').value;
  const contactId = document.getElementById('call-contact-id').value || null;
  const companyName = document.getElementById('call-company-input').value;
  const companyId = document.getElementById('call-company-id').value || null;
  const direction = document.getElementById('call-direction').value;
  const callAt = document.getElementById('call-datetime').value;
  const durationMins = document.getElementById('call-duration').value;
  const notes = document.getElementById('call-notes').value;
  const outcomeEl = document.querySelector('input[name="call-outcome"]:checked');

  if (!contactName || !outcomeEl) {
    showToast('Contact and Outcome are required', 'error');
    return;
  }

  const logData = {
    user_id: state.currentUser.id,
    contact_name: contactId ? null : contactName,
    contact_id: contactId,
    company_name: companyId ? null : companyName,
    company_id: companyId,
    direction,
    call_at: new Date(callAt).toISOString(),
    duration_seconds: durationMins ? durationMins * 60 : null,
    outcome: outcomeEl.value,
    notes,
    organization_id: state.currentOrganization?.id
  };

  const saveBtn = document.getElementById('save-call-log-btn');
  saveBtn.disabled = true;

  let res;
  if (logId) {
    res = await supabaseClient.from('call_logs').update(logData).eq('id', logId);
  } else {
    res = await supabaseClient.from('call_logs').insert([logData]);
  }

  saveBtn.disabled = false;

  if (res.error) {
    showToast('Error saving log: ' + res.error.message, 'error');
  } else {
    showToast('Call log saved', 'success');
    closeModal('call-log-modal');
    renderCallLogsView();
  }
}


// ── Exports ────────────────────────────────────────────────────
export {
  submitChangePassword,
  renderCallLogsView,
  deleteCallLog,
  openCallLogViewModal,
  openCompanyViewModal,
  openCallLogModal,
  initCallLogSearch,
  saveCallLog,
};
