import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Plus, MoreVertical, Edit, Trash2, Search, Wrench, AlertTriangle, CheckCircle, Clock, History, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { ExportCsvButton } from '@/components/ui/export-csv-button';
import { csvText, type CsvColumn } from '@/lib/exportCsv';
import { EvidencePackItems } from '@/components/evidence/EvidencePackMenu';
import { parseCost } from '@/lib/money';
import { format } from 'date-fns';
import AssetServiceHistoryDialog from './AssetServiceHistoryDialog';
import { AssetImportDialog } from '@/components/import';

type Asset = Tables<'building_assets'>;

interface AssetsTabProps {
  buildingId: string;
  /** Printed on the evidence-pack cover. Threaded from the building page like every other tab. */
  buildingName: string;
}

const ASSET_CATEGORIES = [
  { value: 'hvac', label: 'HVAC System' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'plumbing', label: 'Plumbing' },
  { value: 'fire_safety', label: 'Fire Safety' },
  { value: 'elevator', label: 'Elevator/Lift' },
  { value: 'generator', label: 'Generator' },
  { value: 'security', label: 'Security System' },
  { value: 'other', label: 'Other' },
];

const ASSET_STATUSES = [
  { value: 'operational', label: 'Operational', color: 'default' },
  { value: 'needs_maintenance', label: 'Needs Maintenance', color: 'warning' },
  { value: 'under_repair', label: 'Under Repair', color: 'secondary' },
  { value: 'out_of_service', label: 'Out of Service', color: 'destructive' },
];

const assetCategoryLabel = (value: string | null) => ASSET_CATEGORIES.find((c) => c.value === value)?.label || value || '-';
const assetStatusInfo = (value: string | null) => ASSET_STATUSES.find((s) => s.value === value) || ASSET_STATUSES[0];

/** The register as a spreadsheet: the words on the chips, not the stored enum values. */
export const ASSET_CSV_COLUMNS: CsvColumn<Asset>[] = [
  { key: 'name', header: 'Name' },
  { key: 'category', header: 'Category', format: (v) => assetCategoryLabel(v as string | null) },
  { key: 'location', header: 'Location', format: csvText },
  { key: 'manufacturer', header: 'Manufacturer', format: csvText },
  { key: 'model', header: 'Model', format: csvText },
  { key: 'serial_number', header: 'Serial Number', format: csvText },
  { key: 'installation_date', header: 'Installation Date', format: csvText },
  { key: 'last_service_date', header: 'Last Service Date', format: csvText },
  { key: 'next_service_date', header: 'Next Service Date', format: csvText },
  { key: 'status', header: 'Status', format: (v) => assetStatusInfo(v as string | null).label },
  { key: 'notes', header: 'Notes', format: csvText },
];

