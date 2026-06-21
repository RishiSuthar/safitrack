// modules/features/technician.js
// Technician-specific views: UPS maintenance report form + manager report viewer.
import { state, supabaseClient, crmDebugLog, loadPersistedState as _loadPersistedState, saveViewState } from '../state.js';
import { viewContainer } from '../ui/dom.js';
import { showToast, escapeHtml, getInitials, handleImageError } from '../ui/toast.js';
import { renderSkeletonCards, renderError } from '../utils/helpers.js';
import './solar-technician.js';

// ════════════════════════════════════════════════════════════════
// HELPER — format date & compress image
// ════════════════════════════════════════════════════════════════
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

async function compressImage(file, maxPx = 1024, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxPx || height > maxPx) {
          if (width > height) { height = Math.round((height * maxPx) / width); width = maxPx; }
          else { width = Math.round((width * maxPx) / height); height = maxPx; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob => resolve(new File([blob], file.name, { type: 'image/jpeg' })), 'image/jpeg', quality);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ════════════════════════════════════════════════════════════════
// STEP DEFINITIONS — The 7 steps of the UPS form
// ════════════════════════════════════════════════════════════════
const STEP_NAMES = [
  'Site Information',
  'Environmental Conditions',
  'UPS / Inverter Parameters',
  'Electrical Measurements',
  'Battery System',
  'Checks & Maintenance',
  'Conclusion'
];

// ════════════════════════════════════════════════════════════════
// HELPER — Per-step photo upload HTML
// ════════════════════════════════════════════════════════════════
function stepPhotoHTML(stepIndex, customLabel) {
  const labelText = customLabel || `Photo — ${STEP_NAMES[stepIndex]}`;
  return `
    <div class="ups-section-divider"></div>
    <div class="ups-field">
      <label class="ups-field-label">${labelText}</label>
      <div class="ups-photo-upload-wrap ups-step-photo-wrap">
        <input type="file" class="ups-photo-input ups-step-photo-input" id="ups-step-photo-${stepIndex}" accept="image/*" data-step="${stepIndex}">
        <div class="ups-photo-preview-box ups-step-photo-box" id="ups-step-photo-box-${stepIndex}">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          <span style="font-size:13px; font-weight:500;">Tap to take photo</span>
        </div>
        <img class="ups-photo-preview-img ups-step-photo-preview" id="ups-step-photo-preview-${stepIndex}" src="">
      </div>
    </div>
  `;
}

// ════════════════════════════════════════════════════════════════
// TECHNICIAN LOG VISIT VIEW — Landing with UPS Visit button
// ════════════════════════════════════════════════════════════════
async function renderTechnicianLogVisitView() {
  viewContainer.innerHTML = `
    <div class="page-header" style="text-align:center; padding-top:24px;">
      <h1 class="page-title">Service Reports</h1>
      <p class="text-muted" style="margin-bottom:24px;">Select a report type to begin</p>
    </div>

    <div style="display:flex; flex-direction:column; gap:16px; padding:0 16px; max-width:600px; margin:0 auto;">
      <div class="ups-visit-card" id="ups-visit-card" tabindex="0" role="button" aria-label="Start UPS Visit Report">
        <div class="ups-visit-card-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 7h11a4 4 0 0 1 0 8H6V7Z"/>
            <path d="M6 7V3"/>
            <path d="M6 15v4"/>
            <path d="M10 7v8"/>
            <path d="M14 7v8"/>
          </svg>
        </div>
        <div class="ups-visit-card-title">UPS Visit</div>
        <p class="ups-visit-card-desc">UPS maintenance & inspection report</p>
      </div>

      <div class="ups-visit-card" id="solar-survey-card" tabindex="0" role="button" aria-label="Start Solar Inverter Survey">
        <div class="ups-visit-card-icon" style="color: #f59e0b; background: rgba(245, 158, 11, 0.1);">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
        </div>
        <div class="ups-visit-card-title">Solar Inverter Survey</div>
        <p class="ups-visit-card-desc">Site assessment and planning for solar</p>
      </div>
    </div>
  `;

  document.getElementById('ups-visit-card').addEventListener('click', () => {
    renderUPSVisitForm();
  });

  document.getElementById('solar-survey-card').addEventListener('click', () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          window.renderSolarSurveyForm(null, pos.coords.latitude, pos.coords.longitude);
        },
        (err) => {
          console.warn('Geolocation failed or denied', err);
          showToast('Location not available, proceeding without it', 'info');
          window.renderSolarSurveyForm(null, null, null);
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
      );
    } else {
      window.renderSolarSurveyForm(null, null, null);
    }
  });

  if (window.lucide) lucide.createIcons();
}

// ════════════════════════════════════════════════════════════════
// UPS VISIT FORM — 7-step multi-step mobile-first form
// ════════════════════════════════════════════════════════════════

