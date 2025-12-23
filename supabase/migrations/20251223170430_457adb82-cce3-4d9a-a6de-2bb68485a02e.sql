-- ============================================
-- MULTI-TENANT FIX: Update RLS policies to use workspace_id
-- ============================================

-- 1. Drop existing policies on instances
DROP POLICY IF EXISTS "Users can delete their own instances" ON public.instances;
DROP POLICY IF EXISTS "Users can insert their own instances" ON public.instances;
DROP POLICY IF EXISTS "Users can update their own instances" ON public.instances;
DROP POLICY IF EXISTS "Users can view their own instances" ON public.instances;

-- Create new workspace-based policies for instances
CREATE POLICY "Workspace members can view instances"
ON public.instances FOR SELECT
USING (
  is_workspace_member(auth.uid(), workspace_id)
  OR (workspace_id IS NULL AND user_id = auth.uid())
);

CREATE POLICY "Workspace admins can insert instances"
ON public.instances FOR INSERT
WITH CHECK (
  (workspace_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM workspace_members wm
    WHERE wm.workspace_id = instances.workspace_id
    AND wm.user_id = auth.uid()
    AND wm.role IN ('owner', 'admin')
  ))
  OR (workspace_id IS NULL AND user_id = auth.uid())
);

CREATE POLICY "Workspace admins can update instances"
ON public.instances FOR UPDATE
USING (
  is_workspace_member(auth.uid(), workspace_id)
  OR (workspace_id IS NULL AND user_id = auth.uid())
);

CREATE POLICY "Workspace admins can delete instances"
ON public.instances FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM workspace_members wm
    WHERE wm.workspace_id = instances.workspace_id
    AND wm.user_id = auth.uid()
    AND wm.role IN ('owner', 'admin')
  )
  OR (workspace_id IS NULL AND user_id = auth.uid())
);

-- 2. Drop existing policies on contacts
DROP POLICY IF EXISTS "Users can delete contacts of their instances" ON public.contacts;
DROP POLICY IF EXISTS "Users can insert contacts to their instances" ON public.contacts;
DROP POLICY IF EXISTS "Users can update contacts of their instances" ON public.contacts;
DROP POLICY IF EXISTS "Users can view contacts of their instances" ON public.contacts;

-- Create new workspace-based policies for contacts
CREATE POLICY "Workspace members can view contacts"
ON public.contacts FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM instances i
    WHERE i.id = contacts.instance_id
    AND is_workspace_member(auth.uid(), i.workspace_id)
  )
);

CREATE POLICY "Workspace members can insert contacts"
ON public.contacts FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM instances i
    WHERE i.id = contacts.instance_id
    AND is_workspace_member(auth.uid(), i.workspace_id)
  )
);

CREATE POLICY "Workspace members can update contacts"
ON public.contacts FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM instances i
    WHERE i.id = contacts.instance_id
    AND is_workspace_member(auth.uid(), i.workspace_id)
  )
);

CREATE POLICY "Workspace admins can delete contacts"
ON public.contacts FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM instances i
    JOIN workspace_members wm ON wm.workspace_id = i.workspace_id
    WHERE i.id = contacts.instance_id
    AND wm.user_id = auth.uid()
    AND wm.role IN ('owner', 'admin')
  )
);

-- 3. Drop existing policies on conversations
DROP POLICY IF EXISTS "Users can insert conversations to their instances" ON public.conversations;
DROP POLICY IF EXISTS "Users can update conversations of their instances" ON public.conversations;
DROP POLICY IF EXISTS "Users can view conversations of their instances" ON public.conversations;

-- Create new workspace-based policies for conversations
CREATE POLICY "Workspace members can view conversations"
ON public.conversations FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM instances i
    WHERE i.id = conversations.instance_id
    AND is_workspace_member(auth.uid(), i.workspace_id)
  )
);

CREATE POLICY "Workspace members can insert conversations"
ON public.conversations FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM instances i
    WHERE i.id = conversations.instance_id
    AND is_workspace_member(auth.uid(), i.workspace_id)
  )
);

CREATE POLICY "Workspace members can update conversations"
ON public.conversations FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM instances i
    WHERE i.id = conversations.instance_id
    AND is_workspace_member(auth.uid(), i.workspace_id)
  )
);

-- 4. Drop existing policies on messages
DROP POLICY IF EXISTS "Users can insert messages to their instances" ON public.messages;
DROP POLICY IF EXISTS "Users can update messages of their instances" ON public.messages;
DROP POLICY IF EXISTS "Users can view messages of their instances" ON public.messages;

