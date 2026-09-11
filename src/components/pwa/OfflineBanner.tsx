import { useOnlineStatus } from '@/hooks/useOnlineStatus';

/**
 * Guardrail, NOT a <Hint>: the user must always know they are offline and what that means
 * for their changes, whether or not they have coaching hints switched on. Task and issue
 * writes are queued (see OfflineQueueRunner / SyncStatusPill), so the banner promises the sync
 * for those — and only those: reports, forms, sign-offs and admin still fail offline.
 */
export function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div role="status" className="bg-warning text-warning-foreground text-sm px-3 py-1.5 text-center">
      You&rsquo;re offline. Your day is available; tasks and issues you change will sync when you&rsquo;re back online.
    </div>
  );
}
