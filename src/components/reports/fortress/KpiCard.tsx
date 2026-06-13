/** A single KPI tile: value (formatted), label, threshold colour band, optional sub. */
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatZAR } from '@/lib/fortressReports';
import { STATUS_CLASS } from '@/lib/fortressKpis';
import type { Kpi } from '@/hooks/useBuildingKpis';

function formatValue(k: Kpi): string {
  if (k.value === null || k.value === undefined) return '—';
  switch (k.format) {
    case 'pct': return `${k.value}%`;
    case 'zar': return formatZAR(k.value);
    case 'count': return String(k.value);
    default: return Number(k.value).toLocaleString('en-ZA');
  }
}

export function KpiCard({ kpi }: { kpi: Kpi }) {
  const c = STATUS_CLASS[kpi.status];
  return (
    <Card className={cn('ring-1', c.ring)}>
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{kpi.label}</p>
        <p className={cn('mt-1 text-2xl font-semibold tabular-nums', c.text)}>{formatValue(kpi)}</p>
        {kpi.sub && <p className="mt-0.5 text-xs text-muted-foreground">{kpi.sub}</p>}
      </CardContent>
    </Card>
  );
}
