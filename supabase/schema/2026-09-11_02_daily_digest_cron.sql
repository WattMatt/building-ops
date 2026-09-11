-- sql/2026-09-11_02_daily_digest_cron.sql
-- Daily digest email for users who opted in (profiles.daily_digest).
--
-- 04:30 UTC = 06:30 SAST, ahead of the 06:00 UTC expiring-alerts run and the 07:00 UTC
-- sign-off run, so the digest lands first thing rather than behind the per-item alerts.
--
-- Mirrors sql/2026-08-04_10_expiring_alerts_cron.sql. Same shape, different secret.
--
-- PREREQUISITES:
--   1. pg_cron + pg_net extensions enabled.
--   2. Supabase secret DAILY_DIGEST_SECRET set on the project.
--   3. daily-digest deployed WITH that secret available
--      (supabase functions deploy daily-digest --project-ref <PROJECT_REF>).
--
-- The function 401s unless the caller presents the shared secret below, and returns
-- COUNTS ONLY -- never the digest payload.
--
-- Replace <PROJECT_REF> and <DAILY_DIGEST_SECRET> when applying. Do NOT commit a real
-- secret value into this file.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'daily-digest',
  '30 4 * * *',  -- 04:30 UTC daily = 06:30 SAST
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/daily-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-digest-secret', '<DAILY_DIGEST_SECRET>'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- To remove later: select cron.unschedule('daily-digest');
