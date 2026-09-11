/**
 * Settings → Forms (admin): the form_templates catalogue — activate/deactivate, reorder, and
 * edit name/description/category/icon and the fields. Every content save bumps `version` on the
 * server; existing submissions keep their own snapshot so nothing already filled in changes.
 */
import { useEffect, useReducer, useState } from 'react';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Loader2, Pencil } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { Hint } from '@/components/ui/hint';
import { FormIcon, FORM_ICON_NAMES } from '@/components/forms/FormIcon';
import { formCategoryClass, useFormTemplateMutations, useFormTemplates, type FormTemplate } from '@/hooks/useFormTemplates';
import { editorReducer, fieldsChanged, normaliseField, validateFields } from '@/lib/formTemplateEditor';
import { FormFieldEditor } from './FormFieldEditor';

const CATEGORY_SUGGESTIONS = ['Security', 'Maintenance', 'Operations', 'Cleaning', 'Safety', 'Compliance', 'HR/Safety'];

export function FormsAdminCard() {
  const { all, isLoading, isError } = useFormTemplates();
  const { setActive, reorder, isPending } = useFormTemplateMutations();
  const [editing, setEditing] = useState<FormTemplate | null>(null);

  const move = async (index: number, direction: -1 | 1) => {
    const ids = all.map((t) => t.id);
    const j = index + direction;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    try {
      await reorder(ids);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not reorder');
    }
  };

  const toggle = async (t: FormTemplate, on: boolean) => {
    try {
      await setActive(t.id, on);
      toast.success(on ? `${t.name} is available again` : `${t.name} hidden from the library`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Forms</CardTitle>
        <CardDescription>The forms available in the library and on every building's Forms tab.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : isError ? (
          <p className="text-sm text-destructive">Could not load the form templates.</p>
        ) : all.length === 0 ? (
          <p className="text-sm text-muted-foreground">No form templates. Apply the R4c migration to seed the 14 standard forms.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {all.map((t, i) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 p-3" data-testid={`template-${t.id}`}>
                <span className="text-primary"><FormIcon name={t.icon} /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{t.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{t.fields.length} fields · v{t.version}</p>
                </div>
                <Badge variant="secondary" className={formCategoryClass(t.category)}>{t.category}</Badge>
                <Switch checked={t.is_active} disabled={isPending} onCheckedChange={(on) => void toggle(t, on)} aria-label={`${t.name} active`} />
                <Button variant="ghost" size="icon" className="h-11 w-11" disabled={isPending || i === 0} aria-label={`Move ${t.name} up`} onClick={() => void move(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" className="h-11 w-11" disabled={isPending || i === all.length - 1} aria-label={`Move ${t.name} down`} onClick={() => void move(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
                <Button variant="outline" size="sm" className="h-11" onClick={() => setEditing(t)}><Pencil className="mr-1 h-4 w-4" />Edit</Button>
              </li>
            ))}
          </ul>
        )}
        <Hint>Switch a form off to hide it without losing its submissions; reorder to put the forms your teams use most at the top</Hint>
      </CardContent>
      {editing && <FormTemplateEditorDialog template={editing} open onOpenChange={(o) => { if (!o) setEditing(null); }} />}
    </Card>
  );
}

interface EditorProps { template: FormTemplate; open: boolean; onOpenChange: (open: boolean) => void }

export function FormTemplateEditorDialog({ template, open, onOpenChange }: EditorProps) {
  const { update, isPending } = useFormTemplateMutations();
  const [meta, setMeta] = useState({ name: template.name, description: template.description, category: template.category, icon: template.icon });
  const [fields, dispatch] = useReducer(editorReducer, template.fields, (f) => editorReducer([], { type: 'reset', fields: f }));
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    setMeta({ name: template.name, description: template.description, category: template.category, icon: template.icon });
    dispatch({ type: 'reset', fields: template.fields });
    setAttempted(false);
  }, [template]);

  const errors = validateFields(fields);
  const metaError = !meta.name.trim() ? 'The form needs a name' : !meta.category.trim() ? 'The form needs a category' : null;
  const dirty =
    fieldsChanged(template.fields, fields) ||
    meta.name !== template.name ||
    meta.description !== template.description ||
    meta.category !== template.category ||
    meta.icon !== template.icon;

  const save = async () => {
    setAttempted(true);
    if (errors.length || metaError) return;
    try {
      const saved = await update(template.id, {
        name: meta.name.trim(),
        description: meta.description.trim(),
        category: meta.category.trim(),
        icon: meta.icon,
        fields: fields.map(normaliseField),
      });
      toast.success(saved.version > template.version ? `${saved.name} saved as version ${saved.version}` : `${saved.name} saved`);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the form');
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Edit form — {template.name}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Version {template.version}. Saving a change to the name, description, category or fields creates version {template.version + 1}; submissions already made keep the fields they were filled against.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ft-name">Name</Label>
              <Input id="ft-name" className="h-11" value={meta.name} maxLength={120} onChange={(e) => setMeta((m) => ({ ...m, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ft-description">Description</Label>
              <Textarea id="ft-description" rows={2} value={meta.description} maxLength={300} onChange={(e) => setMeta((m) => ({ ...m, description: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ft-category">Category</Label>
              <Input id="ft-category" className="h-11" value={meta.category} maxLength={40} list="ft-categories" onChange={(e) => setMeta((m) => ({ ...m, category: e.target.value }))} />
              <datalist id="ft-categories">{CATEGORY_SUGGESTIONS.map((c) => <option key={c} value={c} />)}</datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ft-icon">Icon</Label>
              <div className="flex items-center gap-2">
                <span className="text-primary"><FormIcon name={meta.icon} /></span>
                <select id="ft-icon" className="h-11 flex-1 rounded-md border border-input bg-background px-2 text-sm" value={meta.icon} onChange={(e) => setMeta((m) => ({ ...m, icon: e.target.value }))}>
                  {FORM_ICON_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>
          </div>
          {attempted && metaError && <p className="text-sm text-destructive">{metaError}</p>}
          <FormFieldEditor fields={fields} errors={attempted ? errors : []} dispatch={dispatch} disabled={isPending} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)} disabled={isPending}>Cancel</Button>
            <Button className="h-11" onClick={() => void save()} disabled={isPending || !dirty}>
              {isPending ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>) : 'Save'}
            </Button>
          </div>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
