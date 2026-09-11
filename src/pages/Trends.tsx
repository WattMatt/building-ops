/**
 * Portfolio trends from the nightly snapshots: four lines over 30/90/365 days and a leaderboard of the
 * buildings whose compliance moved most. The one recharts import outside the OHS tab; loaded lazily.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { usePortfolioTrend } from '@/hooks/usePortfolioTrend';
import { useBuildingsTrends } from '@/hooks/useBuildingTrend';
import { useBuildingNames } from '@/hooks/useBuildingNames';
import { deltaLeaderboard, reconstructionBoundary } from '@/lib/trendSeries';
import { num, type PortfolioRow } from '@/lib/snapshotClient';
import type { CsvColumn } from '@/lib/exportCsv';
import { formatBuildingName } from '@/lib/buildingName';
import { Button } from '@/components/ui/button';
import { ExportCsvButton } from '@/components/ui/export-csv-button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Hint } from '@/components/ui/hint';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const RANGES = [30, 90, 365] as const;
type Range = (typeof RANGES)[number];

/** Every snapshot column, in the order the page reads them; the button dates the filename itself. */
const TREND_CSV_COLUMNS: CsvColumn<PortfolioRow>[] = [
  { key: 'day', header: 'Day' }, { key: 'buildings', header: 'Buildings' }, { key: 'compliance_avg', header: 'Compliance avg %' },
  { key: 'critical_avg', header: 'Critical avg %' }, { key: 'task_completion_avg', header: 'Task completion avg %' },
  { key: 'tasks_overdue', header: 'Overdue tasks' }, { key: 'issues_open', header: 'Open issues' }, { key: 'issues_breached', header: 'SLA breached' },
  { key: 'docs_expiring_30', header: 'Docs expiring 30d' }, { key: 'docs_expiring_60', header: 'Docs expiring 60d' }, { key: 'docs_expiring_90', header: 'Docs expiring 90d' },
  { key: 'docs_expired', header: 'Docs expired' }, { key: 'assets_overdue', header: 'Assets overdue' },
];

/** A chart plots the sum of `keys` per day: one column for most, building + contractor documents for expiry. */
interface ChartSpec { id: string; keys: (keyof PortfolioRow)[]; title: string; pct?: boolean }
const CHARTS: ChartSpec[] = [
  { id: 'compliance', keys: ['compliance_avg'], title: 'OHS compliance (portfolio average)', pct: true },
  { id: 'issues', keys: ['issues_open'], title: 'Open issues' },
  { id: 'tasks', keys: ['tasks_overdue'], title: 'Overdue tasks' },
  { id: 'docs', keys: ['docs_expiring_30', 'contractor_docs_expiring_30'], title: 'Documents expiring within 30 days' },
];

/** Sum of the named columns, or null when none of them holds a number (a gap the line must not bridge). */
function sumColumns(row: PortfolioRow, keys: (keyof PortfolioRow)[]): number | null {
  let total: number | null = null;
  for (const k of keys) {
    const v = num(row[k]);
    if (v !== null) total = (total ?? 0) + v;
  }
  return total;
}

/** Tick labels show MM-DD; the axis itself is keyed on the full day so two years' 09-10 never collide. */
const tickDay = (day: string) => day.slice(5);
// Theme tokens, so the tooltip is legible on the dark background too (recharts defaults to white/black).
const TOOLTIP_STYLE = { backgroundColor: 'hsl(var(--popover))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--popover-foreground))', fontSize: 12 };

