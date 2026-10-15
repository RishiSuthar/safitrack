-- Deal value is optional: reps often don't know it at Lead stage, and a
-- required field made them type 1 just to save. NULL means "not set yet";
-- totals and reports already treat a missing value as 0.
begin;

alter table public.opportunities alter column value drop not null;
alter table public.opportunities alter column value drop default;

commit;
