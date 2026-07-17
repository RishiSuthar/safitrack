// modules/features/forms.js
// Custom Forms — manager creates/edits sectioned form templates;
// technicians fill them (with page-by-page navigation) from "Log Service Visit".
import { state, supabaseClient } from '../state.js';
import { viewContainer } from '../ui/dom.js';
import { showToast, escapeHtml } from '../ui/toast.js';
import { renderSkeletonCards, renderError } from '../utils/helpers.js';

// ── PDF Header helpers (stored in organizations.settings) ─────
export function getPdfHeader() {
  return state.currentOrganization?.settings?.pdf_header || '';
}

async function savePdfHeader(text) {
  const orgId = state.currentOrganization?.id;
  if (!orgId) return;

  const currentSettings = state.currentOrganization?.settings || {};
  const newSettings = { ...currentSettings, pdf_header: text };

  const { error } = await supabaseClient
    .from('organizations')
    .update({ settings: newSettings })
    .eq('id', orgId);

  if (error) {
    showToast('Failed to save header: ' + error.message, 'error');
    return;
  }

  // Update in-memory state so the next PDF render picks it up immediately
  if (state.currentOrganization) {
    state.currentOrganization.settings = newSettings;
  }
}

// ── Field type definitions ─────────────────────────────────────
const FIELD_TYPES = [
  { value: 'text',     label: 'Short Text' },
  { value: 'textarea', label: 'Long Text' },
  { value: 'number',   label: 'Number' },
  { value: 'date',     label: 'Date' },
  { value: 'selector', label: 'Selector' },
  { value: 'select',   label: 'Dropdown' },
  { value: 'photo',    label: 'Photo Upload' },
  { value: 'signature', label: 'Signature' },
  { value: 'group',    label: 'Group' },
];

// Sub-field types (all types except nested groups)
const SUBFIELD_TYPES = FIELD_TYPES.filter(t => t.value !== 'group');

function genId() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `id_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// Normalize stored form.fields (flat legacy array or sectioned array) → sections
function normalizeSections(fieldsData) {
  if (!fieldsData || fieldsData.length === 0) {
    return [{ id: genId(), name: '', fields: [] }];
  }
  if (Array.isArray(fieldsData[0]?.fields)) return fieldsData; // already sectioned
  return [{ id: genId(), name: '', fields: fieldsData }]; // legacy flat → one section
}

// ════════════════════════════════════════════════════════════════
// MAIN VIEW — forms list (no big header, just the button)
// ════════════════════════════════════════════════════════════════
async function renderFormsView() {
  const savedHeader = getPdfHeader();

  viewContainer.innerHTML = `
    <div class="page-header" style="border-bottom:none; padding-bottom:0;">
      <div class="page-header-row" style="justify-content:flex-end;">
        <button class="btn btn-primary" id="new-form-btn">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
          New Form
        </button>
      </div>
    </div>

    ${state.isManager ? `
    <div class="card" style="padding:16px 20px; margin-bottom:20px;">
      <div style="font-size:0.85rem; font-weight:700; margin-bottom:4px;">PDF Header</div>
      <p style="font-size:0.78rem; color:var(--text-muted); margin:0 0 10px 0;">Appears at the top of every downloaded form PDF. Add your company name, phone, email, website, etc.</p>
      <textarea id="pdf-header-input" class="input" rows="3"
        placeholder="e.g. Acme Corp&#10;Tel: +1 800 123 4567  |  info@acme.com&#10;www.acme.com"
        style="width:100%; box-sizing:border-box; resize:vertical; font-size:0.82rem; line-height:1.5;">${escapeHtml(savedHeader)}</textarea>
      <div style="display:flex; justify-content:flex-end; margin-top:8px;">
        <button class="btn btn-primary btn-sm" id="pdf-header-save-btn">Save Header</button>
      </div>
    </div>` : ''}

    <div id="forms-list-container">${renderSkeletonCards(3)}</div>
  `;

  document.getElementById('new-form-btn').addEventListener('click', () => renderFormBuilder(null));

  if (state.isManager) {
    document.getElementById('pdf-header-save-btn').addEventListener('click', async () => {
      const text = document.getElementById('pdf-header-input').value.trim();
      await savePdfHeader(text);
      showToast('PDF header saved', 'success');
    });
  }

  await loadFormsList();
}

async function loadFormsList() {
  const container = document.getElementById('forms-list-container');
  if (!container) return;

  const { data: forms, error } = await supabaseClient
    .from('custom_forms')
    .select('*')
    .eq('organization_id', state.currentOrganization.id)
    .order('created_at', { ascending: false });

  if (error) { container.innerHTML = renderError(error.message); return; }

  if (!forms || forms.length === 0) {
    container.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; padding:60px 20px; text-align:center;">
        <div style="width:64px; height:64px; border-radius:16px; background:var(--bg-secondary); display:flex; align-items:center; justify-content:center; margin-bottom:20px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        </div>
        <h3 style="font-size:1.1rem; margin:0 0 8px 0;">No forms yet</h3>
        <p style="color:var(--text-muted); font-size:0.875rem; margin:0 0 24px 0; max-width:340px;">
          Create your first custom form. Once active, technicians can fill it from the "Log Service Visit" screen.
        </p>
        <button class="btn btn-primary" id="empty-new-form-btn">Create your first form</button>
      </div>
    `;
    document.getElementById('empty-new-form-btn')?.addEventListener('click', () => renderFormBuilder(null));
    return;
  }

  container.innerHTML = `
    <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap:16px;">
      ${forms.map(f => renderFormCard(f)).join('')}
    </div>
  `;
}

