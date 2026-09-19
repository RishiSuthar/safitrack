// modules/features/workflows.js
// Workflow automation — list view, visual builder, conditions, and run history.
// Rebuilt from scratch with proper event delegation, condition support, and engine integration.

import { state, supabaseClient } from '../state.js';
import { viewContainer } from '../ui/dom.js';
import { showToast, escapeHtml } from '../ui/toast.js';
import { renderSkeletonCards, renderError } from '../utils/helpers.js';
import { invalidateWorkflowCache, getWorkflowRuns, getAllWorkflowRuns, getWorkflowRunStats } from './workflow-engine.js';

// ── Local state ────────────────────────────────────────────────────────────────
let allWorkflows = [];
let runStats = {};
let currentWorkflow = null;
let builderDirty = false;
let activeTab = 'workflows'; // 'workflows' | 'history'
let historyData = [];

// ── Constants ──────────────────────────────────────────────────────────────────

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
  { id: 'record_created', label: 'Record Created', icon: 'plus-circle', description: 'When a new record is created', color: 'var(--color-success)' },
  { id: 'record_updated', label: 'Record Updated', icon: 'edit-3', description: 'When a record is updated', color: 'var(--color-primary)' },
  { id: 'field_changed', label: 'Field Changed', icon: 'git-branch', description: 'When a specific field value changes', color: '#8b5cf6' },
  { id: 'task_created', label: 'Task Created', icon: 'check-square', description: 'When a new task is created', color: 'var(--color-warning)' },
  { id: 'task_completed', label: 'Task Completed', icon: 'check-circle', description: 'When a task is marked complete', color: 'var(--color-success)' },
];

const ACTION_TYPES = [
  { id: 'create_record', label: 'Create Record', icon: 'file-plus', description: 'Create a new company, person, or opportunity', color: 'var(--color-success)' },
  { id: 'update_record', label: 'Update Record', icon: 'edit', description: 'Update field values on a record', color: 'var(--color-primary)' },
  { id: 'create_task', label: 'Create Task', icon: 'check-square', description: 'Automatically create a task', color: 'var(--color-warning)' },
  { id: 'update_task', label: 'Update Task', icon: 'clipboard', description: 'Update an existing task', color: '#8b5cf6' },
  { id: 'send_notification', label: 'Send Notification', icon: 'bell', description: 'Notify team members in-app', color: '#ec4899' },
];

const CONDITION_OPERATORS = [
  { id: 'equals', label: 'Equals' },
  { id: 'not_equals', label: 'Does not equal' },
  { id: 'contains', label: 'Contains' },
  { id: 'not_contains', label: 'Does not contain' },
  { id: 'greater_than', label: 'Greater than' },
  { id: 'less_than', label: 'Less than' },
  { id: 'is_empty', label: 'Is empty' },
  { id: 'is_not_empty', label: 'Is not empty' },
];

const OBJECT_LABELS = {
  companies: 'Company',
  people: 'Person',
  opportunities: 'Opportunity',
};

const OBJECT_ICONS = {
  companies: 'building-2',
  people: 'user',
  opportunities: 'circle-dollar-sign',
};

// ══════════════════════════════════════════════════════════════════════════════
//  LIST VIEW
// ══════════════════════════════════════════════════════════════════════════════

async function renderWorkflowsView() {
  viewContainer.innerHTML = renderSkeletonCards(3);

  const [workflowsResult, statsResult] = await Promise.all([
    supabaseClient
      .from('workflows')
      .select('*')
      .eq('organization_id', state.currentOrganization?.id)
      .order('created_at', { ascending: false }),
    getWorkflowRunStats(),
  ]);

  if (workflowsResult.error) {
    viewContainer.innerHTML = renderError(workflowsResult.error.message);
    return;
  }

  allWorkflows = workflowsResult.data || [];
  runStats = statsResult || {};
  activeTab = 'workflows';
  renderListPage();
}

function renderListPage() {
  const activeCount = allWorkflows.filter(w => w.is_active).length;

  let html = `
    <div class="wf-page">
      <div class="wf-page-header">
        <div>
          <h1 class="wf-page-title">Workflows</h1>
          <p class="wf-page-subtitle">${allWorkflows.length} workflow${allWorkflows.length !== 1 ? 's' : ''} · ${activeCount} active</p>
        </div>
        <button class="btn btn-primary" data-wf-action="new-workflow">
          <i data-lucide="plus" style="width:16px;height:16px;"></i>
          New Workflow
        </button>
      </div>

      <div class="wf-tabs">
        <button class="wf-tab ${activeTab === 'workflows' ? 'active' : ''}" data-wf-tab="workflows">
          <i data-lucide="workflow" style="width:14px;height:14px;"></i>
          Workflows
        </button>
        <button class="wf-tab ${activeTab === 'history' ? 'active' : ''}" data-wf-tab="history">
          <i data-lucide="history" style="width:14px;height:14px;"></i>
          Run History
        </button>
      </div>

      <div class="wf-tab-content" id="wf-tab-content">
        ${activeTab === 'workflows' ? renderWorkflowsList() : '<div class="wf-loading">Loading history…</div>'}
      </div>
    </div>
  `;

  viewContainer.innerHTML = html;
  if (window.lucide) setTimeout(() => lucide.createIcons(), 0);
  attachListDelegation();

  if (activeTab === 'history') loadHistory();
}

function renderWorkflowsList() {
  if (allWorkflows.length === 0) return renderEmptyState();

  return `
    <div class="wf-list">
      ${allWorkflows.map(w => renderWorkflowCard(w)).join('')}
    </div>
  `;
}

function renderEmptyState() {
  return `
    <div class="wf-empty">
      <div class="wf-empty-icon">
        <i data-lucide="workflow" style="width:48px;height:48px;color:var(--text-muted);"></i>
      </div>
      <h3 class="wf-empty-title">No workflows yet</h3>
      <p class="wf-empty-text">Automate your CRM with workflows. Set triggers, add conditions, and define actions to save time on repetitive tasks.</p>
      <button class="btn btn-primary" data-wf-action="new-workflow">Create your first workflow</button>
    </div>
  `;
}

