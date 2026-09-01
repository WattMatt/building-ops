-- Migration: denormalized author display name on issue_activity.
-- Site users cannot read other users' profiles under the new RLS, and an
-- immutable audit trail should keep the name as it was at write time.
-- Applied: 2026-06-10 via Supabase Management API.

alter table public.issue_activity add column if not exists author_name text;
