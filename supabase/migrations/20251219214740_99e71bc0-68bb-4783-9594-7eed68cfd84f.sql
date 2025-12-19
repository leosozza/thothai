-- Add columns for multi-tenant WhatsApp connection types
ALTER TABLE public.instances 
ADD COLUMN IF NOT EXISTS connection_type text DEFAULT 'waba' CHECK (connection_type IN ('waba', 'official'));

ALTER TABLE public.instances 
ADD COLUMN IF NOT EXISTS gupshup_app_id text;

ALTER TABLE public.instances 
ADD COLUMN IF NOT EXISTS gupshup_api_key text;

-- Add comment for documentation
COMMENT ON COLUMN public.instances.connection_type IS 'Type of WhatsApp connection: waba (W-API with QR Code) or official (Gupshup)';
COMMENT ON COLUMN public.instances.gupshup_app_id IS 'Gupshup App ID / Source for official WhatsApp connection';
COMMENT ON COLUMN public.instances.gupshup_api_key IS 'Encrypted Gupshup API Key for this instance';