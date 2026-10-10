-- ============================================================
-- Custom Forms & Form Submissions
-- Run in Supabase SQL Editor AFTER the core tables exist
-- (organizations, auth.users, profiles).
-- ============================================================

-- ── custom_forms ─────────────────────────────────────────────
-- Managers create form templates that technicians can fill out.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS custom_forms (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  name            TEXT        NOT NULL,
  description     TEXT,
  -- fields is a JSON array of field definitions:
  -- [
  --   {
  --     "id":          "<uuid-string>",
  --     "label":       "Site Name",
  --     "type":        "text|textarea|number|date|boolean|select|photo",
  --     "required":    true,
  --     "placeholder": "e.g. ABC Corp",
  --     "options":     ["Option A", "Option B"]   -- only for type=select
  --   },
  --   ...
  -- ]
  fields          JSONB       NOT NULL DEFAULT '[]',
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_custom_forms_org    ON custom_forms(organization_id);
CREATE INDEX IF NOT EXISTS idx_custom_forms_active ON custom_forms(organization_id, is_active);

-- ── form_submissions ──────────────────────────────────────────
-- Technician submissions for custom forms created by managers.
-- Existing ups_maintenance_reports and solar_inverter_surveys
-- tables are NOT touched — they continue to work as before.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS form_submissions (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id                 UUID        NOT NULL REFERENCES custom_forms(id) ON DELETE CASCADE,
  organization_id         UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  technician_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  technician_name         TEXT,
  -- data stores field responses: { "<field_id>": <value>, ... }
  data                    JSONB       NOT NULL DEFAULT '{}',
  -- photos stores storage paths: { "<field_id>": "<path>", ... }
  photos                  JSONB                DEFAULT '{}',
  manager_approval_status TEXT        NOT NULL DEFAULT 'Pending'
                            CHECK (manager_approval_status IN ('Pending', 'Approved', 'Denied')),
  denial_reason           TEXT,
  flagged_fields          JSONB,
  submitted_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_form_submissions_form    ON form_submissions(form_id);
CREATE INDEX IF NOT EXISTS idx_form_submissions_org     ON form_submissions(organization_id);
CREATE INDEX IF NOT EXISTS idx_form_submissions_tech    ON form_submissions(technician_id);
CREATE INDEX IF NOT EXISTS idx_form_submissions_created ON form_submissions(submitted_at DESC);

-- ── auto-update updated_at on custom_forms ──────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_custom_forms_updated_at
  BEFORE UPDATE ON custom_forms
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Row Level Security ────────────────────────────────────────
ALTER TABLE custom_forms    ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_submissions ENABLE ROW LEVEL SECURITY;

-- ── custom_forms policies ─────────────────────────────────────

-- Managers in the org have full access (read active + inactive, write, delete)
CREATE POLICY "Managers can manage custom forms"
  ON custom_forms
  FOR ALL
  TO authenticated
  USING (
    organization_id = public.get_my_org_id()
    AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'manager')
  )
  WITH CHECK (
    organization_id = public.get_my_org_id()
    AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'manager')
  );

-- All org members can read active forms (so technicians can see them)
CREATE POLICY "Org members can read active forms"
  ON custom_forms
  FOR SELECT
  TO authenticated
  USING (
    organization_id = public.get_my_org_id()
    AND is_active = true
  );

-- ── form_submissions policies ─────────────────────────────────

-- Technicians can insert their own submissions
CREATE POLICY "Technicians can insert own submissions"
  ON form_submissions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = technician_id
    AND organization_id = public.get_my_org_id()
  );

-- All org members can read submissions
CREATE POLICY "Org members can read submissions"
  ON form_submissions
  FOR SELECT
  TO authenticated
  USING (organization_id = public.get_my_org_id());

-- Technicians can update (resubmit/edit) their own submissions
CREATE POLICY "Technicians can update own submissions"
  ON form_submissions
  FOR UPDATE
  TO authenticated
  USING  (auth.uid() = technician_id)
  WITH CHECK (auth.uid() = technician_id);

-- Managers can update approval status on any org submission
CREATE POLICY "Managers can update submission approvals"
  ON form_submissions
  FOR UPDATE
  TO authenticated
  USING (
    organization_id = public.get_my_org_id()
    AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'manager')
  );
