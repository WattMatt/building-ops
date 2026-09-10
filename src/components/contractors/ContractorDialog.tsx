/**
 * Create / edit one contractor. Pure form: the page hands in `onSave` (create or update) so
 * the dialog neither knows about the query cache nor which write it is doing. The company
 * name is the only required field; the register is meant to be filled in over time.
 */
import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { Hint } from '@/components/ui/hint';
import { responsibleParties } from '@/components/checklists/TemplateItemDialog';
import type { Contractor, ContractorInput } from '@/hooks/useContractors';

/** The responsible-party labels a contractor can stand in for. `contractor` is the generic one. */
export const TRADE_ROLES: readonly string[] = ['contractor', ...responsibleParties];

const NO_ROLE = '__none__';

const blank = (v: string | null | undefined) => v ?? '';
const orNull = (v: string) => {
  const t = v.trim();
  return t.length ? t : null;
};

function initialForm(c: Contractor | null | undefined) {
  return {
    company_name: blank(c?.company_name),
    trade: blank(c?.trade),
    default_trade_role: c?.default_trade_role ?? NO_ROLE,
    contact_name: blank(c?.contact_name),
    contact_email: blank(c?.contact_email),
    contact_phone: blank(c?.contact_phone),
    address: blank(c?.address),
    vat_number: blank(c?.vat_number),
    notes: blank(c?.notes),
    is_active: c ? c.is_active !== false : true,
  };
}

type FormState = ReturnType<typeof initialForm>;

export function toContractorInput(f: FormState): ContractorInput {
  return {
    company_name: f.company_name.trim(),
    trade: orNull(f.trade),
    default_trade_role: f.default_trade_role === NO_ROLE ? null : f.default_trade_role,
    contact_name: orNull(f.contact_name),
    contact_email: orNull(f.contact_email),
    contact_phone: orNull(f.contact_phone),
    address: orNull(f.address),
    vat_number: orNull(f.vat_number),
    notes: orNull(f.notes),
    is_active: f.is_active,
  };
}

interface ContractorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing when set; creating when null. */
  contractor: Contractor | null;
  /** Resolves when saved; rejects with a plain message the dialog shows inline. */
  onSave: (input: ContractorInput) => Promise<void>;
}

export function ContractorDialog({ open, onOpenChange, contractor, onSave }: ContractorDialogProps) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-lg">
        {/* Keyed on open + contractor so the form resets on every open without effects. */}
        {open && <ContractorForm key={contractor?.id ?? 'new'} contractor={contractor} onSave={onSave} onCancel={() => onOpenChange(false)} />}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function ContractorForm({
  contractor,
  onSave,
  onCancel,
}: {
  contractor: Contractor | null;
  onSave: (input: ContractorInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => initialForm(contractor));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const editing = !!contractor;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.company_name.trim()) {
      setError('Company name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(toContractorInput(form));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the contractor.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>{editing ? 'Edit contractor' : 'New contractor'}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          {editing ? 'Update the register entry. Assignments already made keep pointing at this company.' : 'Add a company to the register so it can be assigned to issues, services and PPM lines.'}
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>

      <div className="space-y-2">
        <Label htmlFor="contractor-company">Company name</Label>
        <Input
          id="contractor-company"
          value={form.company_name}
          onChange={(e) => set('company_name', e.target.value)}
          autoComplete="organization"
          required
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="contractor-trade">Trade</Label>
          <Input
            id="contractor-trade"
            value={form.trade}
            onChange={(e) => set('trade', e.target.value)}
            placeholder="e.g. Electrical, HVAC, Plumbing"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="contractor-role">Default trade role</Label>
          <Select value={form.default_trade_role} onValueChange={(v) => set('default_trade_role', v)}>
            <SelectTrigger id="contractor-role" aria-label="Default trade role" className="min-h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_ROLE}>Not set</SelectItem>
              {TRADE_ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Hint icon={false}>The checklist role this company usually fills, so assignment rules can point that role at it.</Hint>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="contractor-contact">Contact name</Label>
          <Input id="contractor-contact" value={form.contact_name} onChange={(e) => set('contact_name', e.target.value)} autoComplete="name" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="contractor-email">Email</Label>
          <Input id="contractor-email" type="email" inputMode="email" value={form.contact_email} onChange={(e) => set('contact_email', e.target.value)} autoComplete="email" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="contractor-phone">Phone</Label>
          <Input id="contractor-phone" type="tel" inputMode="tel" value={form.contact_phone} onChange={(e) => set('contact_phone', e.target.value)} autoComplete="tel" />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="contractor-address">Address</Label>
        <Textarea id="contractor-address" rows={2} value={form.address} onChange={(e) => set('address', e.target.value)} autoComplete="street-address" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="contractor-vat">VAT number</Label>
        <Input id="contractor-vat" value={form.vat_number} onChange={(e) => set('vat_number', e.target.value)} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="contractor-notes">Notes</Label>
        <Textarea id="contractor-notes" rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </div>

      <div className="flex min-h-11 items-center justify-between gap-3 rounded-md border px-3">
        <Label htmlFor="contractor-active" className="cursor-pointer">Active</Label>
        <Switch id="contractor-active" checked={form.is_active} onCheckedChange={(v) => set('is_active', v)} />
      </div>
      {!form.is_active && (
        <p className="text-sm text-muted-foreground">Inactive contractors stay on past work but are hidden from pickers.</p>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <ResponsiveDialogFooter>
        <Button type="button" variant="outline" className="min-h-11" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" className="min-h-11" disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {editing ? 'Save changes' : 'Add contractor'}
        </Button>
      </ResponsiveDialogFooter>
    </form>
  );
}
