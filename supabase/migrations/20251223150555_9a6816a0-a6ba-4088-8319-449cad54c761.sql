-- Fix duplicate is_default personas in the same workspace
-- Set Rosa (inactive persona) to is_default = false
UPDATE public.personas 
SET is_default = false, updated_at = now()
WHERE id = '8d3a8636-7b38-405d-9de4-1aaa413eca2f';

-- Also ensure any other inactive personas that are marked as default get fixed
UPDATE public.personas 
SET is_default = false, updated_at = now()
WHERE is_default = true 
  AND is_active = false;