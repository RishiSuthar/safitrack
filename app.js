const SUPABASE_URL = 'https://ndrkncirkekpqjjkasiy.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5kcmtuY2lya2VrcHFqamthc2l5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU2MDU2MTEsImV4cCI6MjA4MTE4MTYxMX0.SGVLqU6-u1ALj_P1nsyytYe7cNbAyxCVbV6kjAaiGU4';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = null;
let isManager = false;
let currentView = 'log-visit';
let visitTags = [];
let chartInstances = {};
let selectedRepId = null;

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
  // Auth form toggles

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
    submitBtn.innerHTML = '<span>Sign In</span><i class="fas fa-arrow-right"></i>';
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

  // Load default view
  loadView(isManager ? 'team-dashboard' : 'log-visit');
}

function updateUserDisplay(profile) {
  const displayName = profile.first_name ? `${profile.first_name} ${profile.last_name || ''}` : currentUser.email;
  const initials = getInitials(displayName);
  const email = profile.email || currentUser.email;

  // Update header avatar
  document.getElementById('user-avatar').textContent = initials;
  document.getElementById('user-display-name').textContent = displayName;
  document.getElementById('user-display-email').textContent = email;

  // Update sidebar
  document.getElementById('sidebar-user-avatar').textContent = initials;
  document.getElementById('sidebar-user-name').textContent = displayName;
  document.getElementById('sidebar-user-role').textContent = isManager ? 'Manager' : 'Sales Rep';
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
      if (isManager) {
        await renderUserManagementView();
      } else {
        viewContainer.innerHTML = renderAccessDenied();
      }
      break;
    default:
      viewContainer.innerHTML = renderNotFound();
  }
  checkDueReminders();

}

// ======================
// LOG VISIT VIEW
// ======================

