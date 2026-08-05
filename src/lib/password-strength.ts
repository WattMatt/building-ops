/**
 * Password strength + breach checks for client-side use (Standard A5).
 *
 * Ported from ONBOARDING-STANDARD/kit/login-safety/password-strength.ts.
 * zxcvbn is not a dependency of this app, so the entropy score comes from the
 * kit-style heuristic scorer instead: length + character classes + a common-
 * password blocklist (with a small leetspeak normaliser so "P@ssw0rd1" is
 * caught alongside "password1"). Scores map to the same 0-4 scale zxcvbn uses.
 *
 * Breach check: HIBP Pwned Passwords via k-anonymity — only the first 5 chars
 * of the SHA-1 hash leave the browser; the full hash never transmits. The
 * Add-Padding header hides the real response size from network observers.
 *
 * The breach check is best-effort: a network failure returns `null` (unknown),
 * which must NOT block the user from setting a password — the submit gate
 * treats null as "allowed, warn"; only a confirmed breach blocks.
 */

export interface PasswordEvaluation {
  score: 0 | 1 | 2 | 3 | 4;
  warning: string;
  suggestions: string[];
  pwned: boolean | null; // null when the breach check failed (network)
  pwnCount: number | null;
}

/** Minimum acceptable heuristic score ("Fair"). Mirrors the kit's zxcvbn gate. */
export const MIN_SCORE = 2;

// ~35 most common passwords (rockyou/HIBP top lists), lowercase. Checked after
// leet-normalisation and after stripping trailing digits/symbols, so
// "Password123!" and "qwerty2024" are caught too.
const COMMON_PASSWORDS = new Set([
  "password",
  "passwort",
  "passw0rd",
  "letmein",
  "welcome",
  "monkey",
  "dragon",
  "qwerty",
  "qwertyuiop",
  "azerty",
  "abc123",
  "abcd1234",
  "iloveyou",
  "sunshine",
  "princess",
  "football",
  "baseball",
  "superman",
  "batman",
  "trustno1",
  "master",
  "shadow",
  "michael",
  "jennifer",
  "starwars",
  "whatever",
  "freedom",
  "secret",
  "admin",
  "administrator",
  "root",
  "login",
  "guest",
  "default",
  "changeme",
  "12345678",
  "123456789",
  "1234567890",
  "11111111",
  "00000000",
]);

const LEET_MAP: Record<string, string> = {
  "@": "a",
  "4": "a",
  "3": "e",
  "1": "i",
  "!": "i",
  "0": "o",
  $: "s",
  "5": "s",
  "7": "t",
};

function normalizeForBlocklist(password: string): string[] {
  const lower = password.toLowerCase();
  const deleet = lower.replace(/[@431!0$57]/g, (c) => LEET_MAP[c] ?? c);
  const candidates = new Set([lower, deleet]);
  // Strip trailing digits/symbols ("password123!", "qwerty2024").
  for (const c of [...candidates]) {
    candidates.add(c.replace(/[\d\W_]+$/, ""));
  }
  return [...candidates];
}

/** True when the password is (a light variation of) a top common password. */
export function isBlocklisted(password: string): boolean {
  return normalizeForBlocklist(password).some((c) => COMMON_PASSWORDS.has(c));
}

/**
 * Heuristic strength score on zxcvbn's 0-4 scale.
 * 0 = blocklisted or under 8 chars; gate passes at MIN_SCORE (2) and up.
 */
export function scorePassword(password: string): {
  score: PasswordEvaluation["score"];
  warning: string;
  suggestions: string[];
} {
  if (!password || password.length < 8) {
    return {
      score: 0,
      warning: "Too short",
      suggestions: ["Use at least 8 characters"],
    };
  }
  if (isBlocklisted(password)) {
    return {
      score: 0,
      warning: "This is a commonly used password",
      suggestions: ["Avoid dictionary words and common passwords"],
    };
  }

  let points = 1; // >= 8 chars
  if (password.length >= 12) points += 1;
  if (password.length >= 16) points += 1;

  const classes =
    Number(/[a-z]/.test(password)) +
    Number(/[A-Z]/.test(password)) +
    Number(/[0-9]/.test(password)) +
    Number(/[^a-zA-Z0-9]/.test(password));
  if (classes >= 3) points += 1;
  if (classes >= 4) points += 1;

  const suggestions: string[] = [];
  let warning = "";

  // Very low variety ("aaaaaaaa", "abababab") caps at Weak regardless of length.
  if (new Set(password).size <= 4) {
    points = Math.min(points, 1);
    warning = "Repeated characters are easy to guess";
    suggestions.push("Add more variety — avoid repeats and simple patterns");
  }

  const score = Math.min(4, points) as PasswordEvaluation["score"];
  if (score < 3) {
    if (password.length < 12) suggestions.push("Longer passwords are stronger — aim for 12+ characters");
    if (classes < 3) suggestions.push("Mix upper/lower case, numbers and symbols");
  }
  return { score, warning, suggestions };
}

async function sha1Hex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/**
 * HIBP k-anonymity check. Returns the breach count for the password,
 * 0 when not found, or `null` if the check failed (unknown — not "safe").
 */
export async function checkPwned(password: string): Promise<number | null> {
  try {
    const hash = await sha1Hex(password);
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true" },
    });
    if (!res.ok) return null;
    const text = await res.text();
    for (const line of text.split("\n")) {
      const [s, c] = line.trim().split(":");
      if (s === suffix) return parseInt(c ?? "0", 10) || 1;
    }
    return 0;
  } catch {
    return null;
  }
}

export async function evaluatePassword(password: string): Promise<PasswordEvaluation> {
  const { score, warning, suggestions } = scorePassword(password);
  const pwnCount = await checkPwned(password);
  return {
    score,
    warning,
    suggestions,
    pwned: pwnCount === null ? null : pwnCount > 0,
    pwnCount,
  };
}

/**
 * Submit gate shared by every password-set surface (SetPassword, ResetPassword,
 * Profile change-password). Blocks when the heuristic score is below MIN_SCORE
 * or the password is confirmed breached. A failed breach check (network) does
 * NOT block — fail-open per the standard, the meter surfaces the warning.
 */
export async function gatePassword(
  password: string
): Promise<{ ok: boolean; message?: string }> {
  const evaluation = await evaluatePassword(password);
  if (evaluation.score < MIN_SCORE) {
    return {
      ok: false,
      message:
        evaluation.warning ||
        "Password is too weak — use a longer mix of letters, numbers and symbols",
    };
  }
  if (evaluation.pwned) {
    return {
      ok: false,
      message: `This password appears in ${evaluation.pwnCount?.toLocaleString()} known data breaches — choose a different one`,
    };
  }
  return { ok: true };
}

export function strengthLabel(score: number): string {
  return ["Very weak", "Weak", "Fair", "Strong", "Very strong"][score] ?? "Unknown";
}

export function strengthColor(score: number): string {
  return ["#ef4444", "#f59e0b", "#fbbf24", "#34d399", "#10b981"][score] ?? "#6b7280";
}
