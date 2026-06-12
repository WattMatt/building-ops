import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { openStorageFile } from '@/integrations/supabase/storage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Upload, FileText, Trash2, Download, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface Tenant {
  id: string;
  shop_number: string;
  shop_name: string;
}

interface TenantDocument {
  id: string;
  name: string;
  document_type: string;
  file_url: string;
  file_name: string;
  file_size: number | null;
  expiry_date: string | null;
  created_at: string;
}

interface TenantDocumentsDialogProps {
  tenant: Tenant;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DOCUMENT_TYPES = [
  { value: 'lease_agreement', label: 'Lease Agreement' },
  { value: 'utility_account', label: 'Utility Account' },
  { value: 'electrical_coc', label: 'Electrical COC' },
  { value: 'handover_document', label: 'Handover Document' },
  { value: 'other', label: 'Other' },
];

export default function TenantDocumentsDialog({ tenant, open, onOpenChange }: TenantDocumentsDialogProps) {
  const { isAdminOrManager, user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<TenantDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedType, setSelectedType] = useState<string>('lease_agreement');
  const [documentName, setDocumentName] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  useEffect(() => {
    if (open) {
      fetchDocuments();
    }
  }, [open, tenant.id]);

  const fetchDocuments = async () => {
    try {
      const { data, error } = await supabase
        .from('tenant_documents')
        .select('*')
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setDocuments(data || []);
    } catch (error) {
      console.error('Error fetching documents:', error);
      toast.error('Failed to load documents');
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      if (!documentName) {
        setDocumentName(file.name.replace(/\.[^/.]+$/, ''));
      }
    }
  };

  const handleUpload = async () => {
    if (!selectedFile || !documentName.trim()) {
      toast.error('Please select a file and enter a document name');
      return;
    }

    setUploading(true);

    try {
      // Upload file to storage. Path MUST be tenant-docs/<tenant_id>/… — the
      // tenant-docs storage policy keys off the "tenant-docs" prefix and
      // resolves building access via building_tenants at segment 2.
      const fileExt = selectedFile.name.split('.').pop();
      const filePath = `tenant-docs/${tenant.id}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('tenant-documents')
        .upload(filePath, selectedFile);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('tenant-documents')
        .getPublicUrl(filePath);

      // Save document record
      const { error: insertError } = await supabase
        .from('tenant_documents')
        .insert({
          tenant_id: tenant.id,
          document_name: documentName.trim(),
          document_type: selectedType,
          file_url: urlData.publicUrl,
          file_name: selectedFile.name,
          file_size: selectedFile.size,
          uploaded_by: user?.id,
        });

      if (insertError) throw insertError;

      toast.success('Document uploaded successfully');
      setSelectedFile(null);
      setDocumentName('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      fetchDocuments();
    } catch (error: any) {
      console.error('Error uploading document:', error);
      toast.error(error.message || 'Failed to upload document');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (doc: TenantDocument) => {
    if (!confirm('Are you sure you want to delete this document?')) return;

    try {
      // Extract file path from URL
      const urlParts = doc.file_url.split('/tenant-documents/');
      if (urlParts.length > 1) {
        const filePath = urlParts[1];
        await supabase.storage.from('tenant-documents').remove([filePath]);
      }

      const { error } = await supabase
        .from('tenant_documents')
        .delete()
        .eq('id', doc.id);

      if (error) throw error;
      toast.success('Document deleted');
      fetchDocuments();
    } catch (error) {
      console.error('Error deleting document:', error);
      toast.error('Failed to delete document');
    }
  };

  const getDocumentsByType = (type: string) => {
    return documents.filter((doc) => doc.document_type === type);
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Documents - {tenant.shop_number}: {tenant.shop_name}
          </DialogTitle>
          <DialogDescription>
            Manage documents for this tenant
          </DialogDescription>
        </DialogHeader>

        {/* Upload Section */}
        {isAdminOrManager && (
          <div className="border rounded-lg p-4 space-y-4">
            <h3 className="font-medium">Upload New Document</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="doc-type">Document Type</Label>
                <Select value={selectedType} onValueChange={setSelectedType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DOCUMENT_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="doc-name">Document Name</Label>
                <Input
                  id="doc-name"
                  placeholder="Enter document name"
                  value={documentName}
                  onChange={(e) => setDocumentName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="doc-file">File</Label>
                <Input
                  id="doc-file"
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
                />
              </div>
            </div>
            <Button onClick={handleUpload} disabled={uploading || !selectedFile}>
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Document
                </>
              )}
            </Button>
          </div>
        )}

        {/* Documents by Category */}
        <Tabs defaultValue="all" className="w-full">
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="all">All ({documents.length})</TabsTrigger>
            {DOCUMENT_TYPES.map((type) => (
              <TabsTrigger key={type.value} value={type.value}>
                {type.label} ({getDocumentsByType(type.value).length})
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="all" className="mt-4">
            <DocumentsTable
              documents={documents}
              loading={loading}
              onDelete={handleDelete}
              isAdminOrManager={isAdminOrManager}
              formatFileSize={formatFileSize}
            />
          </TabsContent>

          {DOCUMENT_TYPES.map((type) => (
            <TabsContent key={type.value} value={type.value} className="mt-4">
              <DocumentsTable
                documents={getDocumentsByType(type.value)}
                loading={loading}
                onDelete={handleDelete}
                isAdminOrManager={isAdminOrManager}
                formatFileSize={formatFileSize}
              />
            </TabsContent>
          ))}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function DocumentsTable({
  documents,
  loading,
  onDelete,
  isAdminOrManager,
  formatFileSize,
}: {
  documents: TenantDocument[];
  loading: boolean;
  onDelete: (doc: TenantDocument) => void;
  isAdminOrManager: boolean;
  formatFileSize: (bytes: number | null) => string;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="w-6 h-6 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <FileText className="h-12 w-12 mb-4" />
        <p>No documents found</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Size</TableHead>
          <TableHead>Uploaded</TableHead>
          <TableHead className="w-[100px]">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {documents.map((doc) => (
          <TableRow key={doc.id}>
            <TableCell className="font-medium">{doc.document_name}</TableCell>
            <TableCell>
              <Badge variant="outline">
                {DOCUMENT_TYPES.find((t) => t.value === doc.document_type)?.label || doc.document_type}
              </Badge>
            </TableCell>
            <TableCell>{formatFileSize(doc.file_size)}</TableCell>
            <TableCell>{format(new Date(doc.created_at), 'dd MMM yyyy')}</TableCell>
            <TableCell>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => openStorageFile(doc.file_url)}
                  title="Open"
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
                {isAdminOrManager && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onDelete(doc)}
                    className="text-destructive hover:text-destructive"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

const DOCUMENT_TYPES_FOR_TABLE = [
  { value: 'lease_agreement', label: 'Lease Agreement' },
  { value: 'utility_account', label: 'Utility Account' },
  { value: 'electrical_coc', label: 'Electrical COC' },
  { value: 'handover_document', label: 'Handover Document' },
  { value: 'other', label: 'Other' },
];
