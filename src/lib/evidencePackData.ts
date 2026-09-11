/**
 * Loaders for the evidence packs (R4b, spec §5.9). Browser-only: they read through the typed
 * Supabase client, re-sign every stored photo URL and downscale the images to data URLs for
 * pdfmake. The pure doc builders live in `evidencePack.ts` and never see any of this.
 *
 * Two rules the pack depends on:
 *  - `task_completions` is the source of truth for task evidence. The denormalised copy on
 *    `task_instances` is only a fallback, and the pack SAYS SO (`source`) rather than passing
 *    it off as a completion record.
 *  - A photo that cannot be fetched becomes a caption-only "Photo unavailable" placeholder.
 *    Failing the whole pack over one unreachable file would be worse; silently dropping it
 *    would be worse still.
 */
import { supabase } from '@/integrations/supabase/client';
import { resolveStorageUrl } from '@/integrations/supabase/storage';
import { slaState } from '@/lib/slaState';
import type { EmbeddedPhoto } from '@/lib/fortressReportDoc';
import { PACK_PHOTO_CAP, type AssetPack, type EvidencePack, type IssuePack, type PackMeta, type TaskPack } from '@/lib/evidencePack';

/** Same numbers as `fortressReportPdf`, so a photo looks identical in a report and in a pack. */
const PHOTO_MAX_DIM = 1100;
const PHOTO_QUALITY = 0.7;

/**
 * Photos in flight at once. Sequential fetching meant one round-trip per photo behind a bare
 * spinner; unbounded parallelism would hold every blob at once on a phone. Four is the middle.
 */
const PHOTO_CONCURRENCY = 4;

export const PHOTO_UNAVAILABLE_CAPTION = 'Photo unavailable';

/** The manifest is a pack FILE, never a photo — the counts must not include it. */
export const PACK_MANIFEST_NAME = 'photos/index.txt';

/** One original photo as fetched, ready to be zipped alongside the PDF. */
export interface PackOriginal {
  name: string;
  blob: Blob;
}

/** Called after each photo settles, so a caller can say "Fetching photo 3 of 12". */
export type PackProgress = (done: number, total: number) => void;

/** What one pack load returns: the document, the files to zip, and how many photos that is. */
export interface LoadedPack<P extends EvidencePack = EvidencePack> {
  pack: P;
  originals: PackOriginal[];
  /** Photos actually fetched — `originals` also carries the manifest. */
  photoCount: number;
}

/** Fail loudly: an empty section in a compliance pack is indistinguishable from "nothing happened". */
function need<T>(data: T | null | undefined, error: { message: string } | null, what: string): T {
  if (error) throw new Error(`Could not load ${what}: ${error.message}`);
  if (data === null || data === undefined) throw new Error(`Could not load ${what}: not found`);
  return data;
}

/** `photo_urls` is `Json` in the generated types; only the string entries are usable. */
export function photoUrlList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v !== '') : [];
}

const SAST = new Intl.DateTimeFormat('en-ZA', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Johannesburg',
});

/** Instant → wall-clock text in SAST; the pack never prints a raw ISO string. */
export function instant(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : SAST.format(d);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function downscaleToDataUrl(blob: Blob): Promise<string> {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, PHOTO_MAX_DIM / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d ctx');
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    return canvas.toDataURL('image/jpeg', PHOTO_QUALITY);
  } catch {
    return blobToDataUrl(blob);
  }
}

interface PhotoRequest {
  storedUrl: string;
  caption: string;
  source: string;
}

interface FetchedPhoto {
  blob: Blob;
  dataUrl: string;
  ext: 'png' | 'jpg';
}

/**
 * Two phases, because the pack cannot report progress over a list it has not counted yet:
 * every section calls `request()` (cheap, synchronous, reserves a slot), then `run()` fetches
 * the whole set with a small concurrency limit and FILLS THE RESERVED SLOTS IN PLACE. The pack
 * builders hold the same objects, so they see the finished photos.
 *
 * Exported for its own unit tests — the loaders are the only production callers.
 */
export class PhotoCollector {
  readonly originals: PackOriginal[] = [];
  private readonly index: string[] = [];
  private readonly slots: { req: PhotoRequest; photo: EmbeddedPhoto }[] = [];
  /** Photos past `PACK_PHOTO_CAP`: not fetched, not listed, counted on the document instead. */
  omitted = 0;

