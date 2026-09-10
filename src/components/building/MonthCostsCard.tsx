/**
 * "This month's costs" — Building Details overview card (spec §8 "Costs").
 *
 * Reads the `building_month_costs` view (security invoker, so RLS on issues and
 * asset_service_history applies): one row per building per month with the sum of
 * resolved issues' actual_cost and asset service costs. Tap the header to expand a
 * six-month list with a CSV export.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Download, Wallet } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { todayInOperatingTz } from '@/lib/myWork';
import { exportCsv, type CsvColumn } from '@/lib/exportCsv';

export interface MonthCostRow {
  building_id: string;
  /** 'YYYY-MM' */
  month: string;
  issues_actual: number | null;
  services_cost: number | null;
  total: number | null;
}

interface MonthCostsCardProps {
  buildingId: string;
}

/** 'YYYY-MM' of today in the operating timezone (SAST). */
export function currentMonth(now = new Date()): string {
  return todayInOperatingTz(now).slice(0, 7);
}

/** `count` months ending at `month` ('YYYY-MM'), newest first. */
export function lastMonths(month: string, count: number): string[] {
  const [y, m] = month.split('-').map(Number);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

/** 'R 12 345' — en-ZA style: space-grouped thousands, comma decimals, and no decimals unless cents exist. */
export function formatRand(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  const negative = n < 0;
  const cents = Math.round(Math.abs(n) * 100);
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const text = frac === 0 ? grouped : `${grouped},${String(frac).padStart(2, '0')}`;
  return `${negative ? '-' : ''}R ${text}`;
}

const MONTH_LABEL = new Intl.DateTimeFormat('en-ZA', { month: 'short', year: 'numeric', timeZone: 'UTC' });
/** 'Sep 2026' for '2026-09'. */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return MONTH_LABEL.format(new Date(Date.UTC(y, m - 1, 1)));
}

// building_month_costs is not yet in the generated types; regenerate after the migration ships.
type ViewResult = PromiseLike<{ data: MonthCostRow[] | null; error: { message: string } | null }>;
interface ViewQuery {
  eq: (column: string, value: string) => ViewQuery & ViewResult;
  in: (column: string, values: string[]) => ViewQuery & ViewResult;
}
const monthCostsView = () =>
  (supabase as unknown as { from: (table: string) => { select: (columns: string) => ViewQuery } })
    .from('building_month_costs')
    .select('building_id, month, issues_actual, services_cost, total');

async function fetchMonth(buildingId: string, month: string): Promise<MonthCostRow | null> {
  const { data, error } = await monthCostsView().eq('building_id', buildingId).eq('month', month);
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}

async function fetchMonths(buildingId: string, months: string[]): Promise<MonthCostRow[]> {
  const { data, error } = await monthCostsView().eq('building_id', buildingId).in('month', months);
  if (error) throw new Error(error.message);
  const byMonth = new Map((data ?? []).map((r) => [r.month, r]));
  // Every requested month appears, zero-filled, so the list and the CSV are always six rows.
  return months.map(
    (month) => byMonth.get(month) ?? { building_id: buildingId, month, issues_actual: 0, services_cost: 0, total: 0 },
  );
}

const CSV_COLUMNS: CsvColumn<MonthCostRow>[] = [
  { key: 'month', header: 'Month' },
  { key: 'issues_actual', header: 'Issues (R)', format: (v) => String(Number(v ?? 0)) },
  { key: 'services_cost', header: 'Services (R)', format: (v) => String(Number(v ?? 0)) },
  { key: 'total', header: 'Total (R)', format: (v) => String(Number(v ?? 0)) },
];

export default function MonthCostsCard({ buildingId }: MonthCostsCardProps) {
  const month = currentMonth();
  const [expanded, setExpanded] = useState(false);

  const current = useQuery({
    queryKey: ['building-month-costs', buildingId, month],
    queryFn: () => fetchMonth(buildingId, month),
    staleTime: 60_000,
  });

  const months = lastMonths(month, 6);
  const history = useQuery({
    queryKey: ['building-month-costs', buildingId, 'history', month],
    queryFn: () => fetchMonths(buildingId, months),
    staleTime: 60_000,
    enabled: expanded,
  });

  const row = current.data;
  const total = Number(row?.total ?? 0);
  const listId = `month-costs-${buildingId}`;

  return (
    <Card aria-busy={current.isPending}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={listId}
        className={cn(
          'flex w-full min-h-11 items-start justify-between gap-3 p-4 text-left',
          'rounded-lg transition-colors hover:bg-muted/50',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        )}
      >
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Wallet className="h-4 w-4" aria-hidden="true" />
            This month's costs
          </p>
          <div className="pt-1">
            {current.isPending ? (
              <div className="h-6 w-28 animate-pulse rounded bg-muted" aria-hidden="true" />
            ) : current.isError ? (
              // Guardrail, not a hint: a failed read must never read as "no costs".
              <p className="text-sm text-destructive">Couldn't load costs</p>
            ) : total === 0 ? (
              <p className="text-sm text-muted-foreground">No costs recorded this month</p>
            ) : (
              <>
                <p className="text-lg font-semibold leading-tight">{formatRand(total)} this month</p>
                <p className="text-xs text-muted-foreground">
                  issues {formatRand(row?.issues_actual)} · services {formatRand(row?.services_cost)}
                </p>
              </>
            )}
          </div>
        </div>
        <ChevronDown
          className={cn('mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')}
          aria-hidden="true"
        />
      </button>

      {expanded && (
        <CardContent id={listId} className="border-t p-4 pt-3">
          {history.isPending ? (
            <div className="space-y-2" aria-hidden="true">
              {months.map((m) => (
                <div key={m} className="h-5 animate-pulse rounded bg-muted" />
              ))}
            </div>
          ) : history.isError ? (
            <p className="text-sm text-destructive">Couldn't load the last six months</p>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-1 text-left font-medium">Month</th>
                    <th scope="col" className="py-1 text-right font-medium">Issues</th>
                    <th scope="col" className="py-1 text-right font-medium">Services</th>
                    <th scope="col" className="py-1 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {history.data.map((r) => (
                    <tr key={r.month} className="border-t border-border/50">
                      <td className="py-1.5">{monthLabel(r.month)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatRand(r.issues_actual)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatRand(r.services_cost)}</td>
                      <td className="py-1.5 text-right font-medium tabular-nums">{formatRand(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Button
                type="button"
                variant="outline"
                className="mt-3 min-h-11 w-full sm:w-auto"
                onClick={() => exportCsv(history.data, CSV_COLUMNS, `building-costs-${month}.csv`)}
              >
                <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                Export CSV
              </Button>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}
