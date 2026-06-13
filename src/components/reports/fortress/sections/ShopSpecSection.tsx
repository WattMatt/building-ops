/** CM Shop Spec — per-tenant shop specification (versioned: one is_current row per
 *  tenant, not tied to a report). Seeded from the building's tenants. */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SectionCard } from '../SectionCard';
import { fdb, type TenantShopSpec } from '@/integrations/supabase/fortress-db';
import type { SectionProps } from './types';

type Tenant = { id: string; shop_number: string | null; shop_name: string | null; name: string | null };

const TEXT_FIELDS: { key: keyof TenantShopSpec; label: string }[] = [
  { key: 'actual_amps', label: 'Actual Amps' },
  { key: 'lease_amps', label: 'Lease Amps' },
  { key: 'hvac_units', label: 'HVAC Units' },
  { key: 'hvac_btu', label: 'HVAC BTU' },
  { key: 'lighting_type', label: 'Lighting' },
  { key: 'shopfront_type', label: 'Shopfront' },
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
      return { tenants: (tenants ?? []) as Tenant[], byTenant };
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
                        <SelectTrigger className="h-8 w-24"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="single">Single</SelectItem>
                          <SelectItem value="three">Three</SelectItem>
                        </SelectContent>
                      </Select>
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