async function renderLogVisitView() {
  const { data: locations } = await supabaseClient
    .from('locations')
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

      <div class="form-field" id="selected-location" style="display: none;">
        <label>Visit Location</label>
        <div class="selected-location-info">
          <div id="selected-location-name"></div>
          <div id="selected-location-address" class="text-muted"></div>
        </div>
      </div>

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
        <textarea id="notes" placeholder="What happened during the visit? Key takeaways, objections, next steps..." rows="5" required></textarea>
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
        <i class="fas fa-check"></i>
        Save Visit
      </button>
    </div>
  `;

  initLogVisitForm(locations);
}

function initLogVisitForm(locations) {
  const companyNameInput = document.getElementById('company-name');
  const companySearchResults = document.getElementById('company-search-results');
  const selectedLocationDiv = document.getElementById('selected-location');
  const selectedLocationName = document.getElementById('selected-location-name');
  const selectedLocationAddress = document.getElementById('selected-location-address');
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

  let locationVerified = false;
  let map = null;

  // Store for global access
  window.locationsData = locations;

  // Company search functionality
  companyNameInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    
    if (query.length === 0) {
      companySearchResults.style.display = 'none';
      return;
    }

    const filtered = locations.filter(loc =>
      loc.name.toLowerCase().includes(query) ||
      loc.address.toLowerCase().includes(query)
    );

    if (filtered.length === 0) {
      companySearchResults.innerHTML = '<div class="search-result-item">No locations found</div>';
    } else {
      companySearchResults.innerHTML = filtered.map(loc => `
        <div class="search-result-item" onclick="selectLocation('${loc.id}')">
          <div class="search-result-icon"><i class="fas fa-map-marker-alt"></i></div>
          <div>
            <div class="search-result-name">${loc.name}</div>
            <div class="search-result-role">${loc.address}</div>
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
  verifyLocationBtn.addEventListener('click', () => {
    if (!window.selectedLocationData) return;
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

        const distance = calculateDistance(userLat, userLng, window.selectedLocationData.lat, window.selectedLocationData.lng);
        const isWithinRadius = distance <= (window.selectedLocationData.radius + accuracy);

        if (isWithinRadius) {
          locationStatus.className = 'location-status success';
          locationStatus.innerHTML = `<i class="fas fa-check-circle"></i> Location verified! You are ${distance.toFixed(0)}m from ${window.selectedLocationData.name}`;
          locationVerified = true;
          submitBtn.disabled = false;
          initVerificationMap(userLat, userLng, window.selectedLocationData);
        } else {
          locationStatus.className = 'location-status error';
          locationStatus.innerHTML = `<i class="fas fa-times-circle"></i> Too far from ${window.selectedLocationData.name}. You are ${distance.toFixed(0)}m away (max: ${window.selectedLocationData.radius}m)`;
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

  function initVerificationMap(userLat, userLng, location) {
    locationMapEl.style.display = 'block';
    
    if (map) {
      map.remove();
    }

    map = L.map('location-map').setView([userLat, userLng], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(map);

    L.marker([userLat, userLng]).addTo(map).bindPopup('You are here').openPopup();
    L.circle([location.lat, location.lng], {
      radius: location.radius,
      color: '#4f46e5',
      fillColor: '#4f46e5',
      fillOpacity: 0.1
    }).addTo(map);
    L.marker([location.lat, location.lng]).addTo(map).bindPopup(location.name);
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
        location_name: window.selectedLocationData.name,
        location_address: window.selectedLocationData.address,
        latitude: window.selectedLocationData.lat,
        longitude: window.selectedLocationData.lng,
        photo_url: photoUrl,
        travel_time: travelTime ? parseInt(travelTime) : null,
        tags: visitTags,
        created_at: new Date().toISOString()
      };

      const { error } = await supabaseClient.from('visits').insert([visitData]);

      if (error) throw error;

      showToast('Visit logged successfully!', 'success');
      
      if (leadScore >= 70 || visitTags.includes('high-value')) {
        triggerConfetti();
      }

      loadView('my-activity');
    } catch (err) {
      showToast('Failed to save visit: ' + err.message, 'error');
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fas fa-check"></i> Save Visit';
    }
  });
}

// Add this global function to handle location selection
window.selectLocation = function(locationId) {
  const locations = window.locationsData;
  const location = locations.find(loc => loc.id === locationId);
  if (!location) return;

  // Update the company name input
  document.getElementById('company-name').value = location.name;
  
  // Show selected location info
  document.getElementById('selected-location').style.display = 'block';
  document.getElementById('selected-location-name').textContent = location.name;
  document.getElementById('selected-location-address').textContent = location.address;
  
  // Hide search results
  document.getElementById('company-search-results').style.display = 'none';
  
  // Set selected location data
  const selectedLocation = {
    id: location.id,
    name: location.name,
    address: location.address,
    lat: parseFloat(location.latitude),
    lng: parseFloat(location.longitude),
    radius: parseInt(location.radius) || 200
  };
  
  // Store it in a way that can be accessed by the event listener
  window.selectedLocationData = selectedLocation;
  
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

  return `
    <div class="visit-card">
      <div class="visit-header">
        <div>
          <div class="visit-company">${visit.company_name}</div>
          ${showRepName && visit.user ? `<div class="text-muted" style="font-size: 0.8125rem;">by ${visit.user.first_name} ${visit.user.last_name}</div>` : ''}
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

      <div class="visit-notes">${visit.notes}</div>

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
  const [visitsResult, locationsResult] = await Promise.all([
    supabaseClient
      .from('visits')
      .select('*')
      .order('created_at', { ascending: false }),
    supabaseClient
      .from('locations')
      .select('*')
      .order('name', { ascending: true })
  ]);

  const { data: visits, error: visitsError } = visitsResult;
  const { data: locations } = locationsResult;

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
      <button class="btn btn-secondary btn-sm" onclick="showManageLocationsModal()">
        <i class="fas fa-map-marker-alt"></i>
        <span class="hidden-mobile">Locations</span>
      </button>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon"><i class="fas fa-clipboard-list"></i></div>
        <div class="stat-value">${totalVisits}</div>
        <div class="stat-label">Total Visits</div>
      </div>
      <div class="stat-card success">
        <div class="stat-icon"><i class="fas fa-users"></i></div>
        <div class="stat-value">${totalReps}</div>
        <div class="stat-label">Sales Reps</div>
      </div>
      <div class="stat-card warning">
        <div class="stat-icon"><i class="fas fa-calendar-day"></i></div>
        <div class="stat-value">${todayVisits}</div>
        <div class="stat-label">Today</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><i class="fas fa-bullseye"></i></div>
        <div class="stat-value">${avgLeadScore}%</div>
        <div class="stat-label">Avg Lead Score</div>
      </div>
    </div>

    <!-- Search for Sales Rep -->
    <div class="card">
      <div class="search-container">
        <i class="fas fa-search"></i>
        <input type="text" id="rep-search-input" placeholder="Search for a sales rep...">
        <div id="rep-search-results" class="search-results" style="display: none;"></div>
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

    <!-- Recent Team Visits -->
    <div class="card">
      <div class="card-header">
        <h3 class="card-title"><i class="fas fa-clock"></i> Recent Team Activity</h3>
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
  if (!confirm(`Are you sure you want to delete ${userName}?`)) return;

  const { error } = await supabaseClient.from('profiles').delete().eq('id', userId);

  if (error) {
    showToast('Failed to delete user: ' + error.message, 'error');
    return;
  }

  showToast('User deleted successfully', 'success');
  renderUserManagementView();
};

// ======================
// LOCATION MANAGEMENT
// ======================

window.showManageLocationsModal = async function() {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'flex';
  modal.id = 'locations-modal';
  modal.innerHTML = `
    <div class="modal-backdrop" onclick="closeModal('locations-modal')"></div>
    <div class="modal-container" style="max-width: 600px;">
      <div class="modal-header">
        <h3><i class="fas fa-map-marker-alt"></i> Manage Locations</h3>
        <button class="modal-close" onclick="closeModal('locations-modal')">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <div class="modal-body">
        <div class="form-field">
          <label>Location Name</label>
          <input type="text" id="new-location-name" placeholder="e.g., Main Office">
        </div>
        <div class="form-field">
          <label>Address</label>
          <input type="text" id="new-location-address" placeholder="e.g., 123 Main St">
        </div>
        <div class="flex gap-2">
          <div class="form-field" style="flex: 1;">
            <label>Latitude</label>
            <input type="number" id="new-location-lat" step="0.000001" placeholder="Auto-filled" readonly />
          </div>
          <div class="form-field" style="flex: 1;">
            <label>Longitude</label>
            <input type="number" id="new-location-lng" step="0.000001" placeholder="Auto-filled" readonly />
          </div>
        </div>
        <div class="form-field">
          <label>Radius (meters)</label>
          <input type="number" id="new-location-radius" value="200" min="50" max="1000">
        </div>
        <button class="btn btn-primary w-full" onclick="addNewLocation()">
          <i class="fas fa-plus"></i> Add Location
        </button>
        
        <hr style="margin: 1.5rem 0; border: none; border-top: 1px solid var(--border-color);">
        
        <h4 style="margin-bottom: 1rem;">Search Existing Locations</h4>
        <div class="location-search-container">
          <input type="text" id="location-search-input" placeholder="Search locations by name or address...">
        </div>
        
        <div id="locations-list"></div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  loadLocationsList();
  
  // Initialize location search
  const locationSearchInput = document.getElementById('location-search-input');
  locationSearchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    filterLocationsList(query);
  });
};

