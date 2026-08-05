/**
 * Import dialog for building tenants from CSV/Excel files
 */

import { useEffect, useRef } from 'react';
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
  // Per-run outcome tally. GenericImportDialog only counts success/failure, so the
  // insert-vs-update split of a roster re-upload is tracked here.
  const outcomes = useRef({ inserted: 0, updated: 0, failed: 0, errorShown: false });

  useEffect(() => {
    if (open) outcomes.current = { inserted: 0, updated: 0, failed: 0, errorShown: false };
  }, [open]);

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

  const recordFailure = (message: string) => {
    outcomes.current.failed++;
    // Surface the first failure immediately: the summary toast only fires when
    // at least one row succeeded.
    if (!outcomes.current.errorShown) {
      outcomes.current.errorShown = true;
      toast.error(`Tenant import error: ${message}`);
    }
  };

  const importRecord = async (data: TenantData) => {
    // Re-uploading an updated roster is the normal use of this feature, so an
    // existing (building_id, shop_number) must UPDATE rather than fail on
    // building_tenants_building_shop_uniq. Resolved before the write so the
    // reported added/updated counts are real and not guessed.
    const { data: existing, error: lookupError } = await supabase
      .from('building_tenants')
      .select('id')
      .eq('building_id', buildingId)
      .eq('shop_number', data.shop_number)
      .maybeSingle();

    if (lookupError) {
      recordFailure(lookupError.message);
      throw lookupError;
    }

    const { data: written, error } = await supabase
      .from('building_tenants')
      .upsert(
        {
          building_id: buildingId,
          shop_number: data.shop_number,
          shop_name: data.shop_name,
          area: data.area,
          contact_name: data.contact_name,
          contact_phone: data.contact_phone,
          contact_email: data.contact_email,
        },
        { onConflict: 'building_id,shop_number' }
      )
      .select('id');

    if (error) {
      recordFailure(error.message);
      throw error;
    }

    // RLS denies on write come back as success with zero rows — never report
    // a row as imported without proof it landed.
    if (!written || written.length === 0) {
      const message = `Shop ${data.shop_number} was not saved (permission denied)`;
      recordFailure(message);
      throw new Error(message);
    }

    if (existing) {
      outcomes.current.updated++;
    } else {
      outcomes.current.inserted++;
    }
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
        const { inserted, updated, failed } = outcomes.current;
        const summary = [`${inserted} added`, `${updated} updated`]
          .concat(failed > 0 ? [`${failed} failed`] : [])
          .join(', ');
        if (failed > 0) {
          toast.warning(`Tenant import finished: ${summary}`);
        } else {
          toast.success(`Tenant import finished: ${summary}`);
        }
        onImportComplete();
      }}
      renderPreviewColumns={renderPreviewColumns}
      previewColumnHeaders={['Shop #', 'Name', 'Area', 'Contact']}
    />
  );
}
