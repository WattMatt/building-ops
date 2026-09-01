-- 2026-06-14_09_seed_utility_difference.sql
-- Re-ingest the 2 dropped Utilities-sheet values for Abaqulusi Plaza OPS Report (October 2025).
--
-- Source: "Fortress spec docs/OPS Report Abaqulusi Plaza October 2025.xlsx", sheet "Utilities".
-- These two values were present in the source sheet but never ingested into utility_readings:
--   1. Water Bulk-vs-Check "Difference" (column D, section "Council bulk vs Bulk check (Water)")
--      Only the "Site Daily reading total" row carried a real measured delta (D8 = 5.256605892456071).
--      The "Council Bulk" row's Difference (D6 = -1) is a placeholder — its reading is 0 with the
--      comment "Need to investigate if we have a bulk meter" — so it is intentionally NOT ingested.
--   2. Night Usage "Time" window (column D, section "Night Usage"): Bulk Check meter D32 = "22:00 - 06:00".
--
-- UUIDs are deterministic across staging + prod (verified identical). UPDATEs are NULL-guarded so
-- re-running is idempotent and will never clobber a value an operator has since entered.

-- Water bulk-vs-check Difference: Site Daily Reading Total
UPDATE public.utility_readings
SET difference = 5.256605892456071
WHERE id = '0430b3d4-a00d-5a25-a32a-56b208d505d7'
  AND difference IS NULL;

-- Night Usage time window: Bulk Check (Night Usage)
UPDATE public.utility_readings
SET night_window = '22:00 - 06:00'
WHERE id = 'e539762d-e2e6-5daa-b354-79fc2301ed29'
  AND night_window IS NULL;
