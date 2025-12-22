-- Create batch_calls table for campaigns
CREATE TABLE public.batch_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  persona_id UUID REFERENCES public.personas(id) ON DELETE SET NULL,
  telephony_number_id UUID REFERENCES public.telephony_numbers(id) ON DELETE SET NULL,
  
  -- ElevenLabs data
  elevenlabs_batch_id TEXT,
  
  -- Campaign info
  name TEXT NOT NULL,
  description TEXT,
  
  -- Scheduling
  scheduled_time TIMESTAMPTZ,
  
  -- Statistics
  total_recipients INTEGER DEFAULT 0,
  calls_dispatched INTEGER DEFAULT 0,
  calls_completed INTEGER DEFAULT 0,
  calls_failed INTEGER DEFAULT 0,
  
  -- Status: draft, scheduled, in_progress, completed, cancelled, failed
  status TEXT DEFAULT 'draft',
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Create batch_call_recipients table
CREATE TABLE public.batch_call_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.batch_calls(id) ON DELETE CASCADE,
  
  phone_number TEXT NOT NULL,
  name TEXT,
  
  -- Personalization
  dynamic_variables JSONB DEFAULT '{}',
  first_message_override TEXT,
  
  -- ElevenLabs tracking
  elevenlabs_recipient_id TEXT,
  conversation_id TEXT,
  
  -- Status: pending, in_progress, completed, failed, no_answer
  status TEXT DEFAULT 'pending',
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  called_at TIMESTAMPTZ,
  
  -- Result
  duration_seconds INTEGER,
  result_summary TEXT
);

-- Enable RLS on batch_calls
ALTER TABLE public.batch_calls ENABLE ROW LEVEL SECURITY;

-- RLS policies for batch_calls
CREATE POLICY "Users can view batch_calls of their workspaces"
ON public.batch_calls
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = batch_calls.workspace_id
    AND wm.user_id = auth.uid()
  )
);

CREATE POLICY "Admins can manage batch_calls"
ON public.batch_calls
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = batch_calls.workspace_id
    AND wm.user_id = auth.uid()
    AND wm.role IN ('owner', 'admin')
  )
);

-- Enable RLS on batch_call_recipients
ALTER TABLE public.batch_call_recipients ENABLE ROW LEVEL SECURITY;

-- RLS policies for batch_call_recipients
CREATE POLICY "Users can view batch_call_recipients of their workspaces"
ON public.batch_call_recipients
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.batch_calls bc
    JOIN public.workspace_members wm ON wm.workspace_id = bc.workspace_id
    WHERE bc.id = batch_call_recipients.batch_id
    AND wm.user_id = auth.uid()
  )
);

CREATE POLICY "Admins can manage batch_call_recipients"
ON public.batch_call_recipients
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.batch_calls bc
    JOIN public.workspace_members wm ON wm.workspace_id = bc.workspace_id
    WHERE bc.id = batch_call_recipients.batch_id
    AND wm.user_id = auth.uid()
    AND wm.role IN ('owner', 'admin')
  )
);

-- Create indexes for performance
CREATE INDEX idx_batch_calls_workspace_id ON public.batch_calls(workspace_id);
CREATE INDEX idx_batch_calls_status ON public.batch_calls(status);
CREATE INDEX idx_batch_call_recipients_batch_id ON public.batch_call_recipients(batch_id);
CREATE INDEX idx_batch_call_recipients_status ON public.batch_call_recipients(status);

-- Enable realtime for batch_calls
ALTER PUBLICATION supabase_realtime ADD TABLE public.batch_calls;
ALTER PUBLICATION supabase_realtime ADD TABLE public.batch_call_recipients;