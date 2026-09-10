/**
 * The organization's settings object (organizations.settings, R4a). One row per project, so the query has no
 * arguments. `save` writes the whole object: the editors are admin-only and rare, so last-write-wins is fine.
 * `useFeature` answers false while loading — a dark feature must never flash on.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { TablesUpdate } from '@/integrations/supabase/types';
import { DEFAULT_ORG_SETTINGS, parseOrgSettings, type FeatureName, type OrgSettings } from '@/lib/orgSettings';

export const ORG_SETTINGS_KEY = ['org-settings'] as const;

interface OrgSettingsData { id: string | null; settings: OrgSettings }

export function useOrgSettings() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ORG_SETTINGS_KEY,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<OrgSettingsData> => {
      const { data, error } = await supabase.from('organizations').select('*').limit(1).maybeSingle();
      if (error) throw error;
      // organizations.settings is not yet in the generated types; regenerate after the migration ships.
      const row = data as (typeof data & { settings?: unknown }) | null;
      return { id: row?.id ?? null, settings: parseOrgSettings(row?.settings) };
    },
  });

  const mutation = useMutation({
    mutationFn: async (next: OrgSettings): Promise<OrgSettings> => {
      const id = query.data?.id;
      if (!id) throw new Error('No organization row to save settings on.');
      // organizations.settings is not yet in the generated types; regenerate after the migration ships.
      const patch = { settings: next, updated_at: new Date().toISOString() } as unknown as TablesUpdate<'organizations'>;
      const { error } = await supabase.from('organizations').update(patch).eq('id', id);
      if (error) throw error;
      return next;
    },
    onSuccess: (next) => {
      qc.setQueryData<OrgSettingsData>(ORG_SETTINGS_KEY, (prev) => ({ id: prev?.id ?? null, settings: next }));
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
