/** Shapes and buckets for the widened expiry alerts (expiring_items(), R4a §5.6). */
export type ExpiringKind = 'building_document' | 'tenant_document' | 'contractor_document' | 'asset_warranty' | 'asset_service';

export interface ExpiringItem {
  kind: ExpiringKind;
  entity_type: 'document' | 'asset';
  entity_id: string;
  parent_id: string | null;
  building_id: string | null;
  building_name: string | null;
  name: string;
  detail: string | null;
  expiry_date: string;
  days_left: number;
}

export type ExpiryBucket = 'expired' | 'd30' | 'd60' | 'd90';
export const BUCKETS: ExpiryBucket[] = ['expired', 'd30', 'd60', 'd90'];
export const BUCKET_LABELS: Record<ExpiryBucket, string> = { expired: 'Expired', d30: '≤ 30 days', d60: '31–60 days', d90: '61–90 days' };

export function bucketOf(daysLeft: number): ExpiryBucket | null {
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= 30) return 'd30';
  if (daysLeft <= 60) return 'd60';
  if (daysLeft <= 90) return 'd90';
  return null;
}

export type ExpiryCounts = Record<ExpiryBucket, number>;
export function countBuckets(items: { days_left: number }[]): ExpiryCounts {
  const c: ExpiryCounts = { expired: 0, d30: 0, d60: 0, d90: 0 };
  for (const i of items) { const b = bucketOf(i.days_left); if (b) c[b] += 1; }
  return c;
}

export const KIND_LABELS: Record<ExpiringKind, string> = {
  building_document: 'Building document', tenant_document: 'Tenant document', contractor_document: 'Contractor document',
  asset_warranty: 'Warranty', asset_service: 'Service due',
};

/** Where the row's arrow goes. Contractor documents have no building; the register opens on the contractor. */
export function itemUrl(item: Pick<ExpiringItem, 'kind' | 'building_id' | 'parent_id'>): string {
  switch (item.kind) {
    case 'building_document': return `/buildings/${item.building_id}?tab=documents`;
    case 'tenant_document': return `/buildings/${item.building_id}?tab=tenants`;
    case 'contractor_document': return item.parent_id ? `/contractors?open=${item.parent_id}` : '/contractors';
    case 'asset_warranty':
    case 'asset_service': return `/buildings/${item.building_id}?tab=assets`;
  }
}

/** "expires in 3 days", "expires today", "expired 5 days ago"; service rows say "due"/"overdue". */
export function expiryPhrase(item: Pick<ExpiringItem, 'kind' | 'days_left'>): string {
  const n = item.days_left;
  const days = (k: number) => `${k} day${k === 1 ? '' : 's'}`;
  if (item.kind === 'asset_service') return n < 0 ? `service overdue by ${days(-n)}` : n === 0 ? 'service due today' : `service due in ${days(n)}`;
  const what = item.kind === 'asset_warranty' ? 'warranty ' : '';
  return n < 0 ? `${what}expired ${days(-n)} ago` : n === 0 ? `${what}expires today` : `${what}expires in ${days(n)}`;
}
