/**
 * Evidence packs (R4b, spec §5.9): the PDF you hand to an insurer, a landlord or an inspector
 * when they ask "prove it" about one issue, one completed task or one asset.
 *
 * Pure document builders only — `TDocumentDefinitions` in, no I/O, no DOM, no pdfmake runtime
 * (that lives in `pdfGenerator.renderPdfBlob`). Same split as `fortressReportDoc.ts` /
 * `fortressReportPdf.ts`, so every layout decision here is unit-testable.
 *
 * Photos arrive pre-embedded as `EmbeddedPhoto` data URLs; the loaders in `evidencePackData.ts`
 * fetch, sign and downscale them. A photo that could not be fetched is still listed, as a
 * caption-only placeholder — a pack that silently drops evidence is worse than one that says
 * the file could not be read.
 */
import type { TDocumentDefinitions, Content, TableCell } from 'pdfmake/interfaces';
import type { EmbeddedPhoto } from '@/lib/fortressReportDoc';
import { runningHeader, safePrimaryColor } from '@/lib/reportDocs';
import { formatRand } from '@/lib/money';

/**
 * How many photos one pack fetches and embeds. A resolved issue with a photo on every comment
 * can carry dozens; each is held three times at peak (blob, data URL, zip copy) and every one
 * is a round-trip, so the pack stops here and SAYS how many it left out rather than locking
 * the tab up on a phone. Raise it only with a measurement to back the new number.
 */
export const PACK_PHOTO_CAP = 40;

export interface PackMeta {
  orgName: string;
  primaryColor: string;
  /** Display text, already formatted by the caller (the builders never touch the clock). */
  generatedAt: string;
  generatedBy: string;
  buildingName: string;
  /** Photos beyond `PACK_PHOTO_CAP` that this pack did not fetch; printed on the document. */
  photosOmitted?: number;
}

/** The line a capped pack prints, so nobody reads a short pack as "that is all there was". */
export function photosOmittedCopy(n: number): string {
  return `${n} further ${n === 1 ? 'photo is' : 'photos are'} not included — this pack embeds at most ${PACK_PHOTO_CAP}.`;
}

export interface IssuePack {
  kind: 'issue';
  meta: PackMeta;
  issue: {
    id: string;
    title: string;
    description: string;
    priority: string;
    status: string;
    category: string | null;
    createdAt: string;
    deadline: string | null;
    resolvedAt: string | null;
    reportedBy: string;
    assignee: string | null;
    contractor: string | null;
    estimatedCost: number | null;
    actualCost: number | null;
    correctiveAction: string | null;
  };
  sla: {
    targetHours: number | null;
    dueAt: string | null;
    breachedAt: string | null;
    firstResponseAt: string | null;
    label: string;
  };
  photos: EmbeddedPhoto[];
  timeline: { at: string; author: string; type: string; text: string; photos: EmbeddedPhoto[] }[];
  rating: { stars: number; comment: string | null } | null;
}

export interface TaskPack {
  kind: 'task';
  meta: PackMeta;
  task: {
    id: string;
    name: string;
    description: string | null;
    frequency: string;
    dueDate: string;
    status: string;
    responsibleRole: string;
    category: string | null;
    assignee: string | null;
  };
  completion: {
    completedBy: string;
    completedAt: string;
    notes: string | null;
    signatureConfirmed: boolean;
    photos: EmbeddedPhoto[];
    /**
     * Which row the evidence came from. `task_instances` is the denormalised copy kept on the
     * task itself; it is the fallback, and the pack says so in plain text rather than passing
     * it off as a signed completion record.
     */
    source: 'task_completions' | 'task_instances';
  } | null;
}

export interface AssetPack {
  kind: 'asset';
  meta: PackMeta;
  asset: {
    id: string;
    name: string;
    category: string;
    location: string | null;
    manufacturer: string | null;
    model: string | null;
    serialNumber: string | null;
    status: string;
    installationDate: string | null;
    purchaseDate: string | null;
    purchasePrice: number | null;
    replacementCost: number | null;
    warrantyExpiry: string | null;
    warrantyProvider: string | null;
    expectedLifespanYears: number | null;
    lastServiceDate: string | null;
    nextServiceDate: string | null;
    notes: string | null;
  };
  services: {
    date: string;
    type: string;
    description: string | null;
    performedBy: string | null;
    contractor: string | null;
    cost: number | null;
    nextServiceDate: string | null;
  }[];
}