-- Create new workspace-based policies for messages
CREATE POLICY "Workspace members can view messages"
ON public.messages FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM instances i
    WHERE i.id = messages.instance_id
    AND is_workspace_member(auth.uid(), i.workspace_id)
  )
);

CREATE POLICY "Workspace members can insert messages"
ON public.messages FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM instances i
    WHERE i.id = messages.instance_id
    AND is_workspace_member(auth.uid(), i.workspace_id)
  )
);

CREATE POLICY "Workspace members can update messages"
ON public.messages FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM instances i
    WHERE i.id = messages.instance_id
    AND is_workspace_member(auth.uid(), i.workspace_id)
  )
);

-- 5. Drop existing policies on bot_settings
DROP POLICY IF EXISTS "Users can delete bot settings of their instances" ON public.bot_settings;
DROP POLICY IF EXISTS "Users can insert bot settings to their instances" ON public.bot_settings;
DROP POLICY IF EXISTS "Users can update bot settings of their instances" ON public.bot_settings;
DROP POLICY IF EXISTS "Users can view bot settings of their instances" ON public.bot_settings;

-- Create new workspace-based policies for bot_settings
CREATE POLICY "Workspace members can view bot_settings"
ON public.bot_settings FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM instances i
    WHERE i.id = bot_settings.instance_id
    AND is_workspace_member(auth.uid(), i.workspace_id)
  )
);

CREATE POLICY "Workspace admins can insert bot_settings"
ON public.bot_settings FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM instances i
    JOIN workspace_members wm ON wm.workspace_id = i.workspace_id
    WHERE i.id = bot_settings.instance_id
    AND wm.user_id = auth.uid()
    AND wm.role IN ('owner', 'admin')
  )
);

CREATE POLICY "Workspace admins can update bot_settings"
ON public.bot_settings FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM instances i
    JOIN workspace_members wm ON wm.workspace_id = i.workspace_id
    WHERE i.id = bot_settings.instance_id
    AND wm.user_id = auth.uid()
    AND wm.role IN ('owner', 'admin')
  )
);

CREATE POLICY "Workspace admins can delete bot_settings"
ON public.bot_settings FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM instances i
    JOIN workspace_members wm ON wm.workspace_id = i.workspace_id
    WHERE i.id = bot_settings.instance_id
    AND wm.user_id = auth.uid()
    AND wm.role IN ('owner', 'admin')
  )
);

-- 6. Drop existing policies on departments
DROP POLICY IF EXISTS "Users can delete their own departments" ON public.departments;
DROP POLICY IF EXISTS "Users can insert their own departments" ON public.departments;
DROP POLICY IF EXISTS "Users can update their own departments" ON public.departments;
DROP POLICY IF EXISTS "Users can view their own departments" ON public.departments;

-- Create new workspace-based policies for departments
CREATE POLICY "Workspace members can view departments"
ON public.departments FOR SELECT
USING (
  is_workspace_member(auth.uid(), workspace_id)
  OR (workspace_id IS NULL AND user_id = auth.uid())
);

CREATE POLICY "Workspace admins can insert departments"
ON public.departments FOR INSERT
WITH CHECK (
  (workspace_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM workspace_members wm
    WHERE wm.workspace_id = departments.workspace_id
    AND wm.user_id = auth.uid()
    AND wm.role IN ('owner', 'admin')
  ))
  OR (workspace_id IS NULL AND user_id = auth.uid())
);

CREATE POLICY "Workspace admins can update departments"
ON public.departments FOR UPDATE
USING (
  (workspace_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM workspace_members wm
    WHERE wm.workspace_id = departments.workspace_id
    AND wm.user_id = auth.uid()
    AND wm.role IN ('owner', 'admin')
  ))
  OR (workspace_id IS NULL AND user_id = auth.uid())
);

CREATE POLICY "Workspace admins can delete departments"
ON public.departments FOR DELETE
USING (
  (workspace_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM workspace_members wm
    WHERE wm.workspace_id = departments.workspace_id
    AND wm.user_id = auth.uid()
    AND wm.role IN ('owner', 'admin')
  ))
  OR (workspace_id IS NULL AND user_id = auth.uid())
);

-- 7. Add policy for bitrix_event_queue (internal queue - service role only)
-- This table should only be accessed by service role, not regular users
CREATE POLICY "Service role only access"
ON public.bitrix_event_queue FOR ALL
USING (false)
WITH CHECK (false);