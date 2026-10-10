-- ============================================================
-- SafiTrack — all Supabase changes to run in the SQL Editor
-- Run this once, top to bottom.
-- ============================================================


-- 1. Add settings column to organizations
--    Stores org-level config (e.g. PDF header text).
-- ------------------------------------------------------------
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}';


-- 2. Fix form_submissions RLS — allow technicians to edit/resubmit
--    their own submissions even after they've been Approved or Denied.
--    The old policy blocked UPDATE on non-Pending rows, causing edits
--    to silently fail (data appeared to revert after resubmit).
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Technicians can update own pending submissions" ON form_submissions;

CREATE POLICY "Technicians can update own submissions"
  ON form_submissions
  FOR UPDATE
  TO authenticated
  USING  (auth.uid() = technician_id)
  WITH CHECK (auth.uid() = technician_id);
