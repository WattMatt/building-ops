#!/usr/bin/env node
/**
 * Distribution + share smoke — report-distribution and report-share end to end against the live backend
 * (both functions deployed; REPORT_DISTRIBUTION_SECRET and SHARE_SALT set; 2026-09-14_01 + _02 applied).
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... REPORT_DISTRIBUTION_SECRET=... \
 *   node scripts/distribution-smoke.mjs
 *
 * Proves: schedule -> run-now dry run lists the target building with skipped_not_approved (draft report) and
 * writes nothing; approved report without artifact -> skipped_no_artifact + report_export_needed inbox row for
 * the author; approved report with an artifact -> a dry run answers would_send and still writes nothing (no
 * share, no distribution row), then the real run writes a report_distributions 'sent' row and a
 * report_shares row (expires ~30 days, no passcode), emails counted (0 when RESEND_API_KEY is absent);
 * a second real run the same day is 'already_ran'; reminders: a schedule whose reminder date is today raises one
 * report_due_soon per (building, type) and not twice; share GET 200 with needsPasscode=false; POST returns a
 * signed URL that fetches the PDF bytes (HTTP 200, application/pdf); create-with-passcode via JWT ->
 * GET needsPasscode=true, wrong passcode 404 x10 -> 429, right passcode after the lock window is not waited for
 * (asserts 429 body shape only), revoked share 404, malformed/unknown/expired tokens 404 with identical bodies;
 * cron secret missing -> 401; site user JWT run-now -> 403; anon cannot read the three tables.
 *
 * Fixtures are scoped to one ZZTEST-DIST building and torn down (LIFO) afterwards. The cron-secret calls run
 * every active schedule on the project exactly as the 05:00 UTC cron would (idempotent per day: a schedule that
 * already ran today answers already_ran), so on staging they change nothing the cron would not have done.
 * WARNING: the reminder step is a real fan-out — it raises a genuine report_due_soon for every building of
 * every matching schedule on the target project, which means an inbox row AND an email for every real
 * admin/manager there; the inbox rows are cleaned up afterwards, the emails cannot be recalled.
 * Refuses production unless SMOKE_ALLOW_PROD=1 — same guard as calendar-smoke.
 */

const URL_BASE = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
const CRON_SECRET = process.env.REPORT_DISTRIBUTION_SECRET;
if (!URL_BASE || !SERVICE || !ANON || !CRON_SECRET) {
  console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY and REPORT_DISTRIBUTION_SECRET');
  process.exit(2);
}

// Refuse to run against production: the fixtures are real auth users, buildings, reports and inbox rows.
const PROD_REF = 'qdzgkttiosahdfqresvz';
if (URL_BASE.includes(PROD_REF) && process.env.SMOKE_ALLOW_PROD !== '1') {
  console.error(
    `Refusing to run against production (SUPABASE_URL contains ${PROD_REF}): ` +
    'this smoke creates and deletes auth users, buildings, reports, artifacts, schedules, shares and inbox rows. ' +
    'Set SMOKE_ALLOW_PROD=1 to override.'
  );
  process.exit(2);
}

const RUN = crypto.randomUUID().slice(0, 8);
const PASSWORD = `Dist-Smoke-${RUN}!`;
const SVC = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const authed = (jwt) => ({ apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' });
const BUCKET = 'generated-reports';
const REPORT_TYPE = 'ops_monthly';
const REMIND_TYPE = 'cm_monthly';

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
async function svcPatch(table, filter, patch) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}?${filter}`, {
    method: 'PATCH', headers: { ...SVC, Prefer: 'return=representation' }, body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`fixture patch ${table}?${filter}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

const cleanup = [];       // [table, filter] — iterated in order: unshift children, push parents
const userIds = [];       // disposable users, torn down after the rows that reference them
const storageCleanup = []; // object paths in the private bucket

/** A confirmed user with `role`, optionally assigned to `buildingId`, signed in. Registered for teardown. */
async function persona(tag, role, buildingId) {
  const email = `zztest-dist-${tag}-${RUN}@buildingops.app`;
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
  return { id, jwt, email };
}

// ── Calendar helpers: the server works in Africa/Johannesburg dates (same rules as _shared/distribution.ts) ──
const sastToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const pad = (n) => String(n).padStart(2, '0');
const previousMonthStart = (iso) => { const [y, m] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10); };
const nextMonthStart = (iso) => { const [y, m] = iso.split('-').map(Number); return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10); };
/** The function's planFor: send on this month's send_day, remind `remind` days before this or next month's. */
function planFor(today, timing) {
  const thisSend = `${today.slice(0, 7)}-${pad(timing.send_day)}`;
  if (today === thisSend) return { action: 'send', period: previousMonthStart(today) };
  if (today === addDays(thisSend, -timing.remind_days_before)) return { action: 'remind', period: previousMonthStart(thisSend) };
  const nextSend = `${nextMonthStart(today).slice(0, 7)}-${pad(timing.send_day)}`;
  if (today === addDays(nextSend, -timing.remind_days_before)) return { action: 'remind', period: previousMonthStart(nextSend) };
  return { action: 'none' };
}
/** A send_day (1..28) whose reminder, `remind` days before, falls on `today` — or null when no such day exists this month. */
function reminderSendDay(today, remind) {
  for (let sd = 1; sd <= 28; sd++) {
    const plan = planFor(today, { send_day: sd, remind_days_before: remind });
    if (plan.action === 'remind') return { send_day: sd, period: plan.period };
  }
  return null;
}

