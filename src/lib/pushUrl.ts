/**
 * Where a push notification may send the user when tapped.
 *
 * The service worker cannot import `supabase/functions/_shared/notifyRules.ts` (that module is
 * Deno-flavoured and lives outside the SW bundle), so the allowlist is copied here and
 * `src/lib/pushUrl.test.ts` asserts the two lists — and the two checks — never drift apart.
 *
 * The rules are the same as `isAllowedUrl` there: an allowlisted in-app prefix; for a bare
 * prefix (no trailing `/`) the next character must be absent, `/` or `?` so `/issuesanything`
 * does not ride on `/issues`; never protocol-relative (`//evil.example` is off-site once the
 * browser resolves it); no backslash (several clients normalise `\` to `/`, so `/issues\evil`
 * can escape the prefix it appears to match); and no longer than the `notifications.url`
 * column. Anything else lands on the inbox, where the notification row itself lives.
 */
export const PUSH_URL_PREFIXES = [
  '/issues', '/buildings/', '/reports/fortress/', '/my-signoffs', '/forms', '/inbox', '/my-day', '/calendar',
] as const;

/** Mirrors `URL_MAX` in notifyRules.ts (the width of `notifications.url`). */
export const PUSH_URL_MAX = 300;

/** The inbox always exists and always shows the row the push came from. */
export const PUSH_FALLBACK_URL = '/inbox';

/** Returns `url` when it is a safe in-app path, else `/inbox`. Never throws. */
export function safeInAppUrl(url: unknown): string {
  if (typeof url !== 'string' || url.length === 0 || url.length > PUSH_URL_MAX) return PUSH_FALLBACK_URL;
  if (url.startsWith('//') || url.includes('\\')) return PUSH_FALLBACK_URL;
  const allowed = PUSH_URL_PREFIXES.some((prefix) => {
    if (!url.startsWith(prefix)) return false;
    if (prefix.endsWith('/')) return true;
    const next = url.charAt(prefix.length);
    return next === '' || next === '/' || next === '?';
  });
  return allowed ? url : PUSH_FALLBACK_URL;
}
