// modules/features/technician.js
// Technician-specific views: log visit, survey, installation, maintenance.
import { state, supabaseClient, crmDebugLog, loadPersistedState as _loadPersistedState, saveViewState } from '../state.js';
import { viewContainer } from '../ui/dom.js';
import { showToast, escapeHtml, getInitials, handleImageError } from '../ui/toast.js';
import { renderSkeletonCards, renderError } from '../utils/helpers.js';

async function renderTechnicianLogVisitView() {
  const { data: companies } = await supabaseClient
    .from('companies')
    .select('*')
    .order('name', { ascending: true });

  viewContainer.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Select Work Location</h1>
      <p class="text-muted">Choose a company or enter a custom location to proceed.</p>
    </div>

    <div class="card max-w-2xl mx-auto">
      <div class="form-field">
        <label for="technician-company-name">Search Company</label>
        <div class="search-container">
          <input type="text" id="technician-company-name" placeholder="Search for a company..." autocomplete="off" />
          <div id="technician-company-search-results" class="search-results" style="display: none;"></div>
        </div>
      </div>

      <div class="text-center my-4 text-muted">- OR -</div>

      <div class="form-field">
        <label for="technician-custom-location">Custom Location</label>
        <input type="text" id="technician-custom-location" placeholder="Enter custom location name" />
      </div>

      <div class="form-field mt-6">
        <button id="continue-to-dashboard-btn" class="btn btn-primary w-full" disabled>
          Continue to Dashboard
        </button>
      </div>
    </div>
  `;

  if (window.lucide) lucide.createIcons();

  initTechnicianLocationSelect(companies);
}

function initTechnicianLocationSelect(companies) {
  const searchInput = document.getElementById('technician-company-name');
  const resultsDiv = document.getElementById('technician-company-search-results');
  const customInput = document.getElementById('technician-custom-location');
  const continueBtn = document.getElementById('continue-to-dashboard-btn');

  let selectedCompany = null;

  // Search Logic
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    if (customInput.value) customInput.value = ''; // Clear custom if searching
    selectedCompany = null;
    checkContinue();

    if (query.length === 0) {
      resultsDiv.style.display = 'none';
      return;
    }

    const filtered = companies.filter(c =>
      c.name.toLowerCase().includes(query) ||
      (c.address && c.address.toLowerCase().includes(query))
    );

    if (filtered.length === 0) {
      resultsDiv.innerHTML = '<div class="search-result-item">No companies found</div>';
    } else {
      resultsDiv.innerHTML = filtered.map(c => `
         <div class="search-result-item" onclick="selectTechnicianCompanySelection('${c.id}')">
           <div>
             <div class="search-result-name">${c.name}</div>
             <div class="search-result-role">${c.address || 'No address'}</div>
           </div>
         </div>
       `).join('');
      if (window.lucide) lucide.createIcons();
    }
    resultsDiv.style.display = 'block';
  });

  // Global handler for selection
  window.selectTechnicianCompanySelection = (id) => {
    const company = companies.find(c => c.id === id);
    if (!company) return;
    selectedCompany = company;
    searchInput.value = company.name;
    resultsDiv.style.display = 'none';
    checkContinue();
  };

  customInput.addEventListener('input', () => {
    if (searchInput.value) searchInput.value = '';
    selectedCompany = null;
    checkContinue();
  });

  function checkContinue() {
    const customValue = customInput.value.trim();
    if (selectedCompany || customValue.length > 0) {
      continueBtn.disabled = false;
    } else {
      continueBtn.disabled = true;
    }
  }

  continueBtn.addEventListener('click', () => {
    const locationData = selectedCompany ?
      { type: 'company', id: selectedCompany.id, name: selectedCompany.name, address: selectedCompany.address } :
      { type: 'custom', id: null, name: customInput.value.trim(), address: 'Custom Location' };

    renderTechnicianCompanyDashboard(locationData);
  });
}

// ======================
// TECHNICIAN LOCATION DASHBOARD
// ======================

async function renderTechnicianCompanyDashboard(locationData) {
  // locationData: { type: 'company'|'custom', id, name, address }

  viewContainer.innerHTML = `
    <div class="page-header">
      <button class="btn btn-back mb-2" onclick="renderTechnicianLogVisitView()" aria-label="Change location" title="Change location">
        <span class="btn-back-icon"><i data-lucide="arrow-left"></i></span>
        <span class="btn-back-text">Change Location</span>
      </button>
      <h1 class="page-title">${locationData.name}</h1>
      <p class="text-muted">${locationData.address || 'Custom Location'}</p>
    </div>

    <!-- Actions Grid -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
      <div class="card hover:shadow-lg transition-all cursor-pointer" onclick="renderTechnicianForm('survey_visit', '${encodeURIComponent(JSON.stringify(locationData))}')">
        <div class="flex flex-col items-center text-center p-4">
          <div class="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center mb-3 text-blue-600">
            <i data-lucide="clipboard-list" style="width: 24px; height: 24px;"></i>
          </div>
          <h3 class="font-semibold text-lg">Survey Visit</h3>
          <p class="text-sm text-muted mt-1">Standard site survey</p>
        </div>
      </div>

      <div class="card hover:shadow-lg transition-all cursor-pointer" onclick="renderTechnicianForm('installation_visit', '${encodeURIComponent(JSON.stringify(locationData))}')">
        <div class="flex flex-col items-center text-center p-4">
          <div class="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mb-3 text-green-600">
            <i data-lucide="zap" style="width: 24px; height: 24px;"></i>
          </div>
          <h3 class="font-semibold text-lg">Installation Visit</h3>
          <p class="text-sm text-muted mt-1">Full system installation</p>
        </div>
      </div>

      <div class="card hover:shadow-lg transition-all cursor-pointer" onclick="renderTechnicianForm('maintenance_visit', '${encodeURIComponent(JSON.stringify(locationData))}')">
        <div class="flex flex-col items-center text-center p-4">
          <div class="w-12 h-12 rounded-full bg-purple-100 flex items-center justify-center mb-3 text-purple-600">
            <i data-lucide="settings" style="width: 24px; height: 24px;"></i>
          </div>
          <h3 class="font-semibold text-lg">Maintenance Visit</h3>
          <p class="text-sm text-muted mt-1">Routine AMC & Repair</p>
        </div>
      </div>
    </div>
    </div>
  `;

  if (window.lucide) lucide.createIcons();

  // history removed per design revamp
}

// Helper to load history
async function loadLocationHistory(locationData) {
  const listContainer = document.getElementById('location-history-list');

  let query = supabaseClient
    .from('technician_visits')
    .select(`
      *,
      technician:users!technician_id(name)
    `)
    .order('created_at', { ascending: false })
    .limit(10);

  if (locationData.type === 'company') {
    query = query.eq('company_id', locationData.id);
  } else {
    // For custom locations, we filter by name for now
    query = query.eq('company_name', locationData.name);
  }

  const { data: visits, error } = await query;

  if (error || !visits || visits.length === 0) {
    listContainer.innerHTML = `
      <div class="card p-6 text-center">
        <p class="text-muted">No recent forms found for this location.</p>
      </div>
    `;
    return;
  }

  listContainer.innerHTML = visits.map(visit => `
    <div class="card p-4 flex justify-between items-center">
      <div>
        <div class="font-medium">${formatFormType(visit.form_type)}</div>
        <div class="text-sm text-muted">
          ${formatDate(visit.created_at)} • ${visit.technician?.name || 'Unknown User'}
        </div>
      </div>
      <div class="text-sm">
        <span class="badge badge-outline">Submitted</span>
      </div>
    </div>
  `).join('');
}

function formatFormType(type) {
  if (type === 'survey_visit') return 'Survey Visit';
  if (type === 'installation_visit') return 'Installation Visit';
  if (type === 'maintenance_visit') return 'Maintenance Visit';
  return type || 'Unknown Form';
}

// ======================
// GENERIC FORM RENDERER
// ======================

window.renderTechnicianForm = function (formType, locationDataStr) {
  const locationData = JSON.parse(decodeURIComponent(locationDataStr));

  if (formType === 'survey_visit') {
    renderSurveyVisitForm(locationData);
    return;
  }
  if (formType === 'installation_visit') {
    renderInstallationVisitForm(locationData);
    return;
  }
  if (formType === 'maintenance_visit') {
    renderMaintenanceVisitForm(locationData);
    return;
  }

  viewContainer.innerHTML = `
    <div class="page-header">
      <button class="btn btn-back mb-2" onclick='renderTechnicianCompanyDashboard(${JSON.stringify(locationData)})' aria-label="Back to dashboard" title="Back to dashboard">
        <span class="btn-back-icon"><i data-lucide="arrow-left"></i></span>
        <span class="btn-back-text">Back to Dashboard</span>
      </button>
      <h1 class="page-title">${formatFormType(formType)}</h1>
      <p class="text-muted">${locationData.name}</p>
    </div>

    <div class="card p-8 text-center">
      <i data-lucide="hammer" class="w-16 h-16 text-muted mb-4 mx-auto"></i>
      <h2 class="text-xl font-bold mb-2">Form Under Construction</h2>
      <p class="text-muted mb-6">This form template is being implemented. Please provide the details for ${formatFormType(formType)}.</p>
      <button class="btn btn-primary" onclick='renderTechnicianCompanyDashboard(${JSON.stringify(locationData)})'>
        Return to Location Dashboard
      </button>
    </div>
  `;
  if (window.lucide) lucide.createIcons();
};

// ======================
// FORM 1: SURVEY VISIT
// ======================

function renderSurveyVisitForm(locationData) {
  viewContainer.innerHTML = `
    <div class="page-header">
      <button class="btn btn-back mb-2" onclick='renderTechnicianCompanyDashboard(${JSON.stringify(locationData)})' aria-label="Back to dashboard" title="Back to dashboard">
        <span class="btn-back-icon"><i data-lucide="arrow-left"></i></span>
        <span class="btn-back-text">Back to Dashboard</span>
      </button>
      <h1 class="page-title">Survey Visit</h1>
      <p class="text-muted">${locationData.name}</p>
    </div>

    <div class="card max-w-3xl mx-auto">
      <div class="card-body">
        
        <!-- SECTION: VISIT INFO -->
        <div class="section-container mb-6">
          <h3 class="card-title text-lg mb-4 border-b pb-2">Visit Information</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-field">
              <label>Technician Name</label>
              <input type="text" value="${state.currentUser.first_name} ${state.currentUser.last_name}" disabled class="bg-slate-100">
            </div>
            <div class="form-field">
              <label>Visit Date</label>
              <input type="date" id="visit-date" value="${new Date().toISOString().split('T')[0]}" required>
            </div>
            <div class="form-field md:col-span-2">
              <label>GPS Location</label>
              <div class="flex gap-2">
                <button type="button" id="capture-gps-btn" class="btn btn-secondary flex-1">
                  <i data-lucide="map-pin"></i> Capture GPS
                </button>
                <input type="text" id="gps-coordinates" placeholder="Lat, Long" readonly class="flex-1 bg-slate-100">
              </div>
            </div>
          </div>
        </div>

        <!-- SECTION: CLIENT INFORMATION -->
        <div class="section-container mb-6">
          <h3 class="card-title text-lg mb-4 border-b pb-2">Client Information</h3>
          <div class="form-field">
            <label>Company / Client Name</label>
            <input type="text" value="${locationData.name}" disabled class="bg-slate-100">
          </div>
          <div class="form-field">
            <label>Address / Location</label>
            <input type="text" id="client-address" value="${locationData.address || ''}" ${locationData.type === 'company' ? 'disabled' : ''} placeholder="Enter address">
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-field">
              <label>Phone Number</label>
              <input type="tel" id="client-phone" placeholder="Enter phone number">
            </div>
            <div class="form-field">
              <label>Email</label>
              <input type="email" id="client-email" placeholder="Enter email">
            </div>
          </div>
        </div>

        <!-- SECTION: LOAD REQUIREMENTS -->
        <div class="section-container mb-6">
          <h3 class="card-title text-lg mb-4 border-b pb-2">Load Requirements</h3>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div class="form-field">
              <label>Total Load (Watts)</label>
              <input type="number" id="total-load" placeholder="e.g. 5000">
            </div>
            <div class="form-field">
              <label>Backup Time (Hours)</label>
              <input type="number" id="backup-time" placeholder="e.g. 4">
            </div>
            <div class="form-field">
              <label>No. of Appliances</label>
              <input type="number" id="appliance-count" placeholder="e.g. 10">
            </div>
          </div>
          <div class="form-field mt-4">
            <label>Appliance Details</label>
            <textarea id="appliance-details" rows="3" placeholder="List major appliances (e.g. 2 ACs, 1 Fridge, 5 Computers)"></textarea>
          </div>
        </div>

        <!-- SECTION: BATTERY REQUIREMENTS -->
        <div class="section-container mb-6">
          <h3 class="card-title text-lg mb-4 border-b pb-2">Battery Requirements</h3>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div class="form-field">
              <label>Battery Type</label>
              <select id="battery-type">
                <option value="">Select Type</option>
                <option value="Lithium">Lithium</option>
                <option value="Tubular">Tubular</option>
                <option value="SMF">SMF</option>
                <option value="Gel">Gel</option>
                <option value="Flooded">Flooded</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div class="form-field">
              <label>Quantity</label>
              <input type="number" id="battery-quantity" placeholder="Qty">
            </div>
            <div class="form-field">
              <label>Voltage</label>
              <select id="battery-voltage">
                <option value="">Select Voltage</option>
                <option value="12V">12V</option>
                <option value="24V">24V</option>
                <option value="48V">48V</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>
        </div>

        <!-- SECTION: INSTALLATION DETAILS -->
        <div class="section-container mb-6">
          <h3 class="card-title text-lg mb-4 border-b pb-2">Installation Details</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-field">
              <label>Installation Location</label>
              <select id="install-location">
                <option value="">Select Location</option>
                <option value="Indoor">Indoor</option>
                <option value="Outdoor">Outdoor</option>
                <option value="Utility Room">Utility Room</option>
                <option value="Garage">Garage</option>
                <option value="Office">Office</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div class="form-field">
              <label>Distance from Inverter (m)</label>
              <input type="number" id="install-distance" placeholder="Meters">
            </div>
            <div class="form-field">
              <label>Cable Size Required</label>
              <input type="text" id="cable-size" placeholder="e.g. 16mm">
            </div>
            <div class="form-field">
              <label>Feasibility</label>
              <select id="install-feasibility">
                <option value="">Select Feasibility</option>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
                <option value="Needs Review">Needs Review</option>
              </select>
            </div>
          </div>
        </div>

        <!-- SECTION: NOTES & VERIFICATION -->
        <div class="section-container mb-6">
          <h3 class="card-title text-lg mb-4 border-b pb-2">Notes & Verification</h3>
          
          <div class="form-field">
            <label>Technician Notes</label>
            <textarea id="technician-notes" rows="4" placeholder="Enter findings, recommendations, etc."></textarea>
          </div>

          <div class="form-field mt-4">
            <label>Photos (Max 10)</label>
            <input type="file" id="technician-photos" accept="image/*" multiple style="display: none;" />
            <div class="photo-upload-multiple" id="photo-upload-multiple">
              <i data-lucide="camera" class="w-6 h-6 mb-2"></i>
              <p>Tap to add photos</p>
            </div>
            <div class="photo-grid mt-4" id="photo-preview-grid"></div>
          </div>

          <div class="form-field mt-6">
            <label>Technician Signature</label>
            <div class="signature-container bg-slate-50 dark:bg-slate-900 border rounded-lg h-40 relative">
              <canvas id="technician-signature-canvas" class="signature-canvas w-full h-full"></canvas>
              <div class="signature-placeholder absolute inset-0 flex items-center justify-center text-muted pointer-events-none" id="technician-signature-placeholder">
                Sign Here
              </div>
            </div>
            <button type="button" class="btn btn-sm btn-ghost mt-2" id="clear-technician-signature">Clear</button>
          </div>
        </div>

        <div class="form-field mt-8">
          <button id="submit-survey-visit" class="btn btn-primary w-full py-3 text-lg">
            Submit Survey Visit
          </button>
        </div>
      </div>
    </div>
  `;

  if (window.lucide) lucide.createIcons();

  initSurveyVisitForm(locationData);
}

function initSurveyVisitForm(locationData) {
  window.technicianVisitForm = {
    selectedCompany: locationData.type === 'company' ? locationData : null,
    capturedLocation: null,
    technicianSignature: null,
    photos: [],
    technicianSignatureCanvas: null,
    technicianSignatureCtx: null,
    isTechnicianDrawing: false
  };

  // 1. GPS Logic
  const gpsBtn = document.getElementById('capture-gps-btn');
  const gpsInput = document.getElementById('gps-coordinates');

  if (gpsBtn) {
    gpsBtn.addEventListener('click', () => {
      if (!navigator.geolocation) {
        showToast('Geolocation not supported', 'error');
        return;
      }
      gpsBtn.disabled = true;
      gpsBtn.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> Capturing...';
      if (window.lucide) lucide.createIcons();

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          window.technicianVisitForm.capturedLocation = { latitude, longitude };
          gpsInput.value = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
          gpsBtn.className = 'btn btn-success flex-1';
          gpsBtn.innerHTML = '<i data-lucide="check"></i> Captured';
          gpsBtn.disabled = false;
          if (window.lucide) lucide.createIcons();
        },
        (err) => {
          console.error(err);
          gpsBtn.disabled = false;
          gpsBtn.innerHTML = '<i data-lucide="map-pin"></i> Retry';
          showToast('Location capture failed', 'error');
          if (window.lucide) lucide.createIcons();
        }
      );
    });
  }

  // 2. Photo Logic
  const photoInput = document.getElementById('technician-photos');
  const photoUploadArea = document.getElementById('photo-upload-multiple');

  if (photoUploadArea) {
    photoUploadArea.addEventListener('click', () => photoInput.click());

    photoInput.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files).slice(0, 10);
      if (files.length === 0) return;

      window.technicianVisitForm.photos = [];
      const grid = document.getElementById('photo-preview-grid');
      grid.innerHTML = '<div class="text-center w-full"><i data-lucide="loader" class="animate-spin"></i> Compressing...</div>';
      if (window.lucide) lucide.createIcons();

      const processedPhotos = [];
      for (const file of files) {
        if (!file.type.startsWith('image/')) continue;
        processedPhotos.push(await compressImage(file));
      }
      window.technicianVisitForm.photos = processedPhotos;

      grid.innerHTML = processedPhotos.map((p) => {
        const url = p.dataUrl || (p instanceof File ? URL.createObjectURL(p) : 'https://via.placeholder.com/300x300?text=No+Preview');
        return `
          <div class="relative aspect-square bg-slate-100 rounded overflow-hidden">
            <img src="${url}" class="w-full h-full object-cover" />
          </div>
        `;
      }).join('');
    });
  }

  // 3. Signature Logic
  setTimeout(() => {
    const canvas = document.getElementById('technician-signature-canvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';

    let isDrawing = false;

    const getPos = (e) => {
      const r = canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return { x: clientX - r.left, y: clientY - r.top };
    };

    const start = (e) => {
      isDrawing = true;
      ctx.beginPath();
      const { x, y } = getPos(e);
      ctx.moveTo(x, y);
      const placeholder = document.getElementById('technician-signature-placeholder');
      if (placeholder) placeholder.style.display = 'none';
      e.preventDefault();
    };

    const move = (e) => {
      if (!isDrawing) return;
      const { x, y } = getPos(e);
      ctx.lineTo(x, y);
      ctx.stroke();
      e.preventDefault();
    };

    const end = () => {
      if (!isDrawing) return;
      isDrawing = false;
      window.technicianVisitForm.technicianSignature = canvas.toDataURL();
    };

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start);
    canvas.addEventListener('touchmove', move);
    canvas.addEventListener('touchend', end);

    const clearBtn = document.getElementById('clear-technician-signature');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const placeholder = document.getElementById('technician-signature-placeholder');
        if (placeholder) placeholder.style.display = 'flex';
        window.technicianVisitForm.technicianSignature = null;
      });
    }
  }, 100);

  // 4. Submit Logic
  const submitBtn = document.getElementById('submit-survey-visit');
  if (submitBtn) {
    submitBtn.addEventListener('click', async () => {
      // Basic Validation
      if (!window.technicianVisitForm.technicianSignature) {
        showToast('Technician signature is required', 'error');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> Submitting...';
      if (window.lucide) lucide.createIcons();

      try {
        // Upload photos
        const photoUrls = [];
        for (const p of window.technicianVisitForm.photos) {
          const fileToUpload = p.file || (p instanceof File ? p : null);
          if (!fileToUpload) continue;
          const fileName = fileToUpload.name ? fileToUpload.name.replace(/[^a-zA-Z0-9.]/g, '_') : `photo-${Date.now()}.jpg`;
          const path = `technician-photos/${state.currentUser.id}/${Date.now()}-${fileName}`;
          const { error } = await supabaseClient.storage.from('safitrack').upload(path, fileToUpload, {
            contentType: 'image/jpeg',
            upsert: true
          });
          if (!error) {
            const { data } = supabaseClient.storage.from('safitrack').getPublicUrl(path);
            photoUrls.push(data.publicUrl);
          } else {
            console.error('Upload error detail:', error);
          }
        }

        // Construct Data
        const formData = {
          client_phone: document.getElementById('client-phone')?.value,
          client_email: document.getElementById('client-email')?.value,
          client_address: document.getElementById('client-address')?.value,
          total_load_watts: document.getElementById('total-load')?.value,
          backup_time_hours: document.getElementById('backup-time')?.value,
          appliance_count: document.getElementById('appliance-count')?.value,
          appliance_details: document.getElementById('appliance-details')?.value,
          battery_type: document.getElementById('battery-type')?.value,
          battery_quantity: document.getElementById('battery-quantity')?.value,
          battery_voltage: document.getElementById('battery-voltage')?.value,
          install_location: document.getElementById('install-location')?.value,
          install_distance: document.getElementById('install-distance')?.value,
          cable_size: document.getElementById('cable-size')?.value,
          install_feasibility: document.getElementById('install-feasibility')?.value,
          technician_notes: document.getElementById('technician-notes')?.value,
          visit_date: document.getElementById('visit-date')?.value
        };

        const visitData = {
          technician_id: state.currentUser.id,
          company_id: locationData.type === 'company' ? locationData.id : null,
          company_name: locationData.name,
          location_name: locationData.type === 'custom' ? locationData.name : null,
          form_type: 'survey_visit',
          visit_type: 'survey',
          visit_notes: formData.technician_notes || 'Service Survey',
          technician_signature: window.technicianVisitForm.technicianSignature,
          photos: photoUrls.length > 0 ? photoUrls : null,
          latitude: window.technicianVisitForm.capturedLocation?.latitude,
          longitude: window.technicianVisitForm.capturedLocation?.longitude,
          created_at: new Date().toISOString(),
          form_data: formData,
          organization_id: state.currentOrganization?.id
        };

        const { error } = await supabaseClient.from('technician_visits').insert([visitData]);
        if (error) throw error;

        showToast('Survey Visit Submitted!', 'success');
        setTimeout(() => {
          renderTechnicianCompanyDashboard(locationData);
        }, 1500);

      } catch (e) {
        console.error(e);
        showToast('Submission failed: ' + e.message, 'error');
        submitBtn.disabled = false;
        submitBtn.innerHTML = 'Submit Survey Visit';
      }
    });
  }
}

const INVERTER_MODELS = {
  'Kstar': [
    { model: 'Kstar 3.6Kva - 24V', kva: '3.6', voltage: '24V' },
    { model: 'Kstar 3.6Kva - 48V', kva: '3.6', voltage: '48V' },
    { model: 'Kstar 6Kva - 48V', kva: '6', voltage: '48V' }
  ],
  'Fortuner': [
    { model: 'Fortuner 0.7kVA (450W) - 12V', kva: '0.7', voltage: '12V' },
    { model: 'Fortuner 1.5kVA (1200W) - 24V', kva: '1.5', voltage: '24V' },
    { model: 'Fortuner 2.2kVA (1400W) - 24V', kva: '2.2', voltage: '24V' },
    { model: 'Fortuner 10kVA - 48V', kva: '10', voltage: '48V' }
  ]
};

// ======================
// FORM 2: INSTALLATION VISIT
// ======================

function renderInstallationVisitForm(locationData) {
  viewContainer.innerHTML = `
    <div class="page-header">
      <button class="btn btn-back mb-2" onclick='renderTechnicianCompanyDashboard(${JSON.stringify(locationData)})' aria-label="Back to dashboard" title="Back to dashboard">
        <span class="btn-back-icon"><i data-lucide="arrow-left"></i></span>
        <span class="btn-back-text">Back to Dashboard</span>
      </button>
      <h1 class="page-title">Installation Visit</h1>
      <p class="text-muted">${locationData.name}</p>
    </div>

    <div class="card max-w-3xl mx-auto">
      <div class="card-body">
        
        <!-- Section: Visit Info -->
        <div class="section-container mb-6">
          <h3 class="card-title text-lg mb-4 border-b pb-2">Visit Info</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-field">
              <label>Technician Name</label>
              <input type="text" value="${state.currentUser.first_name} ${state.currentUser.last_name}" disabled class="bg-slate-100">
            </div>
            <div class="form-field">
              <label>Visit Date</label>
              <input type="date" id="install-visit-date" value="${new Date().toISOString().split('T')[0]}" required>
            </div>
            <div class="form-field md:col-span-2">
              <label>GPS Location</label>
              <div class="flex gap-2">
                <button type="button" id="install-capture-gps-btn" class="btn btn-secondary flex-1">
                  <i data-lucide="map-pin"></i> Capture GPS
                </button>
                <input type="text" id="install-gps-coordinates" placeholder="Lat, Long" readonly class="flex-1 bg-slate-100">
              </div>
            </div>
          </div>
        </div>

        <!-- Section: Client Information -->
        <div class="section-container mb-6">
          <h3 class="card-title text-lg mb-4 border-b pb-2">Client Information</h3>
          <div class="form-field">
            <label>Company / Client Name</label>
            <input type="text" value="${locationData.name}" disabled class="bg-slate-100">
          </div>
          <div class="form-field">
            <label>Address / Location</label>
            <input type="text" id="install-client-address" value="${locationData.address || ''}" ${locationData.type === 'company' ? 'disabled' : ''} placeholder="Enter address">
          </div>
          <div class="form-field">
            <label>Reference Number</label>
            <input type="text" id="install-reference" placeholder="e.g. ST-2024-001">
          </div>
        </div>

        <!-- Section: Inverter Information -->
        <div class="section-container mb-6">
          <h3 class="card-title text-lg mb-4 border-b pb-2">Inverter Information</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-field">
              <label>Manufacturer</label>
              <select id="inverter-manufacturer">
                <option value="">Select Manufacturer</option>
                <option value="Kstar">Kstar</option>
                <option value="Fortuner">Fortuner</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div class="form-field">
              <label>Model</label>
              <div id="model-input-container">
                <input type="text" id="inverter-model-custom" placeholder="Enter model" style="display: none;">
                <select id="inverter-model-list">
                  <option value="">Select Model</option>
                </select>
              </div>
            </div>
            <div class="form-field">
              <label>Serial Number</label>
              <input type="text" id="inverter-serial" placeholder="Enter serial number">
            </div>
            <div class="form-field">
              <label>KVA Rating</label>
              <input type="text" id="inverter-kva" placeholder="e.g. 5Kva">
            </div>
            <div class="form-field">
              <label>Inverter Type</label>
              <select id="inverter-type">
                <option value="">Select Type</option>
                <option value="Pure Sine Wave">Pure Sine Wave</option>
                <option value="Hybrid">Hybrid</option>
                <option value="Off-Grid">Off-Grid</option>
                <option value="On-Grid">On-Grid</option>
                <option value="UPS">UPS</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Section: Battery Information -->
        <div class="section-container mb-6">
          <h3 class="card-title text-lg mb-4 border-b pb-2">Battery Information</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-field">
              <label>Battery Brand</label>
              <select id="battery-brand">
                <option value="">Select Brand</option>
                <option value="Delta">Delta</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div class="form-field">
              <label>Quantity</label>
              <input type="number" id="battery-qty" placeholder="Qty">
            </div>
            <div class="form-field">
              <label>Voltage</label>
              <select id="battery-volts">
                <option value="">Select Voltage</option>
                <option value="12V">12V</option>
                <option value="24V">24V</option>
                <option value="48V">48V</option>
              </select>
            </div>
            <div class="form-field">
              <label>Amp Rating (Ah)</label>
              <input type="number" id="battery-ah" placeholder="e.g. 200">
            </div>
          </div>
        </div>

        <!-- Section: Electrical Measurements -->
        <div class="section-container mb-6">
          <h3 class="card-title text-lg mb-4 border-b pb-2">Electrical Measurements</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-field">
              <label>Input Voltage (VAC)</label>
              <input type="number" id="input-vac" placeholder="e.g. 230">
            </div>
            <div class="form-field">
              <label>Output Voltage (VAC)</label>
              <input type="number" id="output-vac" placeholder="e.g. 230">
            </div>
            <div class="form-field">
              <label>Charging Voltage (VDC)</label>
              <input type="number" id="charging-vdc" placeholder="e.g. 54.4">
            </div>
            <div class="form-field">
              <label>Output Frequency</label>
              <select id="output-freq">
                <option value="50 Hz">50 Hz</option>
                <option value="60 Hz">60 Hz</option>
              </select>
            </div>
            <div class="form-field">
              <label>Backup Time (Minutes)</label>
              <input type="number" id="backup-min" placeholder="e.g. 120">
            </div>
          </div>
        </div>

        <!-- Section: Inspection Checklist -->
        <div class="section-container mb-6">
          <h3 class="card-title text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">Inspection Checklist</h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            ${[
      'General Wiring Checked', 'Fuses Checked', 'Ventilation / Fans Checked',
      'Load Test Completed', 'Battery Mode Test Completed', 'Display Checked',
      'Terminal Labelled', 'Operation Manual Provided', 'Manual Bypass Checked',
      'Neutral Continuity Checked'
    ].map((item, i) => `
              <label class="flex items-center gap-3 p-3 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl hover:border-primary/50 transition-colors cursor-pointer group">
                <div class="relative flex items-center">
                  <input type="checkbox" class="install-checklist-item w-5 h-5 rounded border-slate-300 text-primary focus:ring-primary/20 transition-all cursor-pointer" data-item="${item}">
                </div>
                <span class="text-sm font-medium text-slate-700 dark:text-slate-200 group-hover:text-primary transition-colors">${item}</span>
              </label>
            `).join('')}
          </div>
        </div>

        <!-- Section: Notes & Verification -->
        <div class="section-container mb-6">
          <h3 class="card-title text-lg mb-4 border-b pb-2">Notes & Verification</h3>
          <div class="form-field">
            <label>Technician Notes</label>
            <textarea id="install-notes" rows="4" placeholder="Enter findings, recommendations, etc."></textarea>
          </div>

          <div class="form-field mt-4">
            <label>Photos (Max 10)</label>
            <input type="file" id="install-photos" accept="image/*" multiple style="display: none;" />
            <div class="photo-upload-multiple" id="install-photo-upload">
              <i data-lucide="camera" class="w-6 h-6 mb-2"></i>
              <p>Tap to add photos</p>
            </div>
            <div class="photo-grid mt-4" id="install-photo-grid"></div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
            <div class="form-field">
              <label>Technician Signature</label>
              <div class="signature-container bg-slate-50 dark:bg-slate-900 border rounded-lg h-40 relative">
                <canvas id="install-tech-sig-canvas" class="signature-canvas w-full h-full"></canvas>
                <div class="signature-placeholder absolute inset-0 flex items-center justify-center text-muted pointer-events-none" id="install-tech-sig-placeholder">
                  Sign Here
                </div>
              </div>
              <button type="button" class="btn btn-sm btn-ghost mt-2" id="clear-install-tech-sig">Clear</button>
            </div>

            <div class="form-field">
              <label>Client Signature</label>
              <div class="signature-container bg-slate-50 dark:bg-slate-900 border rounded-lg h-40 relative">
                <canvas id="install-client-sig-canvas" class="signature-canvas w-full h-full"></canvas>
                <div class="signature-placeholder absolute inset-0 flex items-center justify-center text-muted pointer-events-none" id="install-client-sig-placeholder">
                  Sign Here
                </div>
              </div>
              <button type="button" class="btn btn-sm btn-ghost mt-2" id="clear-install-client-sig">Clear</button>
            </div>
          </div>
        </div>

        <div class="form-field mt-8">
          <button id="submit-install-visit" class="btn btn-primary w-full py-3 text-lg">
            Submit Installation Visit
          </button>
        </div>
      </div>
    </div>
  `;

  if (window.lucide) lucide.createIcons();

  initInstallationVisitForm(locationData);
}

function initInstallationVisitForm(locationData) {
  window.technicianVisitForm = {
    selectedCompany: locationData.type === 'company' ? locationData : null,
    capturedLocation: null,
    technicianSignature: null,
    clientSignature: null,
    photos: []
  };

  // 1. Inverter Auto-fill Logic
  const manufacturerSelect = document.getElementById('inverter-manufacturer');
  const modelList = document.getElementById('inverter-model-list');
  const modelCustom = document.getElementById('inverter-model-custom');
  const kvaInput = document.getElementById('inverter-kva');
  const batteryVolts = document.getElementById('battery-volts');

  manufacturerSelect.addEventListener('change', (e) => {
    const brand = e.target.value;
    modelList.innerHTML = '<option value="">Select Model</option>';

    if (brand === 'Other' || !brand) {
      modelList.style.display = 'none';
      modelCustom.style.display = 'block';
    } else {
      modelList.style.display = 'block';
      modelCustom.style.display = 'none';
      if (INVERTER_MODELS[brand]) {
        INVERTER_MODELS[brand].forEach(m => {
          const opt = document.createElement('option');
          opt.value = m.model;
          opt.textContent = m.model;
          opt.dataset.kva = m.kva;
          opt.dataset.voltage = m.voltage;
          modelList.appendChild(opt);
        });
      }
    }
  });

  modelList.addEventListener('change', (e) => {
    const opt = e.target.selectedOptions[0];
    if (opt && opt.value) {
      kvaInput.value = opt.dataset.kva + ' Kva';
      batteryVolts.value = opt.dataset.voltage;
    }
  });

  // 2. GPS Logic
  const gpsBtn = document.getElementById('install-capture-gps-btn');
  const gpsInput = document.getElementById('install-gps-coordinates');
  gpsBtn.addEventListener('click', () => {
    gpsBtn.disabled = true;
    gpsBtn.innerHTML = '<i data-lucide="loader" class="animate-spin"></i>';
    if (window.lucide) lucide.createIcons();
    navigator.geolocation.getCurrentPosition((pos) => {
      window.technicianVisitForm.capturedLocation = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      gpsInput.value = `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`;
      gpsBtn.className = 'btn btn-success flex-1';
      gpsBtn.innerHTML = '<i data-lucide="check"></i> Captured';
      gpsBtn.disabled = false;
      if (window.lucide) lucide.createIcons();
    });
  });

  // 3. Photo Logic
  const photoInput = document.getElementById('install-photos');
  const photoArea = document.getElementById('install-photo-upload');
  photoArea.addEventListener('click', () => photoInput.click());
  photoInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files).slice(0, 10);
    const grid = document.getElementById('install-photo-grid');
    grid.innerHTML = '<p class="text-center w-full">Compressing...</p>';
    window.technicianVisitForm.photos = [];
    const processed = [];
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      processed.push(await compressImage(file));
    }
    window.technicianVisitForm.photos = processed;
    grid.innerHTML = processed.map(p => {
      const url = p.dataUrl || (p instanceof File ? URL.createObjectURL(p) : 'https://via.placeholder.com/300x300?text=No+Preview');
      return `<img src="${url}" class="aspect-square object-cover rounded">`;
    }).join('');
  });

  // 4. Signature Logic (Simplified setup)
  setTimeout(() => {
    setupInstallCanvas('install-tech-sig-canvas', 'tech');
    setupInstallCanvas('install-client-sig-canvas', 'client');
  }, 100);

  function setupInstallCanvas(id, type) {
    const canvas = document.getElementById(id);
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width; canvas.height = rect.height;
    ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    let drawing = false;
    const getPos = (e) => {
      const r = canvas.getBoundingClientRect();
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      return { x: cx - r.left, y: cy - r.top };
    };
    const start = (e) => { drawing = true; ctx.beginPath(); const { x, y } = getPos(e); ctx.moveTo(x, y); document.getElementById(`install-${type}-sig-placeholder`).style.display = 'none'; e.preventDefault(); };
    const move = (e) => { if (!drawing) return; const { x, y } = getPos(e); ctx.lineTo(x, y); ctx.stroke(); e.preventDefault(); };
    const end = () => { drawing = false; window.technicianVisitForm[`${type === 'tech' ? 'technician' : 'client'}Signature`] = canvas.toDataURL(); };
    canvas.addEventListener('mousedown', start); canvas.addEventListener('mousemove', move); canvas.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start); canvas.addEventListener('touchmove', move); canvas.addEventListener('touchend', end);
    document.getElementById(`clear-install-${type}-sig`).addEventListener('click', () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      document.getElementById(`install-${type}-sig-placeholder`).style.display = 'flex';
      window.technicianVisitForm[`${type === 'tech' ? 'technician' : 'client'}Signature`] = null;
    });
  }

  // 5. Submit Logic
  document.getElementById('submit-install-visit').addEventListener('click', async () => {
    const btn = document.getElementById('submit-install-visit');
    if (!window.technicianVisitForm.technicianSignature) { showToast('Technician signature required', 'error'); return; }
    btn.disabled = true; btn.innerHTML = 'Submitting...';

    try {
      const photoUrls = [];
      for (const p of window.technicianVisitForm.photos) {
        const fileToUpload = p.file || (p instanceof File ? p : null);
        if (!fileToUpload) continue;
        const fileName = fileToUpload.name ? fileToUpload.name.replace(/[^a-zA-Z0-9.]/g, '_') : `photo-${Date.now()}.jpg`;
        const path = `technician-photos/${state.currentUser.id}/${Date.now()}-${fileName}`;
        const { error } = await supabaseClient.storage.from('safitrack').upload(path, fileToUpload, {
          contentType: 'image/jpeg',
          upsert: true
        });
        if (!error) {
          const { data } = supabaseClient.storage.from('safitrack').getPublicUrl(path);
          photoUrls.push(data.publicUrl);
        } else {
          console.error('Install: Upload error', error);
        }
      }

      const checklist = [];
      document.querySelectorAll('.install-checklist-item:checked').forEach(i => checklist.push(i.dataset.item));

      const formData = {
        visit_date: document.getElementById('install-visit-date').value,
        client_address: document.getElementById('install-client-address').value,
        reference_number: document.getElementById('install-reference').value,
        inverter_manufacturer: manufacturerSelect.value,
        inverter_model: manufacturerSelect.value === 'Other' ? modelCustom.value : modelList.value,
        inverter_serial: document.getElementById('inverter-serial').value,
        inverter_kva: kvaInput.value,
        inverter_type: document.getElementById('inverter-type').value,
        battery_brand: document.getElementById('battery-brand').value,
        battery_qty: document.getElementById('battery-qty').value,
        battery_volts: batteryVolts.value,
        battery_ah: document.getElementById('battery-ah').value,
        input_vac: document.getElementById('input-vac').value,
        output_vac: document.getElementById('output-vac').value,
        charging_vdc: document.getElementById('charging-vdc').value,
        output_freq: document.getElementById('output-freq').value,
        backup_min: document.getElementById('backup-min').value,
        checklist: checklist,
        technician_notes: document.getElementById('install-notes').value
      };

      const visitData = {
        technician_id: state.currentUser.id,
        company_id: locationData.type === 'company' ? locationData.id : null,
        company_name: locationData.name,
        location_name: locationData.type === 'custom' ? locationData.name : null,
        form_type: 'installation_visit',
        visit_type: 'installation',
        visit_notes: formData.technician_notes || 'Installation completed',
        technician_signature: window.technicianVisitForm.technicianSignature,
        client_signature: window.technicianVisitForm.clientSignature,
        photos: photoUrls.length > 0 ? photoUrls : null,
        latitude: window.technicianVisitForm.capturedLocation?.latitude,
        longitude: window.technicianVisitForm.capturedLocation?.longitude,
        created_at: new Date().toISOString(),
        form_data: formData,
        organization_id: state.currentOrganization?.id
      };

      const { error } = await supabaseClient.from('technician_visits').insert([visitData]);
      if (error) throw error;
      showToast('Installation Visit Submitted!', 'success');
      setTimeout(() => renderTechnicianCompanyDashboard(locationData), 1500);
    } catch (e) {
      console.error(e); showToast('Error: ' + e.message, 'error'); btn.disabled = false; btn.innerHTML = 'Submit Installation Visit';
    }
  });
}
// ======================
// FORM 3: MAINTENANCE VISIT
// ======================

function renderMaintenanceVisitForm(locationData) {
  viewContainer.innerHTML = `
    <div class="page-header">
      <button class="btn btn-ghost mb-2" onclick='renderTechnicianCompanyDashboard(${JSON.stringify(locationData)})'>
        <i data-lucide="arrow-left"></i> Back to Dashboard
      </button>
      <h1 class="page-title">Maintenance Visit</h1>
      <p class="text-muted">${locationData.name}</p>
    </div>

    <div class="card max-w-3xl mx-auto">
      <div class="card-body">
        
        <!-- Section: Visit Info -->
        <div class="section-container mb-6">
          <h3 class="card-title text-lg mb-4 border-b pb-2">Visit Info</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-field">
              <label>Technician Name</label>
              <input type="text" value="${state.currentUser.first_name} ${state.currentUser.last_name}" disabled class="bg-slate-100">
            </div>
            <div class="form-field">
              <label>Visit Date</label>
              <input type="date" id="maint-visit-date" value="${new Date().toISOString().split('T')[0]}" required>
            </div>
            <div class="form-field md:col-span-2">
              <label>GPS Location</label>
              <div class="flex gap-2">
                <button type="button" id="maint-capture-gps-btn" class="btn btn-secondary flex-1">
                  <i data-lucide="map-pin"></i> Capture GPS
                </button>
                <input type="text" id="maint-gps-coordinates" placeholder="Lat, Long" readonly class="flex-1 bg-slate-100">
              </div>
            </div>
          </div>
        </div>

        <!-- Section: Client Information -->
        <div class="section-container mb-6">
          <h3 class="card-title text-lg mb-4 border-b pb-2">Client Information</h3>
          <div class="form-field">
            <label>Company / Client Name</label>
            <input type="text" value="${locationData.name}" disabled class="bg-slate-100">
          </div>
          <div class="form-field">
            <label>AMC / Maintenance Reference</label>
            <input type="text" id="maint-reference" placeholder="e.g. AMC-2024-001">
          </div>
        </div>

        <!-- Section: System Details (Inverter/Battery) -->
        <div class="section-container mb-6">
          <h3 class="card-title text-lg mb-4 border-b pb-2">System Details</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-field">
              <label>Manufacturer</label>
              <select id="maint-inverter-manufacturer">
                <option value="">Select Manufacturer</option>
                <option value="Kstar">Kstar</option>
                <option value="Fortuner">Fortuner</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div class="form-field">
              <label>Inverter Model</label>
              <select id="maint-inverter-model">
                <option value="">Select Model</option>
              </select>
            </div>
            <div class="form-field">
              <label>Battery Brand</label>
              <input type="text" id="maint-battery-brand" placeholder="e.g. Delta">
            </div>
            <div class="form-field">
              <label>Battery Qty & Voltage</label>
              <input type="text" id="maint-battery-specs" placeholder="e.g. 4x 12V 200Ah">
            </div>
          </div>
        </div>

        <!-- Section: Testing Results -->
        <div class="section-container mb-6">
          <h3 class="card-title text-lg mb-4 border-b pb-2">Testing Results</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-field">
              <label>Charging Current (Amps)</label>
              <input type="number" id="maint-charging-amps" placeholder="e.g. 20">
            </div>
            <div class="form-field">
              <label>Backup Time Observed (Mins)</label>
              <input type="number" id="maint-backup-obs" placeholder="e.g. 45">
            </div>
            <div class="form-field">
              <label>Voltage Per Battery (Avg)</label>
              <input type="number" step="0.1" id="maint-batt-vdc" placeholder="e.g. 13.6">
            </div>
            <div class="form-field">
              <label>System Cleanliness</label>
              <select id="maint-cleanliness">
                <option value="Excellent">Excellent</option>
                <option value="Good">Good</option>
                <option value="Fair">Fair</option>
                <option value="Poor">Poor (Needs Cleaning)</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Section: Maintenance Checklist -->
        <div class="section-container mb-6">
          <h3 class="card-title text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">Maintenance Checklist</h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            ${[
      'Inverter Cleaned', 'Battery Terminals Greased', 'Tightened Connections',
      'Ventilation Fans Checked', 'Input/Output Voltage Checked',
      'Auto-Changeover Tested', 'Bypass Switch Checked',
      'Visual Inspection of Comps', 'Firmware Updated',
      'User Training Refreshed'
    ].map((item, i) => `
              <label class="flex items-center gap-3 p-3 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl hover:border-primary/50 transition-colors cursor-pointer group">
                <div class="relative flex items-center">
                  <input type="checkbox" class="maint-checklist-item w-5 h-5 rounded border-slate-300 text-primary focus:ring-primary/20 transition-all cursor-pointer" data-item="${item}">
                </div>
                <span class="text-sm font-medium text-slate-700 dark:text-slate-200 group-hover:text-primary transition-colors">${item}</span>
              </label>
            `).join('')}
          </div>
        </div>

        <!-- Section: Notes & Verification -->
        <div class="section-container mb-6">
          <h3 class="card-title text-lg mb-4 border-b pb-2">Notes & Verification</h3>
          <div class="form-field">
            <label>Technician Notes/Findings</label>
            <textarea id="maint-notes" rows="4" placeholder="Enter findings, recommendations, etc."></textarea>
          </div>

          <div class="form-field mt-4">
            <label>Photos (Max 10)</label>
            <input type="file" id="maint-photos" accept="image/*" multiple style="display: none;" />
            <div class="photo-upload-multiple" id="maint-photo-upload">
              <i data-lucide="camera" class="w-6 h-6 mb-2"></i>
              <p>Tap to add photos</p>
            </div>
            <div class="photo-grid mt-4" id="maint-photo-grid"></div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
            <div class="form-field">
              <label>Technician Signature</label>
              <div class="signature-container bg-slate-50 dark:bg-slate-900 border rounded-lg h-40 relative">
                <canvas id="maint-tech-sig-canvas" class="signature-canvas w-full h-full"></canvas>
                <div class="signature-placeholder absolute inset-0 flex items-center justify-center text-muted pointer-events-none" id="maint-tech-sig-placeholder">
                  Sign Here
                </div>
              </div>
              <button type="button" class="btn btn-sm btn-ghost mt-2" id="clear-maint-tech-sig">Clear</button>
            </div>

            <div class="form-field">
              <label>Client Signature</label>
              <div class="signature-container bg-slate-50 dark:bg-slate-900 border rounded-lg h-40 relative">
                <canvas id="maint-client-sig-canvas" class="signature-canvas w-full h-full"></canvas>
                <div class="signature-placeholder absolute inset-0 flex items-center justify-center text-muted pointer-events-none" id="maint-client-sig-placeholder">
                  Sign Here
                </div>
              </div>
              <button type="button" class="btn btn-sm btn-ghost mt-2" id="clear-maint-client-sig">Clear</button>
            </div>
          </div>
        </div>

        <div class="form-field mt-8">
          <button id="submit-maint-visit" class="btn btn-primary w-full py-3 text-lg">
            Submit Maintenance Visit
          </button>
        </div>
      </div>
    </div>
  `;

  if (window.lucide) lucide.createIcons();

  initMaintenanceVisitForm(locationData);
}

function initMaintenanceVisitForm(locationData) {
  window.technicianVisitForm = {
    selectedCompany: locationData.type === 'company' ? locationData : null,
    capturedLocation: null,
    technicianSignature: null,
    clientSignature: null,
    photos: []
  };

  // 1. Inverter Auto-fill
  const manufacturerSelect = document.getElementById('maint-inverter-manufacturer');
  const modelList = document.getElementById('maint-inverter-model');
  manufacturerSelect.addEventListener('change', (e) => {
    const brand = e.target.value;
    modelList.innerHTML = '<option value="">Select Model</option>';
    if (INVERTER_MODELS[brand]) {
      INVERTER_MODELS[brand].forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.model; opt.textContent = m.model;
        modelList.appendChild(opt);
      });
    }
  });

  // 2. GPS Logic
  const gpsBtn = document.getElementById('maint-capture-gps-btn');
  const gpsInput = document.getElementById('maint-gps-coordinates');
  gpsBtn.addEventListener('click', () => {
    gpsBtn.disabled = true; gpsBtn.innerHTML = '...';
    navigator.geolocation.getCurrentPosition((pos) => {
      window.technicianVisitForm.capturedLocation = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      gpsInput.value = `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`;
      gpsBtn.className = 'btn btn-success flex-1'; gpsBtn.innerHTML = 'Captured'; gpsBtn.disabled = false;
    });
  });

  // 3. Photo Logic
  const photoInput = document.getElementById('maint-photos');
  const photoArea = document.getElementById('maint-photo-upload');
  photoArea.addEventListener('click', () => photoInput.click());
  photoInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files).slice(0, 10);
    const grid = document.getElementById('maint-photo-grid');
    grid.innerHTML = 'Compressing...';
    const processed = [];
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      processed.push(await compressImage(file));
    }
    window.technicianVisitForm.photos = processed;
    grid.innerHTML = processed.map(p => {
      const url = p.dataUrl || (p instanceof File ? URL.createObjectURL(p) : 'https://via.placeholder.com/300x300?text=No+Preview');
      return `<img src="${url}" class="aspect-square object-cover rounded">`;
    }).join('');
  });

  // 4. Signature Logic
  setTimeout(() => {
    setupMaintCanvas('maint-tech-sig-canvas', 'tech');
    setupMaintCanvas('maint-client-sig-canvas', 'client');
  }, 100);

  function setupMaintCanvas(id, type) {
    const canvas = document.getElementById(id);
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width; canvas.height = rect.height;
    ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    let drawing = false;
    const getPos = (e) => {
      const r = canvas.getBoundingClientRect();
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      return { x: cx - r.left, y: cy - r.top };
    };
    canvas.addEventListener('mousedown', (e) => { drawing = true; ctx.beginPath(); const { x, y } = getPos(e); ctx.moveTo(x, y); document.getElementById(`maint-${type}-sig-placeholder`).style.display = 'none'; });
    canvas.addEventListener('mousemove', (e) => { if (!drawing) return; const { x, y } = getPos(e); ctx.lineTo(x, y); ctx.stroke(); });
    canvas.addEventListener('mouseup', () => { drawing = false; window.technicianVisitForm[`${type === 'tech' ? 'technician' : 'client'}Signature`] = canvas.toDataURL(); });
    canvas.addEventListener('touchstart', (e) => { drawing = true; ctx.beginPath(); const { x, y } = getPos(e); ctx.moveTo(x, y); document.getElementById(`maint-${type}-sig-placeholder`).style.display = 'none'; e.preventDefault(); });
    canvas.addEventListener('touchmove', (e) => { if (!drawing) return; const { x, y } = getPos(e); ctx.lineTo(x, y); ctx.stroke(); e.preventDefault(); });
    canvas.addEventListener('touchend', () => { drawing = false; window.technicianVisitForm[`${type === 'tech' ? 'technician' : 'client'}Signature`] = canvas.toDataURL(); });
    document.getElementById(`clear-maint-${type}-sig`).addEventListener('click', () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      document.getElementById(`maint-${type}-sig-placeholder`).style.display = 'flex';
      window.technicianVisitForm[`${type === 'tech' ? 'technician' : 'client'}Signature`] = null;
    });
  }

  // 5. Submit Logic
  document.getElementById('submit-maint-visit').addEventListener('click', async () => {
    const btn = document.getElementById('submit-maint-visit');
    if (!window.technicianVisitForm.technicianSignature) { showToast('Technician signature required', 'error'); return; }
    btn.disabled = true; btn.innerHTML = 'Submitting...';

    try {
      const photoUrls = [];

      for (const p of window.technicianVisitForm.photos) {
        const fileToUpload = p.file || (p instanceof File ? p : null);
        if (!fileToUpload) { console.warn('Maint: Invalid photo object', p); continue; }
        const fileName = fileToUpload.name ? fileToUpload.name.replace(/[^a-zA-Z0-9.]/g, '_') : `photo-${Date.now()}.jpg`;
        const path = `technician-photos/${state.currentUser.id}/${Date.now()}-${fileName}`;

        const { error } = await supabaseClient.storage.from('safitrack').upload(path, fileToUpload, {
          contentType: 'image/jpeg',
          upsert: true
        });
        if (!error) {
          const { data } = supabaseClient.storage.from('safitrack').getPublicUrl(path);

          photoUrls.push(data.publicUrl);
        } else {
          console.error('Maint: Upload error detail:', error);
        }
      }

      const checklist = [];
      document.querySelectorAll('.maint-checklist-item:checked').forEach(i => checklist.push(i.dataset.item));

      const formData = {
        visit_date: document.getElementById('maint-visit-date').value,
        amc_reference: document.getElementById('maint-reference').value,
        inverter_manufacturer: manufacturerSelect.value,
        inverter_model: modelList.value,
        battery_brand: document.getElementById('maint-battery-brand').value,
        battery_specs: document.getElementById('maint-battery-specs').value,
        charging_amps: document.getElementById('maint-charging-amps').value,
        backup_obs: document.getElementById('maint-backup-obs').value,
        batt_vdc: document.getElementById('maint-batt-vdc').value,
        cleanliness: document.getElementById('maint-cleanliness').value,
        checklist: checklist,
        technician_notes: document.getElementById('maint-notes').value
      };

      const visitData = {
        technician_id: state.currentUser.id,
        company_id: locationData.type === 'company' ? locationData.id : null,
        company_name: locationData.name,
        location_name: locationData.type === 'custom' ? locationData.name : null,
        form_type: 'maintenance_visit',
        visit_type: 'maintenance',
        visit_notes: formData.technician_notes || 'Maintenance completed',
        technician_signature: window.technicianVisitForm.technicianSignature,
        client_signature: window.technicianVisitForm.clientSignature,
        photos: photoUrls.length > 0 ? photoUrls : null,
        latitude: window.technicianVisitForm.capturedLocation?.latitude,
        longitude: window.technicianVisitForm.capturedLocation?.longitude,
        created_at: new Date().toISOString(),
        form_data: formData,
        organization_id: state.currentOrganization?.id
      };

      const { error } = await supabaseClient.from('technician_visits').insert([visitData]);
      if (error) throw error;
      showToast('Maintenance Visit Submitted!', 'success');
      setTimeout(() => renderTechnicianCompanyDashboard(locationData), 1500);
    } catch (e) {
      console.error(e); showToast('Error: ' + e.message, 'error'); btn.disabled = false; btn.innerHTML = 'Submit Maintenance Visit';
    }
  });
}

async function compressImage(file, maxWidth = 1200, quality = 0.7) {

  return new Promise((resolve) => {
    try {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);


      img.onload = () => {

        URL.revokeObjectURL(objectUrl);
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = (maxWidth / width) * height;
          width = maxWidth;

        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          if (!blob) {
            console.error('Canvas toBlob failed, returning original file');
            resolve({ file: file, dataUrl: canvas.toDataURL('image/jpeg', quality) });
            return;
          }
          const compressedFile = new File([blob], file.name || 'photo.jpg', {
            type: 'image/jpeg',
            lastModified: Date.now(),
          });

          resolve({ file: compressedFile, dataUrl: canvas.toDataURL('image/jpeg', quality) });
        }, 'image/jpeg', quality);
      };

      img.onerror = (err) => {
        console.error('Image element failed to load file:', err);
        URL.revokeObjectURL(objectUrl);
        resolve({ file: file, dataUrl: null });
      };

      img.src = objectUrl;
    } catch (err) {
      console.error('Compression crash error:', err);
      resolve({ file: file, dataUrl: null });
    }
  });
}

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
    .eq('technician_id', state.currentUser.id)
    .order('created_at', { ascending: false });

  if (error) {
    viewContainer.innerHTML = renderError(error.message);
    return;
  }

  let html = `
    <div class="page-header">
      <h1 class="page-title">My Service Visits</h1>
    </div>
  `;

  if (visits.length === 0) {
    html += `
      <div class="card">
        <div class="empty-state">
          <i data-lucide="construction" class="empty-state-icon"></i>
          <h3 class="empty-state-title">No service visits yet</h3>
          <p class="empty-state-description">Start logging your service visits to see them here.</p>
          <button class="btn btn-primary" onclick="loadView('technician-log-visit')">
            <i data-lucide="plus"></i> Log Your First Visit
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
        <div class="photo-grid photo-grid-3 mb-2">
          ${visit.photos.slice(0, 3).map(photo => `
            <div class="photo-item">
              <img src="${photo}" alt="Visit photo" onclick="openPhotoModal('${photo}')" onerror="handleImageError(this)">
            </div>
          `).join('')}
          ${visit.photos.length > 3 ? `
            <div class="photo-item photo-item-more">
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
        
        ${state.isManager ? `
          <button class="btn btn-sm btn-secondary" onclick="generateTechnicianVisitPDF('${visit.id}')">
            <i data-lucide="file-text"></i> PDF
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
  // Fetch technician visits without relation joins (avoids FK alias/schema cache issues)
  let visitsQ = supabaseClient.from('technician_visits').select('*').order('created_at', { ascending: false });
  let techQ = supabaseClient.from('profiles').select('id, first_name, last_name, email').eq('role', 'technician').order('first_name', { ascending: true });
  if (state.currentOrganization?.id) {
    visitsQ = visitsQ.eq('organization_id', state.currentOrganization.id);
    techQ = techQ.eq('organization_id', state.currentOrganization.id);
  }

  // Fetch technician visits and all technicians
  const { data: rawVisits, error: visitsError } = await visitsQ;
  const { data: technicians, error: techError } = await techQ;

  if (visitsError || techError) {
    crmDebugLog('renderTechniciansDashboardView.error', {
      visitsError,
      techError
    });
    viewContainer.innerHTML = renderError('Error loading technician data');
    return;
  }

  const visits = rawVisits || [];

  const companyIds = [...new Set(visits.map((visit) => visit.company_id).filter(Boolean))];
  let companiesById = new Map();

  if (companyIds.length > 0) {
    const { data: companies, error: companiesError } = await supabaseClient
      .from('companies')
      .select('id, name, description')
      .in('id', companyIds);

    if (companiesError) {
      crmDebugLog('renderTechniciansDashboardView.companiesError', companiesError);
    } else {
      companiesById = new Map((companies || []).map((company) => [String(company.id), company]));
    }
  }

  const techniciansById = new Map((technicians || []).map((technician) => [String(technician.id), technician]));

  const hydratedVisits = visits.map((visit) => ({
    ...visit,
    technician: techniciansById.get(String(visit.technician_id)) || null,
    companies: visit.company_id ? companiesById.get(String(visit.company_id)) || null : null
  }));

  crmDebugLog('renderTechniciansDashboardView.data', {
    visitsCount: hydratedVisits.length,
    techniciansCount: (technicians || []).length,
    companyRefsCount: companyIds.length,
    sampleVisit: hydratedVisits.length > 0 ? hydratedVisits[0] : null
  });

  // Calculate statistics
  const totalVisits = hydratedVisits.length;
  const totalTechnicians = technicians.length;
  const todayVisits = hydratedVisits.filter(v => {
    const visitDate = new Date(v.created_at).toDateString();
    return visitDate === new Date().toDateString();
  }).length;



  let html = `
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
    </div>

    
    <!-- Filters -->
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Filter Visits</h3>
      </div>
      <div class="technician-filters-row">
        <select class="technician-filter-control" id="filter-company">
          <option value="">All Companies</option>
          ${Array.from(companiesById.values()).map(c => `
            <option value="${c.id}">${c.name}</option>
          `).join('')}
        </select>
        <select class="technician-filter-control" id="filter-technician">
          <option value="">All Technicians</option>
          ${technicians.map(tech => `
            <option value="${tech.id}">${tech.first_name} ${tech.last_name}</option>
          `).join('')}
        </select>

        <select class="technician-filter-control" id="filter-type">
          <option value="">All Types</option>
          <option value="installation">Installation</option>
          <option value="maintenance">Maintenance</option>
          <option value="repair">Repair</option>
          <option value="inspection">Inspection</option>
          <option value="emergency">Emergency</option>
        </select>
        <input type="date" class="technician-filter-control" id="filter-date">
        <button class="btn btn-secondary" id="clear-filters">
          Clear Filters
        </button>
      </div>
    </div>

    <!-- Visits List -->
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Recent Service Visits</h3>
        <span class="text-muted">${hydratedVisits.length} total visits</span>
      </div>
      
      <div id="technician-visits-list">
  `;

  if (hydratedVisits.length === 0) {
    html += `
      <div class="empty-state">
        <i class="fas fa-tools empty-state-icon"></i>
        <h3 class="empty-state-title">No service visits yet</h3>
        <p class="empty-state-description">Technicians will appear here when they start logging visits.</p>
      </div>
    `;
  } else {
    hydratedVisits.slice(0, 20).forEach(visit => {
      html += renderTechnicianVisitCardForManager(visit);
    });
  }

  html += `
      </div>
      ${hydratedVisits.length > 20 ? `
        <div class="text-center mt-3">
          <button class="btn btn-secondary" id="load-more-visits">
            Load More (${hydratedVisits.length - 20} remaining)
          </button>
        </div>
      ` : ''}
    </div>
  `;

  viewContainer.innerHTML = html;

  // Technician locations map removed per request

  // Initialize filters
  const companiesArray = Array.from(companiesById.values());
  initTechnicianFilters(hydratedVisits, technicians, companiesArray);
}

function renderTechnicianVisitCardForManager(visit) {
  const date = formatDate(visit.created_at);
  // Use visit.company_name first (for custom locations), then fallback to joined companies data
  const companyName = visit.company_name || visit.companies?.name || 'Unknown Company';
  const technicianName = visit.technician ?
    `${visit.technician.first_name} ${visit.technician.last_name}` : 'Unknown Technician';



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
        data-type="${visit.visit_type}"
        data-date="${new Date(visit.created_at).toISOString().split('T')[0]}">
      <div class="technician-visit-header">
        <div>
          <div class="technician-visit-company">${companyName}</div>
          <div class="text-prim" style="font-size: 0.875rem;">
            <span class="badge badge-sm badge-outline mr-2">${formatFormType(visit.form_type)}</span>
          </div>
        </div>
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

      ${visit.form_data && Object.keys(visit.form_data).length > 0 ? `
        <div class="mt-4 mb-4">
          <button class="btn btn-xs btn-ghost text-primary flex items-center gap-1" onclick="this.nextElementSibling.classList.toggle('hidden'); if(window.lucide) lucide.createIcons();">
             <i data-lucide="info" style="width: 14px; height: 14px;"></i> View Detailed Technical Report
          </button>
          <div class="hidden mt-3 p-5 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-slate-200/60 dark:border-slate-800 shadow-sm">
            <div class="flex items-center justify-between mb-4 border-b border-slate-200 dark:border-slate-800 pb-2">
              <h4 class="text-sm font-bold text-slate-700 dark:text-slate-200">Technical Report Details</h4>
              <span class="text-[10px] font-bold text-primary uppercase tracking-widest bg-primary/10 px-2 py-0.5 rounded-full">${formatFormType(visit.form_type).replace('Visit', '')}</span>
            </div>
            
            <div class="space-y-6">
              ${(() => {
        const data = visit.form_data;
        const groups = {
          'System Configuration': ['inverter_manufacturer', 'inverter_model', 'inverter_serial', 'inverter_kva', 'inverter_type', 'system_size', 'roof_type', 'inverter_location', 'battery_location'],
          'Battery Specifications': ['battery_brand', 'battery_qty', 'battery_volts', 'battery_ah', 'battery_specs', 'batt_vdc'],
          'Performance Metrics': ['input_vac', 'output_vac', 'pv_voltage', 'pv_amps', 'charging_amps', 'cleanliness'],
          'Visit Information': ['visit_date', 'client_address', 'reference_number', 'amc_reference']
        };

        let groupsHtml = '';

        // Render Categorized Groups
        for (const [groupName, keys] of Object.entries(groups)) {
          const groupData = keys.filter(k => data[k] && data[k] !== '');
          if (groupData.length > 0) {
            groupsHtml += `
                    <div>
                      <h5 class="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">${groupName}</h5>
                      <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
                        ${groupData.map(key => {
              const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
              return `
                            <div>
                              <div class="text-[10px] text-slate-500 mb-0.5">${label}</div>
                              <div class="text-sm font-semibold text-slate-800 dark:text-slate-200">${data[key]}</div>
                            </div>
                          `;
            }).join('')}
                      </div>
                    </div>
                  `;
          }
        }

        // Render Checklist separately
        if (data.checklist && Array.isArray(data.checklist) && data.checklist.length > 0) {
          groupsHtml += `
                  <div>
                    <h5 class="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Service Checklist</h5>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      ${data.checklist.map(item => `
                        <div class="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-800 p-2 rounded-lg border border-slate-100 dark:border-slate-700">
                          <i data-lucide="check-circle-2" class="text-success w-3.5 h-3.5"></i>
                          <span>${item}</span>
                        </div>
                      `).join('')}
                    </div>
                  </div>
                `;
        }

        // Render Notes
        if (data.technician_notes || data.notes) {
          groupsHtml += `
                  <div class="pt-2 border-t border-slate-200 dark:border-slate-800">
                    <h5 class="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Technician Notes</h5>
                    <p class="text-sm text-slate-700 dark:text-slate-300 italic">"${data.technician_notes || data.notes}"</p>
                  </div>
                `;
        }

        return groupsHtml || '<p class="text-sm text-muted">No additional data available.</p>';
      })()}
            </div>
          </div>
        </div>
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
            background: 'var(--color-primary)';
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

