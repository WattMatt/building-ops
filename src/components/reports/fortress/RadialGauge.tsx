/** SVG ring gauge for a 0–100 percentage, colour-banded by `classify(value, threshold)`
 *  (emerald/amber/destructive — the same palette as the OHS tab bars). Shows the number
 *  in the centre, a label below, and an honest "—" empty state when value is null. */
import { classify, type KpiThreshold } from '@/lib/fortressKpis';
import { cn } from '@/lib/utils';

interface Props {
  value: number | null | undefined;
  threshold?: KpiThreshold;
  label: string;
  size?: number;
}

// Status → ring stroke colour (matches the section-bar palette in OhsComplianceTab).
const RING_CLASS: Record<string, string> = {
  good: 'stroke-emerald-500',
  warn: 'stroke-amber-500',
  bad: 'stroke-destructive',
  info: 'stroke-muted-foreground/40',
};
const TEXT_CLASS: Record<string, string> = {
  good: 'text-emerald-600',
  warn: 'text-amber-600',
  bad: 'text-destructive',
  info: 'text-muted-foreground',
};

export function RadialGauge({ value, threshold, label, size = 132 }: Props) {
  const status = classify(value, threshold);
  const hasValue = value !== null && value !== undefined && !Number.isNaN(value);
  const pct = hasValue ? Math.max(0, Math.min(100, value)) : 0;

  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" strokeWidth={stroke}
          className="stroke-muted"
        />
        {hasValue && (
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none" strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={offset}
            className={cn('transition-[stroke-dashoffset] duration-500', RING_CLASS[status])}
          />
        )}
        <text
          x="50%" y="50%"
          textAnchor="middle" dominantBaseline="central"
          className={cn('rotate-90 origin-center text-2xl font-semibold tabular-nums', TEXT_CLASS[status])}
          fill="currentColor"
        >
          {hasValue ? `${value}%` : '—'}
        </text>
      </svg>
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
    </div>
  );
}
