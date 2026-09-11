/**
 * Where an issue came from (R4c, spec §5.10). `issues.source` is 'app' for everything the app
 * creates and 'tenant_intake' for reports through the public QR form; only the tenant-intake
 * function (service role) may write the latter — a DB trigger refuses it from any session.
 */
export const TENANT_SOURCE = 'tenant_intake' as const;
export type IssueSource = 'app' | typeof TENANT_SOURCE;

/** `issues.reporter` — the person who reported through the intake form (no account). */
export interface IssueReporter {
  name: string;
  shop_number: string | null;
  shop: string | null;
  unit: string | null;
  phone: string | null;
  email: string | null;
}

export function isTenantIssue(issue: { source?: IssueSource | string | null }): boolean {
  return issue.source === TENANT_SOURCE;
}

/** jsonb → typed, tolerating anything the column might hold. */
export function parseReporter(value: unknown): IssueReporter | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const str = (k: string) => (typeof v[k] === 'string' && (v[k] as string).trim() ? (v[k] as string).trim() : null);
  const name = str('name');
  if (!name) return null;
  return { name, shop_number: str('shop_number'), shop: str('shop'), unit: str('unit'), phone: str('phone'), email: str('email') };
}

/** "Thandi Tenant · Kool Kids (Shop 12) · Unit G12" — for cards and the detail header. */
export function reporterSummary(r: IssueReporter | null | undefined): string {
  if (!r) return 'Tenant';
  const parts = [r.name];
  if (r.shop && r.shop_number) parts.push(`${r.shop} (Shop ${r.shop_number})`);
  else if (r.shop) parts.push(r.shop);
  else if (r.shop_number) parts.push(`Shop ${r.shop_number}`);
  if (r.unit) parts.push(`Unit ${r.unit}`);
  return parts.join(' · ');
}
