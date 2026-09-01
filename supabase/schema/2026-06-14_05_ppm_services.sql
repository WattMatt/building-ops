-- Wave 7 (battle-test 2026-06-14): proper PPM (planned preventive maintenance) model.
-- The OPS report's PPM sheet is the CONTRACTOR service schedule (Aircon, Generators,
-- Lifts, Fire equipment...) shown as a service × month status grid. This is distinct
-- from `task_instances` (the H&S site-staff checklist that feeds the iOS app) — modelling
-- PPM here keeps the two domains isolated so PPM services never pollute the staff checklist.
-- Report-scoped (like every other Fortress section table) so carry-forward copies it
-- month-to-month. The 12-month grid lives in `months` jsonb:
--   { "YYYY-MM": { "status": "due"|"done"|"missed"|"na", "date": "YYYY-MM-DD"(optional) } }
-- Additive + idempotent. RLS per §9 standard block. Requires 2026-06-13_01 (touch fn).
create table if not exists public.ppm_services (
    id           uuid primary key default gen_random_uuid(),
    report_id    uuid references public.reports(id) on delete cascade,
    building_id  uuid not null references public.buildings(id) on delete cascade,
    service_name text not null,
    frequency    text,
    comment      text,
    months       jsonb not null default '{}'::jsonb,
    sort_order   int default 0,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

create unique index if not exists ppm_services_uq on public.ppm_services (report_id, service_name);
create index if not exists ppm_services_report_idx on public.ppm_services (report_id);

do $$ declare t text := 'ppm_services';
begin
  execute format('alter table public.%I enable row level security;', t);
  execute format('drop policy if exists %I on public.%I;', t||'_read', t);
  execute format('create policy %I on public.%I for select using (can_access_building(building_id));', t||'_read', t);
  execute format('drop policy if exists %I on public.%I;', t||'_ins', t);
  execute format('create policy %I on public.%I for insert with check (is_admin_or_manager() or can_access_building(building_id));', t||'_ins', t);
  execute format('drop policy if exists %I on public.%I;', t||'_upd', t);
  execute format('create policy %I on public.%I for update using (is_admin_or_manager() or can_access_building(building_id));', t||'_upd', t);
  execute format('drop policy if exists %I on public.%I;', t||'_del', t);
  execute format('create policy %I on public.%I for delete using (is_admin());', t||'_del', t);
  execute format('drop trigger if exists %I on public.%I;', 'trg_'||t||'_touch', t);
  execute format('create trigger %I before update on public.%I for each row execute function public.fortress_touch_updated_at();', 'trg_'||t||'_touch', t);
end $$;
