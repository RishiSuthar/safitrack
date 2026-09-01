// modules/features/technician.js
// Technician-specific views: UPS maintenance report form + manager report viewer.
import { state, supabaseClient, crmDebugLog, loadPersistedState as _loadPersistedState, saveViewState } from '../state.js';
import { viewContainer } from '../ui/dom.js';
import { showToast, escapeHtml, getInitials, handleImageError } from '../ui/toast.js';
import { renderSkeletonCards, renderError } from '../utils/helpers.js';
import { getPdfHeader } from './forms.js';
import './solar-technician.js';

// ── Submissions pagination state ──────────────────────────────────────────────
const SUBS_PAGE_SIZE = 20;
let _submissionsPage = 1;
let _submissionsFiltered = [];

const _chevL = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>`;
const _chevR = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`;

function _pgHTML(current, total, size) {
  if (total <= size) return '';
  const totalPages = Math.ceil(total / size);
  const from = (current - 1) * size + 1;
  const to = Math.min(current * size, total);

  const visible = new Set([1, totalPages]);
  for (let i = Math.max(1, current - 2); i <= Math.min(totalPages, current + 2); i++) visible.add(i);
  const pages = [...visible].sort((a, b) => a - b);

  let btns = '';
  for (let i = 0; i < pages.length; i++) {
    if (i > 0 && pages[i] - pages[i - 1] > 1) btns += `<span class="pagination-ellipsis">...</span>`;
    btns += `<button class="pagination-btn${pages[i] === current ? ' active' : ''}" data-pg="${pages[i]}">${pages[i]}</button>`;
  }

  return `<div class="pagination-container">
    <div class="pagination-info">Showing ${from} to ${to} of ${total} records</div>
    <div class="pagination-controls">
      <button class="pagination-btn${current === 1 ? ' disabled' : ''}" data-pg="${current - 1}">${_chevL} Previous</button>
      ${btns}
      <button class="pagination-btn${current === totalPages ? ' disabled' : ''}" data-pg="${current + 1}">Next ${_chevR}</button>
    </div>
  </div>`;
}

