import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

vi.mock('@/components/people/AssigneePicker', () => ({ AssigneePicker: () => null }));
vi.mock('@/components/evidence/EvidencePackMenu', () => ({ EvidencePackMenu: () => <span>evidence pack</span> }));

import { TasksList, type TaskInstance } from './TasksList';

function task(id: string, status: TaskInstance['status'], extra: Partial<TaskInstance> = {}): TaskInstance {
  return {
    id, task_name: `Task ${id}`, task_description: null, frequency: 'daily', status, due_date: '2026-09-13',
    requires_photo: false, requires_signature: false, responsible_role: 'user', building_id: 'b1', category: null,
    assigned_to: null, ...extra,
  };
}

const props = {
  onComplete: vi.fn(), onReportIssue: vi.fn(), buildingId: 'b1',
  nameOf: (id: string | null) => (id === 'u1' ? 'Thabo M' : null),
  canAssign: () => true, onAssign: vi.fn(),
};

describe('TasksList — can\'t do', () => {
  it('shows the Can\'t do badge, who closed it, the reason, and offers no actions', () => {
    const wontDo = task('t2', 'wont_do', {
      completion: { completed_by: 'u1', completed_at: '2026-09-13T08:00:00Z', outcome: 'wont_do', reason: 'load_shedding' },
    });
    render(<TasksList {...props} tasks={[task('t1', 'pending'), wontDo]} showEvidencePack buildingName="Alpha Court" />);

    const row = screen.getByText('Task t2').closest('.rounded-lg') as HTMLElement;
    expect(within(row).getByText("Can't do")).toBeInTheDocument();
    expect(within(row).getByText('Load shedding')).toBeInTheDocument();
    expect(within(row).getByText(/Thabo M/)).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /complete/i })).toBeNull();
    expect(within(row).queryByRole('button', { name: /issue/i })).toBeNull();
    expect(within(row).queryByRole('button', { name: /change assignee/i })).toBeNull();
    // A can't-do is a closed record and can be handed over like a completion.
    expect(within(row).getByText('evidence pack')).toBeInTheDocument();

    const pendingRow = screen.getByText('Task t1').closest('.rounded-lg') as HTMLElement;
    expect(within(pendingRow).getByRole('button', { name: /complete/i })).toBeInTheDocument();
    expect(within(pendingRow).getByRole('button', { name: /change assignee/i })).toBeInTheDocument();
  });

  it('prints the free text itself for an "other" reason and nothing when there is no reason', () => {
    render(<TasksList {...props} tasks={[
      task('t3', 'wont_do', { completion: { completed_by: 'u1', completed_at: null, outcome: 'wont_do', reason: 'other: gate welded shut' } }),
      task('t4', 'wont_do'),
    ]} />);
    expect(screen.getByText('gate welded shut')).toBeInTheDocument();
    const bare = screen.getByText('Task t4').closest('.rounded-lg') as HTMLElement;
    expect(within(bare).getByText("Can't do")).toBeInTheDocument();
    expect(within(bare).queryByText(/Other/)).toBeNull();
  });

  it('keeps a completed row as it was: Done badge, strike-through, no actions', () => {
    render(<TasksList {...props} tasks={[task('t5', 'completed', { completion: { completed_by: 'u1', completed_at: '2026-09-13T08:00:00Z' } })]} />);
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('Task t5').className).toMatch(/line-through/);
    expect(screen.queryByRole('button', { name: /complete/i })).toBeNull();
  });
});
