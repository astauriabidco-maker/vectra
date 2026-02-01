-- ============================================
-- V5 Marketing & CRM - Campagnes de Masse
-- Migration: 004_campaigns.sql
-- ============================================

-- ============================================
-- 1. CAMPAIGN_CONTACTS (Liste de diffusion CRM)
-- ============================================
CREATE TABLE IF NOT EXISTS campaign_contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    phone TEXT NOT NULL,
    name TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Un seul numéro par tenant
    UNIQUE(tenant_id, phone)
);

-- Index pour performance multi-tenant
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_tenant_id ON campaign_contacts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_phone ON campaign_contacts(phone);

-- ============================================
-- 2. CAMPAIGNS (Campagnes de masse)
-- ============================================
CREATE TABLE IF NOT EXISTS campaigns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    template_id UUID REFERENCES templates(id) ON DELETE SET NULL,
    
    -- Statut de la campagne
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PROCESSING', 'COMPLETED', 'FAILED')),
    
    -- Compteurs
    total_contacts INT DEFAULT 0,
    total_sent INT DEFAULT 0,
    total_failed INT DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Index pour performance multi-tenant
CREATE INDEX IF NOT EXISTS idx_campaigns_tenant_id ON campaigns(tenant_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_template_id ON campaigns(template_id);
