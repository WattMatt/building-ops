import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
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
import { Plus, MoreVertical, Edit, Trash2, Search, Wrench, AlertTriangle, CheckCircle, Clock, History, Upload, Download } from 'lucide-react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import AssetServiceHistoryDialog from './AssetServiceHistoryDialog';
import { AssetImportDialog } from '@/components/import';

interface Asset {
  id: string;
  name: string;
  category: string;
  location: string | null;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  installation_date: string | null;
  last_service_date: string | null;
  next_service_date: string | null;
  status: string;
  notes: string | null;
  created_at: string;
}

interface AssetsTabProps {
  buildingId: string;
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

export default function AssetsTab({ buildingId }: AssetsTabProps) {
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
    setEditingAsset(null);
  };

  const openEditDialog = (asset: Asset) => {
    setEditingAsset(asset);
    setName(asset.name);
    setCategory(asset.category);
    setLocation(asset.location || '');
    setManufacturer(asset.manufacturer || '');
    setModel(asset.model || '');
    setSerialNumber(asset.serial_number || '');
    setInstallationDate(asset.installation_date || '');
    setLastServiceDate(asset.last_service_date || '');
    setNextServiceDate(asset.next_service_date || '');
    setStatus(asset.status);
    setNotes(asset.notes || '');
    setIsDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || !category) {
      toast.error('Name and category are required');
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
    } catch (error: any) {
      console.error('Error saving asset:', error);
      toast.error(error.message || 'Failed to save asset');
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

  const handleExport = (exportFormat: 'csv' | 'xlsx') => {
    if (assets.length === 0) {
      toast.error('No assets to export');
      return;
    }

    const exportData = assets.map((asset) => ({
      'Name': asset.name,
      'Category': getCategoryLabel(asset.category),
      'Location': asset.location || '',
      'Manufacturer': asset.manufacturer || '',
      'Model': asset.model || '',
      'Serial Number': asset.serial_number || '',
      'Installation Date': asset.installation_date || '',
      'Last Service Date': asset.last_service_date || '',
      'Next Service Date': asset.next_service_date || '',
      'Status': getStatusInfo(asset.status).label,
      'Notes': asset.notes || '',
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Assets');

    if (exportFormat === 'csv') {
      XLSX.writeFile(wb, 'assets_export.csv', { bookType: 'csv' });
    } else {
      XLSX.writeFile(wb, 'assets_export.xlsx');
    }
    toast.success(`Exported ${assets.length} assets`);
  };

  const filteredAssets = assets.filter((asset) => {
    const matchesSearch =
      asset.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      asset.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (asset.location?.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesCategory = categoryFilter === 'all' || asset.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const getCategoryLabel = (value: string) => {
    return ASSET_CATEGORIES.find((c) => c.value === value)?.label || value;
  };

  const getStatusInfo = (statusValue: string) => {
    return ASSET_STATUSES.find((s) => s.value === statusValue) || ASSET_STATUSES[0];
  };

  const getStatusIcon = (statusValue: string) => {
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <Download className="w-4 h-4 mr-2" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleExport('xlsx')}>
                  Export as Excel (.xlsx)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport('csv')}>
                  Export as CSV
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
