-- ============================================================
-- SafiTrack AI Usage Tracking Migration
-- ============================================================
-- Run this in Supabase Dashboard → SQL Editor
-- ============================================================

create table if not exists public.ai_usage_logs (
    id                uuid        primary key default gen_random_uuid(),
    organization_id   uuid        references public.organizations(id) on delete cascade,
    user_id           uuid        references public.profiles(id) on delete cascade,
    action            text        not null default 'general',
    prompt_tokens     integer     not null default 0,
    candidates_tokens integer     not null default 0,
    total_tokens      integer     not null default 0,
    created_at        timestamptz not null default now()
);

-- Enable RLS
alter table public.ai_usage_logs enable row level security;

-- Policies
-- Super Admin can view all (bypasses RLS via service role key, but good to have explicit policy if needed)
-- Organization users can view their own org's usage
drop policy if exists "ai_usage: view own org" on public.ai_usage_logs;
create policy "ai_usage: view own org"
    on public.ai_usage_logs for select
    using (organization_id = public.get_my_org_id());

comment on table public.ai_usage_logs is 'Logs tokens used by AI requests (e.g. Gemini API calls).';
