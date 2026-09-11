-- 2026-08-31_02: make the insight-linker RPCs finish inside the API statement timeout,
-- read CoC status from the column that is actually populated, and bring both SECURITY
-- DEFINER functions in line with the search_path rule.
--
-- ============================================================================
-- WHY  (measured on prod 2026-08-31, not inferred)
-- ============================================================================
--
-- 1. THE RPCs TIME OUT.  `authenticated` and `authenticator` both carry
--    statement_timeout=8s (pg_db_role_setting).  building_insight_linker measured
--    ~8-10s, so the "Electrical & Compliance" and Documents tabs got SQLSTATE 57014
--    instead of data for all 30 buildings that actually have shops.  The 10 buildings
--    linked to an empty site felt fine only because their foreign scans never executed.
--
-- 2. NOTHING PUSHED DOWN.  Both RPCs filtered with
--       where d.subsection_id in (select subsection_id from shops)
--    where `shops` is a MATERIALIZED local CTE.  postgres_fdw cannot deparse a semi-join
--    against a local CTE, so the deparsed remote query carried no WHERE at all:
--       Remote SQL: SELECT subsection_id FROM public.subsection_documents      -- 5,451 rows
--       Remote SQL: SELECT ... FROM public.inspection_photo_refs               -- 21,381 rows
--    Cost was therefore CONSTANT, not proportional to building size.
--    Collecting the ids into a uuid[] first and filtering with `= any(v_sub_ids)` deparses
--    to `WHERE subsection_id = ANY ($1::uuid[])` and pushes down.  Verified with
--    EXPLAIN (ANALYZE, VERBOSE): 2027ms -> 1288ms on the documents join alone.
--
-- 3. THE REAL COST WAS AN AUDIT FUNCTION.  insight_linker.inspection_photo_refs is NOT a
--    table.  Remotely it is a VIEW over audit_orphan_photo_refs(), which does a recursive
--    jsonb_path_query descent over the whole 10 MB `inspections` table AND an
--    `exists (select 1 from storage.objects ...)` per photo -- a storage-integrity audit,
--    ~21k probes, on every page load.  Even pushed down it still measured 5,861ms,
--    which alone exceeds most of the 8s budget.
--       The same extraction, filtered to one site and run against the BASE table, takes
--       9.8ms (index on inspections.subsection_id exists).  ~600x.
--    So this migration reads insight_linker.inspections directly and stops calling the
--    audit.  Two consequences, both deliberate:
--      * exists_in_storage is no longer checked.  147 of 21,381 refs (0.69%) are orphaned,
--        so a handful of tiles may 404 rather than being hidden.  That is a better trade
--        than the tab not loading at all, and the UI degrades to a broken <img>, not an error.
--      * deleted_at IS NOW RESPECTED.  The audit view does not filter it, so the previous
--        behaviour surfaced photos from 180 soft-deleted inspections.  This is a fix.
--
-- 4. WRONG coc_status COLUMN.  report_electrical_compliance sourced CoC only from
--    subsection_documents (coc_status populated on 857/5451 = 15.7%) and never read
--    insight_linker.subsections.coc_status, which is populated on 1533/1533 = 100% and
--    which the sibling RPC already reads.  Shop-level distribution:
--       Missing=765, Pending=607, Fail=104, Pass=57.
--    The CoC block is now taken from the document row WHEN THAT ROW CARRIES ANY CoC FIELD,
--    and otherwise from the shop row -- block-level, not per-field coalesce, so a row can
--    never mix a document's number with a shop's status and report a contradiction.
--
-- 5. search_path.  Both functions used `SET search_path TO 'public','insight_linker'`.
--    CLAUDE.md requires SECURITY DEFINER functions to pin `SET search_path = ''` with
--    fully-qualified bodies.  Done here.  `anon` also held EXECUTE on both -- denied inside
--    can_access_building() with 42501, so not exploitable, but it is an ungated grant on a
--    definer function that reads another customer's database through a superuser FDW
--    mapping.  Revoked.
--
-- Read-only against insight-linker throughout.  Idempotent.  Apply staging -> prod.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Fewer round trips.  fetch_size 1000 meant ~22 round trips on the photo pull.
--    ALTER SERVER needs ADD vs SET depending on whether the option is already present.
-- ---------------------------------------------------------------------------
do $$
declare v_has boolean;
begin
  select coalesce(srvoptions,'{}')::text like '%fetch_size%' into v_has
  from pg_foreign_server where srvname = 'insight_linker_srv';
  if v_has is null then
    raise notice 'insight_linker_srv not found — skipping fetch_size';
  elsif v_has then
    alter server insight_linker_srv options (set fetch_size '10000');
  else
    alter server insight_linker_srv options (add fetch_size '10000');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) The inspections base table, replacing the audit view as the photo source.
