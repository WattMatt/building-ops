import { describe, it, expect } from 'vitest';
import {
  saveReportArtifact,
  sanitizeReportFileName,
  listReportArtifacts,
  createArtifactSignedUrl,
  GENERATED_REPORTS_BUCKET,
  type ReportArtifactRow,
  type ReportArtifactsClient,
  type SaveReportArtifactInput,
} from './reportArtifacts';

// ---------------------------------------------------------------------------
// Mock client: chainable select/update builders that record their filters, and
// storage spies for upload/remove. Shapes mirror the narrow structural client
// interface the module is typed against.
// ---------------------------------------------------------------------------

interface MockOptions {
  priorVersion?: number;
  versionError?: string;
  uploadError?: string;
  insertError?: string;
  removeError?: string;
  supersedeError?: string;
}

interface Recorded {
  uploads: { path: string; opts: { contentType: string; upsert: boolean } }[];
  removed: string[][];
  inserted: Record<string, unknown>[];
  supersedes: { patch: Record<string, unknown>; filters: string[] }[];
}

function makeMockClient(opts: MockOptions = {}): { client: ReportArtifactsClient; recorded: Recorded } {
  const recorded: Recorded = { uploads: [], removed: [], inserted: [], supersedes: [] };

  const makeSelectBuilder = () => {
    const result = opts.versionError
      ? { data: null, error: { message: opts.versionError } }
      : { data: opts.priorVersion ? [{ version: opts.priorVersion }] : [], error: null };
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const builder: any = {
      eq: () => builder,
      is: () => builder,
      order: () => builder,
      limit: () => builder,
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return builder;
  };

  const makeUpdateBuilder = (patch: Record<string, unknown>) => {
    const entry = { patch, filters: [] as string[] };
    recorded.supersedes.push(entry);
    const result = { error: opts.supersedeError ? { message: opts.supersedeError } : null };
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const builder: any = {
      eq: (col: string, val: string) => { entry.filters.push(`eq:${col}=${val}`); return builder; },
      is: (col: string, val: null) => { entry.filters.push(`is:${col}=${String(val)}`); return builder; },
      neq: (col: string, val: string) => { entry.filters.push(`neq:${col}=${val}`); return builder; },
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return builder;
  };

  const client = {
    from: (table: 'report_artifacts') => {
      expect(table).toBe('report_artifacts');
      return {
        select: () => makeSelectBuilder(),
        insert: (row: Record<string, unknown>) => {
          recorded.inserted.push(row);
          return {
            select: () => ({
              single: async () =>
                opts.insertError
                  ? { data: null, error: { message: opts.insertError } }
                  : { data: { ...row, id: 'new-artifact-id', created_at: '2026-08-06T00:00:00Z', superseded_by: null } as unknown as ReportArtifactRow, error: null },
            }),
          };
        },
        update: (patch: Record<string, unknown>) => makeUpdateBuilder(patch),
      };
    },
    storage: {
      from: (bucket: string) => {
        expect(bucket).toBe(GENERATED_REPORTS_BUCKET);
        return {
          upload: async (path: string, _body: Blob, uploadOpts: { contentType: string; upsert: boolean }) => {
            recorded.uploads.push({ path, opts: uploadOpts });
            return opts.uploadError ? { data: null, error: { message: opts.uploadError } } : { data: { path }, error: null };
          },
          remove: async (paths: string[]) => {
            recorded.removed.push(paths);
            return opts.removeError ? { data: null, error: { message: opts.removeError } } : { data: [], error: null };
          },
          createSignedUrl: async (path: string, _expiresIn: number, signedOpts?: { download?: string | boolean }) => ({
            data: { signedUrl: `https://signed.example/${path}${signedOpts?.download ? '?download' : ''}` },
            error: null,
          }),
        };
      },
    },
  } as unknown as ReportArtifactsClient;

  return { client, recorded };
}

const INPUT: SaveReportArtifactInput = {
  orgId: 'org-1',
  kind: 'hs_compliance',
  blob: new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }),
  fileName: 'HS Compliance — Broll Centre.pdf',
  generatedBy: 'user-1',
  buildingId: 'building-1',
};

describe('sanitizeReportFileName', () => {
  it('strips unsafe characters and always ends in .pdf', () => {
    expect(sanitizeReportFileName('HS Compliance — Broll Centre.pdf')).toBe('HS_Compliance_Broll_Centre.pdf');
    expect(sanitizeReportFileName('../..//etc/passwd')).toBe('etc_passwd.pdf');
    expect(sanitizeReportFileName('###')).toBe('report.pdf');
  });
  it('caps overly long names', () => {
    const name = sanitizeReportFileName(`${'x'.repeat(200)}.pdf`);
    expect(name.length).toBeLessThanOrEqual(84); // 80-char stem + '.pdf'
  });
});

