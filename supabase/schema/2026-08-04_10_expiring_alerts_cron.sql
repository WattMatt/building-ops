-- 2026-08-04_10_expiring_alerts_cron.sql
-- Daily schedule for the notify-expiring-alerts edge function
-- (expiring compliance certificates + overdue asset maintenance).
--
-- Mirrors sql/2026-06-14_03_signoff_cron.sql. Same shape, different secret.
--
-- CONTEXT: this function was never deployed to production, because the repo's
-- config.toml pointed at a clone from 2026-06-17 (see CLAUDE.md). It has now
-- been hardened -- it 401s unless the caller presents either the shared secret
-- below or a verified admin JWT, and it returns COUNTS ONLY, never the alert
-- payload. Before hardening, an anonymous POST of {"dryRun":true} returned every
-- compliance certificate and overdue asset for all 40 buildings.
--
-- PREREQUISITES (all discharged on prod 2026-08-05):
--   1. pg_cron + pg_net extensions enabled.
--   2. Supabase secret EXPIRING_ALERTS_SECRET set on the project.
--   3. notify-expiring-alerts deployed WITH that secret available.
--
-- Replace <PROJECT_REF> and <EXPIRING_ALERTS_SECRET> when applying to another
-- project. Do NOT commit a real secret value into this file.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'expiring-alerts-daily',
  '0 6 * * *',  -- 06:00 UTC daily, ahead of the 07:00 signoff run
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/notify-expiring-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-alerts-secret', '<EXPIRING_ALERTS_SECRET>'
    ),
    body := '{"notifyAdmins": true}'::jsonb
  );
  $$
);

-- To remove later: select cron.unschedule('expiring-alerts-daily');
