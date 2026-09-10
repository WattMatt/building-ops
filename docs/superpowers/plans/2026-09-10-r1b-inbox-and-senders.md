# R1b "Inbox & senders" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every event that makes something "yours" lands in an in-app inbox and, when the person wants it, in their email — through one server-side sender that honours the notification preferences already on the profile.

**Architecture:** A shared Deno module `supabase/functions/_shared/notify.ts` (inbox insert + preference-aware Resend email) with its pure preference rules in `_shared/notifyRules.ts` (unit-tested from vitest). A new `notify` edge function (JWT-verified, caller must be a member of the building, recipients filtered to members) that the client seam `src/lib/notify.ts` calls. The five existing user-facing senders are retrofitted onto the shared module so they also write inbox rows. Client: `useNotifications` (query + realtime on `notifications`), a header bell with a popover, an `/inbox` page, and per-kind badges on nav items. Preferences live on Profile only. A `daily-digest` edge function runs on pg_cron.

**Tech Stack:** Supabase Edge Functions (Deno, `esm.sh/@supabase/supabase-js@2.49.1`, Resend), Postgres/pg_cron/pg_net, React 18 + TS, TanStack Query v5, shadcn/ui, vitest.

**Spec:** `docs/superpowers/specs/2026-09-10-r1-mine-design.md` §6. Schema from R1a (`notifications` table, `building_members` RPC) is assumed applied on staging before Task 9's smoke runs; code does not depend on it locally.

**Ground rules for every agent:** never `git stash` / `checkout` / `switch` / `reset` / `worktree`; compare with `git show <sha>:<path>`; edit only the files your task names; stage only your files; retry `git commit` after 5 s on `index.lock`; end commit messages with a blank line and `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; gate = `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E '<your files>'` prints nothing and `npm run test` is green (the global count must not exceed `.github/typecheck-baseline.txt`, currently 64, at commit time); guardrail copy never through `<Hint>`; Deno is not installed locally, so edge-function code is checked by reading and by the vitest-tested pure module — keep Deno files free of logic that can live in `notifyRules.ts`.

**Notification kinds and the preference that governs email** (from the design):

| kind | governing profile flag | recipients |
|---|---|---|
| task_assigned | task_reminders | assignee |
| issue_assigned, issue_comment, issue_mention | issue_updates | assignee / participants / mentioned |
| report_submitted | issue_updates | all admins+managers (server-resolved) |
| report_returned, report_approved | issue_updates | report author |
| form_submitted | issue_updates | all admins+managers |
| form_reviewed | issue_updates | submitter |
| signoff_requested, signoff_complete | task_reminders | signer / submitter+requesters |
| signoff_overdue | overdue_alerts | all admins+managers |
| document_expiring, asset_service_due | overdue_alerts | (R1b: inbox rows only, no per-item email; the existing digest email stays) |

`email_notifications === false` silences all email. A null flag means opted in (matches `notify-expiring-alerts`).

---

### Task 1: Pure preference rules + the shared sender module

**Files:**
- Create: `supabase/functions/_shared/notifyRules.ts`
- Create: `src/lib/notifyRules.test.ts` (imports the file above by relative path)
- Create: `supabase/functions/_shared/notify.ts`

- [ ] **Step 1: Failing test**

```ts
// src/lib/notifyRules.test.ts
import { describe, it, expect } from 'vitest';
import { shouldEmail, governingFlag, NOTIFICATION_KINDS, buildInboxRows } from '../../supabase/functions/_shared/notifyRules';

describe('governingFlag', () => {
  it('maps every kind to a profile flag', () => {
    for (const k of NOTIFICATION_KINDS) expect(typeof governingFlag(k)).toBe('string');
    expect(governingFlag('task_assigned')).toBe('task_reminders');
    expect(governingFlag('issue_mention')).toBe('issue_updates');
    expect(governingFlag('signoff_overdue')).toBe('overdue_alerts');
  });
});

describe('shouldEmail', () => {
  const base = { email_notifications: null, issue_updates: null, task_reminders: null, overdue_alerts: null, daily_digest: null };
  it('null flags mean opted in', () => {
    expect(shouldEmail('issue_comment', base)).toBe(true);
  });
  it('email_notifications=false silences everything', () => {
    expect(shouldEmail('issue_comment', { ...base, email_notifications: false })).toBe(false);
  });
  it('the governing flag alone can silence a kind', () => {
    expect(shouldEmail('task_assigned', { ...base, task_reminders: false })).toBe(false);
    expect(shouldEmail('issue_assigned', { ...base, task_reminders: false })).toBe(true);
  });
  it('digest-only kinds never email per item', () => {
    expect(shouldEmail('document_expiring', base)).toBe(false);
    expect(shouldEmail('asset_service_due', base)).toBe(false);
  });
});

