import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { mockViewport } from '@/test/mobile';

// A chainable, thenable query stub: any builder call returns itself and awaiting it yields no rows.
const chain = vi.hoisted(() => {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'update', 'insert', 'in', 'limit', 'single', 'maybeSingle']) {
    c[m] = () => c;
  }
  c.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
  return c;
});
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: () => chain, storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) } },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, isAdminOrManager: true }) }));
vi.mock('@/hooks/useBuildingMembers', () => ({
  useBuildingMembers: () => ({ data: [], byId: new Map() }),
  memberDisplayName: (m: { full_name: string | null }) => m.full_name ?? 'Unnamed user',
}));
vi.mock('@/lib/issueActivity', () => ({ postIssueComment: async () => ({ id: 'a1', authorName: 'Me' }) }));
vi.mock('@/lib/photos', () => ({ uploadPhotos: vi.fn().mockResolvedValue([]), photoPrefix: (u: string) => `photos/${u}` }));
vi.mock('@/lib/notify', () => ({ notify: async () => {} }));
vi.mock('@/components/ui/photo-capture', () => ({ PhotoCapture: () => null }));

import IssueDetailDialog from './IssueDetailDialog';

const issue = {
  id: 'i1',
  title: 'Leaking tap in kitchen',
  description: 'Steady drip under the sink.',
  priority: 'medium' as const,
  status: 'open' as const,
  deadline: null,
  created_at: '2026-09-01T08:00:00.000Z',
  building_id: 'b1',
  building_name: 'North Tower',
  reported_by: 'u1',
  assigned_to: null,
  corrective_action: null,
  photo_urls: null,
  task_instance_id: null,
};

describe('IssueDetailDialog', () => {
  afterEach(() => mockViewport(1024));

  it('opens as a bottom sheet on a phone with the issue title', async () => {
    mockViewport(375);
    render(<IssueDetailDialog issue={issue} open onOpenChange={() => {}} canManage onUpdated={() => {}} />);
    expect(await screen.findByRole('heading', { name: /leaking tap in kitchen/i })).toBeInTheDocument();
    expect(document.querySelector('[data-vaul-drawer]')).not.toBeNull();
  });
});
