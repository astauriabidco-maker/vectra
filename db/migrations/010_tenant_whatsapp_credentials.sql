-- Migration: Extend tenants table for WhatsApp credentials storage
-- This allows per-tenant WhatsApp Business API configuration

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS waba_id TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS phone_number_id TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS whatsapp_access_token TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS facebook_config JSONB DEFAULT '{}';

-- Add comments for documentation
COMMENT ON COLUMN tenants.waba_id IS 'WhatsApp Business Account ID from Meta';
COMMENT ON COLUMN tenants.phone_number_id IS 'WhatsApp Phone Number ID from Meta';
COMMENT ON COLUMN tenants.whatsapp_access_token IS 'Long-lived access token for WhatsApp API';
COMMENT ON COLUMN tenants.facebook_config IS 'Additional Facebook/Meta configuration JSON';
