import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// jsdom doesn't implement the Pointer Events capture API that Radix's Select
// uses to open/close on pointer down; polyfill it so the combobox is drivable here.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

vi.mock('@/hooks/useBuildingMembers', async (orig) => ({
  ...(await orig<typeof import('@/hooks/useBuildingMembers')>()),
  useBuildingMembers: () => ({
    data: [
      { id: 'u1', full_name: 'Thabo M', avatar_url: null, role: 'user' },
      { id: 'u2', full_name: 'Lerato K', avatar_url: null, role: 'manager' },
    ],
    byId: new Map(),
    isLoading: false,
    isError: false,
  }),
}));

import { AssigneePicker, toSelectValue, fromSelectValue } from './AssigneePicker';

describe('AssigneePicker', () => {
  it('shows the current assignee name in the trigger', () => {
    render(<AssigneePicker buildingId="b1" value="u2" onChange={() => {}} />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Lerato K');
  });

  it('shows Unassigned when empty', () => {
    render(<AssigneePicker buildingId="b1" value={null} onChange={() => {}} />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Unassigned');
  });

  it('puts a passed id on the trigger element', () => {
    render(<AssigneePicker buildingId="b1" value={null} onChange={() => {}} id="assignee-field" />);
    expect(screen.getByRole('combobox')).toHaveAttribute('id', 'assignee-field');
  });

  it('choosing Unassigned calls onChange(null)', () => {
    const onChange = vi.fn();
    render(<AssigneePicker buildingId="b1" value="u1" onChange={onChange} />);
    const trigger = screen.getByRole('combobox');
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    const option = screen.getByText('Unassigned');
    fireEvent.pointerUp(option);
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe('toSelectValue / fromSelectValue', () => {
  it('maps null to the sentinel and back', () => {
    expect(toSelectValue(null)).toBe('__unassigned__');
    expect(fromSelectValue('__unassigned__')).toBeNull();
  });

  it('passes real ids through unchanged', () => {
    expect(toSelectValue('u1')).toBe('u1');
    expect(fromSelectValue('u1')).toBe('u1');
  });
});
