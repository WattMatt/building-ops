import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Postgrest-like chain: every builder method records itself and returns the same chain; the
// chain is thenable so the hook can `await` it after any number of calls. `state.result`
// decides what a table answers with, given the calls chained before it ran.
interface RecordedCall { table: string; method: string; args: unknown[] }
type QueryResult = { data?: unknown; error: { message: string } | null };
type Chain = Record<string, (...args: unknown[]) => Chain> & {
  then: (resolve: (r: QueryResult) => unknown, reject?: (e: unknown) => unknown) => unknown;
};

const state = vi.hoisted(() => ({
  calls: [] as RecordedCall[],
  /** One entry per resolved query, with the calls that were chained on it. */
  queries: [] as { table: string; calls: RecordedCall[] }[],
  result: (() => ({ data: [], error: null })) as (table: string, calls: RecordedCall[]) => QueryResult,
}));

vi.mock('@/integrations/supabase/client', () => {
  const METHODS = ['select', 'eq', 'is', 'in', 'order', 'maybeSingle', 'upsert', 'delete', 'update'];
  const from = (table: string): Chain => {
    const own: RecordedCall[] = [];
    const chain = {} as Chain;
    for (const method of METHODS) {
      chain[method] = (...args: unknown[]) => {
        const call = { table, method, args };
        own.push(call);
        state.calls.push(call);
        return chain;
      };
    }
    chain.then = (resolve, reject) => {
      state.queries.push({ table, calls: own });
      return Promise.resolve(state.result(table, own)).then(resolve, reject);
    };
    return chain;
  };
  return { supabase: { from } };
});

const notifyMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/lib/notify', () => ({ notify: notifyMock }));

import { useBuildingRoleAssignments, roleLabelsFor, sortRoles } from './useBuildingRoleAssignments';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, children);

const has = (calls: RecordedCall[], method: string, ...args: unknown[]) =>
  calls.some((c) => c.method === method && args.every((a, i) => JSON.stringify(c.args[i]) === JSON.stringify(a)));

const templates = [
  { responsible_role: 'manager', applies_to_building_types: null, is_active: true, template_items: [{ responsible_party: 'HVAC Contractor' }, { responsible_party: null }] },
  { responsible_role: null, applies_to_building_types: ['office'], is_active: true, template_items: [{ responsible_party: 'Cleaner' }] },
  { responsible_role: 'Security', applies_to_building_types: ['retail'], is_active: true, template_items: [{ responsible_party: null }] },
  { responsible_role: 'Archived Role', applies_to_building_types: null, is_active: false, template_items: [{ responsible_party: 'Archived Role' }] },
  { responsible_role: 'Old Lift Contractor', applies_to_building_types: null, is_active: true, archived_at: '2026-09-01T00:00:00Z', template_items: [{ responsible_party: null }] },
];

beforeEach(() => {
  state.calls = [];
  state.queries = [];
  notifyMock.mockClear();
  state.result = (table, calls) => {
    if (table === 'building_role_assignments' && has(calls, 'select')) {
      return { data: [{ role: 'user', user_id: 'u1' }, { role: 'HVAC Contractor', user_id: 'u2' }], error: null };
    }
    if (table === 'buildings') return { data: { name: 'Fortress Mall', building_type: 'office' }, error: null };
    if (table === 'checklist_templates') return { data: templates, error: null };
    if (table === 'task_instances' && has(calls, 'select', 'responsible_role')) {
      return { data: [{ responsible_role: 'user' }, { responsible_role: 'user' }, { responsible_role: 'Cleaner' }], error: null };
    }
    return { data: [], error: null };
  };
});

describe('roleLabelsFor / sortRoles', () => {
  it('lists user and manager first, then the applicable templates’ labels A–Z', () => {
    expect(roleLabelsFor(templates, 'office')).toEqual(['user', 'manager', 'Cleaner', 'HVAC Contractor']);
  });

  it('drops templates that do not apply to the building type, inactive ones, and archived ones', () => {
    expect(roleLabelsFor(templates, 'retail')).toEqual(['user', 'manager', 'HVAC Contractor', 'Security']);
    expect(roleLabelsFor(templates, null)).toEqual(['user', 'manager', 'HVAC Contractor']);
    expect(roleLabelsFor(templates, 'office')).not.toContain('Old Lift Contractor');
    expect(roleLabelsFor([{ ...templates[4], archived_at: null }], 'office')).toContain('Old Lift Contractor');
  });

  it('an empty applies_to list matches no building (SQL = any(\'{}\')), only null means all', () => {
    expect(roleLabelsFor([{ responsible_role: 'Nobody', applies_to_building_types: [], is_active: true, template_items: [{ responsible_party: null }] }], 'office')).toEqual(['user', 'manager']);
  });

  it('falls back to the template role, then user, when an item names nobody', () => {
    expect(roleLabelsFor([{ responsible_role: null, applies_to_building_types: null, is_active: null, template_items: [{ responsible_party: '' }] }], 'office')).toEqual(['user', 'manager']);
  });

  it('sortRoles keeps the fixed pair first even when given in another order', () => {
    expect(sortRoles(['Zed', 'manager', 'alpha', 'user'])).toEqual(['user', 'manager', 'alpha', 'Zed']);
  });
});