function renderFormCard(form) {
  const sections = normalizeSections(form.fields);
  const totalFields = sections.reduce((sum, s) => sum + (s.fields?.length || 0), 0);
  const sectionCount = sections.length;
  const safeName = escapeHtml(form.name);
  const meta = sectionCount > 1
    ? `${sectionCount} pages · ${totalFields} field${totalFields !== 1 ? 's' : ''}`
    : `${totalFields} field${totalFields !== 1 ? 's' : ''}`;

  return `
    <div class="card" style="padding:20px;">
      <div style="display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:10px; gap:10px;">
        <div style="flex:1; min-width:0;">
          <h3 style="font-size:0.95rem; font-weight:700; margin:0 0 4px 0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${safeName}</h3>
          ${form.description ? `<p style="font-size:0.78rem; color:var(--text-muted); margin:0; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${escapeHtml(form.description)}</p>` : ''}
        </div>
        <span style="flex-shrink:0; font-size:11px; font-weight:600; padding:2px 8px; border-radius:12px;
          ${form.is_active ? 'background:rgba(5,150,105,0.1); color:#059669;' : 'background:rgba(107,114,128,0.12); color:var(--text-muted);'}">
          ${form.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>
      <p style="font-size:0.8rem; color:var(--text-muted); margin:0 0 16px 0;">${meta}</p>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-secondary btn-sm" style="flex:1;" onclick="window._editForm('${form.id}')">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Edit
        </button>
        <button class="btn btn-secondary btn-sm" title="${form.is_active ? 'Deactivate' : 'Activate'}"
          onclick="window._toggleFormActive('${form.id}', ${!form.is_active})">
          ${form.is_active
            ? `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
            : `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`}
        </button>
        <button class="btn btn-sm" style="color:#ef4444; border:1px solid rgba(239,68,68,0.3);"
          onclick="window._deleteForm('${form.id}', '${safeName.replace(/'/g, "\\'")}')">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </div>
    </div>
  `;
}

// ════════════════════════════════════════════════════════════════
// FORM BUILDER — sectioned, inline view
// ════════════════════════════════════════════════════════════════
let _builderSections = [];
let _fbDragSIdx = null, _fbDragFIdx = null;

function renderFormBuilder(existingForm) {
  _builderSections = existingForm
    ? JSON.parse(JSON.stringify(normalizeSections(existingForm.fields || [])))
    : [{ id: genId(), name: '', fields: [] }];

  viewContainer.innerHTML = `
    <div style="max-width:720px; margin:0 auto; padding-bottom:80px;">

      <div style="display:flex; align-items:center; gap:12px; margin-bottom:24px;">
        <button class="btn btn-secondary btn-sm" id="fb-back-btn">← Back</button>
        <h2 style="margin:0; font-size:1.2rem; font-weight:700;">${existingForm ? 'Edit Form' : 'New Form'}</h2>
      </div>

      <!-- Form name + description -->
      <div class="card" style="padding:20px; margin-bottom:20px;">
        <div style="margin-bottom:14px;">
          <label style="display:block; font-size:0.85rem; font-weight:600; margin-bottom:6px;">
            Form Name <span style="color:#ef4444;">*</span>
          </label>
          <input type="text" id="fb-name" class="input"
            placeholder="e.g. Generator Maintenance Report"
            value="${existingForm ? escapeHtml(existingForm.name) : ''}"
            style="width:100%; box-sizing:border-box;">
        </div>
        <div>
          <label style="display:block; font-size:0.85rem; font-weight:600; margin-bottom:6px;">Description</label>
          <textarea id="fb-desc" class="input" rows="2"
            placeholder="Optional — shown to technicians when they open the form"
            style="width:100%; box-sizing:border-box; resize:vertical;">${existingForm ? escapeHtml(existingForm.description || '') : ''}</textarea>
        </div>
      </div>

      <!-- Sections container -->
      <div id="fb-sections-container"></div>

      <!-- Add section -->
      <button class="btn btn-secondary btn-sm" id="fb-add-section-btn" style="margin-bottom:24px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
        Add Page
      </button>

      <div style="display:flex; justify-content:flex-end; gap:10px; padding-top:16px; border-top:1px solid var(--border-color);">
        <button class="btn btn-secondary" id="fb-cancel-btn">Cancel</button>
        <button class="btn btn-primary" id="fb-save-btn">${existingForm ? 'Save Changes' : 'Create Form'}</button>
      </div>
    </div>
  `;

  rebuildSections();

  document.getElementById('fb-back-btn').addEventListener('click', () => renderFormsView());
  document.getElementById('fb-cancel-btn').addEventListener('click', () => renderFormsView());
  document.getElementById('fb-add-section-btn').addEventListener('click', () => {
    _builderSections.push({ id: genId(), name: '', fields: [] });
    rebuildSections();
    setTimeout(() => {
      document.querySelectorAll('.fb-section-card')[_builderSections.length - 1]
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  });
  document.getElementById('fb-save-btn').addEventListener('click', () => handleSaveForm(existingForm?.id || null));
}

// ── Render all sections ───────────────────────────────────────
function rebuildSections() {
  const container = document.getElementById('fb-sections-container');
  if (!container) return;
  const isMultiPage = _builderSections.length > 1;

  container.innerHTML = _builderSections.map((section, sIdx) => `
    <div class="card fb-section-card" style="padding:16px; margin-bottom:16px;">

      <div style="display:flex; align-items:center; gap:10px; margin-bottom:14px;">
        <span style="font-size:0.7rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em; flex-shrink:0;">
          ${isMultiPage ? `Page ${sIdx + 1}` : 'Fields'}
        </span>
        ${isMultiPage ? `
        <input type="text" class="input fb-section-name" data-sidx="${sIdx}"
          value="${escapeHtml(section.name || '')}"
          placeholder="Page title (e.g. Site Information)"
          style="flex:1; font-size:0.85rem;">
        <button class="btn btn-sm" title="Remove page"
          style="color:#ef4444; border:1px solid rgba(239,68,68,0.3); flex-shrink:0;"
          onclick="window._fbRemoveSection(${sIdx})">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>` : ''}
      </div>

      <div id="fb-fields-list-${sIdx}">
        ${section.fields.length === 0
          ? `<p style="text-align:center; padding:16px; border:2px dashed var(--border-color); border-radius:8px; color:var(--text-muted); font-size:0.82rem; margin-bottom:8px;">No fields yet — click "Add Field" below</p>`
          : section.fields.map((field, fIdx) => renderBuilderField(sIdx, fIdx, field)).join('')}
      </div>

      <button class="btn btn-secondary btn-sm" style="margin-top:8px; width:100%;"
        onclick="window._fbAddField(${sIdx})">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
        Add Field
      </button>
    </div>
  `).join('');

  // Live-sync section name inputs
  container.querySelectorAll('.fb-section-name').forEach(el => {
    el.addEventListener('input', e => { _builderSections[+e.target.dataset.sidx].name = e.target.value; });
  });

  attachFieldListeners();
}

// ── Render a single field card within the builder ────────────
function renderBuilderField(sIdx, fIdx, field) {
  const typeOptions = FIELD_TYPES.map(t =>
    `<option value="${t.value}" ${field.type === t.value ? 'selected' : ''}>${t.label}</option>`
  ).join('');

  let extraHtml = '';
  if (field.type === 'select' || field.type === 'selector') {
    extraHtml = `<div id="fb-options-container-${sIdx}-${fIdx}">${renderOptionsUI(sIdx, fIdx, field.options || [])}</div>`;
  } else if (field.type === 'group') {
    extraHtml = renderBuilderSubfieldsList(sIdx, fIdx, field.subfields || []);
  } else if (field.type !== 'photo' && field.type !== 'date' && field.type !== 'signature') {
    extraHtml = `
      <input type="text" class="input fb-field-placeholder" data-sidx="${sIdx}" data-fidx="${fIdx}"
        value="${escapeHtml(field.placeholder || '')}"
        placeholder="Placeholder text (optional)"
        style="flex:1; font-size:0.8rem; box-sizing:border-box;">`;
  }

  return `
    <div class="card fb-field-card" draggable="true" data-sidx="${sIdx}" data-fidx="${fIdx}" style="padding:12px; margin-bottom:8px; background:var(--bg-secondary);">
      <div style="display:grid; grid-template-columns:20px 1fr 140px auto; gap:8px; align-items:end; margin-bottom:8px;">
        <div class="fb-drag-handle" title="Drag to reorder">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>
        </div>
        <div>
          <label style="display:block; font-size:0.72rem; font-weight:600; color:var(--text-muted); margin-bottom:3px;">Label *</label>
          <input type="text" class="input fb-field-label" data-sidx="${sIdx}" data-fidx="${fIdx}"
            value="${escapeHtml(field.label || '')}" placeholder="e.g. Site Name"
            style="width:100%; box-sizing:border-box; font-size:0.85rem;">
        </div>
        <div>
          <label style="display:block; font-size:0.72rem; font-weight:600; color:var(--text-muted); margin-bottom:3px;">Type</label>
          ${window.buildCrmDropdown
            ? window.buildCrmDropdown({
                id: `fb-field-type-${sIdx}-${fIdx}`,
                options: FIELD_TYPES.map(t => ({ value: t.value, label: t.label })),
                value: field.type,
                variant: 'form'
              })
            : `<select class="input fb-field-type" data-sidx="${sIdx}" data-fidx="${fIdx}" style="width:100%; font-size:0.85rem;">${typeOptions}</select>`}
        </div>
        <button class="btn btn-sm"
          style="color:#ef4444; border:1px solid rgba(239,68,68,0.3); margin-top:14px; flex-shrink:0;"
          onclick="window._fbRemoveField(${sIdx},${fIdx})">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div style="display:flex; gap:12px; align-items:flex-start; flex-wrap:wrap; padding-left:22px;">
        ${field.type !== 'group' ? `<label style="display:flex; align-items:center; gap:5px; font-size:0.8rem; cursor:pointer; flex-shrink:0; padding-top:${(field.type === 'select' || field.type === 'selector') ? '0' : '4px'};">
          <input type="checkbox" class="fb-field-required" data-sidx="${sIdx}" data-fidx="${fIdx}" ${field.required ? 'checked' : ''}>
          Required
        </label>` : ''}
        <div style="flex:1; min-width:0;">${extraHtml}</div>
      </div>
    </div>
  `;
}

// ── Subfields list for Group type ────────────────────────────
function renderBuilderSubfieldsList(sIdx, fIdx, subfields) {
  const sfRows = subfields.map((sf, sfIdx) => {
    let sfExtra = '';
    if (sf.type === 'select' || sf.type === 'selector') {
      sfExtra = `<div id="fb-sf-options-container-${sIdx}-${fIdx}-${sfIdx}" style="margin-top:6px;">${renderSubfieldOptionsUI(sIdx, fIdx, sfIdx, sf.options || [])}</div>`;
    } else if (sf.type !== 'photo' && sf.type !== 'date' && sf.type !== 'signature') {
      sfExtra = `<input type="text" class="input fb-sf-placeholder" data-sidx="${sIdx}" data-fidx="${fIdx}" data-sfidx="${sfIdx}" value="${escapeHtml(sf.placeholder || '')}" placeholder="Placeholder (optional)" style="font-size:0.8rem; margin-top:6px; width:100%; box-sizing:border-box;">`;
    }
    return `
      <div class="fb-subfield-card">
        <div class="fb-subfield-card-top">
          <input type="text" class="input fb-sf-label" data-sidx="${sIdx}" data-fidx="${fIdx}" data-sfidx="${sfIdx}"
            value="${escapeHtml(sf.label || '')}" placeholder="Subfield label" style="flex:1; font-size:0.82rem; min-width:0;">
          <div style="flex-shrink:0; min-width:120px;">
            ${window.buildCrmDropdown
              ? window.buildCrmDropdown({
                  id: `fb-sf-type-${sIdx}-${fIdx}-${sfIdx}`,
                  options: SUBFIELD_TYPES.map(t => ({ value: t.value, label: t.label })),
                  value: sf.type || 'text',
                  variant: 'form'
                })
              : `<select class="input fb-sf-type" data-sidx="${sIdx}" data-fidx="${fIdx}" data-sfidx="${sfIdx}" style="width:100%; font-size:0.82rem;">${SUBFIELD_TYPES.map(t => `<option value="${t.value}" ${sf.type === t.value ? 'selected' : ''}>${t.label}</option>`).join('')}</select>`}
          </div>
          <label style="display:flex; align-items:center; gap:4px; font-size:0.78rem; cursor:pointer; white-space:nowrap; flex-shrink:0;">
            <input type="checkbox" class="fb-sf-required" data-sidx="${sIdx}" data-fidx="${fIdx}" data-sfidx="${sfIdx}" ${sf.required ? 'checked' : ''}>
            Req
          </label>
          <button type="button" class="btn btn-sm" style="color:#ef4444; border:1px solid rgba(239,68,68,0.3); flex-shrink:0;"
            onclick="window._fbRemoveSubfield(${sIdx},${fIdx},${sfIdx})">
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        ${sfExtra ? `<div class="fb-subfield-card-extra">${sfExtra}</div>` : ''}
      </div>`;
  }).join('');

  return `
    <div class="fb-subfields-wrap" id="fb-subfields-${sIdx}-${fIdx}">
      <div class="fb-subfields-list">${sfRows}</div>
      <button type="button" class="btn btn-secondary btn-sm" style="margin-top:6px;"
        onclick="window._fbAddSubfield(${sIdx},${fIdx})">+ Add Subfield</button>
    </div>`;
}

// ── Options UI for subfields (selector / dropdown) ────────────
function renderSubfieldOptionsUI(sIdx, fIdx, sfIdx, options) {
  const chips = options.length > 0
    ? `<div style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom:8px;">
        ${options.map((opt, oIdx) => `
          <span style="display:inline-flex; align-items:center; gap:3px; background:var(--bg-primary); border:1px solid var(--border-color); border-radius:6px; padding:2px 6px 2px 8px; font-size:0.78rem; white-space:nowrap;">
            ${escapeHtml(opt)}
            <button type="button" onclick="window._fbRemoveSubfieldOption(${sIdx},${fIdx},${sfIdx},${oIdx})"
              style="background:none; border:none; cursor:pointer; color:var(--text-muted); font-size:14px; padding:0 1px; line-height:1; display:flex; align-items:center;">×</button>
          </span>`).join('')}
      </div>`
    : '';
  return `
    ${chips}
    <div style="display:flex; gap:6px;">
      <input type="text" id="fb-sf-opt-input-${sIdx}-${fIdx}-${sfIdx}" class="input"
        placeholder="Type an option, then click Add" style="flex:1; font-size:0.8rem;">
      <button type="button" class="btn btn-secondary btn-sm"
        onclick="window._fbAddSubfieldOption(${sIdx},${fIdx},${sfIdx})">Add</button>
    </div>`;
}

// ── Options add/remove UI (replaces comma-separated input) ───
function renderOptionsUI(sIdx, fIdx, options) {
  const chips = options.length > 0
    ? `<div style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom:8px;">
        ${options.map((opt, oIdx) => `
          <span style="display:inline-flex; align-items:center; gap:3px; background:var(--bg-primary); border:1px solid var(--border-color); border-radius:6px; padding:2px 6px 2px 8px; font-size:0.78rem; white-space:nowrap;">
            ${escapeHtml(opt)}
            <button type="button" onclick="window._fbRemoveOption(${sIdx},${fIdx},${oIdx})"
              style="background:none; border:none; cursor:pointer; color:var(--text-muted); font-size:14px; padding:0 1px; line-height:1; display:flex; align-items:center;">×</button>
          </span>`).join('')}
      </div>`
    : '';

  return `
    ${chips}
    <div style="display:flex; gap:6px;">
      <input type="text" id="fb-opt-input-${sIdx}-${fIdx}" class="input"
        placeholder="Type an option, then click Add"
        style="flex:1; font-size:0.8rem;">
      <button type="button" class="btn btn-secondary btn-sm"
        onclick="window._fbAddOption(${sIdx},${fIdx})">Add</button>
    </div>
  `;
}

// ── Attach live-sync listeners on all field inputs ────────────
function attachFieldListeners() {
  const container = document.getElementById('fb-sections-container');
  if (!container) return;

  container.querySelectorAll('.fb-field-label').forEach(el => {
    el.addEventListener('input', e => {
      _builderSections[+e.target.dataset.sidx].fields[+e.target.dataset.fidx].label = e.target.value;
    });
  });
  // CRM dropdown type selectors — change fires on the hidden value input
  container.querySelectorAll('.crm-dd-value-input[id^="fb-field-type-"]').forEach(el => {
    el.addEventListener('change', () => {
      const [si, fi] = el.id.replace('fb-field-type-', '').split('-').map(Number);
      _builderSections[si].fields[fi].type = el.value;
      _builderSections[si].fields[fi].options = [];
      _builderSections[si].fields[fi].placeholder = '';
      _builderSections[si].fields[fi].subfields = [];
      rebuildSectionFields(si);
    });
  });
  // Fallback: native select (when buildCrmDropdown not yet loaded)
  container.querySelectorAll('.fb-field-type').forEach(el => {
    el.addEventListener('change', e => {
      const si = +e.target.dataset.sidx, fi = +e.target.dataset.fidx;
      _builderSections[si].fields[fi].type = e.target.value;
      _builderSections[si].fields[fi].options = [];
      _builderSections[si].fields[fi].placeholder = '';
      _builderSections[si].fields[fi].subfields = [];
      rebuildSectionFields(si);
    });
  });
  container.querySelectorAll('.fb-field-required').forEach(el => {
    el.addEventListener('change', e => {
      _builderSections[+e.target.dataset.sidx].fields[+e.target.dataset.fidx].required = e.target.checked;
    });
  });
  container.querySelectorAll('.fb-field-placeholder').forEach(el => {
    el.addEventListener('input', e => {
      _builderSections[+e.target.dataset.sidx].fields[+e.target.dataset.fidx].placeholder = e.target.value;
    });
  });
  // Enter key on option inputs
  container.querySelectorAll('[id^="fb-opt-input-"]').forEach(el => {
    const [sIdx, fIdx] = el.id.replace('fb-opt-input-', '').split('-').map(Number);
    el.addEventListener('keypress', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); window._fbAddOption(sIdx, fIdx); }
    });
  });

  // Subfield listeners (label, type, required, placeholder, options)
  container.querySelectorAll('.fb-sf-label').forEach(el => {
    el.addEventListener('input', e => {
      const si = +e.target.dataset.sidx, fi = +e.target.dataset.fidx, sfi = +e.target.dataset.sfidx;
      _builderSections[si].fields[fi].subfields[sfi].label = e.target.value;
    });
  });
  // CRM dropdown subfield type change
  container.querySelectorAll('.crm-dd-value-input[id^="fb-sf-type-"]').forEach(el => {
    el.addEventListener('change', () => {
      const parts = el.id.replace('fb-sf-type-', '').split('-').map(Number);
      const [si, fi, sfi] = parts;
      const sf = _builderSections[si].fields[fi].subfields[sfi];
      sf.type = el.value;
      sf.options = [];
      sf.placeholder = '';
      rebuildSectionFields(si);
    });
  });
  // Fallback native select for subfield type
  container.querySelectorAll('.fb-sf-type').forEach(el => {
    el.addEventListener('change', e => {
      const si = +e.target.dataset.sidx, fi = +e.target.dataset.fidx, sfi = +e.target.dataset.sfidx;
      const sf = _builderSections[si].fields[fi].subfields[sfi];
      sf.type = e.target.value;
      sf.options = [];
      sf.placeholder = '';
      rebuildSectionFields(si);
    });
  });
  container.querySelectorAll('.fb-sf-required').forEach(el => {
    el.addEventListener('change', e => {
      const si = +e.target.dataset.sidx, fi = +e.target.dataset.fidx, sfi = +e.target.dataset.sfidx;
      _builderSections[si].fields[fi].subfields[sfi].required = e.target.checked;
    });
  });
  container.querySelectorAll('.fb-sf-placeholder').forEach(el => {
    el.addEventListener('input', e => {
      const si = +e.target.dataset.sidx, fi = +e.target.dataset.fidx, sfi = +e.target.dataset.sfidx;
      _builderSections[si].fields[fi].subfields[sfi].placeholder = e.target.value;
    });
  });
  // Enter key on subfield option inputs
  container.querySelectorAll('[id^="fb-sf-opt-input-"]').forEach(el => {
    const parts = el.id.replace('fb-sf-opt-input-', '').split('-').map(Number);
    el.addEventListener('keypress', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); window._fbAddSubfieldOption(...parts); }
    });
  });

  // Drag-and-drop reorder within a section
  container.querySelectorAll('.fb-field-card').forEach(card => {
    card.addEventListener('dragstart', e => {
      _fbDragSIdx = +card.dataset.sidx;
      _fbDragFIdx = +card.dataset.fidx;
      card.classList.add('fb-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', '');
    });
    card.addEventListener('dragend', () => card.classList.remove('fb-dragging'));
    card.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      card.classList.add('fb-drag-over');
    });
    card.addEventListener('dragleave', () => card.classList.remove('fb-drag-over'));
    card.addEventListener('drop', e => {
      e.preventDefault();
      card.classList.remove('fb-drag-over');
      const tSIdx = +card.dataset.sidx;
      const tFIdx = +card.dataset.fidx;
      if (_fbDragSIdx === null || _fbDragSIdx !== tSIdx || _fbDragFIdx === tFIdx) return;
      const fields = _builderSections[tSIdx].fields;
      const [moved] = fields.splice(_fbDragFIdx, 1);
      fields.splice(tFIdx, 0, moved);
      _fbDragSIdx = null; _fbDragFIdx = null;
      rebuildSectionFields(tSIdx);
    });
  });

  // Initialise all CRM dropdowns now in DOM (type selectors)
  if (window.initAllCrmDropdowns) window.initAllCrmDropdowns(container);
}

