/**
 * Closing an issue needs a note (what was done) — it becomes the last comment, then the status
 * flips. Both run in the offline queue handler, now (online) or on replay (offline).
 *
 * When the issue has a contractor, the resolver can also rate it (1–5 stars + optional comment).
 * The rating rides on the same op and is written after the status flip; it is optional and never
 * blocks the resolve.
 */
import { useEffect, useState } from 'react';
import { Loader2, Star } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { PhotoCapture, type PhotoFile } from '@/components/ui/photo-capture';
import { useAuth } from '@/contexts/AuthContext';
import { enqueueAndRun } from '@/lib/offline/enqueueAndRun';
import type { IssueResolveResult } from '@/lib/offline/handlers';
import { toastForOutcome } from '@/lib/offline/outcomeToast';
import { removeOp } from '@/lib/offline/queue';

interface Props {
  issueId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onResolved: () => void;
  /** Pass when rendered inside another open ResponsiveDialog so the phone sheet stacks correctly. */
  nested?: boolean;
  /** The issue's contractor, if any: shows the optional rating block. */
  contractorId?: string | null;
}

const STARS = [1, 2, 3, 4, 5] as const;
const STAR_LABELS: Record<number, string> = { 1: 'Poor', 2: 'Fair', 3: 'Good', 4: 'Very good', 5: 'Excellent' };

export function ResolveIssueDialog({ issueId, open, onOpenChange, onResolved, nested, contractorId }: Props) {
  const { user } = useAuth();
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<PhotoFile[]>([]);
  const [rating, setRating] = useState<number | null>(null);
  const [ratingComment, setRatingComment] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => { setNote(''); setPhotos([]); setRating(null); setRatingComment(''); };

  // A rating belongs to one contractor on one visit: it must not carry over to a different
  // contractor, nor survive a cancel and reopen.
  useEffect(() => { setRating(null); setRatingComment(''); }, [contractorId, open]);

  const resolve = async () => {
    if (!user || !note.trim()) return;
    setBusy(true);
    try {
      const outcome = await enqueueAndRun(user.id, {
        kind: 'issue_resolve', activityId: crypto.randomUUID(), issueId, note: note.trim(), userEmail: user.email ?? null,
        ...(contractorId && rating
          ? { rating: { contractorId, rating, comment: ratingComment.trim() || null } }
          : {}),
      }, photos.map((p) => ({ file: p.file })));
      if (outcome.status === 'failed' && outcome.code === 'RESOLVE_DENIED') {
        // The handler saved the note before the status flip was refused, so the op is done as far
        // as it ever can be: a retry would only re-post the note and be refused again. Drop it from
        // the queue, close, refresh (the note is on the issue) and tell the user what happened.
        await removeOp(user.id, outcome.opId);
        reset();
        onOpenChange(false);
        onResolved();
        toast.error(outcome.error);
        return;
      }
      toastForOutcome(outcome, {
        synced: 'Issue resolved',
        queued: "Saved on this device — it will resolve when you're back online",
      });
      if (outcome.status === 'failed') return;
      // The handler resolves the issue whatever became of the rating; say what became of it
      // rather than hide it. 'duplicate' means an earlier attempt of this same op (or another
      // resolver) already rated this contractor on this issue — that rating stands.
      const ratingOutcome = outcome.status === 'synced' ? (outcome.result as IssueResolveResult | null)?.rating : undefined;
      if (ratingOutcome === 'failed') {
        toast.error('The issue is resolved, but the contractor rating could not be saved.');
      } else if (ratingOutcome === 'duplicate') {
        toast.info('This contractor was already rated on this issue. The earlier rating was kept.');
      }
      reset();
      onOpenChange(false);
      onResolved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not resolve the issue.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)} nested={nested}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Resolve this issue</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>Say what was done. This note is recorded on the issue and is required.</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <Textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Replaced the faulty breaker; tested under load." disabled={busy} aria-label="What was done" />
        <PhotoCapture photos={photos} onPhotosChange={setPhotos} maxPhotos={3} size="sm" disabled={busy} label="Photo of the fix (optional)" />
        {contractorId && (
          <div className="space-y-2 rounded-lg border p-3">
            <div id="contractor-rating-label" className="text-sm font-medium">How did the contractor do? <span className="font-normal text-muted-foreground">(optional)</span></div>
            <div role="group" aria-labelledby="contractor-rating-label" className="flex items-center gap-1">
              {STARS.map((n) => {
                const lit = rating != null && n <= rating;
                return (
                  <button
                    key={n}
                    type="button"
                    aria-label={`${n} star${n === 1 ? '' : 's'} — ${STAR_LABELS[n]}`}
                    aria-pressed={rating === n}
                    disabled={busy}
                    onClick={() => setRating((r) => (r === n ? null : n))}
                    className={cn(
                      'inline-flex h-11 w-11 items-center justify-center rounded-md transition-colors',
                      'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      'disabled:pointer-events-none disabled:opacity-50',
                    )}
                  >
                    <Star className={cn('h-6 w-6', lit ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/50')} aria-hidden="true" />
                  </button>
                );
              })}
              <span className="ml-2 text-xs text-muted-foreground" aria-live="polite">{rating ? STAR_LABELS[rating] : 'Not rated'}</span>
            </div>
            <div className="space-y-1">
              <Label htmlFor="contractor-rating-comment" className="text-xs">Comment about the contractor</Label>
              <Textarea
                id="contractor-rating-comment"
                rows={2}
                value={ratingComment}
                onChange={(e) => setRatingComment(e.target.value)}
                placeholder="e.g. Arrived on time, tidy work."
                disabled={busy || rating == null}
              />
            </div>
          </div>
        )}
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={resolve} disabled={busy || !note.trim()}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Resolve
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
