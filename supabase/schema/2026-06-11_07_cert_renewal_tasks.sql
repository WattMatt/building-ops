-- 2026-06-11_07_cert_renewal_tasks.sql
-- Phase 2: certificate-expiry-driven renewal tasks (H&S spec §7).
-- A daily pg_cron job inserts a renewal task for every building document whose
-- expiry_date is within 60 days (or already lapsed). Runs in the DB so it works
-- regardless of which client is open. iOS-safe: new column is nullable, and the
-- inserted rows use only existing frequency/status enum values.

alter table task_instances add column if not exists source_document_id uuid
  references building_documents(id) on delete set null;

-- Idempotency backstop: one renewal task per document per expiry date.
create unique index if not exists task_instances_cert_renewal_uniq
  on task_instances (building_id, source_document_id, due_date)
  where source_document_id is not null;

create or replace function public.generate_certificate_renewal_tasks()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
begin
  insert into task_instances
    (building_id, task_name, task_description, frequency, due_date, status,
     requires_photo, requires_signature, responsible_role, category, source_document_id)
  select
    d.building_id,
    'Renew: ' || d.name,
    'Certificate expires ' || to_char(d.expiry_date, 'YYYY-MM-DD')
      || case when d.issuing_authority is not null then ' — issuer: ' || d.issuing_authority else '' end
      || case when d.reference_number is not null then ' (ref ' || d.reference_number || ')' else '' end
      || '. Arrange renewal and upload the new certificate to the document register.',
    'monthly',
    d.expiry_date,
    case when d.expiry_date < current_date then 'overdue' else 'pending' end,
    false, false, 'manager',
    'statutory_certificates',
    d.id
  from building_documents d
  where d.expiry_date is not null
    and d.expiry_date <= current_date + interval '60 days'
  on conflict (building_id, source_document_id, due_date)
    where source_document_id is not null
    do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

-- Daily at 04:00 UTC. Re-runnable migration: unschedule any prior job first.
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('certificate-renewal-tasks');
exception when others then
  null; -- job did not exist yet
end $$;

select cron.schedule('certificate-renewal-tasks', '0 4 * * *',
  'select public.generate_certificate_renewal_tasks()');

-- Generate immediately so the feature is live without waiting for the first cron tick.
select public.generate_certificate_renewal_tasks() as inserted_now;
