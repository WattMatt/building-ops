/**
 * `gridCellText` / `gridCsvColumns` are the only pure logic in the CSV half of the export work
 * and all thirteen report grids route through them, so every column TYPE is pinned here.
 *
 * The second half is a round-trip of the issue register's real column set through `toCsv`:
 * a column set that is only ever exercised by clicking a button is a column set nobody notices
 * is missing a column (`category` was, for exactly that reason).
 */
import { describe, it, expect, vi } from 'vitest';

// The issue register's column set lives on the page module; the detail dialog it also imports
// drags in heic2any (a Worker at import time), which jsdom has no answer for.
vi.mock('@/components/issues/IssueDetailDialog', () => ({ default: () => null }));

import { gridCellText, gridCsvColumns, TRISTATE_DEFAULTS, type GridColumn } from './EditableGrid';
import { toCsv } from '@/lib/exportCsv';
import { ISSUE_CSV_COLUMNS } from '@/pages/Issues';
import type { Issue } from '@/hooks/useIssues';

const col = (c: Partial<GridColumn> & { key: string }): GridColumn => ({ label: c.key, type: 'text', ...c });

describe('gridCellText', () => {
  it('text and number columns print the stored value; empty stays empty', () => {
    expect(gridCellText(col({ key: 'a' }), { a: 'Lift motor' })).toBe('Lift motor');
    expect(gridCellText(col({ key: 'n', type: 'number' }), { n: 0 })).toBe('0');
    expect(gridCellText(col({ key: 'a' }), { a: null })).toBe('');
    expect(gridCellText(col({ key: 'a' }), { a: '' })).toBe('');
    expect(gridCellText(col({ key: 'a' }), {})).toBe('');
  });

  it('date columns print the stored ISO date, not a parsed one', () => {
    expect(gridCellText(col({ key: 'd', type: 'date' }), { d: '2026-09-11' })).toBe('2026-09-11');
  });

  it('bool columns print Yes/No, never true/false', () => {
    const c = col({ key: 'b', type: 'bool' });
    expect(gridCellText(c, { b: true })).toBe('Yes');
    expect(gridCellText(c, { b: false })).toBe('No');
    expect(gridCellText(c, { b: null })).toBe('');
  });

  it('tristate columns fall back to the same options the select renders', () => {
    const c = col({ key: 't', type: 'tristate' });
    expect(TRISTATE_DEFAULTS.map((o) => o.value)).toEqual(['yes', 'no', 'na']);
    expect(gridCellText(c, { t: 'yes' })).toBe('Yes');
    expect(gridCellText(c, { t: 'na' })).toBe('N/A');
    // A value outside the option list is printed raw rather than dropped.
    expect(gridCellText(c, { t: 'maybe' })).toBe('maybe');
  });

  it('select columns export the option LABEL the author picked', () => {
    const c = col({ key: 's', type: 'select', options: [{ value: 'ppm', label: 'Planned maintenance' }] });
    expect(gridCellText(c, { s: 'ppm' })).toBe('Planned maintenance');
    expect(gridCellText(c, { s: 'other' })).toBe('other');
  });

  it('computed columns run compute, and format when the column has one', () => {
    const compute = (row: Record<string, unknown>) => (row.recovery as number) / (row.expense as number);
    expect(gridCellText(col({ key: 'pct', compute }), { recovery: 1, expense: 4 })).toBe('0.25');
    expect(
      gridCellText(col({ key: 'pct', compute, format: (v) => `${Math.round(Number(v) * 100)}%` }), { recovery: 1, expense: 4 }),
    ).toBe('25%');
    // The cell shows "—" for an empty computed value; the spreadsheet gets an empty cell.
    expect(gridCellText(col({ key: 'pct', compute: () => null }), {})).toBe('');
  });

  it('does NOT apply format to an editable column — the screen does not either', () => {
    // The cell is an <Input> bound to the stored value, so a formatted export would show the
    // reader something the author never saw.
    const c = col({ key: 'cost', type: 'number', format: (v) => `R ${v}` });
    expect(gridCellText(c, { cost: 1200 })).toBe('1200');
  });
});

describe('gridCsvColumns', () => {
  it('keeps the grid order and uses each column label as the header', () => {
    const columns = [col({ key: 'a', label: 'Service' }), col({ key: 'b', label: 'Done', type: 'bool' })];
    const csv = gridCsvColumns(columns);
    expect(csv.map((c) => c.header)).toEqual(['Service', 'Done']);
    expect(toCsv([{ a: 'Lift', b: true }], csv)).toContain('Lift,Yes');
  });
});

const issue = (over: Partial<Issue> = {}): Issue => ({
  id: 'i1',
  title: 'Leaking pipe',
  description: 'Water on the floor',
  priority: 'high',
  status: 'open',
  category: 'plumbing',
  deadline: '2026-09-20',
  created_at: '2026-09-01T08:00:00Z',
  building_id: 'b1',
  building_name: 'Alpha Tower',
  reported_by: 'u2',
  assigned_to: 'u1',
  corrective_action: null,
  photo_urls: null,
  task_instance_id: null,
  sla_target_hours: 24,
  sla_breached_at: null,
  first_response_at: null,
  resolved_at: null,
  ...over,
});

describe('ISSUE_CSV_COLUMNS', () => {
  const headerOf = (csv: string) => csv.replace(/^\uFEFF/, '').split('\r\n')[0].split(',');
  const cellsOf = (csv: string) => csv.replace(/^\uFEFF/, '').split('\r\n')[1].split(',');

  it('carries the columns the register pins on screen, category included', () => {
    const headers = headerOf(toCsv([issue()], ISSUE_CSV_COLUMNS));
    expect(headers).toEqual([
      'Title',
      'Building',
      'Priority',
      'Status',
      'Category',
      'Reported',
      'Deadline',
      'Resolved at',
      'SLA target (hours)',
      'SLA due',
      'SLA state',
      'SLA breached at',
      'First response',
      'Corrective action',
    ]);
  });

  it('round-trips a row: labels not enum values, formatted instants, no raw uuids', () => {
    const csv = toCsv([issue()], ISSUE_CSV_COLUMNS);
    const cells = cellsOf(csv);
    const at = (header: string) => cells[headerOf(csv).indexOf(header)];
    expect(at('Title')).toBe('Leaking pipe');
    expect(at('Category')).toBe('plumbing');
    expect(at('Status')).toBe('Open'); // the label, not `open`
    expect(at('Reported')).not.toBe('2026-09-01T08:00:00Z'); // wall-clock, not a raw ISO string
    expect(at('SLA state')).toBeTruthy();
    // The assignee is a uuid on this row and must not reach the file at all.
    expect(csv).not.toContain('u1');
  });

  it('leaves every optional column blank rather than printing null', () => {
    const cells = cellsOf(toCsv([issue({ building_name: undefined, deadline: null, category: null })], ISSUE_CSV_COLUMNS));
    expect(cells).not.toContain('null');
    expect(cells).not.toContain('undefined');
  });
});
