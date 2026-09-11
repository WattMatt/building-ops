-- 2026-06-18_11: surface the document CATEGORY (the "01 COC" / "As-Built Drawings" /
-- "03_Line Diagram" label each file is saved under) so the building tab shows what each
-- document IS, not just its filename. insight-linker's document_categories is a
-- PER-SUBSECTION table (id, subsection_id, name, order_index); subsection_documents.category_id
-- references it. Phase 1 dropped both as YAGNI — restore the link.
--
-- Read-only, re-runnable. Does NOT edit the shipped _08/_09 (adds the column + table here and
-- replaces the function). Requires _05 (server + user mapping).

-- Recreate the docs foreign table to ADD category_id (the rest matches _08).
drop foreign table if exists insight_linker.subsection_documents;
create foreign table insight_linker.subsection_documents (
  subsection_id   uuid,
  category_id     uuid,
  file_name       text,
  file_url        text,
  file_size       bigint,
  uploaded_at     timestamptz,
  coc_number      text,
  coc_type        text,
  coc_status      text,
  coc_issue_date  date,
  coc_expiry_date date
) server insight_linker_srv options (schema_name 'public', table_name 'subsection_documents');

-- The per-subsection category label table.
drop foreign table if exists insight_linker.document_categories;
create foreign table insight_linker.document_categories (
  id            uuid,
  subsection_id uuid,
  name          text,
  order_index   integer
) server insight_linker_srv options (schema_name 'public', table_name 'document_categories');

-- Replace building_insight_linker so each per-shop document carries its category name.
-- Identical to _09 EXCEPT the `docs` CTE now LEFT JOINs document_categories and adds 'category'.
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

  with shops as (
    select s.id as subsection_id, s.name, s.tenant_name, s.category,
           s.meter_serial_number, s.ct_ratio, s.metering_status,
           s.coc_number, s.coc_status, s.coc_type, s.coc_issue_date, s.coc_expiry_date,
           nullif(regexp_replace(coalesce(s.name,''), '\D', '', 'g'), '') as num
    from insight_linker.subsections s
    where s.site_id = v_site_id
  ),
  gmi as (
    select id, shop_number, shop_name,
           nullif(regexp_replace(coalesce(shop_number,''), '\D', '', 'g'), '') as num
    from public.building_tenants where building_id = p_building_id
  ),
  matched as (
    select sh.*, t.id as t_id, t.shop_number as t_shop_number, t.shop_name as t_shop_name
    from shops sh
    left join lateral (
      select g.id, g.shop_number, g.shop_name from gmi g
      where g.num is not null and g.num = sh.num limit 1
    ) t on true
  ),
  docs as (
    select d.subsection_id,
           jsonb_agg(jsonb_build_object(
             'file_name', d.file_name, 'file_url', d.file_url, 'file_size', d.file_size,
             'category', dc.name,
             'coc_type', d.coc_type, 'coc_status', d.coc_status, 'coc_expiry_date', d.coc_expiry_date
           ) order by dc.order_index nulls last, dc.name nulls last, d.uploaded_at desc nulls last) as items,
           count(*) as n
    from insight_linker.subsection_documents d
    left join insight_linker.document_categories dc on dc.id = d.category_id
    where d.subsection_id in (select subsection_id from shops)
    group by d.subsection_id
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
    'coc_rollup', jsonb_build_object(
        'docs',    (select coalesce(sum(n),0) from docs),
        'pass',    (select count(*) from insight_linker.subsection_documents d where d.subsection_id in (select subsection_id from shops) and d.coc_status ilike 'pass'),
        'fail',    (select count(*) from insight_linker.subsection_documents d where d.subsection_id in (select subsection_id from shops) and d.coc_status ilike 'fail'),
        'pending', (select count(*) from insight_linker.subsection_documents d where d.subsection_id in (select subsection_id from shops) and d.coc_status ilike 'pending')),
    'shops', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'subsection_id', m.subsection_id, 'name', m.name, 'tenant_name', m.tenant_name,
          'category', m.category, 'meter_serial_number', m.meter_serial_number,
          'ct_ratio', m.ct_ratio, 'metering_status', m.metering_status,
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
          'file_name', sd.file_name, 'file_url', sd.file_url)), '[]'::jsonb)
      from insight_linker.site_documents sd where sd.site_id = v_site_id)
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.building_insight_linker(uuid) to authenticated;