--    Only the columns the integration reads.  json_data is fetched for the filtered
--    rows only (~118 rows for the largest building), and the photo extraction runs
--    locally on that small set.
-- ---------------------------------------------------------------------------
create foreign table if not exists insight_linker.inspections (
  id            uuid,
  subsection_id uuid,
  title         text,
  json_data     jsonb,
  deleted_at    timestamptz
) server insight_linker_srv options (schema_name 'public', table_name 'inspections');

-- ---------------------------------------------------------------------------
-- 3) report_electrical_compliance — the Electrical Compliance report section.
-- ---------------------------------------------------------------------------
create or replace function public.report_electrical_compliance(p_building_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_site_id  uuid;
  v_sub_ids  uuid[];
  v_result   jsonb;
begin
  if not public.can_access_building(p_building_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select b.il_site_id into v_site_id from public.buildings b where b.id = p_building_id;
  if v_site_id is null then
    return jsonb_build_object('linked', false, 'fetched_at', now(), 'rows', '[]'::jsonb);
  end if;

  -- Collect the shop ids ONCE, into an array. This is what makes the foreign scans
  -- below deparse to `WHERE subsection_id = ANY ($1::uuid[])` instead of a full fetch.
  select array_agg(s.id) into v_sub_ids
  from insight_linker.subsections s where s.site_id = v_site_id;

  if v_sub_ids is null then
    -- Linked, but the source site has no shops. Distinct from "not linked": the caller
    -- must be able to tell those apart.
    return jsonb_build_object('linked', true, 'fetched_at', now(), 'rows', '[]'::jsonb);
  end if;

  with shops as (
    select s.id as subsection_id, s.name, s.tenant_name,
           s.coc_number, s.coc_status, s.coc_type, s.coc_issue_date,
           nullif(regexp_replace(coalesce(s.name,''), '\D', '', 'g'), '') as num
    from insight_linker.subsections s
    where s.id = any (v_sub_ids)
  ),
  gmi as (
    select bt.shop_number,
           nullif(regexp_replace(coalesce(bt.shop_number,''), '\D', '', 'g'), '') as num
    from public.building_tenants bt where bt.building_id = p_building_id
  ),
  best as (
    select distinct on (d.subsection_id)
           d.subsection_id, d.coc_number, d.coc_type, d.coc_status,
           d.coc_issue_date, d.coc_expiry_date, d.file_url, d.file_name
    from insight_linker.subsection_documents d
    where d.subsection_id = any (v_sub_ids)
    order by d.subsection_id,
             (d.coc_status is not null) desc,
             d.coc_issue_date desc nulls last,
             d.uploaded_at   desc nulls last
  )
  select jsonb_build_object(
    'linked', true,
    'fetched_at', now(),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
        'shop_number', coalesce((select g.shop_number from gmi g
                                  where g.num = sh.num and g.num is not null limit 1), sh.name),
        'tenant_name', sh.tenant_name,
        -- Block-level source choice: the document row wins only when it actually carries
        -- CoC data, otherwise the shop row (100% populated) supplies the whole block.
        -- Never a per-field mix, which could pair one source's number with another's status.
        'coc_number',      case when b.has_coc then b.coc_number     else sh.coc_number     end,
        'coc_type',        case when b.has_coc then b.coc_type       else sh.coc_type       end,
        'coc_status',      case when b.has_coc then b.coc_status     else sh.coc_status     end,
        'coc_issue_date',  case when b.has_coc then b.coc_issue_date else sh.coc_issue_date end,
        -- coc_expiry_date is null on 100% of BOTH source tables (0/5451, 0/1533). Kept in
        -- the contract so the shape does not change if insight-linker starts capturing it.
        'coc_expiry_date', b.coc_expiry_date,
        'coc_source',      case when b.has_coc then 'document' else 'shop' end,
        'certificate_url',  b.file_url,
        'certificate_name', b.file_name
      ) order by sh.num nulls last, sh.name), '[]'::jsonb)
  ) into v_result
  from shops sh
  left join lateral (
    select bb.*,
           (bb.coc_number is not null or bb.coc_status is not null
            or bb.coc_type is not null or bb.coc_issue_date is not null) as has_coc
    from best bb where bb.subsection_id = sh.subsection_id
  ) b on true;

  return v_result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4) building_insight_linker — the Electrical & Compliance tab and Documents tab.
