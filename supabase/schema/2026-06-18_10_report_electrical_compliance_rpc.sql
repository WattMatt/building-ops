-- 2026-06-18_10: Phase 2 — building-scoped, read-only RPC feeding the Fortress
-- "Electrical Compliance" report section. Returns a flat per-shop array (one row per
-- insight-linker subsection) with the BEST COC document per shop, for both the report
-- authoring UI and the pdfMake render. SECURITY DEFINER, gated by can_access_building().
-- insight-linker is read-only. Requires _05 + _08 (with coc_number/coc_issue_date columns).
--
-- "Best doc per shop" = prefer a classified doc (coc_status not null), then latest
-- coc_issue_date, then latest uploaded_at (DISTINCT ON). Shops with no document are still
-- returned (null cert fields) so the report shows which shops lack a COC.

create or replace function public.report_electrical_compliance(p_building_id uuid)
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
    return jsonb_build_object('linked', false, 'fetched_at', now(), 'rows', '[]'::jsonb);
  end if;

  with shops as (
    select s.id as subsection_id, s.name, s.tenant_name,
           nullif(regexp_replace(coalesce(s.name,''), '\D', '', 'g'), '') as num
    from insight_linker.subsections s
    where s.site_id = v_site_id
  ),
  gmi as (
    select shop_number, nullif(regexp_replace(coalesce(shop_number,''), '\D', '', 'g'), '') as num
    from public.building_tenants where building_id = p_building_id
  ),
  best as (
    select distinct on (d.subsection_id)
           d.subsection_id, d.coc_number, d.coc_type, d.coc_status,
           d.coc_issue_date, d.coc_expiry_date, d.file_url, d.file_name
    from insight_linker.subsection_documents d
    where d.subsection_id in (select subsection_id from shops)
    order by d.subsection_id,
             (d.coc_status is not null) desc,
             d.coc_issue_date desc nulls last,
             d.uploaded_at   desc nulls last
  )
  select jsonb_build_object(
    'linked', true,
    'fetched_at', now(),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
        'shop_number',    coalesce((select g.shop_number from gmi g where g.num = sh.num and g.num is not null limit 1), sh.name),
        'tenant_name',    sh.tenant_name,
        'coc_number',     b.coc_number,
        'coc_type',       b.coc_type,
        'coc_status',     b.coc_status,
        'coc_issue_date', b.coc_issue_date,
        'coc_expiry_date',b.coc_expiry_date,
        'certificate_url',  b.file_url,
        'certificate_name', b.file_name
      ) order by sh.num nulls last, sh.name), '[]'::jsonb)
  ) into v_result
  from shops sh
  left join best b on b.subsection_id = sh.subsection_id;

  return v_result;
end;
$$;

grant execute on function public.report_electrical_compliance(uuid) to authenticated;
