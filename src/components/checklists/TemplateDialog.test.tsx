import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { mockViewport } from '@/test/mobile';

if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
// Radix Checkbox measures its hidden form input with ResizeObserver, which jsdom lacks.
if (!('ResizeObserver' in globalThis)) {
  class RO { observe() {} unobserve() {} disconnect() {} }
  (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
}

vi.mock('@/lib/myWork', () => ({ todayInOperatingTz: () => '2026-09-10' }));

type Call = { table: string; op: string; payload?: unknown; filters: unknown[][] };

/**
 * A recording Supabase stub: every `from()` call becomes a Call whose insert/update payload
 * and `.eq` filters are captured; awaiting the builder yields one row (the RLS "allowed" shape).
 */
const db = vi.hoisted(() => {
  const calls: Call[] = [];
  const rpc = vi.fn();
  let rowsBack: unknown[] = [{ id: 't1' }];
  const from = (table: string) => {
    const call: Call = { table, op: 'select', filters: [] };
    calls.push(call);
    const b: Record<string, unknown> = {};
    b.insert = (p: unknown) => { call.op = 'insert'; call.payload = p; return b; };
    b.update = (p: unknown) => { call.op = 'update'; call.payload = p; return b; };
    b.select = () => b;
    b.limit = () => b;
    b.eq = (...args: unknown[]) => { call.filters.push(args); return b; };
    b.maybeSingle = async () => ({ data: { id: 'org-first-row' }, error: null });
    b.then = (resolve: (v: unknown) => void) => resolve({ data: rowsBack, error: null });
    return b;
  };
  return { calls, rpc, from, setRowsBack: (rows: unknown[]) => { rowsBack = rows; } };
});
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: db.from, rpc: db.rpc } }));

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/hooks/useHints', () => ({ useHints: () => ({ hintsEnabled: true, setHintsEnabled: vi.fn() }) }));

import TemplateDialog, { archiveTemplate, type EditableTemplate } from './TemplateDialog';

const weeklyTemplate: EditableTemplate = {
  id: 't1',
  name: 'Fire doors',
  description: 'Walk every escape route',
  frequency: 'weekly',
  responsible_role: 'Security',
  applies_to_building_types: ['office'],
  recurrence: { every: 1, unit: 'week', weekdays: [1] },
  organization_id: 'org1',
};

const renderDialog = (template: EditableTemplate | null, organizationId?: string) => {
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();
  render(
    <TemplateDialog open onOpenChange={onOpenChange} template={template} onSaved={onSaved} organizationId={organizationId} />,
  );
  return { onOpenChange, onSaved };
};

const writes = () => db.calls.filter((c) => c.op === 'insert' || c.op === 'update');

