import { describe, it, expect } from 'vitest';
import { PUSH_NAME_MAX, SECTION_MAX, composeDigest, coverageSummary, dueTodayPush, type CoverageRow } from '../../supabase/functions/_shared/digest';

const TODAY = '2026-09-11';

const empty = { today: TODAY, tasks: [], issues: [], expiring: null, unread: 0 };

describe('composeDigest', () => {
  it('returns null when there is nothing to say', () => {
    expect(composeDigest(empty)).toBeNull();
  });

  it('splits tasks into overdue and due-today by the today string', () => {
    const sections = composeDigest({
      ...empty,
      tasks: [
        { id: 't1', task_name: 'Fire extinguisher check', due_date: '2026-09-09', building_name: 'Alpha Court' },
        { id: 't2', task_name: 'Roof inspection', due_date: '2026-09-10', building_name: null },
        { id: 't3', task_name: 'Generator run-up', due_date: TODAY, building_name: 'Beta Place' },
      ],
    });
    expect(sections).not.toBeNull();
    expect(sections!.map((s) => s.heading)).toEqual(['2 overdue tasks', '1 due today']);
    expect(sections![0].lines).toEqual(['Fire extinguisher check — Alpha Court', 'Roof inspection']);
    expect(sections![1].lines).toEqual(['Generator run-up — Beta Place']);
  });

  it('singularises a lone overdue task', () => {
    const sections = composeDigest({
      ...empty,
      tasks: [{ id: 't1', task_name: 'Roof inspection', due_date: '2026-09-01', building_name: null }],
    });
    expect(sections!.map((s) => s.heading)).toEqual(['1 overdue task']);
  });

  it('lists open issues with priority and building', () => {
    const sections = composeDigest({
      ...empty,
      issues: [
        { id: 'i1', title: 'Lift stuck', priority: 'high', building_name: 'Alpha Court' },
        { id: 'i2', title: 'Leaking tap', priority: 'low', building_name: null },
      ],
    });
    expect(sections!.map((s) => s.heading)).toEqual(['2 open issues assigned to you']);
    expect(sections![0].lines).toEqual(['Lift stuck (high) — Alpha Court', 'Leaking tap (low)']);
  });

  it('gives an unread-only digest one section with no lines', () => {
    const sections = composeDigest({ ...empty, unread: 3 });
    expect(sections).toHaveLength(1);
    expect(sections![0]).toEqual({ heading: '3 unread notifications', lines: [] });
  });

  it('singularises a lone unread notification', () => {
    const sections = composeDigest({ ...empty, unread: 1 });
    expect(sections![0].heading).toBe('1 unread notification');
  });

  it('ignores tasks due after today', () => {
    expect(
      composeDigest({
        ...empty,
        tasks: [{ id: 't1', task_name: 'Later', due_date: '2026-09-20', building_name: null }],
      }),
    ).toBeNull();
  });

  it('orders the sections overdue, today, issues, expiring, unread', () => {
    const sections = composeDigest({
      today: TODAY,
      tasks: [
        { id: 't1', task_name: 'Old', due_date: '2026-09-01', building_name: null },
        { id: 't2', task_name: 'Now', due_date: TODAY, building_name: null },
      ],
      issues: [{ id: 'i1', title: 'Lift stuck', priority: 'high', building_name: null }],
      expiring: { expired: 0, d30: 1, d60: 0, d90: 0 },
      unread: 2,
    });
    expect(sections!.map((s) => s.heading)).toEqual([
      '1 overdue task',
      '1 due today',
      '1 open issue assigned to you',
      '1 expiring document, warranty or service',
      '2 unread notifications',
    ]);
  });

  it('lists the expiry buckets that have anything in them, with the total in the heading', () => {
    const sections = composeDigest({ ...empty, expiring: { expired: 1, d30: 3, d60: 0, d90: 2 } });
    expect(sections).toHaveLength(1);
    expect(sections![0].heading).toBe('6 expiring documents, warranties and services');
    expect(sections![0].lines).toEqual(['1 already expired', '3 within 30 days', '2 within 61–90 days']);
  });

  it('adds no expiry section when every bucket is zero', () => {
    expect(composeDigest({ ...empty, expiring: { expired: 0, d30: 0, d60: 0, d90: 0 } })).toBeNull();
    expect(composeDigest({ ...empty, unread: 1, expiring: { expired: 0, d30: 0, d60: 0, d90: 0 } })).toHaveLength(1);
  });

  const overdueTasks = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `t${i}`,
      task_name: `Task ${i}`,
      due_date: '2026-09-01',
      building_name: null,
    }));

  it('caps a section at SECTION_MAX lines and says how many were left out', () => {
    const sections = composeDigest({ ...empty, tasks: overdueTasks(SECTION_MAX + 1) });
    // The heading still carries the true count — only the list is trimmed.
    expect(sections![0].heading).toBe('16 overdue tasks');
    expect(sections![0].lines).toHaveLength(SECTION_MAX + 1);
    expect(sections![0].lines.slice(0, SECTION_MAX)).toEqual(
      overdueTasks(SECTION_MAX).map((t) => t.task_name),
    );
    expect(sections![0].lines[SECTION_MAX]).toBe('…and 1 more');
  });

  it('adds no trailer at exactly SECTION_MAX lines', () => {
    const sections = composeDigest({ ...empty, tasks: overdueTasks(SECTION_MAX) });
    expect(sections![0].heading).toBe('15 overdue tasks');
    expect(sections![0].lines).toHaveLength(SECTION_MAX);
    expect(sections![0].lines.some((l) => l.includes('more'))).toBe(false);
  });

  it('caps the issues section too, counting only the overflow', () => {
    const sections = composeDigest({
      ...empty,
      issues: Array.from({ length: SECTION_MAX + 4 }, (_, i) => ({
        id: `i${i}`,
        title: `Issue ${i}`,
        priority: 'low',
        building_name: null,
      })),
    });
    expect(sections![0].lines).toHaveLength(SECTION_MAX + 1);
    expect(sections![0].lines[SECTION_MAX]).toBe('…and 4 more');
  });
});

