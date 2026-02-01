-- Migration: 006_media_library.sql
-- Created: 2026-01-30
-- Description: Add media library table for template headers

CREATE TABLE IF NOT EXISTS media (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    size_bytes INTEGER NOT NULL,
    url TEXT NOT NULL,
    media_type VARCHAR(20) NOT NULL CHECK (media_type IN ('IMAGE', 'VIDEO', 'DOCUMENT')),
    meta_media_handle TEXT, -- For Meta API integration
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for tenant queries
CREATE INDEX IF NOT EXISTS idx_media_tenant_id ON media(tenant_id);
CREATE INDEX IF NOT EXISTS idx_media_type ON media(media_type);
