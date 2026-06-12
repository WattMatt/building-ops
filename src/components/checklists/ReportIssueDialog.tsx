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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { PhotoCapture, PhotoFile } from '@/components/ui/photo-capture';
import { toast } from 'sonner';

interface ReportIssueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  taskName: string;
  buildingId: string;
  buildingName: string;
  onSuccess?: () => void;
}

type IssuePriority = 'low' | 'medium' | 'high' | 'critical';

export default function ReportIssueDialog({
  open,
  onOpenChange,
  taskId,
  taskName,
  buildingId,
  buildingName,
  onSuccess,
}: ReportIssueDialogProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<IssuePriority>('medium');
  const [correctiveAction, setCorrectiveAction] = useState('');
  const [photos, setPhotos] = useState<PhotoFile[]>([]);

  const handlePhotosChange = (newPhotos: PhotoFile[]) => {
    setPhotos(newPhotos);
  };

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setPriority('medium');
    setCorrectiveAction('');
    // Clean up photo URLs
    photos.forEach(p => URL.revokeObjectURL(p.preview));
    setPhotos([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      toast.error('Issue title is required');
      return;
    }

    if (!description.trim()) {
      toast.error('Issue description is required');
      return;
    }

    if (!user) {
      toast.error('You must be logged in to report an issue');
      return;
    }

    setLoading(true);

    try {
      // Upload photos if any. Path MUST be photos/<uid>/… — the only
      // tenant-documents prefix a non-admin may write (storage policy
      // "td write own photos"). Throw on failure rather than silently
      // dropping the evidence the user attached.
      const photoUrls: string[] = [];
      for (const photo of photos) {
        const fileName = `photos/${user.id}/${Date.now()}-${photo.file.name}`;
        const { error: uploadError } = await supabase.storage
          .from('tenant-documents')
          .upload(fileName, photo.file);

        if (uploadError) {
          throw new Error(`Photo upload failed: ${uploadError.message}`);
        }

        const { data: urlData } = supabase.storage
          .from('tenant-documents')
          .getPublicUrl(fileName);

        if (urlData) {
          photoUrls.push(urlData.publicUrl);
        }
      }

      // Create the issue
      const { error: issueError } = await supabase.from('issues').insert({
        title: title.trim(),
        description: description.trim(),
        priority,
        status: 'open',
        building_id: buildingId,
        task_instance_id: taskId,
        reported_by: user.id,
        corrective_action: correctiveAction.trim() || null,
        photo_urls: photoUrls.length > 0 ? photoUrls : [],
      });

      if (issueError) throw issueError;

      // Update task status to issue_logged
      await supabase
        .from('task_instances')
        .update({ status: 'issue_logged' })
        .eq('id', taskId);

      toast.success('Issue reported successfully');
      resetForm();
      onOpenChange(false);
      onSuccess?.();
    } catch (error: any) {
      console.error('Error reporting issue:', error);
      toast.error(error.message || 'Failed to report issue');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            Report Issue
          </DialogTitle>
          <DialogDescription>
            Report an issue found during: <strong>{taskName}</strong>
            <br />
            Building: <strong>{buildingName}</strong>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="issue-title">Issue Title *</Label>
            <Input
              id="issue-title"
              placeholder="Brief description of the issue"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={100}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="issue-description">Description *</Label>
            <Textarea
              id="issue-description"
              placeholder="Detailed description of what was found..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={1000}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="issue-priority">Priority</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as IssuePriority)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low - Can wait</SelectItem>
                <SelectItem value="medium">Medium - Should be addressed soon</SelectItem>
                <SelectItem value="high">High - Urgent attention needed</SelectItem>
                <SelectItem value="critical">Critical - Immediate action required</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="corrective-action">Suggested Corrective Action</Label>
            <Textarea
              id="corrective-action"
              placeholder="What action should be taken to resolve this issue?"
              value={correctiveAction}
              onChange={(e) => setCorrectiveAction(e.target.value)}
              rows={2}
              maxLength={500}
            />
          </div>

          <PhotoCapture
            label="Photos (optional)"
            maxPhotos={4}
            maxSizeMB={5}
            photos={photos}
            onPhotosChange={handlePhotosChange}
            size="md"
          />

          <div className="flex justify-end gap-3 pt-4">
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
              Report Issue
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
