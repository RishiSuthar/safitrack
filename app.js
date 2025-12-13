// ======================
// GLOBAL STATE
// ======================

const SUPABASE_URL = 'https://ndrkncirkekpqjjkasiy.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5kcmtuY2lya2VrcHFqamthc2l5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU2MDU2MTEsImV4cCI6MjA4MTE4MTYxMX0.SGVLqU6-u1ALj_P1nsyytYe7cNbAyxCVbV6kjAaiGU4';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = null;
let isManager = false;
let currentView = 'log-visit';
let widgetLayout = [];
let checkInRadius = 100; // meters
let visitTags = [];
let chartInstances = {}; // ✅ ADD THIS: Store chart instances

// DOM Elements
const loadingScreen = document.getElementById('loading-screen');
const authScreen = document.getElementById('auth-screen');
const mainApp = document.getElementById('main-app');
const viewContainer = document.getElementById('view-container');
const userDisplay = document.getElementById('user-display');
const managerViewBtn = document.getElementById('manager-view');
const adminViewBtn = document.getElementById('admin-view');
const logoutBtn = document.getElementById('logout-btn');
const navIndicator = document.querySelector('.nav-indicator');
const themeToggle = document.getElementById('theme-toggle');
const commandPaletteBtn = document.getElementById('command-palette-btn');
const commandPalette = document.getElementById('command-palette');
const exportBtn = document.getElementById('export-btn');
const breadcrumbNav = document.getElementById('breadcrumb-nav');

// ======================
// AUTHENTICATION
// ======================

// Toggle between Login/Signup forms
document.getElementById('toggle-login').addEventListener('click', () => {
  document.getElementById('login-form').style.display = 'block';
  document.getElementById('signup-form').style.display = 'none';
  setActiveTab('toggle-login');
});

document.getElementById('toggle-signup').addEventListener('click', () => {
  document.getElementById('signup-form').style.display = 'block';
  document.getElementById('login-form').style.display = 'none';
  setActiveTab('toggle-signup');
});

function setActiveTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
}

// Password toggle
document.querySelectorAll('.toggle-password').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = btn.previousElementSibling;
    input.type = input.type === 'password' ? 'text' : 'password';
    btn.textContent = input.type === 'password' ? '👁️' : '🙈';
  });
});

// LOGIN
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;

  showSkeletonLoading(true);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  showSkeletonLoading(false);

  if (error) {
    showToast(error.message, 'error');
    return;
  }

  currentUser = data.user;
  initApp();
});

// SIGNUP
document.getElementById('signup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('signup-name').value;
  const email = document.getElementById('signup-email').value;
  const password = document.getElementById('signup-password').value;
  const role = document.getElementById('signup-role').value;

  showSkeletonLoading(true);
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: name,
        role: role
      }
    }
  });
  showSkeletonLoading(false);

  if (error) {
    showToast(error.message, 'error');
    return;
  }

  const { error: profileError } = await supabase
    .from('profiles')
    .insert([
      {
        id: data.user.id,
        first_name: name.split(' ')[0],
        last_name: name.split(' ').slice(1).join(' ') || '',
        email: email,
        role: role
      }
    ]);

  if (profileError) {
    console.error('Profile insert error:', profileError);
  }

  showToast('Account created! Please check your email for confirmation.', 'info');
  triggerConfetti();
});

// LOGOUT
logoutBtn.addEventListener('click', async () => {
  await supabase.auth.signOut();
  currentUser = null;
  authScreen.classList.add('active');
  mainApp.style.display = 'none';
  location.reload();
});

// ======================
// COMMAND PALETTE
// ======================

const commands = [
  { id: 'log-visit', title: 'Log New Visit', description: 'Record a field visit', icon: '📍', action: () => loadView('log-visit') },
  { id: 'my-activity', title: 'My Activity', description: 'View your activity log', icon: '📊', action: () => loadView('my-activity') },
  { id: 'sales-funnel', title: 'Sales Funnel', description: 'View sales pipeline', icon: '📈', action: () => loadView('sales-funnel') },
  { id: 'team-dashboard', title: 'Team Dashboard', description: 'View team performance', icon: '👥', action: () => loadView('team-dashboard') },
  { id: 'export', title: 'Export Reports', description: 'Download reports', icon: '📥', action: () => openExportModal() },
  { id: 'theme', title: 'Toggle Theme', description: 'Switch between light and dark', icon: '🌓', action: () => toggleTheme() },
  { id: 'logout', title: 'Logout', description: 'Sign out of your account', icon: '🚪', action: () => logoutBtn.click() }
];

commandPaletteBtn.addEventListener('click', () => openCommandPalette());

// Keyboard shortcut: Ctrl+K or Cmd+K
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    openCommandPalette();
  }
  if (e.key === 'Escape' && commandPalette.style.display !== 'none') {
    closeCommandPalette();
  }
});

function openCommandPalette() {
  commandPalette.style.display = 'flex';
  document.getElementById('command-input').focus();
  renderCommandResults(commands);
}

function closeCommandPalette() {
  commandPalette.style.display = 'none';
  document.getElementById('command-input').value = '';
}

document.getElementById('close-command-palette').addEventListener('click', closeCommandPalette);
document.querySelector('.command-palette-backdrop').addEventListener('click', closeCommandPalette);

document.getElementById('command-input').addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase();
  const filtered = commands.filter(cmd => 
    cmd.title.toLowerCase().includes(query) || 
    cmd.description.toLowerCase().includes(query)
  );
  renderCommandResults(filtered);
});

document.getElementById('command-input').addEventListener('keydown', (e) => {
  const items = document.querySelectorAll('.command-item');
  const activeIndex = Array.from(items).findIndex(item => item.classList.contains('active'));
  
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    const nextIndex = Math.min(activeIndex + 1, items.length - 1);
    items.forEach(item => item.classList.remove('active'));
    items[nextIndex]?.classList.add('active');
    items[nextIndex]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    const prevIndex = Math.max(activeIndex - 1, 0);
    items.forEach(item => item.classList.remove('active'));
    items[prevIndex]?.classList.add('active');
    items[prevIndex]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const activeItem = items[activeIndex];
    if (activeItem) {
      activeItem.click();
    }
  }
});

