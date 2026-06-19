export type DocSource = 'managed' | 'insight_linker';
export type DocScope = 'building' | 'shop' | 'site';
export type StatusKind = 'success' | 'warning' | 'danger' | 'neutral';

export interface DocStatus {
  label: string;
  kind: StatusKind;
}

/** The shape the managed `building_documents` rows arrive in. */
export interface BuildingDocumentRow {
  id: string;
  building_id: string;
  name: string;
  document_type: string;
  reference_number: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  issuing_authority: string | null;
  file_url: string | null;
  notes: string | null;
  uploaded_by: string | null;
  created_at: string;
}

/** Normalised, source-agnostic document used throughout the Documents tab UI. */
export interface UnifiedDocument {
  key: string;
  source: DocSource;
  name: string;
  type: string; // human label (e.g. "Fire Certificate" or "01 COC")
  typeValue: string; // stable value for the type filter
  scope: DocScope;
  shopNumber: string | null;
  tenantName: string | null;
  shopName: string | null; // insight-linker subsection name (stable shop-section identity)
  issueDate: string | null;
  expiryDate: string | null;
  status: DocStatus;
  sizeBytes: number | null;
  categoryOrder: number | null; // insight-linker document_categories.order_index (sub-group order)
  editable: boolean; // true for managed; false for insight-linker
  managedId: string | null;
  storedUrl: string | null; // managed: file_url (resolve before use); IL: direct public URL
}