function renderWorkflowCard(w) {
  const trigger = w.trigger_config || {};
  const actions = w.actions || [];
  const triggerDef = TRIGGER_TYPES.find(t => t.id === trigger.type);
  const conditions = trigger.conditions || [];
  const stats = runStats[w.id];
  const hasErrors = stats && stats.failed_runs > 0;

  let statusIndicator = 'never';
  let statusColor = 'var(--text-muted)';
  let statusLabel = 'Never run';
  if (stats) {
    if (stats.last_status === 'success') {
      statusIndicator = 'success';
      statusColor = 'var(--color-success)';
      statusLabel = `${stats.total_runs} run${stats.total_runs !== 1 ? 's' : ''}`;
    } else if (stats.last_status === 'error' || stats.last_status === 'partial_failure') {
      statusIndicator = 'error';
      statusColor = 'var(--color-danger)';
      statusLabel = `${stats.failed_runs} failed`;
    }
  }

  const lastRunLabel = stats?.last_run_at ? formatRelativeTime(stats.last_run_at) : '';

  return `
    <div class="wf-card" data-wf-id="${w.id}">
      <div class="wf-card-left">
        <div class="wf-card-status">
          <button class="wf-toggle ${w.is_active ? 'active' : ''}" data-wf-action="toggle" data-wf-id="${w.id}" data-wf-active="${!w.is_active}" title="${w.is_active ? 'Deactivate' : 'Activate'}">
            <span class="wf-toggle-track"><span class="wf-toggle-thumb"></span></span>
          </button>
        </div>
        <div class="wf-card-info">
          <div class="wf-card-name">${escapeHtml(w.name || 'Untitled Workflow')}</div>
          <div class="wf-card-meta">
            <span class="wf-card-trigger-badge" style="--badge-color: ${triggerDef?.color || 'var(--text-muted)'}">
              <i data-lucide="${triggerDef?.icon || 'zap'}" style="width:12px;height:12px;"></i>
              ${triggerDef?.label || 'No trigger'}
              ${trigger.object_type ? ` · ${OBJECT_LABELS[trigger.object_type] || trigger.object_type}` : ''}
            </span>
            ${conditions.length > 0 ? `<span class="wf-card-condition-badge"><i data-lucide="filter" style="width:11px;height:11px;"></i> ${conditions.length}</span>` : ''}
            <span class="wf-card-action-count">${actions.length} action${actions.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
      </div>
      <div class="wf-card-right">
        <div class="wf-card-run-info">
          <span class="wf-card-run-indicator" style="--indicator-color: ${statusColor}" title="${statusLabel}"></span>
          ${lastRunLabel ? `<span class="wf-card-run-time">${lastRunLabel}</span>` : ''}
        </div>
        <button class="btn btn-ghost wf-card-btn" data-wf-action="edit" data-wf-id="${w.id}" title="Edit">
          <i data-lucide="pencil" style="width:14px;height:14px;"></i>
        </button>
        <button class="btn btn-ghost wf-card-btn wf-card-btn-danger" data-wf-action="delete" data-wf-id="${w.id}" title="Delete">
          <i data-lucide="trash-2" style="width:14px;height:14px;"></i>
        </button>
      </div>
    </div>
  `;
}

// ── Run History Tab ──────────────────────────────────────────────────────────

async function loadHistory() {
  const container = document.getElementById('wf-tab-content');
  if (!container) return;

  historyData = await getAllWorkflowRuns(100);
  container.innerHTML = renderHistoryTable();
  if (window.lucide) setTimeout(() => lucide.createIcons(), 0);
}

