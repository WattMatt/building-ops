-- 2026-06-14_11_ingest_cm_remainder.sql
-- Fortress CM (Centre Management) Report — close remaining ingest gaps for AbaQulusi Plaza.
-- Source: 'Fortress spec docs/ABAQULUSI - CM Report Dec 2025 master copy.xlsx'.
-- CM report: d4debf2d-f380-5dc8-b4dd-4429e99fa016, building: 63345a91-6706-5cf3-b26e-80174c36b2b5.
-- Idempotent: NULL-guarded UPDATEs; ON CONFLICT / NOT EXISTS on inserts. Deterministic ids (uuid5).
BEGIN;

-- ============================================================
-- TASK 4 — tenant_turnover.gla (NULL-guarded, matched by tenant_name).
-- GLA is NOT on CM Page 2 (turnover tables have no GLA column); sourced from the
-- OHS & HK sheet (col C) and matched by tenant name. Only confident 1:1 matches applied.
-- Skipped (reported, not fabricated): CASHBUILD, PICARDI REBEL LIQUORS, NR CELL CLINX, PROFUMO.
-- ============================================================
UPDATE tenant_turnover SET gla = 2066, updated_at = now()
  WHERE report_id = 'd4debf2d-f380-5dc8-b4dd-4429e99fa016'::uuid AND tenant_name = 'BOXER' AND gla IS NULL;
UPDATE tenant_turnover SET gla = 2488, updated_at = now()
  WHERE report_id = 'd4debf2d-f380-5dc8-b4dd-4429e99fa016'::uuid AND tenant_name = 'SHOPRITE' AND gla IS NULL;
UPDATE tenant_turnover SET gla = 230, updated_at = now()
  WHERE report_id = 'd4debf2d-f380-5dc8-b4dd-4429e99fa016'::uuid AND tenant_name = 'SHOPRITE LIQ  SHOP' AND gla IS NULL;
UPDATE tenant_turnover SET gla = 60, updated_at = now()
  WHERE report_id = 'd4debf2d-f380-5dc8-b4dd-4429e99fa016'::uuid AND tenant_name = 'CELL-TECH' AND gla IS NULL;
UPDATE tenant_turnover SET gla = 61, updated_at = now()
  WHERE report_id = 'd4debf2d-f380-5dc8-b4dd-4429e99fa016'::uuid AND tenant_name = 'ULTIMATE HAIR SALON' AND gla IS NULL;
UPDATE tenant_turnover SET gla = 68, updated_at = now()
  WHERE report_id = 'd4debf2d-f380-5dc8-b4dd-4429e99fa016'::uuid AND tenant_name = 'HOMESYNC ESSENTIALS' AND gla IS NULL;

-- ============================================================
-- TASK 5a — CM Building Overview narrative (report_narratives, section_key='building_overview').
-- ============================================================
INSERT INTO report_narratives (id, report_id, building_id, section_key, heading, body)
SELECT '96a839d2-b963-52ef-978e-9f3f48c2cf72'::uuid, 'd4debf2d-f380-5dc8-b4dd-4429e99fa016'::uuid, '63345a91-6706-5cf3-b26e-80174c36b2b5'::uuid,
       'building_overview', 'Building Overview', 'Provide the reader with an overview of how the centre is preforming :-AbaQulusi Plaza is a single-level,double-anchored enclosed communter mall. AbaQulusi Plaza plays an important part in the northern KZN transport route with long and short distance taxis as well as local and long distance buses operating within the mall.Even though Vryheid is regarged as rural town which used to mainly focus on mining,agriculture and cattle ranching located within Zululand District under the AbaQulisi municipality which is the main service and retail as well as transport hub aimed at commuters convenience with the goal of integrating the northern KZN transport network for the homeward bound commuters. This intermodal transport facility can accommodate over 300 taxis and close to 100 buses per day.
a. short introduction and information regarding the centre :-
                    i.  AbaQulusi Plaza is situated in Vryheid CBD corner Mason & Utrecht st at centre of AbaQulusi municipality with current GLA of 16908sqm.
                    ii. Target market is LSM 5-7 currently services black lower to middle class there is huge room for growth due to the young population still looking for opportunities.
                    iii.Anchor tenats are Shoprite and Boxer superstore with national retailers such Clicks,Capitec bank,Woolworths Edit,TFG,PEPKOR & Studio88 groups.

