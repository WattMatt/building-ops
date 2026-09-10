# R1a "Assign & talk" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tasks and issues get a human owner, people can talk on an issue (comments, photos, @mentions), resolving an issue requires a closing note, and building contacts are tappable.

**Architecture:** One additive migration authored in the sibling `../GMI/sql/` repo and vendored (`task_instances.assigned_to`, `issue_activity.mentions`, `resolved_at` trigger, `building_members` SECURITY DEFINER RPC, `notifications` table for R1b). A `useBuildingMembers` hook and an `AssigneePicker` component replace the unscoped profiles read. A `notify()` seam in `src/lib/notify.ts` is a no-op that R1b wires to the edge function. All writes chain `.select('id')` and treat zero rows as failure.

**Tech Stack:** Vite + React 18 + TS, TanStack Query (for the new hooks), shadcn/ui, Supabase JS, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-10-r1-mine-design.md` §4, §5.

**Ground rules for every agent:** never `git stash` / `checkout` / `reset` / `worktree`; compare with `git show <sha>:<path>`; one implementer at a time; commit only your files; end commit messages with a blank line and `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; typecheck `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c 'error TS'` must stay ≤ 65; guardrail copy never through `<Hint>`.

---

### Task 1: Migration + RLS smoke assertions

**Files:**
- Create: `../GMI/sql/2026-09-11_01_r1_mine.sql`
- Run: `npm run schema:vendor` → `supabase/schema/2026-09-11_01_r1_mine.sql`, `.source`
- Modify: `scripts/rls-smoke.mjs` (append assertions; read the file's helper style first)

- [ ] **Step 1: Write the migration** (exact content):

```sql
-- 2026-09-11_01_r1_mine.sql
-- R1 "Mine": tasks get a human owner, comments carry mentions, resolved_at is stamped by
-- the database, building membership is queryable without widening profiles RLS, and the
-- in-app inbox table exists (written by the notify edge function in R1b).
-- Additive and idempotent. Apply order: staging (vkrihpmjajjcxmzgjqdr) -> smoke -> prod
-- (qdzgkttiosahdfqresvz) -> smoke. iOS ignores unknown columns.
begin;

-- 1) Tasks get a human owner. responsible_role stays as the default-assignment input (R3).
alter table public.task_instances
  add column if not exists assigned_to uuid references public.profiles(id) on delete set null;
create index if not exists task_instances_assigned_to_due_idx
  on public.task_instances (assigned_to, due_date)
  where status in ('pending','overdue');

-- 2) Mentions on a comment. issue_activity already carries comment + photo_urls.
alter table public.issue_activity
  add column if not exists mentions uuid[] not null default '{}';

-- 3) resolved_at is set by the database so cycle time is trustworthy.
create or replace function public.stamp_issue_resolved_at() returns trigger
language plpgsql as $$
begin
  if new.status = 'resolved' and (old.status is distinct from 'resolved') then
    new.resolved_at := now();
  elsif new.status <> 'resolved' then
    new.resolved_at := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_issue_resolved_at on public.issues;
create trigger trg_issue_resolved_at
  before update of status on public.issues
  for each row execute function public.stamp_issue_resolved_at();

-- 4) Who can be assigned or mentioned on a building: admins/managers plus users with an
--    explicit user_buildings row. SECURITY DEFINER because profiles are not readable across
--    users (p_select is own-row-or-manager); returns display fields only, and only to
--    callers who can access the building themselves.
create or replace function public.building_members(b uuid)
returns table (id uuid, full_name text, avatar_url text, role text)
language sql security definer set search_path = public stable as $$
  select p.id, p.full_name, p.avatar_url, r.role
  from public.profiles p
  join public.user_roles r on r.user_id = p.id
  where public.can_access_building(b)
    and coalesce(p.deactivated, false) = false
    and (
      r.role in ('admin','manager')
      or exists (select 1 from public.user_buildings ub where ub.user_id = p.id and ub.building_id = b)
    )
  order by p.full_name nulls last;
$$;
revoke all on function public.building_members(uuid) from public;
grant execute on function public.building_members(uuid) to authenticated;

-- 5) The inbox. No client insert policy: rows are written by the notify edge function.
create table if not exists public.notifications (
  id            uuid primary key default gen_random_uuid(),
  recipient_id  uuid not null references public.profiles(id) on delete cascade,
  actor_id      uuid references public.profiles(id) on delete set null,
  actor_name    text,
  kind          text not null,
  entity_type   text not null,
  entity_id     uuid,
  building_id   uuid references public.buildings(id) on delete cascade,
  title         text not null,
  body          text,
  url           text not null,
  read_at       timestamptz,
  created_at    timestamptz not null default now(),
  constraint notifications_kind_check check (kind in (
    'task_assigned','issue_assigned','issue_comment','issue_mention',
    'report_submitted','report_returned','report_approved',
    'form_submitted','form_reviewed','signoff_requested','signoff_complete','signoff_overdue',
    'document_expiring','asset_service_due')),
  constraint notifications_entity_type_check check (entity_type in (
    'task','issue','report','form_submission','signoff_request','document','asset'))
);
create index if not exists notifications_recipient_unread_idx
  on public.notifications (recipient_id, created_at desc) where read_at is null;
create index if not exists notifications_recipient_created_idx
  on public.notifications (recipient_id, created_at desc);
alter table public.notifications enable row level security;
drop policy if exists n_select_own on public.notifications;
create policy n_select_own on public.notifications for select using (recipient_id = auth.uid());
drop policy if exists n_update_own on public.notifications;
create policy n_update_own on public.notifications for update
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

commit;
```

- [ ] **Step 2: Vendor** — `npm run schema:vendor`; confirm the new file under `supabase/schema/` and `.source` bumped.

- [ ] **Step 3: Smoke assertions.** Open `scripts/rls-smoke.mjs`, find how it creates the `zztest-*` personas (a `user` persona assigned to one building, an `admin`) and its assertion helper (`expectAllowed`/`expectDenied` or similar). Append, following that style:

```js
// R1: notifications are private to their recipient and never client-insertable.
await expectDenied(asUser.from('notifications').insert({ recipient_id: userId, kind: 'task_assigned', entity_type: 'task', title: 't', url: '/' }), 'user inserts notification');
await expectAllowed(asUser.from('notifications').select('id').eq('recipient_id', userId), 'user reads own notifications');
// A row seeded by service role for the admin must be invisible to the user.
const { data: seeded } = await admin.from('notifications').insert({ recipient_id: adminId, kind: 'task_assigned', entity_type: 'task', title: 't', url: '/' }).select('id').single();
const { data: leaked } = await asUser.from('notifications').select('id').eq('id', seeded.id);
assert.equal((leaked ?? []).length, 0, 'user cannot read another recipient\'s notification');
await admin.from('notifications').delete().eq('id', seeded.id);

// R1: building_members returns members only to callers who can access the building.
const { data: members, error: membersErr } = await asUser.rpc('building_members', { b: assignedBuildingId });
assert.equal(membersErr, null, 'building_members callable by a member');
assert.ok(members.some((m) => m.id === userId), 'member sees themselves');
const { data: foreign } = await asUser.rpc('building_members', { b: otherBuildingId });
assert.equal((foreign ?? []).length, 0, 'non-member gets an empty member list');

// R1: assigned_to is writable by building members only.
await expectAllowed(asUser.from('task_instances').update({ assigned_to: userId }).eq('id', assignedTaskId).select('id'), 'member assigns a task');
await expectDenied(asUser.from('task_instances').update({ assigned_to: userId }).eq('id', foreignTaskId).select('id'), 'non-member cannot assign');
```

Use the script's real variable names for the personas/buildings/tasks; if it has no task fixture, create one via `admin` in the setup block and delete it in teardown. The smoke cannot run here (needs `SUPABASE_*` env); it must at least parse: `node --check scripts/rls-smoke.mjs`.

- [ ] **Step 4: Commit (both repos)**

```bash
git -C ../GMI add sql/2026-09-11_01_r1_mine.sql && git -C ../GMI commit -m "R1 Mine: task assignee, comment mentions, resolved_at trigger, building_members RPC, notifications table"
git add supabase/schema scripts/rls-smoke.mjs && git commit -m "Add the R1 Mine schema (vendored) and prove its RLS in the smoke matrix"
```

---

### Task 2: `useBuildingMembers` hook and `AssigneePicker`

**Files:**
- Create: `src/hooks/useBuildingMembers.ts`
- Create: `src/hooks/useBuildingMembers.test.ts`
- Create: `src/components/people/AssigneePicker.tsx`
- Create: `src/components/people/AssigneePicker.test.tsx`

- [ ] **Step 1: Failing hook test**

```ts
// src/hooks/useBuildingMembers.test.ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));

import { useBuildingMembers, memberDisplayName } from './useBuildingMembers';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, children);

describe('useBuildingMembers', () => {
  it('calls building_members with the building id and returns members', async () => {
    rpc.mockResolvedValueOnce({ data: [{ id: 'u1', full_name: 'Thabo M', avatar_url: null, role: 'user' }], error: null });
    const { result } = renderHook(() => useBuildingMembers('b1'), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(rpc).toHaveBeenCalledWith('building_members', { b: 'b1' });
    expect(result.current.byId.get('u1')?.full_name).toBe('Thabo M');
  });

  it('is disabled without a building id', () => {
    const { result } = renderHook(() => useBuildingMembers(undefined), { wrapper });
    expect(result.current.isLoading).toBe(false);
    expect(rpc).not.toHaveBeenCalledWith('building_members', { b: undefined });
  });
});

describe('memberDisplayName', () => {
  it('falls back sensibly', () => {
    expect(memberDisplayName({ id: 'x', full_name: null, avatar_url: null, role: 'user' })).toBe('Unnamed user');
    expect(memberDisplayName({ id: 'x', full_name: '  Ann ', avatar_url: null, role: 'user' })).toBe('Ann');
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/hooks/useBuildingMembers.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement the hook**

```ts
// src/hooks/useBuildingMembers.ts
/**
 * People who can be assigned or mentioned on a building: admins/managers plus users with an
 * explicit building assignment. Served by the `building_members` SECURITY DEFINER RPC because
 * `profiles` is not readable across users (RLS: own row or manager) — the RPC returns display
 * fields only, and only to callers who can access the building themselves.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface BuildingMember {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  role: string;
}

export function memberDisplayName(m: BuildingMember): string {
  return m.full_name?.trim() || 'Unnamed user';
}

export function useBuildingMembers(buildingId: string | undefined) {
  const query = useQuery({
    queryKey: ['building-members', buildingId],
    enabled: !!buildingId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<BuildingMember[]> => {
      // The RPC is not in the generated types until the migration ships; narrow at the boundary.
      const { data, error } = await (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: BuildingMember[] | null; error: { message: string } | null }>)('building_members', { b: buildingId });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
  const byId = useMemo(() => new Map((query.data ?? []).map((m) => [m.id, m])), [query.data]);
  return { ...query, byId };
}
```

- [ ] **Step 4: Failing picker test**

```tsx
// src/components/people/AssigneePicker.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/hooks/useBuildingMembers', () => ({
  useBuildingMembers: () => ({
    data: [
      { id: 'u1', full_name: 'Thabo M', avatar_url: null, role: 'user' },
      { id: 'u2', full_name: 'Lerato K', avatar_url: null, role: 'manager' },
    ],
    byId: new Map(),
    isLoading: false,
    isError: false,
  }),
  memberDisplayName: (m: { full_name: string | null }) => m.full_name ?? 'Unnamed user',
}));

import { AssigneePicker } from './AssigneePicker';

describe('AssigneePicker', () => {
  it('shows the current assignee name in the trigger', () => {
    render(<AssigneePicker buildingId="b1" value="u2" onChange={() => {}} />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Lerato K');
  });

  it('shows Unassigned when empty', () => {
    render(<AssigneePicker buildingId="b1" value={null} onChange={() => {}} />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Unassigned');
  });
});
```

- [ ] **Step 5: Implement the picker** (shadcn Select; Radix Select renders the trigger with `role="combobox"`)

```tsx
// src/components/people/AssigneePicker.tsx
/** Choose a building member (or nobody). Shared by tasks, issues and mentions. */
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBuildingMembers, memberDisplayName } from '@/hooks/useBuildingMembers';

