-- ============================================================
-- UPS Maintenance Reports Table
-- Run this in your Supabase SQL Editor to create the table.
-- ============================================================

CREATE TABLE IF NOT EXISTS ups_maintenance_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Ownership / multi-tenancy
  technician_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,

  -- Step 1: Site Information
  site_client_name TEXT NOT NULL,
  location_building TEXT,
  ups_brand TEXT,
  ups_serial_number TEXT,
  ups_model TEXT,
  total_ups_runtime NUMERIC,
  technician_name TEXT NOT NULL,

  -- Step 2: Environmental Conditions
  ambient_room_temperature NUMERIC,
  humidity_level NUMERIC,

  -- Step 3: UPS / Inverter Parameters
  operating_mode VARCHAR(10) CHECK (operating_mode IN ('Normal', 'Bypass', 'Fault')),
  rectifier_dc_output_voltage NUMERIC,
  inverter_output_frequency NUMERIC,
  load_percentage NUMERIC,

  -- Step 4: Electrical Measurements — Input
  input_voltage_rn NUMERIC,
  input_voltage_yn NUMERIC,
  input_voltage_bn NUMERIC,

  -- Step 4: Electrical Measurements — Output
  output_voltage_rn NUMERIC,
  output_voltage_yn NUMERIC,
  output_voltage_bn NUMERIC,
  output_load_current NUMERIC,

  -- Step 5: Battery System
  battery_brand TEXT,
  battery_size TEXT,
  battery_quantity_series NUMERIC,
  total_battery_bank_voltage NUMERIC,
  charging_voltage NUMERIC,
  battery_surface_temperature NUMERIC,
  battery_connections_tightened BOOLEAN,
  signs_bulging_leakage BOOLEAN,
  battery_self_test_result VARCHAR(15) CHECK (battery_self_test_result IN ('Pass', 'Fail', 'Not Tested')),

  -- Step 6: Checks & Maintenance
  transfer_manual_bypass VARCHAR(5) CHECK (transfer_manual_bypass IN ('Yes', 'No', 'N/A')),
  load_transfer_test VARCHAR(5) CHECK (load_transfer_test IN ('Yes', 'No', 'N/A')),
  cooling_fan_check VARCHAR(5) CHECK (cooling_fan_check IN ('Yes', 'No', 'N/A')),
  error_alarm_log_cleared VARCHAR(5) CHECK (error_alarm_log_cleared IN ('Yes', 'No', 'N/A')),
  unit_interior_cleaned VARCHAR(5) CHECK (unit_interior_cleaned IN ('Yes', 'No', 'N/A')),
  internal_wiring_inspected VARCHAR(5) CHECK (internal_wiring_inspected IN ('Yes', 'No', 'N/A')),
  firmware_version TEXT,

  -- Step 7: Conclusion
  overall_system_status VARCHAR(4) CHECK (overall_system_status IN ('Pass', 'Fail')),
  client_engineer_name TEXT,
  servicing_engineer_name TEXT,
  notes_remarks TEXT,
  photo_path TEXT,
  signature_data TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_ups_reports_org ON ups_maintenance_reports(organization_id);
CREATE INDEX IF NOT EXISTS idx_ups_reports_tech ON ups_maintenance_reports(technician_id);
CREATE INDEX IF NOT EXISTS idx_ups_reports_created ON ups_maintenance_reports(created_at DESC);

-- ============================================================
-- Row Level Security
-- ============================================================
ALTER TABLE ups_maintenance_reports ENABLE ROW LEVEL SECURITY;

-- Technicians can insert their own reports
CREATE POLICY "Technicians can insert own reports"
  ON ups_maintenance_reports
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = technician_id);

-- Users in the same organization can read all reports
CREATE POLICY "Org members can read reports"
  ON ups_maintenance_reports
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Technicians can update their own reports
CREATE POLICY "Technicians can update own reports"
  ON ups_maintenance_reports
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = technician_id)
  WITH CHECK (auth.uid() = technician_id);
