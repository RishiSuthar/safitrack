// modules/features/workflow-engine.js
// Workflow run history for the Workflows screen. Workflows themselves are
// executed in the database (run_workflows trigger), once per change, so
// they run even when no manager has the app open.

import { state, supabaseClient } from '../state.js';
import { fetchAllPages } from '../utils/analytics.js';

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
  const { data, error } = await fetchAllPages(supabaseClient
    .from('workflow_runs')
    .select('workflow_id, status, created_at')
    .eq('organization_id', state.currentOrganization?.id)
    .order('created_at', { ascending: false }));

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
  getWorkflowRuns,
  getAllWorkflowRuns,
  getWorkflowRunStats,
};
