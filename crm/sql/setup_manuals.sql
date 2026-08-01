-- ============================================================
-- Manuals: folders + files tables, storage bucket, RLS
-- Run this entire script in the Supabase SQL editor.
-- ============================================================

-- ── 1. Folders table ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.manual_folders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  parent_id   uuid REFERENCES public.manual_folders(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (char_length(trim(name)) > 0 AND char_length(name) <= 120),
  created_by  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS manual_folders_org_parent_idx ON public.manual_folders (org_id, parent_id);

-- ── 2. Files table ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.manual_files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  folder_id     uuid REFERENCES public.manual_folders(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (char_length(trim(name)) > 0 AND char_length(name) <= 255),
  storage_path  text NOT NULL,
  file_type     text NOT NULL DEFAULT 'file', -- 'pdf' | 'image' | 'doc' | 'sheet' | 'file'
  file_size     bigint DEFAULT 0,
  mime_type     text DEFAULT '',
  created_by    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS manual_files_org_folder_idx ON public.manual_files (org_id, folder_id);

-- ── 3. updated_at auto-update trigger ─────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS manual_folders_updated_at ON public.manual_folders;
CREATE TRIGGER manual_folders_updated_at
  BEFORE UPDATE ON public.manual_folders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS manual_files_updated_at ON public.manual_files;
CREATE TRIGGER manual_files_updated_at
  BEFORE UPDATE ON public.manual_files
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 4. Row-Level Security ─────────────────────────────────────
ALTER TABLE public.manual_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_files   ENABLE ROW LEVEL SECURITY;

-- Helper: returns the org_id for the currently authenticated user.
-- Avoids repeated subqueries in policies.
CREATE OR REPLACE FUNCTION public.my_org_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$;

-- Helper: returns the role for the currently authenticated user.
CREATE OR REPLACE FUNCTION public.my_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$;

-- ── manual_folders policies ───────────────────────────────────

-- All org members can read folders in their org
DROP POLICY IF EXISTS "manual_folders_select" ON public.manual_folders;
CREATE POLICY "manual_folders_select" ON public.manual_folders
  FOR SELECT USING (org_id = public.my_org_id());

-- Only managers may insert
DROP POLICY IF EXISTS "manual_folders_insert" ON public.manual_folders;
CREATE POLICY "manual_folders_insert" ON public.manual_folders
  FOR INSERT WITH CHECK (
    org_id = public.my_org_id()
    AND public.my_role() = 'manager'
  );

-- Only managers may update (rename)
DROP POLICY IF EXISTS "manual_folders_update" ON public.manual_folders;
CREATE POLICY "manual_folders_update" ON public.manual_folders
  FOR UPDATE USING (
    org_id = public.my_org_id()
    AND public.my_role() = 'manager'
  );

-- Only managers may delete
DROP POLICY IF EXISTS "manual_folders_delete" ON public.manual_folders;
CREATE POLICY "manual_folders_delete" ON public.manual_folders
  FOR DELETE USING (
    org_id = public.my_org_id()
    AND public.my_role() = 'manager'
  );

-- ── manual_files policies ─────────────────────────────────────

DROP POLICY IF EXISTS "manual_files_select" ON public.manual_files;
CREATE POLICY "manual_files_select" ON public.manual_files
  FOR SELECT USING (org_id = public.my_org_id());

DROP POLICY IF EXISTS "manual_files_insert" ON public.manual_files;
CREATE POLICY "manual_files_insert" ON public.manual_files
  FOR INSERT WITH CHECK (
    org_id = public.my_org_id()
    AND public.my_role() = 'manager'
  );

DROP POLICY IF EXISTS "manual_files_update" ON public.manual_files;
CREATE POLICY "manual_files_update" ON public.manual_files
  FOR UPDATE USING (
    org_id = public.my_org_id()
    AND public.my_role() = 'manager'
  );

DROP POLICY IF EXISTS "manual_files_delete" ON public.manual_files;
CREATE POLICY "manual_files_delete" ON public.manual_files
  FOR DELETE USING (
    org_id = public.my_org_id()
    AND public.my_role() = 'manager'
  );

-- ── 5. Storage bucket ─────────────────────────────────────────
-- Run this in the Supabase dashboard Storage tab OR via the API.
-- The SQL below uses the storage schema helper (available in hosted Supabase).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'manuals',
  'manuals',
  false,               -- private — files served via signed URLs only
  52428800,            -- 50 MB per file
  ARRAY[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: all org members may read; only managers may write/delete
DROP POLICY IF EXISTS "manuals_storage_select" ON storage.objects;
CREATE POLICY "manuals_storage_select" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'manuals'
    AND (storage.foldername(name))[1] = (public.my_org_id())::text
  );

DROP POLICY IF EXISTS "manuals_storage_insert" ON storage.objects;
CREATE POLICY "manuals_storage_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'manuals'
    AND (storage.foldername(name))[1] = (public.my_org_id())::text
    AND public.my_role() = 'manager'
  );

DROP POLICY IF EXISTS "manuals_storage_delete" ON storage.objects;
CREATE POLICY "manuals_storage_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'manuals'
    AND (storage.foldername(name))[1] = (public.my_org_id())::text
    AND public.my_role() = 'manager'
  );
