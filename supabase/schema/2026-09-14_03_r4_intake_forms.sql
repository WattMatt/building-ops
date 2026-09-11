-- 2026-09-14_03_r4_intake_forms.sql — R4c "Intake & Forms" (spec §5.10, §5.11). Additive, idempotent.
-- Apply order: staging (after 2026-09-14_01 R4a and _02 R4b) -> npm run smoke:intake && node scripts/rls-smoke.mjs -> prod.
-- The client is unaffected until the tenant_intake feature flag is on and the tenant-intake function is deployed.
begin;

-- ────────────────────────────────────────────────────────────────────────────────────────
-- 1) Tenant intake tokens: one bearer secret per building (rotatable), managed by admin/manager
--    with access to the building. Minted client-side like calendar_tokens (32 random bytes,
--    base64url, 43 chars). The tenant-intake function resolves it with the service role.
-- ────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.intake_tokens (
  id                uuid primary key default gen_random_uuid(),
  building_id       uuid not null references public.buildings(id) on delete cascade,
  token             text not null unique check (token ~ '^[A-Za-z0-9_-]{43}$'),
  label             text,
  is_active         boolean not null default true,
  created_by        uuid references public.profiles(id) on delete set null,   -- reported_by for intake issues; null once that account is gone
  created_at        timestamptz not null default now(),
  last_used_at      timestamptz,
  submissions_count integer not null default 0
);
create index if not exists intake_tokens_building_active_idx on public.intake_tokens (building_id) where is_active;

alter table public.intake_tokens enable row level security;
revoke all on table public.intake_tokens from anon;
drop policy if exists it_select on public.intake_tokens;
create policy it_select on public.intake_tokens for select
  using (public.is_admin_or_manager() and public.can_access_building(building_id));
drop policy if exists it_insert on public.intake_tokens;
create policy it_insert on public.intake_tokens for insert
  with check (public.is_admin_or_manager() and public.can_access_building(building_id) and created_by = auth.uid());
drop policy if exists it_update on public.intake_tokens;
create policy it_update on public.intake_tokens for update
  using (public.is_admin_or_manager() and public.can_access_building(building_id))
  with check (public.is_admin_or_manager() and public.can_access_building(building_id));
-- No delete policy on purpose: a token is disabled (is_active = false), never deleted — submissions_count is history.

-- ────────────────────────────────────────────────────────────────────────────────────────
-- 2) Rate-limit counters. bucket = 't:<token id>' or 'ip:<hashed ip>' (the function hashes with
--    INTAKE_IP_SALT; no raw IP is ever stored). Service role only, through intake_rate_hit.
-- ────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.intake_rate (
  bucket       text not null,
  window_start timestamptz not null,
  count        integer not null default 0,
  primary key (bucket, window_start)
);
alter table public.intake_rate enable row level security;   -- no policies: nobody but the service role reads or writes it
revoke all on table public.intake_rate from public, anon, authenticated;

