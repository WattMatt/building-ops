/**
 * Expiry alert shapes and rules. The implementation lives in
 * `supabase/functions/_shared/expiry.ts` so the `notify-expiring-alerts` and `daily-digest` edge
 * functions and the web app share one pure module; this file only re-exports it under the `@/lib`
 * alias (the same arrangement as src/lib/calendar/events.ts).
 */
export * from '../../supabase/functions/_shared/expiry';
