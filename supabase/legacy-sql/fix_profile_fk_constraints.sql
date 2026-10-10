-- ─────────────────────────────────────────────────────────────────────────────
-- Fix FK constraints that reference profiles(id) so that deleting a profile
-- (member deletion) doesn't raise a foreign key violation.
--
-- Strategy:
--   • Drop NOT NULL on any "created_by / assigned_to / user_id" columns that
--     need to accept NULL when the owning user is deleted.
--   • Re-add FK constraints with ON DELETE SET NULL.
--
-- Column names verified against actual JS queries in the codebase.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── tasks ────────────────────────────────────────────────────────────────────
alter table public.tasks alter column assigned_to drop not null;
alter table public.tasks alter column created_by  drop not null;

alter table public.tasks
  drop constraint if exists tasks_assigned_to_fkey;
alter table public.tasks
  add constraint tasks_assigned_to_fkey
  foreign key (assigned_to) references public.profiles(id) on delete set null;

alter table public.tasks
  drop constraint if exists tasks_created_by_fkey;
alter table public.tasks
  add constraint tasks_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

-- ── reminders ────────────────────────────────────────────────────────────────
alter table public.reminders alter column assigned_to drop not null;
alter table public.reminders alter column created_by  drop not null;

alter table public.reminders
  drop constraint if exists reminders_assigned_to_fkey;
alter table public.reminders
  add constraint reminders_assigned_to_fkey
  foreign key (assigned_to) references public.profiles(id) on delete set null;

alter table public.reminders
  drop constraint if exists reminders_created_by_fkey;
alter table public.reminders
  add constraint reminders_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

-- ── notes ────────────────────────────────────────────────────────────────────
alter table public.notes alter column user_id drop not null;

alter table public.notes
  drop constraint if exists notes_user_id_fkey;
alter table public.notes
  add constraint notes_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete set null;

-- ── visits ────────────────────────────────────────────────────────────────────
alter table public.visits alter column user_id drop not null;

alter table public.visits
  drop constraint if exists visits_user_id_fkey;
alter table public.visits
  add constraint visits_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete set null;

-- ── call_logs ─────────────────────────────────────────────────────────────────
alter table public.call_logs alter column user_id drop not null;

alter table public.call_logs
  drop constraint if exists call_logs_user_id_fkey;
alter table public.call_logs
  add constraint call_logs_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete set null;

-- ── technician_visits ─────────────────────────────────────────────────────────
alter table public.technician_visits alter column technician_id drop not null;

alter table public.technician_visits
  drop constraint if exists technician_visits_technician_id_fkey;
alter table public.technician_visits
  add constraint technician_visits_technician_id_fkey
  foreign key (technician_id) references public.profiles(id) on delete set null;

-- ── routes ────────────────────────────────────────────────────────────────────
alter table public.routes alter column created_by drop not null;

alter table public.routes
  drop constraint if exists routes_created_by_fkey;
alter table public.routes
  add constraint routes_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

-- ── opportunities ─────────────────────────────────────────────────────────────
alter table public.opportunities alter column user_id drop not null;

alter table public.opportunities
  drop constraint if exists opportunities_user_id_fkey;
alter table public.opportunities
  add constraint opportunities_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete set null;


-- ── tasks ────────────────────────────────────────────────────────────────────
alter table public.tasks
  drop constraint if exists tasks_assigned_to_fkey;
alter table public.tasks
  add constraint tasks_assigned_to_fkey
  foreign key (assigned_to) references public.profiles(id) on delete set null;

alter table public.tasks
  drop constraint if exists tasks_created_by_fkey;
alter table public.tasks
  add constraint tasks_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

-- ── reminders ────────────────────────────────────────────────────────────────
alter table public.reminders
  drop constraint if exists reminders_assigned_to_fkey;
alter table public.reminders
  add constraint reminders_assigned_to_fkey
  foreign key (assigned_to) references public.profiles(id) on delete set null;

alter table public.reminders
  drop constraint if exists reminders_created_by_fkey;
alter table public.reminders
  add constraint reminders_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

-- ── notes ────────────────────────────────────────────────────────────────────
alter table public.notes
  drop constraint if exists notes_user_id_fkey;
alter table public.notes
  add constraint notes_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete set null;

-- ── visits ────────────────────────────────────────────────────────────────────
alter table public.visits
  drop constraint if exists visits_user_id_fkey;
alter table public.visits
  add constraint visits_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete set null;

-- ── call_logs ─────────────────────────────────────────────────────────────────
alter table public.call_logs
  drop constraint if exists call_logs_user_id_fkey;
alter table public.call_logs
  add constraint call_logs_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete set null;

-- ── technician_visits ─────────────────────────────────────────────────────────
alter table public.technician_visits
  drop constraint if exists technician_visits_technician_id_fkey;
alter table public.technician_visits
  add constraint technician_visits_technician_id_fkey
  foreign key (technician_id) references public.profiles(id) on delete set null;

-- ── routes ────────────────────────────────────────────────────────────────────
alter table public.routes
  drop constraint if exists routes_created_by_fkey;
alter table public.routes
  add constraint routes_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

-- ── opportunities ─────────────────────────────────────────────────────────────
alter table public.opportunities
  drop constraint if exists opportunities_user_id_fkey;
alter table public.opportunities
  add constraint opportunities_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete set null;

