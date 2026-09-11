/**
 * Field-editor state for a form template (spec §5.11): a reducer over FormField[] and the
 * validation that gates Save. Pure, so the whole editor contract is unit-tested.
 */
import { FORM_FIELD_TYPES, type FormField, type FormFieldType } from '@/lib/formFields';

export const MAX_FIELDS = 60;
export const MAX_OPTIONS = 20;
export const MAX_PHOTOS_PER_FIELD = 10;

export type EditorAction =
  | { type: 'add'; fieldType?: FormFieldType }
  | { type: 'remove'; index: number }
  | { type: 'move'; index: number; direction: -1 | 1 }
  | { type: 'update'; index: number; patch: Partial<FormField> }
  | { type: 'setOptions'; index: number; text: string }   // one option per line
  | { type: 'reset'; fields: FormField[] };

export function newField(fieldType: FormFieldType = 'text'): FormField {
  const f: FormField = { label: '', type: fieldType };
  if (fieldType === 'select') f.options = [];
  if (fieldType === 'photo') f.maxPhotos = 5;
  return f;
}

/** Strip keys that do not apply to the type, so a saved row never carries stale options/maxPhotos. */
export function normaliseField(f: FormField): FormField {
  const out: FormField = { label: f.label.trim(), type: f.type };
  if (f.required) out.required = true;
  if (f.width === 'half') out.width = 'half';
  if (f.type === 'select') out.options = (f.options ?? []).map((o) => o.trim()).filter(Boolean).slice(0, MAX_OPTIONS);
  if (f.type === 'photo') out.maxPhotos = Math.min(MAX_PHOTOS_PER_FIELD, Math.max(1, Math.round(f.maxPhotos ?? 5)));
  return out;
}

export function editorReducer(state: FormField[], action: EditorAction): FormField[] {
  switch (action.type) {
    case 'reset':
      return action.fields.map((f) => ({ ...f, options: f.options ? [...f.options] : undefined }));
    case 'add':
      return state.length >= MAX_FIELDS ? state : [...state, newField(action.fieldType)];
    case 'remove':
      return state.filter((_, i) => i !== action.index);
    case 'move': {
      const j = action.index + action.direction;
      if (action.index < 0 || action.index >= state.length || j < 0 || j >= state.length) return state;
      const next = [...state];
      [next[action.index], next[j]] = [next[j], next[action.index]];
      return next;
    }
    case 'update':
      return state.map((f, i) => {
        if (i !== action.index) return f;
        const merged = { ...f, ...action.patch };
        // Changing the type resets type-specific keys the way newField sets them.
        if (action.patch.type && action.patch.type !== f.type) {
          const fresh = newField(action.patch.type);
          return { ...fresh, label: merged.label, required: merged.required, width: merged.width };
        }
        return merged;
      });
    case 'setOptions':
      return state.map((f, i) =>
        i === action.index ? { ...f, options: action.text.split('\n').map((o) => o.trim()).filter(Boolean) } : f,
      );
    default:
      return state;
  }
}

export interface FieldError { index: number; message: string }

/** Plain guardrail copy: what stops Save. */
export function validateFields(fields: FormField[]): FieldError[] {
  const errors: FieldError[] = [];
  const seen = new Map<string, number>();
  fields.forEach((f, index) => {
    const label = f.label.trim();
    if (!label) errors.push({ index, message: 'Every field needs a label' });
    else if (label.length > 120) errors.push({ index, message: 'Labels must be 120 characters or fewer' });
    else if (seen.has(label.toLowerCase())) errors.push({ index, message: `"${label}" is used twice — labels are the keys submissions are stored under` });
    else seen.set(label.toLowerCase(), index);
    if (!(FORM_FIELD_TYPES as readonly string[]).includes(f.type)) errors.push({ index, message: 'Unknown field type' });
    if (f.type === 'select' && !(f.options ?? []).some((o) => o.trim())) errors.push({ index, message: 'A dropdown needs at least one option' });
    if (f.type === 'photo' && f.maxPhotos !== undefined && (f.maxPhotos < 1 || f.maxPhotos > MAX_PHOTOS_PER_FIELD)) errors.push({ index, message: `Photos: between 1 and ${MAX_PHOTOS_PER_FIELD}` });
  });
  if (fields.length === 0) errors.push({ index: -1, message: 'A form needs at least one field' });
  return errors;
}

/** True when a save would change the stored fields (ignores ordering of keys and untrimmed labels). */
export function fieldsChanged(a: FormField[], b: FormField[]): boolean {
  return JSON.stringify(a.map(normaliseField)) !== JSON.stringify(b.map(normaliseField));
}
