import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
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

type Call = { table: string; op: string; payload?: unknown; filters: unknown[][]; select?: unknown[] };

/**
 * A recording Supabase stub: every `from()` call becomes a Call whose insert/update payload,
 * `.select` arguments and `.eq`/`.gt` filters are captured; awaiting the builder yields one row
 * (the RLS "allowed" shape). A `head: true` select answers with `countBack` instead.
 */
const db = vi.hoisted(() => {
  const calls: Call[] = [];
  const rpc = vi.fn();
  let rowsBack: unknown[] = [{ id: 't1' }];
  let countBack: { count: number | null; error: { message: string } | null } = { count: 7, error: null };
  const from = (table: string) => {
    const call: Call = { table, op: 'select', filters: [] };
    calls.push(call);
    const b: Record<string, unknown> = {};
    b.insert = (p: unknown) => { call.op = 'insert'; call.payload = p; return b; };
    b.update = (p: unknown) => { call.op = 'update'; call.payload = p; return b; };
    b.select = (...args: unknown[]) => { call.select = args; return b; };
    b.limit = () => b;
    b.eq = (...args: unknown[]) => { call.filters.push(args); return b; };
    b.gt = (...args: unknown[]) => { call.filters.push(['gt', ...args]); return b; };
    b.maybeSingle = async () => ({ data: { id: 'org-first-row' }, error: null });
    b.then = (resolve: (v: unknown) => void) => {
      const head = (call.select?.[1] as { head?: boolean } | undefined)?.head === true;
      resolve(head ? { data: null, ...countBack } : { data: rowsBack, error: null });
    };
    return b;
  };
  return {
    calls, rpc, from,
    setRowsBack: (rows: unknown[]) => { rowsBack = rows; },
    setCountBack: (c: typeof countBack) => { countBack = c; },
  };
});
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: db.from, rpc: db.rpc } }));

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/hooks/useHints', () => ({ useHints: () => ({ hintsEnabled: true, setHintsEnabled: vi.fn() }) }));

import TemplateDialog, { archiveTemplate, sameRule, type EditableTemplate } from './TemplateDialog';

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

/** Owns `open` the way the page does, so `onOpenChange(false)` really closes the sheet. */
function Harness({ template, organizationId, onOpenChange, onSaved }: {
  template: EditableTemplate | null; organizationId?: string; onOpenChange: (o: boolean) => void; onSaved: () => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <TemplateDialog
      open={open}
      onOpenChange={(o) => { onOpenChange(o); setOpen(o); }}
      template={template}
      onSaved={onSaved}
      organizationId={organizationId}
    />
  );
}

const renderDialog = (template: EditableTemplate | null, organizationId?: string) => {
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();
  render(<Harness template={template} organizationId={organizationId} onOpenChange={onOpenChange} onSaved={onSaved} />);
  return { onOpenChange, onSaved };
};

const writes = () => db.calls.filter((c) => c.op === 'insert' || c.op === 'update');
const countReads = () => db.calls.filter((c) => c.table === 'task_instances' && (c.select?.[1] as { head?: boolean } | undefined)?.head === true);

