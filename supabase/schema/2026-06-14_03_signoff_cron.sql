-- 2026-06-14_03_signoff_cron.sql
-- Daily schedule for the signoff-reminders edge function (reminders + escalation + expiry).
-- Apply to STAGING first; PROD on owner sign-off.
--
-- PREREQUISITES (owner):
--   1. Enable the pg_cron and pg_net extensions on the project (Dashboard -> Database -> Extensions).
--   2. Set a Supabase secret SIGNOFF_REMINDERS_SECRET (a long random string) and deploy the
--      signoff-reminders function with it available.
--   3. Replace <PROJECT_REF> with the target ref (staging vkrihpmjajjcxmzgjqdr / prod qdzgkttiosahdfqresvz)
--      and <SIGNOFF_REMINDERS_SECRET> with the same secret value below.
--
-- The function self-guards: it 401s unless the x-signoff-secret header matches the secret,
-- so the schedule MUST send it.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'signoff-reminders-daily',
  '0 7 * * *',  -- 07:00 UTC daily
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/signoff-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-signoff-secret', '<SIGNOFF_REMINDERS_SECRET>'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- To remove later: select cron.unschedule('signoff-reminders-daily');
