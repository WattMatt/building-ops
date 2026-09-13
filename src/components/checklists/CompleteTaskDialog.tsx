import { useState } from 'react';
import { enqueueAndRun } from '@/lib/offline/enqueueAndRun';
import { toastForOutcome } from '@/lib/offline/outcomeToast';
import { useAuth } from '@/contexts/AuthContext';
import { queryClient } from '@/lib/queryClient';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Ban, CheckCircle2, Loader2, PenLine } from 'lucide-react';
import { PhotoCapture, PhotoFile } from '@/components/ui/photo-capture';
import { toast } from 'sonner';
import { WONT_DO_CODES, WONT_DO_LABELS, formatReason, type TaskOutcome, type WontDoCode } from '@/lib/wontDo';

interface CompleteTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  taskName: string;
  taskDescription?: string | null;
  requiresPhoto: boolean;
  requiresSignature: boolean;
  onSuccess?: () => void;
}

export default function CompleteTaskDialog({
  open,
  onOpenChange,
  taskId,
  taskName,
  taskDescription,
  requiresPhoto,
  requiresSignature,
  onSuccess,
}: CompleteTaskDialogProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState('');
  const [signatureConfirmed, setSignatureConfirmed] = useState(false);
  const [photos, setPhotos] = useState<PhotoFile[]>([]);
  // S6b: "Done" or "Can't do". A can't-do needs a reason; the photo and signature rules only apply to "Done".
  const [outcome, setOutcome] = useState<TaskOutcome>('completed');
  const [reasonCode, setReasonCode] = useState<WontDoCode | ''>('');
  const [otherText, setOtherText] = useState('');
  const wontDo = outcome === 'wont_do';

  const handlePhotosChange = (newPhotos: PhotoFile[]) => {
    setPhotos(newPhotos);
  };

  const resetForm = () => {
    setNotes('');
    setSignatureConfirmed(false);
    setOutcome('completed');
    setReasonCode('');
    setOtherText('');
    // Clean up photo URLs
    photos.forEach(p => URL.revokeObjectURL(p.preview));
    setPhotos([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Guardrails, plain text: the server refuses the same things (complete_task raises 22023).
    let reason: string | null = null;
    if (wontDo) {
      if (!reasonCode) {
        toast.error('Choose a reason');
        return;
      }
      reason = formatReason(reasonCode, otherText);
      if (!reason) {
        toast.error("Say what's stopping it");
        return;
      }
    } else {
      if (requiresSignature && !signatureConfirmed) {
        toast.error('Please confirm your signature');
        return;
      }
      if (requiresPhoto && photos.length === 0) {
        toast.error('Please add at least one photo');
        return;
      }
    }

    if (!user) {
      toast.error('You must be logged in');
      return;
    }

    setLoading(true);

    try {
      // Every completion goes through the offline queue, on- and offline: the op (photos
      // included) is persisted first, then replayed at once when the browser is online. The
      // complete_task RPC does the completion insert and the instance status flip in one
      // statement, keyed on a client-generated completion id so a retry after a flaky network
      // is a no-op the server reports as already_completed. An RLS denial arrives as a failed
      // outcome carrying the server's message. A can't-do is the same op with an outcome and a
      // reason; the signature is never sent for it (it was not asked).
      const result = await enqueueAndRun(user.id, {
        kind: 'task_complete', completionId: crypto.randomUUID(), taskInstanceId: taskId, taskName,
        notes: notes.trim() || null, signatureConfirmed: wontDo ? false : signatureConfirmed,
        outcome, reason,
      }, photos.map((p) => ({ file: p.file })));
      if (result.status === 'synced' && (result.result as { already_completed?: boolean } | null)?.already_completed) {
        // Someone else got there first, so this submission's notes and photos were not saved.
        toast.info('This task was already completed by someone else — your notes were not saved.');
      } else {
        toastForOutcome(result, {
          synced: wontDo ? "Recorded as can't do" : 'Task completed successfully',
          queued: "Task saved on this device — it will complete when you're back online",
        });
      }
      if (result.status !== 'failed') {
        // Synced now: the rows My Day and the building overview show have changed on the
        // server, so refetch them — the same two keys OfflineQueueRunner.replayAndRefresh
        // invalidates after a replay. A queued write is left to the runner, which refetches
        // once the replay actually lands; until then the pending overlay marks the row.
        // (S6a's block, kept verbatim; a can't-do changes the same rows.)
        if (result.status === 'synced') {
          void Promise.all([
            queryClient.invalidateQueries({ queryKey: ['my-work'] }),
            queryClient.invalidateQueries({ queryKey: ['building-overview'] }),
          ]);
        }
        resetForm();
        onOpenChange(false);
        onSuccess?.();
      }
    } catch (error: any) {
      console.error('Error completing task:', error);
      toast.error(error.message || 'Failed to complete task');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            {wontDo ? <Ban className="h-5 w-5 text-muted-foreground" /> : <CheckCircle2 className="h-5 w-5 text-success" />}
            {wontDo ? 'Record outcome' : 'Complete Task'}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {taskName}
            {taskDescription && (
              <span className="block text-xs mt-1">{taskDescription}</span>
            )}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Done / Can't do. Single-select toggle group: its items are radios to assistive tech. */}
          <ToggleGroup
            type="single"
            variant="outline"
            value={outcome}
            onValueChange={(v) => { if (v) setOutcome(v as TaskOutcome); }}
            aria-label="Outcome"
            className="grid grid-cols-2 gap-2"
          >
            <ToggleGroupItem value="completed" aria-label="Done" className="h-11 gap-2 data-[state=on]:bg-success/10 data-[state=on]:text-success">
              <CheckCircle2 className="h-4 w-4" />
              Done
            </ToggleGroupItem>
            <ToggleGroupItem value="wont_do" aria-label="Can't do" className="h-11 gap-2 data-[state=on]:bg-muted data-[state=on]:text-foreground">
              <Ban className="h-4 w-4" />
              Can't do
            </ToggleGroupItem>
          </ToggleGroup>

          {wontDo && (
            <div className="space-y-2">
              <p id="wont-do-reason-label" className="text-sm font-medium leading-none">Why can't it be done?</p>
              <RadioGroup
                aria-labelledby="wont-do-reason-label"
                value={reasonCode}
                onValueChange={(v) => setReasonCode(v as WontDoCode)}
                className="gap-1"
              >
                {WONT_DO_CODES.map((code) => (
                  <div key={code} className="flex items-center gap-3 min-h-11 rounded-lg px-2 hover:bg-muted/50">
                    <RadioGroupItem value={code} id={`wont-do-${code}`} />
                    <Label htmlFor={`wont-do-${code}`} className="flex-1 cursor-pointer py-3">
                      {WONT_DO_LABELS[code]}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
              {reasonCode === 'other' && (
                <div className="space-y-2">
                  <Label htmlFor="wont-do-other-text">What's stopping it?</Label>
                  <Textarea
                    id="wont-do-other-text"
                    placeholder="A few words is enough"
                    value={otherText}
                    onChange={(e) => setOtherText(e.target.value)}
                    rows={2}
                    maxLength={200}
                  />
                </div>
              )}
            </div>
          )}

          {requiresPhoto && (
            <PhotoCapture
              label={wontDo ? 'Photo (optional)' : 'Photo Evidence'}
              required={!wontDo}
              maxPhotos={2}
              maxSizeMB={5}
              photos={photos}
              onPhotosChange={handlePhotosChange}
              size="sm"
            />
          )}

          <div className="space-y-2">
            <Label htmlFor="completion-notes">Notes (optional)</Label>
            <Textarea
              id="completion-notes"
              placeholder="Any observations or comments..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={500}
            />
          </div>

          {requiresSignature && !wontDo && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <Checkbox
                id="signature-confirm"
                checked={signatureConfirmed}
                onCheckedChange={(checked) => setSignatureConfirmed(checked === true)}
              />
              <div className="space-y-1">
                <Label htmlFor="signature-confirm" className="flex items-center gap-2 cursor-pointer">
                  <PenLine className="h-4 w-4" />
                  Confirm Signature
                </Label>
                <p className="text-xs text-muted-foreground">
                  I confirm that this task has been completed correctly
                </p>
              </div>
            </div>
          )}

          <ResponsiveDialogFooter className="gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="gap-2">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {wontDo ? 'Record' : 'Complete Task'}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
