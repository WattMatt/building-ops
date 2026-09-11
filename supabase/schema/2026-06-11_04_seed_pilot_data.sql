-- 2026-06-11_04_seed_pilot_data.sql
-- Recreate pilot/QA data after the 2026-06-11 production data reset.
-- Dataset per specs/testing/MANUAL_QA_SCRIPT.md prereq seed (ZZTEST- convention):
--   2 buildings, 1 QA template (2 items, one requires_photo), 3 manual task
--   instances (overdue / due today / upcoming), 2 issues (open-high / resolved),
--   1 tenant, 1 contractor (+1 expiring doc), 1 building document expiring in
--   14 days, 2 assets (one service-overdue) + 1 service history row.
-- Idempotent: fixed UUIDs + ON CONFLICT DO NOTHING. Owner-authorized 2026-06-11.
-- QA personas are NOT created here — invite QA-Admin/QA-Site via UsersView
-- (exercises the invite flow) and assign ZZTEST-Sandton Gate to QA-Site.
-- NOTE: task generation is deliberately left to the app: first dashboard open
-- should create 5 daily + 2 weekly + 2 monthly instances per building
-- (monthly anchored 2026-06-01 → backfilled as overdue) — that IS the
-- field verification of F-27/F-05.
begin;

-- ── Buildings ──
insert into public.buildings (id, organization_id, name, address, city, latitude, longitude, avatar_color)
values
  ('aaaa1111-0000-4000-8000-000000000001', 'ae0ea977-3207-4d51-a976-acff8e1f2281',
   'ZZTEST-Sandton Gate', '123 Rivonia Rd, Sandton', 'Johannesburg', -26.1076, 28.0567, '#FF7043'),
  ('aaaa1111-0000-4000-8000-000000000002', 'ae0ea977-3207-4d51-a976-acff8e1f2281',
   'ZZTEST-Rosebank Mews', '173 Oxford Rd, Rosebank', 'Johannesburg', -26.1438, 28.0436, '#42A5F5')
on conflict (id) do nothing;

-- ── QA checklist template: 2 items, one requires_photo (org-scoped) ──
insert into public.checklist_templates (id, name, description, frequency, responsible_role, is_active, organization_id)
values ('bbbb2222-0000-4000-8000-000000000001', 'ZZTEST Daily Security Sweep',
        'QA template per MANUAL_QA_SCRIPT prereq', 'daily', 'user', true,
        'ae0ea977-3207-4d51-a976-acff8e1f2281')
on conflict (id) do nothing;

insert into public.template_items (id, template_id, task_name, task_description, responsible_party, requires_photo, requires_signature, display_order)
values
  ('bbbb2222-0000-4000-8000-000000000011', 'bbbb2222-0000-4000-8000-000000000001',
   'ZZTEST Perimeter walk', 'Walk the full perimeter, check gates and fencing', 'user', true, false, 1),
  ('bbbb2222-0000-4000-8000-000000000012', 'bbbb2222-0000-4000-8000-000000000001',
   'ZZTEST Control room check', 'Verify cameras and access logs', 'user', false, false, 2)
on conflict (id) do nothing;

-- ── Manual task instances (template_item_id NULL → outside the generated-dedup index) ──
insert into public.task_instances (id, building_id, task_name, task_description, frequency, due_date, status, requires_photo, requires_signature, responsible_role)
values
  ('cccc3333-0000-4000-8000-000000000001', 'aaaa1111-0000-4000-8000-000000000001',
   'ZZTEST Manual task (overdue)', 'Seeded overdue task for QA', 'daily', '2026-06-09', 'overdue', false, false, 'user'),
  ('cccc3333-0000-4000-8000-000000000002', 'aaaa1111-0000-4000-8000-000000000001',
   'ZZTEST Manual task (due today)', 'Seeded due-today task for QA', 'daily', '2026-06-11', 'pending', true, false, 'user'),
  ('cccc3333-0000-4000-8000-000000000003', 'aaaa1111-0000-4000-8000-000000000001',
   'ZZTEST Manual task (upcoming)', 'Seeded upcoming task for QA', 'weekly', '2026-06-14', 'pending', false, true, 'user')
