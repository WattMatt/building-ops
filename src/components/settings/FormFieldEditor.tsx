/** The field list editor inside the Forms admin: label, type, required, options, width, photos; reorder. */
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Hint } from '@/components/ui/hint';
import { FIELD_TYPE_LABELS, FORM_FIELD_TYPES, type FormField, type FormFieldType } from '@/lib/formFields';
import { MAX_FIELDS, MAX_PHOTOS_PER_FIELD, type EditorAction, type FieldError } from '@/lib/formTemplateEditor';

interface Props {
  fields: FormField[];
  errors: FieldError[];
  dispatch: (action: EditorAction) => void;
  disabled?: boolean;
}

export function FormFieldEditor({ fields, errors, dispatch, disabled }: Props) {
  const errorsFor = (i: number) => errors.filter((e) => e.index === i).map((e) => e.message);
  return (
    <div className="space-y-3">
      <Hint>Labels are the keys answers are stored under — renaming one hides old answers on that form's PDFs; add a new field instead</Hint>
      {fields.map((f, i) => (
        <div key={i} className="rounded-lg border p-3 space-y-3" data-testid={`field-${i}`}>
          <div className="flex items-start gap-2">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor={`f-${i}-label`} className="text-xs">Label</Label>
              <Input
                id={`f-${i}-label`}
                className="h-11"
                value={f.label}
                maxLength={120}
                disabled={disabled}
                onChange={(e) => dispatch({ type: 'update', index: i, patch: { label: e.target.value } })}
              />
            </div>
            <div className="w-40 space-y-1.5">
              <Label htmlFor={`f-${i}-type`} className="text-xs">Type</Label>
              <select
                id={`f-${i}-type`}
                className="h-11 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={f.type}
                disabled={disabled}
                onChange={(e) => dispatch({ type: 'update', index: i, patch: { type: e.target.value as FormFieldType } })}
              >
                {FORM_FIELD_TYPES.map((t) => <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              <Checkbox
                checked={!!f.required}
                disabled={disabled}
                onCheckedChange={(c) => dispatch({ type: 'update', index: i, patch: { required: c === true } })}
                aria-label={`Required: ${f.label || `field ${i + 1}`}`}
              />
              Required
            </label>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={f.width === 'half'}
                disabled={disabled}
                onCheckedChange={(c) => dispatch({ type: 'update', index: i, patch: { width: c === true ? 'half' : 'full' } })}
                aria-label={`Half width: ${f.label || `field ${i + 1}`}`}
              />
              Half width
            </label>
            {f.type === 'photo' && (
              <label className="flex items-center gap-2">
                Max photos
                <Input
                  type="number"
                  className="h-9 w-20"
                  min={1}
                  max={MAX_PHOTOS_PER_FIELD}
                  value={f.maxPhotos ?? 5}
                  disabled={disabled}
                  onChange={(e) => dispatch({ type: 'update', index: i, patch: { maxPhotos: Number(e.target.value) } })}
                  aria-label={`Max photos for ${f.label || `field ${i + 1}`}`}
                />
              </label>
            )}
            <span className="ml-auto flex gap-1">
              <Button type="button" variant="ghost" size="icon" className="h-9 w-9" disabled={disabled || i === 0} aria-label="Move up" onClick={() => dispatch({ type: 'move', index: i, direction: -1 })}><ArrowUp className="h-4 w-4" /></Button>
              <Button type="button" variant="ghost" size="icon" className="h-9 w-9" disabled={disabled || i === fields.length - 1} aria-label="Move down" onClick={() => dispatch({ type: 'move', index: i, direction: 1 })}><ArrowDown className="h-4 w-4" /></Button>
              <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-destructive" disabled={disabled} aria-label="Remove field" onClick={() => dispatch({ type: 'remove', index: i })}><Trash2 className="h-4 w-4" /></Button>
            </span>
          </div>
          {f.type === 'select' && (
            <div className="space-y-1.5">
              <Label htmlFor={`f-${i}-options`} className="text-xs">Options (one per line)</Label>
              <Textarea
                id={`f-${i}-options`}
                rows={3}
                value={(f.options ?? []).join('\n')}
                disabled={disabled}
                onChange={(e) => dispatch({ type: 'setOptions', index: i, text: e.target.value })}
              />
            </div>
          )}
          {errorsFor(i).map((m) => <p key={m} className="text-sm text-destructive">{m}</p>)}
        </div>
      ))}
      {errors.filter((e) => e.index === -1).map((e) => <p key={e.message} className="text-sm text-destructive">{e.message}</p>)}
      <Button type="button" variant="outline" className="h-11" disabled={disabled || fields.length >= MAX_FIELDS} onClick={() => dispatch({ type: 'add' })}>
        <Plus className="mr-2 h-4 w-4" />Add field
      </Button>
    </div>
  );
}
