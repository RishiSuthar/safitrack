-- SafiTrack: Company Subsector Rollout (forward migration)
-- Date: 2026-09-01
--
-- Purpose:
--  1) Add optional subsector fields to companies, opportunities, and visits.
--  2) Backfill opportunity/visit subsectors from matched companies.
--  3) Add indexes used by common list/report filters.
--
-- Notes:
--  - Fields are nullable to keep create/edit flows non-blocking.
--  - This script is idempotent (safe to re-run).

begin;

-- 1) Schema changes
alter table public.companies
  add column if not exists subsector text;

alter table public.opportunities
  add column if not exists subsector text;

alter table public.visits
  add column if not exists subsector text;

comment on column public.companies.subsector is
  'Optional company subsector (e.g. Supermarket, Private Hospital, Branch Banking).';

comment on column public.opportunities.subsector is
  'Snapshot of company subsector at opportunity create/edit time for reporting stability.';

comment on column public.visits.subsector is
  'Snapshot of company subsector at visit create/edit time for reporting stability.';

-- 2) Backfill from known company records (org + normalized name match)
update public.opportunities o
set subsector = c.subsector
from public.companies c
where o.subsector is null
  and c.subsector is not null
  and o.organization_id = c.organization_id
  and lower(trim(coalesce(o.company_name, ''))) = lower(trim(coalesce(c.name, '')));

update public.visits v
set subsector = c.subsector
from public.companies c
where v.subsector is null
  and c.subsector is not null
  and v.organization_id = c.organization_id
  and lower(trim(coalesce(v.company_name, ''))) = lower(trim(coalesce(c.name, '')));

-- 3) Performance indexes for subsector filters
create index if not exists companies_org_subsector_idx
  on public.companies (organization_id, subsector);

create index if not exists opportunities_org_subsector_created_idx
  on public.opportunities (organization_id, subsector, created_at desc);

create index if not exists visits_org_subsector_created_idx
  on public.visits (organization_id, subsector, created_at desc);

commit;