  /** Reserves one slot per URL, up to the cap. The returned objects are filled in by `run()`. */
  request(urls: string[], captionFor: (i: number) => string, source: string): EmbeddedPhoto[] {
    const out: EmbeddedPhoto[] = [];
    for (let i = 0; i < urls.length; i++) {
      if (this.slots.length >= PACK_PHOTO_CAP) {
        this.omitted += urls.length - i;
        break;
      }
      const photo: EmbeddedPhoto = { dataUrl: '', caption: captionFor(i) };
      this.slots.push({ req: { storedUrl: urls[i], caption: photo.caption ?? '', source }, photo });
      out.push(photo);
    }
    return out;
  }

  /** How many photos `run()` will fetch — the `n` in "photo i of n". */
  get pending(): number {
    return this.slots.length;
  }

  /**
   * One photo, or null when it cannot be used. `fetch` only rejects on a NETWORK failure: a 403
   * from an expired signed URL, a 404 or a 5xx all RESOLVE, and their JSON/XML error body would
   * otherwise be zipped as `photos/01.jpg` and handed to pdfmake as an image. The status and the
   * content type are therefore checked before the body is read at all.
   */
  private async fetchOne(req: PhotoRequest): Promise<FetchedPhoto | null> {
    try {
      const signed = await resolveStorageUrl(req.storedUrl);
      if (!signed) throw new Error('could not sign');
      const res = await fetch(signed);
      if (!res.ok) throw new Error(`unreadable (HTTP ${res.status})`);
      const type = res.headers.get('content-type') ?? '';
      if (!type.startsWith('image/')) throw new Error(`unreadable (content-type ${type || 'unknown'})`);
      const blob = await res.blob();
      return { blob, dataUrl: await downscaleToDataUrl(blob), ext: type.startsWith('image/png') ? 'png' : 'jpg' };
    } catch {
      return null;
    }
  }

  /** Fetches every requested photo, at most `PHOTO_CONCURRENCY` at a time, and fills the slots. */
  async run(onProgress?: PackProgress): Promise<void> {
    const total = this.slots.length;
    const fetched: (FetchedPhoto | null)[] = new Array(total).fill(null);
    let next = 0;
    let done = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const i = next++;
        if (i >= total) return;
        fetched[i] = await this.fetchOne(this.slots[i].req);
        done++;
        onProgress?.(done, total);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PHOTO_CONCURRENCY, total) }, worker));

    // Numbered in PACK order, not in the order the fetches happened to finish.
    for (let i = 0; i < total; i++) {
      const { req, photo } = this.slots[i];
      const got = fetched[i];
      if (!got) {
        this.index.push(`(missing)\t${req.source}\t${req.storedUrl}`);
        photo.caption = `${req.caption} — ${PHOTO_UNAVAILABLE_CAPTION}`;
        continue;
      }
      const name = `photos/${String(this.originals.length + 1).padStart(2, '0')}.${got.ext}`;
      this.originals.push({ name, blob: got.blob });
      this.index.push(`${name}\t${req.source}\t${req.storedUrl}`);
      photo.dataUrl = got.dataUrl;
    }
  }

  /** The originals plus a manifest saying where each file came from; empty when nothing was fetched. */
  finish(): PackOriginal[] {
    if (this.originals.length === 0) return [];
    const text = ['file\tsource\tstored_url', ...this.index].join('\n') + '\n';
    return [...this.originals, { name: PACK_MANIFEST_NAME, blob: new Blob([text], { type: 'text/plain' }) }];
  }

  /** `meta` plus the omitted count, so the document can say what it left out. */
  metaWith(meta: PackMeta): PackMeta {
    return this.omitted > 0 ? { ...meta, photosOmitted: this.omitted } : meta;
  }
}

/** Display names for a building's people, from the `building_members` RPC (profiles are not readable directly). */
async function memberNames(buildingId: string): Promise<Map<string, string>> {
  const { data, error } = await supabase.rpc('building_members', { b: buildingId });
  if (error) return new Map(); // a name is a nicety; the pack must not fail over it
  const rows = (data ?? []) as { id: string; full_name: string | null }[];
  return new Map(rows.map((m) => [m.id, m.full_name?.trim() || 'Unnamed user']));
}

const ACTIVITY_LABELS: Record<string, string> = {
  comment: 'commented',
  status_change: 'changed status',
  assignment: 'reassigned',
  contractor_assignment: 'assigned a contractor',
};

