-- 2026-06-15_02_annual_fieldkeys_cleanup.sql
-- Annual Condition Inspection (AbaQulusi Plaza 2025) per-item field-key cleanup.
-- Report:     b42c47f6-f2fc-516a-a300-d9535d5fd96d
-- Template:   70cb0226-77c6-5156-8c8b-ffcad6e4ef47
-- Inspection: 9afae910-cf7b-5997-9dcd-042d9a195bee
--
-- Three fixes (idempotent, data-preserving):
--   1. Remove junk "N/A" field key (mis-parsed cell) from field_keys AND from response detail.
--   2. Complete the field set from the source workbook for NON-MATRIX items
--      (fuzzy-dedup against existing keys; existing keys untouched, new appended).
--   3. De-dupe matrix items (6.6/11.2/12.4/17.1): remove a base key only when a
--      "<base> — …" variant exists AND the base carries no non-empty detail value.
--      (None qualified here — every base key is data-backed — so no matrix removals.)
--
-- HARD INVARIANT (verified before+after on staging & prod): every key in each response
-- detail remains present in its item field_keys (detail_keys_not_in_fieldkeys = 0).

BEGIN;

-- ── Fix 1: drop junk "N/A" key from captured detail (idempotent) ──
UPDATE public.inspection_responses SET detail = detail - 'N/A'
  WHERE inspection_id = '9afae910-cf7b-5997-9dcd-042d9a195bee' AND template_item_id = 'db956b00-b1ef-5232-91b1-f1c2ded1c1f3' AND detail ? 'N/A';  -- item 4.1
UPDATE public.inspection_responses SET detail = detail - 'N/A'
  WHERE inspection_id = '9afae910-cf7b-5997-9dcd-042d9a195bee' AND template_item_id = '7782b9df-ce4d-5f18-a0e3-35200898b31f' AND detail ? 'N/A';  -- item 5.3
UPDATE public.inspection_responses SET detail = detail - 'N/A'
  WHERE inspection_id = '9afae910-cf7b-5997-9dcd-042d9a195bee' AND template_item_id = 'd2ebf93d-9824-5df6-b35a-fc039f87aae0' AND detail ? 'N/A';  -- item 23
UPDATE public.inspection_responses SET detail = detail - 'N/A'
  WHERE inspection_id = '9afae910-cf7b-5997-9dcd-042d9a195bee' AND template_item_id = '8b85f57b-d9da-53b9-bfe4-f0536b889eb9' AND detail ? 'N/A';  -- item 24

-- ── field_keys rewrites (final desired array per item; ordered: existing kept, new appended) ──
-- item 4.1 "Fire Detection System"  (16→16; −1 (N/A) +1)
UPDATE public.inspection_template_items SET field_keys = '["As built plan available","Brief description of how the system operates","Cost Recovery: Tenant specific / part of ops cost","Current status: (Good, Fair, Poor)","General comment","Inspection checklist: Daily/weekly/monthly","Last date serviced","Make & model of panels","Next service due","Number of detectors","Service fee cost","Service frequency","Service provider / contractor / installed by","Type of detectors (specify how many you have of each type of detector e.g., 10 Smoke, 10 heat etc.)","Type of system installed","Photo (s) reference number:"]'::jsonb
  WHERE id = 'db956b00-b1ef-5232-91b1-f1c2ded1c1f3';
-- item 4.2 "Smoke Vents or Mechanical Extraction"  (15→16; +1)
UPDATE public.inspection_template_items SET field_keys = '["As built plan available","Brief description of how the system operates","Cost Recovery: Tenant specific / part of ops cost","Current status: (Good, Fair, Poor)","General comment","If mechanical extraction units are installed, specify number of units per tenant","If vents are installed, specify number of vents per tenant","Inspection checklist: Daily/Weekly/Monthly","Last date serviced","Make & model","Next service due","Service fee cost","Service frequency","Service provider / contractor / installed by","Type of system installed","Photo (s) reference number:"]'::jsonb
  WHERE id = '3f616fc2-b974-5686-ab1d-95cec5239efd';