function renderCommandResults(results) {
  const container = document.getElementById('command-results');
  if (results.length === 0) {
    container.innerHTML = '<div style="padding: 2rem; text-align: center; color: var(--text-muted);">No commands found</div>';
    return;
  }
  
  container.innerHTML = results.map((cmd, index) => `
    <div class="command-item ${index === 0 ? 'active' : ''}" onclick="executeCommand('${cmd.id}')">
      <div class="command-item-icon">${cmd.icon}</div>
      <div class="command-item-text">
        <div class="command-item-title">${cmd.title}</div>
        <div class="command-item-description">${cmd.description}</div>
      </div>
    </div>
  `).join('');
}

function executeCommand(commandId) {
  const command = commands.find(cmd => cmd.id === commandId);
  if (command) {
    command.action();
    closeCommandPalette();
  }
}

// ======================
// EXPORT FUNCTIONALITY
// ======================

exportBtn.addEventListener('click', () => openExportModal());

function openExportModal() {
  document.getElementById('export-modal').style.display = 'flex';
}

function closeModal(modalId) {
  document.getElementById(modalId).style.display = 'none';
}

function setDateRange(range) {
  const customRange = document.getElementById('custom-date-range');
  const fromInput = document.getElementById('export-date-from');
  const toInput = document.getElementById('export-date-to');
  
  const today = new Date();
  let fromDate = new Date();
  
  switch(range) {
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
}

async function executeExport() {
  const format = document.getElementById('export-format').value;
  const fromDate = document.getElementById('export-date-from').value;
  const toDate = document.getElementById('export-date-to').value;
  
  if (!fromDate || !toDate) {
    showToast('Please select a date range', 'error');
    return;
  }
  
  showSkeletonLoading(true);
  
  try {
    // Fetch visits data
    const { data: visits, error } = await supabase
      .from('visits')
      .select(`
        *,
        user:profiles(first_name, last_name, email)
      `)
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
    
    showToast('✅ Export completed successfully!', 'success');
    closeModal('export-modal');
  } catch (err) {
    console.error('Export error:', err);
    showToast('Export failed: ' + err.message, 'error');
  } finally {
    showSkeletonLoading(false);
  }
}

async function exportToPDF(visits, fromDate, toDate) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  
  // Title
  doc.setFontSize(20);
  doc.text('SafiTrack Visit Report', 20, 20);
  
  // Date range
  doc.setFontSize(12);
  doc.text(`Period: ${fromDate} to ${toDate}`, 20, 30);
  doc.text(`Total Visits: ${visits.length}`, 20, 37);
  
  // Visit details
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
    yPos += 7;
    doc.text(`Rep: ${userName} | Date: ${date}`, 25, yPos);
    yPos += 7;
    if (visit.contact_name) {
      doc.text(`Contact: ${visit.contact_name}`, 25, yPos);
      yPos += 7;
    }
    if (visit.location) {
      doc.text(`Location: ${visit.location}`, 25, yPos);
      yPos += 7;
    }
    
    yPos += 5;
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
    'Location': visit.location || '',
    'Notes': visit.notes,
    'AI Summary': visit.ai_summary || '',
    'Tags': visit.tags ? visit.tags.join(', ') : ''
  }));
  
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Visits');
  
  XLSX.writeFile(workbook, `SafiTrack_Report_${fromDate}_to_${toDate}.xlsx`);
}

async function exportToCSV(visits, fromDate, toDate) {
  const headers = ['Date', 'Company', 'Contact', 'Sales Rep', 'Location', 'Notes', 'AI Summary', 'Tags'];
  const rows = visits.map(visit => [
    new Date(visit.created_at).toLocaleDateString(),
    visit.company_name,
    visit.contact_name || '',
    visit.user ? `${visit.user.first_name} ${visit.user.last_name}` : '',
    visit.location || '',
    visit.notes,
    visit.ai_summary || '',
    visit.tags ? visit.tags.join('; ') : ''
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
// PULL TO REFRESH
// ======================

let touchStartY = 0;
let touchCurrentY = 0;
let isPulling = false;

if ('ontouchstart' in window) {
  const pullToRefresh = document.getElementById('pull-to-refresh');
  
  document.addEventListener('touchstart', (e) => {
    if (window.scrollY === 0) {
      touchStartY = e.touches[0].clientY;
    }
  });
  
  document.addEventListener('touchmove', (e) => {
    if (window.scrollY === 0) {
      touchCurrentY = e.touches[0].clientY;
      const pullDistance = touchCurrentY - touchStartY;
      
      if (pullDistance > 0 && pullDistance < 100) {
        isPulling = true;
        pullToRefresh.style.transform = `translateX(-50%) translateY(${pullDistance - 100}%)`;
      } else if (pullDistance >= 100) {
        pullToRefresh.classList.add('active');
      }
    }
  });
  
  document.addEventListener('touchend', async (e) => {
    if (isPulling && pullToRefresh.classList.contains('active')) {
      await refreshCurrentView();
      showToast('✅ Refreshed!', 'success');
    }
    
    pullToRefresh.classList.remove('active');
    pullToRefresh.style.transform = 'translateX(-50%) translateY(-100%)';
    isPulling = false;
    touchStartY = 0;
    touchCurrentY = 0;
  });
}

async function refreshCurrentView() {
  await loadView(currentView);
}

// ======================
// APP INITIALIZATION
// ======================

async function initApp() {
  authScreen.style.display = 'none';
  mainApp.style.display = 'block';

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role, first_name, last_name')
    .eq('id', currentUser.id)
    .single();

  if (error) {
    showToast('Error loading profile: ' + error.message, 'error');
    return;
  }

  isManager = profile.role === 'manager';
  if (isManager) {
    managerViewBtn.style.display = 'flex';
    adminViewBtn.style.display = 'flex';
  } else {
    document.querySelector('[data-view="log-visit"]').style.display = 'flex';
  }

  const displayName = profile.first_name ? `${profile.first_name} ${profile.last_name || ''}` : currentUser.email;
  userDisplay.textContent = displayName;

  // Load widget layout from localStorage
  const savedLayout = localStorage.getItem('widgetLayout');
  if (savedLayout) {
    widgetLayout = JSON.parse(savedLayout);
  }

  // Setup navigation
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const view = e.target.getAttribute('data-view') || e.target.parentElement.getAttribute('data-view');
      loadView(view);
    });
  });

  // Setup theme toggle
  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }

  // Setup parallax scrolling
  setupParallax();

  // Load default view
  loadView(isManager ? 'team-dashboard' : 'log-visit');
}