const UNASSIGNED = '__unassigned__';

interface AssigneePickerProps {
  buildingId: string;
  value: string | null;
  onChange: (userId: string | null) => void;
  disabled?: boolean;
  allowUnassigned?: boolean;
  className?: string;
}

export function AssigneePicker({ buildingId, value, onChange, disabled, allowUnassigned = true, className }: AssigneePickerProps) {
  const { data: members, isLoading, isError } = useBuildingMembers(buildingId);
  const current = members?.find((m) => m.id === value);
  return (
    <Select
      value={value ?? UNASSIGNED}
      onValueChange={(v) => onChange(v === UNASSIGNED ? null : v)}
      disabled={disabled || isLoading}
    >
      <SelectTrigger className={className} aria-label="Assignee">
        <SelectValue placeholder="Unassigned">
          {value ? (current ? memberDisplayName(current) : 'Assigned user') : 'Unassigned'}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {allowUnassigned && <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>}
        {isError && <p className="px-2 py-1.5 text-xs text-destructive">Could not load people for this building.</p>}
        {(members ?? []).map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {memberDisplayName(m)}
            {m.role === 'admin' || m.role === 'manager' ? <span className="ml-1 text-xs text-muted-foreground">· {m.role}</span> : null}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

If the `SelectValue` children approach does not render the name in jsdom, render the label directly inside `SelectTrigger` instead of `SelectValue` and keep `aria-label`.

- [ ] **Step 6: Run** both tests → PASS; `npm run test`; typecheck ≤ 65.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useBuildingMembers.ts src/hooks/useBuildingMembers.test.ts src/components/people/AssigneePicker.tsx src/components/people/AssigneePicker.test.tsx
git commit -m "Add a building-scoped people list and a shared assignee picker"
```

---

### Task 3: The `notify()` seam

**Files:**
- Create: `src/lib/notify.ts`
- Create: `src/lib/notify.test.ts`

- [ ] **Step 1: Test** — the seam must never throw and must be a no-op until R1b wires it.

```ts
// src/lib/notify.test.ts
import { describe, it, expect } from 'vitest';
import { notify } from './notify';

describe('notify seam', () => {
  it('resolves without throwing', async () => {
    await expect(notify({ kind: 'task_assigned', entityType: 'task', entityId: 't1', buildingId: 'b1', recipients: ['u1'], title: 'x', url: '/x' })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/lib/notify.ts
/**
 * Client-side seam for in-app notifications. R1a records the intent; R1b replaces the body
 * with `supabase.functions.invoke('notify')` so the row lands in the recipient's inbox and
 * email fans out according to their preferences. Fire-and-forget: a failure to notify must
 * never fail the action that caused it.
 */
export type NotificationKind =
  | 'task_assigned' | 'issue_assigned' | 'issue_comment' | 'issue_mention'
  | 'report_submitted' | 'report_returned' | 'report_approved'
  | 'form_submitted' | 'form_reviewed' | 'signoff_requested' | 'signoff_complete' | 'signoff_overdue'
  | 'document_expiring' | 'asset_service_due';

export type NotificationEntityType = 'task' | 'issue' | 'report' | 'form_submission' | 'signoff_request' | 'document' | 'asset';

export interface NotifyInput {
  kind: NotificationKind;
  entityType: NotificationEntityType;
  entityId: string;
  buildingId: string;
  /** Profile ids. The sender drops the actor and anyone without access to the building. */
  recipients: string[];
  title: string;
  body?: string;
  /** In-app path the inbox row deep-links to. */
  url: string;
}

export async function notify(input: NotifyInput): Promise<void> {
  if (!input.recipients.length) return;
  if (import.meta.env.DEV) console.info('[notify] (not wired yet)', input.kind, input.recipients.length, 'recipient(s)');
}
```

- [ ] **Step 3: Run, commit**

```bash
git add src/lib/notify.ts src/lib/notify.test.ts
git commit -m "Add the notify() seam that R1b wires to the inbox"
```

---

### Task 4: Issue assignee through the picker, and history shows people by name

**Files:**
- Modify: `src/components/issues/IssueDetailDialog.tsx`

- [ ] **Step 1: Replace the profiles read.** Delete the `supabase.from('profiles').select('id, full_name, email')` branch in `load` (lines 86-105) and the `people`/`assignable` state. Add:

```ts
import { useBuildingMembers, memberDisplayName } from '@/hooks/useBuildingMembers';
import { AssigneePicker } from '@/components/people/AssigneePicker';
import { notify } from '@/lib/notify';
import { useAuth } from '@/contexts/AuthContext';
// …
const { user } = useAuth();
const { byId: members } = useBuildingMembers(issue.building_id);
const nameOf = (id: string | null | undefined) => (id && members.get(id) ? memberDisplayName(members.get(id)!) : null);
```

`load` now fetches only the activity, selecting `id, activity_type, old_value, new_value, comment, author_name, created_at, user_id, photo_urls, mentions` (extend the `Activity` interface with `user_id: string | null; photo_urls: string[] | null; mentions: string[] | null`).

- [ ] **Step 2: Assignee control** — replace the Select at lines 214-225 with:

```tsx
<div className="space-y-1.5">
  <Label className="text-xs">Assignee</Label>
  <AssigneePicker buildingId={issue.building_id} value={issue.assigned_to} onChange={changeAssignee} disabled={savingAssignee} />
</div>
```

and change `changeAssignee` to take `assigned_to: string | null`, verify the write, and notify:

```ts
const changeAssignee = async (assigned_to: string | null) => {
  if (assigned_to === issue.assigned_to) return;
  setSavingAssignee(true);
  try {
    const { data, error } = await supabase.from('issues').update({ assigned_to }).eq('id', issue.id).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('You do not have permission to assign this issue.');
    toast.success(assigned_to ? `Assigned to ${nameOf(assigned_to) ?? 'user'}` : 'Unassigned');
    if (assigned_to && assigned_to !== user?.id) {
      void notify({ kind: 'issue_assigned', entityType: 'issue', entityId: issue.id, buildingId: issue.building_id, recipients: [assigned_to], title: `Issue assigned to you: ${issue.title}`, url: `/issues?open=${issue.id}` });
    }
    onUpdated();
    await load();
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Failed to assign');
  } finally {
    setSavingAssignee(false);
  }
};
```

- [ ] **Step 3: History names.** In `activityText`, `assignment` uses `nameOf(a.new_value) ?? 'a user'`. Comments render below the author line (not through `activityText`): show `a.comment` with `whitespace-pre-wrap`, then thumbnails for `a.photo_urls` via `<SignedImage>` (h-16 w-16), then, when `a.mentions?.length`, a muted line `Mentioned: ` + names via `nameOf` joined by ", ".

- [ ] **Step 4: Typecheck ≤ 65, `npm run test`, commit**

```bash
git add src/components/issues/IssueDetailDialog.tsx
git commit -m "Assign issues from the building's member list, and show who did what by name"
```

---

### Task 5: Issue comments with photos and @mentions

**Files:**
- Create: `src/lib/mentions.ts`, `src/lib/mentions.test.ts`
- Create: `src/lib/issuePhotos.ts`
- Create: `src/components/issues/IssueCommentComposer.tsx`, `src/components/issues/IssueCommentComposer.test.tsx`
- Modify: `src/components/issues/IssueDetailDialog.tsx` (mount the composer under History)

- [ ] **Step 1: Pure mention helpers, test first**

```ts
// src/lib/mentions.test.ts
import { describe, it, expect } from 'vitest';
import { mentionQueryAt, insertMention } from './mentions';

describe('mentionQueryAt', () => {
  it('returns the partial name typed after an @ at the caret', () => {
    expect(mentionQueryAt('hello @tha', 10)).toEqual({ start: 6, query: 'tha' });
  });
  it('returns null when the caret is not inside an @-word', () => {
    expect(mentionQueryAt('hello there', 11)).toBeNull();
    expect(mentionQueryAt('a@b', 3)).toBeNull(); // no whitespace/start before @
  });
});

describe('insertMention', () => {
  it('replaces the @query with @Name and a trailing space', () => {
    expect(insertMention('hello @tha', { start: 6, query: 'tha' }, 'Thabo M')).toEqual({ text: 'hello @Thabo M ', caret: 15 });
  });
});
```

```ts
// src/lib/mentions.ts
/** Caret-aware helpers for the @mention picker in the issue comment composer. */
export interface MentionRange { start: number; query: string }

/** If the caret sits inside an "@word" that starts at the beginning or after whitespace, return it. */
export function mentionQueryAt(text: string, caret: number): MentionRange | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { start: at, query };
}

export function insertMention(text: string, range: MentionRange, name: string): { text: string; caret: number } {
  const head = text.slice(0, range.start);
  const tail = text.slice(range.start + 1 + range.query.length);
  const inserted = `${head}@${name} `;
  return { text: inserted + tail, caret: inserted.length };
}
```

- [ ] **Step 2: Photo upload helper** (same private prefix and public-URL storage convention as `NewIssue.tsx:84-100`, which `SignedImage` re-signs on read):

```ts
// src/lib/issuePhotos.ts
/** Upload issue evidence photos to the private tenant-documents bucket under the user's prefix. */
import { supabase } from '@/integrations/supabase/client';
import type { PhotoFile } from '@/components/ui/photo-capture';

export async function uploadIssuePhotos(photos: PhotoFile[], userId: string): Promise<string[]> {
  const urls: string[] = [];
  for (const photo of photos) {
    const fileName = `photos/${userId}/${Date.now()}-${crypto.randomUUID()}.jpg`;
    const { error } = await supabase.storage.from('tenant-documents').upload(fileName, photo.file, { contentType: photo.file.type });
    if (error) throw new Error(`Photo upload failed: ${error.message}`);
    const { data } = supabase.storage.from('tenant-documents').getPublicUrl(fileName);
    if (data?.publicUrl) urls.push(data.publicUrl);
  }
  return urls;
}
```

Confirm `PhotoFile` is exported from `photo-capture.tsx` (it has `file: File`); export it if not.

- [ ] **Step 3: Composer test** (mock members + supabase + photos helper; assert the insert payload)

```tsx
// src/components/issues/IssueCommentComposer.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const inserted = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      insert: (row: Record<string, unknown>) => { inserted.rows.push(row); return { select: () => ({ single: () => Promise.resolve({ data: { id: 'a1' }, error: null }) }) }; },
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { full_name: 'Me' }, error: null }) }) }),
    }),
  },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
