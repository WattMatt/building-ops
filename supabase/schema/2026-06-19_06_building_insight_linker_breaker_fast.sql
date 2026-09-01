-- 2026-06-19_06: SUPERSEDES _05. Adds breaker_size to building_insight_linker, but
-- performance-hardened so the RPC stays under the 8s `authenticated` statement_timeout.
--
-- Why: _05's correlated per-shop breaker subquery added ~1.5s of FDW latency and tipped
-- the RPC over 8s on prod (AbaQulusi 500'd; Evaton was already ~9.4s and failing). The
-- original RPC scanned the FDW table subsection_documents FOUR times (docs CTE + 3× coc_rollup).
-- This version scans it ONCE (materialized `sd` CTE feeding both docs and the rollup) and reads
-- breaker from site_assets ONCE (`brk` CTE, joined by meter serial) — net FASTER than _09.
--
-- Output shape is identical to _05 (every key preserved) + breaker_size per shop.
-- Requires 2026-06-19_04 (site_assets foreign table). Read-only, SECURITY DEFINER, can_access_building gate.

create or replace function public.building_insight_linker(p_building_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, insight_linker
as $$
declare
  v_site_id uuid;
  v_result  jsonb;
begin
  if not public.can_access_building(p_building_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select il_site_id into v_site_id from public.buildings where id = p_building_id;
  if v_site_id is null then
    return jsonb_build_object('linked', false, 'fetched_at', now());
  end if;

  with shops as materialized (
    select s.id as subsection_id, s.name, s.tenant_name, s.category,
           s.meter_serial_number, s.ct_ratio, s.metering_status,
           s.coc_number, s.coc_status, s.coc_type, s.coc_issue_date, s.coc_expiry_date,
           nullif(regexp_replace(coalesce(s.name,''), '\D', '', 'g'), '') as num
    from insight_linker.subsections s
    where s.site_id = v_site_id
  ),
  -- ONE scan of site_assets for the site: one breaker per meter serial.
  brk as materialized (
    select distinct on (meter_serial_number) meter_serial_number, breaker_size
    from insight_linker.site_assets
    where site_id = v_site_id and meter_serial_number is not null and breaker_size is not null
    order by meter_serial_number, breaker_size
  ),
  gmi as (
    select id, shop_number, shop_name,
           nullif(regexp_replace(coalesce(shop_number,''), '\D', '', 'g'), '') as num
    from public.building_tenants where building_id = p_building_id
  ),
  matched as (
    select sh.*, t.id as t_id, t.shop_number as t_shop_number, t.shop_name as t_shop_name,
           b.breaker_size
    from shops sh
    left join lateral (
      select g.id, g.shop_number, g.shop_name from gmi g
      where g.num is not null and g.num = sh.num limit 1
    ) t on true
    left join brk b on b.meter_serial_number = sh.meter_serial_number
  ),
  -- ONE scan of subsection_documents for the site; feeds BOTH docs[] and coc_rollup.
  sd as materialized (
    select d.subsection_id, d.file_name, d.file_url, d.file_size,
           d.coc_type, d.coc_status, d.coc_expiry_date, d.uploaded_at
    from insight_linker.subsection_documents d
    where d.subsection_id in (select subsection_id from shops)
  ),
  docs as (
    select subsection_id,
           jsonb_agg(jsonb_build_object(
             'file_name', file_name, 'file_url', file_url, 'file_size', file_size,
             'coc_type', coc_type, 'coc_status', coc_status, 'coc_expiry_date', coc_expiry_date
           ) order by uploaded_at desc nulls last) as items,
           count(*) as n
    from sd group by subsection_id
  ),
  pics as (
    select r.subsection_id,
           jsonb_agg(jsonb_build_object('inspection_title', r.inspection_title, 'photo_url', r.photo_url))
             filter (where r.exists_in_storage) as items,
           count(*) filter (where r.exists_in_storage) as n
    from insight_linker.inspection_photo_refs r
    where r.subsection_id in (select subsection_id from shops)
    group by r.subsection_id
  )
  select jsonb_build_object(
    'linked', true,
    'fetched_at', now(),
    'site', (select to_jsonb(x) from (
        select id as il_site_id, name, supply_authority, nominated_max_demand, site_image_url
        from insight_linker.sites where id = v_site_id) x),
    'counts', jsonb_build_object(
        'shops',       (select count(*) from shops),
        'with_docs',   (select count(*) from docs),
        'with_photos', (select count(*) from pics where n > 0)),
    'coc_rollup', (select jsonb_build_object(
        'docs',    count(*),
        'pass',    count(*) filter (where coc_status ilike 'pass'),
        'fail',    count(*) filter (where coc_status ilike 'fail'),
        'pending', count(*) filter (where coc_status ilike 'pending')) from sd),
    'shops', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'subsection_id', m.subsection_id, 'name', m.name, 'tenant_name', m.tenant_name,
          'category', m.category, 'meter_serial_number', m.meter_serial_number,
          'ct_ratio', m.ct_ratio,
          'breaker_size', m.breaker_size,
          'metering_status', m.metering_status,
          'coc', jsonb_build_object('number', m.coc_number, 'status', m.coc_status,
                  'type', m.coc_type, 'issue_date', m.coc_issue_date, 'expiry', m.coc_expiry_date),
          'matched_tenant', case when m.t_id is not null
                  then jsonb_build_object('id', m.t_id, 'shop_number', m.t_shop_number, 'shop_name', m.t_shop_name)
                  else null end,
          'documents',   coalesce((select items from docs d where d.subsection_id = m.subsection_id), '[]'::jsonb),
          'doc_count',   coalesce((select n     from docs d where d.subsection_id = m.subsection_id), 0),
          'photos',      coalesce((select items from pics p where p.subsection_id = m.subsection_id), '[]'::jsonb),
          'photo_count', coalesce((select n     from pics p where p.subsection_id = m.subsection_id), 0)
        ) order by m.num nulls last, m.name), '[]'::jsonb)
      from matched m),
    'site_documents', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'file_name', sd2.file_name, 'file_url', sd2.file_url)), '[]'::jsonb)
      from insight_linker.site_documents sd2 where sd2.site_id = v_site_id)
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.building_insight_linker(uuid) to authenticated;
