-- ============================================================
-- Tasks are either to do or done
-- ============================================================
-- The tasks page is now one list with a done checkbox, so "in
-- progress" is gone. Anything not finished counts as to do, and
-- the column only accepts the two states from here on.
-- ============================================================

update public.tasks
set status = 'pending'
where status is null or status not in ('pending', 'completed');

alter table public.tasks
  alter column status set not null,
  drop constraint if exists tasks_status_check,
  add constraint tasks_status_check check (status in ('pending', 'completed'));