-- item 4.3 "Extinguishers & Hose Reels & Hydrants"  (16→17; +1)
UPDATE public.inspection_template_items SET field_keys = '["Cost Recovery: Tenant specific / part of ops cost","Current status: (Good, Fair, Poor)","General comments","Give a brief description of how the system operates","Inspection checklist: Daily/weekly/monthly","Last date serviced","Last service certificate obtained","Location plan available","Next service due","Number and type of fire extinguishers for tenants","Number and type of fire extinguishers on the premises","Number of fire hose reels in building","Number of hydrants on the premises","Service fee cost","Service frequency","Service provider / contractor / installed by","Photo (s) reference number:"]'::jsonb
  WHERE id = 'f3c73154-2835-548e-8003-04cf304f053b';
-- item 4.4 "Sprinklers & Valves"  (19→23; +4)
UPDATE public.inspection_template_items SET field_keys = '["As built plan available","Cost Recovery: Tenant specific / part of ops cost","Current status: (Good, Fair, Poor)","Diesel bulk tank capacity","Diesel day tank capacity","Diesel, Electrical, Jockey pump","General comments","Give a brief description of how the system operates","If a backup water tank is present, indicate capacity","Inspection checklist: Daily/weekly/monthly","Last date serviced","Next service due","Number of ICV valves on the premises","Service fee cost","Service frequency","Service provider / contractor / installed by","Size and specs of diesel or electrical pump","Size and specs of jockey pump","What type of sprinkler pump is on premises?","Diesel Pump:","Electric Pump:","Sprinkler valve:","Photo (s) reference number:"]'::jsonb
  WHERE id = '37817ed3-5d83-567b-bb63-3131898c95b0';
-- item 4.5 "OHS Signage"  (6→7; +1)
UPDATE public.inspection_template_items SET field_keys = '["Cost Recovery: Tenant specific / part of ops cost","Current status: (Good, Fair, Poor)","General comment","Inspection checklist: Daily/weekly/monthly","Installation date","Service provider / contractor / installed by","Photo (s) reference number:"]'::jsonb
  WHERE id = 'f012dc19-a617-5d7c-91fc-e6efa89ff3d1';
-- item 5.1 "CCTV cameras"  (10→11; +1)
UPDATE public.inspection_template_items SET field_keys = '["As built plan available","Brief description of system installed","Cost Recovery: Tenant specific / part of ops cost","Current status: (Good, Fair, Poor)","General comment","Inspection checklist: Daily/weekly/monthly","Installation date","Quantity and type of cameras","Type of cameras installed","Upgrade date","Photo (s) reference number:"]'::jsonb
  WHERE id = '97706fa2-5144-5353-9caf-a669100733f2';
-- item 5.2 "Panic Button System"  (9→10; +1)
UPDATE public.inspection_template_items SET field_keys = '["Armed reaction services or control room monitored","As built plan available","Brief description of system installed","Cost Recovery: Tenant specific / part of ops cost","Frequency of test performed: Weekly/Daily","Installation date","Please indicate where this is captured","Quantity of remotes on hand","Upgrade date","Photo (s) reference number:"]'::jsonb
  WHERE id = '794a7ec6-ef33-53f1-833c-ff4b7f0fb76d';
-- item 5.3 "Emergency Evacuation"  (9→9; −1 (N/A) +1)
UPDATE public.inspection_template_items SET field_keys = '["Amount of manual assembly points","Amount of static assembly points","Explain how the evacuation procedure works","How often is the evacuation process tested?","Last date that evacuation procedure was tested","Next scheduled dates of evacuation procedure testing","Were any issues identified with the last evacuation testing drill? Please elaborate on how this was resolved","Where is the evacuation process documented?","Photo (s) reference number:"]'::jsonb
  WHERE id = '7782b9df-ce4d-5f18-a0e3-35200898b31f';
