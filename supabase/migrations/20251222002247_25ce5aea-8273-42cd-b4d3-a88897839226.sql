-- Add column to track if persona is enabled as Bitrix24 chatbot
ALTER TABLE personas ADD COLUMN bitrix_bot_enabled BOOLEAN DEFAULT false;