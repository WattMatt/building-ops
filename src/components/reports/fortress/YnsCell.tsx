/** Tristate yes/no/na select cell — shared by the per-tenant compliance & shop-spec
 *  matrices (the wide auto-saving tables that don't use EditableGrid). */
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { YesNoNa } from '@/integrations/supabase/fortress-db';

export function YnsCell({ value, disabled, onChange }: { value: YesNoNa | null; disabled: boolean; onChange: (v: YesNoNa) => void }) {
  return (
    <Select value={value ?? ''} onValueChange={(v) => onChange(v as YesNoNa)} disabled={disabled}>
      <SelectTrigger className="h-8 w-20"><SelectValue placeholder="—" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="yes">Yes</SelectItem>
        <SelectItem value="no">No</SelectItem>
        <SelectItem value="na">N/A</SelectItem>
      </SelectContent>
    </Select>
  );
}
