const SUPABASE_URL = 'https://ndrkncirkekpqjjkasiy.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5kcmtuY2lya2VrcHFqamthc2l5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU2MDU2MTEsImV4cCI6MjA4MTE4MTYxMX0.SGVLqU6-u1ALj_P1nsyytYe7cNbAyxCVbV6kjAaiGU4';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = null;
let isManager = false;
let currentView = 'log-visit';
let visitTags = [];
let chartInstances = {};
let selectedRepId = null;
let companyCategories = [];
let personPhoneNumbers = [];
let mentionedPeople = [];
let allPeople = [];
let isTechnician = false;

// ======================
// DOM ELEMENTS
// ======================

const loadingScreen = document.getElementById('loading-screen');
const authScreen = document.getElementById('auth-screen');
const mainApp = document.getElementById('main-app');
const viewContainer = document.getElementById('view-container');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
const sidebarClose = document.getElementById('sidebar-close');
const userMenu = document.getElementById('user-menu');
const userAvatarBtn = document.getElementById('user-avatar-btn');
const themeToggle = document.getElementById('theme-toggle');
const commandPaletteBtn = document.getElementById('command-palette-btn');
const commandPalette = document.getElementById('command-palette');
const exportBtn = document.getElementById('export-btn');
const logoutBtn = document.getElementById('logout-btn');

// ======================
// INITIALIZATION
// ======================

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initAuth();
  initEventListeners();
});

function initTheme() {
  const savedTheme = localStorage.getItem('theme') ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme);
}

function initAuth() {
  supabaseClient.auth.getSession().then(({ data: { session } }) => {
    setTimeout(() => {
      if (session) {
        currentUser = session.user;
        loadingScreen.classList.add('hidden');
        initApp();
      } else {
        loadingScreen.classList.add('hidden');
        authScreen.style.display = 'flex';
      }
    }, 1500);
  });

  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN') {
      currentUser = session.user;
      authScreen.style.display = 'none';
      initApp();
    } else if (event === 'SIGNED_OUT') {
      currentUser = null;
      mainApp.style.display = 'none';
      authScreen.style.display = 'flex';
    }
  });
}

function initEventListeners() {
  // Password toggles
  document.querySelectorAll('.toggle-password').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = btn.closest('.input-wrapper').querySelector('input');
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
    });
  });

  // Login form
  document.getElementById('login-form').addEventListener('submit', handleLogin);

  // Logout
  logoutBtn.addEventListener('click', handleLogout);

  // Mobile menu
  mobileMenuToggle?.addEventListener('click', openSidebar);
  sidebarClose?.addEventListener('click', closeSidebar);
  sidebarOverlay?.addEventListener('click', closeSidebar);

  // User menu
  userAvatarBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    userMenu.classList.toggle('active');
  });

  document.addEventListener('click', (e) => {
    if (!userMenu?.contains(e.target)) {
      userMenu?.classList.remove('active');
    }
  });

  // Theme toggle
  themeToggle?.addEventListener('click', toggleTheme);

  // Command palette
  commandPaletteBtn?.addEventListener('click', openCommandPalette);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      openCommandPalette();
    }
    if (e.key === 'Escape') {
      closeCommandPalette();
      closeSidebar();
    }
  });

  document.querySelector('.command-palette-backdrop')?.addEventListener('click', closeCommandPalette);

  // Export
  exportBtn?.addEventListener('click', () => {
    userMenu?.classList.remove('active');
    openExportModal();
  });

  // Navigation
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const view = e.currentTarget.getAttribute('data-view');
      loadView(view);
      closeSidebar();
    });
  });
}

// ======================
// AUTHENTICATION HANDLERS
// ======================

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const submitBtn = e.target.querySelector('button[type="submit"]');

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Signing in...';

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

  if (error) {
    showToast(error.message, 'error');
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span>Sign In</span>';
    return;
  }

  currentUser = data.user;
  submitBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-icon lucide-check"><path d="M20 6 9 17l-5-5"/></svg> Success!';
}

async function handleLogout() {
  await supabaseClient.auth.signOut();
  location.reload();
}

// ======================
// APP INITIALIZATION
// ======================

async function initApp() {
  authScreen.style.display = 'none';
  mainApp.style.display = 'flex';

  const { data: profile, error } = await supabaseClient
    .from('profiles')
    .select('role, first_name, last_name, email')
    .eq('id', currentUser.id)
    .single();

  if (error) {
    showToast('Error loading profile: ' + error.message, 'error');
    return;
  }

  isManager = profile.role === 'manager';
  isTechnician = profile.role === 'technician';

  // Update UI based on role
  updateUserDisplay(profile);
  updateNavigationForRole();

  // Load all people for mention functionality
  await loadAllPeople();

  const savedView = localStorage.getItem('lastActiveView');

  // Define the default based on role
  let defaultView;
  if (isManager) {
    defaultView = 'team-dashboard';
  } else if (isTechnician) {
    defaultView = 'technician-log-visit';
  } else {
    defaultView = 'log-visit';
  }

  // If we have a saved view (and it's not the auth screen), use it. Otherwise use default.
  const viewToLoad = (savedView && savedView !== 'auth-screen') ? savedView : defaultView;

  // Load the determined view
  await loadView(viewToLoad);
}

async function loadAllPeople() {
  const { data: people, error } = await supabaseClient
    .from('people')
    .select('id, name, email, company_id, companies(name)')
    .order('name', { ascending: true });

  if (error) {
    console.error('Error loading people:', error);
    return;
  }

  allPeople = people || [];
}

function updateUserDisplay(profile) {
  const displayName = profile.first_name ? `${profile.first_name} ${profile.last_name || ''}` : currentUser.email;
  const initials = getInitials(displayName);
  const email = profile.email || currentUser.email;

  // Update header avatar
  document.getElementById('user-avatar').textContent = initials;
  document.getElementById('user-display-name').textContent = displayName;
  document.getElementById('user-display-email').textContent = email;

}

function updateNavigationForRole() {
  const managerNavSection = document.getElementById('manager-nav-section');
  const technicianNavSection = document.getElementById('technician-nav-section');
  const managerBottomNav = document.querySelector('.bottom-nav-item.manager-only');
  const logVisitNav = document.querySelector('[data-view="log-visit"]');
  const technicianLogVisitNav = document.querySelector('[data-view="technician-log-visit"]');
  const technicianBottomNav = document.querySelectorAll('.bottom-nav-item.technician-only');

  if (isManager) {
    managerNavSection.style.display = 'block';
    if (managerBottomNav) managerBottomNav.style.display = 'flex';
    // Hide log visit for managers in sidebar
    document.querySelectorAll('.sidebar-nav [data-view="log-visit"]').forEach(el => {
      el.style.display = 'none';
    });
    // Hide technician views for managers
    technicianNavSection.style.display = 'none';
  } else if (isTechnician) {
    // Show technician navigation
    technicianNavSection.style.display = 'block';
    // Hide sales rep navigation
    document.querySelectorAll('.sidebar-nav [data-view="log-visit"]').forEach(el => {
      el.style.display = 'none';
    });
    document.querySelectorAll('.sidebar-nav [data-view="my-activity"]').forEach(el => {
      el.style.display = 'none';
    });
    // Hide views that technicians should not access
    ['sales-funnel', 'opportunity-pipeline', 'companies', 'people', 'user-management'].forEach(view => {
      document.querySelectorAll(`.sidebar-nav [data-view="${view}"]`).forEach(el => el.style.display = 'none');
    });
    // Hide manager navigation
    managerNavSection.style.display = 'none';
  } else {
    // Sales rep view
    managerNavSection.style.display = 'none';
    technicianNavSection.style.display = 'none';
    if (managerBottomNav) managerBottomNav.style.display = 'none';
  }
  if (isTechnician) {
    technicianBottomNav.forEach(el => el.style.display = 'flex');
    // Hide other navigation
    document.querySelectorAll('.bottom-nav-item:not(.technician-only)').forEach(el => {
      el.style.display = 'none';
    });
  } else {
    technicianBottomNav.forEach(el => el.style.display = 'none');
  }

}


// ======================
// SIDEBAR & NAVIGATION
// ======================

function openSidebar() {
  sidebar.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeSidebar() {
  sidebar.classList.remove('active');
  document.body.style.overflow = '';
}

function updateActiveNav(viewName) {
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-view') === viewName);
  });
}

// ======================
// VIEW ROUTER
// ======================
async function loadView(viewName) {
  currentView = viewName;
  updateActiveNav(viewName);

  // Prevent technicians from accessing certain views
  const blockedForTechnician = ['sales-funnel', 'opportunity-pipeline', 'companies', 'people', 'user-management'];
  if (isTechnician && blockedForTechnician.includes(viewName)) {
    showToast('You do not have permission to access this view', 'error');
    return;
  }

  // Destroy existing charts
  Object.keys(chartInstances).forEach(chartId => {
    if (chartInstances[chartId]) {
      chartInstances[chartId].destroy();
      delete chartInstances[chartId];
    }
  });

  localStorage.setItem('lastActiveView', viewName);

  switch (viewName) {
    case 'log-visit':
      await renderLogVisitView();
      break;
    case 'my-activity':
      await renderMyActivityView();
      break;
    case 'sales-funnel':
      await renderSalesFunnelView();
      break;
    case 'opportunity-pipeline':
      await renderOpportunityPipelineView();
      break;
    case 'team-dashboard':
      if (isManager) {
        await renderTeamDashboardView();
      } else {
        viewContainer.innerHTML = renderAccessDenied();
      }
      break;
    case 'route-planning':
      if (isManager) {
        await renderRoutePlanningView();
      } else {
        viewContainer.innerHTML = renderAccessDenied();
      }
      break;
    case 'my-routes':
      await renderMyRoutesView();
      break;
    case 'user-management':
      await renderUserManagementView();
      break;
    case 'companies':
      await renderCompaniesView();
      break;
    case 'people':
      await renderPeopleView();
      break;
    case 'tasks':
      await renderTasksView();
      break;
    case 'technician-log-visit':
      if (isTechnician) {
        await renderTechnicianLogVisitView();
      } else {
        viewContainer.innerHTML = renderAccessDenied();
      }
      break;
    case 'technician-activity':
      if (isTechnician) {
        await renderTechnicianActivityView();
      } else {
        viewContainer.innerHTML = renderAccessDenied();
      }
      break;
    case 'technicians-dashboard':
      if (isManager) {
        await renderTechniciansDashboardView();
      } else {
        viewContainer.innerHTML = renderAccessDenied();
      }
      break;
    case 'reminders':
      await renderRemindersView();
      break;
    default:
      viewContainer.innerHTML = renderNotFound();
  }
  checkDueReminders();
}

// ======================
// COMPANIES VIEW
// ======================

async function renderCompaniesView() {
  // Fetch all companies (we'll paginate in the UI)
  const { data: companies, error } = await supabaseClient
    .from('companies')
    .select(`
      *,
      company_categories(
        categories(
          id,
          name
        )
      )
    `)
    .order('name', { ascending: true });

  if (error) {
    viewContainer.innerHTML = renderError(error.message);
    return;
  }

  // Store for global access
  window.allCompaniesData = companies;

  // Initial pagination state
  let currentPage = 1;
  const recordsPerPage = 10; // Number of records per page
  let searchQuery = ''; // Separate search state

  // Function to render the companies table
  function renderCompaniesTable(companiesToRender, paginationInfo) {
    let html = `
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Companies</h3>
          ${isManager ? `
            <button class="btn btn-primary" id="add-company-btn">
              <i class="fas fa-plus"></i> Add Company
            </button>
          ` : ''}
        </div>
        
        <!-- Add search bar -->
        <div class="form-field">
          <div class="search-container">
            <i class="fas fa-search"></i>
            <input type="text" id="companies-search" placeholder="Search companies by name or description...">
          </div>
        </div>
        
        <!-- Companies Table -->
        <div class="table-container" id="companies-table-container">
          <table class="data-table" id="companies-table">
            <thead>
              <tr>
                <th width="50">#</th>
                <th>Company Name</th>
                <th>Industry</th>
                <th>Location</th>
                <th>Last Interaction</th>
                ${isManager ? '<th>Actions</th>' : ''}
              </tr>
            </thead>
            <tbody>
    `;

    if (companiesToRender.length === 0) {
      html += `
        <tr>
          <td colspan="${isManager ? '6' : '5'}" class="text-center">
            <div class="empty-state">
              <i class="fas fa-building empty-state-icon"></i>
              <h3 class="empty-state-title">No companies found</h3>
              <p class="empty-state-description">Try adjusting your search terms or add a new company.</p>
              ${isManager ? `
                <button class="btn btn-primary" onclick="openCompanyModal()">
                  <i class="fas fa-plus"></i> Add Company
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    } else {
      companiesToRender.forEach((company, index) => {
        const categories = company.company_categories.map(c => c.categories.name).join(', ');
        const actualRowNumber = (paginationInfo.currentPage - 1) * paginationInfo.recordsPerPage + index + 1;

        html += `
          <tr data-id="${company.id}" data-name="${company.name.toLowerCase()}" data-description="${(company.description || '').toLowerCase()}">
            <td>${actualRowNumber}</td>
            <td>
              <div class="company-name-cell">${company.name}</div>
              ${company.description ? `<div class="company-description">${company.description}</div>` : ''}
            </td>
            <td>${categories || 'N/A'}</td>
            <td>${company.address || 'N/A'}</td>
            <td>${company.last_interaction ? formatDate(company.last_interaction) : 'Never'}</td>
            ${isManager ? `
              <td>
                <div class="table-actions">
                  <button class="action-btn edit-company" data-id="${company.id}" title="Edit company">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-square-pen-icon lucide-square-pen"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/></svg>
                  </button>
                  <button class="action-btn delete-company" data-id="${company.id}" title="Delete company">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-icon lucide-trash"><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  </button>
                </div>
              </td>
            ` : ''}
          </tr>
        `;
      });
    }

    html += `
            </tbody>
          </table>
        </div>
        
        <!-- Pagination Container -->
        <div id="companies-pagination"></div>
      </div>
    `;

    viewContainer.innerHTML = html;

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
        const result = searchAndPaginate(
          window.allCompaniesData,
          searchQuery,
          currentPage,
          recordsPerPage,
          (company, query) =>
            company.name.toLowerCase().includes(query) ||
            (company.description && company.description.toLowerCase().includes(query))
        );
        renderCompaniesTable(result.data, result);
      }
    );

    // Initialize event listeners
    initializeCompaniesEventListeners();
  }

  // Separate function to initialize event listeners
  function initializeCompaniesEventListeners() {

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

        // Use a small delay to avoid too many rapid searches
        clearTimeout(newSearchInput.searchTimeout);
        newSearchInput.searchTimeout = setTimeout(() => {
          currentPage = 1; // Reset to first page when searching
          const result = searchAndPaginate(
            window.allCompaniesData,
            searchQuery,
            currentPage,
            recordsPerPage,
            (company, query) =>
              company.name.toLowerCase().includes(query) ||
              (company.description && company.description.toLowerCase().includes(query))
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

    // Edit and delete buttons
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
          (company, query) =>
            company.name.toLowerCase().includes(query) ||
            (company.description && company.description.toLowerCase().includes(query))
        );

        // Adjust current page if necessary
        if (result.data.length === 0 && result.currentPage > 1) {
          currentPage--;
          const adjustedResult = searchAndPaginate(
            window.allCompaniesData,
            searchQuery,
            currentPage,
            recordsPerPage,
            (company, query) =>
              company.name.toLowerCase().includes(query) ||
              (company.description && company.description.toLowerCase().includes(query))
          );
          renderCompaniesTable(adjustedResult.data, adjustedResult);
        } else {
          renderCompaniesTable(result.data, result);
        }
      });
    });
  }

  // Initial render
  const initialResult = searchAndPaginate(
    window.allCompaniesData,
    searchQuery,
    1, // Explicitly set to 1
    recordsPerPage,
    (company, query) => true // No initial filter
  );
  renderCompaniesTable(initialResult.data, initialResult);
}



// Update the openCompanyModal function to use the global data
function openCompanyModal(company = null) {
  const modal = document.getElementById('company-modal');
  const modalTitle = document.getElementById('company-modal-title');
  const saveBtn = document.getElementById('save-company-btn');

  // Reset form
  document.getElementById('company-name-input').value = '';
  document.getElementById('company-description').value = '';
  document.getElementById('company-address').value = '';
  document.getElementById('company-latitude').value = '';
  document.getElementById('company-longitude').value = '';
  document.getElementById('company-radius').value = '200';

  // Clear categories
  document.getElementById('categories-container').innerHTML = '<input type="text" class="categories-input" id="categories-input" placeholder="Add category...">';
  companyCategories = [];

  // Set modal title and show manual coordinates section
  if (company) {
    modalTitle.innerHTML = 'Edit Company';

    // Fill form with company data
    document.getElementById('company-name-input').value = company.name || '';
    document.getElementById('company-description').value = company.description || '';
    document.getElementById('company-address').value = company.address || '';
    document.getElementById('company-latitude').value = company.latitude?.toString() || '';
    document.getElementById('company-longitude').value = company.longitude?.toString() || '';
    document.getElementById('company-radius').value = company.radius?.toString() || '200';

    // Show manual coordinates section
    document.getElementById('manual-coords-section').style.display = 'block';

    // Fill categories
    if (company.company_categories && company.company_categories.length > 0) {
      company.company_categories.forEach(c => {
        addCategory(c.categories.name);
      });
    }

    // Show/hide geocode button based on whether coordinates exist
    const geocodeBtn = document.getElementById('geocode-address-btn');
    if (company.latitude && company.longitude) {
      geocodeBtn.style.display = 'none';
      document.getElementById('manual-coords-section').classList.remove('hidden');
    } else {
      geocodeBtn.style.display = 'block';
      document.getElementById('manual-coords-section').classList.add('hidden');
    }
  } else {
    modalTitle.innerHTML = 'New Company';
    document.getElementById('manual-coords-section').classList.add('hidden');
    const geocodeBtn = document.getElementById('geocode-address-btn');
    if (geocodeBtn) geocodeBtn.style.display = 'block';
  }

  // Show modal
  modal.style.display = 'flex';

  // Initialize event listeners
  initCompanyModalListeners(company);
}


