-- Tabela de conexões MCP externas
CREATE TABLE public.mcp_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  mcp_url TEXT NOT NULL,
  transport_type TEXT NOT NULL DEFAULT 'http',
  auth_type TEXT NOT NULL DEFAULT 'none',
  auth_config JSONB DEFAULT '{}'::jsonb,
  available_tools JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN DEFAULT true,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Tabela de relacionamento persona <-> MCP
CREATE TABLE public.persona_mcp_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id UUID NOT NULL REFERENCES public.personas(id) ON DELETE CASCADE,
  mcp_connection_id UUID NOT NULL REFERENCES public.mcp_connections(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(persona_id, mcp_connection_id)
);

-- Configuração do servidor MCP próprio
CREATE TABLE public.mcp_server_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE UNIQUE,
  is_enabled BOOLEAN DEFAULT false,
  api_key TEXT,
  allowed_tools JSONB DEFAULT '["send_whatsapp_message", "list_contacts", "search_contacts", "get_conversation_history", "ask_persona", "search_knowledge_base"]'::jsonb,
  rate_limit INTEGER DEFAULT 100,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.mcp_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.persona_mcp_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_server_config ENABLE ROW LEVEL SECURITY;

-- RLS Policies para mcp_connections
CREATE POLICY "Users can view mcp_connections of their workspaces"
ON public.mcp_connections FOR SELECT
USING (EXISTS (
  SELECT 1 FROM workspace_members wm
  WHERE wm.workspace_id = mcp_connections.workspace_id
  AND wm.user_id = auth.uid()
));

CREATE POLICY "Admins can manage mcp_connections"
ON public.mcp_connections FOR ALL
USING (EXISTS (
  SELECT 1 FROM workspace_members wm
  WHERE wm.workspace_id = mcp_connections.workspace_id
  AND wm.user_id = auth.uid()
  AND wm.role IN ('owner', 'admin')
));

-- RLS Policies para persona_mcp_connections
CREATE POLICY "Users can view persona_mcp_connections of their workspaces"
ON public.persona_mcp_connections FOR SELECT
USING (EXISTS (
  SELECT 1 FROM personas p
  JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
  WHERE p.id = persona_mcp_connections.persona_id
  AND wm.user_id = auth.uid()
));

CREATE POLICY "Admins can manage persona_mcp_connections"
ON public.persona_mcp_connections FOR ALL
USING (EXISTS (
  SELECT 1 FROM personas p
  JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
  WHERE p.id = persona_mcp_connections.persona_id
  AND wm.user_id = auth.uid()
  AND wm.role IN ('owner', 'admin')
));

-- RLS Policies para mcp_server_config
CREATE POLICY "Users can view mcp_server_config of their workspaces"
ON public.mcp_server_config FOR SELECT
USING (EXISTS (
  SELECT 1 FROM workspace_members wm
  WHERE wm.workspace_id = mcp_server_config.workspace_id
  AND wm.user_id = auth.uid()
));

CREATE POLICY "Admins can manage mcp_server_config"
ON public.mcp_server_config FOR ALL
USING (EXISTS (
  SELECT 1 FROM workspace_members wm
  WHERE wm.workspace_id = mcp_server_config.workspace_id
  AND wm.user_id = auth.uid()
  AND wm.role IN ('owner', 'admin')
));

-- Triggers para updated_at
CREATE TRIGGER update_mcp_connections_updated_at
  BEFORE UPDATE ON public.mcp_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_mcp_server_config_updated_at
  BEFORE UPDATE ON public.mcp_server_config
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();