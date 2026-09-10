/** Choose a building member (or nobody). Shared by tasks, issues and mentions. */
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBuildingMembers, memberDisplayName } from '@/hooks/useBuildingMembers';

const UNASSIGNED = '__unassigned__';

export function toSelectValue(id: string | null): string {
  return id ?? UNASSIGNED;
}

export function fromSelectValue(v: string): string | null {
  return v === UNASSIGNED ? null : v;
}

interface AssigneePickerProps {
  buildingId: string;
  value: string | null;
  onChange: (userId: string | null) => void;
  disabled?: boolean;
  allowUnassigned?: boolean;
  className?: string;
  id?: string;
  /** Label shown in the trigger when nothing is chosen. Defaults to 'Unassigned'. */
  placeholder?: string;
}

export function AssigneePicker({ buildingId, value, onChange, disabled, allowUnassigned = true, className, id, placeholder = 'Unassigned' }: AssigneePickerProps) {
  const { data: members, isLoading, isError } = useBuildingMembers(buildingId);
  const current = members?.find((m) => m.id === value);
  return (
    <div className={className}>
      <Select
        value={toSelectValue(value)}
        onValueChange={(v) => onChange(fromSelectValue(v))}
        disabled={disabled || isLoading}
      >
        <SelectTrigger id={id} aria-label="Assignee">
          <SelectValue>
            {value ? (current ? memberDisplayName(current) : 'Assigned user') : placeholder}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {allowUnassigned && <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>}
          {(members ?? []).map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {memberDisplayName(m)}
              {m.role === 'admin' || m.role === 'manager' ? <span className="ml-1 text-xs text-muted-foreground">· {m.role}</span> : null}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isError && <p className="mt-1 text-xs text-destructive">Could not load people for this building.</p>}
    </div>
  );
}