function rebuildSectionFields(sIdx) {
  const listEl = document.getElementById(`fb-fields-list-${sIdx}`);
  if (!listEl) return;
  const section = _builderSections[sIdx];
  listEl.innerHTML = section.fields.length === 0
    ? `<p style="text-align:center; padding:16px; border:2px dashed var(--border-color); border-radius:8px; color:var(--text-muted); font-size:0.82rem; margin-bottom:8px;">No fields yet — click "Add Field" below</p>`
    : section.fields.map((field, fIdx) => renderBuilderField(sIdx, fIdx, field)).join('');
  attachFieldListeners();
}

// ── Window-exposed builder actions ────────────────────────────
window._fbAddField = function (sIdx) {
  _builderSections[sIdx].fields.push({ id: genId(), label: '', type: 'text', required: false, placeholder: '', options: [] });
  rebuildSectionFields(sIdx);
};

window._fbRemoveField = function (sIdx, fIdx) {
  _builderSections[sIdx].fields.splice(fIdx, 1);
  rebuildSectionFields(sIdx);
};

window._fbAddSubfield = function (sIdx, fIdx) {
  const field = _builderSections[sIdx].fields[fIdx];
  if (!field.subfields) field.subfields = [];
  field.subfields.push({ id: genId(), label: '', type: 'text', required: false, placeholder: '', options: [] });
  rebuildSectionFields(sIdx);
};

