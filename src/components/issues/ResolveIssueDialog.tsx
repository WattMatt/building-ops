/**
 * Closing an issue needs a note (what was done) — it becomes the last comment, then the status
 * flips. Both run in the offline queue handler, now (online) or on replay (offline).
 */
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
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
import { toastForOutcome } from '@/lib/offline/outcomeToast';

interface Props {
  issueId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onResolved: () => void;
  /** Pass when rendered inside another open ResponsiveDialog so the phone sheet stacks correctly. */
  nested?: boolean;
}

export function ResolveIssueDialog({ issueId, open, onOpenChange, onResolved, nested }: Props) {
  const { user } = useAuth();
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<PhotoFile[]>([]);
  const [busy, setBusy] = useState(false);

  const resolve = async () => {
    if (!user || !note.trim()) return;
    setBusy(true);
    try {
      // The handler saves the note even if the status flip is refused; that case comes back as a
      // failed outcome whose message ("Your note was saved, but…") is already user-facing.
      const outcome = await enqueueAndRun(user.id, {
        kind: 'issue_resolve', activityId: crypto.randomUUID(), issueId, note: note.trim(), userEmail: user.email ?? null,
      }, photos.map((p) => ({ file: p.file })));
      toastForOutcome(outcome, {
        synced: 'Issue resolved',
        queued: "Saved on this device — it will resolve when you're back online",
      });
      if (outcome.status === 'failed') return;
      setNote(''); setPhotos([]);
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
        <Textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Replaced the faulty breaker; tested under load." disabled={busy} />
        <PhotoCapture photos={photos} onPhotosChange={setPhotos} maxPhotos={3} size="sm" disabled={busy} label="Photo of the fix (optional)" />
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
