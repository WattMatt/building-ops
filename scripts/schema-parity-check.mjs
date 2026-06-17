// Schema-parity check (reliable column-probe method): for every table+column
// the app's generated types expect, ask the clone's PostgREST for those columns.
// PostgREST returns 42703 naming a missing column, or 404 (PGRST205) for a
// missing table. We peel off missing columns and retry to enumerate them all.
import fs from 'node:fs';

const SUPA = 'https://xuqxnpipetruujcuuflq.supabase.co';
const KEY = 'sb_publishable_4dJ6lA7qhqOxwVo76Nq_Jg_PJU7pUdM';
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

function parseTypes(file) {
  const src = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  const tables = {};
  const re = /(\w+): \{\s*\n\s*Row: \{([\s\S]*?)\n\s*\}\s*\n\s*(?:Insert|Relationships):/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const cols = [...m[2].matchAll(/^\s*(\w+)\??:/gm)].map((x) => x[1]);
    if (cols.length) tables[m[1]] = [...new Set([...(tables[m[1]] || []), ...cols])];
  }
  return tables;
}

const expected = { ...parseTypes('../src/integrations/supabase/types.ts') };
for (const [t, c] of Object.entries(parseTypes('../src/integrations/supabase/fortress-types.ts'))) {
  expected[t] = [...new Set([...(expected[t] || []), ...c])];
}

const missingTables = [];
const missingCols = {};

for (const [table, allCols] of Object.entries(expected)) {
  let cols = [...allCols];
  let tableMissing = false;
  for (let i = 0; i < 25 && cols.length; i++) {
    const r = await fetch(`${SUPA}/rest/v1/${table}?select=${cols.join(',')}&limit=0`, { headers: H });
    if (r.status === 200) break;
    let j = null;
    try { j = await r.json(); } catch {}
    if (j?.code === 'PGRST205' || /Could not find the table/i.test(j?.message || '')) { tableMissing = true; break; }
    const mc = (j?.message || '').match(/column (?:\w+\.)?(\w+) does not exist/i);
    if (mc) {
      (missingCols[table] ||= []).push(mc[1]);
      cols = cols.filter((c) => c !== mc[1]);
    } else { break; }
  }
  if (tableMissing) missingTables.push(table);
}

console.log('Tables checked:', Object.keys(expected).length);
console.log('\n=== MISSING TABLES (code expects, clone lacks) ===');
console.log(missingTables.length ? missingTables.join(', ') : '(none)');
console.log('\n=== MISSING COLUMNS (code expects, clone lacks) ===');
const e = Object.entries(missingCols);
console.log(e.length ? e.map(([t, c]) => `  ${t}: ${c.join(', ')}`).join('\n') : '(none)');
