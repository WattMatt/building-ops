/**
 * Create / edit a checklist template: name, description, recurrence rule (RecurrenceEditor),
 * the role responsible by default, and which building types it applies to.
 *
 * Writes go straight to `checklist_templates`; the DB trigger keeps the legacy `frequency`
 * in sync, but we still send `legacyFrequency(rule)` so the row is right even before the
 * migration's trigger exists on an environment. Every write selects the row back: RLS denies
 * with zero rows and no error, which must read as "no permission", not "saved".
 *
 * After an UPDATE that changed the effective rule, a confirm offers `reschedule_template`,
 * which replaces pending future tasks nobody has touched. The id is stashed and the confirm is
 * opened from an effect only once `open` is false and the sheet's close transition has run
 * (`SHEET_CLOSE_MS`): on phones the vaul Drawer closing and the Radix AlertDialog opening in the
 * same render overlap and fight over focus/scroll lock. Meanwhile a head-count of the tasks the
 * regenerate would replace is fetched so the confirm can say how many.
 */
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Hint } from '@/components/ui/hint';
import { BUILDING_TYPES } from '@/lib/compliance';
import type { TaskFrequency } from '@/lib/constants';
import { legacyFrequency, ruleFromFrequency, type RecurrenceRule } from '@/lib/recurrence';
import { todayInOperatingTz } from '@/lib/myWork';
import RecurrenceEditor, { recurrenceProblem } from '@/components/checklists/RecurrenceEditor';
import { responsibleParties } from '@/components/checklists/TemplateItemDialog';

/** The columns the dialog edits; the page's Template type is a superset. */
export interface EditableTemplate {
  id: string;
  name: string;
  description: string | null;
  frequency: TaskFrequency;
  responsible_role: string | null;
  applies_to_building_types: string[] | null;
  recurrence?: RecurrenceRule | null;
  organization_id?: string | null;
}

export interface TemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create a new template. */
  template: EditableTemplate | null;
  onSaved: () => void;
  /** Org to file a new template under; when absent the first `organizations` row is used (same as the seed). */
  organizationId?: string | null;
}

const NEW_RULE: RecurrenceRule = { every: 1, unit: 'week', weekdays: [1] };

/** Roles offered for `responsible_role`: the two app roles, then the fixed party labels. */
const ROLE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'user', label: 'Building user' },
  { value: 'manager', label: 'Manager' },
  ...responsibleParties.map((p) => ({ value: p, label: p })),
];

const sameRule = (a: RecurrenceRule, b: RecurrenceRule) => JSON.stringify(normalise(a)) === JSON.stringify(normalise(b));
/** Key order and defaults made stable so two equivalent rules compare equal. */
function normalise(r: RecurrenceRule) {
  return {
    every: r.every,
    unit: r.unit,
    weekdays: r.weekdays ? [...r.weekdays].sort((x, y) => x - y) : undefined,
    monthDay: r.monthDay,
    month: r.month,
    lead: r.lead ?? 0,
  };
}

/** The rule the editor starts from: the stored one, else the legacy bucket's equivalent. */
export const effectiveRule = (t: EditableTemplate | null): RecurrenceRule =>
  t ? (t.recurrence ?? ruleFromFrequency(t.frequency)) : NEW_RULE;

/**
 * Archive (or restore) a template. Never deletes: history, reports and iOS keep the row.
 * Throws with a plain message on an RLS denial (zero rows back).
 */
export async function archiveTemplate(id: string, archive: boolean): Promise<void> {
  const { data, error } = await supabase
    .from('checklist_templates')
    .update({ archived_at: archive ? new Date().toISOString() : null })
    .eq('id', id)
    .select('id');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error('You do not have permission to change this template.');
}

type RescheduleResult = { deleted: number; generated: number };

async function rescheduleTemplate(templateId: string): Promise<RescheduleResult> {
  const { data, error } = await supabase.rpc('reschedule_template', { p_template: templateId });
  if (error) throw new Error(error.message);
  const row = data?.[0];
  return { deleted: row?.deleted ?? 0, generated: row?.generated ?? 0 };
}

