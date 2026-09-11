/**
 * /intake/:token — the tenant's "report a problem" form (spec §5.10). Public: outside
 * ProtectedRoute, nothing from the signed-in app shell, no Supabase client. The token in the URL
 * is the credential; GET answers branding + shop list or 404. Mobile-first: one column, 44 px
 * controls, camera capture through the same PhotoCapture pipeline the app uses (HEIC → JPEG,
 * compression, time caption; never a geotag from a tenant's phone).
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PhotoCapture, type PhotoFile } from '@/components/ui/photo-capture';
import { headerTextColor } from '@/lib/headerTextColor';
import {
  EMPTY_INTAKE, INTAKE_LIMITS, SUBMIT_ERROR_COPY, buildIntakeFormData, fetchIntakeInfo, serverFieldError,
  submitIntake, validateIntake, type IntakeErrors, type IntakeInfo, type IntakeValues,
} from '@/lib/intakeForm';

type LoadState = { kind: 'loading' } | { kind: 'inactive' } | { kind: 'error' } | { kind: 'ready'; info: IntakeInfo };

/** An admin types the brand colour; anything that is not a 6-digit hex cannot be contrast-checked. */
const BRAND_FALLBACK = '#2563eb';
const brandColor = (value: string | null | undefined): string =>
  value && /^#[0-9a-f]{6}$/i.test(value) ? value : BRAND_FALLBACK;

