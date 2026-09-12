import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const state = vi.hoisted(() => ({
  isAdminOrManager: true,
  members: [
    { id: 'm1', full_name: 'Lerato K', avatar_url: null, role: 'manager' },
    { id: 'u1', full_name: 'Thabo M', avatar_url: null, role: 'user' },
    { id: 'u2', full_name: 'Ayanda D', avatar_url: null, role: 'user' },
  ],
  membersLoading: false,
  membersError: false,
  rules: new Map<string, string>([['user', 'u1']]),
  rulesLoading: false,
  rulesError: false,
  roles: ['user', 'manager', 'HVAC Contractor'],
  pendingByRole: new Map<string, number>([['user', 3]]),
  people: [
    { id: 'u1', full_name: 'Thabo M', avatar_url: null, role: 'user', deactivated: false },
    { id: 'u3', full_name: 'Sipho N', avatar_url: null, role: 'user', deactivated: false },
    { id: 'm1', full_name: 'Lerato K', avatar_url: null, role: 'manager', deactivated: false },
  ],
  setRule: vi.fn(async () => {}),
  applyToPending: vi.fn(async () => 0),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  // Untyped vi.fn() on purpose: beforeEach sets the resolved values, and single tests override
  // them with shapes (partial failures) an inferred success type would reject.
  actions: {
    countOpenTasksFor: vi.fn(),
    addMember: vi.fn(),
    removeMember: vi.fn(),
  },
}));

