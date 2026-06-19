/**
 * Bulk import dialog for buildings from CSV/Excel files
 * Supports field mapping, validation, and preview before import
 */

import { useState, useCallback } from 'react';
import { formatBuildingName } from '@/lib/buildingName';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Upload,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle2,
  X,
  Loader2,
  Download,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useOrganization } from '@/hooks/useOrganization';

interface BuildingImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportComplete: () => void;
}

type ImportStep = 'upload' | 'mapping' | 'preview' | 'importing' | 'complete';

interface ParsedRow {
  [key: string]: string;
}

interface MappedBuilding {
  name: string;
  address: string;
  city: string;
  latitude?: number;
  longitude?: number;
  isValid: boolean;
  errors: string[];
  originalRow: number;
}

const REQUIRED_FIELDS = ['name', 'address'];
const OPTIONAL_FIELDS = ['city', 'latitude', 'longitude'];
const ALL_FIELDS = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];

const FIELD_LABELS: Record<string, string> = {
  name: 'Building Name',
  address: 'Address',
  city: 'City',
  latitude: 'Latitude',
  longitude: 'Longitude',
};

export default function BuildingImportDialog({
  open,
  onOpenChange,
  onImportComplete,
}: BuildingImportDialogProps) {
  const { organization } = useOrganization();
  const [step, setStep] = useState<ImportStep>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [fieldMapping, setFieldMapping] = useState<Record<string, string>>({});
  const [mappedBuildings, setMappedBuildings] = useState<MappedBuilding[]>([]);
  const [importProgress, setImportProgress] = useState(0);
  const [importResults, setImportResults] = useState({ success: 0, failed: 0 });
  const [dragActive, setDragActive] = useState(false);

  const resetState = () => {
    setStep('upload');
    setFile(null);
    setParsedData([]);
    setHeaders([]);
    setFieldMapping({});
    setMappedBuildings([]);
    setImportProgress(0);
    setImportResults({ success: 0, failed: 0 });
  };

  const handleClose = () => {
    resetState();
    onOpenChange(false);
  };

  const parseFile = useCallback((file: File) => {
    const extension = file.name.split('.').pop()?.toLowerCase();

    if (extension === 'csv') {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          if (results.data.length > 0) {
            const data = results.data as ParsedRow[];
            const cols = Object.keys(data[0]);
            setHeaders(cols);
            setParsedData(data);
            autoMapFields(cols);
            setStep('mapping');
          } else {
            toast.error('No data found in the file');
          }
        },
        error: (error) => {
          toast.error(`Failed to parse CSV: ${error.message}`);
        },
      });
    } else if (extension === 'xlsx' || extension === 'xls') {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as unknown[][];

          if (jsonData.length > 1) {
            const cols = jsonData[0] as string[];
            const rows = jsonData.slice(1).map((row) => {
              const obj: ParsedRow = {};
              cols.forEach((col, i) => {
                obj[col] = String((row as unknown[])[i] ?? '');
              });
              return obj;
            }).filter(row => Object.values(row).some(v => v.trim()));

            setHeaders(cols);
            setParsedData(rows);
            autoMapFields(cols);
            setStep('mapping');
          } else {
            toast.error('No data found in the file');
          }
        } catch {
          toast.error('Failed to parse Excel file');
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      toast.error('Please upload a CSV or Excel file');
    }
  }, []);

  const autoMapFields = (cols: string[]) => {
    const mapping: Record<string, string> = {};
    const lowerCols = cols.map((c) => c.toLowerCase().trim());

    ALL_FIELDS.forEach((field) => {
      const fieldLower = field.toLowerCase();
      // Try exact match first
      let idx = lowerCols.findIndex((c) => c === fieldLower);
      // Try contains match
      if (idx === -1) {
        idx = lowerCols.findIndex((c) => c.includes(fieldLower) || fieldLower.includes(c));
      }
      // Special cases
      if (idx === -1 && field === 'name') {
        idx = lowerCols.findIndex((c) => c.includes('building') || c.includes('property'));
      }
      if (idx !== -1) {
        mapping[field] = cols[idx];
      }
    });

    setFieldMapping(mapping);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      setFile(droppedFile);
      parseFile(droppedFile);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      parseFile(selectedFile);
    }
  };

  const validateAndMapData = () => {
    const mapped: MappedBuilding[] = parsedData.map((row, index) => {
      const errors: string[] = [];
      const name = row[fieldMapping.name]?.trim() || '';
      const address = row[fieldMapping.address]?.trim() || '';
      const city = row[fieldMapping.city]?.trim() || 'City of Tshwane';
      const latStr = row[fieldMapping.latitude]?.trim() || '';
      const lngStr = row[fieldMapping.longitude]?.trim() || '';

      if (!name) errors.push('Name is required');
      if (!address) errors.push('Address is required');

      let latitude: number | undefined;
      let longitude: number | undefined;

      if (latStr) {
        const lat = parseFloat(latStr);
        if (isNaN(lat) || lat < -90 || lat > 90) {
          errors.push('Invalid latitude');
        } else {
          latitude = lat;
        }
      }

      if (lngStr) {
        const lng = parseFloat(lngStr);
        if (isNaN(lng) || lng < -180 || lng > 180) {
          errors.push('Invalid longitude');
        } else {
          longitude = lng;
        }
      }

      return {
        name,
        address,
        city,
        latitude,
        longitude,
        isValid: errors.length === 0,
        errors,
        originalRow: index + 2, // +2 for header row and 0-indexing
      };
    });

    setMappedBuildings(mapped);
    setStep('preview');
  };

  const handleImport = async () => {
    if (!organization?.id) {
      toast.error('Organization not found');
      return;
    }

    const validBuildings = mappedBuildings.filter((b) => b.isValid);
    if (validBuildings.length === 0) {
      toast.error('No valid buildings to import');
      return;
    }

    setStep('importing');
    let success = 0;
    let failed = 0;

    for (let i = 0; i < validBuildings.length; i++) {
      const building = validBuildings[i];
      try {
        const { error } = await supabase.from('buildings').insert({
          name: building.name,
          address: building.address,
          city: building.city,
          latitude: building.latitude,
          longitude: building.longitude,
          organization_id: organization.id,
        });

        if (error) throw error;
        success++;
      } catch (err) {
        console.error('Failed to import building:', building.name, err);
        failed++;
      }

      setImportProgress(Math.round(((i + 1) / validBuildings.length) * 100));
    }

    setImportResults({ success, failed });
    setStep('complete');

    if (success > 0) {
      onImportComplete();
    }
  };

  const downloadTemplate = () => {
    const template = [
      ['name', 'address', 'city', 'latitude', 'longitude'],
      ['Example Building', '123 Main Street', 'Johannesburg', '-26.2041', '28.0473'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(template);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Buildings');
    XLSX.writeFile(wb, 'buildings_import_template.xlsx');
  };

  const validCount = mappedBuildings.filter((b) => b.isValid).length;
  const invalidCount = mappedBuildings.filter((b) => !b.isValid).length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Import Buildings
          </DialogTitle>
          <DialogDescription>
            {step === 'upload' && 'Upload a CSV or Excel file with building data'}
            {step === 'mapping' && 'Map your file columns to building fields'}
            {step === 'preview' && 'Review and confirm the import'}
            {step === 'importing' && 'Importing buildings...'}
            {step === 'complete' && 'Import complete'}
          </DialogDescription>
        </DialogHeader>

        {/* Upload Step */}
        {step === 'upload' && (
          <div className="space-y-4">
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                dragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'
              }`}
            >
              <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-4" />
              <p className="text-sm text-muted-foreground mb-2">
                Drag and drop your file here, or click to browse
              </p>
              <Input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileChange}
                className="max-w-xs mx-auto"
              />
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Supported formats: CSV, Excel (.xlsx, .xls)
              </span>
              <Button variant="outline" size="sm" onClick={downloadTemplate}>
                <Download className="h-4 w-4 mr-2" />
                Download Template
              </Button>
            </div>
          </div>
        )}

        {/* Mapping Step */}
        {step === 'mapping' && (
          <div className="space-y-4">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Found {parsedData.length} rows in {file?.name}. Map your columns below.
              </AlertDescription>
            </Alert>

            <div className="grid gap-4">
              {ALL_FIELDS.map((field) => (
                <div key={field} className="flex items-center gap-4">
                  <Label className="w-32 text-right">
                    {FIELD_LABELS[field]}
                    {REQUIRED_FIELDS.includes(field) && (
                      <span className="text-destructive ml-1">*</span>
                    )}
                  </Label>
                  <Select
                    value={fieldMapping[field] || ''}
                    onValueChange={(value) =>
                      setFieldMapping((prev) => ({
                        ...prev,
                        [field]: value === '_none_' ? '' : value,
                      }))
                    }
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select column" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none_">-- Not mapped --</SelectItem>
                      {headers.map((header) => (
                        <SelectItem key={header} value={header}>
                          {header}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('upload')}>
                Back
              </Button>
              <Button
                onClick={validateAndMapData}
                disabled={!fieldMapping.name || !fieldMapping.address}
              >
                Continue
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Preview Step */}
        {step === 'preview' && (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <Badge variant="secondary" className="gap-1">
                <CheckCircle2 className="h-3 w-3 text-success" />
                {validCount} valid
              </Badge>
              {invalidCount > 0 && (
                <Badge variant="destructive" className="gap-1">
                  <X className="h-3 w-3" />
                  {invalidCount} invalid
                </Badge>
              )}
            </div>

            <ScrollArea className="h-[300px] rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">Row</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead>City</TableHead>
                    <TableHead>Coordinates</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mappedBuildings.map((building, idx) => (
                    <TableRow
                      key={idx}
                      className={!building.isValid ? 'bg-destructive/10' : ''}
                    >
                      <TableCell className="font-mono text-xs">
                        {building.originalRow}
                      </TableCell>
                      <TableCell>
                        {building.isValid ? (
                          <CheckCircle2 className="h-4 w-4 text-success" />
                        ) : (
                          <div className="flex items-center gap-1">
                            <AlertCircle className="h-4 w-4 text-destructive" />
                            <span className="text-xs text-destructive">
                              {building.errors.join(', ')}
                            </span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="font-medium">{formatBuildingName(building.name) || '-'}</TableCell>
                      <TableCell className="max-w-[200px] truncate">
                        {building.address || '-'}
                      </TableCell>
                      <TableCell>{building.city || '-'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {building.latitude && building.longitude
                          ? `${building.latitude}, ${building.longitude}`
                          : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('mapping')}>
                Back
              </Button>
              <Button onClick={handleImport} disabled={validCount === 0}>
                Import {validCount} Building{validCount !== 1 ? 's' : ''}
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Importing Step */}
        {step === 'importing' && (
          <div className="py-8 space-y-4">
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>Importing buildings...</span>
            </div>
            <Progress value={importProgress} className="w-full" />
            <p className="text-center text-sm text-muted-foreground">{importProgress}% complete</p>
          </div>
        )}

        {/* Complete Step */}
        {step === 'complete' && (
          <div className="py-8 space-y-4 text-center">
            <CheckCircle2 className="h-12 w-12 text-success mx-auto" />
            <div>
              <p className="text-lg font-semibold">Import Complete</p>
              <p className="text-sm text-muted-foreground">
                Successfully imported {importResults.success} building
                {importResults.success !== 1 ? 's' : ''}
                {importResults.failed > 0 && `, ${importResults.failed} failed`}
              </p>
            </div>
            <DialogFooter className="justify-center">
              <Button onClick={handleClose}>Close</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
