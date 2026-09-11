/**
 * The one confirmation for discarding an empty draft, shared by the coverage grid and the report editor.
 * A guardrail, not coaching: the copy is always shown, never behind a <Hint>.
 */
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export interface DiscardDraftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  /** A discard is already in flight: the action is disabled so a double tap cannot send two. */
  pending?: boolean;
}

export function DiscardDraftDialog({ open, onOpenChange, onConfirm, pending }: DiscardDraftDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard this draft?</AlertDialogTitle>
          <AlertDialogDescription>
            Only a draft with no saved content can be discarded. The draft is deleted; this cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
          <AlertDialogAction className="min-h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={pending} onClick={onConfirm}>
            Discard draft
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
