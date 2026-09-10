import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { mockViewport } from '@/test/mobile';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: () => ({ update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }), storage: { from: () => ({}) } },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, isAdminOrManager: true }) }));
vi.mock('@/components/ui/photo-capture', () => ({ PhotoCapture: () => null }));

import CompleteTaskDialog from './CompleteTaskDialog';

describe('CompleteTaskDialog', () => {
  afterEach(() => mockViewport(1024));

  it('opens as a bottom sheet on a phone with its title and primary button', async () => {
    mockViewport(375);
    render(
      <CompleteTaskDialog
        open
        onOpenChange={() => {}}
        taskId="t1"
        taskName="Check fire extinguishers"
        requiresPhoto={false}
        requiresSignature={false}
      />,
    );
    expect(await screen.findByRole('heading', { name: /complete task/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /complete task/i })).toBeInTheDocument();
    expect(document.querySelector('[data-vaul-drawer]')).not.toBeNull();
  });
});
