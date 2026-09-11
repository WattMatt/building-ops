/**
 * One table for both "what a run did / would do" (the function's per-building rows, live or from
 * `report_schedules.last_result`) and the recorded history (`report_distributions` rows). Stacked
 * rows on phones, a grid on wider screens — one DOM, no duplicated content.
 */
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { OPERATING_TZ } from '@/lib/myWork';
import { STATUS_LABELS, toResultRows, type RunRow } from '@/lib/reportSchedule';
import type { Distribution } from '@/hooks/useReportSchedules';

interface DistributionResultsProps {
  rows: RunRow[] | Distribution[];
  title: string;
  /** building id → name, for history rows (which carry only the id). */
  buildingNames?: Record<string, string>;
  /**
   * The schedule's configured recipient count. A recorded row with an empty `sent_to` then reads
   * "0 of 2" exactly as the live run dialog labels the same skipped building.
   */
  recipientCount?: number;
}

function statusClass(status: string): string {
  if (status === 'sent') return 'border-success/40 bg-success/10 text-success';
  if (status === 'failed') return 'border-destructive/40 bg-destructive/10 text-destructive';
  if (status.startsWith('skipped')) return 'border-warning/40 bg-warning/10 text-warning';
  // `would_send` is the only dry-run status there is: the run-now path always forces `action: 'send'`.
  if (status === 'would_send') return '';
  return 'bg-muted text-muted-foreground';
}

export function StatusChip({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn('whitespace-nowrap', statusClass(status))}>
      {STATUS_LABELS[status] ?? status.replace(/_/g, ' ')}
    </Badge>
  );
}

export function DistributionResults({ rows, title, buildingNames, recipientCount }: DistributionResultsProps) {
  const list = toResultRows(rows, buildingNames ?? {}, OPERATING_TZ, recipientCount);
  return (
    <section aria-label={title} className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing to show.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          <li className="hidden sm:grid sm:grid-cols-[1fr_auto_6rem_8rem] gap-3 px-3 py-2 text-xs font-medium text-muted-foreground" aria-hidden="true">
            <span>Building</span><span>Status</span><span>Recipients</span><span>When</span>
          </li>
          {list.map((r) => (
            <li key={r.key} className="grid gap-1 px-3 py-2 text-sm sm:grid-cols-[1fr_auto_6rem_8rem] sm:items-center sm:gap-3">
              <span className="font-medium">{r.building}</span>
              {/* Stacked on a phone there is no header row, so every cell but the building names itself. */}
              <span className="flex items-center gap-1">
                <span className="text-muted-foreground sm:hidden">Status:</span>
                <StatusChip status={r.status} />
              </span>
              <span className="text-muted-foreground"><span className="sm:hidden">Recipients: </span>{r.recipients}</span>
              {r.when && <span className="text-muted-foreground"><span className="sm:hidden">When: </span>{r.when}</span>}
              {!r.when && <span className="text-muted-foreground hidden sm:block" aria-hidden="true" />}
              {r.error && <p className="text-xs text-destructive sm:col-span-4">{r.error}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
