-- ============================================================================
-- Fortress Reporting — 16: §6 delta, column adds / type fixes / renames
-- Guards make every statement idempotent (renames + type-changes re-run safely).
-- ============================================================================

-- reports: carry-forward provenance
alter table public.reports
  add column if not exists cloned_from_report_id uuid references public.reports(id);

-- utility_readings: council-bulk vs check difference + night-window
alter table public.utility_readings
  add column if not exists difference   numeric,
  add column if not exists night_window text;

-- tenant_compliance: new columns
alter table public.tenant_compliance
  add column if not exists lease_clause_no            text,
  add column if not exists generator_responsibility   text check (generator_responsibility in ('tenant','ll','na')),
  add column if not exists smoke_extraction_dedicated text check (smoke_extraction_dedicated in ('yes','no','na')),
  add column if not exists smoke_detection_dedicated  text check (smoke_detection_dedicated in ('yes','no','na')),
  add column if not exists electrical_coc_date        date;   -- §6 occupancy/COC date-drift fix (remap in Phase 3)

-- tenant_compliance: rename *_current -> *_annual_service (guarded; idempotent)
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='tenant_compliance'
               and column_name='smoke_extraction_current') then
    alter table public.tenant_compliance rename column smoke_extraction_current to smoke_extraction_annual_service;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='tenant_compliance'
               and column_name='smoke_detection_current') then
    alter table public.tenant_compliance rename column smoke_detection_current to smoke_detection_annual_service;
  end if;
end $$;

-- masterfile_items.on_file: boolean -> tristate text (yes/no/unassessed), 42 rows mapped
do $$ begin
  if (select data_type from information_schema.columns
        where table_schema='public' and table_name='masterfile_items' and column_name='on_file') = 'boolean' then
    alter table public.masterfile_items alter column on_file drop default;
    alter table public.masterfile_items
      alter column on_file type text using (case when on_file then 'yes' else 'no' end);
    alter table public.masterfile_items
      add constraint masterfile_items_on_file_chk check (on_file in ('yes','no','unassessed'));
  end if;
end $$;

-- tenant_shop_spec.generator_connection: boolean -> tristate text (yes/no/na), 50 rows mapped
do $$ begin
  if (select data_type from information_schema.columns
        where table_schema='public' and table_name='tenant_shop_spec' and column_name='generator_connection') = 'boolean' then
    alter table public.tenant_shop_spec alter column generator_connection drop default;
    alter table public.tenant_shop_spec
      alter column generator_connection type text using (case when generator_connection then 'yes' else 'no' end);
    alter table public.tenant_shop_spec
      add constraint tenant_shop_spec_genconn_chk check (generator_connection in ('yes','no','na'));
  end if;
end $$;

-- inspection_responses.photo_urls: ensure jsonb-array shape [{ref,caption,path}] (defensive; already jsonb)
alter table public.inspection_responses
  add column if not exists photo_urls jsonb not null default '[]'::jsonb;