function initCompanyModalListeners(company) {
  const categoriesInput = document.getElementById('categories-input');
  const saveBtn = document.getElementById('save-company-btn');

  // Get buttons after they exist in the DOM
  const geocodeBtn = document.getElementById('geocode-address-btn');
  const useCurrentLocationBtn = document.getElementById('use-current-location-btn');

  // Categories input
  categoriesInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && categoriesInput.value.trim()) {
      e.preventDefault();
      addCategory(categoriesInput.value.trim());
      categoriesInput.value = '';
    }
  });

  // Geocode button (Updated to use OpenStreetMap Nominatim)
  if (geocodeBtn) {
    const newGeocodeBtn = geocodeBtn.cloneNode(true);
    geocodeBtn.parentNode.replaceChild(newGeocodeBtn, geocodeBtn);

    newGeocodeBtn.addEventListener('click', async () => {
      const addressInput = document.getElementById('company-address');
      const address = addressInput.value.trim();

      if (!address) {
        showToast('Please enter an address to geocode', 'error');
        return;
      }

      // Set loading state
      newGeocodeBtn.disabled = true;
      newGeocodeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Geocoding...';

      try {
        // CALL THE NEW NOMINATIM FUNCTION
        const geo = await geocodeAddressWithOSM(address);

        // Update coordinates fields
        document.getElementById('company-latitude').value = geo.latitude.toFixed(6);
        document.getElementById('company-longitude').value = geo.longitude.toFixed(6);
        document.getElementById('company-radius').value = '200';

        // Hide manual coordinate input section
        const manualCoordsSection = document.getElementById('manual-coords-section');
        if (manualCoordsSection) {
          manualCoordsSection.classList.add('hidden');
        }

        showToast(`Address found: ${geo.displayName}`, 'success');

      } catch (error) {
        showToast(error.message, 'error');
      } finally {
        // Restore button state
        newGeocodeBtn.disabled = false;
        newGeocodeBtn.innerHTML = `
          Search Address
        `;
      }
    });
  }

  // Use current location button
  if (useCurrentLocationBtn) {
    const newUseLocationBtn = useCurrentLocationBtn.cloneNode(true);
    useCurrentLocationBtn.parentNode.replaceChild(newUseLocationBtn, useCurrentLocationBtn);

    newUseLocationBtn.addEventListener('click', () => {
      if (navigator.geolocation) {
        newUseLocationBtn.disabled = true;
        newUseLocationBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Getting location...';

        navigator.geolocation.getCurrentPosition(
          (position) => {
            const { latitude, longitude } = position.coords;
            document.getElementById('company-latitude').value = latitude.toFixed(6);
            document.getElementById('company-longitude').value = longitude.toFixed(6);
            document.getElementById('company-radius').value = '200';

            // Hide manual section
            document.getElementById('manual-coords-section').classList.add('hidden');

            showToast('Current location set successfully', 'success');
          },
          (error) => {
            showToast('Unable to get location', 'error');
          },
          { enableHighAccuracy: true, timeout: 10000 }
        );
      } else {
        showToast('Geolocation not supported', 'error');
      }

      newUseLocationBtn.disabled = false;
      newUseLocationBtn.innerHTML = 'Use Current Location';
    });
  }

  // Save company
  // In initCompanyModalListeners function, update the save button handler:
  saveBtn.onclick = async () => {
    const name = document.getElementById('company-name-input').value.trim();
    const description = document.getElementById('company-description').value.trim();
    const address = document.getElementById('company-address').value.trim(); // This is correct
    const latitude = parseFloat(document.getElementById('company-latitude').value);
    const longitude = parseFloat(document.getElementById('company-longitude').value);
    const radius = parseInt(document.getElementById('company-radius').value);

    // Validate
    if (!name || !address || (!latitude && !longitude)) {
      showToast('Please enter company name, address, and coordinates', 'error');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

    try {
      const companyData = {
        name,
        description: description || null,
        address: address, // Make sure this is included
        latitude,
        longitude,
        radius,
        created_by: currentUser.id
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
      if (companyCategories && companyCategories.length > 0) {
        // Delete existing categories ONLY if editing an existing company
        if (company) {
          await supabaseClient
            .from('company_categories')
            .delete()
            .eq('company_id', companyId);
        }

        // Add categories
        for (const categoryName of companyCategories) {
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

      showToast(`Company ${company ? 'updated' : 'created'} successfully!`, 'success');
      closeModal('company-modal');
      renderCompaniesView();

    } catch (error) {
      console.error('Error saving company:', error);
      showToast(`Error ${company ? 'updating' : 'creating'} company: ${error.message}`, 'error');

    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = 'Save Company';
    }
  };
}

function addCategory(name) {
  if (!companyCategories.includes(name)) {
    companyCategories.push(name);
    renderCategories();
  }
}

function removeCategory(name) {
  companyCategories = companyCategories.filter(c => c !== name);
  renderCategories();
}

function renderCategories() {
  const container = document.getElementById('categories-container');
  if (!container) return;

  const categoriesHTML = companyCategories.map(category => `
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
// PEOPLE VIEW
// ======================

async function renderPeopleView() {
  const [peopleResult, companiesResult, opportunitiesResult] = await Promise.all([
    supabaseClient
      .from('people')
      .select(`
        *,
        company:companies(
          id,
          name
        ),
        opportunity:opportunities(
          id,
          name
        )
      `)
      .order('name', { ascending: true }),
    supabaseClient
      .from('companies')
      .select('id, name')
      .order('name', { ascending: true }),
    supabaseClient
      .from('opportunities')
      .select('id, name')
      .order('name', { ascending: true })
  ]);

  const { data: people, error: peopleError } = peopleResult;
  const { data: companies } = companiesResult;
  const { data: opportunities } = opportunitiesResult;

  if (peopleError) {
    viewContainer.innerHTML = renderError(peopleError.message);
    return;
  }

  // Store for global access
  window.allPeopleData = people;
  window.companiesData = companies;
  window.opportunitiesData = opportunities;

  // Initial pagination state
  let currentPage = 1;
  const recordsPerPage = 10; // Number of records per page
  let searchQuery = ''; // Separate search state

  // Function to render the people table
  function renderPeopleTable(peopleToRender, paginationInfo) {
    let html = `
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">People</h3>
          <button class="btn btn-primary" id="add-person-btn">
            <i class="fas fa-plus"></i> Add Person
          </button>
        </div>
        
        <!-- Add search bar -->
        <div class="form-field">
          <div class="search-container">
            <i class="fas fa-search"></i>
            <input type="text" id="people-search" placeholder="Search people by name, email, or company...">
          </div>
        </div>
        
        <!-- People Table -->
        <div class="table-container" id="people-table-container">
          <table class="data-table" id="people-table">
            <thead>
              <tr>
                <th width="50">#</th>
                <th>Name</th>
                <th>Email</th>
                <th>Company</th>
                <th>Job Title</th>
                <th>Phone</th>
                <th>Opportunity</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
    `;

    if (peopleToRender.length === 0) {
      html += `
        <tr>
          <td colspan="8" class="text-center">
            <div class="empty-state">
              <i class="fas fa-user empty-state-icon"></i>
              <h3 class="empty-state-title">No people found</h3>
              <p class="empty-state-description">Try adjusting your search terms or add a new person.</p>
              <button class="btn btn-primary" onclick="openPersonModal()">
                <i class="fas fa-plus"></i> Add Person
              </button>
            </div>
          </td>
        </tr>
      `;
    } else {
      peopleToRender.forEach((person, index) => {
        const companyName = person.company ? person.company.name : 'No company';
        const opportunityName = person.opportunity ? person.opportunity.name : '';
        const phoneNumbers = person.phone_numbers && person.phone_numbers.length > 0
          ? person.phone_numbers.join(', ')
          : 'N/A';
        const actualRowNumber = (paginationInfo.currentPage - 1) * paginationInfo.recordsPerPage + index + 1;

        html += `
          <tr data-id="${person.id}" 
              data-name="${person.name.toLowerCase()}" 
              data-email="${(person.email || '').toLowerCase()}" 
              data-company="${companyName.toLowerCase()}"
              data-job-title="${(person.job_title || '').toLowerCase()}">
            <td>${actualRowNumber}</td>
            <td>
              <div class="person-name-cell">${person.name}</div>
            </td>
            <td>${person.email || 'N/A'}</td>
            <td>${companyName}</td>
            <td>${person.job_title || 'N/A'}</td>
            <td>${phoneNumbers}</td>
            <td>${opportunityName || 'N/A'}</td>
            <td>
              <div class="table-actions">
                <button class="action-btn edit-person" data-id="${person.id}" title="Edit person">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-square-pen-icon lucide-square-pen"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/></svg>
                </button>
                <button class="action-btn delete-person" data-id="${person.id}" title="Delete person">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-icon lucide-trash"><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
              </div>
            </td>
          </tr>
        `;
      });
    }

    html += `
            </tbody>
          </table>
        </div>
        
        <!-- Pagination Container -->
        <div id="people-pagination"></div>
      </div>
    `;

    viewContainer.innerHTML = html;

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
        const result = searchAndPaginate(
          window.allPeopleData,
          searchQuery,
          currentPage,
          recordsPerPage,
          (person, query) =>
            person.name.toLowerCase().includes(query) ||
            (person.email && person.email.toLowerCase().includes(query)) ||
            (person.company && person.company.name && person.company.name.toLowerCase().includes(query)) ||
            (person.job_title && person.job_title.toLowerCase().includes(query))
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

        // Use a small delay to avoid too many rapid searches
        clearTimeout(newSearchInput.searchTimeout);
        newSearchInput.searchTimeout = setTimeout(() => {
          currentPage = 1; // Reset to first page when searching
          const result = searchAndPaginate(
            window.allPeopleData,
            searchQuery,
            currentPage,
            recordsPerPage,
            (person, query) =>
              person.name.toLowerCase().includes(query) ||
              (person.email && person.email.toLowerCase().includes(query)) ||
              (person.company && person.company.name && person.company.name.toLowerCase().includes(query)) ||
              (person.job_title && person.job_title.toLowerCase().includes(query))
          );

          // Store the active element and cursor position before re-rendering
          const activeElement = document.activeElement;
          const wasSearchInput = activeElement && activeElement.id === 'people-search';

          renderPeopleTable(result.data, result);

          // Restore focus and cursor position to the search input if it was the active element
          if (wasSearchInput) {
            setTimeout(() => {
              const searchElement = document.getElementById('people-search');
              searchElement.focus();
              // Set the cursor position to where it was before
              searchElement.setSelectionRange(cursorPosition, cursorPosition);
            }, 0);
          }
        }, 300); // 300ms delay
      });
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
          (person, query) =>
            person.name.toLowerCase().includes(query) ||
            (person.email && person.email.toLowerCase().includes(query)) ||
            (person.company && person.company.name && person.company.name.toLowerCase().includes(query)) ||
            (person.job_title && person.job_title.toLowerCase().includes(query))
        );

        // Adjust current page if necessary
        if (result.data.length === 0 && result.currentPage > 1) {
          currentPage--;
          const adjustedResult = searchAndPaginate(
            window.allPeopleData,
            searchQuery,
            currentPage,
            recordsPerPage,
            (person, query) =>
              person.name.toLowerCase().includes(query) ||
              (person.email && person.email.toLowerCase().includes(query)) ||
              (person.company && person.company.name && person.company.name.toLowerCase().includes(query)) ||
              (person.job_title && person.job_title.toLowerCase().includes(query))
          );
          renderPeopleTable(adjustedResult.data, adjustedResult);
        } else {
          renderPeopleTable(result.data, result);
        }
      });
    });
  }

  // Initial render
  const initialResult = searchAndPaginate(
    window.allPeopleData,
    searchQuery,
    1, // Explicitly set to 1
    recordsPerPage,
    (person, query) => true // No initial filter
  );
  renderPeopleTable(initialResult.data, initialResult);
}


// Update the openPersonModal function to use the global data
function openPersonModal(person = null) {
  const modal = document.getElementById('person-modal');
  const modalTitle = document.getElementById('person-modal-title');
  const saveBtn = document.getElementById('save-person-btn');
  const companySelect = document.getElementById('person-company');
  const opportunitySelect = document.getElementById('person-opportunity');

  // Reset form
  document.getElementById('person-name').value = '';
  document.getElementById('person-email').value = '';
  document.getElementById('person-job-title').value = '';

  // Clear phone numbers
  document.getElementById('phone-numbers-container').innerHTML = `
    <div class="phone-number-input">
      <input type="tel" class="phone-number" placeholder="Enter phone number">
      <button type="button" class="btn btn-sm btn-ghost add-phone-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-plus-icon lucide-plus"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
      </button>
    </div>
  `;
  personPhoneNumbers = [];

  // Populate company dropdown using global data
  if (window.companiesData) {
    companySelect.innerHTML = '<option value="">Select a company</option>';
    window.companiesData.forEach(company => {
      companySelect.innerHTML += `<option value="${company.id}">${company.name}</option>`;
    });
  }

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

    // Fill form with person data
    document.getElementById('person-name').value = person.name || '';
    document.getElementById('person-email').value = person.email || '';
    document.getElementById('person-job-title').value = person.job_title || '';

    if (person.company_id) {
      companySelect.value = person.company_id;
    }

    if (person.opportunity_id) {
      opportunitySelect.value = person.opportunity_id;
    }

    // Add phone numbers
    if (person.phone_numbers && person.phone_numbers.length > 0) {
      personPhoneNumbers = [...person.phone_numbers];
      renderPhoneNumbers();
    }
  } else {
    modalTitle.innerHTML = 'New Person';
  }

  // Show modal
  modal.style.display = 'flex';

  // Initialize event listeners
  initPersonModalListeners(person);
}

function initPersonModalListeners(person) {
  // Add phone number button
  const addPhoneBtn = document.querySelector('.add-phone-btn');
  if (addPhoneBtn) {
    const newAddPhoneBtn = addPhoneBtn.cloneNode(true);
    addPhoneBtn.parentNode.replaceChild(newAddPhoneBtn, addPhoneBtn);
    newAddPhoneBtn.addEventListener('click', (e) => {
      e.preventDefault();
      addPhoneNumber();
    });
  }

  // Save person
  const saveBtn = document.getElementById('save-person-btn');

  saveBtn.onclick = async () => {
    const name = document.getElementById('person-name').value.trim();
    const email = document.getElementById('person-email').value.trim();
    const companyId = document.getElementById('person-company').value;
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
        created_by: currentUser.id
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

      showToast(`Person ${person ? 'updated' : 'created'} successfully!`, 'success');
      closeModal('person-modal');
      renderPeopleView();
    } catch (error) {
      showToast(`Error ${person ? 'updating' : 'creating'} person: ${error.message}`, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = 'Save Person';
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

  personPhoneNumbers.forEach(phone => {
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

async function renderLogVisitView() {
  const { data: companies } = await supabaseClient
    .from('companies')
    .select('*')
    .order('name', { ascending: true });

  viewContainer.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Log Visit</h1>
      <p class="page-subtitle">Record your field visit details</p>
    </div>

    <div class="card">
      <div class="form-field">
        <label for="company-name">Company Name *</label>
        <div class="search-container">
          <i class="fas fa-search"></i>
          <input type="text" id="company-name" placeholder="Search for a company..." required />
          <div id="company-search-results" class="search-results" style="display: none;"></div>
        </div>
      </div>

      <div class="form-field" id="selected-company" style="display: none;">
        <div class="selected-location-info">
          <div id="selected-company-name"></div>
          <div id="selected-company-address" class="text-muted"></div>
        </div>
      </div>
      
      <br>

      <div class="form-field">
        <label for="contact-name">Contact Person</label>
        <input type="text" id="contact-name" placeholder="Client contact name" />
      </div>

      <div class="form-field">
        <label for="visit-type">Visit Type</label>
        <select id="visit-type">
          <option value="new_lead">New Lead</option>
          <option value="follow_up">Follow-up</option>
          <option value="demo">Product Demo</option>
          <option value="closing">Closing</option>
          <option value="support">Customer Support</option>
        </select>
      </div>

      <div class="form-field">
        <label for="notes">Visit Notes *</label>
        <div class="mention-container">
          <textarea id="notes" placeholder="What happened during the visit? Key takeaways, objections, next steps..." rows="5" required></textarea>
          <div id="mention-suggestions" class="mention-suggestions" style="display: none;"></div>
        </div>
        <div class="text-right text-muted mt-1"><span id="char-count">0</span>/1000</div>
      </div>

      <div class="form-field">
        <label>Tags</label>
        <div class="tags-input-container" id="tags-container">
          <input type="text" class="tags-input" id="tags-input" placeholder="Add tags...">
        </div>
        <div class="tag-suggestions">
          <button type="button" class="tag-suggestion" onclick="addTag('urgent')">urgent</button>
          <button type="button" class="tag-suggestion" onclick="addTag('high-value')">high-value</button>
          <button type="button" class="tag-suggestion" onclick="addTag('decision-maker')">decision-maker</button>
          <button type="button" class="tag-suggestion" onclick="addTag('follow-up')">follow-up</button>
        </div>
      </div>

      <div class="form-field">
        <label>Visit Photo</label>
        <input type="file" id="visit-photo" accept="image/*" style="display: none;" />
        <div class="photo-upload-area" id="photo-upload-area">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-camera-icon lucide-camera"><path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"/><circle cx="12" cy="13" r="3"/></svg>
          <span>Tap to take photo</span>
        </div>
        <div id="photo-preview" class="photo-preview"></div>
      </div>

      <div class="form-field">
        <label>Location Verification *</label>
        <button type="button" id="verify-location" class="btn btn-secondary w-full" disabled>
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-pin-icon lucide-map-pin"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>
          Verify Location
        </button>
        <div id="location-status" class="location-status" style="display: none;"></div>
        <div id="location-map" class="location-map" style="display: none;"></div>
      </div>

      <div class="form-field">
        <label for="travel-time">Travel Time (minutes)</label>
        <input type="number" id="travel-time" placeholder="How long did it take to get here?" min="0" />
      </div>

      <button type="button" id="submit-visit" class="btn btn-primary btn-lg w-full mt-3" disabled>
        Save Visit
      </button>
    </div>
  `;

  initLogVisitForm(companies);
}

function initLogVisitForm(companies) {
  const companyNameInput = document.getElementById('company-name');
  const companySearchResults = document.getElementById('company-search-results');
  const selectedCompanyDiv = document.getElementById('selected-company');
  const selectedCompanyName = document.getElementById('selected-company-name');
  const selectedCompanyAddress = document.getElementById('selected-company-address');
  // sales rep should select a company from search; no custom company input here
  const notesEl = document.getElementById('notes');
  const charCountEl = document.getElementById('char-count');
  const verifyLocationBtn = document.getElementById('verify-location');
  const locationStatus = document.getElementById('location-status');
  const locationMapEl = document.getElementById('location-map');
  const submitBtn = document.getElementById('submit-visit');
  const photoUploadArea = document.getElementById('photo-upload-area');
  const photoInput = document.getElementById('visit-photo');
  const photoPreview = document.getElementById('photo-preview');
  const tagsInput = document.getElementById('tags-input');
  const mentionSuggestions = document.getElementById('mention-suggestions');

  let locationVerified = false;
  let map = null;
  let mentionStartIndex = -1;
  let currentMentionQuery = '';

  // Store for global access
  window.companiesData = companies;

  // Company search functionality
  companyNameInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();

    if (query.length === 0) {
      companySearchResults.style.display = 'none';
      return;
    }

    const filtered = companies.filter(company =>
      company.name.toLowerCase().includes(query)
    );

    if (filtered.length === 0) {
      companySearchResults.innerHTML = `<div class="search-result-item">No companies found</div>`;
    } else {
      companySearchResults.innerHTML = filtered.map(company => `
        <div class="search-result-item" onclick="selectCompany('${company.id}')">
          <div class="search-result-icon"></div>
          <div>
            <div class="search-result-name">${company.name}</div>
            <div class="search-result-role">${company.description || 'No description'}</div>
          </div>
        </div>
      `).join('');
    }

    companySearchResults.style.display = 'block';
  });

  // Character counter
  notesEl.addEventListener('input', () => {
    charCountEl.textContent = notesEl.value.length;
  });

  // Initialize mention system for notes
  notesEl.addEventListener('input', (e) => {
    const text = e.target.value;
    const cursorPos = e.target.selectionStart;

    // Check if user is typing a mention (@)
    const beforeCursor = text.substring(0, cursorPos);
    const mentionMatch = beforeCursor.match(/@([^@]*)$/);

    if (mentionMatch) {
      mentionStartIndex = cursorPos - mentionMatch[0].length;
      currentMentionQuery = mentionMatch[1];

      // Show suggestions if query is not empty
      if (currentMentionQuery.length > 0) {
        showMentionSuggestions(currentMentionQuery);
      } else {
        hideMentionSuggestions();
      }
    } else {
      hideMentionSuggestions();
      mentionStartIndex = -1;
      currentMentionQuery = '';
    }
  });

  // Handle mention selection
  notesEl.addEventListener('keydown', (e) => {
    if (mentionSuggestions.style.display !== 'none') {
      const items = mentionSuggestions.querySelectorAll('.mention-suggestion');
      let activeIndex = -1;

      // Find active item
      for (let i = 0; i < items.length; i++) {
        if (items[i].classList.contains('active')) {
          activeIndex = i;
          break;
        }
      }

      // Handle navigation
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIndex = (activeIndex + 1) % items.length;
        updateActiveMention(items, activeIndex);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIndex = activeIndex <= 0 ? items.length - 1 : activeIndex - 1;
        updateActiveMention(items, activeIndex);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (activeIndex >= 0) {
          selectMentionedPerson(items[activeIndex].dataset.personId);
        }
      } else if (e.key === 'Escape') {
        hideMentionSuggestions();
      }
    }
  });

  // Handle click on mention suggestions (before document click handler)
  mentionSuggestions.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    const suggestion = e.target.closest('.mention-suggestion');
    if (suggestion && suggestion.dataset.personId) {
      setTimeout(() => {
        window.selectMentionedPerson(suggestion.dataset.personId);
      }, 0);
    }
  }, true); // Use capture phase to ensure this fires first

  // Handle click outside to close suggestions
  document.addEventListener('click', (e) => {
    if (e.target !== notesEl && !mentionSuggestions.contains(e.target)) {
      hideMentionSuggestions();
    }
  });

  function showMentionSuggestions(query) {
    const filteredPeople = allPeople.filter(person =>
      person.name.toLowerCase().includes(query.toLowerCase())
    );

    if (filteredPeople.length === 0) {
      mentionSuggestions.innerHTML = '<div class="mention-suggestion">No people found</div>';
    } else {
      mentionSuggestions.innerHTML = filteredPeople.map(person => `
        <div class="mention-suggestion" data-person-id="${person.id}">
          <div class="mention-avatar">${getInitials(person.name)}</div>
          <div class="mention-info">
            <div class="mention-name">${person.name}</div>
            <div class="mention-details">${person.email || ''} ${person.companies ? `• ${person.companies.name}` : ''}</div>
          </div>
        </div>
      `).join('');
    }

    mentionSuggestions.style.display = 'block';
  }

  function hideMentionSuggestions() {
    mentionSuggestions.style.display = 'none';
  }

  function updateActiveMention(items, activeIndex) {
    items.forEach((item, index) => {
      item.classList.toggle('active', index === activeIndex);
    });
  }

  window.selectMentionedPerson = function (personId) {
    const person = allPeople.find(p => p.id === parseInt(personId));
    if (!person) return;

    const text = notesEl.value;
    const beforeMention = text.substring(0, mentionStartIndex);
    const afterMention = text.substring(mentionStartIndex + currentMentionQuery.length + 1);

    // Replace with mention format
    notesEl.value = `${beforeMention}@${person.name} (${person.id})${afterMention}`;

    // Add to mentioned people array
    if (!mentionedPeople.find(p => p.id === parseInt(personId))) {
      mentionedPeople.push({
        id: parseInt(personId),
        name: person.name
      });
    }

    // Reset mention state
    hideMentionSuggestions();
    mentionStartIndex = -1;
    currentMentionQuery = '';

    // Update cursor position
    const newCursorPos = beforeMention.length + person.name.length + person.id.toString().length + 4;
    notesEl.focus();
    notesEl.setSelectionRange(newCursorPos, newCursorPos);
  };

  // Tags
  visitTags = [];
  tagsInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && tagsInput.value.trim()) {
      e.preventDefault();
      addTag(tagsInput.value.trim());
      tagsInput.value = '';
    }
  });

  // Photo upload
  photoUploadArea.addEventListener('click', () => photoInput.click());
  photoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        photoPreview.innerHTML = `<img src="${e.target.result}" alt="Visit photo">`;
        photoUploadArea.style.display = 'none';
      };
      reader.readAsDataURL(file);
    }
  });

  // Verify location
  // In the initLogVisitForm function, update the verifyLocationBtn event listener
  verifyLocationBtn.addEventListener('click', () => {
    if (!window.selectedCompanyData) {
      showToast('Please select a company first', 'error');
      return;
    }

    // Validate selected company data
    if (isNaN(window.selectedCompanyData.latitude) || isNaN(window.selectedCompanyData.longitude)) {
      showToast('Invalid company coordinates. Please update company location.', 'error');
      return;
    }

    if (!navigator.geolocation) {
      showToast('Geolocation not supported', 'error');
      return;
    }

    verifyLocationBtn.disabled = true;
    verifyLocationBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Detecting...';
    locationStatus.style.display = 'flex';
    locationStatus.className = 'location-status';
    locationStatus.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Getting your location...';

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const userLat = position.coords.latitude;
        const userLng = position.coords.longitude;
        const accuracy = position.coords.accuracy;

        // Calculate distance with error handling
        const distance = calculateDistance(
          userLat,
          userLng,
          window.selectedCompanyData.latitude,
          window.selectedCompanyData.longitude
        );

        // Check if distance calculation was successful
        if (isNaN(distance)) {
          locationStatus.className = 'location-status error';
          locationStatus.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x-icon lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg> Error calculating distance. Please check company coordinates.`;
          verifyLocationBtn.disabled = false;
          verifyLocationBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-pin-icon lucide-map-pin"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg> Verify Location';
          return;
        }

        const isWithinRadius = distance <= (window.selectedCompanyData.radius + accuracy);

        if (isWithinRadius) {
          locationStatus.className = 'location-status success';
          locationStatus.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-icon lucide-check"><path d="M20 6 9 17l-5-5"/></svg> Location verified! You are ${distance.toFixed(0)}m from ${window.selectedCompanyData.name}`;
          locationVerified = true;
          submitBtn.disabled = false;
          initVerificationMap(userLat, userLng, window.selectedCompanyData);
        } else {
          locationStatus.className = 'location-status error';
          locationStatus.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x-icon lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg> Too far from ${window.selectedCompanyData.name}. You are ${distance.toFixed(0)}m away (max: ${window.selectedCompanyData.radius}m)`;
          locationVerified = false;
          submitBtn.disabled = true;
        }

        verifyLocationBtn.disabled = false;
        verifyLocationBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-pin-icon lucide-map-pin"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg> Verify Location';
      },
      (error) => {
        let errorMsg = 'Unable to get location';
        if (error.code === error.PERMISSION_DENIED) errorMsg = 'Location permission denied';
        if (error.code === error.POSITION_UNAVAILABLE) errorMsg = 'Location unavailable';
        if (error.code === error.TIMEOUT) errorMsg = 'Location request timed out';

        locationStatus.className = 'location-status error';
        locationStatus.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x-icon lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg> ${errorMsg}`;
        verifyLocationBtn.disabled = false;
        verifyLocationBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-pin-icon lucide-map-pin"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg> Verify Location';
        showToast(errorMsg, 'error');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });

  function initVerificationMap(userLat, userLng, company) {
    locationMapEl.style.display = 'block';

    if (map) {
      map.remove();
    }

    map = L.map('location-map').setView([userLat, userLng], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(map);

    L.marker([userLat, userLng]).addTo(map).bindPopup('You are here').openPopup();
    L.circle([company.latitude, company.longitude], {
      radius: company.radius,
      color: '#4f46e5',
      fillColor: '#4f46e5',
      fillOpacity: 0.1
    }).addTo(map);
    L.marker([company.latitude, company.longitude]).addTo(map).bindPopup(company.name);
  }

  // Submit visit
  submitBtn.addEventListener('click', async () => {
    if (!locationVerified) {
      showToast('Please verify your location first', 'error');
      return;
    }

    const company = companyNameInput.value.trim();
    const contact = document.getElementById('contact-name').value.trim();
    const visitType = document.getElementById('visit-type').value;
    const notes = notesEl.value.trim();
    const travelTime = document.getElementById('travel-time').value;
    const photoFile = document.getElementById('visit-photo').files[0];

    if (!company || !notes) {
      showToast('Please fill in all required fields', 'error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

    try {
      let photoUrl = null;

      if (photoFile) {
        const photoPath = `visit-photos/${currentUser.id}/${Date.now()}-${photoFile.name}`;
        const { error: uploadError } = await supabaseClient.storage
          .from('safitrack')
          .upload(photoPath, photoFile);

        if (!uploadError) {
          const { data: urlData } = supabaseClient.storage.from('safitrack').getPublicUrl(photoPath);
          photoUrl = urlData.publicUrl;
        }
      }

      const aiSummary = typeof generateConciseVisitSummary === 'function'
        ? await generateConciseVisitSummary(company, contact, notes)
        : null;
      const leadScore = typeof predictLeadScore === 'function'
        ? await predictLeadScore(company, contact, notes, visitType)
        : null;

      const visitData = {
        user_id: currentUser.id,
        company_name: company,
        contact_name: contact || null,
        visit_type: visitType,
        notes: notes,
        ai_summary: aiSummary,
        lead_score: leadScore,
        location_name: window.selectedCompanyData.name,
        location_address: `${window.selectedCompanyData.latitude}, ${window.selectedCompanyData.longitude}`,
        latitude: window.selectedCompanyData.latitude,
        longitude: window.selectedCompanyData.longitude,
        photo_url: photoUrl,
        travel_time: travelTime ? parseInt(travelTime) : null,
        tags: visitTags,
        mentioned_people: mentionedPeople,
        created_at: new Date().toISOString()
      };

      const { error } = await supabaseClient.from('visits').insert([visitData]);

      if (error) throw error;

      showToast('Visit logged successfully!', 'success');

      if (leadScore >= 70 || visitTags.includes('high-value')) {
        triggerConfetti();
      }

      // Reset mentioned people array for next visit
      mentionedPeople = [];

      loadView('my-activity');
    } catch (err) {
      showToast('Failed to save visit: ' + err.message, 'error');
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'Save Visit';
    }
  });
}

async function geocodeAddress(address) {
  try {
    // Using Nominatim OpenStreetMap geocoding API
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`);
    const data = await response.json();

    if ((data && data.length > 0) && data[0]) {
      const { lat, lon } = data[0];
      return {
        latitude: lat,
        longitude: lon,
        displayName: data[0].display_name || address
      };
    } else {
      throw new Error('Location not found');
    }
  } catch (error) {
    console.error('Geocoding error:', error);
    throw new Error('Unable to geocode address');
  }
}

// Replace the existing selectCompany function with this updated version
window.selectCompany = function (companyId) {
  const companies = window.companiesData;
  const company = companies.find(c => c.id === companyId);
  if (!company) return;

  // Update company name input
  document.getElementById('company-name').value = company.name;

  // Show selected company info
  document.getElementById('selected-company').style.display = 'block';
  document.getElementById('selected-company-name').textContent = company.name;
  document.getElementById('selected-company-address').textContent = company.description || 'No description';

  // Hide search results
  document.getElementById('company-search-results').style.display = 'none';

  // Validate and parse coordinates
  const latitude = parseFloat(company.latitude);
  const longitude = parseFloat(company.longitude);

  // Check if coordinates are valid numbers
  if (isNaN(latitude) || isNaN(longitude)) {
    showToast('Invalid coordinates for this company. Please update company location.', 'error');
    document.getElementById('verify-location').disabled = true;
    return;
  }

  // Set selected company data with radius
  const selectedCompany = {
    id: company.id,
    name: company.name,
    latitude: latitude,
    longitude: longitude,
    radius: parseInt(company.radius) || 200 // Include the radius
  };

  // Store it in a way that can be accessed by the event listener
  window.selectedCompanyData = selectedCompany;

  // Enable verify location button
  document.getElementById('verify-location').disabled = false;
};

// Allow selecting a custom company entered by the user in the Log Visit form
// custom company helper removed for sales rep flow; technicians may use their own helper
// ======================
// MY ACTIVITY VIEW
// ======================

async function renderMyActivityView() {
  const { data: visits, error } = await supabaseClient
    .from('visits')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false });

  if (error) {
    viewContainer.innerHTML = renderError(error.message);
    return;
  }

  let html = `
    <div class="page-header">
      <h1 class="page-title">My Activity</h1>
      <p class="page-subtitle">${visits.length} visits logged</p>
    </div>
  `;

  if (visits.length === 0) {
    html += `
      <div class="card">
        <div class="empty-state">
          <h3 class="empty-state-title">No visits yet</h3>
          <p class="empty-state-description">Start logging your field visits to see them here.</p>
          <button class="btn btn-primary" onclick="loadView('log-visit')">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-plus-icon lucide-plus"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
            Log Your First Visit
          </button>
        </div>
      </div>
    `;
  } else {
    visits.forEach(visit => {
      html += renderVisitCard(visit);
    });
  }

  viewContainer.innerHTML = html;
}

function renderVisitCard(visit, showRepName = false) {
  const date = formatDate(visit.created_at);
  const leadScoreBadge = visit.lead_score ? getLeadScoreBadge(visit.lead_score) : '';

  // Process mentioned people
  let processedNotes = visit.notes || '';
  if (visit.mentioned_people && visit.mentioned_people.length > 0) {
    visit.mentioned_people.forEach(person => {
      const mentionPattern = new RegExp(`@${person.name} \\(${person.id}\\)`, 'g');
      processedNotes = processedNotes.replace(mentionPattern, `<span class="mentioned-person">@${person.name}</span>`);
    });
  }

  return `
    <div class="visit-card">
      <div class="visit-header">
        <div>
          <div class="visit-company">${visit.company_name}</div>
          ${showRepName && visit.user ? `<div class="text-prim" style="font-size: 1rem;">by ${visit.user.first_name} ${visit.user.last_name}</div>` : ''}
        </div>
        <div class="visit-date">${date}</div>
      </div>
      
      <div class="visit-meta">
        ${visit.contact_name ? `<span class="visit-meta-item"><svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-user-icon lucide-user"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> ${visit.contact_name}</span>` : ''}
        ${visit.location_name ? `<span class="visit-meta-item"><svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-pin-icon lucide-map-pin"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>${visit.location_name}</span>` : ''}
        ${visit.visit_type ? `<span class="visit-meta-item"><svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-tag-icon lucide-tag"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/></svg> ${visit.visit_type.replace('_', ' ')}</span>` : ''}
        ${visit.travel_time ? `<span class="visit-meta-item"><i class="fas fa-clock"></i> ${visit.travel_time} min travel</span>` : ''}
      </div>

      ${leadScoreBadge ? `<div class="mb-2">${leadScoreBadge}</div>` : ''}

      ${visit.tags && visit.tags.length > 0 ? `
        <div class="visit-tags mb-2">
          ${visit.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
        </div>
      ` : ''}

      ${visit.photo_url ? `
        <div class="photo-preview mb-2">
          <img src="${visit.photo_url}" alt="Visit photo" onerror="handleImageError(this)">
        </div>
      ` : ''}

      <div class="visit-notes">${processedNotes}</div>

      ${visit.ai_summary ? `
        <div class="ai-insight">
          <div class="ai-insight-header">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-bot-icon lucide-bot"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>
            AI Summary
          </div>
          <div class="ai-insight-content">${parseMarkdown(visit.ai_summary)}</div>
        </div>
      ` : ''}
    </div>
  `;
}

// ======================
// SALES FUNNEL VIEW
// ======================

async function renderSalesFunnelView() {
  const { data: visits, error } = await supabaseClient
    .from('visits')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false });

  if (error) {
    viewContainer.innerHTML = renderError(error.message);
    return;
  }

  const funnelStages = {
    new_lead: { title: 'New Leads', visits: [], color: '#3b82f6' },
    follow_up: { title: 'Follow-ups', visits: [], color: '#8b5cf6' },
    demo: { title: 'Product Demos', visits: [], color: '#f59e0b' },
    closing: { title: 'Closing', visits: [], color: '#10b981' },
    support: { title: 'Customer Support', visits: [], color: '#6b7280' }
  };

  visits.forEach(visit => {
    const type = visit.visit_type || 'new_lead';
    if (funnelStages[type]) {
      funnelStages[type].visits.push(visit);
    }
  });

  const totalVisits = visits.length;

  let html = `
    <div class="page-header">
      <h1 class="page-title">Sales Funnel</h1>
      <p class="page-subtitle">Track your leads through the pipeline</p>
    </div>

    <div class="funnel-container">
  `;

  Object.entries(funnelStages).forEach(([key, stage]) => {
    const count = stage.visits.length;
    const percentage = totalVisits > 0 ? (count / totalVisits * 100) : 0;

    html += `
      <div class="funnel-stage">
        <div class="funnel-stage-header">
          <span class="funnel-stage-title" style="color: ${stage.color}">${stage.title}</span>
          <span class="funnel-stage-count">${count}</span>
        </div>
        <div class="funnel-stage-bar">
          <div class="funnel-stage-progress" style="width: ${percentage}%; background: ${stage.color}"></div>
        </div>
      </div>
    `;
  });

  html += `</div>`;

  // High priority leads
  const highPriorityLeads = visits.filter(v => v.lead_score && v.lead_score >= 70).slice(0, 5);

  html += `
    <div class="card mt-3">
      <div class="card-header">
        <h3 class="card-title"><i class="fas fa-star text-warning"></i> High-Priority Leads</h3>
      </div>
  `;

  if (highPriorityLeads.length > 0) {
    highPriorityLeads.forEach(visit => {
      html += `
        <div class="flex items-center justify-between" style="padding: 0.75rem 0; border-bottom: 1px solid var(--border-color);">
          <div>
            <strong>${visit.company_name}</strong>
            ${visit.contact_name ? `<br><span class="text-muted">${visit.contact_name}</span>` : ''}
          </div>
          ${getLeadScoreBadge(visit.lead_score)}
        </div>
      `;
    });
  } else {
    html += `<p class="text-muted">No high-priority leads yet</p>`;
  }

  html += `</div>`;

  viewContainer.innerHTML = html;
}

// ======================
// OPPORTUNITY PIPELINE VIEW
// ======================

// ======================
// OPPORTUNITY PIPELINE VIEW (Updated)
// ======================

async function renderOpportunityPipelineView() {
  let opportunities;
  let error;

  if (isManager) {
    // Managers can see all opportunities with user info
    const result = await supabaseClient
      .from('opportunities')
      .select(`
        *,
        profiles!inner(
          id,
          first_name,
          last_name,
          email,
          role
        )
      `)
      .order('created_at', { ascending: false });

    opportunities = result.data;
    error = result.error;
  } else {
    // Sales reps only see their own opportunities
    const result = await supabaseClient
      .from('opportunities')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false });

    opportunities = result.data;
    error = result.error;
  }

  if (error) {
    viewContainer.innerHTML = renderError(error.message);
    return;
  }

  // Define pipeline stages - simplified to 4 columns as requested
  const pipelineStages = [
    { id: 'prospecting', title: 'Discovery', color: '#6b7280' },
    { id: 'qualification', title: 'In Progress', color: '#3b82f6' },
    { id: 'closed-won', title: 'Won/Invoiced 🎉', color: '#10b981' },
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

  // Calculate pipeline summary
  const totalValue = opportunities.reduce((sum, opp) => sum + parseFloat(opp.value || 0), 0);
  const avgProbability = opportunities.length > 0
    ? opportunities.reduce((sum, opp) => sum + parseInt(opp.probability || 0), 0) / opportunities.length
    : 0;
  const wonValue = opportunitiesByStage['closed-won'].totalValue;
  const lostValue = opportunitiesByStage['closed-lost'].totalValue;
  const activeValue = totalValue - wonValue - lostValue;

  let html = `
    <div class="page-header">
      <h1 class="page-title">Opportunity Pipeline</h1>
      <p class="page-subtitle">
        ${opportunities.length} ${isManager ? 'total' : 'active'} opportunities
        ${isManager ? '<span class="text-muted"> (Team View)</span>' : ''}
      </p>
    </div>

    <div class="pipeline-summary">
      <div class="pipeline-summary-card">
        <div class="pipeline-summary-title">Total Pipeline Value</div>
        <div class="pipeline-summary-value">Ksh ${totalValue.toLocaleString()}</div>
        <div class="pipeline-summary-change">
          <i class="fas fa-arrow-up"></i> 12% from last month
        </div>
      </div>
      <div class="pipeline-summary-card">
        <div class="pipeline-summary-title">Active Opportunities</div>
        <div class="pipeline-summary-value">${opportunities.filter(opp => opp.mappedStage !== 'closed-won' && opp.mappedStage !== 'closed-lost').length}</div>
        <div class="pipeline-summary-change">
          <i class="fas fa-arrow-up"></i> 3 new this week
        </div>
      </div>
      <div class="pipeline-summary-card">
        <div class="pipeline-summary-title">Avg. Win Probability</div>
        <div class="pipeline-summary-value">${Math.round(avgProbability)}%</div>
        <div class="pipeline-summary-change negative">
          <i class="fas fa-arrow-down"></i> 5% from last month
        </div>
      </div>
      <div class="pipeline-summary-card">
        <div class="pipeline-summary-title">Won This Month</div>
        <div class="pipeline-summary-value">Ksh ${wonValue.toLocaleString()}</div>
        <div class="pipeline-summary-change">
          <i class="fas fa-arrow-up"></i> 8% from last month
        </div>
      </div>
    </div>

    <div class="pipeline-header">
      <div class="pipeline-filters">
        <button class="pipeline-filter active" data-filter="all">All Opportunities</button>
        <button class="pipeline-filter" data-filter="high-value">High Value (Ksh 100k+)</button>
        <button class="pipeline-filter" data-filter="high-probability">High Probability (70%+)</button>
        <button class="pipeline-filter" data-filter="next-step-due">Next Step Due</button>
        ${isManager ? `
          <button class="pipeline-filter" data-filter="my-reps">My Only</button>
        ` : ''}
      </div>
      <button class="btn btn-primary" id="add-opportunity-btn">
        <i class="fas fa-plus"></i> New 
      </button>
    </div>

    <div class="pipeline-stages">
  `;

  // Render pipeline stages
  pipelineStages.forEach(stage => {
    const stageData = opportunitiesByStage[stage.id];
    html += `
      <div class="pipeline-stage" data-stage="${stage.id}">
        <div class="pipeline-stage-header">
          <div class="pipeline-stage-title">${stage.title}</div>
          <div class="pipeline-stage-count">${stageData.opportunities.length}</div>
        </div>
        <div class="pipeline-stage-value">Ksh ${stageData.totalValue.toLocaleString()}</div>
        <div class="opportunity-list" id="opportunities-${stage.id}">
    `;

    // Render opportunities in this stage
    stageData.opportunities.forEach(opp => {
      const isOverdue = opp.next_step_date && new Date(opp.next_step_date) < new Date();
      const competitors = opp.competitors ? JSON.parse(opp.competitors) : [];
      const isOwnOpportunity = !isManager || opp.user_id === currentUser.id;

      // Get user info from joined data
      const user = opp.profiles;
      const ownerName = user ? `${user.first_name} ${user.last_name}` : 'Unknown';

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
            data-user-id="${opp.user_id}"
            draggable="${isOwnOpportunity}">
          <div class="opportunity-company">${opp.company_name}</div>
          <div class="opportunity-name">${opp.name}</div>
          ${isManager && user ? `
            <div class="opportunity-owner">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-user-icon lucide-user"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> ${ownerName}
            </div>
          ` : ''}
          <div class="opportunity-value">Ksh ${parseFloat(opp.value || 0).toLocaleString()}</div>
          
          <div class="opportunity-probability">
            <div class="probability-bar">
              <div class="probability-fill" style="width: ${opp.probability || 0}%; background-color: ${getProbabilityColor(opp.probability || 0)}"></div>
            </div>
            <div class="probability-text">${opp.probability || 0}%</div>
          </div>
          
          ${opp.next_step ? `
            <div class="opportunity-next-step ${isOverdue ? 'overdue' : ''}">
              <i class="fas fa-clock"></i>
              <span>${opp.next_step}</span>
              ${opp.next_step_date ? `<span> (${formatDate(opp.next_step_date)})</span>` : ''}
            </div>
          ` : ''}
          
          ${competitors.length > 0 ? `
            <div class="opportunity-competitors">
              ${competitors.slice(0, 2).map(comp => `
                <span class="competitor-tag">${comp}</span>
              `).join('')}
              ${competitors.length > 2 ? `<span class="competitor-tag">+${competitors.length - 2} more</span>` : ''}
            </div>
          ` : ''}
          
          ${opp.notes ? `
            <div class="opportunity-notes" style="overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">
              ${processedNotes.substring(0, 150)}${processedNotes.length > 150 ? '...' : ''}
            </div>
          ` : ''}
          
          <div class="opportunity-actions">
            <div class="opportunity-date">${formatDate(opp.created_at)}</div>
            <div class="opportunity-menu">
              ${isOwnOpportunity ? `
                <button class="opportunity-action-btn edit-opportunity" data-id="${opp.id}">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-square-pen-icon lucide-square-pen"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/></svg>
                </button>
                <button class="opportunity-action-btn delete-opportunity" data-id="${opp.id}">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-icon lucide-trash"><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
              ` : `
                <button class="opportunity-action-btn view-opportunity" data-id="${opp.id}">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-eye-icon lucide-eye"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>
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

  // Initialize drag and drop with a small delay to ensure DOM is ready
  setTimeout(() => {
    initPipelineDragAndDrop();
    initOpportunityEventListeners(opportunities);
    initPipelineFilters();
  }, 100);
}

function initOpportunityEventListeners(opportunities) {
  // Add opportunity button
  document.getElementById('add-opportunity-btn')?.addEventListener('click', () => {
    openOpportunityModal();
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
        const isOwnOpportunity = !isManager || opportunity.user_id === currentUser.id;
        openOpportunityModal(opportunity, !isOwnOpportunity); // read-only if not own opportunity
      }
    });
  });

  // Click on opportunity card to view details
  document.querySelectorAll('.opportunity-card').forEach(card => {
    card.addEventListener('click', () => {
      const opportunityId = card.dataset.id;
      const opportunity = opportunities.find(opp => opp.id === opportunityId);
      if (opportunity) {
        const isOwnOpportunity = !isManager || opportunity.user_id === currentUser.id;
        openOpportunityModal(opportunity, !isOwnOpportunity); // read-only if not own opportunity
      }
    });
  });
}


function initPipelineDragAndDrop() {
  const opportunityLists = document.querySelectorAll('.opportunity-list');

  if (typeof Sortable === 'undefined') {
    console.error('Sortable.js library is not loaded!');
    showToast('Drag-and-drop functionality requires Sortable.js library', 'error');
    return;
  }

  opportunityLists.forEach(list => {
    new Sortable(list, {
      group: 'pipeline',
      animation: 150,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      filter: '.readonly, .opportunity-actions', // Prevent dragging readonly cards or action buttons
      onStart: function (evt) {
        evt.item.classList.add('dragging');
      },
      onEnd: function (evt) {
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

            showToast('Opportunity moved successfully', 'success');

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
      const valueText = card.querySelector('.opportunity-value')?.textContent;
      if (valueText) {
        totalValue += parseCurrencyValue(valueText);
      }
    });

    const valueElement = stage.querySelector('.pipeline-stage-value');
    if (valueElement) {
      valueElement.textContent = `Ksh ${totalValue.toLocaleString()}`;
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
  let totalProbability = 0;
  let activeCount = 0;

  visibleCards.forEach(card => {
    const valueText = card.querySelector('.opportunity-value')?.textContent;
    const value = parseCurrencyValue(valueText);
    totalValue += value;

    const probText = card.querySelector('.probability-text')?.textContent;
    const probability = parseInt(probText?.replace('%', '') || 0);
    totalProbability += probability;

    const stageId = card.closest('.pipeline-stage')?.dataset.stage;
    if (stageId === 'closed-won') {
      wonValue += value;
    } else if (stageId !== 'closed-lost') {
      activeCount++;
    }
  });

  const avgProbability = visibleCards.length > 0 ? Math.round(totalProbability / visibleCards.length) : 0;

  // Update DOM elements
  const summaryValues = document.querySelectorAll('.pipeline-summary-value');
  if (summaryValues.length >= 4) {
    summaryValues[0].textContent = `Ksh ${totalValue.toLocaleString()}`;
    summaryValues[1].textContent = activeCount;
    summaryValues[2].textContent = `${avgProbability}%`;
    summaryValues[3].textContent = `Ksh ${wonValue.toLocaleString()}`;
  }
}

function initOpportunityEventListeners(opportunities) {
  // Add opportunity button
  document.getElementById('add-opportunity-btn')?.addEventListener('click', () => {
    openOpportunityModal();
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

  // View opportunity buttons (for managers viewing others' opportunities)
  document.querySelectorAll('.view-opportunity').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const opportunityId = btn.dataset.id;
      const opportunity = opportunities.find(opp => opp.id === opportunityId);
      if (opportunity) {
        const isOwnOpportunity = !isManager || opportunity.user_id === currentUser.id;
        openOpportunityModal(opportunity, !isOwnOpportunity); // read-only if not own opportunity
      }
    });
  });

  // Delete opportunity buttons
  document.querySelectorAll('.delete-opportunity').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const opportunityId = btn.dataset.id;

      const confirmed = await showConfirmDialog(
        'Delete Opportunity',
        'Are you sure you want to delete this opportunity?'
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

  // Click on opportunity card to view details
  document.querySelectorAll('.opportunity-card').forEach(card => {
    card.addEventListener('click', () => {
      const opportunityId = card.dataset.id;
      const opportunity = opportunities.find(opp => opp.id === opportunityId);
      if (opportunity) {
        const isOwnOpportunity = !isManager || opportunity.user_id === currentUser.id;
        openOpportunityModal(opportunity, !isOwnOpportunity); // read-only if not own opportunity
      }
    });
  });
}

function initPipelineFilters() {
  const filterButtons = document.querySelectorAll('.pipeline-filter');

  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      // Update active state
      filterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const filter = btn.dataset.filter;

      // Apply filter
      document.querySelectorAll('.opportunity-card').forEach(card => {
        let show = true;

        if (filter === 'my-reps') {
          // Only show opportunities of sales reps (not managers)
          const userId = card.dataset.userId;
          const opportunity = opportunities.find(opp => opp.id === card.dataset.id);
          show = opportunity && opportunity.user && opportunity.user.role === 'sales_rep';
        } else if (filter === 'high-value') {
          const valueText = card.querySelector('.opportunity-value').textContent;
          const value = parseCurrencyValue(valueText);
          show = value >= 100000;
        } else if (filter === 'high-probability') {
          const probText = card.querySelector('.probability-text').textContent;
          const probability = parseInt(probText.replace('%', ''));
          show = probability >= 70;
        } else if (filter === 'next-step-due') {
          show = !!card.querySelector('.opportunity-next-step');
        }

        card.style.display = show ? 'block' : 'none';
      });

      // Update counts and summary after filtering
      updatePipelineStageCounts();
    });
  });
}

