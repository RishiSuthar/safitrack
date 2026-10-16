-- ============================================================
-- Drop the reminders table
-- ============================================================
-- Reminders were removed from the app; tasks cover follow-ups and
-- scheduled calls live on call_logs. The table is empty, nothing
-- references it, and its only triggers are its own. Dropping the
-- table takes its policies, triggers and foreign keys with it.
-- ============================================================

drop table if exists public.reminders;
