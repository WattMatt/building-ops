import { QueryClient } from '@tanstack/react-query';

// Module-level singleton so non-component code (e.g. AuthContext's signOut
// cache purge, STANDARD E3) can reach the same client App.tsx provides.
// Kept out of App.tsx to avoid an App <-> AuthContext import cycle.
export const queryClient = new QueryClient();
