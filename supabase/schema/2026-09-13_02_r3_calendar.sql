-- 2026-09-13_02_r3_calendar.sql — R3b calendar tokens (spec §5.5). Additive, idempotent.
-- Apply order: staging -> npm run smoke -> prod.
begin;

-- One row per feed subscription. building_id null = the user's own ("my work") feed;
-- set = a building feed. The token is stored plain (owner-only RLS, rotate on demand)
-- and is minted client-side: 43-char base64url of 32 random bytes.
create table if not exists public.calendar_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  building_id  uuid references public.buildings(id) on delete cascade,      -- null = the user's own feed
  token        text not null unique,                                          -- 43-char base64url of 32 random bytes, minted client-side
  label        text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index if not exists calendar_tokens_user_idx on public.calendar_tokens (user_id);

-- Owner-only, like notifications / push_subscriptions: admin and manager see nothing here.
-- A building token additionally needs the owner to be able to access that building at mint time.
alter table public.calendar_tokens enable row level security;
drop policy if exists ct_tokens_select on public.calendar_tokens;
create policy ct_tokens_select on public.calendar_tokens for select using (user_id = auth.uid());
drop policy if exists ct_tokens_insert on public.calendar_tokens;
create policy ct_tokens_insert on public.calendar_tokens for insert
  with check (user_id = auth.uid() and (building_id is null or public.can_access_building(building_id)));
drop policy if exists ct_tokens_update on public.calendar_tokens;
create policy ct_tokens_update on public.calendar_tokens for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists ct_tokens_delete on public.calendar_tokens;
create policy ct_tokens_delete on public.calendar_tokens for delete using (user_id = auth.uid());

-- The feed function resolves a token with the service role and then applies the OWNER's access:
-- this helper answers "can user X see building B" without a session, mirroring can_access_building
-- (2026-09-11_03_deactivated_rls_gate.sql): deactivated -> false; admin/manager -> every building;
-- otherwise a user_buildings row. Service-role only — it takes the user id as an argument, so a
-- signed-in caller must never be able to ask it about somebody else.
create or replace function public.user_can_access_building(p_user uuid, p_building uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select deactivated from public.profiles where id = p_user), false) = false
     and ( exists (select 1 from public.user_roles r where r.user_id = p_user and r.role in ('admin','manager'))
        or exists (select 1 from public.user_buildings ub where ub.user_id = p_user and ub.building_id = p_building) )
$$;
revoke all on function public.user_can_access_building(uuid, uuid) from public;
revoke execute on function public.user_can_access_building(uuid, uuid) from anon, authenticated;
grant execute on function public.user_can_access_building(uuid, uuid) to service_role;

commit;

-- Verify:
--   select policyname, cmd from pg_policies where tablename = 'calendar_tokens' order by 1;
--     -> ct_tokens_delete DELETE, ct_tokens_insert INSERT, ct_tokens_select SELECT, ct_tokens_update UPDATE
--   select has_function_privilege('anon', 'public.user_can_access_building(uuid,uuid)', 'execute'),
--          has_function_privilege('authenticated', 'public.user_can_access_building(uuid,uuid)', 'execute'),
--          has_function_privilege('service_role', 'public.user_can_access_building(uuid,uuid)', 'execute');
--     -> f, f, t