/** '' → null; a non-negative whole number → number; anything else → undefined (rejected). */
function parseYears(text: string): number | null | undefined {
  const t = text.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

export default function AssetsTab({ buildingId, buildingName }: AssetsTabProps) {
  const { isAdminOrManager } = useAuth();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [serviceHistoryAsset, setServiceHistoryAsset] = useState<Asset | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [location, setLocation] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [installationDate, setInstallationDate] = useState('');
  const [lastServiceDate, setLastServiceDate] = useState('');
  const [nextServiceDate, setNextServiceDate] = useState('');
  const [status, setStatus] = useState('operational');
  const [notes, setNotes] = useState('');
  // Cost + warranty (spec §8): kept as strings while editing; parsed on save.
  const [purchaseDate, setPurchaseDate] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [replacementCost, setReplacementCost] = useState('');
  const [warrantyExpiry, setWarrantyExpiry] = useState('');
  const [warrantyProvider, setWarrantyProvider] = useState('');
  const [expectedLifespanYears, setExpectedLifespanYears] = useState('');

  useEffect(() => {
    fetchAssets();
  }, [buildingId]);

  const fetchAssets = async () => {
    try {
      const { data, error } = await supabase
        .from('building_assets')
        .select('*')
        .eq('building_id', buildingId)
        .order('name');

      if (error) throw error;
      setAssets(data || []);
    } catch (error) {
      console.error('Error fetching assets:', error);
      toast.error('Failed to load assets');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setName('');
    setCategory('');
    setLocation('');
    setManufacturer('');
    setModel('');
    setSerialNumber('');
    setInstallationDate('');
    setLastServiceDate('');
    setNextServiceDate('');
    setStatus('operational');
    setNotes('');
    setPurchaseDate('');
    setPurchasePrice('');
    setReplacementCost('');
    setWarrantyExpiry('');
    setWarrantyProvider('');
    setExpectedLifespanYears('');
    setEditingAsset(null);
  };

  const openEditDialog = (asset: Asset) => {
    setEditingAsset(asset);
    setName(asset.name);
    setCategory(asset.category ?? '');
    setLocation(asset.location || '');
    setManufacturer(asset.manufacturer || '');
    setModel(asset.model || '');
    setSerialNumber(asset.serial_number || '');
    setInstallationDate(asset.installation_date || '');
    setLastServiceDate(asset.last_service_date || '');
    setNextServiceDate(asset.next_service_date || '');
    setStatus(asset.status ?? 'operational');
    setNotes(asset.notes || '');
    setPurchaseDate(asset.purchase_date || '');
    setPurchasePrice(asset.purchase_price == null ? '' : String(asset.purchase_price));
    setReplacementCost(asset.replacement_cost == null ? '' : String(asset.replacement_cost));
    setWarrantyExpiry(asset.warranty_expiry || '');
    setWarrantyProvider(asset.warranty_provider || '');
    setExpectedLifespanYears(asset.expected_lifespan_years == null ? '' : String(asset.expected_lifespan_years));
    setIsDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || !category) {
      toast.error('Name and category are required');
      return;
    }

    const price = parseCost(purchasePrice);
    const replacement = parseCost(replacementCost);
    const lifespan = parseYears(expectedLifespanYears);
    if (price === undefined || replacement === undefined) {
      toast.error('Purchase price and replacement cost must be amounts of R 0 or more');
      return;
    }
    if (lifespan === undefined) {
      toast.error('Expected lifespan must be a whole number of years');
      return;
    }

    setSaving(true);

    try {
      const assetData = {
        building_id: buildingId,
        name: name.trim(),
        category,
        location: location.trim() || null,
        manufacturer: manufacturer.trim() || null,
        model: model.trim() || null,
        serial_number: serialNumber.trim() || null,
        installation_date: installationDate || null,
        last_service_date: lastServiceDate || null,
        next_service_date: nextServiceDate || null,
        status,
        notes: notes.trim() || null,
        purchase_date: purchaseDate || null,
        purchase_price: price,
        replacement_cost: replacement,
        warranty_expiry: warrantyExpiry || null,
        warranty_provider: warrantyProvider.trim() || null,
        expected_lifespan_years: lifespan,
      };

      if (editingAsset) {
        const { error } = await supabase
          .from('building_assets')
          .update(assetData)
          .eq('id', editingAsset.id);

        if (error) throw error;
        toast.success('Asset updated successfully');
      } else {
        const { error } = await supabase
          .from('building_assets')
          .insert(assetData);

        if (error) throw error;
        toast.success('Asset created successfully');
      }

      setIsDialogOpen(false);
      resetForm();
      fetchAssets();
    } catch (error) {
      console.error('Error saving asset:', error);
      toast.error((error instanceof Error && error.message) || 'Failed to save asset');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (asset: Asset) => {
    if (!confirm(`Are you sure you want to delete ${asset.name}?`)) return;

    try {
      const { error } = await supabase
        .from('building_assets')
        .delete()
        .eq('id', asset.id);

      if (error) throw error;
      toast.success('Asset deleted successfully');
      fetchAssets();
    } catch (error) {
      console.error('Error deleting asset:', error);
      toast.error('Failed to delete asset');
    }
  };

  const filteredAssets = assets.filter((asset) => {
    const matchesSearch =
      asset.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (asset.category?.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (asset.location?.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesCategory = categoryFilter === 'all' || asset.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const getCategoryLabel = assetCategoryLabel;
  const getStatusInfo = assetStatusInfo;

  const getStatusIcon = (statusValue: string | null) => {
    switch (statusValue) {
      case 'operational':
        return <CheckCircle className="h-3 w-3" />;
      case 'needs_maintenance':
        return <AlertTriangle className="h-3 w-3" />;
      case 'under_repair':
        return <Clock className="h-3 w-3" />;
      case 'out_of_service':
        return <AlertTriangle className="h-3 w-3" />;
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="w-6 h-6 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search assets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {ASSET_CATEGORIES.map((cat) => (
                <SelectItem key={cat.value} value={cat.value}>
                  {cat.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {isAdminOrManager && (
          <div className="flex items-center gap-2">
            {/* Exactly the rows on screen after the search and the category filter. */}
            <ExportCsvButton rows={filteredAssets} columns={ASSET_CSV_COLUMNS} filename="assets" />
            <Button variant="outline" onClick={() => setIsImportDialogOpen(true)}>
              <Upload className="w-4 h-4 mr-2" />
              Import
            </Button>
            <Dialog
              open={isDialogOpen}
              onOpenChange={(open) => {
                setIsDialogOpen(open);
                if (!open) resetForm();
              }}
            >
              <DialogTrigger asChild>
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Asset
                </Button>
              </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingAsset ? 'Edit Asset' : 'Add Asset'}</DialogTitle>
                <DialogDescription>
                  {editingAsset ? 'Update asset information' : 'Add a new asset to this building'}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="asset-name">Asset Name *</Label>
                    <Input
                      id="asset-name"
                      placeholder="e.g., Main HVAC Unit"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="category">Category *</Label>
                    <Select value={category} onValueChange={setCategory} required>
                      <SelectTrigger>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {ASSET_CATEGORIES.map((cat) => (
                          <SelectItem key={cat.value} value={cat.value}>
                            {cat.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="location">Location</Label>
                    <Input
                      id="location"
                      placeholder="e.g., Roof, Basement, Floor 3"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="status">Status</Label>
                    <Select value={status} onValueChange={setStatus}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ASSET_STATUSES.map((s) => (
                          <SelectItem key={s.value} value={s.value}>
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="manufacturer">Manufacturer</Label>
                    <Input
                      id="manufacturer"
                      placeholder="e.g., Carrier"
                      value={manufacturer}
                      onChange={(e) => setManufacturer(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="model">Model</Label>
                    <Input
                      id="model"
                      placeholder="Model number"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="serial-number">Serial Number</Label>
                    <Input
                      id="serial-number"
                      placeholder="S/N"
                      value={serialNumber}
                      onChange={(e) => setSerialNumber(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="installation-date">Installation Date</Label>
                    <Input
                      id="installation-date"
                      type="date"
                      value={installationDate}
                      onChange={(e) => setInstallationDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="last-service-date">Last Service Date</Label>
                    <Input
                      id="last-service-date"
                      type="date"
                      value={lastServiceDate}
                      onChange={(e) => setLastServiceDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="next-service-date">Next Service Date</Label>
                    <Input
                      id="next-service-date"
                      type="date"
                      value={nextServiceDate}
                      onChange={(e) => setNextServiceDate(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="purchase-date">Purchase date</Label>
                    <Input
                      id="purchase-date"
                      className="h-11"
                      type="date"
                      value={purchaseDate}
                      onChange={(e) => setPurchaseDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="purchase-price">Purchase price (R)</Label>
                    <Input
                      id="purchase-price"
                      className="h-11"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      placeholder="0"
                      value={purchasePrice}
                      onChange={(e) => setPurchasePrice(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="replacement-cost">Replacement cost (R)</Label>
                    <Input
                      id="replacement-cost"
                      className="h-11"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      placeholder="0"
                      value={replacementCost}
                      onChange={(e) => setReplacementCost(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="warranty-expiry">Warranty expiry</Label>
                    <Input
                      id="warranty-expiry"
                      className="h-11"
                      type="date"
                      value={warrantyExpiry}
                      onChange={(e) => setWarrantyExpiry(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="warranty-provider">Warranty provider</Label>
                    <Input
                      id="warranty-provider"
                      className="h-11"
                      placeholder="e.g., Carrier SA"
                      value={warrantyProvider}
                      onChange={(e) => setWarrantyProvider(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="expected-lifespan">Expected lifespan (years)</Label>
                    <Input
                      id="expected-lifespan"
                      className="h-11"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      placeholder="e.g., 15"
                      value={expectedLifespanYears}
                      onChange={(e) => setExpectedLifespanYears(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    placeholder="Additional notes about this asset..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                  />
                </div>

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={saving}>
                    {saving ? 'Saving...' : editingAsset ? 'Update' : 'Create'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          </div>
        )}
      </div>

      {/* Assets Table */}
      {filteredAssets.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Wrench className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No assets found</h3>
            <p className="text-muted-foreground text-center mb-4">
              {searchQuery || categoryFilter !== 'all'
                ? 'Try adjusting your search or filter'
                : 'Add your first asset to get started'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Next Service</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[80px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAssets.map((asset) => {
                const statusInfo = getStatusInfo(asset.status);
                const isOverdue =
                  asset.next_service_date && new Date(asset.next_service_date) < new Date();

                return (
                  <TableRow key={asset.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{asset.name}</p>
                        {asset.manufacturer && (
                          <p className="text-xs text-muted-foreground">
                            {asset.manufacturer} {asset.model && `• ${asset.model}`}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{getCategoryLabel(asset.category)}</TableCell>
                    <TableCell>{asset.location || '-'}</TableCell>
                    <TableCell>
                      {asset.next_service_date ? (
                        <span className={isOverdue ? 'text-destructive font-medium' : ''}>
                          {format(new Date(asset.next_service_date), 'dd MMM yyyy')}
                          {isOverdue && ' (Overdue)'}
                        </span>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          statusInfo.color === 'destructive'
                            ? 'destructive'
                            : statusInfo.color === 'warning'
                            ? 'outline'
                            : statusInfo.color === 'secondary'
                            ? 'secondary'
                            : 'default'
                        }
                        className="gap-1"
                      >
                        {getStatusIcon(asset.status)}
                        {statusInfo.label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setServiceHistoryAsset(asset)}>
                            <History className="h-4 w-4 mr-2" />
                            Service History
                          </DropdownMenuItem>
                          <EvidencePackItems kind="asset" id={asset.id} buildingName={buildingName} />
                          {isAdminOrManager && (
                            <>
                              <DropdownMenuItem onClick={() => openEditDialog(asset)}>
                                <Edit className="h-4 w-4 mr-2" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleDelete(asset)}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Service History Dialog */}
      {serviceHistoryAsset && (
        <AssetServiceHistoryDialog
          asset={serviceHistoryAsset}
          open={!!serviceHistoryAsset}
          onOpenChange={(open) => !open && setServiceHistoryAsset(null)}
          onServiceAdded={fetchAssets}
        />
      )}

      {/* Import Dialog */}
      <AssetImportDialog
        open={isImportDialogOpen}
        onOpenChange={setIsImportDialogOpen}
        buildingId={buildingId}
        onImportComplete={fetchAssets}
      />
    </div>
  );
}
