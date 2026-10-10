-- ============================================================
-- Add settings JSONB column to organizations
-- Run in Supabase SQL Editor
-- ============================================================
-- Stores org-level configuration (e.g. pdf_header text).
-- Existing rows get an empty object as the default.
-- ============================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}';
