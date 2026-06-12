// modules/features/technician.js
// Technician-specific views: UPS maintenance report form + manager report viewer.
import { state, supabaseClient, crmDebugLog, loadPersistedState as _loadPersistedState, saveViewState } from '../state.js';
import { viewContainer } from '../ui/dom.js';
import { showToast, escapeHtml, getInitials, handleImageError } from '../ui/toast.js';
import { renderSkeletonCards, renderError } from '../utils/helpers.js';

// ════════════════════════════════════════════════════════════════
// HELPER — format date
// ════════════════════════════════════════════════════════════════
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
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
// TECHNICIAN LOG VISIT VIEW — Landing with UPS Visit button
// ════════════════════════════════════════════════════════════════
async function renderTechnicianLogVisitView() {
  viewContainer.innerHTML = `
    <div class="page-header" style="text-align:center; padding-top:24px;">
      <h1 class="page-title">Service Reports</h1>
      <p class="text-muted" style="margin-bottom:24px;">Select a report type to begin</p>
    </div>

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
  `;

  document.getElementById('ups-visit-card').addEventListener('click', () => {
    renderUPSVisitForm();
  });

  if (window.lucide) lucide.createIcons();
}

// ════════════════════════════════════════════════════════════════
// UPS VISIT FORM — 7-step multi-step mobile-first form
// ════════════════════════════════════════════════════════════════

function renderUPSVisitForm() {
  document.body.classList.add('ups-form-active');

  const techName = `${state.currentUser.first_name || ''} ${state.currentUser.last_name || ''}`.trim() || state.currentUser.email;

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
            <div class="ups-field">
              <label class="ups-field-label">Total UPS Runtime <span class="ups-field-unit">(hours)</span></label>
              <input type="number" class="ups-input" id="ups-runtime" placeholder="0" inputmode="decimal" autocomplete="off">
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Technician Name</label>
              <input type="text" class="ups-input" id="ups-tech-name" value="${escapeHtml(techName)}" readonly disabled>
            </div>
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

  initUPSFormLogic(techName);
}

// ════════════════════════════════════════════════════════════════
// UPS FORM LOGIC — Navigation, validation, toggles, submission
// ════════════════════════════════════════════════════════════════

