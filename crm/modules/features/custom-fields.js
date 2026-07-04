// modules/features/custom-fields.js
// Shared utility for custom field definitions and values.
// Used by companies.js, people.js, call-logs.js (view modals), and settings.js.

import { state, supabaseClient } from '../state.js';
import { showToast, escapeHtml } from '../ui/toast.js';
import { formatDate } from '../utils/helpers.js';

// ── In-memory cache keyed by entity type ─────────────────────────────────────
// Populated on first fetch, invalidated from settings when definitions change.
const _defCache = { company: null, person: null };

/**
 * Fetch custom field definitions for an entity type.
 * Returns a sorted array of definition objects. Caches in memory.
 */
async function fetchCustomFieldDefinitions(entityType) {
  if (_defCache[entityType]) return _defCache[entityType];

  const orgId = state.currentOrganization?.id;
  if (!orgId) return [];

  const { data, error } = await supabaseClient
    .from('custom_field_definitions')
    .select('*')
    .eq('organization_id', orgId)
    .eq('entity_type', entityType)
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('Error fetching custom field definitions:', error);
    return [];
  }

  _defCache[entityType] = data || [];
  return _defCache[entityType];
}

/**
 * Fetch custom field values for a specific entity.
 * Returns a Map of definition_id → value string.
 */
async function fetchCustomFieldValues(entityType, entityId) {
  if (!entityId) return new Map();

  const orgId = state.currentOrganization?.id;
  if (!orgId) return new Map();

  const { data, error } = await supabaseClient
    .from('custom_field_values')
    .select('definition_id, value')
    .eq('organization_id', orgId)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId);

  if (error) {
    console.error('Error fetching custom field values:', error);
    return new Map();
  }

  const map = new Map();
  (data || []).forEach(row => map.set(row.definition_id, row.value));
  return map;
}

/**
 * Render custom field form inputs into a container element.
 * @param {string} entityType - 'company' or 'person'
 * @param {string} containerId - DOM id of the container div
 * @param {Map|null} existingValues - Map of definition_id → value (for edit mode)
 * @param {boolean} disabled - If true, all inputs are disabled (view-only mode)
 */
