-- Fix security: Restrict organization data to authenticated users only
-- Currently the "Public can view organization branding" policy exposes email, phone, and address

-- Drop the overly permissive public policy
DROP POLICY IF EXISTS "Public can view organization branding" ON public.organizations;

-- Create a new policy that only allows authenticated users to view organization data
CREATE POLICY "Authenticated users can view organization" 
ON public.organizations 
FOR SELECT 
TO authenticated 
USING (true);

-- Note: The existing policies for admins/managers to manage organizations remain intact