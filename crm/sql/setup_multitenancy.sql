-- ============================================================
-- SafiTrack Multi-Tenant Schema Migration
-- ============================================================
-- Run this ONCE in Supabase Dashboard → SQL Editor
-- It is safe to re-run (uses IF NOT EXISTS / ON CONFLICT).
--
-- WHAT THIS DOES:
--   1. Creates `organizations` table (one row per tenant/company)
--   2. Creates `invitations` table (invite tokens sent to team members)
--   3. Adds `organization_id` to `profiles` and all data tables
--   4. Creates a helper function `get_my_org_id()`
--   5. Creates a DB trigger that auto-creates org + profile when a
--      manager self-registers
--   6. Sets up Row Level Security (RLS) for full data isolation
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. ORGANIZATIONS (tenants)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.organizations (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  owner_id    uuid        references auth.users(id) on delete set null,
  max_members integer     not null default 2,
  created_at  timestamptz not null default now()
);

alter table public.organizations enable row level security;

comment on table public.organizations is
  'One row per customer company (tenant). All data is isolated by organization_id.';


-- ─────────────────────────────────────────────────────────────
-- 2. UPDATE PROFILES
-- ─────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists organization_id uuid
    references public.organizations(id) on delete cascade,
  add column if not exists status text not null default 'active'
    check (status in ('active', 'invited', 'suspended'));

alter table public.profiles enable row level security;

comment on column public.profiles.organization_id is
  'Which organization this user belongs to.';
comment on column public.profiles.status is
  'active = full access; invited = awaiting account setup; suspended = no access.';


-- ─────────────────────────────────────────────────────────────
-- 3. INVITATIONS
-- ─────────────────────────────────────────────────────────────
create table if not exists public.invitations (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations(id) on delete cascade,
  email           text        not null,
  role            text        not null check (role in ('sales_rep', 'technician', 'manager')),
  invited_by      uuid        references auth.users(id) on delete set null,
  status          text        not null default 'pending'
                    check (status in ('pending', 'accepted', 'expired', 'revoked')),
  expires_at      timestamptz not null default (now() + interval '7 days'),
  created_at      timestamptz not null default now()
);

-- Prevent sending two pending invites to the same email for the same org
create unique index if not exists invitations_org_email_pending_idx
  on public.invitations (organization_id, lower(email))
  where status = 'pending';

alter table public.invitations enable row level security;

comment on table public.invitations is
  'Pending/accepted email invitations to join an organization.';


-- ─────────────────────────────────────────────────────────────
-- 4. ADD organization_id TO ALL DATA TABLES
-- ─────────────────────────────────────────────────────────────
-- These run with IF NOT EXISTS so they are idempotent.
alter table public.companies          add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.people             add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.visits             add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.tasks              add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.reminders          add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.opportunities      add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.call_logs          add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.technician_visits  add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.routes             add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.notes              add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

-- Enable RLS on every data table so policies are enforced
alter table public.companies         enable row level security;
alter table public.people            enable row level security;
alter table public.visits            enable row level security;
alter table public.tasks             enable row level security;
alter table public.reminders         enable row level security;
alter table public.opportunities     enable row level security;
alter table public.call_logs         enable row level security;
alter table public.technician_visits enable row level security;
alter table public.routes            enable row level security;
alter table public.notes             enable row level security;


-- ─────────────────────────────────────────────────────────────
-- 5. HELPER: get current user's organization_id
-- ─────────────────────────────────────────────────────────────
-- Used inside RLS policies without causing recursion.
create or replace function public.get_my_org_id()
returns uuid
language sql
security definer
stable
as $$
  select organization_id
  from   public.profiles
  where  id = auth.uid()
$$;

comment on function public.get_my_org_id() is
  'Returns the organization_id of the currently authenticated user. Used in RLS policies.';


