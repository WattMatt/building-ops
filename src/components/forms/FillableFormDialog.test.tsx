import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { FormTemplate } from '@/hooks/useFormTemplates';

/** One `supabase.from(table)` chain: every builder call in order, for assertions. */
interface RecordedCall { table: string; ops: [string, unknown[]][] }
type Result = { data: unknown; error: { message: string } | null };

const state = vi.hoisted(() => ({
  calls: [] as RecordedCall[],
  results: {} as Record<string, Result>,
  invocations: [] as { name: string; body: unknown }[],
}));

vi.mock('@/integrations/supabase/client', () => {
  function makeChain(table: string) {
    const call: RecordedCall = { table, ops: [] };
    state.calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'insert', 'update', 'delete']) {
      chain[m] = (...args: unknown[]) => { call.ops.push([m, args]); return chain; };
    }
    chain.then = (resolve: (v: Result) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(state.results[table] ?? { data: [], error: null }).then(resolve, reject);
    return chain;
  }
  return {
    supabase: {
      from: (table: string) => makeChain(table),
      functions: {
        invoke: async (name: string, opts: { body: unknown }) => {
          state.invocations.push({ name, body: opts?.body });
          return { data: null, error: null };
        },
      },
    },
  };
});

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', email: 'a@b.co' } }) }));
vi.mock('@/hooks/useOrganization', () => ({ useOrganization: () => ({ organization: { name: 'Org', logo_url: null, primary_color: '#2563eb' } }) }));
vi.mock('@/lib/photos', () => ({ uploadPhotos: vi.fn(async () => []), photoPrefix: (id: string) => `photos/${id}` }));
vi.mock('@/components/ui/photo-capture', () => ({ PhotoCapture: () => null }));

import { FillableFormDialog } from './FillableFormDialog';

const TEMPLATE: FormTemplate = {
  id: '3',
  name: 'Daily Site Handover Log',
  description: 'Shift notes',
  category: 'Operations',
  icon: 'clipboard-list',
  fields: [
    { label: 'Outgoing Officer Name', type: 'text', required: true },
    { label: 'Outstanding Tasks', type: 'textarea', required: true },
  ],
  is_active: true,
  sort_order: 3,
  version: 3,
  updated_at: '',
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

const inserts = () => state.calls.filter((c) => c.table === 'form_submissions' && c.ops.some(([m]) => m === 'insert'));

beforeEach(() => {
  state.calls.length = 0;
  state.invocations.length = 0;
  state.results = { buildings: { data: [{ id: 'b1', name: 'Tower' }], error: null }, form_submissions: { data: null, error: null } };
});

describe('FillableFormDialog', () => {
  it('renders the template\'s own fields — no fields prop', () => {
    render(<FillableFormDialog form={TEMPLATE} open onOpenChange={() => {}} />, { wrapper });
    expect(screen.getByText('Daily Site Handover Log')).toBeInTheDocument();
    expect(screen.getByText('Outgoing Officer Name')).toBeInTheDocument();
    expect(screen.getByText('Outstanding Tasks')).toBeInTheDocument();
  });

  it('snapshots the template version and fields on the submission', async () => {
    render(
      <FillableFormDialog form={TEMPLATE} open onOpenChange={() => {}} preselectedBuildingId="b1" preselectedBuildingName="Tower" />,
      { wrapper },
    );
    fireEvent.change(screen.getByPlaceholderText('Enter outgoing officer name'), { target: { value: 'Thabo' } });
    fireEvent.change(screen.getByPlaceholderText('Enter outstanding tasks'), { target: { value: 'Lift 2 still down' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit Form/ }));

    await waitFor(() => expect(inserts()).toHaveLength(1));
    const row = inserts()[0].ops.find(([m]) => m === 'insert')![1][0] as Record<string, unknown>;
    expect(row).toMatchObject({
      form_template_id: '3',
      form_name: 'Daily Site Handover Log',
      building_id: 'b1',
      submitted_by: 'u1',
      status: 'submitted',
      template_version: 3,
    });
    expect(row.fields_snapshot).toEqual(TEMPLATE.fields);
    expect(row.form_data).toEqual({ 'Outgoing Officer Name': 'Thabo', 'Outstanding Tasks': 'Lift 2 still down' });
  });

  it('does not insert while a required field is empty', async () => {
    render(<FillableFormDialog form={TEMPLATE} open onOpenChange={() => {}} preselectedBuildingId="b1" />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: /Submit Form/ }));
    await waitFor(() => expect(inserts()).toHaveLength(0));
  });

  it('renders nothing without a template', () => {
    const { container } = render(<FillableFormDialog form={null} open onOpenChange={() => {}} />, { wrapper });
    expect(container).toBeEmptyDOMElement();
  });
});
