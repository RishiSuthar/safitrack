-- Deleting a deal deletes its tasks and notes too, instead of leaving them
-- unlinked on the Tasks and Notes pages. The database does it, so it happens
-- however the deal is deleted.
begin;

alter table public.tasks drop constraint if exists tasks_opportunity_id_fkey;
alter table public.tasks
  add constraint tasks_opportunity_id_fkey
  foreign key (opportunity_id) references public.opportunities(id) on delete cascade;

alter table public.notes drop constraint if exists notes_opportunity_id_fkey;
alter table public.notes
  add constraint notes_opportunity_id_fkey
  foreign key (opportunity_id) references public.opportunities(id) on delete cascade;

commit;