// ======================
// PARALLAX SCROLLING
// ======================

function setupParallax() {
  let ticking = false;
  
  window.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(() => {
        const scrolled = window.pageYOffset;
        const parallaxElements = document.querySelectorAll('.parallax-bg');
        
        parallaxElements.forEach(el => {
          const speed = el.dataset.speed || 0.5;
          el.style.transform = `translateY(${scrolled * speed}px)`;
        });
        
        ticking = false;
      });
      
      ticking = true;
    }
  });
}

// ======================
// VIEW ROUTER
// ======================

// ======================
// VIEW ROUTER
// ======================

async function loadView(viewName) {
  currentView = viewName;
  updateBreadcrumb(viewName);

  // ✅ DESTROY ALL CHART INSTANCES WHEN SWITCHING VIEWS
  Object.keys(chartInstances).forEach(chartId => {
    if (chartInstances[chartId]) {
      chartInstances[chartId].destroy();
      delete chartInstances[chartId];
    }
  });

  // Update active nav button
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.querySelector(`[data-view="${viewName}"]`);
  if (activeBtn) activeBtn.classList.add('active');

  // Animate nav indicator
  if (activeBtn && navIndicator) {
    const rect = activeBtn.getBoundingClientRect();
    const navRect = activeBtn.parentElement.getBoundingClientRect();
    navIndicator.style.width = `${rect.width}px`;
    navIndicator.style.transform = `translateX(${rect.left - navRect.left}px)`;
  }

  // Show skeleton loading
  viewContainer.innerHTML = renderSkeletonCards(3);

  // Render view after slight delay
  setTimeout(async () => {
    switch(viewName) {
      case 'log-visit':
        renderLogVisitView();
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
          viewContainer.innerHTML = '<div class="card"><h2>⛔ Access Denied</h2><p>Only managers can view the team dashboard.</p></div>';
        }
        break;
      case 'user-management':
        if (isManager) {
          await renderUserManagementView();
        } else {
          viewContainer.innerHTML = '<div class="card"><h2>⛔ Access Denied</h2><p>Only managers can manage users.</p></div>';
        }
        break;
      default:
        viewContainer.innerHTML = '<div class="card"><h2>🔍 View Not Found ! </h2><p>The requested view does not exist.</p></div>';
    }
  }, 300);
}

// ======================
// BREADCRUMB NAVIGATION
// ======================

function updateBreadcrumb(viewName) {
  const breadcrumbMap = {
    'log-visit': 'Log Visit',
    'my-activity': 'My Activity',
    'sales-funnel': 'Sales Funnel',
    'team-dashboard': 'Team Dashboard',
    'user-management': 'User Management'
  };
  
  breadcrumbNav.innerHTML = `
    <span class="breadcrumb-item" onclick="loadView('${isManager ? 'team-dashboard' : 'log-visit'}')">Home</span>
    <span class="breadcrumb-item active">${breadcrumbMap[viewName] || viewName}</span>
  `;
}

// ======================
// LOG VISIT VIEW
// ======================

