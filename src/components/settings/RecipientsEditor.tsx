/**
 * The recipients of a report schedule: external addresses (typed in) and colleagues (picked from the
 * building's members). A colleague row carries `user_id` and a display name but NO email — other users'
 * profiles are not readable under RLS, so the edge function resolves the address with the service role
 * (`report_recipients_valid()` accepts `user_id` alone for the same reason). Validation messages are
 * plain text, never a Hint: they must show with hints off.
 */
import { useState } from 'react';
import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBuildingMembers, memberDisplayName } from '@/hooks/useBuildingMembers';
import { isEmail, type Recipient } from '@/hooks/useReportSchedules';
import { recipientLabel } from '@/lib/reportSchedule';

export const RECIPIENTS_MAX = 50;
/** `report_recipients_valid()` rejects `length(name) > 120`; the form must not offer what the DB refuses. */
export const RECIPIENT_NAME_MAX = 120;
const NAME_TOO_LONG = `A name can be at most ${RECIPIENT_NAME_MAX} characters.`;

interface RecipientsEditorProps {
  value: Recipient[];
  onChange: (next: Recipient[]) => void;
  /** The building whose members the colleague picker offers; undefined/null hides the picker. */
  buildingId?: string | null;
  disabled?: boolean;
}

export function RecipientsEditor({ value, onChange, buildingId, disabled }: RecipientsEditorProps) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { data: members, isLoading: membersLoading, isError: membersError } = useBuildingMembers(buildingId ?? undefined);
  // Radix Select keeps the last chosen value; remounting it after each add puts the placeholder back.
  const [pickerKey, setPickerKey] = useState(0);
  const full = value.length >= RECIPIENTS_MAX;
  const locked = disabled || full;

  const addEmail = () => {
    const address = email.trim().toLowerCase();
    if (!isEmail(address)) {
      setError('Enter a valid email address.');
      return;
    }
    if (value.some((r) => r.email?.toLowerCase() === address)) {
      setError('That address is already a recipient.');
      return;
    }
    const n = name.trim();
    if (n.length > RECIPIENT_NAME_MAX) {
      setError(NAME_TOO_LONG);
      return;
    }
    const row: Recipient = { email: address };
    if (n) row.name = n;
    onChange([...value, row]);
    setEmail('');
    setName('');
    setError(null);
  };

  const addColleague = (userId: string | null) => {
    if (!userId) return;
    if (value.some((r) => r.user_id === userId)) {
      setError('That colleague is already a recipient.');
      return;
    }
    const member = members?.find((m) => m.id === userId);
    // A colleague's name is derived, not typed, so an over-long one is trimmed rather than refused —
    // there would be nothing for the admin to correct.
    const display = (member ? memberDisplayName(member) : 'Colleague').slice(0, RECIPIENT_NAME_MAX);
    onChange([...value, { user_id: userId, name: display }]);
    setError(null);
    setPickerKey((k) => k + 1);
  };

  const remove = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
    setError(null);
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">Recipients</p>
        {value.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recipients yet.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {value.map((r, i) => {
              const label = recipientLabel(r);
              return (
                <li key={r.user_id ?? r.email ?? i} className="flex items-center gap-1 rounded-full border bg-muted/40 pl-3 text-sm">
                  <span className="truncate max-w-[14rem]">{label}</span>
                  {r.user_id && <Badge variant="outline" className="text-[10px]">colleague</Badge>}
                  {r.user_id === undefined && r.name && <span className="text-xs text-muted-foreground truncate max-w-[10rem]">{r.email}</span>}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 rounded-full"
                    aria-label={`Remove ${label}`}
                    onClick={() => remove(i)}
                    disabled={disabled}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="space-y-1">
          <Label htmlFor="recipient-email">Email address</Label>
          <Input
            id="recipient-email"
            type="email"
            inputMode="email"
            autoComplete="off"
            className="h-11"
            value={email}
            onChange={(e) => { setEmail(e.target.value); if (error) setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addEmail(); } }}
            disabled={locked}
            aria-invalid={error === 'Enter a valid email address.' || error === 'That address is already a recipient.' ? true : undefined}
            aria-describedby={error ? 'recipients-error' : undefined}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="recipient-name">Name (optional)</Label>
          <Input
            id="recipient-name"
            autoComplete="off"
            className="h-11"
            maxLength={RECIPIENT_NAME_MAX}
            value={name}
            onChange={(e) => { setName(e.target.value); if (error === NAME_TOO_LONG) setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addEmail(); } }}
            disabled={locked}
            aria-invalid={error === NAME_TOO_LONG ? true : undefined}
            aria-describedby={error ? 'recipients-error' : undefined}
          />
        </div>
        <Button type="button" variant="outline" className="min-h-11" onClick={addEmail} disabled={locked}>
          Add email
        </Button>
      </div>

      {buildingId && (
        <div className="space-y-1">
          <Label htmlFor="recipient-colleague">Add colleague</Label>
          <Select key={pickerKey} onValueChange={addColleague} disabled={locked || membersLoading}>
            <SelectTrigger id="recipient-colleague" aria-label="Add colleague" className="h-11 max-w-sm">
              <SelectValue placeholder="Choose a colleague" />
            </SelectTrigger>
            <SelectContent>
              {(members ?? []).map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {memberDisplayName(m)}
                  {m.role === 'admin' || m.role === 'manager' ? <span className="ml-1 text-xs text-muted-foreground">· {m.role}</span> : null}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {membersError && <p className="text-xs text-destructive">Could not load people for this building.</p>}
        </div>
      )}

      {error && <p id="recipients-error" className="text-xs text-destructive">{error}</p>}
      {full && <p className="text-xs text-muted-foreground">A schedule can have at most {RECIPIENTS_MAX} recipients.</p>}
    </div>
  );
}