/** What TeamTab passes for a partial outcome: the toast must not auto-dismiss. */
const STICKY = { duration: Infinity, closeButton: true };

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isAdminOrManager: state.isAdminOrManager, user: { id: 'me' } }) }));
vi.mock('sonner', () => ({ toast: state.toast }));
vi.mock('@/hooks/useBuildingMembers', async (orig) => ({
  ...(await orig<typeof import('@/hooks/useBuildingMembers')>()),
  useBuildingMembers: () => ({
    data: state.membersError || state.membersLoading ? undefined : state.members,
    byId: new Map(state.members.map((m) => [m.id, m])),
    isLoading: state.membersLoading,
    isError: state.membersError,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/hooks/useBuildingRoleAssignments', async (orig) => ({
  ...(await orig<typeof import('@/hooks/useBuildingRoleAssignments')>()),
  useBuildingRoleAssignments: () => ({
    rules: state.rules,
    roles: state.roles,
    pendingByRole: state.pendingByRole,
    isLoading: state.rulesLoading,
    isError: state.rulesError,
    setRule: state.setRule,
    applyToPending: state.applyToPending,
  }),
}));
vi.mock('@/hooks/useAssignablePeople', async (orig) => ({
  ...(await orig<typeof import('@/hooks/useAssignablePeople')>()),
  useAssignablePeople: () => ({ data: state.people, isLoading: false, isError: false }),
}));
vi.mock('./teamActions', async (orig) => ({
  ...(await orig<typeof import('./teamActions')>()),
  countOpenTasksFor: state.actions.countOpenTasksFor,
  addMember: state.actions.addMember,
  removeMember: state.actions.removeMember,
}));

import TeamTab from './TeamTab';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, children);
const renderTab = () => render(<TeamTab buildingId="b1" buildingName="Fortress Mall" />, { wrapper });

beforeEach(() => {
  state.isAdminOrManager = true;
  state.membersLoading = false;
  state.membersError = false;
  state.rules = new Map([['user', 'u1']]);
  state.rulesLoading = false;
  state.rulesError = false;
  state.pendingByRole = new Map([['user', 3]]);
  state.setRule.mockClear();
  state.applyToPending.mockClear().mockResolvedValue(0);
  state.actions.countOpenTasksFor.mockClear().mockResolvedValue(2);
  state.actions.addMember.mockClear().mockResolvedValue({ ok: true });
  state.actions.removeMember.mockClear().mockResolvedValue({ ok: true, done: ['rules', 'tasks', 'membership'], tasksUnassigned: 2, expectedOpenTasks: 2 });
  Object.values(state.toast).forEach((f) => f.mockClear());
});

describe('TeamTab', () => {
  it('renders nothing for users who cannot manage the team', () => {
    state.isAdminOrManager = false;
    renderTab();
    expect(screen.queryByTestId('team-tab')).toBeNull();
  });

  it('lists managers without controls and field members with role chips', () => {
    renderTab();
    const managers = screen.getByRole('list', { name: 'Managers' });
    expect(within(managers).getByText('Lerato K')).toBeInTheDocument();
    expect(within(managers).queryByRole('button')).toBeNull();

    const thabo = screen.getByTestId('member-u1');
    expect(within(thabo).getByRole('button', { name: 'User (default)' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(thabo).getByRole('button', { name: 'HVAC Contractor' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(screen.getByTestId('member-u2')).getByRole('button', { name: 'User (default)' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('tapping an unheld chip moves that rule to the member', async () => {
    renderTab();
    fireEvent.click(within(screen.getByTestId('member-u2')).getByRole('button', { name: 'User (default)' }));
    await waitFor(() => expect(state.setRule).toHaveBeenCalledWith('user', 'u2'));
    await waitFor(() => expect(state.toast.success).toHaveBeenCalledWith('User (default): Ayanda D'));
  });

  it('tapping the held chip clears the rule', async () => {
    renderTab();
    fireEvent.click(within(screen.getByTestId('member-u1')).getByRole('button', { name: 'User (default)' }));
    await waitFor(() => expect(state.setRule).toHaveBeenCalledWith('user', null));
    await waitFor(() => expect(state.toast.success).toHaveBeenCalledWith('User (default): nobody'));
  });

  it('a failed rule write toasts the reason', async () => {
    state.setRule.mockRejectedValueOnce(new Error('rls'));
    renderTab();
    fireEvent.click(within(screen.getByTestId('member-u2')).getByRole('button', { name: 'HVAC Contractor' }));
    await waitFor(() => expect(state.toast.error).toHaveBeenCalledWith('Could not save the rule: rls'));
  });

  it('Add person offers only non-members who are field staff and, with a user rule present, no default checkbox', async () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Add person/ }));
    const list = await screen.findByRole('listbox', { name: 'People' });
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual(['Sipho N']);
    expect(screen.queryByLabelText('Also make them the default for daily tasks')).toBeNull();
    fireEvent.click(within(list).getByText('Sipho N'));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(state.actions.addMember).toHaveBeenCalledWith('b1', 'u3', false));
    await waitFor(() => expect(state.toast.success).toHaveBeenCalledWith('Added Sipho N to Fortress Mall'));
    await waitFor(() => expect(screen.queryByRole('listbox', { name: 'People' })).toBeNull());
  });

  it('with no user rule, Add person offers the daily-task default checked by default and writes both', async () => {
    state.rules = new Map();
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Add person/ }));
    const box = await screen.findByLabelText('Also make them the default for daily tasks');
    expect(box).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByText('Sipho N'));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(state.actions.addMember).toHaveBeenCalledWith('b1', 'u3', true));
    await waitFor(() => expect(state.toast.success).toHaveBeenCalledWith('Added Sipho N to Fortress Mall and made them the default for daily tasks'));
  });

  it('never offers the default while the rules are still loading — an empty Map says nothing yet', async () => {
    state.rules = new Map();
    state.rulesLoading = true;
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Add person/ }));
    await screen.findByRole('listbox', { name: 'People' });
    expect(screen.queryByLabelText('Also make them the default for daily tasks')).toBeNull();
    fireEvent.click(screen.getByText('Sipho N'));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(state.actions.addMember).toHaveBeenCalledWith('b1', 'u3', false));
  });

  it('never offers the default when the rules failed to load', async () => {
    state.rules = new Map();
    state.rulesError = true;
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Add person/ }));
    await screen.findByRole('listbox', { name: 'People' });
    expect(screen.queryByLabelText('Also make them the default for daily tasks')).toBeNull();
  });

  it('reports a rule failure after access was granted with a toast that stays until dismissed, and closes the dialog', async () => {
    state.rules = new Map();
    state.actions.addMember.mockResolvedValueOnce({ ok: false, step: 'default_rule', message: 'someone already holds the daily-task default here' });
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Add person/ }));
    fireEvent.click(await screen.findByText('Sipho N'));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(state.toast.error).toHaveBeenCalledWith(
      'Added Sipho N to Fortress Mall, but could not make them the default for daily tasks: someone already holds the daily-task default here',
      STICKY,
    ));
    await waitFor(() => expect(screen.queryByRole('listbox', { name: 'People' })).toBeNull());
  });

  it('keeps the dialog open with the pick when the access row could not be written, so retry is one tap', async () => {
    state.actions.addMember.mockResolvedValueOnce({ ok: false, step: 'membership', message: 'rls' });
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Add person/ }));
    fireEvent.click(await screen.findByText('Sipho N'));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(state.toast.error).toHaveBeenCalledWith('Could not add Sipho N: rls'));
    expect(screen.getByRole('listbox', { name: 'People' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Sipho N' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled();
  });

  it('disables Add person while the member list is loading or failed', () => {
    state.membersLoading = true;
    const { unmount } = renderTab();
    expect(screen.getByRole('button', { name: /Add person/ })).toBeDisabled();
    unmount();
    state.membersLoading = false;
    state.membersError = true;
    renderTab();
    expect(screen.getByRole('button', { name: /Add person/ })).toBeDisabled();
  });

  it('Remove asks with the open-task count, then runs the three-step removal', async () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Thabo M' }));
    expect(await screen.findByText('2 open tasks at this building are assigned to them and will be left with no owner. Their role rules here will be removed and they will lose access to this building.')).toBeInTheDocument();
    expect(state.actions.countOpenTasksFor).toHaveBeenCalledWith('b1', 'u1');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(state.actions.removeMember).toHaveBeenCalledWith('b1', 'u1', ['user'], 2));
    await waitFor(() => expect(state.toast.success).toHaveBeenCalledWith('Removed Thabo M from this building'));
  });

  it('a partial removal failure says what was and was not undone, and stays until dismissed', async () => {
    state.actions.removeMember.mockResolvedValueOnce({ ok: false, done: ['rules', 'tasks'], failed: 'membership', message: 'no access row was removed', tasksUnassigned: 2, expectedOpenTasks: 2 });
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Thabo M' }));
    await screen.findByText(/2 open tasks/);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(state.toast.error).toHaveBeenCalledWith(
      'Could not finish removing Thabo M: no access row was removed. Done: their rules here were removed, 2 tasks were unassigned. Not done: building access was not removed.',
      STICKY,
    ));
  });

  it('a removal that unassigned fewer tasks than promised is a sticky warning, not a success', async () => {
    state.actions.removeMember.mockResolvedValueOnce({ ok: true, done: ['rules', 'tasks', 'membership'], tasksUnassigned: 1, expectedOpenTasks: 2 });
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Thabo M' }));
    await screen.findByText(/2 open tasks/);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(state.toast.warning).toHaveBeenCalledWith(
      'Removed Thabo M from this building, but only 1 of 2 open tasks were unassigned. Check the open tasks here.',
      STICKY,
    ));
    expect(state.toast.success).not.toHaveBeenCalled();
  });

  it('Apply to existing pending tasks counts only ruled roles and reports the total', async () => {
    state.applyToPending.mockResolvedValue(3);
    renderTab();
    const apply = screen.getByRole('button', { name: /Apply to existing pending tasks \(3\)/ });
    fireEvent.click(apply);
    await waitFor(() => expect(state.applyToPending).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(state.toast.success).toHaveBeenCalledWith('Assigned 3 pending tasks at Fortress Mall'));
  });

  it('shows a plain error with retry when the member list fails', () => {
    state.membersError = true;
    renderTab();
    expect(screen.getByText('Could not load the people on this building.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
