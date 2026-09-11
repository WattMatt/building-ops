import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { ContractorPicker } from '@/components/contractors/ContractorPicker';
import { useContractors } from '@/hooks/useContractors';
import { Plus, Wrench, Trash2, Calendar } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { parseCost, formatRand } from '@/lib/money';
import { ExportCsvButton } from '@/components/ui/export-csv-button';
import { csvText, type CsvColumn } from '@/lib/exportCsv';

type Asset = Pick<Tables<'building_assets'>, 'id' | 'name' | 'category'>;

type ServiceRecord = Tables<'asset_service_history'> & {
  /** Joined `contractors(company_name)`; null when no contractor is linked. */
  contractors: Pick<Tables<'contractors'>, 'company_name'> | null;
};

interface AssetServiceHistoryDialogProps {
  asset: Asset;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onServiceAdded?: () => void;
}

const SERVICE_TYPES = [
  { value: 'routine_maintenance', label: 'Routine Maintenance' },
  { value: 'repair', label: 'Repair' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'replacement', label: 'Part Replacement' },
  { value: 'calibration', label: 'Calibration' },
  { value: 'cleaning', label: 'Cleaning' },
  { value: 'emergency_repair', label: 'Emergency Repair' },
  { value: 'upgrade', label: 'Upgrade' },
  { value: 'other', label: 'Other' },
];

