-- Add notification preference columns to profiles table
ALTER TABLE public.profiles 
ADD COLUMN email_notifications boolean DEFAULT true,
ADD COLUMN overdue_alerts boolean DEFAULT true,
ADD COLUMN daily_digest boolean DEFAULT false,
ADD COLUMN issue_updates boolean DEFAULT true,
ADD COLUMN task_reminders boolean DEFAULT true;