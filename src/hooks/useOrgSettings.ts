/**
 * The organization's settings object (organizations.settings, R4a). One row per project, so the query has no
 * arguments. `save` merges into the stored jsonb rather than replacing it: keys this build does not know
 * (a later release's flag, a value written by SQL) survive a save from an older client, and `sla_hours` /
 * `features` are merged one level down for the same reason. The editors are admin-only and rare, so
 * last-write-wins on the known keys is fine. `useFeature` answers false while loading — a dark feature must
 * never flash on.
 *
 * Note: `organizations` is authenticated-only after the R4a migration; an anonymous page (R4c tenant intake)
 * cannot read a flag through this hook and must get it from its edge function's GET instead.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { DEFAULT_ORG_SETTINGS, obj, parseOrgSettings, type FeatureName, type JsonObject, type OrgSettings } from '@/lib/orgSettings';

export const ORG_SETTINGS_KEY = ['org-settings'] as const;

interface OrgSettingsData {
  id: string | null;
  /** The jsonb as stored, unknown keys included — the base every save merges into. */
  raw: JsonObject;
  settings: OrgSettings;
}

/** The stored jsonb with `next` laid over it; `sla_hours` and `features` merge per key so unknown entries survive. */
export function mergeOrgSettings(raw: JsonObject, next: OrgSettings): JsonObject {
  return {
    ...raw,
    ...next,
    sla_hours: { ...obj(raw.sla_hours), ...next.sla_hours },
    features: { ...obj(raw.features), ...next.features },
  };
}

export function useOrgSettings() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ORG_SETTINGS_KEY,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<OrgSettingsData> => {
      const { data, error } = await supabase.from('organizations').select('id, settings').limit(1).maybeSingle();
      if (error) throw error;
      const raw = obj(data?.settings);
      return { id: data?.id ?? null, raw, settings: parseOrgSettings(raw) };
    },
  });

  const mutation = useMutation({
    mutationFn: async (next: OrgSettings): Promise<JsonObject> => {
      const current = qc.getQueryData<OrgSettingsData>(ORG_SETTINGS_KEY);
      const id = current?.id;
      if (!id) throw new Error('No organization row to save settings on.');
      // A refetch landing mid-save would overwrite the optimistic cache with the pre-save row.
      await qc.cancelQueries({ queryKey: ORG_SETTINGS_KEY });
      const merged = mergeOrgSettings(current?.raw ?? {}, next);
      const { error } = await supabase.from('organizations').update({ settings: merged, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      return merged;
    },
    onSuccess: (merged) => {
      qc.setQueryData<OrgSettingsData>(ORG_SETTINGS_KEY, (prev) => ({ id: prev?.id ?? null, raw: merged, settings: parseOrgSettings(merged) }));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ORG_SETTINGS_KEY });
    },
  });

  return {
    settings: query.data?.settings ?? DEFAULT_ORG_SETTINGS,
    organizationId: query.data?.id ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    save: mutation.mutateAsync,
    isSaving: mutation.isPending,
  };
}

export function useFeature(name: FeatureName): boolean {
  const { settings, isLoading } = useOrgSettings();
  return !isLoading && settings.features[name];
}