b. Things happening in the Centre:- 
          i. AbaQulusi Plaza re-opened it doors on 22/11/23 housing just above 49 retail outlets and well over 200 trader stands with interntion to uplift the local traders.
          ii. AbaQulusi community has pride in this building as they still refer to it as   "iPlaza yethu"
          iii.The local&long distance taxi rank and bus terminals is in full operation with most commuters now embracing the change.

c. Things happening in the area :- The other mall is in operational since 31/10/2024 indeed it seems to be attracting the upper class with more of lower class choosing to shop at the Plaza and town.We compared the 3 Shoprites in Vryheid and concluded that Plaza shoprite took the most in October.

d. There has not been strikes no protests

e. Customer feedback :- Most customers are attracted by the convenience to taxi and bus routes and how the building connects to the rank,easy to navigate as well as close proximity to city centre.The other mall is now operational so far this has not had that much of negative effect on the foot traffic though upper CBD is most affected by vacant spaces.Currently Nedbank moved all it operations to the other mall customers have requested that Plaza looks into getting more Nedbank and FNB ATMs which do deposits.They were excited that we have a Capitec Bank branch being the only one in the city centre.Our groceries tenants benefitted with this current exodus as witnessed by our inspections of the cbd and the other mall during busy days.'
WHERE NOT EXISTS (
  SELECT 1 FROM report_narratives WHERE report_id = 'd4debf2d-f380-5dc8-b4dd-4429e99fa016'::uuid AND section_key = 'building_overview');

