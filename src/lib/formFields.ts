/**
 * The shape of one field on a form template (spec §5.11). The field lists themselves live in
 * `form_templates.fields` — read through `useFormTemplates()`, never hard-coded here — and every
 * submission snapshots the list it was filled against (`form_submissions.fields_snapshot`).
 */
export const FORM_FIELD_TYPES = ['text', 'date', 'time', 'signature', 'checkbox', 'textarea', 'select', 'photo'] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export const FORM_FIELD_WIDTHS = ['full', 'half'] as const;
export type FormFieldWidth = (typeof FORM_FIELD_WIDTHS)[number];

export interface FormField {
  label: string;
  type: FormFieldType;
  required?: boolean;
  options?: string[];
  width?: FormFieldWidth;
  maxPhotos?: number;
}

export const FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  text: 'Text',
  date: 'Date',
  time: 'Time',
  signature: 'Signature',
  checkbox: 'Checkbox',
  textarea: 'Paragraph',
  select: 'Dropdown',
  photo: 'Photos',
};
