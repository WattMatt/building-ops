import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/hooks/useBuildingMembers', () => ({
  useBuildingMembers: () => ({
    data: [
      { id: 'u1', full_name: 'Thabo M', avatar_url: null, role: 'user' },
      { id: 'u2', full_name: 'Lerato K', avatar_url: null, role: 'manager' },
    ],
    byId: new Map(),
    isLoading: false,
    isError: false,
  }),
  memberDisplayName: (m: { full_name: string | null }) => m.full_name ?? 'Unnamed user',
}));

import { AssigneePicker } from './AssigneePicker';

describe('AssigneePicker', () => {
  it('shows the current assignee name in the trigger', () => {
    render(<AssigneePicker buildingId="b1" value="u2" onChange={() => {}} />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Lerato K');
  });

  it('shows Unassigned when empty', () => {
    render(<AssigneePicker buildingId="b1" value={null} onChange={() => {}} />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Unassigned');
  });
});
