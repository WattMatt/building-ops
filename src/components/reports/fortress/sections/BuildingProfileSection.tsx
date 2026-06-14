/**
 * Annual · Building Location & Description Profile (§3 of the annual inspection).
 * The ~17 typed profile fields persist as a JSON object on reports.meta->'building_profile'
 * (camelCase keys, per SCHEMA_CONTRACT §2.1). These feed the building KPIs, so they are a
 * documented typed shape — not free-form. Orientation photos (§3, 4 slots) are handled by
 * the inspection photo pipeline, not here. Save-on-blur via the section Save button.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SectionCard } from '../SectionCard';
import { fdb } from '@/integrations/supabase/fortress-db';
import type { SectionProps } from './types';

const META_KEY = 'building_profile';

type FieldType = 'text' | 'number' | 'date' | 'textarea';
interface ProfileField {
  key: string;
  label: string;
  type: FieldType;
}

// 17 typed profile fields (fortress/16 §3 + fortress/13 §3 PROFILE archetype).
// camelCase keys are the documented persisted shape on reports.meta.building_profile.
const FIELDS: ProfileField[] = [
  { key: 'propertyAddress', label: 'Property address', type: 'textarea' },
  { key: 'practicalCompletion', label: 'Practical completion', type: 'date' },
  { key: 'yearBuilt', label: 'Year built', type: 'number' },
  { key: 'constructionType', label: 'Construction type', type: 'text' },
  { key: 'zoning', label: 'Zoning', type: 'text' },
  { key: 'erfNo', label: 'Erf no.', type: 'text' },
  { key: 'furtherExpansions', label: 'Further expansions', type: 'textarea' },
  { key: 'totalGlaSqm', label: 'Total GLA (m²)', type: 'number' },
  { key: 'currentVacancySqm', label: 'Current vacancy (m²)', type: 'number' },
  { key: 'parkingOpen', label: 'Parking — open bays', type: 'number' },
  { key: 'parkingCovered', label: 'Parking — covered bays', type: 'number' },
  { key: 'parkingShaded', label: 'Parking — shaded bays', type: 'number' },
  { key: 'parkingMotorbike', label: 'Parking — motorbike bays', type: 'number' },
  { key: 'parkingMomsAndTods', label: 'Parking — moms & tots bays', type: 'number' },
  { key: 'parkingDisabled', label: 'Parking — disabled bays', type: 'number' },
  { key: 'parkingTaxi', label: 'Parking — taxi bays', type: 'number' },
  { key: 'numberOfTenants', label: 'Number of tenants', type: 'number' },
  { key: 'nationalTenants', label: 'National tenants', type: 'number' },
  { key: 'privateTenants', label: 'Private tenants', type: 'number' },
  { key: 'anchorTenants', label: 'Anchor tenants', type: 'textarea' },
];

type Profile = Record<string, unknown>;

export default function BuildingProfileSection({ reportId, readOnly }: SectionProps) {
  const qc = useQueryClient();
  const key = ['fortress-building-profile', reportId];

  const query = useQuery({
    queryKey: key,
    enabled: !!reportId,
    queryFn: async (): Promise<Profile> => {
      const { data, error } = await fdb.from('reports').select('meta').eq('id', reportId).single();
      if (error) throw error;
      const meta = (data?.meta ?? {}) as Record<string, unknown>;
      return (meta[META_KEY] as Profile) ?? {};
    },
  });

  const [profile, setProfile] = useState<Profile>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const loaded = query.data;
  useEffect(() => { setProfile(loaded ? { ...loaded } : {}); setDirty(false); }, [loaded]);

  const set = (k: string, v: unknown) => { setProfile((p) => ({ ...p, [k]: v })); setDirty(true); };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Preserve sibling meta keys — only replace building_profile.
      const { data, error: readErr } = await fdb.from('reports').select('meta').eq('id', reportId).single();
      if (readErr) throw readErr;
      const meta = (data?.meta ?? {}) as Record<string, unknown>;
      const { error } = await fdb
        .from('reports')
        .update({ meta: { ...meta, [META_KEY]: profile } } as never)
        .eq('id', reportId);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: key });
      setDirty(false);
      toast.success('Section saved.');
    } catch (e) {
      if (import.meta.env.DEV) console.error('Save building profile failed:', e);
      toast.error('Could not save this section. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const grid = useMemo(() => FIELDS, []);

  return (
    <SectionCard
      title="Building Profile"
      hint="Property profile (§3). Feeds the building KPIs."
      onSave={handleSave}
      saving={saving}
      dirty={dirty}
      readOnly={readOnly}
    >
      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
          {grid.map((f) => (
            <label key={f.key} className={`space-y-1 text-sm ${f.type === 'textarea' ? 'sm:col-span-2' : ''}`}>
              <span className="text-muted-foreground">{f.label}</span>
              {f.type === 'textarea' ? (
                <Textarea
                  value={(profile[f.key] as string) ?? ''}
                  disabled={readOnly}
                  rows={2}
                  onChange={(e) => set(f.key, e.target.value || null)}
                />
              ) : (
                <Input
                  type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                  value={(profile[f.key] as string | number | null) ?? ''}
                  disabled={readOnly}
                  onChange={(e) => {
                    const raw = e.target.value;
                    set(f.key, raw === '' ? null : f.type === 'number' ? Number(raw) : raw);
                  }}
                />
              )}
            </label>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
