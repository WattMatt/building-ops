-- 2026-06-11_05_seed_form_submissions.sql
-- Mock populated form submissions for ZZTEST-Sandton Gate so the review flow,
-- status filters, and the build-202606111331 submitted-form export have content.
-- Shapes mirror exactly what the iOS app writes: form_data keys = field labels
-- from Models/FormTemplates.swift, flat scalar values, checkbox = bool,
-- signature = "Signed by <email>" or "" when unsigned (contract §2.2).
-- Statuses: 2× submitted, 1× approved, 1× rejected. Idempotent (fixed UUIDs).
begin;

insert into public.form_submissions
  (id, form_template_id, form_name, building_id, submitted_by, status, form_data, created_at, reviewed_by, reviewed_at, review_notes)
values
  -- 1. Daily Site Handover — submitted this morning
  ('3333cccc-0000-4000-8000-000000000001', '3', 'Daily Site Handover',
   'aaaa1111-0000-4000-8000-000000000001', '5b74d917-6d54-4a97-8bb6-c0918cbc98a3', 'submitted',
   $j$
   {"Date":"2026-06-11","Shift":"Day Shift","Outgoing Officer Name":"S. Dlamini","Incoming Officer Name":"P. Naidoo",
    "Handover Time":"06:00","Outstanding Tasks":"Replace globe in stairwell B; follow up on P1 leak (issue logged)",
    "Incidents During Shift":"None","Equipment Status":"All radios charged; CCTV monitor 2 flickering",
    "Key Items Handed Over":"Master key set, gate remote x2","Special Instructions":"Contractor expected 09:00 for chiller service quote",
    "Outgoing Officer Signature":"Signed by test@gmi.co.za","Incoming Officer Signature":"Signed by test@gmi.co.za"}
   $j$::jsonb,
   '2026-06-11T04:05:00+00:00', null, null, null),

  -- 2. Visitor Log — submitted mid-morning (visitor still on site: Time Out empty, badge not returned)
  ('3333cccc-0000-4000-8000-000000000002', '6', 'Visitor Log',
   'aaaa1111-0000-4000-8000-000000000001', '5b74d917-6d54-4a97-8bb6-c0918cbc98a3', 'submitted',
   $j$
   {"Date":"2026-06-11","Time In":"09:30","Visitor Name":"L. van Wyk","Company / Organisation":"ZZTEST FixIt (Pty) Ltd",
    "ID Type":"Driver's License","ID Number":"8203155042089","Host Name":"Centre Management","Host Department":"Operations",
    "Host Contact":"011 555 0100","Purpose of Visit":"Quote for chiller 250h service","Badge Number Issued":"V-014",
    "Time Out":"","Badge Returned":false,"Visitor Signature":"Signed by test@gmi.co.za","Security Officer":"S. Dlamini"}
   $j$::jsonb,
   '2026-06-11T07:40:00+00:00', null, null, null),

  -- 3. Incident Report — approved yesterday (ties to the seeded P1 leak issue)
  ('3333cccc-0000-4000-8000-000000000003', '8', 'Incident Report',
   'aaaa1111-0000-4000-8000-000000000001', '5b74d917-6d54-4a97-8bb6-c0918cbc98a3', 'approved',
   $j$
   {"Date of Incident":"2026-06-10","Time of Incident":"11:15","Location":"Parking level P1, bay 14",
    "Incident Type":"Property Damage","Severity":"Moderate","Persons Involved":"None - area cordoned off",
    "Witnesses":"Cleaner on duty (R. Mokoena)","Description of Incident":"Water pooling from suspected geyser line above bay 14; ceiling board sagging",
    "Immediate Actions Taken":"Area cordoned, water main to riser closed, issue logged in app",
    "Root Cause Analysis":"Corroded fitting on 22mm geyser feed","Corrective Actions Required":"Replace fitting and pressure-test line; assess ceiling board",
    "First Aid Administered":false,"Emergency Services Called":false,"Reporter Name":"S. Dlamini",
    "Reporter Signature":"Signed by test@gmi.co.za","Manager Review Signature":"Signed by arno@wmeng.co.za"}
   $j$::jsonb,
   '2026-06-10T09:20:00+00:00',
   '3d4987f9-c21f-40e9-ac9c-1ec201e5f550', '2026-06-10T13:20:00+00:00',
   'Verified on site. Contractor briefed for repair quote - approved for records.'),

  -- 4. Cleaning & Hygiene Log — rejected (supervisor check missing)
  ('3333cccc-0000-4000-8000-000000000004', '5', 'Cleaning & Hygiene Log',
   'aaaa1111-0000-4000-8000-000000000001', '5b74d917-6d54-4a97-8bb6-c0918cbc98a3', 'rejected',
   $j$
   {"Date":"2026-06-09","Time":"14:30","Area / Location":"Ground floor restrooms","Cleaning Type":"Routine",
    "Cleaner Name":"R. Mokoena","Floors Mopped":true,"Surfaces Wiped":true,"Bins Emptied":true,
    "Consumables Restocked":false,"Consumables Notes":"Paper towel stock low - reorder placed",
    "Issues Found":"Loose tap handle, basin 2","Supervisor Check":false,
    "Cleaner Signature":"Signed by test@gmi.co.za","Supervisor Signature":""}
   $j$::jsonb,
   '2026-06-09T12:45:00+00:00',
   '3d4987f9-c21f-40e9-ac9c-1ec201e5f550', '2026-06-09T14:10:00+00:00',
   'Supervisor check missing - re-submit after supervisor sign-off.')
on conflict (id) do nothing;

commit;
