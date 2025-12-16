-- Create table for mapping W-API instances to Bitrix24 channels
CREATE TABLE public.bitrix_channel_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL REFERENCES public.integrations(id) ON DELETE CASCADE,
  instance_id UUID NOT NULL REFERENCES public.instances(id) ON DELETE CASCADE,
  line_id INTEGER NOT NULL,
  line_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(integration_id, instance_id),
  UNIQUE(integration_id, line_id)
);

-- Enable RLS
ALTER TABLE public.bitrix_channel_mappings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view channel mappings of their workspaces"
ON public.bitrix_channel_mappings
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM workspace_members wm
  WHERE wm.workspace_id = bitrix_channel_mappings.workspace_id
  AND wm.user_id = auth.uid()
));

CREATE POLICY "Users can manage channel mappings of their workspaces"
ON public.bitrix_channel_mappings
FOR ALL
USING (EXISTS (
  SELECT 1 FROM workspace_members wm
  WHERE wm.workspace_id = bitrix_channel_mappings.workspace_id
  AND wm.user_id = auth.uid()
  AND wm.role IN ('owner', 'admin')
));

-- Trigger for updated_at
CREATE TRIGGER update_bitrix_channel_mappings_updated_at
BEFORE UPDATE ON public.bitrix_channel_mappings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();