import { state, supabaseClient } from '../state.js';
import { viewContainer } from '../ui/dom.js';
import { showToast, escapeHtml } from '../ui/toast.js';
import { renderError } from '../utils/helpers.js';

window.SOLAR_STEP_NAMES = [
  'Customer & Site Info',
  'Load & Power Requirements',
  'Solar Panel Details',
  'Site & Installation Conditions',
  'Cable, Mounting & Hardware'
];

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

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function stepPhotoHTML(stepIndex) {
  return `
    <div class="ups-section-divider"></div>
    <div class="ups-field">
      <label class="ups-field-label">Photo — ${window.SOLAR_STEP_NAMES[stepIndex]}</label>
      <div class="ups-photo-upload-wrap ups-step-photo-wrap">
        <input type="file" class="ups-photo-input ups-step-photo-input" id="solar-step-photo-${stepIndex}" accept="image/*" data-step="${stepIndex}">
        <div class="ups-photo-preview-box ups-step-photo-box" id="solar-step-photo-box-${stepIndex}">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          <span style="font-size:13px; font-weight:500;">Tap to take photo</span>
        </div>
        <img class="ups-photo-preview-img ups-step-photo-preview" id="solar-step-photo-preview-${stepIndex}" src="">
      </div>
    </div>
  `;
}