-- item 5.4 "Security Equipment"  (8→9; +1)
UPDATE public.inspection_template_items SET field_keys = '["Brief description of system installed","Current status: (Good, Fair, Poor)","General comment","Inspection checklist: Daily/weekly/monthly","Quantity of equipment","Repair cost","Service provider / contractor / installed by","Type of equipment: Provide a list","Photo (s) reference number:"]'::jsonb
  WHERE id = '8cb623ce-cce9-576b-b96b-4e5ac23887c7';
-- item 6.1 "High tension (above 1000 volts)"  (22→23; +1)
UPDATE public.inspection_template_items SET field_keys = '["Are all COCs in place","Are infrared scans performed","As built plan available","Cost of a scan","Cost Recovery: Tenant specific / part of ops cost","Frequency of scans: Bi-annually / annually etc.","High tension room supply","Last date serviced","Last scanned report available and were all issues resolved","Latest scan performed","List of DBs available","Next scan to be performed","Next service due","Number of transformers on site","Service fee cost","Service frequency","Service provider / contractor / installed by","Switch gear","Type of transformers","Voltage","Who is responsible for the HT room equipment?","Who performs the scan, specify contractor?","Photo (s) reference number:"]'::jsonb
  WHERE id = 'b1531649-0cb7-57d0-808f-8b1cba2ef6ab';
-- item 6.3 "Power factor correction"  (10→11; +1)
UPDATE public.inspection_template_items SET field_keys = '["As built plan available","Cost Recovery: Tenant specific / part of ops cost","Current power factor reading","If yes please elaborate","Is there power factor correction equipment installed?","Last date serviced","Next service due","Service fee cost","Service frequency","Service provider / contractor / installed by","Photo (s) reference number:"]'::jsonb
  WHERE id = '475cdbc6-bec3-5809-bc68-c2ad6d116f04';
-- item 6.4 "Stand-by generator"  (18→19; +1)
UPDATE public.inspection_template_items SET field_keys = '["As built plan available","Bulk tank capacity","Cost Recovery: Tenant specific / part of ops cost","Current status: (Good, Fair, Poor)","Day tank capacity","General comment","Generator running hours: Date/hours","Give a brief description of how generator operates","Inspection checklist: Daily/weekly/monthly","Installation date","Last date serviced","Life span expectancy of generator","Next service due","Service fee cost","Service frequency","Service provider / contractor / installed by","Size generator","Specs of generator","Photo (s) reference number:"]'::jsonb
  WHERE id = '04a5b774-d4f7-5d98-9895-cdfe35c586b0';
-- item 6.5 "Solar"  (17→18; +1)
UPDATE public.inspection_template_items SET field_keys = '["Amount and type of invertors","Amount and type of solar panels","As built plan available","Cleaning service frequency","Cost Recovery: Tenant specific / part of ops cost","Current status: (Good, Fair, Poor)","General comments","Inspection checklist: Daily/weekly/monthly","Installation date","Is an SLA in place?","kWh production of plant","Last date serviced","Next service due","Performance/production guarantee (is calculated over 12 months): (Yes/No)","Plant performance reporting frequency","Service provider / contractor / installed by","Size of solar plant","Photo (s) reference number:"]'::jsonb
  WHERE id = '6084641b-6cf0-5b35-9a7d-f99c87e7565c';
-- item 7 "Air-Conditioning"  (18→19; +1)
UPDATE public.inspection_template_items SET field_keys = '["As built plan available","Breakdown of equipment","Cost Recovery: Tenant specific / part of ops cost","Current status: (Good, Fair, Poor)","General comment","Give a brief description of how the system works","Inspection checklist: Daily/weekly/monthly","Installation date","Is an SLA in place?","Last major service date","Last monthly service date","Next major service date","Next monthly service date","Number of units","Service fee cost","Service frequency","Service provider / contractor / installed by","Type of system: (Chiller system, VRV system)","Photo (s) reference number:"]'::jsonb
  WHERE id = '671394f7-67e1-5aa2-a610-e4e75208c710';