describe('dueTodayPush', () => {
  const task = (id: string, task_name: string, due_date: string) => ({ id, task_name, due_date, building_name: null });

  it('returns null when nothing is due on or before today', () => {
    expect(dueTodayPush([], TODAY)).toBeNull();
    expect(dueTodayPush([task('t1', 'Later', '2026-09-20')], TODAY)).toBeNull();
  });

  it('names a single task due today', () => {
    expect(dueTodayPush([task('t1', 'Roof inspection', TODAY)], TODAY)).toEqual({
      title: '1 task due today',
      body: 'Roof inspection',
    });
  });

  it('quotes the first two names and an ellipsis for the rest', () => {
    const tasks = [task('t1', 'A', TODAY), task('t2', 'B', TODAY), task('t3', 'C', TODAY), task('t4', 'D', TODAY)];
    expect(dueTodayPush(tasks, TODAY)).toEqual({ title: '4 tasks due today', body: 'A · B …' });
    // Exactly PUSH_NAME_MAX names get no trailer.
    expect(dueTodayPush(tasks.slice(0, PUSH_NAME_MAX), TODAY)!.body).toBe('A · B');
  });

  it('leads with the overdue split when any task is late', () => {
    const tasks = [
      task('t1', 'Fire extinguisher check', '2026-09-09'),
      task('t2', 'Roof inspection', '2026-09-10'),
      task('t3', 'Generator run-up', TODAY),
      task('t4', 'Lift service', TODAY),
      task('t5', 'Pump test', TODAY),
    ];
    expect(dueTodayPush(tasks, TODAY)).toEqual({
      title: '5 tasks due today',
      body: '2 overdue · 3 due today — Fire extinguisher check · Roof inspection …',
    });
  });

  it('says only "overdue" when nothing is due today itself', () => {
    expect(dueTodayPush([task('t1', 'Old', '2026-09-01')], TODAY)).toEqual({
      title: '1 task due today',
      body: '1 overdue — Old',
    });
  });

  it('ignores future tasks when counting and naming', () => {
    const tasks = [task('t1', 'Now', TODAY), task('t2', 'Later', '2026-09-20')];
    expect(dueTodayPush(tasks, TODAY)).toEqual({ title: '1 task due today', body: 'Now' });
  });
});