function openOpportunityModal(opportunity = null, readOnly = false) {
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
  document.getElementById('opportunity-notes').value = '';

  // Clear competitors
  document.getElementById('competitors-container').innerHTML = '<input type="text" class="competitors-input" id="competitors-input" placeholder="Add competitor...">';

  // Reset mentioned people
  mentionedPeople = opportunity && opportunity.mentioned_people ? [...opportunity.mentioned_people] : [];

  // Set modal title
  if (opportunity) {
    modalTitle.innerHTML = readOnly
      ? `${opportunity.name}`
      : `Edit Opportunity`;

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

    // Set read-only mode if needed
    if (readOnly) {
      document.querySelectorAll('#opportunity-modal input, #opportunity-modal select, #opportunity-modal textarea').forEach(el => {
        el.disabled = true;
      });
      saveBtn.style.display = 'none';
    } else {
      document.querySelectorAll('#opportunity-modal input, #opportunity-modal select, #opportunity-modal textarea').forEach(el => {
        el.disabled = false;
      });
      saveBtn.style.display = 'block';
    }
  } else {
    modalTitle.innerHTML = 'New Opportunity';
    document.querySelectorAll('#opportunity-modal input, #opportunity-modal select, #opportunity-modal textarea').forEach(el => {
      el.disabled = false;
    });
    saveBtn.style.display = 'block';
  }

  // Show modal
  modal.style.display = 'flex';

  // Initialize event listeners
  initOpportunityModalListeners(opportunity);
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
      // Fetch companies for company search
      const { data: companies } = await supabaseClient
        .from('companies')
        .select('*')
        .ilike('name', `%${query}%`)
        .limit(5);

      if (companies.length === 0) {
        companySearchResults.innerHTML = '<div class="search-result-item">No companies found</div>';
      } else {
        companySearchResults.innerHTML = companies.map(company => `
          <div class="search-result-item" onclick="selectOpportunityCompany('${company.name}')">
            <div class="search-result-icon"></div>
            <div>
              <div class="search-result-name">${company.name}</div>
              <div class="search-result-role">${company.description || 'No description'}</div>
            </div>
          </div>
        `).join('');
      }

      companySearchResults.style.display = 'block';
    }, 300);
  });

  // Initialize mention system for notes
  const notesEl = document.getElementById('opportunity-notes');
  const mentionSuggestionsContainer = document.getElementById('opportunity-mention-suggestions');



  let mentionStartIndex = -1;
  let currentMentionQuery = '';
  let lastMentionStartIndex = -1;

  // Input event - detect @ and show suggestions
  const newNotesEl = notesEl.cloneNode(true);
  notesEl.parentNode.replaceChild(newNotesEl, notesEl);

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
        user_id: currentUser.id,
        name,
        company_name: companyName,
        value,
        probability,
        stage,
        next_step: nextStep || null,
        next_step_date: nextStepDate || null,
        notes: notes || null,
        competitors: competitors.length > 0 ? JSON.stringify(competitors) : null,
        mentioned_people: mentionedPeople
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
  // In a real implementation, this would set up a notification system
  // For now, we'll just store reminder in localStorage
  const reminders = JSON.parse(localStorage.getItem('opportunityReminders') || '[]');

  reminders.push({
    opportunityName,
    nextStep,
    dueDate,
    acknowledged: false
  });

  localStorage.setItem('opportunityReminders', JSON.stringify(reminders));

  // Check if reminder is due today
  const today = new Date().toISOString().split('T')[0];
  if (dueDate === today) {
    showToast(`Reminder: ${nextStep} for ${opportunityName} is due today!`, 'info');
  }
}

function checkDueReminders() {
  // Check for due reminders on app load
  const reminders = JSON.parse(localStorage.getItem('opportunityReminders') || '[]');
  const today = new Date().toISOString().split('T')[0];

  reminders.forEach(reminder => {
    if (!reminder.acknowledged && reminder.dueDate === today) {
      showToast(`Reminder: ${reminder.nextStep} for ${reminder.opportunityName} is due today!`, 'info');
      reminder.acknowledged = true;
    }
  });

  localStorage.setItem('opportunityReminders', JSON.stringify(reminders));
}

// ======================
// TEAM DASHBOARD VIEW
// ======================

async function renderTeamDashboardView() {


  // First, try to get all profiles separately to ensure we have access
  const { data: allProfiles, error: profilesError } = await supabaseClient
    .from('profiles')
    .select('*')
    .order('first_name', { ascending: true });

  if (profilesError) {
    viewContainer.innerHTML = renderError('Unable to load team data. Please check your permissions: ' + profilesError.message);
    return;
  }

  // Then get visits
  const [visitsResult] = await Promise.all([
    supabaseClient
      .from('visits')
      .select('*')
      .order('created_at', { ascending: false })
  ]);

  const { data: visits, error: visitsError } = visitsResult;

  if (visitsError) {
    viewContainer.innerHTML = renderError(visitsError.message);
    return;
  }

  // Manually join visits with profiles
  const visitsWithProfiles = visits.map(visit => {
    const userProfile = allProfiles.find(p => p.id === visit.user_id);
    return {
      ...visit,
      user: userProfile || { id: visit.user_id, first_name: 'Unknown', last_name: 'User', email: '', role: 'sales_rep' }
    };
  });

  // Group visits by user - include all profiles even if they have no visits
  const users = {};

  // First, initialize all profiles
  allProfiles.forEach(profile => {
    if (profile.role === 'sales_rep') {
      users[profile.id] = {
        ...profile,
        visits: []
      };
    }
  });

  // Then add visits to each user
  visitsWithProfiles.forEach(visit => {
    const userId = visit.user_id;
    if (users[userId]) {
      users[userId].visits.push(visit);
    }
  });

  const salesReps = Object.values(users);
  const totalVisits = visitsWithProfiles.length;
  const totalReps = salesReps.length;
  const avgVisitsPerRep = totalReps > 0 ? (totalVisits / totalReps).toFixed(1) : 0;

  const todayVisits = visitsWithProfiles.filter(v => {
    const visitDate = new Date(v.created_at).toDateString();
    return visitDate === new Date().toDateString();
  }).length;

  const avgLeadScore = visitsWithProfiles.filter(v => v.lead_score).length > 0
    ? (visitsWithProfiles.reduce((sum, v) => sum + (v.lead_score || 0), 0) / visitsWithProfiles.filter(v => v.lead_score).length).toFixed(0)
    : 0;

  let html = `
    <div class="page-header flex justify-between items-center">
      <div>
        <h1 class="page-title">Team Dashboard</h1>
        <p class="page-subtitle">Monitor team performance</p>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${totalVisits}</div>
        <div class="stat-label">Total Visits</div>
      </div>
      <div class="stat-card success">
        <div class="stat-value">${totalReps}</div>
        <div class="stat-label">Sales Reps</div>
      </div>
      <div class="stat-card warning">
        <div class="stat-value">${todayVisits}</div>
        <div class="stat-label">Today</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${avgLeadScore}%</div>
        <div class="stat-label">Avg Lead Score</div>
      </div>
    </div>

    <!-- Selected Rep's Visits -->
    <div id="selected-rep-visits" style="display: none;">
      <div class="card">
        <div class="card-header">
          <h3 class="card-title" id="rep-visits-title">Rep Visits</h3>
          <button class="btn btn-ghost btn-sm" id="clear-rep-filter">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x-icon lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg> Clear
          </button>
        </div>
        <div id="rep-visits-container"></div>
      </div>
    </div>

    <!-- Performance Chart -->
    <div class="chart-container">
      <canvas id="performanceChart"></canvas>
    </div>

    <!-- Search for Sales Rep -->
    <div class="card">
      <div class="search-container">
        <i class="fas fa-search"></i>
        <input type="text" id="rep-search-input" placeholder="Search for a sales rep...">
        <div id="rep-search-results" class="search-results" style="display: none;"></div>
      </div>
    </div>

    <!-- Recent Team Visits -->
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Recent Team Activity</h3>
      </div>
      <div id="team-visits-container"></div>
    </div>
  `;

  viewContainer.innerHTML = html;

  // Initialize search
  initRepSearch(salesReps, users);

  // Render recent visits
  renderTeamVisits(visitsWithProfiles.slice(0, 10));

  // Initialize chart
  setTimeout(() => initPerformanceChart(salesReps), 100);
}

function initRepSearch(salesReps, users) {
  const searchInput = document.getElementById('rep-search-input');
  const searchResults = document.getElementById('rep-search-results');
  const selectedRepVisits = document.getElementById('selected-rep-visits');
  const clearBtn = document.getElementById('clear-rep-filter');

  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();

    if (query.length === 0) {
      searchResults.style.display = 'none';
      return;
    }

    const filtered = salesReps.filter(rep =>
      rep.first_name?.toLowerCase().includes(query) ||
      rep.last_name?.toLowerCase().includes(query) ||
      rep.email?.toLowerCase().includes(query)
    );

    if (filtered.length === 0) {
      searchResults.innerHTML = '<div class="search-result-item">No results found</div>';
    } else {
      searchResults.innerHTML = filtered.map(rep => `
        <div class="search-result-item" onclick="selectRep('${rep.id}')">
          <div class="search-result-avatar">${getInitials(rep.first_name + ' ' + rep.last_name)}</div>
          <div>
            <div class="search-result-name">${rep.first_name} ${rep.last_name}</div>
            <div class="search-result-role">${rep.email}</div>
          </div>
        </div>
      `).join('');
    }

    searchResults.style.display = 'block';
  });

  // Store for global access
  window.salesRepsData = { salesReps, users };

  clearBtn.addEventListener('click', () => {
    selectedRepVisits.style.display = 'none';
    selectedRepId = null;
  });
}

window.selectRep = function (repId) {
  const { salesReps, users } = window.salesRepsData;
  const rep = salesReps.find(r => r.id === repId);
  if (!rep) return;

  const repVisits = users[repId]?.visits || [];

  document.getElementById('rep-visits-title').textContent =
    `${rep.first_name} ${rep.last_name}'s Visits (${repVisits.length})`;

  const container = document.getElementById('rep-visits-container');
  if (repVisits.length === 0) {
    container.innerHTML = '<p class="text-muted text-center" style="padding: 2rem;">No visits logged yet</p>';
  } else {
    container.innerHTML = repVisits.map(visit => renderVisitCard(visit)).join('');
  }

  document.getElementById('selected-rep-visits').style.display = 'block';
  document.getElementById('rep-search-results').style.display = 'none';
  document.getElementById('rep-search-input').value = '';
  selectedRepId = repId;
};

function renderTeamVisits(visits) {
  const container = document.getElementById('team-visits-container');
  if (visits.length === 0) {
    container.innerHTML = '<p class="text-muted text-center" style="padding: 2rem;">No visits yet</p>';
  } else {
    container.innerHTML = visits.map(visit => renderVisitCard(visit, true)).join('');
  }
}

function initPerformanceChart(users) {
  const canvas = document.getElementById('performanceChart');
  if (!canvas) return;

  if (chartInstances['performanceChart']) {
    chartInstances['performanceChart'].destroy();
  }

  const ctx = canvas.getContext('2d');
  const labels = users.map(u => `${u.first_name} ${u.last_name?.charAt(0) || ''}.`);
  const data = users.map(u => u.visits.length);

  chartInstances['performanceChart'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Total Visits',
        data: data,
        backgroundColor: '#4f46e5',
        borderRadius: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { precision: 0 }
        }
      }
    }
  });
}

// ======================
// USER MANAGEMENT VIEW
// ======================

async function renderUserManagementView() {
  const { data: users, error } = await supabaseClient
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    viewContainer.innerHTML = renderError(error.message);
    return;
  }

  let html = `
    <div class="page-header">
      <h1 class="page-title">User Management</h1>
      <p class="page-subtitle">${users.length} team members</p>
    </div>
  `;

  users.forEach(user => {
    const initials = getInitials(`${user.first_name} ${user.last_name}`);
    const isCurrentUser = user.id === currentUser.id;

    html += `
      <div class="card" style="display: flex; align-items: center; gap: 1rem; padding: 1rem;">
        <div class="user-avatar" style="width: 48px; height: 48px; font-size: 1rem;">${initials}</div>
        <div style="flex: 1;">
          <div style="font-weight: 600;">${user.first_name} ${user.last_name}</div>
          <div class="text-muted" style="font-size: 0.875rem;">${user.email}</div>
        </div>
        <span class="tag ${user.role === 'manager' ? '' : 'text-muted'}" style="background: ${user.role === 'manager' ? 'var(--color-primary-bg)' : 'var(--bg-tertiary)'};">
          ${user.role === 'manager' ? 'Manager' : user.role === 'technician' ? 'Technician' : user.role === 'sales_rep' ? 'Sales Rep' : (user.role || '')}
        </span>
        ${!isCurrentUser ? `
          <button class="btn btn-ghost btn-sm" onclick="deleteUser('${user.id}', '${user.first_name} ${user.last_name}')">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-icon lucide-trash"><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        ` : ''}
      </div>
    `;
  });

  viewContainer.innerHTML = html;
}

window.deleteUser = async function (userId, userName) {
  const confirmed = await showConfirmDialog(
    'Delete User',
    `Are you sure you want to delete ${userName}?`
  );

  if (!confirmed) return;

  const { error } = await supabaseClient.from('profiles').delete().eq('id', userId);

  if (error) {
    showToast('Failed to delete user: ' + error.message, 'error');
    return;
  }

  showToast('User deleted successfully', 'success');
  renderUserManagementView();
};

// ======================
// ROUTE PLANNING VIEW
// ======================

async function renderRoutePlanningView() {
  // Fetch existing routes and companies
  const [routesResult, companiesResult, profilesResult] = await Promise.all([
    supabaseClient
      .from('routes')
      // FIX: Specify relationship to avoid ambiguity
      .select(`*, assigned_to:profiles!routes_assigned_to_fkey(first_name, last_name)`)
      .eq('created_by', currentUser.id)
      .order('created_at', { ascending: false }),
    supabaseClient
      .from('companies')
      .select('*')
      .order('name', { ascending: true }),
    supabaseClient
      .from('profiles')
      .select('*')
      .eq('role', 'sales_rep')
      .order('first_name', { ascending: true })
  ]);

  const { data: routes, error: routesError } = routesResult;
  const { data: companies, error: companiesError } = companiesResult;
  const { data: salesReps, error: profilesError } = profilesResult;

  if (routesError || companiesError || profilesError) {
    // Log specific errors to console for debugging
    if (routesError) console.error('Routes Error:', routesError);
    if (companiesError) console.error('Companies Error:', companiesError);
    if (profilesError) console.error('Profiles Error:', profilesError);

    viewContainer.innerHTML = renderError('Error loading data');
    return;
  }

  let html = `
    <div class="page-header">
      <h1 class="page-title">Route Planning</h1>
      <p class="page-subtitle">Create and manage routes for your team</p>
    </div>

    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Create New Route</h3>
        <button class="btn btn-primary" id="create-route-btn">
          <i class="fas fa-plus"></i> Create
        </button>
      </div>
      
      <div id="route-creator" style="display: none;">
        <div class="form-field">
          <label for="route-name">Route Name</label>
          <input type="text" id="route-name" placeholder="e.g., Downtown Client Route">
        </div>
        
        <div class="form-field">
          <label for="route-rep">Assign to Sales Reps</label>
          <div class="multi-select-container">
            <div class="multi-select-display empty" id="rep-multi-select">
              <span>Select sales reps...</span>
            </div>
            <div class="multi-select-dropdown" id="rep-dropdown">
              ${salesReps.map(rep => `
                <div class="multi-select-option" data-id="${rep.id}">
                  <input type="checkbox" id="rep-${rep.id}" value="${rep.id}">
                  <label for="rep-${rep.id}">${rep.first_name} ${rep.last_name}</label>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
        
        <div class="form-field">
          <label>Search Companies</label>
          <div class="location-search-container">
            <input type="text" id="location-search" placeholder="Search for companies by name or address...">
          </div>
        </div>
        
        <div class="form-field">
          <label>Select Companies</label>
          <div id="locations-selector" class="locations-grid">
            ${companies.map(loc => `
              <div class="location-card" data-id="${loc.id}" data-lat="${loc.latitude}" data-lng="${loc.longitude}">
                <div class="location-checkbox">
                  <input type="checkbox" id="loc-${loc.id}" value="${loc.id}">
                  <label for="loc-${loc.id}"></label>
                </div>
                <div class="location-info">
                  <h4>${loc.name}</h4>
                  <p>${loc.description || 'No description'}</p>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        
        <div class="ai-recommendation" id="ai-recommendation" style="display: none;">
          <div class="ai-recommendation-header">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-bot-icon lucide-bot"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>
            AI Recommendation
          </div>
          <div class="ai-recommendation-content" id="ai-recommendation-content"></div>
        </div>
        
        <div class="form-field">
          <button id="optimize-route-btn" class="btn btn-secondary" disabled>
            Continue
          </button>
        </div>
        
        <div id="route-map" class="route-map" style="display: none;"></div>
        
        <div id="route-order" class="route-order" style="display: none;">
          <h4>Route Order</h4>
          <div id="sortable-route" class="sortable-container"></div>
        </div>
        
        <div class="form-field">
        <button id="save-route-btn" class="btn btn-primary" style="display: none;">
            Save Route
        </button>
        </div>

      </div>
    </div>

    <div class="card mt-3">
      <div class="card-header">
        <h3 class="card-title">Existing Routes</h3>
      </div>
      <div class="routes-list">
        ${routes.length === 0 ?
      '<p class="text-muted text-center" style="padding: 2rem;">No routes created yet</p>' :
      routes.map(route => `
            <div class="route-item" data-id="${route.id}">
              <div class="route-info">
                <h4>${route.name}</h4>
                <p>Assigned to: ${route.assigned_to ? `${route.assigned_to.first_name} ${route.assigned_to.last_name}` : 'Unassigned'}</p>
                <p>Created: ${formatDate(route.created_at)}</p>
                ${route.estimated_duration ? `<p>Est. duration: ${route.estimated_duration} min</p>` : ''}
              </div>
              <div class="route-actions">
                <button class="btn btn-sm btn-ghost view-route-btn" data-id="${route.id}">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-eye-icon lucide-eye"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>
                </button>
                <button class="btn btn-sm btn-ghost edit-route-btn" data-id="${route.id}">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-square-pen-icon lucide-square-pen"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/></svg>
                </button>
                <button class="btn btn-sm btn-ghost delete-route-btn" data-id="${route.id}">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-icon lucide-trash"><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
              </div>
            </div>
          `).join('')
    }
      </div>
    </div>
  `;

  viewContainer.innerHTML = html;

  // Initialize route creator functionality
  initRouteCreator(companies, salesReps);

  // Initialize route list functionality
  initRouteList();
}

function initRouteCreator(companies, salesReps) {
  const createBtn = document.getElementById('create-route-btn');
  const routeCreator = document.getElementById('route-creator');
  const optimizeBtn = document.getElementById('optimize-route-btn');
  const saveBtn = document.getElementById('save-route-btn');
  const routeMap = document.getElementById('route-map');
  const routeOrder = document.getElementById('route-order');
  const sortableRoute = document.getElementById('sortable-route');
  const locationSearch = document.getElementById('location-search');
  const aiRecommendation = document.getElementById('ai-recommendation');
  const aiRecommendationContent = document.getElementById('ai-recommendation-content');

  let selectedLocations = [];
  let optimizedRoute = [];
  let selectedReps = [];
  let map = null;
  let markers = [];
  let routeLine = null;

  // Store for global access
  window.allLocationsData = companies;

  // Show/hide route creator
  createBtn.addEventListener('click', () => {
    if (routeCreator.style.display === 'none') {
      routeCreator.style.display = 'block';
      createBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x-icon lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg> Cancel';
    } else {
      routeCreator.style.display = 'none';
      createBtn.innerHTML = '<i class="fas fa-plus"></i> Create';
      resetRouteCreator();
    }
  });

  // Initialize multi-select for reps
  const repMultiSelect = document.getElementById('rep-multi-select');
  const repDropdown = document.getElementById('rep-dropdown');

  repMultiSelect.addEventListener('click', () => {
    repDropdown.classList.toggle('show');
  });

  // Handle rep selection
  document.querySelectorAll('.multi-select-option input').forEach(checkbox => {
    checkbox.addEventListener('change', () => {
      const repId = checkbox.value;
      const repName = checkbox.nextElementSibling.textContent;

      if (checkbox.checked) {
        selectedReps.push({ id: repId, name: repName });
      } else {
        selectedReps = selectedReps.filter(rep => rep.id !== repId);
      }

      updateMultiSelectDisplay();
    });
  });

  function updateMultiSelectDisplay() {
    if (selectedReps.length === 0) {
      repMultiSelect.innerHTML = '<span>Select sales reps...</span>';
      repMultiSelect.classList.add('empty');
    } else {
      repMultiSelect.innerHTML = selectedReps.map(rep => `
        <span class="multi-select-tag">
          ${rep.name}
          <span class="remove" data-id="${rep.id}">×</span>
        </span>
      `).join('');
      repMultiSelect.classList.remove('empty');

      // Add event listeners to remove buttons
      repMultiSelect.querySelectorAll('.remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const repId = btn.getAttribute('data-id');
          document.querySelector(`#rep-${repId}`).checked = false;
          selectedReps = selectedReps.filter(rep => rep.id !== repId);
          updateMultiSelectDisplay();
        });
      });
    }
  }

  // Location search functionality
  locationSearch.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    const locationCards = document.querySelectorAll('.location-card');

    if (query.length === 0) {
      locationCards.forEach(card => {
        card.style.display = 'flex';
      });
      return;
    }

    locationCards.forEach(card => {
      const locationId = card.getAttribute('data-id');
      const location = companies.find(loc => loc.id === locationId);

      if (location && (
        location.name.toLowerCase().includes(query) ||
        (location.description && location.description.toLowerCase().includes(query))
      )) {
        card.style.display = 'flex';
      } else {
        card.style.display = 'none';
      }
    });
  });

  // Handle location selection
  document.querySelectorAll('.location-card input[type="checkbox"]').forEach(checkbox => {
    checkbox.addEventListener('change', () => {
      const locationId = checkbox.value;
      const locationCard = checkbox.closest('.location-card');
      const location = companies.find(loc => loc.id === locationId);

      if (checkbox.checked) {
        selectedLocations.push(location);
        locationCard.classList.add('selected');

        // Check if we should show a recommendation
        if (selectedLocations.length >= 1) {
          showNearestLocationRecommendation(selectedLocations);
        }
      } else {
        selectedLocations = selectedLocations.filter(loc => loc.id !== locationId);
        locationCard.classList.remove('selected');

        // Update recommendations
        if (selectedLocations.length >= 1) {
          showNearestLocationRecommendation(selectedLocations);
        } else {
          aiRecommendation.style.display = 'none';
        }
      }

      optimizeBtn.disabled = selectedLocations.length < 2;
    });
  });

  // Function to show nearest location recommendation
  function showNearestLocationRecommendation(selected) {
    if (selected.length === 0) {
      aiRecommendation.style.display = 'none';
      return;
    }

    // Get last selected location
    const lastSelected = selected[selected.length - 1];

    // Find nearest unselected location
    let nearestLocation = null;
    let shortestDistance = Infinity;

    companies.forEach(location => {
      // Skip if already selected
      if (selected.some(loc => loc.id === location.id)) return;

      // Calculate distance from last selected location
      const distance = calculateDistance(
        parseFloat(lastSelected.latitude),
        parseFloat(lastSelected.longitude),
        parseFloat(location.latitude),
        parseFloat(location.longitude)
      );

      if (distance < shortestDistance) {
        shortestDistance = distance;
        nearestLocation = location;
      }
    });

    if (nearestLocation) {
      // Show recommendation
      aiRecommendation.style.display = 'block';
      aiRecommendationContent.innerHTML = `
        <p>Based on your selection of <strong>${lastSelected.name}</strong>, nearest location is <strong>${nearestLocation.name}</strong> (${(shortestDistance / 1000).toFixed(2)} km away).</p>
        <button class="btn btn-sm btn-primary" onclick="selectRecommendedLocation('${nearestLocation.id}')">
          <i class="fas fa-plus"></i> Add it!
        </button>
      `;

      // Highlight recommended location
      document.querySelectorAll('.location-card').forEach(card => {
        card.classList.remove('recommended');
        if (card.getAttribute('data-id') === nearestLocation.id) {
          card.classList.add('recommended');
        }
      });
    } else {
      aiRecommendation.style.display = 'none';
    }
  }

  // Optimize route
  optimizeBtn.addEventListener('click', async () => {
    if (selectedLocations.length < 2) return;

    // Show loading state
    optimizeBtn.disabled = true;
    optimizeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Optimizing...';

    // Simple nearest neighbor algorithm for route optimization
    optimizedRoute = optimizeRoute(selectedLocations);

    // Display route on map
    displayRouteOnMap(optimizedRoute);

    // Show route order
    displayRouteOrder(optimizedRoute);

    // Show save button
    saveBtn.style.display = 'inline-flex';

    // Reset button state
    optimizeBtn.disabled = false;
    optimizeBtn.innerHTML = 'Continue';
  });

  // Save route
  saveBtn.addEventListener('click', async () => {
    const routeName = document.getElementById('route-name').value.trim();

    if (!routeName) {
      showToast('Please enter a route name', 'error');
      return;
    }

    if (selectedReps.length === 0) {
      showToast('Please select at least one sales rep', 'error');
      return;
    }

    if (selectedLocations.length === 0) {
      showToast('Please select at least one location', 'error');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

    try {
      // Calculate total distance and estimated duration
      let totalDistance = 0;
      for (let i = 0; i < optimizedRoute.length - 1; i++) {
        totalDistance += calculateDistance(
          optimizedRoute[i].latitude,
          optimizedRoute[i].longitude,
          optimizedRoute[i + 1].latitude,
          optimizedRoute[i + 1].longitude
        );
      }

      // Estimate duration (assuming average speed of 40 km/h in city)
      const estimatedDuration = Math.round((totalDistance / 1000 / 40) * 60);

      // Create route
      const { data: route, error: routeError } = await supabaseClient
        .from('routes')
        .insert([{
          name: routeName,
          created_by: currentUser.id,
          assigned_to: selectedReps[0].id, // Primary assignment
          estimated_duration: estimatedDuration,
          total_distance: Math.round(totalDistance)
        }])
        .select();

      if (routeError) throw routeError;

      // Check if route was created successfully
      if (!route || route.length === 0) {
        throw new Error('Route was created but no data was returned');
      }

      const newRouteId = route[0].id;

      // Create route locations
      const routeLocationsData = optimizedRoute.map((location, index) => ({
        route_id: newRouteId,
        company_id: location.id,
        position: index + 1
      }));

      const { error: locationsError } = await supabaseClient
        .from('route_locations')
        .insert(routeLocationsData);

      if (locationsError) throw locationsError;

      // Create route assignments for each selected rep
      const routeAssignments = selectedReps.map(rep => ({
        route_id: newRouteId,
        rep_id: rep.id,
        assigned_by: currentUser.id
      }));

      if (routeAssignments.length > 0) {
        const { error: assignmentsError } = await supabaseClient
          .from('route_assignments')
          .insert(routeAssignments);

        if (assignmentsError) throw assignmentsError;
      }

      showToast('Route created and assigned successfully!', 'success');
      renderRoutePlanningView(); // Refresh view
    } catch (error) {
      console.error('Error creating route:', error);
      showToast('Error creating route: ' + error.message, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = 'Save Route';
    }
  });

  function resetRouteCreator() {
    document.getElementById('route-name').value = '';
    document.querySelectorAll('.multi-select-option input').forEach(cb => {
      cb.checked = false;
    });
    selectedReps = [];
    updateMultiSelectDisplay();
    document.querySelectorAll('.location-card input[type="checkbox"]').forEach(cb => {
      cb.checked = false;
      cb.closest('.location-card').classList.remove('selected', 'recommended');
    });
    selectedLocations = [];
    optimizedRoute = [];
    optimizeBtn.disabled = true;
    saveBtn.style.display = 'none';
    routeMap.style.display = 'none';
    routeOrder.style.display = 'none';
    aiRecommendation.style.display = 'none';
  }

  function optimizeRoute(locations) {
    if (locations.length <= 1) return locations;

    // Simple nearest neighbor algorithm
    const route = [locations[0]];
    const remaining = [...locations.slice(1)];

    while (remaining.length > 0) {
      const current = route[route.length - 1];
      let nearestIndex = 0;
      let nearestDistance = Infinity;

      remaining.forEach((location, index) => {
        const distance = calculateDistance(
          current.latitude, current.longitude,
          location.latitude, location.longitude
        );

        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });

      route.push(remaining[nearestIndex]);
      remaining.splice(nearestIndex, 1);
    }

    return route;
  }

  function displayRouteOnMap(route) {
    routeMap.style.display = 'block';

    // Initialize map if not already done
    if (!map) {
      map = L.map('route-map').setView([route[0].latitude, route[0].longitude], 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
      }).addTo(map);
    } else {
      // Clear existing markers and route line
      markers.forEach(marker => map.removeLayer(marker));
      if (routeLine) map.removeLayer(routeLine);
      markers = [];
    }

    // Add markers for each location
    route.forEach((location, index) => {
      const marker = L.marker([location.latitude, location.longitude])
        .bindPopup(`<b>${index + 1}. ${location.name}</b><br>${location.description || 'No description'}`)
        .addTo(map);

      markers.push(marker);
    });

    // Draw route line
    const latlngs = route.map(loc => [loc.latitude, loc.longitude]);
    routeLine = L.polyline(latlngs, { color: '#4f46e5', weight: 4 }).addTo(map);

    // Fit map to show entire route
    const group = new L.featureGroup(markers);
    map.fitBounds(group.getBounds().pad(0.1));
  }

  function displayRouteOrder(route) {
    routeOrder.style.display = 'block';

    sortableRoute.innerHTML = route.map((location, index) => `
      <div class="sortable-item" data-id="${location.id}">
        <div class="sortable-handle">
          <i class="fas fa-grip-vertical"></i>
        </div>
        <div class="sortable-number">${index + 1}</div>
        <div class="sortable-content">
          <h4>${location.name}</h4>
          <p>${location.description || 'No description'}</p>
        </div>
      </div>
    `).join('');

    // Make list sortable
    new Sortable(sortableRoute, {
      handle: '.sortable-handle',
      animation: 150,
      onEnd: function (evt) {
        // Update optimizedRoute array based on new order
        const newOrder = Array.from(sortableRoute.children).map(item => {
          const locationId = item.getAttribute('data-id');
          return route.find(loc => loc.id === locationId);
        });

        optimizedRoute = newOrder;
        displayRouteOnMap(optimizedRoute);
      }
    });
  }
}