create or replace function public.intake_rate_hit(p_bucket text, p_limit integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_window timestamptz := date_trunc('hour', now()); v_count integer;
begin
  insert into public.intake_rate (bucket, window_start, count) values (p_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set count = public.intake_rate.count + 1
  returning count into v_count;
  -- Opportunistic prune: a window older than a day can never be read again.
  delete from public.intake_rate where window_start < now() - interval '1 day';
  return v_count <= p_limit;
end $$;
revoke all on function public.intake_rate_hit(text, integer) from public;
revoke execute on function public.intake_rate_hit(text, integer) from anon, authenticated;
grant execute on function public.intake_rate_hit(text, integer) to service_role;

-- Bumps the token's counters after a stored submission (never for honeypot or rejected posts).
create or replace function public.intake_touch(p_token uuid)
returns void language sql security definer set search_path = '' as $$
  update public.intake_tokens
     set last_used_at = now(), submissions_count = submissions_count + 1
   where id = p_token
$$;
revoke all on function public.intake_touch(uuid) from public;
revoke execute on function public.intake_touch(uuid) from anon, authenticated;
grant execute on function public.intake_touch(uuid) to service_role;

-- ────────────────────────────────────────────────────────────────────────────────────────
-- 3) Issues: where it came from, who reported it (no account), and the reference the tenant keeps.
-- ────────────────────────────────────────────────────────────────────────────────────────
alter table public.issues add column if not exists source text not null default 'app';
alter table public.issues drop constraint if exists issues_source_check;
alter table public.issues add constraint issues_source_check check (source in ('app', 'tenant_intake'));
alter table public.issues add column if not exists reporter jsonb;
alter table public.issues drop constraint if exists issues_reporter_object;
alter table public.issues add constraint issues_reporter_object check (reporter is null or jsonb_typeof(reporter) = 'object');
alter table public.issues add column if not exists reference text;
alter table public.issues drop constraint if exists issues_reference_format;
alter table public.issues add constraint issues_reference_format check (reference is null or reference ~ '^FO-[A-Z2-7]{6}$');
-- Unique only where present: app-created issues keep null and never collide.
create unique index if not exists issues_reference_uniq on public.issues (reference) where reference is not null;
create index if not exists issues_source_idx on public.issues (building_id, source) where source <> 'app';

-- Only the service role (no auth.uid()) may mark an issue as tenant-reported or give it a reference:
-- a signed-in client inserting source = 'tenant_intake' would forge the Tenant chip.
create or replace function public.issues_intake_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.source <> 'app' or new.reporter is not null or new.reference is not null then
      raise exception 'issues: source, reporter and reference are set by tenant intake only' using errcode = '42501';
    end if;
  elsif new.source is distinct from old.source or new.reporter is distinct from old.reporter
     or new.reference is distinct from old.reference then
    raise exception 'issues: source, reporter and reference cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.issues_intake_guard() from public;
revoke execute on function public.issues_intake_guard() from anon;
drop trigger if exists trg_issues_intake_guard on public.issues;
create trigger trg_issues_intake_guard before insert or update on public.issues
  for each row execute function public.issues_intake_guard();

-- ────────────────────────────────────────────────────────────────────────────────────────
-- 4) Form templates: the one catalogue. Ids '1'…'14' are what form_submissions.form_template_id
--    already stores. Read by every active user, written by admins; every content edit bumps version.
-- ────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.form_templates (
  id          text primary key,
  name        text not null,
  description text not null default '',
  category    text not null,
  icon        text not null default 'file-text',        -- lucide icon name (kebab-case); the client falls back to file-text
  fields      jsonb not null default '[]'::jsonb check (jsonb_typeof(fields) = 'array'),
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  version     integer not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null
);
alter table public.form_templates enable row level security;
revoke all on table public.form_templates from anon;
drop policy if exists ft_select on public.form_templates;
create policy ft_select on public.form_templates for select using (public.is_active_user());
drop policy if exists ft_insert on public.form_templates;
create policy ft_insert on public.form_templates for insert with check (public.is_admin());
drop policy if exists ft_update on public.form_templates;
create policy ft_update on public.form_templates for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists ft_delete on public.form_templates;
create policy ft_delete on public.form_templates for delete using (public.is_admin());

create or replace function public.form_templates_touch()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  -- The client never sets version; a content change (what a snapshot is taken against) bumps it.
  new.version := old.version;
  if new.fields is distinct from old.fields or new.name is distinct from old.name
     or new.description is distinct from old.description or new.category is distinct from old.category then
    new.version := old.version + 1;
  end if;
  return new;
end $$;
revoke all on function public.form_templates_touch() from public;
revoke execute on function public.form_templates_touch() from anon;
drop trigger if exists trg_form_templates_touch on public.form_templates;
create trigger trg_form_templates_touch before update on public.form_templates
  for each row execute function public.form_templates_touch();