describe('buildInboxRows', () => {
  it('drops the actor and de-duplicates recipients', () => {
    const rows = buildInboxRows({ recipients: ['a', 'b', 'a', 'me'], actorId: 'me', actorName: 'Me', kind: 'issue_comment', entityType: 'issue', entityId: 'i1', buildingId: 'b1', title: 't', body: null, url: '/issues?open=i1' });
    expect(rows.map((r) => r.recipient_id)).toEqual(['a', 'b']);
    expect(rows[0]).toMatchObject({ actor_id: 'me', actor_name: 'Me', kind: 'issue_comment', entity_type: 'issue', entity_id: 'i1', building_id: 'b1', title: 't', url: '/issues?open=i1' });
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/lib/notifyRules.test.ts` → FAIL.

- [ ] **Step 3: The pure module** (no Deno/Node APIs, so both runtimes import it)

```ts
// supabase/functions/_shared/notifyRules.ts
/**
 * Pure rules for in-app notifications: which profile flag governs each kind, whether an
 * email should go out, and the inbox rows to insert. No I/O, so it is unit-tested from the
 * web app's vitest suite (src/lib/notifyRules.test.ts) and bundled into the edge functions.
 */
export const NOTIFICATION_KINDS = [
  'task_assigned', 'issue_assigned', 'issue_comment', 'issue_mention',
  'report_submitted', 'report_returned', 'report_approved',
  'form_submitted', 'form_reviewed', 'signoff_requested', 'signoff_complete', 'signoff_overdue',
  'document_expiring', 'asset_service_due',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const ENTITY_TYPES = ['task', 'issue', 'report', 'form_submission', 'signoff_request', 'document', 'asset'] as const;
export type NotificationEntityType = (typeof ENTITY_TYPES)[number];

export type PrefFlag = 'issue_updates' | 'task_reminders' | 'overdue_alerts';
export interface NotificationPrefs {
  email_notifications: boolean | null;
  issue_updates: boolean | null;
  task_reminders: boolean | null;
  overdue_alerts: boolean | null;
  daily_digest: boolean | null;
}

/** Kinds that reach the inbox but never send a per-item email (the digest covers them). */
const DIGEST_ONLY: ReadonlySet<NotificationKind> = new Set(['document_expiring', 'asset_service_due']);

export function governingFlag(kind: NotificationKind): PrefFlag {
  switch (kind) {
    case 'task_assigned':
    case 'signoff_requested':
    case 'signoff_complete':
      return 'task_reminders';
    case 'signoff_overdue':
    case 'document_expiring':
    case 'asset_service_due':
      return 'overdue_alerts';
    default:
      return 'issue_updates';
  }
}

/** Null flags mean opted in, matching notify-expiring-alerts. */
export function shouldEmail(kind: NotificationKind, prefs: NotificationPrefs): boolean {
  if (DIGEST_ONLY.has(kind)) return false;
  if (prefs.email_notifications === false) return false;
  return prefs[governingFlag(kind)] !== false;
}

export interface InboxInput {
  recipients: string[];
  actorId: string | null;
  actorName: string | null;
  kind: NotificationKind;
  entityType: NotificationEntityType;
  entityId: string | null;
  buildingId: string | null;
  title: string;
  body: string | null;
  url: string;
}

export interface InboxRow {
  recipient_id: string;
  actor_id: string | null;
  actor_name: string | null;
  kind: NotificationKind;
  entity_type: NotificationEntityType;
  entity_id: string | null;
  building_id: string | null;
  title: string;
  body: string | null;
  url: string;
}

/** One row per distinct recipient, never the actor. */
export function buildInboxRows(input: InboxInput): InboxRow[] {
  const seen = new Set<string>();
  const rows: InboxRow[] = [];
  for (const id of input.recipients) {
    if (!id || id === input.actorId || seen.has(id)) continue;
    seen.add(id);
    rows.push({
      recipient_id: id, actor_id: input.actorId, actor_name: input.actorName,
      kind: input.kind, entity_type: input.entityType, entity_id: input.entityId,
      building_id: input.buildingId, title: input.title.slice(0, 200), body: input.body ? input.body.slice(0, 500) : null, url: input.url,
    });
  }
  return rows;
}
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: The shared sender** (Deno)

```ts
// supabase/functions/_shared/notify.ts
// One sender for every notification: inserts inbox rows (service role) and emails each
// recipient whose preferences allow it. Every user-facing edge function routes through
// this so the inbox and the email can never disagree about what was sent.
import { escapeText, loadBranding, renderEmail, type Branding } from "./email.ts";
import { buildInboxRows, shouldEmail, type InboxInput, type NotificationPrefs } from "./notifyRules.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
export const APP_URL = (Deno.env.get("APP_URL") ?? "https://buildingops.app").replace(/\/+$/, "");

/** Organization name is operator-supplied; keep it safe for the From display name. */
export function senderName(name: string): string {
  return name.replace(/[^A-Za-z0-9 &.-]/g, "").trim().slice(0, 64) || "Building Ops";
}

export async function sendEmail(from: string, to: string[], subject: string, html: string): Promise<void> {
  if (!to.length) return;
  if (!RESEND_API_KEY) { console.warn("RESEND_API_KEY not set; email skipped"); return; }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend API error: ${await res.text()}`);
}

// deno-lint-ignore no-explicit-any
type Admin = { from: (t: string) => any };

export interface CreateNotificationsInput extends InboxInput {
  /** Email subject; defaults to the title. */
  subject?: string;
  /** Extra HTML under the body line (already escaped by the caller). */
  detailHtml?: string;
  ctaText?: string;
}

export interface CreateNotificationsResult { inserted: number; emailed: number; skipped: number }

/**
 * Insert inbox rows for every recipient (minus the actor), then email those whose profile
 * flags allow it. Email failures are logged, never thrown: the inbox row is the record.
 */
export async function createNotifications(admin: Admin, input: CreateNotificationsInput, branding?: Branding): Promise<CreateNotificationsResult> {
  const rows = buildInboxRows(input);
  if (!rows.length) return { inserted: 0, emailed: 0, skipped: 0 };

  const { error: insErr } = await admin.from("notifications").insert(rows);
  if (insErr) throw new Error(`Could not write inbox rows: ${insErr.message}`);

  const ids = rows.map((r) => r.recipient_id);
  const { data: profiles, error: profErr } = await admin
    .from("profiles")
    .select("id, email, full_name, email_notifications, issue_updates, task_reminders, overdue_alerts, daily_digest, deactivated")
    .in("id", ids);
  if (profErr) { console.error("notify: profiles read failed", profErr); return { inserted: rows.length, emailed: 0, skipped: rows.length }; }

  const b = branding ?? await loadBranding(admin);
  const from = `${senderName(b.appName)} <notifications@buildingops.app>`;
  let emailed = 0, skipped = 0;
  for (const p of profiles ?? []) {
    const prefs: NotificationPrefs = p;
    if (!p.email || p.deactivated || !shouldEmail(input.kind, prefs)) { skipped++; continue; }
    const html = renderEmail({
      branding: b,
      preheader: input.body ?? undefined,
      heading: input.title,
      greeting: p.full_name ? `Hi ${escapeText(p.full_name)},` : undefined,
      bodyHtml: `${input.body ? `<p style="margin:0 0 12px;">${escapeText(input.body)}</p>` : ""}${input.detailHtml ?? ""}`,
      ctaText: input.ctaText ?? "Open in Building Ops",
      ctaUrl: `${APP_URL}${input.url}`,
      footnote: "You can change which emails you receive under My Profile → Notifications.",
    });
    try { await sendEmail(from, [p.email], input.subject ?? input.title, html); emailed++; }
    catch (e) { console.error("notify: email failed", p.id, e); skipped++; }
  }
  return { inserted: rows.length, emailed, skipped };
}

/** All active admins and managers — the server-side recipient list for org-wide kinds. */
export async function adminAndManagerIds(admin: Admin): Promise<string[]> {
  const { data } = await admin.from("user_roles").select("user_id").in("role", ["admin", "manager"]);
  return Array.from(new Set((data ?? []).map((r: { user_id: string }) => r.user_id)));
}

/** Display name for the actor, denormalised onto the inbox row. */
export async function actorDisplayName(admin: Admin, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data } = await admin.from("profiles").select("full_name, email").eq("id", userId).maybeSingle();
  return (data?.full_name as string | null)?.trim() || (data?.email as string | null) || null;
}
```

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/notifyRules.ts supabase/functions/_shared/notify.ts src/lib/notifyRules.test.ts
git commit -m "Add one preference-aware sender for inbox rows and email"
```

---

### Task 2: The `notify` edge function

**Files:**
- Create: `supabase/functions/notify/index.ts`
- Modify: `supabase/config.toml` (add `[functions.notify]` with `verify_jwt = true`, next to `notify-signoff-request`)

- [ ] **Step 1: Implement**

```ts
// supabase/functions/notify/index.ts
// Client-invoked notifications (task/issue/report events). The caller must be a member of
// the building; recipients are filtered to members of that building (building_members RPC,
// evaluated as the caller). Org-wide kinds resolve their recipients here, never from the body.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { actorDisplayName, adminAndManagerIds, createNotifications } from "../_shared/notify.ts";
import { ENTITY_TYPES, NOTIFICATION_KINDS, type NotificationEntityType, type NotificationKind } from "../_shared/notifyRules.ts";

const UUID_RE = /^[0-9a-f-]{36}$/i;
const ORG_WIDE: ReadonlySet<NotificationKind> = new Set(["report_submitted", "form_submitted", "signoff_overdue"]);
const MAX_RECIPIENTS = 50;

interface Body {
  kind?: string; entityType?: string; entityId?: string; buildingId?: string;
  recipients?: unknown; title?: string; body?: string; url?: string;
}

serve(async (req: Request): Promise<Response> => {
  const cors = corsHeaders(req);
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No authorization header" }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user: caller }, error: callerErr } = await userClient.auth.getUser();
    if (callerErr || !caller) return json({ error: "Invalid or expired token" }, 401);

    const b: Body = await req.json().catch(() => ({}));
    const kind = NOTIFICATION_KINDS.find((k) => k === b.kind);
    const entityType = ENTITY_TYPES.find((t) => t === b.entityType);
    const buildingId = typeof b.buildingId === "string" && UUID_RE.test(b.buildingId) ? b.buildingId : null;
    const entityId = typeof b.entityId === "string" && UUID_RE.test(b.entityId) ? b.entityId : null;
    const title = typeof b.title === "string" ? b.title.trim().slice(0, 200) : "";
    const body = typeof b.body === "string" ? b.body.trim().slice(0, 500) : null;
    const path = typeof b.url === "string" && b.url.startsWith("/") && !b.url.startsWith("//") ? b.url.slice(0, 300) : null;
    if (!kind || !entityType || !buildingId || !title || !path) return json({ error: "Invalid notification" }, 400);

    // Membership check AS THE CALLER: building_members returns rows only for members.
    const { data: members, error: memErr } = await userClient.rpc("building_members", { b: buildingId });
    if (memErr) { console.error("building_members failed", memErr); return json({ error: "Forbidden" }, 403); }
    const memberIds = new Set((members ?? []).map((m: { id: string }) => m.id));
    if (!memberIds.has(caller.id)) return json({ error: "Forbidden" }, 403);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    let recipients: string[];
    if (ORG_WIDE.has(kind)) {
      recipients = await adminAndManagerIds(admin);
    } else {
      const raw = Array.isArray(b.recipients) ? b.recipients.filter((r): r is string => typeof r === "string" && UUID_RE.test(r)) : [];
      recipients = raw.filter((id) => memberIds.has(id)).slice(0, MAX_RECIPIENTS);
    }

    const result = await createNotifications(admin, {
      recipients, actorId: caller.id, actorName: await actorDisplayName(admin, caller.id),
      kind, entityType: entityType as NotificationEntityType, entityId, buildingId, title, body, url: path,
    });
    return json({ success: true, ...result });
  } catch (e) {
    console.error("notify failed", e);
    return json({ error: "An unexpected error occurred" }, 500);
  }
});
```

- [ ] **Step 2: `supabase/config.toml`** — add after the `notify-signoff-complete` block:

```toml
[functions.notify]
verify_jwt = true
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/notify/index.ts supabase/config.toml
git commit -m "Add the notify edge function: member-checked, preference-aware inbox + email"
```

---

### Task 3: Wire the client seam and the report lifecycle

**Files:**
- Modify: `src/lib/notify.ts` (body only; keep the exported types)
- Modify: `src/lib/notify.test.ts`
- Modify: `src/hooks/useFortressReports.ts` (`useReportLifecycle.onSuccess`)

- [ ] **Step 1: Test** — replace the seam test:

```ts
// src/lib/notify.test.ts
import { describe, it, expect, vi } from 'vitest';
const invoke = vi.hoisted(() => vi.fn(async () => ({ data: { success: true }, error: null })));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke } } }));
import { notify } from './notify';

describe('notify', () => {
  it('invokes the notify function with the payload', async () => {
    await notify({ kind: 'task_assigned', entityType: 'task', entityId: 't1', buildingId: 'b1', recipients: ['u1'], title: 'x', url: '/x' });
    expect(invoke).toHaveBeenCalledWith('notify', { body: expect.objectContaining({ kind: 'task_assigned', recipients: ['u1'], url: '/x' }) });
  });
  it('skips the call with no recipients unless the kind is org-wide', async () => {
    invoke.mockClear();
    await notify({ kind: 'issue_comment', entityType: 'issue', entityId: 'i', buildingId: 'b', recipients: [], title: 'x', url: '/x' });
    expect(invoke).not.toHaveBeenCalled();
    await notify({ kind: 'report_submitted', entityType: 'report', entityId: 'r', buildingId: 'b', recipients: [], title: 'x', url: '/x' });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it('never throws when the function fails', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(notify({ kind: 'task_assigned', entityType: 'task', entityId: 't', buildingId: 'b', recipients: ['u'], title: 'x', url: '/x' })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Implement** — in `src/lib/notify.ts` keep the type exports, replace `notify`:

```ts
import { supabase } from '@/integrations/supabase/client';

const ORG_WIDE: ReadonlySet<NotificationKind> = new Set(['report_submitted', 'form_submitted', 'signoff_overdue']);

/** Fire-and-forget: a failure to notify must never fail the action that caused it. */
export async function notify(input: NotifyInput): Promise<void> {
  if (!input.recipients.length && !ORG_WIDE.has(input.kind)) return;
  try {
    const { error } = await supabase.functions.invoke('notify', { body: input });
    if (error && import.meta.env.DEV) console.warn('[notify] failed:', error.message ?? error);
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[notify] failed:', e);
  }
}
```

Update the header docblock (no longer a stub).

- [ ] **Step 3: Report transitions.** In `useFortressReports.ts` `useReportLifecycle`, extend `onSuccess(r)`:

```ts
import { notify } from '@/lib/notify';
// …
onSuccess: (r) => {
  qc.invalidateQueries({ queryKey: REPORTS_KEY });
  const label = r.title ?? 'Building report';
  const url = `/reports/fortress/${r.id}`;
  if (r.status === 'submitted') {
    void notify({ kind: 'report_submitted', entityType: 'report', entityId: r.id, buildingId: r.building_id, recipients: [], title: `Report submitted for review: ${label}`, url });
  } else if ((r.status === 'rejected' || r.status === 'approved') && r.author_id && r.author_id !== user?.id) {
    void notify({
      kind: r.status === 'rejected' ? 'report_returned' : 'report_approved', entityType: 'report', entityId: r.id, buildingId: r.building_id,
      recipients: [r.author_id], title: r.status === 'rejected' ? `Report returned: ${label}` : `Report approved: ${label}`,
      body: r.status === 'rejected' ? (r.review_notes ?? undefined) : undefined, url,
    });
  }
  // existing toast unchanged
},
```

- [ ] **Step 4: Tests, gate, commit**

```bash
git add src/lib/notify.ts src/lib/notify.test.ts src/hooks/useFortressReports.ts
git commit -m "Send task, issue and report events to the inbox through the notify function"
```

---

### Task 4: `useNotifications`, the header bell, the Inbox page, nav badges

**Files:**
- Create: `src/hooks/useNotifications.ts`, `src/hooks/useNotifications.test.ts`
- Create: `src/components/notifications/NotificationBell.tsx`
- Create: `src/pages/Inbox.tsx`
- Modify: `src/components/layout/DashboardLayout.tsx` (header slot; `NavItem.badgeKinds`; badge render)
- Modify: `src/App.tsx` (route `/inbox`)

- [ ] **Step 1: Hook test** (mock supabase `from('notifications')` chain and `channel`; assert query shape and `markRead` write)

```ts
// src/hooks/useNotifications.test.ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], updates: [] as Record<string, unknown>[] }));
vi.mock('@/integrations/supabase/client', () => {
  const chain: any = {
    select: () => chain, eq: () => chain, is: () => chain, order: () => chain, in: () => chain,
    limit: () => Promise.resolve({ data: state.rows, error: null }),
    update: (patch: Record<string, unknown>) => { state.updates.push(patch); return { eq: () => ({ is: () => Promise.resolve({ error: null }) }) }; },
  };
  const channel = { on: () => channel, subscribe: () => channel };
  return { supabase: { from: () => chain, channel: () => channel, removeChannel: () => {} } };
});
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));

