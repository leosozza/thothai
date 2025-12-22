-- Create calls table to store call history
CREATE TABLE public.calls (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  persona_id UUID REFERENCES public.personas(id) ON DELETE SET NULL,
  elevenlabs_conversation_id TEXT,
  elevenlabs_agent_id TEXT,
  phone_number TEXT,
  caller_name TEXT,
  direction TEXT NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound', 'outbound')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'transferred', 'failed')),
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  ended_at TIMESTAMP WITH TIME ZONE,
  duration_seconds INTEGER,
  transcript TEXT,
  summary TEXT,
  sentiment TEXT,
  human_takeover BOOLEAN DEFAULT false,
  human_takeover_at TIMESTAMP WITH TIME ZONE,
  human_takeover_by UUID,
  bitrix_activity_id TEXT,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create call_events table for real-time events
CREATE TABLE public.call_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  call_id UUID NOT NULL REFERENCES public.calls(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  role TEXT CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  metadata JSONB
);

-- Enable RLS
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_events ENABLE ROW LEVEL SECURITY;

-- RLS policies for calls
CREATE POLICY "Users can view calls in their workspace"
  ON public.calls
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members
      WHERE workspace_members.workspace_id = calls.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert calls in their workspace"
  ON public.calls
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_members
      WHERE workspace_members.workspace_id = calls.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update calls in their workspace"
  ON public.calls
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members
      WHERE workspace_members.workspace_id = calls.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );

-- RLS policies for call_events
CREATE POLICY "Users can view call events"
  ON public.call_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.calls
      JOIN public.workspace_members ON workspace_members.workspace_id = calls.workspace_id
      WHERE calls.id = call_events.call_id
      AND workspace_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert call events"
  ON public.call_events
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.calls
      JOIN public.workspace_members ON workspace_members.workspace_id = calls.workspace_id
      WHERE calls.id = call_events.call_id
      AND workspace_members.user_id = auth.uid()
    )
  );

-- Enable realtime for calls table
ALTER PUBLICATION supabase_realtime ADD TABLE public.calls;
ALTER PUBLICATION supabase_realtime ADD TABLE public.call_events;

-- Create indexes
CREATE INDEX idx_calls_workspace_id ON public.calls(workspace_id);
CREATE INDEX idx_calls_status ON public.calls(status);
CREATE INDEX idx_calls_started_at ON public.calls(started_at DESC);
CREATE INDEX idx_call_events_call_id ON public.call_events(call_id);
CREATE INDEX idx_call_events_timestamp ON public.call_events(timestamp);

-- Trigger for updated_at
CREATE TRIGGER update_calls_updated_at
  BEFORE UPDATE ON public.calls
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();