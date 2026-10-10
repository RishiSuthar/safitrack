-- ============================================================
-- Add fare tracking fields to visits
-- Run in Supabase SQL Editor
-- ============================================================

ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS fare_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS fare_currency text,
  ADD COLUMN IF NOT EXISTS fare_status text,
  ADD COLUMN IF NOT EXISTS fare_requested_by uuid,
  ADD COLUMN IF NOT EXISTS fare_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS fare_approved_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS fare_approved_currency text,
  ADD COLUMN IF NOT EXISTS fare_reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS fare_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS fare_rejection_reason text;

ALTER TABLE public.visits
  DROP CONSTRAINT IF EXISTS visits_fare_amount_nonnegative;

ALTER TABLE public.visits
  ADD CONSTRAINT visits_fare_amount_nonnegative
  CHECK (fare_amount IS NULL OR fare_amount >= 0);

ALTER TABLE public.visits
  DROP CONSTRAINT IF EXISTS visits_fare_approved_amount_nonnegative;

ALTER TABLE public.visits
  ADD CONSTRAINT visits_fare_approved_amount_nonnegative
  CHECK (fare_approved_amount IS NULL OR fare_approved_amount >= 0);

ALTER TABLE public.visits
  DROP CONSTRAINT IF EXISTS visits_fare_status_valid;

ALTER TABLE public.visits
  ADD CONSTRAINT visits_fare_status_valid
  CHECK (fare_status IS NULL OR fare_status IN ('requested', 'approved', 'rejected'));
