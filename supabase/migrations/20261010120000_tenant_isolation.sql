-- ============================================================
-- Tenant isolation hardening
-- ============================================================
-- The live database still carried policies from before multi-tenancy.
-- Postgres ORs permissive policies together, so those old policies
-- (no organization check) let:
--   • any signed-in user read every company, person and profile in
--     every organization;
--   • any manager read/update/delete visits, deals, tasks, calls,
--     reminders, technician visits and profiles in every organization;
--   • anyone holding the public anon key read/insert/update every
--     solar inverter survey;
--   • any user set their own role, organization_id or is_super_admin.
--
-- Every core table already has an "<table>: org isolation" FOR ALL
-- policy granting full access inside the caller's organization, so
-- dropping the old policies only removes cross-organization access.
--
-- Section 8 then narrows visits, deals and tasks inside an organization:
-- managers see all of them, everyone else only their own (deals also
-- to their assignees). Other tables stay organization-wide.
-- ============================================================

begin;

-- ─────────────────────────────────────────────────────────────
-- 1. Fill organization_id on insert when the client leaves it out,
--    so dropping the old user-only insert policies cannot break an
--    insert path that forgets the column.
-- ─────────────────────────────────────────────────────────────
alter function public.get_my_org_id() set search_path = public;
alter function public.my_org_id()     set search_path = public;
alter function public.my_role()       set search_path = public;

