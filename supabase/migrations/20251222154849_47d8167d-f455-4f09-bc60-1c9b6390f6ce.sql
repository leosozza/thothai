-- Create junction table for many-to-many relationship between personas and knowledge documents
CREATE TABLE public.persona_knowledge_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(persona_id, document_id)
);

-- Enable RLS
ALTER TABLE public.persona_knowledge_documents ENABLE ROW LEVEL SECURITY;

-- Policy: Users can manage persona documents of their workspaces
CREATE POLICY "Users can manage persona documents of their workspaces"
  ON public.persona_knowledge_documents FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM personas p
      JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE p.id = persona_knowledge_documents.persona_id
      AND wm.user_id = auth.uid()
    )
  );

-- Policy: Users can view persona documents of their workspaces
CREATE POLICY "Users can view persona documents of their workspaces"
  ON public.persona_knowledge_documents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM personas p
      JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE p.id = persona_knowledge_documents.persona_id
      AND wm.user_id = auth.uid()
    )
  );