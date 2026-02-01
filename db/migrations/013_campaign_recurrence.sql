-- ============================================
-- V5.3 Campaign Recurrence
-- Migration: 013_campaign_recurrence.sql
-- ============================================

-- Add recurrence fields to campaigns
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS recurrence_type TEXT DEFAULT 'none' 
    CHECK (recurrence_type IN ('none', 'daily', 'weekly', 'monthly'));

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN campaigns.recurrence_type IS 'Recurrence pattern: none, daily, weekly, monthly';
COMMENT ON COLUMN campaigns.last_run_at IS 'Last time this recurring campaign was executed';
