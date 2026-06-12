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
import { ClipboardCheck, Loader2, CheckCircle2 } from 'lucide-react';

const MIN_PASSWORD_LENGTH = 8;

/**
 * /set-password — PUBLIC route reached from an invite email link.
 * supabase-js (detectSessionInUrl: true) parses the invite token in the URL
 * fragment into a session before this component renders. We confirm a session
 * exists, then let the invitee choose their password, clear the
 * must_set_password flag on their own profile row, and land them in the app.
 */
export default function SetPassword() {
  const navigate = useNavigate();
  const { clearMustSetPassword } = useAuth();
  const { organization } = useOrganization();
  const appName = organization?.name || 'Building Ops';
  const logoUrl = organization?.logo_url;

  const [checkingSession, setCheckingSession] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Inline "request a fresh link" for an expired/already-used link — keeps the
  // whole journey on this page instead of bouncing to the reset-password page.
  const [reqEmail, setReqEmail] = useState('');
  const [reqSent, setReqSent] = useState(false);
  const [requesting, setRequesting] = useState(false);
  // Links are one-time; corporate mail scanners often pre-click and consume them,
  // so the human arrives with #error=otp_expired and no session. Detect that.
  const linkExpired =
    typeof window !== 'undefined' &&
    (window.location.hash.includes('error') || window.location.hash.includes('otp_expired'));

  const handleRequestNewLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = reqEmail.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      toast.error('Please enter a valid email address');
      return;
    }
    setRequesting(true);
    // Send a fresh setup link that lands right back here.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/set-password`,
    });
    setRequesting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setReqSent(true); // always show success (don't leak which emails exist)
  };

  useEffect(() => {
    let active = true;

    // detectSessionInUrl runs async; PASSWORD_RECOVERY/SIGNED_IN fire once the
    // token in the URL has been exchanged for a session.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (session) {
        setHasSession(true);
        setCheckingSession(false);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return;
      setHasSession(!!session);
      setCheckingSession(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const validate = (): boolean => {
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      // Clear the first-login gate AND sync AuthContext's in-memory state so
      // ProtectedRoute won't bounce us back here. Throws on failure — we must
      // not navigate or show success unless this succeeds.
      await clearMustSetPassword();

      toast.success('Password set. Welcome aboard!');
      navigate('/');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to set password';
      // Surface unconditionally: if the gate isn't cleared the user would be
      // stuck in a redirect loop, so this must never be silently swallowed.
      console.error('Failed to complete set-password flow:', error);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (checkingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Verifying your invite…</p>
        </div>
      </div>
    );
  }

  if (!hasSession) {
    const Header = (
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
        <CardTitle>{reqSent ? 'Check your email' : 'This link has expired'}</CardTitle>
        <CardDescription>
          {reqSent
            ? `If an account exists for ${reqEmail}, a fresh setup link is on its way.`
            : linkExpired
              ? 'Setup links can only be used once and expire after a short time — and email security scanners sometimes open them first. Enter your email and we’ll send a fresh one.'
              : 'Enter your email and we’ll send a fresh link to finish setting up your account.'}
        </CardDescription>
      </CardHeader>
    );

    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          {Header}
          <CardContent className="space-y-4">
            {reqSent ? (
              <>
                <p className="text-sm text-muted-foreground text-center">
                  Open the link in the email to choose your password. It’s valid for 24 hours
                  and can only be used once.
                </p>
                <Button asChild variant="ghost" className="w-full">
                  <Link to="/auth">Back to sign in</Link>
                </Button>
              </>
            ) : (
              <form onSubmit={handleRequestNewLink} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="setup-email">Email</Label>
                  <Input
                    id="setup-email"
                    type="email"
                    placeholder="you@company.com"
                    value={reqEmail}
                    onChange={(e) => setReqEmail(e.target.value)}
                    autoComplete="email"
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={requesting}>
                  {requesting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {requesting ? 'Sending…' : 'Email me a fresh link'}
                </Button>
                <Button asChild variant="ghost" className="w-full">
                  <Link to="/auth">Back to sign in</Link>
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex flex-col items-center gap-2 mb-4">
            {logoUrl ? (
              <img src={logoUrl} alt={appName} className="w-16 h-16 rounded-lg object-contain" />
            ) : (
              <div className="w-16 h-16 bg-primary rounded-lg flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-primary-foreground" />
              </div>
            )}
            <span className="font-bold text-sm">{appName}</span>
          </div>
          <CardTitle>Set your password</CardTitle>
          <CardDescription>
            Choose a password to finish setting up your account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
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
              <Label htmlFor="confirm-password">Confirm password</Label>
              <Input
                id="confirm-password"
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
              {isSubmitting ? 'Setting password…' : 'Set password'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
