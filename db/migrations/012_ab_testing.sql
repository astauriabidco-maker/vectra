-- ============================================
-- V5.2 A/B Testing for Campaigns
-- Migration: 012_ab_testing.sql
-- ============================================

-- ============================================
-- 1. CAMPAIGN VARIANTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS campaign_variants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    variant_letter CHAR(1) NOT NULL CHECK (variant_letter IN ('A', 'B', 'C')),
    template_id UUID REFERENCES templates(id) ON DELETE SET NULL,
    split_percent INT NOT NULL DEFAULT 33,
    
    -- Stats per variant
    sent INT DEFAULT 0,
    delivered INT DEFAULT 0,
    read_count INT DEFAULT 0,
    failed INT DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(campaign_id, variant_letter)
);

CREATE INDEX IF NOT EXISTS idx_campaign_variants_campaign_id ON campaign_variants(campaign_id);

COMMENT ON TABLE campaign_variants IS 'A/B test variants for campaigns (up to 3 per campaign)';

-- ============================================
-- 2. ADD VARIANT TO CAMPAIGN ITEMS
-- ============================================
ALTER TABLE campaign_items ADD COLUMN IF NOT EXISTS variant_letter CHAR(1);

CREATE INDEX IF NOT EXISTS idx_campaign_items_variant ON campaign_items(campaign_id, variant_letter);

COMMENT ON COLUMN campaign_items.variant_letter IS 'Which A/B variant this contact was assigned to';

-- ============================================
-- 3. ADD A/B TEST MODE TO CAMPAIGNS
-- ============================================
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS ab_test_enabled BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN campaigns.ab_test_enabled IS 'Whether this campaign uses A/B testing';
