-- Update the assets bucket to allow audio files by updating allowed_mime_types
-- First, let's update the bucket configuration
UPDATE storage.buckets 
SET allowed_mime_types = ARRAY[
  'image/jpeg', 
  'image/png', 
  'image/gif', 
  'image/webp', 
  'image/svg+xml',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/ogg'
]
WHERE id = 'assets';

-- Create a policy to allow service role to upload TTS audio files
CREATE POLICY "Service role can upload TTS audio"
ON storage.objects
FOR INSERT
TO service_role
WITH CHECK (bucket_id = 'assets' AND (storage.foldername(name))[1] = 'tts');