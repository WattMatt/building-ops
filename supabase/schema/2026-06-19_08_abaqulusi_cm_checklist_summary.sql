-- 2026-06-19_08: ingest the AbaQulusi CM (Dec 2025) "Checklist Summary" (Building Overview tab,
-- rows 79-84) into report_checklist_items so it renders in the CM report's new General Checklist
-- section (added to cm_monthly REPORT_SECTIONS in the web app). Values verbatim from source.
-- Idempotent: clears + re-inserts this report's checklist_summary rows. CM report d4debf2d.
delete from public.report_checklist_items
where report_id = 'd4debf2d-f380-5dc8-b4dd-4429e99fa016' and section_key = 'checklist_summary';

insert into public.report_checklist_items
  (id, report_id, building_id, section_key, item_key, sort_order, value_date, response)
values
  -- date-based inspection items (source D80-D84)
  (gen_random_uuid(),'d4debf2d-f380-5dc8-b4dd-4429e99fa016','63345a91-6706-5cf3-b26e-80174c36b2b5','checklist_summary','ROOF INSPECTION',1,'2025-10-14',null),
  (gen_random_uuid(),'d4debf2d-f380-5dc8-b4dd-4429e99fa016','63345a91-6706-5cf3-b26e-80174c36b2b5','checklist_summary','NIGHT INSPECTION',2,'2025-10-17',null),
  (gen_random_uuid(),'d4debf2d-f380-5dc8-b4dd-4429e99fa016','63345a91-6706-5cf3-b26e-80174c36b2b5','checklist_summary','METER READING DATE',3,'2025-10-27',null),
  (gen_random_uuid(),'d4debf2d-f380-5dc8-b4dd-4429e99fa016','63345a91-6706-5cf3-b26e-80174c36b2b5','checklist_summary','PROJECT START DATE',4,'2022-07-11',null),
  (gen_random_uuid(),'d4debf2d-f380-5dc8-b4dd-4429e99fa016','63345a91-6706-5cf3-b26e-80174c36b2b5','checklist_summary','DATE OF LAST EXPIRED STOCK CHECK',5,'2025-10-18',null),
  -- daily/weekly Y/N site checks (source I79-I84 = Y)
  (gen_random_uuid(),'d4debf2d-f380-5dc8-b4dd-4429e99fa016','63345a91-6706-5cf3-b26e-80174c36b2b5','checklist_summary','OB BOOK CHECKED DAILY',6,null,'yes'),
  (gen_random_uuid(),'d4debf2d-f380-5dc8-b4dd-4429e99fa016','63345a91-6706-5cf3-b26e-80174c36b2b5','checklist_summary','WATER METER READINGS CHECKED DAILY',7,null,'yes'),
  (gen_random_uuid(),'d4debf2d-f380-5dc8-b4dd-4429e99fa016','63345a91-6706-5cf3-b26e-80174c36b2b5','checklist_summary','STAFF REGISTERS SIGNED AND CHECKED DAILY',8,null,'yes'),
  (gen_random_uuid(),'d4debf2d-f380-5dc8-b4dd-4429e99fa016','63345a91-6706-5cf3-b26e-80174c36b2b5','checklist_summary','WEEKLY SERVICE PROVIDER MEETINGS MINUTES AVAILABLE',9,null,'yes'),
  (gen_random_uuid(),'d4debf2d-f380-5dc8-b4dd-4429e99fa016','63345a91-6706-5cf3-b26e-80174c36b2b5','checklist_summary','WEEKLY GENERATOR TEST DONE',10,null,'yes'),
  (gen_random_uuid(),'d4debf2d-f380-5dc8-b4dd-4429e99fa016','63345a91-6706-5cf3-b26e-80174c36b2b5','checklist_summary','WEEKLY ROOF LEAKS SCHEDULE SENT TO HO OPS',11,null,'yes');
