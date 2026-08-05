import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AppRole } from '@/lib/constants';

// Guard unit tests (Standard A11). ProtectedRoute consumes AuthContext via
// useAuth() and react-router-dom's Navigate/useLocation, so those are the two
// seams stubbed here — the guard's own triage logic runs for real. Redirects
// render as a probe div carrying the target path so the routing decision is
// directly assertable without a router runtime.

interface AuthStub {
  user: { id: string } | null;
  role: AppRole | null;
  authError: boolean;
  mustSetPassword: boolean;
  onboardingCompleted: boolean;
  loading: boolean;
}

const authState = vi.hoisted(() => ({
  current: {
    user: { id: 'user-1' },
    role: 'admin',
    authError: false,
    mustSetPassword: false,
    onboardingCompleted: true,
    loading: false,
  } as {
    user: { id: string } | null;
    role: string | null;
    authError: boolean;
    mustSetPassword: boolean;
    onboardingCompleted: boolean;
    loading: boolean;
  },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => authState.current,
}));

vi.mock('react-router-dom', async () => {
  const { createElement: h } = await import('react');
  return {
    Navigate: ({ to }: { to: string }) => h('div', { 'data-testid': 'redirect' }, to),
    useLocation: () => ({
      pathname: '/dashboard',
      search: '',
      hash: '',
      state: null,
      key: 'default',
    }),
  };
});

import ProtectedRoute from './ProtectedRoute';

function renderGuard(allowedRoles?: AppRole[]) {
  return render(
    <ProtectedRoute allowedRoles={allowedRoles}>
      <div data-testid="protected-content">PROTECTED</div>
    </ProtectedRoute>
  );
}

const redirectTarget = () => screen.queryByTestId('redirect')?.textContent ?? null;
const contentShown = () => screen.queryByTestId('protected-content') !== null;
const accessDenied = () => screen.queryByText('Access Denied') !== null;

function setAuth(overrides: Partial<AuthStub>) {
  authState.current = { ...authState.current, ...overrides };
}

describe('ProtectedRoute', () => {
  beforeEach(() => {
    authState.current = {
      user: { id: 'user-1' },
      role: 'admin',
      authError: false,
      mustSetPassword: false,
      onboardingCompleted: true,
      loading: false,
    };
  });

  it('shows the loader while auth state is still resolving', () => {
    setAuth({ loading: true });
    renderGuard();

    expect(screen.queryByText('Loading...')).not.toBeNull();
    expect(contentShown()).toBe(false);
    expect(redirectTarget()).toBeNull();
  });

  it('redirects a signed-out visitor to /auth', () => {
    setAuth({ user: null });
    renderGuard();

    expect(redirectTarget()).toBe('/auth');
    expect(contentShown()).toBe(false);
  });

  it('denies a role-gated route when the user has no role rows (fail closed)', () => {
    setAuth({ role: null });
    renderGuard(['admin']);

    expect(accessDenied()).toBe(true);
    expect(contentShown()).toBe(false);
    expect(redirectTarget()).toBeNull();
  });

  it('denies a role-gated route when the role fetch errored, even with a cached allowed role (fail closed)', () => {
    setAuth({ role: 'admin', authError: true });
    renderGuard(['admin']);

    expect(accessDenied()).toBe(true);
    expect(contentShown()).toBe(false);
  });

  it('denies a role-gated route on role mismatch', () => {
    setAuth({ role: 'user' });
    renderGuard(['admin', 'manager']);

    expect(accessDenied()).toBe(true);
    expect(contentShown()).toBe(false);
  });

  it('renders the protected content for an allowed role', () => {
    setAuth({ role: 'manager' });
    renderGuard(['admin', 'manager']);

    expect(contentShown()).toBe(true);
    expect(accessDenied()).toBe(false);
    expect(redirectTarget()).toBeNull();
  });

  it('sends a user who must set their password to /set-password', () => {
    setAuth({ mustSetPassword: true });
    renderGuard();

    expect(redirectTarget()).toBe('/set-password');
    expect(contentShown()).toBe(false);
  });

  it('sends a user who has not completed onboarding to /onboarding', () => {
    setAuth({ onboardingCompleted: false });
    renderGuard();

    expect(redirectTarget()).toBe('/onboarding');
    expect(contentShown()).toBe(false);
  });

  it('runs the credential gate before the onboarding gate', () => {
    setAuth({ mustSetPassword: true, onboardingCompleted: false });
    renderGuard();

    expect(redirectTarget()).toBe('/set-password');
  });

  it('admits a signed-in user with no role to a session-only route (no allowedRoles) — RLS is the data boundary', () => {
    setAuth({ role: null });
    renderGuard();

    expect(contentShown()).toBe(true);
    expect(accessDenied()).toBe(false);
  });
});
