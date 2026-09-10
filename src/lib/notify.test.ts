import { describe, it, expect, vi } from 'vitest';
const invoke = vi.hoisted(() =>
  vi.fn(async (): Promise<{ data: { success: boolean } | null; error: { message: string } | null }> => ({ data: { success: true }, error: null })),
);
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke } } }));
import { notify } from './notify';

describe('notify', () => {
  it('invokes the notify function with the payload', async () => {
    await notify({ kind: 'task_assigned', entityType: 'task', entityId: 't1', buildingId: 'b1', recipients: ['u1'], title: 'x', url: '/x' });
    expect(invoke).toHaveBeenCalledWith('notify', { body: expect.objectContaining({ kind: 'task_assigned', recipients: ['u1'], url: '/x' }) });
  });
  it('skips the call with no recipients unless the kind is org-wide', async () => {
    invoke.mockClear();
    await notify({ kind: 'issue_comment', entityType: 'issue', entityId: 'i', buildingId: 'b', recipients: [], title: 'x', url: '/x' });
    expect(invoke).not.toHaveBeenCalled();
    await notify({ kind: 'report_submitted', entityType: 'report', entityId: 'r', buildingId: 'b', recipients: [], title: 'x', url: '/x' });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it('report_submitted is the only org-wide kind this seam sends', async () => {
    // form_submitted and signoff_overdue are raised by their own edge functions; sending them
    // from here with no recipients would be a call the `notify` function rejects with a 400.
    invoke.mockClear();
    await notify({ kind: 'form_submitted', entityType: 'form_submission', entityId: 'f', buildingId: 'b', recipients: [], title: 'x', url: '/forms' });
    await notify({ kind: 'signoff_overdue', entityType: 'signoff_request', entityId: 's', buildingId: 'b', recipients: [], title: 'x', url: '/my-signoffs' });
    expect(invoke).not.toHaveBeenCalled();
  });
  it('never throws when the function fails', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(notify({ kind: 'task_assigned', entityType: 'task', entityId: 't', buildingId: 'b', recipients: ['u'], title: 'x', url: '/x' })).resolves.toBeUndefined();
  });
});
