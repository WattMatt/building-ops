-- 2026-06-19_07: fix unit bug in utility_yields.pct_achieved.
-- The Yarona OPS ingest stored solar pct_achieved as a RAW FRACTION (actual/predicted =
-- 41189/49318 = 0.835…) instead of a PERCENT. AbaQulusi correctly stored 90.7. The KPI (K9
-- Solar Yield) + THRESHOLDS.yield expect a 0–100 percent, so the fraction rendered as
-- "0.835…%" and classified red. Normalise any fraction-scale row to a percent (= actual/
-- predicted × 100, 1dp). Guarded `pct_achieved < 1.5` so it ONLY touches fraction-scale
-- rows and is idempotent (after the fix the value is ~83.5 and won't re-match). Real yields
-- are far above 1.5, so this cannot mis-scale a legitimate percent. Data fix only.
update public.utility_yields
set pct_achieved = round((actual_yield / nullif(predicted_yield, 0) * 100)::numeric, 1)
where pct_achieved is not null
  and pct_achieved > 0 and pct_achieved < 1.5
  and predicted_yield is not null and predicted_yield <> 0
  and actual_yield is not null;
