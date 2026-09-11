import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

// jsdom doesn't implement the Pointer Events capture API that Radix's Select uses to
// open/close on pointer down; polyfill it so the combobox is drivable here.
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

const state = vi.hoisted(() => ({
  isAdminOrManager: true,
  rules: new Map<string, string>(),
  roles: [] as string[],
  pendingByRole: new Map<string, number>(),
  isLoading: false,
  setRule: vi.fn(async () => {}),
  applyToPending: vi.fn(async () => 0),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isAdminOrManager: state.isAdminOrManager, user: { id: 'me' } }) }));
vi.mock('sonner', () => ({ toast: state.toast }));
vi.mock('@/hooks/useBuildingRoleAssignments', () => ({
  useBuildingRoleAssignments: () => ({
    rules: state.rules,
    roles: state.roles,
    pendingByRole: state.pendingByRole,
    isLoading: state.isLoading,
    isError: false,
    setRule: state.setRule,
    applyToPending: state.applyToPending,
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

import { RoleAssignmentsPanel, roleLabel } from './RoleAssignmentsPanel';

beforeEach(() => {
  state.isAdminOrManager = true;
  state.rules = new Map([['user', 'u1']]);
  state.roles = ['user', 'manager', 'HVAC Contractor'];
  state.pendingByRole = new Map([['user', 3], ['HVAC Contractor', 2]]);
  state.isLoading = false;
  state.setRule.mockClear();
  state.applyToPending.mockClear();
  state.applyToPending.mockResolvedValue(0);
  state.toast.success.mockClear();
  state.toast.error.mockClear();
  state.toast.info.mockClear();
});

describe('RoleAssignmentsPanel', () => {
  it('renders nothing for users who cannot write the rules', () => {
    state.isAdminOrManager = false;
    render(<RoleAssignmentsPanel buildingId="b1" buildingName="Fortress Mall" />);
    expect(screen.queryByTestId('role-assignments-panel')).toBeNull();
  });

  it('renders one picker row per role, showing the ruled person', () => {
    render(<RoleAssignmentsPanel buildingId="b1" buildingName="Fortress Mall" />);
    expect(screen.getByText('Who does what here')).toBeInTheDocument();
    expect(screen.getByText('New tasks are assigned automatically from these rules every night.')).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('User (default)')).toBeInTheDocument();
    expect(within(rows[0]).getByRole('combobox')).toHaveTextContent('Thabo M');
    expect(within(rows[1]).getByText('Manager')).toBeInTheDocument();
    expect(within(rows[1]).getByRole('combobox')).toHaveTextContent('Nobody');
    expect(within(rows[2]).getByText('HVAC Contractor')).toBeInTheDocument();
  });

  it('choosing a member calls setRule for that role and toasts', async () => {
    render(<RoleAssignmentsPanel buildingId="b1" buildingName="Fortress Mall" />);
    const trigger = within(screen.getAllByRole('listitem')[2]).getByRole('combobox');
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    const option = screen.getByText('Lerato K');
    fireEvent.pointerUp(option);
    fireEvent.click(option);
    await waitFor(() => expect(state.setRule).toHaveBeenCalledWith('HVAC Contractor', 'u2'));
    await waitFor(() => expect(state.toast.success).toHaveBeenCalledWith('HVAC Contractor: Lerato K'));
  });

  it('counts only the unassigned pending tasks whose role has a rule', () => {
    render(<RoleAssignmentsPanel buildingId="b1" buildingName="Fortress Mall" />);
    // user has a rule (3 pending); HVAC Contractor has 2 pending but no rule yet.
    expect(screen.getByRole('button', { name: /Apply to existing pending tasks \(3\)/ })).toBeEnabled();
  });

  it('apply calls applyToPending, toasts the count and reports it to the owner', async () => {
    state.applyToPending.mockResolvedValue(3);
    const onApplied = vi.fn();
    render(<RoleAssignmentsPanel buildingId="b1" buildingName="Fortress Mall" onApplied={onApplied} />);
    fireEvent.click(screen.getByRole('button', { name: /Apply to existing pending tasks/ }));
    await waitFor(() => expect(state.applyToPending).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(state.toast.success).toHaveBeenCalledWith('Assigned 3 pending tasks at Fortress Mall'));
    expect(onApplied).toHaveBeenCalledWith(3);
  });

  it('apply is disabled when no rule would touch anything', () => {
    state.pendingByRole = new Map([['HVAC Contractor', 2]]);
    render(<RoleAssignmentsPanel buildingId="b1" buildingName="Fortress Mall" />);
    expect(screen.getByRole('button', { name: /Apply to existing pending tasks \(0\)/ })).toBeDisabled();
  });

  it('roleLabel humanises the two fixed roles and leaves template labels alone', () => {
    expect(roleLabel('user')).toBe('User (default)');
    expect(roleLabel('manager')).toBe('Manager');
    expect(roleLabel('HVAC Contractor')).toBe('HVAC Contractor');
  });
});
