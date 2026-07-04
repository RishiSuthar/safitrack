-- ============================================================
-- SafiTrack Changelogs & Announcements Schema
-- ============================================================

CREATE TABLE IF NOT EXISTS public.changelogs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL,
  date_string text NOT NULL,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.changelogs ENABLE ROW LEVEL SECURITY;

-- 1. Anyone can read the changelogs
DROP POLICY IF EXISTS "changelogs: public read" ON public.changelogs;
CREATE POLICY "changelogs: public read"
  ON public.changelogs FOR SELECT
  USING (true);

-- Note: All INSERT/UPDATE/DELETE operations will be performed by the 
-- super-admin-api Edge Function which uses the Service Role Key to bypass RLS.
-- This keeps the table completely secure from normal users.

-- Example backfill for existing versions to seed the table:
INSERT INTO public.changelogs (version, date_string, items)
VALUES 
  ('2.2.0', 'July 4, 2026', '[{"type": "new", "text": "Added custom fields for companies and people, now availabe in the settings"}]'),
  ('2.1.0', 'June 30, 2026', '[{"type": "new", "text": "Added full contracts section"}]'),
  ('2.0.0', 'June 30, 2026', '[{"type": "new", "text": "Added custom opportunity pipelines with different stages"}, {"type": "improved", "text": "Load stacked company icons - faster load time now"}, {"type": "fixed", "text": "Opportunity view for mobile now fixed the search bar"}]'),
  ('1.9.0', 'June 10, 2026', '[{"type": "fixed", "text": "Mobile view for technicians"}]')
ON CONFLICT DO NOTHING;
