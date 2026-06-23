// modules/features/workflows.js
// Visual workflow automation builder — triggers + action blocks
import { state, supabaseClient } from '../state.js';
import { viewContainer } from '../ui/dom.js';
import { showToast, escapeHtml } from '../ui/toast.js';
import { renderSkeletonCards, renderError } from '../utils/helpers.js';

// ── Local state ────────────────────────────────────────────────────────────────
let allWorkflows = [];
let currentWorkflow = null;   // workflow being edited in the builder
let builderDirty = false;
let liveSearchAbort = null;   // AbortController for live-search debounce

// Field definitions for each object type
const OBJECT_FIELDS = {
  companies: [
    { key: 'name', label: 'Company Name', type: 'text', required: true },
    { key: 'company_type', label: 'Type', type: 'select', options: ['Prospect', 'Customer', 'Partner', 'Vendor', 'Other'] },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'domain', label: 'Domain', type: 'text' },
    { key: 'address', label: 'Address', type: 'text' },
  ],
  people: [
    { key: 'name', label: 'Full Name', type: 'text', required: true },
    { key: 'email', label: 'Email', type: 'text' },
    { key: 'phone', label: 'Phone', type: 'text' },
    { key: 'company_name', label: 'Company', type: 'text' },
    { key: 'job_title', label: 'Job Title', type: 'text' },
    { key: 'lead_score', label: 'Lead Score', type: 'number' },
  ],
  opportunities: [
    { key: 'name', label: 'Opportunity Name', type: 'text', required: true },
    { key: 'company_name', label: 'Company', type: 'text' },
    { key: 'value', label: 'Value', type: 'number' },
    { key: 'probability', label: 'Probability (%)', type: 'number' },
    { key: 'stage', label: 'Stage', type: 'select', options: ['prospecting', 'qualification', 'closed-won', 'closed-lost'], optionLabels: { prospecting: 'Lead', qualification: 'In Progress', 'closed-won': 'Won', 'closed-lost': 'Lost' } },
    { key: 'next_step', label: 'Next Step', type: 'text' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
};

const TASK_FIELDS = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'description', label: 'Description', type: 'textarea' },
  { key: 'assigned_to', label: 'Assign To', type: 'assignee' },
  { key: 'priority', label: 'Priority', type: 'select', options: ['low', 'medium', 'high'] },
  { key: 'status', label: 'Status', type: 'select', options: ['pending', 'in_progress', 'completed'] },
  { key: 'due_date', label: 'Due Date', type: 'date' },
];

const TRIGGER_TYPES = [
  { id: 'record_created', label: 'Record Created', icon: 'plus-circle', description: 'When a new record is created' },
  { id: 'record_updated', label: 'Record Updated', icon: 'edit-3', description: 'When an existing record is updated' },
  { id: 'task_created', label: 'Task Created', icon: 'check-square', description: 'When a new task is created' },
];

const ACTION_TYPES = [
  { id: 'create_record', label: 'Create Record', icon: 'file-plus', description: 'Create a new company, person, or opportunity' },
  { id: 'update_record', label: 'Update Record', icon: 'edit', description: 'Update an existing record' },
  { id: 'create_task', label: 'Create Task', icon: 'check-square', description: 'Automatically create a task' },
  { id: 'update_task', label: 'Update Task', icon: 'clipboard-check', description: 'Update an existing task' },
];

const OBJECT_LABELS = {
  companies: 'Company',
  people: 'Person',
  opportunities: 'Opportunity',
};

const TRIGGER_COLORS = {
  record_created: 'var(--color-success)',
  record_updated: 'var(--color-primary)',
  task_created: 'var(--color-warning)',
};

const ACTION_COLORS = {
  create_record: 'var(--color-success)',
  update_record: 'var(--color-primary)',
  create_task: 'var(--color-warning)',
  update_task: '#8b5cf6',
};

// ── Workflows List View ────────────────────────────────────────────────────────

async function renderWorkflowsView() {
  viewContainer.innerHTML = renderSkeletonCards(3);

  const { data, error } = await supabaseClient
    .from('workflows')
    .select('*')
    .eq('organization_id', state.currentOrganization?.id)
    .order('created_at', { ascending: false });

  if (error) {
    viewContainer.innerHTML = renderError(error.message);
    return;
  }

  allWorkflows = data || [];
  renderWorkflowsList();
}

function renderWorkflowsList() {
  const activeCount = allWorkflows.filter(w => w.is_active).length;

  let html = `
    <div class="wf-page">
      <div class="wf-page-header">
        <div>
          <h1 class="wf-page-title">Workflows</h1>
          <p class="wf-page-subtitle">${allWorkflows.length} workflow${allWorkflows.length !== 1 ? 's' : ''} · ${activeCount} active</p>
        </div>
        <button class="btn btn-primary" onclick="openWorkflowBuilder()">
          <i data-lucide="plus" style="width:16px;height:16px;"></i>
          New Workflow
        </button>
      </div>

      ${allWorkflows.length === 0 ? renderEmptyState() : `
        <div class="wf-list">
          ${allWorkflows.map(w => renderWorkflowCard(w)).join('')}
        </div>
      `}
    </div>
  `;

  viewContainer.innerHTML = html;
  if (window.lucide) setTimeout(() => lucide.createIcons(), 0);
  attachListListeners();
}

