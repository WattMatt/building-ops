/**
 * `/` lands site roles on My Day and managers on the portfolio dashboard (conformance A1).
 *
 * Site roles are *redirected* rather than served My Day in place: rendering My Day at `/`
 * leaves the address bar saying `/` while the page says "My Day", so the sidebar highlights
 * Dashboard (or nothing), a bookmark or a shared link is ambiguous, and Back behaves oddly.
 * One destination per control — after this, "My Day" is the only entry that lights up.
 *
 * Auth has already resolved by the time this renders: ProtectedRoute holds the loading state,
 * so `isAdminOrManager` is never a half-loaded false. A failed role fetch stays false, which
 * lands on My Day — the correct fail-closed direction.
 */
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import Dashboard from './Dashboard';

export default function RoleHome() {
  const { isAdminOrManager } = useAuth();
  return isAdminOrManager ? <Dashboard /> : <Navigate to="/my-day" replace />;
}