// Global function to select recommended location
window.selectRecommendedLocation = function (locationId) {
  const checkbox = document.querySelector(`#loc-${locationId}`);
  if (checkbox && !checkbox.checked) {
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
  }
};

function initRouteList() {
  // View route details
  document.querySelectorAll('.view-route-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const routeId = btn.dataset.id;
      await viewRouteDetails(routeId);
    });
  });

  // Edit route
  document.querySelectorAll('.edit-route-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const routeId = btn.dataset.id;
      await editRoute(routeId);
    });
  });

  // Delete route
  document.querySelectorAll('.delete-route-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const routeId = btn.dataset.id;
      const routeItem = btn.closest('.route-item');
      const routeName = routeItem.querySelector('h4').textContent;

      const confirmed = await showConfirmDialog(
        'Delete Route',
        `Are you sure you want to delete route "${routeName}"?`
      );

      if (!confirmed) return;

      try {
        const { error } = await supabaseClient
          .from('routes')
          .delete()
          .eq('id', routeId);

        if (error) throw error;

        showToast('Route deleted successfully', 'success');
        routeItem.remove();
      } catch (error) {
        showToast('Error deleting route: ' + error.message, 'error');
      }
    });
  });
}

// Updated viewRouteDetails function
// Replace the existing viewRouteDetails function with this updated version
async function viewRouteDetails(routeId) {
  const oldModal = document.getElementById('route-details-modal');
  if (oldModal) {
    oldModal.remove();
  }

  try {
    // Use the correct table name 'routes' instead of 'route_details'
    const { data: route, error: routeError } = await supabaseClient
      .from('routes')
      .select(`
        *,
        assigned_to_profile:profiles!routes_assigned_to_fkey(first_name, last_name),
        created_by_profile:profiles!routes_created_by_fkey(first_name, last_name)
      `)
      .eq('id', routeId)
      .single();

    if (routeError) throw routeError;

    // Use the correct table name 'route_locations' with a join to companies
    const { data: routeLocations, error: locationsError } = await supabaseClient
      .from('route_locations')
      .select(`
        *,
        companies(id, name, address, latitude, longitude)
      `)
      .eq('route_id', routeId)
      .order('position');

    if (locationsError) throw locationsError;

    // Create modal to show route details
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.id = 'route-details-modal';
    modal.innerHTML = `
      <div class="modal-backdrop" onclick="closeModal('route-details-modal')"></div>
      <div class="modal-container" style="max-width: 800px;">
        <div class="modal-header">
          <h3>${route.name}</h3>
          <button class="modal-close" onclick="closeModal('route-details-modal')">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x-icon lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="route-details">
            <div class="route-info">
              <p><strong>Assigned to:</strong> ${route.assigned_to_profile ? `${route.assigned_to_profile.first_name} ${route.assigned_to_profile.last_name}` : 'Unassigned'}</p>
              <p><strong>Created by:</strong> ${route.created_by_profile ? `${route.created_by_profile.first_name} ${route.created_by_profile.last_name}` : 'Unknown'}</p>
              <p><strong>Created:</strong> ${formatDate(route.created_at)}</p>
              ${route.estimated_duration ? `<p><strong>Est. duration:</strong> ${route.estimated_duration} min</p>` : ''}
              ${route.total_distance ? `<p><strong>Total distance:</strong> ${(route.total_distance / 1000).toFixed(2)} km</p>` : ''}
            </div>
            
            <div class="route-map" id="route-details-map" style="height: 300px; margin: 1rem 0;"></div>
            
            <h4>Route Stops</h4>
            <ol class="route-stops">
              ${routeLocations.map((stop, index) => `
                <li>
                  <strong>${stop.companies.name}</strong><br>
                  ${stop.companies.address || 'No address'}
                </li>
              `).join('')}
            </ol>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Initialize map with a delay to ensure DOM is ready
    setTimeout(() => {
      // Filter for valid locations with coordinates
      const validStops = routeLocations.filter(stop =>
        stop.companies &&
        stop.companies.latitude &&
        stop.companies.longitude &&
        !isNaN(stop.companies.latitude) &&
        !isNaN(stop.companies.longitude)
      );

      if (validStops.length > 0) {
        const map = L.map('route-details-map').setView(
          [validStops[0].companies.latitude, validStops[0].companies.longitude],
          13
        );

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap'
        }).addTo(map);

        // Add markers for each location
        const markers = validStops.map((stop, index) => {
          return L.marker([stop.companies.latitude, stop.companies.longitude])
            .bindPopup(`<b>${index + 1}. ${stop.companies.name}</b><br>${stop.companies.address || 'No address'}`)
            .addTo(map);
        });

        // Draw route line
        const latlngs = validStops.map(stop => [stop.companies.latitude, stop.companies.longitude]);
        L.polyline(latlngs, { color: '#4f46e5', weight: 4 }).addTo(map);

        // Fit map to show entire route
        const group = new L.featureGroup(markers);
        map.fitBounds(group.getBounds().pad(0.1));
      } else {
        const mapElement = document.getElementById('route-details-map');
        if (mapElement) {
          mapElement.innerHTML = '<div class="text-center" style="padding: 2rem;">No valid location data available for this route</div>';
        }
      }
    }, 100);
  } catch (error) {
    console.error('Error loading route details:', error);
    showToast('Error loading route details: ' + error.message, 'error');
  }
}

async function editRoute(routeId) {
  // Similar to viewRouteDetails but with editing capabilities
  // This would allow managers to modify route order or locations
  showToast('Edit route functionality to be implemented', 'info');
}

// ======================
// MY ROUTES VIEW
// ======================

async function renderMyRoutesView() {
  try {
    const { data: routes, error: routesError } = await supabaseClient
      .from('routes')
      .select('*')
      .eq('assigned_to', currentUser.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (routesError) throw routesError;

    let html = `
      <div class="page-header">
        <h1 class="page-title">My Routes</h1>
        <p class="page-subtitle">${routes.length} assigned routes</p>
      </div>
    `;

    let routeIds = [];
    let allRouteLocations = [];
    let companies = [];

    if (routes.length === 0) {
      html += `
        <div class="card">
          <div class="empty-state">
            <h3 class="empty-state-title">No routes assigned</h3>
            <p class="empty-state-description">
              Your manager will assign routes to you here.
            </p>
          </div>
        </div>
      `;
    } else {
      routeIds = routes.map(r => r.id);

      // Get route locations with more flexible approach
      try {
        const { data: routeLocationsData, error: locationsError } =
          await supabaseClient
            .from('route_locations')
            .select('*')
            .in('route_id', routeIds)
            .order('position');

        if (!locationsError) {
          allRouteLocations = routeLocationsData || [];
        }
      } catch (e) {
        console.error('Error fetching route locations:', e);
      }

      // Extract location IDs with more flexible approach
      const locationIds = allRouteLocations
        .map(rl => {
          // Try different possible column names
          return rl.location_id || rl.company_id || rl.stop_id || rl.point_id || rl.company;
        })
        .filter(Boolean); // Filter out null/undefined values

      if (locationIds.length > 0) {
        try {
          const { data: companiesData } = await supabaseClient
            .from('companies')
            .select('*')
            .in('id', locationIds);

          if (companiesData) companies = companiesData;
        } catch (e) {
          console.error('Error fetching companies:', e);
        }
      }

      for (const route of routes) {
        const routeLocations = allRouteLocations
          .filter(rl => rl.route_id === route.id)
          .sort((a, b) => a.position - b.position)
          .map(rl => {
            // Try different possible column names
            const locationId = rl.location_id || rl.company_id || rl.stop_id || rl.point_id || rl.company;

            const company = companies.find(c => c.id === locationId);

            // If no company found, create a placeholder with available data
            return {
              ...rl,
              company: company || {
                id: locationId,
                name: rl.name || 'Unknown Location',
                address: rl.address || 'No address',
                latitude: rl.latitude,
                longitude: rl.longitude
              }
            };
          });

        html += `
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">${route.name}</h3>
              <button class="btn btn-primary start-route-btn"
                      data-id="${route.id}">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-navigation2-icon lucide-navigation-2"><polygon points="12 2 19 21 12 17 5 21 12 2"/></svg>
                Start Route
              </button>
            </div>

            <div class="route-summary">
              <p><strong>Created:</strong> ${formatDate(route.created_at)}</p>
              ${route.estimated_duration
            ? `<p><strong>Est. duration:</strong> ${route.estimated_duration} min</p>`
            : ''
          }
              ${route.total_distance
            ? `<p><strong>Total distance:</strong> ${(route.total_distance / 1000).toFixed(2)} km</p>`
            : ''
          }
            </div>

            <div class="route-map"
                id="route-preview-${route.id}"
                style="height:200px;margin:1rem 0;"></div>

            <h4>Route Stops</h4>
            <ol class="route-stops">
              ${routeLocations
            .map(
              loc => `
                    <li>
                      <strong>${loc.company.name}</strong><br>
                      ${loc.company.address || 'No address'}
                    </li>
                  `
            )
            .join('')}
            </ol>
          </div>
        `;
      }
    }

    viewContainer.innerHTML = html;

    // Initialize map previews for routes with valid locations
    for (const route of routes) {
      const routeLocations = allRouteLocations
        .filter(rl => rl.route_id === route.id)
        .sort((a, b) => a.position - b.position)
        .map(rl => {
          // Try different possible column names
          const locationId = rl.location_id || rl.company_id || rl.stop_id || rl.point_id || rl.company;
          const company = companies.find(c => c.id === locationId);

          return {
            ...rl,
            company: company || {
              id: locationId,
              name: rl.name || 'Unknown Location',
              address: rl.address || 'No address',
              latitude: rl.latitude,
              longitude: rl.longitude
            }
          };
        });

      // Filter for valid locations with coordinates
      const validLocations = routeLocations.filter(loc =>
        loc.company &&
        loc.company.latitude &&
        loc.company.longitude &&
        !isNaN(loc.company.latitude) &&
        !isNaN(loc.company.longitude)
      );

      if (validLocations.length > 0) {
        setTimeout(() => {
          try {
            const map = L.map(`route-preview-${route.id}`).setView(
              [validLocations[0].company.latitude, validLocations[0].company.longitude],
              13
            );

            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
              attribution: '© OpenStreetMap'
            }).addTo(map);

            // Add markers for each location
            const markers = validLocations.map((location, index) => {
              return L.marker([location.company.latitude, location.company.longitude])
                .bindPopup(`<b>${index + 1}. ${location.company.name}</b><br>${location.company.address || 'No address'}`)
                .addTo(map);
            });

            // Draw route line
            const latlngs = validLocations.map(loc => [loc.company.latitude, loc.company.longitude]);
            L.polyline(latlngs, { color: '#4f46e5', weight: 4 }).addTo(map);

            // Fit map to show entire route
            const group = new L.featureGroup(markers);
            map.fitBounds(group.getBounds().pad(0.1));
          } catch (e) {
            console.error('Error initializing map for route', route.id, ':', e);
            const mapElement = document.getElementById(`route-preview-${route.id}`);
            if (mapElement) {
              mapElement.innerHTML = '<div class="text-center" style="padding: 2rem;">Map unavailable</div>';
            }
          }
        }, 100);
      } else {
        const mapElement = document.getElementById(`route-preview-${route.id}`);
        if (mapElement) {
          mapElement.innerHTML = '<div class="text-center" style="padding: 2rem;">No valid location data</div>';
        }
      }
    }

    document.querySelectorAll('.start-route-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        startRouteNavigation(btn.dataset.id);
      });
    });

  } catch (error) {
    console.error('Error rendering routes:', error);
    viewContainer.innerHTML = renderError(error.message);
  }
}

// ======================
// ROUTE NAVIGATION
// ======================

async function startRouteNavigation(routeId) {
  try {
    // Fetch route details
    const { data: route, error: routeError } = await supabaseClient
      .from('routes')
      .select('*')
      .eq('id', routeId)
      .single();

    if (routeError) {
      showToast('Error loading route: ' + routeError.message, 'error');
      return;
    }

    // Get route locations with more flexible approach
    let routeLocationsData = [];
    try {
      const { data: locations, error: locationsError } = await supabaseClient
        .from('route_locations')
        .select('*')
        .eq('route_id', routeId)
        .order('position');

      if (!locationsError) {
        routeLocationsData = locations || [];
      }
    } catch (e) {
      console.error('Error fetching route locations:', e);
    }

    // Get company details for each location
    const locationIds = routeLocationsData
      .map(rl => {
        // Try different possible column names
        return rl.location_id || rl.company_id || rl.stop_id || rl.point_id || rl.company;
      })
      .filter(Boolean);

    let companies = [];
    if (locationIds.length > 0) {
      try {
        const { data: companiesData } = await supabaseClient
          .from('companies')
          .select('*')
          .in('id', locationIds);

        if (companiesData) companies = companiesData;
      } catch (e) {
        console.error('Error fetching companies:', e);
      }
    }

    // Combine data
    const locations = routeLocationsData
      .sort((a, b) => a.position - b.position)
      .map(rl => {
        // Try different possible column names
        const locationId = rl.location_id || rl.company_id || rl.stop_id || rl.point_id || rl.company;
        const company = companies.find(c => c.id === locationId);

        // If no company found, create a placeholder with available data
        return {
          ...rl,
          company: company || {
            id: locationId,
            name: rl.name || 'Unknown Location',
            address: rl.address || 'No address',
            latitude: rl.latitude,
            longitude: rl.longitude
          }
        };
      });

    // Filter for valid locations with coordinates
    const validLocations = locations.filter(loc =>
      loc.company &&
      loc.company.name &&
      loc.company.latitude &&
      loc.company.longitude &&
      !isNaN(loc.company.latitude) &&
      !isNaN(loc.company.longitude)
    );

    if (validLocations.length === 0) {
      showToast('No valid locations found for this route', 'error');
      return;
    }

    // Create navigation view
    let html = `
      <div class="route-navigation">
        <div class="route-navigation-header">
          <button class="btn btn-ghost" onclick="loadView('my-routes')">
            <i class="fas fa-arrow-left"></i> Back
          </button>
          <h2>${route.name}</h2>
          <button class="btn btn-secondary" id="complete-route-btn">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-icon lucide-check"><path d="M20 6 9 17l-5-5"/></svg>
            Complete
          </button>
        </div>
        
        <div class="route-navigation-map" id="navigation-map"></div>
        
        <div class="route-navigation-info">
          <div class="current-stop" id="current-stop">
            <h3>Current Stop</h3>
            <div class="stop-info">
              <h4 id="current-stop-name">${validLocations[0].company.name}</h4>
              <p id="current-stop-address">${validLocations[0].company.address || 'No address'}</p>
              <div class="stop-actions">
                <button class="btn btn-primary" id="arrived-btn">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-icon lucide-check"><path d="M20 6 9 17l-5-5"/></svg>I've Arrived
                </button>
                <button class="btn btn-secondary" id="get-directions-btn">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-locate-icon lucide-locate"><line x1="2" x2="5" y1="12" y2="12"/><line x1="19" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="5"/><line x1="12" x2="12" y1="19" y2="22"/><circle cx="12" cy="12" r="7"/></svg>
                  Get Directions
                </button>
              </div>
            </div>
          </div>
          
          <div class="next-stops">
            <h3>Upcoming Stops</h3>
            <div class="stops-list" id="stops-list">
              ${validLocations.slice(1).map((location, index) => `
                <div class="stop-item" data-index="${index + 1}">
                  <div class="stop-number">${index + 2}</div>
                  <div class="stop-details">
                    <h4>${location.company.name}</h4>
                    <p>${location.company.address || 'No address'}</p>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    viewContainer.innerHTML = html;

    // Initialize navigation
    let currentStopIndex = 0;
    let map = null;
    let userMarker = null;
    let routeLine = null;
    let stopMarkers = [];

    // Initialize map with a delay to ensure DOM is ready
    setTimeout(() => {
      try {
        map = L.map('navigation-map').setView(
          [validLocations[0].company.latitude, validLocations[0].company.longitude],
          15
        );

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap'
        }).addTo(map);

        // Add markers for each location
        validLocations.forEach((location, index) => {
          const isCurrentStop = index === currentStopIndex;
          const isCompletedStop = index < currentStopIndex;

          const marker = L.marker([location.company.latitude, location.company.longitude], {
            icon: L.divIcon({
              className: 'route-marker',
              html: `<div class="route-marker-icon ${isCurrentStop ? 'current' : ''} ${isCompletedStop ? 'completed' : ''}">${index + 1}</div>`,
              iconSize: [30, 30],
              iconAnchor: [15, 15]
            })
          })
            .bindPopup(`<b>${index + 1}. ${location.company.name}</b><br>${location.company.address || 'No address'}`)
            .addTo(map);

          stopMarkers.push(marker);
        });

        // Draw route line
        const latlngs = validLocations.map(loc => [loc.company.latitude, loc.company.longitude]);
        routeLine = L.polyline(latlngs, { color: '#4f46e5', weight: 4, opacity: 0.7 }).addTo(map);

        // Fit map to show entire route
        const group = new L.featureGroup(stopMarkers);
        map.fitBounds(group.getBounds().pad(0.1));

        // Try to get user's location
        if (navigator.geolocation) {
          navigator.geolocation.watchPosition(
            (position) => {
              const { latitude, longitude } = position.coords;

              // Update or create user marker
              if (userMarker) {
                userMarker.setLatLng([latitude, longitude]);
              } else {
                userMarker = L.marker([latitude, longitude], {
                  icon: L.divIcon({
                    className: 'user-marker',
                    html: '<div class="user-marker-icon"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-user-icon lucide-user"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>',
                    iconSize: [30, 30],
                    iconAnchor: [15, 15]
                  })
                }).addTo(map);
              }

              // Check if user is near current stop
              const currentLocation = validLocations[currentStopIndex];
              const distance = calculateDistance(
                latitude, longitude,
                currentLocation.company.latitude, currentLocation.company.longitude
              );

              // If within 100 meters, show notification
              if (distance < 100) {
                document.getElementById('arrived-btn').classList.add('pulse');
              }
            },
            (error) => {
              console.error('Error getting location:', error);
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
          );
        }
      } catch (e) {
        console.error('Error initializing map:', e);
        const mapElement = document.getElementById('navigation-map');
        if (mapElement) {
          mapElement.innerHTML = '<div class="text-center" style="padding: 2rem;">Map unavailable</div>';
        }
      }
    }, 100);

    // Handle button clicks
    document.getElementById('arrived-btn').addEventListener('click', () => {
      // Mark current stop as completed
      currentStopIndex++;

      // If there are more stops, update UI
      if (currentStopIndex < validLocations.length) {
        // Update current stop
        document.getElementById('current-stop-name').textContent = validLocations[currentStopIndex].company.name;
        document.getElementById('current-stop-address').textContent = validLocations[currentStopIndex].company.address || 'No address';

        // Update stops list
        const firstStop = document.querySelector('.stop-item');
        if (firstStop) {
          firstStop.remove();
        }

        // Update map markers
        if (stopMarkers[currentStopIndex - 1]) {
          stopMarkers[currentStopIndex - 1].setIcon(
            L.divIcon({
              className: 'route-marker',
              html: `<div class="route-marker-icon completed">${currentStopIndex}</div>`,
              iconSize: [30, 30],
              iconAnchor: [15, 15]
            })
          );
        }

        if (stopMarkers[currentStopIndex]) {
          stopMarkers[currentStopIndex].setIcon(
            L.divIcon({
              className: 'route-marker',
              html: `<div class="route-marker-icon current">${currentStopIndex + 1}</div>`,
              iconSize: [30, 30],
              iconAnchor: [15, 15]
            })
          );
        }

        // Center map on new current stop
        if (map) {
          map.setView([validLocations[currentStopIndex].company.latitude, validLocations[currentStopIndex].company.longitude], 15);
        }

        showToast(`Proceeding to stop ${currentStopIndex + 1}`, 'info');
      } else {
        // Route completed
        completeRoute(routeId);
      }
    });

    document.getElementById('get-directions-btn').addEventListener('click', () => {
      const currentLocation = validLocations[currentStopIndex];
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${currentLocation.company.latitude},${currentLocation.company.longitude}`, '_blank');
    });

    document.getElementById('complete-route-btn').addEventListener('click', async () => {
      const confirmed = await showConfirmDialog(
        'Complete Route',
        'Are you sure you want to mark this route as completed?'
      );

      if (!confirmed) return;

      completeRoute(routeId);
    });
  } catch (error) {
    console.error('Error starting route navigation:', error);
    showToast('Error starting route: ' + error.message, 'error');
  }
}

async function completeRoute(routeId) {
  try {
    // Mark route as completed
    const { error } = await supabaseClient
      .from('routes')
      .update({ is_active: false })
      .eq('id', routeId);

    if (error) throw error;

    showToast('Route completed successfully', 'success');
    loadView('my-routes');
  } catch (error) {
    console.error('Error completing route:', error);
    showToast('Error completing route: ' + error.message, 'error');
  }
}

// ======================
// TASKS VIEW
// ======================

async function renderTasksView() {
  // Fetch tasks based on user role
  let tasks;
  let error;

  if (isManager) {
    // Managers should only see tasks they created (either assigned to others or themselves).
    // This prevents managers from seeing tasks that sales reps create for themselves.
    const result = await supabaseClient
      .from('tasks')
      .select(`
        *,
        assigned_to_profile:profiles!tasks_assigned_to_fkey(first_name, last_name, email),
        created_by_profile:profiles!tasks_created_by_fkey(first_name, last_name, email)
      `)
      .eq('created_by', currentUser.id)
      .order('created_at', { ascending: false });

    tasks = result.data;
    error = result.error;
  } else {
    // Sales reps only see tasks assigned to them or created by them
    const result = await supabaseClient
      .from('tasks')
      .select('*')
      .or(`assigned_to.eq.${currentUser.id},created_by.eq.${currentUser.id}`)
      .order('created_at', { ascending: false });

    tasks = result.data;
    error = result.error;
  }

  if (error) {
    viewContainer.innerHTML = renderError(error.message);
    return;
  }

  // Fetch sales reps for assignment dropdown (managers only)
  let salesReps = [];
  if (isManager) {
    const { data: reps } = await supabaseClient
      .from('profiles')
      .select('id, first_name, last_name, email')
      .eq('role', 'sales_rep')
      .order('first_name', { ascending: true });

    salesReps = reps || [];
  }

  // Calculate task statistics
  const totalTasks = tasks.length;
  const pendingTasks = tasks.filter(t => t.status === 'pending').length;
  const inProgressTasks = tasks.filter(t => t.status === 'in_progress').length;
  const completedTasks = tasks.filter(t => t.status === 'completed').length;
  const overdueTasks = tasks.filter(t => {
    return t.due_date && new Date(t.due_date) < new Date() && t.status !== 'completed';
  }).length;

  let html = `
    <div class="page-header">
      <h1 class="page-title">Tasks</h1>
      <p class="page-subtitle">${totalTasks} total tasks</p>
    </div>

    <div class="task-stats">
      <div class="task-stat-card">
        <div class="task-stat-title">Total Tasks</div>
        <div class="task-stat-value">${totalTasks}</div>
      </div>
      <div class="task-stat-card">
        <div class="task-stat-title">Pending</div>
        <div class="task-stat-value">${pendingTasks}</div>
      </div>
      <div class="task-stat-card">
        <div class="task-stat-title">In Progress</div>
        <div class="task-stat-value">${inProgressTasks}</div>
      </div>
      <div class="task-stat-card">
        <div class="task-stat-title">Completed</div>
        <div class="task-stat-value">${completedTasks}</div>
      </div>
      ${overdueTasks > 0 ? `
        <div class="task-stat-card">
          <div class="task-stat-title task-overdue">Overdue</div>
          <div class="task-stat-value task-overdue">${overdueTasks}</div>
        </div>
      ` : ''}
    </div>

    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Tasks</h3>
        <button class="btn btn-primary" id="add-task-btn">
          <i class="fas fa-plus"></i> New Task
        </button>
      </div>
      
      <div class="task-filters">
        <button class="task-filter active" data-filter="all">All Tasks</button>
        <button class="task-filter" data-filter="pending">Pending</button>
        <button class="task-filter" data-filter="in_progress">In Progress</button>
        <button class="task-filter" data-filter="completed">Completed</button>
        <button class="task-filter" data-filter="overdue">Overdue</button>
        ${isManager ? `
          <button class="task-filter" data-filter="assigned">Assigned by Me</button>
        ` : ''}
      </div>
      
      <div id="tasks-container">
  `;

  if (tasks.length === 0) {
    html += `
      <div class="empty-state">
        <h3 class="empty-state-title">No tasks yet</h3>
        <p class="empty-state-description">Create your first task to get started.</p>
      </div>
    `;
  } else {
    tasks.forEach(task => {
      html += renderTaskCard(task, isManager);
    });
  }

  html += `
      </div>
    </div>
  `;

  viewContainer.innerHTML = html;

  // Initialize event listeners
  document.getElementById('add-task-btn')?.addEventListener('click', () => {
    openTaskModal(null, salesReps);
  });

  // Initialize task filters
  initTaskFilters(tasks);

  // Initialize task action buttons
  initTaskActionButtons(tasks, salesReps);
}