function renderEmptyState() {
  return `
    <div class="wf-empty">
      <div class="wf-empty-icon">
        <i data-lucide="workflow" style="width:48px;height:48px;color:var(--text-muted);"></i>
      </div>
      <h3 class="wf-empty-title">No workflows yet</h3>
      <p class="wf-empty-text">Automate your CRM with workflows. Set triggers and actions to save time on repetitive tasks.</p>
      <button class="btn btn-primary" onclick="openWorkflowBuilder()">Create your first workflow</button>
    </div>
  `;
}

function renderWorkflowCard(w) {
  const trigger = w.trigger_config || {};
  const actions = w.actions || [];
  const triggerType = TRIGGER_TYPES.find(t => t.id === trigger.type);
  const triggerColor = TRIGGER_COLORS[trigger.type] || 'var(--text-muted)';

  return `
    <div class="wf-card" data-wf-id="${w.id}">
      <div class="wf-card-left">
        <div class="wf-card-status">
          <button class="wf-toggle ${w.is_active ? 'active' : ''}" onclick="toggleWorkflowActive('${w.id}', ${!w.is_active})" title="${w.is_active ? 'Deactivate' : 'Activate'}">
            <span class="wf-toggle-track"><span class="wf-toggle-thumb"></span></span>
          </button>
        </div>
        <div class="wf-card-info">
          <div class="wf-card-name">${escapeHtml(w.name)}</div>
          <div class="wf-card-meta">
            <span class="wf-card-trigger-badge" style="--badge-color: ${triggerColor}">
              <i data-lucide="${triggerType?.icon || 'zap'}" style="width:12px;height:12px;"></i>
              ${triggerType?.label || 'Unknown trigger'}
              ${trigger.object_type ? ` · ${OBJECT_LABELS[trigger.object_type] || trigger.object_type}` : ''}
            </span>
            <span class="wf-card-action-count">${actions.length} action${actions.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
      </div>
      <div class="wf-card-right">
        <button class="btn btn-ghost wf-card-btn" onclick="openWorkflowBuilder('${w.id}')" title="Edit">
          <i data-lucide="pencil" style="width:14px;height:14px;"></i>
        </button>
        <button class="btn btn-ghost wf-card-btn wf-card-btn-danger" onclick="deleteWorkflow('${w.id}')" title="Delete">
          <i data-lucide="trash-2" style="width:14px;height:14px;"></i>
        </button>
      </div>
    </div>
  `;
}

function attachListListeners() {
  // Card click to open builder (excluding buttons)
  document.querySelectorAll('.wf-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const id = card.dataset.wfId;
      openWorkflowBuilder(id);
    });
  });
}

// ── Toggle active ──────────────────────────────────────────────────────────────