describe('useBuildingRoleAssignments', () => {
  it('reads rules for the building and derives roles from the applicable templates', async () => {
    const { result } = renderHook(() => useBuildingRoleAssignments('b1'), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.rules.get('user')).toBe('u1');
    expect(result.current.rules.get('HVAC Contractor')).toBe('u2');
    expect(result.current.roles).toEqual(['user', 'manager', 'Cleaner', 'HVAC Contractor']);
    const rulesRead = state.queries.find((q) => q.table === 'building_role_assignments');
    expect(rulesRead && has(rulesRead.calls, 'eq', 'building_id', 'b1')).toBe(true);
    // The labels query must read archived_at, or an archived template's labels would keep being offered.
    const templatesRead = state.queries.find((q) => q.table === 'checklist_templates');
    expect(templatesRead && has(templatesRead.calls, 'select', 'responsible_role, applies_to_building_types, is_active, archived_at, template_items(responsible_party)')).toBe(true);
  });

  it('counts unassigned pending tasks per role', async () => {
    const { result } = renderHook(() => useBuildingRoleAssignments('b1'), { wrapper });
    await waitFor(() => expect(result.current.pendingByRole.size).toBeGreaterThan(0));
    expect(result.current.pendingByRole.get('user')).toBe(2);
    expect(result.current.pendingByRole.get('Cleaner')).toBe(1);
    const pendingRead = state.queries.find((q) => q.table === 'task_instances');
    expect(pendingRead && has(pendingRead.calls, 'eq', 'status', 'pending')).toBe(true);
    expect(pendingRead && has(pendingRead.calls, 'is', 'assigned_to', null)).toBe(true);
  });

  it('setRule upserts on (building_id, role) and deletes when the person is cleared', async () => {
    const { result } = renderHook(() => useBuildingRoleAssignments('b1'), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await result.current.setRule('Cleaner', 'u3');
    expect(state.calls).toContainEqual({ table: 'building_role_assignments', method: 'upsert', args: [{ building_id: 'b1', role: 'Cleaner', user_id: 'u3' }, { onConflict: 'building_id,role' }] });

    await result.current.setRule('Cleaner', null);
    const del = state.queries.filter((q) => q.table === 'building_role_assignments' && has(q.calls, 'delete')).at(-1);
    expect(del && has(del.calls, 'eq', 'building_id', 'b1') && has(del.calls, 'eq', 'role', 'Cleaner')).toBe(true);
  });

  it('applyToPending assigns per rule, notifies each person once with the total, and returns the count', async () => {
    const { result } = renderHook(() => useBuildingRoleAssignments('b1'), { wrapper });
    await waitFor(() => expect(result.current.rules.size).toBe(2));
    const base = state.result;
    state.result = (table, calls) => {
      if (table === 'task_instances' && has(calls, 'update')) {
        const role = calls.find((c) => c.method === 'eq' && c.args[0] === 'responsible_role')?.args[1];
        return role === 'user' ? { data: [{ id: 't1' }, { id: 't2' }], error: null } : { data: [{ id: 't3' }], error: null };
      }
      return base(table, calls);
    };

    const total = await result.current.applyToPending();
    expect(total).toBe(3);

    const updates = state.queries.filter((q) => q.table === 'task_instances' && has(q.calls, 'update'));
    expect(updates).toHaveLength(2);
    for (const u of updates) {
      expect(has(u.calls, 'eq', 'building_id', 'b1')).toBe(true);
      expect(has(u.calls, 'eq', 'status', 'pending')).toBe(true);
      expect(has(u.calls, 'is', 'assigned_to', null)).toBe(true);
      expect(has(u.calls, 'select', 'id')).toBe(true);
    }
    expect(has(updates[0].calls, 'update', { assigned_to: 'u1' }) && has(updates[0].calls, 'eq', 'responsible_role', 'user')).toBe(true);

    expect(notifyMock).toHaveBeenCalledTimes(2);
    expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'task_assigned', entityType: 'task', entityId: 't1', buildingId: 'b1', recipients: ['u1'],
      title: '2 tasks assigned to you at Fortress Mall', url: '/buildings/b1?tab=checklists',
    }));
    expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({ recipients: ['u2'], entityId: 't3', title: '1 task assigned to you at Fortress Mall' }));
  });

  it('applyToPending leaves rules alone whose label is no longer offered (archived template), so it agrees with the panel count', async () => {
    const base = state.result;
    state.result = (table, calls) => {
      if (table === 'building_role_assignments' && has(calls, 'select')) {
        return { data: [{ role: 'user', user_id: 'u1' }, { role: 'Old Lift Contractor', user_id: 'u5' }], error: null };
      }
      if (table === 'task_instances' && has(calls, 'update')) return { data: [{ id: 't9' }], error: null };
      return base(table, calls);
    };
    const { result } = renderHook(() => useBuildingRoleAssignments('b1'), { wrapper });
    await waitFor(() => expect(result.current.rules.size).toBe(2));
    await waitFor(() => expect(result.current.roles).toEqual(['user', 'manager', 'Cleaner', 'HVAC Contractor']));

    const total = await result.current.applyToPending();
    expect(total).toBe(1);
    const updates = state.queries.filter((q) => q.table === 'task_instances' && has(q.calls, 'update'));
    expect(updates).toHaveLength(1);
    expect(has(updates[0].calls, 'eq', 'responsible_role', 'user')).toBe(true);
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({ recipients: ['u1'] }));
  });

  it('applyToPending skips people whose rules matched nothing', async () => {
    const { result } = renderHook(() => useBuildingRoleAssignments('b1'), { wrapper });
    await waitFor(() => expect(result.current.rules.size).toBe(2));
    const total = await result.current.applyToPending();
    expect(total).toBe(0);
    expect(notifyMock).not.toHaveBeenCalled();
  });
});
