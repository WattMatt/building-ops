import { useState } from 'react';
import { formatBuildingName } from '@/lib/buildingName';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { openStorageFile } from '@/integrations/supabase/storage';
import { SignedImage } from '@/components/ui/signed-image';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { Loader2, Eye, FileText, User, Building2, Calendar, Download, Image, CheckCircle, XCircle, Clock } from 'lucide-react';
import { useOrganization } from '@/hooks/useOrganization';
import { generateFilledFormPdf } from '@/lib/pdfGenerator';
import { defaultFormFields, FormField } from '@/lib/formFields';
import { toast } from 'sonner';

interface FormTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: React.ReactNode;
}

interface FormSubmissionsDialogProps {
  form: FormTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SubmissionDetails {
  id: string;
  form_data: Record<string, any>;
  submitted_by: string;
  building_id: string | null;
  status: string;
  created_at: string;
  photo_urls?: string[];
  reviewed_by?: string;
  reviewed_at?: string;
  review_notes?: string;
}

export function FormSubmissionsDialog({
  form,
  open,
  onOpenChange,
}: FormSubmissionsDialogProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedSubmission, setSelectedSubmission] = useState<SubmissionDetails | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [actionType, setActionType] = useState<'approve' | 'reject' | 'review' | null>(null);
  const [actionNotes, setActionNotes] = useState('');
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
  const { organization } = useOrganization();