async function loadLocationsList() {
  const { data: locations, error } = await supabaseClient
    .from('locations')
    .select('*')
    .order('name', { ascending: true });

  const container = document.getElementById('locations-list');

  if (error) {
    container.innerHTML = `<p class="text-danger">${error.message}</p>`;
    return;
  }

  if (locations.length === 0) {
    container.innerHTML = '<p class="text-muted">No locations added yet</p>';
    return;
  }

  // Store locations for filtering
  window.allLocations = locations;

  container.innerHTML = locations.map(loc => `
    <div class="flex items-center justify-between location-item" data-id="${loc.id}" data-name="${loc.name.toLowerCase()}" data-address="${loc.address.toLowerCase()}">
      <div>
        <strong>${loc.name}</strong>
        <div class="text-muted" style="font-size: 0.8125rem;">${loc.address}</div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="deleteLocation('${loc.id}')">
        <i class="fas fa-trash text-danger"></i>
      </button>
    </div>
  `).join('');
}

function filterLocationsList(query) {
  const container = document.getElementById('locations-list');
  const locationItems = container.querySelectorAll('.location-item');
  
  if (!query) {
    locationItems.forEach(item => {
      item.style.display = 'flex';
    });
    return;
  }
  
  locationItems.forEach(item => {
    const name = item.getAttribute('data-name');
    const address = item.getAttribute('data-address');
    
    if (name.includes(query) || address.includes(query)) {
      item.style.display = 'flex';
    } else {
      item.style.display = 'none';
    }
  });
}

