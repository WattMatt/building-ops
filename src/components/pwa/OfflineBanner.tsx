import { useOnlineStatus } from '@/hooks/useOnlineStatus';

/**
 * Guardrail, NOT a <Hint>: the user must always know that saving will fail right now,
 * whether or not they have coaching hints switched on.
 */
export function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div role="status" className="bg-warning text-warning-foreground text-sm px-3 py-1.5 text-center">
      You&rsquo;re offline. Cached pages stay readable; saving needs a connection.
    </div>
  );
}