function TrendChart({ rows, spec, boundaryDay }: { rows: PortfolioRow[]; spec: ChartSpec; boundaryDay: string | null }) {
  const data = rows.map((r) => ({ day: r.day, value: sumColumns(r, spec.keys) }));
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{spec.title}</CardTitle></CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data} margin={{ left: -20, right: 8, top: 8 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="day" tickFormatter={tickDay} tick={{ fontSize: 11 }} minTickGap={24} />
            <YAxis domain={spec.pct ? [0, 100] : ['auto', 'auto']} tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => (spec.pct ? `${v}%` : v)} />
            {boundaryDay && <ReferenceLine x={boundaryDay} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />}
            <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export default function Trends() {
  const [range, setRange] = useState<Range>(90);
  const portfolio = usePortfolioTrend(range);
  const buildings = useBuildingsTrends(range);
  const { data: names } = useBuildingNames();
  const nameOf = useMemo(() => new Map((names ?? []).map((b) => [b.id, b.name])), [names]);

  const rows = portfolio.data ?? [];
  const boundary = reconstructionBoundary(rows);
  const boundaryDay = boundary > 0 ? rows[boundary].day : null;
  const allReconstructed = rows.length > 0 && boundary === -1;
  const board = useMemo(() => deltaLeaderboard(buildings.rows, 'compliance_pct'), [buildings.rows]);
  const up = board.filter((b) => b.delta > 0).slice(0, 5);
  const down = board.filter((b) => b.delta < 0).slice(-5).reverse();

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Trends</h1>
          <p className="text-sm text-muted-foreground">Portfolio metrics from the nightly snapshot (05:00).</p>
        </div>
        <div className="flex items-center gap-2">
          <div role="group" aria-label="Range" className="flex items-center gap-2">
            {RANGES.map((r) => (
              <Button key={r} variant={r === range ? 'default' : 'outline'} className="h-11 min-w-16" onClick={() => setRange(r)} aria-pressed={r === range}>{r} days</Button>
            ))}
          </div>
          <ExportCsvButton rows={rows} columns={TREND_CSV_COLUMNS} filename={`portfolio-trend-${range}d`} label="CSV" className="h-11" size="default" />
        </div>
      </div>
      <Hint>Sparklines on each building header show the same series for that building; this page is the whole portfolio.</Hint>
      {/* Provenance, not coaching: stays visible with hints off. */}
      {boundaryDay && (
        <p className="text-xs text-muted-foreground">Days before {boundaryDay} were reconstructed from today's data when snapshots began; report and expiry figures for those days are not historical.</p>
      )}
      {allReconstructed && (
        <p className="text-xs text-muted-foreground">All days in this range were reconstructed from today's data when snapshots began; report and expiry figures are not historical yet.</p>
      )}
      {portfolio.isError ? (
        <Card><CardContent className="p-6 text-sm text-destructive">Could not load the portfolio snapshots.</CardContent></Card>
      ) : portfolio.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2" aria-busy="true" aria-label="Loading trends">
          {CHARTS.map((spec) => <Skeleton key={spec.id} className="h-[260px]" />)}
        </div>
      ) : !rows.length ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">No snapshots yet. The first one is written at 05:00 after the migration is applied.</CardContent></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {CHARTS.map((spec) => <TrendChart key={spec.id} rows={rows} spec={spec} boundaryDay={boundaryDay} />)}
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Biggest movers — OHS compliance over {range} days</CardTitle>
          <CardDescription>Change from the first to the latest snapshot in the range.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          {[{ title: 'Improved', list: up }, { title: 'Declined', list: down }].map(({ title, list }) => (
            <div key={title}>
              <p className="mb-2 text-sm font-medium">{title}</p>
              {buildings.isLoading ? <Skeleton className="h-24" /> : list.length === 0 ? <p className="text-sm text-muted-foreground">Nothing moved.</p> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Building</TableHead><TableHead className="text-right">From</TableHead><TableHead className="text-right">To</TableHead><TableHead className="text-right">Δ</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {list.map((b) => (
                      <TableRow key={b.buildingId}>
                        <TableCell><Link className="underline-offset-2 hover:underline" to={`/buildings/${b.buildingId}`}>{formatBuildingName(nameOf.get(b.buildingId) ?? '—')}</Link></TableCell>
                        <TableCell className="text-right tabular-nums">{b.first}%</TableCell>
                        <TableCell className="text-right tabular-nums">{b.last}%</TableCell>
                        <TableCell className={`text-right tabular-nums ${b.delta > 0 ? 'text-success' : 'text-destructive'}`}>{b.delta > 0 ? '+' : ''}{b.delta}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
