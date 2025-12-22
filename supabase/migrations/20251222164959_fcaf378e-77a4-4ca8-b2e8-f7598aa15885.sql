-- Add is_active column to personas table
ALTER TABLE public.personas 
ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;