export type EvidencePack = IssuePack | TaskPack | AssetPack;

/** Plain copy for the empty states — asserted by the tests, so they live as constants. */
export const NO_PHOTOS_COPY = 'No photos attached';
export const NOT_COMPLETED_COPY = 'Not completed';
export const SOURCE_COPY: Record<'task_completions' | 'task_instances', string> = {
  task_completions: 'Recorded in task_completions',
  task_instances: 'Recorded on the task (no completion row)',
};

const PHOTOS_PER_ROW = 2;
const PHOTO_W = 240;
const MUTED = '#6b7280';

const KIND_TITLE: Record<EvidencePack['kind'], string> = {
  issue: 'Issue evidence pack',
  task: 'Task evidence pack',
  asset: 'Asset evidence pack',
};

function subjectId(pack: EvidencePack): string {
  return pack.kind === 'issue' ? pack.issue.id : pack.kind === 'task' ? pack.task.id : pack.asset.id;
}

/** `evidence-issue-1a2b3c4d.pdf` — the kind plus the first 8 characters of the subject's id. */
export function packFileName(pack: EvidencePack): string {
  return `evidence-${pack.kind}-${subjectId(pack).slice(0, 8)}.pdf`;
}

const dash = (v: string | null | undefined): string => (v == null || v === '' ? '—' : v);
const money = (v: number | null | undefined): string => (v == null ? '—' : formatRand(v));

/** `★★★★☆` for 4 of 5; anything outside 0–5 is clamped rather than repeated into the page. */
export function starLine(stars: number): string {
  const n = Math.max(0, Math.min(5, Math.round(stars)));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

function sectionTitle(text: string): Content {
  return { text, style: 'sectionTitle' };
}

/** Two-column key/value block: 44 % label, 56 % value, no borders. */
function keyValues(pairs: [string, string][]): Content {
  const body: TableCell[][] = pairs.map(([k, v]) => [
    { text: k, style: 'k' },
    { text: v, style: 'v' },
  ]);
  return {
    margin: [0, 4, 0, 8],
    layout: 'noBorders',
    table: { widths: ['44%', '56%'], body },
  };
}

/** 2-per-row photo grid; caption (and time) under each. */
function photoGrid(photos: EmbeddedPhoto[], emptyCopy = NO_PHOTOS_COPY): Content[] {
  if (photos.length === 0) return [{ text: emptyCopy, style: 'muted' }];
  const rows: Content[] = [];
  for (let i = 0; i < photos.length; i += PHOTOS_PER_ROW) {
    const slice = photos.slice(i, i + PHOTOS_PER_ROW);
    rows.push({
      margin: [0, 0, 0, 8],
      columnGap: 8,
      columns: slice.map((p): Content => ({
        width: PHOTO_W,
        stack: [
          // A photo that could not be fetched has no data URL: the caption still carries its place.
          ...(p.dataUrl ? [{ image: p.dataUrl, fit: [PHOTO_W, PHOTO_W * 0.75] } as Content] : []),
          ...(p.caption ? [{ text: p.caption, style: 'caption' } as Content] : []),
        ],
      })),
    });
  }
  return rows;
}

function docShell(pack: EvidencePack, body: Content[]): TDocumentDefinitions {
  const { meta } = pack;
  const primary = safePrimaryColor(meta.primaryColor);
  const title = KIND_TITLE[pack.kind];
  return {
    pageMargins: [40, 50, 40, 44],
    content: [
      { text: meta.orgName, style: 'org' },
      { text: title, style: 'title' },
      { text: meta.buildingName, style: 'meta' },
      ...body,
      // Last line of the document, whatever the kind: a capped pack must never look complete.
      ...(meta.photosOmitted ? [{ text: photosOmittedCopy(meta.photosOmitted), style: 'muted' } as Content] : []),
    ],
    styles: {
      org: { color: primary, bold: true, fontSize: 12, margin: [0, 0, 0, 2] },
      title: { fontSize: 20, bold: true, margin: [0, 0, 0, 2] },
      meta: { color: MUTED, fontSize: 10, margin: [0, 0, 0, 10] },
      sectionTitle: { fontSize: 13, bold: true, color: '#111827', margin: [0, 12, 0, 4] },
      k: { fontSize: 9, color: MUTED, margin: [0, 1, 0, 1] },
      v: { fontSize: 10, margin: [0, 1, 0, 1] },
      body: { fontSize: 10, margin: [0, 0, 0, 6] },
      muted: { fontSize: 10, color: MUTED, margin: [0, 0, 0, 6] },
      caption: { fontSize: 7, color: MUTED, margin: [0, 2, 0, 0] },
      th: { bold: true, fontSize: 9, color: primary },
      td: { fontSize: 9 },
      footer: { fontSize: 8, color: '#9ca3af' },
    },
    header: runningHeader(meta.orgName, title),
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        { text: `Generated ${meta.generatedAt} by ${meta.generatedBy} · ${meta.orgName}`, style: 'footer', margin: [40, 20, 0, 0] },
        { text: `Page ${currentPage} of ${pageCount}`, style: 'footer', alignment: 'right', margin: [0, 20, 40, 0] },
      ],
    }),
    defaultStyle: { font: 'Roboto', fontSize: 10 },
  };
}

