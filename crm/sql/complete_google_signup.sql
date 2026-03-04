-- ============================================================
-- SafiTrack - Complete Google Sign-Up RPC
-- ============================================================
-- Run this in your Supabase Dashboard -> SQL Editor
--
-- This function is called from the frontend when a user signs in via
-- Google OAuth but doesn't have an organization yet. We need them to
-- provide a company name since Google doesn't provide one.
-- ============================================================

create or replace function public.complete_google_signup(
  p_company_name text,
  p_first_name text,
  p_last_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_profile public.profiles%rowtype;
begin
  -- 1. Ensure the user is actually authenticated
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'Not authenticated');
  end if;

  -- 2. Check if the user already has a profile with an organization
  select * into v_profile from public.profiles where id = v_user_id;
  if v_profile.organization_id is not null then
    return jsonb_build_object('success', false, 'error', 'Profile already has an organization. Cannot create a new one during Google Auth complete step.');
  end if;

  -- 3. Create the organization
  insert into public.organizations (name, owner_id)
  values (trim(p_company_name), v_user_id)
  returning id into v_org_id;

  -- 4. Create or update the profile
  insert into public.profiles (id, email, role, organization_id, first_name, last_name, status)
  values (
    v_user_id,
    (select email from auth.users where id = v_user_id),
    'manager',
    v_org_id,
    coalesce(trim(p_first_name), ''),
    coalesce(trim(p_last_name),  ''),
    'active'
  )
  on conflict (id) do update
    set organization_id = excluded.organization_id,
        role            = excluded.role,
        first_name      = excluded.first_name,
        last_name       = excluded.last_name,
        status          = 'active';

  return jsonb_build_object(
    'success', true, 
    'organization_id', v_org_id, 
    'role', 'manager'
  );
end;
$$;

comment on function public.complete_google_signup is
  'Called from the frontend to finalize a Google OAuth signup by providing the missing Company Name.';
