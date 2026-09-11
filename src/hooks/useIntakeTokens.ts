/**
 * A building's tenant-intake link (spec §5.10). One ACTIVE row per building; the token is a
 * bearer secret minted client-side exactly like calendar tokens (32 random bytes, base64url) and
 * stored plain under admin/manager-by-building RLS. Rotating inserts the new row first and then
 * disables the old one, so a failed insert leaves the old link working rather than none. Nothing
 * is ever deleted: `submissions_count` is history.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { mintToken } from '@/lib/calendarTokens';
import { intakeUrl } from '@/lib/intakeForm';

export const intakeTokensKey = (buildingId: string | undefined) => ['intake-tokens', buildingId] as const;

/** Plain guardrail copy for a write RLS refused or filtered to nothing. */
export const INTAKE_PERMISSION_MESSAGE = "Only admins and managers can manage this building's intake link.";

export interface IntakeToken {
  id: string;
  building_id: string;
  token: string;
  label: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  last_used_at: string | null;
  submissions_count: number;
}
const TOKEN_COLUMNS = 'id, building_id, token, label, is_active, created_by, created_at, last_used_at, submissions_count';

interface PgError { code?: string; message?: string }
function assertWrote(error: PgError | null, rows: unknown[] | null | undefined): void {
  if (error) {
    if (error.code === '42501' || error.code === 'PGRST116') throw new Error(INTAKE_PERMISSION_MESSAGE);
    throw error;
  }
  if (!rows || rows.length === 0) throw new Error(INTAKE_PERMISSION_MESSAGE);
}

export async function readActiveToken(buildingId: string): Promise<IntakeToken | null> {
  const { data, error } = await supabase
    .from('intake_tokens')
    .select(TOKEN_COLUMNS)
    .eq('building_id', buildingId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function insertToken(uid: string, buildingId: string, label: string): Promise<IntakeToken> {
  const { data, error } = await supabase
    .from('intake_tokens')
    .insert({ building_id: buildingId, token: mintToken(), label, created_by: uid })
    .select(TOKEN_COLUMNS);
  assertWrote(error, data);
  return data![0];
}

async function disableToken(id: string): Promise<void> {
  const { data, error } = await supabase.from('intake_tokens').update({ is_active: false }).eq('id', id).select('id');
  assertWrote(error, data);
}

export interface IntakeTokensState {
  /** The active token row, or null when the building has no live link (or while loading). */
  token: IntakeToken | null;
  /** `intakeUrl(token)`, or null. */
  url: string | null;
  isLoading: boolean;
  isError: boolean;
  isMutating: boolean;
  create: () => Promise<void>;
  rotate: () => Promise<void>;
  disable: () => Promise<void>;
}

export function useIntakeTokens(buildingId: string | undefined, label = 'Tenant intake'): IntakeTokensState {
  const { user } = useAuth();
  const uid = user?.id;
  const qc = useQueryClient();
  const queryKey = intakeTokensKey(buildingId);

  const query = useQuery({
    queryKey,
    enabled: !!buildingId && !!uid,
    staleTime: 60_000,
    queryFn: () => readActiveToken(buildingId!),
  });
  const invalidate = () => { void qc.invalidateQueries({ queryKey }); };

  const create = useMutation({
    mutationFn: async () => { await insertToken(uid!, buildingId!, label); },
    onSuccess: invalidate,
  });
  const rotate = useMutation({
    mutationFn: async () => {
      const old = query.data ?? null;
      await insertToken(uid!, buildingId!, label);     // new link first …
      if (old) await disableToken(old.id);              // … then the old one stops working
    },
    onSuccess: invalidate,
  });
  const disable = useMutation({
    mutationFn: async () => { if (query.data) await disableToken(query.data.id); },
    onSuccess: invalidate,
  });

  const token = query.data ?? null;
  return {
    token,
    url: token ? intakeUrl(token.token) : null,
    isLoading: query.isLoading,
    isError: query.isError,
    isMutating: create.isPending || rotate.isPending || disable.isPending,
    create: async () => { await create.mutateAsync(); },
    rotate: async () => { await rotate.mutateAsync(); },
    disable: async () => { await disable.mutateAsync(); },
  };
}
