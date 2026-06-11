import { describe, it, expect } from 'vitest';
import { assembleHsReportData, certificateStatus, type HsTask, type HsDocument } from './hsComplianceReport';

const T = (over: Partial<HsTask>): HsTask => ({
  id: 'x', task_name: 'Task', category: 'fire_safety', status: 'pending',
  due_date: '2026-06-01', completed_at: null, completed_by_name: null,
  completion_notes: null, photo_urls: [], signature_confirmed: false, ...over,
});

describe('assembleHsReportData', () => {
  const today = new Date('2026-06-11');
  it('groups by category with completed/outstanding/overdue counts', () => {
    const data = assembleHsReportData(
      [
        T({ id: '1', status: 'completed', completed_at: '2026-06-02T08:00:00Z' }),
        T({ id: '2', status: 'pending', due_date: '2026-06-01' }), // overdue
        T({ id: '3', status: 'pending', due_date: '2026-06-30' }), // outstanding, not overdue
        T({ id: '4', category: 'security', status: 'completed', completed_at: '2026-06-03T08:00:00Z' }),
      ],
      [], today
    );
    const fire = data.summary.find((s) => s.category === 'fire_safety')!;
    expect(fire.completed).toBe(1);
    expect(fire.outstanding).toBe(2);
    expect(fire.overdue).toBe(1);
    expect(data.summary.find((s) => s.category === 'security')!.completed).toBe(1);
    expect(data.completedTasks).toHaveLength(2);
    expect(data.outstandingTasks).toHaveLength(2);
  });
  it('uncategorised tasks group under "uncategorised"', () => {
    const data = assembleHsReportData([T({ category: null })], [], today);
    expect(data.summary[0].category).toBe('uncategorised');
  });
});

describe('certificateStatus', () => {
  const today = new Date('2026-06-11');
  const D = (over: Partial<HsDocument>): HsDocument => ({
    id: 'd', name: 'Cert', document_type: 'fire_certificate', expiry_date: null, issuing_authority: null, reference_number: null, ...over,
  });
  it('flags expired, expiring soon (<=60d), current, and no-expiry', () => {
    expect(certificateStatus(D({ expiry_date: '2026-06-01' }), today).status).toBe('expired');
    expect(certificateStatus(D({ expiry_date: '2026-07-01' }), today).status).toBe('expiring_soon');
    expect(certificateStatus(D({ expiry_date: '2027-06-01' }), today).status).toBe('current');
    expect(certificateStatus(D({}), today).status).toBe('no_expiry');
    expect(certificateStatus(D({ expiry_date: '2026-07-01' }), today).daysRemaining).toBe(20);
  });
});