function renderUPSVisitForm(existingData = null) {
  document.body.classList.add('ups-form-active');

  const techProfile = state.currentUserProfile || {};
  const techName = `${techProfile.first_name || state.currentUser.user_metadata?.first_name || ''} ${techProfile.last_name || state.currentUser.user_metadata?.last_name || ''}`.trim() || state.currentUser.email;

  viewContainer.innerHTML = `
    <div class="ups-form-container">
      <!-- Progress bar -->
      <div class="ups-progress-bar">
        <div class="ups-progress-label">
          <span class="ups-progress-step-text" id="ups-step-text">Step 1 of 7</span>
          <span class="ups-progress-section-name" id="ups-section-name">${STEP_NAMES[0]}</span>
        </div>
        <div class="ups-progress-track">
          <div class="ups-progress-fill" id="ups-progress-fill" style="width: ${(1/7)*100}%"></div>
        </div>
      </div>

      ${existingData && existingData.manager_approval_status === 'Denied' ? `
        <div style="background:rgba(239, 68, 68, 0.1); border:1px solid rgba(239, 68, 68, 0.2); padding:12px; margin:16px 16px 0 16px; border-radius:8px;">
          <h4 style="margin:0 0 4px 0; color:#ef4444; font-size:14px; display:flex; align-items:center; gap:6px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
            Report Denied
          </h4>
          <p style="margin:0 0 8px 0; font-size:13px; color:var(--text-primary);"><strong>Reason:</strong> ${escapeHtml(existingData.denial_reason || 'No reason provided')}</p>
          <p style="margin:0; font-size:12px; color:var(--text-muted);"><strong>Flagged Sections:</strong> ${(existingData.flagged_sections || []).join(', ') || 'None'}</p>
        </div>
      ` : ''}

      <!-- Steps viewport -->
      <div class="ups-steps-viewport">
        <div class="ups-steps-track" id="ups-steps-track">

          <!-- STEP 1: Site Information -->
          <div class="ups-step" data-step="0">
            <h2 class="ups-step-title">Site Information</h2>
            <p class="ups-step-subtitle">Basic details about the site and UPS unit</p>

            <div class="ups-field">
              <label class="ups-field-label">Site / Client Name <span class="ups-required">*</span></label>
              <input type="text" class="ups-input" id="ups-site-name" placeholder="e.g. ABC Corporation" autocomplete="off" data-required="true">
              <span class="ups-error-message" id="err-site-name"></span>
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Location (Building / Floor)</label>
              <input type="text" class="ups-input" id="ups-location" placeholder="e.g. Main Building, 3rd Floor" autocomplete="off">
            </div>
            <div class="ups-field">
              <label class="ups-field-label">UPS Brand</label>
              <input type="text" class="ups-input" id="ups-brand" placeholder="e.g. APC, Eaton, Schneider" autocomplete="off">
            </div>
            <div class="ups-field-row">
              <div class="ups-field">
                <label class="ups-field-label">UPS Serial Number</label>
                <input type="text" class="ups-input" id="ups-serial" placeholder="Serial #" autocomplete="off">
              </div>
              <div class="ups-field">
                <label class="ups-field-label">UPS Model</label>
                <input type="text" class="ups-input" id="ups-model" placeholder="Model" autocomplete="off">
              </div>
            </div>
            <div class="ups-field-row">
              <div class="ups-field">
                <label class="ups-field-label">UPS Size <span class="ups-field-unit">(kVA)</span></label>
                <input type="number" class="ups-input" id="ups-size-kva" placeholder="e.g. 10" inputmode="decimal" autocomplete="off">
              </div>
              <div class="ups-field">
                <label class="ups-field-label">Phase</label>
                <div class="ups-toggle-group" id="ups-phase">
                  <button type="button" class="ups-toggle-btn toggle-single" data-value="Single">Single</button>
                  <button type="button" class="ups-toggle-btn toggle-three" data-value="Three">Three</button>
                </div>
              </div>
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Model Type</label>
              <div class="ups-toggle-group" id="ups-model-type">
                <button type="button" class="ups-toggle-btn toggle-rackmount" data-value="Rackmount">Rackmount</button>
                <button type="button" class="ups-toggle-btn toggle-tower" data-value="Tower">Tower</button>
              </div>
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Total UPS Runtime</label>
              <div style="display: flex; gap: 8px;">
                <div style="flex: 1;">
                  <label style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px; display: block;">Hours</label>
                  <input type="number" class="ups-input" id="ups-runtime-hours" placeholder="0" inputmode="numeric" autocomplete="off" min="0">
                </div>
                <div style="flex: 1;">
                  <label style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px; display: block;">Minutes</label>
                  <input type="number" class="ups-input" id="ups-runtime-minutes" placeholder="0" inputmode="numeric" autocomplete="off" min="0" max="59">
                </div>
              </div>
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Technician Name</label>
              <input type="text" class="ups-input" id="ups-tech-name" value="${escapeHtml(techName)}" readonly disabled>
            </div>
            ${stepPhotoHTML(0, 'Before Service Photo')}
          </div>

          <!-- STEP 2: Environmental Conditions -->
          <div class="ups-step" data-step="1">
            <h2 class="ups-step-title">Environmental Conditions</h2>
            <p class="ups-step-subtitle">Room environment around the UPS unit</p>

            <div class="ups-field">
              <label class="ups-field-label">Ambient Room Temperature <span class="ups-field-unit">(°C)</span></label>
              <input type="number" class="ups-input" id="ups-temperature" placeholder="e.g. 25" inputmode="decimal" autocomplete="off">
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Humidity Level <span class="ups-field-unit">(%)</span></label>
              <input type="number" class="ups-input" id="ups-humidity" placeholder="e.g. 45" inputmode="decimal" autocomplete="off">
            </div>
            ${stepPhotoHTML(1)}
          </div>

          <!-- STEP 3: UPS / Inverter Parameters -->
          <div class="ups-step" data-step="2">
            <h2 class="ups-step-title">UPS / Inverter Parameters</h2>
            <p class="ups-step-subtitle">Current operating parameters</p>

            <div class="ups-field">
              <label class="ups-field-label">Operating Mode <span class="ups-required">*</span></label>
              <div class="ups-toggle-group" id="ups-operating-mode" data-required="true">
                <button type="button" class="ups-toggle-btn toggle-normal" data-value="Normal">Normal</button>
                <button type="button" class="ups-toggle-btn toggle-bypass" data-value="Bypass">Bypass</button>
                <button type="button" class="ups-toggle-btn toggle-fault" data-value="Fault">Fault</button>
              </div>
              <span class="ups-error-message" id="err-operating-mode"></span>
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Rectifier DC Output Voltage <span class="ups-field-unit">(VDC)</span></label>
              <input type="number" class="ups-input" id="ups-rectifier-vdc" placeholder="0" inputmode="decimal" autocomplete="off">
            </div>
            <div class="ups-field-row">
              <div class="ups-field">
                <label class="ups-field-label">Inverter Output Frequency <span class="ups-field-unit">(Hz)</span></label>
                <input type="number" class="ups-input" id="ups-inverter-freq" placeholder="50" inputmode="decimal" autocomplete="off">
              </div>
              <div class="ups-field">
                <label class="ups-field-label">Load Percentage <span class="ups-field-unit">(%)</span></label>
                <input type="number" class="ups-input" id="ups-load-pct" placeholder="0" inputmode="decimal" autocomplete="off">
              </div>
            </div>
            ${stepPhotoHTML(2)}
          </div>

          <!-- STEP 4: Electrical Measurements -->
          <div class="ups-step" data-step="3">
            <h2 class="ups-step-title">Electrical Measurements</h2>
            <p class="ups-step-subtitle">Input and output voltage/current readings</p>

            <h3 style="font-size:14px; font-weight:600; color:var(--text-secondary); margin:0 0 12px; text-transform:uppercase; letter-spacing:0.05em;">Input — Phase-Neutral Voltage</h3>
            <div class="ups-field-row ups-field-row-3">
              <div class="ups-field">
                <label class="ups-field-label">R-N <span class="ups-field-unit">(V)</span></label>
                <input type="number" class="ups-input" id="ups-in-rn" placeholder="0" inputmode="decimal">
              </div>
              <div class="ups-field">
                <label class="ups-field-label">Y-N <span class="ups-field-unit">(V)</span></label>
                <input type="number" class="ups-input" id="ups-in-yn" placeholder="0" inputmode="decimal">
              </div>
              <div class="ups-field">
                <label class="ups-field-label">B-N <span class="ups-field-unit">(V)</span></label>
                <input type="number" class="ups-input" id="ups-in-bn" placeholder="0" inputmode="decimal">
              </div>
            </div>

            <div class="ups-section-divider"></div>

            <h3 style="font-size:14px; font-weight:600; color:var(--text-secondary); margin:0 0 12px; text-transform:uppercase; letter-spacing:0.05em;">Output — Phase-Neutral Voltage</h3>
            <div class="ups-field-row ups-field-row-3">
              <div class="ups-field">
                <label class="ups-field-label">R-N <span class="ups-field-unit">(V)</span></label>
                <input type="number" class="ups-input" id="ups-out-rn" placeholder="0" inputmode="decimal">
              </div>
              <div class="ups-field">
                <label class="ups-field-label">Y-N <span class="ups-field-unit">(V)</span></label>
                <input type="number" class="ups-input" id="ups-out-yn" placeholder="0" inputmode="decimal">
              </div>
              <div class="ups-field">
                <label class="ups-field-label">B-N <span class="ups-field-unit">(V)</span></label>
                <input type="number" class="ups-input" id="ups-out-bn" placeholder="0" inputmode="decimal">
              </div>
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Output Load Current <span class="ups-field-unit">(Amps)</span></label>
              <input type="number" class="ups-input" id="ups-out-current" placeholder="0" inputmode="decimal">
            </div>
            ${stepPhotoHTML(3)}
          </div>

          <!-- STEP 5: Battery System -->
          <div class="ups-step" data-step="4">
            <h2 class="ups-step-title">Battery System</h2>
            <p class="ups-step-subtitle">Battery specifications and condition checks</p>

            <div class="ups-field-row">
              <div class="ups-field">
                <label class="ups-field-label">Battery Brand</label>
                <input type="text" class="ups-input" id="ups-batt-brand" placeholder="Brand" autocomplete="off">
              </div>
              <div class="ups-field">
                <label class="ups-field-label">Battery Size</label>
                <input type="text" class="ups-input" id="ups-batt-size" placeholder="e.g. 12V 100Ah" autocomplete="off">
              </div>
            </div>
            <div class="ups-field-row">
              <div class="ups-field">
                <label class="ups-field-label">Quantity in Series</label>
                <input type="number" class="ups-input" id="ups-batt-qty" placeholder="0" inputmode="decimal">
              </div>
              <div class="ups-field">
                <label class="ups-field-label">Total Bank Voltage <span class="ups-field-unit">(VDC)</span></label>
                <input type="number" class="ups-input" id="ups-batt-bank-v" placeholder="0" inputmode="decimal">
              </div>
            </div>
            <div class="ups-field-row">
              <div class="ups-field">
                <label class="ups-field-label">Charging Voltage <span class="ups-field-unit">(VDC)</span></label>
                <input type="number" class="ups-input" id="ups-batt-charge-v" placeholder="0" inputmode="decimal">
              </div>
              <div class="ups-field">
                <label class="ups-field-label">Surface Temp <span class="ups-field-unit">(°C)</span></label>
                <input type="number" class="ups-input" id="ups-batt-temp" placeholder="0" inputmode="decimal">
              </div>
            </div>

            <div class="ups-section-divider"></div>

            <div class="ups-field">
              <label class="ups-field-label">Battery Connections Tightened</label>
              <div class="ups-toggle-group" id="ups-batt-tight">
                <button type="button" class="ups-toggle-btn toggle-yes" data-value="true">Yes</button>
                <button type="button" class="ups-toggle-btn toggle-no" data-value="false">No</button>
              </div>
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Signs of Bulging or Leakage</label>
              <div class="ups-toggle-group" id="ups-batt-bulge">
                <button type="button" class="ups-toggle-btn toggle-yes" data-value="true">Yes</button>
                <button type="button" class="ups-toggle-btn toggle-no" data-value="false">No</button>
              </div>
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Battery Self-Test Result</label>
              <div class="ups-toggle-group" id="ups-batt-test">
                <button type="button" class="ups-toggle-btn toggle-pass" data-value="Pass">Pass</button>
                <button type="button" class="ups-toggle-btn toggle-fail" data-value="Fail">Fail</button>
                <button type="button" class="ups-toggle-btn toggle-not-tested" data-value="Not Tested">Not Tested</button>
              </div>
            </div>
            ${stepPhotoHTML(4)}
          </div>

          <!-- STEP 6: Checks & Maintenance -->
          <div class="ups-step" data-step="5">
            <h2 class="ups-step-title">Checks & Maintenance</h2>
            <p class="ups-step-subtitle">Functional checks and maintenance tasks</p>

            ${[
              { id: 'ups-chk-bypass', label: 'Transfer to Manual Bypass Functional' },
              { id: 'ups-chk-transfer', label: 'Load Transfer Test (Line to Battery)' },
              { id: 'ups-chk-fan', label: 'Cooling Fan Noise / Vibration Check' },
              { id: 'ups-chk-alarm', label: 'Error / Alarm Log Cleared' },
              { id: 'ups-chk-clean', label: 'Unit Interior Cleaned of Dust' },
              { id: 'ups-chk-wiring', label: 'Internal Wiring / Connectors Inspected' }
            ].map(item => `
            <div class="ups-field">
              <label class="ups-field-label">${item.label}</label>
              <div class="ups-toggle-group" id="${item.id}">
                <button type="button" class="ups-toggle-btn toggle-yes" data-value="Yes">Yes</button>
                <button type="button" class="ups-toggle-btn toggle-no" data-value="No">No</button>
                <button type="button" class="ups-toggle-btn toggle-na" data-value="N/A">N/A</button>
              </div>
            </div>
            `).join('')}

            <div class="ups-section-divider"></div>

            <div class="ups-field">
              <label class="ups-field-label">Firmware / Software Version</label>
              <input type="text" class="ups-input" id="ups-firmware" placeholder="e.g. v3.2.1" autocomplete="off">
            </div>
            ${stepPhotoHTML(5)}
          </div>

          <!-- STEP 7: Conclusion -->
          <div class="ups-step" data-step="6">
            <h2 class="ups-step-title">Conclusion</h2>
            <p class="ups-step-subtitle">Final assessment and sign-off</p>

            <div class="ups-field">
              <label class="ups-field-label">Overall System Status <span class="ups-required">*</span></label>
              <div class="ups-toggle-group" id="ups-overall-status" data-required="true">
                <button type="button" class="ups-toggle-btn toggle-pass" data-value="Pass">Pass</button>
                <button type="button" class="ups-toggle-btn toggle-fail" data-value="Fail">Fail</button>
              </div>
              <span class="ups-error-message" id="err-overall-status"></span>
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Client Engineer Name</label>
              <input type="text" class="ups-input" id="ups-client-eng" placeholder="Client's engineer name" autocomplete="off">
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Servicing Engineer Name</label>
              <input type="text" class="ups-input" id="ups-service-eng" value="${escapeHtml(techName)}" readonly disabled>
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Notes / Remarks</label>
              <textarea class="ups-input" id="ups-notes" placeholder="Any additional notes or observations..." rows="4"></textarea>
            </div>

            ${stepPhotoHTML(6, 'After Service Photo')}

            <div class="ups-field">
              <label class="ups-field-label">Technician Signature</label>
              <div class="ups-signature-wrap">
                <button type="button" class="ups-signature-clear" id="ups-sig-clear">Clear</button>
                <canvas class="ups-signature-canvas" id="ups-sig-canvas"></canvas>
              </div>
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Client Signature</label>
              <div class="ups-signature-wrap">
                <button type="button" class="ups-signature-clear" id="ups-client-sig-clear">Clear</button>
                <canvas class="ups-signature-canvas" id="ups-client-sig-canvas"></canvas>
              </div>
            </div>

          </div>

        </div>
      </div>

      <!-- Sticky nav footer -->
      <div class="ups-nav-footer" id="ups-nav-footer">
        <button class="ups-nav-btn" id="ups-btn-back" style="display:none;">← Back</button>
        <button class="ups-nav-btn ups-nav-btn-primary" id="ups-btn-next">Next →</button>
      </div>
    </div>
  `;

  initUPSFormLogic(techName, existingData);
}

