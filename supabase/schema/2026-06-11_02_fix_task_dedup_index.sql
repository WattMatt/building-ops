-- Fix F-27 / G-01: PPM task generation broken since 2026-06-10.
--
-- Cause: PostgREST's `on_conflict=building_id,template_item_id,due_date` emits
-- `ON CONFLICT (...) DO NOTHING`, and Postgres cannot use a PARTIAL unique index
-- (WHERE template_item_id IS NOT NULL, from 2026-06-10_05_task_dedup.sql) as the
-- conflict arbiter without the matching predicate — which PostgREST cannot send.
-- Result: every generation POST failed with 42P10, swallowed by print-only error
-- handling in TaskGenerationService. Zero task_instances created since 2026-06-10.
--
-- Fix: recreate the index NON-partial. NULLS DISTINCT (Postgres default, stated
-- explicitly) means manual tasks (template_item_id IS NULL) never collide with
-- each other — behaviour for non-generated tasks is unchanged.
--
-- Pre-validated 2026-06-11 in a rolled-back transaction on production (PG 17.6):
-- app-exact ON CONFLICT insert succeeded (1 row), duplicate no-opped (0 rows);
-- no duplicate triplets and no NULL-template rows exist to block creation.

begin;

drop index if exists public.task_instances_generated_uniq;

create unique index task_instances_generated_uniq
  on public.task_instances (building_id, template_item_id, due_date)
  nulls distinct;

commit;
