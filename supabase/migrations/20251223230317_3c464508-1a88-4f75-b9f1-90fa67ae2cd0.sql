-- Add column to store ElevenLabs phone number ID
ALTER TABLE public.telephony_numbers 
ADD COLUMN elevenlabs_phone_id TEXT;