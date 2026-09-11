-- 2026-06-14_10_ingest_annual_remainder.sql
-- Fortress Annual Condition Inspection — close remaining ingest gaps for AbaQulusi Plaza.
-- Source: 'Fortress spec docs/10.1 Annual Inspection Report 2025 - Abaqulusi.xlsx' (Sheet1).
-- Target inspection: 9afae910-cf7b-5997-9dcd-042d9a195bee (report b42c47f6..., building 63345a91...).
-- Idempotent: Task 1 uses ON CONFLICT (inspection_id, template_item_id) DO NOTHING;
--             Tasks 2-3 merge into existing detail / are NULL-guarded.
-- Deterministic ids both DBs (uuid5). Detail keys are verbatim source labels (trailing ':' stripped,
-- '?' kept, datetimes normalized YYYY-MM-DD) matching the existing ingester convention.
BEGIN;

-- Resolve template-item ids by section_no (template 70cb0226-77c6-5156-8c8b-ffcad6e4ef47).
-- ============================================================
-- TASK 1 — Five source-populated items that never reached the DB.
--   §6.2 Low tension (equip, unlabelled in source — rows 367-381)
--   §12.4 Parking Equipment (equip, matrix flattened: Booms type/qty/date/provider)
--   §14.1 Irrigation System (equip)
--   §14.2 Flower Beds / planters (condition)
--   §15.2 Sewerage Treatment Plant: SKIPPED — source has no structured body (TOC-only).
-- ============================================================

-- §6.2
INSERT INTO inspection_responses (id, inspection_id, template_item_id, applicable, condition_rating, detail)
SELECT
  '1b6b0b8a-cd83-5e10-8d29-51e3a078af28'::uuid,
  '9afae910-cf7b-5997-9dcd-042d9a195bee'::uuid,
  ti.id,
  true,
  NULL,
  '{"Service frequency": "Annually", "Last date serviced": "2025-02-01", "Next service due": "2026-02-01", "Service fee cost": "7600", "Service provider / contractor / installed by": "Kambula", "Are all COCs in place": "Yes", "Are infrared scans performed": "Yes", "Frequency of scans: Bi-annually / annually etc.": "Annually", "Latest scan performed": "2025-02-01", "Next scan to be performed": "2026-02-01", "Who performs the scan, specify contractor?": "Kambula", "Last scanned report available and were all issues resolved": "Yes", "Cost of a scan": "7600", "List of DBs available": "Yes", "Cost Recovery: Tenant specific / part of ops cost": "OPS Cost"}'::jsonb
FROM inspection_template_items ti
WHERE ti.template_id = '70cb0226-77c6-5156-8c8b-ffcad6e4ef47'::uuid AND ti.section_no = '6.2'
ON CONFLICT (inspection_id, template_item_id) DO NOTHING;

-- §12.4
INSERT INTO inspection_responses (id, inspection_id, template_item_id, applicable, condition_rating, detail)
SELECT
  'a83c8f82-73a6-5454-8d69-442fe8b80c76'::uuid,
  '9afae910-cf7b-5997-9dcd-042d9a195bee'::uuid,
  ti.id,
  true,
  NULL,
  '{"Type of equipment": "Type & Quantity:", "Booms — Type & Quantity": "1", "Booms — Installation date": "2023", "Booms — Service provider / contractor / installed by": "TBC", "Spike barriers": "N/A", "Automated pay stations": "N/A", "Ticket dispenser": "N/A", "Ticket acceptor": "N/A", "What payment facilities are available at the pay stations": "N/A", "Service frequency": "N/A", "Last date serviced": "N/A", "As built plan available": "N/A", "Current status: (Good, Fair, Poor)": "N/A", "General comment": "N/A", "Inspection checklist: Daily/weekly/monthly": "N/A", "Photo (s) reference number": "N/A"}'::jsonb
FROM inspection_template_items ti
WHERE ti.template_id = '70cb0226-77c6-5156-8c8b-ffcad6e4ef47'::uuid AND ti.section_no = '12.4'
ON CONFLICT (inspection_id, template_item_id) DO NOTHING;

-- §14.1
INSERT INTO inspection_responses (id, inspection_id, template_item_id, applicable, condition_rating, detail)
SELECT
  'aff3d99a-7ba3-533b-a187-3efac2e41037'::uuid,
  '9afae910-cf7b-5997-9dcd-042d9a195bee'::uuid,
  ti.id,
  true,
  NULL,
  '{"Is an irrigation system installed?": "No", "Give a brief description of how the system operates": "Manually watered", "Does the irrigation system use a borehole?": "Yes", "Does the irrigation system use grey water?": "N/A", "Is there a backup tank, specify tank capacity?": "Yes 580KL", "Details on pumps for irrigation system": "N/A", "Installed by": "Clear Water", "Current status: (Good, Fair, Poor)": "N/A", "General comment": "To install a system", "Cost Recovery: Tenant specific / part of ops cost": "Common area recovery", "Inspection checklist: Daily/weekly/monthly": "N/A", "Photo (s) reference number": null}'::jsonb
