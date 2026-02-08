-- SafiFlow Database Migration Script
-- Execute this in your Supabase SQL Editor
-- This script adds new tables and enhances existing ones for the SafiFlow enterprise rebuild

-- ============================================================================
-- STEP 1: Create New Tables
-- ============================================================================

-- Product Categories Table
CREATE TABLE IF NOT EXISTS safiflow_product_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Proposal History/Audit Trail Table
CREATE TABLE IF NOT EXISTS safiflow_proposal_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL REFERENCES safiflow_proposed_orders(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- STEP 2: Add Columns to Existing Tables
-- ============================================================================

-- Enhance safiflow_products table
DO $$ 
BEGIN
  -- Add category_id if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='safiflow_products' AND column_name='category_id') THEN
    ALTER TABLE safiflow_products ADD COLUMN category_id UUID REFERENCES safiflow_product_categories(id) ON DELETE SET NULL;
  END IF;

  -- Add sku if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='safiflow_products' AND column_name='sku') THEN
    ALTER TABLE safiflow_products ADD COLUMN sku VARCHAR(100);
  END IF;

  -- Add unit if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='safiflow_products' AND column_name='unit') THEN
    ALTER TABLE safiflow_products ADD COLUMN unit VARCHAR(50) DEFAULT 'units';
  END IF;

  -- Add is_active if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='safiflow_products' AND column_name='is_active') THEN
    ALTER TABLE safiflow_products ADD COLUMN is_active BOOLEAN DEFAULT true;
  END IF;

  -- Add image_url if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='safiflow_products' AND column_name='image_url') THEN
    ALTER TABLE safiflow_products ADD COLUMN image_url TEXT;
  END IF;

  -- Add updated_at if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='safiflow_products' AND column_name='updated_at') THEN
    ALTER TABLE safiflow_products ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

-- Enhance safiflow_proposed_orders table
DO $$ 
BEGIN
  -- Add rep_notes if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='safiflow_proposed_orders' AND column_name='rep_notes') THEN
    ALTER TABLE safiflow_proposed_orders ADD COLUMN rep_notes TEXT;
  END IF;

  -- Add manager_reviewed_at if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='safiflow_proposed_orders' AND column_name='manager_reviewed_at') THEN
    ALTER TABLE safiflow_proposed_orders ADD COLUMN manager_reviewed_at TIMESTAMPTZ;
  END IF;

  -- Add total_items_count if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='safiflow_proposed_orders' AND column_name='total_items_count') THEN
    ALTER TABLE safiflow_proposed_orders ADD COLUMN total_items_count INT DEFAULT 0;
  END IF;

  -- Add items_below_moq_count if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='safiflow_proposed_orders' AND column_name='items_below_moq_count') THEN
    ALTER TABLE safiflow_proposed_orders ADD COLUMN items_below_moq_count INT DEFAULT 0;
  END IF;
END $$;

-- Enhance safiflow_proposed_order_items table
DO $$ 
BEGIN
  -- Add rep_images if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='safiflow_proposed_order_items' AND column_name='rep_images') THEN
    ALTER TABLE safiflow_proposed_order_items ADD COLUMN rep_images TEXT[];
  END IF;

  -- Add priority if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='safiflow_proposed_order_items' AND column_name='priority') THEN
    ALTER TABLE safiflow_proposed_order_items ADD COLUMN priority VARCHAR(20) DEFAULT 'normal';
  END IF;
END $$;

-- ============================================================================
-- STEP 3: Create Indexes for Performance
-- ============================================================================

-- Index for product category lookups
CREATE INDEX IF NOT EXISTS idx_safiflow_products_category 
ON safiflow_products(category_id) WHERE category_id IS NOT NULL;

-- Index for active products
CREATE INDEX IF NOT EXISTS idx_safiflow_products_active 
ON safiflow_products(is_active) WHERE is_active = true;

-- Index for SKU lookups
CREATE INDEX IF NOT EXISTS idx_safiflow_products_sku 
ON safiflow_products(sku) WHERE sku IS NOT NULL;

-- Index for proposal history lookups
CREATE INDEX IF NOT EXISTS idx_safiflow_proposal_history_proposal 
ON safiflow_proposal_history(proposal_id, created_at DESC);

-- Index for proposal status filtering
CREATE INDEX IF NOT EXISTS idx_safiflow_proposed_orders_status 
ON safiflow_proposed_orders(status, created_at DESC);

-- Index for proposal sales rep filtering
CREATE INDEX IF NOT EXISTS idx_safiflow_proposed_orders_rep 
ON safiflow_proposed_orders(sales_rep_id, created_at DESC);

-- ============================================================================
-- STEP 4: Insert Default Categories
-- ============================================================================

INSERT INTO safiflow_product_categories (name, description) VALUES
  ('Beverages', 'Soft drinks, juices, water'),
  ('Dairy Products', 'Milk, yogurt, cheese'),
  ('Snacks', 'Chips, crackers, nuts'),
  ('Household Items', 'Cleaning supplies, toiletries'),
  ('Frozen Foods', 'Ice cream, frozen meals'),
  ('Bakery', 'Bread, pastries, cakes')
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- STEP 5: Create Triggers for Updated Timestamps
-- ============================================================================

-- Trigger function for updating updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to safiflow_products
DROP TRIGGER IF EXISTS update_safiflow_products_updated_at ON safiflow_products;
CREATE TRIGGER update_safiflow_products_updated_at
    BEFORE UPDATE ON safiflow_products
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to safiflow_product_categories
DROP TRIGGER IF EXISTS update_safiflow_categories_updated_at ON safiflow_product_categories;
CREATE TRIGGER update_safiflow_categories_updated_at
    BEFORE UPDATE ON safiflow_product_categories
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- STEP 6: Create Function to Auto-Log Status Changes
-- ============================================================================

