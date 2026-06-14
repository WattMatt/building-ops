/** The flagship OHS Compliance tab: headline gauges, per-section bars, the
 *  no-response action list (one-click "Log as issue"), and the compliance trend. */
import { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { fdb } from '@/integrations/supabase/fortress-db';
import { KpiCard } from './KpiCard';
import { RadialGauge } from './RadialGauge';
import { classify, THRESHOLDS } from '@/lib/fortressKpis';
import { formatPeriodLabel } from '@/lib/fortressReports';
import { useOhsWorklist } from '@/hooks/useOhsWorklist';
import type { OhsAction, SectionScore, Kpi } from '@/hooks/useBuildingKpis';

const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });

interface Props {
  buildingId: string;
  kpis: Kpi[];
  sectionScores: SectionScore[];
  actions: OhsAction[];
  trend: { period: string; pct: number | null }[];
}

const ISSUE_CATEGORY: Record<string, string> = {
  '1.3': 'fire_safety', '2.1': 'fire_safety', '2.2': 'fire_safety', '2.4': 'fire_safety',
  '1.2': 'electrical', '1.5': 'electrical', '2.9': 'electrical', '2.12': 'electrical',
};

export function OhsComplianceTab({ buildingId, kpis, sectionScores, actions, trend }: Props) {
  const { user } = useAuth();
  const [logged, setLogged] = useState<Record<string, boolean>>({});
  const { serviceItems, evac, isLoading: worklistLoading } = useOhsWorklist(buildingId);

  // Row A: O1/O2 as radial gauges; O3 (open non-compliances) + O5 (lowest section) as small tiles.
  const byId = (id: string) => kpis.find((k) => k.id === id) ?? null;
  const o1 = byId('O1');
  const o2 = byId('O2');
  const tileKpis = kpis.filter((k) => ['O3', 'O5'].includes(k.id));

  const logIssue = async (a: OhsAction) => {
    if (!user?.id) return;
    const secNo = a.section.split(' ')[0];
    const issueId = crypto.randomUUID();
    const { error } = await fdb.from('issues').insert({
      id: issueId,
      title: a.prompt.slice(0, 200),
      description: `OHS non-compliance — ${a.section}${a.comment ? `\n${a.comment}` : ''}`,
      priority: 'medium',
      status: 'open',
      building_id: buildingId,
      reported_by: user.id,
      category: ISSUE_CATEGORY[secNo] ?? 'other',
    } as never);
    if (error) { if (import.meta.env.DEV) console.error(error); toast.error('Could not log the issue.'); return; }
    // Link the response → issue so it tracks to resolution and isn't re-offered on reload.
    const { error: linkErr } = await fdb.from('compliance_responses').update({ issue_id: issueId }).eq('id', a.responseId);
    if (linkErr && import.meta.env.DEV) console.error('issue link:', linkErr);
    setLogged((m) => ({ ...m, [a.responseId]: true }));
    toast.success('Logged as an issue.');
  };

  const trendData = trend.filter((t) => t.pct !== null).map((t) => ({ label: formatPeriodLabel(t.period), pct: t.pct }));

  return (
    <div className="space-y-6">
      {/* Row A — headline radial gauges + context tiles */}
      <Card>
        <CardContent className="flex flex-col gap-6 p-4 sm:flex-row sm:items-center">
          <div className="flex flex-1 justify-center gap-8">
            <RadialGauge value={o1?.value ?? null} threshold={THRESHOLDS.compliance} label="Building Compliance" />
            <RadialGauge value={o2?.value ?? null} threshold={THRESHOLDS.critical} label="Critical Equipment" />
          </div>
          {tileKpis.length > 0 && (
            <div className="grid flex-1 grid-cols-2 gap-3">
              {tileKpis.map((k) => <KpiCard key={k.id} kpi={k} />)}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Section breakdown</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {sectionScores.length === 0 ? (
            <p className="text-sm text-muted-foreground">No section data.</p>
          ) : sectionScores.slice().sort((a, b) => a.section_no.localeCompare(b.section_no, undefined, { numeric: true })).map((s) => {
            const pct = s.section_pct ?? 0;
            const status = classify(pct, THRESHOLDS.compliance);
            return (
              <div key={s.section_no} className="flex items-center gap-3">
                <span className="w-44 shrink-0 truncate text-xs text-muted-foreground" title={`${s.section_no} ${s.section_title ?? ''}`}>
                  {s.section_no} {s.section_title}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className={cn('h-full rounded-full',
                    status === 'good' ? 'bg-emerald-500' : status === 'warn' ? 'bg-amber-500' : 'bg-destructive')}
                    style={{ width: `${pct}%` }} />
                </div>
                <span className="w-12 shrink-0 text-right text-xs tabular-nums">{pct}%</span>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Action list — non-compliances</CardTitle></CardHeader>
        <CardContent>
          {actions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open non-compliances. 🎉</p>
          ) : (
            <div className="space-y-2">
              {actions.map((a) => (
                <div key={a.responseId} className="flex items-start justify-between gap-3 rounded-md border p-3">
                  <div className="text-sm">
                    <Badge variant="outline" className="mr-2 text-[10px]">{a.section.split(' ')[0]}</Badge>
                    {a.prompt}
                    {a.comment && <p className="mt-1 text-xs text-muted-foreground">{a.comment}</p>}
                  </div>
                  <Button size="sm" variant="outline" disabled={Boolean(a.issueId) || logged[a.responseId]} onClick={() => logIssue(a)}>
                    {(a.issueId || logged[a.responseId]) ? 'Logged' : 'Log as issue'}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Row D — equipment service register (from annual inspection next_service_due dates) */}
      <Card>
        <CardHeader><CardTitle className="text-base">Equipment service register</CardTitle></CardHeader>
        <CardContent>
          {worklistLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : serviceItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">No service dates recorded.</p>
          ) : (
            <div className="space-y-2">
              {serviceItems.map((s) => (
                <div key={s.responseId} className="flex items-center justify-between gap-3 rounded-md border p-3">
                  <div className="min-w-0 text-sm">
                    <p className="truncate">{s.label}</p>
                    {s.section && <p className="text-xs text-muted-foreground">{s.section}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {s.overdue && <Badge variant="destructive" className="text-[10px]">Overdue</Badge>}
                    <span className="text-xs tabular-nums text-muted-foreground">{fmtDate(s.nextDue)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Row E — evacuation drill recency */}
      <Card>
        <CardHeader><CardTitle className="text-base">Evacuation drill</CardTitle></CardHeader>
        <CardContent>
          {worklistLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : evac ? (
            <p className="text-sm">
              Last evacuation drill: <span className="font-medium">{fmtDate(evac.date)}</span>{' '}
              <span className="text-muted-foreground">({evac.daysAgo} {evac.daysAgo === 1 ? 'day' : 'days'} ago)</span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No drill recorded.</p>
          )}
        </CardContent>
      </Card>

      {trendData.length > 1 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Compliance trend</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trendData} margin={{ left: -20, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="pct" stroke="hsl(var(--primary))" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
