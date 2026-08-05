import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
      // Upload photos if any. Path MUST be photos/<uid>/… — the only
      // tenant-documents prefix a non-admin may write (storage policy
      // "td write own photos"). A failed upload throws rather than silently
      // dropping compliance evidence the user believes they attached.
      const photoUrls: string[] = [];
      for (const photo of photos) {
        const fileName = `photos/${user.id}/${Date.now()}-${photo.file.name}`;
        const { error: uploadError } = await supabase.storage
          .from('tenant-documents')
          .upload(fileName, photo.file);

        if (uploadError) {
          throw new Error(`Photo upload failed: ${uploadError.message}`);
        }

        // Stored as a public-style URL; resolveStorageUrl re-signs it for the
        // private bucket at display time (mirrors the forms/reports pattern).
        const { data: urlData } = supabase.storage
          .from('tenant-documents')
          .getPublicUrl(fileName);

        if (urlData) {
          photoUrls.push(urlData.publicUrl);
        }
      }

      // Create task completion record. task_completions has a unique index on
      // task_instance_id, so a double-click or a retry after a flaky network
      // must be treated as already-done (23505 / DO NOTHING) rather than a
      // failure — otherwise the status update below never runs and the
      // instance is stranded at 'pending'.
      const { data: inserted, error: completionError } = await supabase
        .from('task_completions')
        .upsert(
          {
            task_instance_id: taskId,
            completed_by: user.id,
            notes: notes.trim() || null,
            signature_confirmed: signatureConfirmed,
            photo_urls: photoUrls,
          },
          { onConflict: 'task_instance_id', ignoreDuplicates: true }
        )
        .select('id');

      if (completionError) throw completionError;

      // Zero rows back means the conflict target already had a completion, so
      // this submission was ignored. Say so rather than implying the notes and
      // photos just captured were saved, and leave the existing completer's
      // stamp on the instance intact.
      if (!inserted || inserted.length === 0) {
        toast.info('This task was already completed by someone else — your notes were not saved.');
        resetForm();
        onOpenChange(false);
        onSuccess?.();
        return;
      }

      // Update task status to completed. Stamp completed_at/completed_by on the
      // instance too — Reports and the dashboard "completed today" KPI key off
      // task_instances.completed_at, which was previously left null on web.
      const { data: updated, error: updateError } = await supabase
        .from('task_instances')
        .update({ status: 'completed', completed_at: new Date().toISOString(), completed_by: user.id })
        .eq('id', taskId)
        .select('id');

      if (updateError) throw updateError;
      if (!updated || updated.length === 0) {
        throw new Error('Task status was not updated — your role does not permit it.');
      }

      toast.success('Task completed successfully');
      resetForm();
      onOpenChange(false);
      onSuccess?.();
    } catch (error: any) {
      console.error('Error completing task:', error);
      toast.error(error.message || 'Failed to complete task');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-success" />
            Complete Task
          </DialogTitle>
          <DialogDescription>
            {taskName}
            {taskDescription && (
              <span className="block text-xs mt-1">{taskDescription}</span>
            )}
          </DialogDescription>
        </DialogHeader>

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

          <div className="flex justify-end gap-3 pt-2">
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
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
