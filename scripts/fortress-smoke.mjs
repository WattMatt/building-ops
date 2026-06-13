/**
 * Fortress report data-layer smoke test (staging).
 *
 * Proves the Phase-3 gate against real RLS with real logins:
 *   - a manager can create a draft ops_monthly, author a compliance assessment,
 *     read the live compliance_scores view, and run it draft → submitted → approved
 *   - the status transition is written to audit_logs
 *   - a site-restricted user sees a report for their assigned building but NOT one
 *     for a building they aren't assigned to (cross-building isolation)
 *
 * Talks to the PostgREST/Auth API directly with node's built-in fetch — the same
 * endpoints @supabase/supabase-js calls — so it has no node_modules dependency and
 * can run in CI. Usage (env carries staging creds; nothing secret is committed):
 *   STAGING_URL=… STAGING_ANON=… STAGING_SROLE=… node scripts/fortress-smoke.mjs
 *
 * Test users (staging only): zztest-manager@test.local / zztest-restricted@test.local
 * Buildings: A = 1111… (restricted is assigned), B = 2222… (restricted is NOT).
 */
const URL = process.env.STAGING_URL;
const ANON = process.env.STAGING_ANON;
const SROLE = process.env.STAGING_SROLE;
const PW = 'ZZtest!Pass123';
const BUILDING_A = '11111111-1111-4111-8111-111111111111';
const BUILDING_B = '22222222-2222-4222-8222-222222222222';

if (!URL || !ANON || !SROLE) {
  console.error('Missing STAGING_URL / STAGING_ANON / STAGING_SROLE env.');
  process.exit(2);
}

let failures = 0;
function check(name, cond, detail) {
  const ok = !!cond;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}

async function login(email) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PW }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`login ${email}: ${JSON.stringify(j)}`);
  return j.access_token;
}

/** Minimal PostgREST client bound to a JWT (or service role). */
function rest(token, isServiceRole = false) {
  const base = `${URL}/rest/v1`;
  const headers = {
    apikey: isServiceRole ? SROLE : ANON,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  return {
    async select(path) {
      const r = await fetch(`${base}/${path}`, { headers });
      return r.ok ? r.json() : [];
    },
    async insert(table, rows) {
      const r = await fetch(`${base}/${table}`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify(rows),
      });
      return { ok: r.ok, status: r.status, error: r.ok ? null : await r.text() };
    },
    async patch(table, query, patch) {
      const r = await fetch(`${base}/${table}?${query}`, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify(patch),
      });
      return { ok: r.ok, status: r.status, error: r.ok ? null : await r.text() };
    },
    async del(table, query) {
      const r = await fetch(`${base}/${table}?${query}`, { method: 'DELETE', headers });
      return { ok: r.ok, status: r.status };
    },
  };
}

const uuid = () => crypto.randomUUID();

async function main() {
  const admin = rest(SROLE, true);
  await admin.del('reports', 'title=like.ZZSMOKE*');

  const mgrToken = await login('zztest-manager@test.local');
  const resToken = await login('zztest-restricted@test.local');
  const mgrId = JSON.parse(Buffer.from(mgrToken.split('.')[1], 'base64').toString()).sub;
  const mgr = rest(mgrToken);
  const res = rest(resToken);

  // --- manager creates a draft ops_monthly on building A ---
  const reportId = uuid();
  {
    const r = await mgr.insert('reports', {
      id: reportId, building_id: BUILDING_A, report_type: 'ops_monthly',
      report_period: '2099-01-01', title: 'ZZSMOKE OPS A', status: 'draft',
      author_id: mgrId, author_name: 'ZZTEST Manager',
    });
    check('manager creates draft report', r.ok, r.error);
  }

  // second report on building B (restricted must NOT see this)
  const reportBId = uuid();
  await mgr.insert('reports', {
    id: reportBId, building_id: BUILDING_B, report_type: 'ops_monthly',
    report_period: '2099-02-01', title: 'ZZSMOKE OPS B', status: 'draft',
    author_id: mgrId, author_name: 'ZZTEST Manager',
  });

  // --- compliance assessment + responses ---
  const tpl = (await mgr.select('compliance_templates?select=id&name=eq.OHS Act Report&active=eq.true&order=version.desc&limit=1'))[0];
  check('active OHS template found', !!tpl, tpl?.id);
  const items = await mgr.select(`compliance_template_items?select=id,is_scored&template_id=eq.${tpl.id}&order=sort_order.asc&limit=6`);

  const assessmentId = uuid();
  {
    const r = await mgr.insert('compliance_assessments', {
      id: assessmentId, report_id: reportId, building_id: BUILDING_A, template_id: tpl.id,
    });
    check('manager creates compliance assessment', r.ok, r.error);
  }
  const answers = items.slice(0, 5).map((it, i) => ({
    id: uuid(), assessment_id: assessmentId, template_item_id: it.id, response: i === 0 ? 'no' : 'yes',
  }));
  {
    const r = await mgr.insert('compliance_responses', answers);
    check('manager writes compliance responses', r.ok, r.error);
  }

  // --- read the live score view ---
  {
    const rows = await mgr.select(`compliance_scores?select=compliance_pct&assessment_id=eq.${assessmentId}`);
    const pct = rows[0]?.compliance_pct;
    check('compliance_scores view returns a %', pct !== undefined && pct !== null, `${pct}%`);
  }

  // --- lifecycle: draft → submitted → approved ---
  {
    const e1 = await mgr.patch('reports', `id=eq.${reportId}`, { status: 'submitted' });
    const e2 = await mgr.patch('reports', `id=eq.${reportId}`, { status: 'approved', reviewed_by: mgrId });
    const r = (await mgr.select(`reports?select=status&id=eq.${reportId}`))[0];
    check('manager runs draft→submitted→approved', e1.ok && e2.ok && r?.status === 'approved', r?.status);
  }
  {
    const audit = await admin.select(`audit_logs?select=action&entity_id=eq.${reportId}&order=created_at.asc`);
    const actions = audit.map((a) => a.action);
    check('status transitions logged to audit_logs',
      actions.includes('report_status_submitted') && actions.includes('report_status_approved'),
      actions.join(','));
  }

  // --- RLS: restricted user sees building A's report, NOT building B's ---
  {
    const visA = await res.select(`reports?select=id&id=eq.${reportId}`);
    check('restricted user SEES report for assigned building A', visA.length === 1);
    const visB = await res.select(`reports?select=id&id=eq.${reportBId}`);
    check('restricted user is BLOCKED from building B report', visB.length === 0, visB.length ? 'LEAK' : 'isolated');
  }

  await admin.del('reports', 'title=like.ZZSMOKE*');

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('SMOKE ERROR:', e.message); process.exit(1); });
