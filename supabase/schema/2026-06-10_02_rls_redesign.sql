-- Migration: Replace blanket auth_all policies with role + building-scoped RLS on all tables
-- Context: AUDIT_REPORT_2026-06-10.md priority 2. Companion to 2026-06-10_01_security_user_roles.sql.
-- Role model (mirrors AuthService): admin/manager see everything; user/reviewer are
-- site-restricted to buildings assigned in user_buildings.
-- Also makes the tenant-documents storage bucket private (app moves to signed URLs).
-- Applied: 2026-06-10 via Supabase Management API.

begin;

-- ============================================================
-- Helper: building access = admin/manager, or assignment in user_buildings
-- ============================================================

create or replace function public.can_access_building(b uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.is_admin_or_manager()
      or exists (
           select 1 from public.user_buildings ub
           where ub.user_id = auth.uid() and ub.building_id = b
         )
$$;

-- ============================================================
-- buildings
-- ============================================================
drop policy if exists auth_all on public.buildings;
create policy b_select on public.buildings for select using (public.can_access_building(id));
create policy b_insert on public.buildings for insert with check (public.is_admin_or_manager());
create policy b_update on public.buildings for update using (public.is_admin_or_manager()) with check (public.is_admin_or_manager());
create policy b_delete on public.buildings for delete using (public.is_admin_or_manager());

-- ============================================================
-- Building-scoped tables with a direct building_id column.
-- Site users read and write within their assigned buildings
-- (they add notes, assets, photos, tasks, issues during walks);
-- destructive deletes are admin/manager only.
-- ============================================================

-- building_assets
drop policy if exists auth_all on public.building_assets;
create policy ba_select on public.building_assets for select using (public.can_access_building(building_id));
create policy ba_insert on public.building_assets for insert with check (public.can_access_building(building_id));
create policy ba_update on public.building_assets for update using (public.can_access_building(building_id)) with check (public.can_access_building(building_id));
create policy ba_delete on public.building_assets for delete using (public.is_admin_or_manager());

-- building_documents
drop policy if exists auth_all on public.building_documents;
create policy bd_select on public.building_documents for select using (public.can_access_building(building_id));
create policy bd_insert on public.building_documents for insert with check (public.can_access_building(building_id));
create policy bd_update on public.building_documents for update using (public.can_access_building(building_id)) with check (public.can_access_building(building_id));
create policy bd_delete on public.building_documents for delete using (public.is_admin_or_manager());

-- building_notes
drop policy if exists auth_all on public.building_notes;
create policy bn_select on public.building_notes for select using (public.can_access_building(building_id));
create policy bn_insert on public.building_notes for insert with check (public.can_access_building(building_id));
create policy bn_update on public.building_notes for update using (public.can_access_building(building_id)) with check (public.can_access_building(building_id));
create policy bn_delete on public.building_notes for delete using (public.is_admin_or_manager());

-- building_tenants
drop policy if exists auth_all on public.building_tenants;
create policy bt_select on public.building_tenants for select using (public.can_access_building(building_id));
create policy bt_insert on public.building_tenants for insert with check (public.can_access_building(building_id));
create policy bt_update on public.building_tenants for update using (public.can_access_building(building_id)) with check (public.can_access_building(building_id));
create policy bt_delete on public.building_tenants for delete using (public.is_admin_or_manager());

-- task_instances (INSERT stays building-scoped, not admin-only: TaskGenerationService
-- runs on every dashboard load, so site users generate tasks for their own buildings)
drop policy if exists auth_all on public.task_instances;
create policy ti_select on public.task_instances for select using (public.can_access_building(building_id));
create policy ti_insert on public.task_instances for insert with check (public.can_access_building(building_id));
create policy ti_update on public.task_instances for update using (public.can_access_building(building_id)) with check (public.can_access_building(building_id));
create policy ti_delete on public.task_instances for delete using (public.is_admin_or_manager());

-- issues
drop policy if exists auth_all on public.issues;
create policy i_select on public.issues for select using (public.can_access_building(building_id));
create policy i_insert on public.issues for insert with check (public.can_access_building(building_id));
create policy i_update on public.issues for update using (public.can_access_building(building_id)) with check (public.can_access_building(building_id));
create policy i_delete on public.issues for delete using (public.is_admin_or_manager());

-- form_submissions (review/status changes are admin/manager only)
drop policy if exists auth_all on public.form_submissions;
create policy fs_select on public.form_submissions for select using (public.can_access_building(building_id));
create policy fs_insert on public.form_submissions for insert with check (public.can_access_building(building_id));
create policy fs_update on public.form_submissions for update using (public.is_admin_or_manager()) with check (public.is_admin_or_manager());
create policy fs_delete on public.form_submissions for delete using (public.is_admin_or_manager());

-- ============================================================
-- Building-scoped via join
-- ============================================================

-- task_completions -> task_instances.building_id
drop policy if exists auth_all on public.task_completions;
create policy tc_select on public.task_completions for select using (
  exists (select 1 from public.task_instances ti where ti.id = task_instance_id and public.can_access_building(ti.building_id))
);
create policy tc_insert on public.task_completions for insert with check (
  exists (select 1 from public.task_instances ti where ti.id = task_instance_id and public.can_access_building(ti.building_id))
);
create policy tc_update on public.task_completions for update using (public.is_admin_or_manager()) with check (public.is_admin_or_manager());
create policy tc_delete on public.task_completions for delete using (public.is_admin_or_manager());

-- asset_service_history -> building_assets.building_id
drop policy if exists auth_all on public.asset_service_history;
create policy ash_select on public.asset_service_history for select using (
  exists (select 1 from public.building_assets ba where ba.id = asset_id and public.can_access_building(ba.building_id))
);
create policy ash_insert on public.asset_service_history for insert with check (
  exists (select 1 from public.building_assets ba where ba.id = asset_id and public.can_access_building(ba.building_id))
);
create policy ash_update on public.asset_service_history for update using (
  exists (select 1 from public.building_assets ba where ba.id = asset_id and public.can_access_building(ba.building_id))
) with check (
  exists (select 1 from public.building_assets ba where ba.id = asset_id and public.can_access_building(ba.building_id))
);
create policy ash_delete on public.asset_service_history for delete using (public.is_admin_or_manager());

-- tenant_documents -> building_tenants.building_id
drop policy if exists auth_all on public.tenant_documents;
create policy td_select on public.tenant_documents for select using (
  exists (select 1 from public.building_tenants bt where bt.id = tenant_id and public.can_access_building(bt.building_id))
);
create policy td_insert on public.tenant_documents for insert with check (
  exists (select 1 from public.building_tenants bt where bt.id = tenant_id and public.can_access_building(bt.building_id))
);
create policy td_update on public.tenant_documents for update using (public.is_admin_or_manager()) with check (public.is_admin_or_manager());
create policy td_delete on public.tenant_documents for delete using (public.is_admin_or_manager());

-- ============================================================
-- Org-global reference tables: readable by any signed-in user,
-- writable by admin/manager
-- ============================================================

drop policy if exists auth_all on public.contractors;
create policy c_select on public.contractors for select using (auth.uid() is not null);
create policy c_insert on public.contractors for insert with check (public.is_admin_or_manager());
create policy c_update on public.contractors for update using (public.is_admin_or_manager()) with check (public.is_admin_or_manager());
create policy c_delete on public.contractors for delete using (public.is_admin_or_manager());

drop policy if exists auth_all on public.contractor_documents;
create policy cd_select on public.contractor_documents for select using (auth.uid() is not null);
create policy cd_insert on public.contractor_documents for insert with check (public.is_admin_or_manager());
create policy cd_update on public.contractor_documents for update using (public.is_admin_or_manager()) with check (public.is_admin_or_manager());
create policy cd_delete on public.contractor_documents for delete using (public.is_admin_or_manager());

drop policy if exists auth_all on public.checklist_templates;
create policy ct_select on public.checklist_templates for select using (auth.uid() is not null);
create policy ct_insert on public.checklist_templates for insert with check (public.is_admin_or_manager());
create policy ct_update on public.checklist_templates for update using (public.is_admin_or_manager()) with check (public.is_admin_or_manager());
create policy ct_delete on public.checklist_templates for delete using (public.is_admin_or_manager());

drop policy if exists auth_all on public.template_items;
create policy tpl_select on public.template_items for select using (auth.uid() is not null);
create policy tpl_insert on public.template_items for insert with check (public.is_admin_or_manager());
create policy tpl_update on public.template_items for update using (public.is_admin_or_manager()) with check (public.is_admin_or_manager());
create policy tpl_delete on public.template_items for delete using (public.is_admin_or_manager());

-- media_attachments: polymorphic (record_type/record_id), no clean join path.
-- Any signed-in user may read/insert; destructive ops admin/manager.
drop policy if exists auth_all on public.media_attachments;
create policy ma_select on public.media_attachments for select using (auth.uid() is not null);
create policy ma_insert on public.media_attachments for insert with check (auth.uid() is not null);
create policy ma_update on public.media_attachments for update using (public.is_admin_or_manager()) with check (public.is_admin_or_manager());
create policy ma_delete on public.media_attachments for delete using (public.is_admin_or_manager());

-- ============================================================
-- organizations: anon read stays (login-screen branding),
-- writes admin/manager
-- ============================================================
drop policy if exists auth_all on public.organizations;
create policy o_update on public.organizations for update using (public.is_admin_or_manager()) with check (public.is_admin_or_manager());
create policy o_insert on public.organizations for insert with check (public.is_admin());
create policy o_delete on public.organizations for delete using (public.is_admin());

-- ============================================================
-- profiles: own row + admin/manager; trigger handle_new_user
-- (security definer) still creates rows on signup
-- ============================================================
drop policy if exists auth_all on public.profiles;
create policy p_select on public.profiles for select using (id = auth.uid() or public.is_admin_or_manager());
create policy p_insert on public.profiles for insert with check (id = auth.uid());
create policy p_update on public.profiles for update using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
create policy p_delete on public.profiles for delete using (public.is_admin());

-- ============================================================
-- audit_logs: append-only; users see their own entries,
-- admin/manager see all; no updates
-- ============================================================
drop policy if exists auth_all on public.audit_logs;
create policy al_select on public.audit_logs for select using (user_id = auth.uid() or public.is_admin_or_manager());
create policy al_insert on public.audit_logs for insert with check (user_id = auth.uid() or user_id is null);
create policy al_delete on public.audit_logs for delete using (public.is_admin());

-- ============================================================
-- Storage: tenant-documents goes private (leases, certificates,
-- photo evidence). App switches to signed URLs.
-- organization-logos stays public (login-screen branding).
-- ============================================================
update storage.buckets set public = false where id = 'tenant-documents';

drop policy if exists "Public read docs" on storage.objects;
create policy "Auth read docs" on storage.objects
  for select using (bucket_id = 'tenant-documents' and auth.uid() is not null);

commit;
