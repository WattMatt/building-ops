import { describe, it, expect } from 'vitest';
import {
  CALENDAR_KINDS,
  KIND_LABELS,
  KIND_COLORS,
  taskEvent,
  issueEvent,
  documentEvent,
  assetEvent,
  ppmEvents,
  signoffEvent,
  reportEvent,
  sortEvents,
  groupByDate,
  inRange,
  type CalendarEvent,
} from './events';

const TODAY = '2026-09-10';
const B = 'b-1';
const BN = 'Fortress House';

const ev = (over: Partial<CalendarEvent>): CalendarEvent => ({
  id: 'task-x',
  kind: 'task',
  title: 'x',
  date: TODAY,
  buildingId: B,
  buildingName: BN,
  href: '/',
  status: 'open',
  entityId: 'x',
  ...over,
});

describe('taskEvent', () => {
  const row = { id: 't1', task_name: 'Check fire doors', due_date: '2026-09-12', status: 'pending', building_id: B };

  it('maps the row and links to the checklists tab', () => {
    const e = taskEvent(row, BN, TODAY);
    expect(e).toEqual({
      id: 'task-t1',
      kind: 'task',
      title: 'Check fire doors',
      date: '2026-09-12',
      buildingId: B,
      buildingName: BN,
      href: `/buildings/${B}?tab=checklists`,
      status: 'open',
      entityId: 't1',
    });
  });

  it('is overdue when pending and due before today, or when the row says so', () => {
    expect(taskEvent({ ...row, due_date: '2026-09-09' }, BN, TODAY).status).toBe('overdue');
    expect(taskEvent({ ...row, due_date: TODAY }, BN, TODAY).status).toBe('open');
    expect(taskEvent({ ...row, status: 'overdue', due_date: '2026-09-20' }, BN, TODAY).status).toBe('overdue');
  });

  it('is done when completed, even if the due date has passed', () => {
    expect(taskEvent({ ...row, status: 'completed', due_date: '2026-01-01' }, BN, TODAY).status).toBe('done');
  });

  it('tolerates a missing building name', () => {
    expect(taskEvent(row, null, TODAY).buildingName).toBeNull();
  });
});

describe('issueEvent', () => {
  const row = { id: 'i1', title: 'Leak in basement', deadline: '2026-09-15', status: 'open', building_id: B };

  it('returns null without a deadline', () => {
    expect(issueEvent({ ...row, deadline: null }, BN, TODAY)).toBeNull();
  });

  it('links to the issue via the open param', () => {
    expect(issueEvent(row, BN, TODAY)?.href).toBe('/issues?open=i1');
  });

  it('derives status from resolution and deadline', () => {
    expect(issueEvent(row, BN, TODAY)?.status).toBe('open');
    expect(issueEvent({ ...row, deadline: '2026-09-01' }, BN, TODAY)?.status).toBe('overdue');
    expect(issueEvent({ ...row, deadline: '2026-09-01', status: 'in_progress' }, BN, TODAY)?.status).toBe('overdue');
    expect(issueEvent({ ...row, deadline: '2026-09-01', status: 'resolved' }, BN, TODAY)?.status).toBe('done');
    expect(issueEvent({ ...row, deadline: '2026-09-01', status: 'closed' }, BN, TODAY)?.status).toBe('done');
  });
});

describe('documentEvent', () => {
  const row = { id: 'd1', name: 'Fire certificate', expiry_date: '2026-10-01', building_id: B };

  it('returns null without an expiry date', () => {
    expect(documentEvent({ ...row, expiry_date: null }, BN, TODAY)).toBeNull();
  });

  it('is open until the expiry passes, then overdue', () => {
    expect(documentEvent(row, BN, TODAY)?.status).toBe('open');
    expect(documentEvent({ ...row, expiry_date: TODAY }, BN, TODAY)?.status).toBe('open');
    expect(documentEvent({ ...row, expiry_date: '2026-09-09' }, BN, TODAY)?.status).toBe('overdue');
  });

  it('links to the documents tab', () => {
    const e = documentEvent(row, BN, TODAY)!;
    expect(e.href).toBe(`/buildings/${B}?tab=documents`);
    expect(e.id).toBe('document-d1');
    expect(e.kind).toBe('document');
  });
});

describe('assetEvent', () => {
  const row = { id: 'a1', name: 'Lift 2', next_service_date: '2026-09-20', building_id: B };

  it('returns null without a next service date', () => {
    expect(assetEvent({ ...row, next_service_date: null }, BN, TODAY)).toBeNull();
  });

  it('is overdue once the service date has passed', () => {
    expect(assetEvent(row, BN, TODAY)?.status).toBe('open');
    expect(assetEvent({ ...row, next_service_date: '2026-09-01' }, BN, TODAY)?.status).toBe('overdue');
  });

  it('links to the assets tab', () => {
    expect(assetEvent(row, BN, TODAY)?.href).toBe(`/buildings/${B}?tab=assets`);
  });
});