function renderTaskCard(task, isManager) {
  const isAssignedToMe = task.assigned_to === currentUser.id;
  const isCreatedByMe = task.created_by === currentUser.id;
  const isCreatedByManager = isManager && task.created_by !== currentUser.id;

  // Permissions:
  // - Managers can edit any task.
  // - Sales reps can only edit tasks they created themselves (not tasks assigned to them by a manager).
  const canEdit = isManager || isCreatedByMe;

  // Completion permission:
  // - Managers can mark any task complete.
  // - Sales reps can mark a task complete if it is assigned to them or if they created it.
  const canComplete = isManager || isAssignedToMe || isCreatedByMe;

  const dueDate = task.due_date ? new Date(task.due_date) : null;
  const isOverdue = dueDate && dueDate < new Date();
  const dueDateStr = dueDate ? formatDate(dueDate) : '';

  // Get assigned to name
  let assignedToName = 'Unassigned';
  if (task.assigned_to_profile) {
    assignedToName = `${task.assigned_to_profile.first_name} ${task.assigned_to_profile.last_name}`;
  } else if (task.assigned_to === currentUser.id) {
    assignedToName = 'Me';
  }

  // Get created by name
  let createdByName = 'Unknown';
  if (task.created_by_profile) {
    createdByName = `${task.created_by_profile.first_name} ${task.created_by_profile.last_name}`;
  } else if (task.created_by === currentUser.id) {
    createdByName = 'Me';
  }

  return `
    <div class="task-card" data-id="${task.id}" data-status="${task.status}" data-overdue="${isOverdue}">
      <div class="task-header">
        <div class="task-title">${task.title}</div>
        <div class="task-status ${task.status}">${getStatusLabel(task.status)}</div>
      </div>
      
      ${task.description ? `<div class="task-description">${task.description}</div>` : ''}
      
      <div class="task-meta">
        ${task.due_date ? `
          <div class="task-meta-item ${isOverdue ? 'task-overdue' : ''}">
            <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-calendar-icon lucide-calendar"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>
            <span>Due: ${dueDateStr}</span>
            ${isOverdue ? '<i class="fas fa-exclamation-triangle"></i>' : ''}
          </div>
        ` : ''}
        
        <div class="task-meta-item">
          <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-flag-icon lucide-flag"><path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/></svg>
          <span>Priority: ${task.priority || 'medium'}</span>
        </div>
        
        ${isManager || task.assigned_to ? `
          <div class="task-meta-item">
            <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-user-icon lucide-user"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            <span>Assigned to: ${assignedToName}</span>
          </div>
        ` : ''}
      </div>
      
      <div class="task-actions">
        <div class="task-priority ${task.priority || 'medium'}">${(task.priority || 'medium').charAt(0).toUpperCase() + (task.priority || 'medium').slice(1)}</div>
        <div class="task-action-buttons">
          ${canEdit ? `
            <button class="task-action-btn edit-task" data-id="${task.id}">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-square-pen-icon lucide-square-pen"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/></svg>
            </button>
          ` : ''}
          ${canComplete && task.status !== 'completed' ? `
            <button class="task-action-btn complete-task" data-id="${task.id}">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-icon lucide-check"><path d="M20 6 9 17l-5-5"/></svg>
            </button>
          ` : ''}
          ${isManager || isCreatedByMe ? `
            <button class="task-action-btn delete-task" data-id="${task.id}">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-icon lucide-trash"><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          ` : ''}
        </div>
      </div>
      
      ${!isManager && isCreatedByManager ? `
        <div class="task-creator">
          <i class="fas fa-info-circle"></i>
          <span>This task was assigned to you by a manager</span>
        </div>
      ` : ''}
    </div>
  `;
}

function getStatusLabel(status) {
  switch (status) {
    case 'pending': return 'Pending';
    case 'in_progress': return 'In Progress';
    case 'completed': return 'Completed';
    default: return status;
  }
}

function initTaskFilters(tasks) {
  const filterButtons = document.querySelectorAll('.task-filter');

  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      // Update active state
      filterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const filter = btn.dataset.filter;

      // Apply filter
      document.querySelectorAll('.task-card').forEach(card => {
        let show = true;

        if (filter === 'assigned') {
          // Only show tasks created by current user
          const taskId = card.dataset.id;
          const task = tasks.find(t => t.id === taskId);
          show = task && task.created_by === currentUser.id;
        } else if (filter === 'overdue') {
          const isOverdue = card.dataset.overdue === 'true';
          show = isOverdue;
        } else {
          const status = card.dataset.status;
          show = status === filter;
        }

        card.style.display = show ? 'block' : 'none';
      });
    });
  });
}

function initTaskActionButtons(tasks, salesReps) {
  // Edit task buttons
  document.querySelectorAll('.edit-task').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const taskId = btn.dataset.id;
      const task = tasks.find(t => t.id === taskId);
      if (task) {
        openTaskModal(task, salesReps);
      }
    });
  });

  // Complete task buttons
  document.querySelectorAll('.complete-task').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const taskId = btn.dataset.id;

      const { error } = await supabaseClient
        .from('tasks')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', taskId);

      if (error) {
        showToast('Error completing task: ' + error.message, 'error');
        return;
      }

      showToast('Task completed successfully', 'success');
      renderTasksView();
    });
  });

  // Delete task buttons
  document.querySelectorAll('.delete-task').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const taskId = btn.dataset.id;

      const confirmed = await showConfirmDialog(
        'Delete Task',
        'Are you sure you want to delete this task?'
      );

      if (!confirmed) return;

      const { error } = await supabaseClient
        .from('tasks')
        .delete()
        .eq('id', taskId);

      if (error) {
        showToast('Error deleting task: ' + error.message, 'error');
        return;
      }

      showToast('Task deleted successfully', 'success');
      renderTasksView();
    });
  });
}

function openTaskModal(task = null, salesReps = []) {
  const modal = document.getElementById('task-modal');
  const modalTitle = document.getElementById('task-modal-title');
  const saveBtn = document.getElementById('save-task-btn');
  const assignField = document.getElementById('task-assign-field');
  const assignSelect = document.getElementById('task-assign-to');

  // Reset form
  document.getElementById('task-title').value = '';
  document.getElementById('task-description').value = '';
  document.getElementById('task-due-date').value = '';
  document.getElementById('task-priority').value = 'medium';
  document.getElementById('task-status').value = 'pending';

  // Populate sales reps dropdown for managers
  if (isManager && salesReps.length > 0) {
    assignField.style.display = 'block';
    assignSelect.innerHTML = '<option value="">Select a sales rep</option>';

    // Add option for self
    assignSelect.innerHTML += `<option value="${currentUser.id}">Me</option>`;

    // Add options for sales reps
    salesReps.forEach(rep => {
      assignSelect.innerHTML += `<option value="${rep.id}">${rep.first_name} ${rep.last_name}</option>`;
    });
  } else {
    assignField.style.display = 'none';
  }

  // Set modal title
  if (task) {
    modalTitle.innerHTML = 'Edit Task';

    // Fill form with task data
    document.getElementById('task-title').value = task.title || '';
    document.getElementById('task-description').value = task.description || '';

    // Fix for time display issue
    if (task.due_date) {
      const dueDate = new Date(task.due_date);
      // Format as YYYY-MM-DDTHH:MM for datetime-local input
      const year = dueDate.getFullYear();
      const month = String(dueDate.getMonth() + 1).padStart(2, '0');
      const day = String(dueDate.getDate()).padStart(2, '0');
      const hours = String(dueDate.getHours()).padStart(2, '0');
      const minutes = String(dueDate.getMinutes()).padStart(2, '0');

      document.getElementById('task-due-date').value = `${year}-${month}-${day}T${hours}:${minutes}`;
    } else {
      document.getElementById('task-due-date').value = '';
    }

    document.getElementById('task-priority').value = task.priority || 'medium';
    document.getElementById('task-status').value = task.status || 'pending';

    if (isManager && task.assigned_to) {
      assignSelect.value = task.assigned_to;
    }
  } else {
    modalTitle.innerHTML = 'New Task';
  }

  // Show modal
  modal.style.display = 'flex';

  // Initialize event listeners
  initTaskModalListeners(task);
}

function initTaskModalListeners(task) {
  // Save task
  const saveBtn = document.getElementById('save-task-btn');

  saveBtn.onclick = async () => {
    const title = document.getElementById('task-title').value.trim();
    const description = document.getElementById('task-description').value.trim();
    const dueDate = document.getElementById('task-due-date').value;
    const priority = document.getElementById('task-priority').value;
    const status = document.getElementById('task-status').value;

    // Get assigned to
    let assignedTo = null;
    if (isManager) {
      assignedTo = document.getElementById('task-assign-to').value || null;
    } else {
      // Non-managers can only create tasks for themselves
      assignedTo = currentUser.id;
    }

    // Validate
    if (!title) {
      showToast('Please enter a task title', 'error');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

    try {
      const taskData = {
        title,
        description: description || null,
        assigned_to: assignedTo,
        created_by: currentUser.id,
        due_date: dueDate ? new Date(dueDate).toISOString() : null,
        priority,
        status
      };

      let result;

      if (task) {
        // Update existing task
        result = await supabaseClient
          .from('tasks')
          .update(taskData)
          .eq('id', task.id);
      } else {
        // Create new task
        result = await supabaseClient
          .from('tasks')
          .insert([taskData]);
      }

      if (result.error) throw result.error;

      showToast(`Task ${task ? 'updated' : 'created'} successfully!`, 'success');
      closeModal('task-modal');
      renderTasksView();
    } catch (error) {
      showToast(`Error ${task ? 'updating' : 'creating'} task: ${error.message}`, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = 'Save Task';
    }
  };
}

// ======================
// REMINDERS VIEW
// ======================

async function renderRemindersView() {
  // Fetch reminders based on user role
  let reminders;
  let error;

  if (isManager) {

    const result = await supabaseClient
      .from('reminders')
      .select(`
        *,
        assigned_to_profile:profiles!reminders_assigned_to_fkey(first_name, last_name, email),
        created_by_profile:profiles!reminders_created_by_fkey(first_name, last_name, email)
      `)
      .eq('created_by', currentUser.id)
      .order('reminder_date', { ascending: true });

    reminders = result.data;
    error = result.error;

  } else {
    // Sales reps only see reminders assigned to them or created by them
    const result = await supabaseClient
      .from('reminders')
      .select(`
        *,
        assigned_to_profile:profiles!reminders_assigned_to_fkey(first_name, last_name, email),
        created_by_profile:profiles!reminders_created_by_fkey(first_name, last_name, email)
      `)
      .or(`assigned_to.eq.${currentUser.id},created_by.eq.${currentUser.id}`)
      .order('reminder_date', { ascending: true });

    reminders = result.data;
    error = result.error;
  }


  if (error) {
    viewContainer.innerHTML = renderError(error.message);
    return;
  }

  // Fetch sales reps for assignment dropdown (managers only)
  let salesReps = [];
  if (isManager) {
    const { data: reps } = await supabaseClient
      .from('profiles')
      .select('id, first_name, last_name, email')
      .eq('role', 'sales_rep')
      .order('first_name', { ascending: true });

    salesReps = reps || [];
  }

  // Calculate reminder statistics
  const totalReminders = reminders.length;
  const pendingReminders = reminders.filter(r => !r.is_completed).length;
  const completedReminders = reminders.filter(r => r.is_completed).length;
  const todayReminders = reminders.filter(r => {
    const reminderDate = new Date(r.reminder_date).toDateString();
    const today = new Date().toDateString();
    return reminderDate === today && !r.is_completed;
  }).length;
  const overdueReminders = reminders.filter(r => {
    return new Date(r.reminder_date) < new Date() && !r.is_completed;
  }).length;

  let html = `
    <div class="page-header">
      <h1 class="page-title">Reminders</h1>
      <p class="page-subtitle">${totalReminders} total reminders</p>
    </div>

    <div class="reminder-stats">
      <div class="reminder-stat-card">
        <div class="reminder-stat-title">Total Reminders</div>
        <div class="reminder-stat-value">${totalReminders}</div>
      </div>
      <div class="reminder-stat-card">
        <div class="reminder-stat-title">Pending</div>
        <div class="reminder-stat-value">${pendingReminders}</div>
      </div>
      <div class="reminder-stat-card">
        <div class="reminder-stat-title">Today</div>
        <div class="reminder-stat-value">${todayReminders}</div>
      </div>
      <div class="reminder-stat-card">
        <div class="reminder-stat-title">Completed</div>
        <div class="reminder-stat-value">${completedReminders}</div>
      </div>
      ${overdueReminders > 0 ? `
        <div class="reminder-stat-card">
          <div class="reminder-stat-title task-overdue">Overdue</div>
          <div class="reminder-stat-value task-overdue">${overdueReminders}</div>
        </div>
      ` : ''}
    </div>

    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Reminders</h3>
        <button class="btn btn-primary" id="add-reminder-btn">
          <i class="fas fa-plus"></i> New Reminder
        </button>
      </div>
      
      <div class="reminder-filters">
        <button class="reminder-filter active" data-filter="all">All Reminders</button>
        <button class="reminder-filter" data-filter="pending">Pending</button>
        <button class="reminder-filter" data-filter="completed">Completed</button>
        <button class="reminder-filter" data-filter="today">Today</button>
        <button class="reminder-filter" data-filter="overdue">Overdue</button>
        ${isManager ? `
          <button class="reminder-filter" data-filter="assigned">Assigned by Me</button>
        ` : ''}
      </div>
      
      <div id="reminders-container">
  `;

  // Check for due reminders and show notification
  // Check for due reminders and show notification
  const dueReminders = reminders.filter(r => {
    const reminderDate = new Date(r.reminder_date);
    const now = new Date();
    return reminderDate <= now && !r.is_completed;
  });

  if (dueReminders.length > 0) {
    html += `
      <div class="reminder-notification" id="reminder-notification">
        <div class="reminder-notification-header">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-bell-ring-icon lucide-bell-ring"><path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M22 8c0-2.3-.8-4.3-2-6"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/><path d="M4 2C2.8 3.7 2 5.7 2 8"/></svg>
          <span>You have ${dueReminders.length} due reminder${dueReminders.length > 1 ? 's' : ''}</span>
          <button class="reminder-notification-close" id="close-notification">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x-icon lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
        <div class="reminder-notification-content">
          ${dueReminders.slice(0, 3).map(reminder => {
      // Check if current user is assigned to this reminder
      const isAssignedToCurrentUser = reminder.assigned_to === currentUser.id;

      return `
              <div class="reminder-notification-item">
                <div class="reminder-notification-title">${reminder.title}</div>
                <div class="reminder-notification-time">${formatDate(reminder.reminder_date, true)}</div>
                <div class="reminder-notification-actions">
                  ${isAssignedToCurrentUser ? `
                    <button class="btn btn-sm btn-primary complete-reminder-notification" data-id="${reminder.id}">
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-icon lucide-check"><path d="M20 6 9 17l-5-5"/></svg> Complete
                    </button>
                  ` : `
                    <span class="text-muted" style="font-size: 0.875rem;">Assigned to ${reminder.assigned_to_profile ? reminder.assigned_to_profile.first_name + ' ' + reminder.assigned_to_profile.last_name : 'someone else'}</span>
                  `}
                  <button class="btn btn-sm btn-secondary dismiss-reminder-notification" data-id="${reminder.id}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-bell-off-icon lucide-bell-off"><path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742"/><path d="m2 2 20 20"/><path d="M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05"/></svg>
                    Dismiss
                  </button>
                </div>
              </div>
            `;
    }).join('')}
          ${dueReminders.length > 3 ? `
            <div class="reminder-notification-more">
              And ${dueReminders.length - 3} more...
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  if (reminders.length === 0) {
    html += `
      <div class="empty-state">
        <h3 class="empty-state-title">No reminders yet</h3>
        <p class="empty-state-description">Create your first reminder to get started.</p>
        <button class="btn btn-primary" onclick="openReminderModal()">
          <i class="fas fa-plus"></i> Add Reminder
        </button>
      </div>
    `;
  } else {
    reminders.forEach(reminder => {
      const isOverdue = reminder.reminder_date && new Date(reminder.reminder_date) < new Date();
      const isAssignedToMe = reminder.assigned_to === currentUser.id;
      const isCreatedByMe = reminder.created_by === currentUser.id;
      // Only show complete button if the reminder is assigned to the current user
      const canComplete = isAssignedToMe;

      const isCreatedByManager = isManager && reminder.created_by !== currentUser.id;

      // Get user info from joined data
      const assignedToUser = reminder.assigned_to_profile;
      const assignedToName = assignedToUser ? `${assignedToUser.first_name} ${assignedToUser.last_name}` : 'Unknown';
      const createdByUser = reminder.created_by_profile;
      const createdByName = createdByUser ? `${createdByUser.first_name} ${createdByUser.last_name}` : 'Unknown';

      html += `
        <div class="reminder-card" data-id="${reminder.id}" data-completed="${reminder.is_completed}">
          <div class="reminder-header">
            <div class="reminder-title">${reminder.title}</div>
            <div class="reminder-status ${reminder.is_completed ? 'completed' : 'pending'}">
              ${reminder.is_completed ? 'Completed' : 'Pending'}
            </div>
          </div>
          
          ${reminder.description ? `<div class="reminder-description">${reminder.description}</div>` : ''}
          
          <div class="reminder-meta">
            ${reminder.reminder_date ? `
              <div class="reminder-meta-item">
                <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-calendar-icon lucide-calendar"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>
                <span>${formatDate(reminder.reminder_date)}</span>
                ${isOverdue ? '<i class="fas fa-exclamation-triangle"></i>' : ''}
              </div>
            ` : ''}
            
            ${!isManager && reminder.created_by !== currentUser.id && reminder.created_by_profile ? `
              <div class="reminder-meta-item">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-user-icon lucide-user"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                <span>Assigned by: ${reminder.created_by_profile.first_name} ${reminder.created_by_profile.last_name}</span>
              </div>
            ` : ''}
            
            ${isManager && reminder.assigned_to_profile ? `
              <div class="reminder-meta-item">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-user-icon lucide-user"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                <span>Assigned to: ${reminder.assigned_to_profile.first_name} ${reminder.assigned_to_profile.last_name}</span>
              </div>
            ` : ''}
          </div>
          
          <div class="reminder-actions">
            <div class="reminder-date">
              <i class="fas fa-bell"></i>
              ${formatDate(reminder.reminder_date, true)}
            </div>
            <div class="reminder-action-buttons">
              ${(isManager && isCreatedByMe) || (!isManager && (isAssignedToMe || isCreatedByMe)) ? `
                <button class="reminder-action-btn edit-reminder" data-id="${reminder.id}">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-square-pen-icon lucide-square-pen"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/></svg>
                </button>
              ` : ''}
              ${canComplete && !reminder.is_completed ? `
                <button class="reminder-action-btn complete-reminder" data-id="${reminder.id}">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-icon lucide-check"><path d="M20 6 9 17l-5-5"/></svg>
                </button>
              ` : ''}
              ${(isManager && isCreatedByMe) || (!isManager && isCreatedByMe) ? `
                <button class="reminder-action-btn delete-reminder" data-id="${reminder.id}">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-icon lucide-trash"><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
              ` : ''}
            </div>
          </div>
          
          ${!isManager && isCreatedByManager ? `
            <div class="reminder-assigned-to">
              <i class="fas fa-info-circle"></i>
              <span>This reminder was assigned to you by a manager</span>
            </div>
          ` : ''}
        </div>
      `;
    });
  }

  html += `
      </div>
    </div>
  `;

  viewContainer.innerHTML = html;

  // Store for global access
  window.salesRepsData = salesReps;

  // Initialize event listeners
  document.getElementById('add-reminder-btn')?.addEventListener('click', () => {
    openReminderModal(null, salesReps);
  });

  // Initialize reminder action buttons
  initReminderActionButtons(reminders, salesReps);

  // Initialize reminder filters
  initReminderFilters(reminders);

  // Initialize notification close button
  if (dueReminders.length > 0) {
    document.getElementById('close-notification').addEventListener('click', () => {
      document.getElementById('reminder-notification').style.display = 'none';
    });

    // Initialize notification action buttons
    document.querySelectorAll('.complete-reminder-notification').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const reminderId = btn.dataset.id;

        const { error } = await supabaseClient
          .from('reminders')
          .update({ is_completed: true, updated_at: new Date().toISOString() })
          .eq('id', reminderId);

        if (error) {
          showToast('Error completing reminder: ' + error.message, 'error');
          return;
        }

        showToast('Reminder completed successfully', 'success');
        renderRemindersView();
      });
    });

    document.querySelectorAll('.dismiss-reminder-notification').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const reminderId = btn.dataset.id;

        // Store dismissed reminder in localStorage with a timestamp
        const dismissedReminders = JSON.parse(localStorage.getItem('dismissedReminders') || '[]');
        dismissedReminders.push({
          id: reminderId,
          dismissedAt: new Date().toISOString()
        });
        localStorage.setItem('dismissedReminders', JSON.stringify(dismissedReminders));

        // Hide notification
        document.getElementById('reminder-notification').style.display = 'none';

        showToast('Reminder dismissed', 'info');
      });
    });
  }
}

function initReminderFilters(reminders) {
  const filterButtons = document.querySelectorAll('.reminder-filter');

  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      // Update active state
      filterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const filter = btn.dataset.filter;

      // Apply filter
      document.querySelectorAll('.reminder-card').forEach(card => {
        let show = true;

        if (filter === 'assigned') {
          // Only show reminders created by current user
          const reminderId = card.dataset.id;
          const reminder = reminders.find(r => r.id === reminderId);
          show = reminder && reminder.created_by === currentUser.id;
        } else if (filter === 'overdue') {
          const isOverdue = card.dataset.completed === 'false' && new Date(card.dataset.reminderDate) < new Date();
          show = isOverdue;
        } else {
          const isCompleted = card.dataset.completed === 'true';
          show = isCompleted === (filter === 'completed');
        }

        card.style.display = show ? 'block' : 'none';
      });
    });
  });
}

function initReminderActionButtons(reminders, salesReps) {
  // Edit reminder buttons
  document.querySelectorAll('.edit-reminder').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const reminderId = btn.dataset.id;
      const reminder = reminders.find(r => r.id === reminderId);
      if (reminder) {
        openReminderModal(reminder, salesReps);
      }
    });
  });

  // Complete reminder buttons
  document.querySelectorAll('.complete-reminder').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const reminderId = btn.dataset.id;

      const { error } = await supabaseClient
        .from('reminders')
        .update({ is_completed: true, updated_at: new Date().toISOString() })
        .eq('id', reminderId);

      if (error) {
        showToast('Error completing reminder: ' + error.message, 'error');
        return;
      }

      showToast('Reminder completed successfully', 'success');
      renderRemindersView();
    });
  });

  // Delete reminder buttons
  document.querySelectorAll('.delete-reminder').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const reminderId = btn.dataset.id;

      const confirmed = await showConfirmDialog(
        'Delete Reminder',
        'Are you sure you want to delete this reminder?'
      );

      if (!confirmed) return;

      const { error } = await supabaseClient
        .from('reminders')
        .delete()
        .eq('id', reminderId);

      if (error) {
        showToast('Error deleting reminder: ' + error.message, 'error');
        return;
      }

      showToast('Reminder deleted successfully', 'success');
      renderRemindersView();
    });
  });
}

function openReminderModal(reminder = null, salesReps = []) {
  const modal = document.getElementById('reminder-modal');
  const modalTitle = document.getElementById('reminder-modal-title');
  const saveBtn = document.getElementById('save-reminder-btn');
  const assignField = document.getElementById('reminder-assign-field');
  const assignSelect = document.getElementById('reminder-assign-to');

  // Reset form
  document.getElementById('reminder-title').value = '';
  document.getElementById('reminder-description').value = '';
  document.getElementById('reminder-date').value = '';

  // Populate sales reps dropdown for managers
  if (isManager && salesReps.length > 0) {
    assignField.style.display = 'block';
    assignSelect.innerHTML = '<option value="">Select a sales rep</option>';

    // Add option for self
    assignSelect.innerHTML += `<option value="${currentUser.id}">Me</option>`;

    // Add options for sales reps
    salesReps.forEach(rep => {
      assignSelect.innerHTML += `<option value="${rep.id}">${rep.first_name} ${rep.last_name}</option>`;
    });
  } else {
    assignField.style.display = 'none';
  }

  // Set modal title
  if (reminder) {
    modalTitle.innerHTML = 'Edit Reminder';

    // Fill form with reminder data
    document.getElementById('reminder-title').value = reminder.title || '';
    document.getElementById('reminder-description').value = reminder.description || '';

    // Fix for time display issue
    if (reminder.reminder_date) {
      const reminderDate = new Date(reminder.reminder_date);
      // Format as YYYY-MM-DDTHH:MM for datetime-local input
      const year = reminderDate.getFullYear();
      const month = String(reminderDate.getMonth() + 1).padStart(2, '0');
      const day = String(reminderDate.getDate()).padStart(2, '0');
      const hours = String(reminderDate.getHours()).padStart(2, '0');
      const minutes = String(reminderDate.getMinutes()).padStart(2, '0');

      document.getElementById('reminder-date').value = `${year}-${month}-${day}T${hours}:${minutes}`;
    } else {
      document.getElementById('reminder-date').value = '';
    }

    if (isManager && reminder.assigned_to) {
      assignSelect.value = reminder.assigned_to;
    }
  } else {
    modalTitle.innerHTML = 'New Reminder';
  }

  // Show modal
  modal.style.display = 'flex';

  // Initialize event listeners
  initReminderModalListeners(reminder);
}

function initReminderModalListeners(reminder) {
  // Save reminder
  const saveBtn = document.getElementById('save-reminder-btn');

  saveBtn.onclick = async () => {
    const title = document.getElementById('reminder-title').value.trim();
    const description = document.getElementById('reminder-description').value.trim();
    const reminderDate = document.getElementById('reminder-date').value;

    // Get assigned to
    let assignedTo = null;
    if (isManager) {
      assignedTo = document.getElementById('reminder-assign-to').value || null;
    } else {
      // Non-managers can only create reminders for themselves
      assignedTo = currentUser.id;
    }

    // Validate
    if (!title || !reminderDate) {
      showToast('Please enter a title and reminder date', 'error');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

    try {
      const reminderData = {
        title,
        description: description || null,
        assigned_to: assignedTo,
        created_by: currentUser.id,
        reminder_date: new Date(reminderDate).toISOString(),
        is_completed: false
      };

      let result;

      if (reminder) {
        // Update existing reminder
        result = await supabaseClient
          .from('reminders')
          .update(reminderData)
          .eq('id', reminder.id);
      } else {
        // Create new reminder
        result = await supabaseClient
          .from('reminders')
          .insert([reminderData]);
      }

      if (result.error) throw result.error;

      showToast(`Reminder ${reminder ? 'updated' : 'created'} successfully!`, 'success');
      closeModal('reminder-modal');
      renderRemindersView();
    } catch (error) {
      showToast(`Error ${reminder ? 'updating' : 'creating'} reminder: ${error.message}`, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = 'Save Reminder';
    }
  };
}

// ======================
// EXPORT FUNCTIONALITY
// ======================

function openExportModal() {
  document.getElementById('export-modal').style.display = 'flex';
}

window.closeModal = function (modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.style.display = 'none';
  // For dynamically created modals
  if (!modal) {
    document.querySelectorAll('.modal').forEach(m => {
      if (m.id === modalId) m.remove();
    });
  }
};

window.setDateRange = function (range, btn) {
  document.querySelectorAll('.date-range-btn').forEach(b => b.classList.remove('active'));
  btn?.classList.add('active');

  const customRange = document.getElementById('custom-date-range');
  const fromInput = document.getElementById('export-date-from');
  const toInput = document.getElementById('export-date-to');

  const today = new Date();
  let fromDate = new Date();

  switch (range) {
    case 'today':
      fromDate = today;
      break;
    case 'week':
      fromDate.setDate(today.getDate() - 7);
      break;
    case 'month':
      fromDate.setMonth(today.getMonth() - 1);
      break;
    case 'quarter':
      fromDate.setMonth(today.getMonth() - 3);
      break;
    case 'custom':
      customRange.style.display = 'block';
      return;
  }

  customRange.style.display = 'none';
  fromInput.value = fromDate.toISOString().split('T')[0];
  toInput.value = today.toISOString().split('T')[0];
};

window.executeExport = async function () {
  const format = document.querySelector('input[name="export-format"]:checked')?.value || 'pdf';
  const fromDate = document.getElementById('export-date-from').value;
  const toDate = document.getElementById('export-date-to').value;

  if (!fromDate || !toDate) {
    showToast('Please select a date range', 'error');
    return;
  }

  showToast('Preparing export...', 'info');

  try {
    // FIX: Specify relationship to avoid ambiguity
    const { data: visits, error } = await supabaseClient
      .from('visits')
      .select(`*, user:profiles!inner(first_name, last_name, email)`)
      .gte('created_at', fromDate)
      .lte('created_at', toDate)
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (format === 'pdf') {
      await exportToPDF(visits, fromDate, toDate);
    } else if (format === 'excel') {
      await exportToExcel(visits, fromDate, toDate);
    } else if (format === 'csv') {
      await exportToCSV(visits, fromDate, toDate);
    }

    showToast('Export completed!', 'success');
    closeModal('export-modal');
  } catch (err) {
    showToast('Export failed: ' + err.message, 'error');
  }
};

async function exportToPDF(visits, fromDate, toDate) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(20);
  doc.text('SafiTrack Visit Report', 20, 20);
  doc.setFontSize(12);
  doc.text(`Period: ${fromDate} to ${toDate}`, 20, 30);
  doc.text(`Total Visits: ${visits.length}`, 20, 37);

  let yPos = 50;
  doc.setFontSize(10);

  visits.forEach((visit, index) => {
    if (yPos > 270) {
      doc.addPage();
      yPos = 20;
    }

    const userName = visit.user ? `${visit.user.first_name} ${visit.user.last_name}` : 'Unknown';
    const date = new Date(visit.created_at).toLocaleDateString();

    doc.setFont(undefined, 'bold');
    doc.text(`${index + 1}. ${visit.company_name}`, 20, yPos);
    doc.setFont(undefined, 'normal');
    yPos += 6;
    doc.text(`Rep: ${userName} | Date: ${date}`, 20, yPos);
    yPos += 10;

    if (visit.contact_name) {
      doc.text(`Contact: ${visit.contact_name}`, 20, yPos);
      yPos += 6;
    }

    if (visit.location_name) {
      doc.text(`Location: ${visit.location_name}`, 20, yPos);
      yPos += 6;
    }

    if (visit.visit_type) {
      doc.text(`Type: ${visit.visit_type.replace('_', ' ')}`, 20, yPos);
      yPos += 6;
    }

    if (visit.travel_time) {
      doc.text(`Travel Time: ${visit.travel_time} min`, 20, yPos);
      yPos += 6;
    }

    if (visit.notes) {
      doc.text('Notes:', 20, yPos);
      yPos += 6;

      // Split notes into lines to fit in page
      const lines = doc.splitTextToSize(visit.notes, 170);
      lines.forEach(line => {
        doc.text(line, 20, yPos);
        yPos += 5;
      });
    }

    yPos += 10;
  });

  doc.save(`SafiTrack_Report_${fromDate}_to_${toDate}.pdf`);
}

async function exportToExcel(visits, fromDate, toDate) {
  const XLSX = window.XLSX;

  const data = visits.map(visit => ({
    'Date': new Date(visit.created_at).toLocaleDateString(),
    'Company': visit.company_name,
    'Contact': visit.contact_name || '',
    'Sales Rep': visit.user ? `${visit.user.first_name} ${visit.user.last_name}` : '',
    'Location': visit.location_name || '',
    'Type': visit.visit_type || '',
    'Travel Time': visit.travel_time || '',
    'Notes': visit.notes || '',
    'AI Summary': visit.ai_summary || ''
  }));

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, 'Visits');
  XLSX.writeFile(workbook, `SafiTrack_Report_${fromDate}_to_${toDate}.xlsx`);
}

async function exportToCSV(visits, fromDate, toDate) {
  const headers = ['Date', 'Company', 'Contact', 'Sales Rep', 'Location', 'Type', 'Travel Time', 'Notes', 'AI Summary'];
  const rows = visits.map(visit => [
    new Date(visit.created_at).toLocaleDateString(),
    visit.company_name,
    visit.contact_name || '',
    visit.user ? `${visit.user.first_name} ${visit.user.last_name}` : '',
    visit.location_name || '',
    visit.visit_type || '',
    visit.travel_time || '',
    visit.notes || '',
    visit.ai_summary || ''
  ]);

  let csv = headers.join(',') + '\n';
  rows.forEach(row => {
    csv += row.map(cell => `"${cell}"`).join(',') + '\n';
  });

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `SafiTrack_Report_${fromDate}_to_${toDate}.csv`;
  a.click();
  window.URL.revokeObjectURL(url);
}

// ======================
// UTILITY FUNCTIONS
// ======================

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  updateThemeIcon(next);
  showToast(`Switched to ${next} mode`, 'success');
}


function updateThemeIcon(theme) {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;

  // Define the SVG icons
  const darkModeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-moon-icon lucide-moon"><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/></svg>`;

  const lightModeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-sun-icon lucide-sun"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`;

  // Inject the correct SVG based on the theme
  btn.innerHTML = (theme === 'dark') ? darkModeIcon : lightModeIcon;
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const iconMap = {
    success: 'fa-check-circle',
    error: 'fa-times-circle',
    info: 'fa-info-circle'
  };

  toast.innerHTML = `
    <i class="fas ${iconMap[type] || iconMap.info} toast-icon"></i>
    <span class="toast-message">${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// Try to repair broken image links from Supabase storage by requesting a signed URL
async function handleImageError(img) {
  try {
    // Prevent retry loops
    if (img.dataset._tried) return;
    img.dataset._tried = '1';

    const src = img.src || '';
    const bucketMarker = '/safitrack/';
    const idx = src.indexOf(bucketMarker);
    if (idx === -1) {
      img.onerror = null;
      img.src = 'assets/illustrations/image-missing.png';
      return;
    }

    const storagePath = decodeURIComponent(src.substring(idx + bucketMarker.length));

    const { data, error } = await supabaseClient.storage.from('safitrack').createSignedUrl(storagePath, 60);
    if (!error && data && data.signedUrl) {
      img.onerror = null;
      img.src = data.signedUrl;
      return;
    }

    img.onerror = null;
    img.src = 'assets/illustrations/image-missing.png';
  } catch (err) {
    console.error('handleImageError failed', err);
    img.onerror = null;
    img.src = 'assets/illustrations/image-missing.png';
  }
}

function triggerConfetti() {
  if (typeof confetti === 'function') {
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']
    });
  }
}

function getInitials(name) {
  return name
    .split(' ')
    .map(n => n.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function formatDate(dateString, shortFormat = false) {
  const date = new Date(dateString);

  if (shortFormat) {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    });
  }

  return date.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Geocode an address using OpenStreetMap (Nominatim) API
 * @param {string} address - The address to search for
 * @returns {Promise<Object>} - Object containing latitude, longitude, and display name
 */
async function geocodeAddressWithOSM(address) {
  try {
    // URL encode the address to handle spaces and special characters
    const encodedAddress = encodeURIComponent(address);

    // Nominatim Search Endpoint
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodedAddress}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'SafiTrack-CRM/1.0' // User-Agent is recommended to avoid blocking
      }
    });

    if (!response.ok) {
      // Handle rate limits (HTTP 429)
      if (response.status === 429) {
        throw new Error('Too many requests. Please wait a moment.');
      }
      throw new Error('Geocoding service unavailable. Please enter coordinates manually.');
    }

    const data = await response.json();

    // Check if we got results back
    if (!data || !Array.isArray(data) || data.length === 0) {
      throw new Error('Address not found. Please try a more specific address or enter coordinates manually.');
    }

    // Extract the first (most relevant) result
    const result = data[0];

    return {
      latitude: parseFloat(result.lat),
      longitude: parseFloat(result.lon),
      displayName: result.display_name || address
    };

  } catch (error) {
    console.error('Geocoding error:', error);
    throw new Error(error.message || 'Geocoding failed. Please enter coordinates manually.');
  }
}




// Replace the existing calculateDistance function with this improved version
function calculateDistance(lat1, lon1, lat2, lon2) {
  // Validate input parameters
  if (isNaN(lat1) || isNaN(lon1) || isNaN(lat2) || isNaN(lon2)) {
    console.error('Invalid coordinates for distance calculation', { lat1, lon1, lat2, lon2 });
    return NaN;
  }

  const R = 6371e3; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function getLeadScoreBadge(score) {
  let className = 'low';
  let label = 'Low';

  if (score >= 70) {
    className = 'high';
    label = 'High';
  } else if (score >= 40) {
    className = 'medium';
    label = 'Medium';
  }

  return `<span class="lead-score-badge ${className}"> Lead Score : <i class="fas fa-bullseye"></i> ${label}(${score}%)</span>`;
}

function parseMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}



function renderSkeletonCards(count = 3) {
  let html = '';

  // UPDATE: Add data-hide-scrollbar to the first div
  html += `<div class="page-header" data-hide-scrollbar>
    <h1 class="page-title">Loading...</h1>
    <p class="page-subtitle">Please wait</p>
  </div>`; // Make sure this div closes! 

  // ... rest of the function remains the same
  for (let i = 0; i < count; i++) {
    html += `
      <div class="card">
        <div class="skeleton skeleton-title"></div>
        <div class="skeleton skeleton-text"></div>
        <div class="skeleton skeleton-text"></div>
        <div class="skeleton skeleton-text short"></div>
      </div>
    `;
  }

  return html;
}

function renderError(message) {
  return `
    <div class="card">
      <div class="empty-state">
        <i class="fas fa-exclamation-circle empty-state-icon text-danger"></i>
        <h3 class="empty-state-title">Error</h3>
        <p class="empty-state-description">${message}</p>
      </div>
    </div>
  `;
}

function renderAccessDenied() {
  return `
    <div class="card">
      <div class="empty-state">
        <i class="fas fa-lock empty-state-icon"></i>
        <h3 class="empty-state-title">Access Denied</h3>
        <p class="empty-state-description">You don't have permission to view this page.</p>
      </div>
    </div>
  `;
}

function renderNotFound() {
  return `
    <div class="card">
      <div class="empty-state">
        <i class="fas fa-search empty-state-icon"></i>
        <h3 class="empty-state-title">Not Found</h3>
        <p class="empty-state-description">The requested page does not exist.</p>
      </div>
    </div>
  `;
}

// Tags functions
window.addTag = function (tag) {
  if (!visitTags.includes(tag)) {
    visitTags.push(tag);
    renderTags();
  }
};

window.removeTag = function (tag) {
  visitTags = visitTags.filter(t => t !== tag);
  renderTags();
};

function renderTags() {
  const container = document.getElementById('tags-container');
  if (!container) return;

  const tagsHTML = visitTags.map(tag => `
    <span class="tag">
      ${tag}
      <button class="tag-remove" onclick="removeTag('${tag}')">×</button>
    </span>
  `).join('');

  container.innerHTML = tagsHTML + `<input type="text" class="tags-input" id="tags-input" placeholder="Add tags...">`;

  const newInput = document.getElementById('tags-input');
  newInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && newInput.value.trim()) {
      e.preventDefault();
      addTag(newInput.value.trim());
      newInput.value = '';
    }
  });
}

// ======================
// CUSTOM CONFIRM DIALOG
// ======================

window.showConfirmDialog = function (title, message) {
  return new Promise((resolve) => {
    const dialog = document.getElementById('confirm-dialog');
    const titleEl = document.getElementById('confirm-title');
    const messageEl = document.getElementById('confirm-message');
    const cancelBtn = document.getElementById('confirm-cancel');
    const okBtn = document.getElementById('confirm-ok');

    // Set content
    titleEl.textContent = title;
    messageEl.textContent = message;

    // Show dialog
    dialog.style.display = 'flex';

    // Handle buttons
    const handleCancel = () => {
      dialog.style.display = 'none';
      cleanup();
      resolve(false);
    };

    const handleOk = () => {
      dialog.style.display = 'none';
      cleanup();
      resolve(true);
    };

    const cleanup = () => {
      cancelBtn.removeEventListener('click', handleCancel);
      okBtn.removeEventListener('click', handleOk);
    };

    cancelBtn.addEventListener('click', handleCancel);
    okBtn.addEventListener('click', handleOk);
  });
};

// ======================
// COMMAND PALETTE
// ======================

const commands = [
  { id: 'log-visit', title: 'Log New Visit', description: 'Record a field visit', icon: 'fa-plus-circle', action: () => loadView('log-visit') },
  { id: 'my-activity', title: 'My Activity', description: 'View your visits', icon: 'fa-clipboard-list', action: () => loadView('my-activity') },
  { id: 'sales-funnel', title: 'Sales Funnel', description: 'View pipeline', icon: 'fa-filter', action: () => loadView('sales-funnel') },
  { id: 'team-dashboard', title: 'Team Dashboard', description: 'Team performance', icon: 'fa-users', action: () => loadView('team-dashboard') },
  { id: 'companies', title: 'Companies', description: 'Manage companies', icon: 'fa-building', action: () => loadView('companies') },
  { id: 'people', title: 'People', description: 'Manage people', icon: 'fa-users', action: () => loadView('people') },
  { id: 'user-management', title: 'Users', description: 'Manage users', icon: 'fa-user', action: () => loadView('user-management') },
  { id: 'tasks', title: 'Tasks', description: 'Manage tasks', icon: 'fa-tasks', action: () => loadView('tasks') },
  { id: 'reminders', title: 'Reminders', description: 'View reminders', icon: 'fa-bell', action: () => loadView('reminders') },
  { id: 'export', title: 'Export Reports', description: 'Download data', icon: 'fa-download', action: () => openExportModal() },
  { id: 'theme', title: 'Toggle Theme', description: 'Switch dark/light', icon: 'fa-moon', action: () => toggleTheme() },
  { id: 'logout', title: 'Sign Out', description: 'Log out of account', icon: 'fa-sign-out-alt', action: () => handleLogout() }
];

function openCommandPalette() {
  commandPalette.style.display = 'flex';
  document.getElementById('command-input').focus();
  renderCommandResults(commands);
}

function closeCommandPalette() {
  commandPalette.style.display = 'none';
  document.getElementById('command-input').value = '';
}

document.getElementById('command-input')?.addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase();
  const filtered = commands.filter(cmd =>
    cmd.title.toLowerCase().includes(query) ||
    cmd.description.toLowerCase().includes(query)
  );
  renderCommandResults(filtered);
});

function renderCommandResults(results) {
  const container = document.getElementById('command-results');
  if (results.length === 0) {
    container.innerHTML = '<div style="padding: 2rem; text-align: center; color: var(--text-muted);">No commands found</div>';
    return;
  }

  container.innerHTML = results.map((cmd, i) => `
    <div class="command-item ${i === 0 ? 'active' : ''}" onclick="executeCommand('${cmd.id}')">
      <div class="command-item-icon"><i class="fas ${cmd.icon}"></i></div>
      <div class="command-item-text">
        <div class="command-item-title">${cmd.title}</div>
        <div class="command-item-description">${cmd.description}</div>
      </div>
    </div>
  `).join('');
}

window.executeCommand = function (commandId) {
  const command = commands.find(cmd => cmd.id === commandId);
  if (command) {
    command.action();
    closeCommandPalette();
  }
};



// ======================
// TECHNICIAN LOG VISIT VIEW
// ======================

async function renderTechnicianLogVisitView() {
  const { data: companies } = await supabaseClient
    .from('companies')
    .select('*')
    .order('name', { ascending: true });

  viewContainer.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Log Service Visit</h1>
      <p class="page-subtitle">Record your technical service details</p>
    </div>

    <!-- Step Progress -->
    <div class="form-steps">
      <div class="step active" data-step="1">
        <div class="step-number">1</div>
        <div class="step-title">Location & Company</div>
      </div>
      <div class="step" data-step="2">
        <div class="step-number">2</div>
        <div class="step-title">Visit Details</div>
      </div>
      <div class="step" data-step="3">
        <div class="step-number">3</div>
        <div class="step-title">Photos</div>
      </div>
      <div class="step" data-step="4">
        <div class="step-number">4</div>
        <div class="step-title">Signatures</div>
      </div>
      <div class="step" data-step="5">
        <div class="step-number">5</div>
        <div class="step-title">Review</div>
      </div>
    </div>

    <!-- Step 1: Location & Company -->
    <div class="step-container active" id="step-1">
      <div class="card">
        <h3 class="card-title">Location & Company</h3>
        
        <div class="form-field">
          <label for="technician-company-name">Company Name *</label>
          <div class="search-container">
            <i class="fas fa-search"></i>
            <input type="text" id="technician-company-name" placeholder="Search for a company..." required />
            <div id="technician-company-search-results" class="search-results" style="display: none;"></div>
          </div>
        </div>

        <div class="form-field" id="selected-technician-company" style="display: none;">
          <div class="selected-location-info">
            <div id="selected-technician-company-name"></div>
            <div id="selected-technician-company-address" class="text-muted"></div>
          </div>
        </div>

        <div class="form-field">
          <label for="technician-custom-location">Custom Location (optional)</label>
          <input type="text" id="technician-custom-location" placeholder="Enter custom company or location name" />
          <div class="text-muted mt-1">Technicians may enter a custom location if the company isn't listed.</div>
        </div>

        <div class="form-field">
          <label>Location Verification</label>
          <div class="location-verification">
            <button type="button" id="verify-technician-location" class="btn btn-secondary w-full">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-pin-icon lucide-map-pin"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>
              Capture Current Location
            </button>
            <div id="technician-location-status" class="location-status" style="display: none;"></div>
            <div id="technician-location-map" class="location-map" style="display: none; height: 200px;"></div>
          </div>
          <small class="text-muted">Your location will be captured and displayed on the map for the manager</small>
        </div>

        <div class="form-field">
          <button class="btn btn-primary w-full next-step" data-next="2">
            Next: Visit Details
          </button>
        </div>
      </div>
    </div>

    <!-- Step 2: Visit Details -->
    <div class="step-container" id="step-2">
      <div class="card">
        <h3 class="card-title">Visit Details</h3>
        
        <div class="form-field">
          <label for="visit-type">Visit Type *</label>
          <select id="visit-type" required>
            <option value="">Select visit type</option>
            <option value="installation">Installation</option>
            <option value="maintenance">Maintenance</option>
            <option value="repair">Repair</option>
            <option value="inspection">Inspection</option>
            <option value="emergency">Emergency / Call-out</option>
          </select>
        </div>

        <div class="form-field">
          <label for="work-category">Work Category *</label>
          <select id="work-category" required>
            <option value="">Select category</option>
            <option value="electrical">Electrical</option>
            <option value="solar">Solar</option>
            <option value="networking">Networking</option>
            <option value="mechanical">Mechanical</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div class="form-field" id="other-category-field" style="display: none;">
          <label for="other-category">Specify Other Category</label>
          <input type="text" id="other-category" placeholder="Enter category">
        </div>

        <div class="form-field">
          <label for="work-status">Work Status *</label>
          <select id="work-status" required>
            <option value="">Select status</option>
            <option value="completed">Completed</option>
            <option value="partially_completed">Partially Completed</option>
            <option value="pending">Pending</option>
            <option value="follow_up">Follow-up Required</option>
          </select>
        </div>

        <div class="form-field" id="follow-up-field" style="display: none;">
          <label for="follow-up-notes">Follow-up & Next Actions *</label>
          <textarea id="follow-up-notes" placeholder="Describe required follow-up actions..." rows="3"></textarea>
        </div>

        <div class="form-field">
          <label for="visit-notes">Visit Notes *</label>
          <textarea id="visit-notes" placeholder="Describe the work performed, findings, recommendations..." rows="5" required></textarea>
        </div>

        <div class="form-field flex gap-2">
          <button class="btn btn-secondary flex-1 prev-step" data-prev="1">
            <i class="fas fa-arrow-left"></i> Back
          </button>
          <button class="btn btn-primary flex-1 next-step" data-next="3">
            Next: Photos
          </button>
        </div>
      </div>
    </div>

    <!-- Step 3: Photos -->
    <div class="step-container" id="step-3">
      <div class="card">
        <h3 class="card-title">Photos</h3>
        <p class="text-muted mb-3">Photos will be automatically deleted after 30 days</p>
        
        <input type="file" id="technician-photos" accept="image/*" multiple style="display: none;" />
        
        <div class="photo-upload-multiple" id="photo-upload-multiple">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-camera-icon lucide-camera"><path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"/><circle cx="12" cy="13" r="3"/></svg>
          <p>Tap to add photos (multiple selection supported)</p>
          <small class="text-muted">Maximum 10 photos, 5MB each</small>
        </div>

        <div class="photo-grid" id="photo-preview-grid"></div>

        <div class="form-field flex gap-2">
          <button class="btn btn-secondary flex-1 prev-step" data-prev="2">
            <i class="fas fa-arrow-left"></i> Back
          </button>
          <button class="btn btn-primary flex-1 next-step" data-next="4">
            Next: Signatures
          </button>
        </div>
      </div>
    </div>

    <!-- Step 4: Signatures -->
    <div class="step-container" id="step-4">
      <div class="card">
        <h3 class="card-title">Signatures</h3>
        <p class="text-muted mb-3">Both signatures are required to submit the visit</p>
        
        <div class="form-field">
          <label>Client Signature *</label>
          <div class="signature-container">
            <canvas id="client-signature-canvas" class="signature-canvas"></canvas>
            <div class="signature-placeholder" id="client-signature-placeholder">
              Click and drag to sign
            </div>
          </div>
          <div class="signature-actions">
            <button type="button" class="btn btn-sm btn-secondary" id="clear-client-signature">
              Clear
            </button>
            <button type="button" class="btn btn-sm btn-secondary" id="save-client-signature">
              Save
            </button>
          </div>
          
        </div>

        <div class="form-field">
          <label>Technician Signature *</label>
          <div class="signature-container">
            <canvas id="technician-signature-canvas" class="signature-canvas"></canvas>
            <div class="signature-placeholder" id="technician-signature-placeholder">
              Click and drag to sign
            </div>
          </div>
          <div class="signature-actions">
            <button type="button" class="btn btn-sm btn-secondary" id="clear-technician-signature">
              Clear
            </button>
            <button type="button" class="btn btn-sm btn-secondary" id="save-technician-signature">
              Save
            </button>
          </div>
          
        </div>

        <div class="form-field flex gap-2">
          <button class="btn btn-secondary flex-1 prev-step" data-prev="3">
            <i class="fas fa-arrow-left"></i> Back
          </button>
          <button class="btn btn-primary flex-1 next-step" data-next="5" id="next-to-review" disabled>
            Next: Review
          </button>
        </div>
      </div>
    </div>

    <!-- Step 5: Review & Submit -->
    <div class="step-container" id="step-5">
      <div class="card">
        <h3 class="card-title">Review & Submit</h3>
        
        <div class="review-section">
          <h4>Visit Summary</h4>
          <div id="review-summary"></div>
        </div>

        <div class="review-section">
          <h4>Photos</h4>
          <div class="photo-grid" id="review-photos"></div>
        </div>

        <div class="review-section">
          <h4>Signatures</h4>
          <div class="flex gap-4">
            <div>
              <p class="text-sm text-muted">Client Signature</p>
              <div id="review-client-signature"></div>
            </div>
            <div>
              <p class="text-sm text-muted">Technician Signature</p>
              <div id="review-technician-signature"></div>
            </div>
          </div>
        </div>

        <!-- Confirm signatures checkbox removed - not required -->

        <div class="form-field flex gap-2">
          <button class="btn btn-secondary flex-1 prev-step" data-prev="4">
            <i class="fas fa-arrow-left"></i> Back
          </button>
          <button class="btn btn-primary flex-1" id="submit-technician-visit" disabled>
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-icon lucide-check"><path d="M20 6 9 17l-5-5"/></svg> Submit Visit
          </button>
        </div>
      </div>
    </div>
  `;

  initTechnicianLogVisitForm(companies);
}

function initTechnicianLogVisitForm(companies) {
  // Create a global state object for the form
  window.technicianVisitForm = {
    currentStep: 1,
    selectedCompany: null,
    capturedLocation: null,
    clientSignature: null,
    technicianSignature: null,
    photos: [],
    clientSignatureCanvas: null,
    technicianSignatureCanvas: null,
    clientSignatureCtx: null,
    technicianSignatureCtx: null,
    isClientDrawing: false,
    isTechnicianDrawing: false,
    map: null
  };

  // Store for global access
  window.companiesData = companies;

  // Company search functionality
  const companyNameInput = document.getElementById('technician-company-name');
  const companySearchResults = document.getElementById('technician-company-search-results');
  const selectedCompanyDiv = document.getElementById('selected-technician-company');
  const selectedCompanyName = document.getElementById('selected-technician-company-name');
  const selectedCompanyAddress = document.getElementById('selected-technician-company-address');
  const customLocationInput = document.getElementById('technician-custom-location');

  companyNameInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();

    if (query.length === 0) {
      companySearchResults.style.display = 'none';
      return;
    }

    const filtered = companies.filter(company =>
      company.name.toLowerCase().includes(query)
    );

    if (filtered.length === 0) {
      companySearchResults.innerHTML = '<div class="search-result-item">No companies found</div>';
    } else {
      companySearchResults.innerHTML = filtered.map(company => `
        <div class="search-result-item" onclick="selectTechnicianCompany('${company.id}')">
          <div class="search-result-icon"></div>
          <div>
            <div class="search-result-name">${company.name}</div>
            <div class="search-result-role">${company.description || 'No description'}</div>
          </div>
        </div>
      `).join('');
    }

    companySearchResults.style.display = 'block';
  });

  // Location verification
  const verifyLocationBtn = document.getElementById('verify-technician-location');
  const locationStatus = document.getElementById('technician-location-status');
  const locationMap = document.getElementById('technician-location-map');

  verifyLocationBtn.addEventListener('click', () => {
    let company = window.technicianVisitForm.selectedCompany;

    // If no selected company but technician provided a custom location name, use that
    if (!company) {
      const customName = customLocationInput && customLocationInput.value.trim() ? customLocationInput.value.trim() : null;
      if (customName) {
        company = { id: null, name: customName, description: 'Custom entry' };
        // store as selectedCompany so submit uses it
        window.technicianVisitForm.selectedCompany = company;
        if (selectedCompanyDiv) selectedCompanyDiv.style.display = 'block';
        if (selectedCompanyName) selectedCompanyName.textContent = company.name;
        if (selectedCompanyAddress) selectedCompanyAddress.textContent = company.description;
      } else {
        showToast('Please select a company or enter a custom location', 'error');
        return;
      }
    }

    if (!navigator.geolocation) {
      showToast('Geolocation not supported', 'error');
      return;
    }

    verifyLocationBtn.disabled = true;
    verifyLocationBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Capturing location...';
    locationStatus.style.display = 'flex';
    locationStatus.className = 'location-status';
    locationStatus.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Getting your location...';

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const capturedLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy
        };

        // Store in global state
        window.technicianVisitForm.capturedLocation = capturedLocation;

        locationStatus.className = 'location-status success';
        locationStatus.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-icon lucide-check"><path d="M20 6 9 17l-5-5"/></svg> Location captured! Coordinates: ${capturedLocation.latitude.toFixed(6)}, ${capturedLocation.longitude.toFixed(6)}`;

        // Show map
        locationMap.style.display = 'block';
        initTechnicianLocationMap(company, capturedLocation);

        verifyLocationBtn.disabled = false;
        verifyLocationBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-pin-icon lucide-map-pin"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg> Location Captured';
        verifyLocationBtn.classList.add('btn-success');
      },
      (error) => {
        locationStatus.className = 'location-status error';
        locationStatus.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x-icon lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg> Unable to get location`;
        verifyLocationBtn.disabled = false;
        verifyLocationBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-pin-icon lucide-map-pin"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg> Capture Current Location';
        showToast('Location capture failed', 'error');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });

  // Work category other field
  const workCategorySelect = document.getElementById('work-category');
  const otherCategoryField = document.getElementById('other-category-field');

  workCategorySelect.addEventListener('change', (e) => {
    if (e.target.value === 'other') {
      otherCategoryField.style.display = 'block';
    } else {
      otherCategoryField.style.display = 'none';
    }
  });

  // Follow-up field
  const workStatusSelect = document.getElementById('work-status');
  const followUpField = document.getElementById('follow-up-field');
  const followUpNotes = document.getElementById('follow-up-notes');

  workStatusSelect.addEventListener('change', (e) => {
    if (e.target.value === 'follow_up') {
      followUpField.style.display = 'block';
      followUpNotes.required = true;
    } else {
      followUpField.style.display = 'none';
      followUpNotes.required = false;
    }
  });

  // Photo upload
  const photoInput = document.getElementById('technician-photos');
  const photoUploadArea = document.getElementById('photo-upload-multiple');
  const photoPreviewGrid = document.getElementById('photo-preview-grid');

  photoUploadArea.addEventListener('click', () => photoInput.click());

  photoInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);

    if (files.length === 0) {
      window.technicianVisitForm.photos = [];
      renderPhotoPreviews();
      return;
    }

    // Limit to 10 photos
    const filesToProcess = files.slice(0, 10);

    // Clear existing photos
    window.technicianVisitForm.photos = [];

    // Show compression progress
    showCompressionProgress('Compressing images...');

    try {
      // Process each file with compression
      for (let i = 0; i < filesToProcess.length; i++) {
        const file = filesToProcess[i];

        // Update progress message
        showCompressionProgress(`Compressing image ${i + 1} of ${filesToProcess.length}...`);

        // Validate file type
        if (!file.type.startsWith('image/')) {
          showToast(`File ${file.name} is not an image`, 'error');
          continue;
        }

        // Validate file size (before compression)
        if (file.size > 10 * 1024 * 1024) { // 10MB limit before compression
          showToast(`Photo ${file.name} exceeds 10MB limit`, 'error');
          continue;
        }

        try {
          // Compress the image
          const compressedFile = await compressImage(file, 0.6, 1200, 1200);

          // Read compressed file for preview
          const reader = new FileReader();
          reader.onload = (e) => {
            // Create a photo object with both original and compressed info
            const photoObj = {
              dataUrl: e.target.result,
              file: compressedFile,
              originalFile: file,
              name: file.name,
              originalSize: file.size,
              compressedSize: compressedFile.size,
              type: file.type,
              timestamp: new Date().toISOString()
            };

            // Add to global state
            window.technicianVisitForm.photos.push(photoObj);

            // Update preview if this is the last image
            if (window.technicianVisitForm.photos.length === filesToProcess.filter(f => f.type.startsWith('image/')).length) {
              renderPhotoPreviews();
              hideCompressionProgress();

              // Show compression summary
              const totalOriginal = window.technicianVisitForm.photos.reduce((sum, p) => sum + p.originalSize, 0);
              const totalCompressed = window.technicianVisitForm.photos.reduce((sum, p) => sum + p.compressedSize, 0);
              const totalSavings = ((1 - totalCompressed / totalOriginal) * 100).toFixed(0);

              showToast(`Images compressed! Saved ${totalSavings}% storage space`, 'success');
            }
          };

          reader.readAsDataURL(compressedFile);

        } catch (compressionError) {
          console.error('Compression error:', compressionError);
          showToast(`Failed to compress ${file.name}, using original`, 'warning');

          // Fallback to original file if compression fails
          const reader = new FileReader();
          reader.onload = (e) => {
            const photoObj = {
              dataUrl: e.target.result,
              file: file,
              name: file.name,
              originalSize: file.size,
              compressedSize: file.size,
              type: file.type,
              timestamp: new Date().toISOString()
            };

            window.technicianVisitForm.photos.push(photoObj);

            if (window.technicianVisitForm.photos.length === filesToProcess.filter(f => f.type.startsWith('image/')).length) {
              renderPhotoPreviews();
              hideCompressionProgress();
            }
          };

          reader.readAsDataURL(file);
        }
      }

    } catch (error) {
      console.error('Error processing images:', error);
      hideCompressionProgress();
      showToast('Error processing images', 'error');
    }

    // Reset the input value
    e.target.value = '';
  });

  function renderPhotoPreviews() {
    const photos = window.technicianVisitForm.photos;
    const photoPreviewGrid = document.getElementById('photo-preview-grid');

    if (!photoPreviewGrid) return;

    if (photos.length === 0) {
      photoPreviewGrid.innerHTML = '<p class="text-muted text-center">No photos selected</p>';
      return;
    }

    photoPreviewGrid.innerHTML = photos.map((photo, index) => {
      const originalSizeMB = (photo.originalSize / 1024 / 1024).toFixed(2);
      const compressedSizeMB = (photo.compressedSize / 1024 / 1024).toFixed(2);
      const savings = photo.originalSize !== photo.compressedSize ?
        `(-${((1 - photo.compressedSize / photo.originalSize) * 100).toFixed(0)}%)` : '';

      return `
        <div class="photo-item">
          <img src="${photo.dataUrl}" alt="Visit photo ${index + 1}" style="width: 100%; height: 100%; object-fit: cover;">
          <button class="photo-remove" onclick="removeTechnicianPhoto(${index})" title="Remove photo">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x-icon lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
          <div class="photo-info">
            <small>${photo.name}</small>
            <small>${compressedSizeMB} MB ${savings}</small>
          </div>
        </div>
      `;
    }).join('');
  }

  window.removeTechnicianPhoto = function (index) {
    window.technicianVisitForm.photos.splice(index, 1);
    renderPhotoPreviews();
  };

  // Initialize signature canvases
  function initSignatureCanvases() {
    const clientSignatureCanvas = document.getElementById('client-signature-canvas');
    const technicianSignatureCanvas = document.getElementById('technician-signature-canvas');

    // Set canvas dimensions
    clientSignatureCanvas.width = clientSignatureCanvas.offsetWidth;
    clientSignatureCanvas.height = clientSignatureCanvas.offsetHeight;
    technicianSignatureCanvas.width = technicianSignatureCanvas.offsetWidth;
    technicianSignatureCanvas.height = technicianSignatureCanvas.offsetHeight;

    // Get contexts
    const clientSignatureCtx = clientSignatureCanvas.getContext('2d');
    const technicianSignatureCtx = technicianSignatureCanvas.getContext('2d');

    // Store in global state
    window.technicianVisitForm.clientSignatureCanvas = clientSignatureCanvas;
    window.technicianVisitForm.technicianSignatureCanvas = technicianSignatureCanvas;
    window.technicianVisitForm.clientSignatureCtx = clientSignatureCtx;
    window.technicianVisitForm.technicianSignatureCtx = technicianSignatureCtx;

    // Set up drawing
    setupSignatureDrawing(clientSignatureCanvas, clientSignatureCtx, 'client');
    setupSignatureDrawing(technicianSignatureCanvas, technicianSignatureCtx, 'technician');
  }

  function setupSignatureDrawing(canvas, ctx, type) {
    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;
    let drawingTimeout = null;

    // Get current theme
    const isDarkTheme = document.documentElement.getAttribute('data-theme') === 'dark';

    function startDrawing(e) {
      isDrawing = true;
      [lastX, lastY] = getCoordinates(e);
      if (type === 'client') window.technicianVisitForm.isClientDrawing = true;
      if (type === 'technician') window.technicianVisitForm.isTechnicianDrawing = true;
      canvas.style.cursor = 'crosshair';

      // Clear any existing timeout
      if (drawingTimeout) clearTimeout(drawingTimeout);
    }


    function draw(e) {
      if (!isDrawing) return;

      // Use consistent blue color so signatures are visible in both themes
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const [x, y] = getCoordinates(e);

      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(x, y);
      ctx.stroke();

      [lastX, lastY] = [x, y];

      // Clear any existing timeout
      if (drawingTimeout) clearTimeout(drawingTimeout);
    }


    function stopDrawing() {
      if (!isDrawing) return;

      isDrawing = false;
      canvas.style.cursor = 'crosshair';

      // Immediately capture the signature when drawing stops
      try {
        const signatureData = canvas.toDataURL('image/png');
        const preview = document.getElementById(`${type}-signature-preview`);

        if (type === 'client') {
          window.technicianVisitForm.clientSignature = signatureData;
          document.getElementById('client-signature-placeholder').style.display = 'none';
        } else {
          window.technicianVisitForm.technicianSignature = signatureData;
          document.getElementById('technician-signature-placeholder').style.display = 'none';
        }

        if (preview) {
          preview.innerHTML = `<img src="${signatureData}" alt="${type} signature" style="max-height: 100px;">`;
          preview.classList.add('show');
        }

        checkSignatures();

        // Show a brief confirmation
        showToast(`${type === 'client' ? 'Client' : 'Technician'} signature captured`, 'success');
      } catch (err) {
        console.error('Error capturing signature:', err);
      }
    }

    function getCoordinates(e) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      let clientX, clientY;

      if (e.type.includes('touch')) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }

      return [
        (clientX - rect.left) * scaleX,
        (clientY - rect.top) * scaleY
      ];
    }

    // Mouse events
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);

    // Touch events
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      startDrawing(e);
    });
    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      draw(e);
    });
    canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      stopDrawing();
    });

    // Clear signature buttons
    document.getElementById(`clear-${type}-signature`).addEventListener('click', () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (type === 'client') {
        window.technicianVisitForm.clientSignature = null;
        document.getElementById('client-signature-placeholder').style.display = 'block';
        const pv = document.getElementById('client-signature-preview'); if (pv) pv.classList.remove('show');
      } else {
        window.technicianVisitForm.technicianSignature = null;
        document.getElementById('technician-signature-placeholder').style.display = 'block';
        const pv2 = document.getElementById('technician-signature-preview'); if (pv2) pv2.classList.remove('show');
      }
      checkSignatures();
    });

    // Save signature buttons
    document.getElementById(`save-${type}-signature`).addEventListener('click', () => {
      const signatureData = canvas.toDataURL('image/png');
      const preview = document.getElementById(`${type}-signature-preview`);

      if (type === 'client') {
        window.technicianVisitForm.clientSignature = signatureData;
        document.getElementById('client-signature-placeholder').style.display = 'none';
      } else {
        window.technicianVisitForm.technicianSignature = signatureData;
        document.getElementById('technician-signature-placeholder').style.display = 'none';
      }

      if (preview) {
        preview.innerHTML = `<img src="${signatureData}" alt="${type} signature" style="max-height: 100px;">`;
        preview.classList.add('show');
      }

      checkSignatures();
    });
  }


  function checkSignatures() {
    const nextToReviewBtn = document.getElementById('next-to-review');
    // Require only technician signature to proceed
    nextToReviewBtn.disabled = !window.technicianVisitForm.technicianSignature;
  }

  // Step navigation
  document.querySelectorAll('.next-step').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const nextStep = parseInt(e.target.dataset.next);
      if (validateStep(window.technicianVisitForm.currentStep)) {
        goToStep(nextStep);
      }
    });
  });

  document.querySelectorAll('.prev-step').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const prevStep = parseInt(e.target.dataset.prev);
      goToStep(prevStep);
    });
  });

  function goToStep(step) {
    // Update step indicators
    document.querySelectorAll('.step').forEach(stepEl => {
      const stepNum = parseInt(stepEl.dataset.step);
      stepEl.classList.remove('active', 'completed');
      if (stepNum < step) {
        stepEl.classList.add('completed');
      } else if (stepNum === step) {
        stepEl.classList.add('active');
      }
    });

    // Hide all step containers
    document.querySelectorAll('.step-container').forEach(container => {
      container.classList.remove('active');
    });

    // Show current step container
    document.getElementById(`step-${step}`).classList.add('active');

    // Update current step in global state
    window.technicianVisitForm.currentStep = step;

    // Initialize signatures if going to step 4
    if (step === 4 && !window.technicianVisitForm.clientSignatureCanvas) {
      setTimeout(initSignatureCanvases, 100);
    }

    // Generate review if going to step 5
    if (step === 5) {
      generateReview();
    }
  }

  function validateStep(step) {
    switch (step) {
      case 1:
        const company = window.technicianVisitForm.selectedCompany;
        const customLocation = document.getElementById('technician-custom-location').value.trim();

        // Allow submission if we have a selected company OR a custom location name
        if (!company && !customLocation) {
          showToast('Please select a company or enter a custom location', 'error');
          return false;
        }
        if (!window.technicianVisitForm.capturedLocation) {
          showToast('Please capture your location', 'error');
          return false;
        }
        return true;

      case 2:
        const visitType = document.getElementById('visit-type').value;
        const workCategory = document.getElementById('work-category').value;
        const workStatus = document.getElementById('work-status').value;
        const visitNotes = document.getElementById('visit-notes').value;

        if (!visitType || !workCategory || !workStatus || !visitNotes) {
          showToast('Please fill all required fields', 'error');
          return false;
        }

        if (workCategory === 'other' && !document.getElementById('other-category').value) {
          showToast('Please specify work category', 'error');
          return false;
        }

        if (workStatus === 'follow_up' && !document.getElementById('follow-up-notes').value) {
          showToast('Please provide follow-up notes', 'error');
          return false;
        }

        return true;

      case 3:
        // Photos are optional
        return true;

      case 4:
        // Client signature optional; technician signature required
        if (!window.technicianVisitForm.technicianSignature) {
          showToast('Technician signature is required', 'error');
          return false;
        }
        return true;

      default:
        return true;
    }
  }

  function generateReview() {
    const visitType = document.getElementById('visit-type');
    const workCategory = document.getElementById('work-category');
    const workStatus = document.getElementById('work-status');
    const otherCategory = document.getElementById('other-category');
    const followUpNotes = document.getElementById('follow-up-notes');
    const visitNotes = document.getElementById('visit-notes');
    const company = window.technicianVisitForm.selectedCompany;
    const capturedLocation = window.technicianVisitForm.capturedLocation;

    const summaryHTML = `
      <div class="review-item">
        <strong>Company:</strong> ${company ? company.name : 'Not selected'}
      </div>
      <div class="review-item">
        <strong>Visit Type:</strong> ${visitType.options[visitType.selectedIndex]?.text || 'Not selected'}
      </div>
      <div class="review-item">
        <strong>Work Category:</strong> ${workCategory.value === 'other' ? otherCategory.value : workCategory.options[workCategory.selectedIndex]?.text}
      </div>
      <div class="review-item">
        <strong>Work Status:</strong> ${workStatus.options[workStatus.selectedIndex]?.text || 'Not selected'}
      </div>
      ${workStatus.value === 'follow_up' ? `
        <div class="review-item">
          <strong>Follow-up Notes:</strong> ${followUpNotes.value}
        </div>
      ` : ''}
      <div class="review-item">
        <strong>Visit Notes:</strong> ${visitNotes.value}
      </div>
      <div class="review-item">
        <strong>Location:</strong> ${capturedLocation ? 'Captured ✓' : 'Not captured'}
      </div>
    `;

    document.getElementById('review-summary').innerHTML = summaryHTML;

    // Render photos
    const reviewPhotos = document.getElementById('review-photos');
    const photos = window.technicianVisitForm.photos;
    if (photos.length > 0) {
      reviewPhotos.innerHTML = photos.map((photo, index) => `
        <div class="photo-item">
          <img src="${photo.dataUrl}" alt="Visit photo ${index + 1}">
        </div>
      `).join('');
    } else {
      reviewPhotos.innerHTML = '<p class="text-muted">No photos uploaded</p>';
    }

    // Render signatures (client optional)
    document.getElementById('review-client-signature').innerHTML =
      window.technicianVisitForm.clientSignature ? `<img src="${window.technicianVisitForm.clientSignature}" alt="Client signature" style="max-height: 100px;" onerror="handleImageError(this)">` : 'Not provided';

    document.getElementById('review-technician-signature').innerHTML =
      window.technicianVisitForm.technicianSignature ? `<img src="${window.technicianVisitForm.technicianSignature}" alt="Technician signature" style="max-height: 100px;" onerror="handleImageError(this)">` : 'Not provided';

    // Enable submit only if technician signature exists (client signature optional)
    const submitBtn = document.getElementById('submit-technician-visit');
    submitBtn.disabled = !window.technicianVisitForm.technicianSignature;
  }

  // Submit visit
  document.getElementById('submit-technician-visit').addEventListener('click', async () => {
    if (!validateStep(window.technicianVisitForm.currentStep)) {
      showToast('Please complete all required fields', 'error');
      return;
    }

    const submitBtn = document.getElementById('submit-technician-visit');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';

    try {
      // Upload photos to storage
      const photoUrls = [];
      for (const photo of window.technicianVisitForm.photos) {
        const photoPath = `technician-photos/${currentUser.id}/${Date.now()}-${photo.file.name}`;
        const { error: uploadError } = await supabaseClient.storage
          .from('safitrack')
          .upload(photoPath, photo.file);

        if (!uploadError) {
          const { data: urlData } = supabaseClient.storage.from('safitrack').getPublicUrl(photoPath);
          photoUrls.push(urlData.publicUrl);
        }
      }

      const visitData = {
        technician_id: currentUser.id,

        // 1. Company ID: If selected company, save ID. If custom, save NULL.
        company_id: window.technicianVisitForm.selectedCompany ? window.technicianVisitForm.selectedCompany.id : null,

        // 2. Company Name: If selected company, save name. If custom, save the custom input value.
        // This ensures the "Name: Unknown Company" issue is fixed because we save the name here.
        company_name: window.technicianVisitForm.selectedCompany
          ? window.technicianVisitForm.selectedCompany.name
          : (document.getElementById('technician-custom-location').value.trim() || 'Custom Location'),

        visit_type: document.getElementById('visit-type').value,
        work_category: document.getElementById('work-category').value,
        other_work_category: document.getElementById('work-category').value === 'other' ?
          document.getElementById('other-category').value : null,
        work_status: document.getElementById('work-status').value,
        follow_up_notes: document.getElementById('work-status').value === 'follow_up' ?
          document.getElementById('follow-up-notes').value : null,
        visit_notes: document.getElementById('visit-notes').value,
        client_signature: window.technicianVisitForm.clientSignature,
        technician_signature: window.technicianVisitForm.technicianSignature,
        photos: photoUrls.length > 0 ? photoUrls : null,
        latitude: window.technicianVisitForm.capturedLocation.latitude,
        longitude: window.technicianVisitForm.capturedLocation.longitude,
        verified_location: true,
        created_at: new Date().toISOString()
      };

      const { error } = await supabaseClient
        .from('technician_visits')
        .insert([visitData]);

      if (error) throw error;

      showToast('Service visit submitted successfully!', 'success');

      // Clear form for next entry
      setTimeout(() => {
        loadView('technician-activity');
      }, 1500);

    } catch (err) {
      console.error('Error submitting visit:', err);
      showToast('Failed to submit visit: ' + err.message, 'error');
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-icon lucide-check"><path d="M20 6 9 17l-5-5"/></svg> Submit Visit';
    }
  });

  function initTechnicianLocationMap(company, userLocation) {
    if (window.technicianVisitForm.map) {
      window.technicianVisitForm.map.remove();
    }

    const map = L.map('technician-location-map').setView([userLocation.latitude, userLocation.longitude], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(map);

    // Add technician location marker
    L.marker([userLocation.latitude, userLocation.longitude])
      .addTo(map)
      .bindPopup('Your Location')
      .openPopup();

    // Add company location marker if available
    if (company.latitude && company.longitude) {
      L.marker([company.latitude, company.longitude])
        .addTo(map)
        .bindPopup(company.name);

      // Draw line between technician and company
      const latlngs = [
        [userLocation.latitude, userLocation.longitude],
        [company.latitude, company.longitude]
      ];
      L.polyline(latlngs, { color: '#4f46e5', weight: 2, dashArray: '5, 5' }).addTo(map);
    }

    // Store map reference
    window.technicianVisitForm.map = map;

    // ==========================================================
    // FIX: Force map to recalculate size
    // This prevents the "blank map" issue when initializing
    // on a container that was recently hidden (display: none -> block).
    // ==========================================================
    setTimeout(() => {
      map.invalidateSize();
    }, 100);
  }
}

window.selectTechnicianCompany = function (companyId) {
  const companies = window.companiesData;
  const company = companies.find(c => c.id === companyId);
  if (!company) return;

  // Update company name input
  document.getElementById('technician-company-name').value = company.name;

  // Show selected company info
  document.getElementById('selected-technician-company').style.display = 'block';
  document.getElementById('selected-technician-company-name').textContent = company.name;
  document.getElementById('selected-technician-company-address').textContent =
    company.description || 'No description';

  // Hide search results
  document.getElementById('technician-company-search-results').style.display = 'none';

  // CRITICAL FIX: Store the company in the global state
  window.technicianVisitForm.selectedCompany = company;

  // Enable verify location button
  document.getElementById('verify-technician-location').disabled = false;
};

// Allow selecting a custom company entered by the technician
window.selectCustomTechnicianCompany = function (name) {
  const company = {
    id: null,
    name: name,
    description: 'Custom entry'
  };

  document.getElementById('technician-company-name').value = company.name;
  document.getElementById('selected-technician-company').style.display = 'block';
  document.getElementById('selected-technician-company-name').textContent = company.name;
  document.getElementById('selected-technician-company-address').textContent = company.description;
  document.getElementById('technician-company-search-results').style.display = 'none';

  window.technicianVisitForm.selectedCompany = company;
  document.getElementById('verify-technician-location').disabled = false;
};

// ======================
// TECHNICIAN ACTIVITY VIEW
// ======================

// Update the renderTechnicianActivityView function to properly display photos
async function renderTechnicianActivityView() {
  const { data: visits, error } = await supabaseClient
    .from('technician_visits')
    .select(`
      *,
      companies(
        name,
        description
      )
    `)
    .eq('technician_id', currentUser.id)
    .order('created_at', { ascending: false });

  if (error) {
    viewContainer.innerHTML = renderError(error.message);
    return;
  }

  let html = `
    <div class="page-header">
      <h1 class="page-title">My Service Visits</h1>
      <p class="page-subtitle">${visits.length} service visits logged</p>
    </div>
  `;

  if (visits.length === 0) {
    html += `
      <div class="card">
        <div class="empty-state">
          <i class="fas fa-tools empty-state-icon"></i>
          <h3 class="empty-state-title">No service visits yet</h3>
          <p class="empty-state-description">Start logging your service visits to see them here.</p>
          <button class="btn btn-primary" onclick="loadView('technician-log-visit')">
            <i class="fas fa-plus"></i> Log Your First Visit
          </button>
        </div>
      </div>
    `;
  } else {
    visits.forEach(visit => {
      html += renderTechnicianVisitCard(visit);
    });
  }

  viewContainer.innerHTML = html;
}

function renderTechnicianVisitCard(visit) {
  const date = formatDate(visit.created_at);
  const companyName = visit.company_name || visit.companies?.name || 'Unknown Company';

  const workStatusLabels = {
    'completed': 'Completed',
    'partially_completed': 'Partially Completed',
    'pending': 'Pending',
    'follow_up': 'Follow-up Required'
  };

  const visitTypeLabels = {
    'installation': 'Installation',
    'maintenance': 'Maintenance',
    'repair': 'Repair',
    'inspection': 'Inspection',
    'emergency': 'Emergency / Call-out'
  };

  return `
    <div class="technician-visit-card">
      <div class="technician-visit-header">
        <div>
          <div class="technician-visit-company">${companyName}</div>
          <div class="text-muted" style="font-size: 0.875rem;">${date}</div>
        </div>
        <span class="work-status-badge ${visit.work_status}">
          ${workStatusLabels[visit.work_status]}
        </span>
      </div>
      
      <div class="technician-visit-meta">
        <span class="technician-visit-meta-item">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-wrench-icon lucide-wrench"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"/></svg>
          ${visitTypeLabels[visit.visit_type]}
        </span>
        <span class="technician-visit-meta-item">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-boxes-icon lucide-boxes"><path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z"/><path d="m7 16.5-4.74-2.85"/><path d="m7 16.5 5-3"/><path d="M7 16.5v5.17"/><path d="M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z"/><path d="m17 16.5-5-3"/><path d="m17 16.5 4.74-2.85"/><path d="M17 16.5v5.17"/><path d="M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z"/><path d="M12 8 7.26 5.15"/><path d="m12 8 4.74-2.85"/><path d="M12 13.5V8"/></svg>
          ${visit.work_category}
        </span>
        ${visit.latitude && visit.longitude ? `
          <span class="technician-visit-meta-item">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-pin-icon lucide-map-pin"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>
            Location captured
          </span>
        ` : ''}
      </div>

      ${visit.visit_notes ? `
        <div class="visit-notes mb-2">${visit.visit_notes}</div>
      ` : ''}

      ${visit.follow_up_notes ? `
        <div class="ai-insight">
          <div class="ai-insight-header">
            <i class="fas fa-exclamation-circle"></i> Follow-up Required
          </div>
          <div class="ai-insight-content">${visit.follow_up_notes}</div>
        </div>
      ` : ''}

          ${visit.photos && visit.photos.length > 0 ? `
        <div class="photo-grid mb-2" style="grid-template-columns: repeat(3, 1fr);">
          ${visit.photos.map((photo, index) => `
            <div class="photo-item" onclick="openPhotoModal('${photo}')">
              <img src="${photo}" alt="Visit photo ${index + 1}" style="width: 100%; height: 100%; object-fit: cover;" onerror="handleImageError(this)">
            </div>
          `).join('')}
          ${visit.photos.length > 3 ? `
            <div class="photo-item" style="background: var(--bg-tertiary); display: flex; align-items: center; justify-content: center;">
              <span class="text-muted">+${visit.photos.length - 3} more</span>
            </div>
          ` : ''}
        </div>
      ` : ''}

      <div class="flex items-center justify-between mt-2">
        <div class="flex gap-2">
          ${visit.client_signature ? `
            <span class="tag" style="background: var(--color-success-bg); color: var(--color-success);">
              <i class="fas fa-signature"></i> Client signed
            </span>
          ` : ''}
          ${visit.technician_signature ? `
            <span class="tag" style="background: var(--color-primary-bg); color: var(--color-primary);">
              <i class="fas fa-signature"></i> Technician signed
            </span>
          ` : ''}
        </div>
      </div>
    </div>
  `;
}


function renderTechnicianVisitCard(visit) {
  const date = formatDate(visit.created_at);
  const companyName = visit.company_name || visit.companies?.name || 'Unknown Company';

  const workStatusLabels = {
    'completed': 'Completed',
    'partially_completed': 'Partially Completed',
    'pending': 'Pending',
    'follow_up': 'Follow-up Required'
  };

  const visitTypeLabels = {
    'installation': 'Installation',
    'maintenance': 'Maintenance',
    'repair': 'Repair',
    'inspection': 'Inspection',
    'emergency': 'Emergency / Call-out'
  };

  const workCategoryLabels = {
    'electrical': 'Electrical',
    'solar': 'Solar',
    'networking': 'Networking',
    'mechanical': 'Mechanical',
    'other': visit.other_work_category || 'Other'
  };

  return `
    <div class="technician-visit-card">
      <div class="technician-visit-header">
        <div>
          <div class="technician-visit-company">${companyName}</div>
          <div class="text-muted" style="font-size: 0.875rem;">${date}</div>
        </div>
        <span class="work-status-badge ${visit.work_status}">
          ${workStatusLabels[visit.work_status]}
        </span>
      </div>
      
      <div class="technician-visit-meta">
        <span class="technician-visit-meta-item">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-wrench-icon lucide-wrench"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"/></svg>
          ${visitTypeLabels[visit.visit_type]}
        </span>
        <span class="technician-visit-meta-item">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-boxes-icon lucide-boxes"><path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z"/><path d="m7 16.5-4.74-2.85"/><path d="m7 16.5 5-3"/><path d="M7 16.5v5.17"/><path d="M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z"/><path d="m17 16.5-5-3"/><path d="m17 16.5 4.74-2.85"/><path d="M17 16.5v5.17"/><path d="M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z"/><path d="M12 8 7.26 5.15"/><path d="m12 8 4.74-2.85"/><path d="M12 13.5V8"/></svg>
          ${workCategoryLabels[visit.work_category]}
        </span>
        ${visit.latitude && visit.longitude ? `
          <span class="technician-visit-meta-item">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-pin-icon lucide-map-pin"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>
            Location captured
          </span>
        ` : ''}
      </div>

      ${visit.visit_notes ? `
        <div class="visit-notes mb-2">${visit.visit_notes}</div>
      ` : ''}

      ${visit.follow_up_notes ? `
        <div class="ai-insight">
          <div class="ai-insight-header">
            <i class="fas fa-exclamation-circle"></i> Follow-up Required
          </div>
          <div class="ai-insight-content">${visit.follow_up_notes}</div>
        </div>
      ` : ''}

          ${visit.photos && visit.photos.length > 0 ? `
        <div class="photo-grid mb-2" style="grid-template-columns: repeat(3, 1fr);">
          ${visit.photos.slice(0, 3).map(photo => `
            <div class="photo-item">
              <img src="${photo}" alt="Visit photo" onclick="openPhotoModal('${photo}')" onerror="handleImageError(this)">
            </div>
          `).join('')}
          ${visit.photos.length > 3 ? `
            <div class="photo-item" style="background: var(--bg-tertiary); display: flex; align-items: center; justify-content: center;">
              <span class="text-muted">+${visit.photos.length - 3} more</span>
            </div>
          ` : ''}
        </div>
      ` : ''}

      <div class="flex items-center justify-between mt-2">
        <div class="flex gap-2">
          ${visit.client_signature ? `
            <span class="tag" style="background: var(--color-success-bg); color: var(--color-success);">
              <i class="fas fa-signature"></i> Client signed
            </span>
          ` : ''}
          ${visit.technician_signature ? `
            <span class="tag" style="background: var(--color-primary-bg); color: var(--color-primary);">
              <i class="fas fa-signature"></i> Technician signed
            </span>
          ` : ''}
        </div>
        
        ${isManager ? `
          <button class="btn btn-sm btn-secondary" onclick="generateTechnicianVisitPDF('${visit.id}')">
            <i class="fas fa-file-pdf"></i> PDF
          </button>
        ` : ''}
      </div>
    </div>
  `;
}

// ======================
// TECHNICIANS DASHBOARD VIEW (for managers)
// ======================

async function renderTechniciansDashboardView() {
  // Fetch all technician visits with technician and company details
  const { data: visits, error: visitsError } = await supabaseClient
    .from('technician_visits')
    .select(`
      *,
      technician:profiles!technician_visits_technician_id_fkey(
        first_name,
        last_name,
        email
      ),
      companies(
        name,
        description
      )
    `)
    .order('created_at', { ascending: false });

  // Fetch all technicians
  const { data: technicians, error: techError } = await supabaseClient
    .from('profiles')
    .select('id, first_name, last_name, email')
    .eq('role', 'technician')
    .order('first_name', { ascending: true });

  if (visitsError || techError) {
    viewContainer.innerHTML = renderError('Error loading technician data');
    return;
  }

  // Calculate statistics
  const totalVisits = visits.length;
  const totalTechnicians = technicians.length;
  const todayVisits = visits.filter(v => {
    const visitDate = new Date(v.created_at).toDateString();
    return visitDate === new Date().toDateString();
  }).length;

  // Group visits by work status
  const statusCounts = {
    completed: visits.filter(v => v.work_status === 'completed').length,
    partially_completed: visits.filter(v => v.work_status === 'partially_completed').length,
    pending: visits.filter(v => v.work_status === 'pending').length,
    follow_up: visits.filter(v => v.work_status === 'follow_up').length
  };

  let html = `
    <div class="page-header">
      <h1 class="page-title">Technicians Dashboard</h1>
      <p class="page-subtitle">Monitor technician service visits</p>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${totalVisits}</div>
        <div class="stat-label">Total Service Visits</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${totalTechnicians}</div>
        <div class="stat-label">Active Technicians</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${todayVisits}</div>
        <div class="stat-label">Visits Today</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${statusCounts.completed}</div>
        <div class="stat-label">Completed</div>
      </div>
    </div>

    
    <!-- Filters -->
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Filter Visits</h3>
      </div>
      <div class="flex flex-wrap gap-2">
        <select class="form-control" style="width: auto;" id="filter-technician">
          <option value="">All Technicians</option>
          ${technicians.map(tech => `
            <option value="${tech.id}">${tech.first_name} ${tech.last_name}</option>
          `).join('')}
        </select>
        <select class="form-control" style="width: auto;" id="filter-status">
          <option value="">All Status</option>
          <option value="completed">Completed</option>
          <option value="partially_completed">Partially Completed</option>
          <option value="pending">Pending</option>
          <option value="follow_up">Follow-up Required</option>
        </select>
        <select class="form-control" style="width: auto;" id="filter-type">
          <option value="">All Types</option>
          <option value="installation">Installation</option>
          <option value="maintenance">Maintenance</option>
          <option value="repair">Repair</option>
          <option value="inspection">Inspection</option>
          <option value="emergency">Emergency</option>
        </select>
        <input type="date" class="form-control" style="width: auto;" id="filter-date">
        <button class="btn btn-secondary" id="clear-filters">
          Clear Filters
        </button>
      </div>
    </div>

    <!-- Visits List -->
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Recent Service Visits</h3>
        <span class="text-muted">${visits.length} total visits</span>
      </div>
      
      <div id="technician-visits-list">
  `;

  if (visits.length === 0) {
    html += `
      <div class="empty-state">
        <i class="fas fa-tools empty-state-icon"></i>
        <h3 class="empty-state-title">No service visits yet</h3>
        <p class="empty-state-description">Technicians will appear here when they start logging visits.</p>
      </div>
    `;
  } else {
    visits.slice(0, 20).forEach(visit => {
      html += renderTechnicianVisitCardForManager(visit);
    });
  }

  html += `
      </div>
      ${visits.length > 20 ? `
        <div class="text-center mt-3">
          <button class="btn btn-secondary" id="load-more-visits">
            Load More (${visits.length - 20} remaining)
          </button>
        </div>
      ` : ''}
    </div>
  `;

  viewContainer.innerHTML = html;

  // Technician locations map removed per request

  // Initialize filters
  initTechnicianFilters(visits, technicians);
}

function renderTechnicianVisitCardForManager(visit) {
  const date = formatDate(visit.created_at);
  // Use visit.company_name first (for custom locations), then fallback to joined companies data
  const companyName = visit.company_name || visit.companies?.name || 'Unknown Company';
  const technicianName = visit.technician ?
    `${visit.technician.first_name} ${visit.technician.last_name}` : 'Unknown Technician';

  const workStatusLabels = {
    'completed': 'Completed',
    'partially_completed': 'Partially Completed',
    'pending': 'Pending',
    'follow_up': 'Follow-up Required'
  };

  const visitTypeLabels = {
    'installation': 'Installation',
    'maintenance': 'Maintenance',
    'repair': 'Repair',
    'inspection': 'Inspection',
    'emergency': 'Emergency / Call-out'
  };

  return `
    <div class="technician-visit-card" 
        data-technician="${visit.technician_id}"
        data-status="${visit.work_status}"
        data-type="${visit.visit_type}"
        data-date="${new Date(visit.created_at).toISOString().split('T')[0]}">
      <div class="technician-visit-header">
        <div>
          <div class="technician-visit-company">${companyName}</div>
          <div class="text-prim" style="font-size: 0.875rem;">
            by ${technicianName} • ${date}
          </div>
        </div>
        <span class="work-status-badge ${visit.work_status}">
          ${workStatusLabels[visit.work_status]}
        </span>
      </div>
      
      <div class="technician-visit-meta">
        <span class="technician-visit-meta-item">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-wrench-icon lucide-wrench"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"/></svg>
          ${visitTypeLabels[visit.visit_type]}
        </span>
        <span class="technician-visit-meta-item">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-boxes-icon lucide-boxes"><path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z"/><path d="m7 16.5-4.74-2.85"/><path d="m7 16.5 5-3"/><path d="M7 16.5v5.17"/><path d="M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z"/><path d="m17 16.5-5-3"/><path d="m17 16.5 4.74-2.85"/><path d="M17 16.5v5.17"/><path d="M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z"/><path d="M12 8 7.26 5.15"/><path d="m12 8 4.74-2.85"/><path d="M12 13.5V8"/></svg>
          ${visit.work_category}
        </span>
        ${visit.latitude && visit.longitude ? `
          <span class="technician-visit-meta-item">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-pin-icon lucide-map-pin"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>
            ${visit.latitude.toFixed(4)}, ${visit.longitude.toFixed(4)}
          </span>
        ` : ''}
      </div>

      ${visit.visit_notes ? `
        <div class="visit-notes mb-2">${visit.visit_notes}</div>
      ` : ''}

      ${visit.follow_up_notes ? `
        <div class="ai-insight">
          <div class="ai-insight-header">
            <i class="fas fa-exclamation-circle"></i> Follow-up Required
          </div>
          <div class="ai-insight-content">${visit.follow_up_notes}</div>
        </div>
      ` : ''}

      <div class="flex items-center justify-between mt-2">
        <div class="flex gap-2">
          ${visit.photos && visit.photos.length > 0 ? `
            <span class="tag" style="background: var(--color-primary-bg); color: var(--color-primary);">
              <i class="fas fa-camera"></i> ${visit.photos.length} photo(s)
            </span>
          ` : ''}
          ${visit.client_signature ? `
            <span class="tag" style="background: var(--color-success-bg); color: var(--color-success);">
              <i class="fas fa-signature"></i> Client signed
            </span>
          ` : ''}
        </div>
        
        <div class="flex gap-2">
          ${visit.latitude && visit.longitude ? `
            <button class="btn btn-sm btn-ghost" onclick="viewLocationOnMap(${visit.latitude}, ${visit.longitude}, '${companyName}')">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-icon lucide-map"><path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/></svg>View Map
            </button>
          ` : ''}
          <button class="btn btn-sm btn-secondary" onclick="generateTechnicianVisitPDF('${visit.id}')">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-file-text-icon lucide-file-text"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>PDF
          </button>
          <button class="btn btn-sm btn-ghost" onclick="viewTechnicianVisitDetails('${visit.id}')">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-eye-icon lucide-eye"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>Details
          </button>
        </div>
      </div>
    </div>
  `;
}

function initTechniciansMap(visits) {
  const mapElement = document.getElementById('technicians-map');
  if (!mapElement) return;

  // Filter visits with valid coordinates
  const validVisits = visits.filter(v => v.latitude && v.longitude);

  if (validVisits.length === 0) {
    mapElement.innerHTML = `
      <div class="flex items-center justify-center h-full">
        <div class="text-center">
          <i class="fas fa-map-marker-alt text-4xl text-muted mb-2"></i>
          <p class="text-muted">No location data available</p>
        </div>
      </div>
    `;
    return;
  }

  // Initialize map
  const map = L.map('technicians-map').setView(
    [validVisits[0].latitude, validVisits[0].longitude],
    12
  );

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
  }).addTo(map);

  // Add markers for each visit
  const markers = validVisits.map(visit => {
    // Use visit.company_name first (for custom locations), then fallback to joined companies data
    const companyName = visit.company_name || visit.companies?.name || 'Unknown Company';
    const technicianName = visit.technician ?
      `${visit.technician.first_name} ${visit.technician.last_name}` : 'Unknown';

    const statusColors = {
      'completed': 'green',
      'partially_completed': 'orange',
      'pending': 'blue',
      'follow_up': 'red'
    };

    const marker = L.marker([visit.latitude, visit.longitude], {
      icon: L.divIcon({
        className: 'technician-marker',
        html: `
          <div style="
            background: ${statusColors[visit.work_status] || 'gray'};
            color: white;
            width: 24px;
            height: 24px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            font-weight: bold;
            border: 2px solid white;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
          ">
            <i class="fas fa-wrench"></i>
          </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      })
    })
      .addTo(map)
      .bindPopup(`
        <div style="min-width: 200px;">
          <strong>${companyName}</strong><br>
          <small>${technicianName}</small><br>
          <hr style="margin: 8px 0;">
          <div><strong>Type:</strong> ${visit.visit_type}</div>
          <div><strong>Status:</strong> ${visit.work_status}</div>
          <div><strong>Date:</strong> ${formatDate(visit.created_at)}</div>
          ${visit.visit_notes ? `<div><strong>Notes:</strong> ${visit.visit_notes.substring(0, 100)}${visit.visit_notes.length > 100 ? '...' : ''}</div>` : ''}
          <button class="btn btn-sm btn-primary w-full mt-2" onclick="viewTechnicianVisitDetails('${visit.id}')">
            View Details
          </button>
        </div>
      `);

    return marker;
  });

  // Fit map to show all markers
  if (markers.length > 0) {
    const group = new L.featureGroup(markers);
    map.fitBounds(group.getBounds().pad(0.1));
  }

  // Store map reference for refresh
  window.techniciansMap = map;
  window.techniciansMarkers = markers;
}

