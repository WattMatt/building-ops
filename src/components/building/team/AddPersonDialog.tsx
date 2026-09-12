/**
 * Pick one person who is not yet a member. When the building has no 'user' rule yet, offer to
 * make them the daily-task default (checked by default) — one action, both tables (spec §4.2).
 */
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import type { AssignablePerson } from '@/hooks/useAssignablePeople';

interface AddPersonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  buildingName: string;
  people: AssignablePerson[];
  isLoading: boolean;
  isError: boolean;
  /** True when the building has no 'user' rule yet, so the default-for-daily-tasks offer is shown. */
  offerDefault: boolean;
  onAdd: (personId: string, makeDefault: boolean) => Promise<void>;
}

export function AddPersonDialog({ open, onOpenChange, buildingName, people, isLoading, isError, offerDefault, onAdd }: AddPersonDialogProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [makeDefault, setMakeDefault] = useState(true);
  const [saving, setSaving] = useState(false);

  const close = (next: boolean) => {
    if (!next) { setSelected(null); setMakeDefault(true); }
    onOpenChange(next);
  };

  const submit = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await onAdd(selected, offerDefault && makeDefault);
      close(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a person to {buildingName}</DialogTitle>
          <DialogDescription>Field staff only see the buildings they are added to.</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading people…
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive py-4">Could not load people.</p>
        ) : people.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">Everyone with a field-staff account is already a member here.</p>
        ) : (
          <ul className="max-h-72 overflow-y-auto space-y-1" role="listbox" aria-label="People">
            {people.map((p) => {
              const on = selected === p.id;
              return (
                <li key={p.id} role="option" aria-selected={on}>
                  <button
                    type="button"
                    onClick={() => setSelected(p.id)}
                    className={`w-full text-left min-h-11 rounded-md px-3 text-sm ${on ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/50'}`}
                  >
                    {p.full_name?.trim() || 'Unnamed user'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {offerDefault && people.length > 0 && (
          <label className="flex items-start gap-3 min-h-11 cursor-pointer">
            <Checkbox id="add-person-default" checked={makeDefault} onCheckedChange={(v) => setMakeDefault(v === true)} className="mt-1" />
            <Label htmlFor="add-person-default" className="font-normal cursor-pointer leading-snug">Also make them the default for daily tasks</Label>
          </label>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={saving} className="min-h-11">Cancel</Button>
          <Button onClick={submit} disabled={saving || !selected} className="min-h-11">
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />}
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