// ---------------------------------------------------------------------------
// Issue
// ---------------------------------------------------------------------------

export function buildIssuePackDoc(p: IssuePack): TDocumentDefinitions {
  const { issue, sla, rating } = p;

  const header = keyValues([
    ['Building', p.meta.buildingName],
    ['Status', issue.status],
    ['Priority', issue.priority],
    ['Category', dash(issue.category)],
    ['Reported', issue.createdAt],
    ['Reported by', issue.reportedBy],
    ['Assigned to', dash(issue.assignee)],
    ['Contractor', dash(issue.contractor)],
    ['Deadline', dash(issue.deadline)],
    ['Estimated cost', money(issue.estimatedCost)],
    ['Actual cost', money(issue.actualCost)],
  ]);

  const slaBlock = keyValues([
    ['SLA', sla.label],
    ['Target', sla.targetHours == null ? '—' : `${sla.targetHours} h`],
    ['Due', dash(sla.dueAt)],
    ['First response', dash(sla.firstResponseAt)],
    ['Breached at', dash(sla.breachedAt)],
  ]);

  const timelineBody: TableCell[][] = [
    [
      { text: 'When', style: 'th' },
      { text: 'Who', style: 'th' },
      { text: 'What', style: 'th' },
    ],
  ];
  const timelineContent: Content[] = [];
  if (p.timeline.length === 0) {
    timelineContent.push({ text: 'No activity recorded', style: 'muted' });
  } else {
    for (const entry of p.timeline) {
      timelineBody.push([
        { text: entry.at, style: 'td' },
        { text: entry.author, style: 'td' },
        { text: entry.text || entry.type, style: 'td' },
      ]);
    }
    timelineContent.push({
      margin: [0, 4, 0, 8],
      layout: 'lightHorizontalLines',
      table: { headerRows: 1, widths: ['22%', '22%', '*'], body: timelineBody },
    });
    // Comment photos follow the table, each labelled with its entry, so a reader can tie
    // an image back to the line that produced it without an inline-image table layout.
    for (const entry of p.timeline) {
      if (entry.photos.length === 0) continue;
      timelineContent.push({ text: `${entry.at} · ${entry.author}`, style: 'muted' });
      timelineContent.push(...photoGrid(entry.photos));
    }
  }

  const resolution: Content[] = [
    sectionTitle('Resolution'),
    keyValues([
      ['Corrective action', dash(issue.correctiveAction)],
      ['Resolved at', dash(issue.resolvedAt)],
    ]),
  ];
  if (rating) {
    resolution.push({ text: `Contractor rating: ${starLine(rating.stars)} (${rating.stars} of 5)`, style: 'body' });
    if (rating.comment) resolution.push({ text: rating.comment, style: 'muted' });
  }

  return docShell(p, [
    { text: issue.title, style: 'sectionTitle' },
    header,
    { text: issue.description, style: 'body' },
    sectionTitle('Service level'),
    slaBlock,
    sectionTitle('Photos'),
    ...photoGrid(p.photos),
    sectionTitle('Timeline'),
    ...timelineContent,
    ...resolution,
  ]);
}

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