window._fbRemoveSubfield = function (sIdx, fIdx, sfIdx) {
  _builderSections[sIdx].fields[fIdx].subfields.splice(sfIdx, 1);
  rebuildSectionFields(sIdx);
};

window._fbAddSubfieldOption = function (sIdx, fIdx, sfIdx) {
  const input = document.getElementById(`fb-sf-opt-input-${sIdx}-${fIdx}-${sfIdx}`);
  const val = input?.value.trim();
  if (!val) return;
  const sf = _builderSections[sIdx].fields[fIdx].subfields[sfIdx];
  if (!sf.options) sf.options = [];
  sf.options.push(val);
  if (input) input.value = '';
  const cont = document.getElementById(`fb-sf-options-container-${sIdx}-${fIdx}-${sfIdx}`);
  if (cont) cont.innerHTML = renderSubfieldOptionsUI(sIdx, fIdx, sfIdx, sf.options);
  attachFieldListeners();
};

window._fbRemoveSubfieldOption = function (sIdx, fIdx, sfIdx, oIdx) {
  const sf = _builderSections[sIdx].fields[fIdx].subfields[sfIdx];
  sf.options.splice(oIdx, 1);
  const cont = document.getElementById(`fb-sf-options-container-${sIdx}-${fIdx}-${sfIdx}`);
  if (cont) cont.innerHTML = renderSubfieldOptionsUI(sIdx, fIdx, sfIdx, sf.options);
  attachFieldListeners();
};

