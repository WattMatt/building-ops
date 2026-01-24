import { useState, useEffect } from 'react';
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
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Camera, Loader2, PenLine } from 'lucide-react';
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
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviewUrls, setPhotoPreviewUrls] = useState<string[]>([]);

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length + photos.length > 2) {
      toast.error('Maximum 2 photos allowed');
      return;
    }

    const validFiles = files.filter((file) => {
      if (!file.type.startsWith('image/')) {
        toast.error(`${file.name} is not an image`);
        return false;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast.error(`${file.name} exceeds 5MB limit`);
        return false;
      }
      return true;
    });

    setPhotos((prev) => [...prev, ...validFiles]);
    
    validFiles.forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPhotoPreviewUrls((prev) => [...prev, reader.result as string]);
      };
      reader.readAsDataURL(file);
    });
  };

  const resetForm = () => {
    setNotes('');
    setSignatureConfirmed(false);
    setPhotos([]);
    setPhotoPreviewUrls([]);
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
      // Upload photos if any
      const photoUrls: string[] = [];
      for (const photo of photos) {
        const fileName = `completions/${user.id}/${Date.now()}-${photo.name}`;
        const { error: uploadError } = await supabase.storage
          .from('tenant-documents')
          .upload(fileName, photo);

        if (uploadError) {
          console.error('Photo upload error:', uploadError);
          continue;
        }

        const { data: urlData } = supabase.storage
          .from('tenant-documents')
          .getPublicUrl(fileName);

        if (urlData) {
          photoUrls.push(urlData.publicUrl);
        }
      }

      // Create task completion record
      const { error: completionError } = await supabase.from('task_completions').insert({
        task_instance_id: taskId,
        completed_by: user.id,
        notes: notes.trim() || null,
        signature_confirmed: signatureConfirmed,
        photo_urls: photoUrls,
      });

      if (completionError) throw completionError;

      // Update task status to completed
      const { error: updateError } = await supabase
        .from('task_instances')
        .update({ status: 'completed' })
        .eq('id', taskId);

      if (updateError) throw updateError;

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
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Camera className="h-4 w-4" />
                Photo Evidence *
              </Label>
              <div className="flex flex-wrap gap-2">
                {photoPreviewUrls.map((url, index) => (
                  <img
                    key={index}
                    src={url}
                    alt={`Preview ${index + 1}`}
                    className="h-16 w-16 object-cover rounded-lg border"
                  />
                ))}
                {photos.length < 2 && (
                  <label className="h-16 w-16 border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-primary hover:text-primary cursor-pointer transition-colors">
                    <Camera className="h-4 w-4" />
                    <span className="text-xs">Add</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoSelect}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
            </div>
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
