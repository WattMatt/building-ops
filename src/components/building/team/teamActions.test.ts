import { describe, it, expect, vi, beforeEach } from 'vitest';

interface RecordedCall { table: string; method: string; args: unknown[] }
type QueryResult = { data?: unknown; count?: number | null; error: { message: string } | null };
type Chain = Record<string, (...args: unknown[]) => Chain> & {
  then: (resolve: (r: QueryResult) => unknown, reject?: (e: unknown) => unknown) => unknown;
};

const state = vi.hoisted(() => ({
  queries: [] as { table: string; calls: RecordedCall[] }[],
  result: (() => ({ data: [], error: null })) as (table: string, calls: RecordedCall[]) => QueryResult,
}));

vi.mock('@/integrations/supabase/client', () => {
  const METHODS = ['select', 'eq', 'in', 'is', 'insert', 'update', 'delete'];
  const from = (table: string): Chain => {
    const own: RecordedCall[] = [];
    const chain = {} as Chain;
    for (const method of METHODS) {
      chain[method] = (...args: unknown[]) => { own.push({ table, method, args }); return chain; };
    }
    chain.then = (resolve, reject) => {
      state.queries.push({ table, calls: own });
      return Promise.resolve(state.result(table, own)).then(resolve, reject);
    };
    return chain;
  };
  return { supabase: { from } };
});

import { addMember, removeMember, countOpenTasksFor, describeRemoveOutcome } from './teamActions';

const has = (calls: RecordedCall[], method: string, ...args: unknown[]) =>
  calls.some((c) => c.method === method && args.every((a, i) => JSON.stringify(c.args[i]) === JSON.stringify(a)));
const q = (table: string, method: string) => state.queries.filter((x) => x.table === table && has(x.calls, method));

beforeEach(() => {
  state.queries = [];
  state.result = (table, calls) => {
    if (table === 'task_instances' && has(calls, 'select', 'id', { count: 'exact', head: true })) return { count: 2, error: null };
    if (table === 'user_buildings' && has(calls, 'insert')) return { data: [{ id: 'ub1' }], error: null };
    if (table === 'building_role_assignments' && has(calls, 'delete')) return { data: [{ role: 'user' }], error: null };
    if (table === 'task_instances' && has(calls, 'update')) return { data: [{ id: 't1' }, { id: 't2' }], error: null };
    if (table === 'user_buildings' && has(calls, 'delete')) return { data: [{ id: 'ub1' }], error: null };
    return { data: [], error: null };
  };
});

describe('countOpenTasksFor', () => {
  it('counts pending and overdue tasks assigned to the person at the building', async () => {
    expect(await countOpenTasksFor('b1', 'u1')).toBe(2);
    const [read] = q('task_instances', 'select');
    expect(has(read.calls, 'eq', 'building_id', 'b1') && has(read.calls, 'eq', 'assigned_to', 'u1') && has(read.calls, 'in', 'status', ['pending', 'overdue'])).toBe(true);
  });
});

describe('addMember', () => {
  it('inserts the access row with a zero-row check, then writes the user rule when asked', async () => {
    const setRule = vi.fn(async () => {});
    expect(await addMember('b1', 'u1', true, setRule)).toEqual({ ok: true });
    const [ins] = q('user_buildings', 'insert');
    expect(has(ins.calls, 'insert', { user_id: 'u1', building_id: 'b1' }) && has(ins.calls, 'select', 'id')).toBe(true);
    expect(setRule).toHaveBeenCalledWith('user', 'u1');
  });

  it('skips the rule when not asked', async () => {
    const setRule = vi.fn(async () => {});
    expect(await addMember('b1', 'u1', false, setRule)).toEqual({ ok: true });
    expect(setRule).not.toHaveBeenCalled();
  });

  it('treats zero inserted rows as a membership failure and never touches the rule', async () => {
    state.result = () => ({ data: [], error: null });
    const setRule = vi.fn(async () => {});
    expect(await addMember('b1', 'u1', true, setRule)).toEqual({ ok: false, step: 'membership', message: 'no access row was written' });
    expect(setRule).not.toHaveBeenCalled();
  });

  it('reports a rule failure after the access row was written', async () => {
    const setRule = vi.fn(async () => { throw new Error('rls'); });
    expect(await addMember('b1', 'u1', true, setRule)).toEqual({ ok: false, step: 'default_rule', message: 'rls' });
  });
});

describe('removeMember', () => {
  it('deletes rules, unassigns open tasks, deletes access — in that order, each with .select()', async () => {
    const out = await removeMember('b1', 'u1', ['user'], 2);
    expect(out).toEqual({ ok: true, done: ['rules', 'tasks', 'membership'], tasksUnassigned: 2 });
    expect(state.queries.map((x) => `${x.table}:${x.calls[0].method}`)).toEqual([
      'building_role_assignments:delete', 'task_instances:update', 'user_buildings:delete',
    ]);
    const [rules] = q('building_role_assignments', 'delete');
    expect(has(rules.calls, 'eq', 'building_id', 'b1') && has(rules.calls, 'eq', 'user_id', 'u1') && has(rules.calls, 'select', 'role')).toBe(true);
    const [tasks] = q('task_instances', 'update');
    expect(has(tasks.calls, 'update', { assigned_to: null }) && has(tasks.calls, 'in', 'status', ['pending', 'overdue']) && has(tasks.calls, 'select', 'id')).toBe(true);
    const [ub] = q('user_buildings', 'delete');
    expect(has(ub.calls, 'eq', 'user_id', 'u1') && has(ub.calls, 'select', 'id')).toBe(true);
  });

  it('skips the rules delete when the person holds none, and accepts zero unassigned tasks when none were expected', async () => {
    state.result = (table, calls) => (table === 'user_buildings' && has(calls, 'delete') ? { data: [{ id: 'ub1' }], error: null } : { data: [], error: null });
    const out = await removeMember('b1', 'u1', [], 0);
    expect(out).toEqual({ ok: true, done: ['rules', 'tasks', 'membership'], tasksUnassigned: 0 });
    expect(q('building_role_assignments', 'delete')).toHaveLength(0);
  });

  it('stops at the first failing step and says what was done', async () => {
    const base = state.result;
    state.result = (table, calls) => (table === 'user_buildings' && has(calls, 'delete') ? { data: [], error: null } : base(table, calls));
    const out = await removeMember('b1', 'u1', ['user'], 2);
    expect(out).toEqual({ ok: false, done: ['rules', 'tasks'], failed: 'membership', message: 'no access row was removed', tasksUnassigned: 2 });
    expect(describeRemoveOutcome('Thabo M', out)).toBe(
      'Could not finish removing Thabo M: no access row was removed. Done: their rules here were removed, 2 tasks were unassigned. Not done: building access was not removed.',
    );
  });

  it('a zero-row task update is a failure when the dialog promised tasks', async () => {
    const base = state.result;
    state.result = (table, calls) => (table === 'task_instances' && has(calls, 'update') ? { data: [], error: null } : base(table, calls));
    const out = await removeMember('b1', 'u1', ['user'], 2);
    expect(out.ok).toBe(false);
    expect(out.failed).toBe('tasks');
    expect(q('user_buildings', 'delete')).toHaveLength(0);
  });
});
