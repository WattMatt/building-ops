import { useId } from 'react';
import { Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Hint } from '@/components/ui/hint';
import { PUSH_ENABLED } from '@/lib/push';
import { usePushSubscription, type PushStatus } from '@/hooks/usePushSubscription';

/**
 * Status copy the user must see regardless of the hints setting: each line either
 * explains why the switch is unavailable (a requirement, not a tip) or states what
 * being on means. Coaching for the plain "off" state goes through <Hint> instead.
 */
const STATUS_COPY: Partial<Record<PushStatus, string>> = {
  denied: 'Notifications are blocked for this site. Allow them in your browser settings, then try again.',
  'ios-not-installed': 'On iPhone, add Building Ops to your home screen first, then turn this on.',
  on: "You'll get a push for assignments, mentions, sign-off requests and your tasks due today, following the switches below.",
  unsupported: "This browser can't receive push notifications.",
};

interface PushSwitchProps {
  /** The signed-in user the device subscription belongs to. */
  userId: string | undefined;
}

/**
 * "Push notifications on this device" row for the Profile Notifications card. Renders
 * nothing when the build has no VAPID key, so a preview without push never shows a
 * switch that cannot work.
 */
export function PushSwitch({ userId }: PushSwitchProps) {
  if (!PUSH_ENABLED) return null;
  return <PushSwitchOwned userId={userId} />;
}

function PushSwitchOwned({ userId }: PushSwitchProps) {
  const { status, enable, disable } = usePushSubscription(userId);
  return <PushSwitchRow status={status} enable={enable} disable={disable} />;
}

export interface PushSwitchRowProps {
  status: PushStatus;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  /**
   * Whether the plain "off" state carries its own <Hint>. The My Day prompt card owns the
   * subscription state and its own coaching line, so it passes false; guardrail copy
   * (blocked, unsupported, install first) is shown either way.
   */
  coaching?: boolean;
}

/**
 * The switch itself, driven by whoever owns the `usePushSubscription` instance. Shared by
 * the Profile switch and the My Day prompt card so there is exactly one subscribe path,
 * one set of guardrail copy and one 44 px target.
 */
export function PushSwitchRow({ status, enable, disable, coaching = true }: PushSwitchRowProps) {
  // Generated per instance: the row is shared by Profile and the My Day card, and a fixed id
  // would collide if both ever co-mount, sending the label's click to the wrong switch.
  const switchId = useId();
  const labelId = `${switchId}-label`;
  const disabled = status === 'busy' || status === 'denied' || status === 'unsupported' || status === 'ios-not-installed';
  const checked = status === 'on';
  const copy = STATUS_COPY[status];

  const onCheckedChange = async (next: boolean) => {
    try {
      if (next) await enable();
      else await disable();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Please try again.';
      toast.error(next ? "Couldn't turn on push notifications" : "Couldn't turn off push notifications", {
        description: message,
      });
    }
  };

  return (
    <div className="flex min-h-11 items-center justify-between gap-4">
      <div className="space-y-0.5">
        <Label id={labelId} htmlFor={switchId} className="flex items-center gap-2">
          <Smartphone className="h-4 w-4" />
          Push notifications on this device
        </Label>
        {copy ? (
          <p className="text-sm text-muted-foreground">{copy}</p>
        ) : status === 'off' && coaching ? (
          <Hint icon={false} className="text-sm">
            Turn this on to get urgent alerts on this device even when the app is closed.
          </Hint>
        ) : null}
      </div>
      {/* The 44 px label wrapper is the touch target; the visual switch stays 24 px tall. */}
      <label htmlFor={switchId} className="flex h-11 w-11 shrink-0 items-center justify-center">
        <Switch
          id={switchId}
          aria-labelledby={labelId}
          aria-busy={status === 'busy' || undefined}
          checked={checked}
          disabled={disabled}
          onCheckedChange={onCheckedChange}
        />
      </label>
    </div>
  );
}
