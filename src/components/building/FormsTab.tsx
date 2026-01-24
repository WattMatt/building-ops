import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  Key,
  HardHat,
  ClipboardList,
  Wrench,
  Users,
  AlertTriangle,
  Flame,
  Shield,
  Truck,
  PenLine,
  Eye,
  FileText,
  Loader2,
  Download,
  Image,
} from 'lucide-react';
import { FormPreviewDialog } from '@/components/forms/FormPreviewDialog';
import { FillableFormDialog } from '@/components/forms/FillableFormDialog';
import { defaultFormFields } from '@/lib/formFields';
import { useOrganization } from '@/hooks/useOrganization';
import { generateFilledFormPdf } from '@/lib/pdfGenerator';
import { toast } from 'sonner';

interface FormsTabProps {
  buildingId: string;
  buildingName: string;
}

interface FormTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: React.ReactNode;
}

interface SubmissionDetails {
  id: string;
  form_template_id: string;
  form_name: string;
  form_data: Record<string, any>;
  submitted_by: string;
  status: string;
  created_at: string;
  photo_urls?: string[];
}

const formTemplates: FormTemplate[] = [
  { id: '1', name: 'Key Access Log', description: 'Track keys issued/returned', category: 'Security', icon: <Key className="h-5 w-5" /> },
  { id: '2', name: 'Roof Access Journal', description: 'Record roof access', category: 'Maintenance', icon: <HardHat className="h-5 w-5" /> },
  { id: '3', name: 'Daily Site Handover', description: 'Shift handover notes', category: 'Operations', icon: <ClipboardList className="h-5 w-5" /> },
  { id: '4', name: 'Asset Inspection', description: 'Equipment condition checks', category: 'Maintenance', icon: <Wrench className="h-5 w-5" /> },
  { id: '5', name: 'Cleaning Log', description: 'Hygiene & cleaning records', category: 'Cleaning', icon: <ClipboardList className="h-5 w-5" /> },
  { id: '6', name: 'Visitor Log', description: 'Visitor access control', category: 'Security', icon: <Users className="h-5 w-5" /> },
  { id: '7', name: 'Work Order', description: 'Job cards & work orders', category: 'Maintenance', icon: <Wrench className="h-5 w-5" /> },
  { id: '8', name: 'Incident Report', description: 'Incident & near-miss reports', category: 'Safety', icon: <AlertTriangle className="h-5 w-5" /> },
  { id: '9', name: 'Evacuation Drill', description: 'Emergency drill records', category: 'Safety', icon: <Flame className="h-5 w-5" /> },
  { id: '10', name: 'Permit to Work', description: 'Hot work & safety permits', category: 'Safety', icon: <Shield className="h-5 w-5" /> },
  { id: '11', name: 'Certificate Register', description: 'Compliance certificates', category: 'Compliance', icon: <FileText className="h-5 w-5" /> },
  { id: '12', name: 'Pest Control Log', description: 'Pest & waste management', category: 'Maintenance', icon: <ClipboardList className="h-5 w-5" /> },
  { id: '13', name: 'Parking Incident', description: 'Vehicle incident logs', category: 'Security', icon: <Truck className="h-5 w-5" /> },
  { id: '14', name: 'Training Record', description: 'Training & PPE issuance', category: 'HR', icon: <Users className="h-5 w-5" /> },
];

const categoryColors: Record<string, string> = {
  Security: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  Maintenance: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  Operations: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  Cleaning: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  Safety: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  Compliance: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  HR: 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-400',
};

