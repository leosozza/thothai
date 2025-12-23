-- Add anti-loop control fields to conversations table
ALTER TABLE conversations 
ADD COLUMN IF NOT EXISTS processing_lock_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS last_bot_message_hash text,
ADD COLUMN IF NOT EXISTS bot_state jsonb DEFAULT '{}'::jsonb;

-- Add intent_triggers field to flows table for AI-based flow triggering
ALTER TABLE flows 
ADD COLUMN IF NOT EXISTS intent_triggers text[] DEFAULT '{}'::text[];

-- Add comment to explain the new fields
COMMENT ON COLUMN conversations.processing_lock_at IS 'Timestamp when processing started, used to prevent duplicate processing';
COMMENT ON COLUMN conversations.last_bot_message_hash IS 'Hash of last bot message to prevent sending duplicate messages';
COMMENT ON COLUMN conversations.bot_state IS 'JSON state for tracking bot context: last_processed_message_id, intent_detected, current_flow_id, etc';
COMMENT ON COLUMN flows.intent_triggers IS 'Array of intent keywords that can trigger this flow via AI detection';