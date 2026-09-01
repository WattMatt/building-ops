-- 2026-06-14_01_form_signoff.sql
-- Multi-signer sign-off for form submissions: request -> notify -> sign -> record.
-- Apply to STAGING (vkrihpmjajjcxmzgjqdr) first; PROD (qdzgkttiosahdfqresvz) on owner sign-off.

-- form_submissions gains an overall sign-off state
alter table public.form_submissions
  add column if not exists signoff_status text not null default 'none'
    check (signoff_status in ('none','pending','complete','rejected'));

-- one row per (submission, signer) assignment
create table if not exists public.form_signoff_requests (
  id              uuid primary key default gen_random_uuid(),
  submission_id   uuid not null references public.form_submissions(id) on delete cascade,
  assigned_to     uuid not null references public.profiles(id),
  assigned_by     uuid references public.profiles(id),
  sequence_order  int  not null default 1,
  mode            text not null default 'sequential' check (mode in ('sequential','parallel')),
  status          text not null default 'pending'   check (status in ('pending','signed','declined','expired')),
  active          boolean not null default false,   -- is it this signer's turn? (set on assign + by trigger)
  due_at          timestamptz,
  instructions    text,
  decline_reason  text,
  reminded_at     timestamptz,                      -- last reminder sent (reminder job de-dupes on this)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists fsr_submission_idx on public.form_signoff_requests (submission_id);
create index if not exists fsr_assignee_active_idx
  on public.form_signoff_requests (assigned_to) where active and status = 'pending';

-- immutable audit trail of captured signatures
create table if not exists public.form_signatures (
  id                uuid primary key default gen_random_uuid(),
  request_id        uuid not null references public.form_signoff_requests(id) on delete cascade,
  submission_id     uuid not null references public.form_submissions(id) on delete cascade,
  signer_id         uuid not null references public.profiles(id),
  method            text not null check (method in ('drawn','typed')),
  signature_url     text,           -- storage path for drawn signatures
  typed_name        text,           -- for typed signatures
  confirmation_text text not null,  -- the legal statement shown at signing time
  notes             text,
  ip_address        text,
  user_agent        text,
  signed_at         timestamptz not null default now()
);
create index if not exists fsig_submission_idx on public.form_signatures (submission_id);

-- ── state machine: advance on signature insert ──
create or replace function public.advance_form_signoff() returns trigger
language plpgsql security definer set search_path = public as $$
declare req record; remaining int;
begin
  update public.form_signoff_requests
     set status = 'signed', active = false, updated_at = now()
   where id = NEW.request_id;

  select * into req from public.form_signoff_requests where id = NEW.request_id;

  -- sequential: activate the next-lowest pending step
  if req.mode = 'sequential' then
    update public.form_signoff_requests
       set active = true, updated_at = now()
     where submission_id = req.submission_id
       and status = 'pending'
       and sequence_order = (
         select min(sequence_order) from public.form_signoff_requests
          where submission_id = req.submission_id and status = 'pending'
       );
  end if;

  select count(*) into remaining from public.form_signoff_requests
   where submission_id = req.submission_id and status = 'pending';
  if remaining = 0 then
    update public.form_submissions set signoff_status = 'complete', updated_at = now()
     where id = req.submission_id;
  end if;
  return NEW;
end; $$;

drop trigger if exists trg_advance_form_signoff on public.form_signatures;
create trigger trg_advance_form_signoff after insert on public.form_signatures
  for each row execute function public.advance_form_signoff();

-- ── decline → submission rejected ──
create or replace function public.handle_signoff_decline() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.status = 'declined' and coalesce(OLD.status,'') <> 'declined' then
    -- one decline vetoes the whole submission: reject it and halt the chain by
    -- deactivating any still-pending siblings (sequential or parallel).
    update public.form_submissions set signoff_status = 'rejected', updated_at = now()
     where id = NEW.submission_id;
    update public.form_signoff_requests set active = false, updated_at = now()
     where submission_id = NEW.submission_id and id <> NEW.id and status = 'pending';
  end if;
  return NEW;
end; $$;

drop trigger if exists trg_signoff_decline on public.form_signoff_requests;
create trigger trg_signoff_decline after update on public.form_signoff_requests
  for each row execute function public.handle_signoff_decline();

-- ── RLS ──
alter table public.form_signoff_requests enable row level security;
alter table public.form_signatures       enable row level security;

drop policy if exists fsr_read on public.form_signoff_requests;
create policy fsr_read on public.form_signoff_requests for select using (
  is_admin_or_manager()
  or assigned_to = auth.uid()
  or exists (select 1 from public.form_submissions s
             where s.id = submission_id
               and (s.submitted_by = auth.uid() or can_access_building(s.building_id)))
);

drop policy if exists fsr_write on public.form_signoff_requests;
create policy fsr_write on public.form_signoff_requests for insert with check ( is_admin_or_manager() );

drop policy if exists fsr_update on public.form_signoff_requests;
create policy fsr_update on public.form_signoff_requests for update
  using ( is_admin_or_manager() or assigned_to = auth.uid() )
  with check ( is_admin_or_manager() or assigned_to = auth.uid() );

-- signatures: only the assigned signer may insert, only for THEIR active pending request
drop policy if exists fsig_insert on public.form_signatures;
create policy fsig_insert on public.form_signatures for insert with check (
  signer_id = auth.uid()
  and exists (select 1 from public.form_signoff_requests r
              where r.id = request_id and r.assigned_to = auth.uid()
                and r.active and r.status = 'pending')
  -- a drawn signature's stored path must live under THIS signer's own folder
  -- (signatures/<submission_id>/<signer_id>/...), so the evidence path cannot be forged
  and (
    method <> 'drawn'
    or (split_part(signature_url, '/', 1) = 'signatures'
        and split_part(signature_url, '/', 3) = auth.uid()::text)
  )
);

drop policy if exists fsig_read on public.form_signatures;
create policy fsig_read on public.form_signatures for select using (
  is_admin_or_manager()
  or signer_id = auth.uid()
  or exists (select 1 from public.form_submissions s
             where s.id = submission_id
               and (s.submitted_by = auth.uid() or can_access_building(s.building_id)))
);
