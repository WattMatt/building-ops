import { useEffect, useState, useCallback } from 'react';
import { formatBuildingName } from '@/lib/buildingName';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SignedImage } from '@/components/ui/signed-image';
import { Building2, Calendar, Clock, Loader2, UserCircle2, ArrowRight, Plus } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import type { IssuePriority, IssueStatus } from '@/lib/constants';
import { useBuildingMembers, memberDisplayName } from '@/hooks/useBuildingMembers';
import { AssigneePicker } from '@/components/people/AssigneePicker';
import { IssueCommentComposer } from '@/components/issues/IssueCommentComposer';
import { ResolveIssueDialog } from '@/components/issues/ResolveIssueDialog';
import { notify } from '@/lib/notify';
import { useAuth } from '@/contexts/AuthContext';

interface Issue {
  id: string;
  title: string;
  description: string;
  priority: IssuePriority;
  status: IssueStatus;
  deadline: string | null;
  created_at: string;
  building_id: string;
  building_name?: string;
  reported_by: string;
  assigned_to: string | null;
  corrective_action: string | null;
  photo_urls: string[] | null;
  task_instance_id: string | null;
}

interface Activity {
  id: string;
  activity_type: string;
  old_value: string | null;
  new_value: string | null;
  comment: string | null;
  author_name: string | null;
  created_at: string;
  user_id: string | null;
  photo_urls: string[] | null;
  mentions: string[] | null;
}

const statusColors: Record<IssueStatus, string> = {
  open: 'bg-warning text-warning-foreground',
  in_progress: 'bg-info text-info-foreground',
  escalated: 'bg-destructive text-destructive-foreground',
  resolved: 'bg-success text-success-foreground',
};
const statusLabels: Record<IssueStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  escalated: 'Escalated',
  resolved: 'Resolved',
};
const STATUS_ORDER: IssueStatus[] = ['open', 'in_progress', 'escalated', 'resolved'];

interface Props {
  issue: Issue;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
  onUpdated: () => void;
}

