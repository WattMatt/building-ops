/**
 * Import dialog for building tenants from CSV/Excel files
 */

import { TableCell } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  GenericImportDialog,
  FieldConfig,
  ParsedRow,
  MappedRecord,
} from '@/components/import/GenericImportDialog';

interface TenantImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  buildingId: string;
  onImportComplete: () => void;
}

interface TenantData {
  shop_number: string;
  shop_name: string;
  area: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
}

const TENANT_FIELDS: FieldConfig[] = [
  { key: 'shop_number', label: 'Shop Number', required: true, aliases: ['unit', 'unit number', 'shop #', 'unit #'] },
  { key: 'shop_name', label: 'Shop/Tenant Name', required: true, aliases: ['tenant', 'tenant name', 'business', 'business name', 'name'] },
  { key: 'area', label: 'Area (sqm)', required: false, aliases: ['size', 'floor area', 'sqm', 'square meters'] },
  { key: 'contact_name', label: 'Contact Name', required: false, aliases: ['contact', 'person', 'representative'] },
  { key: 'contact_phone', label: 'Phone', required: false, aliases: ['tel', 'telephone', 'mobile', 'cell'] },
  { key: 'contact_email', label: 'Email', required: false, aliases: ['email address', 'e-mail'] },
];

const TEMPLATE_DATA = [
  ['shop_number', 'shop_name', 'area', 'contact_name', 'contact_phone', 'contact_email'],
  ['G01', 'Coffee Shop', '85', 'John Smith', '+27 82 123 4567', 'john@coffeeshop.co.za'],
  ['G02', 'Fashion Boutique', '120', 'Sarah Johnson', '+27 83 234 5678', 'sarah@fashion.co.za'],
];

export default function TenantImportDialog({
  open,
  onOpenChange,
  buildingId,
  onImportComplete,
}: TenantImportDialogProps) {
  
  const validateRow = (row: ParsedRow, fieldMapping: Record<string, string>): MappedRecord<TenantData> => {
    const errors: string[] = [];
    
    const shopNumber = row[fieldMapping.shop_number]?.trim() || '';
    const shopName = row[fieldMapping.shop_name]?.trim() || '';
    const area = row[fieldMapping.area]?.trim() || null;
    const contactName = row[fieldMapping.contact_name]?.trim() || null;
    const contactPhone = row[fieldMapping.contact_phone]?.trim() || null;
    const contactEmail = row[fieldMapping.contact_email]?.trim() || null;

    if (!shopNumber) errors.push('Shop number is required');
    if (!shopName) errors.push('Shop name is required');
    
    // Validate email format if provided
    if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      errors.push('Invalid email format');
    }

    return {
      data: {
        shop_number: shopNumber,
        shop_name: shopName,
        area,
        contact_name: contactName,
        contact_phone: contactPhone,
        contact_email: contactEmail,
      },
      isValid: errors.length === 0,
      errors,
      originalRow: 0, // Will be set by GenericImportDialog
    };
  };

  const importRecord = async (data: TenantData) => {
    const { error } = await supabase.from('building_tenants').insert({
      building_id: buildingId,
      shop_number: data.shop_number,
      shop_name: data.shop_name,
      area: data.area,
      contact_name: data.contact_name,
      contact_phone: data.contact_phone,
      contact_email: data.contact_email,
    });

    if (error) throw error;
  };

  const renderPreviewColumns = (record: MappedRecord<TenantData>) => [
    <TableCell key="shop_number">{record.data.shop_number}</TableCell>,
    <TableCell key="shop_name">{record.data.shop_name}</TableCell>,
    <TableCell key="area">{record.data.area || '-'}</TableCell>,
    <TableCell key="contact">{record.data.contact_name || '-'}</TableCell>,
  ];

  return (
    <GenericImportDialog<TenantData>
      open={open}
      onOpenChange={onOpenChange}
      title="Import Tenants"
      description="Upload a CSV or Excel file with tenant data"
      fields={TENANT_FIELDS}
      templateData={TEMPLATE_DATA}
      templateFileName="tenants_import_template.xlsx"
      validateRow={validateRow}
      importRecord={importRecord}
      onImportComplete={() => {
        toast.success('Tenants imported successfully');
        onImportComplete();
      }}
      renderPreviewColumns={renderPreviewColumns}
      previewColumnHeaders={['Shop #', 'Name', 'Area', 'Contact']}
    />
  );
}
