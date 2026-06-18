import { useState, useEffect, Fragment } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { fdb, type TenantShopSpec } from '@/integrations/supabase/fortress-db';
import { byShopNumber } from '@/lib/tenantSort';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
import { Plus, MoreVertical, Edit, Trash2, FileText, Store, Search, Upload, Download, ChevronRight, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import TenantDocumentsDialog from './TenantDocumentsDialog';
import TenantShopSpecDialog from './TenantShopSpecDialog';
import { TenantImportDialog } from '@/components/import';

interface Tenant {
  id: string;
  shop_number: string;
  shop_name: string;
  area: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  is_active: boolean;
  created_at: string;
}

interface TenantsTabProps {
  buildingId: string;
}

/** Shop-spec fields shown in the expandable per-tenant detail row (read-only). */
const SPEC_FIELDS: { key: keyof TenantShopSpec; label: string }[] = [
  { key: 'db_phase', label: 'DB Phase' },
  { key: 'actual_amps', label: 'Actual Amps' },
  { key: 'lease_amps', label: 'Lease Amps' },
  { key: 'generator_connection', label: 'Generator' },
  { key: 'hvac_units', label: 'HVAC Units' },
  { key: 'hvac_btu', label: 'HVAC BTU' },
  { key: 'hvac_gas', label: 'HVAC Gas' },
  { key: 'lighting_type', label: 'Lighting' },
  { key: 'shopfront_type', label: 'Shopfront' },
  { key: 'roller_shutter_type', label: 'Roller Shutter' },
  { key: 'ceiling_structure', label: 'Ceiling Structure' },
  { key: 'ceiling_height', label: 'Ceiling Height' },
  { key: 'floor_finish', label: 'Floor Finish' },
  { key: 'walls', label: 'Walls' },
  { key: 'wall_finish', label: 'Wall Finish' },
  { key: 'plumbing_toilets', label: 'Toilets' },
  { key: 'plumbing_sink', label: 'Plumbing Sink' },
  { key: 'notes', label: 'Notes' },
];

export default function TenantsTab({ buildingId }: TenantsTabProps) {
  const { isAdminOrManager } = useAuth();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [documentsDialogTenant, setDocumentsDialogTenant] = useState<Tenant | null>(null);
  const [shopSpecDialogTenant, setShopSpecDialogTenant] = useState<Tenant | null>(null);
  const [specs, setSpecs] = useState<Record<string, TenantShopSpec>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [shopNumber, setShopNumber] = useState('');
  const [shopName, setShopName] = useState('');
  const [area, setArea] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  useEffect(() => {
    fetchTenants();
  }, [buildingId]);

  const fetchTenants = async () => {
    try {
      const { data, error } = await supabase
        .from('building_tenants')
        .select('*')
        .eq('building_id', buildingId)
        .order('shop_number');

      if (error) throw error;
      setTenants(data || []);

      // Load current shop specs (fortress-typed table) keyed by tenant_id.
      const { data: specRows } = await fdb
        .from('tenant_shop_spec')
        .select('*')
        .eq('building_id', buildingId)
        .eq('is_current', true);
      const byTenant: Record<string, TenantShopSpec> = {};
      for (const s of specRows ?? []) if (s.tenant_id) byTenant[s.tenant_id] = s as TenantShopSpec;
      setSpecs(byTenant);
    } catch (error) {
      console.error('Error fetching tenants:', error);
      toast.error('Failed to load tenants');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setShopNumber('');
    setShopName('');
    setArea('');
    setContactName('');
    setContactPhone('');
    setContactEmail('');
    setEditingTenant(null);
  };

  const openEditDialog = (tenant: Tenant) => {
    setEditingTenant(tenant);
    setShopNumber(tenant.shop_number);
    setShopName(tenant.shop_name);
    setArea(tenant.area || '');
    setContactName(tenant.contact_name || '');
    setContactPhone(tenant.contact_phone || '');
    setContactEmail(tenant.contact_email || '');
    setIsDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!shopNumber.trim() || !shopName.trim()) {
      toast.error('Shop number and name are required');
      return;
    }

    setSaving(true);

    try {
      const tenantData = {
        building_id: buildingId,
        shop_number: shopNumber.trim(),
        shop_name: shopName.trim(),
        area: area.trim() || null,
        contact_name: contactName.trim() || null,
        contact_phone: contactPhone.trim() || null,
        contact_email: contactEmail.trim() || null,
      };

      if (editingTenant) {
        const { error } = await supabase
          .from('building_tenants')
          .update(tenantData)
          .eq('id', editingTenant.id);

        if (error) throw error;
        toast.success('Tenant updated successfully');
      } else {
        const { error } = await supabase
          .from('building_tenants')
          .insert(tenantData);

        if (error) throw error;
        toast.success('Tenant created successfully');
      }

      setIsDialogOpen(false);
      resetForm();
      fetchTenants();
    } catch (error: any) {
      console.error('Error saving tenant:', error);
      toast.error(error.message || 'Failed to save tenant');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (tenant: Tenant) => {
    if (!confirm(`Are you sure you want to delete ${tenant.shop_name}?`)) return;

    try {
      const { error } = await supabase
        .from('building_tenants')
        .delete()
        .eq('id', tenant.id);

      if (error) throw error;
      toast.success('Tenant deleted successfully');
      fetchTenants();
    } catch (error) {
      console.error('Error deleting tenant:', error);
      toast.error('Failed to delete tenant');
    }
  };

  const handleExport = (format: 'csv' | 'xlsx') => {
    if (tenants.length === 0) {
      toast.error('No tenants to export');
      return;
    }

    const exportData = tenants.map((tenant) => ({
      'Shop Number': tenant.shop_number,
      'Shop Name': tenant.shop_name,
      'Area': tenant.area || '',
      'Contact Name': tenant.contact_name || '',
      'Contact Phone': tenant.contact_phone || '',
      'Contact Email': tenant.contact_email || '',
      'Status': tenant.is_active ? 'Active' : 'Inactive',
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Tenants');

    if (format === 'csv') {
      XLSX.writeFile(wb, 'tenants_export.csv', { bookType: 'csv' });
    } else {
      XLSX.writeFile(wb, 'tenants_export.xlsx');
    }
    toast.success(`Exported ${tenants.length} tenants`);
  };

  const filteredTenants = tenants
    .filter(
      (tenant) =>
        tenant.shop_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
        tenant.shop_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (tenant.contact_name?.toLowerCase().includes(searchQuery.toLowerCase()))
    )
    .sort(byShopNumber); // standard natural/numeric tenant order — see src/lib/tenantSort.ts

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
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tenants..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
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
            <Dialog open={isDialogOpen} onOpenChange={(open) => {
              setIsDialogOpen(open);
              if (!open) resetForm();
            }}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Tenant
                </Button>
              </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{editingTenant ? 'Edit Tenant' : 'Add Tenant'}</DialogTitle>
                <DialogDescription>
                  {editingTenant ? 'Update tenant information' : 'Add a new tenant to this building'}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="shop-number">Shop Number *</Label>
                    <Input
                      id="shop-number"
                      placeholder="e.g., G01"
                      value={shopNumber}
                      onChange={(e) => setShopNumber(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="area">Area</Label>
                    <Input
                      id="area"
                      placeholder="e.g., 150 sqm"
                      value={area}
                      onChange={(e) => setArea(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shop-name">Shop Name *</Label>
                  <Input
                    id="shop-name"
                    placeholder="Enter shop/tenant name"
                    value={shopName}
                    onChange={(e) => setShopName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contact-name">Contact Name</Label>
                  <Input
                    id="contact-name"
                    placeholder="Primary contact person"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="contact-phone">Phone</Label>
                    <Input
                      id="contact-phone"
                      type="tel"
                      placeholder="+27 XX XXX XXXX"
                      value={contactPhone}
                      onChange={(e) => setContactPhone(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="contact-email">Email</Label>
                    <Input
                      id="contact-email"
                      type="email"
                      placeholder="email@example.com"
                      value={contactEmail}
                      onChange={(e) => setContactEmail(e.target.value)}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={saving}>
                    {saving ? 'Saving...' : editingTenant ? 'Update' : 'Create'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          </div>
        )}
      </div>

      {/* Tenants Table */}
      {filteredTenants.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Store className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No tenants found</h3>
            <p className="text-muted-foreground text-center mb-4">
              {searchQuery ? 'Try adjusting your search terms' : 'Add your first tenant to get started'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Shop #</TableHead>
                <TableHead>Shop Name</TableHead>
                <TableHead>Area</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTenants.map((tenant) => {
                const spec = specs[tenant.id];
                const expanded = expandedId === tenant.id;
                return (
                <Fragment key={tenant.id}>
                <TableRow>
                  <TableCell className="w-8">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => setExpandedId(expanded ? null : tenant.id)}
                      aria-label="Toggle shop spec"
                    >
                      {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </Button>
                  </TableCell>
                  <TableCell className="font-medium">{tenant.shop_number}</TableCell>
                  <TableCell>{tenant.shop_name}</TableCell>
                  <TableCell>{tenant.area || '-'}</TableCell>
                  <TableCell>
                    {tenant.contact_name ? (
                      <div>
                        <p className="text-sm">{tenant.contact_name}</p>
                        {tenant.contact_phone && (
                          <p className="text-xs text-muted-foreground">{tenant.contact_phone}</p>
                        )}
                      </div>
                    ) : (
                      '-'
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={tenant.is_active ? 'default' : 'secondary'}>
                      {tenant.is_active ? 'Active' : 'Inactive'}
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
                        <DropdownMenuItem onClick={() => setDocumentsDialogTenant(tenant)}>
                          <FileText className="h-4 w-4 mr-2" />
                          Documents
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setShopSpecDialogTenant(tenant)}>
                          <Store className="h-4 w-4 mr-2" />
                          Shop Spec
                        </DropdownMenuItem>
                        {isAdminOrManager && (
                          <>
                            <DropdownMenuItem onClick={() => openEditDialog(tenant)}>
                              <Edit className="h-4 w-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleDelete(tenant)}
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
                {expanded && (
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableCell colSpan={7} className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-sm font-semibold">Shop Specification</h4>
                        {isAdminOrManager && (
                          <Button size="sm" variant="outline" onClick={() => setShopSpecDialogTenant(tenant)}>
                            <Store className="h-4 w-4 mr-2" />
                            {spec ? 'Edit Shop Spec' : 'Add Shop Spec'}
                          </Button>
                        )}
                      </div>
                      {spec ? (
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-2">
                          {SPEC_FIELDS.map((f) => {
                            const v = spec[f.key];
                            return (
                              <div key={String(f.key)} className="text-sm">
                                <span className="text-muted-foreground">{f.label}: </span>
                                <span className="font-medium">{v == null || v === '' ? '—' : String(v)}</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No shop spec captured for this tenant yet.</p>
                      )}
                    </TableCell>
                  </TableRow>
                )}
                </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Documents Dialog */}
      {documentsDialogTenant && (
        <TenantDocumentsDialog
          tenant={documentsDialogTenant}
          open={!!documentsDialogTenant}
          onOpenChange={(open) => !open && setDocumentsDialogTenant(null)}
        />
      )}

      {/* Shop Spec Dialog */}
      {shopSpecDialogTenant && (
        <TenantShopSpecDialog
          tenant={shopSpecDialogTenant}
          buildingId={buildingId}
          open={!!shopSpecDialogTenant}
          onOpenChange={(open) => { if (!open) { setShopSpecDialogTenant(null); fetchTenants(); } }}
        />
      )}

      {/* Import Dialog */}
      <TenantImportDialog
        open={isImportDialogOpen}
        onOpenChange={setIsImportDialogOpen}
        buildingId={buildingId}
        onImportComplete={fetchTenants}
      />
    </div>
  );
}
