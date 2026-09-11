import { useState } from 'react';
import { enqueueAndRun } from '@/lib/offline/enqueueAndRun';
import { toastForOutcome } from '@/lib/offline/outcomeToast';
import { useAuth } from '@/contexts/AuthContext';
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
import { CheckCircle2, Loader2, PenLine } from 'lucide-react';
import { PhotoCapture, PhotoFile } from '@/components/ui/photo-capture';
import { toast } from 'sonner';

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

  const handlePhotosChange = (newPhotos: PhotoFile[]) => {
    setPhotos(newPhotos);
  };

  const resetForm = () => {
    setNotes('');
    setSignatureConfirmed(false);
    // Clean up photo URLs
    photos.forEach(p => URL.revokeObjectURL(p.preview));
    setPhotos([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (requiresSignature && !signatureConfirmed) {
      toast.error('Please confirm your signature');
      return;
    }

    if (requiresPhoto && photos.length === 0) {
      toast.error('Please add at least one photo');
      return;
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
      // outcome carrying the server's message.
      const outcome = await enqueueAndRun(user.id, {
        kind: 'task_complete', completionId: crypto.randomUUID(), taskInstanceId: taskId, taskName,
        notes: notes.trim() || null, signatureConfirmed,
      }, photos.map((p) => ({ file: p.file })));
      if (outcome.status === 'synced' && (outcome.result as { already_completed?: boolean } | null)?.already_completed) {
        // Someone else got there first, so this submission's notes and photos were not saved.
        toast.info('This task was already completed by someone else — your notes were not saved.');
      } else {
        toastForOutcome(outcome, {
          synced: 'Task completed successfully',
          queued: "Task saved on this device — it will complete when you're back online",
        });
      }
      if (outcome.status !== 'failed') {
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
            <CheckCircle2 className="h-5 w-5 text-success" />
            Complete Task
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {taskName}
            {taskDescription && (
              <span className="block text-xs mt-1">{taskDescription}</span>
            )}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {requiresPhoto && (
            <PhotoCapture
              label="Photo Evidence"
              required
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

          {requiresSignature && (
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
              Complete Task
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
