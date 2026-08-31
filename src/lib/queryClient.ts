import { QueryClient } from '@tanstack/react-query';

// Module-level singleton so non-component code (e.g. AuthContext's signOut
// cache purge, STANDARD E3) can reach the same client App.tsx provides.
// Kept out of App.tsx to avoid an App <-> AuthContext import cycle.
// retry:1 rather than react-query's default of 3. The insight-linker RPCs run against a
// remote database behind an 8s statement timeout; three retries meant up to ~32s of a
// loading ellipsis before a failure surfaced, which reads as "still loading" and pushed
// users to conclude the data was simply absent.
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1 } },
});