create or replace function public.set_organization_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.organization_id is null then
    new.organization_id := public.get_my_org_id();
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'call_logs', 'companies', 'notes', 'opportunities', 'people',
    'reminders', 'routes', 'tasks', 'technician_visits', 'visits',
    'solar_inverter_surveys', 'ups_maintenance_reports',
    'company_categories', 'route_locations', 'route_assignments'
  ] loop
    execute format('drop trigger if exists set_organization_id on public.%I', t);
    execute format(
      'create trigger set_organization_id before insert on public.%I
         for each row execute function public.set_organization_id()', t);
  end loop;
end;
$$;

-- Backfill rows created without an organization.
update public.tasks t
set    organization_id = p.organization_id
from   public.profiles p
where  t.organization_id is null and p.id = t.created_by;

update public.company_categories cc
set    organization_id = c.organization_id
from   public.companies c
where  cc.organization_id is null and c.id = cc.company_id;

update public.route_locations rl
set    organization_id = r.organization_id
from   public.routes r
where  rl.organization_id is null and r.id = rl.route_id;


-- ─────────────────────────────────────────────────────────────
-- 2. Drop pre-multi-tenancy policies on core tables
-- ─────────────────────────────────────────────────────────────
drop policy if exists "Enable delete for users based on user_id" on public.call_logs;
drop policy if exists "call_logs_delete"                         on public.call_logs;
drop policy if exists "call_logs_insert"                         on public.call_logs;
drop policy if exists "Users can insert call logs"               on public.call_logs;
drop policy if exists "Users can view call logs"                 on public.call_logs;
drop policy if exists "call_logs_select"                         on public.call_logs;
drop policy if exists "Users can update call logs"               on public.call_logs;
drop policy if exists "call_logs_update"                         on public.call_logs;

drop policy if exists "companies_delete" on public.companies;
drop policy if exists "companies_insert" on public.companies;
drop policy if exists "companies_select" on public.companies;
drop policy if exists "companies_update" on public.companies;

drop policy if exists "Users can delete own notes" on public.notes;
drop policy if exists "notes_delete"               on public.notes;
drop policy if exists "Users can insert own notes" on public.notes;
drop policy if exists "notes_insert"               on public.notes;
drop policy if exists "notes_select"               on public.notes;
drop policy if exists "Users can view own notes"   on public.notes;
drop policy if exists "Users can update own notes" on public.notes;
drop policy if exists "notes_update"               on public.notes;

drop policy if exists "Users can delete opportunities based on role" on public.opportunities;
drop policy if exists "opportunities_delete"                         on public.opportunities;
drop policy if exists "opportunities_insert"                         on public.opportunities;
drop policy if exists "Users can insert their own opportunities"     on public.opportunities;
drop policy if exists "Users can view opportunities based on role"   on public.opportunities;
drop policy if exists "opportunities_select"                         on public.opportunities;
drop policy if exists "opportunities_update"                         on public.opportunities;
drop policy if exists "Users can update opportunities based on role" on public.opportunities;

drop policy if exists "people_delete" on public.people;
drop policy if exists "people_insert" on public.people;
drop policy if exists "people_select" on public.people;
drop policy if exists "people_update" on public.people;

drop policy if exists "reminders_delete" on public.reminders;
drop policy if exists "reminders_insert" on public.reminders;
drop policy if exists "reminders_select" on public.reminders;
drop policy if exists "reminders_update" on public.reminders;

drop policy if exists "Managers can delete routes"                                on public.routes;
drop policy if exists "Managers can insert routes"                                on public.routes;
drop policy if exists "Users can view routes assigned to them or created by them" on public.routes;
drop policy if exists "Managers can view all routes"                              on public.routes;
drop policy if exists "Managers can update routes"                                on public.routes;

drop policy if exists "tasks_delete" on public.tasks;
drop policy if exists "tasks_insert" on public.tasks;
drop policy if exists "tasks_select" on public.tasks;
drop policy if exists "tasks_update" on public.tasks;

drop policy if exists "technician_visits_delete" on public.technician_visits;
drop policy if exists "technician_visits_insert" on public.technician_visits;
drop policy if exists "technician_visits_select" on public.technician_visits;
drop policy if exists "technician_visits_update" on public.technician_visits;

drop policy if exists "visits_delete"                 on public.visits;
drop policy if exists "Managers can insert any visits" on public.visits;
drop policy if exists "visits_insert"                 on public.visits;
drop policy if exists "Users can insert own visits"   on public.visits;
drop policy if exists "Managers can view all visits"  on public.visits;
drop policy if exists "Users can view own visits"     on public.visits;
drop policy if exists "visits_select"                 on public.visits;
drop policy if exists "visits_update"                 on public.visits;


-- ─────────────────────────────────────────────────────────────
-- 3. Profiles: same-org visibility, same-org manager actions, and
--    protected columns.
-- ─────────────────────────────────────────────────────────────
drop policy if exists "profiles_select_all_authenticated" on public.profiles;
drop policy if exists "profiles_select"                   on public.profiles;
drop policy if exists "Managers can view all profiles"    on public.profiles;
drop policy if exists "profiles_update"                   on public.profiles;
drop policy if exists "Managers can delete profiles"      on public.profiles;
drop policy if exists "profiles_delete"                   on public.profiles;

drop policy if exists "profiles: managers update same org" on public.profiles;
create policy "profiles: managers update same org"
  on public.profiles for update to authenticated
  using      (organization_id = public.get_my_org_id() and public.is_manager())
  with check (organization_id = public.get_my_org_id());

drop policy if exists "profiles: managers delete same org" on public.profiles;
create policy "profiles: managers delete same org"
  on public.profiles for delete to authenticated
  using (organization_id = public.get_my_org_id() and public.is_manager());

-- Browser requests run as anon/authenticated. Edge functions (service_role)
-- and security-definer functions (postgres: handle_new_user,
-- accept_invitation, complete_google_signup) are not restricted here.
create or replace function public.guard_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Org membership and role come only from signup, invitation or
    -- Google-signup functions, never from a direct client insert.
    new.is_super_admin  := false;
    new.organization_id := null;
    new.role            := 'sales_rep';
    return new;
  end if;

  if new.is_super_admin is distinct from old.is_super_admin then
    raise exception 'is_super_admin cannot be changed' using errcode = '42501';
  end if;

  if new.organization_id is distinct from old.organization_id then
    raise exception 'organization_id cannot be changed' using errcode = '42501';
  end if;

  if (new.role is distinct from old.role or new.status is distinct from old.status)
     and not (public.is_manager() and old.organization_id = public.get_my_org_id())
  then
    raise exception 'Only a manager in this organization can change role or status'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_profile_columns on public.profiles;
create trigger guard_profile_columns
  before insert or update on public.profiles
  for each row execute function public.guard_profile_columns();


-- ─────────────────────────────────────────────────────────────
-- 4. Solar inverter surveys: were open to anyone with the anon key.
-- ─────────────────────────────────────────────────────────────
drop policy if exists "Users can insert solar surveys"         on public.solar_inverter_surveys;
drop policy if exists "Users can view their org solar surveys" on public.solar_inverter_surveys;
drop policy if exists "Users can update solar surveys"         on public.solar_inverter_surveys;

drop policy if exists "solar_inverter_surveys: org isolation" on public.solar_inverter_surveys;
create policy "solar_inverter_surveys: org isolation"
  on public.solar_inverter_surveys for all to authenticated
  using      (organization_id = public.get_my_org_id())
  with check (organization_id = public.get_my_org_id());


-- ─────────────────────────────────────────────────────────────
-- 5. Technician write policies: pin inserts/updates to own org.
-- ─────────────────────────────────────────────────────────────
drop policy if exists "Technicians can insert own reports" on public.ups_maintenance_reports;
create policy "Technicians can insert own reports"
  on public.ups_maintenance_reports for insert to authenticated
  with check (auth.uid() = technician_id and organization_id = public.get_my_org_id());

drop policy if exists "Technicians can update own reports" on public.ups_maintenance_reports;
create policy "Technicians can update own reports"
  on public.ups_maintenance_reports for update to authenticated
  using      (auth.uid() = technician_id and organization_id = public.get_my_org_id())
  with check (auth.uid() = technician_id and organization_id = public.get_my_org_id());

drop policy if exists "Technicians can update own submissions" on public.form_submissions;
create policy "Technicians can update own submissions"
  on public.form_submissions for update to authenticated
  using      (auth.uid() = technician_id and organization_id = public.get_my_org_id())
  with check (auth.uid() = technician_id and organization_id = public.get_my_org_id());


-- ─────────────────────────────────────────────────────────────
-- 6. Tables that had RLS off (anon could read and write them).
-- ─────────────────────────────────────────────────────────────
-- categories is a shared list of names with no organization column.
alter table public.categories enable row level security;
drop policy if exists "categories: authenticated read"   on public.categories;
drop policy if exists "categories: authenticated insert" on public.categories;
create policy "categories: authenticated read"
  on public.categories for select to authenticated using (true);
create policy "categories: authenticated insert"
  on public.categories for insert to authenticated with check (true);

alter table public.company_categories enable row level security;
drop policy if exists "company_categories: org isolation" on public.company_categories;
create policy "company_categories: org isolation"
  on public.company_categories for all to authenticated
  using      (organization_id = public.get_my_org_id())
  with check (organization_id = public.get_my_org_id());

alter table public.route_locations enable row level security;
drop policy if exists "route_locations: org isolation" on public.route_locations;
create policy "route_locations: org isolation"
  on public.route_locations for all to authenticated
  using      (organization_id = public.get_my_org_id())
  with check (organization_id = public.get_my_org_id());


-- ─────────────────────────────────────────────────────────────
-- 7. Unused legacy tables (0 rows, not referenced by the app).
-- ─────────────────────────────────────────────────────────────
drop policy if exists "Managers can manage locations" on public.locations;
drop policy if exists "Everyone can read locations"   on public.locations;
drop policy if exists "Everyone can view locations"   on public.locations;

drop policy if exists "Managers can create route assignments" on public.route_assignments;
drop policy if exists "Users can view route assignments"      on public.route_assignments;
drop policy if exists "route_assignments: org isolation"      on public.route_assignments;
create policy "route_assignments: org isolation"
  on public.route_assignments for all to authenticated
  using      (organization_id = public.get_my_org_id())
  with check (organization_id = public.get_my_org_id());


-- ─────────────────────────────────────────────────────────────
-- 8. Visits, deals and tasks: managers see everything in their
--    organization; everyone else sees only their own.
-- ─────────────────────────────────────────────────────────────
-- visits: owned by user_id
drop policy if exists "visits: org isolation" on public.visits;
drop policy if exists "visits: own or manager" on public.visits;
create policy "visits: own or manager"
  on public.visits for all to authenticated
  using      (organization_id = public.get_my_org_id()
              and (public.is_manager() or user_id = auth.uid()))
  with check (organization_id = public.get_my_org_id()
              and (public.is_manager() or user_id = auth.uid()));

-- tasks: visible to creator and assignee
drop policy if exists "tasks: org isolation" on public.tasks;
drop policy if exists "tasks: own or manager" on public.tasks;
create policy "tasks: own or manager"
  on public.tasks for all to authenticated
  using      (organization_id = public.get_my_org_id()
              and (public.is_manager() or created_by = auth.uid() or assigned_to = auth.uid()))
  with check (organization_id = public.get_my_org_id()
              and (public.is_manager() or created_by = auth.uid() or assigned_to = auth.uid()));

-- opportunities: owner (user_id) and anyone listed in opportunity_assignees
-- can view and edit; only the owner or a manager can create or delete.
drop policy if exists "opportunities: org isolation"      on public.opportunities;
drop policy if exists "assignees can view opportunities"   on public.opportunities;
drop policy if exists "assignees can update opportunities" on public.opportunities;
drop policy if exists "opportunities: view"   on public.opportunities;
drop policy if exists "opportunities: insert" on public.opportunities;
drop policy if exists "opportunities: update" on public.opportunities;
drop policy if exists "opportunities: delete" on public.opportunities;

create policy "opportunities: view"
  on public.opportunities for select to authenticated
  using (organization_id = public.get_my_org_id()
         and (public.is_manager() or user_id = auth.uid()
              or exists (select 1 from public.opportunity_assignees oa
                         where oa.opportunity_id = opportunities.id
                           and oa.user_id = auth.uid())));

create policy "opportunities: insert"
  on public.opportunities for insert to authenticated
  with check (organization_id = public.get_my_org_id()
              and (public.is_manager() or user_id = auth.uid()));

create policy "opportunities: update"
  on public.opportunities for update to authenticated
  using (organization_id = public.get_my_org_id()
         and (public.is_manager() or user_id = auth.uid()
              or exists (select 1 from public.opportunity_assignees oa
                         where oa.opportunity_id = opportunities.id
                           and oa.user_id = auth.uid())))
  with check (organization_id = public.get_my_org_id());

create policy "opportunities: delete"
  on public.opportunities for delete to authenticated
  using (organization_id = public.get_my_org_id()
         and (public.is_manager() or user_id = auth.uid()));

commit;
