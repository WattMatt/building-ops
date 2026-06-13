/** CM Tenant OHS & HK — per-tenant compliance matrix. Rows are seeded from the
 *  building's tenants; each cell auto-saves. Keyed (building_id, tenant_id, period). */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SectionCard } from '../SectionCard';
import { fdb, type TenantCompliance, type YesNoNa } from '@/integrations/supabase/fortress-db';
import { useFortressReport } from '@/hooks/useFortressReports';
import type { SectionProps } from './types';

type Tenant = { id: string; shop_number: string | null; shop_name: string | null; name: string | null };

const YNS: { key: keyof TenantCompliance; label: string }[] = [
  { key: 'hvac_records_current', label: 'HVAC' },
  { key: 'generator_records_current', label: 'Generator' },
  { key: 'fire_sprinkler_annual', label: 'Sprinkler (yr)' },
  { key: 'smoke_detection_current', label: 'Smoke det.' },
  { key: 'handheld_fire_current', label: 'Extinguishers' },
  { key: 'evac_plan_displayed', label: 'Evac plan' },
];

function YnsCell({ value, disabled, onChange }: { value: YesNoNa | null; disabled: boolean; onChange: (v: YesNoNa) => void }) {
  return (
    <Select value={value ?? ''} onValueChange={(v) => onChange(v as YesNoNa)} disabled={disabled}>
      <SelectTrigger className="h-8 w-20"><SelectValue placeholder="—" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="yes">Yes</SelectItem>
        <SelectItem value="no">No</SelectItem>
        <SelectItem value="na">N/A</SelectItem>
      </SelectContent>
    </Select>
  );
}

export default function TenantComplianceSection({ reportId, buildingId, readOnly }: SectionProps) {
  const qc = useQueryClient();
  const { data: report } = useFortressReport(reportId);
  const period = report?.report_period ?? null;
  const key = ['fortress-tenant-compliance', reportId];

  const { data, isLoading } = useQuery({
    queryKey: key,
    enabled: !!buildingId && !!period,
    queryFn: async () => {
      const { data: tenants } = await fdb
        .from('building_tenants')
        .select('id, shop_number, shop_name, name')
        .eq('building_id', buildingId);
      const { data: rows } = await fdb
        .from('tenant_compliance')
        .select('*')
        .eq('building_id', buildingId)
        .eq('period', period!);
      const byTenant: Record<string, TenantCompliance> = {};
      for (const r of rows ?? []) if (r.tenant_id) byTenant[r.tenant_id] = r;
      return { tenants: (tenants ?? []) as Tenant[], byTenant };
    },
  });

  const setField = useCallback(
    async (tenantId: string, patch: Partial<TenantCompliance>) => {
      if (!period) return;
      const existing = data?.byTenant[tenantId];
      const { error } = await fdb.from('tenant_compliance').upsert(
        {
          id: existing?.id ?? crypto.randomUUID(),
          report_id: reportId,
          building_id: buildingId,
          tenant_id: tenantId,
          period,
          ...patch,
        } as never,
        { onConflict: 'building_id,tenant_id,period' },
      );
      if (error) { if (import.meta.env.DEV) console.error(error); toast.error('Could not save that cell.'); return; }
      qc.invalidateQueries({ queryKey: key });
    },
    [data, period, reportId, buildingId, qc, key],
  );

  const tenantLabel = (t: Tenant) => t.shop_name || t.name || t.shop_number || 'Tenant';

  return (
    <SectionCard title="Tenant OHS & HK" hint="Per-tenant compliance. Seeded from the building's tenants; each cell saves on change.">
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
                <TableHead>Occupancy Cert #</TableHead>
                <TableHead>COC Resp.</TableHead>
                {YNS.map((c) => <TableHead key={String(c.key)}>{c.label}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.tenants.map((t) => {
                const row = data.byTenant[t.id];
                return (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{tenantLabel(t)}</TableCell>
                    <TableCell>
                      <Input
                        className="h-8 w-32"
                        defaultValue={row?.occupancy_cert_no ?? ''}
                        disabled={readOnly}
                        onBlur={(e) => { if (!readOnly && e.target.value !== (row?.occupancy_cert_no ?? '')) setField(t.id, { occupancy_cert_no: e.target.value || null }); }}
                      />
                    </TableCell>
                    <TableCell>
                      <Select value={row?.electrical_coc_responsibility ?? ''} onValueChange={(v) => !readOnly && setField(t.id, { electrical_coc_responsibility: v })} disabled={readOnly}>
                        <SelectTrigger className="h-8 w-24"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="tenant">Tenant</SelectItem>
                          <SelectItem value="ll">Landlord</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    {YNS.map((c) => (
                      <TableCell key={String(c.key)}>
                        <YnsCell
                          value={(row?.[c.key] as YesNoNa | null) ?? null}
                          disabled={readOnly}
                          onChange={(v) => setField(t.id, { [c.key]: v } as Partial<TenantCompliance>)}
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
