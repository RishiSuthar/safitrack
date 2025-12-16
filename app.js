// ======================
// GLOBAL STATE
// ======================

const SUPABASE_URL = 'https://ndrkncirkekpqjjkasiy.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5kcmtuY2lya2VrcHFqamthc2l5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU2MDU2MTEsImV4cCI6MjA4MTE4MTYxMX0.SGVLqU6-u1ALj_P1nsyytYe7cNbAyxCVbV6kjAaiGU4';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

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
  supabase.auth.getSession().then(({ data: { session } }) => {
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

  supabase.auth.onAuthStateChange((event, session) => {
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

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

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
  await supabase.auth.signOut();
  location.reload();
}

// ======================
// APP INITIALIZATION
// ======================

async function initApp() {
  authScreen.style.display = 'none';
  mainApp.style.display = 'flex';

  const { data: profile, error } = await supabase
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
    case 'team-dashboard':
      if (isManager) {
        await renderTeamDashboardView();
      } else {
        viewContainer.innerHTML = renderAccessDenied();
      }
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
}

// ======================
// LOG VISIT VIEW
// ======================

async function renderLogVisitView() {
  const { data: locations } = await supabase
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
        <input type="text" id="company-name" placeholder="Enter company name" required />
      </div>

      <div class="form-field">
        <label for="contact-name">Contact Person</label>
        <input type="text" id="contact-name" placeholder="Client contact name" />
      </div>

      <div class="form-field">
        <label for="location-select">Visit Location *</label>
        <select id="location-select" required>
          <option value="">Select a location...</option>
          ${locations ? locations.map(loc => `
            <option value="${loc.id}" data-lat="${loc.latitude}" data-lng="${loc.longitude}" data-radius="${loc.radius || 200}">
              ${loc.name} - ${loc.address}
            </option>
          `).join('') : '<option value="">No locations available</option>'}
        </select>
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
  const notesEl = document.getElementById('notes');
  const charCountEl = document.getElementById('char-count');
  const locationSelect = document.getElementById('location-select');
  const verifyLocationBtn = document.getElementById('verify-location');
  const locationStatus = document.getElementById('location-status');
  const locationMapEl = document.getElementById('location-map');
  const submitBtn = document.getElementById('submit-visit');
  const photoUploadArea = document.getElementById('photo-upload-area');
  const photoInput = document.getElementById('visit-photo');
  const photoPreview = document.getElementById('photo-preview');
  const tagsInput = document.getElementById('tags-input');

  let selectedLocation = null;
  let locationVerified = false;
  let map = null;

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

  // Location selection
  locationSelect.addEventListener('change', (e) => {
    const option = e.target.options[e.target.selectedIndex];
    if (option.value) {
      selectedLocation = {
        id: option.value,
        name: option.text.split(' - ')[0],
        address: option.text.split(' - ')[1],
        lat: parseFloat(option.dataset.lat),
        lng: parseFloat(option.dataset.lng),
        radius: parseInt(option.dataset.radius) || 200
      };
      verifyLocationBtn.disabled = false;
      locationVerified = false;
      submitBtn.disabled = true;
      locationStatus.style.display = 'none';
      locationMapEl.style.display = 'none';
    } else {
      selectedLocation = null;
      verifyLocationBtn.disabled = true;
    }
  });

  // Verify location
  verifyLocationBtn.addEventListener('click', () => {
    if (!selectedLocation) return;
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

        const distance = calculateDistance(userLat, userLng, selectedLocation.lat, selectedLocation.lng);
        const isWithinRadius = distance <= (selectedLocation.radius + accuracy);

        if (isWithinRadius) {
          locationStatus.className = 'location-status success';
          locationStatus.innerHTML = `<i class="fas fa-check-circle"></i> Location verified! You are ${distance.toFixed(0)}m from ${selectedLocation.name}`;
          locationVerified = true;
          submitBtn.disabled = false;
          initVerificationMap(userLat, userLng, selectedLocation);
        } else {
          locationStatus.className = 'location-status error';
          locationStatus.innerHTML = `<i class="fas fa-times-circle"></i> Too far from ${selectedLocation.name}. You are ${distance.toFixed(0)}m away (max: ${selectedLocation.radius}m)`;
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

    const company = document.getElementById('company-name').value.trim();
    const contact = document.getElementById('contact-name').value.trim();
    const visitType = document.getElementById('visit-type').value;
    const notes = document.getElementById('notes').value.trim();
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
        const { error: uploadError } = await supabase.storage
          .from('safitrack')
          .upload(photoPath, photoFile);

        if (!uploadError) {
          const { data: urlData } = supabase.storage.from('safitrack').getPublicUrl(photoPath);
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
        location_name: selectedLocation.name,
        location_address: selectedLocation.address,
        latitude: selectedLocation.lat,
        longitude: selectedLocation.lng,
        photo_url: photoUrl,
        travel_time: travelTime ? parseInt(travelTime) : null,
        tags: visitTags,
        created_at: new Date().toISOString()
      };

      const { error } = await supabase.from('visits').insert([visitData]);

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

// ======================
// MY ACTIVITY VIEW
// ======================

async function renderMyActivityView() {
  const { data: visits, error } = await supabase
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
  const { data: visits, error } = await supabase
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
  const { data: allProfiles, error: profilesError } = await supabase
    .from('profiles')
    .select('*')
    .order('first_name', { ascending: true });


  if (profilesError) {
    viewContainer.innerHTML = renderError('Unable to load team data. Please check your permissions: ' + profilesError.message);
    return;
  }

  // Then get visits
  const [visitsResult, locationsResult] = await Promise.all([
    supabase
      .from('visits')
      .select('*')
      .order('created_at', { ascending: false }),
    supabase
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
  const { data: users, error } = await supabase
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

  const { error } = await supabase.from('profiles').delete().eq('id', userId);

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
            <input type="number" id="new-location-lat" step="0.000001" placeholder="e.g., 40.7128">
          </div>
          <div class="form-field" style="flex: 1;">
            <label>Longitude</label>
            <input type="number" id="new-location-lng" step="0.000001" placeholder="e.g., -74.0060">
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
        
        <h4 style="margin-bottom: 1rem;">Existing Locations</h4>
        <div id="locations-list"></div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  loadLocationsList();
};

async function loadLocationsList() {
  const { data: locations, error } = await supabase
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

  container.innerHTML = locations.map(loc => `
    <div class="flex items-center justify-between" style="padding: 0.75rem; background: var(--bg-tertiary); border-radius: var(--radius-md); margin-bottom: 0.5rem;">
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

window.addNewLocation = async function() {
  const name = document.getElementById('new-location-name').value.trim();
  const address = document.getElementById('new-location-address').value.trim();
  const lat = parseFloat(document.getElementById('new-location-lat').value);
  const lng = parseFloat(document.getElementById('new-location-lng').value);
  const radius = parseInt(document.getElementById('new-location-radius').value) || 200;

  if (!name || !address || isNaN(lat) || isNaN(lng)) {
    showToast('Please fill in all fields', 'error');
    return;
  }

  const { error } = await supabase.from('locations').insert([{
    name, address, latitude: lat, longitude: lng, radius
  }]);

  if (error) {
    showToast('Error: ' + error.message, 'error');
    return;
  }

  showToast('Location added!', 'success');
  document.getElementById('new-location-name').value = '';
  document.getElementById('new-location-address').value = '';
  document.getElementById('new-location-lat').value = '';
  document.getElementById('new-location-lng').value = '';
  loadLocationsList();
};

window.deleteLocation = async function(id) {
  if (!confirm('Delete this location?')) return;

  const { error } = await supabase.from('locations').delete().eq('id', id);

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
    const { data: visits, error } = await supabase
      .from('visits')
      .select(`*, user:profiles(first_name, last_name, email)`)
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