-- Consolidar modelos gratuitos para usar OpenRouter como fonte única
-- Isso evita a necessidade de múltiplas API keys (Groq, Google, etc.)

-- Atualizar Llama 3.3 70B para OpenRouter
UPDATE public.native_ai_models 
SET provider_source = 'openrouter', 
    name = 'meta-llama/llama-3.3-70b-instruct:free'
WHERE name = 'llama-3.3-70b-versatile' AND provider_source = 'groq';

-- Atualizar Llama 3.1 8B para OpenRouter
UPDATE public.native_ai_models 
SET provider_source = 'openrouter', 
    name = 'meta-llama/llama-3.1-8b-instruct:free'
WHERE name = 'llama-3.1-8b-instant' AND provider_source = 'groq';

-- Atualizar Mixtral 8x7B para OpenRouter
UPDATE public.native_ai_models 
SET provider_source = 'openrouter', 
    name = 'mistralai/mixtral-8x7b-instruct:free'
WHERE name = 'mixtral-8x7b-32768' AND provider_source = 'groq';

-- Atualizar Gemma2 9B para OpenRouter (remover duplicata se existir)
UPDATE public.native_ai_models 
SET provider_source = 'openrouter', 
    name = 'google/gemma-2-9b-it:free'
WHERE name = 'gemma2-9b-it' AND provider_source = 'groq';

-- Atualizar Gemini 2.0 Flash gratuito para OpenRouter
UPDATE public.native_ai_models 
SET provider_source = 'openrouter', 
    name = 'google/gemini-2.0-flash-exp:free'
WHERE name = 'gemini-2.0-flash' AND provider_source = 'google-free';

-- Remover duplicatas (manter apenas um registro por modelo)
DELETE FROM public.native_ai_models 
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY display_name ORDER BY created_at) as rn
    FROM public.native_ai_models
  ) t WHERE t.rn > 1
);