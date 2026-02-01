-- ============================================
-- V5 Marketing & CRM - Campaign Items + Contacts
-- Migration: 009_campaign_items.sql
-- ============================================

-- ============================================
-- 1. CONTACTS (CRM Contacts - distinct from campaign_contacts)
-- ============================================
CREATE TABLE IF NOT EXISTS contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    phone TEXT NOT NULL,
    name TEXT,
    email TEXT,
    tags TEXT[] DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    opted_out BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Un seul numéro par tenant
    UNIQUE(tenant_id, phone)
);

-- Index pour performance
CREATE INDEX IF NOT EXISTS idx_contacts_tenant_id ON contacts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);
CREATE INDEX IF NOT EXISTS idx_contacts_opted_out ON contacts(tenant_id, opted_out);

-- ============================================
-- 2. CAMPAIGN_ITEMS (Détail d'exécution par contact)
-- ============================================
CREATE TABLE IF NOT EXISTS campaign_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    
    -- Statut d'envoi
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'QUEUED', 'SENT', 'DELIVERED', 'FAILED')),
    
    -- Lien vers le message envoyé
    message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    
    -- Erreur si échec
    error_message TEXT,
    
    -- Timestamps
    queued_at TIMESTAMP WITH TIME ZONE,
    sent_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index pour performance
CREATE INDEX IF NOT EXISTS idx_campaign_items_campaign_id ON campaign_items(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_items_contact_id ON campaign_items(contact_id);
CREATE INDEX IF NOT EXISTS idx_campaign_items_status ON campaign_items(status);
CREATE INDEX IF NOT EXISTS idx_campaign_items_campaign_status ON campaign_items(campaign_id, status);

-- ============================================
-- 3. UPDATE CAMPAIGNS TABLE - Add stats JSONB
-- ============================================
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS stats JSONB DEFAULT '{"sent": 0, "delivered": 0, "failed": 0, "pending": 0}';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS started_at TIMESTAMP WITH TIME ZONE;

-- ============================================
-- 4. TRIGGER: Update campaign stats on item status change
-- ============================================
CREATE OR REPLACE FUNCTION update_campaign_stats()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE campaigns SET
        stats = (
            SELECT jsonb_build_object(
                'pending', COUNT(*) FILTER (WHERE status = 'PENDING'),
                'queued', COUNT(*) FILTER (WHERE status = 'QUEUED'),
                'sent', COUNT(*) FILTER (WHERE status = 'SENT'),
                'delivered', COUNT(*) FILTER (WHERE status = 'DELIVERED'),
                'failed', COUNT(*) FILTER (WHERE status = 'FAILED')
            )
            FROM campaign_items
            WHERE campaign_id = COALESCE(NEW.campaign_id, OLD.campaign_id)
        )
    WHERE id = COALESCE(NEW.campaign_id, OLD.campaign_id);
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_campaign_stats ON campaign_items;
CREATE TRIGGER trigger_update_campaign_stats
    AFTER INSERT OR UPDATE OF status ON campaign_items
    FOR EACH ROW
    EXECUTE FUNCTION update_campaign_stats();