// Waits for all imgs in a container to finish loading (or error/timeout) before revealing
async function _awaitImages(container) {
  const imgs = [...container.querySelectorAll('img[src]')].filter(i => i.src && !i.complete);
  if (!imgs.length) return;
  const settle = imgs.map(img => new Promise(res => {
    img.addEventListener('load', res, { once: true });
    img.addEventListener('error', res, { once: true });
  }));
  await Promise.race([Promise.all(settle), new Promise(res => setTimeout(res, 6000))]);
}

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
    <div style="padding: 28px 20px 12px; max-width: 560px; margin: 0 auto;">
      <h1 style="font-size: 1.4rem; font-weight: 800; margin: 0 0 4px 0; color: var(--text-primary);">Log a Visit</h1>
      <p style="font-size: 0.85rem; color: var(--text-muted); margin: 0 0 24px 0;">Choose a form to fill out for this service visit.</p>
      <div id="custom-forms-section">
        <div style="text-align:center; padding: 48px 0; color: var(--text-muted); font-size: 0.85rem;">Loading forms…</div>
      </div>
    </div>
  `;

  // Load active custom forms for this org and render cards
  if (state.currentOrganization?.id) {
    try {
      const { data: customForms } = await supabaseClient
        .from('custom_forms')
        .select('id, name, description, fields')
        .eq('organization_id', state.currentOrganization.id)
        .eq('is_active', true)
        .order('name');

      const section = document.getElementById('custom-forms-section');
      if (section) {
        if (customForms && customForms.length > 0) {
          // Count total fields across all sections for each form
          const fieldCount = (f) => {
            const fields = f.fields || [];
            if (fields.length > 0 && Array.isArray(fields[0]?.fields)) {
              return fields.reduce((sum, sec) => sum + (sec.fields?.length || 0), 0);
            }
            return fields.length;
          };

          section.innerHTML = `<div style="display:flex; flex-direction:column; gap:10px;">` +
            customForms.map(f => `
              <div class="lv-form-card" data-custom-form-id="${f.id}" tabindex="0" role="button" aria-label="Start ${escapeHtml(f.name)}">
                <div class="lv-form-card-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                  </svg>
                </div>
                <div class="lv-form-card-body">
                  <div class="lv-form-card-name">${escapeHtml(f.name)}</div>
                  <div class="lv-form-card-meta">
                    ${f.description ? escapeHtml(f.description) : `${fieldCount(f)} field${fieldCount(f) !== 1 ? 's' : ''}`}
                  </div>
                </div>
                <svg class="lv-form-card-chevron" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
              </div>
            `).join('') +
          `</div>`;

          section.querySelectorAll('[data-custom-form-id]').forEach(card => {
            const form = customForms.find(f => f.id === card.dataset.customFormId);
            if (form) {
              card.addEventListener('click', () => renderCustomFormFillView(form));
              card.addEventListener('keypress', e => { if (e.key === 'Enter' || e.key === ' ') renderCustomFormFillView(form); });
            }
          });
        } else {
          section.innerHTML = `
            <div style="text-align:center; padding:48px 20px; color:var(--text-muted);">
              <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:12px; opacity:0.4;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <p style="font-size:0.9rem; font-weight:600; margin:0 0 4px 0;">No active forms</p>
              <p style="font-size:0.8rem; margin:0;">Ask your manager to create and activate a form.</p>
            </div>
          `;
        }
      }
    } catch (_e) { /* non-critical — custom forms are optional */ }
  }
}

// ════════════════════════════════════════════════════════════════
// CUSTOM FORM — fill view (technician)
// ════════════════════════════════════════════════════════════════
function _customFormFieldHtml(field) {
  const labelHtml = `<label class="ups-field-label">${escapeHtml(field.label)}${field.required ? ' <span class="ups-required">*</span>' : ''}</label>`;
  const fieldId = `cf-${field.id}`;
  switch (field.type) {
    case 'textarea':
      return `<div class="ups-field">${labelHtml}<textarea class="ups-input" id="${fieldId}" data-field-id="${field.id}" placeholder="${escapeHtml(field.placeholder || '')}" rows="3"${field.required ? ' data-required="true"' : ''}></textarea></div>`;
    case 'number':
      return `<div class="ups-field">${labelHtml}<input type="number" inputmode="decimal" class="ups-input" id="${fieldId}" data-field-id="${field.id}" placeholder="${escapeHtml(field.placeholder || '')}"${field.required ? ' data-required="true"' : ''}></div>`;
    case 'date':
      // Text input — custom calendar initialised after render in _renderCustomFormPage
      return `<div class="ups-field">${labelHtml}<input type="text" class="ups-input" id="${fieldId}" data-field-id="${field.id}" placeholder="Select date" readonly style="cursor:pointer;"${field.required ? ' data-required="true"' : ''}></div>`;
    case 'select':
      // CRM dropdown — initialised after render in _renderCustomFormPage
      return `
        <div class="ups-field">
          ${labelHtml}
          ${window.buildCrmDropdown
            ? window.buildCrmDropdown({
                id: fieldId,
                placeholder: '— select —',
                options: (field.options || []).map(opt => ({ value: opt, label: opt })),
                required: !!field.required,
                variant: 'form'
              })
            : `<select class="ups-input" id="${fieldId}"${field.required ? ' data-required="true"' : ''}><option value="">— select —</option>${(field.options || []).map(opt => `<option value="${escapeHtml(opt)}">${escapeHtml(opt)}</option>`).join('')}</select>`}
        </div>`;
    case 'selector':
      // UPS-style toggle buttons — toggle-opt gives them a CSS selected state
      return `
        <div class="ups-field">
          ${labelHtml}
          <div class="ups-toggle-group" id="cf-sel-${field.id}">
            ${(field.options || []).map(opt => `<button type="button" class="ups-toggle-btn toggle-opt" data-value="${escapeHtml(opt)}">${escapeHtml(opt)}</button>`).join('')}
          </div>
        </div>`;
    case 'group':
      // Render subfields under a group label (all field types supported)
      return `
        <div class="ups-field cf-group-field">
          ${labelHtml}
          <div class="cf-group-subfields">
            ${(field.subfields || []).map(sf => {
              const sfId = `cf-${field.id}-sf-${sf.id}`;
              const sfLabel = `<label class="ups-field-label cf-sf-label">${escapeHtml(sf.label)}${sf.required ? ' <span class="ups-required">*</span>' : ''}</label>`;
              switch (sf.type) {
                case 'textarea':
                  return `<div class="ups-field">${sfLabel}<textarea class="ups-input" id="${sfId}" placeholder="${escapeHtml(sf.placeholder || '')}" rows="2"${sf.required ? ' data-required="true"' : ''}></textarea></div>`;
                case 'number':
                  return `<div class="ups-field">${sfLabel}<input type="number" inputmode="decimal" class="ups-input" id="${sfId}" placeholder="${escapeHtml(sf.placeholder || '')}"${sf.required ? ' data-required="true"' : ''}></div>`;
                case 'date':
                  return `<div class="ups-field">${sfLabel}<input type="text" class="ups-input" id="${sfId}" placeholder="Select date" readonly style="cursor:pointer;"${sf.required ? ' data-required="true"' : ''}></div>`;
                case 'select':
                  return `<div class="ups-field">${sfLabel}${window.buildCrmDropdown
                    ? window.buildCrmDropdown({ id: sfId, placeholder: '\u2014 select \u2014', options: (sf.options||[]).map(o=>({value:o,label:o})), required: !!sf.required, variant:'form' })
                    : `<select class="ups-input" id="${sfId}"${sf.required?' data-required="true"':''}><option value="">\u2014 select \u2014</option>${(sf.options||[]).map(o=>`<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('')}</select>`}</div>`;
                case 'selector':
                  return `<div class="ups-field">${sfLabel}<div class="ups-toggle-group" id="cf-sel-${field.id}-sf-${sf.id}">${(sf.options||[]).map(o=>`<button type="button" class="ups-toggle-btn toggle-opt" data-value="${escapeHtml(o)}">${escapeHtml(o)}</button>`).join('')}</div></div>`;
                case 'photo':
                  return `<div class="ups-field">${sfLabel}<div class="ups-photo-upload-wrap ups-step-photo-wrap"><input type="file" class="ups-photo-input" id="cf-photo-${field.id}-sf-${sf.id}" accept="image/*"${sf.required?' data-required="true"':''}><div class="ups-photo-preview-box ups-step-photo-box" id="cf-photo-box-${field.id}-sf-${sf.id}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg><span style="font-size:13px; font-weight:500;">Tap to take photo</span></div><img class="ups-photo-preview-img ups-step-photo-preview" id="cf-photo-preview-${field.id}-sf-${sf.id}" src=""></div></div>`;
                case 'signature':
                  return `<div class="ups-field">${sfLabel}<div class="cf-signature-wrap" id="cf-sig-wrap-${field.id}-sf-${sf.id}"><canvas id="cf-canvas-${field.id}-sf-${sf.id}" class="cf-signature-canvas"${sf.required?' data-required="true"':''}></canvas><input type="hidden" id="cf-sig-${field.id}-sf-${sf.id}"><div class="cf-signature-footer"><span class="cf-signature-hint">Sign above</span><button type="button" class="btn btn-secondary btn-sm" onclick="(function(){const c=document.getElementById('cf-canvas-${field.id}-sf-${sf.id}');c.getContext('2d').clearRect(0,0,c.width,c.height);document.getElementById('cf-sig-${field.id}-sf-${sf.id}').value='';})();">Clear</button></div></div></div>`;
                default:
                  return `<div class="ups-field">${sfLabel}<input type="text" class="ups-input" id="${sfId}" placeholder="${escapeHtml(sf.placeholder || '')}"${sf.required ? ' data-required="true"' : ''}></div>`;
              }
            }).join('')}
          </div>
        </div>`;
    case 'photo': {
      const existingPath = _cfExistingPhotos[field.id];
      const existingUrl = existingPath
        ? (supabaseClient.storage.from('safitrack').getPublicUrl(existingPath).data?.publicUrl || '')
        : '';
      return `
        <div class="ups-field">
          ${labelHtml}
          <div class="ups-photo-upload-wrap ups-step-photo-wrap">
            <input type="file" class="ups-photo-input" id="cf-photo-${field.id}" accept="image/*" data-field-id="${field.id}"${field.required && !existingUrl ? ' data-required="true"' : ''}>
            <div class="ups-photo-preview-box ups-step-photo-box" id="cf-photo-box-${field.id}" style="${existingUrl ? 'display:none;' : ''}">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
              <span style="font-size:13px; font-weight:500;">Tap to take photo</span>
            </div>
            <img class="ups-photo-preview-img ups-step-photo-preview" id="cf-photo-preview-${field.id}" src="${existingUrl}" style="${existingUrl ? 'display:block;' : ''}">
            ${existingUrl ? `<button type="button" class="btn btn-secondary btn-sm" style="margin-top:6px; font-size:0.75rem;" onclick="document.getElementById('cf-photo-${field.id}').click()">Replace photo</button>` : ''}
          </div>
        </div>`; }

    case 'signature':
      return `
        <div class="ups-field">
          ${labelHtml}
          <div class="cf-signature-wrap" id="cf-sig-wrap-${field.id}">
            <canvas id="cf-canvas-${field.id}" class="cf-signature-canvas" data-field-id="${field.id}"${field.required ? ' data-required="true"' : ''}></canvas>
            <input type="hidden" id="cf-sig-${field.id}" data-field-id="${field.id}"${field.required ? ' data-required="true"' : ''}>
            <div class="cf-signature-footer">
              <span class="cf-signature-hint">Sign above</span>
              <button type="button" class="btn btn-secondary btn-sm" onclick="(function(){
                const c=document.getElementById('cf-canvas-${field.id}');
                c.getContext('2d').clearRect(0,0,c.width,c.height);
                document.getElementById('cf-sig-${field.id}').value='';
              })()">Clear</button>
            </div>
          </div>
        </div>`;
    default: // text
      return `<div class="ups-field">${labelHtml}<input type="text" class="ups-input" id="${fieldId}" data-field-id="${field.id}" placeholder="${escapeHtml(field.placeholder || '')}"${field.required ? ' data-required="true"' : ''}></div>`;
  }
}

// Normalize form.fields to sections format for fill view (handles legacy flat arrays)
function _normalizeSectionsForFill(fieldsData) {
  if (!fieldsData || fieldsData.length === 0) return [{ id: 's0', name: '', fields: [] }];
  if (fieldsData[0] && Array.isArray(fieldsData[0].fields)) return fieldsData;
  return [{ id: 's0', name: '', fields: fieldsData }];
}

// Accumulated data across pages — reset each time a form is opened
let _cfData = {};
let _cfPhotoFiles = {};
let _cfEditingSubmissionId = null;  // non-null when editing an existing submission
let _cfExistingPhotos = {};         // existing storage paths for photo fields

function renderCustomFormFillView(form, existingSubmission = null) {
  _cfEditingSubmissionId = existingSubmission?.id || null;
  _cfData = existingSubmission?.data ? { ...existingSubmission.data } : {};
  _cfPhotoFiles = {};
  _cfExistingPhotos = existingSubmission?.photos ? { ...existingSubmission.photos } : {};
  const sections = _normalizeSectionsForFill(form.fields || []);
  _renderCustomFormPage(form, sections, 0);
}

function _renderCustomFormPage(form, sections, pageIdx) {
  const totalPages = sections.length;
  const section = sections[pageIdx];
  const isMultiPage = totalPages > 1;
  const isLastPage = pageIdx === totalPages - 1;

  document.body.classList.add('ups-form-active');

  const progressLabel = isMultiPage
    ? `<span class="ups-progress-step-text">Step ${pageIdx + 1} of ${totalPages}</span>
       <span class="ups-progress-section-name">${section.name ? escapeHtml(section.name) : escapeHtml(form.name)}</span>`
    : `<span class="ups-progress-step-text">${escapeHtml(form.name)}</span>
       ${form.description ? `<span class="ups-progress-section-name" style="font-size:0.78rem;">${escapeHtml(form.description)}</span>` : ''}`;

  const progressBar = isMultiPage
    ? `<div class="ups-progress-track"><div class="ups-progress-fill" style="width:${((pageIdx + 1) / totalPages) * 100}%"></div></div>`
    : '';

  viewContainer.innerHTML = `
    <div class="ups-form-container">
      <div class="ups-progress-bar">
        <div class="ups-progress-label">${progressLabel}</div>
        ${progressBar}
      </div>

      <div class="ups-steps-viewport">
        <div style="padding:16px 16px 40px;">
          <div id="cf-fields-container">
            ${(section.fields || []).map(f => _customFormFieldHtml(f)).join('')}
          </div>

          <div style="display:flex; flex-direction:column; gap:8px; padding-top:24px;">
            ${isMultiPage && pageIdx > 0
              ? `<button class="btn btn-secondary btn-lg btn-block" id="cf-prev-btn">← Previous</button>` : ''}
            ${isLastPage
              ? `<button class="btn btn-primary btn-lg btn-block" id="cf-submit-btn">${_cfEditingSubmissionId ? 'Resubmit Form' : 'Submit Form'}</button>`
              : `<button class="btn btn-primary btn-lg btn-block" id="cf-next-btn">Next →</button>`}
            <button class="btn btn-secondary btn-block" id="cf-cancel-btn">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Wire photo previews for this page's photo fields
  (section.fields || []).filter(f => f.type === 'photo').forEach(field => {
    const fileInput = document.getElementById(`cf-photo-${field.id}`);
    const previewBox = document.getElementById(`cf-photo-box-${field.id}`);
    const previewImg = document.getElementById(`cf-photo-preview-${field.id}`);
    if (!fileInput) return;
    previewBox?.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = e => {
        if (previewImg) { previewImg.src = e.target.result; previewImg.style.display = 'block'; }
        if (previewBox) previewBox.style.display = 'none';
      };
      reader.readAsDataURL(file);
    });
  });

  // Wire selector toggle buttons
  (section.fields || []).filter(f => f.type === 'selector').forEach(field => {
    const group = document.getElementById(`cf-sel-${field.id}`);
    if (!group) return;
    group.querySelectorAll('.ups-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        group.querySelectorAll('.ups-toggle-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
    });
  });

  // Wire signature pads
  (section.fields || []).filter(f => f.type === 'signature').forEach(field => {
    const canvas = document.getElementById(`cf-canvas-${field.id}`);
    const hiddenInput = document.getElementById(`cf-sig-${field.id}`);
    if (!canvas) return;
    // Size canvas to its CSS rendered width
    canvas.width = canvas.offsetWidth || 320;
    canvas.height = canvas.offsetHeight || 150;
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-primary') || '#111827';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    let drawing = false;
    const getPos = e => {
      const r = canvas.getBoundingClientRect();
      const src = e.touches ? e.touches[0] : e;
      return { x: (src.clientX - r.left) * (canvas.width / r.width), y: (src.clientY - r.top) * (canvas.height / r.height) };
    };
    const start = e => { e.preventDefault(); drawing = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
    const draw  = e => { e.preventDefault(); if (!drawing) return; const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); };
    const stop  = e => { if (!drawing) return; drawing = false; hiddenInput.value = canvas.toDataURL('image/png'); };
    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup',   stop);
    canvas.addEventListener('mouseleave', stop);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove',  draw,  { passive: false });
    canvas.addEventListener('touchend',   stop);
  });

  // Wire group subfield special types (photo, selector, signature, date)
  (section.fields || []).filter(f => f.type === 'group').forEach(field => {
    (field.subfields || []).filter(sf => sf.type === 'photo').forEach(sf => {
      const fileInput = document.getElementById(`cf-photo-${field.id}-sf-${sf.id}`);
      const previewBox = document.getElementById(`cf-photo-box-${field.id}-sf-${sf.id}`);
      const previewImg = document.getElementById(`cf-photo-preview-${field.id}-sf-${sf.id}`);
      if (!fileInput) return;
      previewBox?.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = e => {
          if (previewImg) { previewImg.src = e.target.result; previewImg.style.display = 'block'; }
          if (previewBox) previewBox.style.display = 'none';
        };
        reader.readAsDataURL(file);
      });
    });
    (field.subfields || []).filter(sf => sf.type === 'selector').forEach(sf => {
      const grp = document.getElementById(`cf-sel-${field.id}-sf-${sf.id}`);
      if (!grp) return;
      grp.querySelectorAll('.ups-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          grp.querySelectorAll('.ups-toggle-btn').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
        });
      });
    });
    (field.subfields || []).filter(sf => sf.type === 'signature').forEach(sf => {
      const canvas = document.getElementById(`cf-canvas-${field.id}-sf-${sf.id}`);
      const hiddenInput = document.getElementById(`cf-sig-${field.id}-sf-${sf.id}`);
      if (!canvas) return;
      canvas.width = canvas.offsetWidth || 320;
      canvas.height = canvas.offsetHeight || 150;
      const ctx = canvas.getContext('2d');
      ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-primary') || '#111827';
      ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      let sfDrawing = false;
      const sfGetPos = e => { const r = canvas.getBoundingClientRect(); const src = e.touches ? e.touches[0] : e; return { x: (src.clientX - r.left) * (canvas.width / r.width), y: (src.clientY - r.top) * (canvas.height / r.height) }; };
      const sfStart = e => { e.preventDefault(); sfDrawing = true; const p = sfGetPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
      const sfDraw  = e => { e.preventDefault(); if (!sfDrawing) return; const p = sfGetPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); };
      const sfStop  = () => { if (!sfDrawing) return; sfDrawing = false; if (hiddenInput) hiddenInput.value = canvas.toDataURL('image/png'); };
      canvas.addEventListener('mousedown', sfStart);
      canvas.addEventListener('mousemove', sfDraw);
      canvas.addEventListener('mouseup', sfStop);
      canvas.addEventListener('mouseleave', sfStop);
      canvas.addEventListener('touchstart', sfStart, { passive: false });
      canvas.addEventListener('touchmove', sfDraw, { passive: false });
      canvas.addEventListener('touchend', sfStop);
    });
    (field.subfields || []).filter(sf => sf.type === 'date').forEach(sf => {
      if (window.initCustomCalendar) window.initCustomCalendar(`#cf-${field.id}-sf-${sf.id}`, { type: 'date' });
    });
  });

  // Init custom calendars for top-level date fields
  (section.fields || []).filter(f => f.type === 'date').forEach(field => {
    if (window.initCustomCalendar) window.initCustomCalendar(`#cf-${field.id}`, { type: 'date' });
  });

  // Init CRM dropdowns for select fields
  if (window.initAllCrmDropdowns) {
    window.initAllCrmDropdowns(document.getElementById('cf-fields-container'));
  }

  // Restore values entered on a previous visit to this page
  _cfRestorePageData(section);

  document.getElementById('cf-cancel-btn')?.addEventListener('click', () => {
    document.body.classList.remove('ups-form-active');
    _cfData = {};
    _cfPhotoFiles = {};
    const wasEditing = !!_cfEditingSubmissionId;
    _cfEditingSubmissionId = null;
    _cfExistingPhotos = {};
    if (wasEditing) renderTechnicianActivityView();
    else renderTechnicianLogVisitView();
  });

  if (isMultiPage && pageIdx > 0) {
    document.getElementById('cf-prev-btn')?.addEventListener('click', () => {
      const { data, photos } = _cfCollectPageData(section, false);
      Object.assign(_cfData, data);
      Object.assign(_cfPhotoFiles, photos);
      _renderCustomFormPage(form, sections, pageIdx - 1);
    });
  }

  if (!isLastPage) {
    document.getElementById('cf-next-btn')?.addEventListener('click', () => {
      const { data, photos, error } = _cfCollectPageData(section, true);
      if (error) { showToast(error, 'error'); return; }
      Object.assign(_cfData, data);
      Object.assign(_cfPhotoFiles, photos);
      _renderCustomFormPage(form, sections, pageIdx + 1);
    });
  } else {
    document.getElementById('cf-submit-btn')?.addEventListener('click', async () => {
      const { data, photos, error } = _cfCollectPageData(section, true);
      if (error) { showToast(error, 'error'); return; }
      Object.assign(_cfData, data);
      Object.assign(_cfPhotoFiles, photos);
      await _submitCustomForm(form);
    });
  }
}

