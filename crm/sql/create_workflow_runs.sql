-- ============================================================
-- Workflow execution log table
-- Adds missing columns to existing workflow_runs table
-- and creates indexes + RLS policies.
-- Safe to re-run.
-- ============================================================

-- Add any missing columns to the existing table
ALTER TABLE public.workflow_runs
  ADD COLUMN IF NOT EXISTS trigger_event jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS actions_executed jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'success',
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS duration_ms integer,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- Index for fast lookups by workflow
CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_id
  ON public.workflow_runs (workflow_id, created_at DESC);

-- Index for org-level queries
CREATE INDEX IF NOT EXISTS idx_workflow_runs_org_id
  ON public.workflow_runs (organization_id, created_at DESC);

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.workflow_runs ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if re-running
DROP POLICY IF EXISTS "workflow_runs_select_own_org" ON public.workflow_runs;
DROP POLICY IF EXISTS "workflow_runs_insert_own_org" ON public.workflow_runs;
DROP POLICY IF EXISTS "workflow_runs_delete_own_org" ON public.workflow_runs;

-- Users can read runs from their organization
CREATE POLICY "workflow_runs_select_own_org" ON public.workflow_runs
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
  );

-- Users can insert runs for their organization
CREATE POLICY "workflow_runs_insert_own_org" ON public.workflow_runs
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
  );

-- Users can delete runs from their organization
CREATE POLICY "workflow_runs_delete_own_org" ON public.workflow_runs
  FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
  );
