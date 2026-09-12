import { useState } from 'react';
import { BellRing } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Hint } from '@/components/ui/hint';
import { PUSH_ENABLED } from '@/lib/push';
import { usePushSubscription } from '@/hooks/usePushSubscription';
import { PushSwitchRow } from '@/components/profile/PushSwitch';

/** Per user, per device: a shared phone must not hide the offer from the next person who signs in. */
const dismissedKey = (uid: string) => `fortress.pushPrompt.dismissed.${uid}`;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'> | null;

// window.localStorage (not the bare global): Node exposes its own undefined `localStorage`
// global that shadows the browser one under vitest. The getter itself can throw (a browser
// with site data blocked), so even reaching for it is guarded.
function deviceStorage(): StorageLike {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** True when this user dismissed the prompt on this device. Unavailable storage reads as "not dismissed". */
export function readDismissed(uid: string, storage: StorageLike = deviceStorage()): boolean {
  try {
    return storage?.getItem(dismissedKey(uid)) === '1';
  } catch {
    return false;
  }
}

/** Best-effort: in private mode the card simply comes back next visit, which is acceptable. */
export function writeDismissed(uid: string, storage: StorageLike = deviceStorage()): void {
  try {
    storage?.setItem(dismissedKey(uid), '1');
  } catch {
    /* see above */
  }
}

interface PushPromptCardProps {
  /** The signed-in user the device subscription would belong to. */
  userId: string | undefined;
}

/**
 * "Turn on push notifications" offer on My Day, above the week strip. Shown only when the
 * build has a VAPID key, someone is signed in, this device is plainly off (not blocked,
 * not unsupported, not an uninstalled iOS tab — InstallCard covers that one) and the user
 * has not dismissed it here. The body is coaching copy, so it goes through <Hint>; the
 * switch and Dismiss stay visible regardless.
 *
 * The card owns the `usePushSubscription` instance and hands its state to the same
 * `PushSwitchRow` the Profile page uses, so there is one subscribe path and the card's
 * visibility follows the very switch the user just flipped.
 */
export function PushPromptCard({ userId }: PushPromptCardProps) {
  if (!PUSH_ENABLED || !userId) return null;
  // Keyed on the user so the dismissed flag is re-read when the account changes without an unmount.
  return <PushPromptCardOwned key={userId} userId={userId} />;
}

function PushPromptCardOwned({ userId }: { userId: string }) {
  const { status, enable, disable } = usePushSubscription(userId);
  const [dismissed, setDismissed] = useState(() => readDismissed(userId));
  // The hook also reports 'busy' during its first probe on mount; the card must not flash
  // then. Once the user has touched the switch here the card stays for every outcome but
  // 'on': through 'busy' while subscribing, and through 'denied' / 'unsupported' so the
  // row's guardrail copy explains what just happened instead of the card vanishing.
  const [engaged, setEngaged] = useState(false);

  if (dismissed) return null;
  const visible = status === 'off' || (engaged && status !== 'on');
  if (!visible) return null;

  const onEnable = async () => {
    setEngaged(true);
    await enable();
  };

  const onDismiss = () => {
    writeDismissed(userId);
    setDismissed(true);
  };

  return (
    <Card data-testid="push-prompt-card">
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <BellRing className="h-4 w-4 shrink-0" aria-hidden="true" />
          Turn on push notifications
        </div>
        <Hint icon={false} className="text-sm">
          Get a push when a task is assigned to you and each morning for what's due today.
        </Hint>
        <PushSwitchRow status={status} enable={onEnable} disable={disable} coaching={false} />
        <Button variant="outline" className="h-11 w-full" onClick={onDismiss}>
          Dismiss
        </Button>
      </CardContent>
    </Card>
  );
}
