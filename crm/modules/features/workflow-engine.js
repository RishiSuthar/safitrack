// modules/features/workflow-engine.js
// Runtime engine — subscribes to Supabase Realtime, matches active workflows,
// evaluates conditions, executes actions, and logs runs.

import { state, supabaseClient } from '../state.js';
import { showToast } from '../ui/toast.js';

// ── Constants ────────────────────────────────────────────────────────────────

const MONITORED_TABLES = ['companies', 'people', 'opportunities', 'tasks'];

const TRIGGER_EVENT_MAP = {
  INSERT: {
    companies: 'record_created',
    people: 'record_created',
    opportunities: 'record_created',
    tasks: 'task_created',
  },
  UPDATE: {
    companies: 'record_updated',
    people: 'record_updated',
    opportunities: 'record_updated',
    tasks: 'task_updated',
  },
};

const OBJECT_TYPE_FROM_TABLE = {
  companies: 'companies',
  people: 'people',
  opportunities: 'opportunities',
};

// ── State ────────────────────────────────────────────────────────────────────

let channel = null;
let cachedWorkflows = [];
let cacheExpiry = 0;
const CACHE_TTL_MS = 30_000; // 30s

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Start the workflow engine. Call once after auth + org are loaded.
 * Sets up Supabase Realtime listeners on core CRM tables.
 */
function initWorkflowEngine() {
  if (channel) return; // already running
  if (!state.currentOrganization?.id) return;

  channel = supabaseClient
    .channel('workflow-engine')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'companies', filter: `organization_id=eq.${state.currentOrganization.id}` },
      (payload) => handleRealtimeEvent('companies', 'INSERT', payload)
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'companies', filter: `organization_id=eq.${state.currentOrganization.id}` },
      (payload) => handleRealtimeEvent('companies', 'UPDATE', payload)
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'people', filter: `organization_id=eq.${state.currentOrganization.id}` },
      (payload) => handleRealtimeEvent('people', 'INSERT', payload)
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'people', filter: `organization_id=eq.${state.currentOrganization.id}` },
      (payload) => handleRealtimeEvent('people', 'UPDATE', payload)
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'opportunities', filter: `organization_id=eq.${state.currentOrganization.id}` },
      (payload) => handleRealtimeEvent('opportunities', 'INSERT', payload)
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'opportunities', filter: `organization_id=eq.${state.currentOrganization.id}` },
      (payload) => handleRealtimeEvent('opportunities', 'UPDATE', payload)
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'tasks', filter: `organization_id=eq.${state.currentOrganization.id}` },
      (payload) => handleRealtimeEvent('tasks', 'INSERT', payload)
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'tasks', filter: `organization_id=eq.${state.currentOrganization.id}` },
      (payload) => handleRealtimeEvent('tasks', 'UPDATE', payload)
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('[WorkflowEngine] Realtime subscription active');
      }
    });
}

/**
 * Stop the engine and clean up the channel.
 */
function stopWorkflowEngine() {
  if (channel) {
    supabaseClient.removeChannel(channel);
    channel = null;
  }
  cachedWorkflows = [];
  cacheExpiry = 0;
}

/**
 * Invalidate the workflow cache so the next event re-fetches.
 * Called when a workflow is saved/deleted/toggled.
 */
function invalidateWorkflowCache() {
  cacheExpiry = 0;
}

// ── Realtime Event Handler ───────────────────────────────────────────────────

async function handleRealtimeEvent(table, eventType, payload) {
  const record = payload.new || {};
  const oldRecord = payload.old || {};

  // Ignore events from our own workflow engine actions (prevent infinite loops)
  if (record._wf_source === 'workflow-engine') return;

  const workflows = await getActiveWorkflows();
  if (workflows.length === 0) return;

  for (const wf of workflows) {
    const trigger = wf.trigger_config;
    if (!trigger) continue;

    const matched = matchesTrigger(trigger, table, eventType, record, oldRecord);
    if (!matched) continue;

    // Evaluate conditions
    const conditions = trigger.conditions || [];
    if (!evaluateConditions(conditions, record)) continue;

    // Execute the workflow
    await executeWorkflow(wf, { table, eventType, record, oldRecord });
  }
}

