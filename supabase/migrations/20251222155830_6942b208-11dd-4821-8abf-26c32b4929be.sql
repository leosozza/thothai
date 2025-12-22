-- Add is_public column to ai_providers
ALTER TABLE ai_providers ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT true;

-- Rename Lovable AI to ThothAI
UPDATE ai_providers SET name = 'ThothAI', slug = 'thoth' WHERE slug = 'lovable';

-- Mark OpenRouter as not public (internal use only)
UPDATE ai_providers SET is_public = false WHERE slug = 'openrouter';