-- ─────────────────────────────────────────────────────────────
-- 6. DB TRIGGER: auto-create org + manager profile on self-signup
-- ─────────────────────────────────────────────────────────────
-- When a manager signs up via the "Create Account" form, the client
-- passes `company_name` (and optionally `first_name`, `last_name`)
-- as user_metadata. This trigger reacts to that and bootstraps
-- everything automatically so the manager lands straight in their
-- own tenant without any manual steps.
--
-- Invited users do NOT have `company_name` in metadata, so they
-- are handled separately in the accept-invite page.
-- ─────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  -- Self-signup path: company_name present in metadata → create org + manager profile
  if (new.raw_user_meta_data->>'company_name') is not null
     and trim(new.raw_user_meta_data->>'company_name') <> ''
  then
    insert into public.organizations (name, owner_id)
    values (trim(new.raw_user_meta_data->>'company_name'), new.id)
    returning id into v_org_id;

    insert into public.profiles (id, email, role, organization_id, first_name, last_name, status)
    values (
      new.id,
      new.email,
      'manager',
      v_org_id,
      coalesce(trim(new.raw_user_meta_data->>'first_name'), ''),
      coalesce(trim(new.raw_user_meta_data->>'last_name'),  ''),
      'active'
    )
    on conflict (id) do update
      set organization_id = excluded.organization_id,
          role            = excluded.role,
          first_name      = excluded.first_name,
          last_name       = excluded.last_name,
          status          = excluded.status;
  end if;

  -- Invited-user path: profile created on the accept-invite page,
  -- not here, so we do nothing for them in this trigger.

  return new;
end;
$$;

-- Drop + recreate so the function body update is picked up
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- ─────────────────────────────────────────────────────────────
-- 7. FUNCTION: accept an invitation (called from accept-invite page)
-- ─────────────────────────────────────────────────────────────
-- The invitee calls this via supabase.rpc() on the accept-invite page
-- AFTER their Supabase session is established and AFTER they have set
-- their name/password. It creates their profile and marks the invite
-- accepted. Using security definer so it runs with elevated permissions.
create or replace function public.accept_invitation(
  p_invitation_id uuid,
  p_first_name    text,
  p_last_name     text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite   public.invitations%rowtype;
  v_user_id  uuid := auth.uid();
  v_profile  public.profiles%rowtype;
begin
  -- Validate the invitation
  select * into v_invite
  from   public.invitations
  where  id     = p_invitation_id
    and  lower(email) = lower((select email from auth.users where id = v_user_id))
    and  status = 'pending'
    and  expires_at > now();

  if v_invite.id is null then
    return jsonb_build_object('success', false, 'error', 'Invitation not found, already used, or expired.');
  end if;

  -- Create/update profile
  insert into public.profiles (id, email, role, organization_id, first_name, last_name, status)
  values (
    v_user_id,
    (select email from auth.users where id = v_user_id),
    v_invite.role,
    v_invite.organization_id,
    coalesce(nullif(trim(p_first_name), ''), ''),
    coalesce(nullif(trim(p_last_name),  ''), ''),
    'active'
  )
  on conflict (id) do update
    set organization_id = excluded.organization_id,
        role            = excluded.role,
        first_name      = excluded.first_name,
        last_name       = excluded.last_name,
        status          = 'active';

  -- Mark invitation accepted
  update public.invitations
  set    status = 'accepted'
  where  id = v_invite.id;

  return jsonb_build_object('success', true, 'organization_id', v_invite.organization_id, 'role', v_invite.role);
end;
$$;

comment on function public.accept_invitation is
  'Called from the accept-invite page after the user has a valid session. Creates their profile and marks invite accepted.';


-- ─────────────────────────────────────────────────────────────
-- 8. ROW LEVEL SECURITY POLICIES
-- ─────────────────────────────────────────────────────────────

-- ── organizations ──────────────────────────────────────────
drop policy if exists "org: members can view own org"  on public.organizations;
drop policy if exists "org: owner can update"          on public.organizations;
drop policy if exists "org: manager can update"        on public.organizations;

create policy "org: members can view own org"
  on public.organizations for select
  using (id = public.get_my_org_id());

create policy "org: manager can update"
  on public.organizations for update
  using (
    id = public.get_my_org_id()
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'manager'
    )
  );


-- ── profiles ───────────────────────────────────────────────
-- Allow users to see everyone in their own org (needed for team views).
drop policy if exists "profiles: view same org"   on public.profiles;
drop policy if exists "profiles: insert own"      on public.profiles;
drop policy if exists "profiles: update own"      on public.profiles;

create policy "profiles: view same org"
  on public.profiles for select
  using (organization_id = public.get_my_org_id() or id = auth.uid());

-- Invited users need to insert their own profile row (no org yet in trigger)
create policy "profiles: insert own"
  on public.profiles for insert
  with check (id = auth.uid());

create policy "profiles: update own"
  on public.profiles for update
  using (id = auth.uid());


-- ── invitations ────────────────────────────────────────────
drop policy if exists "invitations: manager crud"         on public.invitations;
drop policy if exists "invitations: invitee can view"     on public.invitations;

-- Managers can do full CRUD on their org's invitations
create policy "invitations: manager crud"
  on public.invitations for all
  using (
    organization_id = public.get_my_org_id()
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'manager'
    )
  );