-- item 8 "Extraction / Fresh Air"  (12→13; +1)
UPDATE public.inspection_template_items SET field_keys = '["As built plan available","Cost Recovery: Tenant specific / part of ops cost","Give a brief description of how extraction system operates","Inspection checklist: Daily/weekly/monthly","Installation date","Last date serviced","Next service due","Number of units","Service fee cost","Service frequency","Service provider / contractor / installed by","Type of equipment","Photo (s) reference number:"]'::jsonb
  WHERE id = 'c4298ab6-8aac-5be1-8218-63d2fa18ed19';
-- item 9.1 "Interior Lighting"  (8→9; +1)
UPDATE public.inspection_template_items SET field_keys = '["Are motion sensors installed","Cost Recovery: Tenant specific / part of ops cost","Current status: (Good, Fair, Poor)","Day night switch or timer","General comment","Inspection checklist: Daily/weekly/monthly","Service provider / contractor / installed by","Type of lights installed","Photo (s) reference number:"]'::jsonb
  WHERE id = 'ce0829a1-7278-592f-9466-7863549dcc91';
-- item 9.2 "Exterior Lighting"  (8→9; +1)
UPDATE public.inspection_template_items SET field_keys = '["Are motion sensors installed","Cost Recovery: Tenant specific / part of ops cost","Current status: (Good, Fair, Poor)","Day night switch or timer","General comment","Inspection checklist: Daily/weekly/monthly","Service provider / contractor / installed by","Type of lights installed","Photo (s) reference number:"]'::jsonb
  WHERE id = 'b36537dc-ff97-526c-85b7-ad8bfa710f97';
-- item 10.1 "Internal walls"  (7→8; +1)
UPDATE public.inspection_template_items SET field_keys = '["Describe the condition of the paint / marmoran on the internal walls","Describe the structural condition of the internal walls","Inspection checklist: Daily/weekly/monthly","Is there a warranty on the paint? What is the warranty term?","Type and colour code of paint used","When last were the walls painted","When will the next paint job be budgeted for?","Photo (s) reference number:"]'::jsonb
  WHERE id = '07f2dd0b-213a-5804-9750-ecab4e2269c7';
-- item 10.2 "External walls"  (7→8; +1)
UPDATE public.inspection_template_items SET field_keys = '["Describe the condition of the paint / marmoran on the external walls","Describe the structural condition of the external walls","Inspection checklist: Daily/weekly/monthly","Is there a warranty on the paint? What is the warranty term?","Type and colour code of paint used","When last were the walls painted","When will the next paint job be budgeted for?","Photo (s) reference number:"]'::jsonb
  WHERE id = 'cdae7b5d-2b38-5458-9cb7-1ea3dd3ff182';
-- item 10.3 "Ceilings"  (6→7; +1)
UPDATE public.inspection_template_items SET field_keys = '["Describe condition of ceilings","Inspection checklist: Daily/weekly/monthly","Is there a warranty on the paint? What is the warranty term?","Type and colour code of paint used","When last were the ceilings painted","When will the next paint job be budgeted for?","Photo (s) reference number:"]'::jsonb
  WHERE id = 'c2735012-a247-5b62-9eba-c4d5af5f14f0';
-- item 10.4 "Bulkhead/Walkway/Service passages"  (3→4; +1)
UPDATE public.inspection_template_items SET field_keys = '["Describe condition of bulkheads, walkways and service passages","Specify where in the building the items with issues are located and what the issues are","What are the cost implications?","Photo (s) reference number:"]'::jsonb
  WHERE id = '4686b715-2685-593b-a735-34461a708919';
-- item 10.5 "Flooring/Paving"  (8→9; +1)
UPDATE public.inspection_template_items SET field_keys = '["Are the cleaning specifications as per manufacturers recommendation on file?","Current status: (Good, Fair, Poor)","General comment","Inspection checklist: Daily/weekly/monthly","Is there attic stock? If yes, is the attic stock register updated","Paving specs and codes","Tile specs and codes","What are the possible cost implications of the repairs/replacement?","Photo (s) reference number:"]'::jsonb
  WHERE id = 'adf28c3a-3559-5967-83ea-32207b0b951a';
