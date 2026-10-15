-- A task can be due on a day with no particular time ("all day"). That used to
-- be inferred from a due time of exactly local midnight, but local midnight
-- depends on who is looking: a Toronto-midnight task showed as a 7:00 AM task
-- in Nairobi. Now it's explicit:
--
--   due_all_day = true   due on a calendar date, the same date for everyone.
--                        due_date holds UTC midnight of that date
--                        (2026-10-20 -> 2026-10-20T00:00:00Z).
--   due_all_day = false  due at the instant in due_date, shown in local time.
--
-- Tasks saved by the app as "local midnight" in Toronto or Nairobi (where the
-- team works) become all-day tasks on that local date. The backfill is a data
-- fix, so it doesn't run workflows or bump updated_at.
begin;

alter table public.tasks
  add column if not exists due_all_day boolean not null default false;

alter table public.tasks disable trigger user;

update public.tasks
set due_all_day = true,
    due_date = ((due_date at time zone 'Africa/Nairobi')::date)::timestamp at time zone 'UTC'
where not due_all_day
  and due_date is not null
  and (due_date at time zone 'Africa/Nairobi')::time = '00:00';

update public.tasks
set due_all_day = true,
    due_date = ((due_date at time zone 'America/Toronto')::date)::timestamp at time zone 'UTC'
where not due_all_day
  and due_date is not null
  and (due_date at time zone 'America/Toronto')::time = '00:00';

alter table public.tasks enable trigger user;

commit;
