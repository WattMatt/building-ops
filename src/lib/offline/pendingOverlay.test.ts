import { describe, it, expect } from 'vitest';
import { failedTaskIds, queuedIssues, queuedTaskIds } from './pendingOverlay';
import type { QueuedOp, OpPayload } from './types';

function op(payload: OpPayload, extra: Partial<QueuedOp> = {}): QueuedOp {
  return {
    id: `op-${payload.kind}-${Math.random().toString(36).slice(2, 8)}`,
    uid: 'u1',
    createdAt: 1_757_500_000_000,
    attempts: 0,
    status: 'pending',
    lastError: null,
    photos: [],
    payload,
    ...extra,
  };
}

const complete = (taskInstanceId: string): OpPayload => ({
  kind: 'task_complete',
  completionId: `c-${taskInstanceId}`,
  taskInstanceId,
  taskName: 'Check',
  notes: null,
  signatureConfirmed: false,
});

const create = (issueId: string, building_id: string): OpPayload => ({
  kind: 'issue_create',
  issueId,
  row: {
    title: `Issue ${issueId}`,
    description: 'desc',
    priority: 'high',
    status: 'open',
    building_id,
    deadline: null,
    corrective_action: null,
    reported_by: 'u1',
    assigned_to: null,
    task_instance_id: null,
  },
  markTaskIssueLogged: null,
});

const comment: OpPayload = {
  kind: 'issue_comment',
  activityId: 'a1',
  issueId: 'i9',
  issueTitle: 'x',
  buildingId: 'b1',
  comment: 'hi',
  mentions: [],
  notifyOthers: [],
  userEmail: null,
};

describe('queuedTaskIds', () => {
  it('collects pending and failed task completions and ignores other kinds', () => {
    const ids = queuedTaskIds([
      op(complete('t1')),
      op(complete('t2'), { status: 'failed', lastError: 'nope' }),
      op(comment),
      op(create('i1', 'b1')),
    ]);
    expect(ids).toEqual(new Set(['t1', 't2']));
  });

  it('is empty for an empty queue', () => {
    expect(queuedTaskIds([]).size).toBe(0);
  });
});

describe('failedTaskIds', () => {
  it('only reports completions the backend rejected', () => {
    const ids = failedTaskIds([op(complete('t1')), op(complete('t2'), { status: 'failed' })]);
    expect(ids).toEqual(new Set(['t2']));
  });
});

describe('queuedIssues', () => {
  it('shapes issue_create ops as list rows with the building name looked up', () => {
    const rows = queuedIssues(
      [op(create('i1', 'b1'), { createdAt: Date.UTC(2026, 8, 10, 8, 0, 0) }), op(comment)],
      new Map([['b1', 'Alpha Tower']]),
    );
    expect(rows).toEqual([
      {
        id: 'i1',
        title: 'Issue i1',
        description: 'desc',
        priority: 'high',
        status: 'open',
        building_id: 'b1',
        building_name: 'Alpha Tower',
        created_at: '2026-09-10T08:00:00.000Z',
        deadline: null,
        queued: true,
        failed: false,
      },
    ]);
  });

  it('accepts a plain record of names and flags failed ops', () => {
    const rows = queuedIssues([op(create('i2', 'b2'), { status: 'failed' })], { b2: 'Beta House' });
    expect(rows[0]).toMatchObject({ id: 'i2', building_name: 'Beta House', failed: true });
  });

  it('falls back to an empty name for a building it cannot resolve', () => {
    const rows = queuedIssues([op(create('i3', 'b-unknown'))], new Map());
    expect(rows[0].building_name).toBe('');
  });

  it('preserves queue order', () => {
    const rows = queuedIssues(
      [op(create('first', 'b1'), { createdAt: 1 }), op(create('second', 'b1'), { createdAt: 2 })],
      {},
    );
    expect(rows.map((r) => r.id)).toEqual(['first', 'second']);
  });
});
