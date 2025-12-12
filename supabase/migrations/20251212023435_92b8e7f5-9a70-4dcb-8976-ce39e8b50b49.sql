
-- =============================================
-- THOTH.AI - DATABASE STRUCTURE
-- =============================================

-- 1. PROFILES TABLE (User profiles)
CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  company_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = user_id);

-- Trigger for auto-creating profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name)
  VALUES (new.id, new.raw_user_meta_data ->> 'full_name');
  RETURN new;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. WHATSAPP INSTANCES TABLE
CREATE TABLE public.instances (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone_number TEXT,
  instance_key TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'connecting', 'qr_pending')),
  qr_code TEXT,
  profile_picture_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own instances"
  ON public.instances FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own instances"
  ON public.instances FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own instances"
  ON public.instances FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own instances"
  ON public.instances FOR DELETE
  USING (auth.uid() = user_id);

-- 3. CONTACTS TABLE
CREATE TABLE public.contacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  instance_id UUID NOT NULL REFERENCES public.instances ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  name TEXT,
  push_name TEXT,
  profile_picture_url TEXT,
  tags TEXT[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(instance_id, phone_number)
);

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view contacts of their instances"
  ON public.contacts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.instances
      WHERE instances.id = contacts.instance_id
      AND instances.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert contacts to their instances"
  ON public.contacts FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.instances
      WHERE instances.id = contacts.instance_id
      AND instances.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update contacts of their instances"
  ON public.contacts FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.instances
      WHERE instances.id = contacts.instance_id
      AND instances.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete contacts of their instances"
  ON public.contacts FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.instances
      WHERE instances.id = contacts.instance_id
      AND instances.user_id = auth.uid()
    )
  );

-- 4. CONVERSATIONS TABLE
CREATE TABLE public.conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  instance_id UUID NOT NULL REFERENCES public.instances ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'pending')),
  last_message_at TIMESTAMP WITH TIME ZONE,
  unread_count INTEGER NOT NULL DEFAULT 0,
  assigned_to TEXT,
  department TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(instance_id, contact_id)
);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view conversations of their instances"
  ON public.conversations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.instances
      WHERE instances.id = conversations.instance_id
      AND instances.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert conversations to their instances"
  ON public.conversations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.instances
      WHERE instances.id = conversations.instance_id
      AND instances.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update conversations of their instances"
  ON public.conversations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.instances
      WHERE instances.id = conversations.instance_id
      AND instances.user_id = auth.uid()
    )
  );

-- 5. MESSAGES TABLE
CREATE TABLE public.messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.conversations ON DELETE CASCADE,
  instance_id UUID NOT NULL REFERENCES public.instances ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'audio', 'video', 'document', 'sticker', 'location')),
  content TEXT,
  media_url TEXT,
  media_mime_type TEXT,
  audio_transcription TEXT,
  whatsapp_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed')),
  is_from_bot BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view messages of their instances"
  ON public.messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.instances
      WHERE instances.id = messages.instance_id
      AND instances.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert messages to their instances"
  ON public.messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.instances
      WHERE instances.id = messages.instance_id
      AND instances.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update messages of their instances"
  ON public.messages FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.instances
      WHERE instances.id = messages.instance_id
      AND instances.user_id = auth.uid()
    )
  );

-- 6. DEPARTMENTS TABLE
CREATE TABLE public.departments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#6366f1',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own departments"
  ON public.departments FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own departments"
  ON public.departments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own departments"
  ON public.departments FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own departments"
  ON public.departments FOR DELETE
  USING (auth.uid() = user_id);

-- 7. BOT SETTINGS TABLE
CREATE TABLE public.bot_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  instance_id UUID NOT NULL REFERENCES public.instances ON DELETE CASCADE,
  department_id UUID REFERENCES public.departments ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  persona_name TEXT DEFAULT 'Assistente',
  persona_description TEXT,
  welcome_message TEXT,
  fallback_message TEXT,
  voice_enabled BOOLEAN NOT NULL DEFAULT false,
  voice_id TEXT,
  system_prompt TEXT,
  temperature DECIMAL(2,1) DEFAULT 0.7,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(instance_id, department_id)
);

ALTER TABLE public.bot_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view bot settings of their instances"
  ON public.bot_settings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.instances
      WHERE instances.id = bot_settings.instance_id
      AND instances.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert bot settings to their instances"
  ON public.bot_settings FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.instances
      WHERE instances.id = bot_settings.instance_id
      AND instances.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update bot settings of their instances"
  ON public.bot_settings FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.instances
      WHERE instances.id = bot_settings.instance_id
      AND instances.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete bot settings of their instances"
  ON public.bot_settings FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.instances
      WHERE instances.id = bot_settings.instance_id
      AND instances.user_id = auth.uid()
    )
  );

-- 8. UPDATED_AT TRIGGER FUNCTION
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_instances_updated_at BEFORE UPDATE ON public.instances FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_contacts_updated_at BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_departments_updated_at BEFORE UPDATE ON public.departments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_bot_settings_updated_at BEFORE UPDATE ON public.bot_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 9. INDEXES FOR PERFORMANCE
CREATE INDEX idx_instances_user_id ON public.instances(user_id);
CREATE INDEX idx_contacts_instance_id ON public.contacts(instance_id);
CREATE INDEX idx_conversations_instance_id ON public.conversations(instance_id);
CREATE INDEX idx_conversations_last_message ON public.conversations(last_message_at DESC);
CREATE INDEX idx_messages_conversation_id ON public.messages(conversation_id);
CREATE INDEX idx_messages_created_at ON public.messages(created_at DESC);
CREATE INDEX idx_departments_user_id ON public.departments(user_id);

-- 10. ENABLE REALTIME FOR KEY TABLES
ALTER PUBLICATION supabase_realtime ADD TABLE public.instances;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
