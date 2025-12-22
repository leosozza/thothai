-- Corrigir provider_source e names dos modelos nativos para OpenRouter

-- Atualizar Llama 3.3 70B
UPDATE native_ai_models 
SET provider_source = 'openrouter', 
    name = 'meta-llama/llama-3.3-70b-instruct:free'
WHERE name = 'llama-3.3-70b-versatile' OR name LIKE '%llama-3.3%';

-- Atualizar Llama 3.1 8B
UPDATE native_ai_models 
SET provider_source = 'openrouter', 
    name = 'meta-llama/llama-3.1-8b-instruct:free'
WHERE name = 'llama-3.1-8b-instant' OR name LIKE '%llama-3.1-8b%';

-- Atualizar Mixtral 8x7B
UPDATE native_ai_models 
SET provider_source = 'openrouter', 
    name = 'mistralai/mixtral-8x7b-instruct:free'
WHERE name = 'mixtral-8x7b-32768' OR name LIKE '%mixtral%';

-- Atualizar Gemma2 9B
UPDATE native_ai_models 
SET provider_source = 'openrouter', 
    name = 'google/gemma-2-9b-it:free'
WHERE name = 'gemma2-9b-it' OR name LIKE '%gemma%';

-- Atualizar Gemini 2.0 Flash
UPDATE native_ai_models 
SET provider_source = 'openrouter', 
    name = 'google/gemini-2.0-flash-exp:free'
WHERE name = 'gemini-2.0-flash' OR name LIKE '%gemini-2.0%';

-- Garantir que DeepSeek está correto
UPDATE native_ai_models 
SET provider_source = 'deepseek'
WHERE name LIKE '%deepseek%' AND provider_source != 'deepseek';