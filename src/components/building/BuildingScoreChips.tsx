import { ShieldCheck, ShieldOff, ListChecks } from 'lucide-react';
import { cn } from '@/lib/utils';
import { classify, STATUS_CLASS, THRESHOLDS, type KpiThreshold } from '@/lib/fortressKpis';
import { Sparkline } from '@/components/ui/sparkline';
import { formatAsOf } from '@/lib/snapshotClient';

function Chip({ label, value, threshold, icon, noDataIcon, noDataTitle, trend, trendLabel }: {
  label: string; value: number | null; threshold: KpiThreshold; icon: React.ReactNode; noDataIcon: React.ReactNode; noDataTitle: string;
  trend?: (number | null)[]; trendLabel: string;
}) {
  const isNull = value === null;
  const c = STATUS_CLASS[classify(value, threshold)];
  return (
    <span title={isNull ? noDataTitle : undefined}
      className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium tabular-nums', isNull ? 'bg-muted text-muted-foreground' : c.badge)}>
      {isNull ? noDataIcon : icon}
      {label} {isNull ? '—' : `${value}%`}
      {trend && <Sparkline values={trend} min={0} max={100} width={56} height={16} label={trendLabel} className="opacity-80" />}
    </span>
  );
}

export interface BuildingScoreChipsProps {
  ohsPct: number | null;
  taskPct: number | null;
  ohsTrend?: (number | null)[];
  taskTrend?: (number | null)[];
  /** computed_at of the snapshot the numbers came from; shown as a caption. */
  asOf?: string | null;
}

export function BuildingScoreChips({ ohsPct, taskPct, ohsTrend, taskTrend, asOf }: BuildingScoreChipsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Chip label="OHS" value={ohsPct} threshold={THRESHOLDS.compliance} icon={<ShieldCheck className="h-3.5 w-3.5" />}
        noDataIcon={<ShieldOff className="h-3.5 w-3.5" />} noDataTitle="No approved OPS report" trend={ohsTrend} trendLabel="OHS compliance trend" />
      <Chip label="Tasks" value={taskPct} threshold={THRESHOLDS.taskCompletion} icon={<ListChecks className="h-3.5 w-3.5" />}
        noDataIcon={<ListChecks className="h-3.5 w-3.5" />} noDataTitle="No tasks in the last 30 days" trend={taskTrend} trendLabel="Task completion trend" />
      {/* Plain caption, not a <Hint>: data provenance must stay visible with hints off. */}
      {asOf && <span className="text-[11px] text-muted-foreground" title="From the nightly snapshot">as of {formatAsOf(asOf)}</span>}
    </div>
  );
}
