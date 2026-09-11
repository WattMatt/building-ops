-- 2026-09-14_04_r4c_review_fixes.sql
-- Review fixes for R4c (2026-09-14_03_r4_intake_forms.sql), which is already applied to staging and
-- production and is therefore never amended. Additive and idempotent; safe on a project that has _03
-- applied and on one that gets _03 then _04 back to back. Requires _03 (intake_rate, intake_rate_hit,
-- intake_tokens) and 2026-09-14_01 (organizations.settings).
--
--   1) intake_rate.window_start index. intake_rate_hit prunes old windows on EVERY hit, and with no
--      index that is a sequential scan of the table on every unauthenticated request the public
--      tenant-intake endpoint serves.
--   2) intake_rate_hit: the prune is now sampled (~1 request in 50) instead of running on every hit.
--      Same signature, same return, same limit semantics — only the housekeeping changed.
--   3) intake_rate_check(bucket, limit): reads a bucket's verdict WITHOUT charging it. The intake
--      function needs this so the token's 20/hour allowance can be checked before a body is parsed
--      but spent only when a submission is actually stored — the token is printed on a poster by
--      design, so junk posts must not be able to silence a building's intake for the hour.
--   4) organizations.settings.intake.show_shop_names seeded to false where it is absent. The
--      tenant-intake GET is unauthenticated: it hands a building's shop list to anyone who
--      photographs the poster, so shop NAMES (the tenant roster) now ship only on an explicit
--      opt-in. Numbers alone, which are all the form needs, remain the default. A settings key
--      rather than a column: organizations.settings already exists and carries features.*, so this
--      is the least invasive place for it and needs no new grants or policies.
--
-- No new tables, so no new RLS surface: intake_rate keeps RLS enabled with no policies (service role
-- only) and both functions stay revoked from public, anon and authenticated.
begin;

-- ============================================================
-- 1) The prune's index.
-- ============================================================
create index if not exists intake_rate_window_idx on public.intake_rate (window_start);

-- ============================================================
-- 2) intake_rate_hit — charge a bucket and answer whether it is still under its limit.
-- ============================================================
create or replace function public.intake_rate_hit(p_bucket text, p_limit integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_window timestamptz := date_trunc('hour', now()); v_count integer;
begin
  insert into public.intake_rate (bucket, window_start, count) values (p_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set count = public.intake_rate.count + 1
  returning count into v_count;
  -- Opportunistic prune: a window older than a day can never be read again. Sampled, because this
  -- runs on an unauthenticated public endpoint and sweeping on every hit is the expensive half.
  if random() < 0.02 then
    delete from public.intake_rate where window_start < now() - interval '1 day';
  end if;
  return v_count <= p_limit;
end $$;
revoke all on function public.intake_rate_hit(text, integer) from public;
revoke execute on function public.intake_rate_hit(text, integer) from anon, authenticated;
grant execute on function public.intake_rate_hit(text, integer) to service_role;

-- ============================================================
-- 3) intake_rate_check — the same verdict, without charging.
-- ============================================================
create or replace function public.intake_rate_check(p_bucket text, p_limit integer)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select r.count from public.intake_rate r
      where r.bucket = p_bucket and r.window_start = date_trunc('hour', now())),
    0) < p_limit
$$;
revoke all on function public.intake_rate_check(text, integer) from public;
revoke execute on function public.intake_rate_check(text, integer) from anon, authenticated;
grant execute on function public.intake_rate_check(text, integer) to service_role;

comment on function public.intake_rate_check(text, integer) is
  'Reads a rate bucket''s verdict for the current hour without incrementing it. tenant-intake uses it to gate a body parse on a token whose allowance is only spent by a stored submission.';

-- ============================================================
-- 4) The shop-name opt-in, defaulted to numbers only.
-- ============================================================
update public.organizations
   set settings = coalesce(settings, '{}'::jsonb)
                  || jsonb_build_object(
                       'intake',
                       coalesce(settings -> 'intake', '{}'::jsonb)
                       || jsonb_build_object('show_shop_names', false))
 where coalesce(settings, '{}'::jsonb) #> '{intake,show_shop_names}' is null;

commit;