async function toggleWorkflowActive(id, active) {
  const { error } = await supabaseClient
    .from('workflows')
    .update({ is_active: active, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    showToast('Failed to update workflow', 'error');
    return;
  }
  const wf = allWorkflows.find(w => w.id === id);
  if (wf) wf.is_active = active;
  showToast(`Workflow ${active ? 'activated' : 'deactivated'}`, 'success');
  renderWorkflowsList();
}

// ── Delete ─────────────────────────────────────────────────────────────────────

async function deleteWorkflow(id) {
  const wf = allWorkflows.find(w => w.id === id);
  const name = wf ? wf.name : 'this workflow';

  // Build a confirm dialog in the modal
  const confirmed = await window.showConfirmDialog('Delete Workflow', `Delete "${name}"? This cannot be undone.`);
  if (!confirmed) return;

  const { error } = await supabaseClient
    .from('workflows')
    .delete()
    .eq('id', id);

  if (error) {
    showToast('Failed to delete workflow', 'error');
    return;
  }
  allWorkflows = allWorkflows.filter(w => w.id !== id);
  showToast('Workflow deleted', 'success');
  renderWorkflowsList();
}

// ══════════════════════════════════════════════════════════════════════════════
//  WORKFLOW BUILDER (visual canvas)
// ══════════════════════════════════════════════════════════════════════════════

function openWorkflowBuilder(id) {
  if (id) {
    const wf = allWorkflows.find(w => w.id === id);
    if (!wf) { showToast('Workflow not found', 'error'); return; }
    currentWorkflow = JSON.parse(JSON.stringify(wf)); // deep clone
  } else {
    currentWorkflow = {
      id: null,
      name: '',
      is_active: false,
      trigger_config: null,
      actions: [],
    };
  }
  builderDirty = false;
  renderBuilder();
}

function renderBuilder() {
  const wf = currentWorkflow;
  const trigger = wf.trigger_config;
  const hasActions = wf.actions && wf.actions.length > 0;

  let html = `
    <div class="wf-builder">
      <div class="wf-builder-header">
        <div class="wf-builder-header-left">
          <button class="btn btn-ghost" onclick="closeWorkflowBuilder()" title="Back to list">
            <i data-lucide="arrow-left" style="width:16px;height:16px;"></i>
          </button>
          <input type="text" class="wf-builder-name-input" id="wf-name-input"
            value="${escapeHtml(wf.name)}" placeholder="Untitled Workflow"
            oninput="onWorkflowNameChange(this.value)" />
        </div>
        <div class="wf-builder-header-right">
          <div class="wf-builder-active-toggle">
            <label class="wf-toggle-label">
              <span>${wf.is_active ? 'Active' : 'Inactive'}</span>
              <button class="wf-toggle ${wf.is_active ? 'active' : ''}" onclick="toggleBuilderActive()" id="wf-builder-toggle">
                <span class="wf-toggle-track"><span class="wf-toggle-thumb"></span></span>
              </button>
            </label>
          </div>
          <button class="btn btn-primary" onclick="saveWorkflow()" id="wf-save-btn">
            Save Workflow
          </button>
        </div>
      </div>

      <div class="wf-canvas" id="wf-canvas">
        <div class="wf-flow">
          ${renderTriggerBlock(trigger)}
          ${renderConnector(!trigger)}
          ${hasActions ? wf.actions.map((action, idx) => `
            ${renderActionBlock(action, idx)}
            ${renderConnector(false, idx)}
          `).join('') : ''}
          ${trigger ? renderAddActionButton() : ''}
        </div>
      </div>
    </div>
  `;

  viewContainer.innerHTML = html;
  if (window.lucide) setTimeout(() => lucide.createIcons(), 0);
}

// ── Trigger Block ──────────────────────────────────────────────────────────────

function renderTriggerBlock(trigger) {
  if (!trigger) {
    return `
      <div class="wf-block wf-block-trigger wf-block-empty" onclick="openTriggerPicker()">
        <div class="wf-block-icon" style="--block-color: var(--text-muted)">
          <i data-lucide="zap" style="width:20px;height:20px;"></i>
        </div>
        <div class="wf-block-body">
          <div class="wf-block-label">Trigger</div>
          <div class="wf-block-title">Choose a trigger to start this workflow</div>
        </div>
        <div class="wf-block-arrow">
          <i data-lucide="chevron-right" style="width:16px;height:16px;"></i>
        </div>
      </div>
    `;
  }

  const t = TRIGGER_TYPES.find(tt => tt.id === trigger.type);
  const color = TRIGGER_COLORS[trigger.type] || 'var(--text-muted)';
  const objectLabel = trigger.object_type ? OBJECT_LABELS[trigger.object_type] : '';

  return `
    <div class="wf-block wf-block-trigger wf-block-filled" data-trigger-type="${trigger.type}">
      <div class="wf-block-color-bar" style="background:${color}"></div>
      <div class="wf-block-icon" style="--block-color: ${color}">
        <i data-lucide="${t?.icon || 'zap'}" style="width:20px;height:20px;"></i>
      </div>
      <div class="wf-block-body">
        <div class="wf-block-label">Trigger</div>
        <div class="wf-block-title">${t?.label || 'Unknown'}${objectLabel ? ` · <span class="wf-block-object">${objectLabel}</span>` : ''}</div>
        <div class="wf-block-description">
          ${trigger.type === 'task_created' ? 'Fires when any task is created' : (t?.description || '')}
          ${trigger.record_name ? `<span class="wf-target-label">→ ${escapeHtml(trigger.record_name)}</span>` : (trigger.type === 'record_updated' && trigger.object_type ? '<span style="color:var(--text-muted);font-style:italic;">Any record</span>' : '')}
        </div>
      </div>
      <div class="wf-block-actions">
        <button class="wf-block-edit-btn" onclick="openTriggerPicker()" title="Edit trigger">
          <i data-lucide="pencil" style="width:13px;height:13px;"></i>
        </button>
        <button class="wf-block-delete-btn" onclick="removeTrigger()" title="Remove trigger">
          <i data-lucide="x" style="width:13px;height:13px;"></i>
        </button>
      </div>
    </div>
  `;
}

// ── Connector (vertical line with plus) ────────────────────────────────────────

function renderConnector(disabled, afterIdx) {
  return `
    <div class="wf-connector ${disabled ? 'disabled' : ''}">
      <div class="wf-connector-line"></div>
      ${!disabled ? `<div class="wf-connector-dot"></div>` : ''}
    </div>
  `;
}

// ── Action Block ───────────────────────────────────────────────────────────────

function renderActionBlock(action, idx) {
  const at = ACTION_TYPES.find(a => a.id === action.type);
  const color = ACTION_COLORS[action.type] || 'var(--text-muted)';
  const objectLabel = action.object_type ? OBJECT_LABELS[action.object_type] : '';

  // Build summary of configured fields
  let fieldSummary = '';
  if (action.field_values && Object.keys(action.field_values).length > 0) {
    const count = Object.keys(action.field_values).length;
    fieldSummary = `<span class="wf-field-count">${count} field${count !== 1 ? 's' : ''} configured</span>`;
  }

  let targetLabel = '';
  if (action.target_record_name) {
    targetLabel = `<span class="wf-target-label">→ ${escapeHtml(action.target_record_name)}</span>`;
  }

  return `
    <div class="wf-block wf-block-action" data-action-idx="${idx}">
      <div class="wf-block-color-bar" style="background:${color}"></div>
      <div class="wf-block-icon" style="--block-color: ${color}">
        <i data-lucide="${at?.icon || 'play'}" style="width:20px;height:20px;"></i>
      </div>
      <div class="wf-block-body">
        <div class="wf-block-label">Action ${idx + 1}</div>
        <div class="wf-block-title">${at?.label || 'Unknown'}${objectLabel ? ` · <span class="wf-block-object">${objectLabel}</span>` : ''}</div>
        <div class="wf-block-description">
          ${at?.description || ''}
          ${targetLabel}
          ${fieldSummary}
        </div>
      </div>
      <div class="wf-block-actions">
        <button class="wf-block-edit-btn" onclick="openActionEditor(${idx})" title="Edit action">
          <i data-lucide="pencil" style="width:13px;height:13px;"></i>
        </button>
        <button class="wf-block-delete-btn" onclick="removeAction(${idx})" title="Remove action">
          <i data-lucide="x" style="width:13px;height:13px;"></i>
        </button>
      </div>
    </div>
  `;
}

// ── Add action button ──────────────────────────────────────────────────────────

function renderAddActionButton() {
  return `
    <button class="wf-add-action-btn" onclick="openActionPicker()">
      <i data-lucide="plus" style="width:18px;height:18px;"></i>
      <span>Add Action</span>
    </button>
  `;
}


// ══════════════════════════════════════════════════════════════════════════════
//  PICKERS & EDITORS (slide-over panels)
// ══════════════════════════════════════════════════════════════════════════════

function openTriggerPicker() {
  const existing = currentWorkflow.trigger_config;

  let html = `
    <div class="wf-panel-overlay active" id="wf-panel-overlay" onclick="closePanel()"></div>
    <div class="wf-panel active" id="wf-panel">
      <div class="wf-panel-header">
        <h3>Choose Trigger</h3>
        <button class="btn btn-ghost" onclick="closePanel()"><i data-lucide="x" style="width:16px;height:16px;"></i></button>
      </div>
      <div class="wf-panel-body">
        <p class="wf-panel-hint">A trigger starts your workflow when something happens in your CRM.</p>
        <div class="wf-option-list" id="wf-trigger-options">
          ${TRIGGER_TYPES.map(t => `
            <button class="wf-option ${existing?.type === t.id ? 'selected' : ''}" data-trigger="${t.id}">
              <div class="wf-option-icon" style="--opt-color: ${TRIGGER_COLORS[t.id]}">
                <i data-lucide="${t.icon}" style="width:18px;height:18px;"></i>
              </div>
              <div class="wf-option-info">
                <div class="wf-option-label">${t.label}</div>
                <div class="wf-option-desc">${t.description}</div>
              </div>
              ${existing?.type === t.id ? '<i data-lucide="check" class="wf-option-check" style="width:16px;height:16px;"></i>' : ''}
            </button>
          `).join('')}
        </div>
        <div id="wf-trigger-object-section" style="display:none;">
          <label class="wf-panel-label">Object Type</label>
          <div class="wf-option-list wf-object-options" id="wf-trigger-object-options"></div>
        </div>
        <div id="wf-trigger-record-section" style="display:none;">
          <label class="wf-panel-label">Which record?</label>
          <div class="wf-search-input-wrapper">
            <i data-lucide="search" style="width:14px;height:14px;" class="wf-search-icon"></i>
            <input type="text" class="wf-search-input" id="wf-trigger-search" placeholder="Search for a specific record…" autocomplete="off" />
          </div>
          <p class="wf-panel-hint" style="margin-top:var(--space-2);margin-bottom:0;">Leave empty to trigger on any record of this type.</p>
          <div class="wf-search-results" id="wf-trigger-search-results"></div>
        </div>
      </div>
      <div class="wf-panel-footer">
        <button class="btn btn-secondary" onclick="closePanel()">Cancel</button>
        <button class="btn btn-primary" id="wf-confirm-trigger-btn" disabled>Done</button>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', html);
  if (window.lucide) setTimeout(() => lucide.createIcons(), 0);

  // State for the picker
  let selectedType = existing?.type || null;
  let selectedObject = existing?.object_type || null;
  let selectedRecordId = existing?.record_id || null;
  let selectedRecordName = existing?.record_name || null;

  const triggerBtns = document.querySelectorAll('#wf-trigger-options .wf-option');
  const objectSection = document.getElementById('wf-trigger-object-section');
  const objectContainer = document.getElementById('wf-trigger-object-options');
  const recordSection = document.getElementById('wf-trigger-record-section');
  const confirmBtn = document.getElementById('wf-confirm-trigger-btn');

  function updateRecordSection() {
    if (selectedType === 'record_updated' && selectedObject) {
      recordSection.style.display = 'block';
      const searchInput = document.getElementById('wf-trigger-search');
      const resultsEl = document.getElementById('wf-trigger-search-results');
      if (searchInput) {
        searchInput.placeholder = `Search ${OBJECT_LABELS[selectedObject] || 'record'}…`;
        searchInput.value = selectedRecordName || '';
        // Show currently selected if exists
        if (selectedRecordName) {
          resultsEl.innerHTML = `<div class="wf-search-selected"><i data-lucide="check" style="width:14px;height:14px;color:var(--color-success);"></i> ${escapeHtml(selectedRecordName)}</div>`;
          if (window.lucide) setTimeout(() => lucide.createIcons(), 0);
        } else {
          resultsEl.innerHTML = '';
        }

        let debounceTimer;
        searchInput.oninput = () => {
          clearTimeout(debounceTimer);
          const query = searchInput.value.trim();
          if (query.length < 2) { resultsEl.innerHTML = ''; return; }
          debounceTimer = setTimeout(async () => {
            resultsEl.innerHTML = '<div class="wf-search-loading">Searching…</div>';
            const nameCol = 'name';
            const { data, error } = await supabaseClient
              .from(selectedObject)
              .select('id, ' + nameCol)
              .eq('organization_id', state.currentOrganization?.id)
              .ilike(nameCol, `%${query}%`)
              .limit(8);
            if (error || !data || data.length === 0) {
              resultsEl.innerHTML = '<div class="wf-search-loading">No results found</div>';
              return;
            }
            resultsEl.innerHTML = data.map(row => `
              <button class="wf-search-result" data-id="${row.id}" data-name="${escapeHtml(row[nameCol] || '')}">
                <i data-lucide="${selectedObject === 'companies' ? 'building-2' : selectedObject === 'people' ? 'user' : 'circle-dollar-sign'}" style="width:14px;height:14px;"></i>
                <span>${escapeHtml(row[nameCol] || 'Untitled')}</span>
              </button>
            `).join('');
            if (window.lucide) setTimeout(() => lucide.createIcons(), 0);
            resultsEl.querySelectorAll('.wf-search-result').forEach(btn => {
              btn.addEventListener('click', () => {
                selectedRecordId = btn.dataset.id;
                selectedRecordName = btn.dataset.name;
                searchInput.value = btn.dataset.name;
                resultsEl.innerHTML = `<div class="wf-search-selected"><i data-lucide="check" style="width:14px;height:14px;color:var(--color-success);"></i> ${escapeHtml(btn.dataset.name)}</div>`;
                if (window.lucide) setTimeout(() => lucide.createIcons(), 0);
              });
            });
          }, 250);
        };
      }
    } else {
      recordSection.style.display = 'none';
      selectedRecordId = null;
      selectedRecordName = null;
    }
  }

  function updateObjectSection() {
    if (selectedType === 'task_created') {
      objectSection.style.display = 'none';
      selectedObject = null;
      confirmBtn.disabled = false;
      updateRecordSection();
    } else if (selectedType) {
      objectSection.style.display = 'block';
      objectContainer.innerHTML = ['companies', 'people', 'opportunities'].map(obj => `
        <button class="wf-option wf-option-sm ${selectedObject === obj ? 'selected' : ''}" data-object="${obj}">
          <div class="wf-option-icon" style="--opt-color: var(--text-secondary)">
            <i data-lucide="${obj === 'companies' ? 'building-2' : obj === 'people' ? 'user' : 'circle-dollar-sign'}" style="width:16px;height:16px;"></i>
          </div>
          <span class="wf-option-label">${OBJECT_LABELS[obj]}</span>
        </button>
      `).join('');
      if (window.lucide) setTimeout(() => lucide.createIcons(), 0);

      objectContainer.querySelectorAll('.wf-option').forEach(btn => {
        btn.addEventListener('click', () => {
          selectedObject = btn.dataset.object;
          selectedRecordId = null;
          selectedRecordName = null;
          objectContainer.querySelectorAll('.wf-option').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          confirmBtn.disabled = false;
          updateRecordSection();
        });
      });

      confirmBtn.disabled = !selectedObject;
      updateRecordSection();
    } else {
      objectSection.style.display = 'none';
      confirmBtn.disabled = true;
      updateRecordSection();
    }
  }

  triggerBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      selectedType = btn.dataset.trigger;
      triggerBtns.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedObject = null;
      selectedRecordId = null;
      selectedRecordName = null;
      updateObjectSection();
    });
  });

  confirmBtn.addEventListener('click', () => {
    currentWorkflow.trigger_config = {
      type: selectedType,
      object_type: selectedObject,
      record_id: selectedRecordId || null,
      record_name: selectedRecordName || null,
    };
    builderDirty = true;
    closePanel();
    renderBuilder();
  });

  if (selectedType) updateObjectSection();
}

// ── Action picker ──────────────────────────────────────────────────────────────

function openActionPicker() {
  const triggerType = currentWorkflow.trigger_config?.type;
  const allowedActions = ACTION_TYPES.filter(a => {
    // Prevent infinite loop: task_created trigger cannot create/update tasks
    if (triggerType === 'task_created' && (a.id === 'create_task' || a.id === 'update_task')) return false;
    return true;
  });

  let html = `
    <div class="wf-panel-overlay active" id="wf-panel-overlay" onclick="closePanel()"></div>
    <div class="wf-panel active" id="wf-panel">
      <div class="wf-panel-header">
        <h3>Add Action</h3>
        <button class="btn btn-ghost" onclick="closePanel()"><i data-lucide="x" style="width:16px;height:16px;"></i></button>
      </div>
      <div class="wf-panel-body">
        <p class="wf-panel-hint">Choose what happens when the trigger fires.</p>
        <div class="wf-option-list">
          ${allowedActions.map(a => `
            <button class="wf-option" data-action-type="${a.id}">
              <div class="wf-option-icon" style="--opt-color: ${ACTION_COLORS[a.id]}">
                <i data-lucide="${a.icon}" style="width:18px;height:18px;"></i>
              </div>
              <div class="wf-option-info">
                <div class="wf-option-label">${a.label}</div>
                <div class="wf-option-desc">${a.description}</div>
              </div>
            </button>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', html);
  if (window.lucide) setTimeout(() => lucide.createIcons(), 0);

  document.querySelectorAll('[data-action-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.actionType;
      closePanel();
      addNewAction(type);
    });
  });
}

function addNewAction(type) {
  const action = {
    type,
    object_type: null,
    field_values: {},
    target_record_id: null,
    target_record_name: null,
  };

  if (!currentWorkflow.actions) currentWorkflow.actions = [];
  currentWorkflow.actions.push(action);
  builderDirty = true;

  // Immediately open the editor for the new action
  const idx = currentWorkflow.actions.length - 1;
  renderBuilder();
  setTimeout(() => openActionEditor(idx), 100);
}

// ── Action editor ──────────────────────────────────────────────────────────────

function openActionEditor(idx) {
  const action = currentWorkflow.actions[idx];
  if (!action) return;

  const at = ACTION_TYPES.find(a => a.id === action.type);
  const needsObject = ['create_record', 'update_record'].includes(action.type);
  const needsTaskFields = ['create_task', 'update_task'].includes(action.type);
  const needsSearch = ['update_record', 'update_task'].includes(action.type);

  let html = `
    <div class="wf-panel-overlay active" id="wf-panel-overlay" onclick="closePanel()"></div>
    <div class="wf-panel wf-panel-wide active" id="wf-panel">
      <div class="wf-panel-header">
        <h3>${at?.label || 'Edit Action'}</h3>
        <button class="btn btn-ghost" onclick="closePanel()"><i data-lucide="x" style="width:16px;height:16px;"></i></button>
      </div>
      <div class="wf-panel-body" id="wf-action-editor-body">
        ${needsObject ? renderObjectSelector(action) : ''}
        ${needsSearch ? renderSearchSection(action) : ''}
        <div id="wf-action-fields-container">
          ${renderFieldsEditor(action)}
        </div>
      </div>
      <div class="wf-panel-footer">
        <button class="btn btn-secondary" onclick="closePanel()">Cancel</button>
        <button class="btn btn-primary" onclick="confirmActionEdit(${idx})">Done</button>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', html);
  if (window.lucide) setTimeout(() => lucide.createIcons(), 0);
  initActionEditorListeners(idx);
  initCalendarsInPanel();
  loadAssigneeDropdowns(action);
}

function renderObjectSelector(action) {
  return `
    <div class="wf-editor-section">
      <label class="wf-panel-label">Object Type</label>
      <div class="wf-option-list wf-object-options" id="wf-action-object-options">
        ${['companies', 'people', 'opportunities'].map(obj => `
          <button class="wf-option wf-option-sm ${action.object_type === obj ? 'selected' : ''}" data-object="${obj}">
            <div class="wf-option-icon" style="--opt-color: var(--text-secondary)">
              <i data-lucide="${obj === 'companies' ? 'building-2' : obj === 'people' ? 'user' : 'circle-dollar-sign'}" style="width:16px;height:16px;"></i>
            </div>
            <span class="wf-option-label">${OBJECT_LABELS[obj]}</span>
          </button>
        `).join('')}
      </div>
    </div>
  `;
}

function renderSearchSection(action) {
  const searchType = action.type === 'update_task' ? 'task' : (action.object_type || 'record');
  const searchName = action.target_record_name || '';
  return `
    <div class="wf-editor-section" id="wf-search-section">
      <label class="wf-panel-label">Search for ${searchType}</label>
      <div class="wf-search-input-wrapper">
        <i data-lucide="search" style="width:14px;height:14px;" class="wf-search-icon"></i>
        <input type="text" class="wf-search-input" id="wf-live-search"
          placeholder="Type to search…" value="${escapeHtml(searchName)}" autocomplete="off" />
      </div>
      <div class="wf-search-results" id="wf-search-results"></div>
    </div>
  `;
}

function renderFieldsEditor(action) {
  let fields = [];

  if (['create_record', 'update_record'].includes(action.type)) {
    if (!action.object_type) {
      return '<p class="wf-panel-hint">Select an object type above to configure fields.</p>';
    }
    fields = OBJECT_FIELDS[action.object_type] || [];
  } else if (['create_task', 'update_task'].includes(action.type)) {
    fields = TASK_FIELDS;
  }

  if (fields.length === 0) return '';

  const vals = action.field_values || {};

  return `
    <div class="wf-editor-section">
      <label class="wf-panel-label">Fields</label>
      <div class="wf-fields-grid">
        ${fields.map(f => {
          const val = vals[f.key] || '';
          if (f.type === 'assignee') {
            return `
              <div class="wf-field-row">
                <label class="wf-field-label">${f.label}</label>
                <div class="crm-dd crm-dd--form" data-dd-id="${f.key}">
                  <button type="button" class="crm-dd-trigger" aria-haspopup="listbox" aria-expanded="false">
                    <span class="crm-dd-label">— Loading… —</span>
                    <span class="crm-dd-chevron"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>
                  </button>
                  <div class="crm-dd-panel" role="listbox">
                    <ul class="crm-dd-list">
                      <li class="crm-dd-option" role="option" data-value="" data-label="— Loading… —" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>— Loading… —</li>
                    </ul>
                  </div>
                  <input class="crm-dd-value-input wf-field-input wf-assignee-select" type="hidden" data-field-key="${f.key}" value="">
                </div>
              </div>
            `;
          }
          if (f.type === 'select') {
            return `
              <div class="wf-field-row">
                <label class="wf-field-label">${f.label}${f.required ? ' *' : ''}</label>
                <div class="crm-dd crm-dd--form" data-dd-id="${f.key}">
                  <button type="button" class="crm-dd-trigger" aria-haspopup="listbox" aria-expanded="false">
                    <span class="crm-dd-label">${val ? (f.optionLabels ? (f.optionLabels[val] || val) : val) : '— Select —'}</span>
                    <span class="crm-dd-chevron"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>
                  </button>
                  <div class="crm-dd-panel" role="listbox">
                    <ul class="crm-dd-list">
                      <li class="crm-dd-option${val === '' ? ' is-selected' : ''}" role="option" data-value="" data-label="— Select —" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>— Select —</li>
                      ${(f.options || []).map(opt => `<li class="crm-dd-option${val === opt ? ' is-selected' : ''}" role="option" data-value="${opt}" data-label="${f.optionLabels ? (f.optionLabels[opt] || opt) : opt}" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>${f.optionLabels ? (f.optionLabels[opt] || opt) : opt}</li>`).join('')}
                    </ul>
                  </div>
                  <input class="crm-dd-value-input wf-field-input" type="hidden" data-field-key="${f.key}" value="${escapeHtml(val)}">
                </div>
              </div>
            `;
          }
          if (f.type === 'textarea') {
            return `
              <div class="wf-field-row wf-field-row-wide">
                <label class="wf-field-label">${f.label}${f.required ? ' *' : ''}</label>
                <textarea class="wf-field-input" data-field-key="${f.key}" rows="2" placeholder="${f.label}">${escapeHtml(val)}</textarea>
              </div>
            `;
          }
          return `
            <div class="wf-field-row">
              <label class="wf-field-label">${f.label}${f.required ? ' *' : ''}</label>
              <input type="${f.type === 'number' ? 'number' : f.type === 'date' ? 'datetime-local' : 'text'}"
                class="wf-field-input" data-field-key="${f.key}" value="${escapeHtml(val)}" placeholder="${f.label}" />
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function initCalendarsInPanel() {
  if (!window.initCustomCalendar) return;
  const dateInputs = document.querySelectorAll('#wf-panel .wf-field-input[type="datetime-local"]');
  dateInputs.forEach((input, i) => {
    const uid = 'wf-cal-' + i + '-' + Date.now();
    input.id = uid;
    window.initCustomCalendar('#' + uid, { type: 'datetime-local' });
  });
}

async function loadAssigneeDropdowns(action) {
  const selects = document.querySelectorAll('#wf-panel .wf-assignee-select');
  if (selects.length === 0) return;

  const { data: profiles } = await supabaseClient
    .from('profiles')
    .select('id, first_name, last_name')
    .eq('organization_id', state.currentOrganization?.id);

  const val = (action.field_values || {}).assigned_to || '';

  selects.forEach(sel => {
    if (window.updateCrmDropdownOptions) {
      const root = sel.closest('.crm-dd');
      const options = [{ value: '', label: '— Select —' }].concat(
        (profiles || []).map(p => ({ value: p.id, label: `${p.first_name || ''} ${p.last_name || ''}`.trim() }))
      );
      window.updateCrmDropdownOptions(root, options, false);
      window.setCrmDropdownValue(root, val);
    } else {
      sel.innerHTML = '<option value="">— Select —</option>' +
        (profiles || []).map(p =>
          `<option value="${p.id}" ${val === p.id ? 'selected' : ''}>${p.first_name || ''} ${p.last_name || ''}</option>`
        ).join('');
    }
  });
}

function initActionEditorListeners(idx) {
  const action = currentWorkflow.actions[idx];

  // Object type selection (for create_record / update_record)
  const objectBtns = document.querySelectorAll('#wf-action-object-options .wf-option');
  objectBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      action.object_type = btn.dataset.object;
      objectBtns.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      // Re-render fields
      const container = document.getElementById('wf-action-fields-container');
      if (container) {
        container.innerHTML = renderFieldsEditor(action);
        if (window.initAllCrmDropdowns) window.initAllCrmDropdowns();
        initCalendarsInPanel();
      }
      // If update_record, also update search placeholder
      const searchInput = document.getElementById('wf-live-search');
      if (searchInput) {
        searchInput.placeholder = `Search ${OBJECT_LABELS[action.object_type] || 'record'}…`;
        action.target_record_id = null;
        action.target_record_name = null;
        searchInput.value = '';
        document.getElementById('wf-search-results').innerHTML = '';
      }
    });
  });

  // Live search
  const searchInput = document.getElementById('wf-live-search');
  if (searchInput) {
    let debounceTimer;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const query = searchInput.value.trim();
      if (query.length < 2) {
        document.getElementById('wf-search-results').innerHTML = '';
        return;
      }
      debounceTimer = setTimeout(() => runLiveSearch(action, query), 250);
    });
  }
}

