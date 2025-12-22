-- Remover "Free" do nome do modelo DeepSeek
UPDATE native_ai_models 
SET display_name = 'DeepSeek R1'
WHERE display_name = 'DeepSeek R1 Free';

-- Atualizar descrições que mencionam "gratuito/gratuita"
UPDATE native_ai_models 
SET description = 'Modelo de raciocínio avançado'
WHERE display_name = 'DeepSeek R1';

UPDATE native_ai_models 
SET description = 'Modelo rápido do Google'
WHERE display_name = 'Gemini 2.0 Flash';