-- ============================================================
-- TASK 5b — CM 'Checklist Summary' items (report_checklist_items, section_key='checklist_summary').
-- Source: Building Overview sheet rows 79-84 (date items col A/D; Y/N items col F/I).
-- item_key = label slug (canonical key reused where the OPS set has one: roof/night inspection).
-- WARMS dashboard line carries no value in source -> inserted with null value (line exists, unvalued).
-- ============================================================
INSERT INTO report_checklist_items (report_id, building_id, section_key, item_key, sort_order, value_date, value_text, response)
VALUES ('d4debf2d-f380-5dc8-b4dd-4429e99fa016'::uuid, '63345a91-6706-5cf3-b26e-80174c36b2b5'::uuid, 'checklist_summary', 'warms_dashboard_checked_and_distributed_on', 0, NULL, NULL, NULL)
ON CONFLICT (report_id, section_key, item_key) DO NOTHING;  -- WARMS DASHBOARD CHECKED AND DISTRIBUTED ON
INSERT INTO report_checklist_items (report_id, building_id, section_key, item_key, sort_order, value_date, value_text, response)
VALUES ('d4debf2d-f380-5dc8-b4dd-4429e99fa016'::uuid, '63345a91-6706-5cf3-b26e-80174c36b2b5'::uuid, 'checklist_summary', 'last_roof_inspection', 1, '2025-10-14'::date, NULL, NULL)
ON CONFLICT (report_id, section_key, item_key) DO NOTHING;  -- ROOF INSPECTION
INSERT INTO report_checklist_items (report_id, building_id, section_key, item_key, sort_order, value_date, value_text, response)
VALUES ('d4debf2d-f380-5dc8-b4dd-4429e99fa016'::uuid, '63345a91-6706-5cf3-b26e-80174c36b2b5'::uuid, 'checklist_summary', 'last_night_inspection', 2, '2025-10-17'::date, NULL, NULL)
ON CONFLICT (report_id, section_key, item_key) DO NOTHING;  -- NIGHT INSPECTION
INSERT INTO report_checklist_items (report_id, building_id, section_key, item_key, sort_order, value_date, value_text, response)
VALUES ('d4debf2d-f380-5dc8-b4dd-4429e99fa016'::uuid, '63345a91-6706-5cf3-b26e-80174c36b2b5'::uuid, 'checklist_summary', 'meter_reading_date', 3, '2025-10-27'::date, NULL, NULL)
ON CONFLICT (report_id, section_key, item_key) DO NOTHING;  -- METER READING DATE
INSERT INTO report_checklist_items (report_id, building_id, section_key, item_key, sort_order, value_date, value_text, response)
VALUES ('d4debf2d-f380-5dc8-b4dd-4429e99fa016'::uuid, '63345a91-6706-5cf3-b26e-80174c36b2b5'::uuid, 'checklist_summary', 'project_start_date', 4, '2022-07-11'::date, NULL, NULL)
ON CONFLICT (report_id, section_key, item_key) DO NOTHING;  -- PROJECT START DATE
INSERT INTO report_checklist_items (report_id, building_id, section_key, item_key, sort_order, value_date, value_text, response)
VALUES ('d4debf2d-f380-5dc8-b4dd-4429e99fa016'::uuid, '63345a91-6706-5cf3-b26e-80174c36b2b5'::uuid, 'checklist_summary', 'date_of_last_expired_stock_check', 5, '2025-10-18'::date, NULL, NULL)
ON CONFLICT (report_id, section_key, item_key) DO NOTHING;  -- DATE OF LAST EXPIRED STOCK CHECK
INSERT INTO report_checklist_items (report_id, building_id, section_key, item_key, sort_order, value_date, value_text, response)
VALUES ('d4debf2d-f380-5dc8-b4dd-4429e99fa016'::uuid, '63345a91-6706-5cf3-b26e-80174c36b2b5'::uuid, 'checklist_summary', 'ob_booked_checked_daily', 6, NULL, NULL, 'yes')
ON CONFLICT (report_id, section_key, item_key) DO NOTHING;  -- OB BOOKED CHECKED DAILY
INSERT INTO report_checklist_items (report_id, building_id, section_key, item_key, sort_order, value_date, value_text, response)
VALUES ('d4debf2d-f380-5dc8-b4dd-4429e99fa016'::uuid, '63345a91-6706-5cf3-b26e-80174c36b2b5'::uuid, 'checklist_summary', 'water_meter_readings_checked_daily', 7, NULL, NULL, 'yes')
ON CONFLICT (report_id, section_key, item_key) DO NOTHING;  -- WATER METER READINGS CHECKED DAILY
INSERT INTO report_checklist_items (report_id, building_id, section_key, item_key, sort_order, value_date, value_text, response)
VALUES ('d4debf2d-f380-5dc8-b4dd-4429e99fa016'::uuid, '63345a91-6706-5cf3-b26e-80174c36b2b5'::uuid, 'checklist_summary', 'staff_registers_signed_and_checked_daily', 8, NULL, NULL, 'yes')
ON CONFLICT (report_id, section_key, item_key) DO NOTHING;  -- STAFF REGISTERS SIGNED AND CHECKED DAILY
INSERT INTO report_checklist_items (report_id, building_id, section_key, item_key, sort_order, value_date, value_text, response)
VALUES ('d4debf2d-f380-5dc8-b4dd-4429e99fa016'::uuid, '63345a91-6706-5cf3-b26e-80174c36b2b5'::uuid, 'checklist_summary', 'weekly_service_provider_meetings_minutes_available', 9, NULL, NULL, 'yes')
ON CONFLICT (report_id, section_key, item_key) DO NOTHING;  -- WEEKLY SERVICE PROVIDER MEETINGS MINUTES AVAILABLE
INSERT INTO report_checklist_items (report_id, building_id, section_key, item_key, sort_order, value_date, value_text, response)
VALUES ('d4debf2d-f380-5dc8-b4dd-4429e99fa016'::uuid, '63345a91-6706-5cf3-b26e-80174c36b2b5'::uuid, 'checklist_summary', 'weekly_generator_test_done', 10, NULL, NULL, 'yes')
ON CONFLICT (report_id, section_key, item_key) DO NOTHING;  -- WEEKLY GENERATOR TEST DONE
INSERT INTO report_checklist_items (report_id, building_id, section_key, item_key, sort_order, value_date, value_text, response)
VALUES ('d4debf2d-f380-5dc8-b4dd-4429e99fa016'::uuid, '63345a91-6706-5cf3-b26e-80174c36b2b5'::uuid, 'checklist_summary', 'weekly_roof_leaks_schedule_sent_to_ho_ops', 11, NULL, NULL, 'yes')
ON CONFLICT (report_id, section_key, item_key) DO NOTHING;  -- WEEKLY ROOF LEAKS  SCHEDULE SENT TO HO OPS

COMMIT;