export default function FormsTab({ buildingId, buildingName }: FormsTabProps) {
  const [selectedForm, setSelectedForm] = useState<FormTemplate | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [fillOpen, setFillOpen] = useState(false);
  const [selectedSubmission, setSelectedSubmission] = useState<SubmissionDetails | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const { organization } = useOrganization();

  // Fetch submissions for this building
  const { data: submissions, isLoading, refetch } = useQuery({
    queryKey: ['building-form-submissions', buildingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('form_submissions')
        .select('id, form_template_id, form_name, form_data, submitted_by, status, created_at, photo_urls')
        .eq('building_id', buildingId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as SubmissionDetails[];
    },
  });

  // Fetch profiles for submitted_by
  const { data: profiles } = useQuery({
    queryKey: ['profiles-for-building-submissions', submissions?.map((s) => s.submitted_by)],
    queryFn: async () => {
      if (!submissions || submissions.length === 0) return {};
      const userIds = [...new Set(submissions.map((s) => s.submitted_by))];
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', userIds);

      if (error) throw error;
      return (data || []).reduce(
        (acc, profile) => ({
          ...acc,
          [profile.id]: profile.full_name || profile.email,
        }),
        {} as Record<string, string>
      );
    },
    enabled: !!submissions && submissions.length > 0,
  });

  const handleFill = (form: FormTemplate) => {
    setSelectedForm(form);
    setFillOpen(true);
  };

  const handlePreview = (form: FormTemplate) => {
    setSelectedForm(form);
    setPreviewOpen(true);
  };

  const handleDownloadPdf = async (submission: SubmissionDetails) => {
    const form = formTemplates.find(f => f.id === submission.form_template_id);
    if (!form) return;
    
    setIsDownloading(true);
    try {
      const fields = defaultFormFields[form.id] || [];
      const submitterName = profiles?.[submission.submitted_by] || 'Unknown';
      
      await generateFilledFormPdf(
        { id: form.id, name: form.name, description: form.description, category: form.category },
        fields,
        submission.form_data,
        {
          name: organization?.name || 'FM Comply',
          logoUrl: organization?.logo_url,
          primaryColor: organization?.primary_color || '#2563eb',
          address: organization?.address,
          phone: organization?.phone,
          email: organization?.email,
        },
        submitterName,
        new Date(submission.created_at)
      );
      toast.success('PDF downloaded');
    } catch (error) {
      console.error('PDF generation error:', error);
      toast.error('Failed to generate PDF');
    } finally {
      setIsDownloading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'submitted':
        return <Badge variant="default">Submitted</Badge>;
      case 'reviewed':
        return <Badge variant="secondary">Reviewed</Badge>;
      case 'approved':
        return <Badge className="bg-success text-success-foreground">Approved</Badge>;
      case 'rejected':
        return <Badge variant="destructive">Rejected</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <Tabs defaultValue="fill" className="w-full">
        <TabsList>
          <TabsTrigger value="fill">Fill Forms</TabsTrigger>
          <TabsTrigger value="submissions">
            Submissions
            {submissions && submissions.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {submissions.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="fill" className="mt-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {formTemplates.map((form) => (
              <Card key={form.id} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                      {form.icon}
                    </div>
                    <Badge className={categoryColors[form.category] || ''} variant="secondary">
                      {form.category}
                    </Badge>
                  </div>
                  <CardTitle className="text-base mt-3">{form.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">{form.description}</p>
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1" onClick={() => handleFill(form)}>
                      <PenLine className="h-4 w-4 mr-1" />
                      Fill
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handlePreview(form)}>
                      <Eye className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="submissions" className="mt-6">
          {selectedSubmission ? (
            // Submission Detail View
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{selectedSubmission.form_name}</CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">
                      Submitted on {format(new Date(selectedSubmission.created_at), 'PPpp')}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setSelectedSubmission(null)}>
                      ← Back
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleDownloadPdf(selectedSubmission)}
                      disabled={isDownloading}
                    >
                      {isDownloading ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4 mr-2" />
                      )}
                      PDF
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4 mb-6 text-sm">
                  <span className="text-muted-foreground">By:</span>
                  <span className="font-medium">{profiles?.[selectedSubmission.submitted_by] || 'Unknown'}</span>
                  <span className="text-muted-foreground">Status:</span>
                  {getStatusBadge(selectedSubmission.status)}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Object.entries(selectedSubmission.form_data).map(([key, value]) => {
                    const isPhotoField = Array.isArray(value) && value.length > 0 && 
                      typeof value[0] === 'string' && value[0].includes('http');
                    
                    return (
                      <div key={key} className={`border rounded-lg p-3 ${isPhotoField ? 'md:col-span-2' : ''}`}>
                        <span className="text-muted-foreground text-xs uppercase tracking-wide">{key}</span>
                        {isPhotoField ? (
                          <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {(value as string[]).map((url, i) => (
                              <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="aspect-square rounded-lg overflow-hidden border hover:border-primary">
                                <img src={url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                              </a>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-1 text-sm">
                            {typeof value === 'boolean' ? (value ? '✓ Yes' : '✗ No') : String(value) || '-'}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>

                {selectedSubmission.photo_urls && selectedSubmission.photo_urls.length > 0 && (
                  <div className="mt-6">
                    <h4 className="font-semibold flex items-center gap-2 mb-3">
                      <Image className="h-4 w-4" />
                      Attached Photos ({selectedSubmission.photo_urls.length})
                    </h4>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {selectedSubmission.photo_urls.map((url, i) => (
                        <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="aspect-square rounded-lg overflow-hidden border hover:border-primary">
                          <img src={url} alt={`Evidence ${i + 1}`} className="w-full h-full object-cover" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : submissions && submissions.length > 0 ? (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Form</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Submitted By</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[120px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {submissions.map((submission) => (
                    <TableRow key={submission.id}>
                      <TableCell className="font-medium">{submission.form_name}</TableCell>
                      <TableCell>{format(new Date(submission.created_at), 'PP p')}</TableCell>
                      <TableCell>{profiles?.[submission.submitted_by] || 'Unknown'}</TableCell>
                      <TableCell>{getStatusBadge(submission.status)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="sm" onClick={() => setSelectedSubmission(submission)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDownloadPdf(submission)}
                            disabled={isDownloading}
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <FileText className="h-12 w-12 mb-4 opacity-50" />
                <p>No form submissions yet for this building</p>
                <p className="text-sm mt-1">Fill out a form to get started</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Form Preview Dialog */}
      <FormPreviewDialog
        form={selectedForm}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
      />

      {/* Fillable Form Dialog with pre-selected building */}
      <FillableFormDialog
        form={selectedForm}
        fields={selectedForm ? defaultFormFields[selectedForm.id] || [] : []}
        open={fillOpen}
        onOpenChange={setFillOpen}
        preselectedBuildingId={buildingId}
        preselectedBuildingName={buildingName}
        onSubmitSuccess={() => refetch()}
      />
    </div>
  );
}