describe('TemplateDialog', () => {
  beforeEach(() => {
    db.calls.length = 0;
    db.setRowsBack([{ id: 't1' }]);
    db.rpc.mockReset().mockResolvedValue({ data: [{ deleted: 2, generated: 5 }], error: null });
    toast.mockClear(); toast.success.mockClear(); toast.error.mockClear();
  });
  afterEach(() => mockViewport(1024));

  it('opens as a bottom sheet on a phone', async () => {
    mockViewport(375);
    renderDialog(null);
    expect(await screen.findByRole('heading', { name: 'New template' })).toBeInTheDocument();
    expect(document.querySelector('[data-vaul-drawer]')).not.toBeNull();
  });

  it('keeps Create disabled until a name is entered and says why in plain text', () => {
    renderDialog(null);
    const create = screen.getByRole('button', { name: 'Create template' });
    expect(create).toBeDisabled();
    expect(screen.getByTestId('template-problem')).toHaveTextContent('Template name is required');
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Roof drains' } });
    expect(create).toBeEnabled();
    expect(screen.queryByTestId('template-problem')).toBeNull();
  });

  it('inserts the new template with the legacy frequency derived from the rule', async () => {
    const { onOpenChange, onSaved } = renderDialog(null, 'org1');
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: ' Roof drains ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Wednesday' }));
    fireEvent.click(screen.getByLabelText('Retail / Shopping Centre'));
    fireEvent.click(screen.getByRole('button', { name: 'Create template' }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    const [call] = writes();
    expect(call.table).toBe('checklist_templates');
    expect(call.op).toBe('insert');
    expect(call.payload).toEqual({
      name: 'Roof drains',
      description: null,
      recurrence: { every: 1, unit: 'week', weekdays: [1, 3] },
      responsible_role: 'user',
      applies_to_building_types: ['retail'],
      frequency: 'weekly',
      is_active: true,
      organization_id: 'org1',
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toast.success).toHaveBeenCalledWith('Template created');
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('falls back to the first organisations row when no org id is given', async () => {
    renderDialog(null);
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Roof drains' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create template' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(db.calls.some((c) => c.table === 'organizations')).toBe(true);
    expect(writes()[0].payload).toMatchObject({ organization_id: 'org-first-row' });
  });

  it('after an update that changed the rule, confirms and calls reschedule_template', async () => {
    const { onSaved, onOpenChange } = renderDialog(weeklyTemplate);
    expect(screen.getByLabelText('Name *')).toHaveValue('Fire doors');
    fireEvent.click(screen.getByRole('button', { name: 'Wednesday' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    const [call] = writes();
    expect(call.op).toBe('update');
    expect(call.filters).toEqual([['id', 't1']]);
    expect(call.payload).toEqual({
      name: 'Fire doors',
      description: 'Walk every escape route',
      recurrence: { every: 1, unit: 'week', weekdays: [1, 3] },
      responsible_role: 'Security',
      applies_to_building_types: ['office'],
      frequency: 'weekly',
      is_active: true,
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    expect(await screen.findByRole('heading', { name: 'Regenerate future tasks?' })).toBeInTheDocument();
    expect(screen.getByText(/Pending tasks that nobody has touched will be replaced/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));

    await waitFor(() => expect(db.rpc).toHaveBeenCalledWith('reschedule_template', { p_template: 't1' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Regenerated: 2 removed, 5 created'));
    expect(onSaved).toHaveBeenCalledTimes(2);
  });

  it('an update that keeps the rule does not offer to regenerate', async () => {
    renderDialog(weeklyTemplate);
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Fire doors (all floors)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Template updated'));
    expect(screen.queryByRole('heading', { name: 'Regenerate future tasks?' })).toBeNull();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('seeds a legacy template from its frequency and treats an untouched schedule as unchanged', async () => {
    renderDialog({ ...weeklyTemplate, recurrence: null, frequency: 'monthly' });
    expect(screen.getByText('Monthly on the 1st')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].payload).toMatchObject({ recurrence: { every: 1, unit: 'month', monthDay: 1 }, frequency: 'monthly' });
    expect(screen.queryByRole('heading', { name: 'Regenerate future tasks?' })).toBeNull();
  });

  it('reads zero rows back as a permission problem and stays open', async () => {
    db.setRowsBack([]);
    const { onOpenChange, onSaved } = renderDialog(weeklyTemplate);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('You do not have permission to change this template.'));
    expect(onSaved).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe('archiveTemplate', () => {
  beforeEach(() => { db.calls.length = 0; db.setRowsBack([{ id: 't1' }]); });

  it('sets archived_at on archive and clears it on restore, never deleting', async () => {
    await archiveTemplate('t1', true);
    await archiveTemplate('t1', false);
    const [a, r] = writes();
    expect(a.op).toBe('update');
    expect((a.payload as { archived_at: string }).archived_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.payload).toEqual({ archived_at: null });
    expect(db.calls.every((c) => c.op !== 'delete')).toBe(true);
  });

  it('throws a plain message when RLS returns no row', async () => {
    db.setRowsBack([]);
    await expect(archiveTemplate('t1', true)).rejects.toThrow('You do not have permission to change this template.');
  });
});