function initUPSFormLogic(techName) {
  let currentStep = 0;
  const totalSteps = 7;
  const track = document.getElementById('ups-steps-track');
  const progressFill = document.getElementById('ups-progress-fill');
  const stepText = document.getElementById('ups-step-text');
  const sectionName = document.getElementById('ups-section-name');
  const btnBack = document.getElementById('ups-btn-back');
  const btnNext = document.getElementById('ups-btn-next');

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
    } else {
      btnNext.textContent = 'Next →';
      btnNext.className = 'ups-nav-btn ups-nav-btn-primary';
    }

    // Scroll to top of the step viewport
    const viewport = document.querySelector('.ups-steps-viewport');
    if (viewport) viewport.scrollTop = 0;
  }

  // ── Validate current step ──
  function validateStep(step) {
    let valid = true;
    const stepEl = document.querySelector(`.ups-step[data-step="${step}"]`);
    if (!stepEl) return true;

    // Check required text inputs
    stepEl.querySelectorAll('.ups-input[data-required="true"]').forEach(input => {
      if (!input.value.trim()) {
        input.classList.add('ups-input-error');
        const errEl = input.parentElement.querySelector('.ups-error-message');
        if (errEl) errEl.textContent = 'This field is required';
        valid = false;
      }
    });

    // Check required toggle groups
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
      const data = {
        technician_id: state.currentUser.id,
        organization_id: state.currentOrganization?.id,
        // Step 1
        site_client_name: document.getElementById('ups-site-name').value.trim(),
        location_building: document.getElementById('ups-location').value.trim() || null,
        ups_brand: document.getElementById('ups-brand').value.trim() || null,
        ups_serial_number: document.getElementById('ups-serial').value.trim() || null,
        ups_model: document.getElementById('ups-model').value.trim() || null,
        total_ups_runtime: parseFloat(document.getElementById('ups-runtime').value) || null,
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
        notes_remarks: document.getElementById('ups-notes').value.trim() || null
      };

      const { data: result, error } = await supabaseClient
        .from('ups_maintenance_reports')
        .insert([data])
        .select('id')
        .single();

      if (error) throw error;

      showToast('UPS Report Submitted!', 'success');
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
  viewContainer.innerHTML = `<div class="page-header"><h1 class="page-title">My UPS Reports</h1></div><div id="ups-activity-list"></div>`;

  const { data: reports, error } = await supabaseClient
    .from('ups_maintenance_reports')
    .select('id, site_client_name, overall_system_status, created_at')
    .eq('technician_id', state.currentUser.id)
    .order('created_at', { ascending: false })
    .limit(50);

  const container = document.getElementById('ups-activity-list');

  if (error) {
    container.innerHTML = renderError(error.message);
    return;
  }

  if (!reports || reports.length === 0) {
    container.innerHTML = `
      <div class="card">
        <div class="empty-state">
          <h3 class="empty-state-title">No UPS reports yet</h3>
          <p class="empty-state-description">Start logging UPS visits to see them here.</p>
          <button class="btn btn-primary" onclick="loadView('technician-log-visit')">
            <i data-lucide="plus"></i> Log Your First UPS Visit
          </button>
        </div>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  container.innerHTML = `
    <div class="ups-reports-table-wrap">
      <table class="ups-reports-table">
        <thead>
          <tr>
            <th>Report ID</th>
            <th>Site / Client</th>
            <th>Status</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          ${reports.map(r => `
            <tr>
              <td class="ups-report-id-cell">${r.id.substring(0, 8)}…</td>
              <td>${escapeHtml(r.site_client_name || '—')}</td>
              <td>
                <span class="ups-status-badge ${r.overall_system_status === 'Pass' ? 'ups-status-badge-pass' : 'ups-status-badge-fail'}">
                  ${r.overall_system_status || '—'}
                </span>
              </td>
              <td>${formatDate(r.created_at)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ════════════════════════════════════════════════════════════════
// MANAGER VIEW — TECHNICIANS DASHBOARD
// ════════════════════════════════════════════════════════════════

async function renderTechniciansDashboardView() {
  viewContainer.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">UPS Maintenance Reports</h1>
      <p class="text-muted">View and manage all UPS service reports</p>
    </div>

    <div class="ups-reports-section" id="ups-reports-section">
      <div class="ups-reports-header">
        <h3 class="ups-reports-title">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>
          All Reports
        </h3>
        <input type="text" class="ups-reports-search" id="ups-reports-search" placeholder="Search by Report ID…" autocomplete="off">
      </div>

      <div id="ups-reports-container">
        <div class="ups-reports-empty">Loading reports…</div>
      </div>
    </div>
  `;

  // Fetch reports
  let query = supabaseClient
    .from('ups_maintenance_reports')
    .select('id, site_client_name, technician_name, overall_system_status, created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  if (state.currentOrganization?.id) {
    query = query.eq('organization_id', state.currentOrganization.id);
  }

  const { data: reports, error } = await query;

  if (error) {
    document.getElementById('ups-reports-container').innerHTML = renderError(error.message);
    return;
  }

  const allReports = reports || [];
  renderReportsTable(allReports, allReports);

  // Search filter
  const searchInput = document.getElementById('ups-reports-search');
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) {
      renderReportsTable(allReports, allReports);
      return;
    }
    const filtered = allReports.filter(r => r.id.toLowerCase().includes(q));
    renderReportsTable(filtered, allReports);
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
            <th>Report ID</th>
            <th>Site / Client</th>
            <th>Technician</th>
            <th>Date</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${reports.map(r => `
            <tr onclick="window._viewUPSReport('${r.id}')">
              <td class="ups-report-id-cell">${r.id.substring(0, 8)}…</td>
              <td>${escapeHtml(r.site_client_name || '—')}</td>
              <td>${escapeHtml(r.technician_name || '—')}</td>
              <td>${formatDate(r.created_at)}</td>
              <td>
                <span class="ups-status-badge ${r.overall_system_status === 'Pass' ? 'ups-status-badge-pass' : 'ups-status-badge-fail'}">
                  ${r.overall_system_status || '—'}
                </span>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ════════════════════════════════════════════════════════════════
// REPORT DETAIL VIEW (Manager)
// ════════════════════════════════════════════════════════════════

window._viewUPSReport = async function (reportId) {
  const container = document.getElementById('ups-reports-container');
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

  const boolLabel = (v) => v === true ? 'Yes' : v === false ? 'No' : '—';
  const valOrDash = (v) => (v !== null && v !== undefined && v !== '') ? escapeHtml(String(v)) : '—';

  container.innerHTML = `
    <div class="ups-report-detail" id="ups-report-print-target">
      <div class="ups-report-detail-header">
        <div>
          <h3>UPS Report — ${escapeHtml(r.site_client_name || 'Unknown')}</h3>
          <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">ID: ${r.id} • ${formatDate(r.created_at)}</div>
        </div>
        <div class="ups-report-detail-actions">
          <button class="btn btn-secondary btn-sm" onclick="window._backToReportsList()">
            ← Back
          </button>
          <button class="btn btn-primary btn-sm" onclick="window._downloadUPSPDF('${r.id}')">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Download PDF
          </button>
        </div>
      </div>
      <div class="ups-report-detail-body">

        <!-- Site Info -->
        <div class="ups-report-section">
          <div class="ups-report-section-title">Site Information</div>
          <div class="ups-report-fields">
            <div class="ups-report-field"><span class="ups-report-field-label">Site / Client Name</span><span class="ups-report-field-value">${valOrDash(r.site_client_name)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Location</span><span class="ups-report-field-value">${valOrDash(r.location_building)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">UPS Brand</span><span class="ups-report-field-value">${valOrDash(r.ups_brand)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">UPS Serial Number</span><span class="ups-report-field-value">${valOrDash(r.ups_serial_number)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">UPS Model</span><span class="ups-report-field-value">${valOrDash(r.ups_model)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Total Runtime (hrs)</span><span class="ups-report-field-value">${valOrDash(r.total_ups_runtime)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Technician</span><span class="ups-report-field-value">${valOrDash(r.technician_name)}</span></div>
          </div>
        </div>

        <!-- Environmental -->
        <div class="ups-report-section">
          <div class="ups-report-section-title">Environmental Conditions</div>
          <div class="ups-report-fields">
            <div class="ups-report-field"><span class="ups-report-field-label">Room Temperature</span><span class="ups-report-field-value">${valOrDash(r.ambient_room_temperature)} °C</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Humidity Level</span><span class="ups-report-field-value">${valOrDash(r.humidity_level)} %</span></div>
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
          </div>
        </div>

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
  const siteName = (r.site_client_name || 'Unknown').replace(/[^a-zA-Z0-9]/g, '_');
  const dateStr = new Date(r.created_at).toISOString().split('T')[0];

  // Create print container
  const printDiv = document.createElement('div');
  printDiv.className = 'ups-print-target';
  printDiv.innerHTML = `
    <div class="ups-print-header">
      <h1>Sangyug Enterprises Ltd</h1>
      <p>UPS Maintenance Service Report</p>
      <p style="margin-top:4px;">Report ID: ${r.id} • Date: ${formatDate(r.created_at)}</p>
    </div>

    <div class="ups-print-section">
      <h3>Site Information</h3>
      <div class="ups-print-grid">
        <div class="ups-print-field"><span class="ups-print-field-label">Site / Client:</span><span class="ups-print-field-value">${valOrDash(r.site_client_name)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Location:</span><span class="ups-print-field-value">${valOrDash(r.location_building)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">UPS Brand:</span><span class="ups-print-field-value">${valOrDash(r.ups_brand)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Serial Number:</span><span class="ups-print-field-value">${valOrDash(r.ups_serial_number)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Model:</span><span class="ups-print-field-value">${valOrDash(r.ups_model)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Runtime (hrs):</span><span class="ups-print-field-value">${valOrDash(r.total_ups_runtime)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Technician:</span><span class="ups-print-field-value">${valOrDash(r.technician_name)}</span></div>
      </div>
    </div>

    <div class="ups-print-section">
      <h3>Environmental Conditions</h3>
      <div class="ups-print-grid">
        <div class="ups-print-field"><span class="ups-print-field-label">Room Temp:</span><span class="ups-print-field-value">${valOrDash(r.ambient_room_temperature)} °C</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Humidity:</span><span class="ups-print-field-value">${valOrDash(r.humidity_level)} %</span></div>
      </div>
    </div>

    <div class="ups-print-section">
      <h3>UPS / Inverter Parameters</h3>
      <div class="ups-print-grid">
        <div class="ups-print-field"><span class="ups-print-field-label">Operating Mode:</span><span class="ups-print-field-value">${valOrDash(r.operating_mode)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Rectifier DC:</span><span class="ups-print-field-value">${valOrDash(r.rectifier_dc_output_voltage)} VDC</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Inverter Freq:</span><span class="ups-print-field-value">${valOrDash(r.inverter_output_frequency)} Hz</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Load %:</span><span class="ups-print-field-value">${valOrDash(r.load_percentage)} %</span></div>
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
      </div>
    </div>

    <div class="ups-print-section">
      <h3>Checks & Maintenance</h3>
      <div class="ups-print-grid">
        <div class="ups-print-field"><span class="ups-print-field-label">Manual Bypass:</span><span class="ups-print-field-value">${valOrDash(r.transfer_manual_bypass)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Load Transfer:</span><span class="ups-print-field-value">${valOrDash(r.load_transfer_test)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Fan Check:</span><span class="ups-print-field-value">${valOrDash(r.cooling_fan_check)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Alarm Cleared:</span><span class="ups-print-field-value">${valOrDash(r.error_alarm_log_cleared)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Interior Clean:</span><span class="ups-print-field-value">${valOrDash(r.unit_interior_cleaned)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Wiring Inspected:</span><span class="ups-print-field-value">${valOrDash(r.internal_wiring_inspected)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Firmware:</span><span class="ups-print-field-value">${valOrDash(r.firmware_version)}</span></div>
      </div>
    </div>

    <div class="ups-print-section">
      <h3>Conclusion</h3>
      <div class="ups-print-grid">
        <div class="ups-print-field"><span class="ups-print-field-label">Overall Status:</span><span class="ups-print-field-value" style="font-weight:800;">${valOrDash(r.overall_system_status)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Client Engineer:</span><span class="ups-print-field-value">${valOrDash(r.client_engineer_name)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Servicing Engineer:</span><span class="ups-print-field-value">${valOrDash(r.servicing_engineer_name)}</span></div>
        ${r.notes_remarks ? `<div class="ups-print-field" style="grid-column:1/-1;"><span class="ups-print-field-label">Notes:</span><span class="ups-print-field-value">${valOrDash(r.notes_remarks)}</span></div>` : ''}
      </div>
    </div>

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

// ── Exports ────────────────────────────────────────────────────
export {
  renderTechnicianLogVisitView,
  renderTechnicianActivityView,
  renderTechniciansDashboardView,
};
