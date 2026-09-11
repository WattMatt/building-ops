-- 2026-06-18_04_abaqulusi_ops_repairs.sql
-- AbaQulusi gap-fill STEP 4 — OPS repairs (GAP_REGISTER O1-O7). Matches by business keys (staging/prod-agnostic). Idempotent.
BEGIN;

-- O1 remove 4 fabricated PPM 'done' markers (source month grids are empty)
UPDATE public.ppm_services SET months = months - '2025-10' WHERE building_id='63345a91-6706-5cf3-b26e-80174c36b2b5' AND service_name='Domestic pump set';
UPDATE public.ppm_services SET months = months - '2025-11' WHERE building_id='63345a91-6706-5cf3-b26e-80174c36b2b5' AND service_name='Roller shutters';
UPDATE public.ppm_services SET months = months - '2025-09' WHERE building_id='63345a91-6706-5cf3-b26e-80174c36b2b5' AND service_name='Smoke vents & extraction fans';
UPDATE public.ppm_services SET months = months - '2025-07' WHERE building_id='63345a91-6706-5cf3-b26e-80174c36b2b5' AND service_name ILIKE 'Window cleaning%';

-- O2/O3 PPM comments verbatim from source col O (replace dropped/paraphrased)
UPDATE public.ppm_services SET comment='As per the budget, 169 HRS running hrs to the next service' WHERE building_id='63345a91-6706-5cf3-b26e-80174c36b2b5' AND service_name='Generators';
UPDATE public.ppm_services SET comment='Next Infra red Scan to be done in March 2026' WHERE building_id='63345a91-6706-5cf3-b26e-80174c36b2b5' AND service_name='Infra red scanning';
UPDATE public.ppm_services SET comment='Requested service certificates from tenants.
Serviced every 6 Months' WHERE building_id='63345a91-6706-5cf3-b26e-80174c36b2b5' AND service_name='Smoke vents & extraction fans';
UPDATE public.ppm_services SET comment='This needs to be implemented yearly' WHERE building_id='63345a91-6706-5cf3-b26e-80174c36b2b5' AND service_name='Transformers';
UPDATE public.ppm_services SET comment='Clearwater pumps was appointed to do the testing, testing was done in April, awaiting results.' WHERE building_id='63345a91-6706-5cf3-b26e-80174c36b2b5' AND service_name='Water treatment plant';

-- O4 borehole yield transposition: source value 1812.88 is Actual (not Predicted)
UPDATE public.utility_yields SET predicted_yield=NULL, actual_yield=1812.88, comment='awaiting new Yeild test.' WHERE report_id='83d6d2c5-50fe-53f7-9976-3f1157270baf' AND source='borehole';

-- O5 water-bulk Difference = -1 (Council Bulk + Bulk Check); propagate merged comment to Bulk Check
UPDATE public.utility_readings SET difference=-1 WHERE report_id='83d6d2c5-50fe-53f7-9976-3f1157270baf' AND utility='water' AND category='bulk' AND meter_name='Council Bulk';
UPDATE public.utility_readings SET difference=-1, comment='Need to investigate if we have a bulk meter' WHERE report_id='83d6d2c5-50fe-53f7-9976-3f1157270baf' AND utility='water' AND category='bulk' AND meter_name='Bulk Check';

-- O6 building inspection header: date 12 Aug 2025; inspector name has no uuid column -> reports.meta
UPDATE public.building_inspections SET inspection_date='2025-08-12' WHERE report_id='83d6d2c5-50fe-53f7-9976-3f1157270baf';
UPDATE public.reports SET meta = coalesce(meta,'{}'::jsonb) || '{"building_inspected_by":"Wesley Sykes"}'::jsonb WHERE id='83d6d2c5-50fe-53f7-9976-3f1157270baf';

-- O7 expense SMOKE VENT records_uploaded false (source blank) -> NULL
UPDATE public.expense_recoveries SET records_uploaded=NULL WHERE report_id='83d6d2c5-50fe-53f7-9976-3f1157270baf' AND service='SMOKE VENT SERVICE';

COMMIT;
