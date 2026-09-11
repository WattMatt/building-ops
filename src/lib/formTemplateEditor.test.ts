import { describe, it, expect } from 'vitest';
import type { FormField } from '@/lib/formFields';
import {
  MAX_FIELDS,
  MAX_PHOTOS_PER_FIELD,
  editorReducer,
  fieldsChanged,
  newField,
  normaliseField,
  validateFields,
} from './formTemplateEditor';

const text = (label: string): FormField => ({ label, type: 'text' });

describe('editorReducer', () => {
  it('adds a field of the requested type and caps the list at MAX_FIELDS', () => {
    expect(editorReducer([], { type: 'add' })).toEqual([{ label: '', type: 'text' }]);
    expect(editorReducer([], { type: 'add', fieldType: 'select' })).toEqual([{ label: '', type: 'select', options: [] }]);
    expect(editorReducer([], { type: 'add', fieldType: 'photo' })).toEqual([{ label: '', type: 'photo', maxPhotos: 5 }]);
    const full = Array.from({ length: MAX_FIELDS }, (_, i) => text(`f${i}`));
    expect(editorReducer(full, { type: 'add' })).toHaveLength(MAX_FIELDS);
  });

  it('removes by index', () => {
    expect(editorReducer([text('a'), text('b')], { type: 'remove', index: 0 })).toEqual([text('b')]);
  });

  it('moves within bounds and is a no-op outside them', () => {
    const list = [text('a'), text('b')];
    expect(editorReducer(list, { type: 'move', index: 0, direction: 1 })).toEqual([text('b'), text('a')]);
    expect(editorReducer(list, { type: 'move', index: 0, direction: -1 })).toBe(list);
    expect(editorReducer(list, { type: 'move', index: 1, direction: 1 })).toBe(list);
    expect(editorReducer(list, { type: 'move', index: 5, direction: -1 })).toBe(list);
  });

  it('merges a patch into one field only', () => {
    const next = editorReducer([text('a'), text('b')], { type: 'update', index: 1, patch: { required: true } });
    expect(next[0]).toEqual(text('a'));
    expect(next[1]).toEqual({ label: 'b', type: 'text', required: true });
  });

  it('resets type-specific keys on a type change but keeps label, required and width', () => {
    const start: FormField[] = [{ label: 'Shift', type: 'select', options: ['Day'], required: true, width: 'half' }];
    const next = editorReducer(start, { type: 'update', index: 0, patch: { type: 'photo' } });
    expect(next[0]).toEqual({ label: 'Shift', type: 'photo', maxPhotos: 5, required: true, width: 'half' });
    expect(next[0].options).toBeUndefined();
  });

  it('splits options one per line and drops blank lines', () => {
    const next = editorReducer([{ label: 'Shift', type: 'select', options: [] }], { type: 'setOptions', index: 0, text: 'Day\n\n  Night  \n' });
    expect(next[0].options).toEqual(['Day', 'Night']);
  });

  it('reset clones the options array so editing the draft never mutates the template', () => {
    const source: FormField[] = [{ label: 'Shift', type: 'select', options: ['Day'] }];
    const next = editorReducer([], { type: 'reset', fields: source });
    next[0].options!.push('Night');
    expect(source[0].options).toEqual(['Day']);
  });
});

describe('newField / normaliseField', () => {
  it('newField seeds only the keys its type uses', () => {
    expect(newField()).toEqual({ label: '', type: 'text' });
    expect(newField('select').options).toEqual([]);
  });

  it('trims the label and strips keys foreign to the type', () => {
    const f: FormField = { label: '  Date  ', type: 'date', options: ['x'], maxPhotos: 9, width: 'full', required: false };
    expect(normaliseField(f)).toEqual({ label: 'Date', type: 'date' });
  });

  it('keeps required and half width, trims and caps options, clamps maxPhotos', () => {
    expect(normaliseField({ label: 'a', type: 'select', options: [' x ', '', 'y'], required: true, width: 'half' }))
      .toEqual({ label: 'a', type: 'select', options: ['x', 'y'], required: true, width: 'half' });
    expect(normaliseField({ label: 'p', type: 'photo', maxPhotos: 99 }).maxPhotos).toBe(MAX_PHOTOS_PER_FIELD);
    expect(normaliseField({ label: 'p', type: 'photo', maxPhotos: 0 }).maxPhotos).toBe(1);
    expect(normaliseField({ label: 'p', type: 'photo' }).maxPhotos).toBe(5);
  });
});

describe('validateFields', () => {
  it('needs a label on every field', () => {
    expect(validateFields([{ label: '  ', type: 'text' }])).toEqual([{ index: 0, message: 'Every field needs a label' }]);
  });

  it('rejects a label over 120 characters', () => {
    expect(validateFields([{ label: 'x'.repeat(121), type: 'text' }])[0].message).toMatch(/120 characters/);
  });

  it('rejects duplicate labels case-insensitively', () => {
    const errors = validateFields([text('Date'), text('date')]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ index: 1 });
    expect(errors[0].message).toContain('used twice');
  });

  it('rejects an unknown type', () => {
    expect(validateFields([{ label: 'a', type: 'colour' as never }])).toContainEqual({ index: 0, message: 'Unknown field type' });
  });

  it('needs at least one option on a dropdown', () => {
    expect(validateFields([{ label: 'Shift', type: 'select', options: ['  '] }]))
      .toContainEqual({ index: 0, message: 'A dropdown needs at least one option' });
    expect(validateFields([{ label: 'Shift', type: 'select', options: ['Day'] }])).toEqual([]);
  });

  it('keeps maxPhotos in range', () => {
    expect(validateFields([{ label: 'p', type: 'photo', maxPhotos: 0 }])[0].message).toMatch(/between 1 and 10/);
    expect(validateFields([{ label: 'p', type: 'photo', maxPhotos: 11 }])[0].message).toMatch(/between 1 and 10/);
    expect(validateFields([{ label: 'p', type: 'photo', maxPhotos: 3 }])).toEqual([]);
  });

  it('an empty form is an error against the whole list', () => {
    expect(validateFields([])).toEqual([{ index: -1, message: 'A form needs at least one field' }]);
  });
});

describe('fieldsChanged', () => {
  it('ignores whitespace-only and foreign-key differences', () => {
    expect(fieldsChanged([text('Date')], [{ label: ' Date ', type: 'text', required: false }])).toBe(false);
  });

  it('is true for a real edit', () => {
    expect(fieldsChanged([text('Date')], [text('Day')])).toBe(true);
    expect(fieldsChanged([text('Date')], [text('Date'), text('Time')])).toBe(true);
    expect(fieldsChanged([text('Date')], [{ label: 'Date', type: 'text', required: true }])).toBe(true);
  });
});
