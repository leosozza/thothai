-- Add 'bitrix24' to the integrations type check constraint
-- First drop the existing constraint if it exists, then add the new one

DO $$
BEGIN
    -- Try to drop the constraint if it exists
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'integrations_type_check') THEN
        ALTER TABLE public.integrations DROP CONSTRAINT integrations_type_check;
    END IF;
END $$;

-- Add the updated constraint with bitrix24 included
ALTER TABLE public.integrations 
ADD CONSTRAINT integrations_type_check 
CHECK (type = ANY (ARRAY['wapi', 'openai', 'elevenlabs', 'webhook', 'zapier', 'n8n', 'bitrix24']));