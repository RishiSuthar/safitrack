-- ============================================================
-- SafiTrack: Pipeline Switcher Migration
-- ============================================================
-- Run this ONCE in Supabase Dashboard → SQL Editor
-- It is safe to re-run (uses IF NOT EXISTS / ON CONFLICT).
--
-- WHAT THIS DOES:
--   1. Creates `pipelines` table (custom Kanban pipeline definitions per org)
--   2. Adds `pipeline_id` to `opportunities` (which pipeline an opp belongs to)
--   3. Sets up Row Level Security for full org isolation
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. PIPELINES TABLE
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pipelines (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT        NOT NULL,
  stages          JSONB       NOT NULL DEFAULT '[]',
  organization_id UUID        REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  is_default      BOOLEAN     NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.pipelines ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.pipelines IS
  'Custom Kanban pipeline definitions per org. stages is a JSONB array of {id, title, color}.';

-- Index for fast per-org queries
CREATE INDEX IF NOT EXISTS pipelines_org_idx ON public.pipelines (organization_id);

-- Only one default pipeline per org
CREATE UNIQUE INDEX IF NOT EXISTS pipelines_org_default_idx
  ON public.pipelines (organization_id)
  WHERE is_default = true;


-- ─────────────────────────────────────────────────────────────
-- 2. RLS POLICIES FOR PIPELINES
-- ─────────────────────────────────────────────────────────────

-- Everyone in the org can read pipelines
DROP POLICY IF EXISTS "pipelines_select_org" ON public.pipelines;
CREATE POLICY "pipelines_select_org" ON public.pipelines
  FOR SELECT USING (
    organization_id = (
      SELECT organization_id FROM public.profiles
      WHERE id = auth.uid() LIMIT 1
    )
  );

-- Only managers can create pipelines
DROP POLICY IF EXISTS "pipelines_insert_manager" ON public.pipelines;
CREATE POLICY "pipelines_insert_manager" ON public.pipelines
  FOR INSERT WITH CHECK (
    organization_id = (
      SELECT organization_id FROM public.profiles
      WHERE id = auth.uid() LIMIT 1
    )
    AND (
      SELECT role FROM public.profiles
      WHERE id = auth.uid() LIMIT 1
    ) = 'manager'
  );

-- Only managers can update pipelines
DROP POLICY IF EXISTS "pipelines_update_manager" ON public.pipelines;
CREATE POLICY "pipelines_update_manager" ON public.pipelines
  FOR UPDATE USING (
    organization_id = (
      SELECT organization_id FROM public.profiles
      WHERE id = auth.uid() LIMIT 1
    )
    AND (
      SELECT role FROM public.profiles
      WHERE id = auth.uid() LIMIT 1
    ) = 'manager'
  );

-- Only managers can delete pipelines (cannot delete the default pipeline)
DROP POLICY IF EXISTS "pipelines_delete_manager" ON public.pipelines;
CREATE POLICY "pipelines_delete_manager" ON public.pipelines
  FOR DELETE USING (
    organization_id = (
      SELECT organization_id FROM public.profiles
      WHERE id = auth.uid() LIMIT 1
    )
    AND (
      SELECT role FROM public.profiles
      WHERE id = auth.uid() LIMIT 1
    ) = 'manager'
    AND is_default = false
  );


-- ─────────────────────────────────────────────────────────────
-- 3. ADD pipeline_id TO OPPORTUNITIES
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS pipeline_id UUID
    REFERENCES public.pipelines(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS opportunities_pipeline_idx
  ON public.opportunities (pipeline_id);

COMMENT ON COLUMN public.opportunities.pipeline_id IS
  'Which pipeline this opportunity belongs to. NULL = default (Sales) pipeline.';