// ── Trigger Matching ─────────────────────────────────────────────────────────

function matchesTrigger(trigger, table, eventType, record, oldRecord) {
  const triggerType = trigger.type;
  const isTask = table === 'tasks';

  switch (triggerType) {
    case 'record_created':
      if (isTask) return false;
      if (eventType !== 'INSERT') return false;
      if (trigger.object_type && trigger.object_type !== table) return false;
      if (trigger.record_id && trigger.record_id !== record.id) return false;
      return true;

    case 'record_updated':
      if (isTask) return false;
      if (eventType !== 'UPDATE') return false;
      if (trigger.object_type && trigger.object_type !== table) return false;
      if (trigger.record_id && trigger.record_id !== record.id) return false;
      return true;

    case 'field_changed':
      if (eventType !== 'UPDATE') return false;
      if (isTask) {
        // field_changed on tasks not supported for object_type filter
      } else if (trigger.object_type && trigger.object_type !== table) {
        return false;
      }
      if (trigger.watch_field) {
        const oldVal = oldRecord[trigger.watch_field];
        const newVal = record[trigger.watch_field];
        if (oldVal === newVal) return false;
        if (trigger.from_value && String(oldVal) !== String(trigger.from_value)) return false;
        if (trigger.to_value && String(newVal) !== String(trigger.to_value)) return false;
      }
      return true;

    case 'task_created':
      if (!isTask) return false;
      if (eventType !== 'INSERT') return false;
      return true;

    case 'task_completed':
      if (!isTask) return false;
      if (eventType !== 'UPDATE') return false;
      // Must have transitioned to 'completed'
      if (record.status !== 'completed') return false;
      if (oldRecord.status === 'completed') return false; // already was completed
      return true;

    default:
      return false;
  }
}

// ── Condition Evaluator ──────────────────────────────────────────────────────

function evaluateConditions(conditions, record) {
  if (!conditions || conditions.length === 0) return true;

  return conditions.every(cond => {
    const fieldValue = record[cond.field];
    const testValue = cond.value;

    switch (cond.operator) {
      case 'equals':
        return String(fieldValue ?? '') === String(testValue ?? '');
      case 'not_equals':
        return String(fieldValue ?? '') !== String(testValue ?? '');
      case 'contains':
        return String(fieldValue ?? '').toLowerCase().includes(String(testValue ?? '').toLowerCase());
      case 'not_contains':
        return !String(fieldValue ?? '').toLowerCase().includes(String(testValue ?? '').toLowerCase());
      case 'greater_than':
        return Number(fieldValue) > Number(testValue);
      case 'less_than':
        return Number(fieldValue) < Number(testValue);
      case 'is_empty':
        return fieldValue == null || String(fieldValue).trim() === '';
      case 'is_not_empty':
        return fieldValue != null && String(fieldValue).trim() !== '';
      default:
        return true; // unknown operator, pass
    }
  });
}

// ── Workflow Executor ────────────────────────────────────────────────────────

async function executeWorkflow(workflow, triggerEvent) {
  const startTime = performance.now();
  const actionsExecuted = [];
  let errorMessage = null;
  let status = 'success';

  try {
    const actions = workflow.actions || [];
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      try {
        const result = await executeAction(action, triggerEvent);
        actionsExecuted.push({
          index: i,
          type: action.type,
          status: 'success',
          result_id: result?.id || null,
        });
      } catch (err) {
        actionsExecuted.push({
          index: i,
          type: action.type,
          status: 'error',
          error: err.message,
        });
        status = 'partial_failure';
        errorMessage = `Action ${i + 1} failed: ${err.message}`;
      }
    }
  } catch (err) {
    status = 'error';
    errorMessage = err.message;
  }

  const durationMs = Math.round(performance.now() - startTime);

  // Log the run
  await logWorkflowRun(workflow.id, triggerEvent, actionsExecuted, status, errorMessage, durationMs);
}

// ── Action Executor ──────────────────────────────────────────────────────────

async function executeAction(action, triggerEvent) {
  switch (action.type) {
    case 'create_record':
      return await executeCreateRecord(action, triggerEvent);
    case 'update_record':
      return await executeUpdateRecord(action, triggerEvent);
    case 'create_task':
      return await executeCreateTask(action, triggerEvent);
    case 'update_task':
      return await executeUpdateTask(action, triggerEvent);
    case 'send_notification':
      return await executeSendNotification(action, triggerEvent);
    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }
}

