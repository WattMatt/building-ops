/**
 * Top-bar summary of the offline write queue. Guardrail, NOT a <Hint>: whether or not coaching
 * hints are on, the user must be able to see that work is waiting or has been rejected.
 *
 * States, first match wins:
 *   offline with pending ops   → "Offline · N queued"   (warning)      nothing can move yet
 *   failed ops                 → "N need attention"     (destructive)  a human has to retry/discard
 *   online with pending ops    → "Syncing…"             (muted)        the runner is replaying
 *   otherwise                  → nothing                 an "All synced" pill is noise in a top bar
 *
 * Offline outranks failed because a retry cannot succeed without a connection; online, a failed
 * op outranks the transient "Syncing…" because it will not clear itself.
 */
import { useState } from 'react';
import { AlertTriangle, Loader2, WifiOff } from 'lucide-react';
import { useOfflineQueue } from '@/hooks/useOfflineQueue';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { QueueSheet } from './QueueSheet';

type Tone = 'warning' | 'destructive' | 'muted';

const TONE_CLASS: Record<Tone, string> = {
  warning: 'bg-warning text-warning-foreground',
  destructive: 'bg-destructive text-destructive-foreground',
  muted: 'bg-muted text-muted-foreground',
};

export function SyncStatusPill() {
  const { ops, pending, failed, retry, discard } = useOfflineQueue();
  const online = useOnlineStatus();
  const [open, setOpen] = useState(false);

  let label: string;
  let tone: Tone;
  let Icon: typeof WifiOff;
  let spin = false;
  if (!online && pending > 0) {
    label = `Offline · ${pending} queued`;
    tone = 'warning';
    Icon = WifiOff;
  } else if (failed > 0) {
    label = `${failed} need attention`;
    tone = 'destructive';
    Icon = AlertTriangle;
  } else if (pending > 0) {
    label = 'Syncing…';
    tone = 'muted';
    Icon = Loader2;
    spin = true;
  } else {
    // Keep the sheet mounted while the last op drains so an open sheet does not vanish mid-look.
    if (!open) return null;
    return <QueueSheet open={open} onOpenChange={setOpen} ops={ops} retry={retry} discard={discard} />;
  }

  const openSheet = () => {
    track('offline_queue_opened', { pending, failed });
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={openSheet}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          'inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-xs font-medium whitespace-nowrap',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          TONE_CLASS[tone],
        )}
      >
        <Icon className={cn('h-4 w-4 shrink-0', spin && 'animate-spin')} aria-hidden="true" />
        <span>{label}</span>
      </button>
      <QueueSheet open={open} onOpenChange={setOpen} ops={ops} retry={retry} discard={discard} />
    </>
  );
}
