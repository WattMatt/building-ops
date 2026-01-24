-- Add theme_preference column to profiles table
ALTER TABLE public.profiles 
ADD COLUMN theme_preference text DEFAULT 'system' 
CHECK (theme_preference IN ('light', 'dark', 'system'));