function initTechnicianFilters(visits, technicians, companies) {
  const companyFilter = document.getElementById('filter-company');
  const technicianFilter = document.getElementById('filter-technician');
  const typeFilter = document.getElementById('filter-type');
  const dateFilter = document.getElementById('filter-date');
  const clearFiltersBtn = document.getElementById('clear-filters');
  const loadMoreBtn = document.getElementById('load-more-visits');

  let filteredVisits = [...visits];
  let displayedCount = 20;

  function applyFilters() {
    const companyId = companyFilter ? companyFilter.value : '';
    const technicianId = technicianFilter.value;
    const type = typeFilter.value;
    const date = dateFilter.value;

    saveViewState({ technicianDashboard: { companyId, technicianId, type, date } });

    filteredVisits = visits.filter(visit => {
      if (companyId && String(visit.company_id) !== String(companyId)) return false;
      if (technicianId && visit.technician_id !== technicianId) return false;
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
          <i data-lucide="search" class="empty-state-icon"></i>
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

  // Restore state
  const savedState = _loadPersistedState().technicianDashboard || {};
  if (companyFilter && savedState.companyId !== undefined) companyFilter.value = savedState.companyId;
  if (technicianFilter && savedState.technicianId !== undefined) technicianFilter.value = savedState.technicianId;
  if (typeFilter && savedState.type !== undefined) typeFilter.value = savedState.type;
  if (dateFilter && savedState.date !== undefined) dateFilter.value = savedState.date;

  // Add event listeners
  if (companyFilter) companyFilter.addEventListener('change', applyFilters);
  technicianFilter.addEventListener('change', applyFilters);
  typeFilter.addEventListener('change', applyFilters);
  dateFilter.addEventListener('change', applyFilters);

  // Apply filters initially to reflect restored state
  if (Object.keys(savedState).length > 0) {
    applyFilters();
  }

  clearFiltersBtn.addEventListener('click', () => {
    if (companyFilter) companyFilter.value = '';
    technicianFilter.value = '';
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
    const pdfDatePref2 = (typeof getUserDateFormat === 'function') ? getUserDateFormat() : (localStorage.getItem('safitrack_date_format') || 'DD/MM/YYYY');
    const created2 = new Date(visit.created_at);
    const createdDateStr2 = pdfDatePref2 === 'MM/DD/YYYY' ? `${String(created2.getMonth() + 1).padStart(2, '0')}/${String(created2.getDate()).padStart(2, '0')}/${created2.getFullYear()}` : `${String(created2.getDate()).padStart(2, '0')}/${String(created2.getMonth() + 1).padStart(2, '0')}/${created2.getFullYear()}`;
    doc.text(`${createdDateStr2} ${created2.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, 53, yPos + 14);

    doc.setTextColor(100, 100, 100);
    doc.text('GENERATED:', 25, yPos + 21);
    doc.setTextColor(...colors.dark);
    const now = new Date();
    const nowDateStr = pdfDatePref2 === 'MM/DD/YYYY' ? `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${now.getFullYear()}` : `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
    doc.text(`${nowDateStr} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, 53, yPos + 21);

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
      const coordsStr = `${visit.latitude.toFixed(6)}, ${visit.longitude.toFixed(6)}`;
      addInfoRow('Coordinates', coordsStr);

      // Add 'View in Google Maps' button below coordinates, aligned left (match visit PDF style)
      const btnLabel = 'View in Google Maps';
      const btnWidth = doc.getTextWidth(btnLabel) + 12;
      const btnHeight = 6;
      const btnX = 27; // align with info row value
      const btnY = yPos - 4;
      const mapsUrl = `https://www.google.com/maps?q=${visit.latitude.toFixed(6)},${visit.longitude.toFixed(6)}`;
      doc.setFillColor(47, 95, 208);
      doc.roundedRect(btnX, btnY, btnWidth, btnHeight, 2, 2, 'F');
      doc.setFontSize(8);
      doc.setTextColor(255, 255, 255);
      const textX = btnX + btnWidth / 2 - doc.getTextWidth(btnLabel) / 2;
      const textY = btnY + btnHeight / 2 + 1;
      doc.textWithLink(btnLabel, textX, textY, { url: mapsUrl });
      yPos += btnHeight + 4;
      doc.setTextColor(0, 0, 0);
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

    addInfoRow('Form Type', formatFormType(visit.form_type));
    addInfoRow('Visit Type', visitTypeLabels[visit.visit_type] || visit.visit_type);

    const workCategory = visit.work_category + (visit.other_work_category ? ` (${visit.other_work_category})` : '');
    addInfoRow('Work Category', workCategory);



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
      notesLines.forEach((line, i) => {
        doc.text(line, 25, yPos + 7 + (i * 6));
      });
      yPos += notesHeight + 10;
    }

    // Improved: Grouped & All-inclusive Form Data
    if (visit.form_data && Object.keys(visit.form_data).length > 0) {
      const data = visit.form_data;
      const groups = {
        'System Configuration': ['inverter_manufacturer', 'inverter_model', 'inverter_serial', 'inverter_kva', 'inverter_type', 'system_size', 'roof_type', 'inverter_location', 'battery_location'],
        'Battery Specifications': ['battery_brand', 'battery_qty', 'battery_volts', 'battery_ah', 'battery_specs', 'batt_vdc'],
        'Performance Metrics': ['input_vac', 'output_vac', 'pv_voltage', 'pv_amps', 'charging_amps', 'cleanliness', 'charging_vdc', 'output_freq', 'backup_min'],
        'Visit Information': ['visit_date', 'client_address', 'reference_number', 'amc_reference']
      };

      // Track which keys have been rendered
      const renderedKeys = new Set();

      Object.entries(groups).forEach(([section, keys]) => {
        const sectionData = keys.filter(k => data[k] !== undefined && data[k] !== null && data[k] !== '');
        if (sectionData.length > 0) {
          addSectionHeader(section);
          sectionData.forEach(key => {
            const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            const value = data[key];
            if (Array.isArray(value)) {
              addInfoRow(label, value.join(', '));
            } else {
              addInfoRow(label, String(value));
            }
            renderedKeys.add(key);
          });
          yPos += 5;
        }
      });

      // Checklist
      if (data.checklist && Array.isArray(data.checklist) && data.checklist.length > 0) {
        addSectionHeader('Service Checklist');
        data.checklist.forEach(item => {
          addInfoRow('Checklist Item', item);
        });
        renderedKeys.add('checklist');
        yPos += 5;
      }

      // Technician Notes
      if (data.technician_notes || data.notes) {
        addSectionHeader('Technician Notes');
        addInfoRow('Notes', data.technician_notes || data.notes);
        renderedKeys.add('technician_notes');
        renderedKeys.add('notes');
        yPos += 5;
      }

      // Render any remaining fields not in groups
      const remaining = Object.entries(data).filter(([key, value]) => !renderedKeys.has(key) && value !== undefined && value !== null && value !== '');
      if (remaining.length > 0) {
        addSectionHeader('Additional Data');
        remaining.forEach(([key, value]) => {
          const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          if (Array.isArray(value)) {
            addInfoRow(label, value.join(', '));
          } else {
            addInfoRow(label, String(value));
          }
        });
        yPos += 5;
      }
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
// GENERIC FORM RENDERER
// ======================

function renderTechnicianForm(formType, locationDataStr) {
  const locationData = JSON.parse(decodeURIComponent(locationDataStr));

  if (formType === 'survey_visit') { renderSurveyVisitForm(locationData); return; }
  if (formType === 'installation_visit') { renderInstallationVisitForm(locationData); return; }
  if (formType === 'maintenance_visit') { renderMaintenanceVisitForm(locationData); return; }

  viewContainer.innerHTML = `
    <div class="page-header">
      <button class="btn btn-back mb-2" onclick='renderTechnicianCompanyDashboard(${JSON.stringify(locationData)})' aria-label="Back to dashboard" title="Back to dashboard">
        <span class="btn-back-icon"><i data-lucide="arrow-left"></i></span>
        <span class="btn-back-text">Back to Dashboard</span>
      </button>
      <h1 class="page-title">${formatFormType(formType)}</h1>
      <p class="text-muted">${locationData.name}</p>
    </div>
    <div class="card p-8 text-center">
      <i data-lucide="hammer" class="w-16 h-16 text-muted mb-4 mx-auto"></i>
      <h2 class="text-xl font-bold mb-2">Form Under Construction</h2>
      <p class="text-muted mb-6">This form template is being implemented.</p>
      <button class="btn btn-primary" onclick='renderTechnicianCompanyDashboard(${JSON.stringify(locationData)})'>
        Return to Location Dashboard
      </button>
    </div>
  `;
  if (window.lucide) lucide.createIcons();
}

// ======================
// VIEW LOCATION ON MAP MODAL
// ======================

function viewLocationOnMap(latitude, longitude, title) {
  const oldModal = document.getElementById('location-modal');
  if (oldModal) oldModal.remove();

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'flex';
  modal.id = 'location-modal';
  modal.innerHTML = `
    <div class="modal-backdrop" onclick="closeModal('location-modal')"></div>
    <div class="modal-container modal-size-lg">
      <div class="modal-header">
        <h3>${title || 'Location'}</h3>
        <button class="modal-close" onclick="closeModal('location-modal')">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <div id="location-modal-map" class="u-map-lg"></div>
        <div class="mt-3">
          <p><strong>Coordinates:</strong> ${latitude.toFixed(6)}, ${longitude.toFixed(6)}</p>
          <a href="https://www.google.com/maps?q=${latitude},${longitude}" target="_blank" class="btn btn-sm btn-primary mt-2">
            Open in Google Maps
          </a>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  setTimeout(() => {
    const map = L.map('location-modal-map').setView([latitude, longitude], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
    L.marker([latitude, longitude]).addTo(map).bindPopup(title || 'Visit Location').openPopup();
  }, 100);
}

// ======================
// VIEW TECHNICIAN VISIT DETAILS MODAL
// ======================

async function viewTechnicianVisitDetails(visitId) {
  const oldModal = document.getElementById('visit-details-modal');
  if (oldModal) oldModal.remove();

  showToast('Loading visit details...', 'info');

  try {
    const { data: visit, error } = await supabaseClient
      .from('technician_visits')
      .select(`*, technician:profiles!technician_visits_technician_id_fkey(first_name, last_name, email), companies(name, address, description)`)
      .eq('id', visitId)
      .single();

    if (error) throw error;

    const companyName = visit.company_name || visit.companies?.name || 'Unknown Location';
    const companyAddress = visit.companies?.address || 'N/A';
    const companyDescription = visit.companies?.description || 'N/A';

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.id = 'visit-details-modal';
    modal.innerHTML = `
      <div class="modal-backdrop" onclick="closeModal('visit-details-modal')"></div>
      <div class="modal-container modal-size-lg">
        <div class="modal-header">
          <h3>Service Visit Details</h3>
          <div class="flex gap-2">
            <button class="btn btn-sm btn-secondary" onclick="generateTechnicianVisitPDF('${visitId}')">PDF</button>
            <button class="modal-close" onclick="closeModal('visit-details-modal')">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
        </div>
        <div class="modal-body">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h4>Company Information</h4>
              <p><strong>Name:</strong> ${companyName}</p>
              ${visit.companies ? `<p><strong>Address:</strong> ${companyAddress}</p><p><strong>Description:</strong> ${companyDescription}</p>` : ''}
            </div>
            <div>
              <h4>Visit Information</h4>
              <p><strong>Visit Type:</strong> ${visit.visit_type}</p>
              <p><strong>Work Category:</strong> ${visit.work_category}${visit.other_work_category ? ` (${visit.other_work_category})` : ''}</p>
            </div>
          </div>
          ${visit.latitude && visit.longitude ? `<div class="mt-4"><h4>Location</h4><div id="visit-details-map" class="u-map-sm u-mt-md"></div></div>` : ''}
          ${visit.visit_notes ? `<div class="mt-4"><h4>Visit Notes</h4><div class="bg-gray-50 p-3 rounded">${visit.visit_notes}</div></div>` : ''}
          ${visit.follow_up_notes ? `<div class="mt-4"><h4>Follow-up Required</h4><div class="bg-yellow-50 p-3 rounded">${visit.follow_up_notes}</div></div>` : ''}
          ${visit.photos && visit.photos.length > 0 ? `
            <div class="mt-4">
              <h4>Photos (${visit.photos.length})</h4>
              <div class="photo-grid photo-grid-3">
                ${visit.photos.slice(0, 3).map(photo => `<div class="photo-item"><img src="${photo}" alt="Visit photo" onclick="openPhotoModal('${photo}')" onerror="handleImageError(this)"></div>`).join('')}
                ${visit.photos.length > 3 ? `<div class="photo-item photo-item-more"><span class="text-muted">+${visit.photos.length - 3} more</span></div>` : ''}
              </div>
            </div>` : ''}
          <div class="mt-4">
            <h4>Signatures</h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><p class="text-sm text-muted">Client Signature</p>${visit.client_signature ? `<img src="${visit.client_signature}" alt="Client signature" style="max-height:100px;" onerror="handleImageError(this)">` : 'Not provided'}</div>
              <div><p class="text-sm text-muted">Technician Signature</p>${visit.technician_signature ? `<img src="${visit.technician_signature}" alt="Technician signature" style="max-height:100px;" onerror="handleImageError(this)">` : 'Not provided'}</div>
            </div>
          </div>
          ${visit.form_data && Object.keys(visit.form_data).length > 0 ? `
            <div class="mt-6 p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-100 dark:border-slate-800">
              <h4 class="text-sm font-bold text-muted uppercase tracking-wider mb-4">Detailed Form Data</h4>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                ${Object.entries(visit.form_data).map(([key, value]) => {
                  if (value === undefined || value === null || value === '') return '';
                  const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                  if (Array.isArray(value)) return `<div class="col-span-2"><span class="text-muted block text-xs uppercase font-semibold mb-1">${label}</span><div class="flex flex-wrap gap-1">${value.map(v => `<span class="tag tag-sm">${v}</span>`).join('')}</div></div>`;
                  return `<div><span class="text-muted block text-xs uppercase font-semibold mb-1">${label}</span><span class="font-medium">${value}</span></div>`;
                }).join('')}
              </div>
            </div>` : ''}
          <div class="mt-4">
            <h4>Technician</h4>
            <p><strong>Name:</strong> ${visit.technician.first_name} ${visit.technician.last_name}</p>
            <p><strong>Email:</strong> ${visit.technician.email}</p>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="closeModal('visit-details-modal')">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    if (visit.latitude && visit.longitude) {
      setTimeout(() => {
        const map = L.map('visit-details-map').setView([visit.latitude, visit.longitude], 16);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
        L.marker([visit.latitude, visit.longitude]).addTo(map).bindPopup(companyName).openPopup();
        setTimeout(() => map.invalidateSize(), 200);
      }, 100);
    }
  } catch (error) {
    console.error('Error loading visit details:', error);
    showToast('Error loading visit details: ' + error.message, 'error');
  }
}

// ── Exports ────────────────────────────────────────────────────
export {
  renderTechnicianLogVisitView,
  initTechnicianLocationSelect,
  renderTechnicianCompanyDashboard,
  loadLocationHistory,
  formatFormType,
  renderSurveyVisitForm,
  initSurveyVisitForm,
  renderInstallationVisitForm,
  initInstallationVisitForm,
  renderMaintenanceVisitForm,
  initMaintenanceVisitForm,
  compressImage,
  renderTechnicianActivityView,
  renderTechnicianVisitCard,
  renderTechniciansDashboardView,
  renderTechnicianVisitCardForManager,
  initTechniciansMap,
  initTechnicianFilters,
  generateTechnicianVisitPDF,
  renderTechnicianForm,
  viewLocationOnMap,
  viewTechnicianVisitDetails,
};
