/**
 * Tiny inline SVG line for a header chip: no axes, no library. Null gaps are skipped (the line joins the
 * neighbouring points); fewer than two numeric points renders nothing rather than a dot pretending to be a trend.
 */
import { cn } from '@/lib/utils';

export interface SparklineProps {
  values: (number | null)[];
  width?: number;
  height?: number;
  /** Fixed scale (e.g. 0–100 for percentages); defaults to the data's own min/max. */
  min?: number;
  max?: number;
  className?: string;
  /** Accessible name, e.g. "OHS compliance, last 90 days". */
  label: string;
}

export function Sparkline({ values, width = 72, height = 20, min, max, className, label }: SparklineProps) {
  const pts = values.map((v, i) => (v === null ? null : { i, v })).filter((p): p is { i: number; v: number } => p !== null);
  if (pts.length < 2) return null;
  const lo = min ?? Math.min(...pts.map((p) => p.v));
  const hi = max ?? Math.max(...pts.map((p) => p.v));
  const span = hi - lo || 1;
  const n = values.length - 1 || 1;
  const x = (i: number) => (i / n) * (width - 2) + 1;
  const y = (v: number) => height - 1 - ((v - lo) / span) * (height - 2);
  const d = pts.map((p) => `${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg role="img" aria-label={label} width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn('shrink-0 overflow-visible', className)}>
      <polyline points={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.i)} cy={y(last.v)} r={1.8} fill="currentColor" />
    </svg>
  );
}