async function executeCreateRecord(action, triggerEvent) {
  if (!action.object_type) throw new Error('No object type specified');
  const fieldValues = resolveFieldValues(action.field_values || {}, triggerEvent);

  const payload = {
    ...fieldValues,
    organization_id: state.currentOrganization.id,
    _wf_source: 'workflow-engine',
  };

  const { data, error } = await supabaseClient
    .from(action.object_type)
    .insert([payload])
    .select('id')
    .single();

  if (error) throw new Error(error.message);
  return data;
}

async function executeUpdateRecord(action, triggerEvent) {
  const targetId = action.target_record_id || triggerEvent.record?.id;
  const table = action.object_type || triggerEvent.table;
  if (!targetId || !table) throw new Error('No target record to update');

  const fieldValues = resolveFieldValues(action.field_values || {}, triggerEvent);
  fieldValues._wf_source = 'workflow-engine';

  const { data, error } = await supabaseClient
    .from(table)
    .update(fieldValues)
    .eq('id', targetId)
    .select('id')
    .single();

  if (error) throw new Error(error.message);
  return data;
}

async function executeCreateTask(action, triggerEvent) {
  const fieldValues = resolveFieldValues(action.field_values || {}, triggerEvent);

  const payload = {
    title: fieldValues.title || `Auto-task from workflow`,
    description: fieldValues.description || '',
    assigned_to: fieldValues.assigned_to || state.currentUser?.id,
    priority: fieldValues.priority || 'medium',
    status: fieldValues.status || 'pending',
    due_date: fieldValues.due_date || null,
    organization_id: state.currentOrganization.id,
    created_by: state.currentUser?.id,
    _wf_source: 'workflow-engine',
  };

  // Link to triggering record if applicable
  if (triggerEvent.table && triggerEvent.table !== 'tasks' && triggerEvent.record?.id) {
    if (triggerEvent.table === 'companies') payload.company_id = triggerEvent.record.id;
    if (triggerEvent.table === 'people') payload.person_id = triggerEvent.record.id;
    if (triggerEvent.table === 'opportunities') payload.opportunity_id = triggerEvent.record.id;
  }

  const { data, error } = await supabaseClient
    .from('tasks')
    .insert([payload])
    .select('id')
    .single();

  if (error) throw new Error(error.message);
  return data;
}

async function executeUpdateTask(action, triggerEvent) {
  const targetId = action.target_record_id || triggerEvent.record?.id;
  if (!targetId) throw new Error('No target task to update');

  const fieldValues = resolveFieldValues(action.field_values || {}, triggerEvent);
  fieldValues._wf_source = 'workflow-engine';

  const { data, error } = await supabaseClient
    .from('tasks')
    .update(fieldValues)
    .eq('id', targetId)
    .select('id')
    .single();

  if (error) throw new Error(error.message);
  return data;
}

async function executeSendNotification(action, triggerEvent) {
  // Use the existing notification toast system to show in-app notifications
  const recipientIds = action.notify_users || [];
  const message = resolveTemplate(action.message || 'Workflow triggered', triggerEvent);
  const record = triggerEvent.record || {};

  // Show a toast for the current user if they're a recipient (or if no specific recipients set)
  if (recipientIds.length === 0 || recipientIds.includes(state.currentUser?.id)) {
    showToast(message, 'info');
  }

  // Insert notification records for other users via a simple broadcast approach:
  // We'll insert into a lightweight notifications table or just use toasts for now.
  // The notification system is polling-based, so for cross-user delivery we log it.
  if (recipientIds.length > 0) {
    // Create tasks as "notification tasks" that will show up in the notification system
    for (const userId of recipientIds) {
      if (userId === state.currentUser?.id) continue; // already toasted above
      try {
        await supabaseClient.from('tasks').insert([{
          title: `🔔 ${message}`,
          description: `Auto-generated by workflow. Trigger: ${triggerEvent.eventType} on ${triggerEvent.table}`,
          assigned_to: userId,
          priority: 'low',
          status: 'pending',
          organization_id: state.currentOrganization.id,
          created_by: state.currentUser?.id,
          _wf_source: 'workflow-engine',
        }]);
      } catch {
        // Best-effort notification delivery
      }
    }
  }

  return { notified: recipientIds.length || 1 };
}

