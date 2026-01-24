-- Building Assets/Equipment table
CREATE TABLE public.building_assets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  building_id UUID NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL, -- e.g., 'HVAC', 'Fire System', 'Elevator', 'Generator', 'Electrical'
  location TEXT, -- e.g., 'Basement Level 1', 'Rooftop'
  manufacturer TEXT,
  model TEXT,
  serial_number TEXT,
  installation_date DATE,
  last_service_date DATE,
  next_service_date DATE,
  status TEXT NOT NULL DEFAULT 'operational', -- 'operational', 'maintenance', 'offline', 'decommissioned'
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Building Documents table
CREATE TABLE public.building_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  building_id UUID NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  document_type TEXT NOT NULL, -- e.g., 'Certificate', 'Insurance', 'Floor Plan', 'Permit', 'Contract'
  file_url TEXT,
  expiry_date DATE,
  issue_date DATE,
  issuing_authority TEXT,
  reference_number TEXT,
  notes TEXT,
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Building Custom Checklist Items (building-specific tasks)
CREATE TABLE public.building_checklist_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  building_id UUID NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  task_name TEXT NOT NULL,
  task_description TEXT,
  frequency TEXT NOT NULL DEFAULT 'daily', -- 'daily', 'weekly', 'monthly', 'quarterly', 'annually', 'one-time'
  responsible_role TEXT NOT NULL DEFAULT 'user',
  requires_photo BOOLEAN DEFAULT false,
  requires_signature BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Building Notes/Observations table
CREATE TABLE public.building_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  building_id UUID NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT, -- e.g., 'General', 'Maintenance', 'Incident', 'Inspection'
  is_pinned BOOLEAN DEFAULT false,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.building_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.building_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.building_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.building_notes ENABLE ROW LEVEL SECURITY;

-- RLS Policies for building_assets
CREATE POLICY "Users can view assets for their buildings"
ON public.building_assets FOR SELECT
USING (has_building_access(auth.uid(), building_id));

CREATE POLICY "Admins and managers can manage assets"
ON public.building_assets FOR ALL
USING (is_admin_or_manager(auth.uid()));

-- RLS Policies for building_documents
CREATE POLICY "Users can view documents for their buildings"
ON public.building_documents FOR SELECT
USING (has_building_access(auth.uid(), building_id));

CREATE POLICY "Admins and managers can manage documents"
ON public.building_documents FOR ALL
USING (is_admin_or_manager(auth.uid()));

-- RLS Policies for building_checklist_items
CREATE POLICY "Users can view checklist items for their buildings"
ON public.building_checklist_items FOR SELECT
USING (has_building_access(auth.uid(), building_id));

CREATE POLICY "Admins and managers can manage checklist items"
ON public.building_checklist_items FOR ALL
USING (is_admin_or_manager(auth.uid()));

-- RLS Policies for building_notes
CREATE POLICY "Users can view notes for their buildings"
ON public.building_notes FOR SELECT
USING (has_building_access(auth.uid(), building_id));

CREATE POLICY "Users can create notes for their buildings"
ON public.building_notes FOR INSERT
WITH CHECK (auth.uid() = created_by AND has_building_access(auth.uid(), building_id));

CREATE POLICY "Users can update their own notes"
ON public.building_notes FOR UPDATE
USING (auth.uid() = created_by OR is_admin_or_manager(auth.uid()));

CREATE POLICY "Admins and managers can delete notes"
ON public.building_notes FOR DELETE
USING (is_admin_or_manager(auth.uid()));

-- Add indexes for performance
CREATE INDEX idx_building_assets_building_id ON public.building_assets(building_id);
CREATE INDEX idx_building_documents_building_id ON public.building_documents(building_id);
CREATE INDEX idx_building_checklist_items_building_id ON public.building_checklist_items(building_id);
CREATE INDEX idx_building_notes_building_id ON public.building_notes(building_id);

-- Add updated_at triggers
CREATE TRIGGER update_building_assets_updated_at
  BEFORE UPDATE ON public.building_assets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_building_documents_updated_at
  BEFORE UPDATE ON public.building_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_building_checklist_items_updated_at
  BEFORE UPDATE ON public.building_checklist_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_building_notes_updated_at
  BEFORE UPDATE ON public.building_notes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();