window.addNewLocation = async function() {
  const name = document.getElementById('new-location-name').value.trim();
  const address = document.getElementById('new-location-address').value.trim();
  const radius = parseInt(document.getElementById('new-location-radius').value) || 200;

  if (!name || !address) {
    showToast('Please enter location name and address', 'error');
    return;
  }

  const btn = document.querySelector('#locations-modal .btn-primary');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Geocoding...';

  try {
    // ✅ Auto-geocode address
    const geo = await geocodeAddress(address);

    // ✅ Auto-fill (for confirmation)
    document.getElementById('new-location-lat').value = geo.latitude.toFixed(6);
    document.getElementById('new-location-lng').value = geo.longitude.toFixed(6);

    // Optional: Show confirmation to user
    if (!confirm(`📍 Found: "${geo.displayName}"\n\nLatitude: ${geo.latitude.toFixed(6)}\nLongitude: ${geo.longitude.toFixed(6)}\n\nUse this location?`)) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-plus"></i> Add Location';
      return;
    }

    // ✅ Save to DB
    const { error } = await supabaseClient.from('locations').insert([{
      name,
      address,
      latitude: geo.latitude,
      longitude: geo.longitude,
      radius
    }]);

    if (error) throw error;

    showToast(`✅ Location added!`, 'success');
    // Reset form
    document.getElementById('new-location-name').value = '';
    document.getElementById('new-location-address').value = '';
    document.getElementById('new-location-lat').value = '';
    document.getElementById('new-location-lng').value = '';
    loadLocationsList();

  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-plus"></i> Add Location';
  }
};

window.deleteLocation = async function(id) {
  if (!confirm('Delete this location?')) return;

  const { error } = await supabaseClient.from('locations').delete().eq('id', id);

  if (error) {
    showToast('Error: ' + error.message, 'error');
    return;
  }

  showToast('Location deleted', 'success');
  loadLocationsList();
};

// ======================
// COMMAND PALETTE
// ======================

const commands = [
  { id: 'log-visit', title: 'Log New Visit', description: 'Record a field visit', icon: 'fa-plus-circle', action: () => loadView('log-visit') },
  { id: 'my-activity', title: 'My Activity', description: 'View your visits', icon: 'fa-clipboard-list', action: () => loadView('my-activity') },
  { id: 'sales-funnel', title: 'Sales Funnel', description: 'View pipeline', icon: 'fa-filter', action: () => loadView('sales-funnel') },
  { id: 'team-dashboard', title: 'Team Dashboard', description: 'Team performance', icon: 'fa-users', action: () => loadView('team-dashboard') },
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
    // FIX: Specify the relationship to avoid ambiguity
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
    doc.text(`Rep: ${userName} | Date: ${date}`, 25, yPos);
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
    'Notes': visit.notes,
    'AI Summary': visit.ai_summary || ''
  }));

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Visits');
  XLSX.writeFile(workbook, `SafiTrack_Report_${fromDate}_to_${toDate}.xlsx`);
}

