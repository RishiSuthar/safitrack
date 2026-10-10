-- ============================================================
-- SafiTrack: Opportunities Performance Indexes
-- ============================================================
-- Run this ONCE in Supabase Dashboard -> SQL Editor.
-- Safe to re-run (all indexes use IF NOT EXISTS).
--
-- Goal:
--   Speed up opportunities tab/page load by optimizing the exact
--   query patterns used in the CRM opportunities view.
-- ============================================================


-- Managers: org-scoped list ordered by newest
--   where organization_id = ?
--   order by created_at desc
CREATE INDEX IF NOT EXISTS opportunities_org_created_idx
  ON public.opportunities (organization_id, created_at DESC);


-- Sales reps: own opportunities in org ordered by newest
--   where user_id = ? and organization_id = ?
--   order by created_at desc
CREATE INDEX IF NOT EXISTS opportunities_org_user_created_idx
  ON public.opportunities (organization_id, user_id, created_at DESC);


-- Pipeline-focused reads/summaries in org
--   where organization_id = ? and pipeline_id = ?
--   order by created_at desc
CREATE INDEX IF NOT EXISTS opportunities_org_pipeline_created_idx
  ON public.opportunities (organization_id, pipeline_id, created_at DESC);


-- Stage analytics and funnel-like reads in org
--   where organization_id = ? and stage = ?
CREATE INDEX IF NOT EXISTS opportunities_org_stage_idx
  ON public.opportunities (organization_id, stage);


-- Fast assignee-driven access path when resolving extra deals for reps
-- (already present in most environments, kept here for safety)
CREATE INDEX IF NOT EXISTS opp_assignees_user_idx
  ON public.opportunity_assignees (user_id);
