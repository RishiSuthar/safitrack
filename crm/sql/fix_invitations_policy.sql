-- Run this in your Supabase SQL Editor to fix the 403 Forbidden error on the Invitations table

drop policy if exists "invitations: invitee can view" on public.invitations;

create policy "invitations: invitee can view"
  on public.invitations for select
  using (
    lower(email) = lower((auth.jwt() ->> 'email')::text)
  );
