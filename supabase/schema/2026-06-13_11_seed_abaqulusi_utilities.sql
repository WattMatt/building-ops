-- ============================================================================
-- Fortress — 11: AbaQulusi utilities (REAL, parsed from OPS Utilities sheet)
-- scripts/fortress_ingest/generate_abaqulusi_utilities.py. Idempotent.
-- ============================================================================

insert into public.utility_readings (id, report_id, building_id, utility, meter_name, reading, unit, category, pct_of_bulk, comment) values
  ('eee41f84-f07b-5476-9c7f-02fd10255387', '83d6d2c5-50fe-53f7-9976-3f1157270baf', '63345a91-6706-5cf3-b26e-80174c36b2b5', 'water', 'Council Bulk', 0.0, 'KL', 'bulk', null, 'Need to investigate if we have a bulk meter'),
  ('663f5ab0-148c-5716-bda5-3b5a43266645', '83d6d2c5-50fe-53f7-9976-3f1157270baf', '63345a91-6706-5cf3-b26e-80174c36b2b5', 'water', 'Bulk Check', 302.76, 'KL', 'bulk', null, null),
  ('0430b3d4-a00d-5a25-a32a-56b208d505d7', '83d6d2c5-50fe-53f7-9976-3f1157270baf', '63345a91-6706-5cf3-b26e-80174c36b2b5', 'water', 'Site Daily Reading Total', 1894.25, 'KL', 'bulk', null, null),
  ('7c1aed79-2ba3-5a86-9155-228f37b45fbd', '83d6d2c5-50fe-53f7-9976-3f1157270baf', '63345a91-6706-5cf3-b26e-80174c36b2b5', 'electricity', 'Council Bulk', null, 'KWh', 'bulk', null, 'Not Online'),
  ('36f459c3-7963-50b4-9dd2-bf951b5f462a', '83d6d2c5-50fe-53f7-9976-3f1157270baf', '63345a91-6706-5cf3-b26e-80174c36b2b5', 'electricity', 'Bulk Check', 69725.93, 'KWh', 'bulk', null, null),
  ('297dfc7e-80f7-5431-868f-2713b697e4cc', '83d6d2c5-50fe-53f7-9976-3f1157270baf', '63345a91-6706-5cf3-b26e-80174c36b2b5', 'water', 'Borehole meter', 1812.88, 'KL', 'bulk', null, null),
  ('498a2a9f-a6f5-582f-979e-450752a87525', '83d6d2c5-50fe-53f7-9976-3f1157270baf', '63345a91-6706-5cf3-b26e-80174c36b2b5', 'water', 'Tenant Meters', 944.0, 'KL', 'tenant', 44.6, null),
  ('8d78fef1-e2e0-5d30-a521-9950ec2d22c7', '83d6d2c5-50fe-53f7-9976-3f1157270baf', '63345a91-6706-5cf3-b26e-80174c36b2b5', 'water', 'Common Area', 1172.0, 'KL', 'common_area', 55.4, null),
  ('fbf670d4-3909-59e2-a7a1-d59bd004e093', '83d6d2c5-50fe-53f7-9976-3f1157270baf', '63345a91-6706-5cf3-b26e-80174c36b2b5', 'water', 'Unmetered Water', 205.0, 'KL', 'unmetered', 17.5, null),
  ('b9e2440b-b4c1-5b41-8669-7b44dcc493b2', '83d6d2c5-50fe-53f7-9976-3f1157270baf', '63345a91-6706-5cf3-b26e-80174c36b2b5', 'water', 'Ablutions', 677.0, 'KL', 'common_area', 57.8, null),
  ('4b4b80e6-d885-5d80-baa0-a736b0414cce', '83d6d2c5-50fe-53f7-9976-3f1157270baf', '63345a91-6706-5cf3-b26e-80174c36b2b5', 'water', 'Other metered common area', 288.0, 'KL', 'common_area', 24.6, 'Garden watered through common area; taxi consumption recovered through common area'),
  ('e539762d-e2e6-5daa-b354-79fc2301ed29', '83d6d2c5-50fe-53f7-9976-3f1157270baf', '63345a91-6706-5cf3-b26e-80174c36b2b5', 'water', 'Bulk Check (Night Usage)', 124.57, 'KL', 'night_usage', null, '22:00 - 06:00, as per console')
on conflict (id) do nothing;

insert into public.utility_yields (id, report_id, building_id, source, predicted_yield, actual_yield, pct_achieved, unit, comment) values
  ('1c4b342c-74fa-5ad3-afed-89c277d1efaa', '83d6d2c5-50fe-53f7-9976-3f1157270baf', '63345a91-6706-5cf3-b26e-80174c36b2b5', 'borehole', 1812.88, null, null, 'KL', 'Awaiting new yield test'),
  ('7cef31bd-7779-5dd7-a15c-856b00a680fc', '83d6d2c5-50fe-53f7-9976-3f1157270baf', '63345a91-6706-5cf3-b26e-80174c36b2b5', 'solar', 128166.0, 116212.08, 90.7, 'KWh', 'Need to check the predicted yield again')
on conflict (id) do nothing;
