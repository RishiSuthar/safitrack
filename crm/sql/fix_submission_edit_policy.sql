-- ============================================================
-- Fix: allow technicians to resubmit (edit) their own submissions
-- regardless of current approval status.
--
-- The old policy blocked UPDATE when status was Approved/Denied,
-- causing edits to silently fail (0 rows updated, no error).
-- Run in Supabase SQL Editor.
-- ============================================================

-- Drop the old restrictive policy
DROP POLICY IF EXISTS "Technicians can update own pending submissions" ON form_submissions;

-- Replace with one that allows technicians to update any of their
-- own submissions — the JS always resets status back to 'Pending'.
CREATE POLICY "Technicians can update own submissions"
  ON form_submissions
  FOR UPDATE
  TO authenticated
  USING  (auth.uid() = technician_id)
  WITH CHECK (auth.uid() = technician_id);
