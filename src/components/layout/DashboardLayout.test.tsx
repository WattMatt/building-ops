import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AppRole } from '@/lib/constants';

/**
 * Only the sidebar's role shaping is under test: which items and which GROUPS render for a role
 * (spec pilot-field §4.3: a group with nothing the reader can open is not drawn). Every shell
 * piece with its own data source is stubbed; the sidebar primitives run for real.
 */
const auth = vi.hoisted(() => ({
  current: { user: { id: 'u1', email: 'thabo@example.com' }, role: 'user' as AppRole | null, isAdminOrManager: false, signOut: vi.fn() },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth.current }));
vi.mock('@/hooks/useOrganization', () => ({ useOrganization: () => ({ organization: null }) }));
vi.mock('@/hooks/useUserProfile', () => ({ useUserProfile: () => ({ profile: null, loading: false }) }));
vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => ({ unreadByKind: () => 0 }),
  useNotificationsRealtime: () => {},
}));
vi.mock('@/lib/auth-audit', () => ({ recordAuthEvent: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));
vi.mock('@/components/shell/useHotkey', () => ({ useHotkey: () => {} }));
vi.mock('@/components/ThemeToggle', () => ({ ThemeToggle: () => null }));
vi.mock('@/components/HintsToggle', () => ({ HintsToggle: () => null }));
vi.mock('@/components/notifications/NotificationBell', () => ({ NotificationBell: () => null }));
vi.mock('@/components/pwa/OfflineBanner', () => ({ OfflineBanner: () => null }));
vi.mock('@/components/pwa/UpdateToast', () => ({ UpdateToast: () => null }));
vi.mock('@/components/offline/OfflineQueueRunner', () => ({ OfflineQueueRunner: () => null }));
vi.mock('@/components/offline/SyncStatusPill', () => ({ SyncStatusPill: () => null }));
vi.mock('@/components/shell/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('@/components/shell/QuickCreateMenu', () => ({ QuickCreateMenu: () => null }));

import DashboardLayout from './DashboardLayout';

const setRole = (role: AppRole | null) => {
  auth.current = { ...auth.current, role, isAdminOrManager: role === 'admin' || role === 'manager' };
};

const renderLayout = () =>
  render(
    <MemoryRouter initialEntries={['/my-day']}>
      <DashboardLayout>
        <div>page</div>
      </DashboardLayout>
    </MemoryRouter>,
  );

const groupLabels = () =>
  Array.from(document.querySelectorAll('[data-sidebar="group-label"]')).map((el) => el.textContent);

const link = (name: string) => screen.queryByRole('link', { name });

describe('DashboardLayout sidebar', () => {
  beforeEach(() => setRole('user'));

  it('draws only the groups a field user can open: no Building Reports, no Administration (spec pilot-field §4.3)', () => {
    renderLayout();
    expect(groupLabels()).toEqual(['Main', 'Reports & Audit']);
    expect(link('My Day')).not.toBeNull();
    expect(link('Forms Library')).not.toBeNull();
    expect(link('Building Reports')).toBeNull();
    expect(link('Trends')).toBeNull();
    expect(link('Compliance Reports')).toBeNull();
    expect(link('Contractors')).toBeNull();
    expect(link('Settings')).toBeNull();
    expect(link('Dashboard')).toBeNull();
  });

  it('draws all three groups for a manager, with Building Reports and without User Management', () => {
    setRole('manager');
    renderLayout();
    expect(groupLabels()).toEqual(['Main', 'Reports & Audit', 'Administration']);
    expect(link('Building Reports')).not.toBeNull();
    expect(link('Contractors')).not.toBeNull();
    expect(link('User Management')).toBeNull();
  });

  it('adds User Management for an admin', () => {
    setRole('admin');
    renderLayout();
    expect(link('User Management')).not.toBeNull();
    expect(link('Building Reports')).not.toBeNull();
  });

  it('fails closed with no role: ungated items only, no Administration group', () => {
    setRole(null);
    renderLayout();
    expect(groupLabels()).toEqual(['Main', 'Reports & Audit']);
    expect(link('Building Reports')).toBeNull();
    expect(link('Dashboard')).toBeNull();
    expect(link('Forms Library')).not.toBeNull();
  });
});
