-- Mover DeepSeek R1 Free para OpenRouter
UPDATE native_ai_models 
SET provider_source = 'openrouter', 
    name = 'deepseek/deepseek-r1:free'
WHERE display_name ILIKE '%DeepSeek R1%' AND tier = 'basic';