import { useEffect, useState } from 'react';
import {
  evaluatePassword,
  strengthColor,
  strengthLabel,
  type PasswordEvaluation,
} from '@/lib/password-strength';

interface PasswordStrengthMeterProps {
  password: string;
}

/**
 * PasswordStrengthMeter (Standard A5) — debounced live evaluation of the
 * password being typed. Renders a 5-step bar + label + (if breached) a
 * breach-count warning + (if scoring < 3) suggestions. Advisory only — it
 * never blocks submit itself; the actual gate is `gatePassword` inside each
 * form's submit handler.
 */
export function PasswordStrengthMeter({ password }: PasswordStrengthMeterProps) {
  const [evalResult, setEvalResult] = useState<PasswordEvaluation | null>(null);

  useEffect(() => {
    if (!password) {
      setEvalResult(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      void evaluatePassword(password).then((r) => {
        if (!cancelled) setEvalResult(r);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [password]);

  if (!password || !evalResult) return null;

  const { score, suggestions, pwned, pwnCount } = evalResult;
  const color = strengthColor(score);
  const label = strengthLabel(score);

  return (
    <div className="space-y-2 text-xs" data-testid="password-strength-meter">
      <div className="flex gap-1" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-1.5 flex-1 rounded-full bg-muted transition-colors"
            style={i <= score ? { backgroundColor: color } : undefined}
          />
        ))}
      </div>
      <p className="text-muted-foreground">
        Strength: <span style={{ color }}>{label}</span>
      </p>
      {pwned && pwnCount !== null && pwnCount > 0 && (
        <p className="text-destructive" role="alert">
          Found in {pwnCount.toLocaleString()} known data breaches. Choose a unique password.
        </p>
      )}
      {pwned === null && (
        <p className="text-muted-foreground">Breach-check unavailable (network).</p>
      )}
      {score < 3 && suggestions.length > 0 && (
        <ul className="text-muted-foreground list-disc list-inside space-y-0.5">
          {suggestions.slice(0, 2).map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
