-- Tasks and notes can belong to a deal. A deal's next step is its earliest
-- open task, and notes written on a deal are ordinary CRM notes, so both also
-- show up on the Tasks and Notes pages.
--
-- ON DELETE SET NULL: deleting a deal keeps its tasks and notes, just unlinked.
begin;

alter table public.tasks
  add column if not exists opportunity_id uuid references public.opportunities(id) on delete set null;

alter table public.notes
  add column if not exists opportunity_id uuid references public.opportunities(id) on delete set null;

create index if not exists tasks_opportunity_id_idx on public.tasks (opportunity_id) where opportunity_id is not null;
create index if not exists notes_opportunity_id_idx on public.notes (opportunity_id) where opportunity_id is not null;

commit;
