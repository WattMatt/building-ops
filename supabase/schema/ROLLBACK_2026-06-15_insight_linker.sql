-- ROLLBACK for 2026-06-15_03 + _04 (insight-linker building link + 39-site seed).
--
-- NOT a forward migration — deliberately NO date_NN prefix so it is never picked up
-- by the ordered migration runner. Run MANUALLY (Management API / staging_sql.sh) only
-- when you want to undo the link + seed.
--
-- ⚠️ buildings cascade-delete 35 child tables (reports, tasks, inspections, ...). So a
-- blind delete of the seeded buildings would DESTROY any authored work tied to them.
-- This script is SAFE BY CONSTRUCTION: the guard below ABORTS the whole rollback if ANY
-- seeded building has dependent rows in ANY table that FK-references buildings. In that
-- case, deal with that data first (or roll back selectively) — nothing is deleted.
--
-- AbaQulusi Plaza is NEVER deleted — it pre-existed; dropping the column removes only its link.
-- _05 (postgres_fdw) is a separate, independently-reversible artifact (DROP SERVER ... CASCADE;
-- DROP SCHEMA insight_linker CASCADE;) and is NOT touched here.

DO $$
DECLARE
  seeded  uuid[];
  r       record;
  c       bigint;
  blockers text := '';
BEGIN
  -- The 39 seeded Fortress buildings = linked, excluding the AbaQulusi anchor.
  SELECT array_agg(id) INTO seeded
    FROM public.buildings
   WHERE il_site_id IS NOT NULL
     AND il_site_id <> '16729bf2-d71b-40d1-b8c6-b57d1cadd46a';

  IF seeded IS NULL THEN
    RAISE NOTICE 'No seeded buildings found — nothing to delete.';
    RETURN;
  END IF;

  -- Abort if any seeded building has dependents in ANY FK child of buildings.
  FOR r IN
    SELECT tc.table_schema AS s, tc.table_name AS t, kcu.column_name AS col
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.constraint_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema
     WHERE tc.constraint_type = 'FOREIGN KEY'
       AND ccu.table_name = 'buildings' AND ccu.table_schema = 'public'
  LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I = ANY($1)', r.s, r.t, r.col)
      INTO c USING seeded;
    IF c > 0 THEN
      blockers := blockers || format('  %s.%s = %s rows%s', r.s, r.t, c, E'\n');
    END IF;
  END LOOP;

  IF blockers <> '' THEN
    RAISE EXCEPTION E'ROLLBACK ABORTED — seeded buildings have dependent data (would be cascade-deleted):\n%Resolve/reassign that data first, then re-run.', blockers;
  END IF;

  -- Clean: delete the 39 empty seeded buildings.
  DELETE FROM public.buildings WHERE id = ANY(seeded);
  RAISE NOTICE 'Deleted % seeded Fortress buildings.', array_length(seeded, 1);
END $$;

-- Undo _03: drop the unique index + column (this also removes AbaQulusi's link).
DROP INDEX IF EXISTS public.buildings_il_site_id_key;
ALTER TABLE public.buildings DROP COLUMN IF EXISTS il_site_id;
