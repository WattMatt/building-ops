#!/usr/bin/env node
/**
 * Snapshot & SLA journey smoke (R4a, migration 2026-09-14_01, spec §5.1–5.6) — proves the nightly
 * building_metrics_daily row, the portfolio roll-up, the expiring-items function and the SLA clock against
 * the live backend with disposable fixtures it cleans up:
 *
 *   setup    building A + admin + site user on A + a building B nobody but the admin sees
 *   step 1   fixtures on A: one approved ops_monthly report for this month (no assessment → compliance null),
 *            three task_instances (completed yesterday / pending today / overdue 3 days), one open high issue and
 *            one resolved 5 days ago, two building_documents (+10 d, −5 d), a tenant document (+45 d), an asset
 *            with service overdue (−1 d) and a warranty (+80 d)
 *   step 2   snapshot_building_metrics(today, A) as admin → 1; the (A, today) row carries the counts this fixture
 *            drives (tasks, issues, documents, assets, report_state); compliance / critical / inspection / ppm are
 *            null here because the fixture seeds no assessment, inspection or PPM grid
 *   step 3   run again → still exactly one row, computed_at strictly newer (today's row is replaced; a genuine
 *            past-day row is immutable and only a reconstructed one is replaced — see the migration)
 *   step 4   only today exists inside the 90-day window (A is newer than the migration's backfill); a snapshot
 *            for today−7 is marked reconstructed and shows the fixture issues as not yet open
 *   step 5   RLS: the site user reads A's rows and none of B's; anon cannot read the table or the view; the admin
 *            reads the portfolio row for today with ≥ 2 buildings
 *   step 6   gates: site user → 403, anon → 401/403, a future p_day → 400 (22023)
 *   step 7   expiring_items(90) as the site user lists the five A fixtures with the right kinds and days_left;
 *            anon → 401/403
 *   step 8   SLA: a critical issue gets the org default target on insert; a comment by someone other than the
 *            reporter stamps first_response_at; a target pushed into the past is swept by mark_sla_breaches (as
 *            admin) which writes exactly one issue_sla_breached inbox row for the admin; a second sweep adds none;
 *            site user → 403, anon → 401/403
 *   step 9   (project-wide, behind PROJECT_WIDE_ALLOWED) snapshot_building_metrics(today, null) as admin: HTTP 200
 *            in < 30 s; the elapsed ms is printed for APPLY_CHECKLIST
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... \
 *   node scripts/snapshot-smoke.mjs
 *
 * Dates are computed from today's SAST date (the server's day boundary is Africa/Johannesburg), never hard-coded.
 * Every step but 9 is scoped to the fixture buildings; step 9 fans out across every building and is SKIPPED on
 * prod unless SMOKE_ALLOW_PROD=1 (same guard as checklist-smoke / ppm-smoke). mark_sla_breaches (step 8) is the
 * same call the sla-breach-sweep cron makes every 15 minutes, so running it early changes nothing the cron would
 * not have done within the quarter hour.
 */

const URL_BASE = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!URL_BASE || !SERVICE || !ANON) {
  console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY');
  process.exit(2);
}

// Same guard as scripts/checklist-smoke.mjs and ppm-smoke.mjs; step 9 is the only project-wide step.
const PROD_REF = 'qdzgkttiosahdfqresvz';
const PROJECT_WIDE_ALLOWED = !URL_BASE.includes(PROD_REF) || process.env.SMOKE_ALLOW_PROD === '1';
if (!PROJECT_WIDE_ALLOWED) console.log(`  NOTE  SUPABASE_URL contains the prod ref ${PROD_REF}; the project-wide snapshot timing (step 9) is skipped.`);

const RUN = crypto.randomUUID().slice(0, 8);
const PASSWORD = `Snap-Smoke-${RUN}!`;
const SVC = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const authed = (jwt) => ({ apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' });

let pass = 0, failures = 0;
const fails = [];
const ok = (n) => { pass++; console.log(`  PASS  ${n}`); };
const fail = (n, d) => { failures++; fails.push(`${n} — ${d}`); console.error(`  FAIL  ${n} — ${d}`); };
const assert = (n, cond, d) => (cond ? ok(n) : fail(n, d));
const skip = (n, why) => console.log(`  SKIP  ${n} — ${why}`);

async function svcInsert(table, row) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}`, {
    method: 'POST', headers: { ...SVC, Prefer: 'return=representation' }, body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`fixture ${table}: HTTP ${res.status} ${await res.text()}`);
  return (await res.json())[0];
}
/** Service-role delete by filter. Throws on a non-2xx so a teardown that silently leaves rows behind cannot pass. */
async function svcDelete(table, filter) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}?${filter}`, { method: 'DELETE', headers: SVC });
  if (!res.ok) throw new Error(`fixture delete ${table}?${filter}: HTTP ${res.status} ${await res.text()}`);
}
async function svcSelect(table, filter) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}?${filter}`, { headers: SVC });
  if (!res.ok) throw new Error(`fixture select ${table}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}