FROM inspection_template_items ti
WHERE ti.template_id = '70cb0226-77c6-5156-8c8b-ffcad6e4ef47'::uuid AND ti.section_no = '14.1'
ON CONFLICT (inspection_id, template_item_id) DO NOTHING;

-- §14.2
INSERT INTO inspection_responses (id, inspection_id, template_item_id, applicable, condition_rating, detail)
SELECT
  '6c8d585e-7138-5a89-aadf-bcab383cce7e'::uuid,
  '9afae910-cf7b-5997-9dcd-042d9a195bee'::uuid,
  ti.id,
  true,
  'fair',
  '{"Service provider / contractor / installed by": "In House Maintenance", "Is an SLA in place?": "In House Maintenance", "Current status: (Good, Fair, Poor)": "Fair", "General comment": "None", "Inspection checklist: Daily/weekly/monthly": "Daily", "Photo (s) reference number": null}'::jsonb
FROM inspection_template_items ti
WHERE ti.template_id = '70cb0226-77c6-5156-8c8b-ffcad6e4ef47'::uuid AND ti.section_no = '14.2'
ON CONFLICT (inspection_id, template_item_id) DO NOTHING;

-- ============================================================
-- TASK 2 — Flatten matrix grids into existing responses' detail (merge, no clobber).
--   §6.6 Metering (Electricity/Water/Gas), §11.2 Mechanisms (per-fixture Quantity),
--   §17.1 Lifts/Escalators/Goods lift. Existing single-column keys are preserved;
--   we only ADD composite-key cells (existing keys win via '|| new' precedence reversed below).
-- ============================================================

-- §6.6 (27 composite cells)
UPDATE inspection_responses r
SET detail = '{"Type of meters installed — Electricity": "Kamstrup", "Type of meters installed — Water": "Kamstrup", "Type of meters installed — Gas": "Metrix", "Main connection with size of connection — Water": "80mm", "Main connection with size of connection — Gas": "N/A", "What tariff the mall gets invoiced — Electricity": "Industrial kVA", "What tariff the mall gets invoiced — Water": "Sliding scale per KL + basic", "What tariff the mall gets invoiced — Gas": "LPG", "How is sanitation billed per point or per %? — Electricity": "per m2", "How is sanitation billed per point or per %? — Water": "N/A", "How is sanitation billed per point or per %? — Gas": "N/A", "Gas operations – how does it work": "Tenants are billed as per usage photos sent to PEC", "As built plan available — Electricity": "Yes", "As built plan available — Water": "Yes", "As built plan available — Gas": "N/A", "Is an SLA in place? — Electricity": "Yes", "Is an SLA in place? — Water": "Yes", "Is an SLA in place? — Gas": "Adhoc", "Prepaid system installed — Electricity": "N/A", "Prepaid system installed — Water": "N/A", "Prepaid system installed — Gas": "N/A", "How many tenants are on prepaid? — Electricity": "N/A", "How many tenants are on prepaid? — Water": "N/A", "How many tenants are on prepaid? — Gas": "N/A", "Latest technical audit report (done by utility company) — Electricity": "2024", "Latest technical audit report (done by utility company) — Water": "2024", "Latest technical audit report (done by utility company) — Gas": "2024"}'::jsonb || COALESCE(r.detail, '{}'::jsonb),
    updated_at = now()
FROM inspection_template_items ti
WHERE r.template_item_id = ti.id AND r.inspection_id = '9afae910-cf7b-5997-9dcd-042d9a195bee'::uuid
  AND ti.template_id = '70cb0226-77c6-5156-8c8b-ffcad6e4ef47'::uuid AND ti.section_no = '6.6';

-- §11.2 (8 composite cells)
UPDATE inspection_responses r
SET detail = '{"Toilet roll holder — Quantity": "16", "Toilet flush system — Quantity": "33", "Sani-bins — Quantity": "22", "Urinal sensors — Quantity": "14", "Hand dryer — Quantity": "15", "Soap dispenser — Quantity": "18", "Taps — Quantity": "31", "Air fresheners — Quantity": "6"}'::jsonb || COALESCE(r.detail, '{}'::jsonb),
    updated_at = now()
FROM inspection_template_items ti
WHERE r.template_item_id = ti.id AND r.inspection_id = '9afae910-cf7b-5997-9dcd-042d9a195bee'::uuid
  AND ti.template_id = '70cb0226-77c6-5156-8c8b-ffcad6e4ef47'::uuid AND ti.section_no = '11.2';