function initTechnicianFilters(visits, technicians) {
  const technicianFilter = document.getElementById('filter-technician');
  const statusFilter = document.getElementById('filter-status');
  const typeFilter = document.getElementById('filter-type');
  const dateFilter = document.getElementById('filter-date');
  const clearFiltersBtn = document.getElementById('clear-filters');
  const loadMoreBtn = document.getElementById('load-more-visits');

  let filteredVisits = [...visits];
  let displayedCount = 20;

  function applyFilters() {
    const technicianId = technicianFilter.value;
    const status = statusFilter.value;
    const type = typeFilter.value;
    const date = dateFilter.value;

    filteredVisits = visits.filter(visit => {
      if (technicianId && visit.technician_id !== technicianId) return false;
      if (status && visit.work_status !== status) return false;
      if (type && visit.visit_type !== type) return false;
      if (date) {
        const visitDate = new Date(visit.created_at).toISOString().split('T')[0];
        if (visitDate !== date) return false;
      }
      return true;
    });

    renderFilteredVisits();
  }

  function renderFilteredVisits() {
    const container = document.getElementById('technician-visits-list');
    const visitsToShow = filteredVisits.slice(0, displayedCount);

    if (visitsToShow.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-search empty-state-icon"></i>
          <h3 class="empty-state-title">No visits found</h3>
          <p class="empty-state-description">Try adjusting your filters</p>
        </div>
      `;
    } else {
      container.innerHTML = visitsToShow.map(visit =>
        renderTechnicianVisitCardForManager(visit)
      ).join('');
    }

    // Update load more button
    if (loadMoreBtn) {
      const remaining = filteredVisits.length - displayedCount;
      if (remaining > 0) {
        loadMoreBtn.innerHTML = `Load More (${remaining} remaining)`;
        loadMoreBtn.style.display = 'block';
      } else {
        loadMoreBtn.style.display = 'none';
      }
    }
  }

  // Add event listeners
  technicianFilter.addEventListener('change', applyFilters);
  statusFilter.addEventListener('change', applyFilters);
  typeFilter.addEventListener('change', applyFilters);
  dateFilter.addEventListener('change', applyFilters);

  clearFiltersBtn.addEventListener('click', () => {
    technicianFilter.value = '';
    statusFilter.value = '';
    typeFilter.value = '';
    dateFilter.value = '';
    displayedCount = 20;
    applyFilters();
  });

  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => {
      displayedCount += 20;
      renderFilteredVisits();
    });
  }

  // Technician locations map and refresh removed per request
}

// ======================
// PDF GENERATION FOR TECHNICIAN VISITS
// ======================

async function generateTechnicianVisitPDF(visitId) {
  showToast('Generating PDF report...', 'info');

  try {
    // Fetch visit data
    const { data: visit, error } = await supabaseClient
      .from('technician_visits')
      .select(`
        *,
        technician:profiles!technician_visits_technician_id_fkey(
          first_name,
          last_name,
          email
        ),
        companies(
          name,
          address,
          description
        )
      `)
      .eq('id', visitId)
      .single();

    if (error) throw error;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    let yPos = 20;

    // Color scheme
    const colors = {
      primary: [47, 95, 208],
      secondary: [99, 102, 241],
      success: [16, 185, 129],
      warning: [245, 158, 11],
      danger: [239, 68, 68],
      dark: [31, 41, 55],
      light: [243, 244, 246],
      white: [255, 255, 255]
    };

    // Helper: Add gradient header
    const addGradientHeader = () => {
      // Create gradient effect with overlapping rectangles
      doc.setFillColor(...colors.primary);
      doc.rect(0, 0, pageWidth, 50, 'F');

      doc.setFillColor(99, 102, 241, 0.3);
      doc.triangle(0, 0, pageWidth, 0, pageWidth, 50, 'F');
    };

    // Helper: Add footer
    const addFooter = (pageNum) => {
      doc.setFillColor(...colors.light);
      doc.rect(0, pageHeight - 15, pageWidth, 15, 'F');

      doc.setFontSize(8);
      doc.setTextColor(100, 100, 100);
      doc.text(`SafiTrack Service Report - Generated ${new Date().toLocaleDateString()}`, 20, pageHeight - 7);
      doc.text(`Page ${pageNum}`, pageWidth - 30, pageHeight - 7);
    };

    // Helper: Section header
    const addSectionHeader = (title, icon = '') => {
      if (yPos > pageHeight - 40) {
        doc.addPage();
        addGradientHeader();
        yPos = 60;
      }

      doc.setFillColor(...colors.primary);
      doc.roundedRect(20, yPos - 5, pageWidth - 40, 12, 2, 2, 'F');

      doc.setFontSize(12);
      doc.setTextColor(...colors.white);
      doc.setFont(undefined, 'bold');
      doc.text(title, 25, yPos + 3);

      yPos += 18;
      doc.setTextColor(...colors.dark);
      doc.setFont(undefined, 'normal');
    };

    // Helper: Info row with proper spacing
    const addInfoRow = (label, value) => {
      if (yPos > pageHeight - 25) {
        doc.addPage();
        addGradientHeader();
        addFooter(doc.internal.getNumberOfPages());
        yPos = 60;
      }

      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      doc.text('>', 22, yPos);

      doc.setFont(undefined, 'bold');
      doc.setTextColor(...colors.dark);
      doc.text(label + ':', 27, yPos);

      doc.setFont(undefined, 'normal');
      // Add extra spacing (3 spaces) after the colon
      const labelWidth = doc.getTextWidth(label + ':   ');

      // Handle long text with wrapping
      const maxWidth = pageWidth - 60;
      const lines = doc.splitTextToSize(value, maxWidth);

      lines.forEach((line, index) => {
        if (index === 0) {
          doc.text(line, 27 + labelWidth, yPos);
        } else {
          yPos += 6;
          if (yPos > pageHeight - 25) {
            doc.addPage();
            addGradientHeader();
            addFooter(doc.internal.getNumberOfPages());
            yPos = 60;
          }
          doc.text(line, 27 + labelWidth, yPos);
        }
      });

      yPos += 8;
    };

    // Helper: Status badge
    const addStatusBadge = (status) => {
      const statusConfig = {
        'completed': { color: colors.success, text: 'COMPLETED' },
        'partially_completed': { color: colors.warning, text: 'PARTIAL' },
        'pending': { color: colors.secondary, text: 'PENDING' },
        'follow_up': { color: colors.danger, text: 'FOLLOW-UP' }
      };

      const config = statusConfig[status] || statusConfig.pending;

      doc.setFillColor(...config.color);
      doc.roundedRect(pageWidth - 70, 15, 50, 10, 2, 2, 'F');

      doc.setFontSize(8);
      doc.setTextColor(...colors.white);
      doc.setFont(undefined, 'bold');
      doc.text(config.text, pageWidth - 67, 21);
      doc.setFont(undefined, 'normal');
    };

    // Helper: Fetch image with error handling
    const fetchImageAsBase64 = async (url) => {
      try {
        const response = await fetch(url);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch (err) {
        console.error('Error fetching image:', url, err);
        return null;
      }
    };

    // Fetch all media
    let photoDataUrls = [];
    if (visit.photos && visit.photos.length > 0) {
      showToast('Processing photos...', 'info');
      photoDataUrls = await Promise.all(visit.photos.map(url => fetchImageAsBase64(url)));
    }

    const clientSig = visit.client_signature ? await fetchImageAsBase64(visit.client_signature) : null;
    const techSig = visit.technician_signature ? await fetchImageAsBase64(visit.technician_signature) : null;

    // ==========================================
    // PAGE 1: HEADER & OVERVIEW
    // ==========================================
    let currentPage = 1;
    addGradientHeader();

    // Logo/Title - UPDATED
    doc.setFontSize(24);
    doc.setTextColor(...colors.white);
    doc.setFont(undefined, 'bold');
    doc.text('SafiTrack Technician Report', 20, 30);

    doc.setFontSize(11);
    doc.setFont(undefined, 'normal');
    doc.text('Service Visit Information', 20, 40);

    // Status badge
    addStatusBadge(visit.work_status);

    yPos = 60;

    // Report metadata box
    doc.setFillColor(250, 251, 252);
    doc.roundedRect(20, yPos, pageWidth - 40, 25, 3, 3, 'F');

    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text('REPORT ID:', 25, yPos + 7);
    doc.setTextColor(...colors.dark);
    doc.setFont(undefined, 'bold');
    doc.text(visit.id.substring(0, 16), 53, yPos + 7);

    doc.setFont(undefined, 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text('DATE:', 25, yPos + 14);
    doc.setTextColor(...colors.dark);
    doc.text(new Date(visit.created_at).toLocaleString(), 53, yPos + 14);

    doc.setTextColor(100, 100, 100);
    doc.text('GENERATED:', 25, yPos + 21);
    doc.setTextColor(...colors.dark);
    doc.text(new Date().toLocaleString(), 53, yPos + 21);

    yPos += 35;

    // Company Information
    addSectionHeader('LOCATION & COMPANY');
    const companyName = visit.company_name || visit.companies?.name || 'Unknown Location';
    addInfoRow('Company Name', companyName);

    if (visit.companies?.address) {
      addInfoRow('Address', visit.companies.address);
    }
    if (visit.companies?.description) {
      addInfoRow('Description', visit.companies.description);
    }
    if (visit.latitude && visit.longitude) {
      addInfoRow('Coordinates', `${visit.latitude.toFixed(6)}, ${visit.longitude.toFixed(6)}`);
    }

    yPos += 5;

    // Visit Details
    addSectionHeader('SERVICE DETAILS');

    const visitTypeLabels = {
      'installation': 'Installation',
      'maintenance': 'Maintenance',
      'repair': 'Repair',
      'inspection': 'Inspection',
      'emergency': 'Emergency / Call-out'
    };

    addInfoRow('Visit Type', visitTypeLabels[visit.visit_type] || visit.visit_type);

    const workCategory = visit.work_category + (visit.other_work_category ? ` (${visit.other_work_category})` : '');
    addInfoRow('Work Category', workCategory);

    const statusLabels = {
      'completed': 'Completed',
      'partially_completed': 'Partially Completed',
      'pending': 'Pending',
      'follow_up': 'Follow-up Required'
    };
    addInfoRow('Work Status', statusLabels[visit.work_status] || visit.work_status);

    yPos += 5;

    // Technician Info
    addSectionHeader('TECHNICIAN INFORMATION');
    if (visit.technician) {
      addInfoRow('Name', `${visit.technician.first_name} ${visit.technician.last_name}`);
      addInfoRow('Email', visit.technician.email);
    }

    // Add footer to first page
    addFooter(currentPage);

    // ==========================================
    // PAGE 2: NOTES & DETAILS
    // ==========================================
    doc.addPage();
    currentPage++;
    addGradientHeader();
    yPos = 60;

    // Visit Notes
    if (visit.visit_notes) {
      addSectionHeader('VISIT NOTES');

      doc.setFillColor(255, 251, 235);
      const notesLines = doc.splitTextToSize(visit.visit_notes, pageWidth - 50);
      const notesHeight = notesLines.length * 6 + 10;

      doc.roundedRect(20, yPos, pageWidth - 40, notesHeight, 3, 3, 'F');

      doc.setFontSize(10);
      doc.setTextColor(...colors.dark);

      notesLines.forEach((line, index) => {
        doc.text(line, 25, yPos + 8 + (index * 6));
      });

      yPos += notesHeight + 10;
    }

    // Follow-up Notes
    if (visit.follow_up_notes) {
      if (yPos > pageHeight - 60) {
        doc.addPage();
        currentPage++;
        addGradientHeader();
        addFooter(currentPage - 1);
        yPos = 60;
      }

      addSectionHeader('FOLLOW-UP REQUIRED');

      doc.setFillColor(254, 243, 199);
      const followUpLines = doc.splitTextToSize(visit.follow_up_notes, pageWidth - 50);
      const followUpHeight = followUpLines.length * 6 + 10;

      doc.roundedRect(20, yPos, pageWidth - 40, followUpHeight, 3, 3, 'F');

      doc.setFontSize(10);
      doc.setTextColor(...colors.dark);

      followUpLines.forEach((line, index) => {
        doc.text(line, 25, yPos + 8 + (index * 5));
      });

      yPos += followUpHeight + 10;
    }

    addFooter(currentPage);

    // ==========================================
    // PHOTOS SECTION
    // ==========================================
    if (photoDataUrls.length > 0) {
      doc.addPage();
      currentPage++;
      addGradientHeader();
      yPos = 60;

      addSectionHeader(`PHOTOS (${photoDataUrls.length} Total)`);

      const photosPerPage = 2;
      const photoWidth = pageWidth - 50;
      const photoHeight = 100;
      let photoCount = 0;

      for (let i = 0; i < photoDataUrls.length; i++) {
        const imgData = photoDataUrls[i];

        if (!imgData) continue;

        // Check if we need a new page
        if (yPos + photoHeight + 20 > pageHeight - 20) {
          addFooter(currentPage);
          doc.addPage();
          currentPage++;
          addGradientHeader();
          yPos = 60;

          if (photoCount % photosPerPage === 0) {
            addSectionHeader('PHOTOS (Continued)');
          }
        }

        try {
          // Add photo border/frame
          doc.setDrawColor(...colors.light);
          doc.setLineWidth(0.5);
          doc.roundedRect(20, yPos, photoWidth, photoHeight, 2, 2, 'S');

          // Add photo
          doc.addImage(imgData, 'JPEG', 22, yPos + 2, photoWidth - 4, photoHeight - 4);

          // Add photo caption
          doc.setFontSize(8);
          doc.setTextColor(100, 100, 100);
          doc.text(`Photo ${i + 1} of ${photoDataUrls.length}`, 25, yPos + photoHeight + 8);

          yPos += photoHeight + 15;
          photoCount++;

        } catch (err) {
          console.warn('Failed to add image:', err);
          doc.setFontSize(10);
          doc.setTextColor(...colors.danger);
          doc.text(`[Photo ${i + 1} could not be loaded]`, 25, yPos + 10);
          yPos += 20;
        }
      }

      addFooter(currentPage);
    }

    // ==========================================
    // SIGNATURES PAGE
    // ==========================================
    if (clientSig || techSig) {
      doc.addPage();
      currentPage++;
      addGradientHeader();
      yPos = 60;

      addSectionHeader('SIGNATURES');

      const sigWidth = (pageWidth - 50) / 2;
      const sigHeight = 60;

      // Client Signature
      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      doc.text('CLIENT SIGNATURE', 25, yPos);
      yPos += 8;

      if (clientSig) {
        try {
          doc.setDrawColor(...colors.light);
          doc.setLineWidth(0.5);
          doc.roundedRect(20, yPos, sigWidth, sigHeight, 2, 2, 'S');
          doc.addImage(clientSig, 'PNG', 22, yPos + 2, sigWidth - 4, sigHeight - 4);
        } catch (e) {
          doc.text('[Signature unavailable]', 25, yPos + 30);
        }
      } else {
        doc.setFillColor(...colors.light);
        doc.roundedRect(20, yPos, sigWidth, sigHeight, 2, 2, 'F');
        doc.setTextColor(150, 150, 150);
        doc.text('Not provided', 25, yPos + 30);
      }

      // Technician Signature
      doc.setTextColor(100, 100, 100);
      doc.text('TECHNICIAN SIGNATURE', pageWidth - sigWidth - 5, yPos - 8);

      if (techSig) {
        try {
          doc.setDrawColor(...colors.light);
          doc.roundedRect(pageWidth - sigWidth - 10, yPos, sigWidth, sigHeight, 2, 2, 'S');
          doc.addImage(techSig, 'PNG', pageWidth - sigWidth - 8, yPos + 2, sigWidth - 4, sigHeight - 4);
        } catch (e) {
          doc.text('[Signature unavailable]', pageWidth - sigWidth - 5, yPos + 30);
        }
      } else {
        doc.setFillColor(...colors.light);
        doc.roundedRect(pageWidth - sigWidth - 10, yPos, sigWidth, sigHeight, 2, 2, 'F');
        doc.setTextColor(150, 150, 150);
        doc.text('Not provided', pageWidth - sigWidth - 5, yPos + 30);
      }

      yPos += sigHeight + 20;

      // Certification statement
      doc.setFillColor(240, 253, 244);
      doc.roundedRect(20, yPos, pageWidth - 40, 25, 3, 3, 'F');

      doc.setFontSize(9);
      doc.setTextColor(...colors.dark);
      const certText = 'This service report certifies that the work described above was performed on the specified date. All information provided is accurate to the best of our knowledge.';
      const certLines = doc.splitTextToSize(certText, pageWidth - 50);

      certLines.forEach((line, index) => {
        doc.text(line, 25, yPos + 8 + (index * 5));
      });

      addFooter(currentPage);
    }

    // ==========================================
    // SAVE PDF
    // ==========================================
    const fileName = `SafiTrack_Service_Report_${companyName.replace(/\s+/g, '_')}_${new Date(visit.created_at).toISOString().split('T')[0]}.pdf`;

    doc.save(fileName);

    showToast('PDF generated successfully!', 'success');

  } catch (error) {
    console.error('Error generating PDF:', error);
    showToast('Failed to generate PDF: ' + error.message, 'error');
  }
}


// ======================
// UTILITY FUNCTIONS FOR TECHNICIANS
// ======================

window.viewLocationOnMap = function (latitude, longitude, title) {

  const oldModal = document.getElementById('location-modal');
  if (oldModal) {
    oldModal.remove();
  }


  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'flex';
  modal.id = 'location-modal';

  modal.innerHTML = `
    <div class="modal-backdrop" onclick="closeModal('location-modal')"></div>
    <div class="modal-container" style="max-width: 800px;">
      <div class="modal-header">
        <h3><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-locate-fixed-icon lucide-locate-fixed"><line x1="2" x2="5" y1="12" y2="12"/><line x1="19" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="5"/><line x1="12" x2="12" y1="19" y2="22"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/></svg>${title || 'Location'}</h3>
        <button class="modal-close" onclick="closeModal('location-modal')">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x-icon lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <div id="location-modal-map" style="height: 400px;"></div>
        <div class="mt-3">
          <p><strong>Coordinates:</strong> ${latitude.toFixed(6)}, ${longitude.toFixed(6)}</p>
          <a href="https://www.google.com/maps?q=${latitude},${longitude}" target="_blank" class="btn btn-sm btn-primary mt-2">
            <i class="fas fa-external-link-alt"></i> Open in Google Maps
          </a>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Initialize map
  setTimeout(() => {
    const map = L.map('location-modal-map').setView([latitude, longitude], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(map);

    L.marker([latitude, longitude])
      .addTo(map)
      .bindPopup(title || 'Visit Location')
      .openPopup();
  }, 100);
};

window.viewTechnicianVisitDetails = async function (visitId) {

  const oldModal = document.getElementById('visit-details-modal');
  if (oldModal) {
    oldModal.remove();
  }

  showToast('Loading visit details...', 'info');

  try {
    const { data: visit, error } = await supabaseClient
      .from('technician_visits')
      .select(`
        *,
        technician:profiles!technician_visits_technician_id_fkey(
          first_name,
          last_name,
          email
        ),
        companies(
          name,
          address,
          description
        )
      `)
      .eq('id', visitId)
      .single();

    if (error) throw error;


    const workStatusLabels = {
      'completed': 'Completed',
      'partially_completed': 'Partially Completed',
      'pending': 'Pending',
      'follow_up': 'Follow-up Required'
    };

    const visitTypeLabels = {
      'installation': 'Installation',
      'maintenance': 'Maintenance',
      'repair': 'Repair',
      'inspection': 'Inspection',
      'emergency': 'Emergency / Call-out'
    };

    const companyName = visit.company_name || visit.companies?.name || 'Unknown Location';
    const companyAddress = visit.companies?.address || 'N/A';
    const companyDescription = visit.companies?.description || 'N/A';

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.id = 'visit-details-modal';

    modal.innerHTML = `
      <div class="modal-backdrop" onclick="closeModal('visit-details-modal')"></div>
      <div class="modal-container" style="max-width: 800px;">
        <div class="modal-header">
          <h3>Service Visit Details</h3>
          <div class="flex gap-2">
            <button class="btn btn-sm btn-secondary" onclick="generateTechnicianVisitPDF('${visitId}')">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-file-text-icon lucide-file-text"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v9a2 2 0 0 1 2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg> PDF
            </button>
            <button class="modal-close" onclick="closeModal('visit-details-modal')">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x-icon lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
        </div>
        <div class="modal-body">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h4>Company Information</h4>
              <p><strong>Name:</strong> ${companyName}</p>
              ${visit.companies ? `<p><strong>Address:</strong> ${companyAddress}</p>` : ''}
              ${visit.companies ? `<p><strong>Description:</strong> ${companyDescription}</p>` : ''}
            </div>
            <div>
              <h4>Visit Information</h4>
              <p><strong>Visit Type:</strong> ${visit.visit_type}</p>
              <p><strong>Work Category:</strong> ${visit.work_category}${visit.other_work_category ? ` (${visit.other_work_category})` : ''}</p>
              <p><strong>Work Status:</strong> ${visit.work_status}</p>
            </div>
          </div>
          
          ${visit.latitude && visit.longitude ? `
            <div class="mt-4">
              <h4>Location</h4>
              <div id="visit-details-map" style="height: 200px; margin-top: 1rem;"></div>
            </div>
          ` : ''}

          ${visit.visit_notes ? `
            <div class="mt-4">
              <h4>Visit Notes</h4>
              <div class="bg-gray-50 p-3 rounded">${visit.visit_notes}</div>
            </div>
          ` : ''}

          ${visit.follow_up_notes ? `
            <div class="mt-4">
              <h4>Follow-up Required</h4>
              <div class="bg-yellow-50 p-3 rounded">${visit.follow_up_notes}</div>
            </div>
          ` : ''}
          
          ${visit.photos && visit.photos.length > 0 ? `
            <div class="mt-4">
              <h4>Photos (${visit.photos.length})</h4>
              <div class="photo-grid" style="grid-template-columns: repeat(3, 1fr);">
                ${visit.photos.slice(0, 3).map(photo => `
                  <div class="photo-item">
                    <img src="${photo}" alt="Visit photo" onclick="openPhotoModal('${photo}')" onerror="handleImageError(this)">
                  </div>
                `).join('')}
                ${visit.photos.length > 3 ? `
                  <div class="photo-item" style="background: var(--bg-tertiary); display: flex; align-items: center; justify-content: center;">
                    <span class="text-muted">+${visit.photos.length - 3} more</span>
                  </div>
                ` : ''}
              </div>
            </div>
          ` : ''}
          
          <div class="mt-4">
            <h4>Signatures</h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p class="text-sm text-muted">Client Signature</p>
                ${visit.client_signature ? `<img src="${visit.client_signature}" alt="Client signature" style="max-height: 100px;" onerror="handleImageError(this)">` : 'Not provided'}
              </div>
              <div>
                <p class="text-sm text-muted">Technician Signature</p>
                ${visit.technician_signature ? `<img src="${visit.technician_signature}" alt="Technician signature" style="max-height: 100px;" onerror="handleImageError(this)">` : 'Not provided'}
              </div>
            </div>
          </div>
          
          <div class="mt-4">
            <h4>Technician</h4>
            <p><strong>Name:</strong> ${visit.technician.first_name} ${visit.technician.last_name}</p>
            <p><strong>Email:</strong> ${visit.technician.email}</p>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="closeModal('visit-details-modal')">
            Close
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Initialize map if location exists
    if (visit.latitude && visit.longitude) {
      setTimeout(() => {
        const map = L.map('visit-details-map').setView([visit.latitude, visit.longitude], 16);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap'
        }).addTo(map);

        // FIX: Use the 'companyName' variable (calculated earlier in the function)
        // instead of visit.companies.name. This handles custom locations safely.
        L.marker([visit.latitude, visit.longitude])
          .addTo(map)
          .bindPopup(companyName)
          .openPopup();

        // FIX: Force size recalculation to prevent blank map in modal
        setTimeout(() => {
          map.invalidateSize();
        }, 200);
      }, 100);
    }

  } catch (error) {
    console.error('Error loading visit details:', error);
    showToast('Error loading visit details: ' + error.message, 'error');
  }
};


window.openPhotoModal = function (photoUrl) {

  const oldModal = document.getElementById('photo-modal');
  if (oldModal) {
    oldModal.remove();
  }

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'flex';
  modal.id = 'photo-modal';

  modal.innerHTML = `
    <div class="modal-backdrop" onclick="closeModal('photo-modal')"></div>
    <div class="modal-container" style="max-width: 90%; max-height: 90%;">
      <div class="modal-header">
        <h3><i class="fas fa-camera"></i> Photo</h3>
        <button class="modal-close" onclick="closeModal('photo-modal')">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x-icon lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>
      <div class="modal-body" style="display: flex; justify-content: center; align-items: center;">
        <img src="${photoUrl}" alt="Visit photo" style="max-width: 100%; max-height: 70vh; object-fit: contain;" onerror="handleImageError(this)">
      </div>
    </div>
  `;

  document.body.appendChild(modal);
};

// ==================== MENTION SYSTEM HELPERS ====================

function showMentionSuggestions(query, container) {
  const filteredPeople = allPeople.filter(person =>
    person.name.toLowerCase().includes(query.toLowerCase())
  );


  if (filteredPeople.length === 0) {
    container.innerHTML = '<div class="mention-suggestion">No people found</div>';
  } else {
    container.innerHTML = filteredPeople.map(person => `
      <div class="mention-suggestion" data-person-id="${person.id}">
        <div class="mention-avatar">${getInitials(person.name)}</div>
        <div class="mention-info">
          <div class="mention-name">${person.name}</div>
          <div class="mention-details">${person.email || ''} ${person.companies ? `• ${person.companies.name}` : ''}</div>
        </div>
      </div>
    `).join('');
  }

  container.style.display = 'block';
}

function setActiveMention(items, activeIndex) {
  items.forEach((item, index) => {
    item.classList.toggle('active', index === activeIndex);
  });
}

function insertMentionFromSuggestion(suggestionEl, textareaEl, startIndex, query, containerEl) {


  const personId = suggestionEl.dataset.personId;
  const person = allPeople.find(p => p.id === personId); // Use string comparison, not parseInt



  if (!person) {
    console.error('❌ Person not found with ID:', personId);
    return;
  }

  const text = textareaEl.value;
  const cursorPos = textareaEl.selectionStart;
  const beforeMention = text.substring(0, startIndex);
  // Calculate afterMention from cursor position (accounts for partial typing)
  const afterMention = text.substring(cursorPos);



  // Insert mention with styling markup
  const mentionHTML = `@${person.name}`;
  const newText = `${beforeMention}${mentionHTML} ${afterMention}`;
  textareaEl.value = newText;



  // Add to mentioned people array
  if (!mentionedPeople.find(p => p.id === personId)) {
    mentionedPeople.push({
      id: personId,
      name: person.name
    });

  }

  // Close suggestions
  containerEl.style.display = 'none';

  // Update cursor position (after the mention and space)
  const newCursorPos = beforeMention.length + mentionHTML.length + 1;
  textareaEl.focus();
  textareaEl.setSelectionRange(newCursorPos, newCursorPos);


}


// ======================
// SIDEBAR COLLAPSE LOGIC
// ======================

// ======================
// SIDEBAR COLLAPSE LOGIC (UPDATED WITH CUSTOM ICONS)
// ======================

document.addEventListener('DOMContentLoaded', () => {
  const sidebar = document.getElementById('sidebar');
  const sidebarToggle = document.getElementById('sidebar-toggle');

  if (!sidebar || !sidebarToggle) return;

  // Helper function to update the icon SVG based on sidebar state
  const updateSidebarIcon = () => {
    const isCollapsed = sidebar.classList.contains('collapsed');

    if (isCollapsed) {
      // Sidebar is HIDDEN (Collapsed): Show "Open" Icon (Arrows pointing OUT)
      sidebarToggle.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-panel-right-close-icon lucide-panel-right-close"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/><path d="m8 9 3 3-3 3"/></svg>`;
    } else {
      // Sidebar is VISIBLE (Expanded): Show "Close" Icon (Arrows pointing IN)
      sidebarToggle.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-panel-right-open-icon lucide-panel-right-open"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/><path d="m10 15-3-3 3-3"/></svg>`;
    }
  };


  // Helper to force layout update
  // Helper to force layout update
  const adjustMainContent = (isCollapsed) => {
    // Find the main content element
    const mainContent = document.querySelector('.main-content');

    if (isCollapsed) {
      // --- SIDEBAR IS COLLAPSED (60px) ---
      // 1. Calculate exact remaining width: Full Screen Width - Sidebar Width
      mainContent.style.width = 'calc(100vw - 60px)';

      // 2. Reduce margin to match the small sidebar
      mainContent.style.marginLeft = '60px';
    } else {
      // --- SIDEBAR IS EXPANDED (210px) ---
      // 1. Clear inline width so your existing CSS media query handles it
      mainContent.style.width = '';

      // 2. Clear inline margin so CSS handles it
      mainContent.style.marginLeft = '';
    }
  };


  // 1. Set the correct icon immediately on page load
  updateSidebarIcon();

  // 2. Add the click listener
  // Find your existing toggle listener and update it like this:
  sidebarToggle.addEventListener('click', () => {
    // Toggle the class
    const isNowCollapsed = sidebar.classList.toggle('collapsed');

    // Update the icon
    updateSidebarIcon();

    // <--- NEW: Force layout change --->
    adjustMainContent(isNowCollapsed);

    // Save state
    localStorage.setItem('sidebarCollapsed', isNowCollapsed);
  });

  // 3. Restore state on reload
  // Restore state on load
  const sidebarCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';

  if (sidebarCollapsed && window.innerWidth >= 768) {
    sidebar.classList.add('collapsed');
    updateSidebarIcon();

    // <--- NEW: Apply layout on load --->
    adjustMainContent(true);
  }

});

// Handle window resize to ensure icons stay correct if CSS forces a state change
window.addEventListener('resize', () => {
  const sidebar = document.getElementById('sidebar');
  const sidebarToggle = document.getElementById('sidebar-toggle');

  // If we switch to mobile, the sidebar is forced open/hidden by CSS media queries.
  // We force remove the collapsed class and reset the icon.
  if (window.innerWidth < 768) {
    sidebar.classList.remove('collapsed');
    // On mobile, the toggle button is usually hidden, but if visible:
    if (sidebarToggle) {
      sidebarToggle.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-panel-right-close-icon lucide-panel-right-close"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/><path d="m8 9 3 3-3 3"/></svg>`;
    }
  }
});


/**
 * Compress an image file
 * @param {File} file - The image file to compress
 * @param {number} quality - Compression quality (0.1 to 1.0)
 * @param {number} maxWidth - Maximum width (default 1200)
 * @param {number} maxHeight - Maximum height (default 1200)
 * @returns {Promise<File>} - Compressed file
 */
async function compressImage(file, quality = 0.6, maxWidth = 1200, maxHeight = 1200) {
  return new Promise((resolve, reject) => {
    // Create a canvas element
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // Create an image element
    const img = new Image();

    img.onload = function () {
      // Calculate new dimensions
      let { width, height } = img;

      // Calculate aspect ratio
      const aspectRatio = width / height;

      // Resize if dimensions exceed max values
      if (width > maxWidth || height > maxHeight) {
        if (width > height) {
          width = maxWidth;
          height = maxWidth / aspectRatio;
        } else {
          height = maxHeight;
          width = maxHeight * aspectRatio;
        }
      }

      // Set canvas dimensions
      canvas.width = width;
      canvas.height = height;

      // Draw and compress image
      ctx.drawImage(img, 0, 0, width, height);

      // Convert to blob with compression
      canvas.toBlob(
        (blob) => {
          if (blob) {
            // Create a new File object with the compressed blob
            const compressedFile = new File(
              [blob],
              `compressed_${file.name}`,
              {
                type: file.type,
                lastModified: Date.now()
              }
            );

            // Log compression results
            const originalSize = (file.size / 1024 / 1024).toFixed(2);
            const compressedSize = (blob.size / 1024 / 1024).toFixed(2);
            const savings = ((1 - blob.size / file.size) * 100).toFixed(0);

            console.log(`Image compression: ${originalSize}MB → ${compressedSize}MB (${savings}% reduction)`);

            resolve(compressedFile);
          } else {
            reject(new Error('Failed to compress image'));
          }
        },
        file.type,
        quality
      );
    };

    img.onerror = function () {
      reject(new Error('Failed to load image'));
    };

    // Load the image
    img.src = URL.createObjectURL(file);
  });
}



/**
 * Show compression progress
 * @param {string} message - Progress message
 */
function showCompressionProgress(message) {
  // Create or update progress toast
  let progressToast = document.getElementById('compression-progress-toast');

  if (!progressToast) {
    progressToast = document.createElement('div');
    progressToast.id = 'compression-progress-toast';
    progressToast.className = 'toast info';
    progressToast.style.position = 'fixed';
    progressToast.style.top = '20px';
    progressToast.style.right = '20px';
    progressToast.style.zIndex = '9999';
    document.body.appendChild(progressToast);
  }

  progressToast.innerHTML = `
    <i class="fas fa-compress fa-spin toast-icon"></i>
    <span class="toast-message">${message}</span>
  `;

  progressToast.style.display = 'flex';
}

function hideCompressionProgress() {
  const progressToast = document.getElementById('compression-progress-toast');
  if (progressToast) {
    progressToast.style.display = 'none';
  }
}