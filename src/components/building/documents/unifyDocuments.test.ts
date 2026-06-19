import { describe, it, expect } from 'vitest';
import { unifyDocuments } from './unifyDocuments';
import type { BuildingDocumentRow } from './types';
import type { ILBuilding } from '@/integrations/supabase/insight-linker';

const managedRow = (over: Partial<BuildingDocumentRow> = {}): BuildingDocumentRow => ({
  id: 'm1',
  building_id: 'b1',
  name: 'Fire Cert 2026',
  document_type: 'fire_certificate',
  reference_number: 'FC-1',
  issue_date: '2026-01-01',
  expiry_date: '2099-01-01',
  issuing_authority: 'City',
  file_url: 'https://x/storage/v1/object/public/tenant-documents/documents/b1/a.pdf',
  notes: null,
  uploaded_by: 'u1',
  created_at: '2026-01-01',
  ...over,
});

const ilFixture: ILBuilding = {
  linked: true,
  fetched_at: '2026-06-19T00:00:00Z',
  shops: [
    {
      subsection_id: 's14',
      name: 'SHOP 14',
      tenant_name: 'Boxer',
      category: 'Retail',
      meter_serial_number: null,
      ct_ratio: null,
      metering_status: null,
      coc: { number: null, status: null, type: null, issue_date: null, expiry: null },
      matched_tenant: { id: 't14', shop_number: '14', shop_name: 'Boxer' },
      documents: [
        {
          file_name: 'SHOP14_COC.pdf',
          file_url: 'https://il/pub/shop14_coc.pdf',
          file_size: 2100000,
          category: '01 COC',
          coc_type: 'Fixed',
          coc_status: 'pass',
          coc_expiry_date: '2027-01-15',
        },
        {
          file_name: 'line.pdf',
          file_url: 'https://il/pub/line.pdf',
          file_size: 680000,
          category: '03 Line Diagram',
          coc_type: null,
          coc_status: null,
          coc_expiry_date: null,
        },
      ],
      doc_count: 2,
      photos: [],
      photo_count: 0,
    },
  ],
  site_documents: [
    { file_name: '08 Site Plan.pdf', file_url: 'https://il/pub/siteplan.pdf', category: 'Site Plan' },
  ],
};

describe('unifyDocuments', () => {
  it('maps managed rows to editable building-scope docs', () => {
    const out = unifyDocuments([managedRow()], undefined);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      source: 'managed',
      scope: 'building',
      editable: true,
      managedId: 'm1',
      type: 'Fire Certificate',
      typeValue: 'fire_certificate',
      name: 'Fire Cert 2026',
    });
    expect(out[0].status.kind).toBe('success'); // far-future expiry
  });

  it('marks an expired managed doc as danger and a soon-to-expire one as warning', () => {
    const past = unifyDocuments([managedRow({ id: 'p', expiry_date: '2000-01-01' })], undefined);
    expect(past[0].status).toEqual({ label: 'Expired', kind: 'danger' });
    const soon = new Date();
    soon.setDate(soon.getDate() + 10);
    const soonRow = unifyDocuments(
      [managedRow({ id: 's', expiry_date: soon.toISOString().slice(0, 10) })],
      undefined,
    );
    expect(soonRow[0].status).toEqual({ label: 'Expiring soon', kind: 'warning' });
  });

  it('flattens IL shop documents to read-only shop-scope docs with COC status', () => {
    const out = unifyDocuments([], ilFixture).filter(
      (d) => d.source === 'insight_linker' && d.scope === 'shop',
    );
    expect(out).toHaveLength(2);
    const coc = out.find((d) => d.name === 'SHOP14_COC.pdf')!;
    expect(coc).toMatchObject({
      editable: false,
      scope: 'shop',
      shopNumber: '14',
      tenantName: 'Boxer',
      type: '01 COC',
      sizeBytes: 2100000,
      storedUrl: 'https://il/pub/shop14_coc.pdf',
    });
    expect(coc.status).toEqual({ label: 'COC pass', kind: 'success' });
    const line = out.find((d) => d.name === 'line.pdf')!;
    expect(line.status).toEqual({ label: 'Not classified', kind: 'neutral' });
  });

  it('flattens IL site documents to read-only site-scope reference docs', () => {
    const out = unifyDocuments([], ilFixture).filter((d) => d.scope === 'site');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ source: 'insight_linker', editable: false, type: 'Site Plan' });
    expect(out[0].status.kind).toBe('neutral');
  });

  it('produces unique keys across all sources', () => {
    const out = unifyDocuments([managedRow()], ilFixture);
    expect(new Set(out.map((d) => d.key)).size).toBe(out.length);
  });
});
