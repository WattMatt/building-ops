/** CM Shop Spec — per-tenant shop specification (versioned: one is_current row per
 *  tenant, not tied to a report). Seeded from the building's tenants. */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SectionCard } from '../SectionCard';
import { fdb, type TenantShopSpec, type YesNoNa } from '@/integrations/supabase/fortress-db';
import { byShopNumber } from '@/lib/tenantSort';
import { YnsCell } from '../YnsCell';
import type { SectionProps } from './types';

type Tenant = { id: string; shop_number: string | null; shop_name: string | null; name: string | null };

/** DB-phase options matching the ingested data format (legacy 'single'/'three' never matched). */
const DB_PHASE_OPTIONS = ['1 - Single Phase', '3 - Three phase', 'N/A'];

const TEXT_FIELDS: { key: keyof TenantShopSpec; label: string }[] = [
  // DISTRIBUTION BOARDS
  { key: 'actual_amps', label: 'Actual Amps' },
  { key: 'lease_amps', label: 'Lease Amps' },
  // HVAC
  { key: 'hvac_units', label: 'HVAC Units' },
  { key: 'hvac_btu', label: 'HVAC BTU' },
  { key: 'hvac_gas', label: 'HVAC Gas' },
  // TYPE OF LIGHTFITTINGS
  { key: 'lighting_type', label: 'Lighting' },
  // SHOP FRONT
  { key: 'shopfront_type', label: 'Shopfront' },
  // ROLLER SHUTTER
  { key: 'roller_shutter_type', label: 'Roller Shutter' },
  // CEILING
  { key: 'ceiling_structure', label: 'Ceiling Structure' },
  { key: 'ceiling_height', label: 'Ceiling Height' },
  // FLOOR FINISH
  { key: 'floor_finish', label: 'Floor Finish' },
  // STRUCTURE
  { key: 'walls', label: 'Walls' },
  { key: 'wall_finish', label: 'Wall Finish' },
  // PLUMBING (plumbing_toilets is numeric — rendered separately)
  { key: 'plumbing_sink', label: 'Plumbing Sink' },
  { key: 'notes', label: 'Notes' },
];

export default function ShopSpecSection({ buildingId, readOnly }: SectionProps) {
  const qc = useQueryClient();
  const key = ['fortress-shop-spec', buildingId];

  const { data, isLoading } = useQuery({
    queryKey: key,
    enabled: !!buildingId,
    queryFn: async () => {
      const { data: tenants } = await fdb
        .from('building_tenants')
        .select('id, shop_number, shop_name, name')
        .eq('building_id', buildingId);
      const { data: specs } = await fdb
        .from('tenant_shop_spec')
        .select('*')
        .eq('building_id', buildingId)
        .eq('is_current', true);
      const byTenant: Record<string, TenantShopSpec> = {};
      for (const s of specs ?? []) if (s.tenant_id) byTenant[s.tenant_id] = s;
      return { tenants: ((tenants ?? []) as Tenant[]).sort(byShopNumber), byTenant };
    },
  });

  const setField = useCallback(
    async (tenantId: string, patch: Partial<TenantShopSpec>) => {
      const existing = data?.byTenant[tenantId];
      if (existing?.id) {
        const { error } = await fdb.from('tenant_shop_spec').update(patch as never).eq('id', existing.id);
        if (error) { if (import.meta.env.DEV) console.error(error); toast.error('Could not save.'); return; }
      } else {
        const { error } = await fdb.from('tenant_shop_spec').insert({
          id: crypto.randomUUID(), building_id: buildingId, tenant_id: tenantId, is_current: true, ...patch,
        } as never);
        if (error) { if (import.meta.env.DEV) console.error(error); toast.error('Could not save.'); return; }
      }
      qc.invalidateQueries({ queryKey: key });
    },
    [data, buildingId, qc, key],
  );

  const tenantLabel = (t: Tenant) => t.shop_name || t.name || t.shop_number || 'Tenant';

  return (
    <SectionCard title="Shop Spec" hint="Per-tenant shop specification. Only changes on refit — defaults to the current spec.">
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading tenants…</p>
      ) : !data?.tenants.length ? (
        <p className="text-sm text-muted-foreground">No tenants on file for this building.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-40">Tenant</TableHead>
                <TableHead>DB Phase</TableHead>
                <TableHead>Generator</TableHead>
                <TableHead>Toilets</TableHead>
                {TEXT_FIELDS.map((f) => <TableHead key={String(f.key)}>{f.label}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.tenants.map((t) => {
                const spec = data.byTenant[t.id];
                return (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{tenantLabel(t)}</TableCell>
                    <TableCell>
                      <Select value={spec?.db_phase ?? ''} onValueChange={(v) => !readOnly && setField(t.id, { db_phase: v })} disabled={readOnly}>
                        <SelectTrigger className="h-8 w-36"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          {(spec?.db_phase && !DB_PHASE_OPTIONS.includes(spec.db_phase)
                            ? [spec.db_phase, ...DB_PHASE_OPTIONS]
                            : DB_PHASE_OPTIONS).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <YnsCell
                        value={(spec?.generator_connection as YesNoNa | null) ?? null}
                        disabled={readOnly}
                        onChange={(v) => !readOnly && setField(t.id, { generator_connection: v } as Partial<TenantShopSpec>)}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-8 w-20"
                        type="number"
                        min={0}
                        defaultValue={spec?.plumbing_toilets ?? ''}
                        disabled={readOnly}
                        onBlur={(e) => {
                          if (readOnly) return;
                          const next = e.target.value === '' ? null : Number(e.target.value);
                          if (next !== (spec?.plumbing_toilets ?? null) && !Number.isNaN(next)) setField(t.id, { plumbing_toilets: next });
                        }}
                      />
                    </TableCell>
                    {TEXT_FIELDS.map((f) => (
                      <TableCell key={String(f.key)}>
                        <Input
                          className="h-8 w-28"
                          defaultValue={(spec?.[f.key] as string | null) ?? ''}
                          disabled={readOnly}
                          onBlur={(e) => { if (!readOnly && e.target.value !== ((spec?.[f.key] as string | null) ?? '')) setField(t.id, { [f.key]: e.target.value || null } as Partial<TenantShopSpec>); }}
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </SectionCard>
  );
}
