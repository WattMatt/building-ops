/**
 * Detailed view of a single form submission
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SignedImage } from '@/components/ui/signed-image';
import { openStorageFile } from '@/integrations/supabase/storage';
import {
  Eye,
  Download,
  Clock,
  CheckCircle,
  XCircle,
  Image,
  Loader2,
} from 'lucide-react';
import { format } from 'date-fns';

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
}

interface SubmissionDetailViewProps {
  submission: SubmissionDetails;
  submitterName: string;
  reviewerName?: string;
  onBack: () => void;
  onDownload: () => void;
  isDownloading: boolean;
  onApprove: () => void;
  onReject: () => void;
  onMarkReviewed: () => void;
}

export function SubmissionDetailView({
  submission,
  submitterName,
  reviewerName,
  onBack,
  onDownload,
  isDownloading,
  onApprove,
  onReject,
  onMarkReviewed,
}: SubmissionDetailViewProps) {
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
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <CardTitle>{submission.form_name}</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Submitted on {format(new Date(submission.created_at), 'PPpp')}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={onBack}>
              ← Back
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onDownload}
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
        <div className="flex items-center gap-4 mb-6 text-sm flex-wrap">
          <span className="text-muted-foreground">By:</span>
          <span className="font-medium">{submitterName}</span>
          <span className="text-muted-foreground">Status:</span>
          {getStatusBadge(submission.status)}
        </div>

        {/* Review Info */}
        {submission.reviewed_by && (
          <div className="mb-6 p-4 rounded-lg bg-muted/50 border">
            <div className="flex items-center gap-2 text-sm mb-2">
              <span className="text-muted-foreground">Reviewed by:</span>
              <span className="font-medium">{reviewerName || 'Unknown'}</span>
              {submission.reviewed_at && (
                <>
                  <span className="text-muted-foreground">on</span>
                  <span>
                    {format(new Date(submission.reviewed_at), 'PP p')}
                  </span>
                </>
              )}
            </div>
            {submission.review_notes && (
              <div className="text-sm">
                <span className="text-muted-foreground">Notes: </span>
                <span>{submission.review_notes}</span>
              </div>
            )}
          </div>
        )}

        {/* Action Buttons for Pending Submissions */}
        {submission.status === 'submitted' && (
          <div className="mb-6 p-4 rounded-lg border-2 border-dashed border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700">
            <p className="text-sm text-amber-800 dark:text-amber-200 mb-3 font-medium">
              This submission requires review
            </p>
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="outline" onClick={onMarkReviewed}>
                <Eye className="h-4 w-4 mr-1" />
                Mark as Reviewed
              </Button>
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700 text-white"
                onClick={onApprove}
              >
                <CheckCircle className="h-4 w-4 mr-1" />
                Approve
              </Button>
              <Button size="sm" variant="destructive" onClick={onReject}>
                <XCircle className="h-4 w-4 mr-1" />
                Reject
              </Button>
            </div>
          </div>
        )}

        {/* Action buttons for reviewed submissions */}
        {submission.status === 'reviewed' && (
          <div className="mb-6 p-4 rounded-lg border bg-muted/30">
            <p className="text-sm text-muted-foreground mb-3">
              Final decision required
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700 text-white"
                onClick={onApprove}
              >
                <CheckCircle className="h-4 w-4 mr-1" />
                Approve
              </Button>
              <Button size="sm" variant="destructive" onClick={onReject}>
                <XCircle className="h-4 w-4 mr-1" />
                Reject
              </Button>
            </div>
          </div>
        )}

        {/* Form Data */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Object.entries(submission.form_data).map(([key, value]) => {
            const isPhotoField =
              Array.isArray(value) &&
              value.length > 0 &&
              typeof value[0] === 'string' &&
              value[0].includes('http');

            return (
              <div
                key={key}
                className={`border rounded-lg p-3 ${isPhotoField ? 'md:col-span-2' : ''}`}
              >
                <span className="text-muted-foreground text-xs uppercase tracking-wide">
                  {key}
                </span>
                {isPhotoField ? (
                  <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {(value as string[]).map((url, i) => (
                      <a
                        key={i}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="aspect-square rounded-lg overflow-hidden border hover:border-primary"
                      >
                        <img
                          src={url}
                          alt={`Photo ${i + 1}`}
                          className="w-full h-full object-cover"
                        />
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1 text-sm">
                    {typeof value === 'boolean'
                      ? value
                        ? '✓ Yes'
                        : '✗ No'
                      : String(value) || '-'}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Attached Photos */}
        {submission.photo_urls && submission.photo_urls.length > 0 && (
          <div className="mt-6">
            <h4 className="font-semibold flex items-center gap-2 mb-3">
              <Image className="h-4 w-4" />
              Attached Photos ({submission.photo_urls.length})
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {submission.photo_urls.map((url, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => openStorageFile(url)}
                  className="aspect-square rounded-lg overflow-hidden border hover:border-primary"
                >
                  <SignedImage
                    src={url}
                    alt={`Evidence ${i + 1}`}
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
