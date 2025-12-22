-- Criar tabela para regras de transferência de chamadas
CREATE TABLE public.telephony_transfer_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  persona_id uuid REFERENCES public.personas(id) ON DELETE CASCADE,
  name text NOT NULL,
  destination_type text NOT NULL CHECK (destination_type IN ('phone', 'sip_uri')),
  destination text NOT NULL,
  condition text NOT NULL,
  transfer_type text NOT NULL DEFAULT 'conference' CHECK (transfer_type IN ('conference', 'sip_refer', 'warm')),
  priority integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Índices
CREATE INDEX idx_telephony_transfer_rules_workspace ON public.telephony_transfer_rules(workspace_id);
CREATE INDEX idx_telephony_transfer_rules_persona ON public.telephony_transfer_rules(persona_id);

-- RLS
ALTER TABLE public.telephony_transfer_rules ENABLE ROW LEVEL SECURITY;

-- Políticas
CREATE POLICY "Users can view transfer rules of their workspaces"
ON public.telephony_transfer_rules FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.workspace_members wm
  WHERE wm.workspace_id = telephony_transfer_rules.workspace_id
  AND wm.user_id = auth.uid()
));

CREATE POLICY "Admins can manage transfer rules"
ON public.telephony_transfer_rules FOR ALL
USING (EXISTS (
  SELECT 1 FROM public.workspace_members wm
  WHERE wm.workspace_id = telephony_transfer_rules.workspace_id
  AND wm.user_id = auth.uid()
  AND wm.role IN ('owner', 'admin')
));

-- Trigger para updated_at
CREATE TRIGGER update_telephony_transfer_rules_updated_at
BEFORE UPDATE ON public.telephony_transfer_rules
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();