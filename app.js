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
  submitBtn.innerHTML = '<i class="fas fa-check"></i> Success!';
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
  
  // Update UI based on role
  updateUserDisplay(profile);
  updateNavigationForRole();

  // Load all people for mention functionality
  await loadAllPeople();

  // Load default view
  loadView(isManager ? 'team-dashboard' : 'log-visit');
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
  const managerBottomNav = document.querySelector('.bottom-nav-item.manager-only');
  const logVisitNav = document.querySelector('[data-view="log-visit"]');

  if (isManager) {
    managerNavSection.style.display = 'block';
    if (managerBottomNav) managerBottomNav.style.display = 'flex';
    // Hide log visit for managers in sidebar
    document.querySelectorAll('.sidebar-nav [data-view="log-visit"]').forEach(el => {
      el.style.display = 'none';
    });
  } else {
    managerNavSection.style.display = 'none';
    if (managerBottomNav) managerBottomNav.style.display = 'none';
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

  // Destroy existing charts
  Object.keys(chartInstances).forEach(chartId => {
    if (chartInstances[chartId]) {
      chartInstances[chartId].destroy();
      delete chartInstances[chartId];
    }
  });

  // Show loading skeleton
  viewContainer.innerHTML = renderSkeletonCards(3);

  // Small delay for smooth transition
  await new Promise(resolve => setTimeout(resolve, 200));

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

  let html = `
    <div class="page-header">
      <h1 class="page-title">Companies</h1>
      <p class="page-subtitle">${companies.length} companies</p>
    </div>

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
      
      <div class="companies-grid" id="companies-grid">
  `;

  if (companies.length === 0) {
    html += `
      <div class="empty-state">
        <i class="fas fa-building empty-state-icon"></i>
        <h3 class="empty-state-title">No companies yet</h3>
        <p class="empty-state-description">Add your first company to get started.</p>
        ${isManager ? `
          <button class="btn btn-primary" onclick="openCompanyModal()">
            <i class="fas fa-plus"></i> Add Company
          </button>
        ` : ''}
      </div>
    `;
  } else {
    companies.forEach(company => {
      const categories = company.company_categories.map(c => c.categories.name).join(', ');
      
      html += `
        <div class="company-card" data-id="${company.id}" data-name="${company.name.toLowerCase()}" data-description="${(company.description || '').toLowerCase()}">
          <div class="company-header">
            <div class="company-name">${company.name}</div>
            ${isManager ? `
              <div class="company-actions">
                <button class="action-btn edit-company" data-id="${company.id}" title="Edit company">
                  <i class="fas fa-edit"></i>
                </button>
                <button class="action-btn delete-company" data-id="${company.id}" title="Delete company">
                  <i class="fas fa-trash"></i>
                </button>
              </div>
            ` : ''}
          </div>
          
          ${company.description ? `<div class="company-description">${company.description}</div>` : ''}
          
          ${company.latitude && company.longitude ? `
            <div class="company-location">
              <i class="fas fa-map-marker-alt"></i>
              ${company.latitude.toFixed(6)}, ${company.longitude.toFixed(6)}
            </div>
          ` : ''}
          
          ${categories ? `
            <div class="company-categories">
              ${categories.split(', ').map(category => `
                <span class="company-category">${category}</span>
              `).join('')}
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

  // Initialize search functionality
  const searchInput = document.getElementById('companies-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();
      const companyCards = document.querySelectorAll('.company-card');
      
      companyCards.forEach(card => {
        const name = card.dataset.name;
        const description = card.dataset.description;
        
        if (query === '' || name.includes(query) || description.includes(query)) {
          card.style.display = 'block';
        } else {
          card.style.display = 'none';
        }
      });
      
      // Check if any companies are visible
      const visibleCards = Array.from(companyCards).filter(card => card.style.display !== 'none');
      const companiesGrid = document.getElementById('companies-grid');
      
      if (visibleCards.length === 0 && query !== '') {
        // Show no results message
        if (!document.getElementById('no-companies-results')) {
          const noResults = document.createElement('div');
          noResults.id = 'no-companies-results';
          noResults.className = 'empty-state';
          noResults.innerHTML = `
            <i class="fas fa-search empty-state-icon"></i>
            <h3 class="empty-state-title">No companies found</h3>
            <p class="empty-state-description">Try adjusting your search terms</p>
          `;
          companiesGrid.appendChild(noResults);
        }
      } else {
        // Remove no results message if it exists
        const noResults = document.getElementById('no-companies-results');
        if (noResults) {
          noResults.remove();
        }
      }
    });
  }

  // Initialize event listeners
  if (isManager) {
    document.getElementById('add-company-btn')?.addEventListener('click', () => {
      openCompanyModal();
    });

    // Initialize company action buttons
    document.querySelectorAll('.edit-company').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const companyId = btn.dataset.id;
        const company = companies.find(c => c.id === companyId);
        if (company) {
          openCompanyModal(company);
        }
      });
    });

    document.querySelectorAll('.delete-company').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const companyId = btn.dataset.id;
        const company = companies.find(c => c.id === companyId);
        
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
        
        showToast('Company deleted successfully', 'success');
        renderCompaniesView();
      });
    });
  }
}

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
  
  // Geocode button
  if (geocodeBtn) {
    geocodeBtn.addEventListener('click', async () => {
      const address = document.getElementById('company-address').value.trim();
      if (!address) {
        showToast('Please enter an address to geocode', 'error');
        return;
      }
      
      geocodeBtn.disabled = true;
      geocodeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Geocoding...';
      
      try {
        const geo = await geocodeAddress(address);
        
        // Update coordinates fields
        document.getElementById('company-latitude').value = geo.latitude.toFixed(6);
        document.getElementById('company-longitude').value = geo.longitude.toFixed(6);
        document.getElementById('company-radius').value = '200';
        
        // Hide manual section
        document.getElementById('manual-coords-section').classList.add('hidden');
        
        showToast('Address geocoded successfully', 'success');
      } catch (error) {
        showToast('Geocoding failed. Please enter coordinates manually', 'error');
      } finally {
        geocodeBtn.disabled = false;
        geocodeBtn.innerHTML = '<i class="fas fa-map-marker-alt"></i> Geocode Address';
      }
    });
  }
  
  // Use current location button
  if (useCurrentLocationBtn) {
    useCurrentLocationBtn.addEventListener('click', () => {
      if (navigator.geolocation) {
        useCurrentLocationBtn.disabled = true;
        useCurrentLocationBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Getting location...';
        
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
      
      useCurrentLocationBtn.disabled = false;
      useCurrentLocationBtn.innerHTML = 'Use Current Location';
    });
  }
  
  // Save company
  saveBtn.onclick = async () => {
    const name = document.getElementById('company-name-input').value.trim();
    const description = document.getElementById('company-description').value.trim();
    const address = document.getElementById('company-address').value.trim();
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

  let html = `
    <div class="page-header">
      <h1 class="page-title">People</h1>
      <p class="page-subtitle">${people.length} people</p>
    </div>

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
      
      <div class="people-grid" id="people-grid">
  `;

  if (people.length === 0) {
    html += `
      <div class="empty-state">
        <i class="fas fa-users empty-state-icon"></i>
        <h3 class="empty-state-title">No people yet</h3>
        <p class="empty-state-description">Add your first person to get started.</p>
        <button class="btn btn-primary" onclick="openPersonModal()">
          <i class="fas fa-plus"></i> Add Person
        </button>
      </div>
    `;
  } else {
    people.forEach(person => {
      const companyName = person.company ? person.company.name : 'No company';
      const opportunityName = person.opportunity ? person.opportunity.name : '';
      
      html += `
        <div class="person-card" data-id="${person.id}" 
             data-name="${person.name.toLowerCase()}" 
             data-email="${(person.email || '').toLowerCase()}" 
             data-company="${companyName.toLowerCase()}"
             data-job-title="${(person.job_title || '').toLowerCase()}">
          <div class="person-header">
            <div class="person-name">${person.name}</div>
            <div class="person-actions">
              <button class="action-btn edit-person" data-id="${person.id}" title="Edit person">
                <i class="fas fa-edit"></i>
              </button>
              <button class="action-btn delete-person" data-id="${person.id}" title="Delete person">
                <i class="fas fa-trash"></i>
              </button>
            </div>
          </div>
          
          ${person.email ? `
            <div class="person-contact-item">
              <i class="fas fa-envelope"></i>
              ${person.email}
            </div>
          ` : ''}
          
          <div class="person-company">
            <i class="fas fa-building"></i>
            ${companyName}
          </div>
          
          ${person.job_title ? `
            <div class="person-contact-item">
              <i class="fas fa-briefcase"></i>
              ${person.job_title}
            </div>
          ` : ''}
          
          ${person.phone_numbers && person.phone_numbers.length > 0 ? `
            <div class="person-contact">
              ${person.phone_numbers.map(phone => `
                <div class="person-contact-item">
                  <i class="fas fa-phone"></i>
                  ${phone}
                </div>
              `).join('')}
            </div>
          ` : ''}
          
          ${opportunityName ? `
            <div class="person-opportunity">
              <i class="fas fa-lightbulb"></i>
              ${opportunityName}
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
  window.companiesData = companies;
  window.opportunitiesData = opportunities;

  // Initialize search functionality
  const searchInput = document.getElementById('people-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();
      const personCards = document.querySelectorAll('.person-card');
      
      personCards.forEach(card => {
        const name = card.dataset.name;
        const email = card.dataset.email;
        const company = card.dataset.company;
        const jobTitle = card.dataset.jobTitle;
        
        if (query === '' || 
            name.includes(query) || 
            email.includes(query) || 
            company.includes(query) ||
            jobTitle.includes(query)) {
          card.style.display = 'block';
        } else {
          card.style.display = 'none';
        }
      });
      
      // Check if any people are visible
      const visibleCards = Array.from(personCards).filter(card => card.style.display !== 'none');
      const peopleGrid = document.getElementById('people-grid');
      
      if (visibleCards.length === 0 && query !== '') {
        // Show no results message
        if (!document.getElementById('no-people-results')) {
          const noResults = document.createElement('div');
          noResults.id = 'no-people-results';
          noResults.className = 'empty-state';
          noResults.innerHTML = `
            <i class="fas fa-search empty-state-icon"></i>
            <h3 class="empty-state-title">No people found</h3>
            <p class="empty-state-description">Try adjusting your search terms</p>
          `;
          peopleGrid.appendChild(noResults);
        }
      } else {
        // Remove no results message if it exists
        const noResults = document.getElementById('no-people-results');
        if (noResults) {
          noResults.remove();
        }
      }
    });
  }

  // Initialize event listeners
  document.getElementById('add-person-btn')?.addEventListener('click', () => {
    openPersonModal();
  });

  // Initialize person action buttons
  document.querySelectorAll('.edit-person').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const personId = btn.dataset.id;
      const person = people.find(p => p.id === personId);
      if (person) {
        openPersonModal(person);
      }
    });
  });

  document.querySelectorAll('.delete-person').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const personId = btn.dataset.id;
      const person = people.find(p => p.id === personId);
      
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
      
      showToast('Person deleted successfully', 'success');
      renderPeopleView();
    });
  });
}



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
        <i class="fas fa-plus"></i>
      </button>
    </div>
  `;
  personPhoneNumbers = [];
  
  // Populate company dropdown
  if (window.companiesData) {
    companySelect.innerHTML = '<option value="">Select a company</option>';
    window.companiesData.forEach(company => {
      companySelect.innerHTML += `<option value="${company.id}">${company.name}</option>`;
    });
  }
  
  // Populate opportunity dropdown
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
  document.addEventListener('click', (e) => {
    if (e.target.closest('.add-phone-btn')) {
      addPhoneNumber();
    }
  });
  
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
      } else {
        // Create new person
        result = await supabaseClient
          .from('people')
          .insert([personData]);
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
          <i class="fas fa-camera"></i>
          <span>Tap to take photo</span>
        </div>
        <div id="photo-preview" class="photo-preview"></div>
      </div>

      <div class="form-field">
        <label>Location Verification *</label>
        <button type="button" id="verify-location" class="btn btn-secondary w-full" disabled>
          <i class="fas fa-map-marker-alt"></i>
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
      companySearchResults.innerHTML = '<div class="search-result-item">No companies found</div>';
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
        <div class="mention-suggestion" data-person-id="${person.id}" onclick="selectMentionedPerson('${person.id}')">
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

  window.selectMentionedPerson = function(personId) {
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
          locationStatus.innerHTML = `<i class="fas fa-times-circle"></i> Error calculating distance. Please check company coordinates.`;
          verifyLocationBtn.disabled = false;
          verifyLocationBtn.innerHTML = '<i class="fas fa-map-marker-alt"></i> Verify Location';
          return;
        }

        const isWithinRadius = distance <= (window.selectedCompanyData.radius + accuracy);

        if (isWithinRadius) {
          locationStatus.className = 'location-status success';
          locationStatus.innerHTML = `<i class="fas fa-check-circle"></i> Location verified! You are ${distance.toFixed(0)}m from ${window.selectedCompanyData.name}`;
          locationVerified = true;
          submitBtn.disabled = false;
          initVerificationMap(userLat, userLng, window.selectedCompanyData);
        } else {
          locationStatus.className = 'location-status error';
          locationStatus.innerHTML = `<i class="fas fa-times-circle"></i> Too far from ${window.selectedCompanyData.name}. You are ${distance.toFixed(0)}m away (max: ${window.selectedCompanyData.radius}m)`;
          locationVerified = false;
          submitBtn.disabled = true;
        }

        verifyLocationBtn.disabled = false;
        verifyLocationBtn.innerHTML = '<i class="fas fa-map-marker-alt"></i> Verify Location';
      },
      (error) => {
        let errorMsg = 'Unable to get location';
        if (error.code === error.PERMISSION_DENIED) errorMsg = 'Location permission denied';
        if (error.code === error.POSITION_UNAVAILABLE) errorMsg = 'Location unavailable';
        if (error.code === error.TIMEOUT) errorMsg = 'Location request timed out';

        locationStatus.className = 'location-status error';
        locationStatus.innerHTML = `<i class="fas fa-times-circle"></i> ${errorMsg}`;
        verifyLocationBtn.disabled = false;
        verifyLocationBtn.innerHTML = '<i class="fas fa-map-marker-alt"></i> Verify Location';
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
window.selectCompany = function(companyId) {
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
          <i class="fas fa-clipboard-list empty-state-icon"></i>
          <h3 class="empty-state-title">No visits yet</h3>
          <p class="empty-state-description">Start logging your field visits to see them here.</p>
          <button class="btn btn-primary" onclick="loadView('log-visit')">
            <i class="fas fa-plus"></i> Log Your First Visit
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
        ${visit.contact_name ? `<span class="visit-meta-item"><i class="fas fa-user"></i> ${visit.contact_name}</span>` : ''}
        ${visit.location_name ? `<span class="visit-meta-item"><i class="fas fa-map-marker-alt"></i> ${visit.location_name}</span>` : ''}
        ${visit.visit_type ? `<span class="visit-meta-item"><i class="fas fa-tag"></i> ${visit.visit_type.replace('_', ' ')}</span>` : ''}
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
          <img src="${visit.photo_url}" alt="Visit photo">
        </div>
      ` : ''}

      <div class="visit-notes">${processedNotes}</div>

      ${visit.ai_summary ? `
        <div class="ai-insight">
          <div class="ai-insight-header">
            <i class="fas fa-robot"></i> AI Summary
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
        <i class="fas fa-plus"></i> Add 
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
      
      // Process mentioned people in notes
      let processedNotes = opp.notes || '';
      if (opp.mentioned_people && opp.mentioned_people.length > 0) {
        opp.mentioned_people.forEach(person => {
          const mentionPattern = new RegExp(`@${person.name} \\(${person.id}\\)`, 'g');
          processedNotes = processedNotes.replace(mentionPattern, `<span class="mentioned-person">@${person.name}</span>`);
        });
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
              <i class="fas fa-user"></i> ${ownerName}
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
            <div class="opportunity-notes">
              ${processedNotes.length > 100 ? processedNotes.substring(0, 100) + '...' : processedNotes}
            </div>
          ` : ''}
          
          <div class="opportunity-actions">
            <div class="opportunity-date">${formatDate(opp.created_at)}</div>
            <div class="opportunity-menu">
              ${isOwnOpportunity ? `
                <button class="opportunity-action-btn edit-opportunity" data-id="${opp.id}">
                  <i class="fas fa-edit"></i>
                </button>
                <button class="opportunity-action-btn delete-opportunity" data-id="${opp.id}">
                  <i class="fas fa-trash"></i>
                </button>
              ` : `
                <button class="opportunity-action-btn view-opportunity" data-id="${opp.id}">
                  <i class="fas fa-eye"></i>
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
      onStart: function(evt) {
        evt.item.classList.add('dragging');
      },
      onEnd: function(evt) {
        evt.item.classList.remove('dragging');
      },
      onAdd: async function(evt) {
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
    const opportunities = stage.querySelectorAll('.opportunity-card:not([style*="opacity: 0.5"])');
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
        totalValue += parseFloat(valueText.replace(/[$,]/g, ''));
      }
    });
    
    const valueElement = stage.querySelector('.pipeline-stage-value');
    if (valueElement) {
      valueElement.textContent = `$${totalValue.toLocaleString()}`;
    }
  });
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
          const value = parseFloat(valueText.replace(/[$,]/g, ''));
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
  
  probabilitySlider.addEventListener('input', () => {
    probabilityDisplay.textContent = probabilitySlider.value;
  });
  
  // Company search
  const companyInput = document.getElementById('opportunity-company');
  const companySearchResults = document.getElementById('opportunity-company-search-results');
  
  companyInput.addEventListener('input', async (e) => {
    const query = e.target.value.toLowerCase().trim();
    
    if (query.length === 0) {
      companySearchResults.style.display = 'none';
      return;
    }
    
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
  });
  
  // Initialize mention system for notes
  const notesEl = document.getElementById('opportunity-notes');
  const mentionSuggestions = document.getElementById('opportunity-mention-suggestions');
  
  if (!mentionSuggestions) {
    // Create mention suggestions container if it doesn't exist
    const mentionContainer = document.createElement('div');
    mentionContainer.className = 'mention-container';
    mentionContainer.innerHTML = `
      <textarea id="opportunity-notes" placeholder="Additional details about this opportunity..." rows="3"></textarea>
      <div id="opportunity-mention-suggestions" class="mention-suggestions" style="display: none;"></div>
    `;
    
    // Replace original textarea with new container
    const originalTextarea = document.getElementById('opportunity-notes');
    originalTextarea.parentNode.replaceChild(mentionContainer, originalTextarea);
    
    // Get function new textarea element
    const newNotesEl = document.getElementById('opportunity-notes');
    
    // Copy value from original textarea
    newNotesEl.value = originalTextarea.value;
    
    // Initialize mention system for new textarea
    let mentionStartIndex = -1;
    let currentMentionQuery = '';
    
    newNotesEl.addEventListener('input', (e) => {
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
          showOpportunityMentionSuggestions(currentMentionQuery);
        } else {
          hideOpportunityMentionSuggestions();
        }
      } else {
        hideOpportunityMentionSuggestions();
        mentionStartIndex = -1;
        currentMentionQuery = '';
      }
    });
    
    // Handle mention selection
    newNotesEl.addEventListener('keydown', (e) => {
      if (document.getElementById('opportunity-mention-suggestions').style.display !== 'none') {
        const items = document.getElementById('opportunity-mention-suggestions').querySelectorAll('.mention-suggestion');
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
          updateActiveOpportunityMention(items, activeIndex);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          activeIndex = activeIndex <= 0 ? items.length - 1 : activeIndex - 1;
          updateActiveOpportunityMention(items, activeIndex);
        } else if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          if (activeIndex >= 0) {
            selectOpportunityMentionedPerson(items[activeIndex].dataset.personId);
          }
        } else if (e.key === 'Escape') {
          hideOpportunityMentionSuggestions();
        }
      }
    });
    
    // Handle click outside to close suggestions
    document.addEventListener('click', (e) => {
      if (e.target !== newNotesEl && !document.getElementById('opportunity-mention-suggestions').contains(e.target)) {
        hideOpportunityMentionSuggestions();
      }
    });
    
    function showOpportunityMentionSuggestions(query) {
      const filteredPeople = allPeople.filter(person => 
        person.name.toLowerCase().includes(query.toLowerCase())
      );
      
      if (filteredPeople.length === 0) {
        document.getElementById('opportunity-mention-suggestions').innerHTML = '<div class="mention-suggestion">No people found</div>';
      } else {
        document.getElementById('opportunity-mention-suggestions').innerHTML = filteredPeople.map(person => `
          <div class="mention-suggestion" data-person-id="${person.id}" onclick="selectOpportunityMentionedPerson('${person.id}')">
            <div class="mention-avatar">${getInitials(person.name)}</div>
            <div class="mention-info">
              <div class="mention-name">${person.name}</div>
              <div class="mention-details">${person.email || ''} ${person.companies ? `• ${person.companies.name}` : ''}</div>
            </div>
          </div>
        `).join('');
      }
      
      document.getElementById('opportunity-mention-suggestions').style.display = 'block';
    }
    
    function hideOpportunityMentionSuggestions() {
      document.getElementById('opportunity-mention-suggestions').style.display = 'none';
    }
    
    function updateActiveOpportunityMention(items, activeIndex) {
      items.forEach((item, index) => {
        item.classList.toggle('active', index === activeIndex);
      });
    }
    
    window.selectOpportunityMentionedPerson = function(personId) {
      const person = allPeople.find(p => p.id === parseInt(personId));
      if (!person) return;
      
      const text = newNotesEl.value;
      const beforeMention = text.substring(0, mentionStartIndex);
      const afterMention = text.substring(mentionStartIndex + currentMentionQuery.length + 1);
      
      // Replace with mention format
      newNotesEl.value = `${beforeMention}@${person.name} (${person.id})${afterMention}`;
      
      // Add to mentioned people array
      if (!mentionedPeople.find(p => p.id === parseInt(personId))) {
        mentionedPeople.push({
          id: parseInt(personId),
          name: person.name
        });
      }
      
      // Reset mention state
      hideOpportunityMentionSuggestions();
      mentionStartIndex = -1;
      currentMentionQuery = '';
      
      // Update cursor position
      const newCursorPos = beforeMention.length + person.name.length + person.id.toString().length + 4;
      newNotesEl.focus();
      newNotesEl.setSelectionRange(newCursorPos, newCursorPos);
    };
  }
  
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

window.removeCompetitor = function(element) {
  element.parentElement.remove();
};

window.selectOpportunityCompany = function(name) {
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
  console.log('Loading Team Dashboard for user:', currentUser.id); // Debug log
  
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
            <i class="fas fa-times"></i> Clear
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

window.selectRep = function(repId) {
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
          ${user.role === 'manager' ? 'Manager' : 'Sales Rep'}
        </span>
        ${!isCurrentUser ? `
          <button class="btn btn-ghost btn-sm" onclick="deleteUser('${user.id}', '${user.first_name} ${user.last_name}')">
            <i class="fas fa-trash text-danger"></i>
          </button>
        ` : ''}
      </div>
    `;
  });

  viewContainer.innerHTML = html;
}