function renderHistoryTable() {
  if (historyData.length === 0) {
    return `
      <div class="wf-empty" style="padding:var(--space-7) var(--space-5);">
        <div class="wf-empty-icon"><i data-lucide="history" style="width:40px;height:40px;color:var(--text-muted);"></i></div>
        <h3 class="wf-empty-title">No runs yet</h3>
        <p class="wf-empty-text">Workflow runs will appear here once your active workflows start firing.</p>
      </div>
    `;
  }

  return `
    <div class="wf-history-table">
      <div class="wf-history-header">
        <span class="wf-history-col wf-history-col-status">Status</span>
        <span class="wf-history-col wf-history-col-workflow">Workflow</span>
        <span class="wf-history-col wf-history-col-trigger">Trigger</span>
        <span class="wf-history-col wf-history-col-actions">Actions</span>
        <span class="wf-history-col wf-history-col-time">Time</span>
      </div>
      ${historyData.map(run => {
        const trigger = run.trigger_event || {};
        const actions = run.actions_executed || [];
        const workflowName = run.workflows?.name || 'Deleted workflow';
        const statusIcon = run.status === 'success' ? 'check-circle' : run.status === 'partial_failure' ? 'alert-triangle' : 'x-circle';
        const statusColor = run.status === 'success' ? 'var(--color-success)' : run.status === 'partial_failure' ? 'var(--color-warning)' : 'var(--color-danger)';

        return `
          <div class="wf-history-row" data-run-id="${run.id}">
            <span class="wf-history-col wf-history-col-status">
              <i data-lucide="${statusIcon}" style="width:14px;height:14px;color:${statusColor};"></i>
            </span>
            <span class="wf-history-col wf-history-col-workflow">${escapeHtml(workflowName)}</span>
            <span class="wf-history-col wf-history-col-trigger">
              <span class="wf-history-trigger-badge">${trigger.event_type || '?'} · ${trigger.table || '?'}</span>
              ${trigger.record_name ? `<span class="wf-history-record-name">${escapeHtml(trigger.record_name)}</span>` : ''}
            </span>
            <span class="wf-history-col wf-history-col-actions">${actions.length} action${actions.length !== 1 ? 's' : ''}</span>
            <span class="wf-history-col wf-history-col-time">${formatRelativeTime(run.created_at)}</span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// ── Event Delegation (List Page) ─────────────────────────────────────────────

function attachListDelegation() {
  viewContainer.addEventListener('click', handleListClick);
}

function handleListClick(e) {
  const target = e.target;

  // Tab switching
  const tabBtn = target.closest('[data-wf-tab]');
  if (tabBtn) {
    activeTab = tabBtn.dataset.wfTab;
    renderListPage();
    return;
  }

  // Actions
  const actionBtn = target.closest('[data-wf-action]');
  if (actionBtn) {
    const action = actionBtn.dataset.wfAction;
    const id = actionBtn.dataset.wfId;

    switch (action) {
      case 'new-workflow':
        openBuilder(null);
        return;
      case 'edit':
        e.stopPropagation();
        openBuilder(id);
        return;
      case 'delete':
        e.stopPropagation();
        handleDelete(id);
        return;
      case 'toggle':
        e.stopPropagation();
        handleToggle(id, actionBtn.dataset.wfActive === 'true');
        return;
    }
  }

  // Card click → open builder
  const card = target.closest('.wf-card');
  if (card && !target.closest('button')) {
    openBuilder(card.dataset.wfId);
  }
}

// ── Toggle / Delete ──────────────────────────────────────────────────────────

async function handleToggle(id, newActive) {
  const { error } = await supabaseClient
    .from('workflows')
    .update({ is_active: newActive, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    showToast('Failed to update workflow', 'error');
    return;
  }
  const wf = allWorkflows.find(w => w.id === id);
  if (wf) wf.is_active = newActive;
  invalidateWorkflowCache();
  showToast(`Workflow ${newActive ? 'activated' : 'deactivated'}`, 'success');
  renderListPage();
}

async function handleDelete(id) {
  const wf = allWorkflows.find(w => w.id === id);
  const name = wf ? wf.name : 'this workflow';

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
  invalidateWorkflowCache();
  showToast('Workflow deleted', 'success');
  renderListPage();
}

// ══════════════════════════════════════════════════════════════════════════════
//  WORKFLOW BUILDER
// ══════════════════════════════════════════════════════════════════════════════

function openBuilder(id) {
  viewContainer.removeEventListener('click', handleListClick);

  if (id) {
    const wf = allWorkflows.find(w => w.id === id);
    if (!wf) { showToast('Workflow not found', 'error'); return; }
    currentWorkflow = JSON.parse(JSON.stringify(wf));
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
  const conditions = trigger?.conditions || [];
  const hasActions = wf.actions && wf.actions.length > 0;

  let html = `
    <div class="wf-builder">
      <div class="wf-builder-header">
        <div class="wf-builder-header-left">
          <button class="btn btn-ghost" data-wf-builder="back" title="Back to list">
            <i data-lucide="arrow-left" style="width:16px;height:16px;"></i>
          </button>
          <input type="text" class="wf-builder-name-input" id="wf-name-input"
            value="${escapeHtml(wf.name)}" placeholder="Untitled Workflow" />
        </div>
        <div class="wf-builder-header-right">
          <div class="wf-builder-active-toggle">
            <label class="wf-toggle-label">
              <span>${wf.is_active ? 'Active' : 'Inactive'}</span>
              <button class="wf-toggle ${wf.is_active ? 'active' : ''}" data-wf-builder="toggle-active" id="wf-builder-toggle">
                <span class="wf-toggle-track"><span class="wf-toggle-thumb"></span></span>
              </button>
            </label>
          </div>
          <button class="btn btn-primary" data-wf-builder="save" id="wf-save-btn">
            Save Workflow
          </button>
        </div>
      </div>

      <div class="wf-canvas" id="wf-canvas">
        <div class="wf-flow">
          ${renderTriggerBlock(trigger)}
          ${renderConnector(!trigger)}
          ${trigger && conditions.length > 0 ? `
            ${renderConditionsBlock(conditions, trigger)}
            ${renderConnector(false)}
          ` : ''}
          ${trigger && conditions.length === 0 ? `
            ${renderAddConditionButton()}
            ${renderConnector(false)}
          ` : ''}
          ${hasActions ? wf.actions.map((action, idx) => `
            ${renderActionBlock(action, idx)}
            ${renderConnector(false)}
          `).join('') : ''}
          ${trigger ? renderAddActionButton() : ''}
        </div>
      </div>
    </div>
  `;

  viewContainer.innerHTML = html;
  if (window.lucide) setTimeout(() => lucide.createIcons(), 0);
  attachBuilderDelegation();
}

// ── Trigger Block ────────────────────────────────────────────────────────────

function renderTriggerBlock(trigger) {
  if (!trigger) {
    return `
      <div class="wf-block wf-block-trigger wf-block-empty" data-wf-builder="open-trigger-picker">
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
  const objectLabel = trigger.object_type ? OBJECT_LABELS[trigger.object_type] : '';

  let desc = t?.description || '';
  if (trigger.type === 'field_changed' && trigger.watch_field) {
    desc = `When "${trigger.watch_field}" changes`;
    if (trigger.from_value) desc += ` from "${trigger.from_value}"`;
    if (trigger.to_value) desc += ` to "${trigger.to_value}"`;
  }
  if (trigger.record_name) {
    desc += ` <span class="wf-target-label">→ ${escapeHtml(trigger.record_name)}</span>`;
  }

  return `
    <div class="wf-block wf-block-trigger wf-block-filled">
      <div class="wf-block-color-bar" style="background:${t?.color || 'var(--text-muted)'}"></div>
      <div class="wf-block-icon" style="--block-color: ${t?.color || 'var(--text-muted)'}">
        <i data-lucide="${t?.icon || 'zap'}" style="width:20px;height:20px;"></i>
      </div>
      <div class="wf-block-body">
        <div class="wf-block-label">Trigger</div>
        <div class="wf-block-title">${t?.label || 'Unknown'}${objectLabel ? ` · <span class="wf-block-object">${objectLabel}</span>` : ''}</div>
        <div class="wf-block-description">${desc}</div>
      </div>
      <div class="wf-block-actions">
        <button class="wf-block-edit-btn" data-wf-builder="open-trigger-picker" title="Edit trigger">
          <i data-lucide="pencil" style="width:13px;height:13px;"></i>
        </button>
        <button class="wf-block-delete-btn" data-wf-builder="remove-trigger" title="Remove trigger">
          <i data-lucide="x" style="width:13px;height:13px;"></i>
        </button>
      </div>
    </div>
  `;
}

// ── Conditions Block ─────────────────────────────────────────────────────────

function renderConditionsBlock(conditions, trigger) {
  const objectType = trigger?.object_type;
  const fields = getFieldsForTrigger(trigger);

  return `
    <div class="wf-block wf-block-condition">
      <div class="wf-block-color-bar" style="background:var(--color-warning)"></div>
      <div class="wf-block-icon" style="--block-color: var(--color-warning)">
        <i data-lucide="filter" style="width:20px;height:20px;"></i>
      </div>
      <div class="wf-block-body">
        <div class="wf-block-label">Conditions</div>
        <div class="wf-block-title">Only continue if all match</div>
        <div class="wf-conditions-list">
          ${conditions.map((c, idx) => {
            const fieldDef = fields.find(f => f.key === c.field);
            const opDef = CONDITION_OPERATORS.find(o => o.id === c.operator);
            const needsValue = !['is_empty', 'is_not_empty'].includes(c.operator);
            return `
              <div class="wf-condition-pill" data-condition-idx="${idx}">
                <span class="wf-condition-field">${fieldDef?.label || c.field}</span>
                <span class="wf-condition-op">${opDef?.label || c.operator}</span>
                ${needsValue ? `<span class="wf-condition-val">${escapeHtml(c.value || '')}</span>` : ''}
                <button class="wf-condition-remove" data-wf-builder="remove-condition" data-condition-idx="${idx}" title="Remove">
                  <i data-lucide="x" style="width:11px;height:11px;"></i>
                </button>
              </div>
            `;
          }).join('')}
        </div>
      </div>
      <div class="wf-block-actions">
        <button class="wf-block-edit-btn" data-wf-builder="open-condition-editor" title="Edit conditions">
          <i data-lucide="pencil" style="width:13px;height:13px;"></i>
        </button>
        <button class="wf-block-delete-btn" data-wf-builder="clear-conditions" title="Remove all conditions">
          <i data-lucide="x" style="width:13px;height:13px;"></i>
        </button>
      </div>
    </div>
  `;
}

function renderAddConditionButton() {
  return `
    <button class="wf-add-condition-btn" data-wf-builder="open-condition-editor">
      <i data-lucide="filter" style="width:14px;height:14px;"></i>
      <span>Add Conditions</span>
    </button>
  `;
}

// ── Connector ────────────────────────────────────────────────────────────────

function renderConnector(disabled) {
  return `
    <div class="wf-connector ${disabled ? 'disabled' : ''}">
      <div class="wf-connector-line"></div>
      ${!disabled ? '<div class="wf-connector-dot"></div>' : ''}
    </div>
  `;
}

// ── Action Block ─────────────────────────────────────────────────────────────

function renderActionBlock(action, idx) {
  const at = ACTION_TYPES.find(a => a.id === action.type);
  const objectLabel = action.object_type ? OBJECT_LABELS[action.object_type] : '';

  let fieldSummary = '';
  if (action.field_values && Object.keys(action.field_values).length > 0) {
    const count = Object.keys(action.field_values).length;
    fieldSummary = `<span class="wf-field-count">${count} field${count !== 1 ? 's' : ''}</span>`;
  }

  let targetLabel = '';
  if (action.target_record_name) {
    targetLabel = `<span class="wf-target-label">→ ${escapeHtml(action.target_record_name)}</span>`;
  }

  let notifyLabel = '';
  if (action.type === 'send_notification') {
    const users = action.notify_users || [];
    notifyLabel = users.length > 0 ? `<span class="wf-field-count">${users.length} recipient${users.length !== 1 ? 's' : ''}</span>` : '';
    if (action.message) {
      targetLabel = `<span class="wf-target-label">"${escapeHtml(action.message.substring(0, 40))}${action.message.length > 40 ? '…' : ''}"</span>`;
    }
  }

  return `
    <div class="wf-block wf-block-action" data-action-idx="${idx}">
      <div class="wf-block-color-bar" style="background:${at?.color || 'var(--text-muted)'}"></div>
      <div class="wf-block-icon" style="--block-color: ${at?.color || 'var(--text-muted)'}">
        <i data-lucide="${at?.icon || 'play'}" style="width:20px;height:20px;"></i>
      </div>
      <div class="wf-block-body">
        <div class="wf-block-label">Action ${idx + 1}</div>
        <div class="wf-block-title">${at?.label || 'Unknown'}${objectLabel ? ` · <span class="wf-block-object">${objectLabel}</span>` : ''}</div>
        <div class="wf-block-description">
          ${at?.description || ''}
          ${targetLabel}
          ${fieldSummary}
          ${notifyLabel}
        </div>
      </div>
      <div class="wf-block-actions">
        <button class="wf-block-edit-btn" data-wf-builder="edit-action" data-action-idx="${idx}" title="Edit action">
          <i data-lucide="pencil" style="width:13px;height:13px;"></i>
        </button>
        <button class="wf-block-delete-btn" data-wf-builder="remove-action" data-action-idx="${idx}" title="Remove action">
          <i data-lucide="x" style="width:13px;height:13px;"></i>
        </button>
      </div>
    </div>
  `;
}

function renderAddActionButton() {
  return `
    <button class="wf-add-action-btn" data-wf-builder="open-action-picker">
      <i data-lucide="plus" style="width:18px;height:18px;"></i>
      <span>Add Action</span>
    </button>
  `;
}

// ── Builder Event Delegation ─────────────────────────────────────────────────

function attachBuilderDelegation() {
  viewContainer.addEventListener('click', handleBuilderClick);

  const nameInput = document.getElementById('wf-name-input');
  if (nameInput) {
    nameInput.addEventListener('input', () => {
      currentWorkflow.name = nameInput.value;
      builderDirty = true;
    });
  }
}

function handleBuilderClick(e) {
  const target = e.target;
  const actionEl = target.closest('[data-wf-builder]');
  if (!actionEl) return;

  const action = actionEl.dataset.wfBuilder;

  switch (action) {
    case 'back':
      closeBuilder();
      return;
    case 'save':
      saveWorkflow();
      return;
    case 'toggle-active':
      currentWorkflow.is_active = !currentWorkflow.is_active;
      builderDirty = true;
      renderBuilder();
      return;
    case 'open-trigger-picker':
      openTriggerPicker();
      return;
    case 'remove-trigger':
      currentWorkflow.trigger_config = null;
      currentWorkflow.actions = [];
      builderDirty = true;
      renderBuilder();
      return;
    case 'open-condition-editor':
      openConditionEditor();
      return;
    case 'remove-condition': {
      const idx = parseInt(actionEl.dataset.conditionIdx, 10);
      const conds = currentWorkflow.trigger_config?.conditions || [];
      conds.splice(idx, 1);
      if (currentWorkflow.trigger_config) currentWorkflow.trigger_config.conditions = conds;
      builderDirty = true;
      renderBuilder();
      return;
    }
    case 'clear-conditions':
      if (currentWorkflow.trigger_config) currentWorkflow.trigger_config.conditions = [];
      builderDirty = true;
      renderBuilder();
      return;
    case 'open-action-picker':
      openActionPicker();
      return;
    case 'edit-action': {
      const idx = parseInt(actionEl.dataset.actionIdx, 10);
      openActionEditor(idx);
      return;
    }
    case 'remove-action': {
      const idx = parseInt(actionEl.dataset.actionIdx, 10);
      currentWorkflow.actions.splice(idx, 1);
      builderDirty = true;
      renderBuilder();
      return;
    }
  }
}

// ── Close Builder ────────────────────────────────────────────────────────────

async function closeBuilder() {
  viewContainer.removeEventListener('click', handleBuilderClick);
  if (builderDirty) {
    const leave = await window.showConfirmDialog('Unsaved Changes', 'You have unsaved changes. Leave without saving?');
    if (!leave) return;
  }
  currentWorkflow = null;
  builderDirty = false;
  renderWorkflowsView();
}

// ══════════════════════════════════════════════════════════════════════════════
//  PANELS (Trigger picker, Condition editor, Action picker/editor)
// ══════════════════════════════════════════════════════════════════════════════

function createPanel(title, bodyHTML, footerHTML, wide) {
  // Remove any existing panel
  closePanel();

  const overlay = document.createElement('div');
  overlay.className = 'wf-panel-overlay active';
  overlay.id = 'wf-panel-overlay';

  const panel = document.createElement('div');
  panel.className = `wf-panel ${wide ? 'wf-panel-wide' : ''} active`;
  panel.id = 'wf-panel';
  panel.innerHTML = `
    <div class="wf-panel-header">
      <h3>${title}</h3>
      <button class="btn btn-ghost" data-panel-action="close"><i data-lucide="x" style="width:16px;height:16px;"></i></button>
    </div>
    <div class="wf-panel-body" id="wf-panel-body">${bodyHTML}</div>
    ${footerHTML ? `<div class="wf-panel-footer">${footerHTML}</div>` : ''}
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(panel);

  overlay.addEventListener('click', closePanel);
  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-panel-action="close"]')) closePanel();
  });

  if (window.lucide) setTimeout(() => lucide.createIcons(), 0);

  return panel;
}

function closePanel() {
  const overlay = document.getElementById('wf-panel-overlay');
  const panel = document.getElementById('wf-panel');
  if (overlay) overlay.remove();
  if (panel) panel.remove();
}

// ── Trigger Picker ───────────────────────────────────────────────────────────

function openTriggerPicker() {
  const existing = currentWorkflow.trigger_config;

  let selectedType = existing?.type || null;
  let selectedObject = existing?.object_type || null;
  let selectedRecordId = existing?.record_id || null;
  let selectedRecordName = existing?.record_name || null;
  let watchField = existing?.watch_field || '';
  let fromValue = existing?.from_value || '';
  let toValue = existing?.to_value || '';

  const bodyHTML = `
    <p class="wf-panel-hint">A trigger starts your workflow when something happens in your CRM.</p>
    <div class="wf-option-list" id="wf-trigger-options">
      ${TRIGGER_TYPES.map(t => `
        <button class="wf-option ${selectedType === t.id ? 'selected' : ''}" data-trigger="${t.id}">
          <div class="wf-option-icon" style="--opt-color: ${t.color}">
            <i data-lucide="${t.icon}" style="width:18px;height:18px;"></i>
          </div>
          <div class="wf-option-info">
            <div class="wf-option-label">${t.label}</div>
            <div class="wf-option-desc">${t.description}</div>
          </div>
          ${selectedType === t.id ? '<i data-lucide="check" class="wf-option-check" style="width:16px;height:16px;"></i>' : ''}
        </button>
      `).join('')}
    </div>
    <div id="wf-trigger-object-section" style="display:none;">
      <label class="wf-panel-label">Object Type</label>
      <div class="wf-option-list wf-object-options" id="wf-trigger-object-options"></div>
    </div>
    <div id="wf-trigger-field-section" style="display:none;">
      <label class="wf-panel-label">Watch Field</label>
      <select class="wf-field-input" id="wf-trigger-watch-field" style="width:100%;height:var(--control-height-md);">
        <option value="">— Select field —</option>
      </select>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-2);margin-top:var(--space-2);">
        <div>
          <label class="wf-field-label">From value (optional)</label>
          <input type="text" class="wf-field-input" id="wf-trigger-from-value" value="${escapeHtml(fromValue)}" placeholder="Any" style="width:100%;" />
        </div>
        <div>
          <label class="wf-field-label">To value (optional)</label>
          <input type="text" class="wf-field-input" id="wf-trigger-to-value" value="${escapeHtml(toValue)}" placeholder="Any" style="width:100%;" />
        </div>
      </div>
    </div>
    <div id="wf-trigger-record-section" style="display:none;">
      <label class="wf-panel-label">Which record?</label>
      <div class="wf-search-input-wrapper">
        <i data-lucide="search" style="width:14px;height:14px;" class="wf-search-icon"></i>
        <input type="text" class="wf-search-input" id="wf-trigger-search" placeholder="Search…" autocomplete="off" />
      </div>
      <p class="wf-panel-hint" style="margin-top:var(--space-2);margin-bottom:0;">Leave empty to trigger on any record of this type.</p>
      <div class="wf-search-results" id="wf-trigger-search-results"></div>
    </div>
  `;

  const footerHTML = `
    <button class="btn btn-secondary" data-panel-action="close">Cancel</button>
    <button class="btn btn-primary" id="wf-confirm-trigger-btn" disabled>Done</button>
  `;

  const panel = createPanel('Choose Trigger', bodyHTML, footerHTML, false);

  // Wire up interactions
  const confirmBtn = panel.querySelector('#wf-confirm-trigger-btn');
  const objectSection = panel.querySelector('#wf-trigger-object-section');
  const objectContainer = panel.querySelector('#wf-trigger-object-options');
  const recordSection = panel.querySelector('#wf-trigger-record-section');
  const fieldSection = panel.querySelector('#wf-trigger-field-section');

  function updateUI() {
    const needsObject = ['record_created', 'record_updated', 'field_changed'].includes(selectedType);
    const isTask = ['task_created', 'task_completed'].includes(selectedType);
    const isFieldChanged = selectedType === 'field_changed';

    objectSection.style.display = needsObject ? 'block' : 'none';
    fieldSection.style.display = isFieldChanged && selectedObject ? 'block' : 'none';
    recordSection.style.display = (selectedType === 'record_updated' && selectedObject) ? 'block' : 'none';

    if (needsObject) {
      objectContainer.innerHTML = ['companies', 'people', 'opportunities'].map(obj => `
        <button class="wf-option wf-option-sm ${selectedObject === obj ? 'selected' : ''}" data-object="${obj}">
          <div class="wf-option-icon" style="--opt-color: var(--text-secondary)">
            <i data-lucide="${OBJECT_ICONS[obj]}" style="width:16px;height:16px;"></i>
          </div>
          <span class="wf-option-label">${OBJECT_LABELS[obj]}</span>
        </button>
      `).join('');
      if (window.lucide) setTimeout(() => lucide.createIcons(), 0);
    }

    if (isFieldChanged && selectedObject) {
      const fields = OBJECT_FIELDS[selectedObject] || [];
      const selectEl = panel.querySelector('#wf-trigger-watch-field');
      if (selectEl) {
        selectEl.innerHTML = '<option value="">— Select field —</option>' +
          fields.map(f => `<option value="${f.key}" ${watchField === f.key ? 'selected' : ''}>${f.label}</option>`).join('');
      }
    }

    confirmBtn.disabled = !selectedType || (needsObject && !selectedObject);
  }

  // Trigger type selection
  panel.querySelector('#wf-trigger-options').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-trigger]');
    if (!btn) return;
    selectedType = btn.dataset.trigger;
    selectedObject = null;
    selectedRecordId = null;
    selectedRecordName = null;
    watchField = '';
    fromValue = '';
    toValue = '';
    panel.querySelectorAll('#wf-trigger-options .wf-option').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    updateUI();
  });

  // Object type selection
  objectContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-object]');
    if (!btn) return;
    selectedObject = btn.dataset.object;
    selectedRecordId = null;
    selectedRecordName = null;
    watchField = '';
    objectContainer.querySelectorAll('.wf-option').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    updateUI();
  });

  // Watch field
  panel.addEventListener('change', (e) => {
    if (e.target.id === 'wf-trigger-watch-field') watchField = e.target.value;
  });
  panel.addEventListener('input', (e) => {
    if (e.target.id === 'wf-trigger-from-value') fromValue = e.target.value;
    if (e.target.id === 'wf-trigger-to-value') toValue = e.target.value;
  });

  // Record search
  let searchDebounce;
  panel.addEventListener('input', (e) => {
    if (e.target.id !== 'wf-trigger-search') return;
    clearTimeout(searchDebounce);
    const query = e.target.value.trim();
    const resultsEl = panel.querySelector('#wf-trigger-search-results');
    if (query.length < 2) { resultsEl.innerHTML = ''; return; }
    searchDebounce = setTimeout(async () => {
      resultsEl.innerHTML = '<div class="wf-search-loading">Searching…</div>';
      const { data } = await supabaseClient
        .from(selectedObject)
        .select('id, name')
        .eq('organization_id', state.currentOrganization?.id)
        .ilike('name', `%${query}%`)
        .limit(8);
      if (!data || data.length === 0) {
        resultsEl.innerHTML = '<div class="wf-search-loading">No results</div>';
        return;
      }
      resultsEl.innerHTML = data.map(r => `
        <button class="wf-search-result" data-id="${r.id}" data-name="${escapeHtml(r.name || '')}">
          <i data-lucide="${OBJECT_ICONS[selectedObject] || 'file'}" style="width:14px;height:14px;"></i>
          <span>${escapeHtml(r.name || 'Untitled')}</span>
        </button>
      `).join('');
      if (window.lucide) setTimeout(() => lucide.createIcons(), 0);
    }, 250);
  });

  panel.addEventListener('click', (e) => {
    const result = e.target.closest('.wf-search-result');
    if (result) {
      selectedRecordId = result.dataset.id;
      selectedRecordName = result.dataset.name;
      const searchInput = panel.querySelector('#wf-trigger-search');
      if (searchInput) searchInput.value = result.dataset.name;
      const resultsEl = panel.querySelector('#wf-trigger-search-results');
      resultsEl.innerHTML = `<div class="wf-search-selected"><i data-lucide="check" style="width:14px;height:14px;color:var(--color-success);"></i> ${escapeHtml(result.dataset.name)}</div>`;
      if (window.lucide) setTimeout(() => lucide.createIcons(), 0);
    }
  });

  // Confirm
  confirmBtn.addEventListener('click', () => {
    currentWorkflow.trigger_config = {
      type: selectedType,
      object_type: selectedObject,
      record_id: selectedRecordId || null,
      record_name: selectedRecordName || null,
      conditions: currentWorkflow.trigger_config?.conditions || [],
    };
    if (selectedType === 'field_changed') {
      currentWorkflow.trigger_config.watch_field = watchField;
      currentWorkflow.trigger_config.from_value = fromValue || null;
      currentWorkflow.trigger_config.to_value = toValue || null;
    }
    builderDirty = true;
    closePanel();
    renderBuilder();
  });

  if (selectedType) updateUI();
}

