-- Create voice_providers table (similar to ai_providers)
CREATE TABLE public.voice_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL, -- 'tts' or 'stt'
  base_url TEXT,
  is_native BOOLEAN DEFAULT false,
  tier TEXT DEFAULT 'professional',
  token_cost_multiplier NUMERIC DEFAULT 1.0,
  logo_url TEXT,
  docs_url TEXT,
  key_generation_guide TEXT,
  auth_header TEXT DEFAULT 'Authorization',
  auth_prefix TEXT DEFAULT 'Bearer',
  available_voices JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create native_voice_models table (free ThothAI voice models)
CREATE TABLE public.native_voice_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  provider_source TEXT NOT NULL, -- 'elevenlabs', 'azure', 'google'
  type TEXT NOT NULL, -- 'tts' or 'stt'
  tier TEXT DEFAULT 'basic',
  token_cost_multiplier NUMERIC DEFAULT 1.0,
  voice_id TEXT,
  language TEXT DEFAULT 'pt-BR',
  gender TEXT, -- 'male', 'female', 'neutral'
  description TEXT,
  sample_audio_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create workspace_voice_credentials table
CREATE TABLE public.workspace_voice_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES public.voice_providers(id) ON DELETE CASCADE,
  api_key_encrypted TEXT NOT NULL,
  region TEXT,
  default_voice_id TEXT,
  is_active BOOLEAN DEFAULT true,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, provider_id)
);

-- Enable RLS
ALTER TABLE public.voice_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.native_voice_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_voice_credentials ENABLE ROW LEVEL SECURITY;

-- RLS Policies for voice_providers (public read for active)
CREATE POLICY "Anyone can view active voice providers"
ON public.voice_providers FOR SELECT
USING (is_active = true);

-- RLS Policies for native_voice_models (public read for active)
CREATE POLICY "Anyone can view active native voice models"
ON public.native_voice_models FOR SELECT
USING (is_active = true);

-- RLS Policies for workspace_voice_credentials
CREATE POLICY "Workspace members can view voice credentials"
ON public.workspace_voice_credentials FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.workspace_members wm
  WHERE wm.workspace_id = workspace_voice_credentials.workspace_id
  AND wm.user_id = auth.uid()
));

CREATE POLICY "Workspace admins can manage voice credentials"
ON public.workspace_voice_credentials FOR ALL
USING (EXISTS (
  SELECT 1 FROM public.workspace_members wm
  WHERE wm.workspace_id = workspace_voice_credentials.workspace_id
  AND wm.user_id = auth.uid()
  AND wm.role IN ('owner', 'admin')
));

-- Insert default voice providers
INSERT INTO public.voice_providers (name, slug, type, base_url, is_native, tier, docs_url, logo_url) VALUES
('OpenAI Whisper', 'openai_whisper', 'stt', 'https://api.openai.com/v1/audio', false, 'professional', 'https://platform.openai.com/docs/guides/speech-to-text', NULL),
('ElevenLabs', 'elevenlabs', 'tts', 'https://api.elevenlabs.io/v1', false, 'professional', 'https://elevenlabs.io/docs', NULL),
('Azure Speech', 'azure_tts', 'tts', NULL, false, 'professional', 'https://learn.microsoft.com/azure/ai-services/speech-service/', NULL),
('Google Cloud TTS', 'google_tts', 'tts', 'https://texttospeech.googleapis.com/v1', false, 'professional', 'https://cloud.google.com/text-to-speech/docs', NULL);

-- Insert native voice models (ThothAI free tier using ElevenLabs)
INSERT INTO public.native_voice_models (name, display_name, provider_source, type, tier, voice_id, language, gender, description) VALUES
-- ElevenLabs voices
('elevenlabs/sarah', 'Sarah', 'elevenlabs', 'tts', 'basic', 'EXAVITQu4vr4xnSDxMaL', 'en-US', 'female', 'Voz feminina natural e amigável'),
('elevenlabs/roger', 'Roger', 'elevenlabs', 'tts', 'basic', 'CwhRBWXzGAHq8TQ4Fs17', 'en-US', 'male', 'Voz masculina profissional'),
('elevenlabs/laura', 'Laura', 'elevenlabs', 'tts', 'professional', 'FGY2WhTYpPnrIDTdsKH5', 'en-US', 'female', 'Voz feminina expressiva'),
('elevenlabs/charlie', 'Charlie', 'elevenlabs', 'tts', 'professional', 'IKne3meq5aSn9XLyUdCD', 'en-US', 'male', 'Voz masculina casual'),
('elevenlabs/matilda', 'Matilda', 'elevenlabs', 'tts', 'expert', 'XrExE9yKIg1WjnnlVkGX', 'en-US', 'female', 'Voz feminina premium ultra-realista'),
('elevenlabs/brian', 'Brian', 'elevenlabs', 'tts', 'expert', 'nPczCjzI2devNBz1zQrb', 'en-US', 'male', 'Voz masculina premium ultra-realista'),
-- Whisper STT
('openai/whisper', 'Whisper', 'openai', 'stt', 'basic', NULL, 'multi', 'neutral', 'Transcrição de alta precisão multilíngue');

-- Triggers for updated_at
CREATE TRIGGER update_voice_providers_updated_at
BEFORE UPDATE ON public.voice_providers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_native_voice_models_updated_at
BEFORE UPDATE ON public.native_voice_models
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_workspace_voice_credentials_updated_at
BEFORE UPDATE ON public.workspace_voice_credentials
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();