describe('ppmEvents', () => {
  const row = {
    id: 'p1',
    service_name: 'Generator service',
    building_id: B,
    report_id: 'r9',
    months: {
      '2026-08': { status: 'missed' as const },
      '2026-09': { status: 'due' as const, date: '2026-09-15' },
      '2026-10': { status: 'done' as const, date: '2026-10-03' },
      '2026-11': { status: 'na' as const },
      '2026-12': { status: 'due' as const },
      '2027-01': {},
    },
  };

  it('expands only due and missed cells, one event each, dated by the cell or the 1st', () => {
    const out = ppmEvents(row, BN, TODAY);
    expect(out.map((e) => [e.date, e.status])).toEqual([
      ['2026-08-01', 'overdue'],
      ['2026-09-15', 'open'],
      ['2026-12-01', 'open'],
    ]);
    expect(new Set(out.map((e) => e.id)).size).toBe(3);
    expect(out.every((e) => e.entityId === 'p1' && e.kind === 'ppm' && e.title === 'Generator service')).toBe(true);
  });

  it('marks a due cell whose day has passed as overdue', () => {
    const out = ppmEvents({ ...row, months: { '2026-09': { status: 'due', date: '2026-09-02' } } }, BN, TODAY);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('overdue');
  });

  it('links to the Fortress report when the row has one, else the maintenance tab', () => {
    expect(ppmEvents(row, BN, TODAY)[0].href).toBe('/reports/fortress/r9');
    expect(ppmEvents({ ...row, report_id: null }, BN, TODAY)[0].href).toBe(`/buildings/${B}?tab=maintenance`);
  });

  it('returns nothing for a row without a months grid, or with malformed jsonb', () => {
    expect(ppmEvents({ ...row, months: null }, BN, TODAY)).toEqual([]);
    expect(ppmEvents({ ...row, months: 'oops' }, BN, TODAY)).toEqual([]);
    expect(ppmEvents({ ...row, months: [1, 2] }, BN, TODAY)).toEqual([]);
    expect(ppmEvents({ ...row, months: { '2026-09': 'due', '2026-10': { status: 'due', date: 7 } } }, BN, TODAY))
      .toEqual([expect.objectContaining({ date: '2026-10-01', status: 'open' })]);
  });

  describe('plan-backed rows (plan_service_id set)', () => {
    const overrides = {
      '2026-08': { status: 'missed', note: 'Contractor no-show', by: 'u1', at: '2026-09-01T08:00:00Z' },
      '2026-09': { status: 'done', note: '', by: 'u1', at: '2026-09-05T08:00:00Z' },
      '2026-10': { status: 'na', note: 'Decommissioned' },
      '2026-11': { status: 'due', note: 'Pinned' },
    };
    const planBacked = { ...row, plan_service_id: 'ps1', overrides };

    it('ignores the derived months grid and emits only due/missed override cells, on the 1st', () => {
      const out = ppmEvents(planBacked, BN, TODAY);
      expect(out.map((e) => [e.id, e.date, e.status])).toEqual([
        ['ppm-p1-2026-08', '2026-08-01', 'overdue'],
        ['ppm-p1-2026-11', '2026-11-01', 'open'],
      ]);
      expect(out.every((e) => e.kind === 'ppm' && e.entityId === 'p1' && e.href === '/reports/fortress/r9')).toBe(true);
      // The months grid holds a due cell for 2026-12 that a legacy row would emit; here it is a task already.
      expect(out.find((e) => e.date.startsWith('2026-12'))).toBeUndefined();
    });

    it('a stray date on an override is ignored — pinned months have no day', () => {
      const out = ppmEvents({ ...planBacked, overrides: { '2026-09': { status: 'due', date: '2026-09-15' } } }, BN, TODAY);
      expect(out).toEqual([expect.objectContaining({ date: '2026-09-01', status: 'overdue' })]);
    });

    it('yields no events without overrides (empty, null, missing or malformed), whatever months holds', () => {
      expect(ppmEvents({ ...planBacked, overrides: {} }, BN, TODAY)).toEqual([]);
      expect(ppmEvents({ ...planBacked, overrides: null }, BN, TODAY)).toEqual([]);
      expect(ppmEvents({ ...row, plan_service_id: 'ps1' }, BN, TODAY)).toEqual([]);
      expect(ppmEvents({ ...planBacked, overrides: [1] }, BN, TODAY)).toEqual([]);
      expect(ppmEvents({ ...planBacked, overrides: { '2026-09': 'due' } }, BN, TODAY)).toEqual([]);
    });

    it('a legacy row (no plan_service_id) is unchanged even when overrides are present', () => {
      const legacy = { ...row, plan_service_id: null, overrides };
      expect(ppmEvents(legacy, BN, TODAY)).toEqual(ppmEvents(row, BN, TODAY));
      expect(ppmEvents(legacy, BN, TODAY).map((e) => e.date)).toEqual(['2026-08-01', '2026-09-15', '2026-12-01']);
    });
  });
});