// ── Condition Editor ─────────────────────────────────────────────────────────

function openConditionEditor() {
  const trigger = currentWorkflow.trigger_config;
  if (!trigger) return;

  const conditions = JSON.parse(JSON.stringify(trigger.conditions || []));
  const fields = getFieldsForTrigger(trigger);

  function renderConditionRows() {
    if (conditions.length === 0) {
      return '<p class="wf-panel-hint">No conditions yet. Add one to filter when this workflow runs.</p>';
    }
    return conditions.map((c, idx) => `
      <div class="wf-condition-row" data-condition-idx="${idx}">
        <select class="wf-field-input wf-condition-field-select" data-idx="${idx}" data-prop="field">
          <option value="">— Field —</option>
          ${fields.map(f => `<option value="${f.key}" ${c.field === f.key ? 'selected' : ''}>${f.label}</option>`).join('')}
        </select>
        <select class="wf-field-input wf-condition-op-select" data-idx="${idx}" data-prop="operator">
          ${CONDITION_OPERATORS.map(op => `<option value="${op.id}" ${c.operator === op.id ? 'selected' : ''}>${op.label}</option>`).join('')}
        </select>
        ${!['is_empty', 'is_not_empty'].includes(c.operator) ? `
          <input type="text" class="wf-field-input wf-condition-value-input" data-idx="${idx}" data-prop="value" value="${escapeHtml(c.value || '')}" placeholder="Value" />
        ` : ''}
        <button class="wf-block-delete-btn" data-remove-condition="${idx}" title="Remove">
          <i data-lucide="x" style="width:13px;height:13px;"></i>
        </button>
      </div>
    `).join('');
  }

  const bodyHTML = `
    <p class="wf-panel-hint">Only run this workflow when ALL conditions are met.</p>
    <div id="wf-conditions-container">${renderConditionRows()}</div>
    <button class="wf-add-condition-inline-btn" id="wf-add-condition-btn">
      <i data-lucide="plus" style="width:14px;height:14px;"></i> Add condition
    </button>
  `;

  const footerHTML = `
    <button class="btn btn-secondary" data-panel-action="close">Cancel</button>
    <button class="btn btn-primary" id="wf-confirm-conditions-btn">Apply</button>
  `;

  const panel = createPanel('Conditions', bodyHTML, footerHTML, true);

  function refreshRows() {
    const container = panel.querySelector('#wf-conditions-container');
    container.innerHTML = renderConditionRows();
    if (window.lucide) setTimeout(() => lucide.createIcons(), 0);
  }

  // Add condition
  panel.querySelector('#wf-add-condition-btn').addEventListener('click', () => {
    conditions.push({ field: '', operator: 'equals', value: '' });
    refreshRows();
  });

  // Change/remove handlers via delegation
  panel.addEventListener('change', (e) => {
    const idx = parseInt(e.target.dataset?.idx, 10);
    const prop = e.target.dataset?.prop;
    if (!isNaN(idx) && prop) {
      conditions[idx][prop] = e.target.value;
      if (prop === 'operator' && ['is_empty', 'is_not_empty'].includes(e.target.value)) {
        conditions[idx].value = '';
        refreshRows();
      }
    }
  });

  panel.addEventListener('input', (e) => {
    const idx = parseInt(e.target.dataset?.idx, 10);
    const prop = e.target.dataset?.prop;
    if (!isNaN(idx) && prop) {
      conditions[idx][prop] = e.target.value;
    }
  });

  panel.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('[data-remove-condition]');
    if (removeBtn) {
      const idx = parseInt(removeBtn.dataset.removeCondition, 10);
      conditions.splice(idx, 1);
      refreshRows();
    }
  });

  // Confirm
  panel.querySelector('#wf-confirm-conditions-btn').addEventListener('click', () => {
    // Filter out incomplete conditions
    const validConditions = conditions.filter(c => c.field && c.operator);
    currentWorkflow.trigger_config.conditions = validConditions;
    builderDirty = true;
    closePanel();
    renderBuilder();
  });
}

