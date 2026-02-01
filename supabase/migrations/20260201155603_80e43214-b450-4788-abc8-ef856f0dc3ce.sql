-- Add logo_position column to buildings table
ALTER TABLE public.buildings 
ADD COLUMN logo_position text DEFAULT 'top-left';

-- Add comment for documentation
COMMENT ON COLUMN public.buildings.logo_position IS 'Position of the logo in building cards: top-left, top-right, center';