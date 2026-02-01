-- ============================================
-- V3.6 Template Builder - Rejection Reason
-- Migration: 005_templates_rejection.sql
-- ============================================

-- Add rejection_reason column for storing Meta rejection reasons
ALTER TABLE templates ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- Add category column if not exists
ALTER TABLE templates ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'MARKETING';

-- Create index for efficient status filtering
CREATE INDEX IF NOT EXISTS idx_templates_meta_status ON templates(meta_status);
