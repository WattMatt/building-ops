import { describe, it, expect } from 'vitest';
import {
  buildAssetPackDoc,
  buildEvidencePackDoc,
  buildIssuePackDoc,
  buildTaskPackDoc,
  packFileName,
  serviceTotal,
  starLine,
  NOT_COMPLETED_COPY,
  NO_PHOTOS_COPY,
  SOURCE_COPY,
  type AssetPack,
  type IssuePack,
  type PackMeta,
  type TaskPack,
} from '@/lib/evidencePack';

const meta: PackMeta = {
  orgName: 'Watson Mattheus',
  primaryColor: '#2563eb',
  generatedAt: '11 Sept 2026, 09:00',
  generatedBy: 'Arno M',
  buildingName: 'Sandton Centre',
};

/** The builders return a pdfmake doc; everything asserted here is text somewhere inside it. */
const text = (doc: unknown): string => JSON.stringify(doc);

const issuePack = (over: Partial<IssuePack> = {}): IssuePack => ({
  kind: 'issue',
  meta,
  issue: {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    title: 'Lift stuck between floors',
    description: 'Car 2 halts at level 3.',
    priority: 'critical',
    status: 'resolved',
    category: 'elevator',
    createdAt: '01 Sept 2026, 08:00',
    deadline: '02 Sept 2026',
    resolvedAt: '01 Sept 2026, 15:20',
    reportedBy: 'Thabo M',
    assignee: 'Ann K',
    contractor: 'Otis SA',
    estimatedCost: 4500,
    actualCost: 5120.5,
    correctiveAction: 'Replaced the door interlock.',
  },
  sla: {
    targetHours: 4,
    dueAt: '01 Sept 2026, 12:00',
    breachedAt: null,
    firstResponseAt: '01 Sept 2026, 08:40',
    label: 'Met',
  },
  photos: [{ dataUrl: 'data:image/jpeg;base64,AAA', caption: 'Door interlock before repair' }],
  timeline: [
    { at: '01 Sept 2026, 08:40', author: 'Ann K', type: 'comment', text: 'On site.', photos: [] },
    {
      at: '01 Sept 2026, 15:20',
      author: 'Ann K',
      type: 'status_change',
      text: 'changed status to resolved',
      photos: [{ dataUrl: 'data:image/jpeg;base64,BBB', caption: 'Interlock replaced' }],
    },
  ],
  rating: { stars: 4, comment: 'Quick turnaround.' },
  ...over,
});

const taskPack = (over: Partial<TaskPack> = {}): TaskPack => ({
  kind: 'task',
  meta,
  task: {
    id: '11111111-2222-3333-4444-555555555555',
    name: 'Fire extinguisher check',
    description: 'Check pressure and seal on every unit.',
    frequency: 'monthly',
    dueDate: '2026-09-01',
    status: 'completed',
    responsibleRole: 'caretaker',
    category: 'fire_safety',
    assignee: 'Thabo M',
  },
  completion: {
    completedBy: 'Thabo M',
    completedAt: '01 Sept 2026, 10:12',
    notes: 'All units green.',
    signatureConfirmed: true,
    photos: [{ dataUrl: 'data:image/jpeg;base64,CCC', caption: 'Extinguisher gauge' }],
    source: 'task_completions',
  },
  ...over,
});

const assetPack = (over: Partial<AssetPack> = {}): AssetPack => ({
  kind: 'asset',
  meta,
  asset: {
    id: '99999999-8888-7777-6666-555555555555',
    name: 'Chiller 1',
    category: 'HVAC System',
    location: 'Roof',
    manufacturer: 'Carrier',
    model: 'X-200',
    serialNumber: 'SN-4471',
    status: 'Operational',
    installationDate: '2019-04-01',
    purchaseDate: '2019-03-12',
    purchasePrice: 480000,
    replacementCost: 620000,
    warrantyExpiry: '2024-03-12',
    warrantyProvider: 'Carrier SA',
    expectedLifespanYears: 15,
    lastServiceDate: '2026-06-02',
    nextServiceDate: '2026-12-02',
    notes: 'Compressor 2 runs warm.',
  },
  services: [
    { date: '2026-06-02', type: 'Routine Maintenance', description: 'Filter change', performedBy: 'Cool Co', contractor: 'Cool Co', cost: 3200, nextServiceDate: '2026-12-02' },
    { date: '2025-12-02', type: 'Repair', description: 'Fan belt', performedBy: null, contractor: 'Cool Co', cost: 1800.5, nextServiceDate: null },
  ],
  ...over,
});

