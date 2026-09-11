/**
 * The due-date rule for generated tasks, mirrored from public.scheduled_due_date so the UI can
 * label "this period" without asking the server. docs/fixtures/frequency-due-dates.json pins
 * both implementations; change one, change the fixture, and the other fails.
 */
import type { TaskFrequency } from '@/lib/constants';

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

export function scheduledDueDate(frequency: TaskFrequency, todayIso: string): string {
  const [y, m, d] = todayIso.split('-').map(Number);
  switch (frequency) {
    case 'daily': return todayIso;
    case 'weekly': {
      const dt = new Date(Date.UTC(y, m - 1, d));
      const dow = (dt.getUTCDay() + 6) % 7; // Monday = 0 … Sunday = 6
      dt.setUTCDate(dt.getUTCDate() + (6 - dow));
      return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
    }
    case 'monthly': return m === 12 ? iso(y + 1, 1, 1) : iso(y, m + 1, 1);
    case 'quarterly': { const q = Math.floor((m - 1) / 3); return q === 3 ? iso(y + 1, 1, 1) : iso(y, q * 3 + 4, 1); }
    case 'annually': return iso(y + 1, 1, 1);
    default: return todayIso;
  }
}

export const ALL_FREQUENCIES: TaskFrequency[] = ['daily', 'weekly', 'monthly', 'quarterly', 'annually'];
