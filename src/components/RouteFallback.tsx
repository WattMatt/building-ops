/** Suspense fallback for lazily loaded route pages. Lives in the shell chunk, so it
 *  stays tiny: one spinner, no layout, no data. */
import { Loader2 } from 'lucide-react';

export default function RouteFallback() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="flex min-h-[50vh] w-full items-center justify-center"
    >
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
