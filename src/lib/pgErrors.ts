/**
 * Turn a PostgREST write result into a plain, user-facing error — one definition shared by
 * every hook that writes with `.select('id')` so an RLS-filtered update (zero rows, no
 * error) and an explicit `42501` read the same to the user.
 *
 *   const { data, error } = await supabase.from('t').update(patch).eq('id', id).select('id');
 *   throwIfRefused(error, data, "Only admins and managers can change this.");
 *
 * Codes are SQLSTATEs: 42501 insufficient_privilege (a guard trigger or RLS `raise`),
 * 23505 unique_violation. Anything else is rethrown as an Error carrying the database
 * message and code, so callers can still branch on `code` while `message` stays readable.
 */
export interface PgErrorLike {
  code?: string | null;
  message?: string | null;
}

export const PG_INSUFFICIENT_PRIVILEGE = '42501';
export const PG_UNIQUE_VIOLATION = '23505';

/** Default copy for a 23505 when the caller has nothing more specific to say. */
export const ALREADY_EXISTS_MESSAGE = 'That record already exists.';

/** An Error that keeps the SQLSTATE beside the message. */
export interface PgError extends Error {
  code?: string;
}

/**
 * Throw for a non-null `error`: 42501 → `deniedMessage`, 23505 → `existsMessage`, anything
 * else → an Error with the database message (and `code`). Returns normally when `error`
 * is null so it can be followed by the rows check.
 */
export function rethrowPgError(
  error: PgErrorLike | null | undefined,
  deniedMessage: string,
  existsMessage: string = ALREADY_EXISTS_MESSAGE,
): void {
  if (!error) return;
  if (error.code === PG_INSUFFICIENT_PRIVILEGE) throw new Error(deniedMessage);
  if (error.code === PG_UNIQUE_VIOLATION) throw new Error(existsMessage);
  const e: PgError = new Error(error.message || 'The database refused the change.');
  if (error.code) e.code = error.code;
  throw e;
}

/**
 * `rethrowPgError`, then treat an empty result as a refusal: RLS filters a write it does
 * not allow out of an UPDATE/INSERT … RETURNING silently — no error, no rows — and that is a
 * permission problem, not a success.
 */
export function throwIfRefused(
  error: PgErrorLike | null | undefined,
  rows: readonly unknown[] | null | undefined,
  deniedMessage: string,
  existsMessage: string = ALREADY_EXISTS_MESSAGE,
): void {
  rethrowPgError(error, deniedMessage, existsMessage);
  if (!rows || rows.length === 0) throw new Error(deniedMessage);
}
