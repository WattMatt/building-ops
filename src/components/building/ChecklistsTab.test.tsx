import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { mockViewport } from '@/test/mobile';
import { todayInOperatingTz } from '@/lib/myWork';
import { exportCsv, toCsv } from '@/lib/exportCsv';

// Keep the real CSV builder; only the download step is captured so the test can read what the
// button would have written.
vi.mock('@/lib/exportCsv', async (orig) => ({
  ...(await orig<typeof import('@/lib/exportCsv')>()),
  exportCsv: vi.fn(),
}));

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  tasks: [] as Row[],
  completions: [] as Row[],
  selects: [] as { table: string; cols: string }[],
}));

vi.mock('@/integrations/supabase/client', () => {
  // Every builder method returns the same thenable chain; the table decides which rows come back.
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ['eq', 'in', 'order', 'update']) chain[m] = () => chain;
    chain.select = (cols: string) => { state.selects.push({ table, cols }); return chain; };
    chain.then = (resolve: (v: { data: Row[]; error: null }) => unknown) =>
      Promise.resolve({ data: table === 'task_instances' ? state.tasks : table === 'task_completions' ? state.completions : [], error: null }).then(resolve);
    return chain;
  };
  return { supabase: { from, rpc: vi.fn() } };
});
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, isAdminOrManager: true }) }));
vi.mock('@/hooks/useBuildingMembers', async (orig) => ({
  ...(await orig<typeof import('@/hooks/useBuildingMembers')>()),
  useBuildingMembers: () => ({ data: [], byId: new Map(), isLoading: false, isError: false }),
}));
vi.mock('@/components/building/RoleAssignmentsPanel', () => ({ RoleAssignmentsPanel: () => null }));
vi.mock('@/components/people/AssigneePicker', () => ({ AssigneePicker: () => null }));
vi.mock('@/components/evidence/EvidencePackMenu', () => ({ EvidencePackMenu: () => null }));
vi.mock('@/components/checklists/ReportIssueDialog', () => ({ default: () => null }));
vi.mock('@/components/checklists/CompleteTaskDialog', () => ({ default: () => null }));
vi.mock('@/lib/notify', () => ({ notify: vi.fn() }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));

import ChecklistsTab from './ChecklistsTab';

const TODAY = todayInOperatingTz();
const task = (id: string, status: string): Row => ({
  id, task_name: `Task ${id}`, task_description: null, frequency: 'daily', status, due_date: TODAY,
  requires_photo: false, requires_signature: false, responsible_role: 'user', building_id: 'b1', category: null, assigned_to: null,
});
const completion = (task_instance_id: string, outcome: string, reason: string | null): Row => ({
  task_instance_id, completed_by: 'u1', completed_at: `${TODAY}T08:00:00Z`, outcome, reason,
});

describe('ChecklistsTab — can\'t do', () => {
  beforeEach(() => {
    // Phone layout: the strip opens on the Daily tab, where the lists and the progress card live.
    mockViewport(375);
    vi.mocked(exportCsv).mockClear();
    state.selects = [];
    state.tasks = [task('t1', 'pending'), task('t2', 'wont_do'), task('t3', 'completed'), task('t4', 'issue_logged')];
    state.completions = [completion('t2', 'wont_do', 'load_shedding'), completion('t3', 'completed', null)];
  });
  afterEach(() => mockViewport(1024));

  it('reads outcome and reason with the completions, lists can\'t-do tasks in their own card, and keeps them out of the progress denominator', async () => {
    render(<ChecklistsTab buildingId="b1" buildingName="Alpha Court" />);
    const title = await screen.findByText("Can't do (1)");
    const card = title.closest('.rounded-lg') as HTMLElement;
    expect(within(card).getByText('Task t2')).toBeInTheDocument();
    expect(within(card).getByText('Load shedding')).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /complete/i })).toBeNull();
    expect(within(card).queryByText('Task t1')).toBeNull();

    const completions = state.selects.find((s) => s.table === 'task_completions');
    expect(completions?.cols).toMatch(/\boutcome\b/);
    expect(completions?.cols).toMatch(/\breason\b/);

    // 1 completed of the 3 scored (t1, t3, t4); t2 is neither done nor not-done.
    expect(screen.getByText('1 / 3 tasks')).toBeInTheDocument();
    expect(screen.getByText('33%')).toBeInTheDocument();
    expect(screen.getByText("Can't do: 1")).toBeInTheDocument();
    expect(screen.getByText('Issues: 1')).toBeInTheDocument();
  });

  it('exports the reason in its own CSV column: the label for a can\'t-do row, empty otherwise', async () => {
    render(<ChecklistsTab buildingId="b1" buildingName="Alpha Court" />);
    await screen.findByText("Can't do (1)");
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));

    expect(exportCsv).toHaveBeenCalledTimes(1);
    const [rows, columns] = vi.mocked(exportCsv).mock.calls[0];
    expect(columns.map((c) => c.header)).toContain('Reason');
    // Only the two columns under test go through the real builder: the "Completed at" instant
    // carries a comma and is quoted, which a plain split on ',' cannot read.
    const narrow = columns.filter((c) => c.header === 'Task' || c.header === 'Reason');
    const lines = toCsv(rows, narrow).replace(/^﻿/, '').trim().split('\r\n').map((l) => l.split(','));
    expect(lines[0]).toEqual(['Task', 'Reason']);
    const reasonOf = (taskName: string) => lines.find((l) => l[0] === taskName)?.[1];
    expect(reasonOf('Task t2')).toBe('Load shedding');
    expect(reasonOf('Task t3')).toBe('');
    expect(reasonOf('Task t1')).toBe('');
  });

  it('shows neither the card nor the legend entry when nothing is can\'t-do', async () => {
    state.tasks = [task('t1', 'pending'), task('t3', 'completed')];
    state.completions = [completion('t3', 'completed', null)];
    render(<ChecklistsTab buildingId="b1" buildingName="Alpha Court" />);
    expect(await screen.findByText('1 / 2 tasks')).toBeInTheDocument();
    expect(screen.queryByText(/Can't do \(/)).toBeNull();
    expect(screen.queryByText(/Can't do:/)).toBeNull();
  });
});