describe('saveReportArtifact — happy path', () => {
  it('uploads (upsert:false), inserts version prior+1, then supersedes prior issued rows', async () => {
    const { client, recorded } = makeMockClient({ priorVersion: 2 });
    const result = await saveReportArtifact(INPUT, client);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.id).toBe('new-artifact-id');
    expect(result.supersedeWarning).toBeUndefined();

    // Upload: immutable object under {orgId}/{kind}/{ts}-{sanitized}.pdf
    expect(recorded.uploads).toHaveLength(1);
    expect(recorded.uploads[0].path).toMatch(/^org-1\/hs_compliance\/\d+-HS_Compliance_Broll_Centre\.pdf$/);
    expect(recorded.uploads[0].opts).toEqual({ contentType: 'application/pdf', upsert: false });

    // Insert: versioned row, issued, carrying the storage path.
    expect(recorded.inserted).toHaveLength(1);
    expect(recorded.inserted[0]).toMatchObject({
      org_id: 'org-1',
      kind: 'hs_compliance',
      source_id: null,
      building_id: 'building-1',
      version: 3,
      status: 'issued',
      generated_by: 'user-1',
      file_name: 'HS_Compliance_Broll_Centre.pdf',
    });
    expect(recorded.inserted[0].file_path).toBe(recorded.uploads[0].path);

    // Supersede: prior issued rows of the same (kind, source) chain only.
    expect(recorded.supersedes).toHaveLength(1);
    expect(recorded.supersedes[0].patch).toEqual({ status: 'superseded', superseded_by: 'new-artifact-id' });
    expect(recorded.supersedes[0].filters).toEqual([
      'eq:org_id=org-1',
      'eq:kind=hs_compliance',
      'is:source_id=null',
      'eq:status=issued',
      'neq:id=new-artifact-id',
    ]);

    // Fail-closed path never ran.
    expect(recorded.removed).toHaveLength(0);
  });

  it('starts the version chain at 1 and filters by source_id when provided', async () => {
    const { client, recorded } = makeMockClient();
    const result = await saveReportArtifact({ ...INPUT, kind: 'fortress_ops_monthly', sourceId: 'report-9' }, client);
    expect(result.ok).toBe(true);
    expect(recorded.inserted[0]).toMatchObject({ version: 1, source_id: 'report-9' });
    expect(recorded.supersedes[0].filters).toContain('eq:source_id=report-9');
  });
});

describe('saveReportArtifact — failure paths (fail-closed)', () => {
  it('stops before uploading when the version lookup fails', async () => {
    const { client, recorded } = makeMockClient({ versionError: 'boom' });
    const result = await saveReportArtifact(INPUT, client);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('boom') });
    expect(recorded.uploads).toHaveLength(0);
    expect(recorded.inserted).toHaveLength(0);
  });

  it('returns an error and never inserts when the upload fails', async () => {
    const { client, recorded } = makeMockClient({ uploadError: 'bucket unavailable' });
    const result = await saveReportArtifact(INPUT, client);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('bucket unavailable') });
    expect(recorded.inserted).toHaveLength(0);
    expect(recorded.removed).toHaveLength(0);
  });

  it('removes the uploaded object when the row insert fails (no orphan files)', async () => {
    const { client, recorded } = makeMockClient({ priorVersion: 1, insertError: 'RLS says no' });
    const result = await saveReportArtifact(INPUT, client);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('RLS says no') });
    expect(recorded.removed).toHaveLength(1);
    expect(recorded.removed[0]).toEqual([recorded.uploads[0].path]);
    expect(recorded.supersedes).toHaveLength(0);
  });

  it('reports when orphan cleanup itself fails', async () => {
    const { client } = makeMockClient({ insertError: 'no row', removeError: 'also down' });
    const result = await saveReportArtifact(INPUT, client);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('no row');
    expect(result.error).toContain('also down');
  });

  it('keeps the new artifact but surfaces a warning when supersede fails', async () => {
    const { client } = makeMockClient({ priorVersion: 4, supersedeError: 'update denied' });
    const result = await saveReportArtifact(INPUT, client);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.version).toBe(5);
    expect(result.supersedeWarning).toContain('update denied');
  });
});

describe('listReportArtifacts / createArtifactSignedUrl', () => {
  it('lists newest-first via the query builder', async () => {
    const { client } = makeMockClient({ priorVersion: 7 });
    const { data, error } = await listReportArtifacts(10, client);
    expect(error).toBeNull();
    expect(data).toEqual([{ version: 7 }]);
  });

  it('creates signed URLs, with the attachment variant for downloads', async () => {
    const { client } = makeMockClient();
    const preview = await createArtifactSignedUrl('org-1/hs_compliance/1-x.pdf', undefined, client);
    expect(preview.url).toBe('https://signed.example/org-1/hs_compliance/1-x.pdf');
    const download = await createArtifactSignedUrl('org-1/hs_compliance/1-x.pdf', { downloadAs: 'x.pdf' }, client);
    expect(download.url).toContain('?download');
  });
});