async function exportToCSV(visits, fromDate, toDate) {
  const headers = ['Date', 'Company', 'Contact', 'Sales Rep', 'Location', 'Notes'];
  const rows = visits.map(visit => [
    new Date(visit.created_at).toLocaleDateString(),
    visit.company_name,
    visit.contact_name || '',
    visit.user ? `${visit.user.first_name} ${visit.user.last_name}` : '',
    visit.location_name || '',
    visit.notes
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

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
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

  return `<span class="lead-score-badge ${className}"><i class="fas fa-bullseye"></i> ${label} (${score}%)</span>`;
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
// ROUTE PLANNING VIEW
// ======================

async function renderRoutePlanningView() {
  // Fetch existing routes and locations
  const [routesResult, locationsResult, profilesResult] = await Promise.all([
    supabaseClient
      .from('routes')
      // FIX: Specify the relationship to avoid ambiguity
      .select(`*, assigned_to:profiles!routes_assigned_to_fkey(first_name, last_name)`)
      .eq('created_by', currentUser.id)
      .order('created_at', { ascending: false }),
    supabaseClient
      .from('locations')
      .select('*')
      .order('name', { ascending: true }),
    supabaseClient
      .from('profiles')
      .select('*')
      .eq('role', 'sales_rep')
      .order('first_name', { ascending: true })
  ]);

  const { data: routes, error: routesError } = routesResult;
  const { data: locations, error: locationsError } = locationsResult;
  const { data: salesReps, error: profilesError } = profilesResult;

  if (routesError || locationsError || profilesError) {
    // Log specific errors to console for debugging
    if (routesError) console.error('Routes Error:', routesError);
    if (locationsError) console.error('Locations Error:', locationsError);
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
          <i class="fas fa-plus"></i> Create Route
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
          <label>Search Locations</label>
          <div class="location-search-container">
            <input type="text" id="location-search" placeholder="Search for locations by name or address...">
          </div>
        </div>
        
        <div class="form-field">
          <label>Select Locations</label>
          <div id="locations-selector" class="locations-grid">
            ${locations.map(loc => `
              <div class="location-card" data-id="${loc.id}" data-lat="${loc.latitude}" data-lng="${loc.longitude}">
                <div class="location-checkbox">
                  <input type="checkbox" id="loc-${loc.id}" value="${loc.id}">
                  <label for="loc-${loc.id}"></label>
                </div>
                <div class="location-info">
                  <h4>${loc.name}</h4>
                  <p>${loc.address}</p>
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
            <i class="fas fa-magic"></i> Optimize Route
          </button>
          <button id="save-route-btn" class="btn btn-primary" style="display: none;">
            <i class="fas fa-save"></i> Save Route
          </button>
        </div>
        
        <div id="route-map" class="route-map" style="display: none;"></div>
        
        <div id="route-order" class="route-order" style="display: none;">
          <h4>Route Order</h4>
          <div id="sortable-route" class="sortable-container"></div>
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
  initRouteCreator(locations, salesReps);
  
  // Initialize route list functionality
  initRouteList();
}

function initRouteCreator(locations, salesReps) {
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
  window.allLocationsData = locations;
  
  // Show/hide route creator
  createBtn.addEventListener('click', () => {
    if (routeCreator.style.display === 'none') {
      routeCreator.style.display = 'block';
      createBtn.innerHTML = '<i class="fas fa-times"></i> Cancel';
    } else {
      routeCreator.style.display = 'none';
      createBtn.innerHTML = '<i class="fas fa-plus"></i> Create Route';
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
      const location = locations.find(loc => loc.id === locationId);
      
      if (location && (
        location.name.toLowerCase().includes(query) ||
        location.address.toLowerCase().includes(query)
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
      
      if (checkbox.checked) {
        selectedLocations.push(locations.find(loc => loc.id === locationId));
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
    
    // Get the last selected location
    const lastSelected = selected[selected.length - 1];
    
    // Find the nearest unselected location
    let nearestLocation = null;
    let shortestDistance = Infinity;
    
    locations.forEach(location => {
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
        <p>Based on your selection of <strong>${lastSelected.name}</strong>, the nearest location is <strong>${nearestLocation.name}</strong> (${(shortestDistance/1000).toFixed(2)} km away).</p>
        <button class="btn btn-sm btn-primary" onclick="selectRecommendedLocation('${nearestLocation.id}')">
          <i class="fas fa-plus"></i> Add to Route
        </button>
      `;
      
      // Highlight the recommended location
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
    
    // Display the route on map
    displayRouteOnMap(optimizedRoute);
    
    // Show route order
    displayRouteOrder(optimizedRoute);
    
    // Show save button
    saveBtn.style.display = 'inline-flex';
    
    // Reset button state
    optimizeBtn.disabled = false;
    optimizeBtn.innerHTML = '<i class="fas fa-magic"></i> Optimize Route';
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
      
      // Add route locations
      const routeLocations = optimizedRoute.map((location, index) => ({
        route_id: route[0].id,
        location_id: location.id,
        position: index + 1
      }));
      
      const { error: locationsError } = await supabaseClient
        .from('route_locations')
        .insert(routeLocations);
      
      if (locationsError) throw locationsError;
      
      // Create route assignments for each selected rep
      const routeAssignments = selectedReps.map(rep => ({
        route_id: route[0].id,
        rep_id: rep.id,
        assigned_by: currentUser.id
      }));
      
      const { error: assignmentsError } = await supabaseClient
        .from('route_assignments')
        .insert(routeAssignments);
      
      if (assignmentsError) throw assignmentsError;
      
      showToast('Route created and assigned successfully!', 'success');
      renderRoutePlanningView(); // Refresh the view
    } catch (error) {
      showToast('Error creating route: ' + error.message, 'error');
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Route';
    }
  });
  
  // Helper functions
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
    if (map) {
      map.remove();
      map = null;
    }
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
        .bindPopup(`<b>${index + 1}. ${location.name}</b><br>${location.address}`)
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
          <p>${location.address}</p>
        </div>
      </div>
    `).join('');
    
    // Make the list sortable
    new Sortable(sortableRoute, {
      handle: '.sortable-handle',
      animation: 150,
      onEnd: function(evt) {
        // Update the optimizedRoute array based on new order
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
      const routeId = btn.getAttribute('data-id');
      await viewRouteDetails(routeId);
    });
  });
  
  // Edit route
  document.querySelectorAll('.edit-route-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const routeId = btn.getAttribute('data-id');
      await editRoute(routeId);
    });
  });
  
  // Delete route
  document.querySelectorAll('.delete-route-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const routeId = btn.getAttribute('data-id');
      const routeItem = btn.closest('.route-item');
      const routeName = routeItem.querySelector('h4').textContent;
      
      if (confirm(`Are you sure you want to delete the route "${routeName}"?`)) {
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
      }
    });
  });
}

async function viewRouteDetails(routeId) {
  // Fetch route details
  // FIX: Specify the relationship to avoid ambiguity
  const { data: route, error: routeError } = await supabaseClient
    .from('routes')
    .select(`*, 
      route_locations(
        position, 
        location:locations(id, name, address, latitude, longitude)
      ),
      assigned_to:profiles!routes_assigned_to_fkey(first_name, last_name)
    `)
    .eq('id', routeId)
    .single();
  
  if (routeError) {
    showToast('Error loading route details: ' + routeError.message, 'error');
    return;
  }
  
  // Sort locations by position
  const locations = route.route_locations
    .sort((a, b) => a.position - b.position)
    .map(item => item.location);
  
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
            <p><strong>Assigned to:</strong> ${route.assigned_to ? `${route.assigned_to.first_name} ${route.assigned_to.last_name}` : 'Unassigned'}</p>
            <p><strong>Created:</strong> ${formatDate(route.created_at)}</p>
            ${route.estimated_duration ? `<p><strong>Est. duration:</strong> ${route.estimated_duration} min</p>` : ''}
            ${route.total_distance ? `<p><strong>Total distance:</strong> ${(route.total_distance / 1000).toFixed(2)} km</p>` : ''}
          </div>
          
          <div class="route-map" id="route-details-map" style="height: 300px; margin: 1rem 0;"></div>
          
          <h4>Route Stops</h4>
          <ol class="route-stops">
            ${locations.map((location, index) => `
              <li>
                <strong>${location.name}</strong><br>
                ${location.address}
              </li>
            `).join('')}
          </ol>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Initialize map
  setTimeout(() => {
    const map = L.map('route-details-map').setView([locations[0].latitude, locations[0].longitude], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(map);
    
    // Add markers for each location
    const markers = locations.map((location, index) => {
      return L.marker([location.latitude, location.longitude])
        .bindPopup(`<b>${index + 1}. ${location.name}</b><br>${location.address}`)
        .addTo(map);
    });
    
    // Draw route line
    const latlngs = locations.map(loc => [loc.latitude, loc.longitude]);
    L.polyline(latlngs, { color: '#4f46e5', weight: 4 }).addTo(map);
    
    // Fit map to show entire route
    const group = new L.featureGroup(markers);
    map.fitBounds(group.getBounds().pad(0.1));
  }, 100);
}

async function editRoute(routeId) {
  // Similar to viewRouteDetails but with editing capabilities
  // This would allow managers to modify the route order or locations
  // Implementation would be similar to creating a new route but with pre-filled data
  showToast('Edit route functionality to be implemented', 'info');
}


// ======================
// MY ROUTES VIEW
// ======================

async function renderMyRoutesView() {
  // FIX: No ambiguity here, but keeping it consistent is good practice
  const { data: routes, error } = await supabaseClient
    .from('routes')
    .select(`*, 
      route_locations(
        position, 
        location:locations(id, name, address, latitude, longitude)
      )
    `)
    .eq('assigned_to', currentUser.id)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) {
    viewContainer.innerHTML = renderError(error.message);
    return;
  }

  let html = `
    <div class="page-header">
      <h1 class="page-title">My Routes</h1>
      <p class="page-subtitle">${routes.length} assigned routes</p>
    </div>
  `;

  if (routes.length === 0) {
    html += `
      <div class="card">
        <div class="empty-state">
          <i class="fas fa-route empty-state-icon"></i>
          <h3 class="empty-state-title">No routes assigned</h3>
          <p class="empty-state-description">Your manager will assign routes to you here.</p>
        </div>
      </div>
    `;
  } else {
    routes.forEach(route => {
      // Sort locations by position
      const locations = route.route_locations
        .sort((a, b) => a.position - b.position)
        .map(item => item.location);

      html += `
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">${route.name}</h3>
            <button class="btn btn-primary start-route-btn" data-id="${route.id}">
              <i class="fas fa-play"></i> Start Route
            </button>
          </div>
          
          <div class="route-summary">
            <p><strong>Created:</strong> ${formatDate(route.created_at)}</p>
            ${route.estimated_duration ? `<p><strong>Est. duration:</strong> ${route.estimated_duration} min</p>` : ''}
            ${route.total_distance ? `<p><strong>Total distance:</strong> ${(route.total_distance / 1000).toFixed(2)} km</p>` : ''}
          </div>
          
          <div class="route-map" id="route-preview-${route.id}" style="height: 200px; margin: 1rem 0;"></div>
          
          <h4>Route Stops</h4>
          <ol class="route-stops">
            ${locations.map((location, index) => `
              <li>
                <strong>${location.name}</strong><br>
                ${location.address}
              </li>
            `).join('')}
          </ol>
        </div>
      `;
    });
  }

  viewContainer.innerHTML = html;

  // Initialize maps for each route
  routes.forEach(route => {
    const locations = route.route_locations
      .sort((a, b) => a.position - b.position)
      .map(item => item.location);

    setTimeout(() => {
      const mapId = `route-preview-${route.id}`;
      const mapElement = document.getElementById(mapId);
      
      if (!mapElement) return;
      
      const map = L.map(mapId).setView([locations[0].latitude, locations[0].longitude], 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
      }).addTo(map);
      
      // Add markers for each location
      const markers = locations.map((location, index) => {
        return L.marker([location.latitude, location.longitude])
          .bindPopup(`<b>${index + 1}. ${location.name}</b><br>${location.address}`)
          .addTo(map);
      });
      
      // Draw route line
      const latlngs = locations.map(loc => [loc.latitude, loc.longitude]);
      L.polyline(latlngs, { color: '#4f46e5', weight: 4 }).addTo(map);
      
      // Fit map to show entire route
      const group = new L.featureGroup(markers);
      map.fitBounds(group.getBounds().pad(0.1));
    }, 100);
  });

  // Initialize start route buttons
  document.querySelectorAll('.start-route-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const routeId = btn.getAttribute('data-id');
      startRoute(routeId);
    });
  });
}

function startRoute(routeId) {
  startRouteNavigation(routeId);
}

// ======================
// ROUTE NAVIGATION
// ======================

async function startRouteNavigation(routeId) {
  // Fetch route details
  // FIX: No ambiguity here, but keeping it consistent is good practice
  const { data: route, error: routeError } = await supabaseClient
    .from('routes')
    .select(`*, 
      route_locations(
        position, 
        location:locations(id, name, address, latitude, longitude)
      )
    `)
    .eq('id', routeId)
    .single();
  
  if (routeError) {
    showToast('Error loading route: ' + routeError.message, 'error');
    return;
  }
  
  // Sort locations by position
  const locations = route.route_locations
    .sort((a, b) => a.position - b.position)
    .map(item => item.location);
  
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
            <h4 id="current-stop-name">${locations[0].name}</h4>
            <p id="current-stop-address">${locations[0].address}</p>
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
            ${locations.slice(1).map((location, index) => `
              <div class="stop-item" data-index="${index + 1}">
                <div class="stop-number">${index + 2}</div>
                <div class="stop-details">
                  <h4>${location.name}</h4>
                  <p>${location.address}</p>
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
  
  // Initialize map
  setTimeout(() => {
    map = L.map('navigation-map').setView([locations[0].latitude, locations[0].longitude], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(map);
    
    // Add markers for each location
    locations.forEach((location, index) => {
      const isCurrentStop = index === currentStopIndex;
      const isCompletedStop = index < currentStopIndex;
      
      const marker = L.marker([location.latitude, location.longitude], {
        icon: L.divIcon({
          className: 'route-marker',
          html: `<div class="route-marker-icon ${isCurrentStop ? 'current' : ''} ${isCompletedStop ? 'completed' : ''}">${index + 1}</div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        })
      })
        .bindPopup(`<b>${index + 1}. ${location.name}</b><br>${location.address}`)
        .addTo(map);
      
      stopMarkers.push(marker);
    });
    
    // Draw route line
    const latlngs = locations.map(loc => [loc.latitude, loc.longitude]);
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
          
          // Check if user is near the current stop
          const currentLocation = locations[currentStopIndex];
          const distance = calculateDistance(
            latitude, longitude,
            currentLocation.latitude, currentLocation.longitude
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
  }, 100);
  
  // Handle button clicks
  document.getElementById('arrived-btn').addEventListener('click', () => {
    // Mark current stop as completed
    currentStopIndex++;
    
    // If there are more stops, update UI
    if (currentStopIndex < locations.length) {
      // Update current stop
      document.getElementById('current-stop-name').textContent = locations[currentStopIndex].name;
      document.getElementById('current-stop-address').textContent = locations[currentStopIndex].address;
      
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
      map.setView([locations[currentStopIndex].latitude, locations[currentStopIndex].longitude], 15);
      
      showToast(`Proceeding to stop ${currentStopIndex + 1}`, 'info');
    } else {
      // Route completed
      completeRoute(routeId);
    }
  });
  
  document.getElementById('get-directions-btn').addEventListener('click', () => {
    const currentLocation = locations[currentStopIndex];
    // Open in Google Maps or other navigation app
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${currentLocation.latitude},${currentLocation.longitude}`, '_blank');
  });
  
  document.getElementById('complete-route-btn').addEventListener('click', () => {
    if (confirm('Are you sure you want to mark this route as completed?')) {
      completeRoute(routeId);
    }
  });
}

async function completeRoute(routeId) {
  try {
    // Mark route as completed
    const { error } = await supabaseClient
      .from('routes')
      .update({ is_active: false })
      .eq('id', routeId);
    
    if (error) throw error;
    
    showToast('Route completed successfully!', 'success');
    loadView('my-routes');
  } catch (error) {
    showToast('Error completing route: ' + error.message, 'error');
  }
}

async function renderOpportunityPipelineView() {
  let opportunities;
  let error;
  
  if (isManager) {
    // Managers can see all opportunities with user info
    // Using explicit join syntax instead of relationship syntax
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

  // Define pipeline stages
  const pipelineStages = [
    { id: 'prospecting', title: 'Prospecting', color: '#6b7280' },
    { id: 'qualification', title: 'Qualification', color: '#3b82f6' },
    { id: 'proposal', title: 'Proposal', color: '#8b5cf6' },
    { id: 'negotiation', title: 'Negotiation', color: '#f59e0b' },
    { id: 'closed-won', title: 'Closed Won', color: '#10b981' },
    { id: 'closed-lost', title: 'Closed Lost', color: '#ef4444' }
  ];

  // Group opportunities by stage
  const opportunitiesByStage = {};
  pipelineStages.forEach(stage => {
    opportunitiesByStage[stage.id] = {
      ...stage,
      opportunities: opportunities.filter(opp => opp.stage === stage.id),
      totalValue: opportunities
        .filter(opp => opp.stage === stage.id)
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
        <div class="pipeline-summary-value">${opportunities.filter(opp => opp.stage !== 'closed-won' && opp.stage !== 'closed-lost').length}</div>
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
      
      // Get user info from the joined data
      const user = opp.profiles;
      const ownerName = user ? `${user.first_name} ${user.last_name}` : 'Unknown';
      
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
        openOpportunityModal(opportunity, true); // true = read-only mode
      }
    });
  });

  // Delete opportunity buttons
  document.querySelectorAll('.delete-opportunity').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const opportunityId = btn.dataset.id;
      
      if (confirm('Are you sure you want to delete this opportunity?')) {
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
  document.getElementById('opportunity-stage').value = 'prospecting';
  document.getElementById('opportunity-next-step').value = '';
  document.getElementById('opportunity-next-step-date').value = '';
  document.getElementById('opportunity-notes').value = '';
  
  // Clear competitors
  document.getElementById('competitors-container').innerHTML = '<input type="text" class="competitors-input" id="competitors-input" placeholder="Add competitor...">';
  
  // Set modal title
  if (opportunity) {
    modalTitle.innerHTML = readOnly 
      ? `<i class="fas fa-chart-line"></i> ${opportunity.name}`
      : `<i class="fas fa-edit"></i> Edit Opportunity`;
    
    // Fill form with opportunity data
    document.getElementById('opportunity-name').value = opportunity.name || '';
    document.getElementById('opportunity-company').value = opportunity.company_name || '';
    document.getElementById('opportunity-value').value = opportunity.value || '';
    document.getElementById('opportunity-probability').value = opportunity.probability || 50;
    document.getElementById('probability-display').textContent = opportunity.probability || 50;
    document.getElementById('opportunity-stage').value = opportunity.stage || 'prospecting';
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
    modalTitle.innerHTML = '<i class="fas fa-plus"></i> New Opportunity';
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
    
    // Fetch locations for company search
    const { data: locations } = await supabaseClient
      .from('locations')
      .select('*')
      .ilike('name', `%${query}%`)
      .limit(5);
    
    if (locations.length === 0) {
      companySearchResults.innerHTML = '<div class="search-result-item">No companies found</div>';
    } else {
      companySearchResults.innerHTML = locations.map(loc => `
        <div class="search-result-item" onclick="selectOpportunityCompany('${loc.name}')">
          <div class="search-result-icon"></div>
          <div>
            <div class="search-result-name">${loc.name}</div>
            <div class="search-result-role">${loc.address}</div>
          </div>
        </div>
      `).join('');
    }
    
    companySearchResults.style.display = 'block';
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
        competitors: competitors.length > 0 ? JSON.stringify(competitors) : null
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
      saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Opportunity';
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
    <span class="remove" onclick="removeCompetitor(this)">×</span>
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
  // For now, we'll just store the reminder in localStorage
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



