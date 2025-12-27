-- Add recording_url column to calls table
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS recording_url text;

-- Create storage bucket for call recordings
INSERT INTO storage.buckets (id, name, public)
VALUES ('call-recordings', 'call-recordings', true)
ON CONFLICT (id) DO NOTHING;

-- Create storage policies for call recordings
CREATE POLICY "Anyone can view call recordings"
ON storage.objects FOR SELECT
USING (bucket_id = 'call-recordings');

CREATE POLICY "Service role can upload call recordings"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'call-recordings');

CREATE POLICY "Service role can update call recordings"
ON storage.objects FOR UPDATE
USING (bucket_id = 'call-recordings');

CREATE POLICY "Service role can delete call recordings"
ON storage.objects FOR DELETE
USING (bucket_id = 'call-recordings');