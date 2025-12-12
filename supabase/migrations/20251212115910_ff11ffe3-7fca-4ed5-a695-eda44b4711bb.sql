-- Drop problematic policies that cause infinite recursion
DROP POLICY IF EXISTS "Users can view workspace members" ON workspace_members;
DROP POLICY IF EXISTS "Users can view workspaces they belong to" ON workspaces;

-- Create security definer function to check workspace membership without recursion
CREATE OR REPLACE FUNCTION public.is_workspace_member(_user_id uuid, _workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members
    WHERE user_id = _user_id
      AND workspace_id = _workspace_id
  )
$$;

-- Create security definer function to check if user owns workspace
CREATE OR REPLACE FUNCTION public.is_workspace_owner(_user_id uuid, _workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspaces
    WHERE id = _workspace_id
      AND owner_id = _user_id
  )
$$;

-- Recreate workspace_members SELECT policy without recursion
CREATE POLICY "Users can view workspace members"
ON workspace_members FOR SELECT
USING (
  user_id = auth.uid()  -- Can see own membership records
  OR public.is_workspace_owner(auth.uid(), workspace_id)  -- Owners can see all members
);

-- Recreate workspaces SELECT policy without recursion
CREATE POLICY "Users can view workspaces they belong to"
ON workspaces FOR SELECT
USING (
  owner_id = auth.uid()  -- Owner can see their workspaces
  OR public.is_workspace_member(auth.uid(), id)  -- Members can see workspaces they belong to
);