-- ============================================================================
-- Fortress Reporting — 07: PPM monthly status view (reuse, don't rebuild)
-- Finalized from fortress/sql-drafts/F03_to_F08_STUBS.sql §F07.
-- PPM is already task_instances (+ completions) — NO new ppm table.
-- Verified columns (sql/2026-06-11_07): task_instances(building_id, task_name,
-- due_date, status, id), task_completions(task_instance_id UNIQUE, id).
-- R-02: task_name is denormalized — no template_items join.
-- R-12: derive from task_instances.status first (issue_logged is distinct),
--       fall back to date logic.
-- R-01: security_invoker = on so building RLS on the base tables applies.
-- Idempotent: create or replace.
-- ============================================================================

create or replace view public.ppm_monthly_status
  with (security_invoker = on) as
select ti.building_id,
       ti.task_name                             as service_name,
       date_trunc('month', ti.due_date)::date   as period_month,
       case
         when tc.id is not null
           or ti.status = 'completed'        then 'done'
         when ti.status = 'issue_logged'     then 'issue_logged'
         when ti.due_date < current_date     then 'missed'
         else 'due'
       end as status
from public.task_instances ti
left join public.task_completions tc on tc.task_instance_id = ti.id;
