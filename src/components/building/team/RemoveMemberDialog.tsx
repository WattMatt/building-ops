/** Confirm removal, stating how many open tasks at this building are assigned to the person. */
import { Loader2 } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface RemoveMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  buildingName: string;
  /** null while the count is loading. */
  openTasks: number | null;
  busy: boolean;
  onConfirm: () => void;
}

export function removeDescription(openTasks: number): string {
  const tasks = openTasks === 1 ? '1 open task at this building is assigned to them and will be left with no owner.' : `${openTasks} open tasks at this building are assigned to them and will be left with no owner.`;
  return `${openTasks === 0 ? 'No open tasks at this building are assigned to them.' : tasks} Their role rules here will be removed and they will lose access to this building.`;
}

export function RemoveMemberDialog({ open, onOpenChange, name, buildingName, openTasks, busy, onConfirm }: RemoveMemberDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {name} from {buildingName}?</AlertDialogTitle>
          <AlertDialogDescription>
            {openTasks === null ? 'Counting their open tasks…' : removeDescription(openTasks)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} className="min-h-11">Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={(e) => { e.preventDefault(); onConfirm(); }} disabled={busy || openTasks === null} className="min-h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90">
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />}
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