// ════════════════════════════════════════════════════════════════
// UPS FORM LOGIC — Navigation, validation, toggles, submission
// ════════════════════════════════════════════════════════════════

function initUPSFormLogic(techName, existingData) {
  let currentStep = 0;
  const totalSteps = 7;
  const track = document.getElementById('ups-steps-track');
  const progressFill = document.getElementById('ups-progress-fill');
  const stepText = document.getElementById('ups-step-text');
  const sectionName = document.getElementById('ups-section-name');
  const btnBack = document.getElementById('ups-btn-back');
  const btnNext = document.getElementById('ups-btn-next');

  if (existingData) {
    const setVal = (id, val) => { const el = document.getElementById(id); if (el && val !== null && val !== undefined) el.value = val; };
    const setToggle = (name, val) => {
      const group = document.getElementById(name);
      if (group) {
        const btn = group.querySelector(`button.ups-toggle-btn[data-value="${val}"]`);
        if (btn) {
          group.querySelectorAll('.ups-toggle-btn').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
        }
      }
    };

    setVal('ups-site-name', existingData.site_client_name);
    setVal('ups-location', existingData.location_building);
    setVal('ups-brand', existingData.ups_brand);
    setVal('ups-serial', existingData.ups_serial_number);
    setVal('ups-model', existingData.ups_model);
    setVal('ups-size-kva', existingData.ups_size_kva);
    if (existingData.phase) setToggle('ups-phase', existingData.phase);
    if (existingData.model_type) setToggle('ups-model-type', existingData.model_type);
    if (existingData.total_ups_runtime !== null && existingData.total_ups_runtime !== undefined) {
      const total = parseFloat(existingData.total_ups_runtime);
      const hrs = Math.floor(total);
      const mins = Math.round((total - hrs) * 60);
      document.getElementById('ups-runtime-hours').value = hrs > 0 ? hrs : '';
      document.getElementById('ups-runtime-minutes').value = mins > 0 ? mins : '';
    }
    
    setVal('ups-temperature', existingData.ambient_room_temperature);
    setVal('ups-humidity', existingData.humidity_level);
    
    if (existingData.operating_mode) setToggle('ups-operating-mode', existingData.operating_mode);
    setVal('ups-rectifier-vdc', existingData.rectifier_dc_output_voltage);
    setVal('ups-inverter-freq', existingData.inverter_output_frequency);
    setVal('ups-load-pct', existingData.load_percentage);
    
    setVal('ups-in-rn', existingData.input_voltage_rn);
    setVal('ups-in-yn', existingData.input_voltage_yn);
    setVal('ups-in-bn', existingData.input_voltage_bn);
    setVal('ups-out-rn', existingData.output_voltage_rn);
    setVal('ups-out-yn', existingData.output_voltage_yn);
    setVal('ups-out-bn', existingData.output_voltage_bn);
    setVal('ups-out-current', existingData.output_load_current);
    
    setVal('ups-batt-brand', existingData.battery_brand);
    setVal('ups-batt-size', existingData.battery_size);
    setVal('ups-batt-qty', existingData.battery_quantity_series);
    setVal('ups-batt-bank-v', existingData.total_battery_bank_voltage);
    setVal('ups-batt-charge-v', existingData.charging_voltage);
    setVal('ups-batt-temp', existingData.battery_surface_temperature);
    
    if (existingData.battery_connections_tightened !== null) setToggle('ups-batt-tight', String(existingData.battery_connections_tightened));
    if (existingData.signs_bulging_leakage !== null) setToggle('ups-batt-bulge', String(existingData.signs_bulging_leakage));
    if (existingData.battery_self_test_result) setToggle('ups-batt-test', existingData.battery_self_test_result);
    
    if (existingData.transfer_manual_bypass) setToggle('ups-chk-bypass', existingData.transfer_manual_bypass);
    if (existingData.load_transfer_test) setToggle('ups-chk-transfer', existingData.load_transfer_test);
    if (existingData.cooling_fan_check) setToggle('ups-chk-fan', existingData.cooling_fan_check);
    if (existingData.error_alarm_log_cleared) setToggle('ups-chk-alarm', existingData.error_alarm_log_cleared);
    if (existingData.unit_interior_cleaned) setToggle('ups-chk-clean', existingData.unit_interior_cleaned);
    if (existingData.internal_wiring_inspected) setToggle('ups-chk-wiring', existingData.internal_wiring_inspected);
    setVal('ups-firmware', existingData.firmware_version);
    
    if (existingData.overall_system_status) setToggle('ups-overall-status', existingData.overall_system_status);
    setVal('ups-client-eng', existingData.client_engineer_name);
    setVal('ups-notes', existingData.notes_remarks);
    
    // We will let them re-sign or re-take photo if they want, but don't force it.
    // So if existingData has them, they won't be erased unless we explicitly null them.
  }

  // ── Toggle button logic ──
  document.querySelectorAll('.ups-toggle-group').forEach(group => {
    group.querySelectorAll('.ups-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        group.querySelectorAll('.ups-toggle-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        group.classList.remove('ups-input-error');
        // Clear any error message
        const errEl = group.parentElement.querySelector('.ups-error-message');
        if (errEl) errEl.textContent = '';
      });
    });
  });

  // ── Clear input errors on focus ──
  document.querySelectorAll('.ups-input').forEach(input => {
    input.addEventListener('focus', () => {
      input.classList.remove('ups-input-error');
      const errEl = input.parentElement.querySelector('.ups-error-message');
      if (errEl) errEl.textContent = '';
    });
  });

  // ── Navigate to step ──
  function goToStep(step) {
    currentStep = step;
    track.style.transform = `translateX(-${step * 100}%)`;
    progressFill.style.width = `${((step + 1) / totalSteps) * 100}%`;
    stepText.textContent = `Step ${step + 1} of ${totalSteps}`;
    sectionName.textContent = STEP_NAMES[step];

    btnBack.style.display = step === 0 ? 'none' : 'flex';

    if (step === totalSteps - 1) {
      btnNext.textContent = '✓ Submit Report';
      btnNext.className = 'ups-nav-btn ups-nav-btn-submit';
      // Ensure canvas is properly sized when made visible
      setTimeout(resizeCanvas, 10);
    } else {
      btnNext.textContent = 'Next →';
      btnNext.className = 'ups-nav-btn ups-nav-btn-primary';
    }

    // Scroll to top of the step viewport and page
    const viewport = document.querySelector('.ups-steps-viewport');
    if (viewport) viewport.scrollTop = 0;
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const mainContent = document.querySelector('.main-content');
    if (mainContent) mainContent.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ── Signature Pads ──
  function setupSignature(canvasId, clearBtnId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return { hasSignature: false };
    const ctx = canvas.getContext('2d');
    const state = { hasSignature: false, canvas };
    let isDrawing = false;

    function resize() {
      if (!canvas.offsetWidth) return;
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      if (canvas.width !== canvas.offsetWidth * ratio) {
        canvas.width = canvas.offsetWidth * ratio;
        canvas.height = canvas.offsetHeight * ratio;
        ctx.scale(ratio, ratio);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#000';
      }
    }
    resize();

    function getPos(e) {
      const rect = canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return { x: clientX - rect.left, y: clientY - rect.top };
    }

    const startDraw = (e) => { e.preventDefault(); isDrawing = true; state.hasSignature = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
    const draw = (e) => { if (!isDrawing) return; e.preventDefault(); const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); };
    const endDraw = () => { isDrawing = false; };

    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    window.addEventListener('mouseup', endDraw);
    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', endDraw);

    document.getElementById(clearBtnId).addEventListener('click', () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      state.hasSignature = false;
    });

    return { state, resize };
  }

  const techSig = setupSignature('ups-sig-canvas', 'ups-sig-clear');
  const clientSig = setupSignature('ups-client-sig-canvas', 'ups-client-sig-clear');

  function resizeCanvas() {
    if (techSig.resize) techSig.resize();
    if (clientSig.resize) clientSig.resize();
  }
  window.addEventListener('resize', resizeCanvas);

  // ── Per-Step Photo Preview ──
  const selectedStepPhotos = {}; // { stepIndex: File }

  document.querySelectorAll('.ups-step-photo-input').forEach(input => {
    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      const stepIdx = input.dataset.step;
      if (file) {
        selectedStepPhotos[stepIdx] = file;
        const reader = new FileReader();
        reader.onload = (re) => {
          const preview = document.getElementById(`ups-step-photo-preview-${stepIdx}`);
          const box = document.getElementById(`ups-step-photo-box-${stepIdx}`);
          if (preview) { preview.src = re.target.result; preview.style.display = 'block'; }
          if (box) box.style.display = 'none';
        };
        reader.readAsDataURL(file);
      }
    });
  });

  // Pre-populate existing step photos when editing
  if (existingData && existingData.step_photos && typeof existingData.step_photos === 'object') {
    for (const [stepIdx, photoPath] of Object.entries(existingData.step_photos)) {
      if (!photoPath) continue;
      const { data: urlData } = supabaseClient.storage.from('safitrack').getPublicUrl(photoPath);
      const url = urlData?.publicUrl;
      if (url) {
        const preview = document.getElementById(`ups-step-photo-preview-${stepIdx}`);
        const box = document.getElementById(`ups-step-photo-box-${stepIdx}`);
        if (preview) { preview.src = url; preview.style.display = 'block'; }
        if (box) box.style.display = 'none';
      }
    }
  }
  // Backward compat: if old photo_path exists and no step_photos, show it in step 6 (conclusion)
  if (existingData && existingData.photo_path && (!existingData.step_photos || Object.keys(existingData.step_photos).length === 0)) {
    const { data: urlData } = supabaseClient.storage.from('safitrack').getPublicUrl(existingData.photo_path);
    const url = urlData?.publicUrl;
    if (url) {
      const preview = document.getElementById('ups-step-photo-preview-6');
      const box = document.getElementById('ups-step-photo-box-6');
      if (preview) { preview.src = url; preview.style.display = 'block'; }
      if (box) box.style.display = 'none';
    }
  }

  // ── Validate current step ──
  function validateStep(step) {
    let valid = true;
    const stepEl = document.querySelector(`.ups-step[data-step="${step}"]`);
    if (!stepEl) return true;

    // Reset errors
    stepEl.querySelectorAll('.ups-input').forEach(i => i.classList.remove('ups-input-error'));
    stepEl.querySelectorAll('.ups-toggle-group').forEach(g => g.classList.remove('ups-input-error'));
    stepEl.querySelectorAll('.ups-error-message').forEach(m => m.textContent = '');

    // Required inputs
    stepEl.querySelectorAll('.ups-input[required]').forEach(input => {
      if (!input.value.trim()) {
        input.classList.add('ups-input-error');
        const errEl = input.parentElement.querySelector('.ups-error-message');
        if (errEl) errEl.textContent = 'This field is required';
        valid = false;
      }
    });

    // Required toggle groups
    stepEl.querySelectorAll('.ups-toggle-group[data-required="true"]').forEach(group => {
      const selected = group.querySelector('.ups-toggle-btn.selected');
      if (!selected) {
        group.classList.add('ups-input-error');
        const errEl = group.parentElement.querySelector('.ups-error-message');
        if (errEl) errEl.textContent = 'Please select an option';
        valid = false;
      }
    });

    return valid;
  }

  // ── Get toggle value ──
  function getToggleValue(id) {
    const group = document.getElementById(id);
    if (!group) return null;
    const selected = group.querySelector('.ups-toggle-btn.selected');
    return selected ? selected.dataset.value : null;
  }

  // ── Submit ──
  async function submitReport() {
    btnNext.disabled = true;
    btnNext.innerHTML = '<span style="display:inline-flex;align-items:center;gap:6px;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="animate-spin"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> Submitting...</span>';

    try {
      // Upload per-step photos
      const stepPhotos = existingData?.step_photos ? { ...existingData.step_photos } : {};
      const stepEntries = Object.entries(selectedStepPhotos);
      for (const [stepIdx, file] of stepEntries) {
        try {
          const compressed = await compressImage(file, 1200, 0.7);
          const ext = compressed.name.split('.').pop() || 'jpg';
          const fileName = `ups_${Date.now()}_s${stepIdx}_${Math.random().toString(36).substring(2)}.${ext}`;
          const filePath = `technician-photos/${fileName}`;

          const { error: uploadError } = await supabaseClient.storage
            .from('safitrack')
            .upload(filePath, compressed, { cacheControl: '3600', upsert: false });

          if (uploadError) throw uploadError;
          stepPhotos[stepIdx] = filePath;
        } catch (err) {
          console.error(`Photo upload failed for step ${stepIdx}`, err);
          showToast(`Photo upload failed for step ${parseInt(stepIdx)+1}, continuing.`, 'error');
        }
      }

      // Capture signatures
      let signatureData = existingData ? existingData.signature_data : null;
      if (techSig.state.hasSignature) {
        signatureData = techSig.state.canvas.toDataURL('image/png');
      }
      
      let clientSignatureData = existingData ? existingData.client_signature_data : null;
      if (clientSig.state.hasSignature) {
        clientSignatureData = clientSig.state.canvas.toDataURL('image/png');
      }

      const data = {
        technician_id: state.currentUser.id,
        organization_id: state.currentOrganization?.id,
        // Step 1
        site_client_name: document.getElementById('ups-site-name').value.trim(),
        location_building: document.getElementById('ups-location').value.trim() || null,
        ups_brand: document.getElementById('ups-brand').value.trim() || null,
        ups_serial_number: document.getElementById('ups-serial').value.trim() || null,
        ups_model: document.getElementById('ups-model').value.trim() || null,
        ups_size_kva: document.getElementById('ups-size-kva').value ? parseFloat(document.getElementById('ups-size-kva').value) : null,
        phase: getToggleValue('ups-phase'),
        model_type: getToggleValue('ups-model-type'),
        total_ups_runtime: (() => {
          const h = parseInt(document.getElementById('ups-runtime-hours').value) || 0;
          const m = parseInt(document.getElementById('ups-runtime-minutes').value) || 0;
          return (h > 0 || m > 0) ? +(h + (m / 60)).toFixed(2) : null;
        })(),
        technician_name: techName,
        // Step 2
        ambient_room_temperature: parseFloat(document.getElementById('ups-temperature').value) || null,
        humidity_level: parseFloat(document.getElementById('ups-humidity').value) || null,
        // Step 3
        operating_mode: getToggleValue('ups-operating-mode'),
        rectifier_dc_output_voltage: parseFloat(document.getElementById('ups-rectifier-vdc').value) || null,
        inverter_output_frequency: parseFloat(document.getElementById('ups-inverter-freq').value) || null,
        load_percentage: parseFloat(document.getElementById('ups-load-pct').value) || null,
        // Step 4
        input_voltage_rn: parseFloat(document.getElementById('ups-in-rn').value) || null,
        input_voltage_yn: parseFloat(document.getElementById('ups-in-yn').value) || null,
        input_voltage_bn: parseFloat(document.getElementById('ups-in-bn').value) || null,
        output_voltage_rn: parseFloat(document.getElementById('ups-out-rn').value) || null,
        output_voltage_yn: parseFloat(document.getElementById('ups-out-yn').value) || null,
        output_voltage_bn: parseFloat(document.getElementById('ups-out-bn').value) || null,
        output_load_current: parseFloat(document.getElementById('ups-out-current').value) || null,
        // Step 5
        battery_brand: document.getElementById('ups-batt-brand').value.trim() || null,
        battery_size: document.getElementById('ups-batt-size').value.trim() || null,
        battery_quantity_series: parseFloat(document.getElementById('ups-batt-qty').value) || null,
        total_battery_bank_voltage: parseFloat(document.getElementById('ups-batt-bank-v').value) || null,
        charging_voltage: parseFloat(document.getElementById('ups-batt-charge-v').value) || null,
        battery_surface_temperature: parseFloat(document.getElementById('ups-batt-temp').value) || null,
        battery_connections_tightened: getToggleValue('ups-batt-tight') === 'true' ? true : getToggleValue('ups-batt-tight') === 'false' ? false : null,
        signs_bulging_leakage: getToggleValue('ups-batt-bulge') === 'true' ? true : getToggleValue('ups-batt-bulge') === 'false' ? false : null,
        battery_self_test_result: getToggleValue('ups-batt-test'),
        // Step 6
        transfer_manual_bypass: getToggleValue('ups-chk-bypass'),
        load_transfer_test: getToggleValue('ups-chk-transfer'),
        cooling_fan_check: getToggleValue('ups-chk-fan'),
        error_alarm_log_cleared: getToggleValue('ups-chk-alarm'),
        unit_interior_cleaned: getToggleValue('ups-chk-clean'),
        internal_wiring_inspected: getToggleValue('ups-chk-wiring'),
        firmware_version: document.getElementById('ups-firmware').value.trim() || null,
        // Step 7
        overall_system_status: getToggleValue('ups-overall-status'),
        client_engineer_name: document.getElementById('ups-client-eng').value.trim() || null,
        servicing_engineer_name: techName,
        notes_remarks: document.getElementById('ups-notes').value.trim() || null,
        photo_path: existingData?.photo_path || null, // backward compat
        step_photos: stepPhotos,
        signature_data: signatureData,
        client_signature_data: clientSignatureData
      };

      let result;
      if (existingData) {
        data.manager_approval_status = 'Pending'; // reset approval
        const { data: updateRes, error } = await supabaseClient
          .from('ups_maintenance_reports')
          .update(data)
          .eq('id', existingData.id)
          .select('id')
          .single();
        if (error) throw error;
        result = updateRes;
      } else {
        const { data: insertRes, error } = await supabaseClient
          .from('ups_maintenance_reports')
          .insert([data])
          .select('id')
          .single();
        if (error) throw error;
        result = insertRes;
      }

      showToast(existingData ? 'UPS Report Resubmitted!' : 'UPS Report Submitted!', 'success');
      renderSuccessScreen(result.id);

    } catch (e) {
      console.error('UPS report submit error:', e);
      showToast('Submission failed: ' + e.message, 'error');
      btnNext.disabled = false;
      btnNext.textContent = '✓ Submit Report';
      btnNext.className = 'ups-nav-btn ups-nav-btn-submit';
    }
  }

  // ── Button handlers ──
  btnNext.addEventListener('click', () => {
    if (currentStep === totalSteps - 1) {
      if (validateStep(currentStep)) {
        submitReport();
      }
    } else {
      if (validateStep(currentStep)) {
        goToStep(currentStep + 1);
      }
    }
  });

  btnBack.addEventListener('click', () => {
    if (currentStep > 0) {
      goToStep(currentStep - 1);
    }
  });
}