async function runLiveSearch(action, query) {
  if (liveSearchAbort) liveSearchAbort.abort();
  liveSearchAbort = new AbortController();

  const resultsEl = document.getElementById('wf-search-results');
  if (!resultsEl) return;

  resultsEl.innerHTML = '<div class="wf-search-loading">Searching…</div>';

  let table, nameCol;
  if (action.type === 'update_task') {
    table = 'tasks';
    nameCol = 'title';
  } else {
    table = action.object_type;
    nameCol = 'name';
    if (!table) {
      resultsEl.innerHTML = '<div class="wf-search-loading">Select an object type first</div>';
      return;
    }
  }

  const selectCols = (action.type === 'update_record' || action.type === 'update_task') ? '*' : 'id, ' + nameCol;

  const { data, error } = await supabaseClient
    .from(table)
    .select(selectCols)
    .eq('organization_id', state.currentOrganization?.id)
    .ilike(nameCol, `%${query}%`)
    .limit(8);

  if (error) {
    resultsEl.innerHTML = `<div class="wf-search-loading">Error: ${escapeHtml(error.message)}</div>`;
    return;
  }

  if (!data || data.length === 0) {
    resultsEl.innerHTML = '<div class="wf-search-loading">No results found</div>';
    return;
  }

  resultsEl.innerHTML = data.map(row => `
    <button class="wf-search-result" data-id="${row.id}" data-name="${escapeHtml(row[nameCol] || '')}">
      <i data-lucide="${table === 'tasks' ? 'check-square' : table === 'companies' ? 'building-2' : table === 'people' ? 'user' : 'circle-dollar-sign'}" style="width:14px;height:14px;"></i>
      <span>${escapeHtml(row[nameCol] || 'Untitled')}</span>
    </button>
  `).join('');

  if (window.lucide) setTimeout(() => lucide.createIcons(), 0);

  resultsEl.querySelectorAll('.wf-search-result').forEach(btn => {
    btn.addEventListener('click', () => {
      action.target_record_id = btn.dataset.id;
      action.target_record_name = btn.dataset.name;
      const searchInput = document.getElementById('wf-live-search');
      if (searchInput) searchInput.value = btn.dataset.name;
      resultsEl.innerHTML = `<div class="wf-search-selected"><i data-lucide="check" style="width:14px;height:14px;color:var(--color-success);"></i> ${escapeHtml(btn.dataset.name)}</div>`;
      if (window.lucide) setTimeout(() => lucide.createIcons(), 0);

      // Auto-fill form fields with the selected record's data
      if (action.type === 'update_record' && data) {
        const record = data.find(r => r.id === btn.dataset.id);
        if (record) {
          const fields = OBJECT_FIELDS[action.object_type] || [];
          fields.forEach(f => {
            const input = document.querySelector(`.wf-field-input[data-field-key="${f.key}"]`);
            if (input && record[f.key] != null) {
              input.value = record[f.key];
            }
          });
        }
      }
      if (action.type === 'update_task' && data) {
        const record = data.find(r => r.id === btn.dataset.id);
        if (record) {
          TASK_FIELDS.forEach(f => {
            if (f.type === 'assignee') return;
            const input = document.querySelector(`.wf-field-input[data-field-key="${f.key}"]`);
            if (input && record[f.key] != null) {
              input.value = record[f.key];
            }
          });
        }
      }
    });
  });
}

