-- ============================================
-- V5.1 Contact Segmentation
-- Migration: 011_contact_segmentation.sql
-- ============================================

-- ============================================
-- 1. EXTEND CONTACTS TABLE
-- ============================================
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_interaction TIMESTAMP WITH TIME ZONE;

-- Add GIN index for fast tag filtering
CREATE INDEX IF NOT EXISTS idx_contacts_tags ON contacts USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_contacts_location ON contacts(tenant_id, location);
CREATE INDEX IF NOT EXISTS idx_contacts_last_interaction ON contacts(tenant_id, last_interaction);

COMMENT ON COLUMN contacts.location IS 'City or region for geographic targeting';
COMMENT ON COLUMN contacts.country IS 'Country code (FR, US, etc)';
COMMENT ON COLUMN contacts.last_interaction IS 'Last message received from this contact';

-- ============================================
-- 2. ADD TARGET FILTER TO CAMPAIGNS
-- ============================================
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS target_filter JSONB DEFAULT '{}';

COMMENT ON COLUMN campaigns.target_filter IS 'Filter criteria: {"tags": ["vip"], "location": "Paris", "last_interaction_days": 30}';

-- ============================================
-- 3. ADD SCHEDULED STATUS TO CAMPAIGNS
-- ============================================
-- Note: PostgreSQL doesn't allow ALTER CHECK CONSTRAINT, so we drop and recreate
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_status_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_status_check 
    CHECK (status IN ('DRAFT', 'SCHEDULED', 'PROCESSING', 'COMPLETED', 'FAILED'));

-- ============================================
-- 4. TRIGGER: Update last_interaction on message receive
-- ============================================
CREATE OR REPLACE FUNCTION update_contact_last_interaction()
RETURNS TRIGGER AS $$
BEGIN
    -- Update when a message is received (direction = 'inbound')
    IF NEW.direction = 'inbound' THEN
        UPDATE contacts 
        SET last_interaction = NOW()
        WHERE tenant_id = NEW.tenant_id AND phone = NEW.sender;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_contact_last_interaction ON messages;
CREATE TRIGGER trigger_update_contact_last_interaction
    AFTER INSERT ON messages
    FOR EACH ROW
    EXECUTE FUNCTION update_contact_last_interaction();