function _cfCollectPageData(section, validate) {
  const data = {};
  const photos = {};
  let error = null;

  for (const field of (section.fields || [])) {
    if (field.type === 'photo') {
      const fi = document.getElementById(`cf-photo-${field.id}`);
      if (validate && field.required && (!fi || !fi.files[0]) && !_cfExistingPhotos[field.id]) {
        error = `Please upload a photo for: ${field.label}`; break;
      }
      if (fi && fi.files[0]) photos[field.id] = fi.files[0];
    } else if (field.type === 'signature') {
      const sigInput = document.getElementById(`cf-sig-${field.id}`);
      const val = sigInput?.value || '';
      if (validate && field.required && !val) {
        error = `Please provide a signature for: ${field.label}`; break;
      }
      data[field.id] = val || null;
    } else if (field.type === 'group') {
      const groupData = {};
      let groupError = null;
      for (const sf of (field.subfields || [])) {
        if (sf.type === 'photo') {
          const fi = document.getElementById(`cf-photo-${field.id}-sf-${sf.id}`);
          if (validate && sf.required && (!fi || !fi.files[0]) && !_cfExistingPhotos[`${field.id}_sf_${sf.id}`]) { groupError = `Please upload a photo for: ${field.label} → ${sf.label}`; break; }
          if (fi && fi.files[0]) photos[`${field.id}_sf_${sf.id}`] = fi.files[0];
        } else if (sf.type === 'signature') {
          const sigIn = document.getElementById(`cf-sig-${field.id}-sf-${sf.id}`);
          const val = sigIn?.value || '';
          if (validate && sf.required && !val) { groupError = `Please provide a signature for: ${field.label} → ${sf.label}`; break; }
          groupData[sf.id] = val || null;
        } else if (sf.type === 'selector') {
          const grp = document.getElementById(`cf-sel-${field.id}-sf-${sf.id}`);
          const sel = grp?.querySelector('.ups-toggle-btn.selected');
          if (validate && sf.required && !sel) { groupError = `Please select an option for: ${field.label} → ${sf.label}`; break; }
          groupData[sf.id] = sel?.dataset.value || null;
        } else {
          // text, textarea, number, date, select (CRM dropdown hidden input id = sfId)
          const el = document.getElementById(`cf-${field.id}-sf-${sf.id}`);
          const val = (el?.value || '').trim();
          if (validate && sf.required && !val) { groupError = `Please fill in: ${field.label} → ${sf.label}`; break; }
          groupData[sf.id] = val || null;
        }
      }
      if (groupError) { error = groupError; break; }
      data[field.id] = groupData;
    } else if (field.type === 'selector') {
      const group = document.getElementById(`cf-sel-${field.id}`);
      const selected = group?.querySelector('.ups-toggle-btn.selected');
      if (validate && field.required && !selected) {
        error = `Please select an option for: ${field.label}`; break;
      }
      data[field.id] = selected?.dataset.value || null;
    } else {
      // Handles text, textarea, number, date (custom calendar), select (crm-dropdown hidden input)
      const el = document.getElementById(`cf-${field.id}`);
      const val = (el?.value || '').trim();
      if (validate && field.required && !val) {
        error = `Please fill in: ${field.label}`;
        if (el?.type !== 'hidden') el?.focus();
        break;
      }
      data[field.id] = val || null;
    }
  }
  return { data, photos, error };
}

function _cfRestorePageData(section) {
  for (const field of (section.fields || [])) {
    const val = _cfData[field.id];
    if (field.type === 'photo' || val == null) continue;
    if (field.type === 'signature') {
      const canvas = document.getElementById(`cf-canvas-${field.id}`);
      const hiddenInput = document.getElementById(`cf-sig-${field.id}`);
      if (canvas && val) {
        if (hiddenInput) hiddenInput.value = val;
        const img = new Image();
        img.onload = () => canvas.getContext('2d').drawImage(img, 0, 0);
        img.src = val;
      }
      continue;
    }
    if (field.type === 'group') {
      if (typeof val === 'object' && val) {
        for (const sf of (field.subfields || [])) {
          const sfVal = val[sf.id];
          if (sfVal == null) continue;
          if (sf.type === 'signature') {
            const canvas = document.getElementById(`cf-canvas-${field.id}-sf-${sf.id}`);
            const hiddenIn = document.getElementById(`cf-sig-${field.id}-sf-${sf.id}`);
            if (canvas && sfVal) {
              if (hiddenIn) hiddenIn.value = sfVal;
              const img = new Image();
              img.onload = () => canvas.getContext('2d').drawImage(img, 0, 0);
              img.src = sfVal;
            }
          } else if (sf.type === 'selector') {
            const grp = document.getElementById(`cf-sel-${field.id}-sf-${sf.id}`);
            if (grp) {
              grp.querySelectorAll('.ups-toggle-btn').forEach(b => b.classList.remove('selected'));
              grp.querySelector(`.ups-toggle-btn[data-value="${sfVal}"]`)?.classList.add('selected');
            }
          } else if (sf.type === 'select' && window.setCrmDropdownValue) {
            const ddRoot = document.querySelector(`[data-dd-id="cf-${field.id}-sf-${sf.id}"]`);
            if (ddRoot) window.setCrmDropdownValue(ddRoot, sfVal);
          } else {
            const el = document.getElementById(`cf-${field.id}-sf-${sf.id}`);
            if (el) el.value = sfVal;
          }
        }
      }
      continue;
    }
    if (field.type === 'selector') {
      const group = document.getElementById(`cf-sel-${field.id}`);
      if (group) {
        group.querySelectorAll('.ups-toggle-btn').forEach(b => b.classList.remove('selected'));
        group.querySelector(`.ups-toggle-btn[data-value="${val}"]`)?.classList.add('selected');
      }
    } else if (field.type === 'select' && window.setCrmDropdownValue) {
      const ddRoot = document.querySelector(`[data-dd-id="cf-${field.id}"]`);
      if (ddRoot) window.setCrmDropdownValue(ddRoot, val);
    } else {
      const el = document.getElementById(`cf-${field.id}`);
      if (el) el.value = val;
    }
  }
}

