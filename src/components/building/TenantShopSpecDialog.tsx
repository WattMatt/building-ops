/** Standalone per-tenant Shop Spec capture form (modal). Edits the tenant's
 *  current versioned spec (tenant_shop_spec, is_current=true) independently of any
 *  report — the second capture surface alongside the in-report ShopSpecSection grid. */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { fdb, type TenantShopSpec, type YesNoNa } from '@/integrations/supabase/fortress-db';
import { YnsCell } from '@/components/reports/fortress/YnsCell';

interface Tenant {
  id: string;
  shop_number: string;
  shop_name: string;
}

interface TenantShopSpecDialogProps {
  tenant: Tenant;
  buildingId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Distribution-board phase options matching the source/data format
 *  (the legacy 'single'/'three' values never matched the ingested data). */
export const DB_PHASE_OPTIONS = ['1 - Single Phase', '3 - Three phase', 'N/A'];

/** Free-text fields grouped for a readable vertical form. */
const GROUPS: { group: string; fields: { key: keyof TenantShopSpec; label: string }[] }[] = [
  { group: 'Distribution Boards', fields: [
    { key: 'actual_amps', label: 'Actual Amps' },
    { key: 'lease_amps', label: 'Lease Amps' },
  ] },
  { group: 'HVAC', fields: [
    { key: 'hvac_units', label: 'HVAC Units' },
    { key: 'hvac_btu', label: 'HVAC BTU' },
    { key: 'hvac_gas', label: 'HVAC Gas' },
  ] },
  { group: 'Finishes & Structure', fields: [
    { key: 'lighting_type', label: 'Lighting Type' },
    { key: 'shopfront_type', label: 'Shopfront Type' },
    { key: 'roller_shutter_type', label: 'Roller Shutter Type' },
    { key: 'ceiling_structure', label: 'Ceiling Structure' },
    { key: 'ceiling_height', label: 'Ceiling Height' },
    { key: 'floor_finish', label: 'Floor Finish' },
    { key: 'walls', label: 'Walls' },
    { key: 'wall_finish', label: 'Wall Finish' },
  ] },
  { group: 'Plumbing', fields: [
    { key: 'plumbing_sink', label: 'Plumbing Sink' },
  ] },
];

type FormState = Record<string, string | number | null | undefined>;

export default function TenantShopSpecDialog({ tenant, buildingId, open, onOpenChange }: TenantShopSpecDialogProps) {
  const { isAdminOrManager } = useAuth();
  const readOnly = !isAdminOrManager;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({});

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await fdb
        .from('tenant_shop_spec')
        .select('*')
        .eq('tenant_id', tenant.id)
        .eq('is_current', true)
        .maybeSingle();
      if (cancelled) return;
      if (error && import.meta.env.DEV) console.error(error);
      const spec = (data as TenantShopSpec | null) ?? null;
      setExistingId(spec?.id ?? null);
      setForm((spec as FormState) ?? {});
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, tenant.id]);

  const set = useCallback((key: string, value: string | number | null) => {
    setForm((f) => ({ ...f, [key]: value }));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const norm = (v: unknown) => (v === '' || v === undefined ? null : v);
      const patch: Partial<TenantShopSpec> = {
        db_phase: norm(form.db_phase) as string | null,
        actual_amps: norm(form.actual_amps) as string | null,
        lease_amps: norm(form.lease_amps) as string | null,
        generator_connection: (norm(form.generator_connection) as YesNoNa | null) ?? null,
        hvac_units: norm(form.hvac_units) as string | null,
        hvac_btu: norm(form.hvac_btu) as string | null,
        hvac_gas: norm(form.hvac_gas) as string | null,
        lighting_type: norm(form.lighting_type) as string | null,
        shopfront_type: norm(form.shopfront_type) as string | null,
        roller_shutter_type: norm(form.roller_shutter_type) as string | null,
        ceiling_structure: norm(form.ceiling_structure) as string | null,
        ceiling_height: norm(form.ceiling_height) as string | null,
        floor_finish: norm(form.floor_finish) as string | null,
        walls: norm(form.walls) as string | null,
        wall_finish: norm(form.wall_finish) as string | null,
        plumbing_toilets: form.plumbing_toilets === '' || form.plumbing_toilets == null ? null : Number(form.plumbing_toilets),
        plumbing_sink: norm(form.plumbing_sink) as string | null,
        notes: norm(form.notes) as string | null,
      };
      if (existingId) {
        const { error } = await fdb.from('tenant_shop_spec').update(patch as never).eq('id', existingId);
        if (error) throw error;
      } else {
        const { error } = await fdb.from('tenant_shop_spec').insert({
          id: crypto.randomUUID(), building_id: buildingId, tenant_id: tenant.id, is_current: true, ...patch,
        } as never);
        if (error) throw error;
      }
      toast.success('Shop spec saved');
      onOpenChange(false);
    } catch (e: unknown) {
      if (import.meta.env.DEV) console.error(e);
      toast.error('Could not save shop spec.');
    } finally {
      setSaving(false);
    }
  };

  const phaseOptions = (() => {
    const cur = (form.db_phase as string | null) || '';
    return cur && !DB_PHASE_OPTIONS.includes(cur) ? [cur, ...DB_PHASE_OPTIONS] : DB_PHASE_OPTIONS;
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Shop Spec — {tenant.shop_number}: {tenant.shop_name}</DialogTitle>
          <DialogDescription>
            Per-tenant shop specification (current version). {readOnly ? 'Read-only.' : 'Edit and save to update the active spec.'}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Distribution Boards (incl. phase + generator) */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground">Distribution Boards</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>DB Phase</Label>
                  <Select value={(form.db_phase as string | null) ?? ''} onValueChange={(v) => !readOnly && set('db_phase', v)} disabled={readOnly}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      {phaseOptions.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Generator Connection</Label>
                  <YnsCell
                    value={(form.generator_connection as YesNoNa | null) ?? null}
                    disabled={readOnly}
                    onChange={(v) => !readOnly && set('generator_connection', v)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Actual Amps</Label>
                  <Input value={(form.actual_amps as string | null) ?? ''} disabled={readOnly} onChange={(e) => set('actual_amps', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Lease Amps</Label>
                  <Input value={(form.lease_amps as string | null) ?? ''} disabled={readOnly} onChange={(e) => set('lease_amps', e.target.value)} />
                </div>
              </div>
            </div>

            {GROUPS.filter((g) => g.group !== 'Distribution Boards').map((g) => (
              <div key={g.group} className="space-y-3">
                <h3 className="text-sm font-semibold text-muted-foreground">{g.group}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {g.fields.map((f) => (
                    <div key={String(f.key)} className="space-y-2">
                      <Label>{f.label}</Label>
                      <Input
                        value={(form[f.key as string] as string | null) ?? ''}
                        disabled={readOnly}
                        onChange={(e) => set(f.key as string, e.target.value)}
                      />
                    </div>
                  ))}
                  {g.group === 'Plumbing' && (
                    <div className="space-y-2">
                      <Label>No. of Toilets</Label>
                      <Input
                        type="number"
                        min={0}
                        value={(form.plumbing_toilets as number | null) ?? ''}
                        disabled={readOnly}
                        onChange={(e) => set('plumbing_toilets', e.target.value === '' ? null : Number(e.target.value))}
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Notes */}
            <div className="space-y-2">
              <Label>Notes</Label>
              <Input value={(form.notes as string | null) ?? ''} disabled={readOnly} onChange={(e) => set('notes', e.target.value)} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {!readOnly && (
            <Button type="button" onClick={handleSave} disabled={saving || loading}>
              {saving ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</>) : 'Save'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
