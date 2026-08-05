import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import {
  scorePassword,
  isBlocklisted,
  checkPwned,
  evaluatePassword,
  gatePassword,
  strengthLabel,
  MIN_SCORE,
} from './password-strength';

// jsdom does not ship WebCrypto's subtle API — back it with Node's.
if (!globalThis.crypto?.subtle) {
  vi.stubGlobal('crypto', webcrypto);
}

/** Uppercase SHA-1 hex, computed independently of the implementation under test. */
function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex').toUpperCase();
}

function hibpResponse(body: string, ok = true) {
  return Promise.resolve({ ok, text: () => Promise.resolve(body) } as Response);
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (!globalThis.crypto?.subtle) {
    vi.stubGlobal('crypto', webcrypto);
  }
});

describe('scorePassword', () => {
  it('scores anything under 8 characters as 0', () => {
    expect(scorePassword('').score).toBe(0);
    expect(scorePassword('short7!').score).toBe(0);
  });

  it('scores a plain 8-char lowercase+digit password below the gate', () => {
    expect(scorePassword('wxyz9876').score).toBeLessThan(MIN_SCORE);
  });

  it('caps repeated-character passwords at Weak regardless of length', () => {
    expect(scorePassword('aaaaaaaaaaaaaaaa').score).toBeLessThanOrEqual(1);
    expect(scorePassword('abababababababab').score).toBeLessThanOrEqual(1);
  });

  it('scores long multi-class passwords as Strong or better', () => {
    expect(scorePassword('Tr0ub4dor&3-horse').score).toBeGreaterThanOrEqual(3);
    expect(scorePassword('correct-horse-battery-staple').score).toBeGreaterThanOrEqual(3);
  });

  it('scores a short but 4-class password at or above the gate', () => {
    expect(scorePassword('Mx9#pQ2v').score).toBeGreaterThanOrEqual(MIN_SCORE);
  });

  it('zeroes blocklisted passwords, including leet and trailing-suffix variants', () => {
    for (const pw of ['password', 'P@ssw0rd', 'Password123!', 'qwerty2024', 'letmein99']) {
      expect(scorePassword(pw).score, pw).toBe(0);
      expect(isBlocklisted(pw), pw).toBe(true);
    }
    expect(scorePassword('password').warning).toMatch(/commonly used/i);
  });

  it('does not blocklist unrelated passwords', () => {
    expect(isBlocklisted('grievous-plum-orbit-4')).toBe(false);
  });
});

describe('checkPwned (HIBP k-anonymity)', () => {
  const pw = 'Password123!';
  const hash = sha1(pw);
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  it('sends only the 5-char hash prefix, with Add-Padding', async () => {
    fetchMock.mockReturnValue(hibpResponse('AAAA:1'));
    await checkPwned(pw);

    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.pwnedpasswords.com/range/${prefix}`,
      { headers: { 'Add-Padding': 'true' } }
    );
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).not.toContain(suffix);
  });

  it('returns the breach count when the suffix matches', async () => {
    fetchMock.mockReturnValue(
      hibpResponse(`0018A45C4D1DEF81644B54AB7F969B88D65:5\r\n${suffix}:2470\r\nFFFFF:1`)
    );
    await expect(checkPwned(pw)).resolves.toBe(2470);
  });

  it('returns 0 when the suffix is absent (not breached)', async () => {
    fetchMock.mockReturnValue(hibpResponse('0018A45C4D1DEF81644B54AB7F969B88D65:5\r\nFFFFF:1'));
    await expect(checkPwned(pw)).resolves.toBe(0);
  });

  it('fails open with null on network failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(checkPwned(pw)).resolves.toBeNull();
  });

  it('fails open with null on a non-OK response', async () => {
    fetchMock.mockReturnValue(hibpResponse('', false));
    await expect(checkPwned(pw)).resolves.toBeNull();
  });
});

describe('evaluatePassword', () => {
  it('reports pwned=null (unknown) when the breach check fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    const result = await evaluatePassword('grievous-plum-orbit-4');

    expect(result.pwned).toBeNull();
    expect(result.pwnCount).toBeNull();
    expect(result.score).toBeGreaterThanOrEqual(MIN_SCORE);
  });
});

describe('gatePassword (submit gate)', () => {
  it('blocks weak passwords (score < 2)', async () => {
    fetchMock.mockReturnValue(hibpResponse('AAAA:1'));
    const gate = await gatePassword('wxyz9876');

    expect(gate.ok).toBe(false);
    expect(gate.message).toBeTruthy();
  });

  it('blocks blocklisted passwords with the common-password message', async () => {
    fetchMock.mockReturnValue(hibpResponse('AAAA:1'));
    const gate = await gatePassword('Password123!');

    expect(gate.ok).toBe(false);
    expect(gate.message).toMatch(/commonly used/i);
  });

  it('blocks a strong-looking but breached password', async () => {
    const pw = 'Tr0ub4dor&3-horse';
    const suffix = sha1(pw).slice(5);
    fetchMock.mockReturnValue(hibpResponse(`${suffix}:31337`));
    const gate = await gatePassword(pw);

    expect(gate.ok).toBe(false);
    expect(gate.message).toMatch(/data breaches/i);
  });

  it('allows a strong, clean password', async () => {
    fetchMock.mockReturnValue(hibpResponse('AAAA:1\r\nBBBB:2'));
    await expect(gatePassword('grievous-plum-orbit-4')).resolves.toEqual({ ok: true });
  });

  it('fails open when the breach check is unavailable (network down)', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    await expect(gatePassword('grievous-plum-orbit-4')).resolves.toEqual({ ok: true });
  });
});

describe('strengthLabel', () => {
  it('maps the 0-4 scale to the shared labels', () => {
    expect(strengthLabel(0)).toBe('Very weak');
    expect(strengthLabel(2)).toBe('Fair');
    expect(strengthLabel(4)).toBe('Very strong');
  });
});
