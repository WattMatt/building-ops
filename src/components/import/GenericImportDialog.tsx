/**
 * Generic bulk import dialog for CSV/Excel files
 * Supports field mapping, validation, and preview before import
 */

import { useState, useCallback } from 'react';
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
import { toast } from 'sonner';

export type ImportStep = 'upload' | 'mapping' | 'preview' | 'importing' | 'complete';

export interface ParsedRow {
  [key: string]: string;
}

export interface FieldConfig {
  key: string;
  label: string;
  required: boolean;
  aliases?: string[]; // Alternative column names for auto-mapping
}

export interface MappedRecord<T> {
  data: T;
  isValid: boolean;
  errors: string[];
  originalRow: number;
}

export interface GenericImportDialogProps<T> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  fields: FieldConfig[];
  templateData: (string | number)[][];
  templateFileName: string;
  validateRow: (row: ParsedRow, fieldMapping: Record<string, string>) => MappedRecord<T>;
  importRecord: (record: T) => Promise<void>;
  onImportComplete: () => void;
  renderPreviewColumns: (record: MappedRecord<T>) => React.ReactNode[];
  previewColumnHeaders: string[];
}

export function GenericImportDialog<T>({
  open,
  onOpenChange,
  title,
  description,
  fields,
  templateData,
  templateFileName,
  validateRow,
  importRecord,
  onImportComplete,
  renderPreviewColumns,
  previewColumnHeaders,
}: GenericImportDialogProps<T>) {
  const [step, setStep] = useState<ImportStep>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [fieldMapping, setFieldMapping] = useState<Record<string, string>>({});
  const [mappedRecords, setMappedRecords] = useState<MappedRecord<T>[]>([]);
  const [importProgress, setImportProgress] = useState(0);
  const [importResults, setImportResults] = useState({ success: 0, failed: 0 });
  const [dragActive, setDragActive] = useState(false);

  const resetState = () => {
    setStep('upload');
    setFile(null);
    setParsedData([]);
    setHeaders([]);
    setFieldMapping({});
    setMappedRecords([]);
    setImportProgress(0);
    setImportResults({ success: 0, failed: 0 });
  };

  const handleClose = () => {
    resetState();
    onOpenChange(false);
  };

  const autoMapFields = useCallback((cols: string[]) => {
    const mapping: Record<string, string> = {};
    const lowerCols = cols.map((c) => c.toLowerCase().trim());

    fields.forEach((field) => {
      const fieldLower = field.key.toLowerCase();
      // Try exact match first
      let idx = lowerCols.findIndex((c) => c === fieldLower);
      // Try contains match
      if (idx === -1) {
        idx = lowerCols.findIndex((c) => c.includes(fieldLower) || fieldLower.includes(c));
      }
      // Try aliases
      if (idx === -1 && field.aliases) {
        for (const alias of field.aliases) {
          const aliasLower = alias.toLowerCase();
          idx = lowerCols.findIndex((c) => c.includes(aliasLower) || aliasLower.includes(c));
          if (idx !== -1) break;
        }
      }
      if (idx !== -1) {
        mapping[field.key] = cols[idx];
      }
    });

    setFieldMapping(mapping);
  }, [fields]);

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
  }, [autoMapFields]);

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
    const mapped = parsedData.map((row, index) => 
      validateRow(row, fieldMapping)
    ).map((record, index) => ({
      ...record,
      originalRow: index + 2, // +2 for header row and 0-indexing
    }));

    setMappedRecords(mapped);
    setStep('preview');
  };

  const handleImport = async () => {
    const validRecords = mappedRecords.filter((r) => r.isValid);
    if (validRecords.length === 0) {
      toast.error('No valid records to import');
      return;
    }

    setStep('importing');
    let success = 0;
    let failed = 0;

    for (let i = 0; i < validRecords.length; i++) {
      const record = validRecords[i];
      try {
        await importRecord(record.data);
        success++;
      } catch (err) {
        console.error('Failed to import record:', err);
        failed++;
      }

      setImportProgress(Math.round(((i + 1) / validRecords.length) * 100));
    }

    setImportResults({ success, failed });
    setStep('complete');

    if (success > 0) {
      onImportComplete();
    }
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Import');
    XLSX.writeFile(wb, templateFileName);
  };

  const requiredFields = fields.filter(f => f.required);
  const allRequiredMapped = requiredFields.every(f => fieldMapping[f.key]);
  const validCount = mappedRecords.filter((r) => r.isValid).length;
  const invalidCount = mappedRecords.filter((r) => !r.isValid).length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            {title}
          </DialogTitle>
          <DialogDescription>
            {step === 'upload' && (description || 'Upload a CSV or Excel file')}
            {step === 'mapping' && 'Map your file columns to fields'}
            {step === 'preview' && 'Review and confirm the import'}
            {step === 'importing' && 'Importing records...'}
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
              {fields.map((field) => (
                <div key={field.key} className="flex items-center gap-4">
                  <Label className="w-40 text-right">
                    {field.label}
                    {field.required && (
                      <span className="text-destructive ml-1">*</span>
                    )}
                  </Label>
                  <Select
                    value={fieldMapping[field.key] || ''}
                    onValueChange={(value) =>
                      setFieldMapping((prev) => ({
                        ...prev,
                        [field.key]: value === '_none_' ? '' : value,
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
                disabled={!allRequiredMapped}
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
                    {previewColumnHeaders.map((header) => (
                      <TableHead key={header}>{header}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mappedRecords.map((record, idx) => (
                    <TableRow
                      key={idx}
                      className={!record.isValid ? 'bg-destructive/10' : ''}
                    >
                      <TableCell className="font-mono text-xs">
                        {record.originalRow}
                      </TableCell>
                      <TableCell>
                        {record.isValid ? (
                          <CheckCircle2 className="h-4 w-4 text-success" />
                        ) : (
                          <div className="flex items-center gap-1">
                            <AlertCircle className="h-4 w-4 text-destructive" />
                            <span className="text-xs text-destructive">
                              {record.errors.join(', ')}
                            </span>
                          </div>
                        )}
                      </TableCell>
                      {renderPreviewColumns(record)}
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
                Import {validCount} Records
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Importing Step */}
        {step === 'importing' && (
          <div className="space-y-6 py-8">
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="text-muted-foreground">Importing records...</p>
            </div>
            <Progress value={importProgress} className="w-full" />
            <p className="text-center text-sm text-muted-foreground">
              {importProgress}% complete
            </p>
          </div>
        )}

        {/* Complete Step */}
        {step === 'complete' && (
          <div className="space-y-6 py-8">
            <div className="flex flex-col items-center gap-4">
              <CheckCircle2 className="h-12 w-12 text-success" />
              <h3 className="text-lg font-semibold">Import Complete</h3>
            </div>

            <div className="flex justify-center gap-8">
              <div className="text-center">
                <p className="text-2xl font-bold text-success">{importResults.success}</p>
                <p className="text-sm text-muted-foreground">Imported</p>
              </div>
              {importResults.failed > 0 && (
                <div className="text-center">
                  <p className="text-2xl font-bold text-destructive">{importResults.failed}</p>
                  <p className="text-sm text-muted-foreground">Failed</p>
                </div>
              )}
            </div>

            <DialogFooter className="justify-center">
              <Button onClick={handleClose}>Done</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
