/**
 * ICS subscription controls for one scope: the user's own feed (`buildingId`
 * null, mounted on Profile) or a building feed (mounted in a dialog from the
 * building Calendar tab, admin/manager only).
 *
 * Renders content only — no Card shell — so the host decides the chrome.
 * The disclosure that the link is a secret is plain text (a guardrail), the
 * "how to use it" line is coaching and goes through `<Hint>`.
 */
import { useState } from 'react';
import { Copy, Loader2, RefreshCw, Link2, Ban } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Hint } from '@/components/ui/hint';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useCalendarToken, webcalUrl } from '@/lib/calendarTokens';

interface SubscribeCardProps {
  /** null = the user's own feed; a building id = that building's feed. */
  buildingId: string | null;
  /** Used for copy and the token label when this is a building feed. */
  buildingName?: string;
}

const TARGET = 'min-h-11';

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'Something went wrong. Try again.';
}

export function SubscribeCard({ buildingId, buildingName }: SubscribeCardProps) {
  const label = buildingId ? `Building · ${buildingName ?? buildingId}` : 'My calendar';
  const { url, isLoading, isError, isMutating, create, rotate, revoke } = useCalendarToken(buildingId, label);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);

  const scopeText = buildingId
    ? `every dated item for ${buildingName ?? 'this building'}`
    : 'every dated item across your buildings';

  const run = async (action: () => Promise<void>, done: string) => {
    try {
      await action();
      toast.success(done);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const copy = async (text: string, done: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(done);
    } catch {
      toast.error("Couldn't copy. Select the link and copy it yourself.");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Checking for a subscription link…
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-sm text-destructive" role="alert">
        Couldn't load your subscription link. Reload the page to try again.
      </p>
    );
  }

  if (!url) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          A subscription link puts {scopeText} — tasks, deadlines, inspections, expiries — into the calendar app
          you already use. Nothing is shared until you create one.
        </p>
        <Button className={TARGET} disabled={isMutating} onClick={() => run(create, 'Subscription link created')}>
          {isMutating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Link2 className="mr-2 h-4 w-4" aria-hidden="true" />}
          Create subscription link
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={`ics-url-${buildingId ?? 'me'}`}>Subscription link</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id={`ics-url-${buildingId ?? 'me'}`}
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className={`${TARGET} font-mono text-xs`}
          />
          <Button
            type="button"
            variant="secondary"
            className={`${TARGET} shrink-0`}
            onClick={() => copy(url, 'Link copied')}
          >
            <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
            Copy
          </Button>
        </div>
        <Button
          type="button"
          variant="outline"
          className={`${TARGET} w-full sm:w-auto`}
          onClick={() => copy(webcalUrl(url), 'webcal:// link copied')}
        >
          <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
          Copy as webcal://
        </Button>
      </div>

      <p className="text-sm">
        Anyone with this link can read your calendar titles. Rotate it if it leaks.
      </p>

      <Hint>Paste it into Outlook or Google Calendar as a subscription; it refreshes every few hours.</Hint>

      <div className="flex flex-col gap-2 sm:flex-row">
        <AlertDialog open={rotateOpen} onOpenChange={setRotateOpen}>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="outline" className={TARGET} disabled={isMutating}>
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
              Rotate
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Rotate this link?</AlertDialogTitle>
              <AlertDialogDescription>
                The current link stops working straight away and you get a new one. Any calendar app using the old
                link will need the new one pasted in.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className={TARGET}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className={TARGET}
                onClick={() => { setRotateOpen(false); void run(rotate, 'New link ready'); }}
              >
                Rotate link
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={revokeOpen} onOpenChange={setRevokeOpen}>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="ghost" className={`${TARGET} text-destructive hover:text-destructive`} disabled={isMutating}>
              <Ban className="mr-2 h-4 w-4" aria-hidden="true" />
              Turn off
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Turn off this subscription?</AlertDialogTitle>
              <AlertDialogDescription>
                The link stops working straight away. Calendar apps that use it will stop updating. You can create
                a new link at any time.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className={TARGET}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className={`${TARGET} bg-destructive text-destructive-foreground hover:bg-destructive/90`}
                onClick={() => { setRevokeOpen(false); void run(revoke, 'Subscription turned off'); }}
              >
                Turn off
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
