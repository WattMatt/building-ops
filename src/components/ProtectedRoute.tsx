import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import type { AppRole } from '@/lib/constants';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: AppRole[];
}

export default function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { user, role, authError, mustSetPassword, onboardingCompleted, loading } = useAuth();
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
        <div className="text-center">
          <h1 className="text-2xl font-bold text-destructive mb-2">Access Denied</h1>
          <p className="text-muted-foreground">
            You don't have permission to access this page.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
