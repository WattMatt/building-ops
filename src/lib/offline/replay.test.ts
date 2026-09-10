import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** One `supabase.from(table)…` chain the handlers built, recorded for assertions. */
interface FromCall {
  table: string;
  insert?: unknown;
  update?: unknown;
  eq: [string, unknown][];
  select?: string;
}
type Result = { data: unknown; error: unknown };

const state = vi.hoisted(() => ({
  rpc: vi.fn<(name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>>(),
  from: [] as FromCall[],
  /** Per-table result every chain on that table resolves to; default is one row back, no error. */
  results: {} as Record<string, { data: unknown; error: unknown }>,
  /** `supabase.auth.getSession()`; the handlers refuse to run an op under a different user. */
  getSession: vi.fn<() => Promise<{ data: { session: { user: { id: string } } | null } }>>(),
}));

vi.mock('@/integrations/supabase/client', () => {
  function chain(table: string) {
    const call: FromCall = { table, eq: [] };
    state.from.push(call);
    const c = {
      insert: (row: unknown) => { call.insert = row; return c; },
      update: (row: unknown) => { call.update = row; return c; },
      eq: (col: string, val: unknown) => { call.eq.push([col, val]); return c; },
      select: (cols: string) => { call.select = cols; return c; },
      then: (res: (v: Result) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve()
          .then(() => state.results[table] ?? { data: [{ id: 'row' }], error: null })
          .then(res, rej),
    };
    return c;
  }
  return {
    supabase: {
      from: chain,
      rpc: (name: string, args: Record<string, unknown>) => state.rpc(name, args),
      auth: { getSession: () => state.getSession() },
    },
  };
});
vi.mock('@/lib/photos', () => ({
  uploadPhotos: vi.fn().mockResolvedValue(['https://x/p.jpg']),
  photoPrefix: (u: string) => `photos/${u}`,
}));
vi.mock('@/lib/notify', () => ({ notify: vi.fn() }));
vi.mock('@/lib/issueActivity', () => ({
  postIssueComment: vi.fn().mockResolvedValue({ id: 'a1', authorName: 'Thabo' }),
}));

import { uploadPhotos } from '@/lib/photos';
import { notify } from '@/lib/notify';
import { postIssueComment } from '@/lib/issueActivity';
import { enqueue, listOps, updateOp, clearQueue } from './queue';
import { runOne, replayAll, retryOp, isNetworkError, isDuplicateError, MAX_ATTEMPTS } from './replay';
import type { IssueCommentPayload, IssueCreatePayload, IssueResolvePayload, TaskCompletePayload } from './types';

const UID = 'u1';
const complete = (completionId = 'c1', taskInstanceId = 't1'): TaskCompletePayload => ({
  kind: 'task_complete', completionId, taskInstanceId, taskName: 'Check extinguishers', notes: 'all good', signatureConfirmed: true,
});
const create = (markTaskIssueLogged: string | null): IssueCreatePayload => ({
  kind: 'issue_create',
  issueId: 'i1',
  row: {
    title: 'Leak', description: 'Pipe leaking', priority: 'high', status: 'open',
    building_id: 'b1', deadline: null, corrective_action: null,
    reported_by: UID, assigned_to: 'a9', task_instance_id: markTaskIssueLogged,
  },
  markTaskIssueLogged,
});
const comment: IssueCommentPayload = {
  kind: 'issue_comment', activityId: 'act1', issueId: 'i1', issueTitle: 'Leak', buildingId: 'b1',
  comment: 'On it', mentions: ['m1', UID],
  // Duplicates and empties come from an unassigned issue / assignee == reporter; the handler must shape them.
  notifyOthers: ['r1', 'm1', UID, 'r1', '', 'r2'], userEmail: 'me@x.test',
};
const resolve: IssueResolvePayload = { kind: 'issue_resolve', activityId: 'act2', issueId: 'i1', note: 'Fixed', userEmail: 'me@x.test' };
const resolveRated: IssueResolvePayload = { ...resolve, rating: { contractorId: 'con1', rating: 4, comment: 'Tidy work' } };
const ratingRow = { contractor_id: 'con1', issue_id: 'i1', rating: 4, comment: 'Tidy work', rated_by: UID };

const photo = () => ({ file: new File(['x'], 'a.jpg', { type: 'image/jpeg' }) });
const ok = (completionId = 'c1', already_completed = false) => ({ data: [{ completion_id: completionId, already_completed }], error: null });

describe('offline replay', () => {
  let now: ReturnType<typeof vi.spyOn> | undefined;
  beforeEach(async () => {
    // The queue orders by createdAt; two enqueues in one millisecond would otherwise tie on a random id.
    let tick = 1_700_000_000_000;
    now = vi.spyOn(Date, 'now').mockImplementation(() => ++tick);
    await clearQueue(UID);
    state.from.length = 0;
    state.results = {};
    state.rpc.mockReset();
    state.rpc.mockResolvedValue(ok());
    state.getSession.mockReset();
    state.getSession.mockResolvedValue({ data: { session: { user: { id: UID } } } });
    vi.mocked(uploadPhotos).mockClear();
    vi.mocked(notify).mockClear();
    vi.mocked(postIssueComment).mockClear();
  });
  afterEach(() => { now?.mockRestore(); });

  it('1. task_complete calls the complete_task RPC with fresh photo urls, then drops the op', async () => {
    const op = await enqueue(UID, complete(), [photo()]);
    const outcome = await runOne(op);
    expect(uploadPhotos).toHaveBeenCalledTimes(1);
    expect(vi.mocked(uploadPhotos).mock.calls[0][1]).toEqual({ prefix: 'photos/u1' });
    expect(state.rpc).toHaveBeenCalledWith('complete_task', {
      p_completion_id: 'c1', p_task_instance_id: 't1', p_notes: 'all good', p_signature_confirmed: true, p_photo_urls: ['https://x/p.jpg'],
    });
    expect(outcome).toEqual({ status: 'synced', result: { completion_id: 'c1', already_completed: false } });
    expect(await listOps(UID)).toEqual([]);
  });

  it('2. task_complete that was already completed elsewhere is still synced and carries the flag', async () => {
    state.rpc.mockResolvedValue(ok('c1', true));
    const op = await enqueue(UID, complete(), []);
    const outcome = await runOne(op);
    expect(uploadPhotos).not.toHaveBeenCalled();
    expect(state.rpc).toHaveBeenCalledWith('complete_task', expect.objectContaining({ p_photo_urls: [] }));
    expect(outcome).toEqual({ status: 'synced', result: { completion_id: 'c1', already_completed: true } });
    expect(await listOps(UID)).toEqual([]);
  });

  it('3. issue_create inserts with the client id and flips the task only when asked', async () => {
    const withTask = await enqueue(UID, create('t1'), [photo()]);
    const outcome = await runOne(withTask);
    expect(outcome).toEqual({ status: 'synced', result: { issueId: 'i1' } });
    expect(state.from.map((c) => c.table)).toEqual(['issues', 'task_instances']);
    expect(state.from[0].insert).toEqual({ id: 'i1', ...create('t1').row, photo_urls: ['https://x/p.jpg'] });
    expect(state.from[1].update).toEqual({ status: 'issue_logged' });
    expect(state.from[1].eq).toEqual([['id', 't1']]);

    state.from.length = 0;
    const standalone = await enqueue(UID, create(null), []);
    await runOne(standalone);
    expect(state.from.map((c) => c.table)).toEqual(['issues']);
    expect(state.from[0].insert).toEqual({ id: 'i1', ...create(null).row, photo_urls: null });
    expect(await listOps(UID)).toEqual([]);
  });

  it('4. issue_comment posts with the client id and notifies exactly as the composer does', async () => {
    const op = await enqueue(UID, comment, []);
    const outcome = await runOne(op);
    expect(postIssueComment).toHaveBeenCalledWith({
      id: 'act1', issueId: 'i1', userId: UID, userEmail: 'me@x.test', comment: 'On it', photoUrls: [], mentions: ['m1', UID],
    });
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith({
      kind: 'issue_comment', entityType: 'issue', entityId: 'i1', buildingId: 'b1', recipients: ['r1', 'r2'],
      title: 'Thabo commented on: Leak', body: 'On it', url: '/issues?open=i1',
    });
    expect(notify).toHaveBeenCalledWith({
      kind: 'issue_mention', entityType: 'issue', entityId: 'i1', buildingId: 'b1', recipients: ['m1'],
      title: 'Thabo mentioned you on: Leak', body: 'On it', url: '/issues?open=i1',
    });
    expect(outcome).toEqual({ status: 'synced', result: { activityId: 'act1', authorName: 'Thabo' } });
    expect(await listOps(UID)).toEqual([]);
  });

  it('5. issue_resolve comments then flips status; zero rows back is a permission failure', async () => {
    const op = await enqueue(UID, resolve, []);
    expect(await runOne(op)).toEqual({ status: 'synced', result: { issueId: 'i1' } });
    expect(postIssueComment).toHaveBeenCalledWith({
      id: 'act2', issueId: 'i1', userId: UID, userEmail: 'me@x.test', comment: 'Fixed', photoUrls: [],
    });
    expect(state.from).toHaveLength(1);
    expect(state.from[0]).toMatchObject({ table: 'issues', update: { status: 'resolved' }, eq: [['id', 'i1']], select: 'id' });
    expect(notify).not.toHaveBeenCalled();

    state.results.issues = { data: [], error: null };
    const denied = await enqueue(UID, resolve, []);
    expect(await runOne(denied)).toEqual({
      status: 'failed', error: 'Your note was saved, but you do not have permission to resolve this issue.', code: 'RESOLVE_DENIED',
    });
    const [stored] = await listOps(UID);
    expect(stored).toMatchObject({ id: denied.id, status: 'failed', attempts: 1, lastError: expect.stringContaining('permission') });
  });

  it('6. a network failure leaves the op pending, counts the attempt and reports queued', async () => {
    state.rpc.mockRejectedValue(new TypeError('Failed to fetch'));
    const op = await enqueue(UID, complete(), []);
    expect(await runOne(op)).toEqual({ status: 'queued' });
    expect((await listOps(UID))[0]).toMatchObject({ id: op.id, status: 'pending', attempts: 1, lastError: null });

    // supabase-js wraps a failed fetch into a plain error object rather than throwing it.
    state.rpc.mockResolvedValue({ data: null, error: { message: 'TypeError: Failed to fetch', code: '' } });
    expect(await runOne({ ...op, attempts: 1 })).toEqual({ status: 'queued' });
    expect((await listOps(UID))[0]).toMatchObject({ status: 'pending', attempts: 2 });

    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkError({ message: 'Load failed' })).toBe(true);
    expect(isNetworkError({ message: 'NetworkError when attempting to fetch resource.' })).toBe(true);
    expect(isNetworkError({ message: 'permission denied', code: '42501' })).toBe(false);
    // A statement timeout is a real rejection, not a transport failure.
    expect(isNetworkError({ message: 'canceling statement due to statement timeout', code: '57014' })).toBe(false);
    // The handler's own permission rejection stays a rejection even while the browser thinks it is offline.
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(isNetworkError({ message: 'Your note was saved, but you do not have permission to resolve this issue.', code: 'RESOLVE_DENIED' })).toBe(false);
    onLine.mockRestore();
  });

  it('6b. a programming bug (bare TypeError) is failed, not retried forever', async () => {
    state.rpc.mockRejectedValue(new TypeError('x is not a function'));
    const op = await enqueue(UID, complete(), []);
    expect(await runOne(op)).toEqual({ status: 'failed', error: 'x is not a function' });
    expect((await listOps(UID))[0]).toMatchObject({ id: op.id, status: 'failed', attempts: 1, lastError: 'x is not a function' });
    expect(isNetworkError(new TypeError('x is not a function'))).toBe(false);
  });

  it('6c. the twentieth network failure parks the op as failed instead of pending', async () => {
    state.rpc.mockRejectedValue(new TypeError('Failed to fetch'));
    const op = await enqueue(UID, complete(), []);
    await updateOp(UID, op.id, { attempts: MAX_ATTEMPTS - 2 });
    expect(await runOne({ ...op, attempts: MAX_ATTEMPTS - 2 })).toEqual({ status: 'queued' });
    expect((await listOps(UID))[0]).toMatchObject({ status: 'pending', attempts: MAX_ATTEMPTS - 1, lastError: null });

    const capped = await runOne({ ...op, attempts: MAX_ATTEMPTS - 1 });
    expect(capped).toEqual({ status: 'failed', error: 'Could not reach the server after 20 tries' });
    expect((await listOps(UID))[0]).toMatchObject({
      id: op.id, status: 'failed', attempts: MAX_ATTEMPTS, lastError: 'Could not reach the server after 20 tries',
    });
  });

  it('7. a duplicate means an earlier attempt landed: op dropped, outcome synced', async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } });
    const a = await enqueue(UID, complete(), []);
    expect(await runOne(a)).toEqual({ status: 'synced', result: { duplicate: true } });

    expect(await listOps(UID)).toEqual([]);

    // issue_comment is a single write too: the duplicate drops the op and (acceptably) skips the notifies.
    vi.mocked(postIssueComment).mockRejectedValueOnce({ code: '23505', message: 'duplicate key value violates unique constraint' });
    const b = await enqueue(UID, comment, []);
    expect(await runOne(b)).toEqual({ status: 'synced', result: { duplicate: true } });
    expect(notify).not.toHaveBeenCalled();
    expect(await listOps(UID)).toEqual([]);

    expect(isDuplicateError({ code: '23505' })).toBe(true);
    // PostgrestError carries no `status`; a bare 409 is not a duplicate signal.
    expect(isDuplicateError({ status: 409 })).toBe(false);
    expect(isDuplicateError({ code: '42501' })).toBe(false);
  });

  it('7b. issue_resolve whose note already landed still flips the status (write 2 after a duplicate write 1)', async () => {
    vi.mocked(postIssueComment).mockRejectedValueOnce({ code: '23505', message: 'duplicate key value violates unique constraint' });
    const op = await enqueue(UID, resolve, []);
    expect(await runOne(op)).toEqual({ status: 'synced', result: { issueId: 'i1' } });
    expect(postIssueComment).toHaveBeenCalledTimes(1);
    expect(state.from).toHaveLength(1);
    expect(state.from[0]).toMatchObject({ table: 'issues', update: { status: 'resolved' }, eq: [['id', 'i1']], select: 'id' });
    expect(await listOps(UID)).toEqual([]);

    // A non-duplicate rejection of the note still fails the op without touching the status.
    state.from.length = 0;
    vi.mocked(postIssueComment).mockRejectedValueOnce({ code: '42501', message: 'permission denied' });
    const denied = await enqueue(UID, resolve, []);
    expect(await runOne(denied)).toEqual({ status: 'failed', error: 'permission denied', code: '42501' });
    expect(state.from).toHaveLength(0);
  });

  it('5b. issue_resolve with a rating inserts contractor_ratings only after the status flip landed', async () => {
    const op = await enqueue(UID, resolveRated, []);
    expect(await runOne(op)).toEqual({ status: 'synced', result: { issueId: 'i1', rating: 'saved' } });
    expect(state.from.map((c) => c.table)).toEqual(['issues', 'contractor_ratings']);
    expect(state.from[0]).toMatchObject({ update: { status: 'resolved' }, eq: [['id', 'i1']], select: 'id' });
    expect(state.from[1].insert).toEqual(ratingRow);
    expect(await listOps(UID)).toEqual([]);

    // Without a rating on the payload nothing touches contractor_ratings and the result is unchanged.
    state.from.length = 0;
    const plain = await enqueue(UID, resolve, []);
    expect(await runOne(plain)).toEqual({ status: 'synced', result: { issueId: 'i1' } });
    expect(state.from.map((c) => c.table)).toEqual(['issues']);
  });

  it('5c. a duplicate rating (issue already rated by an earlier attempt) is tolerated: op synced, not failed', async () => {
    state.results.contractor_ratings = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
    const op = await enqueue(UID, resolveRated, []);
    expect(await runOne(op)).toEqual({ status: 'synced', result: { issueId: 'i1', rating: 'duplicate' } });
    expect(state.from.map((c) => c.table)).toEqual(['issues', 'contractor_ratings']);
    expect(await listOps(UID)).toEqual([]);
  });

  it('5d. any other rating error never fails the op: the issue is resolved, the result says the rating failed', async () => {
    state.results.contractor_ratings = { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } };
    const op = await enqueue(UID, resolveRated, []);
    expect(await runOne(op)).toEqual({ status: 'synced', result: { issueId: 'i1', rating: 'failed' } });
    expect(state.from.map((c) => c.table)).toEqual(['issues', 'contractor_ratings']);
    expect(await listOps(UID)).toEqual([]);
  });

  it('5e. the rating is skipped when the status flip is refused (RESOLVE_DENIED)', async () => {
    state.results.issues = { data: [], error: null };
    const op = await enqueue(UID, resolveRated, []);
    expect(await runOne(op)).toEqual({
      status: 'failed', error: 'Your note was saved, but you do not have permission to resolve this issue.', code: 'RESOLVE_DENIED',
    });
    expect(state.from.map((c) => c.table)).toEqual(['issues']);
    expect(state.from.some((c) => c.table === 'contractor_ratings')).toBe(false);
  });

  it('7c. issue_create whose insert already landed still flips the task to issue_logged', async () => {
    state.results.issues = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
    const op = await enqueue(UID, create('t1'), []);
    expect(await runOne(op)).toEqual({ status: 'synced', result: { issueId: 'i1' } });
    expect(state.from.map((c) => c.table)).toEqual(['issues', 'task_instances']);
    expect(state.from[1]).toMatchObject({ update: { status: 'issue_logged' }, eq: [['id', 't1']] });
    expect(await listOps(UID)).toEqual([]);

    // Without a task to flip, the duplicate insert alone is a synced op (no throw, nothing else to do).
    state.from.length = 0;
    const standalone = await enqueue(UID, create(null), []);
    expect(await runOne(standalone)).toEqual({ status: 'synced', result: { issueId: 'i1' } });
    expect(state.from.map((c) => c.table)).toEqual(['issues']);

    // Any other insert error still fails the op before the task is touched.
    state.from.length = 0;
    state.results.issues = { data: null, error: { code: '42501', message: 'permission denied' } };
    const denied = await enqueue(UID, create('t1'), []);
    expect(await runOne(denied)).toEqual({ status: 'failed', error: 'permission denied', code: '42501' });
    expect(state.from.map((c) => c.table)).toEqual(['issues']);
  });

  it('8. any other rejection marks the op failed with the message', async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } });
    const op = await enqueue(UID, complete(), []);
    expect(await runOne(op)).toEqual({ status: 'failed', error: 'permission denied', code: '42501' });
    expect((await listOps(UID))[0]).toMatchObject({ id: op.id, status: 'failed', attempts: 1, lastError: 'permission denied' });
  });

  it('8b. an op whose user is no longer signed in is failed (USER_MISMATCH) before anything reaches the backend', async () => {
    state.getSession.mockResolvedValue({ data: { session: { user: { id: 'u2' } } } });
    const op = await enqueue(UID, complete(), [photo()]);
    expect(await runOne(op)).toEqual({ status: 'failed', error: 'Signed-in user changed while syncing', code: 'USER_MISMATCH' });
    expect(uploadPhotos).not.toHaveBeenCalled();
    expect(state.rpc).not.toHaveBeenCalled();
    expect((await listOps(UID))[0]).toMatchObject({
      id: op.id, status: 'failed', attempts: 1, lastError: 'Signed-in user changed while syncing',
    });

    // Signed out entirely is a change of user too.
    state.getSession.mockResolvedValue({ data: { session: null } });
    const other = await enqueue(UID, create(null), []);
    expect(await runOne(other)).toMatchObject({ status: 'failed', code: 'USER_MISMATCH' });
    expect(state.from).toHaveLength(0);
  });

  it('9. replayAll runs oldest-first, stops at a network failure, skips failed unless asked, and is single-flight', async () => {
    const a = await enqueue(UID, complete('c1', 't1'), []);
    const b = await enqueue(UID, complete('c2', 't2'), []);
    const c = await enqueue(UID, complete('c3', 't3'), []);
    const d = await enqueue(UID, complete('c4', 't4'), []);
    await updateOp(UID, b.id, { status: 'failed', lastError: 'earlier rejection', attempts: 1 });

    const offlineFor = new Set(['c3']);
    state.rpc.mockImplementation(async (_name, args) => {
      if (offlineFor.has(args.p_completion_id as string)) throw new TypeError('Failed to fetch');
      return ok(args.p_completion_id as string);
    });

    await replayAll(UID);
    expect(state.rpc.mock.calls.map(([, args]) => args.p_completion_id)).toEqual(['c1', 'c3']);
    const after = await listOps(UID);
    expect(after.map((o) => [o.id, o.status, o.attempts])).toEqual([[b.id, 'failed', 1], [c.id, 'pending', 1], [d.id, 'pending', 0]]);
    expect(after.find((o) => o.id === a.id)).toBeUndefined();

    // Back online: two triggers fire at once (online event + focus); one run, each op exactly once.
    offlineFor.clear();
    state.rpc.mockClear();
    const first = replayAll(UID, { retryFailed: true });
    const second = replayAll(UID, { retryFailed: true });
    expect(second).toBe(first);
    // Single-flight is per user: another user's run mid-flight is its own promise, not this one.
    const otherUser = replayAll('u2');
    expect(otherUser).not.toBe(first);
    await Promise.all([first, second, otherUser]);
    expect(state.rpc.mock.calls.map(([, args]) => args.p_completion_id)).toEqual(['c2', 'c3', 'c4']);
    expect(await listOps(UID)).toEqual([]);

    // retryOp on a single failed op clears its error before re-running.
    state.rpc.mockClear();
    state.rpc.mockResolvedValue(ok('c5'));
    const e = await enqueue(UID, complete('c5', 't5'), []);
    await updateOp(UID, e.id, { status: 'failed', lastError: 'boom', attempts: 1 });
    expect(await retryOp(UID, e.id)).toEqual({ status: 'synced', result: { completion_id: 'c5', already_completed: false } });
    expect(await listOps(UID)).toEqual([]);
    expect(await retryOp(UID, 'gone')).toEqual({ status: 'failed', error: 'This change is no longer queued.' });
  });

  it('9b. retryOp waits for an in-flight replay of the same user, so the two cannot run one op twice', async () => {
    const a = await enqueue(UID, complete('c1', 't1'), []);
    const b = await enqueue(UID, complete('c2', 't2'), []);
    await updateOp(UID, b.id, { status: 'failed', lastError: 'earlier rejection', attempts: 1 });

    // The replay is parked inside op a's RPC; the user taps Retry on b meanwhile.
    let releaseA!: () => void;
    const gate = new Promise<void>((r) => { releaseA = r; });
    state.rpc.mockImplementation(async (_name, args) => {
      if (args.p_completion_id === 'c1') await gate;
      return ok(args.p_completion_id as string);
    });
    const replay = replayAll(UID, { retryFailed: true });
    const retry = retryOp(UID, b.id);
    // The replay is inside a's RPC; b has not been touched by anyone yet.
    await vi.waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(1));
    expect(state.rpc.mock.calls.map(([, args]) => args.p_completion_id)).toEqual(['c1']);

    releaseA();
    await expect(replay).resolves.toEqual({ blocked: false });
    // The replay ran b; the retry, queued behind it, found nothing left to run rather than running it again.
    expect(await retry).toEqual({ status: 'failed', error: 'This change is no longer queued.' });
    expect(state.rpc.mock.calls.map(([, args]) => args.p_completion_id)).toEqual(['c1', 'c2']);
    expect(await listOps(UID)).toEqual([]);
    expect(a.id).not.toBe(b.id);
  });

  it('10. stopAt halts before the named op (nothing behind it touched); blocked is true only after a network stop', async () => {
    const a = await enqueue(UID, complete('c1', 't1'), []);
    const b = await enqueue(UID, complete('c2', 't2'), []);
    const c = await enqueue(UID, complete('c3', 't3'), []);
    state.rpc.mockImplementation(async (_name, args) => ok(args.p_completion_id as string));

    // Clean run up to b: only a lands; b and c are untouched (still pending, no attempt counted).
    expect(await replayAll(UID, { stopAt: b.id })).toEqual({ blocked: false });
    expect(state.rpc.mock.calls.map(([, args]) => args.p_completion_id)).toEqual(['c1']);
    expect((await listOps(UID)).map((o) => [o.id, o.status, o.attempts])).toEqual([[b.id, 'pending', 0], [c.id, 'pending', 0]]);
    expect((await listOps(UID)).find((o) => o.id === a.id)).toBeUndefined();

    // b cannot reach the server: the run is blocked, c (before the stop) is never tried.
    state.rpc.mockClear();
    state.rpc.mockRejectedValue(new TypeError('Failed to fetch'));
    const d = await enqueue(UID, complete('c4', 't4'), []);
    expect(await replayAll(UID, { stopAt: d.id })).toEqual({ blocked: true });
    expect(state.rpc.mock.calls.map(([, args]) => args.p_completion_id)).toEqual(['c2']);
    expect((await listOps(UID)).map((o) => [o.id, o.status, o.attempts])).toEqual([[b.id, 'pending', 1], [c.id, 'pending', 0], [d.id, 'pending', 0]]);

    // Back online, no stopAt: everything drains in order and the run reports unblocked.
    state.rpc.mockClear();
    state.rpc.mockImplementation(async (_name, args) => ok(args.p_completion_id as string));
    expect(await replayAll(UID)).toEqual({ blocked: false });
    expect(state.rpc.mock.calls.map(([, args]) => args.p_completion_id)).toEqual(['c2', 'c3', 'c4']);
    expect(await listOps(UID)).toEqual([]);

    // A stopAt that is not in the queue (already discarded) stops nothing.
    state.rpc.mockClear();
    await enqueue(UID, complete('c5', 't5'), []);
    expect(await replayAll(UID, { stopAt: 'gone' })).toEqual({ blocked: false });
    expect(state.rpc.mock.calls.map(([, args]) => args.p_completion_id)).toEqual(['c5']);
    expect(await listOps(UID)).toEqual([]);
  });
});
