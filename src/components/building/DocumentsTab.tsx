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
import { Plus, MoreVertical, Edit, Trash2, Search, FileText, Download, ExternalLink, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { format, differenceInDays } from 'date-fns';

interface Document {
  id: string;
  name: string;
  document_type: string;
  reference_number: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  issuing_authority: string | null;
  file_url: string | null;
  notes: string | null;
  created_at: string;
}

interface DocumentsTabProps {
  buildingId: string;
}

const DOCUMENT_TYPES = [
  { value: 'compliance_certificate', label: 'Compliance Certificate' },
  { value: 'fire_certificate', label: 'Fire Certificate' },
  { value: 'electrical_coc', label: 'Electrical COC' },
  { value: 'occupancy_certificate', label: 'Occupancy Certificate' },
  { value: 'insurance', label: 'Insurance Policy' },
  { value: 'floor_plan', label: 'Floor Plan' },
  { value: 'building_plan', label: 'Building Plan' },
  { value: 'municipal_rates', label: 'Municipal Rates' },
  { value: 'water_certificate', label: 'Water Certificate' },
  { value: 'gas_certificate', label: 'Gas Certificate' },
  { value: 'lift_certificate', label: 'Lift Certificate' },
  { value: 'other', label: 'Other' },
];

export default function DocumentsTab({ buildingId }: DocumentsTabProps) {
  const { isAdminOrManager, user } = useAuth();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingDocument, setEditingDocument] = useState<Document | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [documentType, setDocumentType] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [issuingAuthority, setIssuingAuthority] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    fetchDocuments();
  }, [buildingId]);

  const fetchDocuments = async () => {
    try {
      const { data, error } = await supabase
        .from('building_documents')
        .select('*')
        .eq('building_id', buildingId)
        .order('name');

      if (error) throw error;
      setDocuments(data || []);
    } catch (error) {
      console.error('Error fetching documents:', error);
      toast.error('Failed to load documents');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setName('');
    setDocumentType('');
    setReferenceNumber('');
    setIssueDate('');
    setExpiryDate('');
    setIssuingAuthority('');
    setNotes('');
    setSelectedFile(null);
    setEditingDocument(null);
  };

  const openEditDialog = (doc: Document) => {
    setEditingDocument(doc);
    setName(doc.name);
    setDocumentType(doc.document_type);
    setReferenceNumber(doc.reference_number || '');
    setIssueDate(doc.issue_date || '');
    setExpiryDate(doc.expiry_date || '');
    setIssuingAuthority(doc.issuing_authority || '');
    setNotes(doc.notes || '');
    setSelectedFile(null);
    setIsDialogOpen(true);
  };

  const uploadFile = async (file: File): Promise<string | null> => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${buildingId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from('tenant-documents')
      .upload(fileName, file);

    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage
      .from('tenant-documents')
      .getPublicUrl(fileName);

    return urlData.publicUrl;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || !documentType) {
      toast.error('Name and document type are required');
      return;
    }

    setSaving(true);

    try {
      let fileUrl = editingDocument?.file_url || null;

      if (selectedFile) {
        setUploading(true);
        fileUrl = await uploadFile(selectedFile);
        setUploading(false);
      }

      const documentData = {
        building_id: buildingId,
        name: name.trim(),
        document_type: documentType,
        reference_number: referenceNumber.trim() || null,
        issue_date: issueDate || null,
        expiry_date: expiryDate || null,
        issuing_authority: issuingAuthority.trim() || null,
        file_url: fileUrl,
        notes: notes.trim() || null,
        uploaded_by: user?.id || null,
      };

      if (editingDocument) {
        const { error } = await supabase
          .from('building_documents')
          .update(documentData)
          .eq('id', editingDocument.id);

        if (error) throw error;
        toast.success('Document updated successfully');
      } else {
        const { error } = await supabase
          .from('building_documents')
          .insert(documentData);

        if (error) throw error;
        toast.success('Document created successfully');
      }

      setIsDialogOpen(false);
      resetForm();
      fetchDocuments();
    } catch (error: any) {
      console.error('Error saving document:', error);
      toast.error(error.message || 'Failed to save document');
    } finally {
      setSaving(false);
      setUploading(false);
    }
  };

  const handleDelete = async (doc: Document) => {
    if (!confirm(`Are you sure you want to delete ${doc.name}?`)) return;

    try {
      const { error } = await supabase
        .from('building_documents')
        .delete()
        .eq('id', doc.id);

      if (error) throw error;
      toast.success('Document deleted successfully');
      fetchDocuments();
    } catch (error) {
      console.error('Error deleting document:', error);
      toast.error('Failed to delete document');
    }
  };

  const filteredDocuments = documents.filter((doc) => {
    const matchesSearch =
      doc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.document_type.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (doc.reference_number?.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesType = typeFilter === 'all' || doc.document_type === typeFilter;
    return matchesSearch && matchesType;
  });

  const getTypeLabel = (value: string) => {
    return DOCUMENT_TYPES.find((t) => t.value === value)?.label || value;
  };

  const getExpiryStatus = (expiryDate: string | null) => {
    if (!expiryDate) return null;
    
    const days = differenceInDays(new Date(expiryDate), new Date());
    
    if (days < 0) {
      return { label: 'Expired', variant: 'destructive' as const, days: Math.abs(days) };
    } else if (days <= 30) {
      return { label: 'Expiring Soon', variant: 'outline' as const, days };
    } else if (days <= 90) {
      return { label: 'Expires in 3 months', variant: 'secondary' as const, days };
    }
    return { label: 'Valid', variant: 'default' as const, days };
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
              placeholder="Search documents..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {DOCUMENT_TYPES.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {isAdminOrManager && (
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
                Add Document
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingDocument ? 'Edit Document' : 'Add Document'}</DialogTitle>
                <DialogDescription>
                  {editingDocument ? 'Update document information' : 'Add a new document to this building'}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="doc-name">Document Name *</Label>
                    <Input
                      id="doc-name"
                      placeholder="e.g., Fire Certificate 2024"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="doc-type">Document Type *</Label>
                    <Select value={documentType} onValueChange={setDocumentType} required>
                      <SelectTrigger>
                        <SelectValue placeholder="Select type" />
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
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="reference-number">Reference Number</Label>
                    <Input
                      id="reference-number"
                      placeholder="Certificate/Policy number"
                      value={referenceNumber}
                      onChange={(e) => setReferenceNumber(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="issuing-authority">Issuing Authority</Label>
                    <Input
                      id="issuing-authority"
                      placeholder="e.g., City Council"
                      value={issuingAuthority}
                      onChange={(e) => setIssuingAuthority(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="issue-date">Issue Date</Label>
                    <Input
                      id="issue-date"
                      type="date"
                      value={issueDate}
                      onChange={(e) => setIssueDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="expiry-date">Expiry Date</Label>
                    <Input
                      id="expiry-date"
                      type="date"
                      value={expiryDate}
                      onChange={(e) => setExpiryDate(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="file">Upload File</Label>
                  <Input
                    id="file"
                    type="file"
                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                    accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                  />
                  {editingDocument?.file_url && !selectedFile && (
                    <p className="text-xs text-muted-foreground">
                      Current file attached. Upload a new file to replace it.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    placeholder="Additional notes about this document..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                  />
                </div>

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={saving || uploading}>
                    {uploading ? 'Uploading...' : saving ? 'Saving...' : editingDocument ? 'Update' : 'Create'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Documents Table */}
      {filteredDocuments.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No documents found</h3>
            <p className="text-muted-foreground text-center mb-4">
              {searchQuery || typeFilter !== 'all'
                ? 'Try adjusting your search or filter'
                : 'Add your first document to get started'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Document Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[80px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredDocuments.map((doc) => {
                const expiryStatus = getExpiryStatus(doc.expiry_date);

                return (
                  <TableRow key={doc.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="font-medium">{doc.name}</p>
                          {doc.issuing_authority && (
                            <p className="text-xs text-muted-foreground">{doc.issuing_authority}</p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{getTypeLabel(doc.document_type)}</TableCell>
                    <TableCell>{doc.reference_number || '-'}</TableCell>
                    <TableCell>
                      {doc.expiry_date ? format(new Date(doc.expiry_date), 'dd MMM yyyy') : '-'}
                    </TableCell>
                    <TableCell>
                      {expiryStatus ? (
                        <Badge variant={expiryStatus.variant} className="gap-1">
                          {expiryStatus.variant === 'destructive' && <AlertCircle className="h-3 w-3" />}
                          {expiryStatus.label}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">No Expiry</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {doc.file_url && (
                            <DropdownMenuItem asChild>
                              <a href={doc.file_url} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="h-4 w-4 mr-2" />
                                View File
                              </a>
                            </DropdownMenuItem>
                          )}
                          {isAdminOrManager && (
                            <>
                              <DropdownMenuItem onClick={() => openEditDialog(doc)}>
                                <Edit className="h-4 w-4 mr-2" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleDelete(doc)}
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
    </div>
  );
}
