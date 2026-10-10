-- ============================================================
-- Keep organization records when a member's account is deleted
-- ============================================================
-- Most tables already clear the person (ON DELETE SET NULL) when a
-- profile or login is deleted. These did not:
--   • companies.created_by, people.created_by, routes.assigned_to and
--     solar_inverter_surveys.technician_id blocked the deletion, so
--     anyone who had created a company or contact, or had a route,
--     could not be removed or delete their own account;
--   • ups_maintenance_reports, form_submissions and workflows were
--     deleted along with their author, wiping company records.
-- All of them now keep the record and clear the person.
-- ============================================================

begin;

alter table public.ups_maintenance_reports alter column technician_id drop not null;
alter table public.form_submissions        alter column technician_id drop not null;
alter table public.workflows               alter column created_by    drop not null;

alter table public.companies drop constraint companies_created_by_fkey;
alter table public.companies add constraint companies_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.people drop constraint people_created_by_fkey;
alter table public.people add constraint people_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.routes drop constraint routes_assigned_to_fkey;
alter table public.routes add constraint routes_assigned_to_fkey
  foreign key (assigned_to) references public.profiles(id) on delete set null;

alter table public.solar_inverter_surveys drop constraint solar_inverter_surveys_technician_id_fkey;
alter table public.solar_inverter_surveys add constraint solar_inverter_surveys_technician_id_fkey
  foreign key (technician_id) references auth.users(id) on delete set null;

alter table public.ups_maintenance_reports drop constraint ups_maintenance_reports_technician_id_fkey;
alter table public.ups_maintenance_reports add constraint ups_maintenance_reports_technician_id_fkey
  foreign key (technician_id) references auth.users(id) on delete set null;

alter table public.form_submissions drop constraint form_submissions_technician_id_fkey;
alter table public.form_submissions add constraint form_submissions_technician_id_fkey
  foreign key (technician_id) references auth.users(id) on delete set null;

alter table public.workflows drop constraint workflows_created_by_fkey;
alter table public.workflows add constraint workflows_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

commit;
