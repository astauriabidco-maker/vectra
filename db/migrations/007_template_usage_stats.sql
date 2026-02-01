-- Migration 007: Template Usage Statistics
-- Add usage tracking to templates

-- Add usage count column
ALTER TABLE templates ADD COLUMN IF NOT EXISTS usage_count INTEGER DEFAULT 0;

-- Add last used timestamp
ALTER TABLE templates ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP;

-- Create index for sorting by usage
CREATE INDEX IF NOT EXISTS idx_templates_usage ON templates(tenant_id, usage_count DESC);

-- Comment
COMMENT ON COLUMN templates.usage_count IS 'Number of times this template has been sent';
COMMENT ON COLUMN templates.last_used_at IS 'Last time this template was used for sending';