vi.mock('@/hooks/useBuildingMembers', () => ({
  useBuildingMembers: () => ({ data: [{ id: 'u1', full_name: 'Thabo M', avatar_url: null, role: 'user' }], byId: new Map([['u1', { id: 'u1', full_name: 'Thabo M', avatar_url: null, role: 'user' }]]) }),
  memberDisplayName: (m: { full_name: string | null }) => m.full_name ?? 'Unnamed user',
}));
vi.mock('@/lib/issuePhotos', () => ({ uploadIssuePhotos: async () => [] }));
vi.mock('@/lib/notify', () => ({ notify: vi.fn(async () => {}) }));
vi.mock('@/components/ui/photo-capture', () => ({ PhotoCapture: () => null }));

import { IssueCommentComposer } from './IssueCommentComposer';

describe('IssueCommentComposer', () => {
  it('posts a comment with the chosen mention', async () => {
    const onPosted = vi.fn();
    render(<IssueCommentComposer issueId="i1" buildingId="b1" issueTitle="Leak" reporterId="r1" assigneeId={null} onPosted={onPosted} />);
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'ping @tha', selectionStart: 9 } });
    fireEvent.click(await screen.findByText('Thabo M'));
    fireEvent.click(screen.getByRole('button', { name: /post/i }));
    await waitFor(() => expect(onPosted).toHaveBeenCalled());
    expect(inserted.rows[0]).toMatchObject({ issue_id: 'i1', activity_type: 'comment', comment: 'ping @Thabo M ', mentions: ['u1'], user_id: 'me', author_name: 'Me' });
  });

  it('disables Post while empty', () => {
    render(<IssueCommentComposer issueId="i1" buildingId="b1" issueTitle="Leak" reporterId="r1" assigneeId={null} onPosted={() => {}} />);
    expect(screen.getByRole('button', { name: /post/i })).toBeDisabled();
  });
});
```

- [ ] **Step 4: Implement the composer**

```tsx
// src/components/issues/IssueCommentComposer.tsx
/**
 * Comment on an issue: text, optional photos, @mentions from the building's members.
 * Writes one issue_activity row (activity_type 'comment'); the author name is denormalised
 * from the caller's own profile because other users cannot read it back later.
 */
