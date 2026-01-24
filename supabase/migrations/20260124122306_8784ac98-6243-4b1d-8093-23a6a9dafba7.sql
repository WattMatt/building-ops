-- Allow public (unauthenticated) users to view organization branding for login page
CREATE POLICY "Public can view organization branding"
ON public.organizations
FOR SELECT
TO anon
USING (true);