function confirmActionEdit(idx) {
  const action = currentWorkflow.actions[idx];

  // Collect field values from the DOM
  const fieldInputs = document.querySelectorAll('.wf-field-input');
  const vals = {};
  fieldInputs.forEach(input => {
    const key = input.dataset.fieldKey;
    const value = input.value.trim();
    if (key && value) {
      vals[key] = value;
    }
  });
  action.field_values = vals;
  builderDirty = true;
  closePanel();
  renderBuilder();
}

// ── Remove ─────────────────────────────────────────────────────────────────────

function removeTrigger() {
  currentWorkflow.trigger_config = null;
  currentWorkflow.actions = [];
  builderDirty = true;
  renderBuilder();
}

function removeAction(idx) {
  currentWorkflow.actions.splice(idx, 1);
  builderDirty = true;
  renderBuilder();
}

// ── Panel helpers ──────────────────────────────────────────────────────────────

function closePanel() {
  const overlay = document.getElementById('wf-panel-overlay');
  const panel = document.getElementById('wf-panel');
  if (overlay) overlay.remove();
  if (panel) panel.remove();
}

// ── Builder header actions ─────────────────────────────────────────────────────

function onWorkflowNameChange(val) {
  currentWorkflow.name = val;
  builderDirty = true;
}

function toggleBuilderActive() {
  currentWorkflow.is_active = !currentWorkflow.is_active;
  builderDirty = true;
  renderBuilder();
}

