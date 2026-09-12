import { useState, useEffect, useRef } from 'react';
import { formatBuildingName } from '@/lib/buildingName';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useBuildings } from '@/hooks/useBuildings';
import { useIsMobile } from '@/hooks/use-mobile';
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
import { Hint } from '@/components/ui/hint';
import { AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react';
import { PRIORITY_OPTIONS } from '@/lib/constants';
import type { IssuePriority } from '@/lib/constants';
import { PageLoading } from '@/components/ui/loading-spinner';
import { PhotoCapture, type PhotoFile } from '@/components/ui/photo-capture';
import { enqueueAndRun } from '@/lib/offline/enqueueAndRun';
import { toastForOutcome } from '@/lib/offline/outcomeToast';
import { toast } from 'sonner';
import { parseCost } from '@/lib/money';
import { readLastBuilding, writeLastBuilding } from '@/lib/lastBuilding';
import { useIssueDraft } from '@/hooks/useIssueDraft';
import { cn } from '@/lib/utils';

/** 44 px tap target on phones (spec §8), the shared component's 40 px from `sm` up. */
const CONTROL = 'min-h-11 sm:min-h-10';

/**
 * Focus on one of these raises the software keyboard (or, for a native select / date input, the
 * bottom picker). The Radix select trigger is deliberately not one: it opens a popover above
 * the bar, and flipping the bar on every tap of it would only make the layout jump.
 */
function raisesKeyboard(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !['button', 'submit', 'reset', 'file', 'checkbox', 'radio', 'range', 'color'].includes(target.type);
  }
  return false;
}

export default function NewIssue() {
  const { user, isAdminOrManager } = useAuth();
  // Keyed on the user: a session change while the form is open (another tab's sign-in, an
  // expired token) remounts the form with the new user's draft. Without the key, the save
  // effect would rebind to the new uid and write A's fields and photos into B's store, and B's
  // own draft would never be restored because the hydration flag had already been set.
  return <NewIssueForm key={user?.id ?? ''} uid={user?.id} isAdminOrManager={isAdminOrManager} />;
}

