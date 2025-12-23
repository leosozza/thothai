-- Add provider_type column to instances table
ALTER TABLE public.instances 
ADD COLUMN IF NOT EXISTS provider_type TEXT DEFAULT 'wapi';

-- Add Evolution API specific columns
ALTER TABLE public.instances 
ADD COLUMN IF NOT EXISTS evolution_instance_name TEXT;

-- Add comment for documentation
COMMENT ON COLUMN public.instances.provider_type IS 'WhatsApp provider: wapi, evolution, or gupshup';
COMMENT ON COLUMN public.instances.evolution_instance_name IS 'Instance name on Evolution API server';