-- item 10.6 "Decking/Balcony"  (5→6; +1)
UPDATE public.inspection_template_items SET field_keys = '["Current status: (Good, Fair, Poor)","General comment","Inspection checklist: Daily/weekly/monthly","Is the maintenance specification as per the manufacturer recommendation on file?","What are the possible cost implications of the repairs/replacement?","Photo (s) reference number:"]'::jsonb
  WHERE id = '98a0b661-54b3-5c4f-b32e-3e3f7d5e94bf';
-- item 10.7 "Perimeter fence"  (5→6; +1)
UPDATE public.inspection_template_items SET field_keys = '["Current status: (Good, Fair, Poor)","General comment","Give a brief explanation of the type of fence","Inspection checklist: Daily/weekly/monthly","What are the possible cost implications of the repairs/replacement?","Photo (s) reference number:"]'::jsonb
  WHERE id = '36d00f6b-7522-55b1-b12a-1f4f6d9d605b';
-- item 11.1 "Ablution facilities"  (7→8; +1)
UPDATE public.inspection_template_items SET field_keys = '["As built plan available","Current status: (Good, Fair, Poor)","General comment","Inspection checklist: Daily/weekly/monthly","Is an SLA in place?","Service provider for cleaning","Service provider for Sani-bins","Photo (s) reference number:"]'::jsonb
  WHERE id = 'ed22cbeb-a002-541a-8d1a-319796e0e7dc';
-- item 12.1 "Road/Parking Surface"  (3→4; +1)
UPDATE public.inspection_template_items SET field_keys = '["Current status: (Good, Fair, Poor)","General comment","Inspection checklist: Daily/weekly/monthly","Photo (s) reference number:"]'::jsonb
  WHERE id = '32e5e635-454f-5735-bd51-60e185a0020d';
-- item 12.2 "Road Markings"  (5→6; +1)
UPDATE public.inspection_template_items SET field_keys = '["Current status: (Good, Fair, Poor)","Do we have road marking stencils? If so where are they stored","General comment","Inspection checklist: Daily/weekly/monthly","When was the last paint job performed?","Photo (s) reference number:"]'::jsonb
  WHERE id = '5e65c5c2-4fcf-5722-86cd-06e2709d7ed2';
-- item 12.3 "Parking Area"  (13→14; +1)
UPDATE public.inspection_template_items SET field_keys = '["As built plan available","Automated pay stations","Booms","Current status: (Good, Fair, Poor)","General comment","Inspection checklist: Daily/weekly/monthly","Last date serviced","Service frequency","Spike barriers","Ticket acceptor","Ticket dispenser","Type of equipment","What payment facilities are available at the pay stations","Photo (s) reference number:"]'::jsonb
  WHERE id = 'b335b550-8bcd-574e-8edf-56de0c5541d4';
-- item 13.1 "Building Signage"  (7→8; +1)
UPDATE public.inspection_template_items SET field_keys = '["Current status: (Good, Fair, Poor)","General comment","Inspection checklist: Daily/weekly/monthly","Is signage clearly visible in the day","Is signage clearly visible in the evening","Is signage metered","Location/elevation plan available","Photo (s) reference number:"]'::jsonb
  WHERE id = 'a54284b1-e308-576d-93a9-b221a1d45c83';
-- item 13.2 "Tenant Signage"  (7→8; +1)
UPDATE public.inspection_template_items SET field_keys = '["Current status: (Good, Fair, Poor)","General comment","Inspection checklist: Daily/weekly/monthly","Is signage clearly visible in the day","Is signage clearly visible in the evening","Is signage metered","Location/elevation plan available","Photo (s) reference number:"]'::jsonb
  WHERE id = '2dedd6cf-dcb8-5a07-82ae-2cfe0176ad21';
-- item 13.3 "Disclaimer Signage"  (4→5; +1)
UPDATE public.inspection_template_items SET field_keys = '["Are disclaimer signs present on site?","Current status: (Good, Fair, Poor)","General comment","Inspection checklist: Daily/weekly/monthly","Photo (s) reference number:"]'::jsonb
  WHERE id = '73683b1a-9360-5e2a-a85f-a0cfaf3cc111';
