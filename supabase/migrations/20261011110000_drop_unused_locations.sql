-- ============================================================
-- Drop the unused locations table
-- ============================================================
-- Left over from before companies stored their own coordinates. It is
-- empty, nothing in the app or database references it, and it has had
-- RLS on with no policies since the tenant isolation migration.
-- ============================================================

drop table if exists public.locations;
