-- Add new valid status values to conversations table
-- First, drop the existing check constraint
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_status_check;

-- Add the new check constraint with additional status values
ALTER TABLE conversations ADD CONSTRAINT conversations_status_check 
  CHECK (status = ANY (ARRAY['open', 'closed', 'pending', 'in_progress', 'waiting_human']));

-- Add processing_blocked column to prevent race conditions during transfer
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS processing_blocked boolean DEFAULT false;