// ── Action Picker ────────────────────────────────────────────────────────────

function openActionPicker() {
  const triggerType = currentWorkflow.trigger_config?.type;
  const allowedActions = ACTION_TYPES.filter(a => {
    // Prevent infinite loop: task triggers cannot create/update tasks
    if (['task_created', 'task_completed'].includes(triggerType) && ['create_task', 'update_task'].includes(a.id)) return false;
    return true;
  });

  const bodyHTML = `
    <p class="wf-panel-hint">Choose what happens when the trigger fires.</p>
    <div class="wf-option-list">
      ${allowedActions.map(a => `
        <button class="wf-option" data-action-type="${a.id}">
          <div class="wf-option-icon" style="--opt-color: ${a.color}">
            <i data-lucide="${a.icon}" style="width:18px;height:18px;"></i>
          </div>
          <div class="wf-option-info">
            <div class="wf-option-label">${a.label}</div>
            <div class="wf-option-desc">${a.description}</div>
          </div>
        </button>
      `).join('')}
    </div>
  `;

  const panel = createPanel('Add Action', bodyHTML, '', false);

  panel.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action-type]');
    if (!btn) return;
    const type = btn.dataset.actionType;
    closePanel();
    addNewAction(type);
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

  if (type === 'send_notification') {
    action.message = '';
    action.notify_users = [];
  }

  if (!currentWorkflow.actions) currentWorkflow.actions = [];
  currentWorkflow.actions.push(action);
  builderDirty = true;

  const idx = currentWorkflow.actions.length - 1;
  renderBuilder();
  setTimeout(() => openActionEditor(idx), 100);
}