import { useNotifications } from './useNotifications';
const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, children);

describe('useNotifications', () => {
  it('loads rows and counts unread by kind', async () => {
    state.rows = [
      { id: '1', kind: 'issue_comment', read_at: null, title: 'a', url: '/issues', created_at: '2026-09-10T00:00:00Z' },
      { id: '2', kind: 'signoff_requested', read_at: null, title: 'b', url: '/my-signoffs', created_at: '2026-09-10T00:00:00Z' },
      { id: '3', kind: 'issue_assigned', read_at: '2026-09-10T01:00:00Z', title: 'c', url: '/issues', created_at: '2026-09-10T00:00:00Z' },
    ];
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(3));
    expect(result.current.unread).toBe(2);
    expect(result.current.unreadByKind(['issue_comment', 'issue_assigned'])).toBe(1);
  });
  it('markRead writes read_at', async () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.items.length).toBeGreaterThan(0));
    await result.current.markRead('1');
    expect(state.updates.at(-1)).toHaveProperty('read_at');
  });
});
```

- [ ] **Step 2: Hook**

```ts
// src/hooks/useNotifications.ts
/**
 * The signed-in user's inbox: newest 50 rows, unread counts (total and per kind), mark-read,
 * and a realtime subscription so a new row appears without a reload. RLS restricts the table
 * to the recipient, so no client-side filtering is needed beyond the user id.
 */
import { useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { NotificationKind } from '@/lib/notify';

export interface NotificationRow {
  id: string; kind: NotificationKind; entity_type: string; entity_id: string | null; building_id: string | null;
  actor_name: string | null; title: string; body: string | null; url: string; read_at: string | null; created_at: string;
}

const KEY = ['notifications'];
const PAGE = 50;

export function useNotifications() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: [...KEY, user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<NotificationRow[]> => {
      // notifications is not yet in the generated types; regenerate after the migration ships.
      const { data, error } = await (supabase.from('notifications' as never) as any)
        .select('id, kind, entity_type, entity_id, building_id, actor_name, title, body, url, read_at, created_at')
        .eq('recipient_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(PAGE);
      if (error) throw new Error(error.message);
      return (data ?? []) as NotificationRow[];
    },
  });

  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`notifications-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${user.id}` }, () => {
        void qc.invalidateQueries({ queryKey: KEY });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, qc]);

  const items = query.data ?? [];
  const unread = useMemo(() => items.filter((n) => !n.read_at).length, [items]);
  const unreadByKind = useCallback((kinds: NotificationKind[]) => items.filter((n) => !n.read_at && kinds.includes(n.kind)).length, [items]);

  const markRead = useCallback(async (id: string) => {
    qc.setQueryData<NotificationRow[]>([...KEY, user?.id], (old) => old?.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
    const { error } = await (supabase.from('notifications' as never) as any).update({ read_at: new Date().toISOString() }).eq('id', id).is('read_at', null);
    if (error) void qc.invalidateQueries({ queryKey: KEY });
  }, [qc, user?.id]);

  const markAllRead = useCallback(async () => {
    if (!user?.id) return;
    qc.setQueryData<NotificationRow[]>([...KEY, user.id], (old) => old?.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })));
    const { error } = await (supabase.from('notifications' as never) as any).update({ read_at: new Date().toISOString() }).eq('recipient_id', user.id).is('read_at', null);
    if (error) void qc.invalidateQueries({ queryKey: KEY });
  }, [qc, user?.id]);

  return { items, unread, unreadByKind, markRead, markAllRead, isLoading: query.isLoading, isError: query.isError, refetch: query.refetch };
}
```

- [ ] **Step 3: Bell**

```tsx
// src/components/notifications/NotificationBell.tsx
/** Header bell: unread count, the 10 newest rows, mark all read, link to the full inbox. */
import { Bell } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useNotifications } from '@/hooks/useNotifications';