CREATE OR REPLACE FUNCTION log_proposal_status_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Only log if status actually changed
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO safiflow_proposal_history (proposal_id, status, notes, changed_by)
    VALUES (NEW.id, NEW.status, NEW.manager_notes, auth.uid());
  END IF;
  RETURN NEW;
END;
$$ language 'plpgsql' SECURITY DEFINER;

-- Apply trigger to automatically log status changes
DROP TRIGGER IF EXISTS auto_log_proposal_status ON safiflow_proposed_orders;
CREATE TRIGGER auto_log_proposal_status
    AFTER UPDATE ON safiflow_proposed_orders
    FOR EACH ROW
    EXECUTE FUNCTION log_proposal_status_change();

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Run these to verify the migration was successful:

-- Check new tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name LIKE 'safiflow%'
ORDER BY table_name;

-- Check new columns in safiflow_products
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'safiflow_products'
ORDER BY ordinal_position;

-- Check categories were inserted
SELECT * FROM safiflow_product_categories ORDER BY name;

-- ============================================================================
-- ROLLBACK SCRIPT (if needed)
-- ============================================================================

/*
-- ONLY RUN THIS IF YOU NEED TO ROLLBACK THE MIGRATION

-- Drop triggers
DROP TRIGGER IF EXISTS auto_log_proposal_status ON safiflow_proposed_orders;
DROP TRIGGER IF EXISTS update_safiflow_products_updated_at ON safiflow_products;
DROP TRIGGER IF EXISTS update_safiflow_categories_updated_at ON safiflow_product_categories;

-- Drop functions
DROP FUNCTION IF EXISTS log_proposal_status_change();
DROP FUNCTION IF EXISTS update_updated_at_column();

-- Drop new tables
DROP TABLE IF EXISTS safiflow_proposal_history CASCADE;
DROP TABLE IF EXISTS safiflow_product_categories CASCADE;

-- Remove new columns from safiflow_proposed_order_items
ALTER TABLE safiflow_proposed_order_items 
  DROP COLUMN IF EXISTS rep_images,
  DROP COLUMN IF EXISTS priority;

-- Remove new columns from safiflow_proposed_orders
ALTER TABLE safiflow_proposed_orders 
  DROP COLUMN IF EXISTS rep_notes,
  DROP COLUMN IF EXISTS manager_reviewed_at,
  DROP COLUMN IF EXISTS total_items_count,
  DROP COLUMN IF EXISTS items_below_moq_count;

-- Remove new columns from safiflow_products
ALTER TABLE safiflow_products 
  DROP COLUMN IF EXISTS category_id,
  DROP COLUMN IF EXISTS sku,
  DROP COLUMN IF EXISTS unit,
  DROP COLUMN IF EXISTS is_active,
  DROP COLUMN IF EXISTS image_url,
  DROP COLUMN IF EXISTS updated_at;
*/

-- ============================================================================
-- STEP 7: Row Level Security (RLS) Policies
-- ============================================================================

-- Enable RLS on tables
ALTER TABLE safiflow_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE safiflow_product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE safiflow_branch_product_moq ENABLE ROW LEVEL SECURITY;
ALTER TABLE safiflow_proposal_history ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- Policies for safiflow_products
-- ----------------------------------------------------------------------------

-- Allow read access to all authenticated users
DROP POLICY IF EXISTS "Allow read access for all authenticated users" ON safiflow_products;
CREATE POLICY "Allow read access for all authenticated users" ON safiflow_products
  FOR SELECT USING (auth.role() = 'authenticated');

-- Allow write access to managers only
DROP POLICY IF EXISTS "Allow write access for managers" ON safiflow_products;
CREATE POLICY "Allow write access for managers" ON safiflow_products
  FOR ALL USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'manager'
  );

-- ----------------------------------------------------------------------------
-- Policies for safiflow_product_categories
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Allow read access for all authenticated users" ON safiflow_product_categories;
CREATE POLICY "Allow read access for all authenticated users" ON safiflow_product_categories
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Allow write access for managers" ON safiflow_product_categories;
CREATE POLICY "Allow write access for managers" ON safiflow_product_categories
  FOR ALL USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'manager'
  );

-- ----------------------------------------------------------------------------
-- Policies for safiflow_branch_product_moq
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Allow read access for all authenticated users" ON safiflow_branch_product_moq;
CREATE POLICY "Allow read access for all authenticated users" ON safiflow_branch_product_moq
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Allow write access for managers" ON safiflow_branch_product_moq;
CREATE POLICY "Allow write access for managers" ON safiflow_branch_product_moq
  FOR ALL USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'manager'
  );

-- ----------------------------------------------------------------------------
-- Policies for safiflow_proposal_history
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Allow read access for managers" ON safiflow_proposal_history;
CREATE POLICY "Allow read access for managers" ON safiflow_proposal_history
  FOR SELECT USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'manager'
  );

DROP POLICY IF EXISTS "Allow insert for authenticated users" ON safiflow_proposal_history;
CREATE POLICY "Allow insert for authenticated users" ON safiflow_proposal_history
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- ----------------------------------------------------------------------------
-- Policies for safiflow_proposed_orders (Update existing if needed)
-- ----------------------------------------------------------------------------
-- Ensure managers can update proposals (for approval/rejection)
DROP POLICY IF EXISTS "Allow update for managers" ON safiflow_proposed_orders;
CREATE POLICY "Allow update for managers" ON safiflow_proposed_orders
  FOR UPDATE USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'manager'
  );