on conflict (id) do nothing;

-- ── Issues: 1 open high, 1 resolved (reported by Arno's account) ──
insert into public.issues (id, title, description, priority, status, building_id, reported_by, category, responsibility, resolved_at)
values
  ('dddd4444-0000-4000-8000-000000000001', 'ZZTEST Leak in parking P1',
   'Water pooling near bay 14, suspected geyser line', 'high', 'open',
   'aaaa1111-0000-4000-8000-000000000001', '3d4987f9-c21f-40e9-ac9c-1ec201e5f550',
   'plumbing', 'landlord', null),
  ('dddd4444-0000-4000-8000-000000000002', 'ZZTEST Broken light fitting',
   'Stairwell B light replaced', 'low', 'resolved',
   'aaaa1111-0000-4000-8000-000000000001', '3d4987f9-c21f-40e9-ac9c-1ec201e5f550',
   'electrical', 'landlord', '2026-06-10T14:00:00+00:00')
on conflict (id) do nothing;

-- ── Tenant ──
insert into public.building_tenants (id, building_id, shop_number, shop_name, contact_name, contact_phone, contact_email, is_active, lease_start, lease_end, monthly_rent, lease_type)
values ('eeee5555-0000-4000-8000-000000000001', 'aaaa1111-0000-4000-8000-000000000001',
        'S101', 'ZZTEST Bean There Coffee', 'Thandi M', '011 555 0101', 'thandi@beanthere.test',
        true, '2026-01-01', '2028-12-31', 18500.00, 'retail')
on conflict (id) do nothing;

-- ── Contractor + expiring document ──
insert into public.contractors (id, organization_id, company_name, contact_name, contact_phone, trade, rating, is_active)
values ('ffff6666-0000-4000-8000-000000000001', 'ae0ea977-3207-4d51-a976-acff8e1f2281',
        'ZZTEST FixIt (Pty) Ltd', 'Frik V', '082 555 0102', 'plumbing', 4, true)
on conflict (id) do nothing;

insert into public.contractor_documents (id, contractor_id, document_type, document_name, expiry_date, is_verified)
values ('ffff6666-0000-4000-8000-000000000011', 'ffff6666-0000-4000-8000-000000000001',
        'insurance', 'ZZTEST Public liability cover', '2026-07-15', true)
on conflict (id) do nothing;

-- ── Building document expiring in 14 days (GlobalAlerts ≤60d window) ──
insert into public.building_documents (id, building_id, name, document_type, reference_number, issue_date, expiry_date, issuing_authority, uploaded_by)
values ('1111aaaa-0000-4000-8000-000000000001', 'aaaa1111-0000-4000-8000-000000000001',
        'ZZTEST Fire Certificate', 'fire_certificate', 'FC-2025-114', '2025-06-25', '2026-06-25',
        'City of Johannesburg EMS', '3d4987f9-c21f-40e9-ac9c-1ec201e5f550')
on conflict (id) do nothing;

-- ── Assets: one service-overdue (Maintenance alert), one healthy + history ──
insert into public.building_assets (id, building_id, name, category, location, status, last_service_date, next_service_date, condition_rating)
values
  ('2222bbbb-0000-4000-8000-000000000001', 'aaaa1111-0000-4000-8000-000000000001',
   'ZZTEST Chiller 1', 'hvac', 'Roof plant room', 'operational', '2025-12-01', '2026-06-01', 3),
  ('2222bbbb-0000-4000-8000-000000000002', 'aaaa1111-0000-4000-8000-000000000001',
   'ZZTEST Generator', 'generator', 'Basement plant room', 'operational', '2026-05-20', '2026-08-20', 4)
on conflict (id) do nothing;

insert into public.asset_service_history (id, asset_id, service_date, service_type, description, performed_by, created_by)
values ('2222bbbb-0000-4000-8000-000000000011', '2222bbbb-0000-4000-8000-000000000002',
        '2026-05-20', 'scheduled', 'ZZTEST 250h service, filters and oil', 'ZZTEST FixIt (Pty) Ltd',
        '3d4987f9-c21f-40e9-ac9c-1ec201e5f550')
on conflict (id) do nothing;

commit;
