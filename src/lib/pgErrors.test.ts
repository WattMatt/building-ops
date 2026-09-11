import { describe, it, expect } from 'vitest';
import { ALREADY_EXISTS_MESSAGE, rethrowPgError, throwIfRefused, type PgError } from './pgErrors';

const DENIED = 'Only admins and managers can change this.';

describe('throwIfRefused', () => {
  it('returns normally when there is no error and at least one row came back', () => {
    expect(() => throwIfRefused(null, [{ id: 'x' }], DENIED)).not.toThrow();
  });

  it('zero rows with no error is the denied message (RLS filtered the write silently)', () => {
    expect(() => throwIfRefused(null, [], DENIED)).toThrow(DENIED);
    expect(() => throwIfRefused(null, null, DENIED)).toThrow(DENIED);
    expect(() => throwIfRefused(undefined, undefined, DENIED)).toThrow(DENIED);
  });

  it('42501 is the denied message whatever the database said', () => {
    expect(() => throwIfRefused({ code: '42501', message: 'ppm_services.overrides: admin or manager only' }, null, DENIED)).toThrow(DENIED);
  });

  it('23505 is "already exists", with the caller\'s wording when given', () => {
    expect(() => throwIfRefused({ code: '23505', message: 'duplicate key' }, null, DENIED)).toThrow(ALREADY_EXISTS_MESSAGE);
    expect(() => throwIfRefused({ code: '23505', message: 'duplicate key' }, null, DENIED, 'That service is already on this report.'))
      .toThrow('That service is already on this report.');
  });

  it('any other error is rethrown as an Error carrying the message and the code', () => {
    let caught: PgError | null = null;
    try { throwIfRefused({ code: '23503', message: 'violates foreign key' }, null, DENIED); } catch (e) { caught = e as PgError; }
    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toBe('violates foreign key');
    expect(caught?.code).toBe('23503');
  });

  it('an error without a message still produces a readable Error', () => {
    expect(() => throwIfRefused({ code: 'XX000' }, null, DENIED)).toThrow('The database refused the change.');
  });
});

describe('rethrowPgError', () => {
  it('is the error half only: no rows check', () => {
    expect(() => rethrowPgError(null, DENIED)).not.toThrow();
    expect(() => rethrowPgError({ code: '42501' }, DENIED)).toThrow(DENIED);
  });
});
