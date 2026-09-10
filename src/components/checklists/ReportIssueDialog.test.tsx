import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { mockViewport } from '@/test/mobile';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: () => ({ insert: () => Promise.resolve({ data: null, error: null }) }), storage: { from: () => ({}) } },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, isAdminOrManager: true }) }));
vi.mock('@/components/ui/photo-capture', () => ({ PhotoCapture: () => null }));

import ReportIssueDialog from './ReportIssueDialog';

describe('ReportIssueDialog', () => {
  afterEach(() => mockViewport(1024));

  it('opens as a bottom sheet on a phone with its title and primary button', async () => {
    mockViewport(375);
    render(
      <ReportIssueDialog
        open
        onOpenChange={() => {}}
        taskId="t1"
        taskName="Check fire extinguishers"
        buildingId="b1"
        buildingName="North Tower"
      />,
    );
    expect(await screen.findByRole('heading', { name: /report issue/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /report issue/i })).toBeInTheDocument();
    expect(document.querySelector('[data-vaul-drawer]')).not.toBeNull();
  });
});