function activityText(a: { activity_type: string; comment: string | null; old_value: string | null; new_value: string | null }): string {
  if (a.activity_type === 'comment') return a.comment ?? '';
  const label = ACTIVITY_LABELS[a.activity_type] ?? a.activity_type;
  const from = a.old_value ? ` from ${a.old_value}` : '';
  const to = a.new_value ? ` to ${a.new_value}` : '';
  return `${label}${from}${to}`;
}

export async function loadIssuePack(issueId: string, meta: PackMeta, onProgress?: PackProgress): Promise<LoadedPack<IssuePack>> {
  const issueRes = await supabase.from('issues').select('*').eq('id', issueId).maybeSingle();
  const issue = need(issueRes.data, issueRes.error, 'the issue');
  const activityRes = await supabase.from('issue_activity').select('*').eq('issue_id', issueId).order('created_at', { ascending: true });
  const activity = need(activityRes.data, activityRes.error, 'the issue timeline');
  const ratingRes = await supabase.from('contractor_ratings').select('rating, comment').eq('issue_id', issueId).maybeSingle();
  // A rating is optional; a read that FAILED still fails the pack (an absent rating and an
  // unreadable one must not look the same on a compliance document).
  if (ratingRes.error) throw new Error(`Could not load the contractor rating: ${ratingRes.error.message}`);
  const ratingRow = ratingRes.data;

  let contractor: string | null = null;
  if (issue.contractor_id) {
    const { data } = await supabase.from('contractors').select('company_name').eq('id', issue.contractor_id).maybeSingle();
    contractor = data?.company_name ?? null;
  }

  const names = await memberNames(issue.building_id);
  const nameOf = (id: string | null): string | null => (id ? names.get(id) ?? null : null);

  // Phase 1: reserve every photo slot (cheap), so phase 2 knows the total and can report it.
  const photos = new PhotoCollector();
  const issuePhotos = photos.request(
    photoUrlList(issue.photo_urls),
    (i) => `Reported photo ${i + 1}`,
    'issue',
  );

  const timeline: IssuePack['timeline'] = [];
  for (const a of activity) {
    const author = a.author_name?.trim() || nameOf(a.user_id) || 'Someone';
    const at = instant(a.created_at) ?? a.created_at;
    timeline.push({
      at,
      author,
      type: a.activity_type,
      text: activityText(a),
      photos: photos.request(photoUrlList(a.photo_urls), (i) => `${at} · photo ${i + 1}`, 'comment'),
    });
  }
  // Phase 2: fetch them all, filling the slots the pack above already holds.
  await photos.run(onProgress);

  // The SLA fields are typed on `issues`; slaState needs created_at, which the DB always writes.
  const sla = slaState({
    created_at: issue.created_at ?? new Date().toISOString(),
    status: issue.status,
    sla_target_hours: issue.sla_target_hours,
    sla_breached_at: issue.sla_breached_at,
    first_response_at: issue.first_response_at,
    resolved_at: issue.resolved_at,
  });

  const pack: IssuePack = {
    kind: 'issue',
    meta: photos.metaWith(meta),
    issue: {
      id: issue.id,
      title: issue.title,
      description: issue.description,
      priority: issue.priority,
      status: issue.status,
      category: issue.category,
      createdAt: instant(issue.created_at) ?? '—',
      deadline: issue.deadline,
      resolvedAt: instant(issue.resolved_at),
      reportedBy: nameOf(issue.reported_by) ?? 'Unknown',
      assignee: nameOf(issue.assigned_to),
      contractor,
      estimatedCost: issue.estimated_cost,
      actualCost: issue.actual_cost,
      correctiveAction: issue.corrective_action,
    },
    sla: {
      targetHours: issue.sla_target_hours,
      dueAt: sla.due ? (instant(sla.due.toISOString()) ?? null) : null,
      breachedAt: instant(issue.sla_breached_at),
      firstResponseAt: instant(issue.first_response_at),
      label: sla.label,
    },
    photos: issuePhotos,
    timeline,
    rating: ratingRow ? { stars: ratingRow.rating, comment: ratingRow.comment } : null,
  };
  return { pack, originals: photos.finish(), photoCount: photos.originals.length };
}