-- item 15.1 "Water Purification"  (11→12; +1)
UPDATE public.inspection_template_items SET field_keys = '["Cost Recovery: Tenant specific / part of ops cost","Current status: (Good, Fair, Poor)","Frequency of water tests","General comment","Give a brief description of how the system works","Inspection checklist: Daily/weekly/monthly","Is a water purification system installed?","Is an SLA in place?","Latest water tests available","Plant performance reporting frequency","Who installed the water purification?","Photo (s) reference number:"]'::jsonb
  WHERE id = '258e170c-6dc0-53f7-9d67-834f5beebd08';
-- item 16.1 "Water pumps, sump pumps"  (9→10; +1)
UPDATE public.inspection_template_items SET field_keys = '["As built plan available","Cost Recovery: Tenant specific / part of ops cost","Current status: (Good, Fair, Poor)","General comment","Give a brief description of how the system operates","Inspection checklist: Daily/weekly/monthly","Installation date","Number of units","Type of equipment","Photo (s) reference number:"]'::jsonb
  WHERE id = '58254a69-d75f-5ca9-8c4a-b378d64ca6f5';
-- item 16.2 "Doors (Revolving, Sliding, Roller shutters)"  (7→9; +2)
UPDATE public.inspection_template_items SET field_keys = '["As built plan available","Cost Recovery: Tenant specific / part of ops cost","Current status: (Good, Fair, Poor)","Inspection checklist: Daily/weekly/monthly","Installation date","Number of units","Type of doors","General comment:","Photo (s) reference number:"]'::jsonb
  WHERE id = 'e48c0622-7b99-56be-95c1-a53b57b5292d';
-- item 16.3 "Entrance carpets"  (7→8; +1)
UPDATE public.inspection_template_items SET field_keys = '["As built plan available","Cost Recovery: Tenant specific / part of ops cost","Current status: (Good, Fair, Poor)","General comment","Inspection checklist: Daily/weekly/monthly","Installation date","Number of carpets outside","Photo (s) reference number:"]'::jsonb
  WHERE id = '4d3d6625-b410-57f2-a9c3-b09a91cc397b';
-- item 17.2 "Cherry picker"  (9→10; +1)
UPDATE public.inspection_template_items SET field_keys = '["Cost Recovery: Tenant specific / part of ops cost","Current status: (Good, Fair, Poor)","Date purchased","General comment","Inspection checklist: Daily/weekly/monthly","Last service certificate","Last training certificates of operator","Make and model","Type of equipment","Photo (s) reference number:"]'::jsonb
  WHERE id = '5e6117c4-eb36-5626-97b2-fc7ef6ca866a';
-- item 18 "Foot Count / FATTI"  (9→10; +1)
UPDATE public.inspection_template_items SET field_keys = '["Brief description of how the system works","Cost Recovery: Tenant specific / part of ops cost","Current status: (Good, Fair, Poor)","General comment","Inspection checklist: Daily/weekly/monthly","Installation date","Is an SLA in place?","Service provider / contractor / installed by","Type of system","Photo (s) reference number:"]'::jsonb
  WHERE id = '1e180609-518e-5e6b-ab89-2200b5d3c980';
-- item 19 "Fountains"  (8→9; +1)
UPDATE public.inspection_template_items SET field_keys = '["As built plan available","Cost Recovery: Tenant specific / part of ops cost","Current status: (Good, Fair, Poor)","General comment","Give a brief description of how the system operates","Inspection checklist: Daily/weekly/monthly","Size and spec of pumps","Type of lights","Photo (s) reference number:"]'::jsonb
  WHERE id = 'c53278a9-068c-5887-bc62-9e583e57e97f';
-- item 20 "Access Control System"  (7→8; +1)
UPDATE public.inspection_template_items SET field_keys = '["Cost Recovery: Tenant specific / part of ops cost","Current status: (Good, Fair, Poor)","General comment","Give a brief description of how the system operates","Inspection checklist: Daily/weekly/monthly","Installation date","Type of system","Photo (s) reference number:"]'::jsonb
  WHERE id = '5c97f8c2-ace0-5ab8-a48a-c0b76a300677';
