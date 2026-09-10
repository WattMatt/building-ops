/**
 * The offline queue, one row per op, oldest first (the order they will replay in). Failed rows
 * show the backend's reason and offer Retry / Discard. All copy here is guardrail — plain text,
 * never through <Hint>.
 */
import { formatDistanceToNow } from 'date-fns';
import { Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import type { OpPayload, QueuedOp, RunOutcome } from '@/lib/offline/types';
import { cn } from '@/lib/utils';

interface QueueSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ops: QueuedOp[];
  retry: (id: string) => Promise<RunOutcome>;
  discard: (id: string) => Promise<void>;
}

const KIND_LABEL: Record<OpPayload['kind'], string> = {
  task_complete: 'Complete task',
  issue_create: 'New issue',
  issue_comment: 'Comment',
  issue_resolve: 'Resolve issue',
};

/** What the op is about, from the payload; the resolve payload carries no title. */
export function opTitle(payload: OpPayload): string {
  switch (payload.kind) {
    case 'task_complete': return payload.taskName;
    case 'issue_create': return payload.row.title;
    case 'issue_comment': return payload.issueTitle;
    case 'issue_resolve': return 'Issue';
  }
}

function summary(pending: number, failed: number): string {
  if (pending === 0 && failed === 0) return 'Nothing is waiting to sync.';
  const parts: string[] = [];
  if (pending > 0) parts.push(`${pending} waiting to sync`);
  if (failed > 0) parts.push(`${failed} need attention`);
  return parts.join(', ') + '.';
}

export function QueueSheet({ open, onOpenChange, ops, retry, discard }: QueueSheetProps) {
  const ordered = [...ops].sort((a, b) => a.createdAt - b.createdAt);
  const pending = ordered.filter((op) => op.status === 'pending').length;
  const failed = ordered.length - pending;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Waiting to sync</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{summary(pending, failed)}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        {ordered.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Everything you changed has synced.</p>
        ) : (
          <ul className="divide-y" aria-label="Queued changes">
            {ordered.map((op) => {
              const isFailed = op.status === 'failed';
              const photos = op.photos.length;
              return (
                <li key={op.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {KIND_LABEL[op.payload.kind]}
                      </p>
                      <p className="truncate text-sm font-medium">{opTitle(op.payload)}</p>
                      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <span>{formatDistanceToNow(new Date(op.createdAt), { addSuffix: true })}</span>
                        {photos > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <Camera className="h-3 w-3" aria-hidden="true" />
                            {photos} {photos === 1 ? 'photo' : 'photos'}
                          </span>
                        )}
                      </p>
                    </div>
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold',
                        isFailed ? 'bg-destructive text-destructive-foreground' : 'bg-warning text-warning-foreground',
                      )}
                    >
                      {isFailed ? 'Failed' : 'Pending'}
                    </span>
                  </div>

                  {isFailed && (
                    <div className="mt-2 space-y-2">
                      <p className="text-sm text-destructive">{op.lastError ?? 'The server rejected this change.'}</p>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="h-11 flex-1"
                          onClick={() => { void discard(op.id); }}
                        >
                          Discard
                        </Button>
                        <Button
                          type="button"
                          className="h-11 flex-1"
                          onClick={() => { void retry(op.id); }}
                        >
                          Retry
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <p className="border-t pt-3 text-xs text-muted-foreground">
          Signing out discards changes that have not synced.
        </p>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
