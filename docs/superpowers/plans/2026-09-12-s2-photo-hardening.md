# S2 "Photo pipeline hardening" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A report PDF can no longer be poisoned by a bad photo or logo (an expired signed URL's JSON body, an XML error page, an SVG pdfmake cannot embed — each is skipped and counted, never handed to pdfmake); a second inspection photo can no longer orphan the first (the append happens in one server statement, not a read-modify-write of the query cache); a 40 MB+ source file is refused before HEIC conversion or canvas work; and clearing an inspection value (capex, comment) actually saves the clear instead of re-saving the old value.

**Architecture:** One browser helper, `src/lib/imageFetch.ts`, becomes the only way the app fetches an image it means to embed: it checks `res.ok` and the `content-type` before the body is read, optionally rejects SVG, and decodes through `createImageBitmap(blob, { imageOrientation: 'from-image' })` with a plain-call fallback. `evidencePackData.fetchOne` and `fortressReportPdf.embedPhoto` both call it; the PDF photo path loses its FileReader fallback (a failed decode is a skipped photo, not a base64'd error body), while the logo keeps a FileReader read that now runs only after the same checks plus an SVG rejection. `fortressReportDoc.photoRows` guards `dataUrl` truthiness the way the evidence pack's `photoGrid` already does. One additive migration in `../GMI/sql/` adds `append_inspection_photo` (security INVOKER, so the existing `ir_write` policy decides); `ConditionInspectionSection.addPhoto` calls it and writes the returned row into the React Query cache through a new `mergeResponse` helper on `useInspectionSection`, whose `setResponse` gains absent-keeps / null-clears patch semantics. `PhotoCapture` gains a `MAX_SOURCE_BYTES` gate; `Settings` stops offering SVG logos.

**Tech Stack:** React 18 + TS, TanStack Query v5, Supabase JS v2 (PostgREST RPC), Postgres 17 (plpgsql, security invoker, RLS), pdfmake, vitest 3 + Testing Library 16 (jsdom 20), `heic2any`.

**Spec:** `docs/superpowers/specs/2026-09-12-field-readiness-design.md` §5 (all of it); constraints §2; deploy §9.

**Ground rules for every agent:** never `git stash` / `checkout` / `switch` / `reset` / `worktree`; compare with `git show <sha>:<path>`; edit only the files your task names; commit with an explicit pathspec; retry after 5 s on `index.lock` (other agents commit concurrently); end commit messages with a blank line and `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; gate = `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E '<your files>'` prints nothing, `npm run test -- <your pattern>` green, the global `error TS` count ≤ `.github/typecheck-baseline.txt` (**46**) measured on a clean tree at commit time; guardrail copy (validation, data-loss, "could not save") is plain text, never through `<Hint>`; mobile-first, tap targets ≥ 44 px; the new RPC is not in the generated types until the controller regenerates them after the migration is applied, so cast at the boundary with the comment `// append_inspection_photo is not yet in the generated types; regenerate after the migration ships.` exactly as R1/R2 did (the controller removes it in Task 9); every new SQL function `set search_path = ''`, `revoke all … from public`, explicit `revoke execute … from anon`; the SQL file is authored in `../GMI/sql/` and vendored with `npm run schema:vendor` — vendoring is serialised across slices (S1 vendors `2026-09-15_01_team_coverage.sql` first; if `supabase/schema/.source` shows a diff you did not cause, re-run the vendor step after theirs lands, and stage only your file plus `.source`).

**Task order and parallelism:** Task 1 first (Tasks 2 and 3 import it). Tasks 2, 3, 4, 5, 6 are pairwise disjoint and may run in parallel once Task 1 has landed. Task 7 needs the function name from Task 6 (boundary cast only — it does not need the migration applied). **Task 8 touches the same two files as Task 7 and must run after it, never alongside it.** Task 9 is controller-only.

**Controller-only steps** (not for implementer agents): applying the migration to staging and prod through the Management API, running the live smokes, regenerating `types.ts` / `fortress-types.ts`, dropping the boundary casts, writing the `APPLY_CHECKLIST.md` section.

---

### Task 1: `imageFetch` — one guarded image fetch and one bitmap decoder

**Files:**
- Create: `src/lib/imageFetch.ts`, `src/lib/imageFetch.test.ts`

- [x] **Step 1: Failing test**

```ts
// src/lib/imageFetch.test.ts
/**
 * `fetch` only rejects on a NETWORK failure: a 403 from an expired signed URL, a 404 or a 5xx all
 * RESOLVE, and their JSON/XML error body would otherwise be decoded as an image — or base64'd into
 * a data URL and handed to pdfmake, which then fails the whole export. These tests pin the three
 * refusals (status, content type, SVG) and the bitmap fallback for browsers that reject the
 * options form of createImageBitmap.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchImageBlob, bitmapFromBlob } from './imageFetch';

/** A Response-shaped stub: only the members fetchImageBlob reads. `blob` is a spy so a test can prove the body was never read. */
const response = (init: { ok?: boolean; status?: number; type?: string | null; body?: string }) => ({
  ok: init.ok ?? true,
  status: init.status ?? 200,
  headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? (init.type === undefined ? 'image/jpeg' : init.type) : null) },
  blob: vi.fn(async () => new Blob([init.body ?? 'binary'], { type: init.type ?? 'image/jpeg' })),
});

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchImageBlob', () => {
  it('rejects a non-2xx before reading the body', async () => {
    const res = response({ ok: false, status: 403, type: 'application/json', body: '{"error":"expired"}' });
    fetchMock.mockResolvedValue(res);
    await expect(fetchImageBlob('https://signed.example/a.jpg')).rejects.toThrow('unreadable (HTTP 403)');
    expect(res.blob).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith('https://signed.example/a.jpg');
  });

  it('rejects a 200 whose content type is not an image, naming the type', async () => {
    const res = response({ ok: true, type: 'application/xml', body: '<Error>AccessDenied</Error>' });
    fetchMock.mockResolvedValue(res);
    await expect(fetchImageBlob('https://signed.example/a.jpg')).rejects.toThrow('not an image (application/xml)');
    expect(res.blob).not.toHaveBeenCalled();
  });

  it('a missing content type reads as "unknown"', async () => {
    fetchMock.mockResolvedValue(response({ ok: true, type: null }));
    await expect(fetchImageBlob('https://signed.example/a.jpg')).rejects.toThrow('not an image (unknown)');
  });

  it('accepts image/* with a parameter suffix and returns the blob', async () => {
    fetchMock.mockResolvedValue(response({ ok: true, type: 'image/png; charset=binary' }));
    const blob = await fetchImageBlob('https://signed.example/a.png');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png; charset=binary');
  });

  it('rejects SVG only when asked to', async () => {
    fetchMock.mockResolvedValue(response({ ok: true, type: 'image/svg+xml', body: '<svg/>' }));
    await expect(fetchImageBlob('https://signed.example/logo.svg', { rejectSvg: true })).rejects.toThrow('svg not embeddable');
    fetchMock.mockResolvedValue(response({ ok: true, type: 'image/svg+xml', body: '<svg/>' }));
    await expect(fetchImageBlob('https://signed.example/logo.svg')).resolves.toBeInstanceOf(Blob);
  });

  it('a network-level rejection propagates as-is', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(fetchImageBlob('https://signed.example/a.jpg')).rejects.toThrow('offline');
  });
});

describe('bitmapFromBlob', () => {
  const blob = new Blob(['x'], { type: 'image/jpeg' });
  const bitmap = { width: 4, height: 3, close: vi.fn() };

  it('asks for EXIF-corrected orientation', async () => {
    const cib = vi.fn(async () => bitmap);
    vi.stubGlobal('createImageBitmap', cib);
    await expect(bitmapFromBlob(blob)).resolves.toBe(bitmap);
    expect(cib).toHaveBeenCalledTimes(1);
    expect(cib).toHaveBeenCalledWith(blob, { imageOrientation: 'from-image' });
  });

  it('falls back to the plain call when the options form is rejected (older Safari)', async () => {
    const cib = vi.fn()
      .mockRejectedValueOnce(new TypeError('imageOrientation is not a valid enum value'))
      .mockResolvedValueOnce(bitmap);
    vi.stubGlobal('createImageBitmap', cib);
    await expect(bitmapFromBlob(blob)).resolves.toBe(bitmap);
    expect(cib).toHaveBeenCalledTimes(2);
    expect(cib.mock.calls[1]).toEqual([blob]);
  });

  it('a blob that cannot be decoded rejects from both forms', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new DOMException('decode', 'InvalidStateError')));
    await expect(bitmapFromBlob(blob)).rejects.toThrow('decode');
  });

  it('rejects, rather than hangs, when createImageBitmap does not exist at all', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    await expect(bitmapFromBlob(blob)).rejects.toThrow();
  });
});
```

Run: `npm run test -- src/lib/imageFetch.test.ts`
Expected: `FAIL  src/lib/imageFetch.test.ts` with `Error: Failed to resolve import "./imageFetch"` (the module does not exist yet).

- [x] **Step 2: Implementation**

```ts
// src/lib/imageFetch.ts
/**
 * The one way the browser fetches an image it means to EMBED (report PDF photos and logo, evidence
 * pack photos).
 *
 * `fetch` only rejects on a NETWORK failure: a 403 from an expired signed URL, a 404 or a 5xx all
 * RESOLVE, and their JSON/XML error body would otherwise be decoded as an image — or, worse, base64'd
 * into a data URL and handed to pdfmake, which fails the whole export over one bad photo. Status and
 * content type are therefore checked before the body is read at all. Callers decide what a refusal
 * means (skip the photo, print the org name instead of the logo); this module only refuses.
 */

export interface FetchImageOptions {
  /** pdfmake embeds PNG and JPEG only; a caller that feeds pdfmake directly rejects SVG here. */
  rejectSvg?: boolean;
}

/**
 * Resolves the image body as a Blob (its `type` carries the response's content type, so a caller
 * that needs png-vs-jpg reads `blob.type`). Throws:
 *   `unreadable (HTTP <n>)`   — non-2xx; the body is never read
 *   `not an image (<type>)`   — content type does not start with image/ ("unknown" when absent)
 *   `svg not embeddable`      — image/svg+xml with `rejectSvg`
 */
export async function fetchImageBlob(signedUrl: string, opts: FetchImageOptions = {}): Promise<Blob> {
  const res = await fetch(signedUrl);
  if (!res.ok) throw new Error(`unreadable (HTTP ${res.status})`);
  const raw = res.headers.get('content-type') ?? '';
  const type = raw.split(';')[0].trim().toLowerCase();
  if (!type.startsWith('image/')) throw new Error(`not an image (${type || 'unknown'})`);
  if (opts.rejectSvg && type === 'image/svg+xml') throw new Error('svg not embeddable');
  return res.blob();
}

/**
 * Decodes a blob to an ImageBitmap with EXIF orientation applied, so a portrait phone photo is not
 * embedded sideways. Older Safari rejects the options form with a TypeError; it gets the plain call
 * (and its own orientation handling). A blob that cannot be decoded rejects from both forms.
 */
export async function bitmapFromBlob(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    return createImageBitmap(blob);
  }
}
```

Run: `npm run test -- src/lib/imageFetch.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  10 passed (10)`.

- [x] **Step 3: Gate and commit**

```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E 'src/lib/imageFetch' ; echo "(nothing above = clean)"
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c 'error TS'   # ≤ 46
git add src/lib/imageFetch.ts src/lib/imageFetch.test.ts && git commit -m "One guarded image fetch for everything the app embeds

fetchImageBlob refuses a non-2xx, a non-image content type and (on request) SVG before the body is
read; bitmapFromBlob decodes with EXIF orientation and falls back to the plain call on older Safari.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Evidence pack reads through the helper (no behaviour change)

**Files:**
- Modify: `src/lib/evidencePackData.ts` (`downscaleToDataUrl` :86-103, `PhotoCollector.fetchOne` :150-170, import block :14-18)
- Test (unchanged, must stay green): `src/lib/evidencePackData.test.ts`

- [x] **Step 1: Confirm the existing tests are the failing-first contract.** The evidence pack already has the status/content-type checks inline (`fetchOne` :159-165) and its tests already pin them (`PhotoCollector.run — an unusable response is not a photo`). This task moves the checks into the shared helper; the tests are the regression net. Run them first so you know the baseline:

```bash
npm run test -- src/lib/evidencePackData.test.ts
```
Expected: `Tests  13 passed (13)`.

- [x] **Step 2: The diff.** Apply exactly this (context lines are the current file):

```diff
--- a/src/lib/evidencePackData.ts
+++ b/src/lib/evidencePackData.ts
@@
 import { supabase } from '@/integrations/supabase/client';
 import { resolveStorageUrl } from '@/integrations/supabase/storage';
+import { bitmapFromBlob, fetchImageBlob } from '@/lib/imageFetch';
 import { slaState } from '@/lib/slaState';
 import type { EmbeddedPhoto } from '@/lib/fortressReportDoc';
 import { PACK_PHOTO_CAP, type AssetPack, type EvidencePack, type IssuePack, type PackMeta, type TaskPack } from '@/lib/evidencePack';
@@
 async function downscaleToDataUrl(blob: Blob): Promise<string> {
   try {
-    const bmp = await createImageBitmap(blob);
+    const bmp = await bitmapFromBlob(blob);
     const scale = Math.min(1, PHOTO_MAX_DIM / Math.max(bmp.width, bmp.height));
@@
   /**
-   * One photo, or null when it cannot be used. `fetch` only rejects on a NETWORK failure: a 403
-   * from an expired signed URL, a 404 or a 5xx all RESOLVE, and their JSON/XML error body would
-   * otherwise be zipped as `photos/01.jpg` and handed to pdfmake as an image. The status and the
-   * content type are therefore checked before the body is read at all.
+   * One photo, or null when it cannot be used. A 403 from an expired signed URL, a 404, a 5xx or a
+   * non-image body would otherwise be zipped as `photos/01.jpg` and handed to pdfmake as an image;
+   * `fetchImageBlob` refuses all of those before the body is read (see src/lib/imageFetch.ts).
    */
   private async fetchOne(req: PhotoRequest): Promise<FetchedPhoto | null> {
     try {
       const signed = await resolveStorageUrl(req.storedUrl);
       if (!signed) throw new Error('could not sign');
-      const res = await fetch(signed);
-      if (!res.ok) throw new Error(`unreadable (HTTP ${res.status})`);
-      const type = res.headers.get('content-type') ?? '';
-      if (!type.startsWith('image/')) throw new Error(`unreadable (content-type ${type || 'unknown'})`);
-      const blob = await res.blob();
-      return { blob, dataUrl: await downscaleToDataUrl(blob), ext: type.startsWith('image/png') ? 'png' : 'jpg' };
+      const blob = await fetchImageBlob(signed);
+      return { blob, dataUrl: await downscaleToDataUrl(blob), ext: blob.type.startsWith('image/png') ? 'png' : 'jpg' };
     } catch {
       return null;
     }
   }
```

What deliberately does NOT change: the `blobToDataUrl` FileReader fallback inside `downscaleToDataUrl` stays. The pack's contract is "a fetched image is always embedded, downscaled when the browser can decode it" and its tests rely on that (`vi.stubGlobal('createImageBitmap', undefined)` in the good-path cases expects a `data:` URL). The PDF module makes the opposite choice in Task 3, and says why.

- [x] **Step 3: Tests still green, gate, commit**

```bash
npm run test -- src/lib/evidencePackData.test.ts      # Tests  13 passed (13)
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E 'src/lib/evidencePackData' ; echo "(nothing above = clean)"
git add src/lib/evidencePackData.ts && git commit -m "Evidence pack photos fetch through imageFetch

Same refusals as before (status, content type), now from the shared helper; the bitmap decode
gains EXIF orientation. The FileReader fallback stays — the pack embeds every fetched image.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Report PDF — a bad photo or logo never fails the export

**Files:**
- Modify: `src/lib/fortressReportPdf.ts` (imports :10-21, `embedPhoto` / `downscaleToDataUrl` / `blobToDataUrl` :44-82, logo :150-156)
- Modify: `src/lib/fortressReportDoc.ts` (`photoRows` :661-678)
- Modify: `src/lib/fortressReportPdf.test.ts` (append a `describe`; add one import)
- Modify: `src/lib/fortressReportDoc.test.ts` (append one `it` inside `describe('buildReportDoc — annual_inspection')`)

The existing `fortressReportPdf.test.ts` already mocks `pdfmake/build/pdfmake` (records every doc passed to `createPdf`), `@/integrations/supabase/client` (a recording PostgREST chain driven by `state.result(table, calls)`), `@/integrations/supabase/storage` (`resolveStorageUrl` → `null`), `@/lib/analytics` and `@/integrations/supabase/insight-linker`. The new block reuses all of it and only adds a stubbed global `fetch`; that is the mocking style to follow.

- [x] **Step 1: Failing tests.** In `src/lib/fortressReportPdf.test.ts`, change the first line to import `afterEach` and the `MockInstance` type too, add one import after the existing `reportError` import, and append the describe block at the end of the file. (Test files are inside `tsconfig.app.json`'s `include`, so they count toward the typecheck baseline — keep them type-clean.)

```ts
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
```
```ts
import { resolveStorageUrl } from '@/integrations/supabase/storage';
```
```ts
describe('generateReportPdf — a bad photo or logo is skipped, never allowed to fail the export', () => {
  const annualReport = { id: 'rep2', building_id: 'b1', report_type: 'annual_inspection', report_period: '2025-12-01', title: 'Annual', status: 'draft', asset_manager: null, ops_manager: null, centre_manager: null, prepared_for: null };
  /** One template item with one photo on file. */
  const annualTables = (table: string): QueryResult => {
    if (table === 'reports') return { data: annualReport, error: null };
    if (table === 'building_inspections') return { data: [{ id: 'i1', template_id: 't1' }], error: null };
    if (table === 'inspection_responses') {
      return { data: [{ template_item_id: 'it1', condition_rating: 'fair', recommendation: null, comment: null, capex_estimate: null, applicable: true, detail: null,
        photo_urls: [{ ref: '1.1', caption: 'Gutters', path: 'documents/b1/annual/1/a.jpg' }] }], error: null };
    }
    if (table === 'inspection_template_items') return { data: [{ id: 'it1', section_no: '1', section_title: 'ROOF', item_label: 'Gutters', sort_order: 1, field_set: 'generic' }], error: null };
    return { data: [], error: null };
  };
  /** A Response-shaped stub: only the members fetchImageBlob reads. */
  const response = (init: { ok?: boolean; status?: number; type?: string; body?: string }) => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? (init.type ?? null) : null) },
    blob: async () => new Blob([init.body ?? 'binary'], { type: init.type ?? 'image/jpeg' }),
  });
  const fetchMock = vi.fn();
  let warn: MockInstance;

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    // Every stored path signs to a URL the fetch mock can recognise.
    vi.mocked(resolveStorageUrl).mockImplementation(async (s) => `signed:${s}`);
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    state.result = annualTables;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(resolveStorageUrl).mockImplementation(async () => null);
    warn.mockRestore();
  });

  it('a 403 JSON body for a photo is skipped, counted as not embedded, and the PDF still renders', async () => {
    fetchMock.mockResolvedValue(response({ ok: false, status: 403, type: 'application/json', body: '{"error":"expired"}' }));
    const out = await generateReportPdf('rep2', { name: 'Org', primaryColor: '#2563eb' });
    expect(out.fileName).toBe('Annual.pdf');
    expect(pdf.docs).toHaveLength(1);
    const content = JSON.stringify(pdf.docs[0].content);
    expect(content).not.toContain('"image"');
    expect(content).toContain('1 of 1 photos on file are not embedded in this PDF');
    expect(content).toContain('Gutters');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('signed:/object/tenant-documents/documents/b1/annual/1/a.jpg');
    expect(warn).toHaveBeenCalledWith('report photo skipped:', 'documents/b1/annual/1/a.jpg', 'unreadable (HTTP 403)');
  });

  it('a 200 that is not an image is skipped the same way, and no FileReader fallback base64s the body', async () => {
    fetchMock.mockResolvedValue(response({ ok: true, type: 'application/xml', body: '<Error>AccessDenied</Error>' }));
    await generateReportPdf('rep2', { name: 'Org', primaryColor: '#2563eb' });
    expect(JSON.stringify(pdf.docs[0].content)).not.toContain('"image"');
    expect(warn).toHaveBeenCalledWith('report photo skipped:', 'documents/b1/annual/1/a.jpg', 'not an image (application/xml)');
  });

  it('a readable photo is decoded with EXIF orientation, downscaled on a canvas and embedded', async () => {
    fetchMock.mockResolvedValue(response({ ok: true, type: 'image/jpeg' }));
    const bitmap = { width: 2200, height: 1100, close: vi.fn() };
    // Typed parameters so `mock.calls[0][1]` below is not indexing an empty tuple.
    const cib = vi.fn(async (_blob: Blob, _opts?: ImageBitmapOptions) => bitmap);
    vi.stubGlobal('createImageBitmap', cib);
    const ctx = { drawImage: vi.fn() };
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
    const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,AAAA');
    try {
      await generateReportPdf('rep2', { name: 'Org', primaryColor: '#2563eb' });
      expect(cib.mock.calls[0][1]).toEqual({ imageOrientation: 'from-image' });
      expect(ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 1100, 550);
      expect(toDataURL).toHaveBeenCalledWith('image/jpeg', 0.62);
      const content = JSON.stringify(pdf.docs[0].content);
      expect(content).toContain('"image":"data:image/jpeg;base64,AAAA"');
      expect(content).not.toContain('photos on file are not embedded');
      expect(bitmap.close).toHaveBeenCalled();
    } finally {
      getContext.mockRestore();
      toDataURL.mockRestore();
    }
  });

  it('a readable photo the browser cannot decode is skipped, not base64d whole', async () => {
    fetchMock.mockResolvedValue(response({ ok: true, type: 'image/jpeg' }));
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new DOMException('decode', 'InvalidStateError')));
    await generateReportPdf('rep2', { name: 'Org', primaryColor: '#2563eb' });
    const content = JSON.stringify(pdf.docs[0].content);
    expect(content).not.toContain('"image"');
    expect(content).toContain('1 of 1 photos on file are not embedded in this PDF');
  });

  it('an SVG logo is skipped with a DEV warning and the org name prints instead', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === 'signed:https://cdn.example/logo.svg'
        ? response({ ok: true, type: 'image/svg+xml', body: '<svg/>' })
        : response({ ok: false, status: 404, type: 'text/html' }));
    await generateReportPdf('rep2', { name: 'Fortress', primaryColor: '#2563eb', logoUrl: 'https://cdn.example/logo.svg' });
    const content = JSON.stringify(pdf.docs[0].content);
    expect(content).not.toContain('"image"');
    expect(content).toContain('"text":"Fortress"');
    expect(warn).toHaveBeenCalledWith('report logo skipped:', 'svg not embeddable');
  });

  it('a PNG logo is embedded as-is (no canvas pass) after the same checks', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === 'signed:https://cdn.example/logo.png'
        ? response({ ok: true, type: 'image/png', body: 'png-bytes' })
        : response({ ok: false, status: 404, type: 'text/html' }));
    await generateReportPdf('rep2', { name: 'Fortress', primaryColor: '#2563eb', logoUrl: 'https://cdn.example/logo.png' });
    const content = JSON.stringify(pdf.docs[0].content);
    expect(content).toContain('"image":"data:image/png;base64,');
    expect(warn).not.toHaveBeenCalledWith('report logo skipped:', expect.anything());
  });

  it('a logo whose signed URL answers 403 is skipped with the status in the warning', async () => {
    fetchMock.mockResolvedValue(response({ ok: false, status: 403, type: 'application/json' }));
    await generateReportPdf('rep2', { name: 'Fortress', primaryColor: '#2563eb', logoUrl: 'https://cdn.example/logo.png' });
    expect(JSON.stringify(pdf.docs[0].content)).not.toContain('"image"');
    expect(warn).toHaveBeenCalledWith('report logo skipped:', 'unreadable (HTTP 403)');
  });
});
```

In `src/lib/fortressReportDoc.test.ts`, inside `describe('buildReportDoc — annual_inspection', …)` after its last `it`, append:

```ts
  it('a photo without a data URL keeps its caption but never becomes a pdfmake image', () => {
    const doc = buildReportDoc(
      { title: 'Annual — Test', report_period: '2025-12-01', report_type: 'annual_inspection', managers: [] },
      { annualSections: [{ title: 'Roof', items: [{ label: 'Gutters', rating: 'fair', applicable: true, photos: [{ dataUrl: '', caption: 'missing one' }, { dataUrl: PHOTO, caption: 'present one' }] }] }], capex: [] },
      { color: '#2563eb', orgName: 'Org' },
    );
    const { images, text } = collect(doc);
    expect(images).toEqual([PHOTO]);
    expect(text).toContain('missing one');
    expect(text).toContain('present one');
  });
```

Run: `npm run test -- src/lib/fortressReportPdf.test.ts src/lib/fortressReportDoc.test.ts`
Expected: the doc test fails with `expected [ '', 'data:image/jpeg;base64,AAAA' ] to deeply equal [ 'data:image/jpeg;base64,AAAA' ]`; in the PDF file the 403-photo, XML-photo, SVG-logo and 403-logo cases all fail on `not.toContain('"image"')` (today `embedPhoto`'s `blobToDataUrl` fallback base64s the error body, and the logo path base64s whatever it gets), the "readable photo" case fails on `expect(cib.mock.calls[0][1]).toEqual({ imageOrientation: 'from-image' })` (called with one argument today), the "cannot decode" case fails on `not.toContain('"image"')` (the fallback embeds the raw JPEG bytes), and the PNG-logo case passes.

- [x] **Step 2: `fortressReportPdf.ts`.** Add the import after the `resolveStorageUrl` import (line 12):

```ts
import { bitmapFromBlob, fetchImageBlob } from '@/lib/imageFetch';
```

Replace lines 44–82 (`embedPhoto`, `downscaleToDataUrl`, `blobToDataUrl`) with:

```ts
/**
 * Resolve a stored photo path to a downscaled JPEG data URL (browser only). Null on ANY failure —
 * a bad photo is skipped and counted under "not embedded" (annualPhotosOmitted), never allowed to
 * fail the export, and never handed to pdfmake as a base64'd error body. There is deliberately no
 * FileReader fallback here: if the browser cannot decode it, pdfmake cannot either.
 */
async function embedPhoto(path: string): Promise<string | null> {
  try {
    const signed = await resolveStorageUrl('/object/tenant-documents/' + path);
    if (!signed) return null;
    const blob = await fetchImageBlob(signed);
    return await downscaleToDataUrl(blob);
  } catch (e) {
    if (import.meta.env.DEV) console.warn('report photo skipped:', path, (e as Error)?.message ?? String(e));
    return null;
  }
}

async function downscaleToDataUrl(blob: Blob): Promise<string> {
  const bmp = await bitmapFromBlob(blob);
  const scale = Math.min(1, PHOTO_MAX_DIM / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d ctx');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return canvas.toDataURL('image/jpeg', PHOTO_QUALITY);
}

/**
 * LOGO ONLY. The logo is embedded as-is (pdfmake fits it to 130×40; no canvas pass, so a PNG keeps
 * its transparency). It is safe only because fetchImageBlob has already refused a non-2xx, a
 * non-image and an SVG before this reads the body. Photos never come through here.
 */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
```

Replace the logo block (lines 150–156) with:

```ts
  let logoDataUrl: string | null = null;
  if (branding.logoUrl) {
    try {
      const signed = await resolveStorageUrl(branding.logoUrl);
      // pdfmake embeds PNG and JPEG only: an SVG logo (accepted by Settings before S2) is skipped
      // and the org name prints in its place, exactly as when no logo is set.
      if (signed) logoDataUrl = await blobToDataUrl(await fetchImageBlob(signed, { rejectSvg: true }));
    } catch (e) {
      if (import.meta.env.DEV) console.warn('report logo skipped:', (e as Error)?.message ?? String(e));
    }
  }
```

Decision recorded: `blobToDataUrl` is kept for the logo only. Reason: the logo must not go through the JPEG canvas pass (it would lose PNG transparency and get re-encoded at 0.62), and the helper's checks make the FileReader read safe. The photo path no longer references it.

- [x] **Step 3: `fortressReportDoc.ts`.** In `photoRows` (line 661), replace the `stack` with:

```ts
        stack: [
          // A photo that could not be fetched has no data URL (same rule as the evidence pack's
          // photoGrid): never hand pdfmake an empty image; the caption still marks its place.
          ...(p.dataUrl ? [{ image: p.dataUrl, fit: [PHOTO_W, PHOTO_W * 0.75] } as Content] : []),
          ...(p.caption ? [{ text: p.caption, fontSize: 7, color: '#6b7280', width: PHOTO_W } as Content] : []),
        ],
```

The logo is already truthiness-guarded at :178 (`opts.logoDataUrl ? { image: … } : { text: opts.orgName … }`) and :186; with Task 3's PDF module setting `logoDataUrl` to `null` on every failure, no change is needed there — read both lines and confirm.

Run: `npm run test -- src/lib/fortressReportPdf.test.ts src/lib/fortressReportDoc.test.ts`
Expected: both files pass; the PDF file reports `Tests  15 passed (15)` (8 existing + 7 new).

- [x] **Step 4: Gate and commit**

```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E 'src/lib/fortressReport(Pdf|Doc)' ; echo "(nothing above = clean)"
npm run test -- src/lib/fortressReport src/lib/evidencePack      # every fortress PDF/doc/pack test green
git add src/lib/fortressReportPdf.ts src/lib/fortressReportDoc.ts src/lib/fortressReportPdf.test.ts src/lib/fortressReportDoc.test.ts && git commit -m "Report PDF: a bad photo or logo is skipped, never embedded

embedPhoto fetches through imageFetch and returns null on any failure; the FileReader fallback is
gone from the photo path and kept for the logo only, behind the same status/content-type checks
plus an SVG rejection with a DEV warning. photoRows never emits an image for an empty data URL.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Settings — no more SVG logos

**Files:**
- Modify: `src/pages/Settings.tsx` (`handleLogoUpload` validTypes/toast :109-114, `<input accept>` :295, helper copy :313)
- Create: `src/pages/Settings.test.tsx` (no Settings test exists; this is a focused render test of the logo control)

- [x] **Step 1: Failing test**

```tsx
// src/pages/Settings.test.tsx
/**
 * The logo control on the Branding tab. SVG used to be accepted and recommended, but pdfmake cannot
 * embed it, so every report PDF silently printed without the logo (Task 3 now skips it with a
 * warning). Settings must stop offering it and say why.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
// Typed parameters so `upload.mock.calls[0][0]` below is not indexing an empty tuple.
const storage = vi.hoisted(() => ({
  upload: vi.fn(async (_path: string, _file: File, _opts?: { upsert?: boolean }) => ({ error: null as { message: string } | null })),
}));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isAdmin: true, isAdminOrManager: true, user: { id: 'u1' } }) }));
vi.mock('@/hooks/useOrganization', () => ({
  useOrganization: () => ({ organization: { id: 'o1', name: 'Fortress', email: 'ops@example.com', logo_url: null, primary_color: '#2563eb' }, loading: false }),
}));
vi.mock('@/hooks/useOrgSettings', () => ({ useFeature: () => false }));
vi.mock('@/components/settings/SlaSettingsCard', () => ({ SlaSettingsCard: () => null }));
vi.mock('@/components/settings/ReportDueDayCard', () => ({ ReportDueDayCard: () => null }));
vi.mock('@/components/settings/FeatureFlagsCard', () => ({ FeatureFlagsCard: () => null }));
vi.mock('@/components/settings/ReportDistributionCard', () => ({ ReportDistributionCard: () => null }));
vi.mock('@/components/settings/FormsAdminCard', () => ({ FormsAdminCard: () => null }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    storage: { from: () => ({ upload: storage.upload, getPublicUrl: (p: string) => ({ data: { publicUrl: `https://x/${p}` } }) }) },
    from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }),
  },
}));

import Settings from './Settings';

const HELPER = 'Recommended: 200x200px, PNG or JPEG. SVG logos cannot be printed into PDF reports.';
const REJECTED = 'Please upload a PNG, JPEG, or WebP image. SVG logos cannot be printed into PDF reports.';

/** Radix Tabs activate on mouse-down, not click. */
const openBranding = () => fireEvent.mouseDown(screen.getByRole('tab', { name: /branding/i }), { button: 0 });
const logoInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;

beforeEach(() => {
  toast.success.mockClear();
  toast.error.mockClear();
  storage.upload.mockClear();
});

describe('Settings — logo upload', () => {
  it('recommends PNG or JPEG, says SVG cannot print, and does not accept SVG in the picker', () => {
    render(<MemoryRouter><Settings /></MemoryRouter>);
    openBranding();
    expect(screen.getByText(HELPER)).toBeInTheDocument();
    expect(screen.queryByText(/PNG or SVG/)).not.toBeInTheDocument();
    expect(logoInput()).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp');
  });

  it('refuses an SVG file with the same explanation and never uploads it', async () => {
    render(<MemoryRouter><Settings /></MemoryRouter>);
    openBranding();
    fireEvent.change(logoInput(), { target: { files: [new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })] } });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(REJECTED));
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('still uploads a PNG', async () => {
    render(<MemoryRouter><Settings /></MemoryRouter>);
    openBranding();
    fireEvent.change(logoInput(), { target: { files: [new File(['png'], 'logo.png', { type: 'image/png' })] } });
    await waitFor(() => expect(storage.upload).toHaveBeenCalledTimes(1));
    expect(storage.upload.mock.calls[0][0]).toMatch(/^logos\/org-logo-\d+\.png$/);
    expect(toast.success).toHaveBeenCalledWith('Logo uploaded and saved successfully');
  });
});
```

Run: `npm run test -- src/pages/Settings.test.tsx`
Expected: `FAIL` — first test: `Unable to find an element with the text: Recommended: 200x200px, PNG or JPEG. SVG logos cannot be printed into PDF reports.`; second test: `expected "error" to be called with arguments: [ 'Please upload a PNG, JPEG, or WebP image. SVG logos …' ]` (the SVG is accepted today, so `upload` IS called); third passes.

- [x] **Step 2: Implementation.** Three edits in `src/pages/Settings.tsx`.

Lines 109–114 become:

```ts
    // Validate file type. SVG is out: pdfmake cannot embed it, so an SVG logo never reaches a
    // report PDF (the exporter skips it and prints the org name). Existing SVG logos keep
    // working in the app header; they are simply not printed.
    const validTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      toast.error('Please upload a PNG, JPEG, or WebP image. SVG logos cannot be printed into PDF reports.');
      return;
    }
```

Line 295 (`accept=`) becomes:

```tsx
                        accept="image/png,image/jpeg,image/webp"
```

Lines 312–314 (the helper `<p>`) become:

```tsx
                    {/* Constraint, not coaching: stays visible with hints off. */}
                    <p className="text-sm text-muted-foreground">
                      Recommended: 200x200px, PNG or JPEG. SVG logos cannot be printed into PDF reports.
                    </p>
```

Run: `npm run test -- src/pages/Settings.test.tsx`
Expected: `Tests  3 passed (3)`.

- [x] **Step 3: Gate and commit**

```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E 'src/pages/Settings' ; echo "(nothing above = clean)"
git add src/pages/Settings.tsx src/pages/Settings.test.tsx && git commit -m "Settings: stop offering SVG logos

pdfmake cannot embed SVG, so the picker drops it, the rejection toast and the helper copy say
why, and PNG or JPEG is recommended. Existing SVG logos still show in the app.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `PhotoCapture` — refuse a 40 MB+ source before decoding it

**Files:**
- Modify: `src/components/ui/photo-capture.tsx` (a new exported constant after the `heic2any` import :10; the top of `validateAndProcessFile` :228)
- Create: `src/components/ui/photo-capture.test.tsx` (none exists)

**What the test relies on from `src/test/setup.ts`:** the jsdom environment (`vitest.config.ts`), `@testing-library/jest-dom` matchers, the `window.matchMedia` stub (irrelevant here because `useIsMobile` is mocked), the `VITE_SUPABASE_*` env stubs (irrelevant — the Supabase client is never imported because every hook that would import it is mocked). setup.ts provides **no canvas, no `Image` loading and no `URL.createObjectURL`**. jsdom without the `canvas` package never fires `img.onload`, so any test that let `compressImage` run would hang. The tests therefore render with `enableCompression={false}` and `caption={{ time: false }}`, which makes `captionOn` false and `compressImage` return the file untouched (:150-152) — the HEIC detection, the size gate and the accept path are all reachable without a canvas. `URL.createObjectURL` is defined on `URL` in the test the way `src/lib/exportCsv.test.ts` does it.

- [x] **Step 1: Failing test**

```tsx
// src/components/ui/photo-capture.test.tsx
/**
 * PhotoCapture's validate-and-process path: HEIC detection by extension when the browser sets no
 * MIME type, the 40 MB source gate (before HEIC conversion or any canvas work), and the plain
 * accept path. Compression and the caption are switched off through props so nothing here
 * needs a canvas or image decoding, which jsdom does not provide (see src/test/setup.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
// Typed parameter so `heic2any.mock.calls[0][0]` below is not indexing an empty tuple.
const heic2any = vi.hoisted(() =>
  vi.fn(async (_opts: { blob: Blob; toType?: string; quality?: number }) => new Blob(['jpeg-bytes'], { type: 'image/jpeg' })));
vi.mock('sonner', () => ({ toast }));
vi.mock('heic2any', () => ({ default: heic2any }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/hooks/useGeotagPreference', () => ({ useGeotagPreference: () => false }));
vi.mock('@/hooks/useGeotag', () => ({ useGeotag: () => ({ position: null }) }));
vi.mock('@/hooks/useHints', () => ({ useHints: () => ({ hintsEnabled: true, setHintsEnabled: vi.fn() }) }));

import { PhotoCapture, MAX_SOURCE_BYTES, type PhotoFile } from './photo-capture';

const createObjectURL = vi.fn((_blob: Blob) => 'blob:preview');

/** The gallery input is the second hidden file input (the first is the camera one). */
function renderCapture() {
  const onPhotosChange = vi.fn<(photos: PhotoFile[]) => void>();
  const { container } = render(
    <PhotoCapture photos={[]} onPhotosChange={onPhotosChange} enableCompression={false} caption={{ time: false }} />,
  );
  const input = container.querySelectorAll('input[type="file"]')[1] as HTMLInputElement;
  const pick = (file: File) => fireEvent.change(input, { target: { files: [file] } });
  return { onPhotosChange, pick };
}

/** A File whose reported size is `bytes` without allocating that much memory. */
function fileOfSize(name: string, type: string, bytes: number): File {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: bytes });
  return f;
}

beforeEach(() => {
  toast.error.mockClear(); toast.warning.mockClear();
  heic2any.mockClear();
  createObjectURL.mockClear();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: createObjectURL });
});

describe('PhotoCapture', () => {
  it('treats a .heic file with an empty MIME type as HEIC and converts it to JPEG', async () => {
    const { onPhotosChange, pick } = renderCapture();
    pick(new File(['heic-bytes'], 'IMG_0001.HEIC', { type: '' }));
    await waitFor(() => expect(onPhotosChange).toHaveBeenCalledTimes(1));
    expect(heic2any).toHaveBeenCalledTimes(1);
    expect(heic2any.mock.calls[0][0]).toMatchObject({ toType: 'image/jpeg', quality: 0.9 });
    const [photos] = onPhotosChange.mock.calls[0];
    expect(photos).toHaveLength(1);
    expect(photos[0].file.name).toBe('IMG_0001.jpg');
    expect(photos[0].file.type).toBe('image/jpeg');
    expect(photos[0].preview).toBe('blob:preview');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('refuses a source larger than 40 MB before HEIC conversion or any decoding', async () => {
    const { onPhotosChange, pick } = renderCapture();
    pick(fileOfSize('huge.heic', '', MAX_SOURCE_BYTES + 1));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith("huge.heic is larger than 40 MB and can't be processed on this device. Take the photo with the camera instead.");
    expect(heic2any).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(onPhotosChange).not.toHaveBeenCalled();
  });

  it('exactly 40 MB is still accepted', async () => {
    const { onPhotosChange, pick } = renderCapture();
    pick(fileOfSize('edge.jpg', 'image/jpeg', MAX_SOURCE_BYTES));
    await waitFor(() => expect(onPhotosChange).toHaveBeenCalledTimes(1));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('an accepted JPEG produces exactly one PhotoFile with a preview URL', async () => {
    const { onPhotosChange, pick } = renderCapture();
    const jpeg = new File(['jpeg-bytes'], 'site.jpg', { type: 'image/jpeg' });
    pick(jpeg);
    await waitFor(() => expect(onPhotosChange).toHaveBeenCalledTimes(1));
    const [photos] = onPhotosChange.mock.calls[0];
    expect(photos).toEqual([{ file: jpeg, preview: 'blob:preview' }]);
    expect(createObjectURL).toHaveBeenCalledWith(jpeg);
    expect(heic2any).not.toHaveBeenCalled();
  });

  it('a non-image is refused by name', async () => {
    const { onPhotosChange, pick } = renderCapture();
    pick(new File(['%PDF'], 'scan.pdf', { type: 'application/pdf' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('scan.pdf is not a supported image format'));
    expect(onPhotosChange).not.toHaveBeenCalled();
  });
});
```

Run: `npm run test -- src/components/ui/photo-capture.test.tsx`
Expected: `FAIL` — `SyntaxError: The requested module './photo-capture' does not provide an export named 'MAX_SOURCE_BYTES'` (every test in the file errors on the import).

- [x] **Step 2: Implementation.** In `src/components/ui/photo-capture.tsx`, after `import heic2any from 'heic2any';` (line 10) add:

```ts
/**
 * Source files above this are refused before HEIC conversion or any canvas work. Decoding a 40 MB+
 * image on a phone can take the tab down (heic2any inflates it to a raw bitmap first), and nothing
 * a phone camera produces is that large — it is a screenshot of a scan, a RAW export, or a mistake.
 */
export const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
```

At the top of `validateAndProcessFile` (line 228, before `// Validate file type (including HEIC)`) add:

```ts
    // Size gate FIRST: the type check below is cheap, but everything after it decodes the file.
    if (file.size > MAX_SOURCE_BYTES) {
      toast.error(`${file.name} is larger than 40 MB and can't be processed on this device. Take the photo with the camera instead.`);
      return null;
    }
```

(`SinglePhotoCapture` — avatars and logos, 2 MB post-processing cap — is not gated; the spec names `PhotoCapture` only. Files are still processed one at a time in `handleFilesSelected`, unchanged.)

Run: `npm run test -- src/components/ui/photo-capture.test.tsx`
Expected: `Tests  5 passed (5)`.

- [x] **Step 3: Gate and commit**

```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E 'src/components/ui/photo-capture' ; echo "(nothing above = clean)"
npm run test -- src/components/ui/photo-capture src/pages/NewIssue src/components/checklists/CompleteTaskDialog    # PhotoCapture consumers still green
git add src/components/ui/photo-capture.tsx src/components/ui/photo-capture.test.tsx && git commit -m "PhotoCapture: refuse a 40 MB+ source before decoding it

MAX_SOURCE_BYTES is checked ahead of HEIC conversion and canvas work; the toast names the limit
and points at the camera. First tests for the component: HEIC by extension with an empty MIME,
the gate, and the accept path.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Migration — `append_inspection_photo` + live smoke assertions

**Files:**
- Create: `../GMI/sql/2026-09-15_02_inspection_photo_append.sql` (then `npm run schema:vendor` → `supabase/schema/2026-09-15_02_inspection_photo_append.sql`)
- Modify: `scripts/rls-smoke.mjs` (append a block after `console.log('  R4c intake & forms …: done');` at :1046 — or after S1's block if it has already landed there — and before the `} catch (e) {`)
- Modify: `supabase/schema/.source` (by the vendor script)

**Why security INVOKER, and what that means for the upsert.** The client's direct `upsert` on `inspection_responses` today passes the `ir_write` policy in `supabase/schema/2026-06-13_03_fortress_inspections.sql:102-109`:

```sql
create policy ir_write on public.inspection_responses for all
    using ( exists (select 1 from public.building_inspections bi
                    where bi.id = inspection_id
                      and (is_admin_or_manager() or can_access_building(bi.building_id))) )
    with check ( exists (select 1 from public.building_inspections bi
                    where bi.id = inspection_id
                      and (is_admin_or_manager() or can_access_building(bi.building_id))) );
```

and reads pass `ir_read` (:98-101, `can_access_building(bi.building_id)`), scoped through the parent row, whose own read policy is `building_inspections_read … using ( can_access_building(building_id) )` (:84-86). An INVOKER function's `insert … on conflict do update` is evaluated as the caller: the INSERT arm is checked against `ir_write`'s `with check`, the UPDATE arm against its `using` and `with check`. A `user` with no access to the building fails `with check` and Postgres raises `42501` (`new row violates row-level security policy for table "inspection_responses"`); nothing is written. Admins and managers pass on `is_admin_or_manager()`; a field user passes on `can_access_building`. No new policy is needed and none is added. The style model for an invoker RPC with grants is `complete_task` in `supabase/schema/2026-09-12_01_r2_field.sql`.

- [x] **Step 1: Write the migration** at `../GMI/sql/2026-09-15_02_inspection_photo_append.sql`:

```sql
-- 2026-09-15_02_inspection_photo_append.sql
-- S2 "Photo pipeline hardening" (spec docs/superpowers/specs/2026-09-12-field-readiness-design.md
-- §5.3). Additive, idempotent, one transaction. Apply order: staging -> rls-smoke -> prod. iOS
-- never calls this.
--
-- append_inspection_photo(p_inspection, p_template_item, p_path, p_caption, p_section_no)
--   Upserts the (inspection, template item) response row and appends
--   {ref: '<section_no>.<n+1>', caption, path} to photo_urls in ONE statement, where n is the
--   row's current jsonb_array_length(photo_urls) (0 on the insert arm, so the first ref is
--   '<section_no>.1'). The client used to read photo_urls from its query cache, push, and upsert
--   the whole array back; two rapid adds rebuilt the list from the same stale copy and the first
--   upload was orphaned in storage. Here the append reads the row under the ON CONFLICT row lock:
--   a concurrent second call waits for the first to commit, re-reads the updated tuple, and gets
--   the next number. Refs never collide and no path is lost.
--
-- SECURITY INVOKER: the upsert passes ir_write on public.inspection_responses exactly as the
-- client's direct upsert did (2026-06-13_03_fortress_inspections.sql) —
--   using / with check ( exists (select 1 from public.building_inspections bi
--       where bi.id = inspection_id
--         and (is_admin_or_manager() or can_access_building(bi.building_id))) )
-- so a caller without access to the building gets 42501 and nothing is written. No policy change.
-- Returns the whole row so the client can put it straight into its cache.
begin;

create or replace function public.append_inspection_photo(
  p_inspection uuid, p_template_item uuid, p_path text, p_caption text, p_section_no text)
returns public.inspection_responses
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_row public.inspection_responses;
begin
  if auth.uid() is null then
    raise exception 'append_inspection_photo: sign in required' using errcode = '42501';
  end if;
  if p_inspection is null or p_template_item is null or coalesce(btrim(p_path), '') = '' then
    raise exception 'append_inspection_photo: inspection, template item and path are required' using errcode = '22023';
  end if;

  insert into public.inspection_responses as ir (id, inspection_id, template_item_id, photo_urls)
  values (gen_random_uuid(), p_inspection, p_template_item,
          jsonb_build_array(jsonb_build_object(
            'ref', coalesce(p_section_no, '') || '.1',
            'caption', p_caption,
            'path', p_path)))
  on conflict (inspection_id, template_item_id) do update
     set photo_urls = ir.photo_urls || jsonb_build_array(jsonb_build_object(
           'ref', coalesce(p_section_no, '') || '.' || (jsonb_array_length(ir.photo_urls) + 1)::text,
           'caption', p_caption,
           'path', p_path)),
         updated_at = now()
  returning ir.* into v_row;
  return v_row;
end $$;
revoke all on function public.append_inspection_photo(uuid, uuid, text, text, text) from public;
revoke execute on function public.append_inspection_photo(uuid, uuid, text, text, text) from anon;
grant execute on function public.append_inspection_photo(uuid, uuid, text, text, text) to authenticated;

commit;

-- Verify:
--   select proname, prosecdef, proconfig from pg_proc
--    where pronamespace = 'public'::regnamespace and proname = 'append_inspection_photo';
--     -- 1 row; prosecdef = false (invoker); proconfig = {search_path=}
--   select has_function_privilege('anon', 'public.append_inspection_photo(uuid,uuid,text,text,text)', 'execute');           -- false
--   select has_function_privilege('authenticated', 'public.append_inspection_photo(uuid,uuid,text,text,text)', 'execute');  -- true
--   notify pgrst, 'reload schema';
-- Then: node scripts/rls-smoke.mjs (the S2 block: anon refused, user without access 42501,
--   admin/manager two appends -> refs .1 and .2 on ONE row).
```

Notes baked in: `coalesce(p_section_no, '')` — `section_no` is nullable on the template table; the old client string-interpolated it (`"null.1"`); an empty prefix is the lesser evil and every real template item has one. `updated_at = now()` is stated even though `trg_inspection_responses_touch` would set it, because the spec names it and the row's freshness is what the client shows. A `photo_urls` that is not a JSON array (never written by this app; the default is `'[]'`) would make `jsonb_array_length` raise, which fails the call loudly rather than silently dropping the photo.

- [x] **Step 2: Verify on a throwaway Postgres 17.** Supabase's base tables are not in the vendored migrations; stand up stubs with exactly the columns the function touches, apply the real file twice (idempotent), then assert. Write both scratch files to the scratchpad, never the repo. `SCRATCH` is your session's scratchpad directory (given in your system prompt).

`$SCRATCH/s2-stub.sql`:

```sql
-- Throwaway stub of the prod surface 2026-09-15_02 depends on. Never applied anywhere real.
create extension if not exists pgcrypto;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema if not exists auth;
-- auth.uid() reads a session setting so the verify script can be "signed out" and "signed in".
create or replace function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
create table public.inspection_template_items (
  id uuid primary key default gen_random_uuid(), section_no text, item_label text);
create table public.building_inspections (
  id uuid primary key default gen_random_uuid(), building_id uuid not null);
create table public.inspection_responses (
  id               uuid primary key default gen_random_uuid(),
  inspection_id    uuid not null references public.building_inspections(id) on delete cascade,
  template_item_id uuid not null references public.inspection_template_items(id),
  acceptable       text, condition_rating text, action_required text, risk_level text,
  recommendation   text, comment text,
  photo_urls       jsonb not null default '[]'::jsonb,
  capex_estimate   numeric,
  applicable       boolean not null default true,
  next_service_due date,
  detail           jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (inspection_id, template_item_id));
```

`$SCRATCH/s2-verify.sql`:

```sql
\set ON_ERROR_STOP on
insert into public.inspection_template_items (id, section_no, item_label)
  values ('00000000-0000-0000-0000-000000000001', '7', 'Gutters');
insert into public.building_inspections (id, building_id)
  values ('00000000-0000-0000-0000-0000000000a1', gen_random_uuid());

do $$
declare
  r public.inspection_responses;
  n integer;
begin
  -- signed out: refused before any write
  perform set_config('app.uid', '', false);
  begin
    perform public.append_inspection_photo('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001',
                                           'documents/b/annual/7/one.jpg', 'Gutters', '7');
    raise exception 'signed-out call was not refused';
  exception when insufficient_privilege then null;
  end;
  select count(*) into n from public.inspection_responses;
  if n <> 0 then raise exception 'signed-out call wrote % row(s)', n; end if;

  -- signed in: first append INSERTS the row with ref 7.1
  perform set_config('app.uid', gen_random_uuid()::text, false);
  r := public.append_inspection_photo('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001',
                                      'documents/b/annual/7/one.jpg', 'Gutters', '7');
  if jsonb_array_length(r.photo_urls) <> 1
     or r.photo_urls->0->>'ref' <> '7.1'
     or r.photo_urls->0->>'caption' <> 'Gutters'
     or r.photo_urls->0->>'path' <> 'documents/b/annual/7/one.jpg' then
    raise exception 'first append wrong: %', r.photo_urls;
  end if;

  -- second append UPDATES the same row with ref 7.2, keeping the first path.
  -- (updated_at is not compared: now() is transaction-stable, so inside this DO block the
  -- default on insert and the explicit set on update are the same instant.)
  r := public.append_inspection_photo('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001',
                                      'documents/b/annual/7/two.jpg', 'Gutters', '7');
  if jsonb_array_length(r.photo_urls) <> 2
     or r.photo_urls->0->>'path' <> 'documents/b/annual/7/one.jpg'
     or r.photo_urls->1->>'ref' <> '7.2'
     or r.photo_urls->1->>'path' <> 'documents/b/annual/7/two.jpg' then
    raise exception 'second append wrong: %', r.photo_urls;
  end if;
  select count(*) into n from public.inspection_responses;
  if n <> 1 then raise exception 'expected one row after two appends, got %', n; end if;

  -- a blank path is refused
  begin
    perform public.append_inspection_photo('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001',
                                           '   ', 'x', '7');
    raise exception 'blank path was not refused';
  exception when invalid_parameter_value then null;
  end;

  -- a null section_no yields '.1', not 'null.1'
  r := public.append_inspection_photo('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001',
                                      'documents/b/annual/7/three.jpg', null, null);
  if r.photo_urls->2->>'ref' <> '.3' or (r.photo_urls->2->'caption') <> 'null'::jsonb then
    raise exception 'null handling wrong: %', r.photo_urls;
  end if;

  raise notice 'append_inspection_photo ok: signed-out refused, refs 7.1 and 7.2 on one row, blank path refused';
end $$;

select has_function_privilege('anon', 'public.append_inspection_photo(uuid,uuid,text,text,text)', 'execute') as anon_can_execute;            -- f
select has_function_privilege('authenticated', 'public.append_inspection_photo(uuid,uuid,text,text,text)', 'execute') as authenticated_can;  -- t
select 'ALL LOCAL CHECKS PASSED' as result;
```

Run (Docker is on this Mac at `~/.rd/bin/docker`; `psql` at `/opt/homebrew/bin/psql`):

```bash
docker run --rm -d --name s2-pg -e POSTGRES_PASSWORD=pg -p 55433:5432 postgres:17
until docker exec s2-pg pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
PGPASSWORD=pg psql -h localhost -p 55433 -U postgres -v ON_ERROR_STOP=1 -q -f "$SCRATCH/s2-stub.sql"
PGPASSWORD=pg psql -h localhost -p 55433 -U postgres -v ON_ERROR_STOP=1 -q -f ../GMI/sql/2026-09-15_02_inspection_photo_append.sql
PGPASSWORD=pg psql -h localhost -p 55433 -U postgres -v ON_ERROR_STOP=1 -q -f ../GMI/sql/2026-09-15_02_inspection_photo_append.sql   # idempotency: must apply twice
PGPASSWORD=pg psql -h localhost -p 55433 -U postgres -v ON_ERROR_STOP=1 -f "$SCRATCH/s2-verify.sql"
docker rm -f s2-pg
```

Expected output of the last psql: `NOTICE:  append_inspection_photo ok: signed-out refused, refs 7.1 and 7.2 on one row, blank path refused`, then `anon_can_execute | f`, `authenticated_can | t`, then `ALL LOCAL CHECKS PASSED`. If `psql` is not on PATH use `docker exec -i s2-pg psql -U postgres -v ON_ERROR_STOP=1 < file`. Fix the migration until both applies and the verify pass.

**Concurrent-safety note (record it in the commit message, no extra test):** `INSERT … ON CONFLICT DO UPDATE` takes the conflicting row's lock; under READ COMMITTED a concurrent second call blocks on that lock, then re-evaluates `ir.photo_urls` against the committed tuple, so it sees the first append and numbers itself `n+2`. Two concurrent first-ever inserts for the same `(inspection_id, template_item_id)` resolve the same way through the unique index's speculative insertion: one inserts, the other takes the UPDATE arm. The update is atomic per row; no read-modify-write window exists on the server. (The client-side window that existed — reading `photo_urls` from the query cache — is what Task 7 removes.)

- [x] **Step 3: Commit the canonical SQL in GMI, then vendor**

```bash
git -C ../GMI add sql/2026-09-15_02_inspection_photo_append.sql && git -C ../GMI commit -m "S2: append_inspection_photo — atomic per-row photo append, security invoker (2026-09-15_02)"
npm run schema:vendor
git status --short supabase/schema     # ONLY: ?? supabase/schema/2026-09-15_02_inspection_photo_append.sql and  M supabase/schema/.source
```

If `git status` shows any other vendored `.sql` as changed, GMI has drifted (or S1 vendored first and its file is uncommitted here) — stop and tell the controller; do not stage it.

- [x] **Step 4: RLS smoke assertions.** In `scripts/rls-smoke.mjs`, after the last `console.log('  … : done');` inside the `try` (today `console.log('  R4c intake & forms …: done');` at :1046) and before `} catch (e) {`, append. `svcInsert`, `rpcCall`, `assert`, `cleanup`, `personas`, `A`, `B`, `RUN`, `URL_BASE`, `SVC` all exist:

```js
  // ════ S2: append_inspection_photo — security invoker, RLS-scoped through building_inspections, atomic append ════
  {
    // A throwaway INACTIVE annual template so the fixture never becomes the app's live template on this project.
    const tpl = (await svcInsert('inspection_templates', { name: `ZZTEST-RLS-${RUN}`, cadence: 'annual', version: 1, active: false })).id;
    cleanup.push(['inspection_templates', tpl]);
    const item = (await svcInsert('inspection_template_items', { template_id: tpl, section_no: '7', section_title: 'ROOF', item_label: 'Gutters', rating_type: 'condition_scale', sort_order: 1 })).id;
    cleanup.push(['inspection_template_items', item]);
    // inspection_responses rows the calls create are removed by the cascade from building_inspections (LIFO: these go before item/tpl).
    const inspA = (await svcInsert('building_inspections', { building_id: A, template_id: tpl })).id;
    cleanup.push(['building_inspections', inspA]);
    const inspB = (await svcInsert('building_inspections', { building_id: B, template_id: tpl })).id;
    cleanup.push(['building_inspections', inspB]);
    const args = (insp, n) => ({ p_inspection: insp, p_template_item: item, p_path: `documents/${insp}/annual/7/${RUN}-${n}.jpg`, p_caption: 'Gutters', p_section_no: '7' });
    const responsesOf = async (insp) => (await (await fetch(`${URL_BASE}/rest/v1/inspection_responses?inspection_id=eq.${insp}&select=id,photo_urls`, { headers: SVC })).json());

    const anon = await rpcCall(null, 'append_inspection_photo', args(inspB, 0));
    assert('append_inspection_photo not executable by anon', anon.status === 401 || anon.status === 403, `expected HTTP 401/403, got ${anon.status}`);

    // userA is assigned to building A only: on B the with-check fails as 42501 and nothing is written.
    const denied = await rpcCall(personas.userA.jwt, 'append_inspection_photo', args(inspB, 0));
    assert('append_inspection_photo refused (42501) for a user without access to the building', !denied.ok && denied.code === '42501', `HTTP ${denied.status} ${JSON.stringify(denied.body).slice(0, 160)}`);
    assert('a refused append wrote nothing', (await responsesOf(inspB)).length === 0, 'an inspection_responses row exists after the refusal');

    const first = await rpcCall(personas.admin.jwt, 'append_inspection_photo', args(inspB, 1));
    assert('append_inspection_photo runs for admin and returns the row', first.ok && first.rows[0]?.inspection_id === inspB && first.rows[0]?.template_item_id === item, `HTTP ${first.status} ${JSON.stringify(first.body).slice(0, 160)}`);
    assert('first append inserts the row with ref 7.1', first.rows[0]?.photo_urls?.length === 1 && first.rows[0]?.photo_urls?.[0]?.ref === '7.1' && first.rows[0]?.photo_urls?.[0]?.path === args(inspB, 1).p_path, JSON.stringify(first.rows[0]?.photo_urls));
    const second = await rpcCall(personas.manager.jwt, 'append_inspection_photo', args(inspB, 2));
    assert('second append (manager) appends ref 7.2 to the SAME row and keeps the first path', second.ok && second.rows[0]?.id === first.rows[0]?.id && second.rows[0]?.photo_urls?.length === 2 && second.rows[0]?.photo_urls?.[0]?.path === args(inspB, 1).p_path && second.rows[0]?.photo_urls?.[1]?.ref === '7.2', JSON.stringify(second.rows[0]?.photo_urls));
    assert('exactly one inspection_responses row after two appends', (await responsesOf(inspB)).length === 1, `${(await responsesOf(inspB)).length} rows`);

    // Invoker, not admin-only: a field user WITH access appends on their own building.
    const own = await rpcCall(personas.userA.jwt, 'append_inspection_photo', args(inspA, 1));
    assert('append_inspection_photo runs for a user with access to the building', own.ok && own.rows[0]?.photo_urls?.[0]?.ref === '7.1', `HTTP ${own.status} ${JSON.stringify(own.body).slice(0, 160)}`);
  }
  console.log('  S2 photo append (append_inspection_photo: anon/no-access refused, refs .1/.2 on one row, invoker for field users): done');
```

`node --check scripts/rls-smoke.mjs` must print nothing.

- [x] **Step 5: Commit**

```bash
node --check scripts/rls-smoke.mjs
git add supabase/schema/2026-09-15_02_inspection_photo_append.sql supabase/schema/.source scripts/rls-smoke.mjs && git commit -m "S2: append_inspection_photo migration (vendored) + rls-smoke assertions

One-statement upsert-and-append on inspection_responses.photo_urls, security invoker so ir_write
decides; ON CONFLICT holds the row lock, so concurrent appends serialise per row and refs never
collide. Smoke: anon and a user without building access are refused (42501, nothing written);
admin then manager get refs 7.1 and 7.2 on one row; a field user with access appends on their own
building.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

**Controller after Task 6:** apply `../GMI/sql/2026-09-15_02_inspection_photo_append.sql` to staging (`vkrihpmjajjcxmzgjqdr`) through the Management API runner, run the `-- Verify:` queries, `notify pgrst, 'reload schema'`, then `node scripts/rls-smoke.mjs` against staging. Types are NOT regenerated until prod (Task 9); Task 7 casts.

---

### Task 7: `addPhoto` goes through the RPC; the hook merges the returned row

**Files:**
- Modify: `src/hooks/useInspectionSection.ts` (a named query-data type; `useQuery<InspectionSectionData>`; new `mergeResponse`; return it)
- Modify: `src/components/reports/fortress/sections/ConditionInspectionSection.tsx` (imports :14-19; `addPhoto` :40-54; destructure `inspectionId` and `mergeResponse` :34)
- Create: `src/hooks/useInspectionSection.test.ts` (none exists; Task 8 appends to it)
- Create: `src/components/reports/fortress/sections/ConditionInspectionSection.test.tsx` (none exists)

Task 8 edits the same hook and the same hook test. Run Task 8 only after this task's commit.

- [x] **Step 1: Failing tests.** Hook test first (mocking style is `src/hooks/useBuildingRoleAssignments.test.ts`: a recording PostgREST chain over `@/integrations/supabase/client`, which is what `fdb` wraps):

```ts
// src/hooks/useInspectionSection.test.ts
/**
 * useInspectionSection: the cache merge used after append_inspection_photo (Task 7) and the
 * absent-keeps / null-clears patch semantics of setResponse (Task 8).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { InspectionResponse } from '@/integrations/supabase/fortress-db';

interface RecordedCall { table: string; method: string; args: unknown[] }
type QueryResult = { data?: unknown; error: { message: string } | null };
type Chain = Record<string, (...args: unknown[]) => Chain> & {
  then: (resolve: (r: QueryResult) => unknown, reject?: (e: unknown) => unknown) => unknown;
};

const state = vi.hoisted(() => ({
  queries: [] as { table: string; calls: RecordedCall[] }[],
  /** What inspection_responses SELECT answers with; a test changes it before a refetch. */
  rows: [] as unknown[],
  result: (() => ({ data: [], error: null })) as (table: string, calls: RecordedCall[]) => QueryResult,
}));

