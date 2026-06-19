import { useState, useEffect } from 'react';
import { formatBuildingName } from '@/lib/buildingName';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useBuildings } from '@/hooks/useBuildings';
import { useIssues } from '@/hooks/useIssues';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react';
import { PRIORITY_OPTIONS } from '@/lib/constants';
import type { IssuePriority } from '@/lib/constants';
import { PageLoading } from '@/components/ui/loading-spinner';
import { PhotoCapture, type PhotoFile } from '@/components/ui/photo-capture';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export default function NewIssue() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { buildings, loading: buildingsLoading } = useBuildings();
  const { createIssue } = useIssues({ autoFetch: false });

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [buildingId, setBuildingId] = useState(searchParams.get('building') || '');
  const [priority, setPriority] = useState<IssuePriority>('medium');
  const [deadline, setDeadline] = useState('');
  const [correctiveAction, setCorrectiveAction] = useState('');
  const [photos, setPhotos] = useState<PhotoFile[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Set default building if only one exists
  useEffect(() => {
    if (buildings.length === 1 && !buildingId) {
      setBuildingId(buildings[0].id);
    }
  }, [buildings, buildingId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      toast.error('Please enter an issue title');
      return;
    }

    if (!buildingId) {
      toast.error('Please select a building');
      return;
    }

    if (!description.trim()) {
      toast.error('Please enter a description');
      return;
    }

    if (!user) {
      toast.error('You must be logged in to report an issue');
      return;
    }

    setSubmitting(true);

    try {
      // Upload photos to Supabase Storage if any
      let photoUrls: string[] = [];
      
      if (photos.length > 0) {
        for (const photo of photos) {
          // photos/<uid>/… in the private tenant-documents bucket — the only
          // prefix a non-admin may write. (Previously building-logos, an
          // admin-write-only PUBLIC bucket, so site users were denied and
          // evidence leaked public when they weren't.)
          const fileName = `photos/${user.id}/${Date.now()}-${crypto.randomUUID()}.jpg`;
          const { error: uploadError } = await supabase.storage
            .from('tenant-documents')
            .upload(fileName, photo.file, { contentType: photo.file.type });

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
      }

      const issueId = await createIssue({
        title: title.trim(),
        description: description.trim(),
        building_id: buildingId,
        priority,
        status: 'open',
        deadline: deadline || null,
        corrective_action: correctiveAction.trim() || null,
        photo_urls: photoUrls.length > 0 ? photoUrls : null,
        reported_by: user.id,
        assigned_to: null,
        task_instance_id: null,
      });

      if (issueId) {
        navigate('/issues');
      }
    } catch (error) {
      console.error('Error creating issue:', error);
      toast.error('Failed to create issue');
    } finally {
      setSubmitting(false);
    }
  };

  if (buildingsLoading) {
    return <PageLoading text="Loading buildings..." />;
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-warning" />
            Report New Issue
          </h1>
          <p className="text-muted-foreground">
            Log a maintenance issue or safety concern
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>Issue Details</CardTitle>
            <CardDescription>
              Provide details about the issue you're reporting
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Building Selection */}
            <div className="space-y-2">
              <Label htmlFor="building">Building *</Label>
              <Select value={buildingId} onValueChange={setBuildingId}>
                <SelectTrigger id="building">
                  <SelectValue placeholder="Select a building" />
                </SelectTrigger>
                <SelectContent>
                  {buildings.map((building) => (
                    <SelectItem key={building.id} value={building.id}>
                      {formatBuildingName(building.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title">Issue Title *</Label>
              <Input
                id="title"
                placeholder="Brief summary of the issue"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={submitting}
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Description *</Label>
              <Textarea
                id="description"
                placeholder="Detailed description of the issue, including location and observations"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                disabled={submitting}
              />
            </div>

            {/* Priority */}
            <div className="space-y-2">
              <Label htmlFor="priority">Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as IssuePriority)}>
                <SelectTrigger id="priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Deadline */}
            <div className="space-y-2">
              <Label htmlFor="deadline">Resolution Deadline (Optional)</Label>
              <Input
                id="deadline"
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                disabled={submitting}
              />
            </div>

            {/* Corrective Action */}
            <div className="space-y-2">
              <Label htmlFor="corrective-action">Suggested Corrective Action (Optional)</Label>
              <Textarea
                id="corrective-action"
                placeholder="Suggested steps to resolve this issue"
                value={correctiveAction}
                onChange={(e) => setCorrectiveAction(e.target.value)}
                rows={2}
                disabled={submitting}
              />
            </div>

            {/* Photos */}
            <div className="space-y-2">
              <PhotoCapture
                label="Photo Evidence"
                photos={photos}
                onPhotosChange={setPhotos}
                maxPhotos={5}
                disabled={submitting}
              />
            </div>

            {/* Submit */}
            <div className="flex gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate(-1)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  'Report Issue'
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