export default function IntakePage() {
  const { token = '' } = useParams<{ token: string }>();
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [values, setValues] = useState<IntakeValues>(EMPTY_INTAKE);
  const [errors, setErrors] = useState<IntakeErrors & { photos?: string }>({});
  const [photos, setPhotos] = useState<PhotoFile[]>([]);
  const [honeypot, setHoneypot] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: 'loading' });
    fetchIntakeInfo(token)
      .then((info) => { if (!cancelled) setLoad(info ? { kind: 'ready', info } : { kind: 'inactive' }); })
      .catch(() => { if (!cancelled) setLoad({ kind: 'error' }); });
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    if (load.kind === 'ready') document.title = `Report a problem — ${load.info.building.name}`;
  }, [load]);

  const set = (field: keyof IntakeValues) => (value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found = validateIntake(values);
    setErrors(found);
    setSubmitError(null);
    if (Object.values(found).some(Boolean)) return;
    setSubmitting(true);
    try {
      const fd = buildIntakeFormData(token, values, photos.map((p) => p.file), honeypot);
      const result = await submitIntake(fd);
      if (result.ok) {
        photos.forEach((p) => URL.revokeObjectURL(p.preview));
        setReference(result.reference);
        window.scrollTo({ top: 0 });
        return;
      }
      if (result.kind === 'invalid') {
        const next: IntakeErrors & { photos?: string } = {};
        for (const f of result.fields) { const m = serverFieldError(f); if (m) next[m.field] = m.message; }
        setErrors(next);
      }
      if (result.kind === 'not_found') setLoad({ kind: 'inactive' });
      setSubmitError(SUBMIT_ERROR_COPY[result.kind]);
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setValues((v) => ({ ...EMPTY_INTAKE, name: v.name, shopNumber: v.shopNumber, phone: v.phone, email: v.email }));
    setPhotos([]);
    setErrors({});
    setSubmitError(null);
    setReference(null);
  };

  if (load.kind === 'loading') {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (load.kind !== 'ready') {
    return (
      <main className="mx-auto max-w-md p-6 text-center space-y-3">
        <AlertTriangle className="mx-auto h-8 w-8 text-warning" />
        <h1 className="text-xl font-semibold">{load.kind === 'inactive' ? 'This link is not active' : 'Could not load the form'}</h1>
        <p className="text-sm text-muted-foreground">
          {load.kind === 'inactive' ? 'Ask the building team for the current QR code.' : 'Check your connection and try again.'}
        </p>
        {load.kind === 'error' && <Button className="h-12" onClick={() => window.location.reload()}>Try again</Button>}
      </main>
    );
  }

  const { info } = load;
  const brand = brandColor(info.org.primaryColor);
  // The brand colour is arbitrary, so white-on-brand is a readability bug on every pale brand —
  // the same luminance check the public share page uses decides the text on it.
  const onBrand = headerTextColor(brand);

  return (
    <main className="mx-auto max-w-md pb-12">
      <header className="flex items-center gap-3 border-b-4 px-4 py-3" style={{ borderColor: brand }}>
        {info.org.logoUrl ? (
          <img src={info.org.logoUrl} alt={info.org.name} className="h-10 w-10 rounded-lg object-contain" />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ backgroundColor: brand, color: onBrand }}>
            <ClipboardCheck className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{info.org.name}</p>
          <p className="truncate text-xs text-muted-foreground">{info.building.name}</p>
        </div>
      </header>

      {reference ? (
        <section className="space-y-4 p-4 text-center" aria-live="polite">
          <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
          <h1 className="text-2xl font-bold">Thank you — we have your report</h1>
          <p className="text-sm text-muted-foreground">Your reference number</p>
          <p className="font-mono text-3xl font-bold tracking-widest" data-testid="reference">{reference}</p>
          <p className="text-sm text-muted-foreground">Keep it: the building team will quote it when they follow up.</p>
          <Button className="h-12 w-full" variant="outline" onClick={reset}>Report another problem</Button>
        </section>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-5 p-4">
          <h1 className="text-2xl font-bold">Report a problem</h1>
          <p className="text-sm text-muted-foreground">Tell us what is wrong in {info.building.name}. A photo helps.</p>

          <div className="space-y-1.5">
            <Label htmlFor="intake-title">What is the problem? *</Label>
            <Input
              id="intake-title"
              className="h-11"
              maxLength={INTAKE_LIMITS.title}
              value={values.title}
              onChange={(e) => set('title')(e.target.value)}
              placeholder="e.g. Light out in the passage"
              aria-invalid={!!errors.title}
            />
            {errors.title && <p className="text-sm text-destructive">{errors.title}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="intake-description">Where is it and what happened? *</Label>
            <Textarea
              id="intake-description"
              rows={4}
              maxLength={INTAKE_LIMITS.description}
              value={values.description}
              onChange={(e) => set('description')(e.target.value)}
              aria-invalid={!!errors.description}
            />
            {errors.description && <p className="text-sm text-destructive">{errors.description}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="intake-category">Type of problem</Label>
            <select
              id="intake-category"
              className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={values.category}
              onChange={(e) => set('category')(e.target.value)}
            >
              <option value="">Choose…</option>
              {info.categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="intake-shop">Your shop</Label>
            <select
              id="intake-shop"
              className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={values.shopNumber}
              onChange={(e) => set('shopNumber')(e.target.value)}
              aria-invalid={!!errors.shopNumber}
            >
              <option value="">Not a shop / not listed</option>
              {info.shops.map((s) => (
                <option key={s.shopNumber} value={s.shopNumber}>{s.shopNumber}{s.shopName ? ` — ${s.shopName}` : ''}</option>
              ))}
            </select>
            {errors.shopNumber && <p className="text-sm text-destructive">{errors.shopNumber}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="intake-name">Your name *</Label>
            <Input
              id="intake-name"
              className="h-11"
              autoComplete="name"
              maxLength={INTAKE_LIMITS.name}
              value={values.name}
              onChange={(e) => set('name')(e.target.value)}
              aria-invalid={!!errors.name}
            />
            {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="intake-phone">Phone</Label>
              <Input
                id="intake-phone"
                className="h-11"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                maxLength={INTAKE_LIMITS.phone}
                value={values.phone}
                onChange={(e) => set('phone')(e.target.value)}
                aria-invalid={!!errors.phone}
              />
              {errors.phone && <p className="text-sm text-destructive">{errors.phone}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="intake-email">Email</Label>
              <Input
                id="intake-email"
                className="h-11"
                type="email"
                inputMode="email"
                autoComplete="email"
                maxLength={INTAKE_LIMITS.email}
                value={values.email}
                onChange={(e) => set('email')(e.target.value)}
                aria-invalid={!!errors.email}
              />
              {errors.email && <p className="text-sm text-destructive">{errors.email}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <PhotoCapture
              label="Photos"
              photos={photos}
              onPhotosChange={(p) => { setPhotos(p); setErrors((e) => ({ ...e, photos: undefined })); }}
              maxPhotos={INTAKE_LIMITS.photos}
              maxSizeMB={INTAKE_LIMITS.photoMB}
              caption={{ time: true, geotag: false }}
              size="lg"
              disabled={submitting}
            />
            {errors.photos && <p className="text-sm text-destructive">{errors.photos}</p>}
          </div>

          {/* Honeypot: off-screen, never labelled, ignored by people, filled by bots. */}
          <div className="absolute left-[-9999px] top-0 h-0 w-0 overflow-hidden" aria-hidden="true">
            <input type="text" name="website" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
          </div>

          {submitError && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{submitError}</p>
          )}

          <Button type="submit" className="h-12 w-full text-base" style={{ backgroundColor: brand, color: onBrand }} disabled={submitting}>
            {submitting ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending…</>) : 'Send report'}
          </Button>
          <p className="text-center text-xs text-muted-foreground">Your name and contact details go to the building team only.</p>
        </form>
      )}
    </main>
  );
}
