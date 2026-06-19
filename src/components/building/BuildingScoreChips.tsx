import { ShieldCheck, ShieldOff, ListChecks } from 'lucide-react';
import { cn } from '@/lib/utils';
import { classify, STATUS_CLASS, THRESHOLDS, type KpiThreshold } from '@/lib/fortressKpis';

function Chip({
  label, value, threshold, icon, noDataIcon, noDataTitle,
}: {
  label: string;
  value: number | null;
  threshold: KpiThreshold;
  icon: React.ReactNode;
  noDataIcon: React.ReactNode;
  noDataTitle: string;
}) {
  const isNull = value === null;
  const c = STATUS_CLASS[classify(value, threshold)];
  return (
    <span
      title={isNull ? noDataTitle : undefined}
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium tabular-nums',
        isNull ? 'bg-muted text-muted-foreground' : c.badge,
      )}
    >
      {isNull ? noDataIcon : icon}
      {label} {isNull ? '—' : `${value}%`}
    </span>
  );
}

export function BuildingScoreChips({ ohsPct, taskPct }: { ohsPct: number | null; taskPct: number | null }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Chip
        label="OHS"
        value={ohsPct}
        threshold={THRESHOLDS.compliance}
        icon={<ShieldCheck className="h-3.5 w-3.5" />}
        noDataIcon={<ShieldOff className="h-3.5 w-3.5" />}
        noDataTitle="No approved OPS report"
      />
      <Chip
        label="Tasks"
        value={taskPct}
        threshold={THRESHOLDS.taskCompletion}
        icon={<ListChecks className="h-3.5 w-3.5" />}
        noDataIcon={<ListChecks className="h-3.5 w-3.5" />}
        noDataTitle="No tasks in the last 30 days"
      />
    </div>
  );
}
