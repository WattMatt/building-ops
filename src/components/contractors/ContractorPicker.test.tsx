import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// jsdom doesn't implement the Pointer Events capture API that Radix's Select
// uses to open/close on pointer down; polyfill it so the combobox is drivable here.
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

const state = vi.hoisted(() => ({
  isLoading: false,
  isError: false,
}));

vi.mock('@/hooks/useContractors', () => ({
  useContractors: () => ({
    contractors: [
      { id: 'c1', company_name: 'Sparks', trade: 'Electrical', is_active: true },
      { id: 'c2', company_name: 'Flow Plumbing', trade: 'Plumbing', is_active: true },
      { id: 'c3', company_name: 'Old Volts', trade: 'electrical', is_active: false },
      { id: 'c4', company_name: 'No Trade Co', trade: null, is_active: true },
    ],
    isLoading: state.isLoading,
    isError: state.isError,
  }),
}));

import { ContractorPicker, contractorLabel, fromContractorSelectValue, toContractorSelectValue } from './ContractorPicker';

function open() {
  const trigger = screen.getByRole('combobox');
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
}

function optionNames() {
  return screen.getAllByRole('option').map((o) => o.textContent);
}

beforeEach(() => {
  state.isLoading = false;
  state.isError = false;
});

describe('ContractorPicker', () => {
  it('shows None when nothing is chosen and the company · trade label otherwise', () => {
    const { rerender } = render(<ContractorPicker value={null} onChange={() => {}} />);
    expect(screen.getByRole('combobox')).toHaveTextContent('None');
    rerender(<ContractorPicker value="c1" onChange={() => {}} />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Sparks · Electrical');
  });

  it('lists None plus the active contractors', () => {
    render(<ContractorPicker value={null} onChange={() => {}} />);
    open();
    expect(optionNames()).toEqual(['None', 'Sparks · Electrical', 'Flow Plumbing · Plumbing', 'No Trade Co']);
  });

  it('filters by trade, case-insensitively', () => {
    render(<ContractorPicker value={null} onChange={() => {}} trade="electrical" />);
    open();
    expect(optionNames()).toEqual(['None', 'Sparks · Electrical']);
  });

  it('includes inactive contractors on request, marked as such', () => {
    render(<ContractorPicker value={null} onChange={() => {}} trade="Electrical" includeInactive />);
    open();
    expect(optionNames()).toEqual(['None', 'Sparks · Electrical', 'Old Volts · electrical· inactive']);
  });

  it('keeps the current value listed even when it would be filtered out', () => {
    render(<ContractorPicker value="c3" onChange={() => {}} trade="Plumbing" />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Old Volts · electrical');
    open();
    expect(optionNames()).toEqual(['None', 'Flow Plumbing · Plumbing', 'Old Volts · electrical· inactive']);
  });

  it('choosing a contractor calls onChange with its id; None with null', () => {
    const onChange = vi.fn();
    const { unmount } = render(<ContractorPicker value={null} onChange={onChange} />);
    open();
    const option = screen.getByRole('option', { name: 'Flow Plumbing · Plumbing' });
    fireEvent.pointerUp(option);
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith('c2');
    unmount();

    onChange.mockClear();
    render(<ContractorPicker value="c1" onChange={onChange} id="second" />);
    const second = screen.getByRole('combobox', { name: 'Contractor' });
    expect(second).toHaveAttribute('id', 'second');
    fireEvent.pointerDown(second, { button: 0, ctrlKey: false });
    fireEvent.click(second);
    const none = screen.getByRole('option', { name: 'None' });
    fireEvent.pointerUp(none);
    fireEvent.click(none);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('is disabled while loading and says so when the register failed to load', () => {
    state.isLoading = true;
    const { unmount } = render(<ContractorPicker value={null} onChange={() => {}} />);
    expect(screen.getByRole('combobox')).toBeDisabled();
    unmount();
    state.isLoading = false;
    state.isError = true;
    render(<ContractorPicker value={null} onChange={() => {}} />);
    expect(screen.getByText('Could not load the contractor register.')).toBeInTheDocument();
  });
});

describe('helpers', () => {
  it('maps null to the sentinel and back', () => {
    expect(toContractorSelectValue(null)).toBe('__none__');
    expect(fromContractorSelectValue('__none__')).toBeNull();
    expect(fromContractorSelectValue('c1')).toBe('c1');
  });

  it('labels by company and trade', () => {
    expect(contractorLabel({ company_name: 'A', trade: 'B' })).toBe('A · B');
    expect(contractorLabel({ company_name: 'A', trade: null })).toBe('A');
  });
});
