import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useOrganization } from '@/hooks/useOrganization';
import { toast } from 'sonner';
import { ClipboardCheck, Loader2, MailCheck } from 'lucide-react';

const MIN_PASSWORD_LENGTH = 8;

type Mode = 'request' | 'recovery' | 'sent';

/**
 * Card chrome for the reset flow. Defined at MODULE scope (not inside
 * ResetPassword) so its identity is stable across renders — a component
 * declared in the render body is a new type every keystroke, which remounts
 * its subtree and makes the inputs lose focus after a single character.
 */
function ResetShell({
  appName,
  logoUrl,
  title,
  description,
  children,
}: {
  appName: string;
  logoUrl?: string | null;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex flex-col items-center gap-2 mb-4">
            {logoUrl ? (
              <img src={logoUrl} alt={appName} className="w-16 h-16 rounded-lg object-contain" />
            ) : (
              <div className="w-16 h-16 bg-primary rounded-lg flex items-center justify-center">
                <ClipboardCheck className="w-8 h-8 text-primary-foreground" />
              </div>
            )}
            <span className="font-bold text-sm">{appName}</span>
          </div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  );
}

/**
 * /reset — PUBLIC route, dual-mode:
 *  (a) "request": no recovery token in the URL → collect an email and send a
 *      reset link via resetPasswordForEmail (redirectTo points back here).
 *  (b) "recovery": supabase-js fires PASSWORD_RECOVERY after parsing the token
 *      from the email link → show a new-password form.
 */
export default function ResetPassword() {
  const navigate = useNavigate();
  const { resetPassword, user } = useAuth();
  const { organization } = useOrganization();
  const appName = organization?.name || 'Building Ops';
  const logoUrl = organization?.logo_url;

  const [mode, setMode] = useState<Mode>('request');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    // A recovery token in the URL fragment is exchanged by detectSessionInUrl and
    // surfaces as a PASSWORD_RECOVERY event. Switch to the new-password form.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setMode('recovery');
      }
    });

    // Fallback: if the user already lands here with a recovery-grade session
    // (token already parsed before the listener attached), still show the form.
    if (window.location.hash.includes('type=recovery')) {
      setMode('recovery');
    }

    // detectSessionInUrl runs async; if the recovery token has already been
    // exchanged for a session before the listener attached (and the hash was
    // consumed), getSession still tells us we're in recovery. Mirror SetPassword.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && window.location.hash.includes('type=recovery')) {
        setMode('recovery');
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
      toast.error('Please enter a valid email address');
      return;
    }

    setIsSubmitting(true);
    const { error } = await resetPassword(trimmed);
    setIsSubmitting(false);

    if (error) {
      toast.error(error.message);
      return;
    }
    // Always present success to avoid leaking which emails are registered.
    setMode('sent');
  };

  const validateNewPassword = (): boolean => {
    if (password.length < MIN_PASSWORD_LENGTH) {
      toast.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return false;
    }
    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return false;
    }
    return true;
  };

  const handleSetNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateNewPassword()) return;

    setIsSubmitting(true);
    try {
      const { data, error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success('Password updated. You can now sign in.');
      // Prefer the live session from updateUser (falling back to getSession,
      // then context) over the possibly-stale context user: a recovery flow can
      // establish a session that hasn't propagated to AuthContext yet.
      const { data: { session } } = await supabase.auth.getSession();
      const freshUser = data.user ?? session?.user ?? user;
      // Choosing a password HERE also satisfies the first-login gate — without
      // this, invitees who used a reset link instead of the invite link kept
      // must_set_password=true and ProtectedRoute bounced them out of the app
      // on every login ("login doesn't work").
      if (freshUser) {
        await supabase
          .from('profiles')
          .update({ must_set_password: false } as never)
          .eq('id', freshUser.id);
      }
      navigate(freshUser ? '/' : '/auth');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update password';
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (mode === 'sent') {
    return (
      <ResetShell appName={appName} logoUrl={logoUrl}
        title="Check your email"
        description={`If an account exists for ${email}, a password reset link is on its way.`}
      >
        <div className="space-y-4">
          <div className="flex justify-center">
            <MailCheck className="h-12 w-12 text-success" />
          </div>
          <p className="text-sm text-muted-foreground text-center">
            Open the link in the email to choose a new password. The link expires after a
            short time and can only be used once.
          </p>
          <Button asChild variant="ghost" className="w-full">
            <Link to="/auth">Back to sign in</Link>
          </Button>
        </div>
      </ResetShell>
    );
  }

  if (mode === 'recovery') {
    return (
      <ResetShell appName={appName} logoUrl={logoUrl} title="Choose a new password" description="Enter a new password for your account.">
        <form onSubmit={handleSetNewPassword} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="reset-new-password">New password</Label>
            <Input
              id="reset-new-password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
            <p className="text-xs text-muted-foreground">
              At least {MIN_PASSWORD_LENGTH} characters.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="reset-confirm-password">Confirm password</Label>
            <Input
              id="reset-confirm-password"
              type="password"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
            {confirmPassword.length > 0 && confirmPassword !== password && (
              <p className="text-xs text-destructive">Passwords do not match.</p>
            )}
          </div>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isSubmitting ? 'Updating…' : 'Update password'}
          </Button>
        </form>
      </ResetShell>
    );
  }

  return (
    <ResetShell appName={appName} logoUrl={logoUrl}
      title="Reset your password"
      description="Enter your email and we'll send you a link to reset your password."
    >
      <form onSubmit={handleRequest} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="reset-email">Email</Label>
          <Input
            id="reset-email"
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {isSubmitting ? 'Sending…' : 'Send reset link'}
        </Button>
        <Button asChild variant="ghost" className="w-full">
          <Link to="/auth">Back to sign in</Link>
        </Button>
      </form>
    </ResetShell>
  );
}
