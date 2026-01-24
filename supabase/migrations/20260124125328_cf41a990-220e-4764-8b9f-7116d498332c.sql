-- Add responsible_party field to template_items for descriptive party names
ALTER TABLE public.template_items 
ADD COLUMN IF NOT EXISTS responsible_party text DEFAULT 'Operations';

-- Add comment
COMMENT ON COLUMN public.template_items.responsible_party IS 'Descriptive name of the responsible party (e.g., Cleaning Staff, Maintenance, Security)';