// ── Field Value Resolution ───────────────────────────────────────────────────

/**
 * Resolve field values, supporting template placeholders like {{record.name}}.
 */
function resolveFieldValues(fieldValues, triggerEvent) {
  const resolved = {};
  for (const [key, value] of Object.entries(fieldValues)) {
    if (typeof value === 'string') {
      resolved[key] = resolveTemplate(value, triggerEvent);
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

function resolveTemplate(template, triggerEvent) {
  if (!template || typeof template !== 'string') return template;
  const record = triggerEvent.record || {};
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (match, path) => {
    const parts = path.split('.');
    if (parts[0] === 'record') {
      return record[parts[1]] ?? match;
    }
    if (parts[0] === 'trigger') {
      return triggerEvent[parts[1]] ?? match;
    }
    return record[path] ?? match;
  });
}

// ── Workflow Cache ───────────────────────────────────────────────────────────

async function getActiveWorkflows() {
  const now = Date.now();
  if (cachedWorkflows.length > 0 && now < cacheExpiry) {
    return cachedWorkflows;
  }

  const { data, error } = await supabaseClient
    .from('workflows')
    .select('*')
    .eq('organization_id', state.currentOrganization?.id)
    .eq('is_active', true);

  if (error) {
    console.error('[WorkflowEngine] Failed to fetch workflows:', error.message);
    return cachedWorkflows; // return stale cache
  }

  cachedWorkflows = data || [];
  cacheExpiry = now + CACHE_TTL_MS;
  return cachedWorkflows;
}

// ── Run Logger ───────────────────────────────────────────────────────────────

async function logWorkflowRun(workflowId, triggerEvent, actionsExecuted, status, errorMessage, durationMs) {
  try {
    await supabaseClient.from('workflow_runs').insert([{
      workflow_id: workflowId,
      organization_id: state.currentOrganization?.id,
      trigger_event: {
        table: triggerEvent.table,
        event_type: triggerEvent.eventType,
        record_id: triggerEvent.record?.id,
        record_name: triggerEvent.record?.name || triggerEvent.record?.title || null,
      },
      actions_executed: actionsExecuted,
      status,
      error_message: errorMessage,
      duration_ms: durationMs,
    }]);
  } catch (err) {
    console.error('[WorkflowEngine] Failed to log run:', err.message);
  }
}

// ── Public Query API ─────────────────────────────────────────────────────────

async function getWorkflowRuns(workflowId, limit = 50) {
  const { data, error } = await supabaseClient
    .from('workflow_runs')
    .select('*')
    .eq('workflow_id', workflowId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return [];
  return data || [];
}

async function getAllWorkflowRuns(limit = 100) {
  const { data, error } = await supabaseClient
    .from('workflow_runs')
    .select('*, workflows(name)')
    .eq('organization_id', state.currentOrganization?.id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return [];
  return data || [];
}

async function getWorkflowRunStats() {
  // Get run counts and last run time for all workflows
  const { data, error } = await supabaseClient
    .from('workflow_runs')
    .select('workflow_id, status, created_at')
    .eq('organization_id', state.currentOrganization?.id)
    .order('created_at', { ascending: false });

  if (error) return {};

  const stats = {};
  for (const run of (data || [])) {
    if (!stats[run.workflow_id]) {
      stats[run.workflow_id] = {
        total_runs: 0,
        successful_runs: 0,
        failed_runs: 0,
        last_run_at: run.created_at,
        last_status: run.status,
      };
    }
    stats[run.workflow_id].total_runs++;
    if (run.status === 'success') stats[run.workflow_id].successful_runs++;
    else stats[run.workflow_id].failed_runs++;
  }

  return stats;
}

// ── Exports ──────────────────────────────────────────────────────────────────

export {
  initWorkflowEngine,
  stopWorkflowEngine,
  invalidateWorkflowCache,
  evaluateConditions,
  getWorkflowRuns,
  getAllWorkflowRuns,
  getWorkflowRunStats,
};
