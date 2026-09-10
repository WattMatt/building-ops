/**
 * The SLA state of an issue as a chip. A guardrail, not coaching: it stays visible with hints off.
 * `none` renders nothing — an issue without a target has no clock to show.
 */
import { Timer } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { slaState, type SlaIssueFields, type SlaKind } from '@/lib/slaState';

const CLASS: Record<Exclude<SlaKind, 'none'>, string> = {
  ok: 'border-border text-muted-foreground',
  due_soon: 'bg-warning text-warning-foreground border-transparent',
  breached: 'bg-destructive text-destructive-foreground border-transparent',
  met: 'bg-success text-success-foreground border-transparent',
  missed: 'border-destructive text-destructive',
};

export function SlaChip({ issue, now, className }: { issue: SlaIssueFields; now?: Date; className?: string }) {
  const s = slaState(issue, now);
  if (s.kind === 'none') return null;
  return (
    <Badge
      variant="outline"
      data-sla={s.kind}
      title={s.due ? `SLA due ${s.due.toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}` : undefined}
      className={cn('gap-1 whitespace-nowrap', CLASS[s.kind], className)}
    >
      <Timer className="h-3 w-3" aria-hidden="true" />
      {s.label}
    </Badge>
  );
}
