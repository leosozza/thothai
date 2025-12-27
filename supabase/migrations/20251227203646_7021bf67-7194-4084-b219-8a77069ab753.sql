-- Add APIBrasil credential fields to instances table
ALTER TABLE instances ADD COLUMN IF NOT EXISTS apibrasil_secret_key text;
ALTER TABLE instances ADD COLUMN IF NOT EXISTS apibrasil_device_token text;
ALTER TABLE instances ADD COLUMN IF NOT EXISTS apibrasil_public_token text;
ALTER TABLE instances ADD COLUMN IF NOT EXISTS apibrasil_bearer_token text;

-- Add comment for documentation
COMMENT ON COLUMN instances.apibrasil_secret_key IS 'APIBrasil SecretKey credential';
COMMENT ON COLUMN instances.apibrasil_device_token IS 'APIBrasil DeviceToken credential';
COMMENT ON COLUMN instances.apibrasil_public_token IS 'APIBrasil PublicToken credential';
COMMENT ON COLUMN instances.apibrasil_bearer_token IS 'APIBrasil Bearer Token credential';