-- Seed: names/descriptions/categories from FormsLibrary.tsx (the long form), icons reconciled
-- (7 file-spreadsheet, 9 shield, 10 flame, 11 file-text, 14 hard-hat), fields = src/lib/formFields.ts verbatim.
insert into public.form_templates (id, name, description, category, icon, sort_order, fields) values
('1', 'Key Access / Key Issuance Log', 'Track keys issued/returned, key ID, purpose', 'Security', 'key', 1, $json$[
 {"label":"Date","type":"date","required":true,"width":"half"},
 {"label":"Time","type":"time","required":true,"width":"half"},
 {"label":"Key ID / Number","type":"text","required":true,"width":"half"},
 {"label":"Key Description","type":"text","required":true,"width":"half"},
 {"label":"Issued To (Name)","type":"text","required":true},
 {"label":"Company / Department","type":"text","width":"half"},
 {"label":"Contact Number","type":"text","width":"half"},
 {"label":"Purpose of Issue","type":"textarea","required":true},
 {"label":"Issue Time","type":"time","required":true,"width":"half"},
 {"label":"Return Time","type":"time","width":"half"},
 {"label":"Supporting Photos","type":"photo","maxPhotos":3},
 {"label":"Recipient Signature","type":"signature","required":true},
 {"label":"Issuing Officer Signature","type":"signature","required":true},
 {"label":"Notes / Remarks","type":"textarea"}
]$json$::jsonb),
('2', 'Roof Access Journal', 'Record personnel, time in/out, work reason, permit', 'Maintenance', 'hard-hat', 2, $json$[
 {"label":"Date","type":"date","required":true,"width":"half"},
 {"label":"Permit Number","type":"text","width":"half"},
 {"label":"Personnel Name","type":"text","required":true},
 {"label":"Company","type":"text","required":true,"width":"half"},
 {"label":"ID Number","type":"text","width":"half"},
 {"label":"Time In","type":"time","required":true,"width":"half"},
 {"label":"Time Out","type":"time","width":"half"},
 {"label":"Reason for Access","type":"textarea","required":true},
 {"label":"Equipment Carried","type":"textarea"},
 {"label":"Safety Briefing Completed","type":"checkbox","required":true},
 {"label":"PPE Worn","type":"checkbox","required":true},
 {"label":"Supporting Photos","type":"photo","maxPhotos":5},
 {"label":"Authorised By","type":"text","required":true},
 {"label":"Authoriser Signature","type":"signature","required":true},
 {"label":"Personnel Signature","type":"signature","required":true}
]$json$::jsonb),
('3', 'Daily Site Handover Log', 'Shift notes, outstanding tasks, incidents', 'Operations', 'clipboard-list', 3, $json$[
 {"label":"Date","type":"date","required":true,"width":"half"},
 {"label":"Shift","type":"select","options":["Day Shift","Night Shift"],"required":true,"width":"half"},
 {"label":"Outgoing Officer Name","type":"text","required":true,"width":"half"},
 {"label":"Incoming Officer Name","type":"text","required":true,"width":"half"},
 {"label":"Handover Time","type":"time","required":true},
 {"label":"Outstanding Tasks","type":"textarea","required":true},
 {"label":"Incidents During Shift","type":"textarea"},
 {"label":"Equipment Status","type":"textarea"},
 {"label":"Key Items Handed Over","type":"textarea"},
 {"label":"Special Instructions","type":"textarea"},
 {"label":"Supporting Photos","type":"photo","maxPhotos":5},
 {"label":"Outgoing Officer Signature","type":"signature","required":true},
 {"label":"Incoming Officer Signature","type":"signature","required":true}
]$json$::jsonb),
('4', 'Asset Inspection Report', 'Condition checks for HVAC, lifts, escalators', 'Maintenance', 'wrench', 4, $json$[
 {"label":"Date","type":"date","required":true,"width":"half"},
 {"label":"Asset ID","type":"text","required":true,"width":"half"},
 {"label":"Asset Type","type":"select","options":["HVAC","Lift","Escalator","Generator","Fire System","Other"],"required":true},
 {"label":"Location","type":"text","required":true},
 {"label":"Inspector Name","type":"text","required":true},
 {"label":"Visual Condition","type":"select","options":["Good","Fair","Poor","Critical"],"required":true,"width":"half"},
 {"label":"Operational Status","type":"select","options":["Operational","Degraded","Non-Operational"],"required":true,"width":"half"},
 {"label":"Last Service Date","type":"date","width":"half"},
 {"label":"Next Service Due","type":"date","width":"half"},
 {"label":"Findings / Observations","type":"textarea","required":true},
 {"label":"Recommended Actions","type":"textarea"},
 {"label":"Evidence Photos","type":"photo","maxPhotos":5},
 {"label":"Inspector Signature","type":"signature","required":true}
]$json$::jsonb),
('5', 'Cleaning & Hygiene Log', 'Restroom checks, consumables restocked, deep-clean notes', 'Cleaning', 'clipboard-list', 5, $json$[
 {"label":"Date","type":"date","required":true,"width":"half"},
 {"label":"Time","type":"time","required":true,"width":"half"},
 {"label":"Area / Location","type":"text","required":true},
 {"label":"Cleaning Type","type":"select","options":["Routine","Deep Clean","Spot Clean","Sanitisation"],"required":true},
 {"label":"Cleaner Name","type":"text","required":true},
 {"label":"Floors Mopped","type":"checkbox"},
 {"label":"Surfaces Wiped","type":"checkbox"},
 {"label":"Bins Emptied","type":"checkbox"},
 {"label":"Consumables Restocked","type":"checkbox"},
 {"label":"Consumables Notes","type":"textarea"},
 {"label":"Issues Found","type":"textarea"},
 {"label":"Completion Photos","type":"photo","maxPhotos":5},
 {"label":"Supervisor Check","type":"checkbox"},
 {"label":"Cleaner Signature","type":"signature","required":true},
 {"label":"Supervisor Signature","type":"signature"}
]$json$::jsonb),
('6', 'Access Control / Visitor Log', 'Visitor name, company, host, ID, badge issued', 'Security', 'users', 6, $json$[
 {"label":"Date","type":"date","required":true,"width":"half"},
 {"label":"Time In","type":"time","required":true,"width":"half"},
 {"label":"Visitor Name","type":"text","required":true},
 {"label":"Company / Organisation","type":"text","required":true},
 {"label":"ID Type","type":"select","options":["ID Card","Passport","Driver's License","Other"],"required":true,"width":"half"},
 {"label":"ID Number","type":"text","required":true,"width":"half"},
 {"label":"Host Name","type":"text","required":true},
 {"label":"Host Department","type":"text","width":"half"},
 {"label":"Host Contact","type":"text","width":"half"},
 {"label":"Purpose of Visit","type":"textarea","required":true},
 {"label":"Badge Number Issued","type":"text","required":true},
 {"label":"Time Out","type":"time"},
 {"label":"Badge Returned","type":"checkbox"},
 {"label":"ID Photo / Supporting Documents","type":"photo","maxPhotos":3},
 {"label":"Visitor Signature","type":"signature","required":true},
 {"label":"Security Officer","type":"text","required":true}
]$json$::jsonb),
('7', 'Work Order / Job Card', 'Request, scope, cost, vendor, completion evidence', 'Operations', 'file-spreadsheet', 7, $json$[
 {"label":"Work Order Number","type":"text","required":true,"width":"half"},
 {"label":"Date Raised","type":"date","required":true,"width":"half"},
 {"label":"Requested By","type":"text","required":true},
 {"label":"Priority","type":"select","options":["Low","Medium","High","Emergency"],"required":true},
 {"label":"Location","type":"text","required":true},
 {"label":"Description of Work","type":"textarea","required":true},
 {"label":"Assigned Vendor / Technician","type":"text"},
 {"label":"Estimated Cost","type":"text","width":"half"},
 {"label":"Actual Cost","type":"text","width":"half"},
 {"label":"Start Date","type":"date","width":"half"},
 {"label":"Completion Date","type":"date","width":"half"},
 {"label":"Work Performed","type":"textarea"},
 {"label":"Materials Used","type":"textarea"},
 {"label":"Before / After Photos","type":"photo","maxPhotos":10},
 {"label":"Completion Evidence Attached","type":"checkbox"},
 {"label":"Technician Signature","type":"signature"},
 {"label":"Approved By Signature","type":"signature"}
]$json$::jsonb),
('8', 'Incident / Near-miss Report', 'Safety incidents, photos, corrective actions', 'Safety', 'alert-triangle', 8, $json$[
 {"label":"Date of Incident","type":"date","required":true,"width":"half"},
 {"label":"Time of Incident","type":"time","required":true,"width":"half"},
 {"label":"Location","type":"text","required":true},
 {"label":"Incident Type","type":"select","options":["Injury","Near Miss","Property Damage","Environmental","Security"],"required":true},
 {"label":"Severity","type":"select","options":["Minor","Moderate","Serious","Critical"],"required":true},
 {"label":"Persons Involved","type":"textarea","required":true},
 {"label":"Witnesses","type":"textarea"},
 {"label":"Description of Incident","type":"textarea","required":true},
 {"label":"Immediate Actions Taken","type":"textarea","required":true},
 {"label":"Root Cause Analysis","type":"textarea"},
 {"label":"Corrective Actions Required","type":"textarea","required":true},
 {"label":"Incident Photos","type":"photo","required":true,"maxPhotos":10},
 {"label":"First Aid Administered","type":"checkbox"},
 {"label":"Emergency Services Called","type":"checkbox"},
 {"label":"Reporter Name","type":"text","required":true},
 {"label":"Reporter Signature","type":"signature","required":true},
 {"label":"Manager Review Signature","type":"signature"}
]$json$::jsonb),
('9', 'Evacuation Drill Record', 'Drill date, attendance, timing, lessons learned', 'Safety', 'shield', 9, $json$[
 {"label":"Drill Date","type":"date","required":true,"width":"half"},
 {"label":"Drill Time","type":"time","required":true,"width":"half"},
 {"label":"Drill Type","type":"select","options":["Fire","Earthquake","Bomb Threat","General Emergency"],"required":true},
 {"label":"Building / Zone","type":"text","required":true},
 {"label":"Total Occupants","type":"text","required":true,"width":"half"},
 {"label":"Evacuation Time (minutes)","type":"text","required":true,"width":"half"},
 {"label":"Assembly Point Used","type":"text","required":true},
 {"label":"All Areas Cleared","type":"checkbox","required":true},
 {"label":"Roll Call Completed","type":"checkbox","required":true},
 {"label":"Fire Wardens Present","type":"textarea"},
 {"label":"Issues Identified","type":"textarea"},
 {"label":"Lessons Learned","type":"textarea"},
 {"label":"Recommendations","type":"textarea"},
 {"label":"Drill Photos","type":"photo","maxPhotos":5},
 {"label":"Drill Coordinator","type":"text","required":true},
 {"label":"Coordinator Signature","type":"signature","required":true}
]$json$::jsonb),
('10', 'Permit to Work / Hot Work Permit', 'Authorisation for hazardous tasks, controls', 'Safety', 'flame', 10, $json$[
 {"label":"Permit Number","type":"text","required":true,"width":"half"},
 {"label":"Date","type":"date","required":true,"width":"half"},
 {"label":"Work Type","type":"select","options":["Hot Work","Confined Space","Working at Height","Electrical","Excavation"],"required":true},
 {"label":"Location","type":"text","required":true},
 {"label":"Contractor Name","type":"text","required":true},
 {"label":"Company","type":"text","required":true},
 {"label":"Description of Work","type":"textarea","required":true},
 {"label":"Start Time","type":"time","required":true,"width":"half"},
 {"label":"End Time","type":"time","required":true,"width":"half"},
 {"label":"Hazards Identified","type":"textarea","required":true},
 {"label":"Control Measures","type":"textarea","required":true},
 {"label":"Fire Extinguisher Available","type":"checkbox","required":true},
 {"label":"Fire Watch Required","type":"checkbox"},
 {"label":"Area Isolated","type":"checkbox"},
 {"label":"PPE Requirements","type":"textarea","required":true},
 {"label":"Site Condition Photos","type":"photo","maxPhotos":5},
 {"label":"Contractor Signature","type":"signature","required":true},
 {"label":"Authorising Officer","type":"text","required":true},
 {"label":"Authoriser Signature","type":"signature","required":true},
 {"label":"Permit Closed","type":"checkbox"},
 {"label":"Close-out Time","type":"time"},
 {"label":"Close-out Signature","type":"signature"}
]$json$::jsonb),
('11', 'Certificate Register', 'Statutory certificates, issuer, expiry, renewal actions', 'Compliance', 'file-text', 11, $json$[
 {"label":"Certificate Type","type":"text","required":true},
 {"label":"Certificate Number","type":"text","required":true},
 {"label":"Asset / Equipment","type":"text","required":true},
 {"label":"Location","type":"text","required":true},
 {"label":"Issuing Authority","type":"text","required":true},
 {"label":"Issue Date","type":"date","required":true,"width":"half"},
 {"label":"Expiry Date","type":"date","required":true,"width":"half"},
 {"label":"Renewal Lead Time (days)","type":"text","width":"half"},
 {"label":"Responsible Person","type":"text","required":true},
 {"label":"Renewal Status","type":"select","options":["Current","Due Soon","Expired","Renewed"],"required":true},
 {"label":"Notes / Actions","type":"textarea"},
 {"label":"Certificate Photos","type":"photo","maxPhotos":5},
 {"label":"Document Attached","type":"checkbox"}
]$json$::jsonb),
('12', 'Pest Control & Waste Log', 'Treatments, locations, hazardous waste disposals', 'Operations', 'clipboard-list', 12, $json$[
 {"label":"Date","type":"date","required":true,"width":"half"},
 {"label":"Type","type":"select","options":["Pest Control","Waste Disposal","Hazardous Waste"],"required":true,"width":"half"},
 {"label":"Location / Area","type":"text","required":true},
 {"label":"Contractor / Company","type":"text","required":true},
 {"label":"Technician Name","type":"text","required":true},
 {"label":"Treatment / Service Type","type":"textarea","required":true},
 {"label":"Chemicals / Materials Used","type":"textarea"},
 {"label":"Quantity Disposed (if waste)","type":"text"},
 {"label":"Disposal Method","type":"text"},
 {"label":"Findings / Observations","type":"textarea"},
 {"label":"Service Photos","type":"photo","maxPhotos":5},
 {"label":"Follow-up Required","type":"checkbox"},
 {"label":"Next Service Date","type":"date"},
 {"label":"Technician Signature","type":"signature","required":true},
 {"label":"FM Officer Signature","type":"signature"}
]$json$::jsonb),
('13', 'Parking & Vehicle Incident Log', 'Accidents, oil spills, tow actions', 'Security', 'truck', 13, $json$[
 {"label":"Date","type":"date","required":true,"width":"half"},
 {"label":"Time","type":"time","required":true,"width":"half"},
 {"label":"Incident Type","type":"select","options":["Accident","Oil Spill","Unauthorised Parking","Tow Required","Vandalism","Other"],"required":true},
 {"label":"Location / Bay Number","type":"text","required":true},
 {"label":"Vehicle Registration","type":"text","required":true},
 {"label":"Vehicle Make / Model","type":"text"},
 {"label":"Owner / Driver Name","type":"text"},
 {"label":"Contact Number","type":"text"},
 {"label":"Description of Incident","type":"textarea","required":true},
 {"label":"Actions Taken","type":"textarea","required":true},
 {"label":"Tow Company Called","type":"checkbox"},
 {"label":"Tow Company Name","type":"text"},
 {"label":"Incident Photos","type":"photo","maxPhotos":5},
 {"label":"Police Report Number","type":"text"},
 {"label":"Reporting Officer","type":"text","required":true},
 {"label":"Officer Signature","type":"signature","required":true}
]$json$::jsonb),
('14', 'Training & PPE Issuance Record', 'Attendance, issued PPE, refresher dates', 'HR/Safety', 'hard-hat', 14, $json$[
 {"label":"Date","type":"date","required":true,"width":"half"},
 {"label":"Type","type":"select","options":["Training","PPE Issuance","Both"],"required":true,"width":"half"},
 {"label":"Employee Name","type":"text","required":true},
 {"label":"Employee ID","type":"text","required":true,"width":"half"},
 {"label":"Department","type":"text","width":"half"},
 {"label":"Training Topic","type":"text"},
 {"label":"Training Duration (hours)","type":"text"},
 {"label":"Trainer Name","type":"text"},
 {"label":"PPE Items Issued","type":"textarea"},
 {"label":"PPE Size / Specifications","type":"textarea"},
 {"label":"Training / PPE Photos","type":"photo","maxPhotos":5},
 {"label":"Competency Assessment Passed","type":"checkbox"},
 {"label":"Refresher Due Date","type":"date"},
 {"label":"Employee Acknowledgement","type":"checkbox","required":true},
 {"label":"Employee Signature","type":"signature","required":true},
 {"label":"Issuing Officer","type":"text","required":true},
 {"label":"Officer Signature","type":"signature","required":true}
]$json$::jsonb)
on conflict (id) do nothing;

