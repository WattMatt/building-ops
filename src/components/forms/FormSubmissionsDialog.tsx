import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Loader2, Eye, FileText, ChevronRight, User, Building2, Calendar } from 'lucide-react';

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
}

export function FormSubmissionsDialog({
  form,
  open,
  onOpenChange,
}: FormSubmissionsDialogProps) {
  const [selectedSubmission, setSelectedSubmission] = useState<SubmissionDetails | null>(null);

  const { data: submissions, isLoading } = useQuery({
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
          created_at
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
          [building.id]: building.name,
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
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedSubmission(null)}
                className="mb-4"
              >
                ← Back to list
              </Button>

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

              <Separator />

              <div className="space-y-4">
                <h4 className="font-semibold">Form Data</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Object.entries(selectedSubmission.form_data).map(([key, value]) => (
                    <div key={key} className="border rounded-lg p-3">
                      <Label className="text-muted-foreground text-xs uppercase tracking-wide">
                        {key}
                      </Label>
                      <p className="mt-1 text-sm break-words">
                        {typeof value === 'boolean' ? (value ? '✓ Yes' : '✗ No') : String(value) || '-'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
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
                  <TableHead className="w-[100px]">Actions</TableHead>
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
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedSubmission(submission)}
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        View
                      </Button>
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
    </Dialog>
  );
}

function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={className}>{children}</span>;
}