describe('signoffEvent', () => {
  const req = { id: 's1', submission_id: 'sub1', due_at: '2026-09-14T22:30:00Z', status: 'pending' };
  const sub = { form_name: 'Fire drill record', building_id: B };

  it('returns null without a due date or without a visible submission', () => {
    expect(signoffEvent({ ...req, due_at: null }, sub, BN, TODAY)).toBeNull();
    expect(signoffEvent(req, null, BN, TODAY)).toBeNull();
  });

  it('converts due_at to the SAST calendar day (22:30Z is the next day in Johannesburg)', () => {
    const e = signoffEvent(req, sub, BN, TODAY)!;
    expect(e.date).toBe('2026-09-15');
    expect(e.title).toBe('Fire drill record');
    expect(e.buildingId).toBe(B);
    expect(e.href).toBe('/my-signoffs');
    expect(e.entityId).toBe('s1');
    expect(e.status).toBe('open');
  });

  it('is done once signed, na when declined or rejected, overdue when the SAST day has passed', () => {
    expect(signoffEvent({ ...req, status: 'signed' }, sub, BN, TODAY)?.status).toBe('done');
    expect(signoffEvent({ ...req, status: 'expired' }, sub, BN, TODAY)?.status).toBe('done');
    // A declined sign-off is not completed work: the request says 'declined', its submission 'rejected'.
    expect(signoffEvent({ ...req, status: 'declined' }, sub, BN, TODAY)?.status).toBe('na');
    expect(signoffEvent({ ...req, status: 'rejected' }, sub, BN, TODAY)?.status).toBe('na');
    expect(signoffEvent({ ...req, status: 'declined', due_at: '2026-09-01T08:00:00Z' }, sub, BN, TODAY)?.status).toBe('na');
    expect(signoffEvent({ ...req, due_at: '2026-09-09T21:59:59Z' }, sub, BN, TODAY)?.status).toBe('overdue');
    // 22:00Z on the 9th is already the 10th in SAST, so it is still open today.
    expect(signoffEvent({ ...req, due_at: '2026-09-09T22:00:00Z' }, sub, BN, TODAY)?.status).toBe('open');
  });
});

describe('reportEvent', () => {
  const row = { id: 'r1', building_id: B, report_period: '2026-09-01', status: 'submitted' };

  it('maps the period date and links to the Fortress report', () => {
    const e = reportEvent(row, BN);
    expect(e.date).toBe('2026-09-01');
    expect(e.href).toBe('/reports/fortress/r1');
    expect(e.kind).toBe('report');
    expect(e.status).toBe('open');
  });

  it('is done when approved and never overdue, whatever today is', () => {
    expect(reportEvent({ ...row, status: 'approved' }, BN, TODAY).status).toBe('done');
    expect(reportEvent({ ...row, report_period: '2026-01-01' }, BN, TODAY).status).toBe('open');
  });
});

describe('sortEvents / groupByDate / inRange', () => {
  const events: CalendarEvent[] = [
    ev({ id: 'report-1', kind: 'report', date: '2026-09-12', title: 'B' }),
    ev({ id: 'task-2', kind: 'task', date: '2026-09-12', title: 'Zeta' }),
    ev({ id: 'task-1', kind: 'task', date: '2026-09-12', title: 'Alpha' }),
    ev({ id: 'issue-1', kind: 'issue', date: '2026-09-11', title: 'C' }),
  ];

  it('sorts by date, then kind order, then title, and does not mutate the input', () => {
    const copy = [...events];
    const sorted = sortEvents(events);
    expect(sorted.map((e) => e.id)).toEqual(['issue-1', 'task-1', 'task-2', 'report-1']);
    expect(events).toEqual(copy);
    expect(sortEvents([...events].reverse()).map((e) => e.id)).toEqual(sorted.map((e) => e.id));
  });

  it('groups by date keeping sorted order within each day', () => {
    const g = groupByDate(events);
    expect([...g.keys()]).toEqual(['2026-09-11', '2026-09-12']);
    expect(g.get('2026-09-12')!.map((e) => e.id)).toEqual(['task-1', 'task-2', 'report-1']);
    expect(g.get('2026-09-13')).toBeUndefined();
  });

  it('keeps events inside the inclusive range', () => {
    expect(inRange(events, '2026-09-12', '2026-09-12').map((e) => e.id).sort()).toEqual(['report-1', 'task-1', 'task-2']);
    expect(inRange(events, '2026-09-01', '2026-09-11')).toHaveLength(1);
    expect(inRange(events, '2026-10-01', '2026-10-31')).toEqual([]);
  });
});

describe('kind tables', () => {
  it('cover every kind with a label and token classes (no hex colours)', () => {
    for (const k of CALENDAR_KINDS) {
      expect(KIND_LABELS[k]).toBeTruthy();
      expect(KIND_COLORS[k]).toMatch(/^[a-z0-9/\- ]+$/i);
      expect(KIND_COLORS[k]).not.toContain('#');
    }
  });
});
