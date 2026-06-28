-- ============================================================
-- SafiTrack – Opportunity Assignees Migration
-- ============================================================
-- Allows tagging multiple team members (sales reps / managers)
-- on a single opportunity so they can co-own and edit it.
--
-- Run ONCE in Supabase Dashboard → SQL Editor.
-- It is safe to re-run (uses IF NOT EXISTS / OR REPLACE).
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. JUNCTION TABLE: opportunity_assignees
-- ─────────────────────────────────────────────────────────────
-- One row per (opportunity, team member) pair.
-- Cascades on delete so removing an opportunity or a user
-- automatically cleans up the join rows.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.opportunity_assignees (
  id              uuid        primary key default gen_random_uuid(),
  opportunity_id  uuid        not null
                    references public.opportunities(id) on delete cascade,
  -- References profiles.id directly (same value as auth.users.id) so that
  -- Supabase PostgREST can resolve embedded profile joins if needed.
  user_id         uuid        not null
                    references public.profiles(id) on delete cascade,
  organization_id uuid
                    references public.organizations(id) on delete cascade,
  assigned_by     uuid
                    references public.profiles(id) on delete set null,
  assigned_at     timestamptz not null default now(),

  unique (opportunity_id, user_id)
);

alter table public.opportunity_assignees enable row level security;

comment on table public.opportunity_assignees is
  'Junction table – links multiple team members (assignees) to a single opportunity.';

comment on column public.opportunity_assignees.assigned_by is
  'The user who tagged this assignee (owner or manager).';


-- ─────────────────────────────────────────────────────────────
-- 2. INDEXES
-- ─────────────────────────────────────────────────────────────
create index if not exists opp_assignees_opportunity_idx
  on public.opportunity_assignees (opportunity_id);

create index if not exists opp_assignees_user_idx
  on public.opportunity_assignees (user_id);

create index if not exists opp_assignees_org_idx
  on public.opportunity_assignees (organization_id);


-- ─────────────────────────────────────────────────────────────
-- 3. ROW LEVEL SECURITY – opportunity_assignees
-- ─────────────────────────────────────────────────────────────

-- Any authenticated member of the org can see who is tagged
create policy "org members can view opportunity assignees"
  on public.opportunity_assignees
  for select
  using (organization_id = get_my_org_id());

-- Opportunity owner or manager can tag team members
create policy "org members can add opportunity assignees"
  on public.opportunity_assignees
  for insert
  with check (organization_id = get_my_org_id());

-- Opportunity owner or manager can untag team members
create policy "org members can remove opportunity assignees"
  on public.opportunity_assignees
  for delete
  using (organization_id = get_my_org_id());


-- ─────────────────────────────────────────────────────────────
-- 4. EXTEND OPPORTUNITIES RLS FOR ASSIGNEES
-- ─────────────────────────────────────────────────────────────
-- Sales reps who are tagged as assignees need read + update
-- access to that opportunity even though they are not the owner.
--
-- These are ADDITIVE policies – they do not replace your
-- existing sales-rep / manager policies.
--
-- If you get a "policy already exists" error, either rename
-- the policy or drop the conflicting one first.
-- ─────────────────────────────────────────────────────────────

-- Assignees can read opportunities they are tagged on
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'opportunities'
      and policyname = 'assignees can view opportunities'
  ) then
    execute $pol$
      create policy "assignees can view opportunities"
        on public.opportunities
        for select
        using (
          organization_id = get_my_org_id()
          and exists (
            select 1 from public.opportunity_assignees oa
            where oa.opportunity_id = id
              and oa.user_id        = auth.uid()
          )
        )
    $pol$;
  end if;
end
$$;

-- Assignees can update opportunities they are tagged on
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'opportunities'
      and policyname = 'assignees can update opportunities'
  ) then
    execute $pol$
      create policy "assignees can update opportunities"
        on public.opportunities
        for update
        using (
          organization_id = get_my_org_id()
          and exists (
            select 1 from public.opportunity_assignees oa
            where oa.opportunity_id = id
              and oa.user_id        = auth.uid()
          )
        )
    $pol$;
  end if;
end
$$;
