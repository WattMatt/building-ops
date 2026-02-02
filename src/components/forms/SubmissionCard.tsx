/**
 * Mobile-friendly card view for a single submission
 */

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Eye, Download, Clock, CheckCircle, XCircle } from 'lucide-react';
import { format } from 'date-fns';

interface SubmissionCardProps {
  submission: {
    id: string;
    form_name: string;
    created_at: string;
    status: string;
    submitted_by: string;
  };
  submitterName: string;
  onView: () => void;
  onDownload: () => void;
  isDownloading: boolean;
}

export function SubmissionCard({
  submission,
  submitterName,
  onView,
  onDownload,
  isDownloading,
}: SubmissionCardProps) {
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'submitted':
        return (
          <Badge variant="outline" className="border-amber-500 text-amber-600">
            <Clock className="h-3 w-3 mr-1" />
            Pending
          </Badge>
        );
      case 'reviewed':
        return (
          <Badge variant="secondary">
            <Eye className="h-3 w-3 mr-1" />
            Reviewed
          </Badge>
        );
      case 'approved':
        return (
          <Badge className="bg-green-600 text-white hover:bg-green-700">
            <CheckCircle className="h-3 w-3 mr-1" />
            Approved
          </Badge>
        );
      case 'rejected':
        return (
          <Badge variant="destructive">
            <XCircle className="h-3 w-3 mr-1" />
            Rejected
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h4 className="font-medium text-sm truncate">{submission.form_name}</h4>
            <p className="text-xs text-muted-foreground mt-1">
              {format(new Date(submission.created_at), 'PP p')}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              By: {submitterName}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {getStatusBadge(submission.status)}
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={onView}>
                <Eye className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onDownload}
                disabled={isDownloading}
              >
                <Download className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
