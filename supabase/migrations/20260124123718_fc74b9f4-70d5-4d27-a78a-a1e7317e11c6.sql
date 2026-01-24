-- Create asset service history table
CREATE TABLE public.asset_service_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  asset_id UUID NOT NULL REFERENCES public.building_assets(id) ON DELETE CASCADE,
  service_date DATE NOT NULL,
  service_type TEXT NOT NULL,
  description TEXT,
  performed_by TEXT,
  cost DECIMAL(10,2),
  next_service_date DATE,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.asset_service_history ENABLE ROW LEVEL SECURITY;

-- Create index for faster lookups
CREATE INDEX idx_asset_service_history_asset_id ON public.asset_service_history(asset_id);
CREATE INDEX idx_asset_service_history_service_date ON public.asset_service_history(service_date);

-- RLS Policies: Users can view service history for assets in buildings they have access to
CREATE POLICY "Users can view service history for accessible assets"
ON public.asset_service_history FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.building_assets ba
    WHERE ba.id = asset_service_history.asset_id
    AND has_building_access(auth.uid(), ba.building_id)
  )
);

-- Admins and managers can manage service history
CREATE POLICY "Admins and managers can manage service history"
ON public.asset_service_history FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.building_assets ba
    WHERE ba.id = asset_service_history.asset_id
    AND is_admin_or_manager(auth.uid())
  )
);

-- Add trigger for updated_at
CREATE TRIGGER update_asset_service_history_updated_at
BEFORE UPDATE ON public.asset_service_history
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();