/** vaul's drawer close transition; the confirm waits this long after `open` turns false. */
export const SHEET_CLOSE_MS = 500;

/**
 * How many tasks `reschedule_template` would replace: pending, due after today, from this
 * template's items. null when the count could not be read (the confirm then says "pending tasks").
 */
async function countReplaceablePending(templateId: string): Promise<number | null> {
  try {
    const { count, error } = await supabase
      .from('task_instances')
      .select('id, template_items!inner(template_id)', { count: 'exact', head: true })
      .eq('template_items.template_id', templateId)
      .eq('status', 'pending')
      .gt('due_date', todayInOperatingTz());
    if (error) throw new Error(error.message);
    return typeof count === 'number' ? count : null;
  } catch (err) {
    console.warn('Could not count pending tasks for the regenerate confirm:', err);
    return null;
  }
}

/** The "regenerate?" confirm's state: stashed at save, shown once the sheet has closed. */
interface PendingReschedule {
  id: string;
  /** null until the head-count answers, or when it failed. */
  count: number | null;
  /** True once `open` has been false for SHEET_CLOSE_MS. */
  ready: boolean;
}

async function resolveOrganizationId(given: string | null | undefined): Promise<string | null> {
  if (given) return given;
  const { data } = await supabase.from('organizations').select('id').limit(1).maybeSingle();
  return data?.id ?? null;
}