async function renderCustomFieldsForm(entityType, containerId, existingValues = null, disabled = false) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const defs = await fetchCustomFieldDefinitions(entityType);
  if (!defs || defs.length === 0) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }

  container.style.display = '';

  const fieldsHtml = defs.map(def => {
    const val = existingValues ? (existingValues.get(def.id) || '') : '';
    const requiredAttr = def.is_required ? 'required' : '';
    const requiredLabel = def.is_required ? ' <span class="required-indicator">(required)</span>' : '';
    const disabledAttr = disabled ? 'disabled' : '';
    const inputId = `cf-${entityType}-${def.field_key}`;

    let inputHtml = '';

    switch (def.field_type) {
      case 'text':
        inputHtml = `<input type="text" id="${inputId}" data-cf-id="${def.id}" data-cf-type="${def.field_type}"
          placeholder="Enter ${escapeHtml(def.field_name).toLowerCase()}..." value="${escapeHtml(val)}" ${requiredAttr} ${disabledAttr}>`;
        break;

      case 'number':
        inputHtml = `<input type="number" id="${inputId}" data-cf-id="${def.id}" data-cf-type="${def.field_type}"
          placeholder="0" value="${escapeHtml(val)}" step="any" ${requiredAttr} ${disabledAttr}>`;
        break;

      case 'date':
        inputHtml = `<input type="date" id="${inputId}" data-cf-id="${def.id}" data-cf-type="${def.field_type}"
          value="${escapeHtml(val)}" ${requiredAttr} ${disabledAttr}>`;
        break;

      case 'url':
        inputHtml = `<input type="url" id="${inputId}" data-cf-id="${def.id}" data-cf-type="${def.field_type}"
          placeholder="https://..." value="${escapeHtml(val)}" ${requiredAttr} ${disabledAttr}>`;
        break;

      case 'checkbox':
        inputHtml = `
          <label class="cf-checkbox-label" for="${inputId}">
            <span class="ios-toggle">
              <input type="checkbox" id="${inputId}" data-cf-id="${def.id}" data-cf-type="${def.field_type}"
                ${val === 'true' ? 'checked' : ''} ${disabledAttr}>
              <span class="ios-toggle-slider" aria-hidden="true"></span>
            </span>
            <span class="cf-checkbox-text">${val === 'true' ? 'Yes' : 'No'}</span>
          </label>`;
        break;

      case 'select': {
        const options = Array.isArray(def.field_options) ? def.field_options : [];
        const optionsHtml = options.map(opt => {
          const isSelected = opt === val;
          return `<li class="crm-dd-option ${isSelected ? 'is-selected' : ''}" role="option" data-value="${escapeHtml(opt)}" data-label="${escapeHtml(opt)}" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>${escapeHtml(opt)}</li>`;
        }).join('');

        const label = val ? escapeHtml(val) : 'Select...';

        inputHtml = `
          <div class="crm-dd crm-dd--form" data-dd-id="${inputId}">
            <button type="button" class="crm-dd-trigger ${val ? 'has-value' : ''}" aria-haspopup="listbox" aria-expanded="false" ${disabledAttr}>
              <span class="crm-dd-label">${label}</span>
              <span class="crm-dd-chevron"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>
            </button>
            <div class="crm-dd-panel" role="listbox">
              <ul class="crm-dd-list">
                <li class="crm-dd-option ${!val ? 'is-selected' : ''}" role="option" data-value="" data-label="Select..." tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Select...</li>
                ${optionsHtml}
              </ul>
            </div>
            <input class="crm-dd-value-input" type="hidden" id="${inputId}" data-cf-id="${def.id}" data-cf-type="${def.field_type}" ${requiredAttr} value="${escapeHtml(val)}">
          </div>`;
        break;
      }

      default:
        inputHtml = `<input type="text" id="${inputId}" data-cf-id="${def.id}" data-cf-type="${def.field_type}"
          value="${escapeHtml(val)}" ${requiredAttr} ${disabledAttr}>`;
    }

    return `
      <div class="form-field">
        <label for="${inputId}">${escapeHtml(def.field_name)}${requiredLabel}</label>
        ${inputHtml}
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="form-section">
      <div class="form-section-header"><div class="form-section-title">Custom Fields</div></div>
      ${fieldsHtml}
    </div>
  `;

  if (window.initCustomCalendar) {
    window.initCustomCalendar(`#${container.id} input[type="date"]`, { type: 'date' });
  }

  // Wire up checkbox toggle text updates
  container.querySelectorAll('input[data-cf-type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const textEl = cb.closest('.cf-checkbox-label')?.querySelector('.cf-checkbox-text');
      if (textEl) textEl.textContent = cb.checked ? 'Yes' : 'No';
    });
  });
}

/**
 * Collect current custom field values from the form container.
 * Returns an array of { definition_id, value } objects.
 */
function collectCustomFieldValues(entityType, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return [];

  const values = [];
  container.querySelectorAll('[data-cf-id]').forEach(input => {
    const defId = input.dataset.cfId;
    const type = input.dataset.cfType;
    let val;

    if (type === 'checkbox') {
      val = input.checked ? 'true' : 'false';
    } else {
      val = (input.value || '').trim();
    }

    values.push({ definition_id: defId, value: val || null });
  });

  return values;
}

/**
 * Validate required custom fields. Returns true if valid, false otherwise.
 */
function validateCustomFields(entityType, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return true;

  const requiredInputs = container.querySelectorAll('[data-cf-id][required]');
  for (const input of requiredInputs) {
    const val = (input.value || '').trim();
    if (!val) {
      const label = input.closest('.form-field')?.querySelector('label')?.textContent || 'Custom field';
      showToast(`Please fill in required field: ${label.replace('(required)', '').trim()}`, 'error');
      input.focus();
      return false;
    }
  }
  return true;
}

/**
 * Save custom field values to Supabase (upsert).
 * @param {string} entityType - 'company' or 'person'
 * @param {string} entityId - UUID of the company or person
 * @param {Array} values - Array of { definition_id, value } from collectCustomFieldValues
 */
