-- 2026-09-15_02_inspection_photo_append.sql
-- S2 "Photo pipeline hardening" (spec docs/superpowers/specs/2026-09-12-field-readiness-design.md
-- §5.3). Additive, idempotent, one transaction. Apply order: staging -> rls-smoke -> prod. iOS
-- never calls this.
--
-- append_inspection_photo(p_inspection, p_template_item, p_path, p_caption, p_section_no)
--   Upserts the (inspection, template item) response row and appends
--   {ref: '<section_no>.<n+1>', caption, path} to photo_urls in ONE statement, where n is the
--   row's current jsonb_array_length(photo_urls) (0 on the insert arm, so the first ref is
--   '<section_no>.1'). The client used to read photo_urls from its query cache, push, and upsert
--   the whole array back; two rapid adds rebuilt the list from the same stale copy and the first
--   upload was orphaned in storage. Here the append reads the row under the ON CONFLICT row lock:
--   a concurrent second call waits for the first to commit, re-reads the updated tuple, and gets
--   the next number. Refs never collide and no path is lost.
--
-- SECURITY INVOKER: the upsert passes ir_write on public.inspection_responses exactly as the
-- client's direct upsert did (2026-06-13_03_fortress_inspections.sql) —
--   using / with check ( exists (select 1 from public.building_inspections bi
--       where bi.id = inspection_id
--         and (is_admin_or_manager() or can_access_building(bi.building_id))) )
-- so a caller without access to the building gets 42501 and nothing is written. No policy change.
-- Returns the whole row so the client can put it straight into its cache.
begin;

create or replace function public.append_inspection_photo(
  p_inspection uuid, p_template_item uuid, p_path text, p_caption text, p_section_no text)
returns public.inspection_responses
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_row public.inspection_responses;
begin
  if auth.uid() is null then
    raise exception 'append_inspection_photo: sign in required' using errcode = '42501';
  end if;
  if p_inspection is null or p_template_item is null or coalesce(btrim(p_path), '') = '' then
    raise exception 'append_inspection_photo: inspection, template item and path are required' using errcode = '22023';
  end if;

  insert into public.inspection_responses as ir (id, inspection_id, template_item_id, photo_urls)
  values (gen_random_uuid(), p_inspection, p_template_item,
          jsonb_build_array(jsonb_build_object(
            'ref', coalesce(p_section_no, '') || '.1',
            'caption', p_caption,
            'path', p_path)))
  on conflict (inspection_id, template_item_id) do update
     set photo_urls = ir.photo_urls || jsonb_build_array(jsonb_build_object(
           'ref', coalesce(p_section_no, '') || '.' || (jsonb_array_length(ir.photo_urls) + 1)::text,
           'caption', p_caption,
           'path', p_path)),
         updated_at = now()
  returning ir.* into v_row;
  return v_row;
end $$;
revoke all on function public.append_inspection_photo(uuid, uuid, text, text, text) from public;
revoke execute on function public.append_inspection_photo(uuid, uuid, text, text, text) from anon;
grant execute on function public.append_inspection_photo(uuid, uuid, text, text, text) to authenticated;

commit;

-- Verify:
--   select proname, prosecdef, proconfig from pg_proc
--    where pronamespace = 'public'::regnamespace and proname = 'append_inspection_photo';
--     -- 1 row; prosecdef = false (invoker); proconfig = {search_path=}
--   select has_function_privilege('anon', 'public.append_inspection_photo(uuid,uuid,text,text,text)', 'execute');           -- false
--   select has_function_privilege('authenticated', 'public.append_inspection_photo(uuid,uuid,text,text,text)', 'execute');  -- true
--   notify pgrst, 'reload schema';
-- Then: node scripts/rls-smoke.mjs (the S2 block: anon refused, user without access 42501,
--   admin/manager two appends -> refs .1 and .2 on ONE row).
