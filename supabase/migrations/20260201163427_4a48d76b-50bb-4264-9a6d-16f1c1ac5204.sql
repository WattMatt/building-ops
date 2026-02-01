-- Add avatar_color column to buildings table for custom avatar colors
ALTER TABLE public.buildings 
ADD COLUMN avatar_color text DEFAULT NULL;