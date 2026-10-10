-- ============================================================
-- SafiTrack Service Contracts Schema
-- ============================================================
-- Run once in Supabase Dashboard → SQL Editor.
-- Safe to re-run (uses IF NOT EXISTS / ALTER ... IF NOT EXISTS).
--
-- WHAT THIS DOES:
--   1. Creates `service_contracts` table for recurring service contracts
--   2. Adds `contract_id` to ups_maintenance_reports & solar_inverter_surveys
--   3. Enables RLS: org members can read; managers can write (app-enforced)
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. SERVICE CONTRACTS
-- ─────────────────────────────────────────────────────────────
create table if not exists public.service_contracts (
  id                  uuid        primary key default gen_random_uuid(),
  organization_id     uuid        not null references public.organizations(id) on delete cascade,
  created_by          uuid        references auth.users(id) on delete set null,
  updated_by          uuid        references auth.users(id) on delete set null,

  -- Company (either select from companies table OR provide custom name)
  company_id          uuid        references public.companies(id) on delete set null,
  custom_company_name text,

  -- Subdivision / branch (e.g. "Nairobi CBD Branch", "Server Room 2")
  subdivision         text,

  -- Contract type: maps to which service form gets auto-launched
  contract_type       text        not null
    check (contract_type in ('ups_service', 'solar_service', 'custom')),
  custom_type_name    text,       -- used when contract_type = 'custom'

  -- Location text that auto-fills the technician's service form
  location            text,

  -- Scheduling
  start_date          date        not null,
  recurrence_type     text        not null default 'monthly'
    check (recurrence_type in (
      'once', 'weekly', 'bi_weekly', 'monthly',
      'quarterly', 'semi_annual', 'yearly', 'custom_weeks'
    )),
  recurrence_interval integer,    -- for 'custom_weeks': number of weeks between visits

  -- Reminder lead times in days (e.g. [7, 14] = 1 week & 2 weeks before)
  reminder_days       integer[]   not null default '{}',

  notes               text,

  -- Lifecycle
  status              text        not null default 'active'
    check (status in ('active', 'paused', 'archived')),

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.service_contracts is
  'Recurring service contracts. Managers create/edit; all org members can view.';

comment on column public.service_contracts.recurrence_interval is
  'Used only when recurrence_type = ''custom_weeks''. Number of weeks between visits.';

comment on column public.service_contracts.reminder_days is
  'Array of integer days-before the due date to surface reminder alerts.';

-- ─────────────────────────────────────────────────────────────
-- 2. AUTO-UPDATE updated_at
-- ─────────────────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists service_contracts_updated_at on public.service_contracts;
create trigger service_contracts_updated_at
  before update on public.service_contracts
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 3. ROW-LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────
alter table public.service_contracts enable row level security;

-- Drop existing policies before recreating (idempotent)
drop policy if exists "org members can read contracts"    on public.service_contracts;
drop policy if exists "org members can insert contracts"  on public.service_contracts;
drop policy if exists "org members can update contracts"  on public.service_contracts;
drop policy if exists "org members can delete contracts"  on public.service_contracts;

-- Read: any authenticated member of the same org
create policy "org members can read contracts"
  on public.service_contracts
  for select
  using (organization_id = get_my_org_id());

-- Write: org members can mutate (role enforcement is in the application layer)
create policy "org members can insert contracts"
  on public.service_contracts
  for insert
  with check (organization_id = get_my_org_id());

create policy "org members can update contracts"
  on public.service_contracts
  for update
  using (organization_id = get_my_org_id())
  with check (organization_id = get_my_org_id());

create policy "org members can delete contracts"
  on public.service_contracts
  for delete
  using (organization_id = get_my_org_id());

-- ─────────────────────────────────────────────────────────────
-- 4. ADD contract_id TO EXISTING REPORT TABLES
--    Lets us track which contract a completed service report
--    belongs to (for history / completion tracking).
-- ─────────────────────────────────────────────────────────────
alter table public.ups_maintenance_reports
  add column if not exists contract_id uuid
    references public.service_contracts(id) on delete set null;

alter table public.solar_inverter_surveys
  add column if not exists contract_id uuid
    references public.service_contracts(id) on delete set null;

-- Index for fast lookup of reports belonging to a contract
create index if not exists idx_ups_reports_contract_id
  on public.ups_maintenance_reports(contract_id)
  where contract_id is not null;

create index if not exists idx_solar_surveys_contract_id
  on public.solar_inverter_surveys(contract_id)
  where contract_id is not null;

-- Index for fast org-scoped queries
create index if not exists idx_service_contracts_org_id
  on public.service_contracts(organization_id);

create index if not exists idx_service_contracts_start_date
  on public.service_contracts(start_date);
