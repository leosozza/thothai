-- Remove is_free column and add tier/token_cost_multiplier to ai_providers
ALTER TABLE ai_providers DROP COLUMN IF EXISTS is_free;

ALTER TABLE ai_providers 
ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'professional' CHECK (tier IN ('basic', 'professional', 'expert')),
ADD COLUMN IF NOT EXISTS token_cost_multiplier DECIMAL(5,2) DEFAULT 1.0;

-- Create native_ai_models table for organized native models by tier
CREATE TABLE IF NOT EXISTS public.native_ai_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'professional' CHECK (tier IN ('basic', 'professional', 'expert')),
  token_cost_multiplier DECIMAL(5,2) NOT NULL DEFAULT 2.0,
  provider_source TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.native_ai_models ENABLE ROW LEVEL SECURITY;

-- Everyone can view active native models
CREATE POLICY "Anyone can view active native models" 
ON public.native_ai_models 
FOR SELECT 
USING (is_active = true);

-- Insert native AI models organized by tier
-- 🟢 BASIC (1x) - Free/lightweight models
INSERT INTO native_ai_models (name, display_name, tier, token_cost_multiplier, provider_source, description) VALUES
('llama-3.3-70b-versatile', 'Llama 3.3 70B', 'basic', 1.0, 'groq', 'Modelo versátil e rápido'),
('llama-3.1-8b-instant', 'Llama 3.1 8B', 'basic', 1.0, 'groq', 'Resposta ultra-rápida'),
('mixtral-8x7b-32768', 'Mixtral 8x7B', 'basic', 1.0, 'groq', 'Modelo MoE eficiente'),
('gemma2-9b-it', 'Gemma 2 9B', 'basic', 1.0, 'groq', 'Modelo leve do Google'),
('gemini-2.0-flash', 'Gemini 2.0 Flash', 'basic', 1.0, 'google-free', 'Versão gratuita do Gemini'),
('deepseek/deepseek-r1:free', 'DeepSeek R1 Free', 'basic', 1.0, 'openrouter', 'Reasoning model gratuito'),
('meta-llama/llama-3.2-3b-instruct:free', 'Llama 3.2 3B', 'basic', 1.0, 'openrouter', 'Modelo compacto'),
('qwen/qwen-2.5-72b-instruct:free', 'Qwen 2.5 72B', 'basic', 1.0, 'openrouter', 'Modelo chinês avançado'),
('microsoft/phi-3-mini-128k-instruct:free', 'Phi-3 Mini', 'basic', 1.0, 'openrouter', 'Modelo eficiente da Microsoft')
ON CONFLICT (name) DO NOTHING;

-- 🔵 PROFESSIONAL (2x) - Intermediate models
INSERT INTO native_ai_models (name, display_name, tier, token_cost_multiplier, provider_source, description) VALUES
('google/gemini-2.5-flash', 'Gemini 2.5 Flash', 'professional', 2.0, 'lovable', 'Equilíbrio entre velocidade e qualidade'),
('google/gemini-2.5-flash-lite', 'Gemini 2.5 Flash Lite', 'professional', 2.0, 'lovable', 'Versão leve do Gemini Flash'),
('openai/gpt-5-mini', 'GPT-5 Mini', 'professional', 2.0, 'lovable', 'Modelo intermediário da OpenAI'),
('openai/gpt-5-nano', 'GPT-5 Nano', 'professional', 2.0, 'lovable', 'Modelo compacto da OpenAI'),
('deepseek-chat', 'DeepSeek Chat', 'professional', 2.0, 'deepseek', 'Chat model avançado')
ON CONFLICT (name) DO NOTHING;

-- 🟣 EXPERT (5x) - Advanced/heavy models
INSERT INTO native_ai_models (name, display_name, tier, token_cost_multiplier, provider_source, description) VALUES
('google/gemini-2.5-pro', 'Gemini 2.5 Pro', 'expert', 5.0, 'lovable', 'Modelo mais capaz do Google'),
('google/gemini-3-pro-preview', 'Gemini 3 Pro', 'expert', 5.0, 'lovable', 'Próxima geração Gemini'),
('openai/gpt-5', 'GPT-5', 'expert', 5.0, 'lovable', 'Modelo mais capaz da OpenAI'),
('claude-sonnet-4-5', 'Claude Sonnet 4.5', 'expert', 5.0, 'anthropic', 'Modelo inteligente da Anthropic'),
('claude-opus-4-1', 'Claude Opus 4.1', 'expert', 5.0, 'anthropic', 'Modelo premium da Anthropic')
ON CONFLICT (name) DO NOTHING;

-- Update ai_providers to mark which are only for custom API keys
UPDATE ai_providers SET tier = 'professional', token_cost_multiplier = 0 WHERE slug != 'lovable';
UPDATE ai_providers SET tier = 'professional', token_cost_multiplier = 2.0 WHERE slug = 'lovable';

-- Create updated_at trigger for native_ai_models
CREATE TRIGGER update_native_ai_models_updated_at
BEFORE UPDATE ON public.native_ai_models
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();