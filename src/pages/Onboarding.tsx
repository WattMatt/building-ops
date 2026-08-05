import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganization } from '@/hooks/useOrganization';
import { ROLE_LABELS, type AppRole } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  Phone,
  Shield,
  User,
} from 'lucide-react';

const STEPS = ['Welcome', 'Profile', 'Your role'] as const;

// What each role can do in Building Ops (D3: role explained to the new user).
const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  admin:
    'You can manage buildings, users, checklists, reports, and settings across the whole portfolio.',
  manager:
    'You can manage buildings, run compliance reports, and oversee checklists and issues across the portfolio.',
  user:
    'You can complete checklists, log and track issues, and view the buildings assigned to you.',
  reviewer:
    'You can review and sign off submitted forms and inspections for your assigned buildings.',
};

/**
 * /onboarding — dedicated first-run route (STANDARD D1/D2, redirect-style
 * gate). ProtectedRoute sends authenticated users here while
 * profiles.onboarding_completed is false; completing the wizard writes the
 * flag (plus profile fields) and releases the gate. Not wrapped in
 * ProtectedRoute (that would loop) — it enforces its own entry conditions.
 */
export default function Onboarding() {
  const navigate = useNavigate();
  const { user, role, mustSetPassword, onboardingCompleted, markOnboardingComplete, loading } =
    useAuth();
  const { organization } = useOrganization();
  const appName = organization?.name || 'Building Ops';
  const logoUrl = organization?.logo_url;

  const [step, setStep] = useState(0);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [prefilled, setPrefilled] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Prefill from the existing profile row (created by handle_new_user). A
  // missing row is fine — completion upserts it (D4: create-or-surface, never
  // silently skip).
  useEffect(() => {
    if (!user || prefilled) return;
    let active = true;
    supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        const p = data as { full_name?: string | null; phone?: string | null } | null;
        if (p) {
          setFullName(p.full_name ?? '');
          setPhone(p.phone ?? '');
        }
        setPrefilled(true);
      });
    return () => {
      active = false;
    };
  }, [user, prefilled]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;
  // Credential gate always comes first.
  if (mustSetPassword) return <Navigate to="/set-password" replace />;
  if (onboardingCompleted) return <Navigate to="/" replace />;

  const handleComplete = async () => {
    if (!user) return;
    setIsSaving(true);
    try {
      // Upsert (not update) so a missing profile row is created rather than
      // silently updating zero rows (D4). onboarding_completed may be absent
      // from the generated types until they are regenerated — cast the patch.
      const { data, error } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          email: user.email ?? null,
          full_name: fullName.trim() || null,
          phone: phone.trim() || null,
          onboarding_completed: true,
          updated_at: new Date().toISOString(),
        } as never)
        .select('*')
        .single();

      if (error) throw error;
      // Verified write: fail loud rather than reporting a success the
      // database does not reflect (the gate would just bounce the user back).
      if (!(data as { onboarding_completed?: boolean } | null)?.onboarding_completed) {
        throw new Error('Onboarding completion could not be verified');
      }

      markOnboardingComplete();
      toast.success("Welcome aboard! You're all set.");
      navigate('/', { replace: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save your profile';
      console.error('Failed to complete onboarding:', error);
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="flex flex-col items-center gap-2 mb-2">
            {logoUrl ? (
              <img src={logoUrl} alt={appName} className="w-16 h-16 rounded-lg object-contain" />
            ) : (
              <div className="w-16 h-16 bg-primary rounded-lg flex items-center justify-center">
                <ClipboardCheck className="w-8 h-8 text-primary-foreground" />
              </div>
            )}
            <span className="font-bold text-sm">{appName}</span>
          </div>
          <CardTitle>
            {step === 0 && `Welcome to ${appName}`}
            {step === 1 && 'Complete your profile'}
            {step === 2 && "You're all set"}
          </CardTitle>
          <CardDescription>
            Step {step + 1} of {STEPS.length} — {STEPS[step]}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Progress */}
          <div className="flex gap-1.5">
            {STEPS.map((label, i) => (
              <div
                key={label}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  i <= step ? 'bg-primary' : 'bg-muted'
                }`}
              />
            ))}
          </div>

          {/* Step 0: Welcome */}
          {step === 0 && (
            <div className="space-y-3 py-2 text-center">
              <p className="text-sm text-muted-foreground">
                Your account is ready. Let&apos;s take a minute to finish setting things up:
                confirm your details and see what you can do here.
              </p>
              <p className="text-sm text-muted-foreground">
                {appName} tracks building maintenance checklists, issues, and compliance across
                the portfolio.
              </p>
            </div>
          )}

          {/* Step 1: Profile */}
          {step === 1 && (
            <div className="grid gap-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="ob-full-name" className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Full name
                </Label>
                <Input
                  id="ob-full-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Enter your full name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ob-phone" className="flex items-center gap-2">
                  <Phone className="h-4 w-4" />
                  Phone number
                </Label>
                <Input
                  id="ob-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Enter your phone number"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                You can change these later under My Profile.
              </p>
            </div>
          )}

          {/* Step 2: Role overview */}
          {step === 2 && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg border p-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <Shield className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">
                      Your role: {role ? ROLE_LABELS[role] : 'Pending'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {role
                        ? ROLE_DESCRIPTIONS[role]
                        : 'Your account is set up. An administrator will assign your role and permissions shortly.'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between pt-2">
            {step > 0 ? (
              <Button variant="outline" onClick={() => setStep(step - 1)} disabled={isSaving}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
            ) : (
              <div />
            )}

            {step < STEPS.length - 1 ? (
              <Button onClick={() => setStep(step + 1)}>
                Next <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button onClick={handleComplete} disabled={isSaving}>
                {isSaving ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                )}
                {isSaving ? 'Saving...' : 'Get started'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
