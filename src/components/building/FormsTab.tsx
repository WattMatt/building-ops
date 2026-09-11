/**
 * Forms Tab - Building-specific form management
 * Refactored into smaller, focused components
 */

import { useState, useMemo } from 'react';
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
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import {
  PenLine,
  Eye,
  FileText,
  Loader2,
  Download,
  Clock,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { FormPreviewDialog } from '@/components/forms/FormPreviewDialog';
import { FillableFormDialog } from '@/components/forms/FillableFormDialog';
import { SubmissionStats } from '@/components/forms/SubmissionStats';
import { SubmissionFilters } from '@/components/forms/SubmissionFilters';
import { SubmissionCard } from '@/components/forms/SubmissionCard';
import { SubmissionDetailView } from '@/components/forms/SubmissionDetailView';
import { ReviewActionDialog } from '@/components/forms/ReviewActionDialog';
import { FormIcon } from '@/components/forms/FormIcon';
import { formCategoryClass, parseFields, useFormTemplates, type FormTemplate } from '@/hooks/useFormTemplates';
import { useOrganization } from '@/hooks/useOrganization';
import { generateFilledFormPdf } from '@/lib/pdfGenerator';
import { toast } from 'sonner';

interface FormsTabProps {
  buildingId: string;
  buildingName: string;
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
  reviewed_by?: string;
  reviewed_at?: string;
  review_notes?: string;
  /** The template version and field list this submission was filled against (R4c). */
  template_version?: number | null;
  fields_snapshot?: unknown;
}

export default function FormsTab({ buildingId, buildingName }: FormsTabProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { organization } = useOrganization();
  const { templates, byId, isLoading: templatesLoading, isError: templatesError } = useFormTemplates();

  // Dialog states
  const [selectedForm, setSelectedForm] = useState<FormTemplate | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [fillOpen, setFillOpen] = useState(false);
  const [selectedSubmission, setSelectedSubmission] = useState<SubmissionDetails | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  
  // Action dialog states
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [actionType, setActionType] = useState<'approve' | 'reject' | 'review' | null>(null);
  const [actionNotes, setActionNotes] = useState('');
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);

  // Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [formFilter, setFormFilter] = useState('all');

  // Fetch submissions for this building
  const { data: submissions, isLoading, refetch } = useQuery({
    queryKey: ['building-form-submissions', buildingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('form_submissions')
        .select('id, form_template_id, form_name, form_data, submitted_by, status, created_at, photo_urls, reviewed_by, reviewed_at, review_notes, template_version, fields_snapshot')
        .eq('building_id', buildingId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      // template_version / fields_snapshot are not yet in the generated types — regenerate after
      // 2026-09-14_03 ships.
      return data as unknown as SubmissionDetails[];
    },
  });

  // Fetch profiles for submitted_by
  const { data: profiles } = useQuery({
    queryKey: ['profiles-for-building-submissions', submissions?.map((s) => s.submitted_by)],
    queryFn: async () => {
      if (!submissions || submissions.length === 0) return {};
      const userIds = [...new Set([
        ...submissions.map((s) => s.submitted_by),
        ...submissions.filter(s => s.reviewed_by).map((s) => s.reviewed_by!)
      ])];
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

  // Computed stats
  const stats = useMemo(() => {
    if (!submissions) return { total: 0, pending: 0, reviewed: 0, approved: 0, rejected: 0 };
    return {
      total: submissions.length,
      pending: submissions.filter(s => s.status === 'submitted').length,
      reviewed: submissions.filter(s => s.status === 'reviewed').length,
      approved: submissions.filter(s => s.status === 'approved').length,
      rejected: submissions.filter(s => s.status === 'rejected').length,
    };
  }, [submissions]);

  // Filtered submissions
  const filteredSubmissions = useMemo(() => {
    if (!submissions) return [];
    return submissions.filter((s) => {
      const matchesSearch = searchQuery === '' || 
        s.form_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (profiles?.[s.submitted_by] || '').toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === 'all' || s.status === statusFilter;
      const matchesForm = formFilter === 'all' || s.form_name === formFilter;
      return matchesSearch && matchesStatus && matchesForm;
    });
  }, [submissions, searchQuery, statusFilter, formFilter, profiles]);

  // Unique form names for filter dropdown
  const formNames = useMemo(() => {
    if (!submissions) return [];
    return [...new Set(submissions.map(s => s.form_name))].sort();
  }, [submissions]);

  const handleFill = (form: FormTemplate) => {
    setSelectedForm(form);
    setFillOpen(true);
  };

  const handlePreview = (form: FormTemplate) => {
    setSelectedForm(form);
    setPreviewOpen(true);
  };

  const handleDownloadPdf = async (submission: SubmissionDetails) => {
    // The fields this submission was actually filled against, so an edited template never
    // reshapes an old PDF; older rows have no snapshot and fall back to the template's fields.
    const template = byId(submission.form_template_id);
    const snapshot = parseFields(submission.fields_snapshot);
    const fields = snapshot.length > 0 ? snapshot : template?.fields ?? [];
    // A submission whose template id no longer resolves still downloads from its own snapshot.
    if (!template && fields.length === 0) return;
    const form = template ?? {
      id: submission.form_template_id ?? '',
      name: submission.form_name,
      description: '',
      category: '',
    };

    setIsDownloading(true);
    try {
      const submitterName = profiles?.[submission.submitted_by] || 'Unknown';

      await generateFilledFormPdf(
        { id: form.id, name: form.name, description: form.description, category: form.category },
        fields,
        submission.form_data,
        {
          name: organization?.name || 'Building Ops',
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

  const handleOpenAction = (type: 'approve' | 'reject' | 'review') => {
    setActionType(type);
    setActionNotes('');
    setActionDialogOpen(true);
  };

  const handleSubmitAction = async () => {
    if (!selectedSubmission || !actionType || !user) return;

    setIsSubmittingAction(true);
    const reviewedAt = new Date().toISOString();
    const newStatus = actionType === 'review' ? 'reviewed' : actionType === 'approve' ? 'approved' : 'rejected';
    
    try {
      const { error } = await supabase
        .from('form_submissions')
        .update({
          status: newStatus,
          reviewed_by: user.id,
          reviewed_at: reviewedAt,
          review_notes: actionNotes || null,
        })
        .eq('id', selectedSubmission.id);

      if (error) throw error;

      toast.success(`Submission ${actionType === 'review' ? 'marked as reviewed' : actionType === 'approve' ? 'approved' : 'rejected'}`);
      
      // Send email notification for approve/reject
      if (actionType === 'approve' || actionType === 'reject') {
        supabase.functions.invoke('notify-form-review', {
          body: {
            submissionId: selectedSubmission.id,
            formName: selectedSubmission.form_name,
            buildingName: buildingName,
            submittedById: selectedSubmission.submitted_by,
            status: newStatus,
            reviewerName: user.email || 'Manager',
            reviewNotes: actionNotes || undefined,
            reviewedAt: reviewedAt,
          }
        }).catch(err => console.error('Failed to send review notification:', err));
      }
      
      setActionDialogOpen(false);
      setSelectedSubmission(null);
      refetch();
      queryClient.invalidateQueries({ queryKey: ['building-form-submissions'] });
    } catch (error: any) {
      console.error('Action error:', error);
      toast.error(error.message || 'Failed to update submission');
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'submitted':
        return <Badge variant="outline" className="border-amber-500 text-amber-600"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
      case 'reviewed':
        return <Badge variant="secondary"><Eye className="h-3 w-3 mr-1" />Reviewed</Badge>;
      case 'approved':
        return <Badge className="bg-green-600 text-white hover:bg-green-700"><CheckCircle className="h-3 w-3 mr-1" />Approved</Badge>;
      case 'rejected':
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Rejected</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <Tabs defaultValue="fill" className="w-full">
        <TabsList>
          <TabsTrigger value="fill">Fill Forms</TabsTrigger>
          <TabsTrigger value="submissions" className="flex items-center gap-2">
            Submissions
            {submissions && submissions.length > 0 && (
              <Badge variant="secondary">{submissions.length}</Badge>
            )}
            {stats.pending > 0 && (
              <Badge variant="outline" className="border-amber-500 text-amber-600">
                {stats.pending} pending
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Fill Forms Tab */}
        <TabsContent value="fill" className="mt-6">
          {templatesLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : templatesError ? (
            <p className="text-sm text-destructive">Could not load the forms library.</p>
          ) : templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No forms are available yet.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {templates.map((form) => (
                <Card key={form.id} className="hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                        <FormIcon name={form.icon} />
                      </div>
                      <Badge className={formCategoryClass(form.category)} variant="secondary">
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
          )}
        </TabsContent>

        {/* Submissions Tab */}
        <TabsContent value="submissions" className="mt-6 space-y-6">
          {selectedSubmission ? (
            <SubmissionDetailView
              submission={selectedSubmission}
              submitterName={profiles?.[selectedSubmission.submitted_by] || 'Unknown'}
              reviewerName={selectedSubmission.reviewed_by ? profiles?.[selectedSubmission.reviewed_by] : undefined}
              onBack={() => setSelectedSubmission(null)}
              onDownload={() => handleDownloadPdf(selectedSubmission)}
              isDownloading={isDownloading}
              onApprove={() => handleOpenAction('approve')}
              onReject={() => handleOpenAction('reject')}
              onMarkReviewed={() => handleOpenAction('review')}
            />
          ) : isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : submissions && submissions.length > 0 ? (
            <>
              {/* Stats */}
              <SubmissionStats {...stats} />

              {/* Filters */}
              <SubmissionFilters
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                statusFilter={statusFilter}
                onStatusChange={setStatusFilter}
                formFilter={formFilter}
                onFormChange={setFormFilter}
                formNames={formNames}
              />

              {/* Mobile Card View */}
              <div className="grid gap-3 sm:hidden">
                {filteredSubmissions.map((submission) => (
                  <SubmissionCard
                    key={submission.id}
                    submission={submission}
                    submitterName={profiles?.[submission.submitted_by] || 'Unknown'}
                    onView={() => setSelectedSubmission(submission)}
                    onDownload={() => handleDownloadPdf(submission)}
                    isDownloading={isDownloading}
                  />
                ))}
                {filteredSubmissions.length === 0 && (
                  <Card>
                    <CardContent className="py-8 text-center text-muted-foreground">
                      No submissions match your filters
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Desktop Table View */}
              <Card className="hidden sm:block">
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
                    {filteredSubmissions.map((submission) => (
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
                    {filteredSubmissions.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          No submissions match your filters
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </Card>
            </>
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

      {/* Fillable Form Dialog */}
      <FillableFormDialog
        form={selectedForm}
        open={fillOpen}
        onOpenChange={setFillOpen}
        preselectedBuildingId={buildingId}
        preselectedBuildingName={buildingName}
        onSubmitSuccess={() => refetch()}
      />

      {/* Review Action Dialog */}
      <ReviewActionDialog
        open={actionDialogOpen}
        onOpenChange={setActionDialogOpen}
        actionType={actionType}
        notes={actionNotes}
        onNotesChange={setActionNotes}
        onSubmit={handleSubmitAction}
        isSubmitting={isSubmittingAction}
      />
    </div>
  );
}
