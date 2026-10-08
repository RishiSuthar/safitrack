-- ============================================================
-- SafiTrack: Track when an opportunity entered its current stage
-- ============================================================
-- Run this ONCE in Supabase Dashboard → SQL Editor
-- It is safe to re-run.
--
-- The pipeline board shows "days in stage" and decides which Won/Lost
-- deals count as recent from this column. Without it the app falls back
-- to updated_at, which resets whenever any field on the deal is edited.
-- ============================================================

ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS stage_changed_at TIMESTAMPTZ;

-- Existing deals: the last update is the best available guess
UPDATE public.opportunities
  SET stage_changed_at = COALESCE(updated_at, created_at, now())
  WHERE stage_changed_at IS NULL;

ALTER TABLE public.opportunities
  ALTER COLUMN stage_changed_at SET DEFAULT now();

-- Kept by the database so every client (board drag, edit form, imports)
-- records stage moves the same way.
CREATE OR REPLACE FUNCTION public.set_opportunity_stage_changed_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.stage_changed_at := COALESCE(NEW.stage_changed_at, now());
  ELSIF NEW.stage IS DISTINCT FROM OLD.stage THEN
    NEW.stage_changed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS opportunities_stage_changed_at ON public.opportunities;
CREATE TRIGGER opportunities_stage_changed_at
  BEFORE INSERT OR UPDATE OF stage ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.set_opportunity_stage_changed_at();
