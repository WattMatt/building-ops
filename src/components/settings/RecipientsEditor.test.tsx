import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';

// jsdom lacks the Pointer Events capture API Radix Select relies on; polyfill so the combobox opens.
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

vi.mock('@/hooks/useBuildingMembers', async (orig) => ({
  ...(await orig<typeof import('@/hooks/useBuildingMembers')>()),
  useBuildingMembers: () => ({
    data: [
      { id: '00000000-0000-0000-0000-000000000001', full_name: 'Thabo M', avatar_url: null, role: 'manager' },
      { id: '00000000-0000-0000-0000-000000000002', full_name: 'Lerato K', avatar_url: null, role: 'admin' },
    ],
    byId: new Map(),
    isLoading: false,
    isError: false,
  }),
}));

import { RecipientsEditor } from './RecipientsEditor';
import type { Recipient } from '@/hooks/useReportSchedules';

function Harness({ initial = [], onChange }: { initial?: Recipient[]; onChange?: (v: Recipient[]) => void }) {
  const [value, setValue] = useState<Recipient[]>(initial);
  return <RecipientsEditor value={value} onChange={(v) => { setValue(v); onChange?.(v); }} buildingId="b1" />;
}

const emailInput = () => screen.getByLabelText('Email address') as HTMLInputElement;
const nameInput = () => screen.getByLabelText('Name (optional)') as HTMLInputElement;
const addEmail = () => fireEvent.click(screen.getByRole('button', { name: 'Add email' }));

function pickColleague(name: string) {
  const trigger = screen.getByRole('combobox', { name: 'Add colleague' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
  const option = screen.getByRole('option', { name: new RegExp(name) });
  fireEvent.pointerUp(option);
  fireEvent.click(option);
}

describe('RecipientsEditor', () => {
  it('adds an email with an optional name and lists it as a chip', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(emailInput(), { target: { value: 'client@example.com' } });
    fireEvent.change(nameInput(), { target: { value: 'The Client' } });
    addEmail();
    expect(onChange).toHaveBeenLastCalledWith([{ email: 'client@example.com', name: 'The Client' }]);
    expect(screen.getByText('The Client')).toBeInTheDocument();
    expect(emailInput().value).toBe('');
    expect(nameInput().value).toBe('');
  });

  it('an email without a name is a chip showing the address, and the row has no name key', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(emailInput(), { target: { value: 'Plain@Example.com' } });
    addEmail();
    expect(onChange).toHaveBeenLastCalledWith([{ email: 'plain@example.com' }]);
    expect(screen.getByText('plain@example.com')).toBeInTheDocument();
  });

  it('rejects an invalid email with a plain error line and adds nothing', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(emailInput(), { target: { value: 'not-an-email' } });
    addEmail();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(emailInput()).toHaveAttribute('aria-invalid', 'true');
  });

  it('rejects a duplicate email (case-insensitive)', () => {
    const onChange = vi.fn();
    render(<Harness initial={[{ email: 'client@example.com' }]} onChange={onChange} />);
    fireEvent.change(emailInput(), { target: { value: 'CLIENT@example.com' } });
    addEmail();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('That address is already a recipient.')).toBeInTheDocument();
  });

  it('removes a recipient from its chip', () => {
    const onChange = vi.fn();
    render(<Harness initial={[{ email: 'a@example.com' }, { email: 'b@example.com', name: 'Bee' }]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Bee' }));
    expect(onChange).toHaveBeenLastCalledWith([{ email: 'a@example.com' }]);
    expect(screen.queryByText('Bee')).not.toBeInTheDocument();
  });

  it('adds a colleague by user_id with their display name and no email key', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    pickColleague('Thabo M');
    expect(onChange).toHaveBeenLastCalledWith([{ user_id: '00000000-0000-0000-0000-000000000001', name: 'Thabo M' }]);
    const row = onChange.mock.calls.at(-1)![0][0];
    expect('email' in row).toBe(false);
    expect(screen.getByText('Thabo M')).toBeInTheDocument();
    expect(screen.getByText('colleague')).toBeInTheDocument();
  });

  it('rejects a duplicate colleague', () => {
    const onChange = vi.fn();
    render(<Harness initial={[{ user_id: '00000000-0000-0000-0000-000000000001', name: 'Thabo M' }]} onChange={onChange} />);
    pickColleague('Thabo M');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('That colleague is already a recipient.')).toBeInTheDocument();
  });

  it('caps a name at the 120 characters the CHECK constraint allows', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(nameInput()).toHaveAttribute('maxLength', '120');
    fireEvent.change(emailInput(), { target: { value: 'client@example.com' } });
    // The attribute caps typing; a paste or an autofill still has to be caught on the way in.
    fireEvent.change(nameInput(), { target: { value: 'x'.repeat(121) } });
    addEmail();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('A name can be at most 120 characters.')).toBeInTheDocument();
    fireEvent.change(nameInput(), { target: { value: 'x'.repeat(120) } });
    addEmail();
    expect(onChange).toHaveBeenLastCalledWith([{ email: 'client@example.com', name: 'x'.repeat(120) }]);
  });

  it('stops at 50 recipients', () => {
    const fifty: Recipient[] = Array.from({ length: 50 }, (_, i) => ({ email: `r${i}@example.com` }));
    const onChange = vi.fn();
    render(<Harness initial={fifty} onChange={onChange} />);
    expect(screen.getByText('A schedule can have at most 50 recipients.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add email' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Add colleague' })).toBeDisabled();
  });

  it('says so when there is nobody yet', () => {
    render(<Harness />);
    expect(screen.getByText('No recipients yet.')).toBeInTheDocument();
  });
});
