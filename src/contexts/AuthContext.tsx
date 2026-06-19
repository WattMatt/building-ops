import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type AppRole = Database['public']['Enums']['app_role'];

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
  mustSetPassword: boolean;
  isRecovery: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName?: string) => Promise<{ error: Error | null }>;
  clearMustSetPassword: () => Promise<void>;
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
  const [mustSetPassword, setMustSetPassword] = useState(false);
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
          setMustSetPassword(false);
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

  const fetchUserRole = async (userId: string) => {
    try {
      const { data: roleData, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .single();

      if (error) {
        console.error('Error fetching user role:', error);
        setRole('user'); // Default to user if role fetch fails
      } else {
        setRole(roleData?.role ?? 'user');
      }

      // First-login gate: read must_set_password from the user's own profile.
      // The column may be absent from the generated types until they are
      // regenerated, so select defensively and read it via a narrow cast.
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();
      setMustSetPassword(Boolean((profileData as { must_set_password?: boolean } | null)?.must_set_password));
    } catch (error) {
      console.error('Error fetching user role:', error);
      setRole('user');
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

  // Clears the first-login gate on the current user's own profile row, then
  // syncs the in-memory state so ProtectedRoute stops bouncing to /set-password.
  // Throws on failure so callers can keep the user on the page.
  const clearMustSetPassword = async () => {
    const { data: { user: currentUser }, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    if (!currentUser) throw new Error('No authenticated user');

    const { error } = await supabase
      .from('profiles')
      // must_set_password is a real column; types.ts (supabase gen types)
      // may lag behind the migration, so cast the patch.
      .update({ must_set_password: false } as never)
      .eq('id', currentUser.id);
    if (error) throw error;

    setMustSetPassword(false);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setRole(null);
    setMustSetPassword(false);
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
        mustSetPassword,
        isRecovery,
        loading,
        signIn,
        signUp,
        clearMustSetPassword,
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