/** What the app's `mintToken()` produces: base64url of 32 random bytes (43 chars, no padding). */
const mintToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
};

/** A tiny but real PDF (one empty page) — enough for the bucket's application/pdf gate and a byte check. */
const TINY_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\nxref\n0 4\n0000000000 65535 f \n' +
  '0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n160\n%%EOF\n',
);

// ── function callers ──
async function distribute(headers, body) {
  const res = await fetch(`${URL_BASE}/functions/v1/report-distribution`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}
const runNow = (jwt, body) => distribute(authed(jwt), body);
const cron = (secret = CRON_SECRET) => distribute({ 'x-distribution-secret': secret }, {});
/** GET the share exactly as the public page would: no apikey, no Authorization. */
async function shareGet(token) {
  const res = await fetch(`${URL_BASE}/functions/v1/report-share?t=${encodeURIComponent(token)}`);
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  return { status: res.status, text, body: parsed, retryAfter: res.headers.get('retry-after') };
}
async function sharePost(body, headers = {}) {
  const res = await fetch(`${URL_BASE}/functions/v1/report-share`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  return { status: res.status, text, body: parsed, retryAfter: res.headers.get('retry-after') };
}
const shareOpen = (t, passcode) => sharePost(passcode === undefined ? { t } : { t, passcode });
const shareCreate = (jwt, body) => sharePost({ action: 'create', ...body }, jwt ? authed(jwt) : {});
/** One schedule's entry in a run response, by id. */
const entryFor = (r, scheduleId) => (Array.isArray(r.body?.schedules) ? r.body.schedules.find((s) => s.scheduleId === scheduleId) : undefined);
const forA = (entry, A) => entry?.buildings?.find((b) => b.buildingId === A);
const countBy = (rows, key) => rows.reduce((acc, r) => { acc[r[key]] = (acc[r[key]] ?? 0) + 1; return acc; }, {});

let A = null;

try {
  console.log(`distribution-smoke vs ${URL_BASE} (run ${RUN})`);
  const today = sastToday();
  const period = previousMonthStart(today);           // run-now's default period
  const todayDay = Number(today.slice(8, 10));

  // ── setup ──
  const org = (await svcSelect('organizations', 'select=id&limit=1'))[0];
  if (!org?.id) throw new Error('no organizations row: report_artifacts needs an org_id');
  A = (await svcInsert('buildings', { name: `ZZTEST-DIST-A-${RUN}` })).id;
  cleanup.push(['buildings', `id=eq.${A}`]);
  const admin = await persona('admin', 'admin', null);
  const site = await persona('site', 'user', A);
  const report = await svcInsert('reports', { building_id: A, report_type: REPORT_TYPE, report_period: period, status: 'draft', title: `ZZTEST-DIST ops ${RUN}`, author_id: admin.id, author_name: 'ZZTEST Admin' });
  cleanup.unshift(['reports', `id=eq.${report.id}`]);
  // A second report (never approved, no artifact) for the "artifact of another report" probes.
  const other = await svcInsert('reports', { building_id: A, report_type: REMIND_TYPE, report_period: '2020-01-01', status: 'draft', title: `ZZTEST-DIST other ${RUN}` });
  cleanup.unshift(['reports', `id=eq.${other.id}`]);
  cleanup.unshift(['notifications', `building_id=eq.${A}&kind=in.(report_due_soon,report_export_needed)`]);
  const external = `zztest-${RUN}@example.invalid`;
  const schedule = await svcInsert('report_schedules', {
    report_type: REPORT_TYPE, building_ids: [A], send_day: Math.min(todayDay, 28), remind_days_before: 3,
    recipients: [{ email: external }, { user_id: admin.id, name: 'ZZTEST Admin' }], created_by: admin.id,
  });
  cleanup.unshift(['report_schedules', `id=eq.${schedule.id}`]);
  cleanup.unshift(['report_distributions', `schedule_id=eq.${schedule.id}`]);
  cleanup.unshift(['report_shares', `report_id=in.(${report.id},${other.id})`]);
  ok(`fixtures: building A, admin + site personas, draft ${REPORT_TYPE} report for ${period}, schedule with one external + one internal recipient`);

  // ── 1. auth gates ──
  {
    const noSecret = await distribute({}, {});
    assert('cron path without a secret → 401', noSecret.status === 401, `HTTP ${noSecret.status} ${JSON.stringify(noSecret.body).slice(0, 120)}`);
    const wrongSecret = await cron('not-the-secret');
    assert('cron path with a wrong secret → 401', wrongSecret.status === 401, `HTTP ${wrongSecret.status}`);
    const siteRun = await runNow(site.jwt, { scheduleId: schedule.id, dryRun: true });
    assert('run-now as a site user → 403', siteRun.status === 403, `HTTP ${siteRun.status} ${JSON.stringify(siteRun.body).slice(0, 120)}`);
    const noId = await runNow(admin.jwt, { dryRun: true });
    assert('run-now without scheduleId → 400', noId.status === 400, `HTTP ${noId.status}`);
    const badPeriod = await runNow(admin.jwt, { scheduleId: schedule.id, dryRun: true, period: '2026-09-15' });
    assert('run-now with a non-first-of-month period → 400', badPeriod.status === 400, `HTTP ${badPeriod.status}`);
    const unknown = await runNow(admin.jwt, { scheduleId: crypto.randomUUID(), dryRun: true });
    assert('run-now for an unknown schedule → 404', unknown.status === 404, `HTTP ${unknown.status}`);
  }

  // ── 2. dry run on a draft report: skipped_not_approved, nothing written ──
  {
    const r = await runNow(admin.jwt, { scheduleId: schedule.id, dryRun: true });
    const entry = entryFor(r, schedule.id);
    const b = forA(entry, A);
    assert('dry run: HTTP 200 ok/dryRun/today', r.status === 200 && r.body?.ok === true && r.body?.dryRun === true && r.body?.today === today, `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    assert('dry run: action send for the previous month', entry?.action === 'send' && entry?.period === period, JSON.stringify(entry).slice(0, 200));
    assert('dry run: building A is skipped_not_approved with 2 recipients', b?.status === 'skipped_not_approved' && b?.recipients === 2 && b?.reportId === report.id && b?.buildingName === `ZZTEST-DIST-A-${RUN}`, JSON.stringify(b));
    assert('dry run: counts.skipped_not_approved = 1', r.body?.counts?.skipped_not_approved === 1 && r.body?.counts?.sent === 0, JSON.stringify(r.body?.counts));
    const dist = await svcSelect('report_distributions', `schedule_id=eq.${schedule.id}&select=id`);
    const sched = (await svcSelect('report_schedules', `id=eq.${schedule.id}&select=last_run_on,last_result`))[0];
    assert('dry run: writes no report_distributions row', dist.length === 0, `${dist.length} rows`);
    assert('dry run: leaves last_run_on / last_result untouched', sched?.last_run_on === null && sched?.last_result === null, JSON.stringify(sched));
  }

  // ── 3. approved without an artifact: skipped_no_artifact + report_export_needed to the author ──
  {
    await svcPatch('reports', `id=eq.${report.id}`, { status: 'approved' });
    const r = await runNow(admin.jwt, { scheduleId: schedule.id, dryRun: false });
    const b = forA(entryFor(r, schedule.id), A);
    assert('no artifact: real run answers skipped_no_artifact', r.status === 200 && r.body?.dryRun === false && b?.status === 'skipped_no_artifact' && r.body?.counts?.skipped_no_artifact === 1, `HTTP ${r.status} ${JSON.stringify(b)} ${JSON.stringify(r.body?.counts)}`);
    const dist = await svcSelect('report_distributions', `schedule_id=eq.${schedule.id}&select=status,report_id,building_id,report_period,artifact_id,share_id,sent_to`);
    assert('no artifact: one skipped_no_artifact distribution row', dist.length === 1 && dist[0].status === 'skipped_no_artifact' && dist[0].report_id === report.id && dist[0].building_id === A && dist[0].report_period === period && dist[0].artifact_id === null && dist[0].share_id === null, JSON.stringify(dist));
    const inbox = await svcSelect('notifications', `kind=eq.report_export_needed&building_id=eq.${A}&select=recipient_id,entity_type,entity_id,title,url`);
    assert('no artifact: exactly one report_export_needed inbox row, to the author', inbox.length === 1 && inbox[0].recipient_id === admin.id, `${inbox.length} rows ${JSON.stringify(inbox).slice(0, 200)}`);
    assert('no artifact: inbox row shape (entity report, url /reports/fortress/<id>, title Export needed…)', inbox[0]?.entity_type === 'report' && inbox[0]?.entity_id === report.id && inbox[0]?.url === `/reports/fortress/${report.id}` && /^Export needed:/.test(inbox[0]?.title ?? '') && inbox[0]?.title.includes(`ZZTEST-DIST-A-${RUN}`), JSON.stringify(inbox[0]));
    const sched = (await svcSelect('report_schedules', `id=eq.${schedule.id}&select=last_run_on,last_result`))[0];
    assert('no artifact: real run stamps last_run_on = today and last_result', sched?.last_run_on === today && sched?.last_result?.action === 'send' && sched?.last_result?.period === period, JSON.stringify(sched));
  }

  // ── 4. approved with an issued artifact: sent + share ──
  const filePath = `${org.id}/fortress_${REPORT_TYPE}/${Date.now()}-smoke-${RUN}.pdf`;
  let share = null;
  {
    const up = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${filePath}`, { method: 'POST', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/pdf' }, body: TINY_PDF });
    if (!up.ok) throw new Error(`storage upload: HTTP ${up.status} ${await up.text()}`);
    storageCleanup.push(filePath);
    const artifact = await svcInsert('report_artifacts', {
      org_id: org.id, kind: `fortress_${REPORT_TYPE}`, source_id: report.id, building_id: A, version: 1,
      file_path: filePath, file_name: `ZZTEST-DIST-${RUN}.pdf`, size_bytes: TINY_PDF.length, generated_by: admin.id, status: 'issued', report_status: 'approved',
    });
    cleanup.unshift(['report_artifacts', `id=eq.${artifact.id}`]);

    // ── 4a. dry run ON the path that can actually send ──
    // Step 2's dry run only ever reached skipped_not_approved, so nothing had tested the branch the real
    // send takes. With the artifact in place this reaches `would_send`, and must still write nothing:
    // no share, and no new report_distributions row beyond step 3's skipped_no_artifact one.
    {
      const distBefore = await svcSelect('report_distributions', `report_id=eq.${report.id}&select=id,status`);
      const d = await runNow(admin.jwt, { scheduleId: schedule.id, dryRun: true });
      const b = forA(entryFor(d, schedule.id), A);
      assert('dry run on the send path: HTTP 200, dryRun true', d.status === 200 && d.body?.ok === true && d.body?.dryRun === true, `HTTP ${d.status} ${JSON.stringify(d.body).slice(0, 200)}`);
      assert('dry run on the send path: building A is would_send', b?.status === 'would_send' && b?.reportId === report.id && b?.recipients === 2, JSON.stringify(b));
      // The count key is `sent` at 8f2113e and may be renamed to `would_send`; the per-building status above
      // is the stable assertion, so accept either key here rather than pinning a name that is in flux.
      const wouldSend = d.body?.counts?.would_send ?? d.body?.counts?.sent;
      assert('dry run on the send path: one would-be send counted', wouldSend === 1 && (d.body?.counts?.skipped_no_artifact ?? 0) === 0 && (d.body?.counts?.failed ?? 0) === 0, JSON.stringify(d.body?.counts));
      const sharesAfter = await svcSelect('report_shares', `report_id=eq.${report.id}&select=id`);
      const distAfter = await svcSelect('report_distributions', `report_id=eq.${report.id}&select=id,status`);
      assert('dry run on the send path: no share was minted', sharesAfter.length === 0, `${sharesAfter.length} share row(s) after a dry run`);
      assert('dry run on the send path: no distribution row was written', distAfter.length === distBefore.length && !distAfter.some((x) => x.status === 'sent'), `${distBefore.length} → ${distAfter.length} ${JSON.stringify(distAfter)}`);
    }

    const r = await runNow(admin.jwt, { scheduleId: schedule.id, dryRun: false });
    const b = forA(entryFor(r, schedule.id), A);
    assert('with artifact: real run answers sent with a shareId', r.status === 200 && b?.status === 'sent' && typeof b?.shareId === 'string' && r.body?.counts?.sent === 1, `HTTP ${r.status} ${JSON.stringify(b)} ${JSON.stringify(r.body?.counts)}`);
    const dist = await svcSelect('report_distributions', `schedule_id=eq.${schedule.id}&status=eq.sent&select=report_id,artifact_id,share_id,sent_to,error`);
    assert('with artifact: one sent distribution row pinned to the artifact and share', dist.length === 1 && dist[0].report_id === report.id && dist[0].artifact_id === artifact.id && dist[0].share_id === b?.shareId && dist[0].error === null, JSON.stringify(dist));
    const sentTo = Array.isArray(dist[0]?.sent_to) ? dist[0].sent_to : [];
    assert('with artifact: sent_to lists both recipients with the internal one resolved to an address and an ok flag each', sentTo.length === 2 && sentTo.every((x) => typeof x.ok === 'boolean') && sentTo.some((x) => x.email === external) && sentTo.some((x) => x.user_id === admin.id && x.email === admin.email), JSON.stringify(sentTo));
    console.log(`  NOTE  emails delivered: ${sentTo.filter((x) => x.ok).length} of ${sentTo.length} (0 when RESEND_API_KEY is absent on the project)`);
    const shares = await svcSelect('report_shares', `report_id=eq.${report.id}&select=id,artifact_id,token,created_by,created_at,expires_at,passcode_hash,view_count,last_viewed_at,revoked_at,failed_attempts,locked_until`);
    share = shares[0] ?? null;
    const days = share ? (Date.parse(share.expires_at) - Date.parse(share.created_at)) / 86_400_000 : NaN;
    assert('with artifact: one share row for the report, on the artifact, owned by the schedule creator', shares.length === 1 && share?.id === b?.shareId && share?.artifact_id === artifact.id && share?.created_by === admin.id, JSON.stringify(shares).slice(0, 200));
    assert('with artifact: share expires in ~30 days, no passcode, zero counters', Math.abs(days - 30) < 0.05 && share?.passcode_hash === null && share?.view_count === 0 && share?.failed_attempts === 0 && share?.locked_until === null && share?.revoked_at === null, `days=${days} ${JSON.stringify(share)}`);
    assert('with artifact: token is 43-char base64url', /^[A-Za-z0-9_-]{43}$/.test(share?.token ?? ''), String(share?.token).slice(0, 8));

    // Same day again: the per-report sent row stops a second send (run-now), the cron path answers already_ran.
    const again = await runNow(admin.jwt, { scheduleId: schedule.id, dryRun: false });
    const bAgain = forA(entryFor(again, schedule.id), A);
    assert('second run-now the same day: already_sent, no new share', bAgain?.status === 'already_sent' && again.body?.counts?.already_sent === 1 && again.body?.counts?.sent === 0 && (await svcSelect('report_shares', `report_id=eq.${report.id}&select=id`)).length === 1, JSON.stringify(bAgain));
    const viaCron = await cron();
    const cronEntry = entryFor(viaCron, schedule.id);
    assert('cron run the same day: the schedule answers already_ran', viaCron.status === 200 && cronEntry?.action === 'already_ran' && cronEntry?.buildings?.length === 0, `HTTP ${viaCron.status} ${JSON.stringify(cronEntry)}`);
  }

  // ── 5. reminders: a schedule whose reminder date is today ──
  {
    const target = reminderSendDay(today, 3);
    if (!target) {
      skip('reminder schedule', `no send_day in 1..28 has its 3-day reminder on ${today}`);
    } else {
      const remindSched = await svcInsert('report_schedules', {
        report_type: REMIND_TYPE, building_ids: [A], send_day: target.send_day, remind_days_before: 3,
        recipients: [{ email: external }], created_by: admin.id,
      });
      cleanup.unshift(['report_schedules', `id=eq.${remindSched.id}`]);
      cleanup.unshift(['report_distributions', `schedule_id=eq.${remindSched.id}`]);
      const r = await cron();
      const entry = entryFor(r, remindSched.id);
      const b = forA(entry, A);
      assert(`reminder: cron plans remind for period ${target.period} (send_day ${target.send_day})`, r.status === 200 && entry?.action === 'remind' && entry?.period === target.period, `HTTP ${r.status} ${JSON.stringify(entry).slice(0, 200)}`);
      assert('reminder: building A reminded (no report exists yet → reportId null)', b?.status === 'reminded' && b?.reportId === null, JSON.stringify(b));
      const rows = await svcSelect('notifications', `kind=eq.report_due_soon&building_id=eq.${A}&select=recipient_id,entity_type,entity_id,title,url,body`);
      const perRecipient = countBy(rows, 'recipient_id');
      assert('reminder: report_due_soon inbox rows exist, one per recipient, admin persona included', rows.length >= 1 && Object.values(perRecipient).every((n) => n === 1) && perRecipient[admin.id] === 1, `${rows.length} rows ${JSON.stringify(perRecipient)}`);
      assert('reminder: inbox row shape (entity report/null id, url /buildings/<A>?tab=reports, title Report due soon…)', rows.every((x) => x.entity_type === 'report' && x.entity_id === null && x.url === `/buildings/${A}?tab=reports` && /^Report due soon:/.test(x.title)), JSON.stringify(rows[0]));
      assert('reminder: no distribution row is written on a remind day', (await svcSelect('report_distributions', `schedule_id=eq.${remindSched.id}&select=id`)).length === 0, 'rows found');
      const count1 = rows.length;
      const second = await cron();
      assert('reminder: second cron call the same day answers already_ran', entryFor(second, remindSched.id)?.action === 'already_ran', JSON.stringify(entryFor(second, remindSched.id)));
      // Force the schedule through the reminder branch again: the per-(building, type, day) dedupe must hold on its own.
      await svcPatch('report_schedules', `id=eq.${remindSched.id}`, { last_run_on: null });
      const third = await cron();
      const b3 = forA(entryFor(third, remindSched.id), A);
      const count2 = (await svcSelect('notifications', `kind=eq.report_due_soon&building_id=eq.${A}&select=id`)).length;
      assert('reminder: re-run after resetting last_run_on is already_reminded and adds no rows', b3?.status === 'already_reminded' && count2 === count1, `${JSON.stringify(b3)} rows ${count1} → ${count2}`);
    }
  }

  // ── 6. public share: GET + open ──
  if (share) {
    const g = await shareGet(share.token);
    assert('share GET: 200 JSON', g.status === 200 && g.body !== null, `HTTP ${g.status} ${g.text.slice(0, 120)}`);
    assert('share GET: metadata (building, title, type, period, approved, needsPasscode false)', g.body?.building === `ZZTEST-DIST-A-${RUN}` && g.body?.title === `ZZTEST-DIST ops ${RUN}` && g.body?.type === REPORT_TYPE && g.body?.period === period && g.body?.reportStatus === 'approved' && g.body?.needsPasscode === false && typeof g.body?.issuedAt === 'string' && g.body?.expiresAt === share.expires_at, JSON.stringify(g.body));
    const o = await shareOpen(share.token);
    assert('share POST: 200 with a signed url, fileName and expiresInSeconds 600', o.status === 200 && typeof o.body?.url === 'string' && o.body?.fileName === `ZZTEST-DIST-${RUN}.pdf` && o.body?.expiresInSeconds === 600, `HTTP ${o.status} ${o.text.slice(0, 160)}`);
    if (o.body?.url) {
      const pdf = await fetch(o.body.url);
      const bytes = Buffer.from(await pdf.arrayBuffer());
      assert('share POST: the signed url serves the PDF bytes (200, application/pdf, %PDF header)', pdf.status === 200 && (pdf.headers.get('content-type') ?? '').startsWith('application/pdf') && bytes.subarray(0, 4).toString() === '%PDF' && bytes.length === TINY_PDF.length, `HTTP ${pdf.status} ${pdf.headers.get('content-type')} ${bytes.length} bytes`);
    }
    const after = (await svcSelect('report_shares', `id=eq.${share.id}&select=view_count,last_viewed_at`))[0];
    assert('share POST: view_count 1, last_viewed_at stamped', after?.view_count === 1 && typeof after?.last_viewed_at === 'string', JSON.stringify(after));
  } else {
    skip('public share GET/open', 'no share row from the real run');
  }

  // ── 7. create with a passcode (authenticated), wrong passcodes lock, right passcode opens ──
  const artifactRow = (await svcSelect('report_artifacts', `source_id=eq.${report.id}&select=id`))[0];
  if (artifactRow) {
    const passcode = `zz-${RUN}`;
    const token = mintToken();
    const c = await shareCreate(admin.jwt, { reportId: report.id, artifactId: artifactRow.id, token, expiresInDays: 7, passcode });
    assert('create: 200 {id, token, expiresAt} for an admin with a passcode', c.status === 200 && typeof c.body?.id === 'string' && c.body?.token === token && typeof c.body?.expiresAt === 'string', `HTTP ${c.status} ${c.text.slice(0, 160)}`);
    const row = c.body?.id ? (await svcSelect('report_shares', `id=eq.${c.body.id}&select=passcode_hash,created_by,expires_at,created_at`))[0] : null;
    const cDays = row ? (Date.parse(row.expires_at) - Date.parse(row.created_at)) / 86_400_000 : NaN;
    assert('create: row carries a 64-hex passcode hash, created_by = caller, ~7 days', /^[0-9a-f]{64}$/.test(row?.passcode_hash ?? '') && row?.created_by === admin.id && Math.abs(cDays - 7) < 0.05, `${JSON.stringify({ ...row, passcode_hash: row?.passcode_hash ? `${row.passcode_hash.length} chars` : row?.passcode_hash })} days=${cDays}`);
    const g = await shareGet(token);
    assert('create: GET needsPasscode true', g.status === 200 && g.body?.needsPasscode === true, `HTTP ${g.status} ${g.text.slice(0, 120)}`);
    const noPass = await shareOpen(token);
    assert('open without a passcode → 404', noPass.status === 404, `HTTP ${noPass.status}`);
    let wrongStatuses = [];
    for (let i = 0; i < 9; i++) wrongStatuses.push((await shareOpen(token, 'wrong-1')).status);
    const at9 = (await svcSelect('report_shares', `id=eq.${c.body?.id}&select=failed_attempts,locked_until`))[0];
    assert('open with a wrong passcode ×9 → 404 each, failed_attempts 9, not locked', wrongStatuses.every((s) => s === 404) && at9?.failed_attempts === 9 && at9?.locked_until === null, `${wrongStatuses.join(',')} ${JSON.stringify(at9)}`);
    const tenth = await shareOpen(token, 'wrong-1');
    const at10 = (await svcSelect('report_shares', `id=eq.${c.body?.id}&select=failed_attempts,locked_until`))[0];
    const lockMinutes = at10?.locked_until ? (Date.parse(at10.locked_until) - Date.now()) / 60_000 : NaN;
    assert('10th wrong passcode → 404, locked_until ≈ now + 15 min, counter reset', tenth.status === 404 && at10?.failed_attempts === 0 && lockMinutes > 13 && lockMinutes <= 15.1, `HTTP ${tenth.status} ${JSON.stringify(at10)} minutes=${lockMinutes}`);
    const locked = await shareOpen(token, passcode);
    assert('locked share → 429 {error: locked, retryAfterSeconds} with Retry-After', locked.status === 429 && locked.body?.error === 'locked' && Number.isInteger(locked.body?.retryAfterSeconds) && locked.body.retryAfterSeconds > 0 && locked.body.retryAfterSeconds <= 900 && locked.retryAfter === String(locked.body.retryAfterSeconds), `HTTP ${locked.status} ${locked.text.slice(0, 120)} retry-after=${locked.retryAfter}`);
    const lockedGet = await shareGet(token);
    assert('locked share: GET still answers metadata (lock applies to open only)', lockedGet.status === 200 && lockedGet.body?.needsPasscode === true, `HTTP ${lockedGet.status}`);
    // The 15-minute window is not waited for: clear it with the service role and prove the right passcode opens.
    await svcPatch('report_shares', `id=eq.${c.body?.id}`, { locked_until: null });
    const right = await shareOpen(token, passcode);
    assert('right passcode (lock cleared) → 200 signed url', right.status === 200 && typeof right.body?.url === 'string', `HTTP ${right.status} ${right.text.slice(0, 120)}`);
    const wrongAfter = await shareOpen(token, 'wrong-2');
    const afterRight = (await svcSelect('report_shares', `id=eq.${c.body?.id}&select=failed_attempts,view_count`))[0];
    assert('success reset the counter: one wrong attempt after → failed_attempts 1, view_count 1', wrongAfter.status === 404 && afterRight?.failed_attempts === 1 && afterRight?.view_count === 1, JSON.stringify(afterRight));

    // create gates
    const noJwt = await shareCreate(null, { reportId: report.id, artifactId: artifactRow.id, token: mintToken(), expiresInDays: 7 });
    assert('create without a JWT → 401', noJwt.status === 401, `HTTP ${noJwt.status}`);
    const siteCreate = await shareCreate(site.jwt, { reportId: report.id, artifactId: artifactRow.id, token: mintToken(), expiresInDays: 7 });
    assert('create as a site user → 403', siteCreate.status === 403, `HTTP ${siteCreate.status}`);
    const badExpiry = await shareCreate(admin.jwt, { reportId: report.id, artifactId: artifactRow.id, token: mintToken(), expiresInDays: 15 });
    assert('create with expiresInDays 15 → 400', badExpiry.status === 400, `HTTP ${badExpiry.status}`);
    const badToken = await shareCreate(admin.jwt, { reportId: report.id, artifactId: artifactRow.id, token: 'short', expiresInDays: 7 });
    assert('create with a malformed token → 400', badToken.status === 400, `HTTP ${badToken.status}`);
    const wrongReport = await shareCreate(admin.jwt, { reportId: other.id, artifactId: artifactRow.id, token: mintToken(), expiresInDays: 7 });
    assert('create with an artifact of another report → 400', wrongReport.status === 400, `HTTP ${wrongReport.status} ${wrongReport.text.slice(0, 80)}`);
    const taken = await shareCreate(admin.jwt, { reportId: report.id, artifactId: artifactRow.id, token, expiresInDays: 7 });
    assert('create with a token already in use → 400', taken.status === 400, `HTTP ${taken.status} ${taken.text.slice(0, 80)}`);
    const shortPass = await shareCreate(admin.jwt, { reportId: report.id, artifactId: artifactRow.id, token: mintToken(), expiresInDays: 7, passcode: 'abc' });
    assert('create with a 3-char passcode → 400', shortPass.status === 400, `HTTP ${shortPass.status}`);
    const plain = await shareCreate(admin.jwt, { reportId: report.id, artifactId: artifactRow.id, token: mintToken(), expiresInDays: 90 });
    assert('create without a passcode (90 days) → 200', plain.status === 200 && typeof plain.body?.id === 'string', `HTTP ${plain.status} ${plain.text.slice(0, 120)}`);
  } else {
    skip('create with passcode', 'no artifact row');
  }

  // ── 8. revoked / malformed / unknown / expired: the same 404 ──
  {
    const notFounds = [];
    if (share) {
      await svcPatch('report_shares', `id=eq.${share.id}`, { revoked_at: new Date().toISOString() });
      const g = await shareGet(share.token);
      const o = await shareOpen(share.token);
      assert('revoked share: GET 404 and POST 404', g.status === 404 && o.status === 404, `GET ${g.status} POST ${o.status}`);
      notFounds.push(['revoked', g]);
    }
    const garbage = await shareGet('garbage');
    assert('malformed token: 404', garbage.status === 404, `HTTP ${garbage.status}`);
    notFounds.push(['malformed', garbage]);
    const unknown = await shareGet(mintToken());
    assert('well-formed unknown token: 404', unknown.status === 404, `HTTP ${unknown.status}`);
    notFounds.push(['unknown', unknown]);
    const missing = await shareGet('');
    assert('missing token: 404', missing.status === 404, `HTTP ${missing.status}`);
    notFounds.push(['missing', missing]);
    if (artifactRow) {
      // The service role may backdate a share (CHECK: expires_at > created_at) — a genuinely expired link.
      const expiredTok = mintToken();
      const created = new Date(Date.now() - 2 * 86_400_000).toISOString();
      const expired = await svcInsert('report_shares', { report_id: report.id, artifact_id: artifactRow.id, token: expiredTok, created_by: admin.id, created_at: created, expires_at: new Date(Date.now() - 86_400_000).toISOString() });
      const g = await shareGet(expiredTok);
      const o = await shareOpen(expiredTok);
      assert('expired share: GET 404 and POST 404', expired?.id && g.status === 404 && o.status === 404, `GET ${g.status} POST ${o.status}`);
      notFounds.push(['expired', g]);
      const postUnknown = await shareOpen(mintToken());
      assert('POST with an unknown token: 404 with the same body as GET', postUnknown.status === 404 && postUnknown.text === g.text, `HTTP ${postUnknown.status} ${JSON.stringify(postUnknown.text)} vs ${JSON.stringify(g.text)}`);
    }
    const bodies = new Set(notFounds.map(([, r]) => r.text));
    assert(`404 bodies are byte-identical across ${notFounds.map(([k]) => k).join('/')}`, bodies.size === 1, [...bodies].map((b) => JSON.stringify(b.slice(0, 60))).join(' | '));
  }

  // ── 9. anon cannot read the three tables ──
  for (const table of ['report_shares', 'report_schedules', 'report_distributions']) {
    const res = await fetch(`${URL_BASE}/rest/v1/${table}?select=id&limit=1`, { headers: { apikey: ANON } });
    assert(`anon GET ${table} is refused`, !res.ok, `HTTP ${res.status}`);
  }
} catch (e) {
  fail('smoke run', e.message);
} finally {
  // ════ Teardown (service role): children first (cleanup is ordered), storage, personas, stray sweep ════
  for (const [table, filter] of cleanup) {
    try { await svcDelete(table, filter); } catch (e) { fail(`teardown ${table}`, e.message); }
  }
  for (const path of storageCleanup) {
    const r = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${path}`, { method: 'DELETE', headers: SVC });
    if (!r.ok) fail('teardown storage', `HTTP ${r.status} for ${path}`);
  }
  for (const uid of userIds) {
    await svcDelete('user_buildings', `user_id=eq.${uid}`).catch(() => {});
    await svcDelete('user_roles', `user_id=eq.${uid}`).catch(() => {});
    await fetch(`${URL_BASE}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: SVC });
  }
  const list = await (await fetch(`${URL_BASE}/auth/v1/admin/users?page=1&per_page=200`, { headers: SVC })).json();
  for (const u of list?.users ?? []) {
    if (u.email?.startsWith('zztest-dist-')) await fetch(`${URL_BASE}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: SVC });
  }
  const leftBuildings = await (await fetch(`${URL_BASE}/rest/v1/buildings?name=like.ZZTEST-DIST-*&select=id`, { headers: SVC })).json();
  if ((leftBuildings?.length ?? 0) > 0) fail('teardown', `${leftBuildings.length} ZZTEST-DIST building(s) survived`);
  else console.log('  teardown: clean');
}

console.log(`\n${pass} passed, ${failures} failed`);
if (fails.length) for (const f of fails) console.log(`  - ${f}`);
console.log(failures === 0 ? 'DISTRIBUTION HOLDS' : 'DISTRIBUTION BROKEN');
process.exit(failures === 0 ? 0 : 1);
