-- Migration: Add template version history
-- Tracks all modifications to templates for audit and rollback

CREATE TABLE IF NOT EXISTS template_versions (
    id SERIAL PRIMARY KEY,
    template_id UUID NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    tenant_id TEXT NOT NULL,
    version_number INTEGER NOT NULL DEFAULT 1,
    
    -- Snapshot of template at this version
    name TEXT NOT NULL,
    language TEXT NOT NULL,
    category TEXT,
    body_text TEXT,
    content JSONB,
    meta_status TEXT,
    
    -- Change metadata
    change_type TEXT NOT NULL DEFAULT 'created', -- created, updated, status_changed, restored
    change_description TEXT,
    changed_by TEXT, -- user who made the change
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast lookup by template
CREATE INDEX IF NOT EXISTS idx_template_versions_template_id ON template_versions(template_id);
CREATE INDEX IF NOT EXISTS idx_template_versions_tenant_id ON template_versions(tenant_id);

-- Unique constraint: one version number per template
CREATE UNIQUE INDEX IF NOT EXISTS idx_template_versions_unique ON template_versions(template_id, version_number);

COMMENT ON TABLE template_versions IS 'Stores historical versions of templates for audit and rollback purposes';
