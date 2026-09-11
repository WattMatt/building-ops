/**
 * Calendar event model (R3b). The canonical code lives in
 * `supabase/functions/_shared/calendar.ts` so the `ics-feed` edge function and the web app
 * share one definition of "an event"; this module only re-exports it for `@/lib/calendar`.
 */
export * from '../../../supabase/functions/_shared/calendar';
