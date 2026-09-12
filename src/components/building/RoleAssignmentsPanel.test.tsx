import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const state = vi.hoisted(() => ({
  isAdminOrManager: true,
  rules: new Map<string, string>(),
  pendingByRole: new Map<string, number>(),
  isLoading: false,
  isError: false,
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isAdminOrManager: state.isAdminOrManager, user: { id: 'me' } }) }));
// Spread the real module: only the hook is stubbed; `roleLabel`, which this file also tests, stays real.
vi.mock('@/hooks/useBuildingRoleAssignments', async (orig) => ({
  ...(await orig<typeof import('@/hooks/useBuildingRoleAssignments')>()),
  useBuildingRoleAssignments: () => ({
    rules: state.rules,
    roles: ['user', 'manager'],
    pendingByRole: state.pendingByRole,
    isLoading: state.isLoading,
    isError: state.isError,
    setRule: vi.fn(),
    applyToPending: vi.fn(),
  }),
}));
vi.mock('@/hooks/useBuildingMembers', async (orig) => {
  const members = [
    { id: 'u1', full_name: 'Thabo M', avatar_url: null, role: 'user' },
    { id: 'u2', full_name: 'Lerato K', avatar_url: null, role: 'manager' },
  ];
  return {
    ...(await orig<typeof import('@/hooks/useBuildingMembers')>()),
    useBuildingMembers: () => ({ data: members, byId: new Map(members.map((m) => [m.id, m])), isLoading: false, isError: false }),
  };
});

import { RoleAssignmentsPanel, summaryLine, NO_DAILY_OWNER_WARNING } from './RoleAssignmentsPanel';
import { roleLabel } from '@/hooks/useBuildingRoleAssignments';

const renderPanel = () => render(<MemoryRouter><RoleAssignmentsPanel buildingId="b1" /></MemoryRouter>);

beforeEach(() => {
  state.isAdminOrManager = true;
  state.rules = new Map([['user', 'u1'], ['issue', 'u2']]);
  state.pendingByRole = new Map([['user', 3]]);
  state.isLoading = false;
  state.isError = false;
});

describe('RoleAssignmentsPanel (summary)', () => {
  it('renders nothing for users who cannot manage the team', () => {
    state.isAdminOrManager = false;
    renderPanel();
    expect(screen.queryByTestId('role-assignments-panel')).toBeNull();
  });

  it('names who catches daily tasks and issues, and links to the Team tab', () => {
    renderPanel();
    expect(screen.getByText('Daily tasks: Thabo M · Issues: Lerato K')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage team' })).toHaveAttribute('href', '/buildings/b1?tab=team');
    expect(screen.queryByRole('alert')).toBeNull();
    // No pickers, no apply button — those moved to the Team tab.
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Apply to existing pending tasks/ })).toBeNull();
  });

  it('says Nobody for a rule that has no person', () => {
    state.rules = new Map([['user', 'u1']]);
    renderPanel();
    expect(screen.getByText('Daily tasks: Thabo M · Issues: Nobody')).toBeInTheDocument();
  });

  it('warns plainly when there is no user rule and pending tasks exist', () => {
    state.rules = new Map([['issue', 'u2']]);
    renderPanel();
    expect(screen.getByRole('alert')).toHaveTextContent(NO_DAILY_OWNER_WARNING);
    expect(screen.getByText('Daily tasks: Nobody · Issues: Lerato K')).toBeInTheDocument();
  });

  it('does not warn when nothing is pending, even with no user rule', () => {
    state.rules = new Map();
    state.pendingByRole = new Map();
    renderPanel();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not warn while loading or on error', () => {
    state.rules = new Map();
    state.isLoading = true;
    const { unmount } = renderPanel();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Loading roles…');
    unmount();
    state.isLoading = false;
    state.isError = true;
    renderPanel();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Could not load the rules for this building.')).toBeInTheDocument();
  });

  it('summaryLine falls back for an id the member list does not know', () => {
    expect(summaryLine(new Map([['user', 'ghost']]), () => 'Assigned user')).toBe('Daily tasks: Assigned user · Issues: Nobody');
  });

  it('roleLabel humanises the two fixed roles and leaves template labels alone', () => {
    expect(roleLabel('user')).toBe('User (default)');
    expect(roleLabel('manager')).toBe('Manager');
    expect(roleLabel('HVAC Contractor')).toBe('HVAC Contractor');
  });
});
