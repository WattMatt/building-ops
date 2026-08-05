import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { ROLE_PRECEDENCE, type AppRole } from '@/lib/constants';
import { queryClient } from '@/lib/queryClient';

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
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName?: string) => Promise<{ error: Error | null }>;
  clearMustSetPassword: () => Promise<void>;
  /** Syncs in-memory state after the onboarding wizard has written onboarding_completed=true. */
  markOnboardingComplete: () => void;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: Error | null }>;
  inviteUser: (payload: InviteUserPayload) => Promise<InviteUserResult>;
  setUserStatus: (userId: string, action: 'deactivate' | 'reactivate') => Promise<void>;
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
          setTimeout(() => {
            fetchUserRole(session.user.id);
          }, 0);
        } else {
          setRole(null);
          setRoles([]);
          setAuthError(false);
          setMustSetPassword(false);
          setOnboardingCompleted(true);
        }
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
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
    await supabase.auth.signOut();
    // E3: purge the query cache so the next user (or a signed-out window)
    // cannot see the outgoing user's cached data.
    queryClient.clear();
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
        signIn,
        signUp,
        clearMustSetPassword,
        markOnboardingComplete,
        signOut,
        resetPassword,
        inviteUser,
        setUserStatus,
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