describe('packFileName', () => {
  it('names the file by kind and the first 8 characters of the subject id', () => {
    expect(packFileName(issuePack())).toBe('evidence-issue-aaaaaaaa.pdf');
    expect(packFileName(taskPack())).toBe('evidence-task-11111111.pdf');
    expect(packFileName(assetPack())).toBe('evidence-asset-99999999.pdf');
  });
});

describe('starLine', () => {
  it('renders five glyphs and clamps out-of-range values', () => {
    expect(starLine(4)).toBe('★★★★☆');
    expect(starLine(0)).toBe('☆☆☆☆☆');
    expect(starLine(9)).toBe('★★★★★');
    expect(starLine(-2)).toBe('☆☆☆☆☆');
  });
});

describe('buildIssuePackDoc', () => {
  it('carries the title, building, photo captions, SLA label and rating line', () => {
    const out = text(buildIssuePackDoc(issuePack()));
    expect(out).toContain('Lift stuck between floors');
    expect(out).toContain('Sandton Centre');
    expect(out).toContain('Door interlock before repair');
    expect(out).toContain('Interlock replaced');
    expect(out).toContain('Met');
    expect(out).toContain('★★★★☆');
    expect(out).toContain('Quick turnaround.');
    expect(out).toContain('Replaced the door interlock.');
  });

  it('says so when the issue has no photos', () => {
    const out = text(buildIssuePackDoc(issuePack({ photos: [] })));
    expect(out).toContain(NO_PHOTOS_COPY);
  });

  it('renders a caption-only placeholder for a photo that could not be fetched', () => {
    const out = text(buildIssuePackDoc(issuePack({ photos: [{ dataUrl: '', caption: 'Photo unavailable' }] })));
    expect(out).toContain('Photo unavailable');
    expect(out).not.toContain('"image":""');
  });

  it('names the generator and the organization in the footer', () => {
    const doc = buildIssuePackDoc(issuePack());
    const footer = doc.footer as (p: number, c: number) => unknown;
    expect(text(footer(1, 2))).toContain('Generated 11 Sept 2026, 09:00 by Arno M · Watson Mattheus');
  });
});

describe('buildTaskPackDoc', () => {
  it('prints the completion source and the signature line', () => {
    const out = text(buildTaskPackDoc(taskPack()));
    expect(out).toContain('Fire extinguisher check');
    expect(out).toContain(SOURCE_COPY.task_completions);
    expect(out).toContain('Signature confirmed');
    expect(out).toContain('Extinguisher gauge');
  });

  it('flags the denormalised fallback rather than passing it off as a completion row', () => {
    const pack = taskPack();
    const out = text(buildTaskPackDoc({ ...pack, completion: { ...pack.completion!, source: 'task_instances' } }));
    expect(out).toContain(SOURCE_COPY.task_instances);
    expect(out).not.toContain(SOURCE_COPY.task_completions);
  });

  it('says "Not completed" when there is no completion at all', () => {
    const out = text(buildTaskPackDoc(taskPack({ completion: null })));
    expect(out).toContain(NOT_COMPLETED_COPY);
  });
});

describe('buildAssetPackDoc', () => {
  it('totals the service costs and lists the lifecycle', () => {
    expect(serviceTotal(assetPack().services)).toBeCloseTo(5000.5, 2);
    const out = text(buildAssetPackDoc(assetPack()));
    expect(out).toContain('Chiller 1');
    expect(out).toContain('Total service cost: R 5 000,50');
    expect(out).toContain('Warranty expiry');
    expect(out).toContain('Filter change');
  });

  it('handles an asset with no service history', () => {
    const out = text(buildAssetPackDoc(assetPack({ services: [] })));
    expect(out).toContain('No services recorded');
    expect(out).toContain('Total service cost: R 0');
  });
});

describe('buildEvidencePackDoc', () => {
  it('dispatches on kind', () => {
    expect(text(buildEvidencePackDoc(issuePack()))).toBe(text(buildIssuePackDoc(issuePack())));
    expect(text(buildEvidencePackDoc(taskPack()))).toBe(text(buildTaskPackDoc(taskPack())));
    expect(text(buildEvidencePackDoc(assetPack()))).toBe(text(buildAssetPackDoc(assetPack())));
  });
});