// ── Action Editor ────────────────────────────────────────────────────────────

function openActionEditor(idx) {
  const action = currentWorkflow.actions[idx];
  if (!action) return;

  const at = ACTION_TYPES.find(a => a.id === action.type);
  const needsObject = ['create_record', 'update_record'].includes(action.type);
  const needsTaskFields = ['create_task', 'update_task'].includes(action.type);
  const needsSearch = ['update_record', 'update_task'].includes(action.type);
  const isNotification = action.type === 'send_notification';

  let bodyHTML = '';

  if (needsObject) {
    bodyHTML += renderObjectSelector(action);
  }

  if (needsSearch) {
    bodyHTML += renderSearchSection(action);
  }

  if (isNotification) {
    bodyHTML += renderNotificationEditor(action);
  }

  bodyHTML += `<div id="wf-action-fields-container">${renderFieldsEditor(action)}</div>`;

  const footerHTML = `
    <button class="btn btn-secondary" data-panel-action="close">Cancel</button>
    <button class="btn btn-primary" id="wf-confirm-action-btn">Done</button>
  `;

  const panel = createPanel(at?.label || 'Edit Action', bodyHTML, footerHTML, true);

  // Object type selection
  const objectContainer = panel.querySelector('#wf-action-object-options');
  if (objectContainer) {
    objectContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-object]');
      if (!btn) return;
      action.object_type = btn.dataset.object;
      objectContainer.querySelectorAll('.wf-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      // Re-render fields
      const fieldsContainer = panel.querySelector('#wf-action-fields-container');
      if (fieldsContainer) {
        fieldsContainer.innerHTML = renderFieldsEditor(action);
        if (window.initAllCrmDropdowns) window.initAllCrmDropdowns();
        initCalendarsInPanel();
        loadAssigneeDropdowns(action);
      }
      // Update search placeholder
      const searchInput = panel.querySelector('#wf-live-search');
      if (searchInput) {
        searchInput.placeholder = `Search ${OBJECT_LABELS[action.object_type] || 'record'}…`;
        action.target_record_id = null;
        action.target_record_name = null;
        searchInput.value = '';
        const resultsEl = panel.querySelector('#wf-search-results');
        if (resultsEl) resultsEl.innerHTML = '';
      }
    });
  }

  // Live search for update_record / update_task
  const searchInput = panel.querySelector('#wf-live-search');
  if (searchInput) {
    let debounceTimer;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const query = searchInput.value.trim();
      const resultsEl = panel.querySelector('#wf-search-results');
      if (query.length < 2) { resultsEl.innerHTML = ''; return; }
      debounceTimer = setTimeout(() => runLiveSearch(panel, action, query), 250);
    });
  }

  // Notification message
  const msgInput = panel.querySelector('#wf-notification-message');
  if (msgInput) {
    msgInput.addEventListener('input', () => {
      action.message = msgInput.value;
    });
  }

  // Confirm
  panel.querySelector('#wf-confirm-action-btn').addEventListener('click', () => {
    // Collect field values
    const fieldInputs = panel.querySelectorAll('.wf-field-input[data-field-key]');
    const vals = {};
    fieldInputs.forEach(input => {
      const key = input.dataset.fieldKey;
      const value = input.value.trim();
      if (key && value) vals[key] = value;
    });
    action.field_values = vals;

    // Collect notification users
    const userCheckboxes = panel.querySelectorAll('.wf-notify-user-checkbox:checked');
    if (isNotification) {
      action.notify_users = Array.from(userCheckboxes).map(cb => cb.value);
    }

    builderDirty = true;
    closePanel();
    renderBuilder();
  });

  // Init custom dropdowns and calendars
  if (window.initAllCrmDropdowns) setTimeout(() => window.initAllCrmDropdowns(), 50);
  initCalendarsInPanel();
  if (needsTaskFields || (needsObject && action.object_type)) {
    loadAssigneeDropdowns(action);
  }
}

