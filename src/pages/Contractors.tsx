/**
 * The contractor register (spec §8, R3c). Admin/manager only — the route is gated in
 * App.tsx and the page fails closed too, the way UserManagement does. One list with search,
 * a trade filter and a "show inactive" toggle; New opens ContractorDialog, a row opens
 * ContractorSheet (details, documents, history), and Edit inside the sheet reuses the dialog.
 */
import { useMemo, useState } from 'react';
import { HardHat, Loader2, Plus, Search, Shield } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Hint } from '@/components/ui/hint';
import { ContractorDialog } from '@/components/contractors/ContractorDialog';
import { ContractorSheet, RatingStars } from '@/components/contractors/ContractorSheet';
import { useContractors, type Contractor, type ContractorInput } from '@/hooks/useContractors';

const ALL_TRADES = '__all__';

/** Pure: the rows the list shows for a search + trade + inactive setting. */
export function filterContractors(
  rows: Contractor[],
  { search, trade, showInactive }: { search: string; trade: string; showInactive: boolean },
): Contractor[] {
  const q = search.trim().toLowerCase();
  return rows.filter((c) => {
    if (!showInactive && c.is_active === false) return false;
    if (trade !== ALL_TRADES && (c.trade ?? '').trim().toLowerCase() !== trade.toLowerCase()) return false;
    if (!q) return true;
    return [c.company_name, c.trade, c.contact_name, c.contact_email, c.contact_phone, c.default_trade_role]
      .some((v) => (v ?? '').toLowerCase().includes(q));
  });
}

export default function Contractors() {
  const { isAdminOrManager } = useAuth();
  const { contractors, isLoading, isError, create, update, setActive } = useContractors();

  const [search, setSearch] = useState('');
  const [trade, setTrade] = useState(ALL_TRADES);
  const [showInactive, setShowInactive] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Contractor | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const trades = useMemo(() => {
    const set = new Map<string, string>();
    for (const c of contractors) {
      const t = (c.trade ?? '').trim();
      if (t) set.set(t.toLowerCase(), t);
    }
    return [...set.values()].sort((a, b) => a.localeCompare(b));
  }, [contractors]);

  const visible = useMemo(
    () => filterContractors(contractors, { search, trade, showInactive }),
    [contractors, search, trade, showInactive],
  );
  const inactiveCount = contractors.filter((c) => c.is_active === false).length;
  // Read from the list so the sheet re-renders with the fresh row after an edit or toggle.
  const selected = selectedId ? contractors.find((c) => c.id === selectedId) ?? null : null;

  if (!isAdminOrManager) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <Shield className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Access Restricted</h2>
          <p className="text-muted-foreground">Only admins and managers can view the contractor register.</p>
        </div>
      </div>
    );
  }

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (c: Contractor) => {
    setEditing(c);
    setDialogOpen(true);
  };

  const handleSave = async (input: ContractorInput) => {
    if (editing) {
      await update.mutateAsync({ id: editing.id, ...input });
      toast.success('Contractor updated');
    } else {
      const id = await create.mutateAsync(input);
      toast.success('Contractor added');
      setSelectedId(id);
    }
    setDialogOpen(false);
    setEditing(null);
  };

  const handleSetActive = async (c: Contractor, active: boolean) => {
    try {
      await setActive.mutateAsync({ id: c.id, is_active: active });
      toast.success(active ? `${c.company_name} is active again` : `${c.company_name} marked inactive`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the contractor.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <HardHat className="h-6 w-6" aria-hidden="true" />
            Contractors
          </h1>
          <p className="text-muted-foreground">The companies you call out for repairs, services and planned maintenance.</p>
        </div>
        <Button className="min-h-11" onClick={openNew}>
          <Plus className="mr-2 h-4 w-4" />
          New contractor
        </Button>
      </div>

      <Hint>Add every company you use, then pick them on issues, asset services and PPM lines. Documents with expiry dates (insurance, certifications) show amber before they lapse.</Hint>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                aria-label="Search contractors"
                placeholder="Search by company, trade or contact"
                className="h-11 pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={trade} onValueChange={setTrade}>
              <SelectTrigger aria-label="Trade" className="min-h-11 md:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_TRADES}>All trades</SelectItem>
                {trades.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex min-h-11 items-center gap-2">
              <Switch id="show-inactive" checked={showInactive} onCheckedChange={setShowInactive} />
              <Label htmlFor="show-inactive" className="cursor-pointer text-sm">
                Show inactive{inactiveCount > 0 ? ` (${inactiveCount})` : ''}
              </Label>
            </div>
          </div>

          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            <p className="py-6 text-center text-sm text-destructive">Could not load the contractor register.</p>
          ) : visible.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {contractors.length === 0 ? 'No contractors yet. Add the first one.' : 'No contractors match.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Company</TableHead>
                    <TableHead className="hidden sm:table-cell">Trade</TableHead>
                    <TableHead className="hidden md:table-cell">Contact</TableHead>
                    <TableHead>Rating</TableHead>
                    <TableHead className="w-24">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((c) => (
                    <TableRow
                      key={c.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`Open ${c.company_name}`}
                      className="h-12 cursor-pointer"
                      onClick={() => setSelectedId(c.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedId(c.id);
                        }
                      }}
                    >
                      <TableCell>
                        <p className="font-medium">{c.company_name}</p>
                        <p className="text-xs text-muted-foreground sm:hidden">{c.trade ?? '—'}</p>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">{c.trade ?? '—'}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        {c.contact_name ?? '—'}
                        {c.contact_phone ? <span className="block text-xs text-muted-foreground">{c.contact_phone}</span> : null}
                      </TableCell>
                      <TableCell><RatingStars value={c.rating} /></TableCell>
                      <TableCell>
                        {c.is_active === false ? <Badge variant="outline">Inactive</Badge> : <Badge variant="secondary">Active</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ContractorDialog
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) setEditing(null);
        }}
        contractor={editing}
        onSave={handleSave}
      />

      <ContractorSheet
        open={!!selected}
        onOpenChange={(o) => { if (!o) setSelectedId(null); }}
        contractor={selected}
        canEdit={isAdminOrManager}
        onEdit={openEdit}
        onSetActive={handleSetActive}
      />
    </div>
  );
}
