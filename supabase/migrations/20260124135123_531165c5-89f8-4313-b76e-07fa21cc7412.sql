-- Add photo_urls column to form_submissions table for storing evidence images
ALTER TABLE public.form_submissions 
ADD COLUMN IF NOT EXISTS photo_urls TEXT[] DEFAULT '{}'::text[];