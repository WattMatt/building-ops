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
            <CardTitle>Link expired or invalid</CardTitle>
            <CardDescription>
              This invite link is no longer valid. Invite links can only be used once
              and expire after a short time.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Request a fresh link, or ask your administrator to re-send your invite.
            </p>
            <Button asChild className="w-full">
              <Link to="/reset">Request a new link</Link>
            </Button>
            <Button asChild variant="ghost" className="w-full">
              <Link to="/auth">Back to sign in</Link>
            </Button>
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
