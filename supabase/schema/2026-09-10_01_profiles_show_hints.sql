-- 2026-09-10_01_profiles_show_hints.sql
-- Per-user in-app hints preference (web). Replaces the localStorage fallback so the
-- choice follows the user across devices. Default on: first-time users get guidance.
-- Additive, idempotent. The existing profiles update policy (own row) covers writes.
begin;
alter table public.profiles add column if not exists show_hints boolean not null default true;
commit;
