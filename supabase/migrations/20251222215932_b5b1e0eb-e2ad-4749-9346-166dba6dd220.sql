-- Create telephony_providers table
CREATE TABLE public.telephony_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider_type text NOT NULL CHECK (provider_type IN ('wavoip', 'twilio', 'telnyx')),
  name text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create telephony_numbers table
CREATE TABLE public.telephony_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.telephony_providers(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  phone_number text NOT NULL,
  friendly_name text,
  persona_id uuid REFERENCES public.personas(id) ON DELETE SET NULL,
  elevenlabs_agent_id text,
  is_active boolean DEFAULT true,
  capabilities jsonb DEFAULT '{"voice": true, "sms": false}',
  provider_number_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.telephony_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telephony_numbers ENABLE ROW LEVEL SECURITY;

-- RLS Policies for telephony_providers
CREATE POLICY "Users can view telephony_providers of their workspaces"
  ON public.telephony_providers FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.workspace_members wm 
    WHERE wm.workspace_id = telephony_providers.workspace_id 
    AND wm.user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage telephony_providers"
  ON public.telephony_providers FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.workspace_members wm 
    WHERE wm.workspace_id = telephony_providers.workspace_id 
    AND wm.user_id = auth.uid()
    AND wm.role IN ('owner', 'admin')
  ));

-- RLS Policies for telephony_numbers
CREATE POLICY "Users can view telephony_numbers of their workspaces"
  ON public.telephony_numbers FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.workspace_members wm 
    WHERE wm.workspace_id = telephony_numbers.workspace_id 
    AND wm.user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage telephony_numbers"
  ON public.telephony_numbers FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.workspace_members wm 
    WHERE wm.workspace_id = telephony_numbers.workspace_id 
    AND wm.user_id = auth.uid()
    AND wm.role IN ('owner', 'admin')
  ));

-- Create indexes for performance
CREATE INDEX idx_telephony_providers_workspace ON public.telephony_providers(workspace_id);
CREATE INDEX idx_telephony_numbers_workspace ON public.telephony_numbers(workspace_id);
CREATE INDEX idx_telephony_numbers_provider ON public.telephony_numbers(provider_id);
CREATE INDEX idx_telephony_numbers_persona ON public.telephony_numbers(persona_id);

-- Add updated_at trigger
CREATE TRIGGER update_telephony_providers_updated_at
  BEFORE UPDATE ON public.telephony_providers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_telephony_numbers_updated_at
  BEFORE UPDATE ON public.telephony_numbers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();