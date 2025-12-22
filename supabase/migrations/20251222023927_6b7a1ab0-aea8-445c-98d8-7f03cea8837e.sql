-- Create storage bucket for knowledge documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('knowledge-documents', 'knowledge-documents', false)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for knowledge-documents bucket
CREATE POLICY "Users can upload documents to their workspace folder"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'knowledge-documents' AND
  EXISTS (
    SELECT 1 FROM workspace_members wm
    WHERE wm.workspace_id::text = (storage.foldername(name))[1]
    AND wm.user_id = auth.uid()
  )
);

CREATE POLICY "Users can view documents from their workspace"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'knowledge-documents' AND
  EXISTS (
    SELECT 1 FROM workspace_members wm
    WHERE wm.workspace_id::text = (storage.foldername(name))[1]
    AND wm.user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete documents from their workspace"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'knowledge-documents' AND
  EXISTS (
    SELECT 1 FROM workspace_members wm
    WHERE wm.workspace_id::text = (storage.foldername(name))[1]
    AND wm.user_id = auth.uid()
  )
);