// ════════════════════════════════════════════════════════════════
// SUCCESS SCREEN
// ════════════════════════════════════════════════════════════════

function renderSuccessScreen(reportId) {
  document.body.classList.remove('ups-form-active');

  viewContainer.innerHTML = `
    <div class="ups-success-screen">
      <div class="ups-success-icon">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 6 9 17l-5-5"/>
        </svg>
      </div>
      <h2 class="ups-success-title">Report Submitted!</h2>
      <p class="ups-success-subtitle">Your UPS maintenance report has been saved successfully.</p>
      <div class="ups-success-report-id">Report ID: ${reportId}</div>
      <button class="ups-success-btn" id="ups-new-report-btn">Start New Report</button>
    </div>
  `;

  // Remove the nav footer if still present
  const footer = document.querySelector('.ups-nav-footer');
  if (footer) footer.remove();

  document.getElementById('ups-new-report-btn').addEventListener('click', () => {
    renderTechnicianLogVisitView();
  });
}

// ════════════════════════════════════════════════════════════════
// TECHNICIAN ACTIVITY VIEW (My Service Visits — unchanged)
// ════════════════════════════════════════════════════════════════

async function renderTechnicianActivityView() {
  viewContainer.innerHTML = `<div class="page-header"><h1 class="page-title">My Service Reports</h1></div><div id="ups-activity-list"></div>`;

  const [upsRes, solarRes] = await Promise.all([
    supabaseClient
      .from('ups_maintenance_reports')
      .select('id, site_client_name, overall_system_status, created_at, manager_approval_status, denial_reason')
      .eq('technician_id', state.currentUser.id)
      .order('created_at', { ascending: false })
      .limit(50),
    supabaseClient
      .from('solar_inverter_surveys')
      .select('id, company_organization_name, manager_approval_status, created_at, denial_reason')
      .eq('technician_id', state.currentUser.id)
      .order('created_at', { ascending: false })
      .limit(50)
  ]);

  const container = document.getElementById('ups-activity-list');

  if (upsRes.error) {
    container.innerHTML = renderError(upsRes.error.message);
    return;
  }
  if (solarRes.error) {
    container.innerHTML = renderError(solarRes.error.message);
    return;
  }

  const upsReports = (upsRes.data || []).map(r => ({ ...r, _type: 'UPS', titleName: r.site_client_name }));
  const solarReports = (solarRes.data || []).map(r => ({ ...r, _type: 'SOLAR', titleName: r.company_organization_name }));
  
  const allReports = [...upsReports, ...solarReports].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (!allReports || allReports.length === 0) {
    container.innerHTML = `
      <div class="card">
        <div class="empty-state">
          <h3 class="empty-state-title">No service reports yet</h3>
          <p class="empty-state-description">Start logging visits to see them here.</p>
          <button class="btn btn-primary" onclick="loadView('technician-log-visit')">
            <i data-lucide="plus"></i> Log Your First Visit
          </button>
        </div>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  container.innerHTML = `
    <div class="ups-tech-cards-wrap" style="max-width: 600px; margin: 0 auto; padding-bottom: 24px;">
      ${allReports.map(r => `
        <div class="ups-tech-card">
          <div class="ups-tech-card-header">
            <div>
              <div class="ups-tech-card-title">
                ${r._type === 'UPS' ? '<span style="font-size:10px; background:#e0e7ff; color:#4f46e5; padding:2px 6px; border-radius:12px; margin-right:6px; vertical-align:middle;">UPS</span>' : '<span style="font-size:10px; background:#fef3c7; color:#d97706; padding:2px 6px; border-radius:12px; margin-right:6px; vertical-align:middle;">SOLAR</span>'}
                ${escapeHtml(r.titleName || 'Unknown Site')}
              </div>
              <div class="ups-tech-card-meta">
                <span>Date: ${formatDate(r.created_at)}</span>
                <span>ID: ${r.id.substring(0, 8)}…</span>
              </div>
            </div>
            <div style="display:flex; flex-direction:column; gap:4px; align-items:flex-end;">
              <span class="ups-status-badge ${r.manager_approval_status === 'Approved' ? 'ups-status-badge-pass' : (r.manager_approval_status === 'Denied' ? 'ups-status-badge-fail' : '')}" style="${!r.manager_approval_status || r.manager_approval_status === 'Pending' ? 'background:var(--bg-secondary); color:var(--text-primary); border:1px solid var(--border-color);' : ''}">
                ${r.manager_approval_status || 'Pending'}
              </span>
            </div>
          </div>
          
          ${r.manager_approval_status === 'Denied' ? `
            <div style="margin-top:8px; padding:8px 12px; background:var(--color-danger-bg); border-left:3px solid var(--color-danger); border-radius:var(--radius-xs); font-size:0.85rem; color:var(--color-danger-rgb);">
              <strong>Denied:</strong> ${escapeHtml(r.denial_reason || 'Needs revision')}
            </div>
          ` : ''}

          <div class="ups-tech-card-actions">
            <button class="btn btn-secondary btn-sm" onclick="${r._type === 'UPS' ? `window._viewUPSReport('${r.id}', true)` : `window._viewSolarReport('${r.id}', true)`}">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              View
            </button>
            <button class="btn btn-primary btn-sm" onclick="${r._type === 'UPS' ? `window._editUPSReport('${r.id}')` : `window._editSolarReport('${r.id}')`}">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Edit
            </button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

window._editUPSReport = async function(reportId) {
  const { data: r, error } = await supabaseClient
    .from('ups_maintenance_reports')
    .select('*')
    .eq('id', reportId)
    .single();
    
  if (error || !r) {
    showToast('Failed to load report for editing', 'error');
    return;
  }
  
  renderUPSVisitForm(r);
};

window._editSolarReport = async function(reportId) {
  const { data: r, error } = await supabaseClient
    .from('solar_inverter_surveys')
    .select('*')
    .eq('id', reportId)
    .single();
    
  if (error || !r) {
    showToast('Failed to load report for editing', 'error');
    return;
  }
  
  window.renderSolarSurveyForm(r, r.latitude, r.longitude);
};

// ════════════════════════════════════════════════════════════════
// MANAGER VIEW — TECHNICIANS DASHBOARD
// ════════════════════════════════════════════════════════════════

async function renderTechniciansDashboardView() {
  viewContainer.innerHTML = `
    <div class="ups-reports-section" id="ups-reports-section" style="margin-top: 0;">
      <div class="ups-reports-header">
        <h3 class="ups-reports-title">
          All Reports
        </h3>
        <div style="display:flex; gap:8px; flex-wrap:wrap; flex:1; justify-content:flex-end; align-items:center;">
          <select class="ups-reports-search" id="ups-reports-filter-type" style="width:120px; padding:8px;">
            <option value="">All Types</option>
            <option value="UPS">UPS</option>
            <option value="SOLAR">Solar</option>
          </select>
          <select class="ups-reports-search" id="ups-reports-filter-status" style="width:140px; padding:8px;">
            <option value="">All Statuses</option>
            <option value="Approved">Approved</option>
            <option value="Pending">Pending</option>
            <option value="Denied">Denied</option>
          </select>
          <div style="display:inline-flex; align-items:center; gap:6px;">
            <span style="font-size:0.75rem; color:var(--text-muted); font-weight:550;">Date:</span>
            <input type="date" class="ups-reports-search" id="ups-reports-filter-date-from" placeholder="From" style="width:130px; padding:8px;">
            <span style="font-size:0.75rem; color:var(--text-muted); font-weight:550;">to</span>
            <input type="date" class="ups-reports-search" id="ups-reports-filter-date-to" placeholder="To" style="width:130px; padding:8px;">
            <button class="crm-filter-clear" id="ups-reports-date-clear" style="display:none;">✕ Clear dates</button>
          </div>
          <input type="text" class="ups-reports-search" id="ups-reports-search" placeholder="Search ID, Site, or Location…" autocomplete="off">
        </div>
      </div>

      <div id="ups-reports-container">
        <div class="ups-reports-empty">Loading reports…</div>
      </div>
    </div>
  `;

  // Fetch reports
  let queryUPS = supabaseClient
    .from('ups_maintenance_reports')
    .select('id, site_client_name, technician_name, overall_system_status, created_at, manager_approval_status')
    .order('created_at', { ascending: false })
    .limit(100);

  let querySolar = supabaseClient
    .from('solar_inverter_surveys')
    .select('id, company_organization_name, survey_done_by, created_at, manager_approval_status')
    .order('created_at', { ascending: false })
    .limit(100);

  if (state.currentOrganization?.id) {
    queryUPS = queryUPS.eq('organization_id', state.currentOrganization.id);
    querySolar = querySolar.eq('organization_id', state.currentOrganization.id);
  }

  const [resUPS, resSolar] = await Promise.all([queryUPS, querySolar]);

  if (resUPS.error || resSolar.error) {
    document.getElementById('ups-reports-container').innerHTML = renderError((resUPS.error || resSolar.error).message);
    return;
  }

  const upsReports = (resUPS.data || []).map(r => ({ ...r, _type: 'UPS', titleName: r.site_client_name, techName: r.technician_name }));
  const solarReports = (resSolar.data || []).map(r => ({ ...r, _type: 'SOLAR', titleName: r.company_organization_name, techName: r.survey_done_by }));
  
  const allReports = [...upsReports, ...solarReports].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  renderReportsTable(allReports, allReports);

  // Search & Filters
  const searchInput = document.getElementById('ups-reports-search');
  const typeFilter = document.getElementById('ups-reports-filter-type');
  const statusFilter = document.getElementById('ups-reports-filter-status');
  const dateFromInput = document.getElementById('ups-reports-filter-date-from');
  const dateToInput = document.getElementById('ups-reports-filter-date-to');

  // Initialize CustomCalendar on date inputs
  if (window.initCustomCalendar) {
    window.initCustomCalendar('#ups-reports-filter-date-from', { type: 'date' });
    window.initCustomCalendar('#ups-reports-filter-date-to', { type: 'date' });
  }

  const applyFilters = () => {
    const q = searchInput.value.trim().toLowerCase();
    const t = typeFilter.value;
    const s = statusFilter.value;
    const dateFrom = dateFromInput?.value || '';
    const dateTo = dateToInput?.value || '';

    const clearBtn = document.getElementById('ups-reports-date-clear');
    if (clearBtn) clearBtn.style.display = (dateFrom || dateTo) ? 'inline-block' : 'none';
    
    const filtered = allReports.filter(r => {
      const matchSearch = !q || 
        r.id.toLowerCase().includes(q) || 
        (r.titleName || '').toLowerCase().includes(q) || 
        (r.techName || '').toLowerCase().includes(q);
      const matchType = !t || r._type === t;
      const matchStatus = !s || r.manager_approval_status === s || (!r.manager_approval_status && s === 'Pending');

      let matchDate = true;
      if (dateFrom || dateTo) {
        const reportDate = new Date(r.created_at);
        if (dateFrom && reportDate < new Date(dateFrom)) matchDate = false;
        if (dateTo) {
          const toEnd = new Date(dateTo);
          toEnd.setHours(23, 59, 59, 999);
          if (reportDate > toEnd) matchDate = false;
        }
      }

      return matchSearch && matchType && matchStatus && matchDate;
    });
    renderReportsTable(filtered, allReports);
  };

  searchInput.addEventListener('input', applyFilters);
  typeFilter.addEventListener('change', applyFilters);
  statusFilter.addEventListener('change', applyFilters);
  dateFromInput?.addEventListener('change', applyFilters);
  dateToInput?.addEventListener('change', applyFilters);

  document.getElementById('ups-reports-date-clear')?.addEventListener('click', () => {
    if (dateFromInput) dateFromInput.value = '';
    if (dateToInput) dateToInput.value = '';
    applyFilters();
  });
}

function renderReportsTable(reports, allReports) {
  const container = document.getElementById('ups-reports-container');

  if (reports.length === 0) {
    container.innerHTML = `<div class="ups-reports-empty">No reports found.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="ups-reports-table-wrap">
      <table class="ups-reports-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Report ID</th>
            <th>Site / Client</th>
            <th>Technician</th>
            <th>Date</th>
            <th>Approval</th>
          </tr>
        </thead>
        <tbody>
          ${reports.map(r => `
            <tr onclick="${r._type === 'UPS' ? `window._viewUPSReport('${r.id}')` : `window._viewSolarReport('${r.id}')`}">
              <td>
                <span style="font-size:11px; font-weight:600; padding:2px 8px; border-radius:12px; ${r._type === 'UPS' ? 'background:#e0e7ff; color:#4f46e5;' : 'background:#fef3c7; color:#d97706;'}">
                  ${r._type}
                </span>
              </td>
              <td class="ups-report-id-cell">${r.id.substring(0, 8)}…</td>
              <td>${escapeHtml(r.titleName || '—')}</td>
              <td>${escapeHtml(r.techName || '—')}</td>
              <td>${formatDate(r.created_at)}</td>
              <td onclick="event.stopPropagation()">
                ${!r.manager_approval_status || r.manager_approval_status === 'Pending' ? `
                  <div style="display:flex; gap:6px;">
                    <button class="btn btn-sm btn-success" onclick="window._updateReportApproval('${r._type}', '${r.id}', 'Approved')" style="padding:4px 8px; font-size:12px; min-height:28px;" title="Approve">
                      <i data-lucide="check" style="width:14px; height:14px; pointer-events:none;"></i>
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="window._updateReportApproval('${r._type}', '${r.id}', 'Denied')" style="padding:4px 8px; font-size:12px; min-height:28px;" title="Deny">
                      <i data-lucide="x" style="width:14px; height:14px; pointer-events:none;"></i>
                    </button>
                  </div>
                ` : `
                  <div style="display:flex; gap:6px; align-items:center;">
                    <span class="ups-status-badge ${r.manager_approval_status === 'Approved' ? 'ups-status-badge-pass' : 'ups-status-badge-fail'}">
                      ${r.manager_approval_status}
                    </span>
                    <button class="btn btn-sm" onclick="window._updateReportApproval('${r._type}', '${r.id}', 'Pending')" style="padding:4px 8px; font-size:12px; min-height:28px; background:transparent; border:1px solid var(--border-color); color:var(--text-muted);" title="Reset to Pending">
                      <i data-lucide="undo" style="width:14px; height:14px; pointer-events:none;"></i>
                    </button>
                  </div>
                `}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  if (window.lucide) lucide.createIcons();
}

// ════════════════════════════════════════════════════════════════
// REPORT DETAIL VIEW & APPROVAL (Manager)
// ════════════════════════════════════════════════════════════════

window._updateReportApproval = async function (type, reportId, status) {
  if (status === 'Denied') {
    renderDenialModal(reportId, type);
    return;
  }

  const table = type === 'UPS' ? 'ups_maintenance_reports' : 'solar_inverter_surveys';

  try {
    const { data, error } = await supabaseClient
      .from(table)
      .update({ manager_approval_status: status })
      .eq('id', reportId)
      .select();
      
    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error('Update blocked by permissions. Are you logged in as a Manager for this organization?');
    }
    
    showToast(`Report marked as ${status}`, 'success');
    renderTechniciansDashboardView(); // Refresh the list
  } catch (err) {
    showToast(`Failed to update approval: ${err.message}`, 'error');
  }
};

window._updateUPSApproval = function(id, status) { window._updateReportApproval('UPS', id, status); };


function renderDenialModal(reportId, type = 'UPS') {
  const modalHTML = `
    <div class="ups-modal-overlay" id="ups-denial-modal" style="position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:9999; padding:16px;">
      <div class="ups-modal-content" style="width:100%; max-width:500px; padding:24px; border-radius:12px; background:var(--bg-primary); color:var(--text-primary); box-shadow:0 10px 40px rgba(0,0,0,0.2);">
        <h2 style="margin-top:0; margin-bottom:16px; font-size:20px;">Deny Report</h2>
        <p style="margin-bottom:16px; color:var(--text-muted); font-size:14px;">Select the sections that need correction and provide a reason for the technician.</p>
        
        <div style="margin-bottom:16px;">
          <label style="display:block; margin-bottom:8px; font-weight:600; font-size:14px;">Flagged Sections</label>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;" id="ups-denial-sections">
            ${(type === 'UPS' ? STEP_NAMES : window.SOLAR_STEP_NAMES).map(name => `
              <label style="display:flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">
                <input type="checkbox" value="${name}">
                ${name}
              </label>
            `).join('')}
          </div>
        </div>

        <div style="margin-bottom:24px;">
          <label style="display:block; margin-bottom:8px; font-weight:600; font-size:14px;">Reason for Denial</label>
          <textarea id="ups-denial-reason" class="ups-input" rows="4" placeholder="E.g., Values seem incorrect, please re-measure..."></textarea>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:12px;">
          <button class="btn btn-secondary" onclick="document.getElementById('ups-denial-modal').remove()">Cancel</button>
          <button class="btn btn-danger" id="ups-denial-submit">Submit Denial</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHTML);

  document.getElementById('ups-denial-submit').addEventListener('click', async () => {
    const reason = document.getElementById('ups-denial-reason').value.trim();
    const checked = Array.from(document.querySelectorAll('#ups-denial-sections input:checked')).map(cb => cb.value);
    
    if (!reason) {
      showToast('Please provide a reason for denial.', 'error');
      return;
    }

    const btn = document.getElementById('ups-denial-submit');
    btn.disabled = true;
    btn.textContent = 'Submitting...';

    const table = type === 'UPS' ? 'ups_maintenance_reports' : 'solar_inverter_surveys';

    try {
      const { data, error } = await supabaseClient
        .from(table)
        .update({ 
          manager_approval_status: 'Denied',
          denial_reason: reason,
          flagged_sections: checked
        })
        .eq('id', reportId)
        .select();
        
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Update blocked by permissions.');
      
      showToast('Report denied and sent back to technician.', 'success');
      document.getElementById('ups-denial-modal').remove();
      renderTechniciansDashboardView();
    } catch (err) {
      showToast(`Failed: ${err.message}`, 'error');
      btn.disabled = false;
      btn.textContent = 'Submit Denial';
    }
  });
}

window._viewUPSReport = async function (reportId, isTechnician = false) {
  const containerId = isTechnician ? 'ups-activity-list' : 'ups-reports-container';
  const container = document.getElementById(containerId);
  container.innerHTML = `<div class="ups-reports-empty">Loading report…</div>`;

  const { data: r, error } = await supabaseClient
    .from('ups_maintenance_reports')
    .select('*')
    .eq('id', reportId)
    .single();

  if (error || !r) {
    container.innerHTML = renderError(error?.message || 'Report not found');
    return;
  }

  // Fetch technician actual name if needed
  if (r.technician_id) {
    const { data: techProfile } = await supabaseClient
      .from('profiles')
      .select('first_name, last_name')
      .eq('id', r.technician_id)
      .single();
    if (techProfile && (techProfile.first_name || techProfile.last_name)) {
      const realName = `${techProfile.first_name || ''} ${techProfile.last_name || ''}`.trim();
      r.technician_name = realName;
      if (r.servicing_engineer_name && r.servicing_engineer_name.includes('@')) {
        r.servicing_engineer_name = realName;
      }
    }
  }

  function getStepPhotoUrl(rData, stepIdx) {
    if (rData.step_photos && typeof rData.step_photos === 'object' && rData.step_photos[stepIdx]) {
      const { data } = supabaseClient.storage.from('safitrack').getPublicUrl(rData.step_photos[stepIdx]);
      return data?.publicUrl || null;
    }
    if (stepIdx === 6 && rData.photo_path && (!rData.step_photos || Object.keys(rData.step_photos).length === 0)) {
      const { data } = supabaseClient.storage.from('safitrack').getPublicUrl(rData.photo_path);
      return data?.publicUrl || null;
    }
    return null;
  }

  function mgrStepPhoto(stepIdx, label = null) {
    const url = getStepPhotoUrl(r, stepIdx);
    if (!url) return '';
    return `
      <div class="ups-report-field" style="grid-column: 1 / -1; margin-top: 12px;">
        <span class="ups-report-field-label" style="margin-bottom:8px;">${label || 'Photo — ' + STEP_NAMES[stepIdx]}</span>
        <img src="${url}" class="ups-report-photo-thumb" onclick="window.open(this.src, '_blank')">
      </div>
    `;
  }

  const boolLabel = (v) => v === true ? 'Yes' : v === false ? 'No' : '—';
  const valOrDash = (v) => (v !== null && v !== undefined && v !== '') ? escapeHtml(String(v)) : '—';
  const formatRuntimeHelper = (v) => {
    if (v === null || v === undefined || v === '') return '—';
    const hrs = Math.floor(v);
    const mins = Math.round((v - hrs) * 60);
    let res = [];
    if (hrs > 0) res.push(`${hrs} hr${hrs !== 1 ? 's' : ''}`);
    if (mins > 0) res.push(`${mins} min${mins !== 1 ? 's' : ''}`);
    return res.length > 0 ? res.join(' ') : '0 mins';
  };

  container.innerHTML = `
    <div class="ups-report-detail" id="ups-report-print-target">
      <div class="ups-report-detail-header">
        <div>
          <div style="display:flex; align-items:center; gap:12px;">
            <h3 style="margin:0;">UPS Report — ${escapeHtml(r.site_client_name || 'Unknown')}</h3>
            ${r.manager_approval_status && r.manager_approval_status !== 'Pending' ? `
              <span class="ups-status-badge ${r.manager_approval_status === 'Approved' ? 'ups-status-badge-pass' : 'ups-status-badge-fail'}">
                ${r.manager_approval_status}
              </span>
            ` : ''}
          </div>
          <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">ID: ${r.id} • ${formatDate(r.created_at)}</div>
        </div>
        <div class="ups-report-detail-actions">
          <button class="btn btn-secondary btn-sm" onclick="${isTechnician ? 'window.renderTechnicianActivityView()' : 'window._backToReportsList()'}">
            ← Back
          </button>
          <button class="btn btn-primary btn-sm" onclick="window._downloadUPSPDF('${r.id}')">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Download PDF
          </button>
        </div>
      </div>
      <div class="ups-report-detail-body">
        
        <!-- Before & After Photos -->
        <div class="ups-report-section">
          <div class="ups-report-section-title">Before & After Service Photos</div>
          <div style="display:flex; gap:16px; flex-wrap:wrap; margin-bottom: 24px;">
            <div style="flex:1; min-width:200px;">
              ${mgrStepPhoto(0, 'Before Service')}
            </div>
            <div style="flex:1; min-width:200px;">
              ${mgrStepPhoto(6, 'After Service')}
            </div>
          </div>
        </div>

        <!-- Site Info -->
        <div class="ups-report-section">
          <div class="ups-report-section-title">Site Information</div>
          <div class="ups-report-fields">
            <div class="ups-report-field"><span class="ups-report-field-label">Site / Client Name</span><span class="ups-report-field-value">${valOrDash(r.site_client_name)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Location</span><span class="ups-report-field-value">${valOrDash(r.location_building)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">UPS Brand</span><span class="ups-report-field-value">${valOrDash(r.ups_brand)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">UPS Serial Number</span><span class="ups-report-field-value">${valOrDash(r.ups_serial_number)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">UPS Model</span><span class="ups-report-field-value">${valOrDash(r.ups_model)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">UPS Size (kVA)</span><span class="ups-report-field-value">${valOrDash(r.ups_size_kva)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Phase</span><span class="ups-report-field-value">${valOrDash(r.phase)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Model Type</span><span class="ups-report-field-value">${valOrDash(r.model_type)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Total Runtime</span><span class="ups-report-field-value">${formatRuntimeHelper(r.total_ups_runtime)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Technician</span><span class="ups-report-field-value">${valOrDash(r.technician_name)}</span></div>
          </div>
        </div>

        <!-- Environmental -->
        <div class="ups-report-section">
          <div class="ups-report-section-title">Environmental Conditions</div>
          <div class="ups-report-fields">
            <div class="ups-report-field"><span class="ups-report-field-label">Room Temperature</span><span class="ups-report-field-value">${valOrDash(r.ambient_room_temperature)} °C</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Humidity Level</span><span class="ups-report-field-value">${valOrDash(r.humidity_level)} %</span></div>
            ${mgrStepPhoto(1)}
          </div>
        </div>

        <!-- UPS Parameters -->
        <div class="ups-report-section">
          <div class="ups-report-section-title">UPS / Inverter Parameters</div>
          <div class="ups-report-fields">
            <div class="ups-report-field"><span class="ups-report-field-label">Operating Mode</span><span class="ups-report-field-value">${valOrDash(r.operating_mode)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Rectifier DC Voltage</span><span class="ups-report-field-value">${valOrDash(r.rectifier_dc_output_voltage)} VDC</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Inverter Frequency</span><span class="ups-report-field-value">${valOrDash(r.inverter_output_frequency)} Hz</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Load Percentage</span><span class="ups-report-field-value">${valOrDash(r.load_percentage)} %</span></div>
            ${mgrStepPhoto(2)}
          </div>
        </div>

        <!-- Electrical -->
        <div class="ups-report-section">
          <div class="ups-report-section-title">Electrical Measurements</div>
          <div class="ups-report-fields">
            <div class="ups-report-field"><span class="ups-report-field-label">Input R-N</span><span class="ups-report-field-value">${valOrDash(r.input_voltage_rn)} V</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Input Y-N</span><span class="ups-report-field-value">${valOrDash(r.input_voltage_yn)} V</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Input B-N</span><span class="ups-report-field-value">${valOrDash(r.input_voltage_bn)} V</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Output R-N</span><span class="ups-report-field-value">${valOrDash(r.output_voltage_rn)} V</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Output Y-N</span><span class="ups-report-field-value">${valOrDash(r.output_voltage_yn)} V</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Output B-N</span><span class="ups-report-field-value">${valOrDash(r.output_voltage_bn)} V</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Output Load Current</span><span class="ups-report-field-value">${valOrDash(r.output_load_current)} A</span></div>
            ${mgrStepPhoto(3)}
          </div>
        </div>

        <!-- Battery -->
        <div class="ups-report-section">
          <div class="ups-report-section-title">Battery System</div>
          <div class="ups-report-fields">
            <div class="ups-report-field"><span class="ups-report-field-label">Battery Brand</span><span class="ups-report-field-value">${valOrDash(r.battery_brand)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Battery Size</span><span class="ups-report-field-value">${valOrDash(r.battery_size)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Qty in Series</span><span class="ups-report-field-value">${valOrDash(r.battery_quantity_series)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Bank Voltage</span><span class="ups-report-field-value">${valOrDash(r.total_battery_bank_voltage)} VDC</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Charging Voltage</span><span class="ups-report-field-value">${valOrDash(r.charging_voltage)} VDC</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Surface Temp</span><span class="ups-report-field-value">${valOrDash(r.battery_surface_temperature)} °C</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Connections Tight</span><span class="ups-report-field-value">${boolLabel(r.battery_connections_tightened)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Bulging / Leakage</span><span class="ups-report-field-value">${boolLabel(r.signs_bulging_leakage)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Self-Test Result</span><span class="ups-report-field-value">${valOrDash(r.battery_self_test_result)}</span></div>
            ${mgrStepPhoto(4)}
          </div>
        </div>

        <!-- Checks -->
        <div class="ups-report-section">
          <div class="ups-report-section-title">Checks & Maintenance</div>
          <div class="ups-report-fields">
            <div class="ups-report-field"><span class="ups-report-field-label">Manual Bypass</span><span class="ups-report-field-value">${valOrDash(r.transfer_manual_bypass)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Load Transfer Test</span><span class="ups-report-field-value">${valOrDash(r.load_transfer_test)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Fan / Vibration Check</span><span class="ups-report-field-value">${valOrDash(r.cooling_fan_check)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Alarm Log Cleared</span><span class="ups-report-field-value">${valOrDash(r.error_alarm_log_cleared)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Interior Cleaned</span><span class="ups-report-field-value">${valOrDash(r.unit_interior_cleaned)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Wiring Inspected</span><span class="ups-report-field-value">${valOrDash(r.internal_wiring_inspected)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Firmware Version</span><span class="ups-report-field-value">${valOrDash(r.firmware_version)}</span></div>
            ${mgrStepPhoto(5)}
          </div>
        </div>

        <!-- Conclusion -->
        <div class="ups-report-section">
          <div class="ups-report-section-title">Conclusion</div>
          <div class="ups-report-fields">
            <div class="ups-report-field">
              <span class="ups-report-field-label">Overall Status</span>
              <span class="ups-report-field-value">
                <span class="ups-status-badge ${r.overall_system_status === 'Pass' ? 'ups-status-badge-pass' : 'ups-status-badge-fail'}">
                  ${valOrDash(r.overall_system_status)}
                </span>
              </span>
            </div>
            <div class="ups-report-field"><span class="ups-report-field-label">Client Engineer</span><span class="ups-report-field-value">${valOrDash(r.client_engineer_name)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Servicing Engineer</span><span class="ups-report-field-value">${valOrDash(r.servicing_engineer_name)}</span></div>
            ${r.notes_remarks ? `<div class="ups-report-field" style="grid-column: 1 / -1;"><span class="ups-report-field-label">Notes / Remarks</span><span class="ups-report-field-value" style="white-space:pre-wrap;">${escapeHtml(r.notes_remarks)}</span></div>` : ''}
            ${mgrStepPhoto(6, 'Final Site Photo')}
          </div>
        </div>

        <!-- Signatures -->
        ${(r.signature_data || r.client_signature_data) ? `
        <div class="ups-report-section">
          <div class="ups-report-section-title">Signatures</div>
          <div class="ups-report-fields" style="display:flex; flex-wrap:wrap; gap:24px;">
            ${r.signature_data ? `
            <div class="ups-report-field" style="flex:1; min-width:200px; max-width:300px;">
              <span class="ups-report-field-label" style="margin-bottom:8px;">Technician Signature</span>
              <img src="${r.signature_data}" class="ups-report-sig-thumb">
            </div>
            ` : ''}
            ${r.client_signature_data ? `
            <div class="ups-report-field" style="flex:1; min-width:200px; max-width:300px;">
              <span class="ups-report-field-label" style="margin-bottom:8px;">Client Signature</span>
              <img src="${r.client_signature_data}" class="ups-report-sig-thumb">
            </div>
            ` : ''}
          </div>
        </div>
        ` : ''}

      </div>
    </div>
  `;

  // Store current report data for PDF
  window._currentUPSReport = r;
}

window._backToReportsList = function () {
  renderTechniciansDashboardView();
};

// ════════════════════════════════════════════════════════════════
// PDF DOWNLOAD (via window.print)
// ════════════════════════════════════════════════════════════════

window._downloadUPSPDF = function (reportId) {
  const r = window._currentUPSReport;
  if (!r) {
    showToast('Report data not available', 'error');
    return;
  }

  const boolLabel = (v) => v === true ? 'Yes' : v === false ? 'No' : '—';
  const valOrDash = (v) => (v !== null && v !== undefined && v !== '') ? String(v) : '—';
  const formatRuntimeHelper = (v) => {
    if (v === null || v === undefined || v === '') return '—';
    const hrs = Math.floor(v);
    const mins = Math.round((v - hrs) * 60);
    let res = [];
    if (hrs > 0) res.push(`${hrs} hr${hrs !== 1 ? 's' : ''}`);
    if (mins > 0) res.push(`${mins} min${mins !== 1 ? 's' : ''}`);
    return res.length > 0 ? res.join(' ') : '0 mins';
  };
  const siteName = (r.site_client_name || 'Unknown').replace(/[^a-zA-Z0-9]/g, '_');
  const dateStr = new Date(r.created_at).toISOString().split('T')[0];

  function getStepPhotoUrlLocal(rData, stepIdx) {
    if (rData.step_photos && typeof rData.step_photos === 'object' && rData.step_photos[stepIdx]) {
      const { data } = supabaseClient.storage.from('safitrack').getPublicUrl(rData.step_photos[stepIdx]);
      return data?.publicUrl || null;
    }
    if (stepIdx === 6 && rData.photo_path && (!rData.step_photos || Object.keys(rData.step_photos).length === 0)) {
      const { data } = supabaseClient.storage.from('safitrack').getPublicUrl(rData.photo_path);
      return data?.publicUrl || null;
    }
    return null;
  }

  function pdfStepPhoto(stepIdx, label = null) {
    const url = getStepPhotoUrlLocal(r, stepIdx);
    if (!url) return '';
    return `
      <div style="margin-top:8px;">
        <div style="color:#666; font-weight:500; font-size:11px; margin-bottom:4px;">📷 ${label || STEP_NAMES[stepIdx]}:</div>
        <img src="${url}" style="max-width:200px; max-height:200px; border:1px solid #ccc; border-radius:4px;">
      </div>
    `;
  }

  // Create print container
  const printDiv = document.createElement('div');
  printDiv.className = 'ups-print-target';
  printDiv.innerHTML = `
    <div class="ups-print-header">
      <h1 style="margin-bottom:8px;">Sangyug Enterprises Limited</h1>
      <p style="margin:4px 0;">www.sangyug.com</p>
      <p style="margin:4px 0;">Email : servicecentre@sangyug.com, info@sangyug.com</p>
      <p style="margin:4px 0;">Phone : 0743 767960 | 0715 177456</p>
      <p style="margin-top:12px; font-weight:600;">UPS Maintenance Service Report</p>
      <p style="margin-top:4px;">Report ID: ${r.id} • Date: ${formatDate(r.created_at)}</p>
    </div>

    <div class="ups-print-section">
      <h3>Before & After Service Photos</h3>
      <div style="display:flex; gap:16px; margin-top:12px;">
        <div style="flex:1;">
          <strong style="font-size:12px; display:block; margin-bottom:4px;">Before Service</strong>
          ${pdfStepPhoto(0, 'Before Service')}
        </div>
        <div style="flex:1;">
          <strong style="font-size:12px; display:block; margin-bottom:4px;">After Service</strong>
          ${pdfStepPhoto(6, 'After Service')}
        </div>
      </div>
    </div>

    <div class="ups-print-section">
      <h3>Site Information</h3>
      <div class="ups-print-grid">
        <div class="ups-print-field"><span class="ups-print-field-label">Site / Client:</span><span class="ups-print-field-value">${valOrDash(r.site_client_name)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Location:</span><span class="ups-print-field-value">${valOrDash(r.location_building)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">UPS Brand:</span><span class="ups-print-field-value">${valOrDash(r.ups_brand)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Serial Number:</span><span class="ups-print-field-value">${valOrDash(r.ups_serial_number)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Model:</span><span class="ups-print-field-value">${valOrDash(r.ups_model)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Size (kVA):</span><span class="ups-print-field-value">${valOrDash(r.ups_size_kva)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Phase:</span><span class="ups-print-field-value">${valOrDash(r.phase)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Model Type:</span><span class="ups-print-field-value">${valOrDash(r.model_type)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Runtime:</span><span class="ups-print-field-value">${formatRuntimeHelper(r.total_ups_runtime)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Technician:</span><span class="ups-print-field-value">${valOrDash(r.technician_name)}</span></div>
      </div>
    </div>

    <div class="ups-print-section">
      <h3>Environmental Conditions</h3>
      <div class="ups-print-grid">
        <div class="ups-print-field"><span class="ups-print-field-label">Room Temp:</span><span class="ups-print-field-value">${valOrDash(r.ambient_room_temperature)} °C</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Humidity:</span><span class="ups-print-field-value">${valOrDash(r.humidity_level)} %</span></div>
        ${pdfStepPhoto(1)}
      </div>
    </div>

    <div class="ups-print-section">
      <h3>UPS / Inverter Parameters</h3>
      <div class="ups-print-grid">
        <div class="ups-print-field"><span class="ups-print-field-label">Operating Mode:</span><span class="ups-print-field-value">${valOrDash(r.operating_mode)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Rectifier DC:</span><span class="ups-print-field-value">${valOrDash(r.rectifier_dc_output_voltage)} VDC</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Inverter Freq:</span><span class="ups-print-field-value">${valOrDash(r.inverter_output_frequency)} Hz</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Load %:</span><span class="ups-print-field-value">${valOrDash(r.load_percentage)} %</span></div>
        ${pdfStepPhoto(2)}
      </div>
    </div>

    <div class="ups-print-section">
      <h3>Electrical Measurements</h3>
      <div class="ups-print-grid">
        <div class="ups-print-field"><span class="ups-print-field-label">Input R-N:</span><span class="ups-print-field-value">${valOrDash(r.input_voltage_rn)} V</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Input Y-N:</span><span class="ups-print-field-value">${valOrDash(r.input_voltage_yn)} V</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Input B-N:</span><span class="ups-print-field-value">${valOrDash(r.input_voltage_bn)} V</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Output R-N:</span><span class="ups-print-field-value">${valOrDash(r.output_voltage_rn)} V</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Output Y-N:</span><span class="ups-print-field-value">${valOrDash(r.output_voltage_yn)} V</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Output B-N:</span><span class="ups-print-field-value">${valOrDash(r.output_voltage_bn)} V</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Load Current:</span><span class="ups-print-field-value">${valOrDash(r.output_load_current)} A</span></div>
        ${pdfStepPhoto(3)}
      </div>
    </div>

    <div class="ups-print-section">
      <h3>Battery System</h3>
      <div class="ups-print-grid">
        <div class="ups-print-field"><span class="ups-print-field-label">Brand:</span><span class="ups-print-field-value">${valOrDash(r.battery_brand)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Size:</span><span class="ups-print-field-value">${valOrDash(r.battery_size)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Qty in Series:</span><span class="ups-print-field-value">${valOrDash(r.battery_quantity_series)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Bank Voltage:</span><span class="ups-print-field-value">${valOrDash(r.total_battery_bank_voltage)} VDC</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Charging V:</span><span class="ups-print-field-value">${valOrDash(r.charging_voltage)} VDC</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Surface Temp:</span><span class="ups-print-field-value">${valOrDash(r.battery_surface_temperature)} °C</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Connections Tight:</span><span class="ups-print-field-value">${boolLabel(r.battery_connections_tightened)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Bulging/Leakage:</span><span class="ups-print-field-value">${boolLabel(r.signs_bulging_leakage)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Self-Test:</span><span class="ups-print-field-value">${valOrDash(r.battery_self_test_result)}</span></div>
        ${pdfStepPhoto(4)}
      </div>
    </div>

    <div class="ups-print-section">
      <h3>Checks &amp; Maintenance</h3>
      <div class="ups-print-grid">
        <div class="ups-print-field"><span class="ups-print-field-label">Manual Bypass:</span><span class="ups-print-field-value">${valOrDash(r.transfer_manual_bypass)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Load Transfer:</span><span class="ups-print-field-value">${valOrDash(r.load_transfer_test)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Fan Check:</span><span class="ups-print-field-value">${valOrDash(r.cooling_fan_check)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Alarm Cleared:</span><span class="ups-print-field-value">${valOrDash(r.error_alarm_log_cleared)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Interior Clean:</span><span class="ups-print-field-value">${valOrDash(r.unit_interior_cleaned)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Wiring Inspected:</span><span class="ups-print-field-value">${valOrDash(r.internal_wiring_inspected)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Firmware:</span><span class="ups-print-field-value">${valOrDash(r.firmware_version)}</span></div>
        ${pdfStepPhoto(5)}
      </div>
    </div>

    <div class="ups-print-section">
      <h3>Conclusion</h3>
      <div class="ups-print-grid">
        <div class="ups-print-field"><span class="ups-print-field-label">Overall Status:</span><span class="ups-print-field-value" style="font-weight:800;">${valOrDash(r.overall_system_status)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Manager Approval:</span><span class="ups-print-field-value" style="font-weight:800;">${valOrDash(r.manager_approval_status)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Client Engineer:</span><span class="ups-print-field-value">${valOrDash(r.client_engineer_name)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Servicing Engineer:</span><span class="ups-print-field-value">${valOrDash(r.servicing_engineer_name)}</span></div>
        ${r.notes_remarks ? `<div class="ups-print-field" style="grid-column:1/-1;"><span class="ups-print-field-label">Notes:</span><span class="ups-print-field-value">${valOrDash(r.notes_remarks)}</span></div>` : ''}
        ${pdfStepPhoto(6)}
      </div>
    </div>

    ${(r.signature_data || r.client_signature_data) ? `
    <div class="ups-print-section" style="margin-top:24px;">
      <h3>Signatures</h3>
      <div class="ups-print-grid">
        ${r.signature_data ? `
        <div class="ups-print-field" style="flex-direction:column; gap:8px;">
          <span class="ups-print-field-label">Technician Signature</span>
          <img src="${r.signature_data}" style="max-width:240px; max-height:100px; border-bottom:1px solid #111;">
        </div>
        ` : ''}
        ${r.client_signature_data ? `
        <div class="ups-print-field" style="flex-direction:column; gap:8px;">
          <span class="ups-print-field-label">Client Signature</span>
          <img src="${r.client_signature_data}" style="max-width:240px; max-height:100px; border-bottom:1px solid #111;">
        </div>
        ` : ''}
      </div>
    </div>
    ` : ''}

    <div class="ups-print-footer">
      Sangyug Enterprises Ltd — Generated ${new Date().toLocaleString()}
    </div>
  `;

  document.body.appendChild(printDiv);
  document.body.classList.add('ups-print-mode');

  const origTitle = document.title;
  document.title = `UPS_Report_${siteName}_${dateStr}`;

  setTimeout(() => {
    window.print();
    // Restore after print
    setTimeout(() => {
      document.body.classList.remove('ups-print-mode');
      printDiv.remove();
      document.title = origTitle;
    }, 500);
  }, 100);
};

// Expose for back button in technician view
window.renderTechnicianActivityView = renderTechnicianActivityView;

// ── Exports ────────────────────────────────────────────────────
export {
  renderTechnicianLogVisitView,
  renderTechnicianActivityView,
  renderTechniciansDashboardView,
};