-- item 21 "Business/Demand Control System"  (9→10; +1)
UPDATE public.inspection_template_items SET field_keys = '["Cost Recovery: Tenant specific / part of ops cost","Current status: (Good, Fair, Poor)","General comment","Give a brief description of how the system operates","Inspection checklist: Daily/weekly/monthly","Installation date","Type and model of software installed","Type of system installed","Who is the system maintained by?","Photo (s) reference number:"]'::jsonb
  WHERE id = '2637cc30-29bc-5c86-a61d-42e82f36a1c9';
-- item 22 "Waterproofing"  (9→10; +1)
UPDATE public.inspection_template_items SET field_keys = '["Condition of gutters/full bores","Condition of parapets","Condition of roof sheeting","Condition of wall copings","Cost Recovery: Tenant specific / part of ops cost","General comment","Guarantee in place: (Specify date guarantee expires)","Inspection checklist: Daily/weekly/monthly","Type of waterproofing","Photo (s) reference number:"]'::jsonb
  WHERE id = 'efd061f4-0b88-57b7-9fcc-b24a0ee04844';
-- item 23 "Security (services)"  (13→13; −1 (N/A) +1)
UPDATE public.inspection_template_items SET field_keys = '["Cost Recovery: Tenant specific / part of ops cost","Current status: (Good, Fair, Poor)","Day shift security","General comment","How many car guards","Inspection checklist: Daily/weekly/monthly","Is an SLA in place?","Night shift security","Patrolling equipment make and model","Patrolling equipment purchase date","Service provider / contractor","Staff complement","Photo (s) reference number:"]'::jsonb
  WHERE id = 'd2ebf93d-9824-5df6-b35a-fc039f87aae0';
-- item 24 "Cleaning"  (12→12; −1 (N/A) +1)
UPDATE public.inspection_template_items SET field_keys = '["Cleaning equipment make and model","Cost Recovery: Tenant specific / part of ops cost","Current status: (Good, Fair, Poor)","Day shift cleaners","General comment","Inspection checklist: Daily/weekly/monthly","Is an SLA in place?","Night shift cleaners","Service provider / contractor","Staff complement","When was equipment purchased?","Photo (s) reference number:"]'::jsonb
  WHERE id = '8b85f57b-d9da-53b9-bfe4-f0536b889eb9';
-- item 25 "Refuse"  (10→11; +1)
UPDATE public.inspection_template_items SET field_keys = '["As built plan available for refuse yard","Day shift staff","Inspection checklist: Daily/weekly/monthly","Is an SLA in place?","Night shift staff","Odour cure system in place","Recyclable rebate","Service provider / contractor","Specify amount wheelie bins","Staff complement","Photo (s) reference number:"]'::jsonb
  WHERE id = 'e537139f-7aa7-5857-a772-c27c44a6faa3';
-- item 26 "Parking Management"  (6→7; +1)
UPDATE public.inspection_template_items SET field_keys = '["Day shift staff","Inspection checklist: Daily/weekly/monthly","Is an SLA in place?","Night shift staff","Service provider / contractor","Staff complement","Photo (s) reference number:"]'::jsonb
  WHERE id = '1530b69f-b3d1-58c1-85aa-1af4b2240581';
-- item 27 "Landscaping (services)"  (5→6; +1)
UPDATE public.inspection_template_items SET field_keys = '["As built plan available","Inspection checklist: Daily/weekly/monthly","Is an SLA in place?","Service provider / contractor","Staff complement","Photo (s) reference number:"]'::jsonb
  WHERE id = 'ed306079-3ce3-535f-82a5-88dbce0bf553';
-- item 28 "Pest Control"  (4→5; +1)
UPDATE public.inspection_template_items SET field_keys = '["Inspection checklist: Daily/weekly/monthly","Is an SLA in place?","Is pest control register available?","Service provider / contractor","Photo (s) reference number:"]'::jsonb
  WHERE id = '8ce5691a-1902-5155-ba74-e196f1d1c2f2';

COMMIT;
