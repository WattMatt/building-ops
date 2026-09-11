import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import type { AppRole } from '@/lib/constants';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: AppRole[];
}

export default function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { user, role, authError, mustSetPassword, onboardingCompleted, loading, refreshRole } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  // First-login gate: a user who must set their password is sent to /set-password
  // (a public route) before they can reach any protected page. This gate runs
  // BEFORE the onboarding gate — credentials first, then first-run.
  if (mustSetPassword) {
    return <Navigate to="/set-password" replace />;
  }

  // First-run gate (D2, redirect-style): authenticated users who have not
  // completed onboarding are sent to the dedicated /onboarding route.
  if (!onboardingCompleted) {
    return <Navigate to="/onboarding" replace />;
  }

  // Fail closed (A9): when this route is role-gated, a null role (no role rows)
  // or a failed role fetch denies access — never a privileged default.
  // Session-only routes (no allowedRoles) are unaffected.
  if (allowedRoles && (authError || !role || !allowedRoles.includes(role))) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="max-w-sm text-center">
          {authError ? (
            <>
              <h1 className="mb-2 text-2xl font-bold">Couldn't verify your access</h1>
              <p className="text-muted-foreground">
                Your role could not be loaded, so this page is locked for now. This is usually a connection problem, not a permissions one.
              </p>
              <Button variant="outline" size="sm" className="mt-4" onClick={() => { void refreshRole(); }}>
                Try again
              </Button>
            </>
          ) : (
            <>
              <h1 className="mb-2 text-2xl font-bold text-destructive">Access Denied</h1>
              <p className="text-muted-foreground">You don't have permission to access this page.</p>
            </>
          )}
          <p className="mt-4 text-sm">
            <Link to="/" className="underline">Back to dashboard</Link>
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