function renderObjectSelector(action) {
  return `
    <div class="wf-editor-section">
      <label class="wf-panel-label">Object Type</label>
      <div class="wf-option-list wf-object-options" id="wf-action-object-options">
        ${['companies', 'people', 'opportunities'].map(obj => `
          <button class="wf-option wf-option-sm ${action.object_type === obj ? 'selected' : ''}" data-object="${obj}">
            <div class="wf-option-icon" style="--opt-color: var(--text-secondary)">
              <i data-lucide="${OBJECT_ICONS[obj]}" style="width:16px;height:16px;"></i>
            </div>
            <span class="wf-option-label">${OBJECT_LABELS[obj]}</span>
          </button>
        `).join('')}
      </div>
    </div>
  `;
}

function renderSearchSection(action) {
  const searchType = action.type === 'update_task' ? 'task' : (OBJECT_LABELS[action.object_type] || 'record');
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

function renderNotificationEditor(action) {
  return `
    <div class="wf-editor-section">
      <label class="wf-panel-label">Message</label>
      <textarea class="wf-field-input" id="wf-notification-message" rows="3" placeholder="Enter notification message…&#10;Use {{record.name}} for dynamic values"
        style="width:100%;height:auto;padding:var(--space-2) var(--space-3);resize:vertical;min-height:56px;">${escapeHtml(action.message || '')}</textarea>
      <p class="wf-panel-hint" style="margin-top:var(--space-2);margin-bottom:0;">Variables: {{record.name}}, {{record.email}}, {{record.stage}}, etc.</p>
    </div>
    <div class="wf-editor-section">
      <label class="wf-panel-label">Notify Users</label>
      <div id="wf-notify-users-container" class="wf-notify-users-list">
        <p class="wf-panel-hint">Loading team members…</p>
      </div>
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
  } else {
    return '';
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

// ── Panel Helpers ────────────────────────────────────────────────────────────

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
  const panel = document.getElementById('wf-panel');
  if (!panel) return;

  const selects = panel.querySelectorAll('.wf-assignee-select');
  const notifyContainer = panel.querySelector('#wf-notify-users-container');

  const { data: profiles } = await supabaseClient
    .from('profiles')
    .select('id, first_name, last_name')
    .eq('organization_id', state.currentOrganization?.id);

  const profileList = profiles || [];

  // Assignee dropdowns
  if (selects.length > 0) {
    const val = (action.field_values || {}).assigned_to || '';
    selects.forEach(sel => {
      if (window.updateCrmDropdownOptions) {
        const root = sel.closest('.crm-dd');
        const options = [{ value: '', label: '— Select —' }].concat(
          profileList.map(p => ({ value: p.id, label: `${p.first_name || ''} ${p.last_name || ''}`.trim() }))
        );
        window.updateCrmDropdownOptions(root, options, false);
        window.setCrmDropdownValue(root, val);
      }
    });
  }

  // Notification user checkboxes
  if (notifyContainer) {
    const selectedUsers = action.notify_users || [];
    notifyContainer.innerHTML = profileList.length === 0
      ? '<p class="wf-panel-hint">No team members found.</p>'
      : profileList.map(p => {
          const name = `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown';
          const checked = selectedUsers.includes(p.id);
          return `
            <label class="wf-notify-user-item">
              <input type="checkbox" class="wf-notify-user-checkbox" value="${p.id}" ${checked ? 'checked' : ''} />
              <span class="wf-notify-user-name">${escapeHtml(name)}</span>
            </label>
          `;
        }).join('');
  }
}

