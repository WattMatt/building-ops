-- 2026-06-18_03_abaqulusi_cm_missing.sql
-- AbaQulusi gap-fill STEP 3 — CM missing ingestion (GAP_REGISTER C1-C6).
-- C1 local_resources_contacts (3); C2 loadshedding + C3 maintenance + C5 incidents -> report_narratives (ONE row/section: report_narratives_uq is unique on report_id,section_key);
-- C4 toilet_fund.profit_per_roll; C6 shop15 fire_blanket. Idempotent (NOT EXISTS / IS NULL guards).
-- Note: loadshedding source has stage/hours but NO dates -> narrative summary (consistent with borehole_status/generator_status); loadshedding_log left empty (no dated events).
-- Note: Checklist Summary already stored in report_checklist_items (section checklist_summary, 12 rows) — no action.
-- Note: 6 monthly incident narratives combined into one section row (unique constraint forbids 6 rows).
BEGIN;

-- C1 local resources contacts
INSERT INTO public.local_resources_contacts (id, report_id, building_id, resource_type, name, last_meeting_date, frequency, contact_person, contact_number, sort_order)
SELECT gen_random_uuid(), 'd4debf2d-f380-5dc8-b4dd-4429e99fa016', '63345a91-6706-5cf3-b26e-80174c36b2b5', NULL, 'COMMUNITY POLICE FORUM (CPF)', '2025-07-17'::date, 'Weekly', 'SAFETY OFFICER ABAQULUSI MUNICIPALITY', '0349895500/0733737743', 1
WHERE NOT EXISTS (SELECT 1 FROM public.local_resources_contacts WHERE report_id='d4debf2d-f380-5dc8-b4dd-4429e99fa016' AND name='COMMUNITY POLICE FORUM (CPF)');
INSERT INTO public.local_resources_contacts (id, report_id, building_id, resource_type, name, last_meeting_date, frequency, contact_person, contact_number, sort_order)
SELECT gen_random_uuid(), 'd4debf2d-f380-5dc8-b4dd-4429e99fa016', '63345a91-6706-5cf3-b26e-80174c36b2b5', NULL, 'LOCAL POLICE', '2025-07-17'::date, 'Monthly', 'SWITCH BOARD', '10111', 2
WHERE NOT EXISTS (SELECT 1 FROM public.local_resources_contacts WHERE report_id='d4debf2d-f380-5dc8-b4dd-4429e99fa016' AND name='LOCAL POLICE');
INSERT INTO public.local_resources_contacts (id, report_id, building_id, resource_type, name, last_meeting_date, frequency, contact_person, contact_number, sort_order)
SELECT gen_random_uuid(), 'd4debf2d-f380-5dc8-b4dd-4429e99fa016', '63345a91-6706-5cf3-b26e-80174c36b2b5', NULL, 'LOCAL AUTHORITY', '2025-07-17'::date, 'Monthly', 'SAFETY', '0349822133', 3
WHERE NOT EXISTS (SELECT 1 FROM public.local_resources_contacts WHERE report_id='d4debf2d-f380-5dc8-b4dd-4429e99fa016' AND name='LOCAL AUTHORITY');

-- C2 loadshedding summary (no dated events in source)
INSERT INTO public.report_narratives (id, report_id, building_id, section_key, sort_order, heading, body)
SELECT gen_random_uuid(), 'd4debf2d-f380-5dc8-b4dd-4429e99fa016', '63345a91-6706-5cf3-b26e-80174c36b2b5', 'loadshedding', 1, 'Loadshedding', 'Stage 2 throughout the week (Mon-Sun). Total hours: 0. Diesel litres delivered: 0. Comment: None.'
WHERE NOT EXISTS (SELECT 1 FROM public.report_narratives WHERE report_id='d4debf2d-f380-5dc8-b4dd-4429e99fa016' AND section_key='loadshedding');

-- C3 maintenance & project items narrative
INSERT INTO public.report_narratives (id, report_id, building_id, section_key, sort_order, heading, body)
SELECT gen_random_uuid(), 'd4debf2d-f380-5dc8-b4dd-4429e99fa016', '63345a91-6706-5cf3-b26e-80174c36b2b5', 'maintenance_project', 1, 'Maintenance and Project Items', 'Road repairs currently taking place around the building.'
WHERE NOT EXISTS (SELECT 1 FROM public.report_narratives WHERE report_id='d4debf2d-f380-5dc8-b4dd-4429e99fa016' AND section_key='maintenance_project');

-- C5 centre security incidents — 6 monthly narratives combined into one section row
INSERT INTO public.report_narratives (id, report_id, building_id, section_key, sort_order, heading, body)
SELECT gen_random_uuid(), 'd4debf2d-f380-5dc8-b4dd-4429e99fa016', '63345a91-6706-5cf3-b26e-80174c36b2b5', 'security_incidents', 1, 'Centre Security Incidents (Jul-Dec 2025)', 'July 2025: 1. Junkies fought at Bus Rank 2. Handrail balluster damaged by brick 3. Drinking in public 4. 3 Theft cases at Bus Rank

August 2025: 1. Shoplifting arrest at Sportscene 2. Security car mirror got bumped by bus 3. Drinking in public 4. Urinating along fence/building 5. Truck ran over bollard

September 2025: 1. Drinking in public 2. Urinating along fence/building

October 2025: 1. Arrest of scammers 2. Drinking in public 3. Urinating along fence/building 4. Damage to parking cone

November 2025: 1. Arrests for theft and public indecency 2. Drinking in public 3. Urinating along fence/building

December 2025: 1. Arrests for theft 2. Drinking in public 3. Urinating along fence/building'
WHERE NOT EXISTS (SELECT 1 FROM public.report_narratives WHERE report_id='d4debf2d-f380-5dc8-b4dd-4429e99fa016' AND section_key='security_incidents');

-- C4 toilet_fund profit_per_roll
UPDATE public.toilet_fund SET profit_per_roll=55.79 WHERE report_id='d4debf2d-f380-5dc8-b4dd-4429e99fa016' AND profit_per_roll IS NULL;

-- C6 shop 15 fire_blanket malformed ',YES' -> 'yes'
UPDATE public.tenant_compliance tc SET fire_blanket='yes' FROM public.building_tenants bt
WHERE tc.tenant_id=bt.id AND bt.building_id='63345a91-6706-5cf3-b26e-80174c36b2b5' AND bt.shop_number='15' AND tc.fire_blanket IS NULL;

COMMIT;
