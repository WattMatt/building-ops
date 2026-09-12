import { describe, it, expect, vi, beforeEach } from 'vitest';

interface RecordedCall { table: string; method: string; args: unknown[] }
type QueryResult = { data?: unknown; count?: number | null; error: { message: string; code?: string } | null };
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

import { addMember, removeMember, countOpenTasksFor, describeRemoveOutcome, isUnderCount, type RemoveOutcome } from './teamActions';

const has = (calls: RecordedCall[], method: string, ...args: unknown[]) =>
  calls.some((c) => c.method === method && args.every((a, i) => JSON.stringify(c.args[i]) === JSON.stringify(a)));
const q = (table: string, method: string) => state.queries.filter((x) => x.table === table && has(x.calls, method));

beforeEach(() => {
  state.queries = [];
  state.result = (table, calls) => {
    if (table === 'task_instances' && has(calls, 'select', 'id', { count: 'exact', head: true })) return { count: 2, error: null };
    if (table === 'user_buildings' && has(calls, 'insert')) return { data: [{ id: 'ub1' }], error: null };
    if (table === 'building_role_assignments' && has(calls, 'insert')) return { data: [{ role: 'user' }], error: null };
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
  it('inserts the access row with a zero-row check, then INSERTS (never upserts) the user rule when asked', async () => {
    expect(await addMember('b1', 'u1', true)).toEqual({ ok: true });
    const [ins] = q('user_buildings', 'insert');
    expect(has(ins.calls, 'insert', { user_id: 'u1', building_id: 'b1' }) && has(ins.calls, 'select', 'id')).toBe(true);
    const [rule] = q('building_role_assignments', 'insert');
    expect(has(rule.calls, 'insert', { building_id: 'b1', role: 'user', user_id: 'u1' }) && has(rule.calls, 'select', 'role')).toBe(true);
    expect(state.queries.map((x) => `${x.table}:${x.calls[0].method}`)).toEqual(['user_buildings:insert', 'building_role_assignments:insert']);
  });

  it('skips the rule when not asked', async () => {
    expect(await addMember('b1', 'u1', false)).toEqual({ ok: true });
    expect(q('building_role_assignments', 'insert')).toHaveLength(0);
  });

  it('treats zero inserted rows as a membership failure and never touches the rule', async () => {
    state.result = () => ({ data: [], error: null });
    expect(await addMember('b1', 'u1', true)).toEqual({ ok: false, step: 'membership', message: 'no access row was written' });
    expect(q('building_role_assignments', 'insert')).toHaveLength(0);
  });

  it('maps a unique violation on the rule to a plain message: someone else already holds the default', async () => {
    const base = state.result;
    state.result = (table, calls) =>
      table === 'building_role_assignments' && has(calls, 'insert')
        ? { data: null, error: { message: 'duplicate key value violates unique constraint "building_role_assignments_pkey"', code: '23505' } }
        : base(table, calls);
    expect(await addMember('b1', 'u1', true)).toEqual({ ok: false, step: 'default_rule', message: 'someone already holds the daily-task default here' });
  });

  it('reports any other rule failure after the access row was written, and a zero-row rule insert too', async () => {
    const base = state.result;
    state.result = (table, calls) =>
      table === 'building_role_assignments' && has(calls, 'insert') ? { data: null, error: { message: 'rls', code: '42501' } } : base(table, calls);
    expect(await addMember('b1', 'u1', true)).toEqual({ ok: false, step: 'default_rule', message: 'rls' });

    state.result = (table, calls) => (table === 'building_role_assignments' && has(calls, 'insert') ? { data: [], error: null } : base(table, calls));
    expect(await addMember('b1', 'u1', true)).toEqual({ ok: false, step: 'default_rule', message: 'no rule row was written' });
  });
});

describe('removeMember', () => {
  it('deletes rules, unassigns open tasks, deletes access — in that order, each with .select()', async () => {
    const out = await removeMember('b1', 'u1', ['user'], 2);
    expect(out).toEqual({ ok: true, done: ['rules', 'tasks', 'membership'], tasksUnassigned: 2, expectedOpenTasks: 2 });
    expect(state.queries.map((x) => `${x.table}:${x.calls[0].method}`)).toEqual([
      'building_role_assignments:delete', 'task_instances:update', 'user_buildings:delete',
    ]);
    const [rules] = q('building_role_assignments', 'delete');
    expect(has(rules.calls, 'eq', 'building_id', 'b1') && has(rules.calls, 'eq', 'user_id', 'u1') && has(rules.calls, 'select', 'role')).toBe(true);
    const [tasks] = q('task_instances', 'update');
    expect(has(tasks.calls, 'update', { assigned_to: null }) && has(tasks.calls, 'in', 'status', ['pending', 'overdue']) && has(tasks.calls, 'select', 'id')).toBe(true);
    const [ub] = q('user_buildings', 'delete');
    expect(has(ub.calls, 'eq', 'building_id', 'b1') && has(ub.calls, 'eq', 'user_id', 'u1') && has(ub.calls, 'select', 'id')).toBe(true);
    expect(isUnderCount(out)).toBe(false);
    expect(describeRemoveOutcome('Thabo M', out)).toBe('Removed Thabo M from this building');
  });

  it('skips the rules delete when the person holds none, and accepts zero unassigned tasks when none were expected', async () => {
    state.result = (table, calls) => (table === 'user_buildings' && has(calls, 'delete') ? { data: [{ id: 'ub1' }], error: null } : { data: [], error: null });
    const out = await removeMember('b1', 'u1', [], 0);
    expect(out).toEqual({ ok: true, done: ['rules', 'tasks', 'membership'], tasksUnassigned: 0, expectedOpenTasks: 0 });
    expect(q('building_role_assignments', 'delete')).toHaveLength(0);
  });

  it('stops at the first failing step and says what was done', async () => {
    const base = state.result;
    state.result = (table, calls) => (table === 'user_buildings' && has(calls, 'delete') ? { data: [], error: null } : base(table, calls));
    const out = await removeMember('b1', 'u1', ['user'], 2);
    expect(out).toEqual({ ok: false, done: ['rules', 'tasks'], failed: 'membership', message: 'no access row was removed', tasksUnassigned: 2, expectedOpenTasks: 2 });
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

  it('an under-count on the task step completes but is flagged, and the sentence says n of m', async () => {
    const base = state.result;
    state.result = (table, calls) => (table === 'task_instances' && has(calls, 'update') ? { data: [{ id: 't1' }], error: null } : base(table, calls));
    const out = await removeMember('b1', 'u1', ['user'], 2);
    expect(out).toEqual({ ok: true, done: ['rules', 'tasks', 'membership'], tasksUnassigned: 1, expectedOpenTasks: 2 });
    expect(isUnderCount(out)).toBe(true);
    expect(describeRemoveOutcome('Thabo M', out)).toBe(
      'Removed Thabo M from this building, but only 1 of 2 open tasks were unassigned. Check the open tasks here.',
    );
  });

  it('an under-count inside a later failure is also said as n of m', () => {
    const out: RemoveOutcome = { ok: false, done: ['rules', 'tasks'], failed: 'membership', message: 'rls', tasksUnassigned: 1, expectedOpenTasks: 3 };
    expect(describeRemoveOutcome('Thabo M', out)).toBe(
      'Could not finish removing Thabo M: rls. Done: their rules here were removed, 1 of 3 open tasks were unassigned. Not done: building access was not removed.',
    );
  });

  it('describeRemoveOutcome with nothing done says so and lists every step as not done', () => {
    const out: RemoveOutcome = { ok: false, done: [], failed: 'rules', message: 'no rule was removed', tasksUnassigned: 0, expectedOpenTasks: 2 };
    expect(isUnderCount(out)).toBe(false);
    expect(describeRemoveOutcome('Thabo M', out)).toBe(
      'Could not finish removing Thabo M: no rule was removed. Done: nothing. Not done: their rules here were not removed, their open tasks were not unassigned, building access was not removed.',
    );
  });
});