async function _submitCustomForm(form) {
  const techProfile = state.currentUserProfile || {};
  const techName = `${techProfile.first_name || state.currentUser?.user_metadata?.first_name || ''} ${techProfile.last_name || state.currentUser?.user_metadata?.last_name || ''}`.trim() || state.currentUser?.email || '';

  const btn = document.getElementById('cf-submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = _cfEditingSubmissionId ? 'Resubmitting…' : 'Submitting…'; }

  try {
    // Upload any new photos; fall back to existing paths for unchanged ones
    const uploadedPhotos = { ..._cfExistingPhotos };
    for (const [fieldId, file] of Object.entries(_cfPhotoFiles)) {
      let f = file;
      try { f = await compressImage(file); } catch (_e) { /* keep original */ }
      const path = `custom-forms/${state.currentOrganization.id}/${form.id}/${Date.now()}_${fieldId}.jpg`;
      const { error: upErr } = await supabaseClient.storage.from('safitrack').upload(path, f, { upsert: true });
      if (upErr) throw upErr;
      uploadedPhotos[fieldId] = path;
    }

    if (_cfEditingSubmissionId) {
      // UPDATE existing submission — reset status so manager reviews again
      const { error } = await supabaseClient.from('form_submissions').update({
        data: _cfData,
        photos: uploadedPhotos,
        manager_approval_status: 'Pending',
        denial_reason: null,
        submitted_at: new Date().toISOString(),
      }).eq('id', _cfEditingSubmissionId);
      if (error) throw error;
    } else {
      // INSERT new submission
      const { error } = await supabaseClient.from('form_submissions').insert({
        form_id: form.id,
        organization_id: state.currentOrganization.id,
        technician_id: state.currentUser.id,
        technician_name: techName,
        data: _cfData,
        photos: uploadedPhotos,
        manager_approval_status: 'Pending'
      });
      if (error) throw error;
    }

    const wasEditing = !!_cfEditingSubmissionId;
    document.body.classList.remove('ups-form-active');
    _cfData = {};
    _cfPhotoFiles = {};
    _cfEditingSubmissionId = null;
    _cfExistingPhotos = {};
    showToast(wasEditing ? 'Form resubmitted!' : 'Form submitted successfully!', 'success');
    renderTechnicianActivityView();
  } catch (err) {
    showToast(`Failed to submit: ${err.message}`, 'error');
    if (btn) { btn.disabled = false; btn.textContent = _cfEditingSubmissionId ? 'Resubmit Form' : 'Submit Form'; }
  }
}

// ════════════════════════════════════════════════════════════════
// UPS VISIT FORM — 7-step multi-step mobile-first form
// ════════════════════════════════════════════════════════════════

function renderUPSVisitForm(existingData = null, contractPrefill = null) {
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

  initUPSFormLogic(techName, existingData, contractPrefill);
}

// ════════════════════════════════════════════════════════════════
// UPS FORM LOGIC — Navigation, validation, toggles, submission
// ════════════════════════════════════════════════════════════════

function initUPSFormLogic(techName, existingData, contractPrefill) {
  // Contract prefill (when started from Contracts view)
  if (contractPrefill) {
    const siteEl = document.getElementById('ups-site-name');
    if (siteEl && contractPrefill.siteName) siteEl.value = contractPrefill.siteName;

    // Combine location + subdivision into the location field
    const locEl = document.getElementById('ups-location');
    if (locEl) {
      const parts = [contractPrefill.location, contractPrefill.subdivision].filter(Boolean);
      if (parts.length) locEl.value = parts.join(' — ');
    }

    const container = document.querySelector('.ups-form-container');
    if (container) {
      const subdivisionLine = contractPrefill.subdivision
        ? `<span style="font-size:11px;opacity:0.85;"> · ${escapeHtml(contractPrefill.subdivision)}</span>`
        : '';
      const banner = document.createElement('div');
      banner.className = 'contract-service-banner';
      banner.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg><div><strong>Contract Service</strong> · ${escapeHtml(contractPrefill.contractTypeLabel || '')}<div>${escapeHtml(contractPrefill.siteName || '')}${subdivisionLine}${contractPrefill.dueDate ? ' · Due: ' + escapeHtml(contractPrefill.dueDate) : ''}</div></div>`;
      container.insertBefore(banner, container.firstChild);
    }
  }

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
        client_signature_data: clientSignatureData,
        contract_id: contractPrefill?.contractId || null
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

  const [upsRes, solarRes, customRes] = await Promise.all([
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
      .limit(50),
    supabaseClient
      .from('form_submissions')
      .select('id, submitted_at, manager_approval_status, denial_reason, form_id, custom_forms(name)')
      .eq('technician_id', state.currentUser.id)
      .order('submitted_at', { ascending: false })
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
  const customReports = (customRes.data || []).map(r => ({
    ...r,
    _type: 'CUSTOM',
    titleName: r.custom_forms?.name || 'Custom Form',
    created_at: r.submitted_at
  }));

  const allReports = [...upsReports, ...solarReports, ...customReports].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (!allReports || allReports.length === 0) {
    container.innerHTML = `
      <div class="card">
        <div class="empty-state">
          <h3 class="empty-state-title">No service reports yet</h3>
          <p class="empty-state-description">Start logging visits to see them here.</p>
          <button class="btn btn-primary" onclick="navigateView('technician-log-visit')">
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
                ${r._type === 'UPS' ? '<span style="font-size:10px; background:#e0e7ff; color:#4f46e5; padding:2px 6px; border-radius:12px; margin-right:6px; vertical-align:middle;">UPS</span>' : r._type === 'CUSTOM' ? '<span style="font-size:10px; background:#d1fae5; color:#065f46; padding:2px 6px; border-radius:12px; margin-right:6px; vertical-align:middle;">FORM</span>' : '<span style="font-size:10px; background:#fef3c7; color:#d97706; padding:2px 6px; border-radius:12px; margin-right:6px; vertical-align:middle;">SOLAR</span>'}
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
            <button class="btn btn-secondary btn-sm" onclick="${r._type === 'UPS' ? `window._viewUPSReport('${r.id}', true)` : r._type === 'CUSTOM' ? `window._viewCustomSubmission('${r.id}', true)` : `window._viewSolarReport('${r.id}', true)`}">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              View
            </button>
            ${r._type !== 'CUSTOM' ? `<button class="btn btn-primary btn-sm" onclick="${r._type === 'UPS' ? `window._editUPSReport('${r.id}')` : `window._editSolarReport('${r.id}')`}">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Edit
            </button>` : `<button class="btn btn-primary btn-sm" onclick="window._editCustomSubmission('${r.id}')">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Edit
            </button>`}
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

window._editCustomSubmission = async function(submissionId) {
  const { data: s, error } = await supabaseClient
    .from('form_submissions')
    .select('*, custom_forms(id, name, description, fields)')
    .eq('id', submissionId)
    .single();

  if (error || !s) {
    showToast('Failed to load submission for editing', 'error');
    return;
  }

  const form = s.custom_forms;
  if (!form) {
    showToast('The form template for this submission no longer exists', 'error');
    return;
  }

  renderCustomFormFillView(form, s);
};

// ════════════════════════════════════════════════════════════════
// MANAGER VIEW — TECHNICIANS DASHBOARD
// ════════════════════════════════════════════════════════════════

async function renderTechniciansDashboardView() {
  _submissionsPage = 1; // reset on every full view load
  viewContainer.innerHTML = `
    <div class="ups-reports-section" id="ups-reports-section" style="margin-top: 0;">
      <div class="ups-reports-header">
        <h3 class="ups-reports-title">
          Submissions
        </h3>
        <div style="display:flex; gap:8px; flex-wrap:wrap; flex:1; justify-content:flex-end; align-items:center;">
          <div class="crm-dd crm-dd--filter" data-dd-id="ups-reports-filter-type" id="ups-reports-filter-type-dd" style="width:150px;">
            <button type="button" class="crm-dd-trigger has-value" aria-haspopup="listbox" aria-expanded="false">
              <span class="crm-dd-label">All Forms</span>
              <span class="crm-dd-chevron"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>
            </button>
            <div class="crm-dd-panel" role="listbox">
              <ul class="crm-dd-list" id="ups-reports-filter-type-list">
                <li class="crm-dd-option is-selected" role="option" aria-selected="true" data-value="" data-label="All Forms" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>All Forms</li>
              </ul>
            </div>
            <input class="crm-dd-value-input ups-reports-search" type="hidden" id="ups-reports-filter-type" value="">
          </div>
          <div class="crm-dd crm-dd--filter" data-dd-id="ups-reports-filter-status" style="width:140px;">
            <button type="button" class="crm-dd-trigger has-value" aria-haspopup="listbox" aria-expanded="false">
              <span class="crm-dd-label">All Statuses</span>
              <span class="crm-dd-chevron"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>
            </button>
            <div class="crm-dd-panel" role="listbox">
              <ul class="crm-dd-list">
                <li class="crm-dd-option is-selected" role="option" aria-selected="true" data-value="" data-label="All Statuses" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>All Statuses</li>
                <li class="crm-dd-option" role="option" data-value="Approved" data-label="Approved" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Approved</li>
                <li class="crm-dd-option" role="option" data-value="Pending" data-label="Pending" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Pending</li>
                <li class="crm-dd-option" role="option" data-value="Denied" data-label="Denied" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Denied</li>
              </ul>
            </div>
            <input class="crm-dd-value-input ups-reports-search" type="hidden" id="ups-reports-filter-status" value="">
          </div>
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

  let queryForms = supabaseClient
    .from('custom_forms')
    .select('id, name')
    .order('name', { ascending: true });

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

  let queryCustom = supabaseClient
    .from('form_submissions')
    .select('id, technician_name, submitted_at, manager_approval_status, form_id, custom_forms(name)')
    .order('submitted_at', { ascending: false })
    .limit(100);

  if (state.currentOrganization?.id) {
    queryForms = queryForms.eq('organization_id', state.currentOrganization.id);
    queryUPS = queryUPS.eq('organization_id', state.currentOrganization.id);
    querySolar = querySolar.eq('organization_id', state.currentOrganization.id);
    queryCustom = queryCustom.eq('organization_id', state.currentOrganization.id);
  }

  const [resForms, resUPS, resSolar, resCustom] = await Promise.all([queryForms, queryUPS, querySolar, queryCustom]);

  if (resUPS.error || resSolar.error) {
    document.getElementById('ups-reports-container').innerHTML = renderError((resUPS.error || resSolar.error).message);
    return;
  }

  const upsReports = (resUPS.data || []).map(r => ({ ...r, _type: 'UPS', titleName: r.site_client_name, techName: r.technician_name }));
  const solarReports = (resSolar.data || []).map(r => ({ ...r, _type: 'SOLAR', titleName: r.company_organization_name, techName: r.survey_done_by }));
  const customReports = (resCustom.data || []).map(r => ({
    ...r,
    _type: 'CUSTOM',
    _formName: r.custom_forms?.name || 'Custom Form',
    titleName: r.custom_forms?.name || 'Custom Form',
    techName: r.technician_name,
    created_at: r.submitted_at,
  }));
  
  const allReports = [...upsReports, ...solarReports, ...customReports].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  renderReportsTable(allReports, allReports);

  // Build form filter options dynamically
  const _checkSvg = `<svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
  const filterList = document.getElementById('ups-reports-filter-type-list');
  if (filterList) {
    const orgForms = resForms.data || [];
    // Add each custom form as an option
    orgForms.forEach(form => {
      const li = document.createElement('li');
      li.className = 'crm-dd-option';
      li.setAttribute('role', 'option');
      li.setAttribute('data-value', form.id);
      li.setAttribute('data-label', form.name);
      li.setAttribute('tabindex', '-1');
      li.innerHTML = `${_checkSvg}${form.name}`;
      filterList.appendChild(li);
    });
    // Re-init the dropdown now that options are populated
    const ddEl = document.getElementById('ups-reports-filter-type-dd');
    if (ddEl && window.initCrmDropdown) window.initCrmDropdown(ddEl);
  }

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
      // t is either a form UUID (custom), 'UPS', 'SOLAR', or '' (all)
      const matchType = !t || r.form_id === t || r._type === t;
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
    _submissionsPage = 1; // reset to first page on any filter change
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
  _submissionsFiltered = reports;
  const container = document.getElementById('ups-reports-container');

  if (reports.length === 0) {
    container.innerHTML = `<div class="ups-reports-empty">No reports found.</div>`;
    return;
  }

  const totalPages = Math.ceil(reports.length / SUBS_PAGE_SIZE);
  _submissionsPage = Math.max(1, Math.min(_submissionsPage, totalPages));
  const start = (_submissionsPage - 1) * SUBS_PAGE_SIZE;
  const pageReports = reports.slice(start, start + SUBS_PAGE_SIZE);

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
          ${pageReports.map(r => `
            <tr onclick="${r._type === 'UPS' ? `window._viewUPSReport('${r.id}')` : r._type === 'SOLAR' ? `window._viewSolarReport('${r.id}')` : `window._viewCustomSubmission('${r.id}')`}">
              <td>
                <span style="font-size:11px; font-weight:600; padding:2px 8px; border-radius:12px; ${r._type === 'UPS' ? 'background:#e0e7ff; color:#4f46e5;' : r._type === 'SOLAR' ? 'background:#fef3c7; color:#d97706;' : 'background:#d1fae5; color:#059669;'}">
                  ${r._type === 'CUSTOM' ? escapeHtml(r._formName || 'Custom') : r._type}
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
    ${_pgHTML(_submissionsPage, reports.length, SUBS_PAGE_SIZE)}
  `;

  if (window.lucide) lucide.createIcons();

  // Wire pagination via event delegation — runs once per container lifetime
  if (!container._pgWired) {
    container._pgWired = true;
    container.addEventListener('click', e => {
      const btn = e.target.closest('.pagination-btn');
      if (!btn || btn.classList.contains('disabled') || btn.classList.contains('active')) return;
      const pg = parseInt(btn.dataset.pg, 10);
      if (!isNaN(pg)) {
        _submissionsPage = pg;
        renderReportsTable(_submissionsFiltered);
        container.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }
}

// ════════════════════════════════════════════════════════════════
// REPORT DETAIL VIEW & APPROVAL (Manager)
// ════════════════════════════════════════════════════════════════

window._updateReportApproval = async function (type, reportId, status) {
  if (status === 'Denied') {
    renderDenialModal(reportId, type);
    return;
  }

  const table = type === 'UPS' ? 'ups_maintenance_reports'
    : type === 'SOLAR' ? 'solar_inverter_surveys'
    : 'form_submissions';

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
  const stepNames = type === 'UPS' ? STEP_NAMES
    : type === 'SOLAR' ? window.SOLAR_STEP_NAMES
    : null; // CUSTOM forms don't have predefined steps

  const modalHTML = `
    <div class="ups-modal-overlay" id="ups-denial-modal" style="position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:9999; padding:16px;">
      <div class="ups-modal-content" style="width:100%; max-width:500px; padding:24px; border-radius:12px; background:var(--bg-primary); color:var(--text-primary); box-shadow:0 10px 40px rgba(0,0,0,0.2);">
        <h2 style="margin-top:0; margin-bottom:16px; font-size:20px;">Deny Report</h2>
        <p style="margin-bottom:16px; color:var(--text-muted); font-size:14px;">Provide a reason for the technician${stepNames ? ' and select the sections that need correction' : ''}.</p>
        
        ${stepNames ? `
        <div style="margin-bottom:16px;">
          <label style="display:block; margin-bottom:8px; font-weight:600; font-size:14px;">Flagged Sections</label>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;" id="ups-denial-sections">
            ${stepNames.map(name => `
              <label style="display:flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">
                <input type="checkbox" value="${name}">
                ${name}
              </label>
            `).join('')}
          </div>
        </div>
        ` : ''}

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
    const checked = stepNames
      ? Array.from(document.querySelectorAll('#ups-denial-sections input:checked')).map(cb => cb.value)
      : [];
    
    if (!reason) {
      showToast('Please provide a reason for denial.', 'error');
      return;
    }

    const btn = document.getElementById('ups-denial-submit');
    btn.disabled = true;
    btn.textContent = 'Submitting...';

    const table = type === 'UPS' ? 'ups_maintenance_reports'
      : type === 'SOLAR' ? 'solar_inverter_surveys'
      : 'form_submissions';

    try {
      const { data, error } = await supabaseClient
        .from(table)
        .update({ 
          manager_approval_status: 'Denied',
          denial_reason: reason,
          flagged_sections: checked.length ? checked : undefined,
          flagged_fields: type === 'CUSTOM' ? checked : undefined,
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
  container.style.removeProperty('opacity');
  container.style.removeProperty('transition');
  container.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:64px 24px;gap:12px;"><div class="loading-spinner" style="width:32px;height:32px;border-width:3px;margin:0;"></div><span style="font-size:13px;color:var(--text-muted);">Loading…</span></div>`;

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

  container.style.opacity = '0';
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

  await _awaitImages(container);
  container.style.transition = 'opacity 0.2s ease';
  container.style.opacity = '1';
  setTimeout(() => { container.style.removeProperty('opacity'); container.style.removeProperty('transition'); }, 250);

  // Store current report data for PDF
  window._currentUPSReport = r;
}

window._backToReportsList = function () {
  renderTechniciansDashboardView();
};

// ════════════════════════════════════════════════════════════════
// CUSTOM FORM SUBMISSION DETAIL VIEW (Manager)
// ════════════════════════════════════════════════════════════════
window._viewCustomSubmission = async function (submissionId, isTechnician = false) {
  const container = document.getElementById(isTechnician ? 'ups-activity-list' : 'ups-reports-container');
  if (!container) return;
  container.style.removeProperty('opacity');
  container.style.removeProperty('transition');
  container.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:64px 24px;gap:12px;"><div class="loading-spinner" style="width:32px;height:32px;border-width:3px;margin:0;"></div><span style="font-size:13px;color:var(--text-muted);">Loading…</span></div>`;

  const { data: s, error } = await supabaseClient
    .from('form_submissions')
    .select('*, custom_forms(name, fields)')
    .eq('id', submissionId)
    .single();

  if (error || !s) {
    container.innerHTML = renderError(error?.message || 'Submission not found');
    return;
  }

  const form = s.custom_forms || {};
  // Normalize sections format (handles both legacy flat and new sectioned fields)
  const _sections = _normalizeSectionsForFill(form.fields || []);
  const fields = _sections.flatMap(sec => sec.fields || []);
  const isMultiPage = _sections.length > 1;
  const valOrDash = v => (v !== null && v !== undefined && v !== '') ? escapeHtml(String(v)) : '—';

  function renderFieldRow(field) {
    const value = s.data?.[field.id];
    const photoPath = s.photos?.[field.id];
    if (field.type === 'photo' && photoPath) {
      const { data: urlData } = supabaseClient.storage.from('safitrack').getPublicUrl(photoPath);
      const imgSrc = urlData?.publicUrl || '';
      return `<div class="ups-report-field" style="grid-column:1/-1;">
        <span class="ups-report-field-label">${escapeHtml(field.label)}</span>
        <img src="${imgSrc}" class="ups-report-photo-thumb" style="cursor:pointer;" onclick="window.open('${imgSrc}','_blank')">
      </div>`;
    }
    if (field.type === 'signature' && value) {
      return `<div class="ups-report-field" style="grid-column:1/-1;">
        <span class="ups-report-field-label">${escapeHtml(field.label)}</span>
        <img src="${value}" style="max-width:320px; width:100%; border:1px solid var(--border-color); border-radius:8px; background:#fff; display:block; margin-top:4px;">
      </div>`;
    }
    if (field.type === 'group') {
      const groupVal = value;
      const subRows = (field.subfields || []).map(sf => {
        const sv = (typeof groupVal === 'object' && groupVal) ? groupVal[sf.id] : null;
        const sfPhotoPath = s.photos?.[`${field.id}_sf_${sf.id}`];
        if (sf.type === 'photo' && sfPhotoPath) {
          const { data: urlData } = supabaseClient.storage.from('safitrack').getPublicUrl(sfPhotoPath);
          const imgSrc = urlData?.publicUrl || '';
          return `<div class="ups-report-field" style="grid-column:1/-1;"><span class="ups-report-field-label">${escapeHtml(field.label)} — ${escapeHtml(sf.label)}</span><img src="${imgSrc}" class="ups-report-photo-thumb" style="cursor:pointer;" onclick="window.open('${imgSrc}','_blank')"></div>`;
        }
        if (sf.type === 'signature' && sv) {
          return `<div class="ups-report-field" style="grid-column:1/-1;"><span class="ups-report-field-label">${escapeHtml(field.label)} — ${escapeHtml(sf.label)}</span><img src="${sv}" style="max-width:320px; width:100%; border:1px solid var(--border-color); border-radius:8px; background:#fff; display:block; margin-top:4px;"></div>`;
        }
        return `<div class="ups-report-field"><span class="ups-report-field-label">${escapeHtml(field.label)} — ${escapeHtml(sf.label)}</span><span class="ups-report-field-value">${valOrDash(sv)}</span></div>`;
      }).join('');
      return subRows || `<div class="ups-report-field"><span class="ups-report-field-label">${escapeHtml(field.label)}</span><span class="ups-report-field-value">—</span></div>`;
    }
    return `<div class="ups-report-field">
      <span class="ups-report-field-label">${escapeHtml(field.label)}</span>
      <span class="ups-report-field-value">${valOrDash(value)}</span>
    </div>`;
  }

  const responseSectionsHtml = isMultiPage
    ? _sections.map((sec, idx) => {
        const secTitle = sec.name ? escapeHtml(sec.name) : `Page ${idx + 1}`;
        const secFieldsHtml = (sec.fields || []).map(renderFieldRow).join('');
        return secFieldsHtml ? `
        <div class="ups-report-section">
          <div class="ups-report-section-title">${secTitle}</div>
          <div class="ups-report-fields">${secFieldsHtml}</div>
        </div>` : '';
      }).join('')
    : (fields.length > 0 ? `
        <div class="ups-report-section">
          <div class="ups-report-section-title">Responses</div>
          <div class="ups-report-fields">${fields.map(renderFieldRow).join('')}</div>
        </div>` : '');

  container.style.opacity = '0';
  container.innerHTML = `
    <div class="ups-report-detail">
      <div class="ups-report-detail-header">
        <div>
          <div style="display:flex; align-items:center; gap:12px;">
            <h3 style="margin:0;">${escapeHtml(form.name || 'Custom Form')}</h3>
            ${s.manager_approval_status && s.manager_approval_status !== 'Pending' ? `
              <span class="ups-status-badge ${s.manager_approval_status === 'Approved' ? 'ups-status-badge-pass' : 'ups-status-badge-fail'}">
                ${s.manager_approval_status}
              </span>` : ''}
          </div>
          <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">
            ID: ${s.id} • ${formatDate(s.submitted_at)}
          </div>
        </div>
        <div class="ups-report-detail-actions">
          <button class="btn btn-secondary btn-sm" onclick="${isTechnician ? 'window.renderTechnicianActivityView()' : 'window._backToReportsList()'}">← Back</button>
          <button class="btn btn-primary btn-sm" onclick="window._downloadCustomSubmissionPDF('${s.id}')">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Download PDF
          </button>
        </div>
      </div>
      <div class="ups-report-detail-body">
        <div class="ups-report-section">
          <div class="ups-report-section-title">Submission Info</div>
          <div class="ups-report-fields">
            <div class="ups-report-field"><span class="ups-report-field-label">Technician</span><span class="ups-report-field-value">${escapeHtml(s.technician_name || '—')}</span></div>
            <div class="ups-report-field"><span class="ups-report-field-label">Submitted</span><span class="ups-report-field-value">${formatDate(s.submitted_at)}</span></div>
            ${s.denial_reason ? `<div class="ups-report-field" style="grid-column:1/-1;"><span class="ups-report-field-label">Denial Reason</span><span class="ups-report-field-value" style="color:#ef4444;">${escapeHtml(s.denial_reason)}</span></div>` : ''}
          </div>
        </div>
        ${responseSectionsHtml}
      </div>
    </div>
  `;

  await _awaitImages(container);
  container.style.transition = 'opacity 0.2s ease';
  container.style.opacity = '1';
  setTimeout(() => { container.style.removeProperty('opacity'); container.style.removeProperty('transition'); }, 250);

  // Store submission data for PDF
  window._currentCustomSubmission = { s, form, fields };

  if (window.lucide) lucide.createIcons();
};

// ════════════════════════════════════════════════════════════════
// PDF PRINT HELPER — opens a clean popup so only PDF content prints
// ════════════════════════════════════════════════════════════════
window._openPrintWindow = function(bodyHtml, docTitle) {
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) { showToast('Allow pop-ups for this site to download PDF.', 'error'); return; }
  const css = [
    '@page{size:A4;margin:14mm 18mm}',
    '*{box-sizing:border-box}',
    'body{font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.6;color:#111;background:#fff;margin:0;padding:0}',
    '.ups-print-header{text-align:center;padding-bottom:12px;margin-bottom:14px;border-bottom:2px solid #111}',
    '.ups-print-header h1{font-size:17px;font-weight:800;margin:0 0 3px}',
    '.ups-print-header p{font-size:10px;color:#555;margin:1px 0}',
    '.ups-print-doc-title{display:block;font-size:13px;font-weight:700;color:#111;margin-top:10px}',
    '.ups-print-section{padding:10px 0;border-bottom:1px solid #ddd}',
    '.ups-print-section:last-of-type{border-bottom:none}',
    '.ups-print-section h3{font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#999;margin:0 0 6px}',
    '.ups-print-grid{display:grid;grid-template-columns:repeat(3,1fr);column-gap:16px;row-gap:3px}',
    '.ups-print-field{display:flex;gap:4px;align-items:baseline;break-inside:avoid;overflow:hidden}',
    '.ups-print-field-label{color:#888;font-weight:400;white-space:nowrap;flex-shrink:0;min-width:72px;max-width:110px}',
    '.ups-print-field-value{color:#111;font-weight:600;word-break:break-word;overflow-wrap:break-word;min-width:0}',
    '.ups-print-photo-pair{grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px;break-inside:avoid}',
    '.ups-print-photo-single{grid-column:1/-1;margin-top:8px;break-inside:avoid}',
    '.ups-print-photo-caption{font-size:9px;color:#aaa;margin-bottom:3px}',
    '.ups-print-photo-pair img,.ups-print-photo-single img{width:100%;height:auto;max-height:180px;object-fit:contain;object-position:left top;display:block}',
    '.ups-print-photo-single img{max-width:280px;width:auto}',
    '.ups-print-sig-row{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:8px;break-inside:avoid}',
    '.ups-print-sig-caption{font-size:9px;color:#888;margin-bottom:4px}',
    '.ups-print-sig-row img{max-width:200px;max-height:70px;width:auto;height:auto;object-fit:contain;display:block}',
    '.ups-print-footer{margin-top:14px;padding-top:6px;border-top:1px solid #ddd;text-align:center;font-size:9px;color:#bbb}',
  ].join('\n');
  win.document.open();
  win.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + docTitle + '</title><style>' + css + '</style></head><body>' + bodyHtml + '</body></html>');
  win.document.close();
  win.focus();
  setTimeout(function() { win.print(); win.close(); }, 400);
};

// ════════════════════════════════════════════════════════════════
// CUSTOM FORM PDF DOWNLOAD
// ════════════════════════════════════════════════════════════════

window._downloadCustomSubmissionPDF = function (submissionId) {
  const cached = window._currentCustomSubmission;
  if (!cached || cached.s.id !== submissionId) {
    showToast('Submission data not available', 'error');
    return;
  }
  const { s, form } = cached;
  const _sections = _normalizeSectionsForFill(form.fields || []);
  const isMultiPage = _sections.length > 1;
  const valOrDash = (v) => (v !== null && v !== undefined && v !== '') ? String(v) : '—';
  const esc = (v) => String(v || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const formName = (form.name || 'Custom Form').replace(/[^a-zA-Z0-9 ]/g, '_');
  const dateStr = new Date(s.submitted_at || s.created_at).toISOString().split('T')[0];
  const approvalStatus = s.manager_approval_status || 'Pending';
  const statusColor = approvalStatus === 'Approved' ? '#059669' : approvalStatus === 'Denied' ? '#dc2626' : '#d97706';
  const statusBg   = approvalStatus === 'Approved' ? '#ecfdf5' : approvalStatus === 'Denied' ? '#fef2f2' : '#fffbeb';
  const orgId = state.currentOrganization?.id;
  const customHeader = getPdfHeader();

  // ── Field renderer ─────────────────────────────────────────
  function renderPdfField(field, sData, sPhotos) {
    const value = sData?.[field.id];
    const photoPath = sPhotos?.[field.id];

    if (field.type === 'photo' && photoPath) {
      const { data: urlData } = supabaseClient.storage.from('safitrack').getPublicUrl(photoPath);
      const imgSrc = urlData?.publicUrl || '';
      return `<div class="cf-field cf-field-full">
        <div class="cf-label">${esc(field.label)}</div>
        <img src="${imgSrc}" class="cf-photo">
      </div>`;
    }
    if (field.type === 'signature' && value) {
      return `<div class="cf-field cf-field-full">
        <div class="cf-label">${esc(field.label)}</div>
        <div class="cf-sig-box"><img src="${value}" class="cf-sig-img"></div>
      </div>`;
    }
    if (field.type === 'group') {
      const groupVal = value;
      const subHtml = (field.subfields || []).map(sf => {
        const sv = (typeof groupVal === 'object' && groupVal) ? groupVal[sf.id] : null;
        const sfPhotoPath = sPhotos?.[`${field.id}_sf_${sf.id}`];
        if (sf.type === 'photo' && sfPhotoPath) {
          const { data: urlData } = supabaseClient.storage.from('safitrack').getPublicUrl(sfPhotoPath);
          const imgSrc = urlData?.publicUrl || '';
          return `<div class="cf-field cf-field-full">
            <div class="cf-label">${esc(field.label)} — ${esc(sf.label)}</div>
            <img src="${imgSrc}" class="cf-photo">
          </div>`;
        }
        if (sf.type === 'signature' && sv) {
          return `<div class="cf-field cf-field-full">
            <div class="cf-label">${esc(field.label)} — ${esc(sf.label)}</div>
            <div class="cf-sig-box"><img src="${sv}" class="cf-sig-img"></div>
          </div>`;
        }
        return `<div class="cf-field">
          <div class="cf-label">${esc(field.label)} — ${esc(sf.label)}</div>
          <div class="cf-value">${esc(valOrDash(sv))}</div>
        </div>`;
      }).join('');
      return subHtml || `<div class="cf-field"><div class="cf-label">${esc(field.label)}</div><div class="cf-value">—</div></div>`;
    }
    const isLong = field.type === 'textarea';
    return `<div class="cf-field${isLong ? ' cf-field-full' : ''}">
      <div class="cf-label">${esc(field.label)}</div>
      <div class="cf-value">${esc(valOrDash(value))}</div>
    </div>`;
  }

  // ── Build section HTML ─────────────────────────────────────
  const sectionBlocks = _sections.map((sec, idx) => {
    const title = isMultiPage
      ? (sec.name ? esc(sec.name) : `Page ${idx + 1}`)
      : 'Responses';
    const fieldsHtml = (sec.fields || []).map(f => renderPdfField(f, s.data, s.photos)).join('');
    if (!fieldsHtml) return '';
    return `
      <div class="cf-section">
        <div class="cf-section-head">
          <span class="cf-section-num">${idx + 1}</span>
          <span class="cf-section-title">${title}</span>
        </div>
        <div class="cf-grid">${fieldsHtml}</div>
      </div>`;
  }).join('');

  // ── CSS ────────────────────────────────────────────────────
  const css = `
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 11px; color: #1a1a2e; background: #fff; }

    /* ── Top bar ── */
    .cf-topbar { background: #0f2d52; height: 6px; width: 100%; }

    /* ── Page wrapper ── */
    .cf-page { padding: 28px 36px 24px; }

    /* ── Header ── */
    .cf-header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 18px; border-bottom: 1.5px solid #e0e8f0; margin-bottom: 18px; }
    .cf-header-left h1 { font-size: 18px; font-weight: 800; color: #0f2d52; letter-spacing: -0.3px; }
    .cf-header-left p { font-size: 9px; color: #6b7280; margin-top: 3px; line-height: 1.6; }
    .cf-header-right { text-align: right; }
    .cf-doc-type { display: inline-block; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #0f2d52; background: #e8f0fb; padding: 3px 10px; border-radius: 100px; margin-bottom: 5px; }
    .cf-doc-id { font-size: 9px; color: #9ca3af; }

    /* ── Title block ── */
    .cf-title-block { margin-bottom: 16px; }
    .cf-form-name { font-size: 20px; font-weight: 800; color: #0f2d52; line-height: 1.2; margin-bottom: 4px; }
    .cf-form-desc { font-size: 10px; color: #6b7280; }

    /* ── Meta strip ── */
    .cf-meta { display: flex; gap: 0; background: #f7f9fc; border: 1px solid #e0e8f0; border-radius: 8px; overflow: hidden; margin-bottom: 20px; }
    .cf-meta-item { flex: 1; padding: 10px 14px; border-right: 1px solid #e0e8f0; }
    .cf-meta-item:last-child { border-right: none; }
    .cf-meta-label { font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: #9ca3af; margin-bottom: 3px; }
    .cf-meta-value { font-size: 11px; font-weight: 700; color: #1a1a2e; }
    .cf-status-pill { display: inline-block; font-size: 10px; font-weight: 700; padding: 2px 9px; border-radius: 100px; color: ${statusColor}; background: ${statusBg}; border: 1px solid ${statusColor}40; }

    /* ── Denial reason ── */
    .cf-denial { background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 8px 12px; margin-bottom: 16px; font-size: 10px; color: #dc2626; }
    .cf-denial strong { font-weight: 700; }

    /* ── Section ── */
    .cf-section { margin-bottom: 18px; break-inside: avoid; }
    .cf-section-head { display: flex; align-items: center; gap: 8px; background: #f0f5ff; border-left: 3px solid #0f2d52; padding: 7px 12px; border-radius: 0 6px 6px 0; margin-bottom: 10px; }
    .cf-section-num { width: 18px; height: 18px; background: #0f2d52; color: #fff; font-size: 9px; font-weight: 800; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .cf-section-title { font-size: 11px; font-weight: 700; color: #0f2d52; text-transform: uppercase; letter-spacing: 0.06em; }

    /* ── Field grid ── */
    .cf-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; padding: 0 4px; }
    .cf-field { background: #fff; border: 1px solid #e8edf3; border-radius: 5px; padding: 8px 10px; break-inside: avoid; }
    .cf-field-full { grid-column: 1 / -1; }
    .cf-label { font-size: 8.5px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 3px; }
    .cf-value { font-size: 11px; font-weight: 600; color: #1a1a2e; word-break: break-word; line-height: 1.4; }

    /* ── Photo ── */
    .cf-photo { max-width: 100%; max-height: 200px; object-fit: contain; object-position: left top; display: block; margin-top: 6px; border-radius: 4px; border: 1px solid #e0e8f0; }

    /* ── Signature ── */
    .cf-sig-box { border: 1px solid #e0e8f0; border-radius: 4px; background: #fafafa; padding: 8px; display: inline-block; margin-top: 4px; }
    .cf-sig-img { max-width: 220px; max-height: 70px; width: auto; height: auto; object-fit: contain; display: block; }

    /* ── Footer ── */
    .cf-footer { margin-top: 24px; padding-top: 10px; border-top: 1px solid #e0e8f0; display: flex; justify-content: space-between; align-items: center; }
    .cf-footer-brand { font-size: 9px; font-weight: 700; color: #0f2d52; }
    .cf-footer-time { font-size: 8.5px; color: #9ca3af; }
    .cf-footer-accent { width: 100%; height: 3px; background: linear-gradient(to right, #0f2d52, #3b7dd8); margin-top: 8px; border-radius: 100px; }
  `;

  // ── Body HTML ──────────────────────────────────────────────
  const bodyHtml = `
    <div class="cf-topbar"></div>
    <div class="cf-page">

      <div class="cf-header">
        <div class="cf-header-left">
          ${customHeader
            ? customHeader.split('\n').map((line, i) => i === 0
                ? `<h1>${esc(line)}</h1>`
                : `<p>${esc(line)}</p>`).join('')
            : '<h1>Form Submission</h1>'}
        </div>
        <div class="cf-header-right">
          <div class="cf-doc-type">Custom Form Submission</div><br>
          <span class="cf-doc-id">ID: ${esc(s.id)}</span>
        </div>
      </div>

      <div class="cf-title-block">
        <div class="cf-form-name">${esc(form.name || 'Custom Form')}</div>
        ${form.description ? `<div class="cf-form-desc">${esc(form.description)}</div>` : ''}
      </div>

      <div class="cf-meta">
        <div class="cf-meta-item">
          <div class="cf-meta-label">Technician</div>
          <div class="cf-meta-value">${esc(valOrDash(s.technician_name))}</div>
        </div>
        <div class="cf-meta-item">
          <div class="cf-meta-label">Submitted</div>
          <div class="cf-meta-value">${formatDate(s.submitted_at || s.created_at)}</div>
        </div>
        <div class="cf-meta-item">
          <div class="cf-meta-label">Status</div>
          <div class="cf-meta-value"><span class="cf-status-pill">${esc(approvalStatus)}</span></div>
        </div>
      </div>

      ${s.denial_reason ? `<div class="cf-denial"><strong>Denial Reason:</strong> ${esc(s.denial_reason)}</div>` : ''}

      ${sectionBlocks}

      <div class="cf-footer">
        <span class="cf-footer-brand">${esc(customHeader ? customHeader.split('\n')[0] : 'Form Submission')}</span>
        <span class="cf-footer-time">Generated ${new Date().toLocaleString()}</span>
      </div>
      <div class="cf-footer-accent"></div>

    </div>
  `;

  // ── Open print window ──────────────────────────────────────
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) { showToast('Allow pop-ups for this site to download PDF.', 'error'); return; }
  win.document.open();
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(form.name || 'Submission')}_${dateStr}</title><style>${css}</style></head><body>${bodyHtml}</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); win.close(); }, 500);
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

  function pdfPhoto(url, caption) {
    if (!url) return '';
    return `<div class="ups-print-photo-single">
      <div class="ups-print-photo-caption">${caption}</div>
      <img src="${url}">
    </div>`;
  }

  const beforeUrl = getStepPhotoUrlLocal(r, 0);
  const afterUrl  = getStepPhotoUrlLocal(r, 6);

  const beforeAfterHtml = (beforeUrl || afterUrl) ? `
    <div class="ups-print-photo-pair">
      ${beforeUrl ? `<div><div class="ups-print-photo-caption">Before Service</div><img src="${beforeUrl}"></div>` : '<div></div>'}
      ${afterUrl  ? `<div><div class="ups-print-photo-caption">After Service</div><img src="${afterUrl}"></div>`  : '<div></div>'}
    </div>` : '';

  const __printHtml = `
    <div class="ups-print-header">
      <h1>Sangyug Enterprises Limited</h1>
      <p>www.sangyug.com &bull; servicecentre@sangyug.com &bull; 0743 767960</p>
      <span class="ups-print-doc-title">UPS Maintenance Service Report</span>
      <p>Report ID: ${r.id} &bull; ${formatDate(r.created_at)}</p>
    </div>

    <div class="ups-print-section">
      <h3>Site Information</h3>
      <div class="ups-print-grid">
        <div class="ups-print-field"><span class="ups-print-field-label">Site / Client</span><span class="ups-print-field-value">${valOrDash(r.site_client_name)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Location</span><span class="ups-print-field-value">${valOrDash(r.location_building)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Technician</span><span class="ups-print-field-value">${valOrDash(r.technician_name)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">UPS Brand</span><span class="ups-print-field-value">${valOrDash(r.ups_brand)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Serial No.</span><span class="ups-print-field-value">${valOrDash(r.ups_serial_number)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Model</span><span class="ups-print-field-value">${valOrDash(r.ups_model)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Size (kVA)</span><span class="ups-print-field-value">${valOrDash(r.ups_size_kva)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Phase</span><span class="ups-print-field-value">${valOrDash(r.phase)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Model Type</span><span class="ups-print-field-value">${valOrDash(r.model_type)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Runtime</span><span class="ups-print-field-value">${formatRuntimeHelper(r.total_ups_runtime)}</span></div>
        ${beforeAfterHtml}
      </div>
    </div>

    <div class="ups-print-section">
      <h3>Environmental Conditions</h3>
      <div class="ups-print-grid">
        <div class="ups-print-field"><span class="ups-print-field-label">Room Temp</span><span class="ups-print-field-value">${valOrDash(r.ambient_room_temperature)} °C</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Humidity</span><span class="ups-print-field-value">${valOrDash(r.humidity_level)} %</span></div>
        ${pdfPhoto(getStepPhotoUrlLocal(r, 1), 'Environmental Photo')}
      </div>
    </div>

    <div class="ups-print-section">
      <h3>UPS / Inverter Parameters</h3>
      <div class="ups-print-grid">
        <div class="ups-print-field"><span class="ups-print-field-label">Operating Mode</span><span class="ups-print-field-value">${valOrDash(r.operating_mode)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Rectifier DC</span><span class="ups-print-field-value">${valOrDash(r.rectifier_dc_output_voltage)} VDC</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Inverter Freq</span><span class="ups-print-field-value">${valOrDash(r.inverter_output_frequency)} Hz</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Load</span><span class="ups-print-field-value">${valOrDash(r.load_percentage)} %</span></div>
        ${pdfPhoto(getStepPhotoUrlLocal(r, 2), 'UPS Parameters Photo')}
      </div>
    </div>

    <div class="ups-print-section">
      <h3>Electrical Measurements</h3>
      <div class="ups-print-grid">
        <div class="ups-print-field"><span class="ups-print-field-label">Input R-N</span><span class="ups-print-field-value">${valOrDash(r.input_voltage_rn)} V</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Input Y-N</span><span class="ups-print-field-value">${valOrDash(r.input_voltage_yn)} V</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Input B-N</span><span class="ups-print-field-value">${valOrDash(r.input_voltage_bn)} V</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Output R-N</span><span class="ups-print-field-value">${valOrDash(r.output_voltage_rn)} V</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Output Y-N</span><span class="ups-print-field-value">${valOrDash(r.output_voltage_yn)} V</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Output B-N</span><span class="ups-print-field-value">${valOrDash(r.output_voltage_bn)} V</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Load Current</span><span class="ups-print-field-value">${valOrDash(r.output_load_current)} A</span></div>
        ${pdfPhoto(getStepPhotoUrlLocal(r, 3), 'Electrical Photo')}
      </div>
    </div>

    <div class="ups-print-section">
      <h3>Battery System</h3>
      <div class="ups-print-grid">
        <div class="ups-print-field"><span class="ups-print-field-label">Brand</span><span class="ups-print-field-value">${valOrDash(r.battery_brand)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Size</span><span class="ups-print-field-value">${valOrDash(r.battery_size)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Qty in Series</span><span class="ups-print-field-value">${valOrDash(r.battery_quantity_series)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Bank Voltage</span><span class="ups-print-field-value">${valOrDash(r.total_battery_bank_voltage)} VDC</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Charging V</span><span class="ups-print-field-value">${valOrDash(r.charging_voltage)} VDC</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Surface Temp</span><span class="ups-print-field-value">${valOrDash(r.battery_surface_temperature)} °C</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Connections</span><span class="ups-print-field-value">${boolLabel(r.battery_connections_tightened)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Bulging/Leak</span><span class="ups-print-field-value">${boolLabel(r.signs_bulging_leakage)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Self-Test</span><span class="ups-print-field-value">${valOrDash(r.battery_self_test_result)}</span></div>
        ${pdfPhoto(getStepPhotoUrlLocal(r, 4), 'Battery Photo')}
      </div>
    </div>

    <div class="ups-print-section">
      <h3>Checks &amp; Maintenance</h3>
      <div class="ups-print-grid">
        <div class="ups-print-field"><span class="ups-print-field-label">Manual Bypass</span><span class="ups-print-field-value">${valOrDash(r.transfer_manual_bypass)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Load Transfer</span><span class="ups-print-field-value">${valOrDash(r.load_transfer_test)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Fan Check</span><span class="ups-print-field-value">${valOrDash(r.cooling_fan_check)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Alarm Cleared</span><span class="ups-print-field-value">${valOrDash(r.error_alarm_log_cleared)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Interior Clean</span><span class="ups-print-field-value">${valOrDash(r.unit_interior_cleaned)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Wiring</span><span class="ups-print-field-value">${valOrDash(r.internal_wiring_inspected)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Firmware</span><span class="ups-print-field-value">${valOrDash(r.firmware_version)}</span></div>
        ${pdfPhoto(getStepPhotoUrlLocal(r, 5), 'Maintenance Photo')}
      </div>
    </div>

    <div class="ups-print-section">
      <h3>Conclusion</h3>
      <div class="ups-print-grid">
        <div class="ups-print-field"><span class="ups-print-field-label">Overall Status</span><span class="ups-print-field-value" style="font-weight:800;">${valOrDash(r.overall_system_status)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Manager Approval</span><span class="ups-print-field-value" style="font-weight:800;">${valOrDash(r.manager_approval_status)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Client Engineer</span><span class="ups-print-field-value">${valOrDash(r.client_engineer_name)}</span></div>
        <div class="ups-print-field"><span class="ups-print-field-label">Servicing Eng.</span><span class="ups-print-field-value">${valOrDash(r.servicing_engineer_name)}</span></div>
        ${r.notes_remarks ? `<div class="ups-print-field" style="grid-column:1/-1;"><span class="ups-print-field-label">Notes</span><span class="ups-print-field-value">${valOrDash(r.notes_remarks)}</span></div>` : ''}
      </div>
    </div>

    ${(r.signature_data || r.client_signature_data) ? `
    <div class="ups-print-section">
      <h3>Signatures</h3>
      <div class="ups-print-sig-row">
        ${r.signature_data ? `<div><div class="ups-print-sig-caption">Technician</div><img src="${r.signature_data}"></div>` : ''}
        ${r.client_signature_data ? `<div><div class="ups-print-sig-caption">Client</div><img src="${r.client_signature_data}"></div>` : ''}
      </div>
    </div>` : ''}

    <div class="ups-print-footer">
      Sangyug Enterprises Ltd &mdash; Generated ${new Date().toLocaleString()}
    </div>
  `;
  window._openPrintWindow(__printHtml, `UPS_Report_${siteName}_${dateStr}`);
};

// Expose for back button in technician view
window.renderTechnicianActivityView = renderTechnicianActivityView;

// Expose for contract service launch
function renderUPSVisitFormWithContract(prefill) {
  renderUPSVisitForm(null, prefill);
}
window.renderUPSVisitFormWithContract = renderUPSVisitFormWithContract;

// ── Exports ────────────────────────────────────────────────────
// renderSubmissionsView is the canonical name (the old renderTechniciansDashboardView
// alias is kept for backward compatibility with any direct call sites).
const renderSubmissionsView = renderTechniciansDashboardView;

export {
  renderTechnicianLogVisitView,
  renderTechnicianActivityView,
  renderTechniciansDashboardView,
  renderSubmissionsView,
  renderUPSVisitFormWithContract,
};
