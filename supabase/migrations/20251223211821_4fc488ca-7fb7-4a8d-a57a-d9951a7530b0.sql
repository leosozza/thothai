-- Níveis de acesso do operador
CREATE TYPE operator_access_level AS ENUM ('own', 'department', 'all');

-- Tabela de operadores
CREATE TABLE operators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE NOT NULL,
  
  -- Vínculo opcional com Bitrix24
  bitrix24_user_id INTEGER,
  bitrix24_department_ids INTEGER[] DEFAULT '{}',
  
  -- Permissões de acesso
  access_level operator_access_level DEFAULT 'own',
  
  -- Departamentos locais que pode atender
  department_ids UUID[] DEFAULT '{}',
  
  -- Instâncias que pode ver (NULL = todas do workspace)
  allowed_instance_ids UUID[],
  
  -- Configurações
  can_transfer_to_ai BOOLEAN DEFAULT true,
  max_concurrent_conversations INTEGER DEFAULT 10,
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  is_online BOOLEAN DEFAULT false,
  last_seen_at TIMESTAMPTZ,
  
  -- Metadata
  display_name TEXT,
  avatar_url TEXT,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(user_id, workspace_id)
);

-- Índices para performance
CREATE INDEX idx_operators_workspace ON operators(workspace_id);
CREATE INDEX idx_operators_user ON operators(user_id);
CREATE INDEX idx_operators_bitrix ON operators(bitrix24_user_id) WHERE bitrix24_user_id IS NOT NULL;
CREATE INDEX idx_operators_active ON operators(workspace_id, is_active) WHERE is_active = true;

-- Habilitar RLS
ALTER TABLE operators ENABLE ROW LEVEL SECURITY;

-- RLS: Admins/Owners podem gerenciar operadores
CREATE POLICY "Admins can manage operators"
ON operators FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM workspace_members wm
    WHERE wm.workspace_id = operators.workspace_id 
    AND wm.user_id = auth.uid() 
    AND wm.role IN ('owner', 'admin')
  )
);

-- RLS: Operadores podem ver seus próprios dados
CREATE POLICY "Operators can view own record"
ON operators FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- RLS: Operadores podem atualizar seu status online
CREATE POLICY "Operators can update own status"
ON operators FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Adicionar coluna assigned_operator_id à conversations (ADITIVO)
ALTER TABLE conversations 
  ADD COLUMN IF NOT EXISTS assigned_operator_id UUID REFERENCES operators(id);

-- Índice para performance
CREATE INDEX IF NOT EXISTS idx_conversations_operator 
  ON conversations(assigned_operator_id) WHERE assigned_operator_id IS NOT NULL;

-- Função helper para verificar acesso do operador
CREATE OR REPLACE FUNCTION can_operator_access_conversation(
  _user_id UUID, 
  _conversation_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _operator operators%ROWTYPE;
  _conversation conversations%ROWTYPE;
  _instance instances%ROWTYPE;
BEGIN
  -- Buscar operador ativo
  SELECT * INTO _operator FROM operators 
  WHERE user_id = _user_id AND is_active = true
  LIMIT 1;
  
  -- Se não é operador, retorna false (admin/owner usa outra policy)
  IF NOT FOUND THEN RETURN false; END IF;
  
  -- Buscar conversa
  SELECT * INTO _conversation FROM conversations 
  WHERE id = _conversation_id;
  IF NOT FOUND THEN RETURN false; END IF;
  
  -- Buscar instância para verificar workspace
  SELECT * INTO _instance FROM instances 
  WHERE id = _conversation.instance_id;
  IF NOT FOUND THEN RETURN false; END IF;
  
  -- Verificar se operador pertence ao mesmo workspace
  IF _operator.workspace_id != _instance.workspace_id THEN 
    RETURN false; 
  END IF;
  
  -- Se tem acesso total ('all'), pode ver tudo do workspace
  IF _operator.access_level = 'all' THEN RETURN true; END IF;
  
  -- Se conversa está atribuída ao operador, pode ver
  IF _conversation.assigned_operator_id = _operator.id THEN 
    RETURN true; 
  END IF;
  
  -- Se acesso é 'own', só pode ver suas atribuídas
  IF _operator.access_level = 'own' THEN RETURN false; END IF;
  
  -- Para 'department', verificar se conversa está no departamento do operador
  IF _operator.access_level = 'department' THEN
    IF array_length(_operator.department_ids, 1) > 0 THEN
      IF _conversation.department IS NOT NULL THEN
        RETURN EXISTS (
          SELECT 1 FROM departments d
          WHERE d.id = ANY(_operator.department_ids)
            AND d.name = _conversation.department
        );
      END IF;
    END IF;
    RETURN false;
  END IF;
  
  RETURN false;
END;
$$;

-- Nova policy ADICIONAL para operadores verem conversas
CREATE POLICY "Operators can view assigned conversations"
ON conversations FOR SELECT
TO authenticated
USING (
  can_operator_access_conversation(auth.uid(), id)
);

-- Policy para operadores poderem atualizar conversas atribuídas
CREATE POLICY "Operators can update assigned conversations"
ON conversations FOR UPDATE
TO authenticated
USING (
  can_operator_access_conversation(auth.uid(), id)
);

-- Trigger para atualizar updated_at
CREATE TRIGGER update_operators_updated_at
BEFORE UPDATE ON operators
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Habilitar realtime para operators (status online)
ALTER PUBLICATION supabase_realtime ADD TABLE operators;