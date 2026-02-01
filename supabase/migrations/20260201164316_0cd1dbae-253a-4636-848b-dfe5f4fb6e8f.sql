-- Create a dedicated storage bucket for issue photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('issue-photos', 'issue-photos', true);

-- Allow authenticated users to upload issue photos
CREATE POLICY "Authenticated users can upload issue photos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'issue-photos');

-- Allow public read access to issue photos
CREATE POLICY "Issue photos are publicly accessible"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'issue-photos');

-- Allow users to update their own uploaded issue photos
CREATE POLICY "Users can update their own issue photos"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'issue-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Allow users to delete their own uploaded issue photos
CREATE POLICY "Users can delete their own issue photos"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'issue-photos' AND auth.uid()::text = (storage.foldername(name))[1]);