describe('TemplateDialog', () => {
  beforeEach(() => {
    db.calls.length = 0;
    db.setRowsBack([{ id: 't1' }]);
    db.setCountBack({ count: 7, error: null });
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

    expect(await screen.findByRole('heading', { name: 'Regenerate future tasks?' }, { timeout: 2000 })).toBeInTheDocument();
    // The confirm says how many tasks the regenerate would replace: pending, future, from this template's items.
    expect(screen.getByText(/7 pending tasks that nobody has touched will be replaced/)).toBeInTheDocument();
    const [count] = countReads();
    expect(count.select).toEqual(['id, template_items!inner(template_id)', { count: 'exact', head: true }]);
    expect(count.filters).toEqual([
      ['template_items.template_id', 't1'],
      ['status', 'pending'],
      ['gt', 'due_date', '2026-09-10'],
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));

    await waitFor(() => expect(db.rpc).toHaveBeenCalledWith('reschedule_template', { p_template: 't1' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Regenerated: 2 removed, 5 created'));
    expect(onSaved).toHaveBeenCalledTimes(2);
  });

  it('singular count, and the countless sentence when the head-count fails', async () => {
    db.setCountBack({ count: 1, error: null });
    renderDialog(weeklyTemplate);
    fireEvent.click(screen.getByRole('button', { name: 'Wednesday' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/1 pending task that nobody has touched will be replaced/, {}, { timeout: 2000 })).toBeInTheDocument();
  });

  it('falls back to the countless sentence when the head-count errors', async () => {
    db.setCountBack({ count: null, error: { message: 'permission denied' } });
    renderDialog(weeklyTemplate);
    fireEvent.click(screen.getByRole('button', { name: 'Wednesday' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/^Pending tasks that nobody has touched will be replaced/, {}, { timeout: 2000 })).toBeInTheDocument();
    expect(countReads()).toHaveLength(1);
  });

  it('on a phone, the confirm opens only after the sheet has closed (never in the same render)', async () => {
    mockViewport(375);
    const { onOpenChange } = renderDialog(weeklyTemplate);
    expect(document.querySelector('[data-vaul-drawer]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Wednesday' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));

    // Same tick as the close: the sheet is on its way out and the confirm is NOT yet mounted.
    expect(screen.queryByRole('heading', { name: 'Regenerate future tasks?' })).toBeNull();
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByRole('heading', { name: 'Regenerate future tasks?' })).toBeNull();

    // After vaul's close transition the sheet is gone and only then does the confirm appear.
    expect(await screen.findByRole('heading', { name: 'Regenerate future tasks?' }, { timeout: 2000 })).toBeInTheDocument();
    const drawer = document.querySelector('[data-vaul-drawer]');
    expect(drawer === null || drawer.getAttribute('data-state') === 'closed').toBe(true);
    expect(screen.getByText(/7 pending tasks that nobody has touched will be replaced/)).toBeInTheDocument();
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

  it('saving an untouched legacy template sends no recurrence, keeps its frequency, and never prompts', async () => {
    renderDialog({ ...weeklyTemplate, recurrence: null, frequency: 'monthly' });
    // Seeded from the bucket so the editor has something to show...
    expect(screen.getByText('Monthly on the 1st')).toBeInTheDocument();
    // ...and says so in plain words.
    expect(screen.getByTestId('template-legacy-note')).toHaveTextContent(
      'This template still uses the fixed monthly schedule. Change the rule above to switch it to a custom one.',
    );
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Fire doors (all floors)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    // The seed is only an approximation (weekly → Monday, quarterly → from the 1st): writing it
    // would silently move the template's existing tasks. Legacy stays legacy.
    expect(writes()[0].payload).toEqual({
      name: 'Fire doors (all floors)',
      description: 'Walk every escape route',
      responsible_role: 'Security',
      applies_to_building_types: ['office'],
      frequency: 'monthly',
      is_active: true,
    });
    expect(writes()[0].payload).not.toHaveProperty('recurrence');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Template updated'));
    await new Promise((r) => setTimeout(r, 600));
    expect(screen.queryByRole('heading', { name: 'Regenerate future tasks?' })).toBeNull();
    expect(countReads()).toHaveLength(0);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('editing a legacy template’s weekday switches it to a rule and offers to regenerate', async () => {
    renderDialog({ ...weeklyTemplate, recurrence: null, frequency: 'weekly' });
    expect(screen.getByTestId('template-legacy-note')).toHaveTextContent('fixed weekly schedule');
    fireEvent.click(screen.getByRole('button', { name: 'Wednesday' }));
    expect(screen.queryByTestId('template-legacy-note')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].payload).toMatchObject({ recurrence: { every: 1, unit: 'week', weekdays: [1, 3] }, frequency: 'weekly' });
    expect(await screen.findByRole('heading', { name: 'Regenerate future tasks?' }, { timeout: 2000 })).toBeInTheDocument();
  });

  it('a rule-backed template shows no legacy note', () => {
    renderDialog(weeklyTemplate);
    expect(screen.queryByTestId('template-legacy-note')).toBeNull();
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

describe('sameRule', () => {
  it('ignores lead (visibility only, and hidden) so a lead-only diff never prompts a regenerate', () => {
    expect(sameRule({ every: 1, unit: 'week', weekdays: [1], lead: 7 }, { every: 1, unit: 'week', weekdays: [1] })).toBe(true);
    expect(sameRule({ every: 1, unit: 'week', weekdays: [3, 1] }, { every: 1, unit: 'week', weekdays: [1, 3] })).toBe(true);
    expect(sameRule({ every: 1, unit: 'week', weekdays: [1] }, { every: 2, unit: 'week', weekdays: [1] })).toBe(false);
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
