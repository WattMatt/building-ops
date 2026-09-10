import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Radix Popover measures its content with ResizeObserver; jsdom has none.
if (!('ResizeObserver' in globalThis)) {
  class RO { observe() {} unobserve() {} disconnect() {} }
  (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
}

vi.mock('@/hooks/useContractors', () => ({
  useContractors: () => ({
    contractors: [
      { id: 'c1', company_name: 'Sparks', trade: 'Electrical', contact_name: 'Jane Volt', contact_phone: '+27 11 555 0100', contact_email: 'jane@sparks.test', is_active: true },
      { id: 'c2', company_name: 'Bare Co', trade: null, contact_name: null, contact_phone: null, contact_email: null, is_active: true },
    ],
    isLoading: false,
    isError: false,
  }),
}));
// The picker has its own tests; a native select keeps Radix Select out of jsdom.
vi.mock('@/components/contractors/ContractorPicker', () => ({
  ContractorPicker: ({ onChange, id, 'aria-label': label }: { onChange: (id: string | null) => void; id?: string; 'aria-label'?: string }) => (
    <select id={id} aria-label={label} defaultValue="" onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Choose</option>
      <option value="c1">Sparks</option>
      <option value="c2">Bare Co</option>
    </select>
  ),
}));

import ProfessionalTeamSection, { type ProfessionalTeam } from './ProfessionalTeamSection';

const empty = { name: '', company: '', phone: '', email: '' };
const team: ProfessionalTeam = {
  architect: { ...empty },
  civilEngineer: { name: 'Keep Me', company: 'Civil Co', phone: '1', email: 'k@civil.test' },
  structuralEngineer: { ...empty },
  electricalEngineer: { ...empty },
  wetServicesEngineer: { ...empty },
};

describe('ProfessionalTeamSection', () => {
  it('offers a 44px "Pick from register" button per professional', () => {
    render(<ProfessionalTeamSection team={team} onChange={() => {}} />);
    const buttons = screen.getAllByRole('button', { name: /pick from register/i });
    expect(buttons).toHaveLength(5);
    for (const b of buttons) expect(b.className).toMatch(/\bmin-h-11\b/);
  });

  it('fills name/company/phone/email from the chosen contractor and leaves the other keys untouched', async () => {
    const onChange = vi.fn();
    render(<ProfessionalTeamSection team={team} onChange={onChange} />);
    fireEvent.click(screen.getAllByRole('button', { name: /pick from register/i })[0]);
    const picker = await screen.findByLabelText(/pick architect from the contractor register/i);
    fireEvent.change(picker, { target: { value: 'c1' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      ...team,
      architect: { name: 'Jane Volt', company: 'Sparks', phone: '+27 11 555 0100', email: 'jane@sparks.test' },
    });
    // The keys are the persisted camelCase jsonb keys (pinned for iOS).
    expect(Object.keys(onChange.mock.calls[0][0])).toEqual(['architect', 'civilEngineer', 'structuralEngineer', 'electricalEngineer', 'wetServicesEngineer']);
  });

  it('maps missing contact details to empty strings so the inputs stay controlled', async () => {
    const onChange = vi.fn();
    render(<ProfessionalTeamSection team={team} onChange={onChange} />);
    fireEvent.click(screen.getAllByRole('button', { name: /pick from register/i })[1]);
    const picker = await screen.findByLabelText(/pick civil engineer from the contractor register/i);
    fireEvent.change(picker, { target: { value: 'c2' } });
    expect(onChange).toHaveBeenCalledWith({ ...team, civilEngineer: { name: '', company: 'Bare Co', phone: '', email: '' } });
  });

  it('keeps the filled fields editable as free text', () => {
    const filled = { ...team, architect: { name: 'Jane Volt', company: 'Sparks', phone: '1', email: 'j@x' } };
    const onChange = vi.fn();
    render(<ProfessionalTeamSection team={filled} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/contact name/i, { selector: '#arch-name' }), { target: { value: 'Jane V.' } });
    expect(onChange).toHaveBeenCalledWith({ ...filled, architect: { ...filled.architect, name: 'Jane V.' } });
  });
});