-- Invitees can read their own invitation (needed on accept-invite page)
create policy "invitations: invitee can view"
  on public.invitations for select
  using (
    lower(email) = lower((select email from auth.users where id = auth.uid()))
  );


-- ── companies ──────────────────────────────────────────────
drop policy if exists "companies: org isolation" on public.companies;
create policy "companies: org isolation"
  on public.companies for all
  using (organization_id = public.get_my_org_id())
  with check (organization_id = public.get_my_org_id());


-- ── people ─────────────────────────────────────────────────
drop policy if exists "people: org isolation" on public.people;
create policy "people: org isolation"
  on public.people for all
  using (organization_id = public.get_my_org_id())
  with check (organization_id = public.get_my_org_id());


-- ── visits ─────────────────────────────────────────────────
drop policy if exists "visits: org isolation" on public.visits;
create policy "visits: org isolation"
  on public.visits for all
  using (organization_id = public.get_my_org_id())
  with check (organization_id = public.get_my_org_id());


-- ── tasks ──────────────────────────────────────────────────
drop policy if exists "tasks: org isolation" on public.tasks;
create policy "tasks: org isolation"
  on public.tasks for all
  using (organization_id = public.get_my_org_id())
  with check (organization_id = public.get_my_org_id());


-- ── reminders ──────────────────────────────────────────────
drop policy if exists "reminders: org isolation" on public.reminders;
create policy "reminders: org isolation"
  on public.reminders for all
  using (organization_id = public.get_my_org_id())
  with check (organization_id = public.get_my_org_id());


-- ── opportunities ──────────────────────────────────────────
drop policy if exists "opportunities: org isolation" on public.opportunities;
create policy "opportunities: org isolation"
  on public.opportunities for all
  using (organization_id = public.get_my_org_id())
  with check (organization_id = public.get_my_org_id());


-- ── call_logs ──────────────────────────────────────────────
drop policy if exists "call_logs: org isolation" on public.call_logs;
create policy "call_logs: org isolation"
  on public.call_logs for all
  using (organization_id = public.get_my_org_id())
  with check (organization_id = public.get_my_org_id());


-- ── technician_visits ──────────────────────────────────────
drop policy if exists "technician_visits: org isolation" on public.technician_visits;
create policy "technician_visits: org isolation"
  on public.technician_visits for all
  using (organization_id = public.get_my_org_id())
  with check (organization_id = public.get_my_org_id());


-- ── routes ─────────────────────────────────────────────────
drop policy if exists "routes: org isolation" on public.routes;
create policy "routes: org isolation"
  on public.routes for all
  using (organization_id = public.get_my_org_id())
  with check (organization_id = public.get_my_org_id());


-- ── notes ──────────────────────────────────────────────────
drop policy if exists "notes: org isolation" on public.notes;
create policy "notes: org isolation"
  on public.notes for all
  using (organization_id = public.get_my_org_id())
  with check (organization_id = public.get_my_org_id());


-- ─────────────────────────────────────────────────────────────
-- 9. BACKFILL EXISTING DATA (run once if you have existing rows)
-- ─────────────────────────────────────────────────────────────
-- If you already have data in these tables from manual setup,
-- you can migrate it to one organization by running the block
-- below (replace '00000000-0000-0000-0000-000000000000' with
-- the actual organization UUID you want to assign existing data to).
--
-- REMOVE THE /* and */ around this block to enable it:


do $$
declare
  v_org_id uuid := '08d16378-aee7-43cf-859b-207f0f93f6c5'; -- ← CHANGE THIS
begin
  update public.profiles          set organization_id = v_org_id where organization_id is null;
  update public.companies          set organization_id = v_org_id where organization_id is null;
  update public.people             set organization_id = v_org_id where organization_id is null;
  update public.visits             set organization_id = v_org_id where organization_id is null;
  update public.tasks              set organization_id = v_org_id where organization_id is null;
  update public.reminders          set organization_id = v_org_id where organization_id is null;
  update public.opportunities      set organization_id = v_org_id where organization_id is null;
  update public.call_logs          set organization_id = v_org_id where organization_id is null;
  update public.technician_visits  set organization_id = v_org_id where organization_id is null;
  update public.routes             set organization_id = v_org_id where organization_id is null;
  update public.notes              set organization_id = v_org_id where organization_id is null;
end;
$$;


-- ─────────────────────────────────────────────────────────────
-- DONE
-- ─────────────────────────────────────────────────────────────
-- Next step: deploy the `send-invite` Edge Function
-- (see supabase/functions/send-invite/index.ts)
-- ─────────────────────────────────────────────────────────────
