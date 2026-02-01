-- ============================================
-- V5.4 Campaign Analytics Enhancement
-- Migration: 014_campaign_analytics.sql
-- ============================================

-- Add read_count and response_count to campaigns for KPI calculations
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS read_count INT DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS response_count INT DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS conversion_count INT DEFAULT 0;

-- Add read status to campaign_items
ALTER TABLE campaign_items ADD COLUMN IF NOT EXISTS read_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE campaign_items ADD COLUMN IF NOT EXISTS response_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN campaigns.read_count IS 'Number of messages read (opened)';
COMMENT ON COLUMN campaigns.response_count IS 'Number of contacts who responded';
COMMENT ON COLUMN campaigns.conversion_count IS 'Number of conversions (custom goal)';