window._fbRemoveSection = async function (sIdx) {
  if (_builderSections.length <= 1) return;
  const confirmed = await window.showConfirmDialog('Remove Page', `Remove page ${sIdx + 1} and all its fields? This cannot be undone.`);
  if (!confirmed) return;
  _builderSections.splice(sIdx, 1);
  rebuildSections();
};

window._fbAddOption = function (sIdx, fIdx) {
  const input = document.getElementById(`fb-opt-input-${sIdx}-${fIdx}`);
  if (!input) return;
  const val = input.value.trim();
  if (!val) return;
  if (!_builderSections[sIdx].fields[fIdx].options) _builderSections[sIdx].fields[fIdx].options = [];
  _builderSections[sIdx].fields[fIdx].options.push(val);
  input.value = '';
  const cont = document.getElementById(`fb-options-container-${sIdx}-${fIdx}`);
  if (cont) {
    cont.innerHTML = renderOptionsUI(sIdx, fIdx, _builderSections[sIdx].fields[fIdx].options);
    const newInput = document.getElementById(`fb-opt-input-${sIdx}-${fIdx}`);
    if (newInput) {
      newInput.focus();
      newInput.addEventListener('keypress', ev => {
        if (ev.key === 'Enter') { ev.preventDefault(); window._fbAddOption(sIdx, fIdx); }
      });
    }
  }
};