export async function loadTaskPack(taskId: string, meta: PackMeta, onProgress?: PackProgress): Promise<LoadedPack<TaskPack>> {
  const taskRes = await supabase.from('task_instances').select('*').eq('id', taskId).maybeSingle();
  const task = need(taskRes.data, taskRes.error, 'the task');
  const completionsRes = await supabase
    .from('task_completions')
    .select('completed_by, created_at, notes, photo_urls, signature_confirmed')
    .eq('task_instance_id', taskId)
    .order('created_at', { ascending: false });
  const completions = need(completionsRes.data, completionsRes.error, 'the task completion');

  const names = await memberNames(task.building_id);
  const nameOf = (id: string | null): string | null => (id ? names.get(id) ?? null : null);
  const photos = new PhotoCollector();

  let completion: TaskPack['completion'] = null;
  const row = completions[0];
  if (row) {
    completion = {
      completedBy: nameOf(row.completed_by) ?? 'Unknown',
      completedAt: instant(row.created_at) ?? '—',
      notes: row.notes,
      signatureConfirmed: !!row.signature_confirmed,
      photos: photos.request(photoUrlList(row.photo_urls), (i) => `Completion photo ${i + 1}`, 'completion'),
      source: 'task_completions',
    };
  } else if (task.completed_at) {
    // Denormalised fallback: the task carries a copy of the completion but no `task_completions`
    // row exists. The pack prints the source, so a reader can tell the two apart.
    completion = {
      completedBy: nameOf(task.completed_by) ?? 'Unknown',
      completedAt: instant(task.completed_at) ?? '—',
      notes: task.completion_notes,
      signatureConfirmed: !!task.signature_url,
      photos: photos.request(photoUrlList(task.photo_urls), (i) => `Completion photo ${i + 1}`, 'task'),
      source: 'task_instances',
    };
  }
  await photos.run(onProgress);

  const pack: TaskPack = {
    kind: 'task',
    meta: photos.metaWith(meta),
    task: {
      id: task.id,
      name: task.task_name,
      description: task.task_description,
      frequency: task.frequency,
      dueDate: task.due_date,
      status: task.status,
      responsibleRole: task.responsible_role ?? 'user',
      category: task.category,
      assignee: nameOf(task.assigned_to),
    },
    completion,
  };
  return { pack, originals: photos.finish(), photoCount: photos.originals.length };
}

export async function loadAssetPack(assetId: string, meta: PackMeta): Promise<LoadedPack<AssetPack>> {
  const assetRes = await supabase.from('building_assets').select('*').eq('id', assetId).maybeSingle();
  const asset = need(assetRes.data, assetRes.error, 'the asset');
  const servicesRes = await supabase
    .from('asset_service_history')
    .select('*, contractors(company_name)')
    .eq('asset_id', assetId)
    .order('service_date', { ascending: false });
  const services = need(servicesRes.data, servicesRes.error, 'the service history');

  const pack: AssetPack = {
    kind: 'asset',
    meta,
    asset: {
      id: asset.id,
      name: asset.name,
      category: asset.category ?? '—',
      location: asset.location,
      manufacturer: asset.manufacturer,
      model: asset.model,
      serialNumber: asset.serial_number,
      status: asset.status ?? '—',
      installationDate: asset.installation_date,
      purchaseDate: asset.purchase_date,
      purchasePrice: asset.purchase_price,
      replacementCost: asset.replacement_cost,
      warrantyExpiry: asset.warranty_expiry,
      warrantyProvider: asset.warranty_provider,
      expectedLifespanYears: asset.expected_lifespan_years,
      lastServiceDate: asset.last_service_date,
      nextServiceDate: asset.next_service_date,
      notes: asset.notes,
    },
    services: services.map((s) => ({
      date: s.service_date,
      type: s.service_type ?? '—',
      description: s.description,
      performedBy: s.performed_by,
      contractor: s.contractors?.company_name ?? null,
      cost: s.cost,
      nextServiceDate: s.next_service_date,
    })),
  };
  // An asset pack embeds no photos; the zip option still resolves to just the PDF.
  return { pack, originals: [], photoCount: 0 };
}

export async function loadEvidencePack(
  kind: 'issue' | 'task' | 'asset',
  id: string,
  meta: PackMeta,
  onProgress?: PackProgress,
): Promise<LoadedPack> {
  switch (kind) {
    case 'issue':
      return loadIssuePack(id, meta, onProgress);
    case 'task':
      return loadTaskPack(id, meta, onProgress);
    case 'asset':
      return loadAssetPack(id, meta);
  }
}
