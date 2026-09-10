import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { ROLE_PRECEDENCE, type AppRole } from '@/lib/constants';
import { queryClient } from '@/lib/queryClient';
import { clearPersistedCache, stopPersisting } from '@/lib/persist';
import { clearQueue } from '@/lib/offline/queue';
import { identify, resetAnalytics } from '@/lib/analytics';

export interface InviteUserPayload {
  email: string;
  fullName?: string;
  role: 'admin' | 'manager' | 'user' | 'reviewer';
  buildingIds?: string[];
  mode?: 'invite' | 'temp_password';
}

export interface InviteUserResult {
  userId: string;
  status: 'invited' | 'temp_password';
  tempPassword?: string;
  // Invite delivery: emailed=true when Resend accepted the message. When email
  // could not be sent, actionLink carries the setup link for manual delivery.
  emailed?: boolean;
  actionLink?: string | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  role: AppRole | null;
  /** All roles held by the user (user_roles can hold multiple rows per user). */
  roles: AppRole[];
  /** True when the role/profile fetch failed — role-gated routes must fail closed. */
  authError: boolean;
  mustSetPassword: boolean;
  onboardingCompleted: boolean;
  isRecovery: boolean;
  loading: boolean;
  /** Re-run the role/profile fetch for the current session (M-8: a transient failure
   *  must not read as a permissions problem, and the user needs a way to retry). */
  refreshRole: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName?: string) => Promise<{ error: Error | null }>;
  clearMustSetPassword: () => Promise<void>;
  /** Syncs in-memory state after the onboarding wizard has written onboarding_completed=true. */
  markOnboardingComplete: () => void;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: Error | null }>;
  inviteUser: (payload: InviteUserPayload) => Promise<InviteUserResult>;
  setUserStatus: (userId: string, action: 'deactivate' | 'reactivate') => Promise<void>;
  setUserRole: (userId: string, newRole: AppRole) => Promise<void>;
  isAdmin: boolean;
  isManager: boolean;
  isAdminOrManager: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [authError, setAuthError] = useState(false);
  const [mustSetPassword, setMustSetPassword] = useState(false);
  const [onboardingCompleted, setOnboardingCompleted] = useState(true);
  const [isRecovery, setIsRecovery] = useState(false);
  const [loading, setLoading] = useState(true);
  /**
   * Whether a signed-in session has been seen since this tab loaded. Supabase fires a
   * no-session auth event on first load for a signed-out visitor too, and resetting there
   * would rotate the anonymous PostHog distinct id on every cold start — orphaning the
   * pre-login pageviews from the session they belong to. Only a session that actually
   * ended is worth a reset.
   */
  const hadSessionRef = useRef(false);

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        // Recovery links that land anywhere except the reset/set-password
        // pages (e.g. resets initiated from the iOS app carry no redirect_to
        // and land on the root) must show the new-password form — not
        // silently sign the user in. The hash marker re-arms ResetPassword's
        // recovery mode because the original URL hash is consumed before
        // this event fires.
        if (event === 'PASSWORD_RECOVERY') {
          // This listener is registered at app init, so it reliably catches the
          // event even when a page's own listener attaches too late and the URL
          // hash has already been consumed. Pages read isRecovery to switch into
          // set-new-password mode.
          setIsRecovery(true);
          if (
            window.location.pathname !== '/reset' &&
            window.location.pathname !== '/set-password'
          ) {
            window.location.replace('/reset#type=recovery');
            return;
          }
        }
        setSession(session);
        setUser(session?.user ?? null);

        // Defer role fetching to avoid deadlock
        if (session?.user) {
          hadSessionRef.current = true;
          setTimeout(() => {
            fetchUserRole(session.user.id);
          }, 0);
        } else {
          setRole(null);
          setRoles([]);
          setAuthError(false);
          setMustSetPassword(false);
          setOnboardingCompleted(true);
          // Sessions also end without going through signOut() — an expired or revoked
          // token, or a sign-out in another tab. Drop the analytics identity here too,
          // so the next person on this browser is not attributed to the outgoing user.
          // Guarded on a session having actually existed: see hadSessionRef.
          if (hadSessionRef.current) {
            hadSessionRef.current = false;
            resetAnalytics();
          }
        }
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        hadSessionRef.current = true;
        fetchUserRole(session.user.id);
      } else {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Derives the highest-privilege role from the raw user_roles rows.
  // Unknown role strings are ignored; no rows (or only unknown ones) => null.
  const deriveRoles = (rows: { role: string | null }[]): AppRole[] => {
    const known = new Set(
      rows
        .map((r) => r.role)
        .filter((r): r is AppRole => typeof r === 'string' && (ROLE_PRECEDENCE as readonly string[]).includes(r))
    );
    return ROLE_PRECEDENCE.filter((r) => known.has(r));
  };

  const fetchUserRole = async (userId: string) => {
    try {
      // user_roles can hold multiple rows per user (the table carries a
      // building_id column), so fetch ALL rows and derive the highest role.
      // Fail closed (A9): on error the role becomes null AND authError is set,
      // so role-gated routes deny instead of defaulting to a privileged 'user'.
      const { data: roleData, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId);

      if (error) {
        console.error('Error fetching user role:', error);
        setRole(null);
        setRoles([]);
        setAuthError(true);
      } else {
        const derived = deriveRoles(roleData ?? []);
        setRoles(derived);
        setRole(derived[0] ?? null); // null (no role rows) => role-gated routes deny
        setAuthError(false);
        // Product analytics identity: id + role only, never email or name.
        identify(userId, { role: derived[0] ?? null });
      }

      // First-login + onboarding gates: read must_set_password and
      // onboarding_completed from the user's own profile. The columns may be
      // absent from the generated types until they are regenerated, so select
      // defensively and read them via a narrow cast.
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();
      const p = profileData as { must_set_password?: boolean; onboarding_completed?: boolean } | null;
      setMustSetPassword(Boolean(p?.must_set_password));
      // Missing row (no error, data null) => wizard shows and creates-or-surfaces
      // the row (D4). Fetch ERROR => skip the UX gate rather than trapping the
      // user; the role guard + RLS remain the security boundary.
      setOnboardingCompleted(profileError ? true : p ? Boolean(p.onboarding_completed) : false);
    } catch (error) {
      console.error('Error fetching user role:', error);
      setRole(null);
      setRoles([]);
      setAuthError(true);
    } finally {
      setLoading(false);
    }
  };

  // M-8: lets a role-gated route retry after a transient user_roles fetch
  // failure instead of leaving the user stuck behind a permanent-looking
  // "Access Denied" screen.
  const refreshRole = async () => {
    if (!user?.id) return;
    setLoading(true);
    await fetchUserRole(user.id);
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  };

  // Self-signup is disabled — accounts are created by an administrator via the
  // invite-user edge function. This stub remains only to satisfy the context
  // type; it has no UI callers and must never create an account.
  const signUp = async (_email: string, _password: string, _fullName?: string) => {
    throw new Error('Self-signup is disabled — contact your administrator');
  };

  // Clears the first-login gate for the current user, then syncs the in-memory
  // state so ProtectedRoute stops bouncing to /set-password. A DB trigger
  // (2026-08-05_06_phase2_onboarding_standard.sql) blocks client-side writes to
  // profiles.must_set_password, so the clear is routed through the
  // clear-password-gate edge function: it validates the JWT, confirms a
  // credential update just happened, and clears the flag server-side for THAT
  // user only. Throws on failure so callers can keep the user on the page.
  const clearMustSetPassword = async () => {
    const { error } = await supabase.functions.invoke('clear-password-gate', {
      body: {},
    });
    if (error) {
      // Non-2xx responses surface the JSON body on error.context.
      let message = error.message || 'Failed to clear the password gate';
      try {
        const body = await (error as { context?: Response }).context?.json?.();
        if (body?.error) message = body.error;
      } catch {
        // keep the default message
      }
      throw new Error(message);
    }

    setMustSetPassword(false);
  };

  // The onboarding wizard writes onboarding_completed=true itself (own-profile
  // update is allowed); this only syncs the in-memory gate state.
  const markOnboardingComplete = () => {
    setOnboardingCompleted(true);
  };

  const signOut = async () => {
    // Captured before anything nulls it: the persisted store is keyed by this id.
    const outgoingUserId = user?.id;
    await supabase.auth.signOut();
    // E3: purge the query cache so the next user (or a signed-out window)
    // cannot see the outgoing user's cached data — in memory and on disk.
    // Persistence must stop BEFORE clear(): clear() emits synchronous `removed`
    // events and the persister writes the first one immediately, which would put
    // the outgoing user's remaining rows back on disk after the delete below.
    stopPersisting();
    queryClient.clear();
    void clearPersistedCache(outgoingUserId);
    // Unsynced offline writes go with the user too — a shared phone must never replay them
    // as someone else. The queue sheet warns that signing out drops queued changes.
    if (outgoingUserId) void clearQueue(outgoingUserId);
    resetAnalytics();
    setUser(null);
    setSession(null);
    setRole(null);
    setRoles([]);
    setAuthError(false);
    setMustSetPassword(false);
    setOnboardingCompleted(true);
  };

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset`,
    });
    return { error };
  };

  // Thin wrapper over the invite-user edge function (admin-only, service role).
  const inviteUser = async (payload: InviteUserPayload): Promise<InviteUserResult> => {
    const { data, error } = await supabase.functions.invoke('invite-user', {
      body: payload,
    });
    if (error) {
      // Non-2xx responses surface the JSON body on error.context.
      let message = error.message || 'Failed to invite user';
      try {
        const body = await (error as { context?: Response }).context?.json?.();
        if (body?.error) message = body.error;
      } catch {
        // keep the default message
      }
      throw new Error(message);
    }
    return data as InviteUserResult;
  };

  // Thin wrapper over the set-user-status edge function (admin-only).
  const setUserStatus = async (userId: string, action: 'deactivate' | 'reactivate') => {
    const { error } = await supabase.functions.invoke('set-user-status', {
      body: { userId, action },
    });
    if (error) {
      let message = error.message || 'Failed to update user status';
      try {
        const body = await (error as { context?: Response }).context?.json?.();
        if (body?.error) message = body.error;
      } catch {
        // keep the default message
      }
      throw new Error(message);
    }
  };

  // Role changes go through an admin-verified edge function (never a raw client
  // write), so the last-admin and self-demotion guards cannot be bypassed and a
  // zero-row update can no longer report success.
  const setUserRole = async (userId: string, newRole: AppRole) => {
    const { error } = await supabase.functions.invoke('set-user-role', {
      body: { userId, role: newRole },
    });
    if (error) {
      let message = error.message || 'Failed to update user role';
      try {
        const body = await (error as { context?: Response }).context?.json?.();
        if (body?.error) message = body.error;
      } catch {
        // keep the default message
      }
      throw new Error(message);
    }
  };

  const isAdmin = role === 'admin';
  const isManager = role === 'manager';
  const isAdminOrManager = isAdmin || isManager;

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        role,
        roles,
        authError,
        mustSetPassword,
        onboardingCompleted,
        isRecovery,
        loading,
        refreshRole,
        signIn,
        signUp,
        clearMustSetPassword,
        markOnboardingComplete,
        signOut,
        resetPassword,
        inviteUser,
        setUserStatus,
        setUserRole,
        isAdmin,
        isManager,
        isAdminOrManager,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
