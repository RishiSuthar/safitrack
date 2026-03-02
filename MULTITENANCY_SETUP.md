# SafiTrack Multi-Tenant Setup Guide

This document explains how to activate the full self-service signup and invite flow you just built.

---

## What was built

| Piece | File | What it does |
|---|---|---|
| DB schema | `crm/sql/setup_multitenancy.sql` | Creates `organizations` + `invitations` tables, adds `organization_id` to every data table, sets up RLS, and installs the auto-create trigger |
| Edge Function | `supabase/functions/send-invite/index.ts` | Called by managers to invite a team member; uses service-role key to fire `auth.admin.inviteUserByEmail` |
| Accept-invite page | `crm/accept-invite.html` + `crm/accept-invite.js` | Landing page for invited users; lets them set name + password and creates their profile |
| Signup form | `crm/index.html` | "Create a free account" pane in the auth screen |
| App wiring | `crm/app.js` | `handleSignup`, `openInviteModal`, `handleInviteSubmit`, `switchAuthPane`, org loading in `initApp`, updated members list |

---

## Step 1 — Run the SQL migration

1. Open **Supabase Dashboard → SQL Editor**
2. Paste the entire contents of `crm/sql/setup_multitenancy.sql`
3. Run it

> If you already have users and data from your manual setup, scroll to the bottom of the SQL file and follow the "Backfill existing data" instructions (uncomment that block and fill in your org UUID).

---

## Step 2 — Enable Row Level Security on existing tables

If RLS is not yet enabled on your older tables, run:

```sql
alter table public.companies     enable row level security;
alter table public.people        enable row level security;
alter table public.visits        enable row level security;
alter table public.tasks         enable row level security;
alter table public.reminders     enable row level security;
alter table public.opportunities enable row level security;
```

The SQL migration already covers `organizations`, `invitations`, and `profiles`.

---

## Step 3 — Configure Auth settings in Supabase

### 3a. Email confirmation
Go to **Supabase Dashboard → Authentication → Settings → Email**:
- **Confirm email**: Enable this so managers confirm before logging in
- **Invite email**: Supabase sends this automatically when you call `inviteUserByEmail` (no extra config needed)

### 3b. Redirect URLs
Go to **Authentication → URL Configuration → Redirect URLs** and add:
```
https://safitrack.netlify.app/crm/
https://safitrack.netlify.app/crm/accept-invite.html
```
(Add `http://localhost:*` as well if testing locally)

### 3c. Email templates (optional but recommended)
Go to **Authentication → Email Templates → Invite User** and customise the invite email. The magic link in that email should point to your accept-invite page. The `{{ .RedirectTo }}` variable in the template is what you pass as `redirectTo` in the Edge Function — it's already set to `.../crm/accept-invite.html`.

---

## Step 4 — Deploy the Edge Function

Make sure you have the [Supabase CLI](https://supabase.com/docs/guides/cli) installed and linked to your project.

```bash
# from the workspace root
supabase login
supabase link --project-ref ndrkncirkekpqjjkasiy

# set the site URL so invite links point to the right place
supabase secrets set PUBLIC_SITE_URL=https://safitrack.netlify.app

# deploy
supabase functions deploy send-invite
```

The function needs no JWT verification disabled because we manually verify the caller with the anon key inside the function. If you want to be explicit:
```bash
supabase functions deploy send-invite --no-verify-jwt
```

---

## Step 5 — Test the full flow

### As a new manager:
1. Go to `https://safitrack.netlify.app/crm/`
2. Click **"Create a free account"**
3. Fill in name, company name, email, password
4. Check your email → click the confirmation link
5. Sign in → you land in your own tenant's CRM as a Manager

### As a manager inviting someone:
1. Sign in → go to **Settings → Team Members**
2. Click **"Invite member"**
3. Enter the email + pick a role → click **"Send invitation"**
4. The invitee receives an email with a magic link

### As an invited user:
1. Click the link in the email
2. You land on `/crm/accept-invite.html`
3. Fill in your name + create a password → click **"Finish setting up"**
4. Redirected to `/crm/` and signed in automatically

---

## Data isolation guarantee

Every data table (`companies`, `people`, `visits`, `tasks`, `reminders`, `opportunities`) has an `organization_id` column and an RLS policy that restricts queries to `organization_id = get_my_org_id()`.

The `get_my_org_id()` function looks up the authenticated user's profile and returns their org. This runs as `security definer` so it always has access to the profiles table without RLS interference.

**Result:** Tenants are fully isolated. User A can never read, write, or delete data from User B's company.

---

## Member limits

The `organizations.max_members` column defaults to **10**. The `send-invite` Edge Function enforces this:
- It counts active profiles + pending invitations for the org
- If the total ≥ `max_members`, it returns a clear error message

To upgrade a specific org:
```sql
update public.organizations set max_members = 50 where id = '<org-uuid>';
```

---

## Adding more data tables

If you have tables not listed in the migration (e.g. `call_logs`, `route_plans`, `technician_visits`):

```sql
-- 1. Add the column
alter table public.your_table
  add column if not exists organization_id uuid
    references public.organizations(id) on delete cascade;

-- 2. Add the RLS policy
alter table public.your_table enable row level security;

drop policy if exists "your_table: org isolation" on public.your_table;
create policy "your_table: org isolation"
  on public.your_table for all
  using (organization_id = public.get_my_org_id())
  with check (organization_id = public.get_my_org_id());

-- 3. Backfill existing rows if needed
update public.your_table
set organization_id = '<your-org-uuid>'
where organization_id is null;
```

---

## When inserting new data from the app

Now that tables have `organization_id`, every `INSERT` must include it. In `app.js`, add the org id to inserts like this:

```javascript
// At the top of any insert function:
const orgId = currentOrganization?.id;
if (!orgId) { showToast('No organization found for your account.', 'error'); return; }

// Then in the insert:
const { error } = await supabaseClient.from('visits').insert({
  ...visitData,
  organization_id: orgId,   // ← add this
});
```

The RLS `with check` policy will also block inserts that omit or misuse the org id, providing a second layer of protection.
