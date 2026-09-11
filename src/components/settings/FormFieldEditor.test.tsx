import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FormField } from '@/lib/formFields';

vi.mock('@/hooks/useHints', () => ({ useHints: () => ({ hintsEnabled: true, setHintsEnabled: () => {} }) }));

import { FormFieldEditor } from './FormFieldEditor';

const dispatch = vi.fn();
const FIELDS: FormField[] = [
  { label: 'Date', type: 'date' },
  { label: 'Shift', type: 'select', options: ['Day', 'Night'] },
];

beforeEach(() => { dispatch.mockClear(); });

describe('FormFieldEditor', () => {
  it('renders one block per field with its label and type', () => {
    render(<FormFieldEditor fields={FIELDS} errors={[]} dispatch={dispatch} />);
    expect(screen.getByTestId('field-0')).toBeInTheDocument();
    expect(screen.getByTestId('field-1')).toBeInTheDocument();
    expect(screen.getByLabelText('Label', { selector: '#f-0-label' })).toHaveValue('Date');
    expect(screen.getByLabelText('Type', { selector: '#f-1-type' })).toHaveValue('select');
  });

  it('dispatches a label edit for the right index', () => {
    render(<FormFieldEditor fields={FIELDS} errors={[]} dispatch={dispatch} />);
    fireEvent.change(screen.getByLabelText('Label', { selector: '#f-1-label' }), { target: { value: 'Shift type' } });
    expect(dispatch).toHaveBeenCalledWith({ type: 'update', index: 1, patch: { label: 'Shift type' } });
  });

  it('Add field dispatches add', () => {
    render(<FormFieldEditor fields={FIELDS} errors={[]} dispatch={dispatch} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'add' });
  });

  it('Move up is disabled on the first row and Move down on the last', () => {
    render(<FormFieldEditor fields={FIELDS} errors={[]} dispatch={dispatch} />);
    expect(screen.getAllByRole('button', { name: 'Move up' })[0]).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Move down' })[1]).toBeDisabled();
    fireEvent.click(screen.getAllByRole('button', { name: 'Move down' })[0]);
    expect(dispatch).toHaveBeenCalledWith({ type: 'move', index: 0, direction: 1 });
  });

  it('shows the options textarea only for a dropdown, and edits go through setOptions', () => {
    render(<FormFieldEditor fields={FIELDS} errors={[]} dispatch={dispatch} />);
    expect(screen.queryByLabelText('Options (one per line)', { selector: '#f-0-options' })).not.toBeInTheDocument();
    const options = screen.getByLabelText('Options (one per line)', { selector: '#f-1-options' });
    expect(options).toHaveValue('Day\nNight');
    fireEvent.change(options, { target: { value: 'Day\nNight\nSwing' } });
    expect(dispatch).toHaveBeenCalledWith({ type: 'setOptions', index: 1, text: 'Day\nNight\nSwing' });
  });

  it('shows a max-photos input only for a photo field', () => {
    render(<FormFieldEditor fields={[{ label: 'Evidence', type: 'photo', maxPhotos: 3 }]} errors={[]} dispatch={dispatch} />);
    expect(screen.getByLabelText('Max photos for Evidence')).toHaveValue(3);
  });

  it('renders an error under the field it belongs to, and list-level errors on their own', () => {
    render(<FormFieldEditor fields={FIELDS} errors={[{ index: 1, message: 'A dropdown needs at least one option' }, { index: -1, message: 'A form needs at least one field' }]} dispatch={dispatch} />);
    expect(screen.getByTestId('field-1')).toHaveTextContent('A dropdown needs at least one option');
    expect(screen.getByTestId('field-0')).not.toHaveTextContent('A dropdown needs at least one option');
    expect(screen.getByText('A form needs at least one field')).toBeInTheDocument();
  });

  it('disables every control while a save is in flight', () => {
    render(<FormFieldEditor fields={FIELDS} errors={[]} dispatch={dispatch} disabled />);
    expect(screen.getByLabelText('Label', { selector: '#f-0-label' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add field' })).toBeDisabled();
    for (const b of screen.getAllByRole('button', { name: 'Remove field' })) expect(b).toBeDisabled();
  });
});
