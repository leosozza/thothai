-- Add ElevenLabs Agent ID column to personas for telephony integration
ALTER TABLE personas 
ADD COLUMN elevenlabs_agent_id text;

-- Create index for fast lookup by agent_id during webhooks
CREATE INDEX idx_personas_elevenlabs_agent_id 
ON personas(elevenlabs_agent_id) 
WHERE elevenlabs_agent_id IS NOT NULL;

-- Add comment explaining the field
COMMENT ON COLUMN personas.elevenlabs_agent_id IS 'ElevenLabs Agent ID for voice/telephony integration';