-- ---------------------------------------------------------------------------
create or replace function public.building_insight_linker(p_building_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_site_id uuid;
  v_sub_ids uuid[];
  v_result  jsonb;
begin
  if not public.can_access_building(p_building_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select b.il_site_id into v_site_id from public.buildings b where b.id = p_building_id;
  if v_site_id is null then
    return jsonb_build_object('linked', false, 'fetched_at', now());
  end if;

  select array_agg(s.id) into v_sub_ids
  from insight_linker.subsections s where s.site_id = v_site_id;
  v_sub_ids := coalesce(v_sub_ids, '{}'::uuid[]);

  with shops as materialized (
    select s.id as subsection_id, s.name, s.tenant_name, s.category,
           s.meter_serial_number, s.ct_ratio, s.metering_status,
           s.coc_number, s.coc_status, s.coc_type, s.coc_issue_date, s.coc_expiry_date,
           nullif(regexp_replace(coalesce(s.name,''), '\D', '', 'g'), '') as num
    from insight_linker.subsections s
    where s.site_id = v_site_id
  ),
  brk as materialized (
    select distinct on (a.meter_serial_number) a.meter_serial_number, a.breaker_size
    from insight_linker.site_assets a
    where a.site_id = v_site_id and a.meter_serial_number is not null and a.breaker_size is not null
    order by a.meter_serial_number, a.breaker_size
  ),
  gmi as (
    select bt.id, bt.shop_number, bt.shop_name,
           nullif(regexp_replace(coalesce(bt.shop_number,''), '\D', '', 'g'), '') as num
    from public.building_tenants bt where bt.building_id = p_building_id
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
  sd as materialized (
    select d.subsection_id, d.file_name, d.file_url, d.file_size,
           d.coc_type, d.coc_status, d.coc_expiry_date, d.uploaded_at
    from insight_linker.subsection_documents d
    where d.subsection_id = any (v_sub_ids)          -- pushes down
  ),
  docs as (
    select sd.subsection_id,
           jsonb_agg(jsonb_build_object(
             'file_name', sd.file_name, 'file_url', sd.file_url, 'file_size', sd.file_size,
             'coc_type', sd.coc_type, 'coc_status', sd.coc_status, 'coc_expiry_date', sd.coc_expiry_date
           ) order by sd.uploaded_at desc nulls last) as items,
           count(*) as n
    from sd group by sd.subsection_id
  ),
  -- Photos read from the inspections BASE table, not audit_orphan_photo_refs().
  -- Soft-deleted inspections are excluded, which the audit view did not do.
  pics as (
    select i.subsection_id,
           jsonb_agg(jsonb_build_object('inspection_title', i.title, 'photo_url', p.url)) as items,
           count(*) as n
    from insight_linker.inspections i
    cross join lateral (
      select jsonb_path_query(i.json_data, 'lax $.**.photos[*]') #>> '{}' as url
    ) p
    where i.subsection_id = any (v_sub_ids)          -- pushes down
      and i.deleted_at is null
      and i.json_data is not null
      and p.url ~ '^https?://[^/]+/storage/v1/object/'
    group by i.subsection_id
  )
  select jsonb_build_object(
    'linked', true,
    'fetched_at', now(),
    'site', (select to_jsonb(x) from (
        select s2.id as il_site_id, s2.name, s2.supply_authority,
               s2.nominated_max_demand, s2.site_image_url
        from insight_linker.sites s2 where s2.id = v_site_id) x),
    'counts', jsonb_build_object(
        'shops',       (select count(*) from shops),
        'with_docs',   (select count(*) from docs),
        'with_photos', (select count(*) from pics where pics.n > 0)),
    'coc_rollup', (select jsonb_build_object(
        'docs',    count(*),
        'pass',    count(*) filter (where sd.coc_status ilike 'pass'),
        'fail',    count(*) filter (where sd.coc_status ilike 'fail'),
        'pending', count(*) filter (where sd.coc_status ilike 'pending')) from sd),
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
          'documents',   coalesce((select d.items from docs d where d.subsection_id = m.subsection_id), '[]'::jsonb),
          'doc_count',   coalesce((select d.n     from docs d where d.subsection_id = m.subsection_id), 0),
          'photos',      coalesce((select p.items from pics p where p.subsection_id = m.subsection_id), '[]'::jsonb),
          'photo_count', coalesce((select p.n     from pics p where p.subsection_id = m.subsection_id), 0)
        ) order by m.num nulls last, m.name), '[]'::jsonb)
      from matched m),
    'site_documents', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'file_name', sd2.file_name, 'file_url', sd2.file_url)), '[]'::jsonb)
      from insight_linker.site_documents sd2 where sd2.site_id = v_site_id)
  ) into v_result;

  return v_result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5) Grants. Only signed-in users may call these; can_access_building() still decides
--    which buildings they see. anon has no business reaching another customer's data
--    through a superuser FDW mapping, even behind a gate.
-- ---------------------------------------------------------------------------
revoke all on function public.report_electrical_compliance(uuid) from public, anon;
revoke all on function public.building_insight_linker(uuid)     from public, anon;
grant execute on function public.report_electrical_compliance(uuid) to authenticated, service_role;
grant execute on function public.building_insight_linker(uuid)      to authenticated, service_role;

commit;
