-- Wave 7 (battle-test 2026-06-14): seed AbaQulusi Plaza PPM services into the OPS report.
-- FAITHFUL to source: the OPS "PPM" sheet encodes completion as cell fill-colour. Only
-- GREEN ("service done") cells are reliably readable (7 services); the rest are left blank
-- (no asserted status) rather than fabricated. Fiscal-year grid Jul-2025..Jun-2026.
-- Idempotent via ON CONFLICT (report_id, service_name).
insert into public.ppm_services (report_id, building_id, service_name, frequency, comment, months, sort_order)
values
  ('83d6d2c5-50fe-53f7-9976-3f1157270baf','63345a91-6706-5cf3-b26e-80174c36b2b5','Aircon audit',null,null,'{}'::jsonb,1),
  ('83d6d2c5-50fe-53f7-9976-3f1157270baf','63345a91-6706-5cf3-b26e-80174c36b2b5','Aircon minor',null,'Order 1340595 released','{"2025-08":{"status":"done"}}'::jsonb,2),
  ('83d6d2c5-50fe-53f7-9976-3f1157270baf','63345a91-6706-5cf3-b26e-80174c36b2b5','Aircon major',null,null,'{}'::jsonb,3),
  ('83d6d2c5-50fe-53f7-9976-3f1157270baf','63345a91-6706-5cf3-b26e-80174c36b2b5','Annexure B inspection',null,null,'{}'::jsonb,4),
  ('83d6d2c5-50fe-53f7-9976-3f1157270baf','63345a91-6706-5cf3-b26e-80174c36b2b5','Booster pumps',null,null,'{}'::jsonb,5),
  ('83d6d2c5-50fe-53f7-9976-3f1157270baf','63345a91-6706-5cf3-b26e-80174c36b2b5','Borehole pump',null,'Service done 24/04/2025','{"2025-08":{"status":"done"}}'::jsonb,6),
  ('83d6d2c5-50fe-53f7-9976-3f1157270baf','63345a91-6706-5cf3-b26e-80174c36b2b5','Compactor minor',null,null,'{}'::jsonb,7),
  ('83d6d2c5-50fe-53f7-9976-3f1157270baf','63345a91-6706-5cf3-b26e-80174c36b2b5','Compactor major',null,null,'{}'::jsonb,8),
  ('83d6d2c5-50fe-53f7-9976-3f1157270baf','63345a91-6706-5cf3-b26e-80174c36b2b5','Cherry picker & scissors lift',null,null,'{}'::jsonb,9),
  ('83d6d2c5-50fe-53f7-9976-3f1157270baf','63345a91-6706-5cf3-b26e-80174c36b2b5','Domestic pump set',null,null,'{"2025-10":{"status":"done"}}'::jsonb,10),
  ('83d6d2c5-50fe-53f7-9976-3f1157270baf','63345a91-6706-5cf3-b26e-80174c36b2b5','Fire equipment',null,null,'{}'::jsonb,11),
  ('83d6d2c5-50fe-53f7-9976-3f1157270baf','63345a91-6706-5cf3-b26e-80174c36b2b5','Generators',null,'169 running hrs to next service','{"2025-08":{"status":"done"}}'::jsonb,12),
  ('83d6d2c5-50fe-53f7-9976-3f1157270baf','63345a91-6706-5cf3-b26e-80174c36b2b5','Infra red scanning',null,'Next scan March 2026','{}'::jsonb,13),
  ('83d6d2c5-50fe-53f7-9976-3f1157270baf','63345a91-6706-5cf3-b26e-80174c36b2b5','Lifts',null,null,'{}'::jsonb,14),
  ('83d6d2c5-50fe-53f7-9976-3f1157270baf','63345a91-6706-5cf3-b26e-80174c36b2b5','Smoke vents & extraction fans','6-monthly',null,'{"2025-09":{"status":"done"}}'::jsonb,15),
  ('83d6d2c5-50fe-53f7-9976-3f1157270baf','63345a91-6706-5cf3-b26e-80174c36b2b5','Sprinkler engine',null,null,'{}'::jsonb,16),
  ('83d6d2c5-50fe-53f7-9976-3f1157270baf','63345a91-6706-5cf3-b26e-80174c36b2b5','Sprinkler valve',null,'Only to be serviced in 2026','{}'::jsonb,17),
  ('83d6d2c5-50fe-53f7-9976-3f1157270baf','63345a91-6706-5cf3-b26e-80174c36b2b5','Structural inspection',null,null,'{}'::jsonb,18),
  ('83d6d2c5-50fe-53f7-9976-3f1157270baf','63345a91-6706-5cf3-b26e-80174c36b2b5','Sewer line jetting',null,null,'{}'::jsonb,19),
  ('83d6d2c5-50fe-53f7-9976-3f1157270baf','63345a91-6706-5cf3-b26e-80174c36b2b5','Smoke detection systems',null,null,'{}'::jsonb,20),
  ('83d6d2c5-50fe-53f7-9976-3f1157270baf','63345a91-6706-5cf3-b26e-80174c36b2b5','Transformers','annually','To be implemented yearly','{}'::jsonb,21),
  ('83d6d2c5-50fe-53f7-9976-3f1157270baf','63345a91-6706-5cf3-b26e-80174c36b2b5','Water treatment plant',null,null,'{}'::jsonb,22),
  ('83d6d2c5-50fe-53f7-9976-3f1157270baf','63345a91-6706-5cf3-b26e-80174c36b2b5','Waterproofing guarantee',null,null,'{}'::jsonb,23),
  ('83d6d2c5-50fe-53f7-9976-3f1157270baf','63345a91-6706-5cf3-b26e-80174c36b2b5','Window cleaning and high level cleaning',null,null,'{"2025-07":{"status":"done"}}'::jsonb,24),
  ('83d6d2c5-50fe-53f7-9976-3f1157270baf','63345a91-6706-5cf3-b26e-80174c36b2b5','Roller shutters',null,null,'{"2025-11":{"status":"done"}}'::jsonb,25)
on conflict (report_id, service_name) do update
  set frequency = excluded.frequency,
      comment   = excluded.comment,
      months    = excluded.months,
      sort_order= excluded.sort_order,
      updated_at= now();
