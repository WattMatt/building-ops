import { differenceInDays } from 'date-fns';
import { getTypeLabel } from './documentTypes';
import type { BuildingDocumentRow, UnifiedDocument, DocStatus } from './types';
import type { ILBuilding } from '@/integrations/supabase/insight-linker';

function managedStatus(expiry: string | null): DocStatus {
  if (!expiry) return { label: 'No expiry', kind: 'neutral' };
  const days = differenceInDays(new Date(expiry), new Date());
  if (days < 0) return { label: 'Expired', kind: 'danger' };
  if (days <= 30) return { label: 'Expiring soon', kind: 'warning' };
  if (days <= 90) return { label: 'Due in 3 months', kind: 'neutral' };
  return { label: 'Valid', kind: 'success' };
}

function cocStatus(status: string | null): DocStatus {
  switch ((status ?? '').toLowerCase()) {
    case 'pass':
      return { label: 'COC pass', kind: 'success' };
    case 'fail':
      return { label: 'COC fail', kind: 'danger' };
    case 'pending':
      return { label: 'COC pending', kind: 'warning' };
    default:
      return { label: 'Not classified', kind: 'neutral' };
  }
}

export function unifyDocuments(
  managed: BuildingDocumentRow[],
  il: ILBuilding | undefined,
): UnifiedDocument[] {
  const out: UnifiedDocument[] = [];

  for (const row of managed) {
    out.push({
      key: `managed:${row.id}`,
      source: 'managed',
      name: row.name,
      type: getTypeLabel(row.document_type),
      typeValue: row.document_type,
      scope: 'building',
      shopNumber: null,
      tenantName: null,
      shopName: null,
      issueDate: row.issue_date,
      expiryDate: row.expiry_date,
      status: managedStatus(row.expiry_date),
      sizeBytes: null,
      categoryOrder: null,
      editable: true,
      managedId: row.id,
      storedUrl: row.file_url,
    });
  }

  for (const shop of il?.shops ?? []) {
    const shopNumber = shop.matched_tenant?.shop_number ?? null;
    const tenantName = shop.tenant_name ?? shop.matched_tenant?.shop_name ?? null;
    shop.documents.forEach((d, idx) => {
      const category = d.category?.trim() || 'Uncategorised';
      out.push({
        key: `il:${shop.subsection_id}:${d.file_url ?? idx}`,
        source: 'insight_linker',
        name: d.file_name?.trim() || '(unnamed file)',
        type: category,
        typeValue: category.toLowerCase(),
        scope: 'shop',
        shopNumber,
        tenantName,
        shopName: shop.name ?? null,
        issueDate: null,
        expiryDate: d.coc_expiry_date,
        status: cocStatus(d.coc_status),
        sizeBytes: d.file_size,
        categoryOrder: d.category_order ?? null,
        editable: false,
        managedId: null,
        storedUrl: d.file_url,
      });
    });
  }

  (il?.site_documents ?? []).forEach((d, idx) => {
    const category = d.category?.trim() || 'Uncategorised';
    out.push({
      key: `il-site:${d.file_url ?? idx}`,
      source: 'insight_linker',
      name: d.file_name?.trim() || '(unnamed file)',
      type: category,
      typeValue: category.toLowerCase(),
      scope: 'site',
      shopNumber: null,
      tenantName: null,
      shopName: null,
      issueDate: null,
      expiryDate: null,
      status: { label: 'Reference', kind: 'neutral' },
      sizeBytes: null,
      categoryOrder: null,
      editable: false,
      managedId: null,
      storedUrl: d.file_url,
    });
  });

  return out;
}