describe('coverage section', () => {
  // Only the columns the digest reads (its CoverageRow is a subset of the RPC row on purpose).
  const cov = (over: Partial<CoverageRow>): CoverageRow => ({
    building_id: 'b', building_name: 'B', field_members: 1,
    unassigned_open: 0, due_yesterday: 0, completed_yesterday: 0, ...over,
  });

  it('coverageSummary names no-team buildings, totals unassigned work and finds silent buildings', () => {
    expect(coverageSummary([
      cov({ building_name: 'Alpha Court', field_members: 0, unassigned_open: 2 }),
      cov({ building_name: 'Beta Place', unassigned_open: 3, due_yesterday: 4, completed_yesterday: 0 }),
      cov({ building_name: 'Gamma House', due_yesterday: 2, completed_yesterday: 1 }),
      cov({ building_name: 'Delta Row', due_yesterday: 0, completed_yesterday: 0 }),
    ])).toEqual({ noTeam: ['Alpha Court'], unassignedOpen: 5, silentYesterday: ['Beta Place'] });
  });

  it('coverageSummary is null when there is nothing to say', () => {
    expect(coverageSummary([cov({}), cov({ building_name: 'C' })])).toBeNull();
    expect(coverageSummary([])).toBeNull();
  });

  it('composeDigest adds a Coverage section between expiring and unread, worded per line', () => {
    const sections = composeDigest({
      ...empty,
      unread: 1,
      expiring: { expired: 1, d30: 0, d60: 0, d90: 0 },
      coverage: { noTeam: ['Alpha Court', 'Beta Place'], unassignedOpen: 5, silentYesterday: ['Gamma House'] },
    });
    expect(sections!.map((s) => s.heading)).toEqual([
      '1 expiring document, warranty or service',
      'Coverage: 2 buildings with no field team, 1 silent yesterday',
      '1 unread notification',
    ]);
    expect(sections![1].lines).toEqual([
      'Alpha Court has no field team',
      'Beta Place has no field team',
      '5 open tasks have nobody assigned',
      'Nothing was logged yesterday at Gamma House',
    ]);
  });

  it('singularises the unassigned line and omits it at zero', () => {
    expect(composeDigest({ ...empty, coverage: { noTeam: [], unassignedOpen: 1, silentYesterday: [] } })![0].lines).toEqual(['1 open task has nobody assigned']);
    expect(composeDigest({ ...empty, coverage: { noTeam: ['A'], unassignedOpen: 0, silentYesterday: [] } })![0].lines).toEqual(['A has no field team']);
  });

  it('caps the no-team list at SECTION_MAX and still appends the other lines', () => {
    const noTeam = Array.from({ length: SECTION_MAX + 2 }, (_, i) => `Building ${i}`);
    const lines = composeDigest({ ...empty, coverage: { noTeam, unassignedOpen: 2, silentYesterday: ['Z'] } })![0].lines;
    expect(lines).toHaveLength(SECTION_MAX + 3);
    expect(lines[SECTION_MAX]).toBe('…and 2 more');
    expect(lines.slice(-2)).toEqual(['2 open tasks have nobody assigned', 'Nothing was logged yesterday at Z']);
  });

  it('caps the silent-yesterday list at SECTION_MAX too, with the true counts in the heading', () => {
    const silentYesterday = Array.from({ length: SECTION_MAX + 3 }, (_, i) => `Building ${i}`);
    const [section] = composeDigest({ ...empty, coverage: { noTeam: ['A'], unassignedOpen: 0, silentYesterday } })!;
    expect(section.heading).toBe(`Coverage: 1 building with no field team, ${SECTION_MAX + 3} silent yesterday`);
    expect(section.lines).toHaveLength(1 + SECTION_MAX + 1);
    expect(section.lines[0]).toBe('A has no field team');
    expect(section.lines[SECTION_MAX]).toBe(`Nothing was logged yesterday at Building ${SECTION_MAX - 1}`);
    expect(section.lines[SECTION_MAX + 1]).toBe('…and 3 more');
  });

  it('keeps a plain Coverage heading when only unassigned work is reported', () => {
    expect(composeDigest({ ...empty, coverage: { noTeam: [], unassignedOpen: 3, silentYesterday: [] } })![0].heading).toBe('Coverage');
  });

  it('adds no section for null or all-empty coverage (site users pass null)', () => {
    expect(composeDigest({ ...empty, coverage: null })).toBeNull();
    expect(composeDigest({ ...empty, coverage: { noTeam: [], unassignedOpen: 0, silentYesterday: [] } })).toBeNull();
  });
});
