import { describe, it, expect } from 'vitest';
import fixture from '../../docs/fixtures/distribution-plan.json';
import {
  EXPIRY_DAYS_ALLOWED,
  EXPIRY_DAYS_DEFAULT,
  TOKEN_RE,
  addDays,
  distributionCopy,
  mintShareToken,
  monthStart,
  nextMonthStart,
  nextRunDates,
  passcodeHash,
  periodLabel,
  planFor,
  previousMonthStart,
  reminderCopy,
  reminderDateFor,
  sendDateFor,
} from '../../supabase/functions/_shared/distribution';

describe('planFor mirrors docs/fixtures/distribution-plan.json', () => {
  for (const row of fixture.planFor) {
    it(`${row.today} with send_day ${row.send_day}, remind ${row.remind_days_before} -> ${row.expect.action}${'period' in row.expect ? ` ${row.expect.period}` : ''}`, () => {
      expect(planFor(row.today, { send_day: row.send_day, remind_days_before: row.remind_days_before })).toEqual(row.expect);
    });
  }

  it('send wins over remind when the two coincide (remind_days_before = 0)', () => {
    expect(planFor('2026-10-07', { send_day: 7, remind_days_before: 0 })).toEqual({ action: 'send', period: '2026-09-01' });
  });
});

describe('nextRunDates mirrors docs/fixtures/distribution-plan.json', () => {
  for (const row of fixture.nextRunDates) {
    it(`${row.today} with send_day ${row.send_day}, remind ${row.remind_days_before} -> ${row.expect.nextSend}`, () => {
      expect(nextRunDates(row.today, { send_day: row.send_day, remind_days_before: row.remind_days_before })).toEqual(row.expect);
    });
  }
});

describe('date arithmetic', () => {
  it('addDays crosses month and year ends in UTC', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
  });
  it('month helpers', () => {
    expect(monthStart('2026-09-17')).toBe('2026-09-01');
    expect(previousMonthStart('2026-01-15')).toBe('2025-12-01');
    expect(nextMonthStart('2026-12-15')).toBe('2027-01-01');
  });
  it('the send date is send_day of the month after the period; the reminder is remind_days_before earlier', () => {
    const timing = { send_day: 7, remind_days_before: 3 };
    expect(sendDateFor('2026-09-01', timing)).toBe('2026-10-07');
    expect(reminderDateFor('2026-09-01', timing)).toBe('2026-10-04');
    expect(sendDateFor('2026-12-01', { send_day: 28, remind_days_before: 27 })).toBe('2027-01-28');
    expect(reminderDateFor('2026-12-01', { send_day: 28, remind_days_before: 27 })).toBe('2027-01-01');
  });
  it('periodLabel names the month', () => {
    expect(periodLabel('2026-09-01')).toBe('September 2026');
  });
});

describe('copy', () => {
  const base = { buildingName: 'Fortress <A> & "B"', reportType: 'ops_monthly' as const, period: '2026-09-01', title: 'OPS', compliancePct: 91.6, expiresAt: '2026-11-06T22:00:00.000Z', appName: 'Building Ops' };

  it('escapes the building name in the body but not in the subject', () => {
    const copy = distributionCopy(base);
    expect(copy.bodyHtml).toContain('Fortress &lt;A&gt; &amp; &quot;B&quot;');
    expect(copy.bodyHtml).not.toContain('<A>');
    expect(copy.subject).toBe('Monthly OPS Report — Fortress <A> & "B" — September 2026');
    expect(copy.heading).toBe('Monthly OPS Report: Fortress <A> & "B"');
    expect(copy.ctaText).toBe('Open the report');
  });
  it('rounds the compliance figure and omits it when there is no snapshot', () => {
    expect(distributionCopy(base).bodyHtml).toContain('Compliance at 92%.');
    expect(distributionCopy({ ...base, compliancePct: null }).bodyHtml).not.toContain('Compliance');
  });
  it('states the expiry as a SAST calendar date', () => {
    // 22:00Z on the 6th is 00:00 on the 7th in Johannesburg.
    expect(distributionCopy(base).bodyHtml).toContain('expires on 7 November 2026');
  });
  it('reminder copy distinguishes a missing report from one in progress', () => {
    const missing = reminderCopy({ buildingName: 'Fortress A', reportType: 'cm_monthly', period: '2026-09-01', sendDate: '2026-10-07', exists: false, status: null });
    expect(missing.title).toBe('Report due soon: Monthly CM Report — Fortress A September 2026');
    expect(missing.body).toContain('has not been started');
    expect(missing.body).toContain('distributed on 7 October');
    const submitted = reminderCopy({ buildingName: 'Fortress A', reportType: 'annual_inspection', period: '2026-09-01', sendDate: '2026-10-07', exists: true, status: 'submitted' });
    expect(submitted.title).toContain('Annual Inspection Report');
    expect(submitted.body).toContain('is submitted');
  });
});

describe('share tokens and passcodes', () => {
  it('mints 43-char base64url tokens, distinct each time', () => {
    const a = mintShareToken();
    const b = mintShareToken();
    expect(a).toMatch(TOKEN_RE);
    expect(b).toMatch(TOKEN_RE);
    expect(a).not.toBe(b);
  });
  it('rejects anything that is not exactly 43 base64url characters', () => {
    expect(TOKEN_RE.test('a'.repeat(42))).toBe(false);
    expect(TOKEN_RE.test('a'.repeat(44))).toBe(false);
    expect(TOKEN_RE.test(`${'a'.repeat(42)}+`)).toBe(false);
    expect(TOKEN_RE.test(`${'a'.repeat(42)}=`)).toBe(false);
  });
  it('hashes to 64 hex chars and is sensitive to passcode, token and salt', async () => {
    const token = 'A'.repeat(43);
    const h = await passcodeHash('1234', token, 'salt');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await passcodeHash('1234', token, 'salt')).toBe(h);
    expect(await passcodeHash('1235', token, 'salt')).not.toBe(h);
    expect(await passcodeHash('1234', 'B'.repeat(43), 'salt')).not.toBe(h);
    expect(await passcodeHash('1234', token, 'other')).not.toBe(h);
  });
  it('pins the expiry choices', () => {
    expect([...EXPIRY_DAYS_ALLOWED]).toEqual([7, 30, 90]);
    expect(EXPIRY_DAYS_ALLOWED).toContain(EXPIRY_DAYS_DEFAULT);
  });
});
