-- Make workspace_id optional for integrations (allows Bitrix24 marketplace integrations without workspace)
ALTER TABLE public.integrations 
ALTER COLUMN workspace_id DROP NOT NULL;

-- Update RLS policy to allow reading integrations without workspace_id (for Bitrix24)
DROP POLICY IF EXISTS "Users can view integrations of their workspaces" ON public.integrations;

CREATE POLICY "Users can view integrations of their workspaces" 
ON public.integrations 
FOR SELECT 
USING (
  -- Workspace member can view
  (workspace_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM workspace_members wm
    WHERE wm.workspace_id = integrations.workspace_id 
    AND wm.user_id = auth.uid()
  ))
  OR
  -- Integrations without workspace (Bitrix24 marketplace) - viewable if config matches context
  workspace_id IS NULL
);

-- Update ALL policy to also handle null workspace_id
DROP POLICY IF EXISTS "Users can manage integrations of their workspaces" ON public.integrations;

CREATE POLICY "Users can manage integrations of their workspaces" 
ON public.integrations 
FOR ALL
USING (
  (workspace_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM workspace_members wm
    WHERE wm.workspace_id = integrations.workspace_id 
    AND wm.user_id = auth.uid()
    AND wm.role = ANY (ARRAY['owner'::text, 'admin'::text])
  ))
  OR
  workspace_id IS NULL
);