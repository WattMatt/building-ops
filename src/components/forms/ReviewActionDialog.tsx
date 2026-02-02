/**
 * Dialog for approving, rejecting, or reviewing form submissions
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';

interface ReviewActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actionType: 'approve' | 'reject' | 'review' | null;
  notes: string;
  onNotesChange: (notes: string) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
}

export function ReviewActionDialog({
  open,
  onOpenChange,
  actionType,
  notes,
  onNotesChange,
  onSubmit,
  isSubmitting,
}: ReviewActionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {actionType === 'approve' && 'Approve Submission'}
            {actionType === 'reject' && 'Reject Submission'}
            {actionType === 'review' && 'Mark as Reviewed'}
          </DialogTitle>
          <DialogDescription>
            {actionType === 'approve' &&
              'Confirm that this form submission meets all requirements.'}
            {actionType === 'reject' &&
              'Please provide a reason for rejecting this submission.'}
            {actionType === 'review' &&
              'Mark this submission as reviewed for further action.'}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <Label htmlFor="notes">
            {actionType === 'reject' ? 'Reason for Rejection *' : 'Notes (optional)'}
          </Label>
          <Textarea
            id="notes"
            placeholder={
              actionType === 'reject'
                ? 'Please explain why this submission is being rejected...'
                : 'Add any notes or comments...'
            }
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            className="mt-2"
            rows={4}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            disabled={isSubmitting || (actionType === 'reject' && !notes.trim())}
            className={
              actionType === 'approve'
                ? 'bg-green-600 hover:bg-green-700'
                : actionType === 'reject'
                  ? 'bg-destructive hover:bg-destructive/90'
                  : ''
            }
          >
            {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {actionType === 'approve' && 'Approve'}
            {actionType === 'reject' && 'Reject'}
            {actionType === 'review' && 'Mark Reviewed'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