function renderLogVisitView() {
  const html = `
    <div class="view active" id="log-visit-view">
      <div class="card">
        <h2>📍 Log New Field Visit</h2>
        <p>Record your visit details and get a concise AI summary.</p>
        
        <div class="form-group">
          <label>Company Name *</label>
          <input type="text" id="company-name" placeholder="e.g., Acme Corp" required />
        </div>
        
        <div class="form-group">
          <label>Contact Person at Client</label>
          <input type="text" id="contact-name" placeholder="e.g., Sarah Chen (Client Contact)" />
        </div>
        
        <div class="form-group">
          <label>Visit Type</label>
          <select id="visit-type">
            <option value="new_lead">New Lead</option>
            <option value="follow_up">Follow-up</option>
            <option value="demo">Product Demo</option>
            <option value="closing">Closing</option>
            <option value="support">Customer Support</option>
          </select>
        </div>
        
        <div class="form-group">
          <label>Visit Notes *</label>
          <textarea id="notes" placeholder="What happened? Key takeaways? Objections? Next steps..." rows="6" required></textarea>
          <div class="char-counter"><span id="char-count">0</span>/1000</div>
        </div>

        <div class="form-group">
          <label>Tags & Categories</label>
          <div class="tags-input-container" id="tags-container">
            <input type="text" class="tags-input" id="tags-input" placeholder="Add tags...">
          </div>
          <div class="tag-suggestions">
            <button class="tag-suggestion" onclick="addTag('urgent')">urgent</button>
            <button class="tag-suggestion" onclick="addTag('high-value')">high-value</button>
            <button class="tag-suggestion" onclick="addTag('decision-maker')">decision-maker</button>
            <button class="tag-suggestion" onclick="addTag('follow-up')">follow-up</button>
          </div>
        </div>

        <div class="form-group">
          <label>Visit Photo</label>
          <div class="photo-upload-container">
            <input type="file" id="visit-photo" accept="image/*" style="display: none;" />
            <button id="photo-btn" class="btn secondary">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
              Take Photo
            </button>
            <div id="photo-preview" class="photo-preview"></div>
          </div>
        </div>

        <div class="form-group">
          <label>Location Verification *</label>
          <div id="location-container">
            <button id="add-location" class="btn secondary">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
              Detect My Location
            </button>
            <div id="location-status" class="location-status"></div>
            <div id="location-map" class="location-map"></div>
          </div>
        </div>

        <div class="form-group">
          <label>Travel Time to This Visit</label>
          <input type="number" id="travel-time" placeholder="Minutes" min="0" />
        </div>

        <div class="button-group" style="display: flex; gap: 1rem; margin-top: 1.5rem;">
          <button id="submit-visit" class="btn primary" style="flex: 1;" disabled>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
            Save Visit
          </button>
        </div>
      </div>
    </div>
  `;
  viewContainer.innerHTML = html;

  // CHAR COUNTER
  const notesEl = document.getElementById('notes');
  const charCountEl = document.getElementById('char-count');
  notesEl.addEventListener('input', () => {
    charCountEl.textContent = notesEl.value.length;
  });

  // TAGS INPUT
  visitTags = [];
  const tagsInput = document.getElementById('tags-input');
  tagsInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && tagsInput.value.trim()) {
      e.preventDefault();
      addTag(tagsInput.value.trim());
      tagsInput.value = '';
    }
  });

  // PHOTO CAPTURE
  const photoBtn = document.getElementById('photo-btn');
  const photoInput = document.getElementById('visit-photo');
  const photoPreview = document.getElementById('photo-preview');
  
  photoBtn.addEventListener('click', () => {
    photoInput.click();
  });
  
  photoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        photoPreview.innerHTML = `<img src="${e.target.result}" alt="Visit photo" style="max-width: 100%; max-height: 200px; border-radius: 8px; margin-top: 0.5rem;">`;
      };
      reader.readAsDataURL(file);
    }
  });

  // LOCATION CAPTURE WITH RADIUS VERIFICATION
  const locationBtn = document.getElementById('add-location');
  const locationStatus = document.getElementById('location-status');
  const locationMap = document.getElementById('location-map');
  const submitBtn = document.getElementById('submit-visit');
  let locationCaptured = false;
  let map = null;
  let marker = null;
  let radiusCircle = null;

  locationBtn.addEventListener('click', () => {
    if (!navigator.geolocation) {
      showToast('Geolocation not supported by your browser.', 'error');
      return;
    }
    
    locationStatus.innerHTML = '<div class="spinner" style="width: 16px; height: 16px; border-width: 2px; margin-right: 8px;"></div>Detecting location...';
    
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const accuracy = position.coords.accuracy;
        const coords = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        
        // Verify location accuracy
        if (accuracy > checkInRadius) {
          locationStatus.innerHTML = `⚠️ Location accuracy (${accuracy.toFixed(0)}m) exceeds required radius (${checkInRadius}m)`;
          showToast('Location not accurate enough. Please try again.', 'warning');
          return;
        }
        
        locationStatus.innerHTML = `✅ Location verified: ${coords} (±${accuracy.toFixed(0)}m)`;
        window.tempLocation = { lat, lng, coords, accuracy };
        locationCaptured = true;
        submitBtn.disabled = false;
        
        initializeMap(lat, lng, accuracy);
      },
      (error) => {
        let errorMsg = 'Unable to retrieve location.';
        switch(error.code) {
          case error.PERMISSION_DENIED:
            errorMsg = 'Location permission denied. Please enable GPS.';
            break;
          case error.POSITION_UNAVAILABLE:
            errorMsg = 'Location information unavailable.';
            break;
          case error.TIMEOUT:
            errorMsg = 'Location request timed out.';
            break;
        }
        locationStatus.innerHTML = `❌ ${errorMsg}`;
        showToast(errorMsg, 'error');
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  });
  
  function initializeMap(lat, lng, accuracy) {
    if (!map) {
      map = L.map('location-map').setView([lat, lng], 16);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map);
    }
    
    if (marker) marker.remove();
    if (radiusCircle) radiusCircle.remove();
    
    marker = L.marker([lat, lng]).addTo(map);
    marker.bindPopup('Your location').openPopup();
    
    radiusCircle = L.circle([lat, lng], {
      radius: accuracy,
      color: '#10b981',
      fillColor: '#10b981',
      fillOpacity: 0.2
    }).addTo(map);
    
    map.fitBounds(radiusCircle.getBounds());
  }

  // SUBMIT HANDLER
  submitBtn.addEventListener('click', async () => {
    if (!locationCaptured) {
      showToast('Please detect your location before submitting.', 'error');
      return;
    }
    
    const company = document.getElementById('company-name').value.trim();
    const contact = document.getElementById('contact-name').value.trim();
    const visitType = document.getElementById('visit-type').value;
    const notes = document.getElementById('notes').value.trim();
    const travelTime = document.getElementById('travel-time').value;
    const photoFile = document.getElementById('visit-photo').files[0];

    if (!company || !notes) {
      showToast('Company and Notes are required.', 'error');
      return;
    }

    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<div class="spinner" style="width: 16px; height: 16px; border-width: 2px; margin-right: 8px;"></div>Processing...';

    try {
      let photoUrl = null;
      
      if (photoFile) {
        const photoPath = `visit-photos/${currentUser.id}/${Date.now()}-${photoFile.name}`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('safitrack')
          .upload(photoPath, photoFile);
          
        if (uploadError) throw uploadError;
        
        const { data: urlData } = supabase.storage
          .from('safitrack')
          .getPublicUrl(photoPath);
          
        photoUrl = urlData.publicUrl;
      }

      // Generate AI summary and lead score
      const aiSummary = await generateConciseVisitSummary(company, contact, notes);
      const leadScore = await predictLeadScore(company, contact, notes, visitType);

      const visitData = {
        user_id: currentUser.id,
        company_name: company,
        contact_name: contact || null,
        visit_type: visitType,
        notes: notes,
        ai_summary: aiSummary,
        lead_score: leadScore,
        location: window.tempLocation.coords,
        latitude: window.tempLocation.lat,
        longitude: window.tempLocation.lng,
        location_accuracy: window.tempLocation.accuracy,
        photo_url: photoUrl,
        travel_time: travelTime ? parseInt(travelTime) : null,
        tags: visitTags,
        created_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('visits')
        .insert([visitData]);

      if (error) throw error;

      showToast('✅ Visit logged successfully!', 'success');
      
      // Trigger confetti for high-value visits
      if (leadScore >= 70 || visitTags.includes('high-value')) {
        triggerConfetti();
      }
      
      window.tempLocation = null;
      visitTags = [];
      loadView('my-activity');

    } catch (err) {
      console.error('Error saving visit:', err);
      showToast('Failed to save visit: ' + (err.message || 'Unknown error'), 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalText;
    }
  });
}

function addTag(tag) {
  if (!visitTags.includes(tag)) {
    visitTags.push(tag);
    renderTags();
  }
}

function removeTag(tag) {
  visitTags = visitTags.filter(t => t !== tag);
  renderTags();
}

function renderTags() {
  const container = document.getElementById('tags-container');
  const input = document.getElementById('tags-input');
  
  const tagsHTML = visitTags.map(tag => `
    <span class="tag">
      ${tag}
      <button class="tag-remove" onclick="removeTag('${tag}')">×</button>
    </span>
  `).join('');
  
  container.innerHTML = tagsHTML + input.outerHTML;
  
  // Re-attach event listener
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
// MY ACTIVITY VIEW
// ======================

async function renderMyActivityView() {
  showSkeletonLoading(true);

  const { data: visits, error } = await supabase
    .from('visits')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false });

  showSkeletonLoading(false);

  if (error) {
    viewContainer.innerHTML = `<div class="card"><h2>❌ Error</h2><p>${error.message}</p></div>`;
    return;
  }

  let html = `
    <div class="view active" id="my-activity-view">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
        <h2>📊 My Activity Log</h2>
        <span>${visits.length} visits logged</span>
      </div>
  `;

  if (visits.length === 0) {
    html += `
      <div class="card" style="text-align: center; padding: 3rem;">
        <h3>No visits logged yet</h3>
        <p>Start logging your field visits to see your activity here.</p>
        <button onclick="loadView('log-visit')" class="btn primary" style="margin-top: 1.5rem;">
          Log Your First Visit
        </button>
      </div>
    `;
  } else {
    for (const visit of visits) {
      const date = new Date(visit.created_at).toLocaleString();
      const hasFlag = visit.ai_summary?.includes('urgent') || visit.ai_summary?.includes('priority');
      const leadScoreBadge = visit.lead_score ? getLeadScoreBadge(visit.lead_score) : '';
      
      html += `
        <div class="visit-card">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
            <div>
              <h3>${visit.company_name}</h3>
              ${leadScoreBadge}
            </div>
            ${visit.location ? `<span class="text-sm" style="color: var(--text-muted);">📍 ${visit.location}</span>` : ''}
          </div>
          
          ${visit.contact_name ? `<p><strong>Contact:</strong> ${visit.contact_name}</p>` : ''}
          <p><strong>Date:</strong> ${date}</p>
          ${visit.visit_type ? `<p><strong>Type:</strong> ${visit.visit_type.replace('_', ' ')}</p>` : ''}
          ${visit.travel_time ? `<p><strong>Travel Time:</strong> ${visit.travel_time} minutes</p>` : ''}
          
          ${visit.tags && visit.tags.length > 0 ? `
            <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0.5rem 0;">
              ${visit.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
            </div>
          ` : ''}
          
          ${visit.photo_url ? `
            <div style="margin: 1rem 0;">
              <img src="${visit.photo_url}" alt="Visit photo" style="max-width: 100%; max-height: 200px; border-radius: 8px;">
            </div>
          ` : ''}
          
          <div style="background: var(--bg-tertiary); padding: 1rem; border-radius: 8px; margin: 1rem 0;">
            <p><strong>Your Notes:</strong></p>
            <p>${visit.notes}</p>
          </div>
          
          ${visit.ai_summary ? `
            <div class="ai-insight">
              <h4>🤖 AI Summary</h4>
              <div class="ai-content">${parseMarkdown(visit.ai_summary)}</div>
              <button class="copy-btn" onclick="copyToClipboard(this.parentElement)">📋 Copy</button>
            </div>
          ` : ''}
          
          ${hasFlag ? `
            <div class="ai-flag" style="margin-top: 1rem; padding: 0.75rem; background: rgba(239, 68, 68, 0.1); border-radius: 6px; display: flex; align-items: center; gap: 0.5rem;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--danger)"><polygon points="12 2 22 22 2 22"></polygon><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
              <strong>High Priority Follow-up Needed</strong>
            </div>
          ` : ''}
        </div>
      `;
    }
  }

  html += `</div>`;
  viewContainer.innerHTML = html;
}

// ======================
// SALES FUNNEL VIEW
// ======================

async function renderSalesFunnelView() {
  showSkeletonLoading(true);

  const { data: visits, error } = await supabase
    .from('visits')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false });

  showSkeletonLoading(false);

  if (error) {
    viewContainer.innerHTML = `<div class="card"><h2>❌ Error</h2><p>${error.message}</p></div>`;
    return;
  }

  // Group visits by type
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
    <div class="view active" id="sales-funnel-view">
      <h2>📈 Sales Funnel</h2>
      <p>Track your leads through the sales pipeline</p>
      
      <div class="funnel-container">
  `;

  Object.entries(funnelStages).forEach(([key, stage]) => {
    const count = stage.visits.length;
    const percentage = totalVisits > 0 ? (count / totalVisits * 100).toFixed(1) : 0;
    const avgLeadScore = stage.visits.length > 0 
      ? (stage.visits.reduce((sum, v) => sum + (v.lead_score || 0), 0) / stage.visits.length).toFixed(0)
      : 0;
    
    html += `
      <div class="funnel-stage" style="border-left: 4px solid ${stage.color}">
        <div class="funnel-stage-header">
          <div>
            <div class="funnel-stage-title">${stage.title}</div>
            <small style="color: var(--text-muted);">Avg Lead Score: ${avgLeadScore}%</small>
          </div>
          <div class="funnel-stage-count">${count}</div>
        </div>
        <div class="funnel-stage-bar">
          <div class="funnel-stage-progress" style="width: ${percentage}%; background: ${stage.color}"></div>
        </div>
        <small style="color: var(--text-muted); margin-top: 0.5rem; display: block;">${percentage}% of total visits</small>
      </div>
    `;
  });

  html += `
      </div>
      
      <div class="card" style="margin-top: 2rem;">
        <h3>🎯 High-Priority Leads</h3>
        <div style="display: flex; flex-direction: column; gap: 1rem; margin-top: 1rem;">
  `;

  const highPriorityLeads = visits
    .filter(v => v.lead_score && v.lead_score >= 70)
    .slice(0, 5);

  if (highPriorityLeads.length > 0) {
    highPriorityLeads.forEach(visit => {
      html += `
        <div style="padding: 1rem; background: var(--bg-tertiary); border-radius: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <strong>${visit.company_name}</strong>
              ${visit.contact_name ? `<br><small>${visit.contact_name}</small>` : ''}
            </div>
            ${getLeadScoreBadge(visit.lead_score)}
          </div>
        </div>
      `;
    });
  } else {
    html += '<p style="color: var(--text-muted);">No high-priority leads yet</p>';
  }

  html += `
        </div>
      </div>
    </div>
  `;

  viewContainer.innerHTML = html;
}

function getLeadScoreBadge(score) {
  let className = 'low';
  let label = 'Low Priority';
  
  if (score >= 70) {
    className = 'high';
    label = 'High Priority';
  } else if (score >= 40) {
    className = 'medium';
    label = 'Medium Priority';
  }
  
  return `<span class="lead-score-badge ${className}">🎯 ${label} (${score}%)</span>`;
}

// ======================
// TEAM DASHBOARD VIEW
// ======================

async function renderTeamDashboardView() {
  showSkeletonLoading(true);

  const { data: visits, error } = await supabase
    .from('visits')
    .select(`
      *,
      user:profiles(first_name, last_name, email, role)
    `)
    .order('created_at', { ascending: false });

  showSkeletonLoading(false);

  if (error) {
    viewContainer.innerHTML = `<div class="card"><h2>❌ Error</h2><p>${error.message}</p></div>`;
    return;
  }

  // Group visits by user
  const users = {};
  visits.forEach(visit => {
    const userId = visit.user_id;
    if (!users[userId]) {
      users[userId] = {
        ...visit.user,
        visits: []
      };
    }
    users[userId].visits.push(visit);
  });

  const salesReps = Object.values(users).filter(u => u.role === 'sales_rep');
  const totalVisits = visits.length;
  const totalReps = salesReps.length;
  const avgVisitsPerRep = totalReps > 0 ? (totalVisits / totalReps).toFixed(1) : 0;
  const todayVisits = visits.filter(v => {
    const visitDate = new Date(v.created_at).toDateString();
    const today = new Date().toDateString();
    return visitDate === today;
  }).length;

  const avgLeadScore = visits.filter(v => v.lead_score).length > 0
    ? (visits.reduce((sum, v) => sum + (v.lead_score || 0), 0) / visits.filter(v => v.lead_score).length).toFixed(0)
    : 0;

  let html = `
    <div class="view active" id="team-dashboard-view">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
        <h2>👥 Team Performance Dashboard</h2>
        <div style="display: flex; gap: 0.5rem;">
          <select id="rep-filter" class="btn secondary small">
            <option value="all">All Reps</option>
            ${salesReps.map(rep => `<option value="${rep.id}">${rep.first_name} ${rep.last_name}</option>`).join('')}
          </select>
          <select id="date-filter" class="btn secondary small">
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
          </select>
        </div>
      </div>
      
      <!-- Dashboard Widgets -->
      <div class="dashboard-grid" id="dashboard-widgets">
        <div class="widget draggable" data-widget="total-visits">
          <div class="widget-header">
            <div class="widget-title">📊 Total Visits</div>
            <div class="widget-drag-handle">⋮⋮</div>
          </div>
          <div class="widget-body">
            <div class="widget-stat">${totalVisits}</div>
            <div class="widget-label">All time</div>
          </div>
        </div>
        
        <div class="widget draggable" data-widget="sales-reps">
          <div class="widget-header">
            <div class="widget-title">👤 Sales Reps</div>
            <div class="widget-drag-handle">⋮⋮</div>
          </div>
          <div class="widget-body">
            <div class="widget-stat">${totalReps}</div>
            <div class="widget-label">Active team members</div>
          </div>
        </div>
        
        <div class="widget draggable" data-widget="avg-visits">
          <div class="widget-header">
            <div class="widget-title">📈 Avg Visits/Rep</div>
            <div class="widget-drag-handle">⋮⋮</div>
          </div>
          <div class="widget-body">
            <div class="widget-stat">${avgVisitsPerRep}</div>
            <div class="widget-label">Per representative</div>
          </div>
        </div>
        
        <div class="widget draggable" data-widget="today-visits">
          <div class="widget-header">
            <div class="widget-title">📅 Today's Visits</div>
            <div class="widget-drag-handle">⋮⋮</div>
          </div>
          <div class="widget-body">
            <div class="widget-stat">${todayVisits}</div>
            <div class="widget-label">Logged today</div>
          </div>
        </div>
        
        <div class="widget draggable" data-widget="avg-lead-score">
          <div class="widget-header">
            <div class="widget-title">🎯 Avg Lead Score</div>
            <div class="widget-drag-handle">⋮⋮</div>
          </div>
          <div class="widget-body">
            <div class="widget-stat">${avgLeadScore}%</div>
            <div class="widget-label">Team average</div>
          </div>
        </div>
      </div>
      
      <div class="chart-container">
        <canvas id="performanceChart"></canvas>
      </div>
      
      <div class="section-header">
        <h3>🔍 Team Activity</h3>
      </div>
      
      <!-- Visits Details Section -->
      <div class="card" style="margin-top: 2rem;">
        <h3>📍 Recent Visits</h3>
        <div id="visits-container" style="margin-top: 1rem;">
          <!-- Visits will be rendered here -->
        </div>
      </div>
    </div>
  `;

  viewContainer.innerHTML = html;

  // Initialize filters
  const repFilter = document.getElementById('rep-filter');
  const dateFilter = document.getElementById('date-filter');
  const visitsContainer = document.getElementById('visits-container');

  // Function to filter and render visits
  function renderFilteredVisits() {
    const repId = repFilter.value;
    const dateRange = dateFilter.value;
    
    let filteredVisits = [...visits];
    
    // Filter by rep
    if (repId !== 'all') {
      filteredVisits = filteredVisits.filter(v => v.user_id === repId);
    }
    
    // Filter by date range
    const now = new Date();
    if (dateRange === 'today') {
      filteredVisits = filteredVisits.filter(v => {
        const visitDate = new Date(v.created_at).toDateString();
        return visitDate === now.toDateString();
      });
    } else if (dateRange === 'week') {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      filteredVisits = filteredVisits.filter(v => new Date(v.created_at) >= weekAgo);
    } else if (dateRange === 'month') {
      const monthAgo = new Date();
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      filteredVisits = filteredVisits.filter(v => new Date(v.created_at) >= monthAgo);
    }
    
    // Render the filtered visits
    let visitsHtml = '';
    if (filteredVisits.length === 0) {
      visitsHtml = '<p style="text-align: center; color: var(--text-muted); padding: 2rem;">No visits match the selected filters.</p>';
    } else {
      filteredVisits.forEach(visit => {
        const date = new Date(visit.created_at).toLocaleString();
        const hasFlag = visit.ai_summary?.includes('urgent') || visit.ai_summary?.includes('priority');
        const leadScoreBadge = visit.lead_score ? getLeadScoreBadge(visit.lead_score) : '';
        const repName = visit.user ? `${visit.user.first_name} ${visit.user.last_name}` : 'Unknown';
        
        visitsHtml += `
          <div class="visit-card" style="margin-bottom: 1.5rem;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
              <div>
                <h3>${visit.company_name}</h3>
                <p style="font-size: 0.9rem; color: var(--text-secondary);">Logged by: ${repName}</p>
                ${leadScoreBadge}
              </div>
              ${visit.location ? `<span class="text-sm" style="color: var(--text-muted);">📍 ${visit.location}</span>` : ''}
            </div>
            
            ${visit.contact_name ? `<p><strong>Contact:</strong> ${visit.contact_name}</p>` : ''}
            <p><strong>Date:</strong> ${date}</p>
            ${visit.visit_type ? `<p><strong>Type:</strong> ${visit.visit_type.replace('_', ' ')}</p>` : ''}
            ${visit.travel_time ? `<p><strong>Travel Time:</strong> ${visit.travel_time} minutes</p>` : ''}
            
            ${visit.tags && visit.tags.length > 0 ? `
              <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0.5rem 0;">
                ${visit.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
              </div>
            ` : ''}
            
            ${visit.photo_url ? `
              <div style="margin: 1rem 0;">
                <img src="${visit.photo_url}" alt="Visit photo" style="max-width: 100%; max-height: 200px; border-radius: 8px;">
              </div>
            ` : ''}
            
            ${visit.latitude && visit.longitude ? `
              <div style="margin: 1rem 0;">
                <button class="btn secondary small" onclick="viewLocationOnMap(${visit.latitude}, ${visit.longitude})">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                  View Location
                </button>
              </div>
            ` : ''}
            
            <div style="background: var(--bg-tertiary); padding: 1rem; border-radius: 8px; margin: 1rem 0;">
              <p><strong>Notes:</strong></p>
              <p>${visit.notes}</p>
            </div>
            
            ${visit.ai_summary ? `
              <div class="ai-insight">
                <h4>🤖 AI Summary</h4>
                <div class="ai-content">${parseMarkdown(visit.ai_summary)}</div>
                <button class="copy-btn" onclick="copyToClipboard(this.parentElement)">📋 Copy</button>
              </div>
            ` : ''}
            
            ${hasFlag ? `
              <div class="ai-flag" style="margin-top: 1rem; padding: 0.75rem; background: rgba(239, 68, 68, 0.1); border-radius: 6px; display: flex; align-items: center; gap: 0.5rem;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--danger)"><polygon points="12 2 22 22 2 22"></polygon><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                <strong>High Priority Follow-up Needed</strong>
              </div>
            ` : ''}
          </div>
        `;
      });
    }
    
    visitsContainer.innerHTML = visitsHtml;
  }

  // Add event listeners for filters
  repFilter.addEventListener('change', renderFilteredVisits);
  dateFilter.addEventListener('change', renderFilteredVisits);

  // Initial render
  renderFilteredVisits();

  // Initialize chart and widgets
  setTimeout(() => {
    initPerformanceChart(salesReps);
    initWidgetDragDrop();
  }, 100);
}

// Add this function to view location on map
function viewLocationOnMap(lat, lng) {
  // Create a modal to show the map
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-backdrop" onclick="this.parentElement.remove()"></div>
    <div class="modal-container" style="max-width: 800px; max-height: 600px;">
      <div class="modal-header">
        <h3>Visit Location</h3>
        <button class="icon-btn" onclick="this.closest('.modal').remove()">✕</button>
      </div>
      <div class="modal-body" style="padding: 0; height: 500px;">
        <div id="location-map-modal" style="width: 100%; height: 100%;"></div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Initialize the map
  setTimeout(() => {
    const map = L.map('location-map-modal').setView([lat, lng], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    
    const marker = L.marker([lat, lng]).addTo(map);
    marker.bindPopup('Visit Location').openPopup();
  }, 100);
}
// ======================
// WIDGET DRAG & DROP
// ======================

let widgetEditMode = false;

function toggleWidgetEdit() {
  widgetEditMode = !widgetEditMode;
  const widgets = document.querySelectorAll('.widget');
  
  if (widgetEditMode) {
    widgets.forEach(w => w.style.cursor = 'move');
    showToast('Drag widgets to reorder', 'info');
  } else {
    widgets.forEach(w => w.style.cursor = 'default');
    saveWidgetLayout();
  }
}

function initWidgetDragDrop() {
  const container = document.getElementById('dashboard-widgets');
  if (!container) return;
  
  new Sortable(container, {
    animation: 150,
    handle: '.widget-drag-handle',
    ghostClass: 'dragging',
    onEnd: function() {
      saveWidgetLayout();
    }
  });
}

function saveWidgetLayout() {
  const widgets = Array.from(document.querySelectorAll('.widget'));
  const layout = widgets.map(w => w.dataset.widget);
  localStorage.setItem('widgetLayout', JSON.stringify(layout));
  showToast('✅ Layout saved', 'success');
}

// ======================
// USER MANAGEMENT VIEW
// ======================

async function renderUserManagementView() {
  showSkeletonLoading(true);

  const { data: users, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });

  showSkeletonLoading(false);

  if (error) {
    viewContainer.innerHTML = `<div class="card"><h2>❌ Error</h2><p>${error.message}</p></div>`;
    return;
  }

  let html = `
    <div class="view active" id="user-management-view">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
        <h2>👥 User Management</h2>
        <button class="btn primary" onclick="showAddUserModal()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          Add User
        </button>
      </div>
      
      <div class="card">
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="border-bottom: 2px solid var(--border-color);">
              <th style="padding: 1rem; text-align: left;">Name</th>
              <th style="padding: 1rem; text-align: left;">Email</th>
              <th style="padding: 1rem; text-align: left;">Role</th>
              <th style="padding: 1rem; text-align: left;">Joined</th>
              <th style="padding: 1rem; text-align: center;">Actions</th>
            </tr>
          </thead>
          <tbody>
  `;

  users.forEach(user => {
    const fullName = `${user.first_name} ${user.last_name}`;
    const joinedDate = new Date(user.created_at).toLocaleDateString();
    const roleBadge = user.role === 'manager' 
      ? '<span style="background: var(--accent); color: white; padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.85rem;">Manager</span>'
      : '<span style="background: var(--bg-tertiary); color: var(--text-primary); padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.85rem;">Sales Rep</span>';
    
    html += `
      <tr style="border-bottom: 1px solid var(--border-color);">
        <td style="padding: 1rem;">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <div class="rep-avatar" style="width: 35px; height: 35px; font-size: 0.9rem;">
              ${user.first_name.charAt(0)}${user.last_name.charAt(0)}
            </div>
            ${fullName}
          </div>
        </td>
        <td style="padding: 1rem;">${user.email}</td>
        <td style="padding: 1rem;">${roleBadge}</td>
        <td style="padding: 1rem;">${joinedDate}</td>
        <td style="padding: 1rem; text-align: center;">
          <button class="btn secondary small" onclick="editUser('${user.id}')">Edit</button>
          ${user.id !== currentUser.id ? `<button class="btn danger small" onclick="deleteUser('${user.id}', '${fullName}')">Delete</button>` : ''}
        </td>
      </tr>
    `;
  });

  html += `
          </tbody>
        </table>
      </div>
    </div>
  `;

  viewContainer.innerHTML = html;
}

function showAddUserModal() {
  showToast('User invitation feature coming soon!', 'info');
}

function editUser(userId) {
  showToast('Edit user feature coming soon!', 'info');
}

async function deleteUser(userId, userName) {
  if (!confirm(`Are you sure you want to delete ${userName}? This action cannot be undone.`)) {
    return;
  }
  
  try {
    const { error } = await supabase
      .from('profiles')
      .delete()
      .eq('id', userId);
    
    if (error) throw error;
    
    showToast(`✅ User ${userName} deleted successfully`, 'success');
    renderUserManagementView();
  } catch (err) {
    console.error('Error deleting user:', err);
    showToast('Failed to delete user: ' + err.message, 'error');
  }
}

// ======================
// CHART.JS INTEGRATION
// ======================

// ======================
// CHART.JS INTEGRATION
// ======================

function initPerformanceChart(users) {
  const canvas = document.getElementById('performanceChart');
  if (!canvas) return;
  
  // ✅ DESTROY EXISTING CHART IF IT EXISTS
  if (chartInstances['performanceChart']) {
    chartInstances['performanceChart'].destroy();
    delete chartInstances['performanceChart'];
  }
  
  const ctx = canvas.getContext('2d');
  
  const labels = users.map(u => `${u.first_name} ${u.last_name.charAt(0)}.`);
  const data = users.map(u => u.visits.length);
  
  const thisWeekData = users.map(u => {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    return u.visits.filter(v => new Date(v.created_at) >= oneWeekAgo).length;
  });
  
  const backgroundColors = data.map(d => {
    if (d >= 10) return 'rgba(16, 185, 129, 0.7)';
    if (d >= 5) return 'rgba(59, 130, 246, 0.7)';
    return 'rgba(245, 158, 11, 0.7)';
  });

  // ✅ STORE THE CHART INSTANCE
  chartInstances['performanceChart'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Total Visits',
          data: data,
          backgroundColor: backgroundColors,
          borderColor: backgroundColors.map(c => c.replace('0.7', '1')),
          borderWidth: 1
        },
        {
          label: 'This Week',
          data: thisWeekData,
          backgroundColor: 'rgba(147, 51, 234, 0.7)',
          borderColor: 'rgba(147, 51, 234, 1)',
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            precision: 0
          }
        }
      }
    }
  });
}

// ======================
// UTILITY FUNCTIONS
// ======================

function showSkeletonLoading(show) {
  if (show) {
    document.getElementById('loading-screen').classList.add('active');
    document.getElementById('loading-screen').style.display = 'flex';
  } else {
    document.getElementById('loading-screen').classList.remove('active');
    setTimeout(() => {
      document.getElementById('loading-screen').style.display = 'none';
    }, 300);
  }
}

function renderSkeletonCards(count = 3) {
  let html = '<div class="loading-skeleton">';
  for (let i = 0; i < count; i++) {
    html += `
      <div class="skeleton-card">
        <div class="skeleton-title"></div>
        <div class="skeleton-text"></div>
        <div class="skeleton-text"></div>
        <div class="skeleton-text short"></div>
      </div>
    `;
  }
  html += '</div>';
  return html;
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  
  const icon = themeToggle.querySelector('svg');
  if (next === 'dark') {
    icon.innerHTML = '<path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"></path>';
  } else {
    icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
  }
  
  showToast(`Switched to ${next} mode`, 'success');
}

function triggerConfetti() {
  confetti({
    particleCount: 100,
    spread: 70,
    origin: { y: 0.6 },
    colors: ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']
  });
}

// ======================
// ON PAGE LOAD
// ======================

window.addEventListener('DOMContentLoaded', () => {
  const savedTheme = localStorage.getItem('theme') || (
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  );
  document.documentElement.setAttribute('data-theme', savedTheme);
  
  if (themeToggle) {
    const icon = themeToggle.querySelector('svg');
    if (savedTheme === 'dark') {
      icon.innerHTML = '<path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"></path>';
    }
  }
  
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session) {
      currentUser = session.user;
      setTimeout(() => {
        loadingScreen.classList.add('hidden');
        setTimeout(() => {
          loadingScreen.style.display = 'none';
          initApp();
        }, 300);
      }, 1500);
    } else {
      loadingScreen.classList.add('hidden');
      setTimeout(() => {
        loadingScreen.style.display = 'none';
        authScreen.classList.add('active');
      }, 300);
    }
  });
  
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN') {
      currentUser = session.user;
      initApp();
    } else if (event === 'SIGNED_OUT') {
      currentUser = null;
      authScreen.classList.add('active');
      mainApp.style.display = 'none';
    }
  });
});