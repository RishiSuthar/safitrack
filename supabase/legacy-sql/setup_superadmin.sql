-- ============================================================
-- SafiTrack Super Admin & Billing Schema Update
-- ============================================================

-- 1. Add Super Admin flag to profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.is_super_admin IS 'Set to true manually in the DB for platform owners.';

-- 2. Subscriptions Table
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan_id text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'canceled', 'trialing')),
  current_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS for subscriptions
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "subscriptions: org isolation" ON public.subscriptions;
CREATE POLICY "subscriptions: org isolation"
  ON public.subscriptions FOR SELECT
  USING (organization_id = public.get_my_org_id());

-- 3. Payments (Invoices) Table
CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  stripe_invoice_id text,
  amount integer NOT NULL, -- in cents
  status text NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'open', 'void', 'uncollectible')),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS for payments
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payments: org isolation" ON public.payments;
CREATE POLICY "payments: org isolation"
  ON public.payments FOR SELECT
  USING (organization_id = public.get_my_org_id());

-- Note: The Super Admin Edge Function bypasses RLS to read all organizations, subscriptions, and payments.
