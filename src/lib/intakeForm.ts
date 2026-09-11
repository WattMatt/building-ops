/**
 * The public tenant intake form (spec §5.10): limits, validation, the multipart request the
 * tenant-intake function accepts, and the two fetch wrappers. No Supabase client on purpose —
 * the page is public, the token is the credential, and nothing it fetches may land in the
 * persisted query cache on a tenant's phone.
 */
export const INTAKE_LIMITS = {
  title: 120, description: 2000, name: 80, shopNumber: 20, phone: 30, email: 120, photos: 3, photoMB: 5,
} as const;
export const REFERENCE_RE = /^FO-[A-Z2-7]{6}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What `GET /tenant-intake?t=` answers (see plan Contracts). */
export interface IntakeInfo {
  building: { name: string };
  org: { name: string; logoUrl: string | null; primaryColor: string };
  shops: { shopNumber: string; shopName: string }[];
  categories: string[];
}

export interface IntakeValues {
  title: string; description: string; name: string; shopNumber: string; phone: string; email: string; category: string;
}
export type IntakeField = keyof IntakeValues;
export type IntakeErrors = Partial<Record<IntakeField, string>>;
export const EMPTY_INTAKE: IntakeValues = { title: '', description: '', name: '', shopNumber: '', phone: '', email: '', category: '' };

/** Plain guardrail copy (never through <Hint>): what stops a submission. */
export function validateIntake(v: IntakeValues): IntakeErrors {
  const e: IntakeErrors = {};
  const title = v.title.trim(), description = v.description.trim(), name = v.name.trim(), email = v.email.trim();
  if (!title) e.title = 'Tell us what the problem is';
  else if (title.length > INTAKE_LIMITS.title) e.title = `Keep the summary under ${INTAKE_LIMITS.title} characters`;
  if (!description) e.description = 'Describe the problem and where it is';
  else if (description.length > INTAKE_LIMITS.description) e.description = `Keep the description under ${INTAKE_LIMITS.description} characters`;
  if (!name) e.name = 'Your name lets the team follow up';
  else if (name.length > INTAKE_LIMITS.name) e.name = `Keep your name under ${INTAKE_LIMITS.name} characters`;
  if (email && !EMAIL_RE.test(email)) e.email = 'That email address does not look right';
  if (v.phone.trim().length > INTAKE_LIMITS.phone) e.phone = `Keep the phone number under ${INTAKE_LIMITS.phone} characters`;
  return e;
}

/** The link the QR code carries; the route is public (outside ProtectedRoute). */
export function intakeUrl(token: string, origin: string = window.location.origin): string {
  return `${origin}/intake/${token}`;
}

export function intakeFunctionUrl(): string {
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tenant-intake`;
}

/** Field names are the function's contract; `website` is the honeypot the page keeps empty. */
export function buildIntakeFormData(token: string, v: IntakeValues, photos: File[], honeypot = ''): FormData {
  const fd = new FormData();
  fd.append('t', token);
  fd.append('title', v.title.trim());
  fd.append('description', v.description.trim());
  fd.append('name', v.name.trim());
  if (v.shopNumber.trim()) fd.append('shop_number', v.shopNumber.trim());
  if (v.phone.trim()) fd.append('phone', v.phone.trim());
  if (v.email.trim()) fd.append('email', v.email.trim());
  if (v.category) fd.append('category', v.category);
  fd.append('website', honeypot);
  for (const f of photos.slice(0, INTAKE_LIMITS.photos)) fd.append('photos', f, f.name || 'photo.jpg');
  return fd;
}

export type IntakeSubmitResult =
  | { ok: true; reference: string }
  | { ok: false; kind: 'invalid' | 'rate_limited' | 'not_found' | 'too_large' | 'failed'; fields: string[] };

/** 404 → null (the page shows "this link is not active"); network/5xx → throws. */
export async function fetchIntakeInfo(token: string, fetchImpl: typeof fetch = fetch): Promise<IntakeInfo | null> {
  const res = await fetchImpl(`${intakeFunctionUrl()}?t=${encodeURIComponent(token)}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Intake info failed: HTTP ${res.status}`);
  return (await res.json()) as IntakeInfo;
}

export async function submitIntake(fd: FormData, fetchImpl: typeof fetch = fetch): Promise<IntakeSubmitResult> {
  let res: Response;
  try {
    res = await fetchImpl(intakeFunctionUrl(), { method: 'POST', body: fd });
  } catch {
    return { ok: false, kind: 'failed', fields: [] };
  }
  const body = (await res.json().catch(() => ({}))) as { reference?: string; error?: string; fields?: string[] };
  if (res.status === 201 && typeof body.reference === 'string' && REFERENCE_RE.test(body.reference)) {
    return { ok: true, reference: body.reference };
  }
  if (res.status === 400) return { ok: false, kind: 'invalid', fields: Array.isArray(body.fields) ? body.fields : [] };
  if (res.status === 404) return { ok: false, kind: 'not_found', fields: [] };
  if (res.status === 413) return { ok: false, kind: 'too_large', fields: [] };
  if (res.status === 429) return { ok: false, kind: 'rate_limited', fields: [] };
  return { ok: false, kind: 'failed', fields: [] };
}

/** Server-side field rejections → the field on the page and plain copy for it. */
export function serverFieldError(field: string): { field: IntakeField | 'photos'; message: string } | null {
  switch (field) {
    case 'title': return { field: 'title', message: 'Tell us what the problem is' };
    case 'description': return { field: 'description', message: 'Describe the problem and where it is' };
    case 'name': return { field: 'name', message: 'Your name lets the team follow up' };
    case 'email': return { field: 'email', message: 'That email address does not look right' };
    case 'shop_number': return { field: 'shopNumber', message: 'Pick your shop from the list' };
    case 'photos': return { field: 'photos', message: `Up to ${INTAKE_LIMITS.photos} photos of ${INTAKE_LIMITS.photoMB} MB each` };
    default: return null;
  }
}

export const SUBMIT_ERROR_COPY: Record<Exclude<IntakeSubmitResult, { ok: true }>['kind'], string> = {
  invalid: 'Please check the highlighted fields.',
  rate_limited: 'Too many reports from this phone or this link in the last hour. Please try again later.',
  not_found: 'This link is no longer active. Ask the building team for the current QR code.',
  too_large: 'The photos are too large to send. Remove one and try again.',
  failed: 'Could not send your report. Check your connection and try again.',
};
