-- Create workspace_tokens table for secure multi-tenant linking
CREATE TABLE public.workspace_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  token TEXT UNIQUE NOT NULL,
  token_type TEXT NOT NULL DEFAULT 'bitrix24',
  is_used BOOLEAN DEFAULT false,
  used_at TIMESTAMPTZ,
  used_by_member_id TEXT,
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '7 days'),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.workspace_tokens ENABLE ROW LEVEL SECURITY;

-- Policy: workspace members can view their tokens
CREATE POLICY "Workspace members can view tokens"
ON public.workspace_tokens
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = workspace_tokens.workspace_id
    AND wm.user_id = auth.uid()
  )
);

-- Policy: workspace admins/owners can create tokens
CREATE POLICY "Workspace admins can create tokens"
ON public.workspace_tokens
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = workspace_tokens.workspace_id
    AND wm.user_id = auth.uid()
    AND wm.role IN ('owner', 'admin')
  )
);

-- Policy: workspace admins/owners can delete tokens
CREATE POLICY "Workspace admins can delete tokens"
ON public.workspace_tokens
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = workspace_tokens.workspace_id
    AND wm.user_id = auth.uid()
    AND wm.role IN ('owner', 'admin')
  )
);

-- Create index for faster token lookups
CREATE INDEX idx_workspace_tokens_token ON public.workspace_tokens(token);
CREATE INDEX idx_workspace_tokens_workspace ON public.workspace_tokens(workspace_id);