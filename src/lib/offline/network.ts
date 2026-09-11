/**
 * Only a transport failure counts as "network": the TypeError fetch throws, or the same message
 * after supabase-js/postgrest-js has wrapped it into a plain error object. A bare TypeError is a
 * programming bug and must surface as failed, not retry silently; a statement timeout (57014) is
 * a real rejection, so "timed out" is deliberately not matched.
 *
 * Lives on its own so both the replay loop (which classifies a whole op) and the handlers (which
 * decide whether a best-effort write may swallow its error) share one definition.
 */
export function isNetworkError(e: unknown): boolean {
  const msg = (e as { message?: string } | null)?.message ?? '';
  return (
    (e instanceof TypeError && /fetch|network|load failed/i.test(e.message)) ||
    /failed to fetch|network ?error|load failed|networkrequest/i.test(msg)
  );
}