-- ────────────────────────────────────────────────────────────────────────────────────────
-- 5) Submissions remember what they were filled against (old rows stay null → the client
--    falls back to the template's current fields, as it does today).
-- ────────────────────────────────────────────────────────────────────────────────────────
alter table public.form_submissions add column if not exists template_version integer;
alter table public.form_submissions add column if not exists fields_snapshot jsonb;
alter table public.form_submissions drop constraint if exists form_submissions_fields_snapshot_array;
alter table public.form_submissions add constraint form_submissions_fields_snapshot_array
  check (fields_snapshot is null or jsonb_typeof(fields_snapshot) = 'array');

-- ────────────────────────────────────────────────────────────────────────────────────────
-- 6) Storage: intake photos are written by the service role under intake/<building_id>/…;
--    signed-in readers need building access (SignedImage re-signs the stored public-style URL).
--    No insert policy: a signed-in client must never write this prefix.
-- ────────────────────────────────────────────────────────────────────────────────────────
drop policy if exists "td read intake photos" on storage.objects;
create policy "td read intake photos" on storage.objects for select using (
  bucket_id = 'tenant-documents'
  and split_part(name, '/', 1) = 'intake'
  and public.can_access_building(nullif(split_part(name, '/', 2), '')::uuid)
);

-- ────────────────────────────────────────────────────────────────────────────────────────
-- 7) Notification kind. Restated as the UNION of every kind the R4 slices add, because the
--    last migration to touch the constraint wins (R4a _01: issue_sla_breached; R4b _02:
--    report_due_soon, report_export_needed). Mirror: supabase/functions/_shared/notifyRules.ts.
-- ────────────────────────────────────────────────────────────────────────────────────────
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'task_assigned','issue_assigned','issue_comment','issue_mention',
  'report_submitted','report_returned','report_approved',
  'form_submitted','form_reviewed','signoff_requested','signoff_complete','signoff_overdue',
  'document_expiring','asset_service_due','task_due_today',
  'issue_sla_breached',
  'report_due_soon','report_export_needed',
  'issue_reported'));

commit;

-- Verify (staging, after apply):
--   select count(*) from public.form_templates;                                   -- 14
--   select id, version, jsonb_array_length(fields) from public.form_templates order by sort_order;
--   select policyname, cmd from pg_policies where tablename in ('intake_tokens','form_templates') order by 1;
--     -> ft_delete DELETE, ft_insert INSERT, ft_select SELECT, ft_update UPDATE, it_insert INSERT, it_select SELECT, it_update UPDATE
--   select has_function_privilege('anon', 'public.intake_rate_hit(text,integer)', 'execute'),
--          has_function_privilege('authenticated', 'public.intake_rate_hit(text,integer)', 'execute'),
--          has_function_privilege('service_role', 'public.intake_rate_hit(text,integer)', 'execute');   -- f, f, t
--   select policyname from pg_policies where tablename = 'objects' and policyname = 'td read intake photos';
--   select conname from pg_constraint where conname in ('issues_source_check','issues_reference_format','notifications_kind_check');