async function saveCustomFieldValues(entityType, entityId, values) {
  if (!values || values.length === 0) return;

  const orgId = state.currentOrganization?.id;
  if (!orgId || !entityId) return;

  // Build upsert rows
  const rows = values
    .filter(v => v.value !== null && v.value !== '')
    .map(v => ({
      organization_id: orgId,
      definition_id: v.definition_id,
      entity_type: entityType,
      entity_id: entityId,
      value: v.value,
    }));

  // Delete values that were cleared (set to null/empty)
  const clearedDefIds = values
    .filter(v => v.value === null || v.value === '')
    .map(v => v.definition_id);

  if (clearedDefIds.length > 0) {
    await supabaseClient
      .from('custom_field_values')
      .delete()
      .eq('entity_id', entityId)
      .eq('entity_type', entityType)
      .in('definition_id', clearedDefIds);
  }

  if (rows.length > 0) {
    const { error } = await supabaseClient
      .from('custom_field_values')
      .upsert(rows, { onConflict: 'definition_id,entity_id' });

    if (error) {
      console.error('Error saving custom field values:', error);
      showToast('Warning: Some custom field values may not have saved', 'error');
    }
  }
}

/**
 * Render custom fields as read-only display for view modals.
 * Uses the same record-field-card pattern as existing sidebar fields.
 * @param {string} entityType - 'company' or 'person'
 * @param {string} containerId - DOM id of the container
 * @param {string} entityId - UUID of the entity
 */
async function renderCustomFieldsDisplay(entityType, containerId, entityId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const defs = await fetchCustomFieldDefinitions(entityType);
  if (!defs || defs.length === 0) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }

  const valuesMap = await fetchCustomFieldValues(entityType, entityId);

  // Only show fields that have values
  const fieldsWithValues = defs.filter(def => {
    const val = valuesMap.get(def.id);
    return val !== undefined && val !== null && val !== '';
  });

  if (fieldsWithValues.length === 0) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }

  container.style.display = '';

  // Icon for custom fields section
  const customFieldIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M12 3v18M3 12h18M7.5 7.5l9 9M16.5 7.5l-9 9"/>
  </svg>`;

  const cardsHtml = fieldsWithValues.map(def => {
    const rawVal = valuesMap.get(def.id) || '';
    let displayVal;

    switch (def.field_type) {
      case 'checkbox':
        displayVal = rawVal === 'true' ? 'Yes' : 'No';
        break;
      case 'url':
        if (rawVal) {
          const href = /^https?:\/\//i.test(rawVal) ? rawVal : 'https://' + rawVal;
          displayVal = `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(rawVal)}</a>`;
        } else {
          displayVal = '—';
        }
        break;
      case 'date':
        if (rawVal) {
          displayVal = escapeHtml(formatDate(rawVal));
        } else {
          displayVal = '—';
        }
        break;
      default:
        displayVal = escapeHtml(rawVal) || '—';
    }

    return `
      <div class="record-field-card">
        <div class="rfc-icon">${customFieldIcon}</div>
        <div class="rfc-body">
          <div class="rfc-label">${escapeHtml(def.field_name)}</div>
          <div class="rfc-value">${displayVal}</div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="record-sidebar-title">Custom Fields</div>
    ${cardsHtml}
  `;
}

/**
 * Invalidate the in-memory definition cache for an entity type.
 * Called from settings when definitions are created/updated/deleted.
 */
function invalidateCustomFieldCache(entityType) {
  if (entityType) {
    _defCache[entityType] = null;
  } else {
    _defCache.company = null;
    _defCache.person = null;
  }
}

/**
 * Generate a URL-safe key from a field name.
 * e.g. "Annual Revenue" → "annual_revenue"
 */
function generateFieldKey(name) {
  return (name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/[\s-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 50);
}


// ── Exports ────────────────────────────────────────────────────
export {
  fetchCustomFieldDefinitions,
  fetchCustomFieldValues,
  renderCustomFieldsForm,
  collectCustomFieldValues,
  validateCustomFields,
  saveCustomFieldValues,
  renderCustomFieldsDisplay,
  invalidateCustomFieldCache,
  generateFieldKey,
};
