import { describe, it, expect } from 'vitest';
import { notify } from './notify';

describe('notify seam', () => {
  it('resolves without throwing', async () => {
    await expect(notify({ kind: 'task_assigned', entityType: 'task', entityId: 't1', buildingId: 'b1', recipients: ['u1'], title: 'x', url: '/x' })).resolves.toBeUndefined();
  });
});
