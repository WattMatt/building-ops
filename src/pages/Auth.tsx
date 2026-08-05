import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganization } from '@/hooks/useOrganization';
import { recordAuthEvent } from '@/lib/auth-audit';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Building2, Shield, ClipboardCheck } from 'lucide-react';
import { z } from 'zod';

const emailSchema = z.string().email('Please enter a valid email address');
const passwordSchema = z.string().min(1, 'Please enter your password');

export default function Auth() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signIn, loading } = useAuth();
  const { organization } = useOrganization();

  const appName = organization?.name || 'Building Ops';
  const logoUrl = organization?.logo_url;

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // E3/deep-link restore: ProtectedRoute stashes the page the user was heading
  // for in location.state.from — return there after login instead of always
  // landing on '/'. Only same-app paths are accepted: must start with a single
  // '/' ('//host' would be treated as protocol-relative and leave the app).
  const requested = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
  const from =
    requested && requested.startsWith('/') && !requested.startsWith('//') ? requested : '/';

  // Redirect if already logged in
  useEffect(() => {
    if (user && !loading) {
      navigate(from, { replace: true });
    }
  }, [user, loading, navigate, from]);

  const validateLogin = () => {
    try {
      emailSchema.parse(loginEmail);
      passwordSchema.parse(loginPassword);
      return true;
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast.error(error.errors[0].message);
      }
      return false;
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateLogin()) return;

    setIsSubmitting(true);
    const { error } = await signIn(loginEmail, loginPassword);
    setIsSubmitting(false);

    if (error) {
      if (error.message.includes('Invalid login credentials')) {
        toast.error('Invalid email or password');
      } else {
        toast.error(error.message);
      }
    } else {
      // C7: audit successful logins (fire-and-forget; never blocks the UX).
      void recordAuthEvent('auth.login');
      toast.success('Welcome back!');
      navigate(from);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      {/* Left side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-sidebar text-sidebar-foreground p-12 flex-col justify-between">
        <div>
          <div className="flex items-center gap-3 mb-8">
            {logoUrl ? (
              <img src={logoUrl} alt={appName} className="w-10 h-10 rounded-lg object-contain" />
            ) : (
              <div className="w-10 h-10 bg-sidebar-primary rounded-lg flex items-center justify-center">
                <ClipboardCheck className="w-6 h-6 text-sidebar-primary-foreground" />
              </div>
            )}
            <span className="text-xl font-bold">{appName}</span>
          </div>
          
          <h1 className="text-4xl font-bold mb-6">
            Facilities Management
            <br />
            <span className="text-sidebar-primary">Compliance Made Simple</span>
          </h1>
          
          <p className="text-sidebar-foreground/80 text-lg mb-12">
            Streamline your building maintenance checklists, audits, and compliance tracking across your entire portfolio.
          </p>
        </div>

        <div className="space-y-6">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-sidebar-accent rounded-lg flex items-center justify-center shrink-0">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold mb-1">Portfolio Management</h3>
              <p className="text-sm text-sidebar-foreground/70">
                Manage multiple buildings with role-based access and centralized dashboards.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-sidebar-accent rounded-lg flex items-center justify-center shrink-0">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold mb-1">Audit-Ready</h3>
              <p className="text-sm text-sidebar-foreground/70">
                Digital sign-offs, photo evidence, and exportable compliance packs for regulators.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-sidebar-accent rounded-lg flex items-center justify-center shrink-0">
              <ClipboardCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold mb-1">Smart Checklists</h3>
              <p className="text-sm text-sidebar-foreground/70">
                Daily, weekly, and monthly templates with automatic task generation.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Right side - Auth forms */}
      <div className="flex-1 flex items-center justify-center p-8">
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
            <CardTitle>Welcome back</CardTitle>
            <CardDescription>
              Sign in to your account
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="login-email">Email</Label>
                <Input
                  id="login-email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  placeholder="you@company.com"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="login-password">Password</Label>
                  <Link
                    to="/reset"
                    className="text-sm text-primary hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
                <Input
                  id="login-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  required
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Signing in...' : 'Sign In'}
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-muted-foreground">
              Need access? Contact your administrator.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