vi.mock('@/integrations/supabase/client', () => {
  const METHODS = ['select', 'eq', 'order', 'limit', 'maybeSingle', 'single', 'insert', 'upsert'];
  const from = (table: string): Chain => {
    const own: RecordedCall[] = [];
    const chain = {} as Chain;
    for (const method of METHODS) {
      chain[method] = (...args: unknown[]) => { own.push({ table, method, args }); return chain; };
    }
    chain.then = (resolve, reject) => {
      state.queries.push({ table, calls: own });
      return Promise.resolve(state.result(table, own)).then(resolve, reject);
    };
    return chain;
  };
  return { supabase: { from } };
});
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { useInspectionSection } from './useInspectionSection';

const existing: InspectionResponse = {
  id: 'r1', inspection_id: 'i1', template_item_id: 'it1',
  acceptable: null, condition_rating: 'fair', action_required: null, risk_level: null,
  recommendation: 'Fix the gutter', comment: 'old comment', capex_estimate: 500, applicable: true,
  next_service_due: null, detail: { size: '5' }, photo_urls: [{ ref: '7.1', caption: 'Gutters', path: 'documents/b1/annual/7/one.jpg' }],
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
};

const KEY = ['fortress-inspection', 'annual', 'rep1', false];

/** Template, one item, one inspection, and `state.rows` as its responses; an upsert answers empty. */
const tables = (table: string, calls: RecordedCall[]): QueryResult => {
  if (table === 'inspection_templates') return { data: { id: 't1', name: 'Annual', cadence: 'annual', version: 1, active: true }, error: null };
  if (table === 'inspection_template_items') return { data: [{ id: 'it1', template_id: 't1', section_no: '7', section_title: 'ROOF', item_label: 'Gutters', sort_order: 1 }], error: null };
  if (table === 'building_inspections') return { data: { id: 'i1', report_id: 'rep1', building_id: 'b1', template_id: 't1' }, error: null };
  if (table === 'inspection_responses') return calls.some((c) => c.method === 'upsert') ? { data: null, error: null } : { data: state.rows, error: null };
  return { data: [], error: null };
};

