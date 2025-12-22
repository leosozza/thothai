-- Add bitrix_bot_id field to personas table
-- This allows each persona to be registered as a separate bot in Bitrix24

ALTER TABLE public.personas 
ADD COLUMN IF NOT EXISTS bitrix_bot_id integer;

-- Add comment for documentation
COMMENT ON COLUMN public.personas.bitrix_bot_id IS 'The bot ID from Bitrix24 when this persona is published as a bot';