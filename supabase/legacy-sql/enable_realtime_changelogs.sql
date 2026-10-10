-- Enable Supabase Realtime for the changelogs table
-- This allows the CRM to instantly listen for new broadcasts and show the popup without refreshing.

ALTER PUBLICATION supabase_realtime ADD TABLE public.changelogs;