window.deleteUser = async function(userId, userName) {
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
            <i class="fas fa-lightbulb"></i> AI Recommendation
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
                  <i class="fas fa-eye"></i>
                </button>
                <button class="btn btn-sm btn-ghost edit-route-btn" data-id="${route.id}">
                  <i class="fas fa-edit"></i>
                </button>
                <button class="btn btn-sm btn-ghost delete-route-btn" data-id="${route.id}">
                  <i class="fas fa-trash text-danger"></i>
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
      createBtn.innerHTML = '<i class="fas fa-times"></i> Cancel';
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
        <p>Based on your selection of <strong>${lastSelected.name}</strong>, nearest location is <strong>${nearestLocation.name}</strong> (${(shortestDistance/1000).toFixed(2)} km away).</p>
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
          optimizedRoute[i+1].latitude, 
          optimizedRoute[i+1].longitude
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
      onEnd: function(evt) {
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
window.selectRecommendedLocation = function(locationId) {
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
          <h3><i class="fas fa-route"></i> ${route.name}</h3>
          <button class="modal-close" onclick="closeModal('route-details-modal')">
            <i class="fas fa-times"></i>
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
            <i class="fas fa-route empty-state-icon"></i>
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
                <i class="fas fa-play"></i> Start Route
              </button>
            </div>

            <div class="route-summary">
              <p><strong>Created:</strong> ${formatDate(route.created_at)}</p>
              ${
                route.estimated_duration
                  ? `<p><strong>Est. duration:</strong> ${route.estimated_duration} min</p>`
                  : ''
              }
              ${
                route.total_distance
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
            <i class="fas fa-check"></i> Complete
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
                  <i class="fas fa-check-circle"></i> I've Arrived
                </button>
                <button class="btn btn-secondary" id="get-directions-btn">
                  <i class="fas fa-directions"></i> Get Directions
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
                    html: '<div class="user-marker-icon"><i class="fas fa-user"></i></div>',
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
    // Managers can see all tasks with user info
    // Using explicit join syntax instead of relationship syntax
    const result = await supabaseClient
      .from('tasks')
      .select(`
        *,
        assigned_to_profile:profiles!tasks_assigned_to_fkey(first_name, last_name, email),
        created_by_profile:profiles!tasks_created_by_fkey(first_name, last_name, email)
      `)
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
          <i class="fas fa-plus"></i> Add
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
  
  // Sales reps can only edit tasks they created themselves
  // Managers can edit tasks they created or those assigned to sales reps
  const canEdit = (isManager && !isAssignedToMe) || 
                  (!isManager && isCreatedByMe) || 
                  (isManager && isCreatedByManager);
  
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
            <i class="fas fa-calendar"></i>
            <span>Due: ${dueDateStr}</span>
            ${isOverdue ? '<i class="fas fa-exclamation-triangle"></i>' : ''}
          </div>
        ` : ''}
        
        <div class="task-meta-item">
          <i class="fas fa-flag"></i>
          <span>Priority: ${task.priority || 'medium'}</span>
        </div>
        
        ${isManager || task.assigned_to ? `
          <div class="task-meta-item">
            <i class="fas fa-user"></i>
            <span>Assigned to: ${assignedToName}</span>
          </div>
        ` : ''}
      </div>
      
      <div class="task-actions">
        <div class="task-priority ${task.priority || 'medium'}">${(task.priority || 'medium').charAt(0).toUpperCase() + (task.priority || 'medium').slice(1)}</div>
        <div class="task-action-buttons">
          ${canEdit ? `
            <button class="task-action-btn edit-task" data-id="${task.id}">
              <i class="fas fa-edit"></i>
            </button>
            ${task.status !== 'completed' ? `
              <button class="task-action-btn complete-task" data-id="${task.id}">
                <i class="fas fa-check-circle"></i>
              </button>
            ` : ''}
          ` : ''}
          ${isManager || isCreatedByMe ? `
            <button class="task-action-btn delete-task" data-id="${task.id}">
              <i class="fas fa-trash"></i>
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
    // Managers can see all reminders with user info
    // Using explicit join syntax instead of relationship syntax
    const result = await supabaseClient
      .from('reminders')
      .select(`
        *,
        assigned_to_profile:profiles!reminders_assigned_to_fkey(first_name, last_name, email),
        created_by_profile:profiles!reminders_created_by_fkey(first_name, last_name, email)
      `)
      .order('reminder_date', { ascending: true });
    
    reminders = result.data;
    error = result.error;
  } else {
    // Sales reps only see reminders assigned to them or created by them
    const result = await supabaseClient
      .from('reminders')
      .select('*')
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
          <i class="fas fa-plus"></i> Add
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
  const dueReminders = reminders.filter(r => {
    const reminderDate = new Date(r.reminder_date);
    const now = new Date();
    return reminderDate <= now && !r.is_completed;
  });

  if (dueReminders.length > 0) {
    html += `
      <div class="reminder-notification" id="reminder-notification">
        <div class="reminder-notification-header">
          <i class="fas fa-bell"></i>
          <span>You have ${dueReminders.length} due reminder${dueReminders.length > 1 ? 's' : ''}</span>
          <button class="reminder-notification-close" id="close-notification">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="reminder-notification-content">
          ${dueReminders.slice(0, 3).map(reminder => `
            <div class="reminder-notification-item">
              <div class="reminder-notification-title">${reminder.title}</div>
              <div class="reminder-notification-time">${formatDate(reminder.reminder_date, true)}</div>
              <div class="reminder-notification-actions">
                <button class="btn btn-sm btn-primary complete-reminder-notification" data-id="${reminder.id}">
                  <i class="fas fa-check"></i> Complete
                </button>
                <button class="btn btn-sm btn-secondary dismiss-reminder-notification" data-id="${reminder.id}">
                  <i class="fas fa-clock"></i> Dismiss
                </button>
              </div>
            </div>
          `).join('')}
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
      const isOwnReminder = !isManager || reminder.assigned_to === currentUser.id;
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
                <i class="fas fa-calendar"></i>
                <span>${formatDate(reminder.reminder_date)}</span>
                ${isOverdue ? '<i class="fas fa-exclamation-triangle"></i>' : ''}
              </div>
            ` : ''}
            
            ${isManager || reminder.assigned_to ? `
              <div class="reminder-meta-item">
                <i class="fas fa-user"></i>
                <span>Assigned to: ${assignedToName}</span>
              </div>
            ` : ''}
            
            ${isManager && createdByUser ? `
              <div class="reminder-meta-item">
                <i class="fas fa-user-plus"></i>
                <span>Created by: ${createdByName}</span>
              </div>
            ` : ''}
          </div>
          
          <div class="reminder-actions">
            <div class="reminder-date">
              <i class="fas fa-bell"></i>
              ${formatDate(reminder.reminder_date, true)}
            </div>
            <div class="reminder-action-buttons">
              ${isOwnReminder ? `
                <button class="reminder-action-btn edit-reminder" data-id="${reminder.id}">
                  <i class="fas fa-edit"></i>
                </button>
                ${!reminder.is_completed ? `
                  <button class="reminder-action-btn complete-reminder" data-id="${reminder.id}">
                    <i class="fas fa-check-circle"></i>
                  </button>
                ` : ''}
              ` : ''}
              ${isManager || isCreatedByManager ? `
                <button class="reminder-action-btn delete-reminder" data-id="${reminder.id}">
                  <i class="fas fa-trash"></i>
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

window.closeModal = function(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.style.display = 'none';
  // For dynamically created modals
  if (!modal) {
    document.querySelectorAll('.modal').forEach(m => {
      if (m.id === modalId) m.remove();
    });
  }
};

window.setDateRange = function(range, btn) {
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

window.executeExport = async function() {
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
  const icon = themeToggle?.querySelector('i');
  if (icon) {
    icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
  }
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
window.addTag = function(tag) {
  if (!visitTags.includes(tag)) {
    visitTags.push(tag);
    renderTags();
  }
};

window.removeTag = function(tag) {
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

window.showConfirmDialog = function(title, message) {
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

window.executeCommand = function(commandId) {
  const command = commands.find(cmd => cmd.id === commandId);
  if (command) {
    command.action();
    closeCommandPalette();
  }
};