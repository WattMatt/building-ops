/**
 * Import dialog for building assets from CSV/Excel files
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

interface AssetImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  buildingId: string;
  onImportComplete: () => void;
}

interface AssetData {
  name: string;
  category: string;
  location: string | null;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  installation_date: string | null;
  next_service_date: string | null;
  status: string;
}

const ASSET_FIELDS: FieldConfig[] = [
  { key: 'name', label: 'Asset Name', required: true, aliases: ['asset', 'equipment', 'item'] },
  { key: 'category', label: 'Category', required: true, aliases: ['type', 'asset type', 'equipment type'] },
  { key: 'location', label: 'Location', required: false, aliases: ['position', 'floor', 'area'] },
  { key: 'manufacturer', label: 'Manufacturer', required: false, aliases: ['make', 'brand', 'vendor'] },
  { key: 'model', label: 'Model', required: false, aliases: ['model number', 'model #'] },
  { key: 'serial_number', label: 'Serial Number', required: false, aliases: ['serial', 's/n', 'serial #'] },
  { key: 'installation_date', label: 'Installation Date', required: false, aliases: ['installed', 'install date'] },
  { key: 'next_service_date', label: 'Next Service Date', required: false, aliases: ['service due', 'maintenance date'] },
  { key: 'status', label: 'Status', required: false, aliases: ['condition', 'state'] },
];

const TEMPLATE_DATA = [
  ['name', 'category', 'location', 'manufacturer', 'model', 'serial_number', 'installation_date', 'next_service_date', 'status'],
  ['Main HVAC Unit', 'hvac', 'Roof', 'Carrier', 'XR15', 'CAR-2024-001', '2023-01-15', '2026-03-15', 'operational'],
  ['Fire Panel', 'fire_safety', 'Ground Floor', 'Siemens', 'FC1020', 'SIE-2023-045', '2022-06-20', '2026-06-20', 'operational'],
  ['Backup Generator', 'generator', 'Basement', 'Caterpillar', 'C15', 'CAT-2023-112', '2023-03-10', '2026-09-10', 'needs_maintenance'],
];

const CATEGORY_MAPPINGS: Record<string, string> = {
  'hvac': 'hvac',
  'hvac system': 'hvac',
  'air conditioning': 'hvac',
  'ac': 'hvac',
  'electrical': 'electrical',
  'electric': 'electrical',
  'plumbing': 'plumbing',
  'water': 'plumbing',
  'fire safety': 'fire_safety',
  'fire': 'fire_safety',
  'fire_safety': 'fire_safety',
  'elevator': 'elevator',
  'lift': 'elevator',
  'generator': 'generator',
  'genset': 'generator',
  'security': 'security',
  'security system': 'security',
  'cctv': 'security',
  'other': 'other',
};

const STATUS_MAPPINGS: Record<string, string> = {
  'operational': 'operational',
  'working': 'operational',
  'active': 'operational',
  'ok': 'operational',
  'needs maintenance': 'needs_maintenance',
  'needs_maintenance': 'needs_maintenance',
  'maintenance required': 'needs_maintenance',
  'under repair': 'under_repair',
  'under_repair': 'under_repair',
  'repairing': 'under_repair',
  'out of service': 'out_of_service',
  'out_of_service': 'out_of_service',
  'broken': 'out_of_service',
  'offline': 'out_of_service',
};

function parseDate(value: string): string | null {
  if (!value) return null;
  
  // Try parsing common date formats
  const date = new Date(value);
  if (!isNaN(date.getTime())) {
    return date.toISOString().split('T')[0];
  }
  
  // Try DD/MM/YYYY format
  const ddmmyyyy = value.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  return null;
}

export default function AssetImportDialog({
  open,
  onOpenChange,
  buildingId,
  onImportComplete,
}: AssetImportDialogProps) {
  
  const validateRow = (row: ParsedRow, fieldMapping: Record<string, string>): MappedRecord<AssetData> => {
    const errors: string[] = [];
    
    const name = row[fieldMapping.name]?.trim() || '';
    const categoryRaw = row[fieldMapping.category]?.trim().toLowerCase() || '';
    const location = row[fieldMapping.location]?.trim() || null;
    const manufacturer = row[fieldMapping.manufacturer]?.trim() || null;
    const model = row[fieldMapping.model]?.trim() || null;
    const serialNumber = row[fieldMapping.serial_number]?.trim() || null;
    const installationDateRaw = row[fieldMapping.installation_date]?.trim() || '';
    const nextServiceDateRaw = row[fieldMapping.next_service_date]?.trim() || '';
    const statusRaw = row[fieldMapping.status]?.trim().toLowerCase() || 'operational';

    // Validate required fields
    if (!name) errors.push('Name is required');
    if (!categoryRaw) errors.push('Category is required');

    // Map category
    const category = CATEGORY_MAPPINGS[categoryRaw] || 'other';
    if (categoryRaw && !CATEGORY_MAPPINGS[categoryRaw]) {
      // If category not recognized, still allow but warn (will use 'other')
    }

    // Map status
    const status = STATUS_MAPPINGS[statusRaw] || 'operational';

    // Parse dates
    const installationDate = parseDate(installationDateRaw);
    const nextServiceDate = parseDate(nextServiceDateRaw);

    if (installationDateRaw && !installationDate) {
      errors.push('Invalid installation date');
    }
    if (nextServiceDateRaw && !nextServiceDate) {
      errors.push('Invalid service date');
    }

    return {
      data: {
        name,
        category,
        location,
        manufacturer,
        model,
        serial_number: serialNumber,
        installation_date: installationDate,
        next_service_date: nextServiceDate,
        status,
      },
      isValid: errors.length === 0,
      errors,
      originalRow: 0,
    };
  };

  const importRecord = async (data: AssetData) => {
    const { error } = await supabase.from('building_assets').insert({
      building_id: buildingId,
      name: data.name,
      category: data.category,
      location: data.location,
      manufacturer: data.manufacturer,
      model: data.model,
      serial_number: data.serial_number,
      installation_date: data.installation_date,
      next_service_date: data.next_service_date,
      status: data.status,
    });

    if (error) throw error;
  };

  const getCategoryLabel = (value: string) => {
    const labels: Record<string, string> = {
      hvac: 'HVAC',
      electrical: 'Electrical',
      plumbing: 'Plumbing',
      fire_safety: 'Fire Safety',
      elevator: 'Elevator',
      generator: 'Generator',
      security: 'Security',
      other: 'Other',
    };
    return labels[value] || value;
  };

  const renderPreviewColumns = (record: MappedRecord<AssetData>) => [
    <TableCell key="name">{record.data.name}</TableCell>,
    <TableCell key="category">{getCategoryLabel(record.data.category)}</TableCell>,
    <TableCell key="location">{record.data.location || '-'}</TableCell>,
    <TableCell key="status">{record.data.status}</TableCell>,
  ];

  return (
    <GenericImportDialog<AssetData>
      open={open}
      onOpenChange={onOpenChange}
      title="Import Assets"
      description="Upload a CSV or Excel file with asset data"
      fields={ASSET_FIELDS}
      templateData={TEMPLATE_DATA}
      templateFileName="assets_import_template.xlsx"
      validateRow={validateRow}
      importRecord={importRecord}
      onImportComplete={() => {
        toast.success('Assets imported successfully');
        onImportComplete();
      }}
      renderPreviewColumns={renderPreviewColumns}
      previewColumnHeaders={['Name', 'Category', 'Location', 'Status']}
    />
  );
}
