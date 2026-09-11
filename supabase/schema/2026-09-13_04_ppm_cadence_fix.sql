-- 2026-09-13_04_ppm_cadence_fix.sql
-- Re-derive the cadence of the PPM plan lines the R3c one-shot seed (2026-09-13_03 §7) left
-- inactive. Measured on staging after _03: 538 of 664 plan lines were flagged. Two causes:
--   1) The seed took the NEWEST ppm_services row per (building, service) and that row's
--      `frequency` is usually NULL although older report copies of the same service carry a value.
--   2) The regexes missed real strings: "Trimonthly", "Montlhy" (typo), "Bi Monthly"/"Bi-Monthly",
--      "6-monthly", plus "annually" on rows hidden by (1).
-- This pass is data-only and idempotent. It has two steps.
--
-- Step 0 — self-heal the FIRST version of this file, which over-inferred from the grid: one
--   captured month became "yearly" and two cells 6 apart became "every 6 months". Any line that
--   is still active AND still carries exactly that machine note is reverted to inactive with a
--   'Migrated 2026-09-13: cadence "" not recognised (only N report month(s) captured) — set the
--   rule and activate' note (N from the old note). A human edit changes/clears the note, so
--   hand-reviewed lines are never reverted. No-op where the loose version never ran.
--
-- Step 1 — derive a cadence for plan lines a human has not edited: `is_active = false` AND
--   `notes` is still the seed's (or step 0's) exact
--   'Migrated 2026-09-13: cadence "…" not recognised … — set the rule and activate' text.
--   (a) Newest NON-NULL, non-blank `frequency` across ALL report rows of that building+service
--       (`plan_service_id` or same building_id + service_name), mapped most-specific first so
--       "Bi Monthly" / "Trimonthly" / "6-monthly" are not swallowed by the bare `monthly` match.
--       Explicit non-month cadences ("Weekly", "Adhoc", "N/A", …) are terminal: they keep the
--       note and stay inactive; the grid is NOT consulted for them.
--   (b) No usable string → infer from the `months` grids: the distinct YYYY-MM keys whose cell
--       carries a status other than 'na' (which asserts the month is NOT in the cadence).
--       A cadence needs REPEATED evidence — a single captured month in a fresh report says nothing:
--         ≥ 10 distinct months in any 12-month window                  → monthly
--         ≥ 2 months, every gap a multiple of 12 (same month-of-year in
--           ≥ 2 distinct years, no other months)                       → yearly on that month
--         ≥ 3 months (≥ 2 gaps), every gap a multiple of 6             → every 6 months
--         ≥ 3 months (≥ 2 gaps), every gap a multiple of 3             → every 3 months
--         exactly 1 month                                              → NOT inferred; stays inactive,
--           note becomes '… cadence "<orig>" not recognised (only 1 report month captured) — …'
--           (<orig> = the string already in the note, possibly empty)
--         anything else                                                → unresolved, unchanged
--       A month-unit rule has no phase field (recurrence_occurrences anchors on the generation
--       `from` date), so the observed starting month goes into the note, not the rule.
--   (c) Derived → recurrence set, is_active = true, updated_at = now(), notes replaced with a short
--       'Migrated 2026-09-13: cadence … read as / inferred as …' audit line (its wording differs from
--       the seed's, so a re-run — or a later manual deactivation — cannot re-process the line).
--       The 1-month note is only written when it differs, so a re-run touches nothing.
-- Regex note: in PostgreSQL ARE `\b` is BACKSPACE; word boundaries are `\y`.
-- Requires 2026-09-13_03 (building_ppm_services, ppm_services.plan_service_id).
begin;

-- ---------------------------------------------------------------------------------------------
-- Step 0: revert the loose version's over-inference (exact machine note only).
-- ---------------------------------------------------------------------------------------------
update public.building_ppm_services s
   set is_active  = false,
       notes      = 'Migrated 2026-09-13: cadence "" not recognised (only '
                    || n.n || ' report month' || case when n.n = '1' then '' else 's' end
                    || ' captured) — set the rule and activate',
       updated_at = now()
  from (
    select id,
           substring(notes from ', (\d+) grid months?\)$') as n
      from public.building_ppm_services
     where is_active
       and (   notes like 'Migrated 2026-09-13: cadence inferred from the report grid as yearly (from %, 1 grid month)'
            or notes like 'Migrated 2026-09-13: cadence inferred from the report grid as every 6 months (from %, 2 grid months)')
  ) n
 where n.id = s.id
   and n.n is not null;

-- ---------------------------------------------------------------------------------------------
-- Step 1: derive cadences for still-untouched inactive lines.
-- ---------------------------------------------------------------------------------------------
with cand as (
  select s.id as plan_id, s.building_id, s.service_name, s.notes,
         coalesce(substring(s.notes from '^Migrated 2026-09-13: cadence "(.*)" not recognised'), '') as orig
    from public.building_ppm_services s
   where not s.is_active
     and s.notes like 'Migrated 2026-09-13: cadence "%" not recognised%'
),
src as (
  select distinct c.plan_id, p.id as row_id, p.frequency, p.months, p.created_at
    from cand c
    join public.ppm_services p
      on p.plan_service_id = c.plan_id
      or (p.building_id = c.building_id and p.service_name = c.service_name)
),
-- (a) newest non-blank frequency string per plan line
txt as (
  select distinct on (plan_id) plan_id, btrim(frequency) as f
    from src
   where nullif(btrim(coalesce(frequency, '')), '') is not null
   order by plan_id, created_at desc, row_id
),
txt_rule as (
  select plan_id, f,
         case
           when f ~* '\y6 ?-?month|bi ?-?annual|half|semi'                    then 6
           when f ~* 'bi ?-?monthly|\y2(nd)? ?-?month'                       then 2
           when f ~* 'tri ?-?monthly|quarter|\y3(rd)? ?-?month'              then 3
           when f ~* 'annual|yearly|\yyear|\y12 ?-?month|\y1 ?-?year'        then 12
           when f ~* 'montl?hl?y|every month|\y1 ?-?month|\y1 ?m\y'          then 1
           else null
         end as every_months,
         -- explicit non-month/year cadences: leave for a human, do not guess from the grid
         (f ~* 'week|daily|fortnight|ad ?-?hoc|^n/?a$|as (and when )?(required|needed)|on request|when required') as terminal
    from txt
),
-- (b) grid months per plan line: distinct YYYY-MM with a status other than 'na'
cells as (
  select distinct s.plan_id,
         (extract(year from to_date(kv.key, 'YYYY-MM'))::int * 12
          + extract(month from to_date(kv.key, 'YYYY-MM'))::int - 1) as mi   -- absolute month index
    from src s
    cross join lateral jsonb_each(case when jsonb_typeof(s.months) = 'object' then s.months else '{}'::jsonb end) kv
   where kv.key ~ '^\d{4}-(0[1-9]|1[0-2])$'
     and jsonb_typeof(kv.value) = 'object'
     and nullif(btrim(coalesce(kv.value->>'status', '')), '') is not null
     and lower(kv.value->>'status') <> 'na'
),
gaps as (
  select plan_id, mi,
         mi - lag(mi) over (partition by plan_id order by mi) as gap,
         count(*) over (partition by plan_id order by mi range between current row and 11 following) as in_12
    from cells
),
grid_stats as (
  select plan_id,
         count(*)::int                                   as n,
         min(mi)                                          as first_mi,
         max(in_12)::int                                  as max_in_12,
         coalesce(bool_and(gap % 12 = 0) filter (where gap is not null), true) as all12,
         coalesce(bool_and(gap % 6  = 0) filter (where gap is not null), true) as all6,
         coalesce(bool_and(gap % 3  = 0) filter (where gap is not null), true) as all3
    from gaps
   group by plan_id
),
grid_rule as (
  select plan_id, n, (first_mi % 12) + 1 as first_month,
         case
           when max_in_12 >= 10        then 1
           when n >= 2 and all12       then 12   -- same month-of-year in >= 2 distinct years, nothing else
           when n >= 3 and all6        then 6    -- >= 2 gaps, all multiples of 6
           when n >= 3 and all3        then 3    -- >= 2 gaps, all multiples of 3
           else null                             -- incl. n = 1: one captured month is not a cadence
         end as every_months
    from grid_stats
),
derived as (
  select c.plan_id, c.orig,
         coalesce(t.every_months, case when coalesce(t.terminal, false) then null else g.every_months end) as every_months,
         case when t.every_months is not null then 'text' when coalesce(t.terminal, false) then null else 'grid' end as via,
         t.f, g.first_month, g.n
    from cand c
    left join txt_rule  t on t.plan_id = c.plan_id
    left join grid_rule g on g.plan_id = c.plan_id
),
changes as (
  -- resolved lines get a rule + activation; 1-cell grid lines only get the explanatory note
  select plan_id,
         every_months is not null as activate,
         case
           when every_months is null then null
           when every_months = 12   then jsonb_build_object('every', 1, 'unit', 'year', 'monthDay', 1,
                                           'month', case when via = 'grid' then first_month else 7 end)
           else jsonb_build_object('every', every_months, 'unit', 'month', 'monthDay', 1)
         end as recurrence,
         case
           when every_months is not null then
             'Migrated 2026-09-13: cadence '
               || case when via = 'text' then '"' || f || '" read as ' else 'inferred from the report grid as ' end
               || case every_months when 1 then 'monthly' when 12 then 'yearly' else 'every ' || every_months || ' months' end
               || case when via = 'grid' and every_months <> 1
                       then ' (from ' || to_char(make_date(2000, first_month, 1), 'Mon') || ', ' || n || ' grid months)'
                       else '' end
           else
             'Migrated 2026-09-13: cadence "' || orig || '" not recognised (only 1 report month captured) — set the rule and activate'
         end as note
    from derived
   where every_months is not null
      or (via = 'grid' and n = 1)
)
update public.building_ppm_services s
   set recurrence = coalesce(c.recurrence, s.recurrence),
       is_active  = c.activate,
       notes      = c.note,
       updated_at = now()
  from changes c
 where c.plan_id = s.id
   and (c.recurrence is null or public.recurrence_is_valid(c.recurrence))
   and (c.activate or s.notes is distinct from c.note);

commit;

-- Verify:
--   select is_active, count(*) from public.building_ppm_services group by 1;
--   select notes, count(*) from public.building_ppm_services where not is_active group by 1 order by 2 desc;
--   select recurrence, count(*) from public.building_ppm_services where is_active group by 1 order by 2 desc;
--   select count(*) from public.building_ppm_services
--    where is_active and notes like 'Migrated 2026-09-13: cadence %';           -- lines this pass resolved
--   select count(*) from public.building_ppm_services
--    where not is_active and notes like '%(only % report month% captured)%';   -- too little grid evidence
