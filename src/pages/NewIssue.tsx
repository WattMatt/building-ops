import { useState, useEffect } from 'react';
import { formatBuildingName } from '@/lib/buildingName';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useBuildings } from '@/hooks/useBuildings';
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
import { enqueueAndRun } from '@/lib/offline/enqueueAndRun';
import { toastForOutcome } from '@/lib/offline/outcomeToast';
import { toast } from 'sonner';
import { parseCost } from '@/lib/money';

export default function NewIssue() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, isAdminOrManager } = useAuth();
  const { buildings, loading: buildingsLoading } = useBuildings();

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [buildingId, setBuildingId] = useState(searchParams.get('building') || '');
  const [priority, setPriority] = useState<IssuePriority>('medium');
  const [deadline, setDeadline] = useState('');
  const [correctiveAction, setCorrectiveAction] = useState('');
  const [photos, setPhotos] = useState<PhotoFile[]>([]);
  // Admin/manager only (spec §8): a rough estimate at logging time; the actual cost is
  // entered on the issue when the work is done.
  const [estimatedCost, setEstimatedCost] = useState('');
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

    const estimate = isAdminOrManager ? parseCost(estimatedCost) : null;
    if (estimate === undefined) {
      toast.error('Estimated cost must be an amount of R 0 or more');
      return;
    }

    setSubmitting(true);

    try {
      // The insert and its photo upload run in the offline queue handler, now (online) or on
      // replay (offline); photos land under photos/<uid>/… (see src/lib/photos.ts). The
      // client-generated issue id makes a retry collide rather than duplicate.
      const outcome = await enqueueAndRun(user.id, {
        kind: 'issue_create',
        issueId: crypto.randomUUID(),
        row: {
          title: title.trim(),
          description: description.trim(),
          priority,
          status: 'open',
          building_id: buildingId,
          deadline: deadline || null,
          corrective_action: correctiveAction.trim() || null,
          reported_by: user.id,
          assigned_to: null,
          task_instance_id: null,
          // Only admin/manager may write a cost; everyone else's row omits the column.
          ...(isAdminOrManager ? { estimated_cost: estimate } : {}),
        },
        markTaskIssueLogged: null,
      }, photos.map((p) => ({ file: p.file })));
      toastForOutcome(outcome, {
        synced: 'Issue reported successfully',
        queued: "Issue saved on this device — it will be reported when you're back online",
      });
      // A queued issue already shows on the list with a "Queued" chip, so leave the form either way.
      if (outcome.status !== 'failed') {
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

            {/* Estimated cost (admin/manager) */}
            {isAdminOrManager && (
              <div className="space-y-2">
                <Label htmlFor="estimated-cost">Estimated cost (R) (Optional)</Label>
                <Input
                  id="estimated-cost"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  placeholder="0"
                  className="h-11"
                  value={estimatedCost}
                  onChange={(e) => setEstimatedCost(e.target.value)}
                  disabled={submitting}
                />
              </div>
            )}

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
