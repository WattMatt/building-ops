import { describe, it, expect, vi, beforeEach } from 'vitest';

// The module builds its queries off the shared client at import time, so the mock is hoisted.
const sb = vi.hoisted(() => ({
  insert: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      insert: sb.insert,
      select: sb.select,
      update: sb.update,
    }),
    functions: { invoke: sb.invoke },
  },
}));

import {
  createShare,
  isActiveShare,
  listShares,
  passcodeProblem,
  revokeShare,
  shareUrl,
  CREATE_FAILED_MESSAGE,
  SHARE_COLUMNS,
  SHARE_PERMISSION_MESSAGE,
  TOKEN_TAKEN_MESSAGE,
  PASSCODE_MAX,
  type ReportShareRow,
} from './reportShares';

const row = (over: Partial<ReportShareRow> = {}): ReportShareRow => ({
  id: 's1',
  report_id: 'r1',
  artifact_id: 'a1',
  token: 'x'.repeat(43),
  created_by: 'u1',
  created_at: '2026-09-01T00:00:00.000Z',
  expires_at: '2026-10-01T00:00:00.000Z',
  view_count: 0,
  last_viewed_at: null,
  revoked_at: null,
  has_passcode: false,
  ...over,
});

/** What `supabase.functions.invoke` hands back for a non-2xx: a generic message plus the Response. */
const httpError = (status: number, body: unknown) => ({
  message: 'Edge Function returned a non-2xx status code',
  name: 'FunctionsHttpError',
  context: { status, json: () => Promise.resolve(body) },
});

/** insert(...).select(...) resolving to `result`. */
function insertReturns(result: { data: unknown; error: unknown }) {
  sb.insert.mockReturnValue({ select: vi.fn().mockResolvedValue(result) });
}

beforeEach(() => {
  sb.insert.mockReset();
  sb.select.mockReset();
  sb.update.mockReset();
  sb.invoke.mockReset();
});

