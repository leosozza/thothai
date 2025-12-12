-- Add attendance_mode column to conversations table
ALTER TABLE public.conversations 
ADD COLUMN IF NOT EXISTS attendance_mode TEXT DEFAULT 'ai';

-- Add check constraint for valid values
ALTER TABLE public.conversations 
ADD CONSTRAINT attendance_mode_check 
CHECK (attendance_mode IN ('ai', 'human', 'hybrid'));

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_conversations_attendance_mode 
ON public.conversations(attendance_mode);