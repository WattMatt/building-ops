-- Create storage bucket for building logos
INSERT INTO storage.buckets (id, name, public)
VALUES ('building-logos', 'building-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Allow admins and managers to upload building logos
CREATE POLICY "Admins and managers can upload building logos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'building-logos' AND
  is_admin_or_manager(auth.uid())
);

-- Allow admins and managers to update building logos
CREATE POLICY "Admins and managers can update building logos"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'building-logos' AND
  is_admin_or_manager(auth.uid())
);

-- Allow admins and managers to delete building logos
CREATE POLICY "Admins and managers can delete building logos"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'building-logos' AND
  is_admin_or_manager(auth.uid())
);

-- Allow public to view building logos
CREATE POLICY "Public can view building logos"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'building-logos');