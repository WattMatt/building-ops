-- Add new JSONB columns for building details

-- Electrical supply authority contact
ALTER TABLE public.buildings 
ADD COLUMN IF NOT EXISTS electrical_authority jsonb DEFAULT NULL;

-- Council contact details
ALTER TABLE public.buildings 
ADD COLUMN IF NOT EXISTS council_details jsonb DEFAULT NULL;

-- Professional team contacts (architects, engineers, etc.)
ALTER TABLE public.buildings 
ADD COLUMN IF NOT EXISTS professional_team jsonb DEFAULT NULL;

-- Meter reading company contact
ALTER TABLE public.buildings 
ADD COLUMN IF NOT EXISTS meter_reading_company jsonb DEFAULT NULL;

-- Bulk tariff structures for utilities
ALTER TABLE public.buildings 
ADD COLUMN IF NOT EXISTS utility_tariffs jsonb DEFAULT NULL;

-- Add comments for documentation
COMMENT ON COLUMN public.buildings.electrical_authority IS 'Electrical supply authority contact details (name, phone, email, account_number)';
COMMENT ON COLUMN public.buildings.council_details IS 'Council contact details (name, phone, email, ward_number)';
COMMENT ON COLUMN public.buildings.professional_team IS 'Professional team contacts (architect, civil_engineer, structural_engineer, electrical_engineer, wet_services_engineer)';
COMMENT ON COLUMN public.buildings.meter_reading_company IS 'Meter reading company contact details (name, phone, email, contract_number)';
COMMENT ON COLUMN public.buildings.utility_tariffs IS 'Bulk tariff structures for utilities (water, electricity)';