export function buildTaskPackDoc(p: TaskPack): TDocumentDefinitions {
  const { task, completion } = p;

  const instance = keyValues([
    ['Building', p.meta.buildingName],
    ['Status', task.status],
    ['Frequency', task.frequency],
    ['Due date', task.dueDate],
    ['Responsible role', task.responsibleRole],
    ['Category', dash(task.category)],
    ['Assigned to', dash(task.assignee)],
  ]);

  const completionBlock: Content[] = completion
    ? [
        keyValues([
          ['Completed by', completion.completedBy],
          ['Completed at', completion.completedAt],
          ['Signature confirmed', completion.signatureConfirmed ? 'Yes' : 'No'],
          ['Notes', dash(completion.notes)],
        ]),
        { text: SOURCE_COPY[completion.source], style: 'muted' },
        sectionTitle('Photos'),
        ...photoGrid(completion.photos),
      ]
    : [{ text: NOT_COMPLETED_COPY, style: 'muted' }];

  return docShell(p, [
    { text: task.name, style: 'sectionTitle' },
    instance,
    ...(task.description ? [{ text: task.description, style: 'body' } as Content] : []),
    sectionTitle('Completion'),
    ...completionBlock,
  ]);
}

// ---------------------------------------------------------------------------
// Asset
// ---------------------------------------------------------------------------

/** Total of every recorded service cost; services without a cost contribute nothing. */
export function serviceTotal(services: AssetPack['services']): number {
  return services.reduce((sum, s) => sum + (s.cost ?? 0), 0);
}

export function buildAssetPackDoc(p: AssetPack): TDocumentDefinitions {
  const { asset, services } = p;

  const identity = keyValues([
    ['Building', p.meta.buildingName],
    ['Category', asset.category],
    ['Location', dash(asset.location)],
    ['Status', asset.status],
    ['Manufacturer', dash(asset.manufacturer)],
    ['Model', dash(asset.model)],
    ['Serial number', dash(asset.serialNumber)],
  ]);

  const lifecycle = keyValues([
    ['Purchased', dash(asset.purchaseDate)],
    ['Installed', dash(asset.installationDate)],
    ['Purchase price', money(asset.purchasePrice)],
    ['Replacement cost', money(asset.replacementCost)],
    ['Warranty expiry', dash(asset.warrantyExpiry)],
    ['Warranty provider', dash(asset.warrantyProvider)],
    ['Expected lifespan', asset.expectedLifespanYears == null ? '—' : `${asset.expectedLifespanYears} years`],
    ['Last service', dash(asset.lastServiceDate)],
    ['Next service', dash(asset.nextServiceDate)],
  ]);

  const serviceContent: Content[] = [];
  if (services.length === 0) {
    serviceContent.push({ text: 'No services recorded', style: 'muted' });
  } else {
    const body: TableCell[][] = [
      ['Date', 'Type', 'Description', 'Performed by', 'Contractor', 'Cost', 'Next'].map(
        (t): TableCell => ({ text: t, style: 'th' }),
      ),
    ];
    for (const s of services) {
      body.push([
        { text: s.date, style: 'td' },
        { text: s.type, style: 'td' },
        { text: dash(s.description), style: 'td' },
        { text: dash(s.performedBy), style: 'td' },
        { text: dash(s.contractor), style: 'td' },
        { text: money(s.cost), style: 'td' },
        { text: dash(s.nextServiceDate), style: 'td' },
      ]);
    }
    serviceContent.push({
      margin: [0, 4, 0, 8],
      layout: 'lightHorizontalLines',
      table: { headerRows: 1, widths: ['auto', 'auto', '*', 'auto', 'auto', 'auto', 'auto'], body },
    });
  }

  return docShell(p, [
    { text: asset.name, style: 'sectionTitle' },
    identity,
    sectionTitle('Lifecycle'),
    lifecycle,
    sectionTitle('Service history'),
    ...serviceContent,
    sectionTitle('Costs'),
    {
      text: `Total service cost: ${formatRand(serviceTotal(services))} across ${services.length} ${services.length === 1 ? 'service' : 'services'}`,
      style: 'body',
    },
    ...(asset.notes ? [sectionTitle('Notes'), { text: asset.notes, style: 'body' } as Content] : []),
  ]);
}

export function buildEvidencePackDoc(p: EvidencePack): TDocumentDefinitions {
  switch (p.kind) {
    case 'issue':
      return buildIssuePackDoc(p);
    case 'task':
      return buildTaskPackDoc(p);
    case 'asset':
      return buildAssetPackDoc(p);
  }
}
