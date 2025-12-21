-- Create bitrix debug logs table for comprehensive debugging
CREATE TABLE public.bitrix_debug_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Context
  function_name TEXT NOT NULL,
  integration_id UUID,
  workspace_id UUID,
  
  -- Log type
  level TEXT NOT NULL DEFAULT 'info',
  category TEXT,
  
  -- Content
  message TEXT NOT NULL,
  details JSONB DEFAULT '{}'::jsonb,
  
  -- Request context
  request_id TEXT,
  http_method TEXT,
  http_path TEXT,
  http_status INTEGER,
  
  -- Timing
  duration_ms INTEGER,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for fast queries
CREATE INDEX idx_bitrix_debug_logs_timestamp ON public.bitrix_debug_logs(timestamp DESC);
CREATE INDEX idx_bitrix_debug_logs_function ON public.bitrix_debug_logs(function_name);
CREATE INDEX idx_bitrix_debug_logs_level ON public.bitrix_debug_logs(level);
CREATE INDEX idx_bitrix_debug_logs_request_id ON public.bitrix_debug_logs(request_id);
CREATE INDEX idx_bitrix_debug_logs_integration ON public.bitrix_debug_logs(integration_id);
CREATE INDEX idx_bitrix_debug_logs_created ON public.bitrix_debug_logs(created_at DESC);

-- Enable RLS but allow service role full access (for edge functions)
ALTER TABLE public.bitrix_debug_logs ENABLE ROW LEVEL SECURITY;

-- Policy for workspace members to view their logs
CREATE POLICY "Users can view logs of their workspaces"
ON public.bitrix_debug_logs
FOR SELECT
USING (
  workspace_id IS NULL 
  OR EXISTS (
    SELECT 1 FROM workspace_members wm
    WHERE wm.workspace_id = bitrix_debug_logs.workspace_id
    AND wm.user_id = auth.uid()
  )
);

-- Policy for admins to delete old logs
CREATE POLICY "Admins can delete logs"
ON public.bitrix_debug_logs
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM workspace_members wm
    WHERE wm.workspace_id = bitrix_debug_logs.workspace_id
    AND wm.user_id = auth.uid()
    AND wm.role IN ('owner', 'admin')
  )
);

-- Comment on table
COMMENT ON TABLE public.bitrix_debug_logs IS 'Debug logs for Bitrix24 integration - tracks all requests, responses, and API calls';