-- Adicionar colunas para seleção de provedor de voz na tabela personas
ALTER TABLE personas 
  ADD COLUMN IF NOT EXISTS voice_provider_id UUID REFERENCES voice_providers(id),
  ADD COLUMN IF NOT EXISTS use_native_voice BOOLEAN DEFAULT true;

-- Comentários para documentação
COMMENT ON COLUMN personas.voice_provider_id IS 'ID do provedor de voz quando use_native_voice é false';
COMMENT ON COLUMN personas.use_native_voice IS 'Se true, usa vozes nativas ThothAI; se false, usa provedor próprio';