  const { data: submissions, isLoading, refetch } = useQuery({
    queryKey: ['form-submissions', form?.id],
    queryFn: async () => {
      if (!form) return [];
      const { data, error } = await supabase
        .from('form_submissions')
        .select(`
          id,
          form_data,
          submitted_by,
          building_id,
          status,
          created_at,
          photo_urls,
          reviewed_by,
          reviewed_at,
          review_notes
        `)
        .eq('form_template_id', form.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as SubmissionDetails[];
    },
    enabled: open && !!form,
  });

  // Fetch profiles for submitted_by
  const { data: profiles } = useQuery({
    queryKey: ['profiles-for-submissions', submissions?.map((s) => s.submitted_by)],
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

  // Fetch buildings for building_id
  const { data: buildings } = useQuery({
    queryKey: [
      'buildings-for-submissions',
      submissions?.filter((s) => s.building_id).map((s) => s.building_id),
    ],
    queryFn: async () => {
      if (!submissions) return {};
      const buildingIds = submissions
        .map((s) => s.building_id)
        .filter((id): id is string => !!id);
      if (buildingIds.length === 0) return {};

      const { data, error } = await supabase
        .from('buildings')
        .select('id, name')
        .in('id', buildingIds);

      if (error) throw error;
      return (data || []).reduce(
        (acc, building) => ({
          ...acc,
          [building.id]: formatBuildingName(building.name),
        }),
        {} as Record<string, string>
      );
    },
    enabled: !!submissions,
  });

  if (!form) return null;

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

  const handleOpenAction = (type: 'approve' | 'reject' | 'review') => {
    setActionType(type);
    setActionNotes('');
    setActionDialogOpen(true);
  };

  const handleSubmitAction = async () => {
    if (!selectedSubmission || !actionType || !user || !form) return;

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
      
      // Send email notification for approve/reject (not for "reviewed")
      if (actionType === 'approve' || actionType === 'reject') {
        const buildingName = selectedSubmission.building_id ? buildings?.[selectedSubmission.building_id] : undefined;
        supabase.functions.invoke('notify-form-review', {
          body: {
            submissionId: selectedSubmission.id,
            formName: form.name,
            buildingName: buildingName || '',
            submittedById: selectedSubmission.submitted_by,
            status: newStatus,
            reviewerName: user.email || 'Manager',
            reviewNotes: actionNotes || undefined,
            reviewedAt: reviewedAt,
          }
        }).catch(err => {
          if (import.meta.env.DEV) console.error('Failed to send review notification:', err);
        });
      }
      
      setActionDialogOpen(false);
      setSelectedSubmission(null);
      refetch();
      queryClient.invalidateQueries({ queryKey: ['form-submissions'] });
    } catch (error: any) {
      if (import.meta.env.DEV) console.error('Action error:', error);
      toast.error(error.message || 'Failed to update submission');
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleDownloadPdf = async (submission: SubmissionDetails) => {
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
      toast.success('PDF downloaded successfully');
    } catch (error) {
      if (import.meta.env.DEV) console.error('PDF generation error:', error);
      toast.error('Failed to generate PDF');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
              {form.icon}
            </div>
            <div>
              <DialogTitle className="text-xl">
                {selectedSubmission ? 'Submission Details' : `${form.name} - Submissions`}
              </DialogTitle>
              <p className="text-sm text-muted-foreground">
                {selectedSubmission
                  ? `Submitted on ${format(new Date(selectedSubmission.created_at), 'PPpp')}`
                  : `${submissions?.length || 0} submission(s) found`}
              </p>
            </div>
          </div>
        </DialogHeader>

        <Separator className="my-4" />

        <ScrollArea className="flex-1">
          {selectedSubmission ? (
            // Submission Detail View
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedSubmission(null)}
                >
                  ← Back to list
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
                  Download PDF
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="flex items-center gap-2 text-sm">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Submitted by:</span>
                  <span className="font-medium">
                    {profiles?.[selectedSubmission.submitted_by] || 'Unknown'}
                  </span>
                </div>
                {selectedSubmission.building_id && (
                  <div className="flex items-center gap-2 text-sm">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Building:</span>
                    <span className="font-medium">
                      {buildings?.[selectedSubmission.building_id] || 'Unknown'}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Status:</span>
                  {getStatusBadge(selectedSubmission.status)}
                </div>
              </div>

              {/* Review Info */}
              {selectedSubmission.reviewed_by && (
                <div className="p-4 rounded-lg bg-muted/50 border mb-4">
                  <div className="flex items-center gap-2 text-sm mb-2">
                    <span className="text-muted-foreground">Reviewed by:</span>
                    <span className="font-medium">{profiles?.[selectedSubmission.reviewed_by] || 'Unknown'}</span>
                    {selectedSubmission.reviewed_at && (
                      <>
                        <span className="text-muted-foreground">on</span>
                        <span>{format(new Date(selectedSubmission.reviewed_at), 'PP p')}</span>
                      </>
                    )}
                  </div>
                  {selectedSubmission.review_notes && (
                    <div className="text-sm">
                      <span className="text-muted-foreground">Notes: </span>
                      <span>{selectedSubmission.review_notes}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Action Buttons for Pending Submissions */}
              {selectedSubmission.status === 'submitted' && (
                <div className="p-4 rounded-lg border-2 border-dashed border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700 mb-4">
                  <p className="text-sm text-amber-800 dark:text-amber-200 mb-3 font-medium">This submission requires review</p>
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleOpenAction('review')}
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      Mark as Reviewed
                    </Button>
                    <Button
                      size="sm"
                      className="bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => handleOpenAction('approve')}
                    >
                      <CheckCircle className="h-4 w-4 mr-1" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleOpenAction('reject')}
                    >
                      <XCircle className="h-4 w-4 mr-1" />
                      Reject
                    </Button>
                  </div>
                </div>
              )}

              {/* Action buttons for reviewed submissions */}
              {selectedSubmission.status === 'reviewed' && (
                <div className="p-4 rounded-lg border bg-muted/30 mb-4">
                  <p className="text-sm text-muted-foreground mb-3">Final decision required</p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => handleOpenAction('approve')}
                    >
                      <CheckCircle className="h-4 w-4 mr-1" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleOpenAction('reject')}
                    >
                      <XCircle className="h-4 w-4 mr-1" />
                      Reject
                    </Button>
                  </div>
                </div>
              )}

              <Separator />

              <div className="space-y-4">
                <h4 className="font-semibold">Form Data</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Object.entries(selectedSubmission.form_data).map(([key, value]) => {
                    // Check if this is a photo field
                    const isPhotoField = Array.isArray(value) && value.length > 0 && 
                      typeof value[0] === 'string' && value[0].includes('http');
                    
                    return (
                      <div key={key} className={`border rounded-lg p-3 ${isPhotoField ? 'md:col-span-2' : ''}`}>
                        <span className="text-muted-foreground text-xs uppercase tracking-wide">
                          {key}
                        </span>
                        {isPhotoField ? (
                          <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                            {(value as string[]).map((url, photoIndex) => (
                              <button
                                key={photoIndex}
                                type="button"
                                onClick={() => openStorageFile(url)}
                                className="relative aspect-square rounded-lg overflow-hidden border hover:border-primary transition-colors group"
                              >
                                <SignedImage
                                  src={url}
                                  alt={`Photo ${photoIndex + 1}`}
                                  className="w-full h-full object-cover"
                                />
                                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                  <Eye className="h-5 w-5 text-white" />
                                </div>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-1 text-sm break-words">
                            {typeof value === 'boolean' ? (value ? '✓ Yes' : '✗ No') : String(value) || '-'}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Display standalone photo_urls if any */}
              {selectedSubmission.photo_urls && selectedSubmission.photo_urls.length > 0 && (
                <div className="space-y-4">
                  <h4 className="font-semibold flex items-center gap-2">
                    <Image className="h-4 w-4" />
                    Attached Photos ({selectedSubmission.photo_urls.length})
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {selectedSubmission.photo_urls.map((url, index) => (
                      <button
                        key={index}
                        type="button"
                        onClick={() => openStorageFile(url)}
                        className="relative aspect-square rounded-lg overflow-hidden border hover:border-primary transition-colors group"
                      >
                        <SignedImage
                          src={url}
                          alt={`Evidence photo ${index + 1}`}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <Eye className="h-5 w-5 text-white" />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : submissions && submissions.length > 0 ? (
            // Submissions List
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Submitted By</TableHead>
                  <TableHead>Building</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[150px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {submissions.map((submission) => (
                  <TableRow key={submission.id}>
                    <TableCell>
                      {format(new Date(submission.created_at), 'PP p')}
                    </TableCell>
                    <TableCell>
                      {profiles?.[submission.submitted_by] || 'Unknown'}
                    </TableCell>
                    <TableCell>
                      {submission.building_id
                        ? buildings?.[submission.building_id] || '-'
                        : '-'}
                    </TableCell>
                    <TableCell>{getStatusBadge(submission.status)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedSubmission(submission)}
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          View
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
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <FileText className="h-12 w-12 mb-4 opacity-50" />
              <p>No submissions found for this form</p>
            </div>
          )}
        </ScrollArea>
      </DialogContent>

      {/* Action Confirmation Dialog */}
      <Dialog open={actionDialogOpen} onOpenChange={setActionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionType === 'approve' && 'Approve Submission'}
              {actionType === 'reject' && 'Reject Submission'}
              {actionType === 'review' && 'Mark as Reviewed'}
            </DialogTitle>
            <DialogDescription>
              {actionType === 'approve' && 'Confirm that this form submission meets all requirements.'}
              {actionType === 'reject' && 'Please provide a reason for rejecting this submission.'}
              {actionType === 'review' && 'Mark this submission as reviewed for further action.'}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <Label htmlFor="action-notes">
              {actionType === 'reject' ? 'Reason for Rejection *' : 'Notes (optional)'}
            </Label>
            <Textarea
              id="action-notes"
              placeholder={
                actionType === 'reject' 
                  ? 'Please explain why this submission is being rejected...'
                  : 'Add any notes or comments...'
              }
              value={actionNotes}
              onChange={(e) => setActionNotes(e.target.value)}
              className="mt-2"
              rows={4}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setActionDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmitAction}
              disabled={isSubmittingAction || (actionType === 'reject' && !actionNotes.trim())}
              className={
                actionType === 'approve' 
                  ? 'bg-green-600 hover:bg-green-700' 
                  : actionType === 'reject' 
                    ? 'bg-destructive hover:bg-destructive/90' 
                    : ''
              }
            >
              {isSubmittingAction && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {actionType === 'approve' && 'Approve'}
              {actionType === 'reject' && 'Reject'}
              {actionType === 'review' && 'Mark Reviewed'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
