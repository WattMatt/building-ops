import { describe, it, expect } from 'vitest';
import { renderIcs, escapeIcsText, foldIcsLine, nextDay, type CalendarEvent } from './ics';

const NOW = new Date('2026-09-10T08:05:09.123Z');
const APP = 'https://ops.example.com';

const ev = (over: Partial<CalendarEvent>): CalendarEvent => ({
  id: 'task-t1',
  kind: 'task',
  title: 'Check fire doors',
  date: '2026-09-12',
  buildingId: 'b-1',
  buildingName: 'Fortress House',
  href: '/buildings/b-1?tab=checklists',
  status: 'open',
  entityId: 't1',
  ...over,
});

const render = (events: CalendarEvent[]) => renderIcs(events, { name: 'Building Ops · My calendar', appUrl: APP, now: NOW });
const lines = (ics: string) => ics.split('\r\n');
const unfold = (ics: string) => ics.replace(/\r\n[ \t]/g, '');
const octets = (s: string) => new TextEncoder().encode(s).length;

describe('renderIcs', () => {
  it('renders a valid empty calendar with CRLF endings', () => {
    const ics = render([]);
    const ls = lines(ics);
    expect(ls[0]).toBe('BEGIN:VCALENDAR');
    expect(ls).toContain('VERSION:2.0');
    expect(ls).toContain('PRODID:-//Building Ops//EN');
    expect(ls).toContain('CALSCALE:GREGORIAN');
    expect(ls).toContain('X-WR-CALNAME:Building Ops · My calendar');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).not.toContain('VEVENT');
    // No bare LF anywhere.
    expect(ics.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('renders every field of a VEVENT', () => {
    const ls = lines(unfold(render([ev({})])));
    const body = ls.slice(ls.indexOf('BEGIN:VEVENT'), ls.indexOf('END:VEVENT') + 1);
    expect(body).toEqual([
      'BEGIN:VEVENT',
      'UID:task-t1@buildingops.app',
      'DTSTAMP:20260910T080509Z',
      'DTSTART;VALUE=DATE:20260912',
      'DTEND;VALUE=DATE:20260913',
      'SUMMARY:Check fire doors · Fortress House',
      'DESCRIPTION:Task — open',
      'URL:https://ops.example.com/buildings/b-1?tab=checklists',
      'STATUS:CONFIRMED',
      'CATEGORIES:TASK',
      'END:VEVENT',
    ]);
  });

  it('omits the building suffix when there is no building name', () => {
    expect(unfold(render([ev({ buildingName: null })]))).toContain('SUMMARY:Check fire doors\r\n');
  });

  it('escapes backslash, semicolon, comma and newline in text values', () => {
    const ics = unfold(render([ev({ title: 'Fix; leak, roof\\door\nnow', buildingName: 'A, B' })]));
    expect(ics).toContain('SUMMARY:Fix\; leak\\, roof\\\\door\\nnow · A\\, B\r\n');
    expect(escapeIcsText('a\r\nb')).toBe('a\\nb');
  });

  it('folds long lines at 75 octets and unfolding restores the text', () => {
    const title = 'x'.repeat(200);
    const ics = render([ev({ title })]);
    for (const l of lines(ics)) expect(octets(l)).toBeLessThanOrEqual(75);
    expect(ics).toContain('\r\n ');
    expect(lines(unfold(ics))).toContain(`SUMMARY:${title} · Fortress House`);
  });

  it('folds by octets, never splitting a multi-byte character', () => {
    const title = 'é'.repeat(120); // 2 octets each
    const ics = render([ev({ title })]);
    for (const l of lines(ics)) {
      expect(octets(l)).toBeLessThanOrEqual(75);
      expect(l).not.toContain('�');
    }
    expect(lines(unfold(ics))).toContain(`SUMMARY:${title} · Fortress House`);
    expect(foldIcsLine('€'.repeat(30))).toBe('€'.repeat(25) + '\r\n ' + '€'.repeat(5));
  });

  it('computes DTEND as the following day across month, year and leap boundaries', () => {
    expect(nextDay('2026-09-30')).toBe('2026-10-01');
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
    expect(nextDay('2028-02-29')).toBe('2028-03-01');
    expect(nextDay('2027-02-28')).toBe('2027-03-01');
    const ics = unfold(render([ev({ date: '2026-12-31' })]));
    expect(ics).toContain('DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101');
  });

  it('orders events deterministically regardless of input order', () => {
    const a = ev({ id: 'task-a', entityId: 'a', date: '2026-09-12', title: 'A' });
    const b = ev({ id: 'issue-b', entityId: 'b', kind: 'issue', date: '2026-09-11', title: 'B' });
    const c = ev({ id: 'task-c', entityId: 'c', date: '2026-09-12', title: 'C' });
    const uids = (ics: string) => lines(ics).filter((l) => l.startsWith('UID:'));
    expect(uids(render([c, a, b]))).toEqual(['UID:issue-b@buildingops.app', 'UID:task-a@buildingops.app', 'UID:task-c@buildingops.app']);
    expect(render([c, a, b])).toBe(render([a, b, c]));
  });

  it('uses the event id for PPM UIDs so each month cell stays unique', () => {
    const ics = render([ev({ id: 'ppm-p1-2026-09', kind: 'ppm', entityId: 'p1' })]);
    expect(ics).toContain('UID:ppm-p1-2026-09@buildingops.app');
    expect(ics).toContain('CATEGORIES:PPM');
  });

  it('honours a custom prodId', () => {
    expect(renderIcs([], { name: 'x', appUrl: APP, now: NOW, prodId: '-//Test//EN' })).toContain('PRODID:-//Test//EN');
  });
});
