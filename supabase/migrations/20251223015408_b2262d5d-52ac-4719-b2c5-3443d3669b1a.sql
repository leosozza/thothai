-- Remover constraint antigo
ALTER TABLE telephony_providers 
DROP CONSTRAINT IF EXISTS telephony_providers_provider_type_check;

-- Adicionar novo constraint com 'sip' incluído
ALTER TABLE telephony_providers 
ADD CONSTRAINT telephony_providers_provider_type_check 
CHECK (provider_type = ANY (ARRAY['wavoip', 'twilio', 'telnyx', 'sip']));