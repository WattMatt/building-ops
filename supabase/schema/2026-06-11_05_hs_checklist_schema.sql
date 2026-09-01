-- 2026-06-11_05_hs_checklist_schema.sql
-- Insurance H&S checklists: building-type scoping + compliance category.
-- All columns nullable/additive — iOS app ships unchanged (Codable ignores unknown keys).

alter table buildings add column if not exists building_type text
  check (building_type in ('office','retail','industrial','mixed_use'));

alter table checklist_templates add column if not exists applies_to_building_types text[];

alter table template_items add column if not exists category text;
alter table task_instances add column if not exists category text;

-- Scoping is enforced at the DB so the UNCHANGED iOS generator also complies:
-- rows whose template does not apply to the building's type are silently
-- skipped; category is denormalised from the template item for ALL clients.
create or replace function public.enforce_hs_template_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_applies text[];
  v_item_category text;
  v_building_type text;
begin
  if new.template_item_id is null then
    return new;
  end if;

  select ct.applies_to_building_types, ti.category
    into v_applies, v_item_category
  from template_items ti
  join checklist_templates ct on ct.id = ti.template_id
  where ti.id = new.template_item_id;

  if not found then
    return new;
  end if;

  if new.category is null then
    new.category := v_item_category;
  end if;

  -- null applies_to = template applies to every building
  if v_applies is null then
    return new;
  end if;

  select building_type into v_building_type
  from buildings where id = new.building_id;

  if v_building_type is null or not (v_building_type = any(v_applies)) then
    return null; -- skip: template not applicable to this building
  end if;

  return new;
end;
$$;

drop trigger if exists trg_task_instances_hs_scope on task_instances;
create trigger trg_task_instances_hs_scope
  before insert on task_instances
  for each row execute function public.enforce_hs_template_scope();