export function NotificationBell() {
  const { items, unread, markRead, markAllRead } = useNotifications();
  const navigate = useNavigate();
  const recent = items.slice(0, 10);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={unread ? `${unread} unread notifications` : 'Notifications'} className="relative">
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          {unread > 0 && <button type="button" className="text-xs underline" onClick={() => void markAllRead()}>Mark all read</button>}
        </div>
        {recent.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing new.</p>
        ) : (
          <ul className="max-h-80 divide-y overflow-y-auto">
            {recent.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={`w-full px-3 py-2 text-left hover:bg-muted ${n.read_at ? '' : 'bg-primary/5'}`}
                  onClick={() => { void markRead(n.id); navigate(n.url); }}
                >
                  <p className="truncate text-sm">{n.title}</p>
                  <p className="text-xs text-muted-foreground">{n.actor_name ? `${n.actor_name} · ` : ''}{formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t px-3 py-2 text-right">
          <Link to="/inbox" className="text-xs underline">Open inbox</Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4: Inbox page** (`src/pages/Inbox.tsx`) — title "Inbox", an "Unread only" toggle (shadcn `Switch`), the list (same row content as the bell, full width, each row a button that marks read and navigates), loading / error-with-retry / empty states in the style of `MySignoffs.tsx`. Add the route in `App.tsx` next to `/my-signoffs` (session-only, inside `ProtectedRoute` + `DashboardLayout`).

- [ ] **Step 5: Header + badges.** In `DashboardLayout.tsx`: import `NotificationBell` and render it before `<HintsToggle />`. Extend `NavItem` with `badgeKinds?: NotificationKind[]`; set `badgeKinds: ['issue_assigned','issue_comment','issue_mention']` on Issues, `['signoff_requested','signoff_overdue']` on My Sign-offs, `['report_submitted','report_returned','report_approved']` on Building Reports. Call `const { unreadByKind } = useNotifications();` in the layout, and in each of the three nav render loops, after `<span>{item.title}</span>`:

```tsx
{item.badgeKinds && unreadByKind(item.badgeKinds) > 0 && (
  <span className="ml-auto rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-4 text-primary-foreground">{unreadByKind(item.badgeKinds)}</span>
)}
```

- [ ] **Step 6: Tests, gate, commit**

```bash
git add src/hooks/useNotifications.ts src/hooks/useNotifications.test.ts src/components/notifications/NotificationBell.tsx src/pages/Inbox.tsx src/components/layout/DashboardLayout.tsx src/App.tsx
git commit -m "Add the inbox: header bell with unread count, an Inbox page, live updates, and nav badges"
```

---

### Task 5: Preferences live on Profile only

**Files:**
- Modify: `src/pages/Profile.tsx` (labels/descriptions only, ~lines 541-650)
- Modify: `src/pages/Settings.tsx` (remove the notifications tab: trigger at ~255-258, content at ~323-390, related state/handlers at ~64, 118-148)

- [ ] **Step 1: Profile copy.** Retitle the card "Notifications" with description "Everything below also appears in your inbox in the app. These switches control email." Labels: `email_notifications` → "Email me at all" ("Turn this off to stop every email; the inbox still updates."); `issue_updates` → "Issues and reports" ("Assignments, comments, mentions, and report reviews."); `task_reminders` → "Tasks and sign-offs" ("When a task or a sign-off is assigned to me."); `overdue_alerts` → "Overdue and expiring" ("Overdue sign-offs, expiring documents, and asset service due."); `daily_digest` → "Daily digest" ("One email each morning with what's on my day."). Keep the save button and handler.

- [ ] **Step 2: Settings.** Remove the Notifications `TabsTrigger`, its `TabsContent`, the preference state and `handleSaveNotifications` (or equivalently named) handler, and any now-unused imports (`Bell`, `Switch`). Do not touch Organization or Branding tabs.

- [ ] **Step 3: Gate, tests, commit**

```bash
git add src/pages/Profile.tsx src/pages/Settings.tsx
git commit -m "Keep notification preferences in one place, on the profile, with labels that say what each switch does"
```

---

### Task 6: Retrofit the five user-facing senders onto the shared module

**Files:** `supabase/functions/notify-form-submission/index.ts`, `notify-form-review/index.ts`, `notify-signoff-request/index.ts`, `notify-signoff-complete/index.ts`, `signoff-reminders/index.ts`.

Pattern for each (worked fully for `notify-form-review`; the others follow the same shape):

- Delete the local `sendEmail` and any local `senderName`/`APP_URL`; import `createNotifications` (and `APP_URL` if the function builds absolute links) from `../_shared/notify.ts`.
- Keep the function's authorization and row lookups exactly as they are.
- Replace the final `sendEmail(...)` with one `createNotifications(supabase, { recipients, actorId, actorName, kind, entityType, entityId, buildingId, title, body, url, subject, detailHtml, ctaText })`. The `detailHtml` is the function's existing table/paragraph block (already escaped). The `url` is the in-app PATH (`/forms`, `/my-signoffs`), not an absolute URL.
- Return `{ success: true, ...result }`.

`notify-form-review` becomes, from the line `// Get the submitter's email from profiles` onward: keep the reviewer-name and building-name reads, then

```ts
const status = submission.status as string;           // 'approved' | 'rejected'
const result = await createNotifications(supabase, {
  recipients: submission.submitted_by ? [submission.submitted_by] : [],
  actorId: caller.id, actorName: reviewerName ?? null,
  kind: 'form_reviewed', entityType: 'form_submission', entityId: submission.id, buildingId: submission.building_id ?? null,
  title: `Form ${status}: ${formName}`,
  body: submission.review_notes ? String(submission.review_notes) : null,
  url: '/forms',
  subject: `Form ${status === 'approved' ? 'Approved' : 'Rejected'}: ${formName}`,
  detailHtml: /* the existing details table */,
  ctaText: 'View form',
});
return json({ success: true, ...result });
```

Mapping for the rest: `notify-form-submission` → kind `form_submitted`, recipients `adminAndManagerIds(supabase)`, actor = submitter, url `/forms`, entityType `form_submission`. `notify-signoff-request` → `signoff_requested`, recipients `[request.assigned_to]`, actor `request.assigned_by`, url `/my-signoffs`, entityType `signoff_request`, entityId `request.id`. `notify-signoff-complete` → `signoff_complete`, recipients = submitter + requesters set, actor = caller, url `/forms`. `signoff-reminders` → two calls per run: `signoff_requested` reminder to each signer (title "Reminder: sign-off due …"), and `signoff_overdue` to `adminAndManagerIds` for expired requests; keep the `reminded_at` write and the expiry logic; also switch its wildcard CORS to `corsHeaders(req)` from `../_shared/cors.ts` and keep the `x-signoff-secret` header in `ALLOW_HEADERS` by extending the header string locally if needed.

- [ ] **Step 1–5:** one function per step, reading each file fully first. Confirm every function still compiles by reading imports/usages (no Deno locally). Confirm no function still declares its own `sendEmail`: `grep -L "sendEmail" supabase/functions/notify-*/index.ts supabase/functions/signoff-reminders/index.ts` must list all five.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/notify-form-submission supabase/functions/notify-form-review supabase/functions/notify-signoff-request supabase/functions/notify-signoff-complete supabase/functions/signoff-reminders
git commit -m "Route the form and sign-off emails through the shared sender so they also land in the inbox and honour preferences"
```

---

### Task 7: Daily digest

**Files:**
- Create: `supabase/functions/daily-digest/index.ts`
- Create: `supabase/functions/_shared/digest.ts` (pure composition, tested) + `src/lib/digest.test.ts`
- Create: `../GMI/sql/2026-09-11_02_daily_digest_cron.sql` → vendored
- Modify: `supabase/config.toml` (`[functions.daily-digest] verify_jwt = false`)

- [ ] **Step 1: Pure composer + test**

```ts
// supabase/functions/_shared/digest.ts
/** Pure composition of one person's digest; no I/O so it is unit-tested from vitest. */
export interface DigestTask { id: string; task_name: string; due_date: string; building_name: string | null }
export interface DigestIssue { id: string; title: string; priority: string; building_name: string | null }
export interface DigestInput { today: string /* YYYY-MM-DD */; tasks: DigestTask[]; issues: DigestIssue[]; unread: number }
export interface DigestSection { heading: string; lines: string[] }

export function composeDigest(input: DigestInput): DigestSection[] | null {
  const overdue = input.tasks.filter((t) => t.due_date < input.today);
  const today = input.tasks.filter((t) => t.due_date === input.today);
  const sections: DigestSection[] = [];
  const line = (t: DigestTask) => `${t.task_name}${t.building_name ? ` — ${t.building_name}` : ''}`;
  if (overdue.length) sections.push({ heading: `${overdue.length} overdue task${overdue.length === 1 ? '' : 's'}`, lines: overdue.map(line) });
  if (today.length) sections.push({ heading: `${today.length} due today`, lines: today.map(line) });
  if (input.issues.length) sections.push({ heading: `${input.issues.length} open issue${input.issues.length === 1 ? '' : 's'} assigned to you`, lines: input.issues.map((i) => `${i.title} (${i.priority})${i.building_name ? ` — ${i.building_name}` : ''}`) });
  if (input.unread) sections.push({ heading: `${input.unread} unread notification${input.unread === 1 ? '' : 's'}`, lines: [] });
  return sections.length ? sections : null;
}
```

Test (`src/lib/digest.test.ts`): empty input → null; overdue/today split by the `today` string; unread-only digest has one section with no lines.

- [ ] **Step 2: Edge function** — cron-secret guard (`x-digest-secret` vs `DAILY_DIGEST_SECRET`, same shape as `signoff-reminders`), then: profiles where `daily_digest = true` and not deactivated and email present; for each: tasks `assigned_to = id` with status in (pending, overdue) and `due_date <= today` (today in `Africa/Johannesburg`), issues `assigned_to = id` and status != resolved, unread count from `notifications` (`read_at is null`); hydrate building names in one `buildings` read; `composeDigest`; skip when null; otherwise one `renderEmail` with the sections as `<h3>`/`<ul>` blocks (escape every line with `escapeText`), `ctaText: 'Open My Day'`, `ctaUrl: `${APP_URL}/my-day`` (the route lands in R1c; until then the app's `/` is fine — use `/`). Return counts only.

- [ ] **Step 3: Cron SQL** (GMI, then vendor):

```sql
-- 2026-09-11_02_daily_digest_cron.sql
-- Daily digest email for users who opted in (profiles.daily_digest). 04:30 UTC = 06:30 SAST,
-- ahead of the 06:00/07:00 UTC alert and sign-off runs. Replace <PROJECT_REF> and
-- <DAILY_DIGEST_SECRET> when applying; never commit a real secret.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule(
  'daily-digest',
  '30 4 * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/daily-digest',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-digest-secret', '<DAILY_DIGEST_SECRET>'),
    body := '{}'::jsonb
  );
  $$
);
-- To remove later: select cron.unschedule('daily-digest');
```

- [ ] **Step 4: Commit (both repos)**

```bash
git -C ../GMI add sql/2026-09-11_02_daily_digest_cron.sql && git -C ../GMI commit -m "Schedule the daily digest"
git add supabase/functions/daily-digest supabase/functions/_shared/digest.ts src/lib/digest.test.ts supabase/schema supabase/config.toml
git commit -m "Add the opt-in daily digest: overdue and due-today tasks, my issues, unread count"
```

---

### Task 8: Notifications smoke (live, not in the default chain until deployed)

**Files:**
- Create: `scripts/notifications-smoke.mjs`

- [ ] Using the helpers and personas in `scripts/rls-smoke.mjs` as the model: sign in as the `user` persona, POST `/functions/v1/notify` with a `task_assigned` for a building they can access and recipient = themselves → expect 200 and no inbox row (actor excluded); recipient = the manager persona → expect 200 and a row visible to the manager and not the user; a building they cannot access → 403; an unknown kind → 400. Mark read via the manager's JWT and assert `read_at` set. Clean up rows with the service key. Add `"smoke:notifications": "node scripts/notifications-smoke.mjs"` to `package.json` scripts; do not add it to `smoke` until Task 9 confirms the function is deployed. `node --check` must pass.

```bash
git add scripts/notifications-smoke.mjs package.json
git commit -m "Add a live smoke for the notify function and inbox visibility"
```

---

### Task 9: Owner actions (hand to Arno)

- [ ] Deploy `notify`, `daily-digest`, and the five retrofitted functions; set `DAILY_DIGEST_SECRET`; apply the cron SQL with the real ref and secret on staging, then prod.
- [ ] Run `npm run smoke:notifications` against staging, then add it to the `smoke` chain.
- [ ] Regenerate `types.ts`, then drop the `'notifications' as never` casts in `useNotifications.ts`.

---

## Self-review

- Spec §6 coverage: one sender + prefs matrix → T1; `notify` fn → T2; client seam + report transitions → T3; inbox UI, realtime, badges → T4; preferences consolidated → T5; retrofit of the existing senders → T6 (five user-facing ones; `notify-expiring-alerts` keeps its own digest email and already honours prefs — deliberately untouched, noted); daily digest → T7; smoke → T8. Analytics scaffold is R1c.
- Placeholders: none; T6 gives one worked function and an explicit mapping for the other four.
- Type consistency: `NotificationKind`/`NotificationEntityType` defined once in `notifyRules.ts` and mirrored (same literal unions) in `src/lib/notify.ts`; `createNotifications` input fields used identically in T2 and T6; `useNotifications` return shape used by the bell, the page, and the layout in T4.

## Status (2026-09-10)

Tasks 1–8 implemented on `feat/reports-access-hardening` (commits bc05679..f5c6fe1), each through a
spec review and a quality review, seven fix commits, and a whole-slice final review; 309 tests pass,
typecheck baseline 64, build green. Task 9 remains with the owner. Nothing in this slice has run
against a live project: the `notify` and `daily-digest` functions and the five retrofitted senders are
verified by reading and by the vitest-covered pure modules only, so `npm run smoke:notifications` on
staging is the first real proof.

Deviations from the plan text, all reviewed: recipients are filtered (unknown, deactivated) BEFORE the
inbox insert; results carry `failed` separately from `skipped`; title/body are clamped once and shared
by inbox and email; `buildInboxRows` rejects empty titles and non-allowlisted URLs; the `notify`
function accepts only the seven client kinds and `report_submitted` is the only org-wide client kind;
`parseNotifyBody` and `isAllowedUrl` live in `notifyRules.ts` under test; the realtime channel has one
owner (`useNotificationsRealtime`, mounted by the layout) with a debounced invalidation; unread is an
exact head count; emails render `detailHtml` before a labelled, pre-wrapped body; `corsHeaders` takes
extra header names; the reminder cron survives a bad row; the digest is gated on the master email
switch and caps each section at 15 lines; the smoke refuses the production ref and opts personas out
of email.

Follow-ups deliberately left:
- `notify-expiring-alerts` still sends its own digest email and writes no inbox rows (spec §6 listed
  it; the plan excluded it).
- The same duplicate-channel defect exists in `useUserProfile` / `useOrganization` (queued as a
  separate task chip).
- `notify-form-submission`'s client still posts the legacy body without `submissionId`; the
  "most recent submission" fallback is therefore the live path. Fix on the client, then delete it.
- Notifications are not idempotent: a client retry within the freshness window duplicates inbox rows.
- `notify-signoff-complete` drops the submitter when they were also the last signer (actor rule).