window.renderSolarSurveyForm = function(existingData = null, lat = null, lng = null) {
  document.body.classList.add('ups-form-active');

  const techProfile = state.currentUserProfile || {};
  let techName = 'Unknown Technician';
  if (state.currentUser) {
    techName = `${techProfile.first_name || state.currentUser.user_metadata?.first_name || ''} ${techProfile.last_name || state.currentUser.user_metadata?.last_name || ''}`.trim() || state.currentUser.email;
  }

  viewContainer.innerHTML = `
    <div class="ups-form-container">
      <div class="ups-progress-bar">
        <div class="ups-progress-label">
          <span class="ups-progress-step-text" id="solar-step-text">Step 1 of 5</span>
          <span class="ups-progress-section-name" id="solar-section-name">${window.SOLAR_STEP_NAMES[0]}</span>
        </div>
        <div class="ups-progress-track">
          <div class="ups-progress-fill" id="solar-progress-fill" style="width: 20%"></div>
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

      <div class="ups-steps-viewport">
        <div class="ups-steps-track" id="solar-steps-track">

          <!-- STEP 1: Customer & Site Info -->
          <div class="ups-step" data-step="0">
            <h2 class="ups-step-title">Customer & Site Info</h2>
            <p class="ups-step-subtitle">Basic details about the site</p>

            <div class="ups-field">
              <label class="ups-field-label">Company / Organization Name <span class="ups-required">*</span></label>
              <input type="text" class="ups-input" id="sol-company-name" autocomplete="off" required>
              <span class="ups-error-message"></span>
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Customer Name</label>
              <input type="text" class="ups-input" id="sol-customer-name" autocomplete="off">
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Phone Contact (WhatsApp pref.)</label>
              <input type="text" class="ups-input" id="sol-phone" inputmode="tel" autocomplete="off">
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Email</label>
              <input type="email" class="ups-input" id="sol-email" inputmode="email" autocomplete="off">
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Location</label>
              <input type="text" class="ups-input" id="sol-location" autocomplete="off">
            </div>

            <div class="ups-field">
              <label class="ups-field-label">Survey Done By</label>
              <input type="text" class="ups-input" id="sol-survey-by" value="${escapeHtml(techName)}" readonly disabled>
            </div>
            ${stepPhotoHTML(0)}
          </div>

          <!-- STEP 2: Load & Power Requirements -->
          <div class="ups-step" data-step="1">
            <h2 class="ups-step-title">Load & Power Requirements</h2>
            <p class="ups-step-subtitle">Calculate needs and capacity</p>

            <div class="ups-field">
              <label class="ups-field-label">Equipment / Products to be Used on Inverter</label>
              <textarea class="ups-input" id="sol-equipment" rows="3" autocomplete="off"></textarea>
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Max Load to be Backed Up <span class="ups-field-unit">(Watts)</span></label>
              <input type="number" class="ups-input" id="sol-max-load" inputmode="decimal" autocomplete="off">
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Inverter Size Required <span class="ups-field-unit">(No. of Rooms / Houses)</span></label>
              <input type="number" class="ups-input" id="sol-inverter-size" inputmode="decimal" autocomplete="off">
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Backup Time Required</label>
              <div style="display: flex; gap: 8px;">
                <div style="flex: 1;">
                  <label style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px; display: block;">Hours</label>
                  <input type="number" class="ups-input" id="sol-backup-hours" placeholder="0" inputmode="numeric" min="0">
                </div>
                <div style="flex: 1;">
                  <label style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px; display: block;">Minutes</label>
                  <input type="number" class="ups-input" id="sol-backup-minutes" placeholder="0" inputmode="numeric" min="0" max="59">
                </div>
              </div>
            </div>
            <div class="ups-field-row">
              <div class="ups-field">
                <label class="ups-field-label">Number of Batteries</label>
                <input type="number" class="ups-input" id="sol-num-batteries" inputmode="decimal">
              </div>
              <div class="ups-field">
                <label class="ups-field-label">Battery Capacity <span class="ups-field-unit">(Ah)</span></label>
                <input type="number" class="ups-input" id="sol-batt-cap" inputmode="decimal">
              </div>
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Type of Battery Required</label>
              <div class="ups-toggle-group" id="sol-batt-type">
                <button type="button" class="ups-toggle-btn toggle-normal" data-value="Lithium">Lithium</button>
                <button type="button" class="ups-toggle-btn toggle-normal" data-value="MF">MF</button>
                <button type="button" class="ups-toggle-btn toggle-normal" data-value="Tubular">Tubular</button>
              </div>
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Priority Mode</label>
              <div class="ups-toggle-group" id="sol-priority">
                <button type="button" class="ups-toggle-btn toggle-normal" data-value="Solar (S)">Solar (S)</button>
                <button type="button" class="ups-toggle-btn toggle-normal" data-value="Battery (B)">Battery (B)</button>
                <button type="button" class="ups-toggle-btn toggle-normal" data-value="Utility (U)">Utility (U)</button>
              </div>
            </div>
            ${stepPhotoHTML(1)}
          </div>

          <!-- STEP 3: Solar Panel Details -->
          <div class="ups-step" data-step="2">
            <h2 class="ups-step-title">Solar Panel Details</h2>
            <p class="ups-step-subtitle">Panel arrays and ratings</p>

            <div class="ups-field">
              <label class="ups-field-label">Number of Solar Panels</label>
              <input type="number" class="ups-input" id="sol-num-panels" inputmode="decimal">
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Solar Panel Size <span class="ups-field-unit">(Voc / Isc)</span></label>
              <input type="text" class="ups-input" id="sol-panel-size" autocomplete="off">
            </div>
            <div class="ups-field-row">
              <div class="ups-field">
                <label class="ups-field-label">Panels Per Side/String</label>
                <input type="number" class="ups-input" id="sol-panels-per-string" inputmode="decimal">
              </div>
              <div class="ups-field">
                <label class="ups-field-label">Solar Strings Needed</label>
                <input type="number" class="ups-input" id="sol-strings-needed" inputmode="decimal">
              </div>
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Inverter MPPT Range</label>
              <input type="text" class="ups-input" id="sol-mppt-range" placeholder="e.g. 120VDC–500VDC" autocomplete="off">
            </div>
            <div class="ups-field-row">
              <div class="ups-field">
                <label class="ups-field-label">Solar Array Voc Min <span class="ups-field-unit">(VDC)</span></label>
                <input type="number" class="ups-input" id="sol-voc-min" inputmode="decimal">
              </div>
              <div class="ups-field">
                <label class="ups-field-label">Solar Array Voc Max <span class="ups-field-unit">(VDC)</span></label>
                <input type="number" class="ups-input" id="sol-voc-max" inputmode="decimal">
              </div>
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Solar Combiner Box Needed</label>
              <div class="ups-toggle-group" id="sol-combiner">
                <button type="button" class="ups-toggle-btn toggle-yes" data-value="true">Yes</button>
                <button type="button" class="ups-toggle-btn toggle-no" data-value="false">No</button>
              </div>
            </div>
            <div class="ups-field">
              <label class="ups-field-label">MC4 Pairs Needed <span class="ups-field-unit">(Male & Female)</span></label>
              <input type="number" class="ups-input" id="sol-mc4-pairs" inputmode="decimal">
            </div>
            ${stepPhotoHTML(2)}
          </div>

          <!-- STEP 4: Site & Installation Conditions -->
          <div class="ups-step" data-step="3">
            <h2 class="ups-step-title">Site & Installation Conditions</h2>
            <p class="ups-step-subtitle">Building details and logistics</p>

            <div class="ups-field">
              <label class="ups-field-label">Type of House / Building</label>
              <input type="text" class="ups-input" id="sol-bldg-type" placeholder="e.g. Godown, Ground Floor" autocomplete="off">
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Type of Roof</label>
              <div class="ups-toggle-group" id="sol-roof-type">
                <button type="button" class="ups-toggle-btn toggle-normal" data-value="Iron Sheets">Iron Sheets</button>
                <button type="button" class="ups-toggle-btn toggle-normal" data-value="Tiles">Tiles</button>
              </div>
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Transparent Light Sheets Present</label>
              <div class="ups-toggle-group" id="sol-trans-sheets">
                <button type="button" class="ups-toggle-btn toggle-yes" data-value="true">Yes</button>
                <button type="button" class="ups-toggle-btn toggle-no" data-value="false">No</button>
              </div>
            </div>
            <div class="ups-field">
              <label class="ups-field-label">If Yes, Quantity & Spacing <span class="text-muted">(Optional)</span></label>
              <input type="text" class="ups-input" id="sol-trans-details" autocomplete="off">
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Height of Roof from Ground <span class="ups-field-unit">(Meters)</span></label>
              <input type="number" class="ups-input" id="sol-roof-height" inputmode="decimal">
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Wi-Fi Availability</label>
              <div class="ups-toggle-group" id="sol-wifi">
                <button type="button" class="ups-toggle-btn toggle-yes" data-value="true">Yes</button>
                <button type="button" class="ups-toggle-btn toggle-no" data-value="false">No</button>
              </div>
            </div>
            <div class="ups-field-row">
              <div class="ups-field">
                <label class="ups-field-label">No. of Technicians Required</label>
                <input type="number" class="ups-input" id="sol-techs-req" inputmode="decimal">
              </div>
              <div class="ups-field">
                <label class="ups-field-label">Working Days to Install</label>
                <input type="number" class="ups-input" id="sol-days-req" inputmode="decimal">
              </div>
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Most Challenging Area <span class="text-muted">(Optional)</span></label>
              <textarea class="ups-input" id="sol-challenge" rows="2"></textarea>
            </div>
            ${stepPhotoHTML(3)}
          </div>

          <!-- STEP 5: Cable, Mounting & Hardware -->
          <div class="ups-step" data-step="4">
            <h2 class="ups-step-title">Cable, Mounting & Hardware</h2>
            <p class="ups-step-subtitle">Cabling and accessory quantities</p>

            <div class="ups-field">
              <label class="ups-field-label">Battery Cable Length & Size</label>
              <input type="text" class="ups-input" id="sol-batt-cable" autocomplete="off">
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Distance from Inverter to CU <span class="ups-field-unit">(Meters)</span></label>
              <input type="number" class="ups-input" id="sol-dist-cu" inputmode="decimal">
            </div>
            <div class="ups-field">
              <label class="ups-field-label">AC Cable Size</label>
              <div class="ups-toggle-group" id="sol-ac-cable-sz">
                <button type="button" class="ups-toggle-btn toggle-normal" data-value="2.5mm">2.5mm</button>
                <button type="button" class="ups-toggle-btn toggle-normal" data-value="4.0mm">4.0mm</button>
                <button type="button" class="ups-toggle-btn toggle-normal" data-value="6.0mm">6.0mm</button>
              </div>
            </div>
            <div class="ups-field">
              <label class="ups-field-label">AC Cable Length <span class="ups-field-unit">(Meters)</span></label>
              <input type="number" class="ups-input" id="sol-ac-cable-len" inputmode="decimal">
            </div>
            <div class="ups-field">
              <label class="ups-field-label">DC Cable Length for Solar <span class="ups-field-unit">(Meters)</span></label>
              <input type="number" class="ups-input" id="sol-dc-cable-len" inputmode="decimal">
            </div>
            <div class="ups-field">
              <label class="ups-field-label">DC Cable Size</label>
              <div class="ups-toggle-group" id="sol-dc-cable-sz">
                <button type="button" class="ups-toggle-btn toggle-normal" data-value="4mm">4mm</button>
                <button type="button" class="ups-toggle-btn toggle-normal" data-value="6mm">6mm</button>
              </div>
            </div>
            
            <div class="ups-section-divider"></div>
            
            <div class="ups-field">
              <label class="ups-field-label">Number of Trunkings & Size</label>
              <input type="text" class="ups-input" id="sol-trunkings" autocomplete="off">
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Number of Conduits & Size</label>
              <input type="text" class="ups-input" id="sol-conduits" autocomplete="off">
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Flexible Conduit <span class="ups-field-unit">(Meters)</span></label>
              <input type="number" class="ups-input" id="sol-flex-conduit" inputmode="decimal">
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Silicon Tubes Required</label>
              <input type="number" class="ups-input" id="sol-silicon" inputmode="decimal">
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Rope Required</label>
              <div class="ups-toggle-group" id="sol-rope">
                <button type="button" class="ups-toggle-btn toggle-yes" data-value="true">Yes</button>
                <button type="button" class="ups-toggle-btn toggle-no" data-value="false">No</button>
              </div>
            </div>
            
            <div class="ups-section-divider"></div>

            <div class="ups-field-row">
              <div class="ups-field">
                <label class="ups-field-label">End Clamps</label>
                <input type="number" class="ups-input" id="sol-end-clamps" inputmode="decimal">
              </div>
              <div class="ups-field">
                <label class="ups-field-label">Mid Clamps</label>
                <input type="number" class="ups-input" id="sol-mid-clamps" inputmode="decimal">
              </div>
              <div class="ups-field">
                <label class="ups-field-label">Center Clamps</label>
                <input type="number" class="ups-input" id="sol-center-clamps" inputmode="decimal">
              </div>
            </div>
            <div class="ups-field-row">
              <div class="ups-field">
                <label class="ups-field-label">Rails (Mounting)</label>
                <input type="number" class="ups-input" id="sol-rails" inputmode="decimal">
              </div>
              <div class="ups-field">
                <label class="ups-field-label">L/Tile Hooks</label>
                <input type="number" class="ups-input" id="sol-hooks" inputmode="decimal">
              </div>
            </div>

            <div class="ups-field">
              <label class="ups-field-label">Splicing Kit for Solar</label>
              <div class="ups-toggle-group" id="sol-splicing">
                <button type="button" class="ups-toggle-btn toggle-yes" data-value="true">Yes</button>
                <button type="button" class="ups-toggle-btn toggle-no" data-value="false">No</button>
              </div>
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Climbing Tools Required (Scaffolding/Ladder)</label>
              <textarea class="ups-input" id="sol-climbing" rows="2"></textarea>
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Where to Place / Mount the Inverter</label>
              <input type="text" class="ups-input" id="sol-inv-mount" autocomplete="off">
            </div>
            <div class="ups-field">
              <label class="ups-field-label">AVS & Changeover Mount Location</label>
              <div class="ups-toggle-group" id="sol-avs-mount">
                <button type="button" class="ups-toggle-btn toggle-normal" data-value="Cabinet">Cabinet</button>
                <button type="button" class="ups-toggle-btn toggle-normal" data-value="Shelf">Shelf</button>
                <button type="button" class="ups-toggle-btn toggle-normal" data-value="Wall Mount">Wall</button>
              </div>
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Solar MCB & Enclosure</label>
              <div class="ups-toggle-group" id="sol-mcb">
                <button type="button" class="ups-toggle-btn toggle-yes" data-value="true">Yes</button>
                <button type="button" class="ups-toggle-btn toggle-no" data-value="false">No</button>
              </div>
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Additional Comments / Observations <span class="text-muted">(Optional)</span></label>
              <textarea class="ups-input" id="sol-comments" rows="3"></textarea>
            </div>
            ${stepPhotoHTML(4)}

            <div class="ups-section-divider"></div>
            
            <div class="ups-field">
              <label class="ups-field-label">Technician Signature</label>
              <div class="ups-signature-wrap">
                <button type="button" class="ups-signature-clear" id="sol-sig-clear">Clear</button>
                <canvas class="ups-signature-canvas" id="sol-sig-canvas"></canvas>
              </div>
            </div>
            <div class="ups-field">
              <label class="ups-field-label">Client Signature</label>
              <div class="ups-signature-wrap">
                <button type="button" class="ups-signature-clear" id="sol-client-sig-clear">Clear</button>
                <canvas class="ups-signature-canvas" id="sol-client-sig-canvas"></canvas>
              </div>
            </div>

          </div>

        </div>
      </div>

      <div class="ups-nav-footer" id="solar-nav-footer">
        <button class="ups-nav-btn" id="solar-btn-back" style="display:none;">← Back</button>
        <button class="ups-nav-btn ups-nav-btn-primary" id="solar-btn-next">Next →</button>
      </div>
    </div>
  `;

  window._initSolarFormLogic(techName, existingData, lat, lng);
};