/** Service-role patch by filter (fixtures only). */
async function svcPatch(table, filter, patch) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}?${filter}`, {
    method: 'PATCH', headers: { ...SVC, Prefer: 'return=representation' }, body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`fixture patch ${table}?${filter}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}
/** Persona-scoped select: RLS applies. Returns the rows (empty on a filtered-out row) or null on an HTTP error. */
async function selectAs(jwt, table, filter) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}?${filter}`, { headers: authed(jwt) });
  if (!res.ok) return null;
  return res.json();
}
const rpc = (tok, fn, body) => fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
  method: 'POST', headers: tok ? authed(tok) : { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
/** rpc + parsed body: { status, ok, body } — body is the JSON value (a scalar for integer-returning functions). */
async function rpcJson(tok, fn, body) {
  const res = await rpc(tok, fn, body);
  let parsed = null;
  try { parsed = await res.json(); } catch { /* non-JSON error page */ }
  return { status: res.status, ok: res.ok, body: parsed };
}

const cleanup = [];       // [table, filter] — iterated in order: unshift children, push parents
const userIds = [];       // disposable users, torn down after the rows that reference them
let A = null, B = null;

/** A confirmed user with `role`, optionally assigned to `buildingId`, signed in. Registered for teardown. */
async function persona(tag, role, buildingId) {
  const email = `zztest-snap-${tag}-${RUN}@buildingops.app`;
  let res = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
    method: 'POST', headers: SVC, body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  });
  const id = (await res.json()).id;
  if (!id) throw new Error(`persona ${tag} create failed`);
  userIds.push(id);
  await fetch(`${URL_BASE}/rest/v1/user_roles?on_conflict=user_id`, {
    method: 'POST', headers: { ...SVC, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ user_id: id, role }),
  });
  if (buildingId) await svcInsert('user_buildings', { user_id: id, building_id: buildingId });
  res = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const jwt = (await res.json()).access_token;
  if (!jwt) throw new Error(`persona ${tag} login failed`);
  return { id, jwt };
}
/** A confirmed site user ('user' role) assigned to `buildingId`, signed in. */
const siteUser = (tag, buildingId) => persona(tag, 'user', buildingId);
/** A confirmed admin (all buildings), signed in. */
const adminUser = (tag) => persona(tag, 'admin', null);

// Calendar helpers: the server works in Africa/Johannesburg dates.
const sastToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const hoursAgoIso = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
/** Read one snapshot row for (building, day) as `jwt`; null when the caller cannot see it or it does not exist. */
async function snapshotRow(jwt, buildingId, day) {
  const rows = await selectAs(jwt, 'building_metrics_daily', `building_id=eq.${buildingId}&day=eq.${day}&select=*`);
  return rows && rows.length === 1 ? rows[0] : null;
}

try {
  console.log(`snapshot-smoke vs ${URL_BASE} (run ${RUN})`);
  const today = sastToday();
  const thisMonth = `${today.slice(0, 7)}-01`;

  // ── setup ──
  A = (await svcInsert('buildings', { name: `ZZTEST-SNAP-A-${RUN}` })).id;
  B = (await svcInsert('buildings', { name: `ZZTEST-SNAP-B-${RUN}` })).id;
  cleanup.push(['buildings', `id=in.(${A},${B})`]);
  cleanup.unshift(['building_metrics_daily', `building_id=in.(${A},${B})`]);
  const admin = await adminUser('admin');
  const site = await siteUser('site', A);
  console.log(`  buildings A=${A} B=${B}; admin + site user ready`);

  // ── step 1: fixtures on A ──
  const report = await svcInsert('reports', { building_id: A, report_type: 'ops_monthly', report_period: thisMonth, status: 'approved', title: `ZZTEST-SNAP ops ${RUN}` });
  cleanup.unshift(['reports', `id=eq.${report.id}`]);
  const tasks = [];
  for (const t of [
    { task_name: `ZZTEST-SNAP done ${RUN}`, status: 'completed', due_date: addDays(today, -1), completed_at: new Date().toISOString() },
    { task_name: `ZZTEST-SNAP pending ${RUN}`, status: 'pending', due_date: today },
    { task_name: `ZZTEST-SNAP overdue ${RUN}`, status: 'overdue', due_date: addDays(today, -3) },
  ]) tasks.push((await svcInsert('task_instances', { building_id: A, ...t })).id);
  cleanup.unshift(['task_instances', `id=in.(${tasks.join(',')})`]);
  const issueOpen = (await svcInsert('issues', { building_id: A, title: `ZZTEST-SNAP high ${RUN}`, description: 'snapshot smoke', priority: 'high', status: 'open', reported_by: admin.id })).id;
  const issueResolved = (await svcInsert('issues', { building_id: A, title: `ZZTEST-SNAP resolved ${RUN}`, description: 'snapshot smoke', priority: 'low', status: 'resolved', reported_by: admin.id })).id;
  await svcPatch('issues', `id=eq.${issueResolved}`, { resolved_at: hoursAgoIso(5 * 24) });   // trg_issue_resolved_at is UPDATE OF status only
  const issueIds = [issueOpen, issueResolved];
  cleanup.unshift(['issues', `id=in.(${issueIds.join(',')})`]);
  cleanup.unshift(['issue_activity', `issue_id=in.(${issueIds.join(',')})`]);
  const docs = [];
  docs.push((await svcInsert('building_documents', { building_id: A, name: `ZZTEST-SNAP cert ${RUN}`, document_type: 'certificate', expiry_date: addDays(today, 10) })).id);
  docs.push((await svcInsert('building_documents', { building_id: A, name: `ZZTEST-SNAP old ${RUN}`, document_type: 'certificate', expiry_date: addDays(today, -5) })).id);
  cleanup.unshift(['building_documents', `id=in.(${docs.join(',')})`]);
  const tenant = (await svcInsert('building_tenants', { building_id: A, name: `ZZTEST-SNAP tenant ${RUN}`, shop_name: `ZZTEST-SNAP shop ${RUN}` })).id;
  cleanup.unshift(['building_tenants', `id=eq.${tenant}`]);
  const tenantDoc = (await svcInsert('tenant_documents', { tenant_id: tenant, document_name: `ZZTEST-SNAP lease ${RUN}`, document_type: 'lease', expiry_date: addDays(today, 45) })).id;
  cleanup.unshift(['tenant_documents', `id=eq.${tenantDoc}`]);
  const asset = (await svcInsert('building_assets', { building_id: A, name: `ZZTEST-SNAP chiller ${RUN}`, category: 'HVAC', next_service_date: addDays(today, -1), warranty_expiry: addDays(today, 80) })).id;
  cleanup.unshift(['building_assets', `id=eq.${asset}`]);
  ok('step 1: fixtures on A (report, 3 tasks, 2 issues, 2 documents, tenant document, asset)');

  // ── step 2: snapshot (today, A) as admin ──
  {
    const r = await rpcJson(admin.jwt, 'snapshot_building_metrics', { p_day: today, p_building: A });
    assert('step 2: snapshot_building_metrics(today, A) as admin returns 1', r.status === 200 && Number(r.body) === 1, `HTTP ${r.status} body ${JSON.stringify(r.body)}`);
    const row = await snapshotRow(admin.jwt, A, today);
    assert('step 2: exactly one (A, today) row readable by admin', !!row, 'row missing or duplicated');
    if (row) {
      assert('step 2: compliance_pct null (no assessment)', row.compliance_pct === null, `got ${row.compliance_pct}`);
      assert('step 2: compliance_period = this month', row.compliance_period === thisMonth, `got ${row.compliance_period}`);
      assert('step 2: task_completion_30d_pct 33.3', Number(row.task_completion_30d_pct) === 33.3, `got ${row.task_completion_30d_pct}`);
      assert('step 2: tasks_overdue 1 / tasks_due_7d 1', row.tasks_overdue === 1 && row.tasks_due_7d === 1, `got ${row.tasks_overdue} / ${row.tasks_due_7d}`);
      assert('step 2: issues_open 1 by priority {"high":1}', row.issues_open === 1 && JSON.stringify(row.issues_open_by_priority) === '{"high":1}', `got ${row.issues_open} ${JSON.stringify(row.issues_open_by_priority)}`);
      assert('step 2: issues_breached 0 / issues_resolved_30d 1', row.issues_breached === 0 && row.issues_resolved_30d === 1, `got ${row.issues_breached} / ${row.issues_resolved_30d}`);
      assert('step 2: docs expiring 30/60/90 = 1/1/1, expired 1, assets_overdue 1',
        row.docs_expiring_30 === 1 && row.docs_expiring_60 === 1 && row.docs_expiring_90 === 1 && row.docs_expired === 1 && row.assets_overdue === 1,
        `got ${row.docs_expiring_30}/${row.docs_expiring_60}/${row.docs_expiring_90} expired ${row.docs_expired} assets ${row.assets_overdue}`);
      assert('step 2: report_state ops_monthly approved, cm_monthly missing',
        row.report_state?.ops_monthly?.status === 'approved' && row.report_state?.cm_monthly?.status === 'missing' && row.report_state?.ops_monthly?.period === thisMonth,
        JSON.stringify(row.report_state));
      assert('step 2: reconstructed false', row.reconstructed === false, `got ${row.reconstructed}`);
      assert('step 2: computed_at within 60 s', Math.abs(Date.now() - Date.parse(row.computed_at)) < 60_000, `computed_at ${row.computed_at}`);
    }

    // ── step 3: idempotent re-run ──
    await new Promise((r) => setTimeout(r, 1100));
    const again = await rpcJson(admin.jwt, 'snapshot_building_metrics', { p_day: today, p_building: A });
    const rows = await selectAs(admin.jwt, 'building_metrics_daily', `building_id=eq.${A}&day=eq.${today}&select=computed_at`);
    assert('step 3: second run still one (A, today) row', again.status === 200 && rows?.length === 1, `HTTP ${again.status}, ${rows?.length} rows`);
    assert('step 3: computed_at strictly newer', !!row && !!rows?.[0] && Date.parse(rows[0].computed_at) > Date.parse(row.computed_at), `${row?.computed_at} → ${rows?.[0]?.computed_at}`);
  }

  // ── step 4: backfill window + reconstruction ──
  {
    const win = await selectAs(admin.jwt, 'building_metrics_daily', `building_id=eq.${A}&day=gte.${addDays(today, -90)}&select=day`);
    assert('step 4: only today exists for A inside the 90-day window (A is newer than the backfill)', win?.length === 1 && win[0].day === today, JSON.stringify(win));
    const r = await rpcJson(admin.jwt, 'snapshot_building_metrics', { p_day: addDays(today, -7), p_building: A });
    assert('step 4: snapshot_building_metrics(today−7, A) returns 1', r.status === 200 && Number(r.body) === 1, `HTTP ${r.status} body ${JSON.stringify(r.body)}`);
    const row7 = await snapshotRow(admin.jwt, A, addDays(today, -7));
    assert('step 4: today−7 row is reconstructed with issues_open 0 (fixture issues were created today)', !!row7 && row7.reconstructed === true && row7.issues_open === 0, JSON.stringify(row7));
  }

  // ── step 5: RLS ──
  {
    const siteA = await selectAs(site.jwt, 'building_metrics_daily', `building_id=eq.${A}&select=day`);
    assert('step 5: site user on A reads A rows', Array.isArray(siteA) && siteA.length >= 1, `got ${JSON.stringify(siteA)}`);
    const rb = await rpcJson(admin.jwt, 'snapshot_building_metrics', { p_day: today, p_building: B });
    assert('step 5: snapshot(today, B) as admin returns 1', rb.status === 200 && Number(rb.body) === 1, `HTTP ${rb.status}`);
    const siteB = await selectAs(site.jwt, 'building_metrics_daily', `building_id=eq.${B}&select=day`);
    assert('step 5: site user cannot read B rows', Array.isArray(siteB) && siteB.length === 0, `got ${JSON.stringify(siteB)}`);
    for (const view of ['building_metrics_daily', 'portfolio_metrics_daily']) {
      const res = await fetch(`${URL_BASE}/rest/v1/${view}?limit=1`, { headers: { apikey: ANON } });
      assert(`step 5: anon GET ${view} is refused`, !res.ok, `HTTP ${res.status}`);
    }
    const pf = await selectAs(admin.jwt, 'portfolio_metrics_daily', `day=eq.${today}&select=*`);
    assert('step 5: admin reads the portfolio row for today with ≥ 2 buildings', pf?.length === 1 && pf[0].buildings >= 2, JSON.stringify(pf));
  }

  // ── step 6: gates ──
  {
    const s = await rpc(site.jwt, 'snapshot_building_metrics', { p_day: today, p_building: A });
    assert('step 6: snapshot as site user → 403', s.status === 403, `HTTP ${s.status}`);
    const a = await rpc(null, 'snapshot_building_metrics', { p_day: today, p_building: A });
    assert('step 6: snapshot as anon → 401/403', a.status === 401 || a.status === 403, `HTTP ${a.status}`);
    const f = await rpc(admin.jwt, 'snapshot_building_metrics', { p_day: addDays(today, 1), p_building: A });
    assert('step 6: p_day tomorrow as admin → 400 (22023)', f.status === 400, `HTTP ${f.status}`);
  }

  // ── step 7: expiring_items as the site user ──
  {
    const r = await rpcJson(site.jwt, 'expiring_items', { p_days: 90 });
    const mine = Array.isArray(r.body) ? r.body.filter((x) => x.building_id === A) : [];
    const byKind = Object.fromEntries(mine.map((x) => [x.kind, x]));
    assert('step 7: expiring_items(90) as site user lists the 5 A fixtures', r.status === 200 && mine.length === 5, `HTTP ${r.status}, ${mine.length} rows: ${JSON.stringify(mine.map((x) => [x.kind, x.days_left]))}`);
    const expected = { building_document: [10, -5], tenant_document: [45], asset_warranty: [80], asset_service: [-1] };
    const daysByKind = {};
    for (const x of mine) (daysByKind[x.kind] ??= []).push(x.days_left);
    assert('step 7: kinds and days_left (10, −5, 45, 80, −1)',
      Object.entries(expected).every(([k, v]) => JSON.stringify((daysByKind[k] ?? []).sort((p, q) => p - q)) === JSON.stringify([...v].sort((p, q) => p - q))),
      JSON.stringify(daysByKind));
    assert('step 7: entity_type document/asset, building_name and detail filled',
      byKind.building_document?.entity_type === 'document' && byKind.asset_service?.entity_type === 'asset'
        && byKind.building_document?.building_name === `ZZTEST-SNAP-A-${RUN}` && byKind.tenant_document?.detail === `ZZTEST-SNAP shop ${RUN}`
        && byKind.tenant_document?.parent_id === tenant,
      JSON.stringify(byKind));
    const a = await rpc(null, 'expiring_items', { p_days: 90 });
    assert('step 7: expiring_items as anon → 401/403', a.status === 401 || a.status === 403, `HTTP ${a.status}`);
  }

  // ── step 8: SLA ──
  {
    const orgCritical = await rpcJson(admin.jwt, 'org_sla_hours', { p_priority: 'critical' });
    const sla = await svcInsert('issues', { building_id: A, title: `ZZTEST-SNAP sla ${RUN}`, description: 'sla smoke', priority: 'critical', status: 'open', reported_by: admin.id });
    cleanup.unshift(['issues', `id=eq.${sla.id}`]);
    cleanup.unshift(['issue_activity', `issue_id=eq.${sla.id}`]);
    cleanup.unshift(['notifications', `entity_id=eq.${sla.id}`]);
    assert('step 8: critical issue gets the org default target on insert', orgCritical.status === 200 && Number(sla.sla_target_hours) === Number(orgCritical.body), `target ${sla.sla_target_hours}, org default ${JSON.stringify(orgCritical.body)}`);
    assert('step 8: first_response_at null after insert', sla.first_response_at === null, `got ${sla.first_response_at}`);
    const comment = await fetch(`${URL_BASE}/rest/v1/issue_activity`, {
      method: 'POST', headers: { ...authed(site.jwt), Prefer: 'return=representation' },
      body: JSON.stringify({ issue_id: sla.id, user_id: site.id, activity_type: 'comment', comment: `ZZTEST-SNAP first response ${RUN}` }),
    });
    assert('step 8: site user can comment on the A issue', comment.status === 201, `HTTP ${comment.status} ${await comment.text()}`);
    const afterComment = (await svcSelect('issues', `id=eq.${sla.id}&select=first_response_at`))[0];
    assert('step 8: first_response_at stamped by a non-reporter comment', !!afterComment?.first_response_at, JSON.stringify(afterComment));
    await svcPatch('issues', `id=eq.${sla.id}`, { sla_target_hours: 1, created_at: hoursAgoIso(2) });
    const before = (await svcSelect('notifications', `entity_id=eq.${sla.id}&kind=eq.issue_sla_breached&select=id`)).length;
    const sweep = await rpcJson(admin.jwt, 'mark_sla_breaches', {});
    assert('step 8: mark_sla_breaches as admin returns ≥ 1', sweep.status === 200 && Number(sweep.body) >= 1, `HTTP ${sweep.status} body ${JSON.stringify(sweep.body)}`);
    const breached = (await svcSelect('issues', `id=eq.${sla.id}&select=sla_breached_at`))[0];
    assert('step 8: sla_breached_at stamped', !!breached?.sla_breached_at, JSON.stringify(breached));
    const inbox = await svcSelect('notifications', `entity_id=eq.${sla.id}&kind=eq.issue_sla_breached&recipient_id=eq.${admin.id}&select=id,title,body,url,entity_type,building_id`);
    assert('step 8: exactly one issue_sla_breached row for the admin persona', before === 0 && inbox.length === 1, `${inbox.length} rows (before: ${before})`);
    if (inbox.length === 1) {
      assert('step 8: inbox row shape (title, body, url, entity_type, building_id)',
        inbox[0].title === `SLA breached: ZZTEST-SNAP sla ${RUN}` && inbox[0].body === 'Priority critical · target 1 h' && inbox[0].url === `/issues?open=${sla.id}`
          && inbox[0].entity_type === 'issue' && inbox[0].building_id === A,
        JSON.stringify(inbox[0]));
    }
    const siteInbox = await svcSelect('notifications', `entity_id=eq.${sla.id}&kind=eq.issue_sla_breached&recipient_id=eq.${site.id}&select=id`);
    assert('step 8: unassigned site user gets no inbox row', siteInbox.length === 0, `${siteInbox.length} rows`);
    const total = (await svcSelect('notifications', `entity_id=eq.${sla.id}&kind=eq.issue_sla_breached&select=id`)).length;
    await rpcJson(admin.jwt, 'mark_sla_breaches', {});
    const totalAfter = (await svcSelect('notifications', `entity_id=eq.${sla.id}&kind=eq.issue_sla_breached&select=id`)).length;
    assert('step 8: second sweep adds no rows for the issue', total === totalAfter, `${total} → ${totalAfter}`);
    const s = await rpc(site.jwt, 'mark_sla_breaches', {});
    assert('step 8: mark_sla_breaches as site user → 403', s.status === 403, `HTTP ${s.status}`);
    const a = await rpc(null, 'mark_sla_breaches', {});
    assert('step 8: mark_sla_breaches as anon → 401/403', a.status === 401 || a.status === 403, `HTTP ${a.status}`);
  }

  // ── step 9: project-wide timing ──
  if (PROJECT_WIDE_ALLOWED) {
    const t0 = Date.now();
    const r = await rpc(admin.jwt, 'snapshot_building_metrics', { p_day: today, p_building: null });
    const ms = Date.now() - t0;
    const body = await r.text();
    assert('step 9: snapshot_building_metrics(today, null) as admin → 200 in < 30 s', r.status === 200 && ms < 30_000, `HTTP ${r.status} in ${ms} ms ${body.slice(0, 80)}`);
    console.log(`  TIMING  snapshot_building_metrics(today, null): ${ms} ms for ${body.trim()} building row(s)`);
  } else {
    skip('step 9: project-wide snapshot timing', 'prod ref in SUPABASE_URL (set SMOKE_ALLOW_PROD=1 to run it)');
  }
} catch (e) {
  fail('smoke run', e.message);
} finally {
  // ════ Teardown (service role): children first (cleanup is ordered), then personas, then stray sweep ════
  for (const [table, filter] of cleanup) {
    try { await svcDelete(table, filter); } catch (e) { fail(`teardown ${table}`, e.message); }
  }
  for (const uid of userIds) {
    await fetch(`${URL_BASE}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: SVC });
  }
  const list = await (await fetch(`${URL_BASE}/auth/v1/admin/users?page=1&per_page=200`, { headers: SVC })).json();
  for (const u of list?.users ?? []) {
    if (u.email?.startsWith('zztest-snap-')) {
      await fetch(`${URL_BASE}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: SVC });
    }
  }
  const leftBuildings = await (await fetch(`${URL_BASE}/rest/v1/buildings?name=like.ZZTEST-SNAP-*&select=id`, { headers: SVC })).json();
  if ((leftBuildings?.length ?? 0) > 0) fail('teardown', `${leftBuildings.length} ZZTEST-SNAP building(s) survived`);
}

console.log(`\n${pass} passed, ${failures} failed`);
if (failures) console.log(fails.map((f) => `  - ${f}`).join('\n'));
process.exit(failures === 0 ? 0 : 1);
