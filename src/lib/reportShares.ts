/**
 * Share links (spec §5.8): a bearer URL to ONE issued artifact. Token minted client-side (same 43-char
 * base64url as calendar_tokens). A link WITHOUT a passcode is inserted straight through RLS; a link WITH
 * one goes through the report-share function's `create` action, because the hash uses the server salt.
 * Revoke is a client update of `revoked_at` (the only column clients may write) and is one-way: the
 * policy refuses an update that clears it, so there is no un-revoke.
 *
 * RLS filters a refused write to zero rows rather than raising, so every write selects its row back and
 * reads "nothing came back" as a permission failure (the calendar_tokens pattern). Reads and
 * `return=representation` writes both name their columns — SELECT on this table is column-privileged.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { mintToken } from '@/lib/calendarTokens';
import { track } from '@/lib/analytics';

export type ExpiryDays = 7 | 30 | 90;
export const EXPIRY_OPTIONS: { value: ExpiryDays; label: string }[] = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
];
export const PASSCODE_MIN = 4;
export const PASSCODE_MAX = 64;
export const SHARE_PERMISSION_MESSAGE = "You don't have permission to share this report.";

/**
 * The columns `authenticated` may read. `passcode_hash`, `failed_attempts` and `locked_until` are
 * revoked at the column level — a share's secret material is the function's business, not the
 * dashboard's — so every read names its columns and a bare `select('*')` would 403.
 */
export const SHARE_COLUMNS =
  'id, report_id, artifact_id, token, created_by, created_at, expires_at, view_count, last_viewed_at, revoked_at, has_passcode';

export interface ReportShareRow {
  id: string;
  report_id: string;
  artifact_id: string;
  token: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  view_count: number;
  last_viewed_at: string | null;
  revoked_at: string | null;
  /**
   * `passcode_hash is not null`, generated and granted at the column level — the hash itself stays
   * revoked, so the list can say THAT a link is locked without ever reading what locks it. Read-only:
   * no write path sets it.
   */
  has_passcode: boolean;
}

/** The public URL a recipient opens. Same shape the distribution email builds from APP_URL. */
export const shareUrl = (token: string) => `${window.location.origin}/share/${token}`;

export const isActiveShare = (s: ReportShareRow, now = Date.now()) =>
  !s.revoked_at && new Date(s.expires_at).getTime() > now;

/** Validation, not coaching: rendered plainly, never through <Hint>. Empty = no passcode, which is allowed. */
export function passcodeProblem(p: string): string | null {
  if (!p) return null;
  if (p.length < PASSCODE_MIN) return `Passcode must be at least ${PASSCODE_MIN} characters.`;
  if (p.length > PASSCODE_MAX) return `Passcode must be at most ${PASSCODE_MAX} characters.`;
  return null;
}

export interface CreateShareInput {
  reportId: string;
  artifactId: string;
  expiresInDays: ExpiryDays;
  passcode?: string;
}

export const CREATE_FAILED_MESSAGE = 'Could not create the link.';
/** A token collision is a 1-in-2^258 fluke, not a user error: a fresh token is minted on the retry. */
export const TOKEN_TAKEN_MESSAGE = 'Could not create the link. Try again.';

/**
 * `supabase.functions.invoke` collapses every non-2xx into a FunctionsHttpError whose `message` is the
 * generic "Edge Function returned a non-2xx status code" — the real reason is the `{error}` body hanging
 * off `error.context` (a Response). Read it and map the codes report-share actually returns; anything
 * unrecognised (or a body that will not parse) falls back to the generic line rather than leaking a code.
 */
async function createErrorMessage(error: unknown): Promise<string> {
  const context = (error as { context?: { json?: () => Promise<unknown> } } | null)?.context;
  let code = '';
  if (typeof context?.json === 'function') {
    try {
      const body = (await context.json()) as { error?: unknown } | null;
      if (typeof body?.error === 'string') code = body.error;
    } catch { /* a non-JSON or already-read body tells us nothing */ }
  }
  if (code === 'forbidden' || code === 'unauthorized') return SHARE_PERMISSION_MESSAGE;
  if (code === 'token taken') return TOKEN_TAKEN_MESSAGE;
  return CREATE_FAILED_MESSAGE;
}

export async function createShare(
  input: CreateShareInput,
  userId: string,
): Promise<{ id: string; token: string; expiresAt: string }> {
  // The dialog validates too, but a direct caller must not be answered with an opaque 400.
  const problem = passcodeProblem(input.passcode ?? '');
  if (problem) throw new Error(problem);
  const token = mintToken();
  if (input.passcode) {
    // Only the function can write passcode_hash: the hash is peppered with a server-side salt.
    const { data, error } = await supabase.functions.invoke('report-share', {
      body: {
        action: 'create',
        reportId: input.reportId,
        artifactId: input.artifactId,
        token,
        expiresInDays: input.expiresInDays,
        passcode: input.passcode,
      },
    });
    if (error) throw new Error(await createErrorMessage(error));
    const created = data as { id?: unknown; token?: unknown; expiresAt?: unknown } | null;
    // A 2xx with no body would otherwise throw a TypeError on `data.id` and surface as a crash.
    if (typeof created?.id !== 'string' || typeof created.token !== 'string' || typeof created.expiresAt !== 'string') {
      throw new Error(CREATE_FAILED_MESSAGE);
    }
    return { id: created.id, token: created.token, expiresAt: created.expiresAt };
  }
  const expiresAt = new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from('report_shares')
    .insert({ report_id: input.reportId, artifact_id: input.artifactId, token, created_by: userId, expires_at: expiresAt })
    .select('id, token, expires_at');
  if (error) throw error;
  if (!data?.length) throw new Error(SHARE_PERMISSION_MESSAGE); // RLS filtered the insert silently
  return { id: data[0].id, token: data[0].token, expiresAt: data[0].expires_at };
}

export async function listShares(reportId: string): Promise<ReportShareRow[]> {
  const { data, error } = await supabase
    .from('report_shares')
    .select(SHARE_COLUMNS)
    .eq('report_id', reportId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ReportShareRow[];
}

/** Revocation is final: the update policy's `with check` refuses a row whose `revoked_at` is null again. */
export async function revokeShare(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('report_shares')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error(SHARE_PERMISSION_MESSAGE);
}

export function useReportShares(reportId: string | undefined) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const key = ['report-shares', reportId];
  const query = useQuery({ queryKey: key, enabled: !!reportId, queryFn: () => listShares(reportId!) });
  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const create = useMutation({
    mutationFn: (input: CreateShareInput) => createShare(input, user!.id),
    onSuccess: (_r, input) => {
      track('report_shared', { action: 'create', days: input.expiresInDays, passcode: !!input.passcode });
      void invalidate();
    },
  });

  const revoke = useMutation({
    mutationFn: revokeShare,
    onSuccess: () => {
      track('report_shared', { action: 'revoke' });
      void invalidate();
    },
  });

  return { ...query, shares: query.data ?? [], create, revoke };
}