export default function IssueDetailDialog({ issue, open, onOpenChange, canManage, onUpdated }: Props) {
  const { user } = useAuth();
  const { byId: members } = useBuildingMembers(issue.building_id);
  const nameOf = (id: string | null | undefined) => (id && members.get(id) ? memberDisplayName(members.get(id)!) : null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [savingAssignee, setSavingAssignee] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: acts } = await supabase
        .from('issue_activity')
        .select('id, activity_type, old_value, new_value, comment, author_name, created_at, user_id, photo_urls, mentions')
        .eq('issue_id', issue.id)
        .order('created_at', { ascending: true });
      setActivity((acts as unknown as Activity[]) ?? []);
    } finally {
      setLoading(false);
    }
  }, [issue.id]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  // The issues trigger logs the change to issue_activity automatically.
  const changeStatus = async (status: IssueStatus) => {
    if (status === issue.status) return;
    if (status === 'resolved') {
      setResolveOpen(true);
      return;
    }
    setSavingStatus(true);
    try {
      const { data, error } = await supabase.from('issues').update({ status }).eq('id', issue.id).select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('You do not have permission to change this issue.');
      toast.success(`Status changed to ${statusLabels[status]}`);
      onUpdated();
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to change status');
    } finally {
      setSavingStatus(false);
    }
  };

  const changeAssignee = async (assigned_to: string | null) => {
    if (assigned_to === issue.assigned_to) return;
    setSavingAssignee(true);
    try {
      const { data, error } = await supabase.from('issues').update({ assigned_to }).eq('id', issue.id).select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('You do not have permission to assign this issue.');
      toast.success(assigned_to ? `Assigned to ${nameOf(assigned_to) ?? 'user'}` : 'Unassigned');
      if (assigned_to && assigned_to !== user?.id) {
        void notify({ kind: 'issue_assigned', entityType: 'issue', entityId: issue.id, buildingId: issue.building_id, recipients: [assigned_to], title: `Issue assigned to you: ${issue.title}`, url: `/issues?open=${issue.id}` });
      }
      onUpdated();
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to assign');
    } finally {
      setSavingAssignee(false);
    }
  };

  const activityText = (a: Activity): string => {
    switch (a.activity_type) {
      case 'created':
        return 'created this issue';
      case 'status_change':
        return `changed status ${statusLabels[a.old_value as IssueStatus] ?? a.old_value} → ${statusLabels[a.new_value as IssueStatus] ?? a.new_value}`;
      case 'assignment':
        return a.new_value
          ? `assigned to ${nameOf(a.new_value) ?? 'a user'}`
          : 'removed the assignee';
      case 'contractor_assignment':
        return `assigned contractor ${a.new_value ?? ''}`.trim();
      case 'comment':
        return '';
      default:
        return a.activity_type;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6">{issue.title}</DialogTitle>
          <DialogDescription className="flex items-center gap-2 flex-wrap pt-1">
            <Badge variant="secondary" className={statusColors[issue.status]}>{statusLabels[issue.status]}</Badge>
            <span className="flex items-center gap-1 text-xs"><Building2 className="h-3 w-3" />{formatBuildingName(issue.building_name)}</span>
            <span className="flex items-center gap-1 text-xs"><Calendar className="h-3 w-3" />{format(new Date(issue.created_at), 'MMM d, yyyy')}</span>
            {issue.deadline && (
              <span className="flex items-center gap-1 text-xs"><Clock className="h-3 w-3" />Due {format(new Date(issue.deadline), 'MMM d')}</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm whitespace-pre-wrap">{issue.description}</p>

          {issue.corrective_action && (
            <div className="rounded-lg bg-muted/50 p-3 text-sm">
              <span className="font-medium">Corrective action: </span>{issue.corrective_action}
            </div>
          )}

          {issue.photo_urls && issue.photo_urls.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {issue.photo_urls.map((url, i) => (
                <SignedImage key={i} src={url} alt={`Evidence ${i + 1}`} className="h-20 w-20 rounded-md object-cover border" />
              ))}
            </div>
          )}

          {/* Management controls (admin/manager) */}
          {canManage && (
            <div className="grid grid-cols-2 gap-3 border-t pt-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Status</Label>
                <Select value={issue.status} onValueChange={(v) => changeStatus(v as IssueStatus)} disabled={savingStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_ORDER.map((s) => (
                      <SelectItem key={s} value={s}>{statusLabels[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Assignee</Label>
                <AssigneePicker buildingId={issue.building_id} value={issue.assigned_to} onChange={changeAssignee} disabled={savingAssignee} />
              </div>
            </div>
          )}

          {/* History */}
          <div className="border-t pt-4">
            <Label className="text-xs text-muted-foreground">History</Label>
            {loading ? (
              <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
            ) : activity.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No history yet.</p>
            ) : (
              <ol className="mt-2 space-y-3">
                {activity.map((a) => (
                  <li key={a.id} className="flex gap-2 text-sm">
                    <span className="mt-0.5 text-muted-foreground">
                      {a.activity_type === 'status_change' ? <ArrowRight className="h-4 w-4" />
                        : a.activity_type === 'assignment' ? <UserCircle2 className="h-4 w-4" />
                        : <Plus className="h-4 w-4" />}
                    </span>
                    <div className="flex-1">
                      <p>
                        <span className="font-medium">{a.author_name ?? 'Someone'}</span> {activityText(a)}
                      </p>
                      {a.activity_type === 'comment' && a.comment && (
                        <p className="whitespace-pre-wrap">{a.comment}</p>
                      )}
                      {a.photo_urls && a.photo_urls.length > 0 && (
                        <div className="mt-1 flex gap-2 flex-wrap">
                          {a.photo_urls.map((url, i) => (
                            <SignedImage key={i} src={url} alt={`Comment photo ${i + 1}`} className="h-16 w-16 rounded-md object-cover border" />
                          ))}
                        </div>
                      )}
                      {a.mentions && a.mentions.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Mentioned: {a.mentions.map((id) => nameOf(id)).filter((n): n is string => !!n).join(', ')}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">{format(new Date(a.created_at), 'MMM d, yyyy • h:mm a')}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}

            <IssueCommentComposer
              issueId={issue.id}
              buildingId={issue.building_id}
              issueTitle={issue.title}
              reporterId={issue.reported_by}
              assigneeId={issue.assigned_to}
              onPosted={() => { void load(); onUpdated(); }}
            />
          </div>
        </div>

        <ResolveIssueDialog
          issueId={issue.id}
          open={resolveOpen}
          onOpenChange={setResolveOpen}
          onResolved={() => { onUpdated(); void load(); }}
        />
      </DialogContent>
    </Dialog>
  );
}
