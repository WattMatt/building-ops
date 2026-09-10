-- 2026-09-13_04_ppm_cadence_fix.sql
-- Re-derive the cadence of the PPM plan lines the R3c one-shot seed (2026-09-13_03 §7) left
-- inactive. Measured on staging after _03: 538 of 664 plan lines were flagged. Two causes:
--   1) The seed took the NEWEST ppm_services row per (building, service) and that row's
--      `frequency` is usually NULL although older report copies of the same service carry a value.
--   2) The regexes missed real strings: "Trimonthly", "Montlhy" (typo), "Bi Monthly"/"Bi-Monthly",
--      "6-monthly", plus "annually" on rows hidden by (1).
-- This pass is data-only, idempotent, and only touches plan lines a human has not edited:
-- `is_active = false` AND `notes` is still the seed's exact
-- 'Migrated 2026-09-13: cadence "…" not recognised — set the rule and activate' text.
--   (a) Newest NON-NULL, non-blank `frequency` across ALL report rows of that building+service
--       (`plan_service_id` or same building_id + service_name), mapped most-specific first so
--       "Bi Monthly" / "Trimonthly" / "6-monthly" are not swallowed by the bare `monthly` match.
--       Explicit non-month cadences ("Weekly", "Adhoc", "N/A", …) are terminal: they keep the
--       note and stay inactive; the grid is NOT consulted for them.
--   (b) No usable string → infer from the `months` grids: the distinct YYYY-MM keys whose cell
--       carries a status other than 'na' (which asserts the month is NOT in the cadence).
--         ≥ 10 distinct months in any 12-month window          → monthly
--         1 distinct month                                     → yearly on that month
--         ≥ 2 months, every gap a multiple of 12               → yearly on that month
--         ≥ 2 months, every gap a multiple of 6                → every 6 months
--         ≥ 3 months, every gap a multiple of 3                → every 3 months
--         anything else                                        → unresolved, unchanged
--       A month-unit rule has no phase field (recurrence_occurrences anchors on the generation
--       `from` date), so the observed starting month goes into the note, not the rule.
--   (c) Derived → recurrence set, is_active = true, updated_at = now(), notes replaced with a short
--       'Migrated 2026-09-13: cadence … read as / inferred as …' audit line (its wording differs from
--       the seed's, so a re-run — or a later manual deactivation — cannot re-process the line).
-- Regex note: in PostgreSQL ARE `\b` is BACKSPACE; word boundaries are `\y`.
-- Requires 2026-09-13_03 (building_ppm_services, ppm_services.plan_service_id).
begin;

with cand as (
  select s.id as plan_id, s.building_id, s.service_name
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
           when n = 1                  then 12
           when n >= 2 and all12       then 12
           when n >= 2 and all6        then 6
           when n >= 3 and all3        then 3
           else null
         end as every_months
    from grid_stats
),
derived as (
  select c.plan_id,
         coalesce(t.every_months, case when coalesce(t.terminal, false) then null else g.every_months end) as every_months,
         case when t.every_months is not null then 'text' when coalesce(t.terminal, false) then null else 'grid' end as via,
         t.f, g.first_month, g.n
    from cand c
    left join txt_rule  t on t.plan_id = c.plan_id
    left join grid_rule g on g.plan_id = c.plan_id
),
rules as (
  select plan_id,
         case every_months
           when 12 then jsonb_build_object('every', 1, 'unit', 'year', 'monthDay', 1,
                          'month', case when via = 'grid' then first_month else 7 end)
           else jsonb_build_object('every', every_months, 'unit', 'month', 'monthDay', 1)
         end as recurrence,
         'Migrated 2026-09-13: cadence '
           || case when via = 'text' then '"' || f || '" read as ' else 'inferred from the report grid as ' end
           || case every_months when 1 then 'monthly' when 12 then 'yearly' else 'every ' || every_months || ' months' end
           || case when via = 'grid' and every_months <> 1
                   then ' (from ' || to_char(make_date(2000, first_month, 1), 'Mon') || ', ' || n || ' grid month' || case when n = 1 then '' else 's' end || ')'
                   else '' end
           as note
    from derived
   where every_months is not null
)
update public.building_ppm_services s
   set recurrence = r.recurrence,
       is_active  = true,
       notes      = r.note,
       updated_at = now()
  from rules r
 where r.plan_id = s.id
   and public.recurrence_is_valid(r.recurrence);

commit;

-- Verify:
--   select is_active, count(*) from public.building_ppm_services group by 1;
--   select notes, count(*) from public.building_ppm_services where not is_active group by 1 order by 2 desc;
--   select recurrence, count(*) from public.building_ppm_services where is_active group by 1 order by 2 desc;
--   select count(*) from public.building_ppm_services
--    where is_active and notes like 'Migrated 2026-09-13: cadence %';           -- lines this pass resolved
