/** CM Building Turnover — single record per report. growth_pct is computed (read-only),
 *  mirroring the v_building_turnover view. Saves the one row via the shared section hook. */
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SectionCard } from '../SectionCard';
import { useReportSection } from '@/hooks/useReportSection';
import { formatPct } from '@/lib/fortressReports';
import type { SectionProps } from './types';

type Row = Record<string, unknown> & { id?: string };

const FIELDS: { key: string; label: string }[] = [
  { key: 'current_month_total', label: 'Current Month Total' },
  { key: 'previous_year_month_total', label: 'Prev-Year Month Total' },
  { key: 'annual_trading_density', label: 'Annual Trading Density' },
  { key: 'spend_per_head', label: 'Spend per Head' },
];

export default function BuildingTurnoverSection({ reportId, buildingId, readOnly }: SectionProps) {
  const { rows, isLoading, saveAll, isSaving } = useReportSection<Row>('building_turnover', reportId);
  const [row, setRow] = useState<Row>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => { setRow(rows[0] ? { ...rows[0] } : {}); setDirty(false); }, [rows]);

  const set = (k: string, v: unknown) => { setRow((r) => ({ ...r, [k]: v })); setDirty(true); };

  const growth = (() => {
    const cur = Number(row.current_month_total);
    const prev = Number(row.previous_year_month_total);
    if (!prev || Number.isNaN(cur) || Number.isNaN(prev)) return null;
    return Math.round(((cur - prev) / prev) * 1000) / 10;
  })();

  const save = async () => { await saveAll([{ ...row, building_id: buildingId }] as never); setDirty(false); };

  return (
    <SectionCard title="Building Turnover" hint="Centre trading performance. Growth % is computed." onSave={save} saving={isSaving} dirty={dirty} readOnly={readOnly}>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <label key={f.key} className="space-y-1 text-sm">
              <span className="text-muted-foreground">{f.label}</span>
              <Input
                type="number"
                value={(row[f.key] as number | string | null) ?? ''}
                disabled={readOnly}
                onChange={(e) => set(f.key, e.target.value === '' ? null : Number(e.target.value))}
              />
            </label>
          ))}
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Growth % (computed)</span>
            <Input value={formatPct(growth)} disabled readOnly />
          </label>
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="text-muted-foreground">CM Comment</span>
            <Textarea value={(row.cm_comment as string) ?? ''} disabled={readOnly} onChange={(e) => set('cm_comment', e.target.value || null)} />
          </label>
        </div>
      )}
    </SectionCard>
  );
}