describe('createShare', () => {
  it('inserts a passcode-free link straight through RLS with a 43-char token', async () => {
    insertReturns({ data: [{ id: 's1', token: 'tok', expires_at: '2026-10-01T00:00:00.000Z' }], error: null });
    const before = Date.now();
    const result = await createShare({ reportId: 'r1', artifactId: 'a1', expiresInDays: 30 }, 'u1');
    expect(result).toEqual({ id: 's1', token: 'tok', expiresAt: '2026-10-01T00:00:00.000Z' });
    expect(sb.invoke).not.toHaveBeenCalled();
    const sent = sb.insert.mock.calls[0][0] as Record<string, string>;
    expect(sent.report_id).toBe('r1');
    expect(sent.artifact_id).toBe('a1');
    expect(sent.created_by).toBe('u1');
    expect(sent.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const days = (new Date(sent.expires_at).getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  it('routes a passcode link through the report-share function and never inserts', async () => {
    sb.invoke.mockResolvedValue({ data: { id: 's2', token: 'tok2', expiresAt: '2026-09-08T00:00:00.000Z' }, error: null });
    const result = await createShare({ reportId: 'r1', artifactId: 'a1', expiresInDays: 7, passcode: 'hunter2' }, 'u1');
    expect(result).toEqual({ id: 's2', token: 'tok2', expiresAt: '2026-09-08T00:00:00.000Z' });
    expect(sb.insert).not.toHaveBeenCalled();
    const [fn, opts] = sb.invoke.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(fn).toBe('report-share');
    expect(opts.body).toMatchObject({ action: 'create', reportId: 'r1', artifactId: 'a1', expiresInDays: 7, passcode: 'hunter2' });
    expect(opts.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('turns an RLS-filtered insert (zero rows, no error) into the permission message', async () => {
    insertReturns({ data: [], error: null });
    await expect(createShare({ reportId: 'r1', artifactId: 'a1', expiresInDays: 30 }, 'u1'))
      .rejects.toThrow(SHARE_PERMISSION_MESSAGE);
  });

  // invoke() reports every non-2xx as the same generic sentence; the real reason is in the body.
  it.each([
    ['a 403 forbidden becomes the share permission message', 403, { error: 'forbidden' }, SHARE_PERMISSION_MESSAGE],
    ['a 401 unauthorized becomes the share permission message', 401, { error: 'unauthorized' }, SHARE_PERMISSION_MESSAGE],
    ['a token collision asks for a retry', 400, { error: 'token taken' }, TOKEN_TAKEN_MESSAGE],
    ['a bad artifact falls back to the generic line', 400, { error: 'bad artifact' }, CREATE_FAILED_MESSAGE],
    ['an unknown code falls back to the generic line', 500, { error: 'unavailable' }, CREATE_FAILED_MESSAGE],
  ])('%s', async (_name, status, body, expected) => {
    sb.invoke.mockResolvedValue({ data: null, error: httpError(status as number, body) });
    await expect(createShare({ reportId: 'r1', artifactId: 'a1', expiresInDays: 30, passcode: '1234' }, 'u1'))
      .rejects.toThrow(expected as string);
    // Never the vendor sentence.
    await expect(createShare({ reportId: 'r1', artifactId: 'a1', expiresInDays: 30, passcode: '1234' }, 'u1'))
      .rejects.not.toThrow('non-2xx');
  });

  it('falls back to the generic line when the error body will not parse', async () => {
    sb.invoke.mockResolvedValue({
      data: null,
      error: { message: 'Edge Function returned a non-2xx status code', context: { json: () => Promise.reject(new Error('not json')) } },
    });
    await expect(createShare({ reportId: 'r1', artifactId: 'a1', expiresInDays: 30, passcode: '1234' }, 'u1'))
      .rejects.toThrow(CREATE_FAILED_MESSAGE);
  });

  it('a 2xx with no body is an error, not a TypeError', async () => {
    sb.invoke.mockResolvedValue({ data: null, error: null });
    await expect(createShare({ reportId: 'r1', artifactId: 'a1', expiresInDays: 30, passcode: '1234' }, 'u1'))
      .rejects.toThrow(CREATE_FAILED_MESSAGE);
    sb.invoke.mockResolvedValue({ data: { id: 's1' }, error: null }); // token/expiresAt missing
    await expect(createShare({ reportId: 'r1', artifactId: 'a1', expiresInDays: 30, passcode: '1234' }, 'u1'))
      .rejects.toThrow(CREATE_FAILED_MESSAGE);
  });

  it('validates the passcode itself, so a direct caller never gets an opaque 400', async () => {
    await expect(createShare({ reportId: 'r1', artifactId: 'a1', expiresInDays: 30, passcode: 'ab' }, 'u1'))
      .rejects.toThrow('at least 4');
    await expect(createShare({ reportId: 'r1', artifactId: 'a1', expiresInDays: 30, passcode: 'a'.repeat(PASSCODE_MAX + 1) }, 'u1'))
      .rejects.toThrow('at most 64');
    expect(sb.invoke).not.toHaveBeenCalled();
    expect(sb.insert).not.toHaveBeenCalled();
  });
});

describe('listShares / revokeShare', () => {
  it('lists a report’s links newest first', async () => {
    const order = vi.fn().mockResolvedValue({ data: [row()], error: null });
    const eq = vi.fn().mockReturnValue({ order });
    sb.select.mockReturnValue({ eq });
    expect(await listShares('r1')).toEqual([row()]);
    // SELECT is column-privileged: a bare '*' would 403 against the real table.
    expect(sb.select).toHaveBeenCalledWith(SHARE_COLUMNS);
    expect(SHARE_COLUMNS).not.toContain('passcode_hash');
    // The generated boolean is readable; the hash behind it is not. That is what lets the list
    // show a Passcode chip for links it did not create.
    expect(SHARE_COLUMNS).toContain('has_passcode');
    expect(eq).toHaveBeenCalledWith('report_id', 'r1');
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
  });

  it('revoke writes revoked_at and treats zero rows as a permission failure', async () => {
    const select = vi.fn().mockResolvedValue({ data: [], error: null });
    const eq = vi.fn().mockReturnValue({ select });
    sb.update.mockReturnValue({ eq });
    await expect(revokeShare('s1')).rejects.toThrow(SHARE_PERMISSION_MESSAGE);
    expect(Object.keys(sb.update.mock.calls[0][0] as object)).toEqual(['revoked_at']);
    expect(eq).toHaveBeenCalledWith('id', 's1');
  });
});

describe('pure helpers', () => {
  it('isActiveShare excludes revoked and expired links', () => {
    const now = Date.parse('2026-09-15T00:00:00.000Z');
    expect(isActiveShare(row(), now)).toBe(true);
    expect(isActiveShare(row({ revoked_at: '2026-09-10T00:00:00.000Z' }), now)).toBe(false);
    expect(isActiveShare(row({ expires_at: '2026-09-01T00:00:00.000Z' }), now)).toBe(false);
  });

  it('passcodeProblem allows empty and bounds the length', () => {
    expect(passcodeProblem('')).toBeNull();
    expect(passcodeProblem('abc')).toContain('at least 4');
    expect(passcodeProblem('abcd')).toBeNull();
    expect(passcodeProblem('a'.repeat(PASSCODE_MAX + 1))).toContain('at most 64');
  });

  it('shareUrl points at the public page on this origin', () => {
    expect(shareUrl('abc')).toBe(`${window.location.origin}/share/abc`);
  });
});
