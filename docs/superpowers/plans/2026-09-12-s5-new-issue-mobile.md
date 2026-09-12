# S5 "New Issue mobile pass" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A caretaker on a phone opens New Issue with the building already chosen, takes the photo first, taps 44 px controls, reaches "Report issue" with a thumb, and never loses a half-written report to the camera app or a reload.

**Architecture:** Three small pieces under the existing page. (1) `src/lib/lastBuilding.ts` keeps the last submitted building per user in `localStorage` (`fortress.lastBuilding.<uid>`); `NewIssue` derives the building once the roster has loaded in the order `?building=` → only building → last used → empty. (2) `src/lib/offline/drafts.ts` is a second per-user `idb-keyval` store (`bo-drafts-<uid>`, one key) holding the form fields and the already-processed photo `File`s; `useIssueDraft(uid)` reads it once on mount, debounces writes by 400 ms, flushes on unmount and cancels on clear; `NewIssue` restores fields and previews, shows a plain guardrail bar "Draft restored / Discard", saves on every change, clears on submit and discard. The store is emptied in `PersistedQueryProvider` alongside `clearQueue` on user change. (3) Layout: photo capture directly under the building select with one `<Hint>`, `min-h-11` controls below `sm`, a bottom action bar that is `fixed` on phones (decided by `useIsMobile`, the app's phone test), and a phone-only floating "Report issue" link on My Day. No schema change, no function change.

**Tech Stack:** React 18 + TS, `idb-keyval` (dependency, `^6.3.0`), `fake-indexeddb` (devDependency, `^6.2.5`, auto-loaded by `src/test/setup.ts`), vitest 3 + Testing Library, `src/test/mobile.ts` `mockViewport` for phone-width tests.

**Spec:** `docs/superpowers/specs/2026-09-12-field-readiness-design.md` §8 (constraints in §2).

**Ground rules for every agent:** never `git stash` / `checkout` / `switch` / `reset` / `worktree`; compare with `git show <sha>:<path>`; edit only the files your task names; commit with an explicit pathspec; retry after 5 s on `index.lock`; end commit messages with a blank line and `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; gate = `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E '<your files>'` prints nothing, `npm run test` green, global count ≤ `.github/typecheck-baseline.txt` (46); guardrail copy (the "Draft restored" bar, validation toasts) is plain text, never through `<Hint>`; coaching copy always through `<Hint>`; tap targets ≥ 44 px on phones; do not edit the shared components in `src/components/ui/` (heights are set per call site with responsive classes).

**Facts every task relies on:** `NewIssue` (`src/pages/NewIssue.tsx`) already submits through `enqueueAndRun(user.id, { kind: 'issue_create', … }, photos.map((p) => ({ file: p.file })))` and gets back a `RunOutcome` — `{ status: 'synced', result }`, `{ status: 'queued' }` or `{ status: 'failed', error }` (`src/lib/offline/types.ts`); it navigates to `/issues` whenever `outcome.status !== 'failed'`. `PhotoCapture` (`src/components/ui/photo-capture.tsx`) takes `photos: PhotoFile[]` and `onPhotosChange`, where `PhotoFile = { file: File; preview: string }` and `file` is the compressed JPEG. `src/lib/offline/queue.ts` creates stores with `createStore(\`bo-queue-${uid}\`, 'ops')` cached in a `Map`, and `clearQueue` swallows a missing store. `PersistedQueryProvider.tsx` lines 78–88 call `clearQueue(prevUid)` when `uid` moves A→B or A→null. `useIsMobile()` (`src/hooks/use-mobile.tsx`) is `window.innerWidth < 768`, read in an effect, and `mockViewport(375)` from `src/test/mobile.ts` makes it true (call before `render`, restore with `mockViewport(1024)` in `afterEach`). `src/test/setup.ts` installs a Map-backed `window.localStorage` and `fake-indexeddb/auto`. jsdom has no `URL.createObjectURL` (tests stub it, as `src/lib/exportCsv.test.ts` does). jsdom's `File` flattens to `{}` under Node's `structuredClone`, so IndexedDB round-trip tests use `File` from `node:buffer` behind a `fileSurvivesClone` guard (copied from `src/lib/offline/queue.test.ts`). `useHints` is `export const useHints = () => useContext(HintsContext)` in `src/hooks/useHints.tsx`; `MyDay.test.tsx` mocks it. `Hint` is `src/components/ui/hint.tsx`. `IssuePriority` is exported from `@/lib/constants`. The Button `default` size is `h-10`, Input `h-10`, SelectTrigger `h-10`, Textarea `min-h-[80px]`; `min-h-11` (44 px) already appears in `QuickCreateMenu.tsx`, so the Tailwind scale has it. The drawer and dialogs sit at `z-50`.

**Controller-only steps:** Task 6 (full gate, manual 375 px check in the browser, push). No migration, no function deploy; the normal Vercel push is the whole deploy.

---

### Task 1: Last-used building and the selection precedence

**Files:**
- Create: `src/lib/lastBuilding.ts`, `src/lib/lastBuilding.test.ts`
- Modify: `src/pages/NewIssue.tsx`, `src/pages/NewIssue.test.tsx`

- [ ] **Step 1: Failing store test**

```ts
// src/lib/lastBuilding.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readLastBuilding, writeLastBuilding } from './lastBuilding';

describe('lastBuilding', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('round-trips per user under fortress.lastBuilding.<uid>', () => {
    expect(readLastBuilding('u1')).toBe('');
    writeLastBuilding('u1', 'b1');
    expect(window.localStorage.getItem('fortress.lastBuilding.u1')).toBe('b1');
    expect(readLastBuilding('u1')).toBe('b1');
    expect(readLastBuilding('u2')).toBe('');
  });

  it('overwrites the previous value', () => {
    writeLastBuilding('u1', 'b1');
    writeLastBuilding('u1', 'b2');
    expect(readLastBuilding('u1')).toBe('b2');
  });

  it('swallows storage failures (private mode, quota, disabled storage)', () => {
    // setup.ts installs a plain-object localStorage, so spying on its methods is enough.
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    expect(() => writeLastBuilding('u1', 'b1')).not.toThrow();
    expect(readLastBuilding('u1')).toBe('');
  });
});
```

Run: `npx vitest run src/lib/lastBuilding.test.ts`
Expected: `FAIL  src/lib/lastBuilding.test.ts` with `Error: Failed to resolve import "./lastBuilding"` — `Test Files  1 failed (1)`.

- [ ] **Step 2: Store**

```ts
// src/lib/lastBuilding.ts
/**
 * The building this user last reported an issue against (spec: field-readiness §8). A caretaker
 * with several buildings usually reports from the one they reported from last, so New Issue
 * pre-selects it when neither the URL nor a single-building roster decides.
 *
 * localStorage, not IndexedDB: one short id, read synchronously so the select never flashes
 * empty. Keyed per user for the same reason as the palette recents — a phone shared between
 * two caretakers must not carry one person's building to the next. Storage failures are
 * swallowed: this is a convenience, never worth an error in the form.
 */
const keyFor = (uid: string) => `fortress.lastBuilding.${uid}`;

export function readLastBuilding(uid: string): string {
  try {
    return window.localStorage.getItem(keyFor(uid)) ?? '';
  } catch {
    return '';
  }
}

export function writeLastBuilding(uid: string, buildingId: string): void {
  try {
    window.localStorage.setItem(keyFor(uid), buildingId);
  } catch {
    // Private mode / quota / storage disabled: remembering is best-effort.
  }
}
```

Run: `npx vitest run src/lib/lastBuilding.test.ts`
Expected: `✓ src/lib/lastBuilding.test.ts (3 tests)` — `Test Files  1 passed (1)`.

- [ ] **Step 3: Failing page tests** — in `src/pages/NewIssue.test.tsx` the buildings mock is a fixed one-building roster. Replace lines 16–18 (the `vi.mock('@/hooks/useBuildings', …)` block) with a controllable one:

```ts
const bld = vi.hoisted(() => ({
  value: [{ id: 'b1', name: 'North Tower' }] as { id: string; name: string }[],
  loading: false,
}));
vi.mock('@/hooks/useBuildings', () => ({
  useBuildings: () => ({ buildings: bld.value, loading: bld.loading }),
}));
```

Replace the `beforeEach` (lines 33–38) with:

```ts
  beforeEach(() => {
    enqueueAndRun.mockReset().mockResolvedValue({ status: 'synced', result: {} });
    navigate.mockClear();
    auth.value = { user: { id: 'u1' }, isAdminOrManager: false };
    bld.value = [{ id: 'b1', name: 'North Tower' }];
    bld.loading = false;
    window.localStorage.clear();
    toast.mockClear(); toast.success.mockClear(); toast.error.mockClear();
  });
```

Add a route-aware render helper directly under the `UUID` constant (line 23):

```ts
const renderAt = (path = '/issues/new') =>
  render(<MemoryRouter initialEntries={[path]}><NewIssue /></MemoryRouter>);

const two = [{ id: 'b1', name: 'North Tower' }, { id: 'b2', name: 'South Wing' }];
```

Append this `describe` inside `describe('NewIssue', …)`, after the `'still goes to the list when the issue is queued…'` test (before the final `});`):

```tsx
  describe('building precedence (spec §8)', () => {
    it('?building= wins over the last-used building', async () => {
      bld.value = two;
      window.localStorage.setItem('fortress.lastBuilding.u1', 'b1');
      renderAt('/issues/new?building=b2');
      await submit();
      expect(enqueueAndRun.mock.calls[0][1].row.building_id).toBe('b2');
    });

    it('a single building is pre-selected', async () => {
      window.localStorage.setItem('fortress.lastBuilding.u1', 'b9');
      renderAt();
      await submit();
      expect(enqueueAndRun.mock.calls[0][1].row.building_id).toBe('b1');
    });

    it('falls back to the last-used building when there are several', async () => {
      bld.value = two;
      window.localStorage.setItem('fortress.lastBuilding.u1', 'b2');
      renderAt();
      await submit();
      expect(enqueueAndRun.mock.calls[0][1].row.building_id).toBe('b2');
    });

    it('ignores a last-used building the user can no longer access', async () => {
      bld.value = two;
      window.localStorage.setItem('fortress.lastBuilding.u1', 'b9');
      renderAt();
      fireEvent.change(screen.getByLabelText(/issue title/i), { target: { value: 'Broken door' } });
      fireEvent.change(screen.getByLabelText(/^description/i), { target: { value: 'Hinge snapped.' } });
      fireEvent.click(screen.getByRole('button', { name: /report issue/i }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Please select a building'));
      expect(enqueueAndRun).not.toHaveBeenCalled();
    });

    it('stays empty when nothing decides', async () => {
      bld.value = two;
      renderAt();
      fireEvent.change(screen.getByLabelText(/issue title/i), { target: { value: 'Broken door' } });
      fireEvent.change(screen.getByLabelText(/^description/i), { target: { value: 'Hinge snapped.' } });
      fireEvent.click(screen.getByRole('button', { name: /report issue/i }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Please select a building'));
      expect(enqueueAndRun).not.toHaveBeenCalled();
    });

    it('remembers the building after a synced submit and after a queued one', async () => {
      const { unmount } = renderAt();
      await submit();
      expect(window.localStorage.getItem('fortress.lastBuilding.u1')).toBe('b1');
      unmount();

      window.localStorage.clear();
      enqueueAndRun.mockReset().mockResolvedValueOnce({ status: 'queued' });
      renderAt();
      await submit();
      expect(window.localStorage.getItem('fortress.lastBuilding.u1')).toBe('b1');
    });

    it('does not remember the building when the submit is rejected', async () => {
      enqueueAndRun.mockReset().mockResolvedValueOnce({ status: 'failed', error: 'permission denied' });
      renderAt();
      await submit();
      expect(window.localStorage.getItem('fortress.lastBuilding.u1')).toBeNull();
    });
  });
```

Run: `npx vitest run src/pages/NewIssue.test.tsx`
Expected: `Tests  2 failed | 10 passed (12)`. Exactly two fail: `falls back to the last-used building when there are several` (the page has no last-used rule yet, so the building is empty, the toast fires and `submit()`'s `waitFor` times out) and `remembers the building after a synced submit and after a queued one` (`expected null to be 'b1'`). The other five new tests already hold with today's code (`?building=` and the single-building rule exist; nothing is remembered), and the five existing tests stay green.

- [ ] **Step 4: Precedence effect and the write on submit** — in `src/pages/NewIssue.tsx`:

Add the import after line 26 (`import { parseCost } from '@/lib/money';`):

```ts
import { readLastBuilding, writeLastBuilding } from '@/lib/lastBuilding';
```

Change the building state (line 37) so the URL is read by the effect, not the initialiser (the effect must also be able to re-derive after a draft is discarded in Task 3):

```ts
  const [buildingId, setBuildingId] = useState('');
```

Replace the single-building effect (lines 47–52) with:

```ts
  // Building precedence (spec §8): ?building= → the user's only building → the building they
  // last reported from → empty. Decided once the roster has loaded and only while nothing is
  // chosen, so a roster refetch never overrides what the user picked. A remembered building the
  // user can no longer access (revoked, removed) is ignored rather than submitted blind.
  useEffect(() => {
    if (buildingsLoading || buildingId) return;
    const fromUrl = searchParams.get('building');
    if (fromUrl) { setBuildingId(fromUrl); return; }
    if (buildings.length === 1) { setBuildingId(buildings[0].id); return; }
    if (!user) return;
    const last = readLastBuilding(user.id);
    if (last && buildings.some((b) => b.id === last)) setBuildingId(last);
  }, [buildings, buildingsLoading, buildingId, searchParams, user]);
```

Replace the navigate block inside `handleSubmit` (lines 112–115) with:

```ts
      // A queued issue already shows on the list with a "Queued" chip, so leave the form either
      // way; both outcomes mean the building was a real choice worth remembering next time.
      if (outcome.status !== 'failed') {
        writeLastBuilding(user.id, buildingId);
        navigate('/issues');
      }
```

Run: `npx vitest run src/pages/NewIssue.test.tsx src/lib/lastBuilding.test.ts`
Expected: `Test Files  2 passed (2)` — `Tests  15 passed (15)`.

- [ ] **Step 5: gate, tests, commit** — `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E 'lastBuilding|NewIssue'` prints nothing; `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c 'error TS'` ≤ 46; then `git add src/lib/lastBuilding.ts src/lib/lastBuilding.test.ts src/pages/NewIssue.tsx src/pages/NewIssue.test.tsx && git commit -m "New Issue pre-selects the building: URL, only building, then last used per user"` (blank line, then the `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` trailer).

---

### Task 2: Draft store

**Files:**
- Create: `src/lib/offline/drafts.ts`, `src/lib/offline/drafts.test.ts`
- Modify: `src/components/PersistedQueryProvider.tsx`, `src/components/PersistedQueryProvider.test.tsx`

- [ ] **Step 1: Failing store test**

```ts
// src/lib/offline/drafts.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { File as NodeFile } from 'node:buffer';
import { saveIssueDraft, readIssueDraft, clearIssueDraft, clearDraftStore, draftStoreName, type IssueDraft } from './drafts';

// Same guard as queue.test.ts: fake-indexeddb clones with Node's structuredClone, which flattens
// jsdom's pure-JS File to {} and, on Node 20/22, drops a node:buffer File's name. Browsers always
// carry File through IndexedDB; this protects the test double only.
const fileSurvivesClone = (() => {
  try {
    const f = new NodeFile(['x'], 'p.jpg', { type: 'image/jpeg' });
    return structuredClone(f)?.name === 'p.jpg';
  } catch {
    return false;
  }
})();

const draft: IssueDraft = {
  title: 'Lift out of service',
  description: 'Lift 2 stuck on ground floor.',
  buildingId: 'b1',
  priority: 'high',
  photos: [],
  savedAt: 1_757_000_000_000,
};

describe('issue draft store', () => {
  beforeEach(async () => { await clearDraftStore('u1'); await clearDraftStore('u2'); });

  it('reads null before anything is saved', async () => {
    expect(await readIssueDraft('u1')).toBeNull();
  });

  it('round-trips one draft per user and clears it', async () => {
    await saveIssueDraft('u1', draft);
    expect(await readIssueDraft('u1')).toEqual(draft);
    expect(await readIssueDraft('u2')).toBeNull();
    await clearIssueDraft('u1');
    expect(await readIssueDraft('u1')).toBeNull();
  });

  it('overwrites rather than accumulates', async () => {
    await saveIssueDraft('u1', draft);
    await saveIssueDraft('u1', { ...draft, title: 'Lift back in service', savedAt: draft.savedAt + 1 });
    expect((await readIssueDraft('u1'))?.title).toBe('Lift back in service');
  });

  it.skipIf(!fileSurvivesClone)('keeps the photo files with their name, type and size', async () => {
    const file = new NodeFile(['abc'], 'fault.jpg', { type: 'image/jpeg' }) as unknown as File;
    await saveIssueDraft('u1', { ...draft, photos: [file] });
    const back = await readIssueDraft('u1');
    expect(back?.photos).toHaveLength(1);
    expect(back!.photos[0]).toMatchObject({ name: 'fault.jpg', type: 'image/jpeg', size: 3 });
    expect(await back!.photos[0].text()).toBe('abc');
  });

  it('clearDraftStore empties that user only, and tolerates a store that was never created', async () => {
    await saveIssueDraft('u1', draft);
    await saveIssueDraft('u2', draft);
    await clearDraftStore('u1');
    await expect(clearDraftStore('never-seen')).resolves.toBeUndefined();
    expect(await readIssueDraft('u1')).toBeNull();
    expect(await readIssueDraft('u2')).toEqual(draft);
  });

  it('names the store per user', () => {
    expect(draftStoreName('u1')).toBe('bo-drafts-u1');
  });
});
```

Run: `npx vitest run src/lib/offline/drafts.test.ts`
Expected: `FAIL` with `Error: Failed to resolve import "./drafts"`.

- [ ] **Step 2: Store**

```ts
// src/lib/offline/drafts.ts
/**
 * A New Issue form half-filled on a phone must survive the camera: iOS evicts a background tab
 * freely, and the user comes back to a reloaded page with an empty form and no photo. This is
 * one record per user in its own idb-keyval store — `bo-drafts-<uid>`, built the same way as
 * the write queue's `bo-queue-<uid>` — holding the fields and the already-processed JPEG Files
 * (structured clone keeps them, exactly as the queue relies on).
 *
 * Keyed per user and cleared with the queue on user change (PersistedQueryProvider): a phone
 * shared between two caretakers must never show one person's half-written report to the next.
 * Reads never throw — an unreadable store just means the form starts empty.
 */
import { createStore, get, set, del, clear, type UseStore } from 'idb-keyval';
import type { IssuePriority } from '@/lib/constants';

export interface IssueDraft {
  title: string;
  description: string;
  buildingId: string;
  priority: IssuePriority;
  /** Compressed JPEGs as PhotoCapture produced them; previews are recreated on restore. */
  photos: File[];
  savedAt: number;
}

export const draftStoreName = (uid: string) => `bo-drafts-${uid}`;
/** One draft per user today; the key leaves room for other forms later without a new store. */
const ISSUE_KEY = 'issue';

const stores = new Map<string, UseStore>();
function storeFor(uid: string): UseStore {
  let s = stores.get(uid);
  if (!s) { s = createStore(draftStoreName(uid), 'drafts'); stores.set(uid, s); }
  return s;
}

export async function saveIssueDraft(uid: string, draft: IssueDraft): Promise<void> {
  await set(ISSUE_KEY, draft, storeFor(uid));
}

export async function readIssueDraft(uid: string): Promise<IssueDraft | null> {
  try {
    return (await get<IssueDraft>(ISSUE_KEY, storeFor(uid))) ?? null;
  } catch {
    return null;
  }
}

export async function clearIssueDraft(uid: string): Promise<void> {
  try { await del(ISSUE_KEY, storeFor(uid)); } catch { /* store never created */ }
}

/** Every draft this user left on the device. Called next to clearQueue on user change. */
export async function clearDraftStore(uid: string): Promise<void> {
  try { await clear(storeFor(uid)); } catch { /* store never created */ }
}
```

Run: `npx vitest run src/lib/offline/drafts.test.ts`
Expected: `✓ src/lib/offline/drafts.test.ts (6 tests)` (the File test may report `skipped` on Node 20/22 — the same as `queue.test.ts` — and `passed` on Node 26).

- [ ] **Step 3: Failing provider test** — in `src/components/PersistedQueryProvider.test.tsx`:

Add the import after line 8 (`import { clearQueue, enqueue, listOps } from '@/lib/offline/queue';`):

```ts
import { clearDraftStore, readIssueDraft, saveIssueDraft } from '@/lib/offline/drafts';
```

Extend the `afterEach` (lines 95–102) so it reads:

```ts
  afterEach(async () => {
    stopPersisting();
    queryClient.clear();
    await clearIdb();
    // The write queue and the draft store live in their own per-user stores, which clearIdb()
    // (default store) misses.
    await clearQueue('A');
    await clearQueue('B');
    await clearDraftStore('A');
    await clearDraftStore('B');
  });
```

Replace the test `'an implicit user switch also drops the outgoing user\'s offline write queue'` (from its `it(` line through its closing `});`) with:

```ts
  it('an implicit user switch also drops the outgoing user\'s offline write queue and issue draft', async () => {
    // A's unsynced writes must not survive on a shared device to replay under B's session, and
    // A's half-written issue must not be offered to B.
    await enqueue('A', { kind: 'task_complete', completionId: 'c1', taskInstanceId: 't1', taskName: 'Check', notes: null, signatureConfirmed: false }, []);
    await saveIssueDraft('A', { title: 'Lift', description: '', buildingId: 'b1', priority: 'medium', photos: [], savedAt: 1 });
    expect(await listOps('A')).toHaveLength(1);
    expect(await readIssueDraft('A')).not.toBeNull();

    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('success:A'));
    expect(await listOps('A')).toHaveLength(1); // mounting as A keeps A's queue
    expect(await readIssueDraft('A')).not.toBeNull(); // and A's draft

    act(() => {
      auth.callback!('SIGNED_IN', { user: { id: 'B' } });
      setProbeUid('B');
    });

    await waitFor(async () => expect(await listOps('A')).toEqual([]));
    await waitFor(async () => expect(await readIssueDraft('A')).toBeNull());
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('success:B'));
  });
```

Run: `npx vitest run src/components/PersistedQueryProvider.test.tsx`
Expected: that one test fails at `expect(await readIssueDraft('A')).toBeNull()` — `expected { title: 'Lift', … } to be null` (waitFor times out); the other tests pass.

- [ ] **Step 4: Clear the draft store with the queue** — in `src/components/PersistedQueryProvider.tsx`:

Add after line 6 (`import { clearQueue } from '@/lib/offline/queue';`):

```ts
import { clearDraftStore } from '@/lib/offline/drafts';
```

Replace lines 78–86 (the `if (prevUid && prevUid !== uid) { … }` block) with:

```ts
    if (prevUid && prevUid !== uid) {
      // Someone else (or nobody) now owns this tab. Stop first so clear() cannot be
      // persisted, then drop the previous user's rows from memory and disk — read cache,
      // write queue AND issue draft, so A's unsynced ops cannot replay under B's session
      // and A's half-written issue is never offered to B.
      stopPersisting();
      queryClient.clear();
      void clearPersistedCache(prevUid);
      void clearQueue(prevUid);
      void clearDraftStore(prevUid);
    }
```

In the docblock, extend the sentence that ends `so on a shared device they can never replay under B.` (line 42) to: `so on a shared device they can never replay under B. The issue draft store (\`bo-drafts-A\`) goes the same way.`

Run: `npx vitest run src/components/PersistedQueryProvider.test.tsx src/lib/offline/drafts.test.ts`
Expected: `Test Files  2 passed (2)`.

- [ ] **Step 5: gate, tests, commit** — `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E 'drafts|PersistedQueryProvider'` prints nothing; global count ≤ 46; `git add src/lib/offline/drafts.ts src/lib/offline/drafts.test.ts src/components/PersistedQueryProvider.tsx src/components/PersistedQueryProvider.test.tsx && git commit -m "Issue draft store: per-user IndexedDB record with photos, dropped with the queue on user change"` (+ trailer).

---

### Task 3: `useIssueDraft` and the restore / save / discard flow

**Files:**
- Create: `src/hooks/useIssueDraft.ts`, `src/hooks/useIssueDraft.test.ts`
- Modify: `src/pages/NewIssue.tsx`, `src/pages/NewIssue.test.tsx`

- [ ] **Step 1: Failing hook test** — the store is mocked here so the debounce can run under fake timers without fake-indexeddb (which schedules on `setImmediate`) in the loop; the store's own behaviour is Task 2's test.

```ts
// src/hooks/useIssueDraft.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { IssueDraft } from '@/lib/offline/drafts';

const store = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), clear: vi.fn() }));
vi.mock('@/lib/offline/drafts', () => ({
  readIssueDraft: store.read,
  saveIssueDraft: store.save,
  clearIssueDraft: store.clear,
}));

import { useIssueDraft, DRAFT_DEBOUNCE_MS } from './useIssueDraft';

const saved: IssueDraft = { title: 'Lift', description: 'Stuck', buildingId: 'b1', priority: 'high', photos: [], savedAt: 1 };
const input = { title: 'Lift', description: 'Stuck', buildingId: 'b1', priority: 'high' as const, photos: [] as File[] };

describe('useIssueDraft', () => {
  beforeEach(() => {
    store.read.mockReset().mockResolvedValue(null);
    store.save.mockReset().mockResolvedValue(undefined);
    store.clear.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it('is not ready until the store has been read, then hands back what it holds', async () => {
    store.read.mockResolvedValue(saved);
    const { result } = renderHook(() => useIssueDraft('u1'));
    expect(result.current.ready).toBe(false);
    expect(result.current.restored).toBeNull();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.restored).toEqual(saved);
    expect(store.read).toHaveBeenCalledWith('u1');
  });

  it('is ready with nothing to restore when there is no user', async () => {
    const { result } = renderHook(() => useIssueDraft(undefined));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.restored).toBeNull();
    act(() => { result.current.save(input); result.current.clear(); });
    expect(store.read).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
    expect(store.clear).not.toHaveBeenCalled();
  });

  it('debounces saves by 400 ms and writes only the last value, stamped', async () => {
    const { result } = renderHook(() => useIssueDraft('u1'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    vi.useFakeTimers();
    act(() => { result.current.save(input); });
    act(() => { vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS - 1); });
    act(() => { result.current.save({ ...input, title: 'Lift 2' }); });
    act(() => { vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS - 1); });
    expect(store.save).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(store.save).toHaveBeenCalledWith('u1', expect.objectContaining({ ...input, title: 'Lift 2', savedAt: expect.any(Number) }));
  });

  it('clear() cancels a pending save and deletes the draft', async () => {
    const { result } = renderHook(() => useIssueDraft('u1'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    vi.useFakeTimers();
    act(() => { result.current.save(input); });
    act(() => { result.current.clear(); });
    act(() => { vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS * 2); });
    expect(store.save).not.toHaveBeenCalled();
    expect(store.clear).toHaveBeenCalledWith('u1');
  });

  it('flushes a pending save on unmount so leaving the page keeps the last keystrokes', async () => {
    const { result, unmount } = renderHook(() => useIssueDraft('u1'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    vi.useFakeTimers();
    act(() => { result.current.save(input); });
    unmount();
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(store.save).toHaveBeenCalledWith('u1', expect.objectContaining(input));
    act(() => { vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS * 2); });
    expect(store.save).toHaveBeenCalledTimes(1);
  });

  it('a save that fails (quota, private mode) is swallowed', async () => {
    store.save.mockRejectedValue(new Error('QuotaExceededError'));
    const { result } = renderHook(() => useIssueDraft('u1'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    vi.useFakeTimers();
    act(() => { result.current.save(input); });
    await act(async () => { vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS); await Promise.resolve(); });
    expect(store.save).toHaveBeenCalledTimes(1);
  });
});
```

Run: `npx vitest run src/hooks/useIssueDraft.test.ts`
Expected: `FAIL` with `Error: Failed to resolve import "./useIssueDraft"`.

- [ ] **Step 2: Hook**

```ts
// src/hooks/useIssueDraft.ts
/**
 * The New Issue form's draft (spec: field-readiness §8). Reads the user's draft once on mount,
 * debounces saves so typing does not hammer IndexedDB, flushes a pending save when the page
 * unmounts (leaving for the camera or the list must not lose the last keystrokes), and cancels
 * the pending save on clear() so a submit or discard can never be overwritten by a stale timer.
 *
 * `restored` is what the store held at mount and never changes afterwards; the page applies it
 * once. `ready` gates the page's own save effect: saving before the read settles would
 * overwrite the draft with an empty form.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { clearIssueDraft, readIssueDraft, saveIssueDraft, type IssueDraft } from '@/lib/offline/drafts';

export const DRAFT_DEBOUNCE_MS = 400;

export type IssueDraftInput = Omit<IssueDraft, 'savedAt'>;

export interface UseIssueDraft {
  restored: IssueDraft | null;
  ready: boolean;
  save: (draft: IssueDraftInput) => void;
  clear: () => void;
}

export function useIssueDraft(uid: string | undefined): UseIssueDraft {
  const [restored, setRestored] = useState<IssueDraft | null>(null);
  const [ready, setReady] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<IssueDraftInput | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setRestored(null);
    if (!uid) { setReady(true); return; }
    void readIssueDraft(uid).then((draft) => {
      if (cancelled) return;
      setRestored(draft);
      setReady(true);
    });
    return () => { cancelled = true; };
  }, [uid]);

  const write = useCallback((draft: IssueDraftInput) => {
    if (!uid) return;
    void saveIssueDraft(uid, { ...draft, savedAt: Date.now() }).catch(() => {
      // Quota / private mode: the draft is a convenience, never worth an error in the form.
    });
  }, [uid]);

  const save = useCallback((draft: IssueDraftInput) => {
    if (!uid) return;
    pending.current = draft;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const next = pending.current;
      pending.current = null;
      if (next) write(next);
    }, DRAFT_DEBOUNCE_MS);
  }, [uid, write]);

  const clear = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    pending.current = null;
    if (uid) void clearIssueDraft(uid);
  }, [uid]);

  // Flush on unmount: a draft is meant to outlive the page. clear() has already emptied
  // `pending`, so a submitted or discarded form is never resurrected here.
  useEffect(() => () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const next = pending.current;
    pending.current = null;
    if (next) write(next);
  }, [write]);

  return { restored, ready, save, clear };
}
```

Run: `npx vitest run src/hooks/useIssueDraft.test.ts`
Expected: `✓ src/hooks/useIssueDraft.test.ts (6 tests)`.

- [ ] **Step 3: Failing page tests** — in `src/pages/NewIssue.test.tsx`:

Replace the `PhotoCapture` mock (line 19, `vi.mock('@/components/ui/photo-capture', () => ({ PhotoCapture: () => null }));`) with one that exposes the photo count, and add the draft hook mock and the object-URL stubs under it:

```tsx
vi.mock('@/components/ui/photo-capture', () => ({
  PhotoCapture: ({ photos }: { photos: unknown[] }) => <div data-testid="photo-capture">{photos.length}</div>,
}));
const draft = vi.hoisted(() => ({
  restored: null as null | { title: string; description: string; buildingId: string; priority: 'low' | 'medium' | 'high' | 'critical'; photos: File[]; savedAt: number },
  ready: true,
  save: vi.fn(),
  clear: vi.fn(),
}));
vi.mock('@/hooks/useIssueDraft', () => ({ useIssueDraft: () => draft }));
// jsdom has no object URLs; restoring a draft recreates previews through them.
const createObjectURL = vi.hoisted(() => vi.fn((_file: Blob) => 'blob:fake'));
const revokeObjectURL = vi.hoisted(() => vi.fn());
Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: createObjectURL });
Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revokeObjectURL });
```

Add to the `beforeEach`, after `window.localStorage.clear();`:

```ts
    draft.restored = null;
    draft.ready = true;
    draft.save.mockClear();
    draft.clear.mockClear();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
```

Append inside `describe('NewIssue', …)` after the building-precedence `describe`:

```tsx
  describe('draft (spec §8)', () => {
    const photo = new File(['x'], 'fault.jpg', { type: 'image/jpeg' });
    const stored = { title: 'Lift', description: 'Stuck on 3', buildingId: 'b2', priority: 'high' as const, photos: [photo], savedAt: 1 };

    it('restores the fields and photos and shows the guardrail bar', async () => {
      bld.value = two;
      draft.restored = stored;
      renderAt();
      expect(screen.getByLabelText(/issue title/i)).toHaveValue('Lift');
      expect(screen.getByLabelText(/^description/i)).toHaveValue('Stuck on 3');
      expect(screen.getByTestId('photo-capture')).toHaveTextContent('1');
      expect(createObjectURL).toHaveBeenCalledWith(photo);
      expect(screen.getByRole('status')).toHaveTextContent('Draft restored');
      fireEvent.click(screen.getByRole('button', { name: /report issue/i }));
      await waitFor(() => expect(enqueueAndRun).toHaveBeenCalledTimes(1));
      const [, payload, photos] = enqueueAndRun.mock.calls[0];
      expect(payload.row).toMatchObject({ title: 'Lift', description: 'Stuck on 3', building_id: 'b2', priority: 'high' });
      expect(photos).toEqual([{ file: photo }]);
    });

    it('a draft without a building leaves the precedence choice alone', async () => {
      draft.restored = { ...stored, buildingId: '' };
      renderAt();
      fireEvent.click(screen.getByRole('button', { name: /report issue/i }));
      await waitFor(() => expect(enqueueAndRun).toHaveBeenCalledTimes(1));
      expect(enqueueAndRun.mock.calls[0][1].row.building_id).toBe('b1');
    });

    it('does not restore or show the bar while the store is still being read', () => {
      draft.restored = stored;
      draft.ready = false;
      renderAt();
      expect(screen.getByLabelText(/issue title/i)).toHaveValue('');
      expect(screen.queryByRole('status')).toBeNull();
    });

    it('saves on every change once ready', async () => {
      renderAt();
      fireEvent.change(screen.getByLabelText(/issue title/i), { target: { value: 'Broken door' } });
      await waitFor(() => expect(draft.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ title: 'Broken door', description: '', buildingId: 'b1', priority: 'medium', photos: [] }),
      ));
      expect(draft.clear).not.toHaveBeenCalled();
    });

    it('an empty form is never saved as a draft', async () => {
      renderAt();
      await new Promise((r) => setTimeout(r, 0));
      expect(draft.save).not.toHaveBeenCalled();
    });

    it('Discard empties the form, revokes the previews and clears the store', async () => {
      bld.value = two;
      draft.restored = stored;
      renderAt();
      // The restore itself is content, so the page has already saved it once; Discard must
      // not save again.
      const savesBefore = draft.save.mock.calls.length;
      fireEvent.click(screen.getByRole('button', { name: /discard/i }));
      expect(screen.getByLabelText(/issue title/i)).toHaveValue('');
      expect(screen.getByLabelText(/^description/i)).toHaveValue('');
      expect(screen.getByTestId('photo-capture')).toHaveTextContent('0');
      expect(screen.queryByRole('status')).toBeNull();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');
      expect(draft.clear).toHaveBeenCalledTimes(1);
      await new Promise((r) => setTimeout(r, 0));
      expect(draft.save).toHaveBeenCalledTimes(savesBefore);
    });

    it('a successful or queued submit clears the draft; a rejected one keeps it', async () => {
      const first = renderAt();
      await submit();
      expect(draft.clear).toHaveBeenCalledTimes(1);
      expect(draft.clear.mock.invocationCallOrder[0]).toBeGreaterThan(enqueueAndRun.mock.invocationCallOrder[0]);
      first.unmount();

      draft.clear.mockClear();
      enqueueAndRun.mockReset().mockResolvedValueOnce({ status: 'queued' });
      const second = renderAt();
      await submit();
      expect(draft.clear).toHaveBeenCalledTimes(1);
      second.unmount();

      draft.clear.mockClear();
      enqueueAndRun.mockReset().mockResolvedValueOnce({ status: 'failed', error: 'permission denied' });
      renderAt();
      await submit();
      expect(draft.clear).not.toHaveBeenCalled();
    });
  });
```

Run: `npx vitest run src/pages/NewIssue.test.tsx`
Expected: `Tests  5 failed | 14 passed (19)`. The five that need the integration fail — `restores the fields…` (`Unable to find an accessible element with the role "status"`), `a draft without a building…` (`waitFor` times out: nothing is enqueued because the title is empty), `saves on every change…`, `Discard…` (`Unable to find … name /discard/i`), `a successful or queued submit clears…` (`expected "spy" to be called 1 times`). `does not restore … while the store is still being read` and `an empty form is never saved` hold trivially today; the 12 earlier tests stay green.

- [ ] **Step 4: Page integration** — in `src/pages/NewIssue.tsx`:

Change line 1 to:

```ts
import { useState, useEffect, useRef } from 'react';
```

Add after the `lastBuilding` import:

```ts
import { useIssueDraft } from '@/hooks/useIssueDraft';
```

Add after `const [submitting, setSubmitting] = useState(false);`:

```ts
  // Draft (spec §8): the form must survive the camera app and a reload. `hydrated` is set once
  // the read has settled and any draft has been applied; the save effect waits for it so the
  // empty first render never overwrites what the store holds.
  const { restored, ready: draftReady, save: saveDraft, clear: clearDraft } = useIssueDraft(user?.id);
  const [hydrated, setHydrated] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const hadContent = useRef(false);
```

Add after the building-precedence effect (order matters: the precedence effect runs first, then a draft with a building overrides it — the draft is the user's later, explicit choice):

```ts
  useEffect(() => {
    if (!draftReady || hydrated) return;
    if (restored) {
      setTitle(restored.title);
      setDescription(restored.description);
      if (restored.buildingId) setBuildingId(restored.buildingId);
      setPriority(restored.priority);
      setPhotos(restored.photos.map((file) => ({ file, preview: URL.createObjectURL(file) })));
      setDraftRestored(true);
    }
    setHydrated(true);
  }, [draftReady, hydrated, restored]);

  // Save on every change. Building and priority alone are not a draft (they are derived or
  // defaults), so a form the user has typed nothing into is never stored — and a form they
  // emptied again is cleared rather than kept as a blank record.
  useEffect(() => {
    if (!hydrated) return;
    const hasContent = title.trim() !== '' || description.trim() !== '' || photos.length > 0;
    if (hasContent) {
      hadContent.current = true;
      saveDraft({ title, description, buildingId, priority, photos: photos.map((p) => p.file) });
    } else if (hadContent.current) {
      hadContent.current = false;
      clearDraft();
    }
  }, [hydrated, title, description, buildingId, priority, photos, saveDraft, clearDraft]);

  const discardDraft = () => {
    for (const p of photos) URL.revokeObjectURL(p.preview);
    hadContent.current = false;
    clearDraft();
    setTitle('');
    setDescription('');
    setPriority('medium');
    setPhotos([]);
    // The building goes back through the precedence rule (URL, only building, last used).
    setBuildingId('');
    setDraftRestored(false);
  };
```

In `handleSubmit`, change the non-failed block to clear the draft before leaving:

```ts
      if (outcome.status !== 'failed') {
        writeLastBuilding(user.id, buildingId);
        clearDraft();
        navigate('/issues');
      }
```

In the JSX, insert the guardrail bar between the header `</div>` (line 144) and `<form onSubmit={handleSubmit}>` — plain text, not a `<Hint>`, because a data-loss cue must show with hints off:

```tsx
      {draftRestored && (
        <div
          role="status"
          className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-sm"
        >
          <span>Draft restored</span>
          <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-9" onClick={discardDraft} disabled={submitting}>
            Discard
          </Button>
        </div>
      )}
```

Run: `npx vitest run src/pages/NewIssue.test.tsx src/hooks/useIssueDraft.test.ts`
Expected: `Test Files  2 passed (2)` — `Tests  25 passed (25)` (19 page + 6 hook).

- [ ] **Step 5: gate, tests, commit** — `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E 'useIssueDraft|NewIssue'` prints nothing; global count ≤ 46; `git add src/hooks/useIssueDraft.ts src/hooks/useIssueDraft.test.ts src/pages/NewIssue.tsx src/pages/NewIssue.test.tsx && git commit -m "New Issue keeps a draft across the camera and reloads, with a plain Draft restored bar"` (+ trailer).

---

### Task 4: Phone layout — photo first, 44 px controls, fixed action bar, one hint

**Files:**
- Modify: `src/pages/NewIssue.tsx`, `src/pages/NewIssue.test.tsx`

- [ ] **Step 1: Failing tests** — in `src/pages/NewIssue.test.tsx`:

Add the imports after line 3 (`import { MemoryRouter } from 'react-router-dom';`):

```ts
import { mockViewport } from '@/test/mobile';
```

Change the first line to also import `afterEach`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
```

Add the hints mock after the `useIssueDraft` mock (the page's hint goes through `useHints`, which reaches for the Supabase client; `MyDay.test.tsx` mocks it the same way):

```ts
const hints = vi.hoisted(() => ({ enabled: true }));
vi.mock('@/hooks/useHints', () => ({
  useHints: () => ({ hintsEnabled: hints.enabled, setHintsEnabled: vi.fn() }),
}));
```

Add inside `describe('NewIssue', …)` directly after the `beforeEach`:

```ts
  afterEach(() => { mockViewport(1024); hints.enabled = true; });
```

Append inside `describe('NewIssue', …)` after the draft `describe`:

```tsx
  describe('phone layout (spec §8)', () => {
    // jsdom has no layout engine: every scrollWidth/clientWidth is 0 and Tailwind's CSS is not
    // compiled into the test DOM, so "scrollWidth <= 375" would pass vacuously. What the test
    // CAN observe is the decision the page makes from the viewport — the class list — so that
    // is what it asserts. The real no-horizontal-scroll check is the browser step in Task 6.
    it('pins the action bar to the bottom on a phone and leaves it inline on a desktop', () => {
      mockViewport(375);
      const { unmount } = renderAt();
      const bar = screen.getByTestId('issue-actions');
      expect(bar.className).toMatch(/\bfixed\b/);
      expect(bar.className).toMatch(/safe-area-inset-bottom/);
      expect(bar.className).toMatch(/\bbottom-0\b/);
      unmount();

      mockViewport(1024);
      renderAt();
      expect(screen.getByTestId('issue-actions').className).not.toMatch(/\bfixed\b/);
    });

    it('puts the photo control directly under the building select, before the title', () => {
      renderAt();
      const building = screen.getByLabelText(/building/i);
      const photos = screen.getByTestId('photo-capture');
      const title = screen.getByLabelText(/issue title/i);
      expect(building.compareDocumentPosition(photos) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(photos.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('gives every control a 44 px minimum below sm', () => {
      auth.value = { user: { id: 'u1' }, isAdminOrManager: true };
      renderAt();
      for (const el of [
        screen.getByLabelText(/building/i),
        screen.getByLabelText(/issue title/i),
        screen.getByLabelText(/priority/i),
        screen.getByLabelText(/resolution deadline/i),
        screen.getByLabelText(/estimated cost/i),
        screen.getByRole('button', { name: /report issue/i }),
        screen.getByRole('button', { name: /cancel/i }),
      ]) {
        expect(el.className).toMatch(/\bmin-h-11\b/);
      }
    });

    it('routes the photo coaching line through the hints toggle', () => {
      const line = 'One clear photo of the fault is worth more than a paragraph.';
      const { unmount } = renderAt();
      expect(screen.getByText(line)).toBeInTheDocument();
      unmount();
      hints.enabled = false;
      renderAt();
      expect(screen.queryByText(line)).toBeNull();
    });
  });
```

Run: `npx vitest run src/pages/NewIssue.test.tsx`
Expected: `Tests  4 failed | 19 passed (23)` — the four layout tests fail (`Unable to find an element by: [data-testid="issue-actions"]`, the order assertion `expected 0 to be truthy` because today the photo control sits after the title, `expected 'flex h-10 …' to match /\bmin-h-11\b/`, `Unable to find an element with the text: One clear photo…`); the 19 earlier tests pass.

- [ ] **Step 2: Layout** — replace `src/pages/NewIssue.tsx` in full with the file below. Logic is unchanged from Task 3; only the imports (`Hint`, `useIsMobile`, `cn`), the field order, the classes, the bar and the hint are new.

```tsx
import { useState, useEffect, useRef } from 'react';
import { formatBuildingName } from '@/lib/buildingName';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useBuildings } from '@/hooks/useBuildings';
import { useIsMobile } from '@/hooks/use-mobile';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Hint } from '@/components/ui/hint';
import { AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react';
import { PRIORITY_OPTIONS } from '@/lib/constants';
import type { IssuePriority } from '@/lib/constants';
import { PageLoading } from '@/components/ui/loading-spinner';
import { PhotoCapture, type PhotoFile } from '@/components/ui/photo-capture';
import { enqueueAndRun } from '@/lib/offline/enqueueAndRun';
import { toastForOutcome } from '@/lib/offline/outcomeToast';
import { toast } from 'sonner';
import { parseCost } from '@/lib/money';
import { readLastBuilding, writeLastBuilding } from '@/lib/lastBuilding';
import { useIssueDraft } from '@/hooks/useIssueDraft';
import { cn } from '@/lib/utils';

/** 44 px tap target on phones (spec §8), the shared component's 40 px from `sm` up. */
const CONTROL = 'min-h-11 sm:min-h-10';

export default function NewIssue() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, isAdminOrManager } = useAuth();
  const { buildings, loading: buildingsLoading } = useBuildings();
  // The app's phone test (same breakpoint as ResponsiveDialog). The action bar is pinned by
  // this decision rather than a CSS-only class so a test can observe it; the heights above use
  // plain responsive classes.
  const isMobile = useIsMobile();

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [buildingId, setBuildingId] = useState('');
  const [priority, setPriority] = useState<IssuePriority>('medium');
  const [deadline, setDeadline] = useState('');
  const [correctiveAction, setCorrectiveAction] = useState('');
  const [photos, setPhotos] = useState<PhotoFile[]>([]);
  // Admin/manager only (spec §8): a rough estimate at logging time; the actual cost is
  // entered on the issue when the work is done.
  const [estimatedCost, setEstimatedCost] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Draft (spec §8): the form must survive the camera app and a reload. `hydrated` is set once
  // the read has settled and any draft has been applied; the save effect waits for it so the
  // empty first render never overwrites what the store holds.
  const { restored, ready: draftReady, save: saveDraft, clear: clearDraft } = useIssueDraft(user?.id);
  const [hydrated, setHydrated] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const hadContent = useRef(false);

  // Building precedence (spec §8): ?building= → the user's only building → the building they
  // last reported from → empty. Decided once the roster has loaded and only while nothing is
  // chosen, so a roster refetch never overrides what the user picked. A remembered building the
  // user can no longer access (revoked, removed) is ignored rather than submitted blind.
  useEffect(() => {
    if (buildingsLoading || buildingId) return;
    const fromUrl = searchParams.get('building');
    if (fromUrl) { setBuildingId(fromUrl); return; }
    if (buildings.length === 1) { setBuildingId(buildings[0].id); return; }
    if (!user) return;
    const last = readLastBuilding(user.id);
    if (last && buildings.some((b) => b.id === last)) setBuildingId(last);
  }, [buildings, buildingsLoading, buildingId, searchParams, user]);

  useEffect(() => {
    if (!draftReady || hydrated) return;
    if (restored) {
      setTitle(restored.title);
      setDescription(restored.description);
      if (restored.buildingId) setBuildingId(restored.buildingId);
      setPriority(restored.priority);
      setPhotos(restored.photos.map((file) => ({ file, preview: URL.createObjectURL(file) })));
      setDraftRestored(true);
    }
    setHydrated(true);
  }, [draftReady, hydrated, restored]);

  // Save on every change. Building and priority alone are not a draft (they are derived or
  // defaults), so a form the user has typed nothing into is never stored — and a form they
  // emptied again is cleared rather than kept as a blank record.
  useEffect(() => {
    if (!hydrated) return;
    const hasContent = title.trim() !== '' || description.trim() !== '' || photos.length > 0;
    if (hasContent) {
      hadContent.current = true;
      saveDraft({ title, description, buildingId, priority, photos: photos.map((p) => p.file) });
    } else if (hadContent.current) {
      hadContent.current = false;
      clearDraft();
    }
  }, [hydrated, title, description, buildingId, priority, photos, saveDraft, clearDraft]);

  const discardDraft = () => {
    for (const p of photos) URL.revokeObjectURL(p.preview);
    hadContent.current = false;
    clearDraft();
    setTitle('');
    setDescription('');
    setPriority('medium');
    setPhotos([]);
    // The building goes back through the precedence rule (URL, only building, last used).
    setBuildingId('');
    setDraftRestored(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      toast.error('Please enter an issue title');
      return;
    }

    if (!buildingId) {
      toast.error('Please select a building');
      return;
    }

    if (!description.trim()) {
      toast.error('Please enter a description');
      return;
    }

    if (!user) {
      toast.error('You must be logged in to report an issue');
      return;
    }

    const estimate = isAdminOrManager ? parseCost(estimatedCost) : null;
    if (estimate === undefined) {
      toast.error('Estimated cost must be an amount of R 0 or more');
      return;
    }

    setSubmitting(true);

    try {
      // The insert and its photo upload run in the offline queue handler, now (online) or on
      // replay (offline); photos land under photos/<uid>/… (see src/lib/photos.ts). The
      // client-generated issue id makes a retry collide rather than duplicate.
      const outcome = await enqueueAndRun(user.id, {
        kind: 'issue_create',
        issueId: crypto.randomUUID(),
        row: {
          title: title.trim(),
          description: description.trim(),
          priority,
          status: 'open',
          building_id: buildingId,
          deadline: deadline || null,
          corrective_action: correctiveAction.trim() || null,
          reported_by: user.id,
          assigned_to: null,
          task_instance_id: null,
          // Only admin/manager may write a cost; everyone else's row omits the column.
          ...(isAdminOrManager ? { estimated_cost: estimate } : {}),
        },
        markTaskIssueLogged: null,
      }, photos.map((p) => ({ file: p.file })));
      toastForOutcome(outcome, {
        synced: 'Issue reported successfully',
        queued: "Issue saved on this device — it will be reported when you're back online",
      });
      // A queued issue already shows on the list with a "Queued" chip, so leave the form either
      // way; both outcomes mean the building was a real choice worth remembering next time.
      if (outcome.status !== 'failed') {
        writeLastBuilding(user.id, buildingId);
        clearDraft();
        navigate('/issues');
      }
    } catch (error) {
      console.error('Error creating issue:', error);
      toast.error('Failed to create issue');
    } finally {
      setSubmitting(false);
    }
  };

  if (buildingsLoading) {
    return <PageLoading text="Loading buildings..." />;
  }

  return (
    // pb-28 on a phone keeps the last field clear of the fixed action bar.
    <div className={cn('space-y-6 max-w-2xl mx-auto', isMobile && 'pb-28')}>
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" className="h-11 w-11 sm:h-10 sm:w-10" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-warning" />
            Report New Issue
          </h1>
          <p className="text-muted-foreground">
            Log a maintenance issue or safety concern
          </p>
        </div>
      </div>

      {/* Guardrail, not a <Hint>: a data-loss cue must show however experienced the user is. */}
      {draftRestored && (
        <div
          role="status"
          className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-sm"
        >
          <span>Draft restored</span>
          <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-9" onClick={discardDraft} disabled={submitting}>
            Discard
          </Button>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>Issue Details</CardTitle>
            <CardDescription>
              Provide details about the issue you're reporting
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Building Selection */}
            <div className="space-y-2">
              <Label htmlFor="building">Building *</Label>
              <Select value={buildingId} onValueChange={setBuildingId}>
                <SelectTrigger id="building" className={CONTROL}>
                  <SelectValue placeholder="Select a building" />
                </SelectTrigger>
                <SelectContent>
                  {buildings.map((building) => (
                    <SelectItem key={building.id} value={building.id} className="min-h-11 sm:min-h-0">
                      {formatBuildingName(building.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Photos — first, directly under the building (spec §8): on site the photo is the
                report; the words come after. */}
            <div className="space-y-2">
              <PhotoCapture
                label="Photo Evidence"
                photos={photos}
                onPhotosChange={setPhotos}
                maxPhotos={5}
                disabled={submitting}
              />
              <Hint>One clear photo of the fault is worth more than a paragraph.</Hint>
            </div>

            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title">Issue Title *</Label>
              <Input
                id="title"
                className={CONTROL}
                placeholder="Brief summary of the issue"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={submitting}
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Description *</Label>
              <Textarea
                id="description"
                placeholder="Detailed description of the issue, including location and observations"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                disabled={submitting}
              />
            </div>

            {/* Priority */}
            <div className="space-y-2">
              <Label htmlFor="priority">Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as IssuePriority)}>
                <SelectTrigger id="priority" className={CONTROL}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value} className="min-h-11 sm:min-h-0">
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Deadline */}
            <div className="space-y-2">
              <Label htmlFor="deadline">Resolution Deadline (Optional)</Label>
              <Input
                id="deadline"
                type="date"
                className={CONTROL}
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                disabled={submitting}
              />
            </div>

            {/* Corrective Action */}
            <div className="space-y-2">
              <Label htmlFor="corrective-action">Suggested Corrective Action (Optional)</Label>
              <Textarea
                id="corrective-action"
                placeholder="Suggested steps to resolve this issue"
                value={correctiveAction}
                onChange={(e) => setCorrectiveAction(e.target.value)}
                rows={2}
                disabled={submitting}
              />
            </div>

            {/* Estimated cost (admin/manager) */}
            {isAdminOrManager && (
              <div className="space-y-2">
                <Label htmlFor="estimated-cost">Estimated cost (R) (Optional)</Label>
                <Input
                  id="estimated-cost"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  placeholder="0"
                  className={CONTROL}
                  value={estimatedCost}
                  onChange={(e) => setEstimatedCost(e.target.value)}
                  disabled={submitting}
                />
              </div>
            )}

            {/* Submit. On a phone the row is pinned above the home indicator (thumb zone);
                z-30 keeps it under the select popover, dialogs and the drawer (z-50). */}
            <div
              data-testid="issue-actions"
              className={cn(
                'flex gap-3',
                isMobile
                  ? 'fixed inset-x-0 bottom-0 z-30 border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]'
                  : 'pt-4',
              )}
            >
              <Button
                type="button"
                variant="outline"
                className={cn(CONTROL, isMobile && 'flex-1')}
                onClick={() => navigate(-1)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" className={cn(CONTROL, isMobile && 'flex-[2]')} disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  'Report Issue'
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
```

Run: `npx vitest run src/pages/NewIssue.test.tsx`
Expected: `✓ src/pages/NewIssue.test.tsx (23 tests)`.

- [ ] **Step 3: gate, tests, commit** — `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E 'NewIssue'` prints nothing; global count ≤ 46; `git add src/pages/NewIssue.tsx src/pages/NewIssue.test.tsx && git commit -m "New Issue phone layout: photo first, 44 px controls, pinned action bar, one photo hint"` (+ trailer).

---

### Task 5: My Day quick capture

**Files:**
- Modify: `src/pages/MyDay.tsx`, `src/pages/MyDay.test.tsx`

- [ ] **Step 1: Failing test** — in `src/pages/MyDay.test.tsx`:

Change line 1 to add `afterEach`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
```

Add after line 3 (`import { MemoryRouter } from 'react-router-dom';`):

```ts
import { mockViewport } from '@/test/mobile';
```

Add inside `describe('MyDay', …)` directly after the `beforeEach`:

```ts
  afterEach(() => mockViewport(1024));
```

Append inside `describe('MyDay', …)` after the `'routes the section coaching copy through the hints toggle'` test:

```tsx
  it('offers a floating Report issue button on a phone only (spec §8)', () => {
    mockViewport(375);
    const { unmount } = renderPage();
    const fab = screen.getByRole('link', { name: 'Report issue' });
    expect(fab).toHaveAttribute('href', '/issues/new');
    expect(fab.className).toMatch(/\bfixed\b/);
    expect(fab.className).toMatch(/\bh-14\b/);
    expect(fab.className).toMatch(/\bw-14\b/);
    unmount();

    mockViewport(1024);
    renderPage();
    expect(screen.queryByRole('link', { name: 'Report issue' })).toBeNull();
  });
```

Run: `npx vitest run src/pages/MyDay.test.tsx`
Expected: that test fails with `Unable to find an accessible element with the role "link" and name "Report issue"`; the other 16 pass.

- [ ] **Step 2: The button** — in `src/pages/MyDay.tsx`:

Add after line 40 (`import { track } from '@/lib/analytics';`):

```ts
import { useIsMobile } from '@/hooks/use-mobile';
```

Add after `const { isAdminOrManager } = useAuth();` inside `MyDay()`:

```ts
  // Phone-only quick capture (spec §8). Wider screens have the "+" menu in the top bar; on a
  // phone the field action sits in the thumb zone instead. Decided by the app's phone test so
  // the node is not rendered at all on a desktop.
  const isMobile = useIsMobile();
```

Change the page wrapper (`<div className="mx-auto w-full max-w-2xl space-y-4">`) to reserve room under the last row for the button:

```tsx
    <div className={cn('mx-auto w-full max-w-2xl space-y-4', isMobile && 'pb-24')}>
```

Insert before the closing `</div>` of that wrapper (after the `{issueToOpen && (…)}` block):

```tsx
      {isMobile && (
        <Link
          to="/issues/new"
          aria-label="Report issue"
          className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <AlertTriangle className="h-6 w-6" aria-hidden="true" />
        </Link>
      )}
```

(`Link`, `AlertTriangle` and `cn` are already imported.)

Run: `npx vitest run src/pages/MyDay.test.tsx`
Expected: `✓ src/pages/MyDay.test.tsx (17 tests)`.

- [ ] **Step 3: gate, tests, commit** — `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E 'MyDay'` prints nothing; global count ≤ 46; `git add src/pages/MyDay.tsx src/pages/MyDay.test.tsx && git commit -m "My Day: floating Report issue button on phones"` (+ trailer).

---

### Task 6 (controller): full gate, phone check, record

**Files:** none new (plan Status section only).

- [ ] **Step 1: Full gate**

```
npm run test
```
Expected: `Test Files  N passed (N)`, `Tests  … passed`, no failures (one `skipped` in `drafts.test.ts` and `queue.test.ts` on Node 20/22 is expected).

```
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c 'error TS'
```
Expected: a number ≤ 46 (`cat .github/typecheck-baseline.txt`).

```
npm run build
```
Expected: `✓ built in …s`, no errors.

- [ ] **Step 2: Phone check in the browser** (the jsdom tests cannot see layout) — `npm run dev`, DevTools device toolbar at iPhone SE (375 × 667) signed in as a site user with two buildings:
  1. `/my-day`: the round "Report issue" button sits bottom-right above the home-indicator area and the last row scrolls clear of it; no horizontal scroll bar; the button is gone at ≥ 768 px.
  2. Tap it → `/issues/new`: building pre-selected (last used after one submit), photo control directly under it with the hint line, all controls ≥ 44 px (inspect: computed height), "Cancel / Report Issue" pinned at the bottom with the safe-area padding, the last field scrolls clear of the bar; `document.documentElement.scrollWidth === 375` in the console.
  3. Type a title, add a photo, reload → fields and photo preview back, "Draft restored" bar with Discard; Discard empties the form and a further reload starts empty.
  4. Switch hints off in the header → the photo hint disappears, the "Draft restored" bar does not.
  5. Sign in as a second user on the same browser → New Issue starts empty (draft cleared with the queue).

- [ ] **Step 3: Record and push** — add a `## Status (2026-09-1x)` section at the end of this plan listing commits and the Node version the File round-trip ran on; push the branch (the Vercel preview is the deploy; nothing to apply to Supabase).

---

## Self-review: spec §8 → tasks

| Spec §8 line | Where |
|---|---|
| Building precedence `?building=` → only building → last used (`localStorage` `fortress.lastBuilding.<uid>`, written on every successful submit) → empty | Task 1 (`lastBuilding.ts`, precedence effect, `writeLastBuilding` on `synced` and `queued`; tests for each branch) |
| Photo capture directly under the building; title and description keep required status | Task 4 (field order; the `!title.trim()` / `!description.trim()` guards are untouched) |
| All controls `min-h-11` below `sm` | Task 4 (`CONTROL = 'min-h-11 sm:min-h-10'` on every Input/SelectTrigger/Button; `SelectItem`s `min-h-11 sm:min-h-0` like `QuickCreateMenu`; back button `h-11 w-11 sm:h-10 sm:w-10`; shared `ui/` components untouched) |
| Fixed bottom action bar on phones holding "Report issue" | Task 4 (`fixed inset-x-0 bottom-0`, `pb-[max(0.75rem,env(safe-area-inset-bottom))]`, page `pb-28`) |
| My Day floating "Report issue" on phones linking to `/issues/new` | Task 5 (56 px `Link`, `aria-label="Report issue"`, page `pb-24`) |
| `useIssueDraft(uid)` storing `{ title, description, buildingId, priority, photos }` in `bo-drafts-<uid>`, photos as processed JPEG `File`s, debounced 400 ms | Task 2 (store, `IssueDraft` with `savedAt`), Task 3 (hook, `DRAFT_DEBOUNCE_MS = 400`) |
| On mount with a draft: restore, recreate previews, guardrail bar "Draft restored" with Discard | Task 3 (`URL.createObjectURL` previews; `role="status"` bar, plain text) |
| Cleared on submit or discard | Task 3 (`clearDraft()` on non-failed outcome and in `discardDraft`; hook cancels the pending timer first) |
| Store cleared with the queue on user change | Task 2 (`clearDraftStore(prevUid)` next to `clearQueue(prevUid)`; provider test extended) |
| One `<Hint>` under the photo control, exact copy | Task 4 |
| Tests: precedence, draft save/restore/discard with `fake-indexeddb`, 375 px render, FAB mobile-only | Tasks 1, 2 (fake-indexeddb), 3, 4, 5 |
| Gate: tests, typecheck ≤ baseline, build; no migration; normal Vercel push | Task 6 |

**Ambiguities resolved (say so in review if you disagree):**

1. **"Last used" that is no longer accessible.** The spec does not say. A remembered building the roster no longer contains is ignored (falls through to empty), because submitting against a building the user lost access to would fail at RLS after the user filled in the form.
2. **Precedence re-derivation.** The URL is read in the effect rather than the `useState` initialiser so that Discard can reset the building and let the same rule decide again; behaviour for a fresh mount is identical.
3. **What counts as a draft.** Building and priority are derived/defaults, so a form with no title, description or photo is never saved, and a form the user empties again is cleared. Otherwise every visit to the page would leave a "draft" behind and the bar would show on a blank form. The draft carries exactly the spec's five fields plus `savedAt`; deadline, corrective action and estimated cost are not drafted (spec §8 lists the fields; extending it is a one-line change to `IssueDraft` if wanted).
4. **Draft vs precedence order.** If the draft holds a building it overrides the precedence result (it is the user's later explicit choice); an empty draft building leaves the precedence result alone.
5. **Phone decision for the bar and the FAB.** Spec says "below `sm`" (640). The pinned bar and the FAB are gated by `useIsMobile()` (768, the same phone test `ResponsiveDialog` and `PhotoCapture` use) rather than `sm:static` / `sm:hidden` CSS, because jsdom applies no CSS and cannot see a Tailwind breakpoint — the tests must observe the decision as a class or a rendered node. Between 640 and 767 px (small tablets portrait) the bar is pinned and the FAB shows; the 44 px heights use CSS `sm:` exactly as the spec says. If the reviewer wants 640 as the single boundary, the `sm:` classes can be added back on top of the JS gate without changing the tests.
6. **375 px "no horizontal scroll" test.** Asserted as the class decision at `mockViewport(375)` vs `1024`, with the reason in the test comment; the real width check is the browser step in Task 6.
7. **Unmount flush.** The spec only asks for a 400 ms debounce; the hook also flushes a pending save on unmount so leaving within the debounce window (opening the list, the OS killing the tab) keeps the last keystrokes. `clear()` empties the pending slot first, so a submitted or discarded form is never resurrected.
8. **Discard keeps the deadline / corrective action / estimate** the user may have typed after the restore, since they were never part of the draft. Acceptable: those fields are optional and rarely filled before the photo.