import { useRef, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { PhotoCapture, type PhotoFile } from '@/components/ui/photo-capture';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useBuildingMembers, memberDisplayName } from '@/hooks/useBuildingMembers';
import { uploadIssuePhotos } from '@/lib/issuePhotos';
import { mentionQueryAt, insertMention, type MentionRange } from '@/lib/mentions';
import { notify } from '@/lib/notify';

interface Props {
  issueId: string;
  buildingId: string;
  issueTitle: string;
  reporterId: string | null;
  assigneeId: string | null;
  onPosted: () => void;
}

export function IssueCommentComposer({ issueId, buildingId, issueTitle, reporterId, assigneeId, onPosted }: Props) {
  const { user } = useAuth();
  const { data: members } = useBuildingMembers(buildingId);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<PhotoFile[]>([]);
  const [mentions, setMentions] = useState<string[]>([]);
  const [range, setRange] = useState<MentionRange | null>(null);
  const [posting, setPosting] = useState(false);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  const candidates = range
    ? (members ?? []).filter((m) => memberDisplayName(m).toLowerCase().includes(range.query.toLowerCase())).slice(0, 6)
    : [];

  const onChange = (value: string, caret: number) => {
    setText(value);
    setRange(mentionQueryAt(value, caret));
  };

  const pick = (id: string, name: string) => {
    if (!range) return;
    const next = insertMention(text, range, name);
    setText(next.text);
    setMentions((m) => (m.includes(id) ? m : [...m, id]));
    setRange(null);
    requestAnimationFrame(() => boxRef.current?.setSelectionRange(next.caret, next.caret));
  };

  const post = async () => {
    const comment = text.trim();
    if (!comment || !user) return;
    setPosting(true);
    try {
      const photoUrls = photos.length ? await uploadIssuePhotos(photos, user.id) : [];
      const { data: me } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
      const authorName = (me as { full_name?: string | null } | null)?.full_name?.trim() || user.email || 'Someone';
      // Keep only mentions whose @Name still appears in the text.
      const kept = mentions.filter((id) => { const m = members?.find((x) => x.id === id); return m && comment.includes(`@${memberDisplayName(m)}`); });
      const { data, error } = await supabase.from('issue_activity').insert({
        issue_id: issueId, activity_type: 'comment', comment, photo_urls: photoUrls, mentions: kept, user_id: user.id, author_name: authorName,
      } as never).select('id').single();
      if (error) throw error;
      if (!data) throw new Error('The comment was not saved.');
      const others = Array.from(new Set([assigneeId, reporterId].filter((id): id is string => !!id && id !== user.id && !kept.includes(id))));
      if (others.length) void notify({ kind: 'issue_comment', entityType: 'issue', entityId: issueId, buildingId, recipients: others, title: `${authorName} commented on: ${issueTitle}`, body: comment.slice(0, 200), url: `/issues?open=${issueId}` });
      const mentioned = kept.filter((id) => id !== user.id);
      if (mentioned.length) void notify({ kind: 'issue_mention', entityType: 'issue', entityId: issueId, buildingId, recipients: mentioned, title: `${authorName} mentioned you on: ${issueTitle}`, body: comment.slice(0, 200), url: `/issues?open=${issueId}` });
      setText(''); setPhotos([]); setMentions([]);
      onPosted();
    } catch (e) {
      if (import.meta.env.DEV) console.error('Post comment failed:', e);
      toast.error(e instanceof Error ? e.message : 'Could not post the comment.');
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="space-y-2 border-t pt-3">
      <div className="relative">
        <Textarea
          ref={boxRef}
          rows={3}
          placeholder="Add a comment… type @ to mention someone"
          value={text}
          onChange={(e) => onChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onKeyUp={(e) => setRange(mentionQueryAt(text, (e.target as HTMLTextAreaElement).selectionStart ?? text.length))}
          disabled={posting}
        />
        {range && candidates.length > 0 && (
          <ul role="listbox" className="absolute left-0 top-full z-10 mt-1 w-64 rounded-md border bg-popover p-1 shadow-md">
            {candidates.map((m) => (
              <li key={m.id}>
                <button type="button" role="option" aria-selected={false} className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(m.id, memberDisplayName(m))}>
                  {memberDisplayName(m)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <PhotoCapture photos={photos} onPhotosChange={setPhotos} maxPhotos={3} size="sm" disabled={posting} label="Photos" />
      <div className="flex justify-end">
        <Button size="sm" onClick={post} disabled={posting || !text.trim()}>
          {posting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
          Post
        </Button>
      </div>
    </div>
  );
}
```

Check `Textarea` forwards refs (shadcn's does). If `PhotoFile` is not exported from `photo-capture.tsx`, export the existing interface.

- [ ] **Step 5: Mount it.** In `IssueDetailDialog.tsx`, after the History list (inside the same `border-t` block), render:

```tsx
<IssueCommentComposer issueId={issue.id} buildingId={issue.building_id} issueTitle={issue.title} reporterId={issue.reported_by} assigneeId={issue.assigned_to} onPosted={() => { void load(); onUpdated(); }} />
```

Anyone who can open the dialog can comment (RLS `ia_insert` = building access), so it is not gated on `canManage`.

- [ ] **Step 6: Tests, typecheck ≤ 65, commit**

```bash
git add src/lib/mentions.ts src/lib/mentions.test.ts src/lib/issuePhotos.ts src/components/issues/IssueCommentComposer.tsx src/components/issues/IssueCommentComposer.test.tsx src/components/issues/IssueDetailDialog.tsx src/components/ui/photo-capture.tsx
git commit -m "Let people comment on an issue with photos and @mentions"
```

---

### Task 6: Resolving an issue requires a closing note

**Files:**
- Create: `src/components/issues/ResolveIssueDialog.tsx`
- Modify: `src/components/issues/IssueDetailDialog.tsx` (`changeStatus`)

- [ ] **Step 1: Dialog** — note required, optional photos; writes the comment row first, then the status.

```tsx
// src/components/issues/ResolveIssueDialog.tsx
/** Closing an issue needs a note (what was done) — it becomes the last comment, then the status flips. */
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PhotoCapture, type PhotoFile } from '@/components/ui/photo-capture';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { uploadIssuePhotos } from '@/lib/issuePhotos';

interface Props { issueId: string; open: boolean; onOpenChange: (o: boolean) => void; onResolved: () => void }

export function ResolveIssueDialog({ issueId, open, onOpenChange, onResolved }: Props) {
  const { user } = useAuth();
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<PhotoFile[]>([]);
  const [busy, setBusy] = useState(false);

  const resolve = async () => {
    if (!user || !note.trim()) return;
    setBusy(true);
    try {
      const photoUrls = photos.length ? await uploadIssuePhotos(photos, user.id) : [];
      const { data: me } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
      const authorName = (me as { full_name?: string | null } | null)?.full_name?.trim() || user.email || 'Someone';
      const { error: cErr } = await supabase.from('issue_activity').insert({ issue_id: issueId, activity_type: 'comment', comment: note.trim(), photo_urls: photoUrls, mentions: [], user_id: user.id, author_name: authorName } as never);
      if (cErr) throw cErr;
      // The note is saved even if the status flip fails — it is true either way.
      const { data, error } = await supabase.from('issues').update({ status: 'resolved' }).eq('id', issueId).select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('Your note was saved, but you do not have permission to resolve this issue.');
      toast.success('Issue resolved');
      setNote(''); setPhotos([]);
      onOpenChange(false);
      onResolved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not resolve the issue.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resolve this issue</DialogTitle>
          <DialogDescription>Say what was done. This note is recorded on the issue and is required.</DialogDescription>
        </DialogHeader>
        <Textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Replaced the faulty breaker; tested under load." disabled={busy} />
        <PhotoCapture photos={photos} onPhotosChange={setPhotos} maxPhotos={3} size="sm" disabled={busy} label="Photo of the fix (optional)" />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={resolve} disabled={busy || !note.trim()}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Resolve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Wire it.** In `IssueDetailDialog.tsx`: state `const [resolveOpen, setResolveOpen] = useState(false);`. In `changeStatus`, `if (status === 'resolved') { setResolveOpen(true); return; }` before the write. Render `<ResolveIssueDialog issueId={issue.id} open={resolveOpen} onOpenChange={setResolveOpen} onResolved={() => { onUpdated(); void load(); }} />` inside the dialog content. The plain status write for other transitions also gains `.select('id')` + zero-row check.

- [ ] **Step 3: Typecheck ≤ 65, tests, commit**

```bash
git add src/components/issues/ResolveIssueDialog.tsx src/components/issues/IssueDetailDialog.tsx
git commit -m "Require a closing note when an issue is resolved"
```

---

### Task 7: Assign tasks to people

**Files:**
- Modify: `src/components/building/ChecklistsTab.tsx`

- [ ] **Step 1: Data.** Add `assigned_to: string | null;` to `TaskInstance` and `assigned_to` to the `fetchTasks` select. Add near the top of the component:

```ts
const { user, isAdminOrManager } = useAuth();
const { byId: members } = useBuildingMembers(buildingId);
const nameOf = (id: string | null) => (id && members.get(id) ? memberDisplayName(members.get(id)!) : null);

const assignTasks = async (taskIds: string[], assigned_to: string | null) => {
  if (!taskIds.length) return;
  const { data, error } = await supabase.from('task_instances').update({ assigned_to } as never).in('id', taskIds).select('id');
  if (error) { toast.error(`Could not assign: ${error.message}`); return; }
  if ((data?.length ?? 0) < taskIds.length) toast.error(`Only ${data?.length ?? 0} of ${taskIds.length} tasks could be assigned — your role does not permit the rest.`);
  else toast.success(assigned_to ? `Assigned ${taskIds.length} task${taskIds.length === 1 ? '' : 's'} to ${nameOf(assigned_to) ?? 'user'}` : 'Unassigned');
  if (assigned_to && assigned_to !== user?.id && data?.length) {
    void notify({ kind: 'task_assigned', entityType: 'task', entityId: data[0].id, buildingId, recipients: [assigned_to], title: `${data.length} task${data.length === 1 ? '' : 's'} assigned to you at ${buildingName ?? 'a building'}`, url: `/buildings/${buildingId}?tab=checklists` });
  }
  fetchTasks();
};
```

Imports: `useBuildingMembers`, `memberDisplayName`, `AssigneePicker`, `notify`, `Popover, PopoverContent, PopoverTrigger` from `@/components/ui/popover`, `UserPlus` from lucide.

- [ ] **Step 2: Bulk assign.** Next to the "Generate <Frequency>" button (line ~466), for `isAdminOrManager`, add a Popover:

```tsx
{isAdminOrManager && pendingTasks.length > 0 && (
  <Popover>
    <PopoverTrigger asChild>
      <Button variant="outline" size="sm"><UserPlus className="mr-2 h-4 w-4" />Assign all pending</Button>
    </PopoverTrigger>
    <PopoverContent className="w-72 space-y-2">
      <p className="text-sm">Assign the {pendingTasks.length} pending {frequencyLabels[selectedFrequency].toLowerCase()} tasks to:</p>
      <AssigneePicker buildingId={buildingId} value={null} onChange={(id) => id && assignTasks(pendingTasks.map((t) => t.id), id)} allowUnassigned={false} />
    </PopoverContent>
  </Popover>
)}
```

- [ ] **Step 3: Per-row assignee.** `TasksList` gains props `nameOf: (id: string | null) => string | null`, `canAssign: (task: TaskInstance) => boolean`, `onAssign: (task: TaskInstance, userId: string | null) => void`, `buildingId: string`. In each row, under the due-date line:

```tsx
<div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
  <User className="h-3 w-3" />
  {task.assigned_to ? (nameOf(task.assigned_to) ?? 'Assigned') : 'Unassigned'}
  {canAssign(task) && task.status === 'pending' && (
    <Popover>
      <PopoverTrigger asChild><button type="button" className="underline">change</button></PopoverTrigger>
      <PopoverContent className="w-64">
        <AssigneePicker buildingId={buildingId} value={task.assigned_to} onChange={(id) => onAssign(task, id)} />
      </PopoverContent>
    </Popover>
  )}
</div>
```

Pass from the two `TasksList` call sites: `buildingId={buildingId}`, `nameOf={nameOf}`, `canAssign={(t) => isAdminOrManager || t.assigned_to === user?.id}` (the assignee may hand off), `onAssign={(t, id) => assignTasks([t.id], id)}`.

- [ ] **Step 4: Typecheck ≤ 65, tests, commit**

```bash
git add src/components/building/ChecklistsTab.tsx
git commit -m "Assign checklist tasks to a person, singly or all pending at once"
```

---

### Task 8: Tappable building contacts

**Files:**
- Modify: `src/pages/BuildingDetails.tsx` (contact cards ~lines 214-307)

- [ ] **Step 1:** Wrap each phone in `<a href={`tel:${phone.replace(/\s+/g, '')}`} className="hover:underline">{phone}</a>` and each email in `<a href={`mailto:${email}`} className="hover:underline">{email}</a>` for all three cards (Asset Manager, Centre Management, Security). Keep the icons and classes.

- [ ] **Step 2: Typecheck, commit**

```bash
git add src/pages/BuildingDetails.tsx
git commit -m "Make building contact numbers and emails tappable"
```

---

### Task 9: Owner actions (hand to Arno)

- [ ] Apply `GMI/sql/2026-09-11_01_r1_mine.sql` to staging, run `npm run smoke` (rls-smoke now covers notifications, building_members, assigned_to), then prod, then smoke again.
- [ ] Regenerate `types.ts`, then drop the `as never` / narrow-cast notes in `useBuildingMembers.ts`, `ChecklistsTab.tsx`, `src/lib/issueActivity.ts`, and the narrow cast in `IssueDetailDialog.tsx`.
- [ ] Push both repos.

---

## Self-review

- Spec §5 coverage: AssigneePicker + useBuildingMembers → T2; task assignment single+bulk with zero-row checks → T7; comments with photos + mentions → T5; resolve with closing note + trigger → T1 + T6; tel/mailto → T8; notify seam → T3; issue assignee via picker → T4; migration incl. notifications table + realtime → T1. Generation leaves `assigned_to` null (stated).
- Placeholders: none.
- Type consistency: `BuildingMember` / `memberDisplayName` / `useBuildingMembers().byId` used identically in T2, T4, T5, T7; `NotifyInput` fields match across T3–T7; `uploadIssuePhotos(photos, userId)` in T5 and T6; `assignTasks(ids, assigned_to)` in T7 both call sites.
