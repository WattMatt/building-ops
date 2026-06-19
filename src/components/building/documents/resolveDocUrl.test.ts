import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolveStorageUrl = vi.fn();
vi.mock('@/integrations/supabase/storage', () => ({
  resolveStorageUrl: (...a: unknown[]) => resolveStorageUrl(...a),
}));

import { resolveDocUrl } from './resolveDocUrl';
import type { UnifiedDocument } from './types';

const base: UnifiedDocument = {
  key: 'k',
  source: 'managed',
  name: 'n',
  type: 't',
  typeValue: 't',
  scope: 'building',
  shopNumber: null,
  tenantName: null,
  issueDate: null,
  expiryDate: null,
  status: { label: 'Valid', kind: 'success' },
  sizeBytes: null,
  editable: true,
  managedId: 'm',
  storedUrl: 'https://x/object/public/tenant-documents/documents/b/a.pdf',
};

describe('resolveDocUrl', () => {
  beforeEach(() => resolveStorageUrl.mockReset());

  it('signs managed URLs via resolveStorageUrl', async () => {
    resolveStorageUrl.mockResolvedValue('https://signed');
    expect(await resolveDocUrl(base)).toBe('https://signed');
    expect(resolveStorageUrl).toHaveBeenCalledWith(base.storedUrl);
  });

  it('returns insight-linker URLs directly without signing', async () => {
    const il = {
      ...base,
      source: 'insight_linker' as const,
      editable: false,
      storedUrl: 'https://il/pub/x.pdf',
    };
    expect(await resolveDocUrl(il)).toBe('https://il/pub/x.pdf');
    expect(resolveStorageUrl).not.toHaveBeenCalled();
  });

  it('returns null when there is no stored url', async () => {
    expect(await resolveDocUrl({ ...base, storedUrl: null })).toBeNull();
  });
});