function NewIssueForm({ uid, isAdminOrManager }: { uid: string | undefined; isAdminOrManager: boolean }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { buildings, loading: buildingsLoading } = useBuildings();
  // The app's phone test (same breakpoint as ResponsiveDialog). The action bar is pinned by
  // this decision rather than a CSS-only class so a test can observe it; the heights above use
  // plain responsive classes.
  const isMobile = useIsMobile();

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [buildingId, setBuildingId] = useState('');
  const [priority, setPriority] = useState<IssuePriority>('medium');
  const [deadline, setDeadline] = useState('');
  const [correctiveAction, setCorrectiveAction] = useState('');
  const [photos, setPhotos] = useState<PhotoFile[]>([]);
  // Admin/manager only (spec §8): a rough estimate at logging time; the actual cost is
  // entered on the issue when the work is done.
  const [estimatedCost, setEstimatedCost] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // iOS does not shrink the layout viewport for the keyboard, so a fixed bottom bar would sit
  // on top of the field being typed into. While a keyboard-raising field has focus the bar
  // renders inline instead, and returns to the thumb zone on blur.
  const [typing, setTyping] = useState(false);

  // Draft (spec §8): the form must survive the camera app and a reload. `hydrated` is set once
  // the read has settled and any draft has been applied; the save effect waits for it so the
  // empty first render never overwrites what the store holds.
  const { restored, ready: draftReady, save: saveDraft, clear: clearDraft } = useIssueDraft(uid);
  const [hydrated, setHydrated] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const hadContent = useRef(false);

  // Previews are object URLs — made here on restore, or by PhotoCapture, which revokes only
  // the ones the user removes. Whatever is still on screen when the page unmounts (submit,
  // Cancel, Back) is released here. Read through a ref so the cleanup sees the final list.
  const photosRef = useRef(photos);
  photosRef.current = photos;
  useEffect(() => () => {
    for (const p of photosRef.current) URL.revokeObjectURL(p.preview);
  }, []);

  // Building precedence (spec §8): ?building= → the user's only building → the building they
  // last reported from → empty. Decided once the roster has loaded and only while nothing is
  // chosen, so a roster refetch never overrides what the user picked. An id the roster does not
  // contain — a stale link, a remembered building since revoked or removed — falls through to
  // the next rule rather than being submitted blind to fail at RLS.
  useEffect(() => {
    if (buildingsLoading || buildingId) return;
    const known = (id: string) => buildings.some((b) => b.id === id);
    const fromUrl = searchParams.get('building');
    if (fromUrl && known(fromUrl)) { setBuildingId(fromUrl); return; }
    if (buildings.length === 1) { setBuildingId(buildings[0].id); return; }
    if (!uid) return;
    const last = readLastBuilding(uid);
    if (last && known(last)) setBuildingId(last);
  }, [buildings, buildingsLoading, buildingId, searchParams, uid]);

  // Restore, once the roster is known (the draft's building is checked against it like every
  // other id). Coerced field by field: a record written by an older build or damaged on disk
  // restores what it can and never throws at `title.trim()` on the next render.
  useEffect(() => {
    if (!draftReady || buildingsLoading || hydrated) return;
    if (restored) {
      const title = typeof restored.title === 'string' ? restored.title : '';
      const description = typeof restored.description === 'string' ? restored.description : '';
      const files = Array.isArray(restored.photos)
        ? restored.photos.filter((f): f is File => f instanceof File)
        : [];
      const priority = PRIORITY_OPTIONS.some((o) => o.value === restored.priority) ? restored.priority : 'medium';
      const building =
        typeof restored.buildingId === 'string' && buildings.some((b) => b.id === restored.buildingId)
          ? restored.buildingId
          : '';
      if (title.trim() !== '' || description.trim() !== '' || files.length > 0) {
        setTitle(title);
        setDescription(description);
        setPriority(priority);
        if (building) setBuildingId(building);
        setPhotos(files.map((file) => ({ file, preview: URL.createObjectURL(file) })));
        setDraftRestored(true);
      } else {
        // Nothing worth restoring: drop the record rather than show an empty "Draft restored" bar.
        clearDraft();
      }
    }
    setHydrated(true);
  }, [draftReady, buildingsLoading, buildings, hydrated, restored, clearDraft]);

  // Save on every change. Building and priority alone are not a draft (they are derived or
  // defaults), so a form the user has typed nothing into is never stored — and a form they
  // emptied again is cleared rather than kept as a blank record.
  useEffect(() => {
    if (!hydrated) return;
    const hasContent = title.trim() !== '' || description.trim() !== '' || photos.length > 0;
    if (hasContent) {
      hadContent.current = true;
      saveDraft({ title, description, buildingId, priority, photos: photos.map((p) => p.file) });
    } else if (hadContent.current) {
      hadContent.current = false;
      clearDraft();
    }
  }, [hydrated, title, description, buildingId, priority, photos, saveDraft, clearDraft]);

  const discardDraft = () => {
    for (const p of photos) URL.revokeObjectURL(p.preview);
    hadContent.current = false;
    clearDraft();
    setTitle('');
    setDescription('');
    setPriority('medium');
    setPhotos([]);
    // The building goes back through the precedence rule (URL, only building, last used).
    setBuildingId('');
    setDraftRestored(false);
  };

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

    if (!uid) {
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
      const outcome = await enqueueAndRun(uid, {
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
          reported_by: uid,
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
      // A queued issue already shows on the list with a "Queued" chip, so leave the form either
      // way; both outcomes mean the building was a real choice worth remembering next time.
      if (outcome.status !== 'failed') {
        writeLastBuilding(uid, buildingId);
        clearDraft();
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

  // Pinned to the bottom on a phone, except while the keyboard is up (see `typing`).
  const pinned = isMobile && !typing;

  return (
    // pb-28 while the bar is pinned keeps the last field clear of it.
    <div className={cn('space-y-6 max-w-2xl mx-auto', pinned && 'pb-28')}>
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" className="h-11 w-11 sm:h-10 sm:w-10" onClick={() => navigate(-1)} aria-label="Back">
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

      {/* Guardrail, not a <Hint>: a data-loss cue must show however experienced the user is. */}
      {draftRestored && (
        <div
          role="status"
          className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-sm"
        >
          <span>Draft restored</span>
          <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-9" onClick={discardDraft} disabled={submitting}>
            Discard
          </Button>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        onFocusCapture={(e) => { if (raisesKeyboard(e.target)) setTyping(true); }}
        onBlurCapture={(e) => {
          // Moving straight from one text field to another keeps the bar inline: no flash of
          // the pinned bar between the two focus events.
          if (raisesKeyboard(e.target) && !raisesKeyboard(e.relatedTarget)) setTyping(false);
        }}
      >
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
                <SelectTrigger id="building" className={CONTROL}>
                  <SelectValue placeholder="Select a building" />
                </SelectTrigger>
                <SelectContent>
                  {buildings.map((building) => (
                    <SelectItem key={building.id} value={building.id} className="min-h-11 sm:min-h-0">
                      {formatBuildingName(building.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Photos — first, directly under the building (spec §8): on site the photo is the
                report; the words come after. */}
            <div className="space-y-2">
              <PhotoCapture
                label="Photo Evidence"
                photos={photos}
                onPhotosChange={setPhotos}
                maxPhotos={5}
                disabled={submitting}
              />
              <Hint>One clear photo of the fault is worth more than a paragraph</Hint>
            </div>

            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title">Issue Title *</Label>
              <Input
                id="title"
                className={CONTROL}
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
                <SelectTrigger id="priority" className={CONTROL}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value} className="min-h-11 sm:min-h-0">
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
                className={CONTROL}
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
                  className={CONTROL}
                  value={estimatedCost}
                  onChange={(e) => setEstimatedCost(e.target.value)}
                  disabled={submitting}
                />
              </div>
            )}

            {/* Submit. On a phone the row is pinned above the home indicator (thumb zone);
                z-30 keeps it under the select popover, dialogs and the drawer (z-50). */}
            <div
              data-testid="issue-actions"
              className={cn(
                'flex gap-3',
                pinned
                  ? 'fixed inset-x-0 bottom-0 z-30 border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]'
                  : 'pt-4',
              )}
            >
              <Button
                type="button"
                variant="outline"
                className={cn(CONTROL, isMobile && 'flex-1')}
                onClick={() => navigate(-1)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" className={cn(CONTROL, isMobile && 'flex-[2]')} disabled={submitting}>
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