export default function AssetServiceHistoryDialog({
  asset,
  open,
  onOpenChange,
  onServiceAdded,
}: AssetServiceHistoryDialogProps) {
  const { isAdminOrManager, user } = useAuth();
  const { contractors } = useContractors();
  const [records, setRecords] = useState<ServiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [serviceDate, setServiceDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [serviceType, setServiceType] = useState('');
  const [description, setDescription] = useState('');
  const [performedBy, setPerformedBy] = useState('');
  const [contractorId, setContractorId] = useState<string | null>(null);
  // The company name the picker last wrote into "Performed by" — the only text it may overwrite.
  const [prefilledPerformedBy, setPrefilledPerformedBy] = useState<string | null>(null);
  const [cost, setCost] = useState('');
  const [nextServiceDate, setNextServiceDate] = useState('');
  const [notes, setNotes] = useState('');

  const fetchRecords = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('asset_service_history')
        .select('*, contractors(company_name)')
        .eq('asset_id', asset.id)
        .order('service_date', { ascending: false });

      if (error) throw error;
      setRecords(data || []);
    } catch (error) {
      console.error('Error fetching service history:', error);
      toast.error('Failed to load service history');
    } finally {
      setLoading(false);
    }
  }, [asset.id]);

  useEffect(() => {
    if (open) {
      fetchRecords();
    }
  }, [open, fetchRecords]);

  const resetForm = () => {
    setServiceDate(format(new Date(), 'yyyy-MM-dd'));
    setServiceType('');
    setDescription('');
    setPerformedBy('');
    setContractorId(null);
    setPrefilledPerformedBy(null);
    setCost('');
    setNextServiceDate('');
    setNotes('');
    setShowAddForm(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!serviceDate || !serviceType) {
      toast.error('Service date and type are required');
      return;
    }

    // Blank → null (nothing recorded); an unparseable or negative amount is refused, not coerced.
    const parsedCost = parseCost(cost);
    if (parsedCost === undefined) {
      toast.error('Cost must be an amount of R 0 or more');
      return;
    }

    setSaving(true);

    try {
      const recordData = {
        asset_id: asset.id,
        service_date: serviceDate,
        service_type: serviceType,
        description: description.trim() || null,
        performed_by: performedBy.trim() || null,
        contractor_id: contractorId,
        cost: parsedCost,
        next_service_date: nextServiceDate || null,
        notes: notes.trim() || null,
        created_by: user?.id || null,
      };

      const { error } = await supabase
        .from('asset_service_history')
        .insert(recordData);

      if (error) throw error;

      // Update asset's last_service_date and next_service_date if provided
      const assetUpdate: Record<string, string | null> = {
        last_service_date: serviceDate,
      };
      if (nextServiceDate) {
        assetUpdate.next_service_date = nextServiceDate;
      }

      await supabase
        .from('building_assets')
        .update(assetUpdate)
        .eq('id', asset.id);

      toast.success('Service record added successfully');
      resetForm();
      fetchRecords();
      onServiceAdded?.();
    } catch (error) {
      console.error('Error saving service record:', error);
      toast.error((error instanceof Error && error.message) || 'Failed to save service record');
    } finally {
      setSaving(false);
    }
  };

  // Picking a contractor fills "Performed by" with the company name when the field is empty or
  // still holds the name a previous pick put there (A → B swaps A for B; A → none clears it).
  // Anything the user typed is left alone.
  const chooseContractor = (id: string | null) => {
    setContractorId(id);
    const typed = performedBy.trim();
    if (typed && typed !== prefilledPerformedBy) return;
    const company = (id && contractors.find((c) => c.id === id)?.company_name) || null;
    setPerformedBy(company ?? '');
    setPrefilledPerformedBy(company);
  };

  const handleDelete = async (record: ServiceRecord) => {
    if (!confirm('Are you sure you want to delete this service record?')) return;

    try {
      const { error } = await supabase
        .from('asset_service_history')
        .delete()
        .eq('id', record.id);

      if (error) throw error;
      toast.success('Service record deleted');
      fetchRecords();
    } catch (error) {
      console.error('Error deleting record:', error);
      toast.error('Failed to delete record');
    }
  };

  const getServiceTypeLabel = (value: string | null) => {
    return SERVICE_TYPES.find((t) => t.value === value)?.label || value || '-';
  };

  // The contractor name comes from the joined row; the register is the fallback for rows the
  // join could not resolve (a contractor that is no longer readable keeps its id, not a blank).
  const contractorName = useCallback(
    (record: ServiceRecord): string =>
      record.contractors?.company_name ?? contractors.find((c) => c.id === record.contractor_id)?.company_name ?? '',
    [contractors],
  );

  // Memoised: `contractorName` closes over the loaded register.
  const csvColumns = useMemo((): CsvColumn<ServiceRecord>[] => [
    { key: 'service_date', header: 'Service date' },
    { key: 'service_type', header: 'Service type', format: (v) => getServiceTypeLabel(v as string | null) },
    { key: 'description', header: 'Description', format: csvText },
    { key: 'performed_by', header: 'Performed by', format: csvText },
    { key: 'contractor_id', header: 'Contractor', format: (_v, row) => contractorName(row) },
    { key: 'cost', header: 'Cost', format: (v) => (v == null ? '' : String(v)) },
    { key: 'next_service_date', header: 'Next service date', format: csvText },
    { key: 'notes', header: 'Notes', format: csvText },
  ], [contractorName]);

  const getServiceTypeBadgeVariant = (value: string | null): BadgeProps['variant'] => {
    switch (value) {
      case 'emergency_repair':
        return 'destructive';
      case 'repair':
      case 'replacement':
        return 'outline';
      case 'routine_maintenance':
      case 'inspection':
        return 'default';
      default:
        return 'secondary';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            Service History - {asset.name}
          </DialogTitle>
          <DialogDescription>
            View and manage maintenance records and repairs for this asset
          </DialogDescription>
          <div className="flex justify-end">
            {/* The asset NAME, never its uuid: the file has to mean something in a Downloads folder. */}
            <ExportCsvButton rows={records} columns={csvColumns} filename={`service-history-${asset.name}`} />
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {/* Add Record Form */}
          {isAdminOrManager && (
            <div className="border rounded-lg p-4">
              {!showAddForm ? (
                <Button onClick={() => setShowAddForm(true)} variant="outline" className="w-full">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Service Record
                </Button>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="service-date">Service Date *</Label>
                      <Input
                        id="service-date"
                        type="date"
                        value={serviceDate}
                        onChange={(e) => setServiceDate(e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="service-type">Service Type *</Label>
                      <Select value={serviceType} onValueChange={setServiceType} required>
                        <SelectTrigger id="service-type">
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                        <SelectContent>
                          {SERVICE_TYPES.map((type) => (
                            <SelectItem key={type.value} value={type.value}>
                              {type.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      placeholder="What work was performed..."
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={2}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="service-contractor">Contractor</Label>
                      <ContractorPicker id="service-contractor" value={contractorId} onChange={chooseContractor} aria-label="Contractor" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="performed-by">Performed By</Label>
                      <Input
                        id="performed-by"
                        placeholder="Technician/Company"
                        value={performedBy}
                        onChange={(e) => setPerformedBy(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="cost">Cost (R)</Label>
                      <Input
                        id="cost"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={cost}
                        onChange={(e) => setCost(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="next-service">Next Service Date</Label>
                      <Input
                        id="next-service"
                        type="date"
                        value={nextServiceDate}
                        onChange={(e) => setNextServiceDate(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="notes">Notes</Label>
                    <Textarea
                      id="notes"
                      placeholder="Additional notes..."
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                    />
                  </div>

                  <div className="flex gap-2 justify-end">
                    <Button type="button" variant="outline" onClick={resetForm}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={saving}>
                      {saving ? 'Saving...' : 'Add Record'}
                    </Button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Service History Table */}
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : records.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Calendar className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No service history</h3>
              <p className="text-muted-foreground">
                No maintenance records have been logged for this asset yet.
              </p>
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Performed By</TableHead>
                    <TableHead>Cost</TableHead>
                    {isAdminOrManager && <TableHead className="w-[60px]"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell className="whitespace-nowrap">
                        {format(new Date(record.service_date), 'dd MMM yyyy')}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getServiceTypeBadgeVariant(record.service_type)}>
                          {getServiceTypeLabel(record.service_type)}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[200px]">
                        <p className="truncate">{record.description || '-'}</p>
                        {record.notes && (
                          <p className="text-xs text-muted-foreground truncate">{record.notes}</p>
                        )}
                      </TableCell>
                      <TableCell>
                        {record.performed_by || record.contractors?.company_name || '-'}
                        {record.contractors && record.performed_by && record.performed_by !== record.contractors.company_name && (
                          <p className="text-xs text-muted-foreground">{record.contractors.company_name}</p>
                        )}
                      </TableCell>
                      <TableCell>
                        {record.cost != null ? formatRand(record.cost) : '-'}
                      </TableCell>
                      {isAdminOrManager && (
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(record)}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