window._initSolarFormLogic = function(techName, existingData, lat, lng) {
  let currentStep = 0;
  const totalSteps = 5;
  const track = document.getElementById('solar-steps-track');
  const progressFill = document.getElementById('solar-progress-fill');
  const stepText = document.getElementById('solar-step-text');
  const sectionName = document.getElementById('solar-section-name');
  const btnBack = document.getElementById('solar-btn-back');
  const btnNext = document.getElementById('solar-btn-next');

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

    setVal('sol-company-name', existingData.company_organization_name);
    setVal('sol-customer-name', existingData.customer_name);
    setVal('sol-phone', existingData.phone_contact);
    setVal('sol-email', existingData.email);
    setVal('sol-location', existingData.location);
    
    setVal('sol-equipment', existingData.equipment_products_used);
    setVal('sol-max-load', existingData.max_load_backed_up);
    setVal('sol-inverter-size', existingData.inverter_size_required);
    setVal('sol-backup-hours', existingData.backup_time_hours);
    setVal('sol-backup-minutes', existingData.backup_time_minutes);
    setVal('sol-num-batteries', existingData.number_of_batteries);
    setVal('sol-batt-cap', existingData.battery_capacity_ah);
    if (existingData.type_of_battery_required) setToggle('sol-batt-type', existingData.type_of_battery_required);
    if (existingData.priority_mode) setToggle('sol-priority', existingData.priority_mode);

    setVal('sol-num-panels', existingData.number_of_solar_panels);
    setVal('sol-panel-size', existingData.solar_panel_size_voc_isc);
    setVal('sol-panels-per-string', existingData.panels_per_side_string);
    setVal('sol-strings-needed', existingData.solar_strings_needed);
    setVal('sol-mppt-range', existingData.inverter_mppt_range);
    setVal('sol-voc-min', existingData.solar_array_voc_min);
    setVal('sol-voc-max', existingData.solar_array_voc_max);
    if (existingData.solar_combiner_box_needed !== null) setToggle('sol-combiner', String(existingData.solar_combiner_box_needed));
    setVal('sol-mc4-pairs', existingData.mc4_pairs_needed);

    setVal('sol-bldg-type', existingData.type_of_house_building);
    if (existingData.type_of_roof) setToggle('sol-roof-type', existingData.type_of_roof);
    if (existingData.transparent_light_sheets_present !== null) setToggle('sol-trans-sheets', String(existingData.transparent_light_sheets_present));
    setVal('sol-trans-details', existingData.transparent_light_sheets_details);
    setVal('sol-roof-height', existingData.height_of_roof_from_ground_m);
    if (existingData.wifi_availability !== null) setToggle('sol-wifi', String(existingData.wifi_availability));
    setVal('sol-techs-req', existingData.number_of_technicians_required);
    setVal('sol-days-req', existingData.number_of_working_days_to_install);
    setVal('sol-challenge', existingData.most_challenging_area);

    setVal('sol-batt-cable', existingData.battery_cable_length_size);
    setVal('sol-dist-cu', existingData.distance_from_inverter_to_cu_m);
    if (existingData.ac_cable_size) setToggle('sol-ac-cable-sz', existingData.ac_cable_size);
    setVal('sol-ac-cable-len', existingData.ac_cable_length_m);
    setVal('sol-dc-cable-len', existingData.dc_cable_length_solar_m);
    if (existingData.dc_cable_size) setToggle('sol-dc-cable-sz', existingData.dc_cable_size);
    setVal('sol-trunkings', existingData.number_of_trunkings_size);
    setVal('sol-conduits', existingData.number_of_conduits_size);
    setVal('sol-flex-conduit', existingData.flexible_conduit_m);
    setVal('sol-silicon', existingData.silicon_tubes_required);
    if (existingData.rope_required !== null) setToggle('sol-rope', String(existingData.rope_required));
    setVal('sol-end-clamps', existingData.end_clamps_solar);
    setVal('sol-mid-clamps', existingData.mid_clamps_solar);
    setVal('sol-center-clamps', existingData.center_clamps_solar);
    setVal('sol-rails', existingData.rails_for_solar_mounting);
    setVal('sol-hooks', existingData.l_hooks_or_tile_hooks);
    if (existingData.splicing_kit_for_solar !== null) setToggle('sol-splicing', String(existingData.splicing_kit_for_solar));
    setVal('sol-climbing', existingData.climbing_tools_required);
    setVal('sol-inv-mount', existingData.where_to_place_mount_inverter);
    if (existingData.avs_changeover_mount_location) setToggle('sol-avs-mount', existingData.avs_changeover_mount_location);
    if (existingData.solar_mcb_enclosure !== null) setToggle('sol-mcb', String(existingData.solar_mcb_enclosure));
    setVal('sol-comments', existingData.additional_comments);
  }

  // Toggles
  document.querySelectorAll('.ups-toggle-group').forEach(group => {
    group.querySelectorAll('.ups-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        group.querySelectorAll('.ups-toggle-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        group.classList.remove('ups-input-error');
        const errEl = group.parentElement.querySelector('.ups-error-message');
        if (errEl) errEl.textContent = '';
      });
    });
  });

  // Inputs
  document.querySelectorAll('.ups-input').forEach(input => {
    input.addEventListener('focus', () => {
      input.classList.remove('ups-input-error');
      const errEl = input.parentElement.querySelector('.ups-error-message');
      if (errEl) errEl.textContent = '';
    });
  });

  function goToStep(step) {
    currentStep = step;
    track.style.transform = `translateX(-${step * 100}%)`;
    progressFill.style.width = `${((step + 1) / totalSteps) * 100}%`;
    stepText.textContent = `Step ${step + 1} of ${totalSteps}`;
    sectionName.textContent = window.SOLAR_STEP_NAMES[step];

    btnBack.style.display = step === 0 ? 'none' : 'flex';

    if (step === totalSteps - 1) {
      btnNext.textContent = '✓ Submit Survey';
      btnNext.className = 'ups-nav-btn ups-nav-btn-submit';
      setTimeout(resizeCanvas, 10);
    } else {
      btnNext.textContent = 'Next →';
      btnNext.className = 'ups-nav-btn ups-nav-btn-primary';
    }

    const viewport = document.querySelector('.ups-steps-viewport');
    if (viewport) viewport.scrollTop = 0;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const mainContent = document.querySelector('.main-content');
    if (mainContent) mainContent.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Signature Pads
  function setupSignature(canvasId, clearBtnId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return { hasSignature: false };
    const ctx = canvas.getContext('2d');
    const stateObj = { hasSignature: false, canvas };
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

    const startDraw = (e) => { e.preventDefault(); isDrawing = true; stateObj.hasSignature = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
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
      stateObj.hasSignature = false;
    });

    return { stateObj, resize };
  }

  const techSig = setupSignature('sol-sig-canvas', 'sol-sig-clear');
  const clientSig = setupSignature('sol-client-sig-canvas', 'sol-client-sig-clear');

  function resizeCanvas() {
    if (techSig.resize) techSig.resize();
    if (clientSig.resize) clientSig.resize();
  }
  window.addEventListener('resize', resizeCanvas);

  // Per-Step Photo Preview
  const selectedStepPhotos = {};

  document.querySelectorAll('.ups-step-photo-input').forEach(input => {
    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      const stepIdx = input.dataset.step;
      if (file) {
        selectedStepPhotos[stepIdx] = file;
        const reader = new FileReader();
        reader.onload = (re) => {
          const preview = document.getElementById(`solar-step-photo-preview-${stepIdx}`);
          const box = document.getElementById(`solar-step-photo-box-${stepIdx}`);
          if (preview) { preview.src = re.target.result; preview.style.display = 'block'; }
          if (box) box.style.display = 'none';
        };
        reader.readAsDataURL(file);
      }
    });
  });

  if (existingData && existingData.step_photos && typeof existingData.step_photos === 'object') {
    for (const [stepIdx, photoPath] of Object.entries(existingData.step_photos)) {
      if (!photoPath) continue;
      const { data: urlData } = supabaseClient.storage.from('safitrack').getPublicUrl(photoPath);
      const url = urlData?.publicUrl;
      if (url) {
        const preview = document.getElementById(`solar-step-photo-preview-${stepIdx}`);
        const box = document.getElementById(`solar-step-photo-box-${stepIdx}`);
        if (preview) { preview.src = url; preview.style.display = 'block'; }
        if (box) box.style.display = 'none';
      }
    }
  }

  function validateStep(step) {
    let valid = true;
    const stepEl = document.querySelector(`.ups-step[data-step="${step}"]`);
    if (!stepEl) return true;

    stepEl.querySelectorAll('.ups-input').forEach(i => i.classList.remove('ups-input-error'));
    stepEl.querySelectorAll('.ups-error-message').forEach(m => m.textContent = '');

    stepEl.querySelectorAll('.ups-input[required]').forEach(input => {
      if (!input.value.trim()) {
        input.classList.add('ups-input-error');
        const errEl = input.parentElement.querySelector('.ups-error-message');
        if (errEl) errEl.textContent = 'This field is required';
        valid = false;
      }
    });

    return valid;
  }

  function getToggleValue(id) {
    const group = document.getElementById(id);
    if (!group) return null;
    const selected = group.querySelector('.ups-toggle-btn.selected');
    return selected ? selected.dataset.value : null;
  }

  async function submitReport() {
    btnNext.disabled = true;
    btnNext.innerHTML = '<span style="display:inline-flex;align-items:center;gap:6px;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="animate-spin"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> Submitting...</span>';

    try {
      const stepPhotos = existingData?.step_photos ? { ...existingData.step_photos } : {};
      const stepEntries = Object.entries(selectedStepPhotos);
      for (const [stepIdx, file] of stepEntries) {
        try {
          const compressed = await compressImage(file, 1200, 0.7);
          const ext = compressed.name.split('.').pop() || 'jpg';
          const fileName = `solar_${Date.now()}_s${stepIdx}_${Math.random().toString(36).substring(2)}.${ext}`;
          const filePath = `technician-photos/${fileName}`;

          const { error: uploadError } = await supabaseClient.storage
            .from('safitrack')
            .upload(filePath, compressed, { cacheControl: '3600', upsert: false });

          if (uploadError) throw uploadError;
          stepPhotos[stepIdx] = filePath;
        } catch (err) {
          console.error(`Photo upload failed for step ${stepIdx}`, err);
        }
      }

      let signatureData = existingData ? existingData.signature_data : null;
      if (techSig.stateObj.hasSignature) {
        signatureData = techSig.stateObj.canvas.toDataURL('image/png');
      }
      let clientSignatureData = existingData ? existingData.client_signature_data : null;
      if (clientSig.stateObj.hasSignature) {
        clientSignatureData = clientSig.stateObj.canvas.toDataURL('image/png');
      }

      const data = {
        technician_id: state.currentUser?.id,
        organization_id: state.currentOrganization?.id,
        latitude: lat,
        longitude: lng,

        company_organization_name: document.getElementById('sol-company-name').value.trim(),
        customer_name: document.getElementById('sol-customer-name').value.trim() || null,
        phone_contact: document.getElementById('sol-phone').value.trim() || null,
        email: document.getElementById('sol-email').value.trim() || null,
        location: document.getElementById('sol-location').value.trim() || null,
        survey_done_by: techName,

        equipment_products_used: document.getElementById('sol-equipment').value.trim() || null,
        max_load_backed_up: parseFloat(document.getElementById('sol-max-load').value) || null,
        inverter_size_required: parseFloat(document.getElementById('sol-inverter-size').value) || null,
        backup_time_hours: parseFloat(document.getElementById('sol-backup-hours').value) || null,
        backup_time_minutes: parseFloat(document.getElementById('sol-backup-minutes').value) || null,
        number_of_batteries: parseFloat(document.getElementById('sol-num-batteries').value) || null,
        battery_capacity_ah: parseFloat(document.getElementById('sol-batt-cap').value) || null,
        type_of_battery_required: getToggleValue('sol-batt-type'),
        priority_mode: getToggleValue('sol-priority'),

        number_of_solar_panels: parseFloat(document.getElementById('sol-num-panels').value) || null,
        solar_panel_size_voc_isc: document.getElementById('sol-panel-size').value.trim() || null,
        panels_per_side_string: parseFloat(document.getElementById('sol-panels-per-string').value) || null,
        solar_strings_needed: parseFloat(document.getElementById('sol-strings-needed').value) || null,
        inverter_mppt_range: document.getElementById('sol-mppt-range').value.trim() || null,
        solar_array_voc_min: parseFloat(document.getElementById('sol-voc-min').value) || null,
        solar_array_voc_max: parseFloat(document.getElementById('sol-voc-max').value) || null,
        solar_combiner_box_needed: getToggleValue('sol-combiner') === 'true' ? true : getToggleValue('sol-combiner') === 'false' ? false : null,
        mc4_pairs_needed: parseFloat(document.getElementById('sol-mc4-pairs').value) || null,

        type_of_house_building: document.getElementById('sol-bldg-type').value.trim() || null,
        type_of_roof: getToggleValue('sol-roof-type'),
        transparent_light_sheets_present: getToggleValue('sol-trans-sheets') === 'true' ? true : getToggleValue('sol-trans-sheets') === 'false' ? false : null,
        transparent_light_sheets_details: document.getElementById('sol-trans-details').value.trim() || null,
        height_of_roof_from_ground_m: parseFloat(document.getElementById('sol-roof-height').value) || null,
        wifi_availability: getToggleValue('sol-wifi') === 'true' ? true : getToggleValue('sol-wifi') === 'false' ? false : null,
        number_of_technicians_required: parseFloat(document.getElementById('sol-techs-req').value) || null,
        number_of_working_days_to_install: parseFloat(document.getElementById('sol-days-req').value) || null,
        most_challenging_area: document.getElementById('sol-challenge').value.trim() || null,

        battery_cable_length_size: document.getElementById('sol-batt-cable').value.trim() || null,
        distance_from_inverter_to_cu_m: parseFloat(document.getElementById('sol-dist-cu').value) || null,
        ac_cable_size: getToggleValue('sol-ac-cable-sz'),
        ac_cable_length_m: parseFloat(document.getElementById('sol-ac-cable-len').value) || null,
        dc_cable_length_solar_m: parseFloat(document.getElementById('sol-dc-cable-len').value) || null,
        dc_cable_size: getToggleValue('sol-dc-cable-sz'),
        number_of_trunkings_size: document.getElementById('sol-trunkings').value.trim() || null,
        number_of_conduits_size: document.getElementById('sol-conduits').value.trim() || null,
        flexible_conduit_m: parseFloat(document.getElementById('sol-flex-conduit').value) || null,
        silicon_tubes_required: parseFloat(document.getElementById('sol-silicon').value) || null,
        rope_required: getToggleValue('sol-rope') === 'true' ? true : getToggleValue('sol-rope') === 'false' ? false : null,
        end_clamps_solar: parseFloat(document.getElementById('sol-end-clamps').value) || null,
        mid_clamps_solar: parseFloat(document.getElementById('sol-mid-clamps').value) || null,
        center_clamps_solar: parseFloat(document.getElementById('sol-center-clamps').value) || null,
        rails_for_solar_mounting: parseFloat(document.getElementById('sol-rails').value) || null,
        l_hooks_or_tile_hooks: parseFloat(document.getElementById('sol-hooks').value) || null,
        splicing_kit_for_solar: getToggleValue('sol-splicing') === 'true' ? true : getToggleValue('sol-splicing') === 'false' ? false : null,
        climbing_tools_required: document.getElementById('sol-climbing').value.trim() || null,
        where_to_place_mount_inverter: document.getElementById('sol-inv-mount').value.trim() || null,
        avs_changeover_mount_location: getToggleValue('sol-avs-mount'),
        solar_mcb_enclosure: getToggleValue('sol-mcb') === 'true' ? true : getToggleValue('sol-mcb') === 'false' ? false : null,
        additional_comments: document.getElementById('sol-comments').value.trim() || null,

        step_photos: stepPhotos,
        signature_data: signatureData,
        client_signature_data: clientSignatureData
      };

      let result;
      if (existingData) {
        data.manager_approval_status = 'Pending';
        const { data: updateRes, error } = await supabaseClient
          .from('solar_inverter_surveys')
          .update(data)
          .eq('id', existingData.id)
          .select('id')
          .single();
        if (error) throw error;
        result = updateRes;
      } else {
        const { data: insertRes, error } = await supabaseClient
          .from('solar_inverter_surveys')
          .insert([data])
          .select('id')
          .single();
        if (error) throw error;
        result = insertRes;
      }

      showToast(existingData ? 'Solar Survey Resubmitted!' : 'Solar Survey Submitted!', 'success');
      
      // Reuse success screen
      document.body.classList.remove('ups-form-active');
      viewContainer.innerHTML = `
        <div class="ups-success-screen">
          <div class="ups-success-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 6 9 17l-5-5"/>
            </svg>
          </div>
          <h2 class="ups-success-title">Survey Submitted!</h2>
          <p class="ups-success-subtitle">Your Solar Inverter Survey has been saved successfully.</p>
          <div class="ups-success-report-id">Report ID: ${result.id}</div>
          <button class="ups-success-btn" id="solar-new-report-btn">Start New Report</button>
        </div>
      `;
      document.getElementById('solar-new-report-btn').addEventListener('click', () => {
        window.renderTechnicianLogVisitView();
      });

    } catch (e) {
      console.error('Solar report submit error:', e);
      showToast('Submission failed: ' + e.message, 'error');
      btnNext.disabled = false;
      btnNext.textContent = '✓ Submit Survey';
      btnNext.className = 'ups-nav-btn ups-nav-btn-submit';
    }
  }

  btnNext.addEventListener('click', () => {
    if (currentStep === totalSteps - 1) {
      if (validateStep(currentStep)) submitReport();
    } else {
      if (validateStep(currentStep)) goToStep(currentStep + 1);
    }
  });

  btnBack.addEventListener('click', () => {
    if (currentStep > 0) goToStep(currentStep - 1);
  });
};

