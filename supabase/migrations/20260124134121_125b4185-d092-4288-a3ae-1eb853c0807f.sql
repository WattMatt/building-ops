-- Create a table for form submissions
CREATE TABLE public.form_submissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  form_template_id TEXT NOT NULL,
  form_name TEXT NOT NULL,
  building_id UUID REFERENCES public.buildings(id) ON DELETE SET NULL,
  submitted_by UUID NOT NULL,
  form_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'submitted',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.form_submissions ENABLE ROW LEVEL SECURITY;

-- Create policies for form submissions
CREATE POLICY "Users can view form submissions for their buildings"
ON public.form_submissions
FOR SELECT
USING (
  submitted_by = auth.uid() 
  OR (building_id IS NOT NULL AND has_building_access(auth.uid(), building_id))
  OR is_admin_or_manager(auth.uid())
);

CREATE POLICY "Users can create form submissions"
ON public.form_submissions
FOR INSERT
WITH CHECK (auth.uid() = submitted_by);

CREATE POLICY "Users can update their own submissions"
ON public.form_submissions
FOR UPDATE
USING (submitted_by = auth.uid() OR is_admin_or_manager(auth.uid()));

CREATE POLICY "Admins can delete submissions"
ON public.form_submissions
FOR DELETE
USING (is_admin_or_manager(auth.uid()));

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_form_submissions_updated_at
BEFORE UPDATE ON public.form_submissions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add index for faster queries
CREATE INDEX idx_form_submissions_building ON public.form_submissions(building_id);
CREATE INDEX idx_form_submissions_submitted_by ON public.form_submissions(submitted_by);
CREATE INDEX idx_form_submissions_form_template ON public.form_submissions(form_template_id);