async function runLiveSearch(panel, action, query) {
  const resultsEl = panel.querySelector('#wf-search-results');
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

  const { data, error } = await supabaseClient
    .from(table)
    .select('*')
    .eq('organization_id', state.currentOrganization?.id)
    .ilike(nameCol, `%${query}%`)
    .limit(8);

  if (error || !data || data.length === 0) {
    resultsEl.innerHTML = '<div class="wf-search-loading">No results found</div>';
    return;
  }

  resultsEl.innerHTML = data.map(row => `
    <button class="wf-search-result" data-id="${row.id}" data-name="${escapeHtml(row[nameCol] || '')}">
      <i data-lucide="${table === 'tasks' ? 'check-square' : OBJECT_ICONS[table] || 'file'}" style="width:14px;height:14px;"></i>
      <span>${escapeHtml(row[nameCol] || 'Untitled')}</span>
    </button>
  `).join('');

  if (window.lucide) setTimeout(() => lucide.createIcons(), 0);

  resultsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.wf-search-result');
    if (!btn) return;
    action.target_record_id = btn.dataset.id;
    action.target_record_name = btn.dataset.name;
    const searchInput = panel.querySelector('#wf-live-search');
    if (searchInput) searchInput.value = btn.dataset.name;
    resultsEl.innerHTML = `<div class="wf-search-selected"><i data-lucide="check" style="width:14px;height:14px;color:var(--color-success);"></i> ${escapeHtml(btn.dataset.name)}</div>`;
    if (window.lucide) setTimeout(() => lucide.createIcons(), 0);

    // Auto-fill form fields
    const record = data.find(r => r.id === btn.dataset.id);
    if (record) {
      const fields = action.type === 'update_task' ? TASK_FIELDS : (OBJECT_FIELDS[action.object_type] || []);
      fields.forEach(f => {
        if (f.type === 'assignee') return;
        const input = panel.querySelector(`.wf-field-input[data-field-key="${f.key}"]`);
        if (input && record[f.key] != null) {
          input.value = record[f.key];
        }
      });
    }
  });
}

// ── Helper: Get Fields For Trigger ───────────────────────────────────────────

function getFieldsForTrigger(trigger) {
  if (!trigger) return [];
  if (['task_created', 'task_completed'].includes(trigger.type)) return TASK_FIELDS;
  if (trigger.object_type) return OBJECT_FIELDS[trigger.object_type] || [];
  // If no specific object type, return all record fields
  return [
    ...OBJECT_FIELDS.companies,
    ...OBJECT_FIELDS.people,
    ...OBJECT_FIELDS.opportunities,
  ];
}

// ══════════════════════════════════════════════════════════════════════════════
//  SAVE WORKFLOW
// ══════════════════════════════════════════════════════════════════════════════

async function saveWorkflow() {
  const wf = currentWorkflow;
  if (!wf) return;

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
    is_active: wf.is_active,
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

  invalidateWorkflowCache();
  builderDirty = false;
  showToast(`Workflow "${wf.name}" saved`, 'success');
  currentWorkflow = null;
  viewContainer.removeEventListener('click', handleBuilderClick);
  renderWorkflowsView();
}

// ── Utility ──────────────────────────────────────────────────────────────────

function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

// ── Exports ──────────────────────────────────────────────────────────────────
export {
  renderWorkflowsView,
  openBuilder as openWorkflowBuilder,
  closeBuilder as closeWorkflowBuilder,
  saveWorkflow,
  handleDelete as deleteWorkflow,
  handleToggle as toggleWorkflowActive,
  openTriggerPicker,
  openActionPicker,
  openActionEditor,
  closePanel,
};
