-- Building Tenants table
CREATE TABLE public.building_tenants (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  building_id UUID NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  shop_number TEXT NOT NULL,
  shop_name TEXT NOT NULL,
  area TEXT, -- e.g., 'Ground Floor', '150 sqm'
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  lease_start_date DATE,
  lease_end_date DATE,
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Tenant Documents table
CREATE TABLE public.tenant_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.building_tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  document_type TEXT NOT NULL, -- 'lease_agreement', 'utility_account', 'electrical_coc', 'handover_document', 'other'
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER,
  expiry_date DATE,
  issue_date DATE,
  notes TEXT,
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.building_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_documents ENABLE ROW LEVEL SECURITY;

-- RLS Policies for building_tenants
CREATE POLICY "Users can view tenants for their buildings"
ON public.building_tenants FOR SELECT
USING (has_building_access(auth.uid(), building_id));

CREATE POLICY "Admins and managers can manage tenants"
ON public.building_tenants FOR ALL
USING (is_admin_or_manager(auth.uid()));

-- RLS Policies for tenant_documents (need to check building access via tenant)
CREATE OR REPLACE FUNCTION public.has_tenant_access(_user_id UUID, _tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.building_tenants bt
    WHERE bt.id = _tenant_id
      AND has_building_access(_user_id, bt.building_id)
  )
$$;

CREATE POLICY "Users can view documents for tenants in their buildings"
ON public.tenant_documents FOR SELECT
USING (has_tenant_access(auth.uid(), tenant_id));

CREATE POLICY "Admins and managers can manage tenant documents"
ON public.tenant_documents FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.building_tenants bt
    WHERE bt.id = tenant_id
    AND is_admin_or_manager(auth.uid())
  )
);

-- Add indexes for performance
CREATE INDEX idx_building_tenants_building_id ON public.building_tenants(building_id);
CREATE INDEX idx_tenant_documents_tenant_id ON public.tenant_documents(tenant_id);

-- Add updated_at triggers
CREATE TRIGGER update_building_tenants_updated_at
  BEFORE UPDATE ON public.building_tenants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_tenant_documents_updated_at
  BEFORE UPDATE ON public.tenant_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Create storage bucket for tenant documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('tenant-documents', 'tenant-documents', false);

-- Storage policies for tenant documents bucket
CREATE POLICY "Authenticated users can upload tenant documents"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'tenant-documents');

CREATE POLICY "Users can view tenant documents they have access to"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'tenant-documents');

CREATE POLICY "Admins and managers can delete tenant documents"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'tenant-documents' AND is_admin_or_manager(auth.uid()));