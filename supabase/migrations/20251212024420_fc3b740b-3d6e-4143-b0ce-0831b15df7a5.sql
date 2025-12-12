
-- =============================================
-- MULTI-TENANT + AI TRAINING + FLOWS STRUCTURE
-- =============================================

-- 1. WORKSPACES TABLE (Multi-tenant)
CREATE TABLE public.workspaces (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  owner_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  logo_url TEXT,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'business', 'enterprise')),
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own workspaces"
  ON public.workspaces FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert their own workspaces"
  ON public.workspaces FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own workspaces"
  ON public.workspaces FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own workspaces"
  ON public.workspaces FOR DELETE
  USING (auth.uid() = owner_id);

-- 2. WORKSPACE MEMBERS TABLE
CREATE TABLE public.workspace_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, user_id)
);

ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view workspace members"
  ON public.workspace_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = workspace_members.workspace_id
      AND wm.user_id = auth.uid()
    )
  );

CREATE POLICY "Workspace owners can manage members"
  ON public.workspace_members FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.workspaces w
      WHERE w.id = workspace_members.workspace_id
      AND w.owner_id = auth.uid()
    )
  );

-- 3. ADD WORKSPACE_ID TO EXISTING TABLES
ALTER TABLE public.instances ADD COLUMN workspace_id UUID REFERENCES public.workspaces ON DELETE CASCADE;
ALTER TABLE public.departments ADD COLUMN workspace_id UUID REFERENCES public.workspaces ON DELETE CASCADE;

-- 4. KNOWLEDGE BASE TABLE (AI Training)
CREATE TABLE public.knowledge_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces ON DELETE CASCADE,
  department_id UUID REFERENCES public.departments ON DELETE SET NULL,
  title TEXT NOT NULL,
  content TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN ('document', 'url', 'manual', 'conversation')),
  source_url TEXT,
  file_path TEXT,
  file_type TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  chunks_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view knowledge docs of their workspaces"
  ON public.knowledge_documents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = knowledge_documents.workspace_id
      AND wm.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert knowledge docs to their workspaces"
  ON public.knowledge_documents FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = knowledge_documents.workspace_id
      AND wm.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update knowledge docs of their workspaces"
  ON public.knowledge_documents FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = knowledge_documents.workspace_id
      AND wm.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete knowledge docs of their workspaces"
  ON public.knowledge_documents FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = knowledge_documents.workspace_id
      AND wm.user_id = auth.uid()
    )
  );

-- 5. KNOWLEDGE CHUNKS TABLE (For vector search)
CREATE TABLE public.knowledge_chunks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.knowledge_documents ON DELETE CASCADE,
  content TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  tokens_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view chunks of their docs"
  ON public.knowledge_chunks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.knowledge_documents kd
      JOIN public.workspace_members wm ON wm.workspace_id = kd.workspace_id
      WHERE kd.id = knowledge_chunks.document_id
      AND wm.user_id = auth.uid()
    )
  );

-- 6. PERSONAS TABLE
CREATE TABLE public.personas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces ON DELETE CASCADE,
  department_id UUID REFERENCES public.departments ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  avatar_url TEXT,
  system_prompt TEXT NOT NULL,
  voice_id TEXT,
  voice_enabled BOOLEAN DEFAULT false,
  temperature DECIMAL(2,1) DEFAULT 0.7,
  welcome_message TEXT,
  fallback_message TEXT,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.personas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view personas of their workspaces"
  ON public.personas FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = personas.workspace_id
      AND wm.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage personas of their workspaces"
  ON public.personas FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = personas.workspace_id
      AND wm.user_id = auth.uid()
      AND wm.role IN ('owner', 'admin')
    )
  );

-- 7. FLOWS TABLE
CREATE TABLE public.flows (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces ON DELETE CASCADE,
  instance_id UUID REFERENCES public.instances ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('keyword', 'first_message', 'schedule', 'webhook', 'manual')),
  trigger_value TEXT,
  is_active BOOLEAN NOT NULL DEFAULT false,
  nodes JSONB NOT NULL DEFAULT '[]',
  edges JSONB NOT NULL DEFAULT '[]',
  variables JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.flows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view flows of their workspaces"
  ON public.flows FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = flows.workspace_id
      AND wm.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage flows of their workspaces"
  ON public.flows FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = flows.workspace_id
      AND wm.user_id = auth.uid()
    )
  );

-- 8. INTEGRATIONS TABLE
CREATE TABLE public.integrations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('wapi', 'openai', 'elevenlabs', 'webhook', 'zapier', 'n8n')),
  name TEXT NOT NULL,
  config JSONB DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT false,
  last_sync_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, type)
);

ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view integrations of their workspaces"
  ON public.integrations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = integrations.workspace_id
      AND wm.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage integrations of their workspaces"
  ON public.integrations FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = integrations.workspace_id
      AND wm.user_id = auth.uid()
      AND wm.role IN ('owner', 'admin')
    )
  );

-- 9. INDEXES
CREATE INDEX idx_workspaces_owner ON public.workspaces(owner_id);
CREATE INDEX idx_workspace_members_user ON public.workspace_members(user_id);
CREATE INDEX idx_workspace_members_workspace ON public.workspace_members(workspace_id);
CREATE INDEX idx_instances_workspace ON public.instances(workspace_id);
CREATE INDEX idx_knowledge_docs_workspace ON public.knowledge_documents(workspace_id);
CREATE INDEX idx_knowledge_chunks_document ON public.knowledge_chunks(document_id);
CREATE INDEX idx_personas_workspace ON public.personas(workspace_id);
CREATE INDEX idx_flows_workspace ON public.flows(workspace_id);
CREATE INDEX idx_integrations_workspace ON public.integrations(workspace_id);

-- 10. TRIGGERS
CREATE TRIGGER update_workspaces_updated_at BEFORE UPDATE ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_knowledge_docs_updated_at BEFORE UPDATE ON public.knowledge_documents FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_personas_updated_at BEFORE UPDATE ON public.personas FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_flows_updated_at BEFORE UPDATE ON public.flows FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_integrations_updated_at BEFORE UPDATE ON public.integrations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 11. AUTO-CREATE WORKSPACE ON USER SIGNUP
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  new_workspace_id UUID;
BEGIN
  -- Create profile
  INSERT INTO public.profiles (user_id, full_name)
  VALUES (new.id, new.raw_user_meta_data ->> 'full_name');
  
  -- Create default workspace
  INSERT INTO public.workspaces (owner_id, name, slug)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data ->> 'full_name', 'Meu Workspace'),
    LOWER(REPLACE(new.id::text, '-', ''))
  )
  RETURNING id INTO new_workspace_id;
  
  -- Add owner as member
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (new_workspace_id, new.id, 'owner');
  
  RETURN new;
END;
$$;

-- 12. ENABLE REALTIME
ALTER PUBLICATION supabase_realtime ADD TABLE public.flows;
ALTER PUBLICATION supabase_realtime ADD TABLE public.knowledge_documents;
