/**
 * Portfolio trends from the nightly snapshots: four lines over 30/90/365 days and a leaderboard of the
 * buildings whose compliance moved most. The one recharts import outside the OHS tab; loaded lazily.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { supabase } from '@/integrations/supabase/client';
import { usePortfolioTrend } from '@/hooks/usePortfolioTrend';
import { useBuildingsTrends } from '@/hooks/useBuildingTrend';
import { deltaLeaderboard, reconstructionBoundary } from '@/lib/trendSeries';
import { num, type PortfolioRow } from '@/lib/snapshotClient';
import { exportCsv } from '@/lib/exportCsv';
import { formatBuildingName } from '@/lib/buildingName';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Hint } from '@/components/ui/hint';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const RANGES = [30, 90, 365] as const;
type Range = (typeof RANGES)[number];

interface ChartSpec { key: keyof PortfolioRow; title: string; pct?: boolean }
const CHARTS: ChartSpec[] = [
  { key: 'compliance_avg', title: 'OHS compliance (portfolio average)', pct: true },
  { key: 'issues_open', title: 'Open issues' },
  { key: 'tasks_overdue', title: 'Overdue tasks' },
  { key: 'docs_expiring_30', title: 'Documents expiring within 30 days' },
];

function TrendChart({ rows, spec, boundaryDay }: { rows: PortfolioRow[]; spec: ChartSpec; boundaryDay: string | null }) {
  const data = rows.map((r) => ({ day: r.day, label: r.day.slice(5), value: num(r[spec.key]) }));
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{spec.title}</CardTitle></CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data} margin={{ left: -20, right: 8, top: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={24} />
            <YAxis domain={spec.pct ? [0, 100] : ['auto', 'auto']} tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip formatter={(v: number) => (spec.pct ? `${v}%` : v)} labelFormatter={(l, p) => (p?.[0]?.payload as { day?: string })?.day ?? String(l)} />
            {boundaryDay && <ReferenceLine x={boundaryDay.slice(5)} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />}
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
  const { data: names } = useQuery({
    queryKey: ['buildings-for-reports'],
    queryFn: async () => {
      const { data, error } = await supabase.from('buildings').select('id, name').order('name');
      if (error) throw error;
      return data ?? [];
    },
  });
  const nameOf = useMemo(() => new Map((names ?? []).map((b) => [b.id, b.name])), [names]);

  const rows = portfolio.data ?? [];
  const boundary = reconstructionBoundary(rows);
  const boundaryDay = boundary > 0 ? rows[boundary].day : null;
  const board = useMemo(() => deltaLeaderboard(buildings.rows, 'compliance_pct'), [buildings.rows]);
  const up = board.filter((b) => b.delta > 0).slice(0, 5);
  const down = board.filter((b) => b.delta < 0).slice(-5).reverse();

  const onExport = () => exportCsv(rows, [
    { key: 'day', header: 'Day' }, { key: 'buildings', header: 'Buildings' }, { key: 'compliance_avg', header: 'Compliance avg %' },
    { key: 'critical_avg', header: 'Critical avg %' }, { key: 'task_completion_avg', header: 'Task completion avg %' },
    { key: 'tasks_overdue', header: 'Overdue tasks' }, { key: 'issues_open', header: 'Open issues' }, { key: 'issues_breached', header: 'SLA breached' },
    { key: 'docs_expiring_30', header: 'Docs expiring 30d' }, { key: 'docs_expiring_60', header: 'Docs expiring 60d' }, { key: 'docs_expiring_90', header: 'Docs expiring 90d' },
    { key: 'docs_expired', header: 'Docs expired' }, { key: 'assets_overdue', header: 'Assets overdue' },
  ], `portfolio-trend-${range}d.csv`);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Trends</h1>
          <p className="text-sm text-muted-foreground">Portfolio metrics from the nightly snapshot (05:00).</p>
        </div>
        <div className="flex items-center gap-2">
          {RANGES.map((r) => (
            <Button key={r} variant={r === range ? 'default' : 'outline'} className="h-11 min-w-16" onClick={() => setRange(r)} aria-pressed={r === range}>{r} d</Button>
          ))}
          <Button variant="outline" className="h-11" onClick={onExport} disabled={!rows.length}><Download className="mr-2 h-4 w-4" />CSV</Button>
        </div>
      </div>
      <Hint>Sparklines on each building header show the same series for that building; this page is the whole portfolio.</Hint>
      {boundaryDay && (
        <p className="text-xs text-muted-foreground">Days before {boundaryDay} were reconstructed from today's data when snapshots began; report and expiry figures for those days are not historical.</p>
      )}
      {portfolio.isError ? (
        <Card><CardContent className="p-6 text-sm text-destructive">Could not load the portfolio snapshots.</CardContent></Card>
      ) : !portfolio.isLoading && !rows.length ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">No snapshots yet. The first one is written at 05:00 after the migration is applied.</CardContent></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {CHARTS.map((spec) => <TrendChart key={spec.key} rows={rows} spec={spec} boundaryDay={boundaryDay} />)}
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
              {list.length === 0 ? <p className="text-sm text-muted-foreground">Nothing moved.</p> : (
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
