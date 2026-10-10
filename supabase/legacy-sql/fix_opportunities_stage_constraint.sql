-- ============================================================
-- Fix: Remove hard-coded stage check constraint from opportunities
-- ============================================================
-- The old constraint only allowed a fixed list of stage names.
-- With custom pipelines, stage IDs are dynamic, so the constraint
-- must be dropped. Stage validity is now enforced at the app level.
--
-- Run this ONCE in Supabase Dashboard → SQL Editor
-- ============================================================

ALTER TABLE public.opportunities
  DROP CONSTRAINT IF EXISTS opportunities_stage_check;