export default function TemplateDialog({ open, onOpenChange, template, onSaved, organizationId }: TemplateDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rule, setRule] = useState<RecurrenceRule>(NEW_RULE);
  const [role, setRole] = useState('user');
  const [buildingTypes, setBuildingTypes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  /** Set only after a rule-changing update; the confirm shows once `ready`. */
  const [reschedule, setReschedule] = useState<PendingReschedule | null>(null);
  const [rescheduling, setRescheduling] = useState(false);

  // Open the confirm only after the sheet has closed and its transition has run.
  useEffect(() => {
    if (open || !reschedule || reschedule.ready) return;
    const timer = setTimeout(() => {
      setReschedule((prev) => (prev && !prev.ready ? { ...prev, ready: true } : prev));
    }, SHEET_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [open, reschedule]);

  useEffect(() => {
    if (!open) return;
    setName(template?.name ?? '');
    setDescription(template?.description ?? '');
    setRule(effectiveRule(template));
    setRole(template?.responsible_role ?? 'user');
    setBuildingTypes(template?.applies_to_building_types ?? []);
  }, [open, template]);

  const ruleProblem = recurrenceProblem(rule);
  const nameProblem = name.trim() === '' ? 'Template name is required' : null;
  const problem = nameProblem ?? ruleProblem;

  const toggleType = (value: string, on: boolean) =>
    setBuildingTypes((prev) => (on ? [...new Set([...prev, value])] : prev.filter((v) => v !== value)));

  const handleSave = async () => {
    if (problem) return;
    setSaving(true);
    try {
      const fields = {
        name: name.trim(),
        description: description.trim() || null,
        recurrence: rule,
        responsible_role: role,
        applies_to_building_types: buildingTypes.length > 0 ? buildingTypes : null,
        frequency: legacyFrequency(rule),
        is_active: true,
      };

      if (template) {
        const { data, error } = await supabase
          .from('checklist_templates')
          .update(fields)
          .eq('id', template.id)
          .select('id');
        if (error) throw new Error(error.message);
        if (!data || data.length === 0) throw new Error('You do not have permission to change this template.');
        toast.success('Template updated');
        onSaved();
        onOpenChange(false);
        if (!sameRule(effectiveRule(template), rule)) {
          const id = template.id;
          setReschedule({ id, count: null, ready: false });
          void countReplaceablePending(id).then((count) => {
            setReschedule((prev) => (prev && prev.id === id ? { ...prev, count } : prev));
          });
        }
        return;
      }

      const organization_id = await resolveOrganizationId(organizationId);
      if (!organization_id) throw new Error('No organisation found to file this template under.');
      const { data, error } = await supabase
        .from('checklist_templates')
        .insert({ ...fields, organization_id })
        .select('id');
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) throw new Error('You do not have permission to create templates.');
      toast.success('Template created');
      onSaved();
      onOpenChange(false);
    } catch (err) {
      console.error('Error saving template:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  const handleReschedule = async () => {
    if (!reschedule) return;
    setRescheduling(true);
    try {
      const { deleted, generated } = await rescheduleTemplate(reschedule.id);
      toast.success(`Regenerated: ${deleted} removed, ${generated} created`);
      onSaved();
    } catch (err) {
      console.error('Error rescheduling template:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to regenerate tasks');
    } finally {
      setRescheduling(false);
      setReschedule(null);
    }
  };

  const replaceCount = reschedule?.count ?? null;
  const replaceSentence =
    replaceCount === null
      ? 'Pending tasks that nobody has touched will be replaced.'
      : `${replaceCount} pending task${replaceCount === 1 ? '' : 's'} that nobody has touched will be replaced.`;

  return (
    <>
      <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
        <ResponsiveDialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{template ? 'Edit template' : 'New template'}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {template
                ? 'Change what this template is called, how often it repeats, and where it applies.'
                : 'A template groups tasks that repeat on the same schedule.'}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>

          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSave();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="template-name">Name *</Label>
              <Input
                id="template-name"
                className="h-11"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Weekly fire-door walk"
                autoComplete="off"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="template-description">Description</Label>
              <Textarea
                id="template-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this checklist covers"
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label>Schedule</Label>
              <RecurrenceEditor value={rule} onChange={(next) => setRule(next)} idPrefix="template-recurrence" />
              <Hint>Tasks are created on the dates in the preview for every building this template applies to.</Hint>
            </div>

            <div className="space-y-2">
              <Label htmlFor="template-role">Responsible by default</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id="template-role" aria-label="Responsible role" className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Hint>Each task can name its own responsible party; this is the fallback when it does not.</Hint>
            </div>

            <div className="space-y-2">
              <Label>Applies to building types</Label>
              <div className="rounded-md border divide-y" role="group" aria-label="Building types">
                {BUILDING_TYPES.map((t) => {
                  const id = `template-type-${t.value}`;
                  return (
                    <div key={t.value} className="flex min-h-11 items-center gap-3 px-3">
                      <Checkbox
                        id={id}
                        checked={buildingTypes.includes(t.value)}
                        onCheckedChange={(v) => toggleType(t.value, v === true)}
                      />
                      <Label htmlFor={id} className="flex-1 cursor-pointer py-3 font-normal">
                        {t.label}
                      </Label>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                {buildingTypes.length === 0 ? 'None ticked: applies to every building.' : `Applies to ${buildingTypes.length} building type${buildingTypes.length === 1 ? '' : 's'}.`}
              </p>
            </div>

            {problem && (
              <p className="text-sm text-destructive" data-testid="template-problem">
                {problem}
              </p>
            )}

            <ResponsiveDialogFooter>
              <Button type="button" variant="outline" className="h-11" onClick={() => onOpenChange(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" className="h-11" disabled={saving || problem !== null}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {template ? 'Save changes' : 'Create template'}
              </Button>
            </ResponsiveDialogFooter>
          </form>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <AlertDialog open={reschedule?.ready === true} onOpenChange={(o) => { if (!o && !rescheduling) setReschedule(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate future tasks?</AlertDialogTitle>
            <AlertDialogDescription>
              {replaceSentence} Tasks someone has completed, reassigned or edited stay as they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rescheduling}>Not now</AlertDialogCancel>
            <AlertDialogAction
              disabled={rescheduling}
              onClick={(e) => {
                e.preventDefault();
                void handleReschedule();
              }}
            >
              {rescheduling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Regenerate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
