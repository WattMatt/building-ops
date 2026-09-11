/**
 * Choose a contractor from the register (or none). Shared by issue detail, asset service
 * history, PPM plan lines and the building professional-team form. Reads are org-wide, so any
 * signed-in user can pick; whether the pick is saved is the caller's (and RLS's) business.
 */
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useContractors, type Contractor } from '@/hooks/useContractors';

const NONE = '__none__';

export function toContractorSelectValue(id: string | null): string {
  return id ?? NONE;
}

export function fromContractorSelectValue(v: string): string | null {
  return v === NONE ? null : v;
}

/** "Company · Trade" — the trade is what a caller scanning a long list is usually after. */
export function contractorLabel(c: Pick<Contractor, 'company_name' | 'trade'>): string {
  return c.trade ? `${c.company_name} · ${c.trade}` : c.company_name;
}

const sameTrade = (a: string | null | undefined, b: string) => (a ?? '').trim().toLowerCase() === b.trim().toLowerCase();

interface ContractorPickerProps {
  value: string | null;
  onChange: (contractorId: string | null) => void;
  /** Narrow the list to contractors of this trade (case-insensitive). The current value always stays listed. */
  trade?: string;
  disabled?: boolean;
  /** Also list inactive contractors. Off by default; the current value always stays listed. */
  includeInactive?: boolean;
  className?: string;
  id?: string;
  /** Label shown in the trigger when nothing is chosen. Defaults to 'None'. */
  placeholder?: string;
  'aria-label'?: string;
}

export function ContractorPicker({
  value,
  onChange,
  trade,
  disabled,
  includeInactive = false,
  className,
  id,
  placeholder = 'None',
  'aria-label': ariaLabel = 'Contractor',
}: ContractorPickerProps) {
  const { contractors, isLoading, isError } = useContractors();
  const current = contractors.find((c) => c.id === value);
  const options = contractors.filter((c) => {
    if (c.id === value) return true;
    if (!includeInactive && c.is_active === false) return false;
    if (trade && !sameTrade(c.trade, trade)) return false;
    return true;
  });

  return (
    <div className={className}>
      <Select
        value={toContractorSelectValue(value)}
        onValueChange={(v) => onChange(fromContractorSelectValue(v))}
        disabled={disabled || isLoading}
      >
        <SelectTrigger id={id} aria-label={ariaLabel} className="min-h-11">
          <SelectValue>
            {value ? (current ? contractorLabel(current) : 'Contractor') : placeholder}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>None</SelectItem>
          {options.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {contractorLabel(c)}
              {c.is_active === false ? <span className="ml-1 text-xs text-muted-foreground">· inactive</span> : null}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isError && <p className="mt-1 text-xs text-destructive">Could not load the contractor register.</p>}
    </div>
  );
}
