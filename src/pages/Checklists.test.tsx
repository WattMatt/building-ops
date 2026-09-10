import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const state = vi.hoisted(() => ({ isAdminOrManager: false }));

/** Rows the page reads; only the columns it renders. */
const rows = vi.hoisted(() => ({
  checklist_templates: [
    {
      id: 't1', name: 'Daily walk', description: null, frequency: 'daily', responsible_role: 'user', is_active: true,
      organization_id: 'org1', applies_to_building_types: null, recurrence: null, archived_at: null, version: 1,
    },
    {
      id: 't2', name: 'Fire doors', description: null, frequency: 'weekly', responsible_role: 'Security', is_active: true,
      organization_id: 'org1', applies_to_building_types: ['office'], recurrence: { every: 1, unit: 'week', weekdays: [1] },
      archived_at: null, version: 2,
    },
    {
      id: 't3', name: 'Old lift checks', description: null, frequency: 'monthly', responsible_role: 'user', is_active: true,
      organization_id: 'org1', applies_to_building_types: null, recurrence: null, archived_at: '2026-09-01T00:00:00Z', version: 1,
    },
  ],
  template_items: [] as unknown[],
}));

// Chainable, thenable stub keyed by table: awaiting it yields that table's rows.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: keyof typeof rows) => {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'order', 'eq', 'update', 'insert', 'limit']) b[m] = () => b;
      b.then = (resolve: (v: unknown) => void) => resolve({ data: rows[table] ?? [], error: null });
      return b;
    },
  },
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ isAdminOrManager: state.isAdminOrManager, user: { id: 'u1' } }),
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));

// The dialogs have their own tests; the page only has to open them.
vi.mock('@/components/checklists/TemplateDialog', () => ({
  default: ({ open, template }: { open: boolean; template: { name: string } | null }) => (
    <div>{`TemplateDialog open=${open} template=${template?.name ?? 'new'}`}</div>
  ),
  archiveTemplate: vi.fn(),
}));
vi.mock('@/components/checklists/TemplateItemDialog', () => ({ default: () => null }));
vi.mock('@/components/checklists/ApplyTemplateDialog', () => ({ default: () => null }));
vi.mock('@/components/checklists/PreviewTemplateDialog', () => ({ default: () => null }));

import Checklists from './Checklists';

describe('Checklists page', () => {
  beforeEach(() => { state.isAdminOrManager = false; });

  it('shows New template and the archived toggle to an admin, hiding archived cards until asked', async () => {
    state.isAdminOrManager = true;
    render(<Checklists />);
    expect(await screen.findByRole('button', { name: /new template/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add task/i })).toBeInTheDocument();

    const toggle = screen.getByRole('switch', { name: /show archived \(1\)/i });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByText('Old lift checks')).toBeNull();

    fireEvent.click(toggle);
    expect(screen.getByText('Old lift checks')).toBeInTheDocument();
    expect(screen.getByText('Archived')).toBeInTheDocument();
  });

  it('labels the frequency badge from the recurrence rule when there is one, else the legacy bucket', async () => {
    state.isAdminOrManager = true;
    render(<Checklists />);
    expect(await screen.findByText('Weekly on Mon')).toBeInTheDocument();
    expect(screen.getByText('Daily')).toBeInTheDocument();
  });

  it('opens the template dialog for a new template', async () => {
    state.isAdminOrManager = true;
    render(<Checklists />);
    expect(await screen.findByText('TemplateDialog open=false template=new')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /new template/i }));
    expect(screen.getByText('TemplateDialog open=true template=new')).toBeInTheDocument();
  });

  it('hides template administration from a plain user', async () => {
    render(<Checklists />);
    expect(await screen.findByText('Daily walk')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new template/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /add task/i })).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByText('Old lift checks')).toBeNull();
  });
});
