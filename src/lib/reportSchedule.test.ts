/**
 * The display-only half of `src/lib/reportSchedule.ts` (the scheduling arithmetic it re-exports is
 * covered by `src/lib/distributionPlan.test.ts`), plus the one-label-map invariant: the Settings UI
 * and the emails `report-distribution` sends must never name a report type differently.
 */
import { describe, it, expect, vi } from 'vitest';

// fortress-db pulls in the Supabase client for its typed handle; this suite only wants its constants.
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import { REPORT_TYPE_LABELS as SHARED_LABELS } from '../../supabase/functions/_shared/distribution';
import { REPORT_TYPE_LABELS as DB_LABELS } from '@/integrations/supabase/fortress-db';
import { REPORT_TYPE_LABELS as LIB_LABELS, ordinal, recipientLabel, toResultRows } from '@/lib/reportSchedule';
import type { Distribution } from '@/hooks/useReportSchedules';

const TZ = 'Africa/Johannesburg';

describe('REPORT_TYPE_LABELS', () => {
  it('is one object, re-exported everywhere it is read', () => {
    expect(DB_LABELS).toBe(SHARED_LABELS);
    expect(LIB_LABELS).toBe(SHARED_LABELS);
  });

  it('pins the names the emails and the UI share', () => {
    expect(SHARED_LABELS).toEqual({
      ops_monthly: 'Monthly OPS Report',
      cm_monthly: 'Monthly CM Report',
      annual_inspection: 'Annual Inspection Report',
    });
  });
});

describe('toResultRows', () => {
  it('reads a run\'s per-building rows: no timestamp, the building name as given', () => {
    const rows = toResultRows(
      [
        { buildingId: 'b1', buildingName: 'Alpha', reportId: 'r1', status: 'sent', recipients: '2 of 2' },
        { buildingId: 'b2', buildingName: '', reportId: null, status: 'failed', recipients: '0 of 2', error: 'run' },
      ],
      {},
      TZ,
    );
    expect(rows).toEqual([
      { key: 'b1-0', building: 'Alpha', status: 'sent', recipients: '2 of 2', when: null, error: null },
      { key: 'b2-1', building: 'b2', status: 'failed', recipients: '0 of 2', when: null, error: 'run' },
    ]);
  });

  it('reads a recorded distribution through the `sent_at` discriminator: id key, delivered-of-total, a time', () => {
    const recorded: Distribution[] = [
      {
        id: 'd1', schedule_id: 's1', report_id: 'r1', building_id: 'b1', report_period: '2026-09-01',
        artifact_id: 'a1', share_id: 'sh1', status: 'sent', error: null, sent_at: '2026-10-07T05:30:00Z',
        sent_to: [{ email: 'a@example.com', ok: true }, { email: 'b@example.com', ok: false }],
      },
      {
        id: 'd2', schedule_id: 's1', report_id: null, building_id: 'gone', report_period: '2026-09-01',
        artifact_id: null, share_id: null, status: 'skipped_not_approved', error: null,
        sent_at: '2026-10-07T05:30:00Z', sent_to: [],
      },
    ];
    const rows = toResultRows(recorded, { b1: 'Alpha' }, TZ);
    expect(rows[0].key).toBe('d1');
    expect(rows[0].building).toBe('Alpha');
    expect(rows[0].recipients).toBe('1 of 2');
    expect(rows[0].when).toBe('7 Oct, 07:30');
    // No name for the id: the row falls back to the id itself, never to a blank cell.
    expect(rows[1].building).toBe('gone');
    // No recipient count given, and nothing was attempted: the bare number, as the pre-R4b rows read.
    expect(rows[1].recipients).toBe('0');

    // With the schedule's count, a recorded skip reads exactly as the live run dialog labels it.
    expect(toResultRows(recorded, { b1: 'Alpha' }, TZ, 2)[1].recipients).toBe('0 of 2');
    // A delivered-of-attempted row is never overwritten by the fallback.
    expect(toResultRows(recorded, { b1: 'Alpha' }, TZ, 5)[0].recipients).toBe('1 of 2');
  });

  it('names a building that was deleted after the run', () => {
    const rows = toResultRows(
      [{ id: 'd3', schedule_id: 's1', report_id: null, building_id: null, report_period: '2026-09-01', artifact_id: null, share_id: null, status: 'failed', error: 'share', sent_at: '2026-10-07T05:30:00Z', sent_to: [] }],
      {},
      TZ,
    );
    expect(rows[0].building).toBe('Building removed');
    expect(rows[0].error).toBe('share');
  });
});

describe('small helpers', () => {
  it('ordinal covers the teens and the 1/2/3 endings', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
  });

  it('recipientLabel prefers the name, then the address, then a placeholder', () => {
    expect(recipientLabel({ name: 'Ann', email: 'a@example.com' })).toBe('Ann');
    expect(recipientLabel({ name: '  ', email: 'a@example.com' })).toBe('a@example.com');
    expect(recipientLabel({ user_id: 'u1' })).toBe('Colleague');
  });
});
