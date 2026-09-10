/**
 * Edits a `RecurrenceRule` (src/lib/recurrence.ts): "Every N unit", the weekday chips for
 * weeks, the day-of-month and month pickers for months/years, the visibility lead, and a live
 * preview of the next six due dates so an admin sees what the rule means before saving.
 *
 * Controlled: the parent owns the rule and receives `(rule, valid)` on every change.
 * `recurrenceProblem()` is exported so the parent can gate Save on the seeded rule too.
 *
 * Validity mirrors `isValidRule`, but the editor checks the cases a person can reach here
 * (interval range, lead range, an empty weekday list) first so the guardrail line names the
 * field to fix instead of the generic "not valid".
 */
import { useMemo } from 'react';
import { format } from 'date-fns';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  describeRule,
  isValidRule,
  nextOccurrences,
  type RecurrenceRule,
  type RecurrenceUnit,
} from '@/lib/recurrence';
import { todayInOperatingTz } from '@/lib/myWork';

export interface RecurrenceEditorProps {
  value: RecurrenceRule;
  onChange: (rule: RecurrenceRule, valid: boolean) => void;
  /** Prefix for the field ids so two editors on a page never collide. */
  idPrefix?: string;
}

const UNITS: readonly RecurrenceUnit[] = ['day', 'week', 'month', 'year'];
const WEEKDAYS: ReadonlyArray<{ iso: number; label: string; long: string }> = [
  { iso: 1, label: 'Mon', long: 'Monday' },
  { iso: 2, label: 'Tue', long: 'Tuesday' },
  { iso: 3, label: 'Wed', long: 'Wednesday' },
  { iso: 4, label: 'Thu', long: 'Thursday' },
  { iso: 5, label: 'Fri', long: 'Friday' },
  { iso: 6, label: 'Sat', long: 'Saturday' },
  { iso: 7, label: 'Sun', long: 'Sunday' },
];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

/** Plain-text reason the rule cannot be saved, or null when it can. */
export function recurrenceProblem(rule: RecurrenceRule): string | null {
  if (!Number.isInteger(rule.every) || rule.every < 1 || rule.every > 52) return 'Repeat every 1 to 52 units';
  if (rule.lead !== undefined && (!Number.isInteger(rule.lead) || rule.lead < 0 || rule.lead > 60)) {
    return 'Show between 0 and 60 days before';
  }
  if (rule.unit === 'week' && (rule.weekdays ?? []).length === 0) return 'Pick at least one weekday';
  if (!isValidRule(rule)) return 'This schedule is not valid';
  return null;
}

/** `YYYY-MM-DD` → `dd MMM yyyy` without letting the local zone shift the day. */
export function formatIsoDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return format(new Date(y, m - 1, d), 'dd MMM yyyy');
}

/** Switch units keeping what carries over (every, lead) and seeding what the new unit needs. */
function withUnit(rule: RecurrenceRule, unit: RecurrenceUnit): RecurrenceRule {
  const base: RecurrenceRule = { every: rule.every, unit };
  if (rule.lead !== undefined) base.lead = rule.lead;
  if (unit === 'week') base.weekdays = rule.weekdays && rule.weekdays.length > 0 ? rule.weekdays : [1];
  if (unit === 'month' || unit === 'year') base.monthDay = rule.monthDay ?? 1;
  if (unit === 'year') base.month = rule.month ?? 1;
  return base;
}

const unitLabel = (unit: RecurrenceUnit, n: number) => (n === 1 ? unit : `${unit}s`);

export default function RecurrenceEditor({ value, onChange, idPrefix = 'recurrence' }: RecurrenceEditorProps) {
  const problem = recurrenceProblem(value);
  const emit = (next: RecurrenceRule) => onChange(next, recurrenceProblem(next) === null);

  const preview = useMemo(
    () => (problem === null ? nextOccurrences(value, 6, todayInOperatingTz()).map(formatIsoDay) : []),
    [value, problem],
  );

  const toggleWeekday = (iso: number) => {
    const current = value.weekdays ?? [];
    const weekdays = current.includes(iso) ? current.filter((d) => d !== iso) : [...current, iso].sort((a, b) => a - b);
    emit({ ...value, weekdays });
  };

  const numberFrom = (raw: string): number => (raw.trim() === '' ? Number.NaN : Number(raw));

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-every`}>Repeat</Label>
        <div className="flex items-center gap-2">
          <span className="text-sm">Every</span>
          <Input
            id={`${idPrefix}-every`}
            aria-label="Every"
            type="number"
            inputMode="numeric"
            min={1}
            max={52}
            className="h-11 w-20"
            value={Number.isNaN(value.every) ? '' : value.every}
            onChange={(e) => emit({ ...value, every: numberFrom(e.target.value) })}
          />
          <Select value={value.unit} onValueChange={(u) => emit(withUnit(value, u as RecurrenceUnit))}>
            <SelectTrigger aria-label="Unit" className="h-11 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UNITS.map((u) => (
                <SelectItem key={u} value={u}>
                  {unitLabel(u, value.every)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {value.unit === 'week' && (
        <div className="space-y-2">
          <Label>On</Label>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Weekdays">
            {WEEKDAYS.map((d) => {
              const on = (value.weekdays ?? []).includes(d.iso);
              return (
                <button
                  key={d.iso}
                  type="button"
                  aria-pressed={on}
                  aria-label={d.long}
                  onClick={() => toggleWeekday(d.iso)}
                  className={cn(
                    'h-11 min-w-[44px] rounded-md border px-3 text-sm font-medium transition-colors',
                    on ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted',
                  )}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {(value.unit === 'month' || value.unit === 'year') && (
        <div className="grid gap-3 sm:grid-cols-2">
          {value.unit === 'year' && (
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-month`}>In</Label>
              <Select value={String(value.month ?? 1)} onValueChange={(m) => emit({ ...value, month: Number(m) })}>
                <SelectTrigger id={`${idPrefix}-month`} aria-label="Month" className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((name, i) => (
                    <SelectItem key={name} value={String(i + 1)}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-monthday`}>On day</Label>
            <Select
              value={String(value.monthDay ?? 1)}
              onValueChange={(md) => emit({ ...value, monthDay: md === 'last' ? 'last' : Number(md) })}
            >
              <SelectTrigger id={`${idPrefix}-monthday`} aria-label="Day of month" className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTH_DAYS.map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {d}
                  </SelectItem>
                ))}
                <SelectItem value="last">Last day</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-lead`}>Visibility</Label>
        <div className="flex items-center gap-2">
          <span className="text-sm">Show</span>
          <Input
            id={`${idPrefix}-lead`}
            aria-label="Days before"
            type="number"
            inputMode="numeric"
            min={0}
            max={60}
            className="h-11 w-20"
            value={value.lead === undefined ? 0 : Number.isNaN(value.lead) ? '' : value.lead}
            onChange={(e) => emit({ ...value, lead: numberFrom(e.target.value) })}
          />
          <span className="text-sm">days before</span>
        </div>
      </div>

      <div className="rounded-md border bg-muted/40 p-3 text-sm">
        {problem === null ? (
          <>
            <p className="font-medium">{describeRule(value)}</p>
            <p className="text-muted-foreground" data-testid="recurrence-preview">
              Next: {preview.length > 0 ? preview.join(', ') : 'nothing in the next 3 years'}
            </p>
          </>
        ) : (
          <p className="text-destructive" role="alert">
            {problem}
          </p>
        )}
      </div>
    </div>
  );
}