window._fbRemoveOption = function (sIdx, fIdx, oIdx) {
  _builderSections[sIdx].fields[fIdx].options.splice(oIdx, 1);
  const cont = document.getElementById(`fb-options-container-${sIdx}-${fIdx}`);
  if (cont) {
    cont.innerHTML = renderOptionsUI(sIdx, fIdx, _builderSections[sIdx].fields[fIdx].options);
    const newInput = document.getElementById(`fb-opt-input-${sIdx}-${fIdx}`);
    if (newInput) {
      newInput.addEventListener('keypress', ev => {
        if (ev.key === 'Enter') { ev.preventDefault(); window._fbAddOption(sIdx, fIdx); }
      });
    }
  }
};

// ── Save form ─────────────────────────────────────────────────
async function handleSaveForm(existingFormId) {
  const name = document.getElementById('fb-name')?.value.trim();
  const desc = document.getElementById('fb-desc')?.value.trim();

  if (!name) {
    showToast('Please enter a form name.', 'error');
    document.getElementById('fb-name')?.focus();
    return;
  }

  const totalFields = _builderSections.reduce((sum, s) => sum + s.fields.length, 0);
  if (totalFields === 0) {
    showToast('Please add at least one field.', 'error');
    return;
  }

  for (let si = 0; si < _builderSections.length; si++) {
    for (let fi = 0; fi < _builderSections[si].fields.length; fi++) {
      if (!_builderSections[si].fields[fi].label.trim()) {
        showToast(`Page ${si + 1}, field ${fi + 1} needs a label.`, 'error');
        return;
      }
    }
  }

  const saveBtn = document.getElementById('fb-save-btn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  try {
    const payload = {
      name,
      description: desc || null,
      fields: _builderSections, // sections array saved in the fields JSONB column
      organization_id: state.currentOrganization.id,
      updated_at: new Date().toISOString()
    };
    let error;
    if (existingFormId) {
      ({ error } = await supabaseClient.from('custom_forms').update(payload).eq('id', existingFormId));
    } else {
      payload.created_by = state.currentUser.id;
      ({ error } = await supabaseClient.from('custom_forms').insert(payload));
    }
    if (error) throw error;
    showToast(existingFormId ? 'Form updated!' : 'Form created!', 'success');
    renderFormsView();
  } catch (err) {
    showToast(`Failed to save: ${err.message}`, 'error');
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = existingFormId ? 'Save Changes' : 'Create Form';
    }
  }
}

// ── Window-exposed card actions ───────────────────────────────
window._editForm = async function (formId) {
  const { data: form, error } = await supabaseClient
    .from('custom_forms').select('*').eq('id', formId).single();
  if (error || !form) { showToast('Failed to load form', 'error'); return; }
  renderFormBuilder(form);
};

window._toggleFormActive = async function (formId, isActive) {
  const { error } = await supabaseClient
    .from('custom_forms')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', formId);
  if (error) { showToast('Failed to update', 'error'); return; }
  showToast(isActive ? 'Form activated' : 'Form deactivated', 'success');
  await loadFormsList();
};

window._deleteForm = async function (formId, formName) {
  const confirmed = await window.showConfirmDialog('Delete Form', `Delete "${formName}"? This permanently deletes the form and all its submissions. This cannot be undone.`);
  if (!confirmed) return;
  const { error } = await supabaseClient.from('custom_forms').delete().eq('id', formId);
  if (error) { showToast('Failed to delete: ' + error.message, 'error'); return; }
  showToast('Form deleted', 'success');
  await loadFormsList();
};

// ── Exports ───────────────────────────────────────────────────
export { renderFormsView, normalizeSections };
