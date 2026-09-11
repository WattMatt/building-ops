/**
 * The one form catalogue (spec §5.11). `form_templates` replaces the two hard-coded arrays and
 * `defaultFormFields`; ids '1'…'14' are what form_submissions.form_template_id already stores.
 * Readers filter `is_active`; the Settings admin sees every row. Every content save bumps
 * `version` server-side (trigger), and new submissions snapshot `fields` + `version`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { FormField } from '@/lib/formFields';
import type { TablesUpdate } from '@/integrations/supabase/types';

export const FORM_TEMPLATES_KEY = ['form-templates'] as const;

/** Plain guardrail copy for a write RLS refused or filtered to nothing. */
export const FORM_TEMPLATE_PERMISSION_MESSAGE = 'Only admins can change form templates.';

export interface FormTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  fields: FormField[];
  is_active: boolean;
  sort_order: number;
  version: number;
  updated_at: string;
}

export type FormTemplatePatch = Partial<
  Pick<FormTemplate, 'name' | 'description' | 'category' | 'icon' | 'fields' | 'is_active' | 'sort_order'>
>;

const COLUMNS = 'id, name, description, category, icon, fields, is_active, sort_order, version, updated_at';

/** jsonb → FormField[]; a malformed row renders as an empty form rather than crashing the page. */
export function parseFields(value: unknown): FormField[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (f): f is FormField =>
      !!f &&
      typeof f === 'object' &&
      typeof (f as FormField).label === 'string' &&
      typeof (f as FormField).type === 'string',
  );
}

export function mapTemplate(row: Record<string, unknown>): FormTemplate {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    description: String(row.description ?? ''),
    category: String(row.category ?? ''),
    icon: row.icon ? String(row.icon) : 'file-text',
    fields: parseFields(row.fields),
    is_active: row.is_active !== false,
    sort_order: Number(row.sort_order ?? 0),
    version: Number(row.version ?? 1),
    updated_at: String(row.updated_at ?? ''),
  };
}

export async function fetchFormTemplates(): Promise<FormTemplate[]> {
  const { data, error } = await supabase
    .from('form_templates')
    .select(COLUMNS)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(mapTemplate);
}

/** Every template, cached 5 min. `templates` is the active list; `all` includes inactive rows (admin). */
export function useFormTemplates() {
  const query = useQuery({ queryKey: FORM_TEMPLATES_KEY, staleTime: 5 * 60_000, queryFn: fetchFormTemplates });
  const all = query.data ?? [];
  return {
    all,
    templates: all.filter((t) => t.is_active),
    byId: (id: string | null | undefined) => (id ? all.find((t) => t.id === id) ?? null : null),
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

/** Admin writes. Each selects the row back: zero rows = RLS filtered it = permission failure. */
export function useFormTemplateMutations() {
  const qc = useQueryClient();
  const invalidate = () => { void qc.invalidateQueries({ queryKey: FORM_TEMPLATES_KEY }); };

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: FormTemplatePatch }): Promise<FormTemplate> => {
      // `fields` is jsonb, generated as `Json`, which a `FormField[]` (an interface, so no implicit
      // index signature) does not structurally satisfy — the value written is identical.
      const row = patch as TablesUpdate<'form_templates'>;
      const { data, error } = await supabase.from('form_templates').update(row).eq('id', id).select(COLUMNS);
      if (error) {
        if (error.code === '42501') throw new Error(FORM_TEMPLATE_PERMISSION_MESSAGE);
        throw error;
      }
      if (!data?.length) throw new Error(FORM_TEMPLATE_PERMISSION_MESSAGE);
      return mapTemplate(data[0]);
    },
    onSuccess: invalidate,
  });

  const reorder = useMutation({
    // One update per moved row; sort_order = position. Small list (14), so no RPC.
    mutationFn: async (orderedIds: string[]) => {
      for (let i = 0; i < orderedIds.length; i++) {
        const { data, error } = await supabase
          .from('form_templates')
          .update({ sort_order: i + 1 })
          .eq('id', orderedIds[i])
          .select('id');
        if (error) throw error;
        if (!data?.length) throw new Error(FORM_TEMPLATE_PERMISSION_MESSAGE);
      }
    },
    onSuccess: invalidate,
  });

  return {
    update: (id: string, patch: FormTemplatePatch) => update.mutateAsync({ id, patch }),
    setActive: (id: string, is_active: boolean) => update.mutateAsync({ id, patch: { is_active } }),
    reorder: (orderedIds: string[]) => reorder.mutateAsync(orderedIds),
    isPending: update.isPending || reorder.isPending,
  };
}

/** Category badge colour, one map for the library and the tab (was two divergent maps). */
export function formCategoryClass(category: string): string {
  switch (category) {
    case 'Security': return 'bg-primary text-primary-foreground';
    case 'Maintenance': return 'bg-accent text-accent-foreground';
    case 'Operations': return 'bg-info text-info-foreground';
    case 'Cleaning': return 'bg-success text-success-foreground';
    case 'Safety': return 'bg-warning text-warning-foreground';
    case 'Compliance': return 'bg-destructive/80 text-destructive-foreground';
    default: return 'bg-muted text-muted-foreground';
  }
}
