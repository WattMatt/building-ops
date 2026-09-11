-- Migration: unique index so PPM task generation cannot create duplicates.
-- TaskGenerationService runs on every dashboard load; its client-side dedup
-- fetch truncated at 1000 rows. The app now sends
-- on_conflict=building_id,template_item_id,due_date with ignore-duplicates;
-- this index is the database-level backstop.
-- Existing duplicates are removed first, preferring completed rows, then oldest.
-- Applied: 2026-06-10 via Supabase Management API.

begin;

delete from public.task_instances t
using (
  select id, row_number() over (
    partition by building_id, template_item_id, due_date
    order by (status = 'completed') desc, created_at asc
  ) as rn
  from public.task_instances
  where template_item_id is not null
) d
where t.id = d.id and d.rn > 1;

create unique index if not exists task_instances_generated_uniq
  on public.task_instances (building_id, template_item_id, due_date)
  where template_item_id is not null;

commit;