async function closeWorkflowBuilder() {
  if (builderDirty) {
    const leave = await window.showConfirmDialog('Unsaved Changes', 'You have unsaved changes. Leave without saving?');
    if (!leave) return;
  }
  currentWorkflow = null;
  builderDirty = false;
  renderWorkflowsView();
}

// ── Save workflow ──────────────────────────────────────────────────────────────

async function saveWorkflow() {
  const wf = currentWorkflow;
  if (!wf) return;

  // Validate
  if (!wf.name.trim()) {
    const nameInput = document.getElementById('wf-name-input');
    if (nameInput) { nameInput.focus(); nameInput.classList.add('wf-input-error'); }
    showToast('Please give your workflow a name', 'error');
    return;
  }

  if (!wf.trigger_config) {
    showToast('Add a trigger to your workflow', 'error');
    return;
  }

  const saveBtn = document.getElementById('wf-save-btn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  const payload = {
    name: wf.name.trim(),
    is_active: true,
    trigger_config: wf.trigger_config,
    actions: wf.actions || [],
    organization_id: state.currentOrganization?.id,
    updated_at: new Date().toISOString(),
  };

  let result;
  if (wf.id) {
    result = await supabaseClient
      .from('workflows')
      .update(payload)
      .eq('id', wf.id)
      .select();
  } else {
    payload.created_by = state.currentUser.id;
    payload.created_at = new Date().toISOString();
    result = await supabaseClient
      .from('workflows')
      .insert([payload])
      .select();
  }

  if (result.error) {
    showToast('Failed to save workflow: ' + result.error.message, 'error');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Workflow'; }
    return;
  }

  // Update local state
  if (result.data && result.data[0]) {
    const saved = result.data[0];
    currentWorkflow.id = saved.id;
    const existingIdx = allWorkflows.findIndex(w => w.id === saved.id);
    if (existingIdx !== -1) {
      allWorkflows[existingIdx] = saved;
    } else {
      allWorkflows.unshift(saved);
    }
  }

  builderDirty = false;
  showToast(`Workflow "${wf.name}" saved`, 'success');
  currentWorkflow = null;
  renderWorkflowsView();
}

// ── Exports ────────────────────────────────────────────────────────────────────
export {
  renderWorkflowsView,
  openWorkflowBuilder,
  closeWorkflowBuilder,
  saveWorkflow,
  deleteWorkflow,
  toggleWorkflowActive,
  openTriggerPicker,
  removeTrigger,
  openActionPicker,
  openActionEditor,
  removeAction,
  confirmActionEdit,
  closePanel,
  onWorkflowNameChange,
  toggleBuilderActive,
};
