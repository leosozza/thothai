-- Create enum for app roles if it doesn't exist
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create ai_providers table
CREATE TABLE public.ai_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  base_url TEXT NOT NULL,
  auth_header TEXT DEFAULT 'Authorization',
  auth_prefix TEXT DEFAULT 'Bearer',
  is_free BOOLEAN DEFAULT false,
  is_native BOOLEAN DEFAULT false,
  logo_url TEXT,
  docs_url TEXT,
  key_generation_guide TEXT,
  available_models JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.ai_providers ENABLE ROW LEVEL SECURITY;

-- Everyone can view active providers
CREATE POLICY "Anyone can view active providers"
ON public.ai_providers
FOR SELECT
USING (is_active = true);

-- Create workspace_ai_credentials table
CREATE TABLE public.workspace_ai_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES public.ai_providers(id) ON DELETE CASCADE,
  api_key_encrypted TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, provider_id)
);

-- Enable RLS
ALTER TABLE public.workspace_ai_credentials ENABLE ROW LEVEL SECURITY;

-- Workspace admins/owners can manage credentials
CREATE POLICY "Workspace admins can manage credentials"
ON public.workspace_ai_credentials
FOR ALL
USING (EXISTS (
  SELECT 1 FROM public.workspace_members wm
  WHERE wm.workspace_id = workspace_ai_credentials.workspace_id
  AND wm.user_id = auth.uid()
  AND wm.role IN ('owner', 'admin')
));

-- Workspace members can view credentials (masked)
CREATE POLICY "Workspace members can view credentials"
ON public.workspace_ai_credentials
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.workspace_members wm
  WHERE wm.workspace_id = workspace_ai_credentials.workspace_id
  AND wm.user_id = auth.uid()
));

-- Create workspace_credits table
CREATE TABLE public.workspace_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE UNIQUE,
  balance DECIMAL(12,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.workspace_credits ENABLE ROW LEVEL SECURITY;

-- Workspace members can view credits
CREATE POLICY "Workspace members can view credits"
ON public.workspace_credits
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.workspace_members wm
  WHERE wm.workspace_id = workspace_credits.workspace_id
  AND wm.user_id = auth.uid()
));

-- Create credit_transactions table
CREATE TABLE public.credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  amount DECIMAL(12,2) NOT NULL,
  transaction_type TEXT NOT NULL,
  description TEXT,
  ai_provider TEXT,
  ai_model TEXT,
  tokens_used INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

-- Workspace members can view transactions
CREATE POLICY "Workspace members can view transactions"
ON public.credit_transactions
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.workspace_members wm
  WHERE wm.workspace_id = credit_transactions.workspace_id
  AND wm.user_id = auth.uid()
));

-- Add columns to personas table
ALTER TABLE public.personas
ADD COLUMN IF NOT EXISTS ai_provider_id UUID REFERENCES public.ai_providers(id),
ADD COLUMN IF NOT EXISTS ai_model TEXT DEFAULT 'google/gemini-2.5-flash',
ADD COLUMN IF NOT EXISTS use_native_credits BOOLEAN DEFAULT true;

-- Create updated_at trigger for new tables
CREATE TRIGGER update_ai_providers_updated_at
BEFORE UPDATE ON public.ai_providers
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_workspace_ai_credentials_updated_at
BEFORE UPDATE ON public.workspace_ai_credentials
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_workspace_credits_updated_at
BEFORE UPDATE ON public.workspace_credits
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert initial AI providers data
INSERT INTO public.ai_providers (name, slug, base_url, is_free, is_native, available_models, docs_url, key_generation_guide) VALUES
('Lovable AI', 'lovable', 'https://ai.gateway.lovable.dev/v1/chat/completions', true, true, 
  '["google/gemini-2.5-flash", "google/gemini-2.5-pro", "google/gemini-2.5-flash-lite", "openai/gpt-5", "openai/gpt-5-mini", "openai/gpt-5-nano"]'::jsonb, 
  NULL, 'Gerenciado automaticamente pelo Lovable. Não requer configuração.'),
  
