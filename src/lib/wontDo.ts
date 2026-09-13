/**
 * The web app's view of the "Can't do" vocabulary. The module itself lives beside the digest code
 * (supabase/functions/_shared/wontDo.ts) so the daily-digest edge function bundles the same list;
 * this re-export is the only path app code imports. Same relative-import idiom as
 * src/lib/digest.test.ts, and the file is in the tsc program through this import.
 */
export * from '../../supabase/functions/_shared/wontDo';
