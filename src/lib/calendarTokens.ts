/**
 * ICS subscription tokens (spec §5.5, R3b).
 *
 * A token is a bearer secret: anyone holding the feed URL can read the calendar
 * titles for its scope. It is minted client-side (32 random bytes, base64url,
 * 43 chars), stored plain in `calendar_tokens` under owner-only RLS, and the
 * `ics-feed` edge function resolves it with the service role. Rotating a token
 * revokes the old row and inserts a fresh one, so a leaked link stops working.
 *
 * One active row per (user, scope): `building_id` null is the user's own feed;
 * a building id is the per-building feed (admin/manager surfaces only).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { track } from '@/lib/analytics';

/** 32 random bytes → base64url without padding → 43 chars. */
export function mintToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The https URL a calendar client fetches. */
export function feedUrl(token: string): string {
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ics-feed?t=${token}`;
}

/** The same URL with the `webcal://` scheme, which Outlook and Apple Calendar open as a subscription. */
export function webcalUrl(url: string): string {
  return url.replace(/^https?:\/\//i, 'webcal://');
}

interface TokenRow {
  id: string;
  token: string;
}

type Scope = 'me' | 'building';

/** Text every write path throws when RLS silently filtered the row instead of erroring. */
export const PERMISSION_MESSAGE = "You don't have permission to manage this calendar link.";

// PostgREST returns zero rows (not an error) when a write is filtered by RLS, so
// every write selects `id` back and treats an empty result as a permission failure.
function assertWrote(rows: { id: string }[] | null): void {
  if (!rows || rows.length === 0) throw new Error(PERMISSION_MESSAGE);
}

/** The one table this module touches, typed locally so reads and writes are checked. */
type CalendarTokensDb = {
  public: {
    Tables: {
      calendar_tokens: {
        Row: {
          id: string;
          user_id: string;
          building_id: string | null;
          token: string;
          label: string | null;
          created_at: string;
          last_used_at: string | null;
          revoked_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          building_id?: string | null;
          token: string;
          label?: string | null;
          created_at?: string;
          last_used_at?: string | null;
          revoked_at?: string | null;
        };
        Update: {
          label?: string | null;
          last_used_at?: string | null;
          revoked_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

// calendar_tokens is not yet in the generated types; regenerate after the migration ships.
const tokens = () => (supabase as unknown as SupabaseClient<CalendarTokensDb>).from('calendar_tokens');

async function readActive(uid: string, buildingId: string | null): Promise<TokenRow | null> {
  const base = tokens().select('id, token').eq('user_id', uid).is('revoked_at', null);
  const scoped = buildingId ? base.eq('building_id', buildingId) : base.is('building_id', null);
  const { data, error } = await scoped.order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function insertToken(uid: string, buildingId: string | null, label: string): Promise<void> {
  const { data, error } = await tokens()
    .insert({ user_id: uid, building_id: buildingId, token: mintToken(), label })
    .select('id');
  if (error) throw error;
  assertWrote(data);
}

async function revokeRow(id: string): Promise<void> {
  const { data, error } = await tokens()
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');
  if (error) throw error;
  assertWrote(data);
}

export interface CalendarTokenState {
  /** The active token for this scope, or null when none exists (or while loading). */
  token: string | null;
  /** `feedUrl(token)`, or null when there is no token. */
  url: string | null;
  isLoading: boolean;
  isError: boolean;
  /** True while create/rotate/revoke is in flight. */
  isMutating: boolean;
  create: () => Promise<void>;
  rotate: () => Promise<void>;
  revoke: () => Promise<void>;
}

/**
 * The caller's active calendar token for one scope (`buildingId` null = their
 * own feed). Writes select `id` back and treat zero rows as a permission error;
 * each write invalidates the scope's query and emits `calendar_feed` analytics.
 *
 * @param label stored on the row for the owner's reference; defaults per scope.
 */
export function useCalendarToken(buildingId: string | null, label?: string): CalendarTokenState {
  const { user } = useAuth();
  const uid = user?.id;
  const queryClient = useQueryClient();
  const scope: Scope = buildingId ? 'building' : 'me';
  const rowLabel = label ?? (buildingId ? 'Building feed' : 'My calendar');
  const queryKey = ['calendar-token', uid, buildingId ?? 'me'];

  const query = useQuery({
    queryKey,
    enabled: !!uid,
    staleTime: 60_000,
    queryFn: () => readActive(uid!, buildingId),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const createMutation = useMutation({
    mutationFn: async () => {
      await insertToken(uid!, buildingId, rowLabel);
    },
    onSuccess: () => { track('calendar_feed', { action: 'create', scope }); void invalidate(); },
  });

  const rotateMutation = useMutation({
    mutationFn: async () => {
      const current = query.data;
      if (current) await revokeRow(current.id);
      await insertToken(uid!, buildingId, rowLabel);
    },
    onSuccess: () => { track('calendar_feed', { action: 'rotate', scope }); void invalidate(); },
    // A revoke that landed before the insert failed still changed the row; refetch either way.
    onError: () => { void invalidate(); },
  });

  const revokeMutation = useMutation({
    mutationFn: async () => {
      const current = query.data;
      if (!current) return;
      await revokeRow(current.id);
    },
    onSuccess: () => { track('calendar_feed', { action: 'revoke', scope }); void invalidate(); },
  });

  const token = query.data?.token ?? null;
  return {
    token,
    url: token ? feedUrl(token) : null,
    isLoading: query.isLoading,
    isError: query.isError,
    isMutating: createMutation.isPending || rotateMutation.isPending || revokeMutation.isPending,
    create: () => createMutation.mutateAsync(),
    rotate: () => rotateMutation.mutateAsync(),
    revoke: () => revokeMutation.mutateAsync(),
  };
}