window._viewSolarReport = async function(reportId, isTechnician = false) {
  const containerId = isTechnician ? 'ups-activity-list' : 'ups-reports-container';
  const container = document.getElementById(containerId);
  container.innerHTML = `<div class="ups-reports-empty">Loading report…</div>`;

  const { data: r, error } = await supabaseClient
    .from('solar_inverter_surveys')
    .select('*')
    .eq('id', reportId)
    .single();

  if (error || !r) {
    container.innerHTML = renderError(error?.message || 'Report not found');
    return;
  }

  function getStepPhotoUrl(rData, stepIdx) {
    if (rData.step_photos && typeof rData.step_photos === 'object' && rData.step_photos[stepIdx]) {
      const { data } = supabaseClient.storage.from('safitrack').getPublicUrl(rData.step_photos[stepIdx]);
      return data?.publicUrl || null;
    }
    return null;
  }

  function mgrStepPhoto(stepIdx) {
    const url = getStepPhotoUrl(r, stepIdx);
    if (!url) return '';
    return `
      <div class="ups-report-field" style="grid-column: 1 / -1; margin-top: 12px;">
        <span class="ups-report-field-label" style="margin-bottom:8px;">Photo — ${window.SOLAR_STEP_NAMES[stepIdx]}</span>
        <img src="${url}" class="ups-report-photo-thumb" onclick="window.open(this.src, '_blank')">
      </div>
    `;
  }

  const boolLabel = (v) => v === true ? 'Yes' : v === false ? 'No' : '—';
  const valOrDash = (v) => (v !== null && v !== undefined && v !== '') ? escapeHtml(String(v)) : '—';

  container.innerHTML = `
    <div class="ups-report-detail" id="solar-report-print-target">
      <div class="ups-report-detail-header">
        <div>
          <div style="display:flex; align-items:center; gap:12px;">
            <h3 style="margin:0;">Solar Survey — ${escapeHtml(r.company_organization_name || 'Unknown')}</h3>
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
          <button class="btn btn-primary btn-sm" onclick="window._downloadSolarPDF('${r.id}')">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Download PDF
          </button>
        </div>
      </div>
      <div class="ups-report-detail-body">
        ${(r.latitude && r.longitude) ? `
        <div style="margin-bottom:16px; font-size:13px; color:var(--text-secondary); background:var(--bg-secondary); padding:8px 12px; border-radius:6px; display:inline-flex; align-items:center; gap:8px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
          Location Logged: ${r.latitude}, ${r.longitude}
        </div>
        ` : ''}

        <div class="ups-report-section">
          <div class="ups-report-section-title">Customer & Site Info</div>
          <div class="ups-report-fields">
            <div class="ups-report-field"><span class="ups-report-field-label">Company</span><span class="ups-report-field-value">${valOrDash(r.company_organization_name)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Customer</span><span class="ups-report-field-value">${valOrDash(r.customer_name)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Phone</span><span class="ups-report-field-value">${valOrDash(r.phone_contact)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Email</span><span class="ups-report-field-value">${valOrDash(r.email)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Location</span><span class="ups-report-field-value">${valOrDash(r.location)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Survey By</span><span class="ups-report-field-value">${valOrDash(r.survey_done_by)}</span></div>
            ${mgrStepPhoto(0)}
          </div>
        </div>

        <div class="ups-report-section">
          <div class="ups-report-section-title">Load & Power Requirements</div>
          <div class="ups-report-fields">
            <div class="ups-report-field" style="grid-column:1/-1;"><span class="ups-report-field-label">Equipment</span><span class="ups-report-field-value">${valOrDash(r.equipment_products_used)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Max Load</span><span class="ups-report-field-value">${valOrDash(r.max_load_backed_up)} W</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Inverter Size</span><span class="ups-report-field-value">${valOrDash(r.inverter_size_required)} Rooms</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Backup Time</span><span class="ups-report-field-value">${valOrDash(r.backup_time_hours)}h ${valOrDash(r.backup_time_minutes)}m</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Batteries</span><span class="ups-report-field-value">${valOrDash(r.number_of_batteries)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Capacity</span><span class="ups-report-field-value">${valOrDash(r.battery_capacity_ah)} Ah</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Battery Type</span><span class="ups-report-field-value">${valOrDash(r.type_of_battery_required)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Priority Mode</span><span class="ups-report-field-value">${valOrDash(r.priority_mode)}</span></div>
            ${mgrStepPhoto(1)}
          </div>
        </div>

        <div class="ups-report-section">
          <div class="ups-report-section-title">Solar Panel Details</div>
          <div class="ups-report-fields">
            <div class="ups-report-field"><span class="ups-report-field-label">Panels</span><span class="ups-report-field-value">${valOrDash(r.number_of_solar_panels)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Size (Voc/Isc)</span><span class="ups-report-field-value">${valOrDash(r.solar_panel_size_voc_isc)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Panels/String</span><span class="ups-report-field-value">${valOrDash(r.panels_per_side_string)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Strings Needed</span><span class="ups-report-field-value">${valOrDash(r.solar_strings_needed)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">MPPT Range</span><span class="ups-report-field-value">${valOrDash(r.inverter_mppt_range)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Voc Min</span><span class="ups-report-field-value">${valOrDash(r.solar_array_voc_min)} VDC</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Voc Max</span><span class="ups-report-field-value">${valOrDash(r.solar_array_voc_max)} VDC</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Combiner Box</span><span class="ups-report-field-value">${boolLabel(r.solar_combiner_box_needed)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">MC4 Pairs</span><span class="ups-report-field-value">${valOrDash(r.mc4_pairs_needed)}</span></div>
            ${mgrStepPhoto(2)}
          </div>
        </div>

        <div class="ups-report-section">
          <div class="ups-report-section-title">Site & Installation Conditions</div>
          <div class="ups-report-fields">
            <div class="ups-report-field"><span class="ups-report-field-label">Building Type</span><span class="ups-report-field-value">${valOrDash(r.type_of_house_building)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Roof Type</span><span class="ups-report-field-value">${valOrDash(r.type_of_roof)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Light Sheets</span><span class="ups-report-field-value">${boolLabel(r.transparent_light_sheets_present)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Sheet Details</span><span class="ups-report-field-value">${valOrDash(r.transparent_light_sheets_details)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Roof Height</span><span class="ups-report-field-value">${valOrDash(r.height_of_roof_from_ground_m)} m</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Wi-Fi</span><span class="ups-report-field-value">${boolLabel(r.wifi_availability)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Techs Req</span><span class="ups-report-field-value">${valOrDash(r.number_of_technicians_required)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Days to Install</span><span class="ups-report-field-value">${valOrDash(r.number_of_working_days_to_install)}</span></div>
            <div class="ups-report-field" style="grid-column:1/-1;"><span class="ups-report-field-label">Challenging Area</span><span class="ups-report-field-value">${valOrDash(r.most_challenging_area)}</span></div>
            ${mgrStepPhoto(3)}
          </div>
        </div>

        <div class="ups-report-section">
          <div class="ups-report-section-title">Cable, Mounting & Hardware</div>
          <div class="ups-report-fields">
            <div class="ups-report-field"><span class="ups-report-field-label">Batt Cable</span><span class="ups-report-field-value">${valOrDash(r.battery_cable_length_size)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Dist to CU</span><span class="ups-report-field-value">${valOrDash(r.distance_from_inverter_to_cu_m)} m</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">AC Cable Size</span><span class="ups-report-field-value">${valOrDash(r.ac_cable_size)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">AC Len</span><span class="ups-report-field-value">${valOrDash(r.ac_cable_length_m)} m</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">DC Len</span><span class="ups-report-field-value">${valOrDash(r.dc_cable_length_solar_m)} m</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">DC Size</span><span class="ups-report-field-value">${valOrDash(r.dc_cable_size)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Trunkings</span><span class="ups-report-field-value">${valOrDash(r.number_of_trunkings_size)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Conduits</span><span class="ups-report-field-value">${valOrDash(r.number_of_conduits_size)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Flex Conduit</span><span class="ups-report-field-value">${valOrDash(r.flexible_conduit_m)} m</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Silicon Tubes</span><span class="ups-report-field-value">${valOrDash(r.silicon_tubes_required)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Rope</span><span class="ups-report-field-value">${boolLabel(r.rope_required)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">End Clamps</span><span class="ups-report-field-value">${valOrDash(r.end_clamps_solar)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Mid Clamps</span><span class="ups-report-field-value">${valOrDash(r.mid_clamps_solar)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Center Clamps</span><span class="ups-report-field-value">${valOrDash(r.center_clamps_solar)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Rails</span><span class="ups-report-field-value">${valOrDash(r.rails_for_solar_mounting)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">L/Tile Hooks</span><span class="ups-report-field-value">${valOrDash(r.l_hooks_or_tile_hooks)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Splicing Kit</span><span class="ups-report-field-value">${boolLabel(r.splicing_kit_for_solar)}</span></div>
            <div class="ups-report-field" style="grid-column:1/-1;"><span class="ups-report-field-label">Climbing Tools</span><span class="ups-report-field-value">${valOrDash(r.climbing_tools_required)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Inv Mount</span><span class="ups-report-field-value">${valOrDash(r.where_to_place_mount_inverter)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">AVS Mount</span><span class="ups-report-field-value">${valOrDash(r.avs_changeover_mount_location)}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Solar MCB</span><span class="ups-report-field-value">${boolLabel(r.solar_mcb_enclosure)}</span></div>
            ${r.additional_comments ? `<div class="ups-report-field" style="grid-column:1/-1;"><span class="ups-report-field-label">Comments</span><span class="ups-report-field-value" style="white-space:pre-wrap;">${escapeHtml(r.additional_comments)}</span></div>` : ''}
            ${mgrStepPhoto(4)}
          </div>
        </div>

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

  window._currentSolarReport = r;
};

window._downloadSolarPDF = function(reportId) {
  const r = window._currentSolarReport;
  if (!r) return showToast('Report data not available', 'error');

  const boolLabel = (v) => v === true ? 'Yes' : v === false ? 'No' : '—';
  const valOrDash = (v) => (v !== null && v !== undefined && v !== '') ? String(v) : '—';
  const companyName = (r.company_organization_name || 'Unknown').replace(/[^a-zA-Z0-9]/g, '_');
  const dateStr = new Date(r.created_at).toISOString().split('T')[0];

  function getStepPhotoUrlLocal(rData, stepIdx) {
    if (rData.step_photos && typeof rData.step_photos === 'object' && rData.step_photos[stepIdx]) {
      const { data } = supabaseClient.storage.from('safitrack').getPublicUrl(rData.step_photos[stepIdx]);
      return data?.publicUrl || null;
    }
    return null;
  }

  function pdfStepPhoto(stepIdx) {
    const url = getStepPhotoUrlLocal(r, stepIdx);
    if (!url) return '';
    return `
      <div style="margin-top:8px; grid-column:1/-1;">
        <div style="color:#666; font-weight:500; font-size:11px; margin-bottom:4px;">📷 Photo — ${window.SOLAR_STEP_NAMES[stepIdx]}:</div>
        <img src="${url}" style="max-width:200px; max-height:200px; border:1px solid #ccc; border-radius:4px;">
      </div>
    `;
  }

  const printDiv = document.createElement('div');
  printDiv.className = 'ups-print-target';
  printDiv.innerHTML = `
    <div class="ups-print-header">
      <h1 style="margin-bottom:8px;">Sangyug Enterprises Limited</h1>
      <p style="margin:4px 0;">www.sangyug.com</p>
      <p style="margin:4px 0;">Email : servicecentre@sangyug.com, info@sangyug.com</p>
      <p style="margin:4px 0;">Phone : 0743 767960 | 0715 177456</p>
      <p style="margin-top:12px; font-weight:600;">Solar Inverter Survey</p>
      <p style="margin-top:4px;">Report ID: ${r.id} • Date: ${formatDate(r.created_at)}</p>
      ${(r.latitude && r.longitude) ? `<p style="margin-top:4px; font-size:11px; color:#555;">Location: ${r.latitude}, ${r.longitude}</p>` : ''}
    </div>

    <div class="ups-print-section">
      <h3>Customer & Site Info</h3>
      <div class="ups-print-grid">
        <div class="ups-print-field"><span class="ups-print-field-label">Company:</span><span class="ups-print-field-value">${valOrDash(r.company_organization_name)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Customer:</span><span class="ups-print-field-value">${valOrDash(r.customer_name)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Phone:</span><span class="ups-print-field-value">${valOrDash(r.phone_contact)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Email:</span><span class="ups-print-field-value">${valOrDash(r.email)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Location:</span><span class="ups-print-field-value">${valOrDash(r.location)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Survey By:</span><span class="ups-print-field-value">${valOrDash(r.survey_done_by)}</span></div>
        ${pdfStepPhoto(0)}
      </div>
    </div>

    <div class="ups-print-section">
      <h3>Load & Power Requirements</h3>
      <div class="ups-print-grid">
        <div class="ups-print-field" style="grid-column:1/-1;"><span class="ups-print-field-label">Equipment:</span><span class="ups-print-field-value">${valOrDash(r.equipment_products_used)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Max Load:</span><span class="ups-print-field-value">${valOrDash(r.max_load_backed_up)} W</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Inverter Size:</span><span class="ups-print-field-value">${valOrDash(r.inverter_size_required)} Rooms</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Backup:</span><span class="ups-print-field-value">${valOrDash(r.backup_time_hours)}h ${valOrDash(r.backup_time_minutes)}m</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Batteries:</span><span class="ups-print-field-value">${valOrDash(r.number_of_batteries)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Capacity:</span><span class="ups-print-field-value">${valOrDash(r.battery_capacity_ah)} Ah</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Batt Type:</span><span class="ups-print-field-value">${valOrDash(r.type_of_battery_required)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Priority:</span><span class="ups-print-field-value">${valOrDash(r.priority_mode)}</span></div>
        ${pdfStepPhoto(1)}
      </div>
    </div>

    <div class="ups-print-section">
      <h3>Solar Panel Details</h3>
      <div class="ups-print-grid">
        <div class="ups-print-field"><span class="ups-print-field-label">Panels:</span><span class="ups-print-field-value">${valOrDash(r.number_of_solar_panels)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Size:</span><span class="ups-print-field-value">${valOrDash(r.solar_panel_size_voc_isc)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Panels/String:</span><span class="ups-print-field-value">${valOrDash(r.panels_per_side_string)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Strings:</span><span class="ups-print-field-value">${valOrDash(r.solar_strings_needed)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">MPPT Range:</span><span class="ups-print-field-value">${valOrDash(r.inverter_mppt_range)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Voc Min:</span><span class="ups-print-field-value">${valOrDash(r.solar_array_voc_min)} VDC</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Voc Max:</span><span class="ups-print-field-value">${valOrDash(r.solar_array_voc_max)} VDC</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Combiner:</span><span class="ups-print-field-value">${boolLabel(r.solar_combiner_box_needed)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">MC4 Pairs:</span><span class="ups-print-field-value">${valOrDash(r.mc4_pairs_needed)}</span></div>
        ${pdfStepPhoto(2)}
      </div>
    </div>

    <div class="ups-print-section">
      <h3>Site & Installation Conditions</h3>
      <div class="ups-print-grid">
        <div class="ups-print-field"><span class="ups-print-field-label">Building Type:</span><span class="ups-print-field-value">${valOrDash(r.type_of_house_building)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Roof Type:</span><span class="ups-print-field-value">${valOrDash(r.type_of_roof)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Light Sheets:</span><span class="ups-print-field-value">${boolLabel(r.transparent_light_sheets_present)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Sheet Detail:</span><span class="ups-print-field-value">${valOrDash(r.transparent_light_sheets_details)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Roof Height:</span><span class="ups-print-field-value">${valOrDash(r.height_of_roof_from_ground_m)} m</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Wi-Fi:</span><span class="ups-print-field-value">${boolLabel(r.wifi_availability)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Techs Req:</span><span class="ups-print-field-value">${valOrDash(r.number_of_technicians_required)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Install Days:</span><span class="ups-print-field-value">${valOrDash(r.number_of_working_days_to_install)}</span></div>
        <div class="ups-print-field" style="grid-column:1/-1;"><span class="ups-print-field-label">Challenge:</span><span class="ups-print-field-value">${valOrDash(r.most_challenging_area)}</span></div>
        ${pdfStepPhoto(3)}
      </div>
    </div>

    <div class="ups-print-section">
      <h3>Cable, Mounting & Hardware</h3>
      <div class="ups-print-grid">
        <div class="ups-print-field"><span class="ups-print-field-label">Batt Cable:</span><span class="ups-print-field-value">${valOrDash(r.battery_cable_length_size)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Dist to CU:</span><span class="ups-print-field-value">${valOrDash(r.distance_from_inverter_to_cu_m)} m</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">AC Cable Size:</span><span class="ups-print-field-value">${valOrDash(r.ac_cable_size)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">AC Len:</span><span class="ups-print-field-value">${valOrDash(r.ac_cable_length_m)} m</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">DC Len:</span><span class="ups-print-field-value">${valOrDash(r.dc_cable_length_solar_m)} m</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">DC Size:</span><span class="ups-print-field-value">${valOrDash(r.dc_cable_size)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Trunkings:</span><span class="ups-print-field-value">${valOrDash(r.number_of_trunkings_size)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Conduits:</span><span class="ups-print-field-value">${valOrDash(r.number_of_conduits_size)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Flex Conduit:</span><span class="ups-print-field-value">${valOrDash(r.flexible_conduit_m)} m</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Silicon Tubes:</span><span class="ups-print-field-value">${valOrDash(r.silicon_tubes_required)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Rope:</span><span class="ups-print-field-value">${boolLabel(r.rope_required)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">End Clamps:</span><span class="ups-print-field-value">${valOrDash(r.end_clamps_solar)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Mid Clamps:</span><span class="ups-print-field-value">${valOrDash(r.mid_clamps_solar)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Center Clamps:</span><span class="ups-print-field-value">${valOrDash(r.center_clamps_solar)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Rails:</span><span class="ups-print-field-value">${valOrDash(r.rails_for_solar_mounting)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">L/Tile Hooks:</span><span class="ups-print-field-value">${valOrDash(r.l_hooks_or_tile_hooks)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Splicing Kit:</span><span class="ups-print-field-value">${boolLabel(r.splicing_kit_for_solar)}</span></div>
        <div class="ups-print-field" style="grid-column:1/-1;"><span class="ups-print-field-label">Climbing Tools:</span><span class="ups-print-field-value">${valOrDash(r.climbing_tools_required)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Inv Mount:</span><span class="ups-print-field-value">${valOrDash(r.where_to_place_mount_inverter)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">AVS Mount:</span><span class="ups-print-field-value">${valOrDash(r.avs_changeover_mount_location)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Solar MCB:</span><span class="ups-print-field-value">${boolLabel(r.solar_mcb_enclosure)}</span></div>
        ${r.additional_comments ? `<div class="ups-print-field" style="grid-column:1/-1;"><span class="ups-print-field-label">Comments:</span><span class="ups-print-field-value">${valOrDash(r.additional_comments)}</span></div>` : ''}
        ${pdfStepPhoto(4)}
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
  document.title = `Solar_Survey_${companyName}_${dateStr}`;

  setTimeout(() => {
    window.print();
    setTimeout(() => {
      document.body.classList.remove('ups-print-mode');
      printDiv.remove();
      document.title = origTitle;
    }, 500);
  }, 100);
};
