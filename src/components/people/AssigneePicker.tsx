/** Choose a building member (or nobody). Shared by tasks, issues and mentions. */
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBuildingMembers, memberDisplayName } from '@/hooks/useBuildingMembers';

const UNASSIGNED = '__unassigned__';

interface AssigneePickerProps {
  buildingId: string;
  value: string | null;
  onChange: (userId: string | null) => void;
  disabled?: boolean;
  allowUnassigned?: boolean;
  className?: string;
}

export function AssigneePicker({ buildingId, value, onChange, disabled, allowUnassigned = true, className }: AssigneePickerProps) {
  const { data: members, isLoading, isError } = useBuildingMembers(buildingId);
  const current = members?.find((m) => m.id === value);
  return (
    <Select
      value={value ?? UNASSIGNED}
      onValueChange={(v) => onChange(v === UNASSIGNED ? null : v)}
      disabled={disabled || isLoading}
    >
      <SelectTrigger className={className} aria-label="Assignee">
        <SelectValue placeholder="Unassigned">
          {value ? (current ? memberDisplayName(current) : 'Assigned user') : 'Unassigned'}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {allowUnassigned && <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>}
        {isError && <p className="px-2 py-1.5 text-xs text-destructive">Could not load people for this building.</p>}
        {(members ?? []).map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {memberDisplayName(m)}
            {m.role === 'admin' || m.role === 'manager' ? <span className="ml-1 text-xs text-muted-foreground">· {m.role}</span> : null}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
