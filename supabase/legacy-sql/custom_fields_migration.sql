-- ============================================================
-- SafiTrack Custom Fields Schema Migration
-- ============================================================
-- Run this in Supabase Dashboard → SQL Editor
-- It is safe to re-run (uses IF NOT EXISTS / ON CONFLICT).
--
-- WHAT THIS DOES:
--   1. Creates `custom_field_definitions` table (field schema per org)
--   2. Creates `custom_field_values` table (actual stored values)
--   3. Sets up RLS policies for org isolation
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. CUSTOM FIELD DEFINITIONS
-- ─────────────────────────────────────────────────────────────
create table if not exists public.custom_field_definitions (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations(id) on delete cascade,
  entity_type     text        not null check (entity_type in ('company', 'person')),
  field_name      text        not null,
  field_key       text        not null,
  field_type      text        not null check (field_type in ('text', 'number', 'date', 'select', 'checkbox', 'url')),
  field_options   jsonb,       -- for 'select' type: ["Option A", "Option B", ...]
  is_required     boolean     not null default false,
  sort_order      integer     not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint uq_custom_field_def unique (organization_id, entity_type, field_key)
);

alter table public.custom_field_definitions enable row level security;

comment on table public.custom_field_definitions is
  'Defines custom fields per organization. Each row describes one custom field that applies to either companies or people.';

-- Index for fast lookups when opening modals
create index if not exists idx_cfd_org_entity
  on public.custom_field_definitions (organization_id, entity_type, sort_order);


-- ─────────────────────────────────────────────────────────────
-- 2. CUSTOM FIELD VALUES
-- ─────────────────────────────────────────────────────────────
create table if not exists public.custom_field_values (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations(id) on delete cascade,
  definition_id   uuid        not null references public.custom_field_definitions(id) on delete cascade,
  entity_type     text        not null check (entity_type in ('company', 'person')),
  entity_id       uuid        not null,
  value           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint uq_custom_field_value unique (definition_id, entity_id)
);

alter table public.custom_field_values enable row level security;

comment on table public.custom_field_values is
  'Stores actual custom field values. One row per field per entity (company or person).';

-- Index for fast lookups when loading a single record's custom fields
create index if not exists idx_cfv_entity
  on public.custom_field_values (entity_type, entity_id);

-- Index for fetching all values for a definition (e.g. when deleting a field)
create index if not exists idx_cfv_definition
  on public.custom_field_values (definition_id);


-- ─────────────────────────────────────────────────────────────
-- 3. RLS POLICIES
-- ─────────────────────────────────────────────────────────────

-- ── custom_field_definitions ──────────────────────────────────
drop policy if exists "custom_field_definitions: org read" on public.custom_field_definitions;
drop policy if exists "custom_field_definitions: manager write" on public.custom_field_definitions;

-- All org members can read definitions (needed to render forms)
create policy "custom_field_definitions: org read"
  on public.custom_field_definitions for select
  using (organization_id = public.get_my_org_id());

-- Only managers can create/update/delete definitions
create policy "custom_field_definitions: manager write"
  on public.custom_field_definitions for all
  using (
    organization_id = public.get_my_org_id()
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'manager'
    )
  )
  with check (
    organization_id = public.get_my_org_id()
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'manager'
    )
  );


-- ── custom_field_values ───────────────────────────────────────
drop policy if exists "custom_field_values: org isolation" on public.custom_field_values;

create policy "custom_field_values: org isolation"
  on public.custom_field_values for all
  using (organization_id = public.get_my_org_id())
  with check (organization_id = public.get_my_org_id());


-- ─────────────────────────────────────────────────────────────
-- 4. AUTO-UPDATE updated_at TRIGGER
-- ─────────────────────────────────────────────────────────────
create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_updated_at_custom_field_definitions on public.custom_field_definitions;
create trigger set_updated_at_custom_field_definitions
  before update on public.custom_field_definitions
  for each row execute procedure public.update_updated_at_column();

drop trigger if exists set_updated_at_custom_field_values on public.custom_field_values;
create trigger set_updated_at_custom_field_values
  before update on public.custom_field_values
  for each row execute procedure public.update_updated_at_column();


-- ─────────────────────────────────────────────────────────────
-- DONE
-- ─────────────────────────────────────────────────────────────