-- §17.1 (39 composite cells)
UPDATE inspection_responses r
SET detail = '{"Type of equipment — Lifts": "N/A", "Type of equipment — Escalators": "N/A", "Type of equipment — Goods lift": "N/A", "Number of units — Lifts": "N/A", "Number of units — Escalators": "N/A", "Number of units — Goods lift": "N/A", "As built plan available — Lifts": "N/A", "As built plan available — Escalators": "N/A", "As built plan available — Goods lift": "N/A", "Installation date — Lifts": "N/A", "Installation date — Escalators": "N/A", "Installation date — Goods lift": "N/A", "Drainage system — Lifts": "N/A", "Drainage system — Escalators": "N/A", "Drainage system — Goods lift": "N/A", "Current status: (Good, Fair, Poor) — Lifts": "N/A", "Current status: (Good, Fair, Poor) — Escalators": "N/A", "Current status: (Good, Fair, Poor) — Goods lift": "N/A", "General comment — Lifts": "N/A", "General comment — Escalators": "N/A", "General comment — Goods lift": "N/A", "Is an SLA in place? — Lifts": "N/A", "Is an SLA in place? — Escalators": "N/A", "Is an SLA in place? — Goods lift": "N/A", "Inspection checklist: Daily/weekly/monthly — Lifts": "N/A", "Inspection checklist: Daily/weekly/monthly — Escalators": "N/A", "Inspection checklist: Daily/weekly/monthly — Goods lift": "N/A", "Is Annexure A (commissioning certificate) report on file — Lifts": "N/A", "Is Annexure A (commissioning certificate) report on file — Escalators": "N/A", "Is Annexure A (commissioning certificate) report on file — Goods lift": "N/A", "When was the last Annex B (independent lift inspector report) report done? — Lifts": "N/A", "When was the last Annex B (independent lift inspector report) report done? — Escalators": "N/A", "When was the last Annex B (independent lift inspector report) report done? — Goods lift": "N/A", "Cost Recovery: Tenant specific / part of ops cost — Lifts": "N/A", "Cost Recovery: Tenant specific / part of ops cost — Escalators": "N/A", "Cost Recovery: Tenant specific / part of ops cost — Goods lift": "N/A", "Photo (s) reference number — Lifts": "N/A", "Photo (s) reference number — Escalators": "N/A", "Photo (s) reference number — Goods lift": "N/A"}'::jsonb || COALESCE(r.detail, '{}'::jsonb),
    updated_at = now()
FROM inspection_template_items ti
WHERE r.template_item_id = ti.id AND r.inspection_id = '9afae910-cf7b-5997-9dcd-042d9a195bee'::uuid
  AND ti.template_id = '70cb0226-77c6-5156-8c8b-ffcad6e4ef47'::uuid AND ti.section_no = '17.1';

-- ============================================================
-- TASK 3 — Narrative bodies (detail.Body). §1 Disclaimer & §2 Introduction.
--   §29 General: SKIPPED — source body is empty (label only, no text).
--   §1 already has a response row (profile-free) -> set Body. §2 has no row -> INSERT with Body.
-- ============================================================

-- §1 Disclaimer (UPDATE existing response, add Body)
UPDATE inspection_responses r
SET detail = COALESCE(r.detail, '{}'::jsonb) || jsonb_build_object('Body', 'The information in this document is done entirely without prejudice to any of the rights of Broll. This document is based on the view of the writer and must be taken at face value with all rights reserved herein.'),
    updated_at = now()
FROM inspection_template_items ti
WHERE r.template_item_id = ti.id AND r.inspection_id = '9afae910-cf7b-5997-9dcd-042d9a195bee'::uuid
  AND ti.template_id = '70cb0226-77c6-5156-8c8b-ffcad6e4ef47'::uuid AND ti.section_no = '1';

-- §2 Introduction (no response row exists -> INSERT with Body)
INSERT INTO inspection_responses (id, inspection_id, template_item_id, applicable, detail)
SELECT
  '8c0b50b9-54db-5a53-a7cb-0dbf7b772299'::uuid,
  '9afae910-cf7b-5997-9dcd-042d9a195bee'::uuid,
  ti.id,
  true,
  jsonb_build_object('Body', 'Broll Management is requesting  to do annual building inspections to assess the condition of the building structure, equipment and to compile a reasonable budget for annual budgeting purposes.

The audit had to also highlight any risk and the recommendations to eliminate the risk needed. This report has been compiled in order to report on the operational condition of the respective building.

The report is broken up into the different components that make up the whole and areas of concern have been highlighted.

Where applicable, mention is made of the scheduled inspections and checklists that are utilized on site on a daily/weekly/monthly/6-monthly and annual basis as well as the findings of the scheduled maintenance inspections and services that are conducted as per the annual schedule.

The general condition and operation of the equipment was based on a visual inspection the Centre Manager.')
FROM inspection_template_items ti
WHERE ti.template_id = '70cb0226-77c6-5156-8c8b-ffcad6e4ef47'::uuid AND ti.section_no = '2'
ON CONFLICT (inspection_id, template_item_id) DO NOTHING;

COMMIT;