('OpenRouter', 'openrouter', 'https://openrouter.ai/api/v1/chat/completions', true, false,
  '["deepseek/deepseek-r1:free", "google/gemma-2-9b-it:free", "meta-llama/llama-3.2-3b-instruct:free", "anthropic/claude-3.5-sonnet", "openai/gpt-4o", "google/gemini-pro-1.5"]'::jsonb,
  'https://openrouter.ai/keys', '## Como gerar sua API Key do OpenRouter

1. Acesse [openrouter.ai](https://openrouter.ai)
2. Crie uma conta ou faça login
3. Vá em **Settings → Keys**
4. Clique em **Create Key**
5. Copie a chave gerada

**Nota:** OpenRouter oferece alguns modelos gratuitos com limite de uso.'),

('Groq', 'groq', 'https://api.groq.com/openai/v1/chat/completions', true, false,
  '["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768", "gemma2-9b-it"]'::jsonb,
  'https://console.groq.com/keys', '## Como gerar sua API Key do Groq

1. Acesse [console.groq.com](https://console.groq.com)
2. Faça login com sua conta
3. Vá em **API Keys** no menu lateral
4. Clique em **Create API Key**
5. Dê um nome e copie a chave

**Nota:** Groq oferece plano gratuito generoso para desenvolvimento.'),

('DeepSeek', 'deepseek', 'https://api.deepseek.com/v1/chat/completions', false, false,
  '["deepseek-chat", "deepseek-reasoner"]'::jsonb,
  'https://platform.deepseek.com/api_keys', '## Como gerar sua API Key do DeepSeek

1. Acesse [platform.deepseek.com](https://platform.deepseek.com)
2. Registre-se ou faça login
3. Vá em **API Keys**
4. Clique em **Create new API key**
5. Copie a chave gerada

**Nota:** DeepSeek oferece preços muito competitivos.'),

('Google AI (Gemini)', 'google', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', true, false,
  '["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"]'::jsonb,
  'https://aistudio.google.com/apikey', '## Como gerar sua API Key do Google AI

1. Acesse [aistudio.google.com](https://aistudio.google.com)
2. Faça login com sua conta Google
3. Clique em **Get API Key** no menu
4. Clique em **Create API Key**
5. Selecione ou crie um projeto
6. Copie a chave gerada

**Nota:** Google oferece plano gratuito com limites generosos.'),

('Anthropic (Claude)', 'anthropic', 'https://api.anthropic.com/v1/messages', false, false,
  '["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"]'::jsonb,
  'https://console.anthropic.com/settings/keys', '## Como gerar sua API Key da Anthropic

1. Acesse [console.anthropic.com](https://console.anthropic.com)
2. Crie uma conta ou faça login
3. Vá em **Settings → API Keys**
4. Clique em **Create Key**
5. Copie a chave gerada

**Nota:** Anthropic requer créditos pré-pagos.'),

('OpenAI', 'openai', 'https://api.openai.com/v1/chat/completions', false, false,
  '["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"]'::jsonb,
  'https://platform.openai.com/api-keys', '## Como gerar sua API Key da OpenAI

1. Acesse [platform.openai.com](https://platform.openai.com)
2. Faça login com sua conta
3. Vá em **API Keys** no menu
4. Clique em **Create new secret key**
5. Dê um nome e copie a chave

**Nota:** OpenAI requer créditos pré-pagos ou plano Plus.'),

('Mistral AI', 'mistral', 'https://api.mistral.ai/v1/chat/completions', false, false,
  '["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest", "open-mixtral-8x22b"]'::jsonb,
  'https://console.mistral.ai/api-keys', '## Como gerar sua API Key da Mistral

1. Acesse [console.mistral.ai](https://console.mistral.ai)
2. Crie uma conta ou faça login
3. Vá em **API Keys**
4. Clique em **Create new key**
5. Copie a chave gerada

**Nota:** Mistral oferece preços competitivos para modelos europeus.'),

('xAI (Grok)', 'xai', 'https://api.x.ai/v1/chat/completions', false, false,
  '["grok-beta", "grok-vision-beta"]'::jsonb,
  'https://console.x.ai', '## Como gerar sua API Key do xAI (Grok)

1. Acesse [console.x.ai](https://console.x.ai)
2. Faça login com sua conta X (Twitter)
3. Vá em **API Keys**
4. Clique em **Create API Key**
5. Copie a chave gerada

**Nota:** Requer assinatura X Premium+.');