const upsertPayload = () => {
  const q = state.queries.filter((x) => x.table === 'inspection_responses' && x.calls.some((c) => c.method === 'upsert')).pop();
  const call = q?.calls.find((c) => c.method === 'upsert');
  return { row: call?.args[0] as Record<string, unknown>, opts: call?.args[1] };
};

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
  const hook = renderHook(() => useInspectionSection('rep1', 'b1', 'annual'), { wrapper });
  return { qc, ...hook };
}

beforeEach(() => {
  state.queries = [];
  state.rows = [existing];
  state.result = tables;
});

describe('useInspectionSection.mergeResponse', () => {
  it('writes the given row into the cached responses immediately, then invalidates', async () => {
    const { qc, result } = mount();
    await waitFor(() => expect(result.current.inspectionId).toBe('i1'));
    expect(result.current.responses.it1.photo_urls).toHaveLength(1);
    const selectsBefore = state.queries.filter((q) => q.table === 'inspection_responses').length;

    const merged: InspectionResponse = { ...existing, photo_urls: [...(existing.photo_urls as unknown[]), { ref: '7.2', caption: 'Gutters', path: 'documents/b1/annual/7/two.jpg' }] };
    state.rows = [merged]; // the server agrees when the invalidation refetches
    act(() => { result.current.mergeResponse(merged); });

    // Synchronously in the cache — no round trip in between.
    const cached = qc.getQueryData<{ responses: Record<string, InspectionResponse> }>(KEY);
    expect(cached?.responses.it1.photo_urls).toHaveLength(2);
    await waitFor(() => expect(state.queries.filter((q) => q.table === 'inspection_responses').length).toBe(selectsBefore + 1));
    expect(result.current.responses.it1.photo_urls).toHaveLength(2);
  });

  it('is a no-op on an empty cache', () => {
    const qc = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
    const { result } = renderHook(() => useInspectionSection(undefined, undefined, 'annual'), { wrapper });
    act(() => { result.current.mergeResponse(existing); });
    expect(qc.getQueryData(['fortress-inspection', 'annual', undefined, false])).toBeUndefined();
  });
});
```

Section test (mocking style is `src/components/reports/fortress/sections/PpmSection.test.tsx`: the hook is mocked whole, `useHints` and `sonner` stubbed, rendered under a `QueryClientProvider`):

```tsx
// src/components/reports/fortress/sections/ConditionInspectionSection.test.tsx
/**
 * addPhoto: upload, then ONE server statement appends the ref/caption/path, then the returned row
 * is merged into the cache. The old read-modify-write (push onto the cached photo_urls and upsert
 * the whole array) is gone — two rapid adds cannot orphan the first upload any more.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { InspectionResponse, InspectionTemplateItem } from '@/integrations/supabase/fortress-db';

const state = vi.hoisted(() => ({
  responses: {} as Record<string, InspectionResponse>,
  inspectionId: 'i1' as string | null,
  setResponse: vi.fn(async () => {}),
  mergeResponse: vi.fn(),
  rpc: vi.fn(),
  // Typed parameters so `upload.mock.calls[0][1]` below is not indexing an empty tuple.
  upload: vi.fn(async (_photos: unknown[], _opts: { prefix: string; paths?: string[] }) => ['documents/b1/annual/7/p.jpg']),
  toast: { success: vi.fn(), error: vi.fn() },
}));

const item: InspectionTemplateItem = {
  id: 'it1', template_id: 't1', section_no: '7', section_title: 'ROOF', item_label: 'Gutters', rating_type: 'condition_scale',
  allows_photo: true, allow_na: true, sort_order: 1, field_set: 'generic', field_keys: [], created_at: '', updated_at: '',
};

vi.mock('@/hooks/useInspectionSection', () => ({
  useInspectionSection: () => ({ template: null, items: [item], responses: state.responses, inspectionId: state.inspectionId, isLoading: false, setResponse: state.setResponse, mergeResponse: state.mergeResponse }),
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: state.rpc } }));
vi.mock('@/integrations/supabase/storage', () => ({ openStorageFile: vi.fn() }));
vi.mock('@/components/ui/signed-image', () => ({ SignedImage: () => null }));
vi.mock('@/lib/photos', () => ({ uploadPhotoPaths: state.upload, inspectionPhotoPrefix: (b: string, s: string) => `documents/${b}/annual/${s}` }));
vi.mock('@/hooks/useHints', () => ({ useHints: () => ({ hintsEnabled: true, setHintsEnabled: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: state.toast }));
// One button that "picks" a processed JPEG, the way PhotoCapture calls onPhotosChange.
vi.mock('@/components/ui/photo-capture', () => ({
  PhotoCapture: ({ onPhotosChange }: { onPhotosChange: (p: { file: File; preview: string }[]) => void }) => (
    <button type="button" onClick={() => onPhotosChange([{ file: new File(['x'], 'p.jpg', { type: 'image/jpeg' }), preview: 'blob:p' }])}>+ Photo</button>
  ),
}));

import ConditionInspectionSection from './ConditionInspectionSection';

const returnedRow: InspectionResponse = {
  id: 'r1', inspection_id: 'i1', template_item_id: 'it1', acceptable: null, condition_rating: null, action_required: null, risk_level: null,
  recommendation: null, comment: null, capex_estimate: null, applicable: true, next_service_due: null, detail: {},
  photo_urls: [{ ref: '7.1', caption: 'Gutters', path: 'documents/b1/annual/7/p.jpg' }], created_at: '', updated_at: '',
};

const revokeObjectURL = vi.fn();

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ConditionInspectionSection reportId="rep1" buildingId="b1" readOnly={false} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.responses = {};
  state.inspectionId = 'i1';
  state.setResponse.mockClear();
  state.mergeResponse.mockClear();
  state.rpc.mockReset().mockResolvedValue({ data: returnedRow, error: null });
  state.upload.mockClear().mockResolvedValue(['documents/b1/annual/7/p.jpg']);
  state.toast.error.mockClear();
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revokeObjectURL });
  revokeObjectURL.mockClear();
});

describe('ConditionInspectionSection.addPhoto', () => {
  it('uploads, appends through append_inspection_photo and merges the returned row — never a cached read-modify-write', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: '+ Photo' }));
    await waitFor(() => expect(state.mergeResponse).toHaveBeenCalledTimes(1));

    expect(state.upload).toHaveBeenCalledTimes(1);
    expect(state.upload.mock.calls[0][1]).toEqual({ prefix: 'documents/b1/annual/7' });
    expect(state.rpc).toHaveBeenCalledTimes(1);
    expect(state.rpc).toHaveBeenCalledWith('append_inspection_photo', {
      p_inspection: 'i1', p_template_item: 'it1', p_path: 'documents/b1/annual/7/p.jpg', p_caption: 'Gutters', p_section_no: '7',
    });
    expect(state.mergeResponse).toHaveBeenCalledWith(returnedRow);
    expect(state.setResponse).not.toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:p');
    expect(state.toast.error).not.toHaveBeenCalled();
  });

  it('a failed append says so and leaves the cache alone', async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: 'new row violates row-level security policy', code: '42501' } });
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: '+ Photo' }));
    await waitFor(() => expect(state.toast.error).toHaveBeenCalledWith('Photo uploaded but not attached to the item. Add it again.'));
    expect(state.mergeResponse).not.toHaveBeenCalled();
    expect(state.setResponse).not.toHaveBeenCalled();
  });

  it('an upload failure never reaches the RPC', async () => {
    state.upload.mockRejectedValue(new Error('Photo upload failed: 403'));
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: '+ Photo' }));
    await waitFor(() => expect(state.toast.error).toHaveBeenCalledWith('Photo upload failed.'));
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.mergeResponse).not.toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:p');
  });

  it('does nothing without an inspection row (read-only view never created one)', async () => {
    state.inspectionId = null;
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: '+ Photo' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(state.upload).not.toHaveBeenCalled();
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
```

Run: `npm run test -- src/hooks/useInspectionSection.test.ts src/components/reports/fortress/sections/ConditionInspectionSection.test.tsx`
Expected: hook file — `TypeError: result.current.mergeResponse is not a function` (both cases); section file — first case times out on `expect(state.mergeResponse).toHaveBeenCalledTimes(1)` (today `addPhoto` calls `setResponse` with a rebuilt `photo_urls`), the failed-append case times out on the toast, the upload-failure case passes, the no-inspection case fails because today's `addPhoto` uploads regardless.

- [x] **Step 2: Hook — `mergeResponse` and a named data type.** In `src/hooks/useInspectionSection.ts`:

After the `InspectionResponsePatch` interface (line 36) add:

```ts
/** What the section query holds. Named so `mergeResponse` can update it through setQueryData. */
export interface InspectionSectionData {
  template: InspectionTemplate | null;
  items: InspectionTemplateItem[];
  inspectionId: string | null;
  responses: Record<string, InspectionResponse>;
}
```

Change `const query = useQuery({` (line 48) to `const query = useQuery<InspectionSectionData>({` and `queryFn: async () => {` (line 51) to `queryFn: async (): Promise<InspectionSectionData> => {`. The two early `return { template: …, items: …, inspectionId: null, responses: {} as Record<string, InspectionResponse> }` objects and the final return already match the shape; leave them.

After `setResponse` (before `return {`, line 145) add:

```ts
  /**
   * Put a server-returned row into the cached responses NOW, then invalidate. Used after an RPC
   * that has already changed the row (append_inspection_photo): the UI shows the real row at once,
   * and a second rapid add sees the appended list rather than a stale copy. No-op when nothing is
   * cached yet (the invalidation still runs and is harmless).
   */
  const mergeResponse = useCallback(
    (row: InspectionResponse) => {
      qc.setQueryData<InspectionSectionData>(key, (old) =>
        old ? { ...old, responses: { ...old.responses, [row.template_item_id]: row } } : old);
      qc.invalidateQueries({ queryKey: key });
    },
    [qc, key],
  );
```

and add `mergeResponse,` to the returned object after `setResponse,`.

- [x] **Step 3: Section — `addPhoto` through the RPC.** In `src/components/reports/fortress/sections/ConditionInspectionSection.tsx`:

Imports: add after line 14 (`import { openStorageFile } …`):

```ts
import { supabase } from '@/integrations/supabase/client';
```

and change line 19 to import the response type too:

```ts
import type { ConditionRating, InspectionResponse, InspectionTemplateItem } from '@/integrations/supabase/fortress-db';
```

Line 34 becomes:

```ts
  const { items, responses, inspectionId, isLoading, setResponse, mergeResponse } = useInspectionSection(reportId, buildingId, 'annual', readOnly);
```

Replace `addPhoto` (lines 37–54, including its leading comment) with:

```ts
  // Inspection photos store storage PATHS (not URLs) under documents/<building>/annual/<section>/
  // — written by admins/managers, see src/lib/photos.ts. Upload failures toast rather than throw
  // because this is an auto-saving field, not a submit.
  //
  // The append is ONE server statement (append_inspection_photo): the row is upserted and
  // {ref, caption, path} is appended to photo_urls under the row lock. The old path pushed onto
  // the cached photo_urls and upserted the whole array, so two rapid adds rebuilt the list from
  // the same stale copy and the first upload was orphaned in storage.
  const addPhoto = async (it: InspectionTemplateItem, photo: PhotoFile) => {
    // A read-only view never creates the inspection row; without one there is nothing to attach to.
    if (!inspectionId) { URL.revokeObjectURL(photo.preview); return; }
    let path: string;
    try {
      // String(): section_no is nullable in the type; the old path interpolated it the same way.
      [path] = await uploadPhotoPaths([photo], { prefix: inspectionPhotoPrefix(buildingId, String(it.section_no)) });
    } catch (error) {
      if (import.meta.env.DEV) console.error('photo upload:', error);
      toast.error('Photo upload failed.');
      return;
    } finally {
      URL.revokeObjectURL(photo.preview);
    }
    // append_inspection_photo is not yet in the generated types; regenerate after the migration ships.
    const { data, error } = await supabase.rpc('append_inspection_photo' as never, {
      p_inspection: inspectionId, p_template_item: it.id, p_path: path, p_caption: it.item_label, p_section_no: String(it.section_no),
    } as never);
    if (error) {
      if (import.meta.env.DEV) console.error('append_inspection_photo:', error);
      // Guardrail, not a hint: the file IS in storage, the row does not point at it.
      toast.error('Photo uploaded but not attached to the item. Add it again.');
      return;
    }
    mergeResponse(data as unknown as InspectionResponse);
  };
```

Run: `npm run test -- src/hooks/useInspectionSection.test.ts src/components/reports/fortress/sections/ConditionInspectionSection.test.tsx`
Expected: `Test Files  2 passed (2)`, `Tests  6 passed (6)`.

- [x] **Step 4: Gate and commit**

```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E 'src/hooks/useInspectionSection|src/components/reports/fortress/sections/ConditionInspectionSection' ; echo "(nothing above = clean)"
npm run test -- src/hooks/useInspectionSection src/components/reports/fortress
git add src/hooks/useInspectionSection.ts src/hooks/useInspectionSection.test.ts src/components/reports/fortress/sections/ConditionInspectionSection.tsx src/components/reports/fortress/sections/ConditionInspectionSection.test.tsx && git commit -m "Inspection photos append through append_inspection_photo

addPhoto uploads, calls the RPC, and merges the returned row into the query cache through the
hook's new mergeResponse (setQueryData, then invalidate). No more read-modify-write of the cached
photo_urls, so a second rapid add cannot orphan the first upload.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `setResponse` patch semantics — absent keeps, null clears

**Files:**
- Modify: `src/hooks/useInspectionSection.ts` (`InspectionResponsePatch` :25-36; the upsert payload inside `setResponse` :117-135)
- Modify: `src/hooks/useInspectionSection.test.ts` (append a `describe`)

Runs after Task 7 has been committed (same files).

- [x] **Step 1: Failing test.** Append to `src/hooks/useInspectionSection.test.ts`:

```ts
describe('useInspectionSection.setResponse — a key absent keeps the stored value, a key present with null clears it', () => {
  it('{ capex_estimate: null } writes null and leaves every other column as stored', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.inspectionId).toBe('i1'));
    await act(async () => { await result.current.setResponse('it1', { capex_estimate: null }); });

    const { row, opts } = upsertPayload();
    expect(opts).toEqual({ onConflict: 'inspection_id,template_item_id' });
    expect(row.id).toBe('r1');
    expect(row.inspection_id).toBe('i1');
    expect(row.template_item_id).toBe('it1');
    expect(row.capex_estimate).toBeNull();
    expect(row.comment).toBe('old comment');
    expect(row.recommendation).toBe('Fix the gutter');
    expect(row.condition_rating).toBe('fair');
    expect(row.applicable).toBe(true);
    expect(row.detail).toEqual({ size: '5' });
    expect(row.photo_urls).toEqual(existing.photo_urls);
  });

  it('{ comment: "x" } keeps the existing capex estimate', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.inspectionId).toBe('i1'));
    await act(async () => { await result.current.setResponse('it1', { comment: 'x' }); });

    const { row } = upsertPayload();
    expect(row.comment).toBe('x');
    expect(row.capex_estimate).toBe(500);
    expect(row.recommendation).toBe('Fix the gutter');
  });

  it('clearing a text and a date both write null; an explicit undefined counts as absent', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.inspectionId).toBe('i1'));
    await act(async () => { await result.current.setResponse('it1', { recommendation: null, next_service_due: null, comment: undefined }); });

    const { row } = upsertPayload();
    expect(row.recommendation).toBeNull();
    expect(row.next_service_due).toBeNull();
    expect(row.comment).toBe('old comment');
  });

  it('a first response for an item (nothing stored) gets a fresh id and the column defaults', async () => {
    state.rows = [];
    const { result } = mount();
    await waitFor(() => expect(result.current.inspectionId).toBe('i1'));
    await act(async () => { await result.current.setResponse('it1', { condition_rating: 'poor' }); });

    const { row } = upsertPayload();
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.condition_rating).toBe('poor');
    expect(row.capex_estimate).toBeNull();
    expect(row.applicable).toBe(true);
    expect(row.detail).toEqual({});
    expect(row.photo_urls).toEqual([]);
  });
});
```

Run: `npm run test -- src/hooks/useInspectionSection.test.ts`
Expected: the first case fails with `expected 500 to be null` (today's `patch.capex_estimate ?? existing?.capex_estimate` re-saves 500); the third fails with `expected 'Fix the gutter' to be null`; the second and fourth pass.

- [x] **Step 2: Implementation.** In `src/hooks/useInspectionSection.ts` replace the `InspectionResponsePatch` interface (lines 25–36) with:

```ts
/**
 * A partial write to one response row. A key ABSENT from the patch keeps the stored value; a key
 * PRESENT with `null` clears it. The nullable columns say so explicitly; `applicable` is NOT NULL
 * and the two JSON columns are replaced whole.
 */
export type InspectionResponsePatch = Partial<{
  acceptable: YesNoNa | null;
  condition_rating: ConditionRating | null;
  action_required: ActionRequired | null;
  recommendation: string | null;
  comment: string | null;
  capex_estimate: number | null;
  applicable: boolean;
  next_service_due: string | null;
  detail: Record<string, unknown>;
  photo_urls: PhotoRef[];
}>;
```

Inside `setResponse`, replace the `upsert(` payload object (lines 117–135, from `{` through `photo_urls: … as never,` `}`) with:

```ts
      // A key absent from the patch keeps the stored value; a key present with null clears it.
      // `??` used to collapse the two, so clearing a capex estimate or a comment silently re-saved
      // the old value. An explicit `undefined` counts as absent (TS lets optional fields spread in).
      const pick = <K extends keyof InspectionResponsePatch, V>(k: K, current: V) =>
        (k in patch && patch[k] !== undefined ? patch[k] : current) as Exclude<InspectionResponsePatch[K], undefined> | V;
      const { error } = await fdb.from('inspection_responses').upsert(
        {
          id: existing?.id ?? crypto.randomUUID(),
          inspection_id: inspectionId,
          template_item_id: templateItemId,
          acceptable: pick('acceptable', existing?.acceptable ?? null),
          condition_rating: pick('condition_rating', existing?.condition_rating ?? null),
          action_required: pick('action_required', existing?.action_required ?? null),
          recommendation: pick('recommendation', existing?.recommendation ?? null),
          comment: pick('comment', existing?.comment ?? null),
          capex_estimate: pick('capex_estimate', existing?.capex_estimate ?? null),
          applicable: pick('applicable', existing?.applicable ?? true),
          next_service_due: pick('next_service_due', existing?.next_service_due ?? null),
          detail: pick('detail', (existing?.detail ?? {}) as Record<string, unknown>) as never,
          photo_urls: pick('photo_urls', (existing?.photo_urls as unknown as PhotoRef[] | null) ?? []) as never,
        },
        { onConflict: 'inspection_id,template_item_id' },
      );
```

(The `const { error } = await fdb.from('inspection_responses').upsert(` line and the `{ onConflict }` argument already exist — keep exactly one of each.)

Every caller in `ConditionInspectionSection.tsx` already passes concrete values (`null` to clear capex / next-service date, strings for text, a full `detail` object); no caller changes. `BuildingInspectionSection.tsx` uses the same hook for the monthly cadence with `{ acceptable }` / `{ comment }` patches — read it and confirm it passes nothing that relied on `??` collapsing `null` (it does not; `acceptable` is always one of the three values).

Run: `npm run test -- src/hooks/useInspectionSection.test.ts`
Expected: `Tests  6 passed (6)`.

- [x] **Step 3: Gate and commit**

```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E 'src/hooks/useInspectionSection|src/components/reports/fortress/sections/(Condition|Building)InspectionSection' ; echo "(nothing above = clean)"
npm run test -- src/hooks/useInspectionSection src/components/reports/fortress
git add src/hooks/useInspectionSection.ts src/hooks/useInspectionSection.test.ts && git commit -m "setResponse: absent keeps, null clears

InspectionResponsePatch is Partial with explicit nullable members; the upsert reads a key only
when it is present in the patch, so clearing capex or a comment writes null instead of re-saving
the stored value.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9 (controller): apply, smoke, regenerate, record

- [ ] **Step 1: Staging.** With the Management-API runner (`supa.mjs` in the controller's scratchpad; ref `vkrihpmjajjcxmzgjqdr`), apply `../GMI/sql/2026-09-15_02_inspection_photo_append.sql` (expect HTTP 201), run every `-- Verify:` query from the file's tail and paste the results into the apply record (`prosecdef = false`, `proconfig = {search_path=}`, anon `false`, authenticated `true`), then `notify pgrst, 'reload schema'`. If S1's `2026-09-15_01_team_coverage.sql` has not been applied yet, apply it first — the files are independent, but the checklist records them in order.

- [ ] **Step 2: Staging smokes.** Against staging (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` for `vkrihpmjajjcxmzgjqdr`):

```bash
node scripts/rls-smoke.mjs                       # "… S2 photo append …: done", RLS MATRIX HOLDS, teardown clean
npx vite-node scripts/fortress-pdf-smoke.ts      # OK wrote …/abaqulusi_annual_TEST.pdf — the node render proves photoRows still lays out
```

`fortress-pdf-smoke` follows `SUPABASE_URL` and reads the AbaQulusi annual report; if that report is absent on staging the script fails on `insp` being undefined — run it once with `FORTRESS_PDF_REF=qdzgkttiosahdfqresvz` instead (read-only; it embeds on-disk fixtures, never storage). Open the PDF and confirm the condition-inspection photo grid renders. Fix what the smokes reveal before touching prod.

- [ ] **Step 3: Production.** Apply the same file to `qdzgkttiosahdfqresvz` (201), run the `-- Verify:` queries, reload PostgREST, run `node scripts/rls-smoke.mjs` against prod (`… S2 photo append …: done`, `RLS MATRIX HOLDS`, `teardown: clean`). Deploy the app.

- [ ] **Step 4: Regenerate types from prod and drop the boundary cast.**

```bash
supabase gen types typescript --project-id qdzgkttiosahdfqresvz > src/integrations/supabase/types.ts
supabase gen types typescript --project-id vkrihpmjajjcxmzgjqdr \
  | sed '/^type DatabaseWithoutInternals = Omit<Database/,$d' | sed 's/export type Database/export type FortressDatabase/' > src/integrations/supabase/fortress-types.ts
```

(`fortress-types.ts` is generated from staging by its own header recipe — keep that recipe.) Then in `ConditionInspectionSection.tsx` delete the `// append_inspection_photo is not yet in the generated types…` comment and the two `as never` casts, and change `mergeResponse(data as unknown as InspectionResponse)` to `mergeResponse(data)` if the generated `Returns` is the `inspection_responses` Row — keep the cast only if the generator emits it as `Json` or a composite record type, and say which in the commit. The section test's `state.rpc` mock is unaffected. Gate: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c 'error TS'` ≤ 46 (ratchet `.github/typecheck-baseline.txt` down if it fell), `npm run test` green, `npm run build` green.

```bash
git add src/integrations/supabase/types.ts src/integrations/supabase/fortress-types.ts src/components/reports/fortress/sections/ConditionInspectionSection.tsx .github/typecheck-baseline.txt && git commit -m "S2: regenerate types after append_inspection_photo shipped; drop the boundary cast

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 5: `docs/plans/APPLY_CHECKLIST.md` — append this section** (fill the dates, the GMI sha and the smoke counts from the runs above):

```markdown
## S2 "Photo pipeline hardening" (2026-09-__)

Spec `docs/superpowers/specs/2026-09-12-field-readiness-design.md` §5; plan `docs/superpowers/plans/2026-09-12-s2-photo-hardening.md`.

### Migration

- `2026-09-15_02_inspection_photo_append.sql` (GMI `_______`) — additive, idempotent, one transaction. One function,
  `append_inspection_photo(p_inspection, p_template_item, p_path, p_caption, p_section_no) returns inspection_responses`,
  **security invoker** with `set search_path = ''`: upserts the response row on `(inspection_id, template_item_id)` and
  appends `{ref: '<section>.<n+1>', caption, path}` to `photo_urls` in one statement under the row lock. No new table,
  no policy change — the existing `ir_write` policy decides, so a user without building access gets 42501 and nothing
  is written. `authenticated` may execute; `anon` and `public` revoked.

### Staging — DONE 2026-09-__

- [ ] Applied twice (idempotent), verify queries: `prosecdef = false`, `proconfig = {search_path=}`, anon `false`,
      authenticated `true`; PostgREST reloaded.
- [ ] `rls-smoke` ___/0 (S2 block: anon and no-access user refused, refs 7.1/7.2 on one row, field user with access
      appends); `fortress-pdf-smoke` rendered.

### Production — DONE 2026-09-__

- [ ] Applied, verified, PostgREST reloaded; `rls-smoke` ___/0; app deployed; types regenerated from prod; cast dropped.

### Ships live on this deploy, NOT behind a flag

- Report PDF: a photo whose signed URL answers non-2xx or a non-image body is skipped and counted in the "N of M photos
  on file are not embedded" note; an SVG logo is skipped (org name prints) with a DEV warning.
- Settings: the logo picker no longer accepts SVG; existing SVG logos still show in the app, never in PDFs.
- PhotoCapture: a source over 40 MB is refused before decoding.
- Annual inspection: photos append through the RPC; clearing capex / comment / recommendation now saves the clear.

### Owner items

- **Existing SVG org logos.** Any organisation whose logo is an SVG prints reports with the org name in place of the
  logo until an admin uploads a PNG or JPEG on Settings → Branding. `select id, name, logo_url from organizations where
  logo_url ilike '%.svg'` lists them.
- **Orphaned inspection photos from before S2.** Storage objects under `documents/<building>/annual/<section>/` that no
  `inspection_responses.photo_urls` entry references are the old race's leftovers. They are harmless and small;
  decide whether to sweep them (a service-role listing per building, diffed against the JSON) or leave them.
```

- [ ] **Step 6: Whole-slice review** — spec §5 coverage against the mapping below, `git show` each commit, confirm no `<Hint>` carries guardrail copy (the three new toasts and the Settings helper are plain), push, update the PR.

---

## Self-review: spec §5 → tasks

| Spec §5 item | Where |
|---|---|
| §5.1 `imageFetch.ts` exports `fetchImageBlob` (throws unless `ok` and `image/*`) and `bitmapFromBlob` (`imageOrientation: 'from-image'`) | Task 1 |
| §5.1 `evidencePackData.fetchOne` uses it | Task 2 |
| §5.1 `fortressReportPdf.embedPhoto` uses it, returns `null` on any failure, `blobToDataUrl` fallback deleted from the photo path | Task 3 Step 2 |
| §5.1 org logo: same fetch, skips `image/svg+xml`, DEV warning | Task 3 Step 2 (logo block; `rejectSvg: true`) |
| §5.1 `Settings` stops recommending SVG, accept list drops it; existing SVG logos keep working in-app | Task 4; owner item in Task 9 Step 5 |
| §5.1 `fortressReportDoc` guards `p.dataUrl` truthiness | Task 3 Step 3 |
| §5.2 `PhotoCapture` rejects > `MAX_SOURCE_BYTES` (40 MB) before HEIC/canvas, toast names the limit, one file at a time | Task 5 |
| §5.3 migration `append_inspection_photo(…) returns inspection_responses`, security invoker, upsert on `(inspection_id, template_item_id)`, appends `{ref: '<section_no>.<n+1>', caption, path}` in one statement | Task 6 Step 1 |
| §5.3 `ConditionInspectionSection.addPhoto` calls it and writes the returned row into the cache with `setQueryData` before invalidating | Task 7 (`mergeResponse`) |
| §5.4 `setResponse`: absent = unchanged, present-null = clear; `InspectionResponsePatch` is `Partial<…>` with explicit `| null` | Task 8 |
| §5.5 `imageFetch.test.ts` (non-2xx, wrong content type, SVG skip) | Task 1 |
| §5.5 `fortressReportPdf` embed test with a mocked fetch returning JSON | Task 3 Step 1 |
| §5.5 `photo-capture.test.tsx` (HEIC by extension with empty MIME, size gate) | Task 5 |
| §5.5 `useInspectionSection.test.ts` (null clears, undefined keeps) | Task 8 (plus `mergeResponse` in Task 7) |
| §5.5 SQL on the throwaway Postgres (two appends → `.1` and `.2`) | Task 6 Step 2 |
| §5.5 `rls-smoke` (a `user` with no access → 42501) | Task 6 Step 4 |
| §2 constraints: additive migration in `../GMI/sql/`, vendored, staging first, grants in the same migration, invoker relies on RLS, guardrail copy not through `<Hint>`, boundary casts until regeneration | Task 6 Steps 1/3, Task 7 Step 3, Task 9 |
| §9 deploy: staging → smokes → prod → regenerate types → `APPLY_CHECKLIST.md` section | Task 9 |

**Ambiguities resolved (and how):**

1. **`blobToDataUrl` in the PDF module** — kept, for the logo only. The logo must not go through the JPEG canvas pass (transparency, re-encoding), and after `fetchImageBlob(…, { rejectSvg: true })` the FileReader read cannot see an error body. The photo path never touches it, and the function's comment says so.
2. **Photo decode failure in the PDF vs the evidence pack** — the PDF skips (spec: "returns null on any failure; the fallback is deleted"); the pack keeps its FileReader fallback (spec says "without changing behaviour" and its tests assert a `data:` URL when `createImageBitmap` is absent). Each file's comment states its rule.
3. **Toast vs helper copy in Settings** — the helper `<p>` gets the spec sentence verbatim; the rejection toast keeps its "Please upload a …" shape (now PNG/JPEG/WebP) and carries the same SVG sentence, so both surfaces say why. WebP stays accepted by Settings because the spec only removes SVG; pdfmake cannot embed WebP either — listed as an open question.
4. **`p_section_no` null** — `coalesce(p_section_no, '')` so a null section prints `'.1'` rather than `'null.1'`; verified on the throwaway DB. The client passes `String(it.section_no)` as before.
5. **Explicit `undefined` in a patch** — counts as absent (`k in patch && patch[k] !== undefined`). `tsconfig.app.json` has no `exactOptionalPropertyTypes`, so `{ comment: undefined }` type-checks; treating it as "clear" would write null by accident. Tested in Task 8.
6. **Where the RPC is called** — from the section (spec wording), through `supabase.rpc(… as never, … as never)` exactly as `insight-linker.ts` does; the hook only owns the cache (`mergeResponse` sets, then invalidates). The section never touches `qc`.
7. **`SinglePhotoCapture` size gate** — not added; the spec names `PhotoCapture`, and that control already caps post-processing size at 2 MB.
8. **`rls-smoke` fixture template** — inserted with `active: false` so the smoke never becomes a project's live annual template; the inspection rows cascade-delete the responses the calls create, so cleanup order is inspections → item → template (LIFO handles it).
9. **Tasks 7 and 8 share two files** — stated up front; they run in sequence, not in parallel.

**Open questions for the controller:**

- WebP logos: accepted by Settings, not embeddable by pdfmake (the logo would be skipped with `not an image`-style warning only if the content type were wrong; a real `image/webp` passes `fetchImageBlob` and pdfmake then throws on it inside `createPdf`). Either drop WebP from the Settings list in this slice (one-line change to Task 4's `validTypes`/`accept`/copy) or add `image/webp` to the logo rejection alongside SVG. Not in spec §5; flagged, not done.
- `fortress-pdf-smoke.ts` targets the prod AbaQulusi report by default; the staging run in Task 9 Step 2 may need `FORTRESS_PDF_REF`. Read-only either way.
