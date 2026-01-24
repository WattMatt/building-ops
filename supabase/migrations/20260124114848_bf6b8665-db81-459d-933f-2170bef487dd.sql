-- Create storage bucket for organization logos
INSERT INTO storage.buckets (id, name, public)
VALUES ('organization-logos', 'organization-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload logos
CREATE POLICY "Admins can upload organization logos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'organization-logos' 
  AND public.has_role(auth.uid(), 'admin')
);

-- Allow public read access for logos
CREATE POLICY "Organization logos are publicly accessible"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'organization-logos');

-- Allow admins to update logos
CREATE POLICY "Admins can update organization logos"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'organization-logos' 
  AND public.has_role(auth.uid(), 'admin')
);

-- Allow admins to delete logos
CREATE POLICY "Admins can delete organization logos"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'organization-logos' 
  AND public.has_role(auth.uid(), 'admin')
);